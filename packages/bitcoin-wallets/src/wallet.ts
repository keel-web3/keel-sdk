import { Buffer } from "buffer";
import { address, Psbt, Transaction } from "bitcoinjs-lib";
import { createSession } from "./accounts.js";
import { validateAccount } from "./keys.js";
import { bitcoinNetwork, assertWalletNetwork } from "./network.js";
import { WalletSessionGuard, sessionIdentity, type Subscribe, type FocusTarget } from "./session.js";
import { classifyPaymentUtxos, recheckPaymentInputs, type ClassificationReceipt, type KeelOutputReader, type PaymentUtxo } from "./utxos.js";
import { validateSignedPsbt } from "./signed-review.js";
import { signWithProvider, type SigningProvider, type WalletId } from "./signing.js";
import { signBip322Message } from "./messages.js";
import type { BtcAccount, BtcNet, BtcSession, SignRequest } from "./types.js";

type MessageTransport = Parameters<typeof signBip322Message>[0]["transport"];
export interface BitcoinWalletHost {
  id: WalletId;
  connect(network: BtcNet): Promise<BtcSession>;
  readLiveSession(network: BtcNet): Promise<BtcSession>;
  /** Read the selected provider's current network, not an address-derived guess. */
  getNetwork(): Promise<BtcNet | unknown>;
  signingProvider: SigningProvider;
  /** Optional documented BIP-322 transport, bound to the same selected provider. */
  messageTransport?: MessageTransport;
  reader: KeelOutputReader;
  subscribe?: readonly Subscribe[];
  focusTarget?: FocusTarget;
  onInvalidate?(): void;
}

const networks: Record<WalletId, readonly BtcNet[]> = {
  xverse: ["mainnet", "signet", "regtest"],
  unisat: ["mainnet", "testnet3"],
  okx: ["mainnet", "testnet3", "signet"],
  leather: ["mainnet", "testnet3", "signet"],
  "magic-eden": ["mainnet"],
};

function snapshotRequest(input: SignRequest): SignRequest {
  if (!input || typeof input.psbtBase64 !== "string" || !Array.isArray(input.inputs)) throw new Error("Invalid signing request");
  const inputs = input.inputs.map(item => {
    if (!item || (item.path !== "key" && (!item.path || typeof item.path.leafHash !== "string"))) throw new Error("Invalid signing path");
    const path = item.path === "key" ? "key" : Object.freeze({ leafHash: item.path.leafHash });
    return Object.freeze({ index: item.index, account: item.account, sighash: item.sighash, path });
  });
  return Object.freeze({ psbtBase64: input.psbtBase64, inputs: Object.freeze(inputs) as unknown as SignRequest["inputs"] });
}

/** All callbacks and transports must refer to the same explicitly selected provider.
 * Their common origin is the host's responsibility, not independently attested here. */
export function createBitcoinWalletAdapter(host: BitcoinWalletHost) {
  if (!host || !Object.hasOwn(networks, host.id)) throw new Error("Unknown wallet");
  let network: BtcNet | undefined;
  let disposed = false;
  let generation = 0;
  let guard: WalletSessionGuard | undefined;
  let connectingGuard = false;
  const cleanups = new Set<() => void>();
  const pending = new Map<string, { request: SignRequest; receipts: ClassificationReceipt[] }>();
  const detach = () => { for (const cleanup of [...cleanups]) cleanup(); };
  const track = (off: () => void) => {
    let active = true;
    const cleanup = () => { if (active) { active = false; cleanups.delete(cleanup); off(); } };
    cleanups.add(cleanup);
    return cleanup;
  };
  const clear = () => {
    generation++;
    pending.clear();
    const keepListeners = connectingGuard;
    connectingGuard = false;
    if (!keepListeners) detach();
    host.onInvalidate?.();
  };
  function available() { if (disposed) throw new Error("Wallet disposed"); }
  function current(own: WalletSessionGuard, version: number) {
    available();
    if (guard !== own || generation !== version) throw new Error("Wallet session changed");
  }
  function checked(session: BtcSession, net: BtcNet): BtcSession {
    if (!session || session.walletId !== host.id || session.network !== net ||
        session.ordinals?.purpose !== "ordinals" || session.payment?.purpose !== "payment") throw new Error("Wallet identity mismatch");
    const validated = createSession(host.id, net, [validateAccount(session.ordinals, net), validateAccount(session.payment, net)]);
    if (validated.sharedAddress !== session.sharedAddress) throw new Error("Shared account mismatch");
    const sharedWallet = host.id === "unisat" || host.id === "okx";
    if (validated.sharedAddress !== sharedWallet || (!sharedWallet &&
        !(host.id === "xverse" ? ["p2wpkh", "p2sh-p2wpkh"] : ["p2wpkh"]).includes(validated.payment.addressType))) {
      throw new Error("Unsupported wallet account roles");
    }
    return validated;
  }
  function newGuard(): WalletSessionGuard {
    const subscribe = host.subscribe?.map(sub => (invalidate: () => void) => track(sub(invalidate)));
    let focusCleanup: (() => void) | undefined;
    const focusTarget: FocusTarget | undefined = host.focusTarget ? {
      addEventListener(type, listener) {
        host.focusTarget!.addEventListener(type, listener);
        focusCleanup = track(() => host.focusTarget!.removeEventListener(type, listener));
      },
      removeEventListener() { focusCleanup?.(); },
    } : undefined;
    return new WalletSessionGuard({
      getLiveSession: async () => {
        const net = network;
        if (!net) throw new Error("Wallet session unavailable");
        assertWalletNetwork(net, await host.getNetwork());
        const live = checked(await host.readLiveSession(net), net);
        assertWalletNetwork(net, await host.getNetwork());
        return live;
      },
      ...(subscribe ? { subscribe } : {}),
      ...(focusTarget ? { focusTarget } : {}),
      clear,
    });
  }
  function activeGuard(): WalletSessionGuard {
    available();
    if (!guard) throw new Error("Wallet session unavailable");
    return guard;
  }
  function paymentInputs(session: BtcSession, request: SignRequest): PaymentUtxo[] {
    const psbt = Psbt.fromBase64(request.psbtBase64, { network: bitcoinNetwork(session.network) });
    const paymentScript = Buffer.from(address.toOutputScript(session.payment.address, bitcoinNetwork(session.network)));
    return psbt.txInputs.flatMap((input, index) => {
      const data = psbt.data.inputs[index]!;
      const prevout = data.witnessUtxo;
      if (!prevout) throw new Error("Missing input prevout");
      const txid = Buffer.from(input.hash).reverse().toString("hex");
      if (data.nonWitnessUtxo) {
        const previous = Transaction.fromBuffer(data.nonWitnessUtxo);
        const output = previous.outs[input.index];
        if (previous.getId() !== txid || !output || output.value !== prevout.value || !Buffer.from(output.script).equals(Buffer.from(prevout.script))) throw new Error("Previous transaction output mismatch");
      }
      if (!Buffer.from(prevout.script).equals(paymentScript)) return [];
      const value = Number(prevout.value);
      if (!Number.isSafeInteger(value)) throw new Error("Invalid input value");
      return [{ txid, vout: input.index, value, script: Buffer.from(prevout.script).toString("hex"), address: session.payment.address, network: session.network }];
    });
  }
  return {
    id: host.id,
    async connect(net: BtcNet) {
      available();
      bitcoinNetwork(net);
      if (!networks[host.id].includes(net)) throw new Error("Unsupported wallet network");
      if (guard) guard.dispose(); else clear();
      network = net;
      const own = newGuard();
      guard = own;
      let version = generation;
      try {
        const requested = checked(await host.connect(net), net);
        current(own, version);
        assertWalletNetwork(net, await host.getNetwork());
        current(own, version);
        connectingGuard = true;
        let connecting: Promise<BtcSession>;
        try { connecting = own.connect(sessionIdentity(requested)); } finally { connectingGuard = false; }
        version = generation;
        const session = await connecting;
        current(own, version);
        return session;
      } catch (error) {
        if (guard === own && generation === version) { own.dispose(); guard = undefined; network = undefined; }
        throw error;
      }
    },
    async signPsbt(input: SignRequest) {
      const own = activeGuard();
      const request = snapshotRequest(input);
      const result = await own.sign(async session => {
        const version = generation;
        const classified = await classifyPaymentUtxos(session, paymentInputs(session, request), host.reader);
        current(own, version);
        if (classified.excluded.length) throw new Error("Unsafe payment input");
        const receipts = await recheckPaymentInputs(session, classified.spendable, host.reader);
        current(own, version);
        await own.reconcile();
        current(own, version);
        const signed = await signWithProvider(host.id, host.signingProvider, session, request);
        current(own, version);
        if (validateSignedPsbt(session, request, signed) !== signed) throw new Error("Noncanonical signed PSBT");
        return { signed, receipts: Object.freeze([...receipts]) as unknown as ClassificationReceipt[], version };
      });
      current(own, result.version);
      if (pending.size >= 32 && !pending.has(result.signed)) pending.delete(pending.keys().next().value!);
      pending.set(result.signed, { request, receipts: result.receipts });
      return result.signed;
    },
    async signMessageBip322(input: BtcAccount, message: string) {
      const own = activeGuard();
      if (!input || typeof message !== "string") throw new Error("Invalid message request");
      const account: BtcAccount = { ...input, ...(input.bip32 ? { bip32: { ...input.bip32 } } : {}) };
      return own.sign(async session => {
        const version = generation;
        if ((account.purpose !== "ordinals" && account.purpose !== "payment") || !host.messageTransport || host.messageTransport.wallet !== host.id) throw new Error("Unsupported message capability or account");
        const validated = validateAccount(account, session.network);
        const selected = session[account.purpose];
        if (validated.address !== selected.address || validated.addressType !== selected.addressType || validated.publicKey.toLowerCase() !== selected.publicKey.toLowerCase()) throw new Error("Wallet account mismatch");
        const walletNetwork = await host.getNetwork();
        current(own, version);
        return signBip322Message({ transport: host.messageTransport, network: session.network, walletNetwork, address: validated.address, message });
      });
    },
    async recheckBeforeBroadcast(signedBase64: string) {
      const own = activeGuard();
      const entry = pending.get(signedBase64);
      if (!entry) throw new Error("Unknown signed PSBT");
      return own.sign(async session => {
        const version = generation;
        if (pending.get(signedBase64) !== entry) throw new Error("Unknown signed PSBT");
        if (validateSignedPsbt(session, entry.request, signedBase64) !== signedBase64) throw new Error("Noncanonical signed PSBT");
        await recheckPaymentInputs(session, entry.receipts, host.reader);
        current(own, version);
      });
    },
    disconnect() { available(); if (guard) guard.dispose(); else clear(); guard = undefined; network = undefined; },
    dispose() { if (!disposed) { disposed = true; if (guard) guard.dispose(); else clear(); guard = undefined; network = undefined; } },
  };
}
