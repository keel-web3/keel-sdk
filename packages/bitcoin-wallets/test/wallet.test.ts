import { describe, expect, it, vi } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { Signer } from "bip322-js";
import { createSession, sharedAddressSession } from "../src/accounts.js";
import { validateAccount } from "../src/keys.js";
import { createBitcoinWalletAdapter, type BitcoinWalletHost } from "../src/wallet.js";
import { Bip322LoginManager } from "../src/login.js";
import { connectXverse, reconcileXverse, type XverseConnection } from "../src/xverse.js";
import { WalletProviderError, unwrapWalletResponse } from "../src/providers.js";
import type { LegacySignOptions, SigningProvider, WalletId } from "../src/signing.js";
import type { BtcAccount, BtcNet, BtcSession, SignRequest } from "../src/types.js";
import type { PaymentUtxo } from "../src/utxos.js";

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const ordinalKey = ECPair.fromPrivateKey(Buffer.alloc(32, 1));
const paymentKey = ECPair.fromPrivateKey(Buffer.alloc(32, 2));
const otherKey = ECPair.fromPrivateKey(Buffer.alloc(32, 3));
const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");
const tap = bitcoin.payments.p2tr({ internalPubkey: ordinalKey.publicKey.slice(1) });
const payment = bitcoin.payments.p2wpkh({ pubkey: paymentKey.publicKey });
const other = bitcoin.payments.p2tr({ internalPubkey: otherKey.publicKey.slice(1) });
const ordAccount: BtcAccount = { address: tap.address!, addressType: "p2tr", purpose: "ordinals", publicKey: hex(ordinalKey.publicKey) };
const paymentAccount: BtcAccount = { address: payment.address!, addressType: "p2wpkh", purpose: "payment", publicKey: hex(paymentKey.publicKey) };
const wallets: WalletId[] = ["xverse", "unisat", "okx", "leather", "magic-eden"];
const context = { domain: "example.com", uri: "https://example.com/login", network: "mainnet" as const };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function fixture(id: WalletId) {
  const shared = id === "unisat" || id === "okx";
  const session = shared
    ? sharedAddressSession(id, "mainnet", { address: ordAccount.address, addressType: "p2tr", publicKey: ordAccount.publicKey })
    : createSession(id, "mainnet", [ordAccount, paymentAccount]);
  const sighash = id === "magic-eden" ? 0 : 1;
  const psbt = new bitcoin.Psbt();
  psbt.addInput({ hash: "11".repeat(32), index: 1, witnessUtxo: { script: tap.output!, value: 10000n }, tapInternalKey: ordinalKey.publicKey.slice(1), ...(sighash ? { sighashType: sighash } : {}) });
  if (sighash === 0) psbt.data.inputs[0]!.sighashType = 0;
  psbt.addInput(shared
    ? { hash: "22".repeat(32), index: 2, witnessUtxo: { script: tap.output!, value: 20000n }, tapInternalKey: ordinalKey.publicKey.slice(1), sighashType: 1 }
    : { hash: "22".repeat(32), index: 2, witnessUtxo: { script: payment.output!, value: 20000n }, sighashType: 1 });
  psbt.addOutput({ address: payment.address!, value: 29000n });
  const request: SignRequest = { psbtBase64: psbt.toBase64(), inputs: [
    { index: 0, account: "ordinals", sighash, path: "key" },
    { index: 1, account: "payment", sighash: 1, path: "key" },
  ] };
  let live: BtcSession = session;
  let network: unknown = "mainnet";
  let unsafe = false;
  let changed = false;
  let wrongSignature = false;
  let height = 100;
  let beforeSign: (() => Promise<void>) | undefined;
  let beforeRead: (() => Promise<void>) | undefined;
  let invalidate: (() => void) | undefined;
  const unsubscribe = vi.fn(() => { invalidate = undefined; });
  const onInvalidate = vi.fn();
  const readOutput = vi.fn(async (output: PaymentUtxo) => {
    if (beforeRead) await beforeRead();
    return { ...output, confirmed: true, spent: false, indexed: true, indexHeight: height, chainHeight: height,
      inscriptions: unsafe ? ["inscription"] : [], runes: [], satRarities: ["common"] };
  });
  const sign = vi.fn(async (base64: string, indexes: number[]) => {
    if (beforeSign) await beforeSign();
    const tx = bitcoin.Psbt.fromBase64(base64);
    if (changed) tx.setInputSequence(0, 1);
    const tweaked = ordinalKey.tweak(bitcoin.crypto.taggedHash("TapTweak", ordinalKey.publicKey.slice(1)));
    for (const index of indexes) {
      const isTap = index === 0 || shared;
      const signer = isTap ? tweaked : paymentKey;
      tx.signInput(index, signer, [index === 0 ? sighash : 1]);
    }
    if (wrongSignature) tx.data.inputs[0]!.tapKeySig![10] ^= 1;
    return tx.toBase64();
  });
  const signingProvider: SigningProvider = id === "xverse" ? {
    request: async (_method, params) => ({ status: "success", result: { psbt: await sign(params.psbt, Object.values(params.signInputs).flat()) } }),
  } : id === "leather" ? {
    request: async (_method, params) => ({ result: { hex: Buffer.from(await sign(Buffer.from(params.hex, "hex").toString("base64"), params.signAtIndex), "base64").toString("hex") } }),
  } : id === "magic-eden" ? {
    signTransaction: async (options: LegacySignOptions) => { options.onFinish({ psbtBase64: await sign(options.payload.psbtBase64, options.payload.inputsToSign.flatMap(group => group.signingIndexes)) }); },
  } : {
    signPsbt: async (psbtHex, options) => Buffer.from(await sign(Buffer.from(psbtHex, "hex").toString("base64"), options.toSignInputs.map(input => input.index)), "base64").toString("hex"),
  };
  const xverseMessage = vi.fn(async (_method: "signMessage", params: { address: string; message: string; protocol: "BIP322" }) => ({ status: "success", result: {
    address: params.address,
    signature: Signer.sign((params.address === session.ordinals.address ? ordinalKey : paymentKey).toWIF(), params.address, params.message),
  } }));
  const injectedMessage = vi.fn(async (message: string) => Signer.sign(ordinalKey.toWIF(), session.ordinals.address, message));
  const host: BitcoinWalletHost = {
    id,
    connect: vi.fn(async () => session),
    readLiveSession: vi.fn(async () => live),
    getNetwork: vi.fn(async () => network),
    signingProvider,
    ...(id === "xverse" ? { messageTransport: { wallet: "xverse" as const, request: xverseMessage } } : {}),
    ...(id === "unisat" || id === "okx" ? { messageTransport: { wallet: id, signMessage: injectedMessage } } : {}),
    reader: { readOutput },
    subscribe: [callback => { invalidate = callback; return unsubscribe; }],
    onInvalidate,
  };
  const adapter = createBitcoinWalletAdapter(host);
  return { adapter, host, request, session, readOutput, sign, onInvalidate, unsubscribe, xverseMessage, injectedMessage,
    setLive(value: BtcSession) { live = value; }, setNetwork(value: unknown) { network = value; },
    setUnsafe(value: boolean) { unsafe = value; }, setChanged(value: boolean) { changed = value; },
    setWrongSignature(value: boolean) { wrongSignature = value; }, setHeight(value: number) { height = value; },
    setBeforeSign(value: (() => Promise<void>) | undefined) { beforeSign = value; },
    setBeforeRead(value: (() => Promise<void>) | undefined) { beforeRead = value; },
    invalidate() { invalidate?.(); },
  };
}

function xverseProviderFixture() {
  const f = fixture("xverse");
  let permission = false;
  let rejectConnection = false;
  let reportedNetwork = "Mainnet";
  const wallet = { request: vi.fn(async (method: string, params: unknown) => {
    if (method === "wallet_connect") {
      if (rejectConnection) return { status: "error", error: { code: 4001, message: "Connection rejected" } };
      permission = true;
      return { status: "success", result: { addresses: [ordAccount, paymentAccount], walletType: "software" } };
    }
    if (!permission) throw new Error("Account read permission required");
    if (method === "wallet_getNetwork") return { status: "success", result: { bitcoin: { name: reportedNetwork } } };
    if (method === "wallet_getAccount") return { status: "success", result: { addresses: [ordAccount, paymentAccount], walletType: "software" } };
    if (method === "signPsbt") {
      const payload = params as { psbt: string; signInputs: Record<string, number[]> };
      return { status: "success", result: { psbt: await f.sign(payload.psbt, Object.values(payload.signInputs).flat()) } };
    }
    throw new Error(`Unexpected wallet method ${method}`);
  }) };
  const toSession = (connection: XverseConnection) => createSession("xverse", connection.network,
    connection.accounts.map(account => validateAccount({
      ...account,
      addressType: account.addressType === "p2sh" ? "p2sh-p2wpkh" : account.addressType,
    }, connection.network)));
  f.host.connect = vi.fn(async net => toSession(await connectXverse(wallet, net)));
  f.host.readLiveSession = vi.fn(async net => toSession(await reconcileXverse(wallet, net)));
  f.host.getNetwork = vi.fn(async () => {
    const result = unwrapWalletResponse(await wallet.request("wallet_getNetwork", null)) as { bitcoin?: { name?: string } };
    return result.bitcoin?.name === "Mainnet" ? "mainnet" : result.bitcoin?.name === "Signet" ? "signet" : "unknown";
  });
  f.host.signingProvider = wallet;
  return { ...f, wallet, rejectConnection() { rejectConnection = true; }, setReportedNetwork(value: string) { reportedNetwork = value; } };
}

function guardedVaultFixture(id: "unisat" | "okx", evidence: "404" | "inscription" | "rune" | "safe", mixed = false) {
  const f = fixture(id);
  const leaf = bitcoin.script.compile([
    ordinalKey.publicKey.slice(1), bitcoin.opcodes.OP_CHECKSIGVERIFY,
    paymentKey.publicKey.slice(1), bitcoin.opcodes.OP_CHECKSIG,
  ]);
  const vault = bitcoin.payments.p2tr({
    internalPubkey: Buffer.from("50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0", "hex"),
    scriptTree: { output: leaf }, redeem: { output: leaf, redeemVersion: 0xc0 },
  });
  const psbt = new bitcoin.Psbt();
  if (mixed) psbt.addInput({ hash: "44".repeat(32), index: 0, witnessUtxo: { script: tap.output!, value: 10000n }, tapInternalKey: ordinalKey.publicKey.slice(1), sighashType: 1 });
  const vaultIndex = mixed ? 1 : 0;
  psbt.addInput({ hash: "33".repeat(32), index: 0, witnessUtxo: { script: vault.output!, value: 10000n },
    tapLeafScript: [{ script: leaf, leafVersion: 0xc0, controlBlock: vault.witness!.at(-1)! }] });
  psbt.data.inputs[vaultIndex]!.sighashType = 0;
  psbt.addOutput({ address: payment.address!, value: mixed ? 19000n : 9000n });
  psbt.signTaprootInput(vaultIndex, paymentKey);
  const leafHash = hex(psbt.data.inputs[vaultIndex]!.tapScriptSig![0]!.leafHash);
  const request: SignRequest = { psbtBase64: psbt.toBase64(), inputs: [
    ...(mixed ? [{ index: 0, account: "payment" as const, sighash: 1, path: "key" as const }] : []),
    { index: vaultIndex, account: "payment", sighash: 0, path: { leafHash } },
  ] };
  const sign = (tx: bitcoin.Psbt) => {
    if (mixed) tx.signInput(0, ordinalKey.tweak(bitcoin.crypto.taggedHash("TapTweak", ordinalKey.publicKey.slice(1))), [1]);
    tx.signTaprootInput(vaultIndex, ordinalKey);
    return tx;
  };
  const external = sign(psbt.clone());
  const provider = vi.fn(async (psbtHex: string) => sign(bitcoin.Psbt.fromHex(psbtHex)).toHex());
  const reader = vi.fn(async (output: PaymentUtxo) => {
    if (evidence === "404") throw new Error("Reader HTTP 404");
    return { ...output, confirmed: true, spent: false, indexed: true, indexHeight: 100, chainHeight: 100,
      inscriptions: evidence === "inscription" ? ["fixture-inscription"] : [],
      runes: evidence === "rune" ? ["fixture-rune"] : [], satRarities: ["common"] };
  });
  f.host.reader = { readOutput: reader };
  f.host.signingProvider = { signPsbt: provider };
  return { ...f, request, external, vaultIndex, reader, provider };
}

describe("payment vault classification", () => {
  it.each([
    ["unisat", "404"], ["unisat", "inscription"], ["unisat", "rune"],
    ["okx", "404"], ["okx", "inscription"], ["okx", "rune"],
  ] as const)(
    "%s refuses an unclassifiable payment vault with %s evidence before signing", async (id, evidence) => {
      const f = guardedVaultFixture(id, evidence);
      const verify = (pubkey: Uint8Array, hash: Uint8Array, signature: Uint8Array) => ecc.verifySchnorr(hash, pubkey, signature);
      expect(f.external.data.inputs[f.vaultIndex]!.tapScriptSig).toHaveLength(2);
      expect(f.external.validateSignaturesOfInput(f.vaultIndex, verify)).toBe(true);
      await f.adapter.connect("mainnet");
      await expect(f.adapter.signPsbt(f.request)).rejects.toThrow("Payment input cannot be classified for the wallet address");
      expect(f.provider).not.toHaveBeenCalled(); expect(f.reader).not.toHaveBeenCalled();
      await expect(f.adapter.recheckBeforeBroadcast(f.external.toBase64())).rejects.toThrow("Unknown signed PSBT");
      expect(f.provider).not.toHaveBeenCalled(); f.adapter.dispose();
    },
  );
  it.each(["unisat", "okx"] as const)("%s refuses a payment vault even alongside an ordinary payment input", async id => {
    const f = guardedVaultFixture(id, "safe", true); await f.adapter.connect("mainnet");
    await expect(f.adapter.signPsbt(f.request)).rejects.toThrow("Payment input cannot be classified for the wallet address");
    expect(f.provider).not.toHaveBeenCalled(); expect(f.reader).not.toHaveBeenCalled();
    await expect(f.adapter.recheckBeforeBroadcast(f.external.toBase64())).rejects.toThrow("Unknown signed PSBT");
    f.adapter.dispose();
  });
  it.each(["unisat", "okx"] as const)("%s still signs a reviewed ordinals-role vault leaf", async id => {
    const f = guardedVaultFixture(id, "404"); await f.adapter.connect("mainnet");
    const request: SignRequest = { ...f.request, inputs: [{ ...f.request.inputs[0]!, account: "ordinals" }] };
    const signed = await f.adapter.signPsbt(request);
    expect(bitcoin.Psbt.fromBase64(signed).data.inputs[0]!.tapScriptSig).toHaveLength(2);
    await f.adapter.recheckBeforeBroadcast(signed);
    expect(f.provider).toHaveBeenCalledOnce(); expect(f.reader).not.toHaveBeenCalled(); f.adapter.dispose();
  });
  it.each(["unisat", "okx"] as const)("%s still signs and rechecks ordinary classified payment inputs", async id => {
    const f = fixture(id); await f.adapter.connect("mainnet");
    const signed = await f.adapter.signPsbt(f.request);
    await f.adapter.recheckBeforeBroadcast(signed);
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.readOutput).toHaveBeenCalled(); f.adapter.dispose();
  });
});

describe("guarded wallet integration", () => {
  it("connects and verifies a UniSat testnet4 BIP-322 message", async () => {
    const f = fixture("unisat");
    const address = bitcoin.payments.p2tr({ internalPubkey: ordinalKey.publicKey.slice(1), network: bitcoin.networks.testnet }).address!;
    const session = sharedAddressSession("unisat", "testnet4", { address, addressType: "p2tr", publicKey: ordAccount.publicKey });
    f.host.connect = async () => session; f.host.readLiveSession = async () => session; f.host.getNetwork = async () => "testnet4";
    const signMessage = vi.fn(async (message: string) => Signer.sign(ordinalKey.toWIF(), address, message));
    f.host.messageTransport = { wallet: "unisat", signMessage };
    await f.adapter.connect("testnet4"); await f.adapter.signMessageBip322(session.ordinals, "login");
    expect(signMessage).toHaveBeenCalledOnce(); f.adapter.dispose();
  });
  it("subscribes only after permission and signs with the reconciled identity", async () => {
    const f = fixture("unisat"); let permission = false; const off = vi.fn();
    f.host.connect = vi.fn(async () => { permission = true; return f.session; });
    f.host.subscribe = [() => { if (!permission) throw new Error("permission required"); return off; }];
    // The adapter captures the host and reads subscriptions on connection.
    await f.adapter.connect("mainnet");
    await f.adapter.signMessageBip322(f.session.ordinals, "login");
    expect(f.injectedMessage).toHaveBeenCalledOnce(); f.adapter.dispose(); expect(off).toHaveBeenCalledOnce();
  });
  it.each(["identity", "network", "unknown"] as const)("refuses changed %s after permission before authority", async change => {
    const f = fixture("unisat");
    f.host.connect = vi.fn(async () => {
      if (change === "identity") f.setLive({ ...f.session, ordinals: { ...f.session.ordinals, address: other.address!, publicKey: hex(otherKey.publicKey) } });
      else f.setNetwork(change === "network" ? "testnet3" : "mystery");
      return f.session;
    });
    await expect(f.adapter.connect("mainnet")).rejects.toThrow();
    await expect(f.adapter.signMessageBip322(f.session.ordinals, "login")).rejects.toThrow();
    expect(f.injectedMessage).not.toHaveBeenCalled(); f.adapter.dispose();
  });
  it.each(["dispose", "concurrent"] as const)("refuses stale permission after %s", async action => {
    const f = fixture("unisat"); const wait = deferred<BtcSession>(); let calls = 0;
    f.host.connect = vi.fn(async () => ++calls === 1 ? wait.promise : f.session);
    const first = f.adapter.connect("mainnet");
    if (action === "dispose") f.adapter.dispose(); else await f.adapter.connect("mainnet");
    wait.resolve(f.session); await expect(first).rejects.toThrow();
    if (action === "dispose") await expect(f.adapter.signMessageBip322(f.session.ordinals, "login")).rejects.toThrow();
    expect(f.injectedMessage).not.toHaveBeenCalled(); f.adapter.dispose();
  });

  it("connects before the permission-gated network read and completes guarded signing", async () => {
    const f = fixture("xverse"); let permission = false; const calls: string[] = [];
    f.host.connect = vi.fn(async () => { calls.push("connect"); permission = true; return f.session; });
    f.host.getNetwork = vi.fn(async () => {
      calls.push("getNetwork");
      if (!permission) throw new Error("Account read permission required");
      return "mainnet";
    });
    await f.adapter.connect("mainnet");
    expect(calls.slice(0, 2)).toEqual(["connect", "getNetwork"]);
    const signed = await f.adapter.signPsbt(f.request);
    await f.adapter.recheckBeforeBroadcast(signed);
    expect(f.sign).toHaveBeenCalledOnce(); f.adapter.dispose();
  });
  it("connects a first-time Xverse provider through the real connection and reconciliation helpers", async () => {
    const f = xverseProviderFixture();
    await expect(f.wallet.request("wallet_getNetwork", null)).rejects.toThrow("Account read permission required");
    await expect(f.wallet.request("wallet_getAccount", { addresses: ["ordinals", "payment"] })).rejects.toThrow("Account read permission required");
    f.wallet.request.mockClear();
    await f.adapter.connect("mainnet");
    expect(f.wallet.request.mock.calls[0]).toEqual(["wallet_connect", { addresses: ["ordinals", "payment"], network: "Mainnet", message: "Connect your Ordinals and payment addresses to KEEL." }]);
    expect(f.wallet.request.mock.calls).toContainEqual(["wallet_getAccount", { addresses: ["ordinals", "payment"] }]);
    expect(f.wallet.request.mock.calls.map(call => call[0])).toContain("wallet_getNetwork");
    const signed = await f.adapter.signPsbt(f.request);
    await f.adapter.recheckBeforeBroadcast(signed);
    expect(f.wallet.request.mock.calls).toContainEqual(["signPsbt", {
      psbt: f.request.psbtBase64, broadcast: false,
      signInputs: { [f.session.ordinals.address]: [0], [f.session.payment.address]: [1] },
    }]);
    expect(f.sign).toHaveBeenCalledOnce(); f.adapter.dispose();
  });
  it("preserves a rejected Xverse connection without reading the network or signing", async () => {
    const f = xverseProviderFixture(); f.rejectConnection();
    await expect(f.adapter.connect("mainnet")).rejects.toMatchObject({ code: 4001, rejected: true });
    expect(f.wallet.request.mock.calls.map(call => call[0])).toEqual(["wallet_connect"]);
    expect(f.sign).not.toHaveBeenCalled(); f.adapter.dispose();
  });
  it.each(["unknown", "signet"])("rejects a post-permission %s network without signing", async network => {
    const f = fixture("xverse"); f.setNetwork(network);
    await expect(f.adapter.connect("mainnet")).rejects.toThrow("Wallet network mismatch or unknown");
    expect(f.host.connect).toHaveBeenCalledOnce();
    expect(f.host.getNetwork).toHaveBeenCalledOnce();
    expect(f.host.readLiveSession).not.toHaveBeenCalled();
    await expect(f.adapter.signPsbt(f.request)).rejects.toThrow();
    expect(f.sign).not.toHaveBeenCalled(); f.adapter.dispose();
  });
  it("propagates a provider network-read error after connection without signing", async () => {
    const f = fixture("xverse");
    f.host.getNetwork = vi.fn(async () => { throw new Error("Account read permission required"); });
    await expect(f.adapter.connect("mainnet")).rejects.toThrow("Account read permission required");
    expect(f.host.connect).toHaveBeenCalledOnce();
    expect(f.host.getNetwork).toHaveBeenCalledOnce(); expect(f.sign).not.toHaveBeenCalled();
    f.adapter.dispose();
  });
  it.each(["Unknown", "Signet"])("rejects Xverse's post-permission %s network without signing", async network => {
    const f = xverseProviderFixture(); f.setReportedNetwork(network);
    await expect(f.adapter.connect("mainnet")).rejects.toThrow("Xverse network mismatch or unknown");
    expect(f.wallet.request.mock.calls.map(call => call[0])).toEqual(["wallet_connect", "wallet_getNetwork"]);
    expect(f.sign).not.toHaveBeenCalled(); f.adapter.dispose();
  });
  it("reaches a rejected connection before a permission-gated network read", async () => {
    const f = fixture("xverse");
    f.host.connect = vi.fn(async () => { throw new Error("Intentional connect error"); });
    f.host.getNetwork = vi.fn(async () => { throw new Error("Account read permission required"); });
    await expect(f.adapter.connect("mainnet")).rejects.toThrow("Intentional connect error");
    expect(f.host.connect).toHaveBeenCalledOnce();
    expect(f.host.getNetwork).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); f.adapter.dispose();
  });
  it.each(wallets)("%s signs actual key-path signatures, classifies prevouts and rechecks the exact result", async id => {
    const f = fixture(id);
    await f.adapter.connect("mainnet");
    const signed = await f.adapter.signPsbt(f.request);
    const parsed = bitcoin.Psbt.fromBase64(signed);
    expect(parsed.data.inputs[0]!.tapKeySig).toBeDefined();
    expect(id === "unisat" || id === "okx" ? parsed.data.inputs[1]!.tapKeySig : parsed.data.inputs[1]!.partialSig).toBeDefined();
    expect(f.sign).toHaveBeenCalledOnce();
    const outputs = f.readOutput.mock.calls.map(call => call[0]);
    expect(outputs).toContainEqual({ txid: "22".repeat(32), vout: 2, value: 20000, script: hex((id === "unisat" || id === "okx" ? tap : payment).output!), address: f.session.payment.address, network: "mainnet" });
    expect(outputs.some(output => output.txid === "11".repeat(32))).toBe(id === "unisat" || id === "okx");
    await f.adapter.recheckBeforeBroadcast(signed);
    await expect(f.adapter.recheckBeforeBroadcast(signed + "AA==")).rejects.toThrow("Unknown signed PSBT");
    f.adapter.dispose();
  });
  it("uses real separate-role Xverse BIP-322 proofs for a server nonce", async () => {
    const f = fixture("xverse"); await f.adapter.connect("mainnet");
    const login = new Bip322LoginManager(context);
    const challenge = login.issue({ ordinals: f.session.ordinals.address, payment: f.session.payment.address });
    const ordinals = await f.adapter.signMessageBip322(f.session.ordinals, challenge.message);
    const paymentProof = await f.adapter.signMessageBip322(f.session.payment, challenge.message);
    expect(login.verify(challenge, { ordinals, payment: paymentProof })).toEqual({ ordinals: f.session.ordinals.address, payment: f.session.payment.address });
    expect(f.xverseMessage).toHaveBeenCalledTimes(2); f.adapter.dispose();
  });
  it.each(["unisat", "okx"] as const)("%s signs a real shared-role BIP-322 login", async id => {
    const f = fixture(id); await f.adapter.connect("mainnet");
    const login = new Bip322LoginManager(context);
    const challenge = login.issue({ ordinals: f.session.ordinals.address, payment: f.session.payment.address });
    const ordinals = await f.adapter.signMessageBip322(f.session.ordinals, challenge.message);
    expect(login.verify(challenge, { ordinals })).toEqual({ ordinals: f.session.ordinals.address, payment: f.session.payment.address });
    f.adapter.dispose();
  });
  it.each(["leather", "magic-eden"] as const)("%s refuses unsupported BIP-322 before provider calls", async id => {
    const f = fixture(id); await f.adapter.connect("mainnet");
    await expect(f.adapter.signMessageBip322(f.session.ordinals, "login")).rejects.toThrow("Unsupported message capability");
    expect(f.sign).not.toHaveBeenCalled(); f.adapter.dispose();
  });
  it("rejects altered unsigned bytes and forged signatures returned by a provider", async () => {
    const f = fixture("xverse"); await f.adapter.connect("mainnet");
    f.setChanged(true); await expect(f.adapter.signPsbt(f.request)).rejects.toThrow("Wallet changed transaction");
    f.setChanged(false); f.setWrongSignature(true); await expect(f.adapter.signPsbt(f.request)).rejects.toThrow("Invalid Taproot signature");
    f.adapter.dispose();
  });
  it("classifies an unrequested payment prevout and blocks an unsafe shared address", async () => {
    const f = fixture("unisat"); await f.adapter.connect("mainnet");
    f.setUnsafe(true);
    await expect(f.adapter.signPsbt({ ...f.request, inputs: [f.request.inputs[0]!] })).rejects.toThrow("Unsafe payment input");
    expect(f.readOutput.mock.calls.map(call => call[0].txid)).toEqual(["11".repeat(32), "22".repeat(32)]);
    expect(f.sign).not.toHaveBeenCalled(); f.adapter.dispose();
  });
  it("reclassifies before broadcast and refuses changed or unknown signed bytes", async () => {
    const f = fixture("xverse"); await f.adapter.connect("mainnet");
    const signed = await f.adapter.signPsbt(f.request);
    const changed = bitcoin.Psbt.fromBase64(signed); changed.data.inputs[0]!.tapKeySig![0] ^= 1;
    await expect(f.adapter.recheckBeforeBroadcast(changed.toBase64())).rejects.toThrow("Unknown signed PSBT");
    f.setUnsafe(true); await expect(f.adapter.recheckBeforeBroadcast(signed)).rejects.toThrow();
    f.setUnsafe(false); f.setHeight(101); await expect(f.adapter.recheckBeforeBroadcast(signed)).rejects.toThrow();
    f.adapter.dispose();
  });
  it("refuses an output that becomes unsafe immediately before signing", async () => {
    const f = fixture("xverse"); await f.adapter.connect("mainnet");
    const read = f.host.reader.readOutput; let calls = 0;
    f.host.reader.readOutput = async output => { if (++calls === 2) f.setUnsafe(true); return read(output); };
    await expect(f.adapter.signPsbt(f.request)).rejects.toThrow();
    expect(f.sign).not.toHaveBeenCalled(); f.adapter.dispose();
  });
  it("bounds pending reviewed signatures to 32 and evicts the oldest", async () => {
    const f = fixture("xverse"); await f.adapter.connect("mainnet");
    const signed: string[] = [];
    for (let sequence = 0; sequence < 33; sequence++) {
      const psbt = bitcoin.Psbt.fromBase64(f.request.psbtBase64);
      psbt.setInputSequence(0, sequence);
      signed.push(await f.adapter.signPsbt({ ...f.request, psbtBase64: psbt.toBase64() }));
    }
    await expect(f.adapter.recheckBeforeBroadcast(signed[0]!)).rejects.toThrow("Unknown signed PSBT");
    await expect(f.adapter.recheckBeforeBroadcast(signed[32]!)).resolves.toBeUndefined();
    f.adapter.dispose();
  });
  it.each(["account", "network"] as const)("refuses a silent %s switch before calling the provider", async change => {
    const f = fixture("xverse"); await f.adapter.connect("mainnet");
    if (change === "network") f.setNetwork("testnet3");
    else f.setLive({ ...f.session, ordinals: { ...f.session.ordinals, address: other.address!, publicKey: hex(otherKey.publicKey) } });
    await expect(f.adapter.signPsbt(f.request)).rejects.toThrow();
    expect(f.sign).not.toHaveBeenCalled(); expect(f.unsubscribe).toHaveBeenCalledOnce();
    f.adapter.dispose();
  });
  it("refuses a silent network switch while the wallet is signing", async () => {
    const f = fixture("xverse"); await f.adapter.connect("mainnet");
    const started = deferred<void>(); const finish = deferred<void>();
    f.setBeforeSign(async () => { started.resolve(); await finish.promise; });
    const signing = f.adapter.signPsbt(f.request); await started.promise;
    f.setNetwork("signet"); finish.resolve();
    await expect(signing).rejects.toThrow("Wallet network mismatch or unknown");
    expect(f.unsubscribe).toHaveBeenCalledOnce(); f.adapter.dispose();
  });
  it("rejects unsupported sighash and script paths before invoking the provider", async () => {
    const f = fixture("xverse"); await f.adapter.connect("mainnet");
    const changed = bitcoin.Psbt.fromBase64(f.request.psbtBase64);
    changed.data.inputs[0]!.sighashType = 2;
    await expect(f.adapter.signPsbt({ psbtBase64: changed.toBase64(), inputs: [{ ...f.request.inputs[0]!, sighash: 2 }] })).rejects.toThrow("Unsupported wallet sighash");
    await expect(f.adapter.signPsbt({ ...f.request, inputs: [{ ...f.request.inputs[0]!, path: { leafHash: "00".repeat(32) } }] })).rejects.toThrow("Unsupported script path");
    expect(f.sign).not.toHaveBeenCalled(); f.adapter.dispose();
  });
  it("refuses mismatched wallet, network, roles, keys and shared claims on connect", async () => {
    for (const patch of [
      { walletId: "okx" }, { network: "signet" }, { sharedAddress: true },
      { ordinals: paymentAccount, payment: ordAccount },
      { ordinals: { ...ordAccount, publicKey: hex(otherKey.publicKey) } },
    ]) {
      const f = fixture("xverse");
      f.host.connect = async () => ({ ...f.session, ...patch }) as BtcSession;
      await expect(f.adapter.connect("mainnet")).rejects.toThrow(); f.adapter.dispose();
    }
    const f = fixture("xverse");
    await expect(f.adapter.connect("testnet4")).rejects.toThrow("Unsupported wallet network");
    expect(f.host.connect).not.toHaveBeenCalled();
    f.setNetwork("unknown");
    await expect(f.adapter.connect("mainnet")).rejects.toThrow("Wallet network mismatch or unknown");
    expect(f.host.connect).toHaveBeenCalledOnce(); f.adapter.dispose();
  });
  it("refuses Phantom and unsupported shared or separate wallet roles", async () => {
    const xverse = fixture("xverse");
    expect(() => createBitcoinWalletAdapter({ ...xverse.host, id: "phantom" } as never)).toThrow("Unknown wallet");
    xverse.host.connect = async () => createSession("xverse", "mainnet", [ordAccount, { ...ordAccount, purpose: "payment" }]);
    await expect(xverse.adapter.connect("mainnet")).rejects.toThrow("Unsupported wallet account roles");
    const unisat = fixture("unisat");
    unisat.host.connect = async () => createSession("unisat", "mainnet", [ordAccount, paymentAccount]);
    await expect(unisat.adapter.connect("mainnet")).rejects.toThrow("Unsupported wallet account roles");
    xverse.adapter.dispose(); unisat.adapter.dispose();
  });
  it("invalidates overlapping connects before waiting for the provider", async () => {
    const f = fixture("xverse"); const delayed = deferred<BtcSession>(); const started = deferred<void>();
    let calls = 0; f.host.connect = () => { if (++calls === 1) { started.resolve(); return delayed.promise; } return Promise.resolve(f.session); };
    const first = f.adapter.connect("mainnet"); await started.promise;
    await f.adapter.connect("mainnet");
    delayed.resolve(f.session); await expect(first).rejects.toThrow("Wallet session changed");
    expect(await f.adapter.signPsbt(f.request)).toBeTypeOf("string"); f.adapter.dispose();
  });
  it.each(["event", "disconnect", "dispose"] as const)("cannot complete a connect invalidated by %s", async reason => {
    const f = fixture("xverse"); const delayed = deferred<BtcSession>(); const started = deferred<void>();
    if (reason === "event") f.host.readLiveSession = () => { started.resolve(); return delayed.promise; };
    else f.host.connect = () => { started.resolve(); return delayed.promise; };
    const connecting = f.adapter.connect("mainnet"); await started.promise;
    if (reason === "event") f.invalidate(); else f.adapter[reason]();
    delayed.resolve(f.session); await expect(connecting).rejects.toThrow();
    await expect(f.adapter.signPsbt(f.request)).rejects.toThrow(); f.adapter.dispose();
  });
  it("never calls the signing provider after an in-flight classification invalidation", async () => {
    const f = fixture("xverse"); await f.adapter.connect("mainnet");
    const started = deferred<void>(); const finish = deferred<void>();
    f.setBeforeRead(async () => { started.resolve(); await finish.promise; });
    const signing = f.adapter.signPsbt(f.request); await started.promise;
    f.invalidate(); finish.resolve(); await expect(signing).rejects.toThrow("Wallet session changed");
    expect(f.sign).not.toHaveBeenCalled(); expect(f.unsubscribe).toHaveBeenCalledOnce(); f.adapter.dispose();
  });
  it("does not cache a signature returned after an in-flight invalidation", async () => {
    const f = fixture("xverse"); await f.adapter.connect("mainnet");
    const started = deferred<void>(); const finish = deferred<void>();
    f.setBeforeSign(async () => { started.resolve(); await finish.promise; });
    const signing = f.adapter.signPsbt(f.request); await started.promise;
    f.invalidate(); finish.resolve(); await expect(signing).rejects.toThrow("Wallet session changed");
    const signed = await f.sign.mock.results[0]!.value;
    f.setBeforeSign(undefined); await f.adapter.connect("mainnet");
    await expect(f.adapter.recheckBeforeBroadcast(signed)).rejects.toThrow("Unknown signed PSBT"); f.adapter.dispose();
  });
  it("snapshots a reviewed request and message account before awaiting live checks", async () => {
    const f = fixture("xverse"); await f.adapter.connect("mainnet");
    const gate = deferred<void>(); const started = deferred<void>();
    const original = f.host.getNetwork;
    let pause = true;
    f.host.getNetwork = async () => { if (pause) { pause = false; started.resolve(); await gate.promise; } return original(); };
    const originalPsbt = f.request.psbtBase64;
    const signing = f.adapter.signPsbt(f.request); await started.promise;
    f.request.psbtBase64 = "not a psbt"; f.request.inputs[0]!.index = 9; f.request.inputs.length = 1;
    gate.resolve(); const signed = await signing;
    expect(f.sign.mock.calls[0]![0]).toBe(originalPsbt);
    expect(bitcoin.Psbt.fromBase64(signed).data.inputs[1]!.partialSig).toHaveLength(1);
    const account = { ...f.session.ordinals };
    const secondGate = deferred<void>(); const secondStarted = deferred<void>();
    f.host.getNetwork = async () => { f.host.getNetwork = original; secondStarted.resolve(); await secondGate.promise; return original(); };
    const message = f.adapter.signMessageBip322(account, "nonce"); await secondStarted.promise;
    account.address = other.address!; account.publicKey = hex(otherKey.publicKey); secondGate.resolve();
    await expect(message).resolves.toBeTypeOf("string");
    expect(f.xverseMessage.mock.calls[0]![1].address).toBe(f.session.ordinals.address); f.adapter.dispose();
  });
  it("clears pending state and listeners, and rejects actions after disposal", async () => {
    const f = fixture("xverse"); await f.adapter.connect("mainnet");
    const signed = await f.adapter.signPsbt(f.request); f.invalidate();
    expect(f.onInvalidate).toHaveBeenCalled(); expect(f.unsubscribe).toHaveBeenCalledOnce();
    await f.adapter.connect("mainnet"); await expect(f.adapter.recheckBeforeBroadcast(signed)).rejects.toThrow("Unknown signed PSBT");
    f.adapter.dispose();
    await expect(f.adapter.connect("mainnet")).rejects.toThrow("disposed");
    await expect(f.adapter.signPsbt(f.request)).rejects.toThrow("disposed");
    await expect(f.adapter.signMessageBip322(f.session.ordinals, "test")).rejects.toThrow("disposed");
    await expect(f.adapter.recheckBeforeBroadcast(signed)).rejects.toThrow("disposed");
    expect(() => f.adapter.disconnect()).toThrow("disposed");
  });
  it("removes focus and provider listeners on invalidation and reinstalls them on reconnect", async () => {
    const f = fixture("xverse");
    let focus: (() => void) | undefined;
    const focusTarget = {
      addEventListener: vi.fn((_type: "focus", listener: () => void) => { focus = listener; }),
      removeEventListener: vi.fn((_type: "focus", listener: () => void) => { if (focus === listener) focus = undefined; }),
    };
    const adapter = createBitcoinWalletAdapter({ ...f.host, focusTarget });
    await adapter.connect("mainnet"); expect(focus).toBeTypeOf("function");
    f.setNetwork("signet"); focus!();
    await vi.waitFor(() => expect(focus).toBeUndefined());
    expect(focusTarget.removeEventListener).toHaveBeenCalledOnce();
    f.setNetwork("mainnet"); await adapter.connect("mainnet");
    expect(focusTarget.addEventListener).toHaveBeenCalledTimes(2);
    adapter.dispose(); expect(focus).toBeUndefined(); f.adapter.dispose();
  });
});

describe("provider error codes", () => {
  it.each(["connect", "reconcile"] as const)("preserves Xverse %s response and thrown error codes", async method => {
    const connect = method === "connect" ? connectXverse : reconcileXverse;
    for (const failure of [{ status: "error", error: { code: -32000, message: "rejected" } }, { code: -32601, message: "unsupported" }]) {
      const isEnvelope = "status" in failure;
      const request = vi.fn(async () => { if (!isEnvelope) throw failure; return failure; });
      try { await connect({ request }, "mainnet"); throw new Error("Expected rejection"); }
      catch (error) { expect(error).toBeInstanceOf(WalletProviderError); expect((error as WalletProviderError).code).toBe(isEnvelope ? -32000 : -32601); }
    }
  });
  it("preserves Xverse BIP-322 rejection codes for envelopes and thrown errors", async () => {
    const f = fixture("xverse");
    let thrown = false;
    f.host.messageTransport = { wallet: "xverse", request: async () => {
      if (thrown) throw { code: 4001, message: "declined" };
      return { status: "error", error: { code: "USER_REJECTION", message: "declined" } };
    } };
    await f.adapter.connect("mainnet");
    await expect(f.adapter.signMessageBip322(f.session.ordinals, "login")).rejects.toMatchObject({ code: "USER_REJECTION", rejected: true });
    thrown = true;
    await expect(f.adapter.signMessageBip322(f.session.ordinals, "login")).rejects.toMatchObject({ code: 4001, rejected: true });
    f.adapter.dispose();
  });
});
