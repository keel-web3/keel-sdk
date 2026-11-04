import { Buffer } from "node:buffer";

import {
  initEccLib,
  networks,
  opcodes,
  payments,
  Psbt,
  script,
  type Network,
} from "bitcoinjs-lib";
import { ECPairFactory, type ECPairInterface } from "ecpair";
import * as ecc from "tiny-secp256k1";

import {
  assertVaultTaprootInputSignaturesValid,
  assertVaultTaprootSpendProof,
  vaultTaprootRequiredPublicKeys,
} from "./psbt-review.js";

initEccLib(ecc);

export const ECPair = ECPairFactory(ecc);
export const REGTEST_NETWORK = networks.regtest;
export const TAPLEAF_VERSION = 0xc0;

// BIP341's recommended nothing-up-my-sleeve internal key. Its discrete log is
// unknown, so there is no hidden key-path bypass around the two revealed rules.
export const TAPROOT_NUMS_KEY = Buffer.from(
  "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0",
  "hex",
);

export function deriveTaprootAddress(input: {
  readonly publicKey: Uint8Array;
  readonly network?: Network;
}): string {
  const address = payments.p2tr({
    internalPubkey: toXOnly(input.publicKey),
    network: input.network ?? REGTEST_NETWORK,
  }).address;
  if (address === undefined) throw new Error("Unable to derive a Taproot address.");
  return address;
}

export interface TaprootAuctionVault {
  readonly address: string;
  readonly outputScriptHex: string;
  readonly ownerPublicKeyHex: string;
  readonly coordinatorPublicKeyHex: string;
  readonly refundAfterHeight: number;
  readonly cooperativeScriptHex: string;
  readonly cooperativeControlBlockHex: string;
  readonly refundScriptHex: string;
  readonly refundControlBlockHex: string;
}

export interface VaultSpendInput {
  readonly transactionId: string;
  readonly outputIndex: number;
  readonly valueSats: bigint;
}

export interface VaultSpendOutput {
  readonly address: string;
  readonly valueSats: bigint;
}

export function createTaprootAuctionVault(input: {
  readonly ownerPublicKey: Uint8Array;
  readonly coordinatorPublicKey: Uint8Array;
  readonly refundAfterHeight: number;
  readonly network?: Network;
}): TaprootAuctionVault {
  if (!Number.isInteger(input.refundAfterHeight) || input.refundAfterHeight < 1) {
    throw new Error("refundAfterHeight must be a positive block height.");
  }
  const network = input.network ?? REGTEST_NETWORK;
  const owner = toXOnly(input.ownerPublicKey);
  const coordinator = toXOnly(input.coordinatorPublicKey);
  const cooperativeScript = script.compile([
    owner,
    opcodes.OP_CHECKSIGVERIFY,
    coordinator,
    opcodes.OP_CHECKSIG,
  ]);
  const refundScript = script.compile([
    script.number.encode(input.refundAfterHeight),
    opcodes.OP_CHECKLOCKTIMEVERIFY,
    opcodes.OP_DROP,
    owner,
    opcodes.OP_CHECKSIG,
  ]);
  const scriptTree = [
    { output: cooperativeScript },
    { output: refundScript },
  ] as [{ output: Uint8Array }, { output: Uint8Array }];
  const payment = payments.p2tr({
    internalPubkey: TAPROOT_NUMS_KEY,
    scriptTree,
    network,
  });
  const cooperative = payments.p2tr({
    internalPubkey: TAPROOT_NUMS_KEY,
    scriptTree,
    redeem: { output: cooperativeScript, redeemVersion: TAPLEAF_VERSION },
    network,
  });
  const refund = payments.p2tr({
    internalPubkey: TAPROOT_NUMS_KEY,
    scriptTree,
    redeem: { output: refundScript, redeemVersion: TAPLEAF_VERSION },
    network,
  });
  const address = payment.address;
  const output = payment.output;
  const cooperativeControlBlock = cooperative.witness?.at(-1);
  const refundControlBlock = refund.witness?.at(-1);
  if (
    address === undefined
    || output === undefined
    || cooperativeControlBlock === undefined
    || refundControlBlock === undefined
  ) {
    throw new Error("Unable to construct Taproot auction vault.");
  }
  return {
    address,
    outputScriptHex: Buffer.from(output).toString("hex"),
    ownerPublicKeyHex: Buffer.from(owner).toString("hex"),
    coordinatorPublicKeyHex: Buffer.from(coordinator).toString("hex"),
    refundAfterHeight: input.refundAfterHeight,
    cooperativeScriptHex: Buffer.from(cooperativeScript).toString("hex"),
    cooperativeControlBlockHex: Buffer.from(cooperativeControlBlock).toString("hex"),
    refundScriptHex: Buffer.from(refundScript).toString("hex"),
    refundControlBlockHex: Buffer.from(refundControlBlock).toString("hex"),
  };
}

/**
 * Creates the shared unsigned settlement/cancellation PSBT. The owner and the
 * coordinator sign clones independently; neither party receives the other's
 * private key and a PSBT is not reported as consumed until its transaction is
 * broadcast and confirmed.
 */
export function createCooperativeVaultPsbt(input: {
  readonly vault: TaprootAuctionVault;
  readonly funding: VaultSpendInput;
  readonly destination?: VaultSpendOutput;
  readonly outputs?: readonly VaultSpendOutput[];
  readonly network?: Network;
}): string {
  return createVaultPsbt({ ...input, path: "cooperative" }).toBase64();
}

/** Owner-only recovery PSBT. It is invalid before the encoded CLTV height. */
export function createRefundVaultPsbt(input: {
  readonly vault: TaprootAuctionVault;
  readonly funding: VaultSpendInput;
  readonly destination: VaultSpendOutput;
  readonly network?: Network;
}): string {
  const psbt = createVaultPsbt({ ...input, path: "refund" });
  psbt.setLocktime(input.vault.refundAfterHeight);
  psbt.setInputSequence(0, 0xfffffffe);
  return psbt.toBase64();
}

export function signVaultPsbt(input: {
  readonly psbtBase64: string;
  readonly signer: ECPairInterface;
  readonly network?: Network;
}): string {
  const psbt = Psbt.fromBase64(input.psbtBase64, {
    network: input.network ?? REGTEST_NETWORK,
  });
  psbt.signTaprootInput(0, input.signer);
  return psbt.toBase64();
}

export function combineAndFinalizeVaultPsbts(input: {
  readonly signedPsbts: readonly [string, ...string[]];
  readonly network?: Network;
}): { readonly psbtBase64: string; readonly transactionHex: string; readonly transactionId: string } {
  const network = input.network ?? REGTEST_NETWORK;
  const [first, ...rest] = input.signedPsbts;
  const combined = Psbt.fromBase64(first, { network });
  if (rest.length > 0) {
    combined.combine(...rest.map((item) => Psbt.fromBase64(item, { network })));
  }
  if (combined.data.inputs.length !== 1) {
    throw new Error("Auction vault finalization requires exactly one input.");
  }
  const psbtInput = combined.data.inputs[0];
  const leaf = psbtInput?.tapLeafScript?.[0];
  const operations = leaf === undefined ? undefined : script.decompile(leaf.script);
  if (psbtInput === undefined || leaf === undefined || operations === undefined || operations === null) {
    throw new Error("Vault finalization requires one decoded Taproot script path.");
  }
  const leafHash = assertVaultTaprootSpendProof(psbtInput);
  const requiredPublicKeys = vaultTaprootRequiredPublicKeys(leaf.script);
  const signatures = psbtInput.tapScriptSig ?? [];
  const signatureKeys = new Set<string>();
  if (
    signatures.length !== requiredPublicKeys.length
    || signatures.some((signature) => {
      const publicKey = Buffer.from(signature.pubkey).toString("hex");
      if (
        signature.signature.length !== 64
        || !Buffer.from(signature.leafHash).equals(leafHash)
        || !requiredPublicKeys.includes(publicKey)
        || signatureKeys.has(publicKey)
      ) {
        return true;
      }
      signatureKeys.add(publicKey);
      return false;
    })
    || requiredPublicKeys.some((publicKey) => !signatureKeys.has(publicKey))
  ) {
    throw new Error("Vault finalization received an invalid signer, leaf hash, or sighash mode.");
  }
  assertVaultTaprootInputSignaturesValid(combined, 0);
  combined.finalizeTaprootInput(0, leafHash);
  const transaction = combined.extractTransaction();
  return {
    psbtBase64: combined.toBase64(),
    transactionHex: transaction.toHex(),
    transactionId: transaction.getId(),
  };
}

function createVaultPsbt(input: {
  readonly vault: TaprootAuctionVault;
  readonly funding: VaultSpendInput;
  readonly destination?: VaultSpendOutput;
  readonly outputs?: readonly VaultSpendOutput[];
  readonly path: "cooperative" | "refund";
  readonly network?: Network;
}): Psbt {
  const outputs = input.outputs ?? (input.destination === undefined ? [] : [input.destination]);
  const totalOutputSats = outputs.reduce((total, output) => total + output.valueSats, 0n);
  if (outputs.length === 0 || outputs.some((output) => output.valueSats <= 0n) || totalOutputSats >= input.funding.valueSats) {
    throw new Error("Vault spend output must leave a positive miner fee.");
  }
  const cooperative = input.path === "cooperative";
  const leafScript = Buffer.from(
    cooperative ? input.vault.cooperativeScriptHex : input.vault.refundScriptHex,
    "hex",
  );
  const controlBlock = Buffer.from(
    cooperative ? input.vault.cooperativeControlBlockHex : input.vault.refundControlBlockHex,
    "hex",
  );
  const psbt = new Psbt({ network: input.network ?? REGTEST_NETWORK })
    .addInput({
      hash: input.funding.transactionId,
      index: input.funding.outputIndex,
      witnessUtxo: {
        script: Buffer.from(input.vault.outputScriptHex, "hex"),
        value: input.funding.valueSats,
      },
      tapLeafScript: [{
        leafVersion: TAPLEAF_VERSION,
        script: leafScript,
        controlBlock,
      }],
    });
  for (const output of outputs) psbt.addOutput({ address: output.address, value: output.valueSats });
  return psbt;
}

function toXOnly(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length === 32) return publicKey;
  if (publicKey.length === 33) return publicKey.slice(1, 33);
  throw new Error("A compressed or x-only secp256k1 public key is required.");
}
