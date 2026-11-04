import { describe, expect, it } from "vitest";
import { crypto, payments, Psbt } from "bitcoinjs-lib";
import { ECPair, REGTEST_NETWORK, createTaprootAuctionVault, createCooperativeVaultPsbt, signVaultPsbt } from "../src/taproot-auction-vault.js";
import { assertVaultTaprootSpendProof } from "../src/psbt-review.js";
import { validateSignedPsbt } from "../src/signed-review.js";
import type { BtcSession, SignRequest } from "../src/types.js";

const key = ECPair.makeRandom({ network: REGTEST_NETWORK });
const pub = Buffer.from(key.publicKey).toString("hex");
const p2w = payments.p2wpkh({ pubkey: key.publicKey, network: REGTEST_NETWORK });
const account = { address: p2w.address!, addressType: "p2wpkh" as const, purpose: "payment" as const, publicKey: pub };
const session: BtcSession = { walletId: "fixture", network: "regtest", payment: account, ordinals: { ...account, purpose: "ordinals" }, sharedAddress: true };
function fixture() {
  const psbt = new Psbt({ network: REGTEST_NETWORK });
  psbt.addInput({ hash: "11".repeat(32), index: 0, witnessUtxo: { script: p2w.output!, value: 10000n }, sighashType: 1 });
  psbt.addOutput({ address: p2w.address!, value: 9000n });
  const request: SignRequest = { psbtBase64: psbt.toBase64(), inputs: [{ index: 0, account: "payment", sighash: 1, path: "key" }] };
  psbt.signInput(0, key);
  return { request, psbt };
}
describe("wallet PSBT return", () => {
  it("accepts a real segwit signature", () => { const {request, psbt} = fixture(); expect(validateSignedPsbt(session, request, psbt.toBase64())).toBe(psbt.toBase64()); });
  it("rejects changed output and sequence", () => {
    const {request, psbt} = fixture();
    const changed = Psbt.fromBase64(request.psbtBase64); changed.setInputSequence(0, 1); changed.signInput(0, key);
    expect(() => validateSignedPsbt(session, request, changed.toBase64())).toThrow();
    const output = Psbt.fromBase64(request.psbtBase64, { network: REGTEST_NETWORK }); output.addOutput({ address: p2w.address!, value: 1n });
    expect(() => validateSignedPsbt(session, request, output.toBase64())).toThrow();
    psbt.finalizeAllInputs(); expect(() => validateSignedPsbt(session, request, psbt.toBase64())).toThrow();
  });
  it("accepts a real vault script signature and preserves cosignatures", () => {
    const owner = ECPair.makeRandom({ network: REGTEST_NETWORK });
    const coordinator = ECPair.makeRandom({ network: REGTEST_NETWORK });
    const vault = createTaprootAuctionVault({ ownerPublicKey: owner.publicKey, coordinatorPublicKey: coordinator.publicKey, refundAfterHeight: 500 });
    const unsigned = createCooperativeVaultPsbt({ vault, funding: { transactionId: "22".repeat(32), outputIndex: 0, valueSats: 10000n }, destination: { address: p2w.address!, valueSats: 9000n } });
    const initial = Psbt.fromBase64(unsigned); initial.data.inputs[0]!.sighashType = 0;
    const before = signVaultPsbt({ psbtBase64: initial.toBase64(), signer: coordinator });
    const parsed = Psbt.fromBase64(before); const leaf = assertVaultTaprootSpendProof(parsed.data.inputs[0]!);
    const request: SignRequest = { psbtBase64: before, inputs: [{ index: 0, account: "ordinals", sighash: 0, path: { leafHash: leaf.toString("hex") } }] };
    const ownerSession = { ...session, ordinals: { address: payments.p2tr({ internalPubkey: owner.publicKey.slice(1), network: REGTEST_NETWORK }).address!, addressType: "p2tr" as const, purpose: "ordinals" as const, publicKey: Buffer.from(owner.publicKey).toString("hex"), internalKeyXOnly: Buffer.from(owner.publicKey.slice(1)).toString("hex") } };
    const signed = signVaultPsbt({ psbtBase64: before, signer: owner });
    expect(validateSignedPsbt(ownerSession, request, signed)).toBe(signed);
    const lost = signVaultPsbt({ psbtBase64: initial.toBase64(), signer: owner });
    expect(() => validateSignedPsbt(ownerSession, request, lost)).toThrow();
    const wrongLeaf = { ...request, inputs: [{ ...request.inputs[0]!, path: { leafHash: "ff".repeat(32) } }] };
    expect(() => validateSignedPsbt(ownerSession, wrongLeaf, signed)).toThrow();
    const altered = Psbt.fromBase64(signed); altered.data.inputs[0]!.tapLeafScript![0]!.controlBlock[0] ^= 1;
    expect(() => validateSignedPsbt(ownerSession, request, altered.toBase64())).toThrow();
    const changedCosigner = Psbt.fromBase64(signed); changedCosigner.data.inputs[0]!.tapScriptSig![0]!.signature[5] ^= 1;
    expect(() => validateSignedPsbt(ownerSession, request, changedCosigner.toBase64())).toThrow();
  });
});

it("accepts mixed Taproot, native and wrapped segwit signatures", () => {
  const x = key.publicKey.slice(1);
  const tap = payments.p2tr({ internalPubkey: x, network: REGTEST_NETWORK });
  const wrapped = payments.p2sh({ redeem: p2w, network: REGTEST_NETWORK });
  const tx = new Psbt({ network: REGTEST_NETWORK });
  tx.addInput({ hash: "33".repeat(32), index: 0, witnessUtxo: { script: tap.output!, value: 10000n }, tapInternalKey: x, sighashType: 1 });
  tx.addInput({ hash: "44".repeat(32), index: 0, witnessUtxo: { script: p2w.output!, value: 10000n }, sighashType: 1 });
  tx.addInput({ hash: "55".repeat(32), index: 0, witnessUtxo: { script: wrapped.output!, value: 10000n }, redeemScript: p2w.output!, sighashType: 1 });
  tx.addOutput({ address: p2w.address!, value: 29000n });
  const tapAccount = { address: tap.address!, addressType: "p2tr" as const, purpose: "ordinals" as const, publicKey: pub, internalKeyXOnly: Buffer.from(x).toString("hex") };
  const payAccount = { address: wrapped.address!, addressType: "p2sh-p2wpkh" as const, purpose: "payment" as const, publicKey: pub };
  const bound: BtcSession = { ...session, ordinals: tapAccount, payment: payAccount, sharedAddress: false };
  const firstRequest: SignRequest = { psbtBase64: tx.toBase64(), inputs: [{index: 0, account: "ordinals", sighash: 1, path: "key"}, {index: 2, account: "payment", sighash: 1, path: "key"}] };
  const tweak = crypto.taggedHash("TapTweak", x);
  const tapSigner = key.tweak(tweak);
  tx.signInput(0, tapSigner, [1]); tx.signInput(2, key);
  const result = validateSignedPsbt(bound, firstRequest, tx.toBase64());
  const second: SignRequest = { psbtBase64: result, inputs: [{index: 1, account: "payment", sighash: 1, path: "key"}] };
  tx.signInput(1, key);
  expect(validateSignedPsbt({ ...bound, payment: account }, second, tx.toBase64())).toBe(tx.toBase64());
});

it("rejects metadata changes, fake signatures and wrong sighash", () => {
  const {request, psbt} = fixture();
  const changed = Psbt.fromBase64(psbt.toBase64());
  changed.data.inputs[0]!.witnessUtxo!.value += 1n;
  expect(() => validateSignedPsbt(session, request, changed.toBase64())).toThrow();
  const fake = Psbt.fromBase64(psbt.toBase64());
  fake.data.inputs[0]!.partialSig![0]!.signature[10] ^= 1;
  expect(() => validateSignedPsbt(session, request, fake.toBase64())).toThrow();
  const extraKey = Psbt.fromBase64(psbt.toBase64());
  const other = ECPair.makeRandom({ network: REGTEST_NETWORK });
  extraKey.data.inputs[0]!.partialSig![0]!.pubkey = other.publicKey;
  expect(() => validateSignedPsbt(session, request, extraKey.toBase64())).toThrow();
  const wrong = Psbt.fromBase64(psbt.toBase64());
  const sig = wrong.data.inputs[0]!.partialSig![0]!.signature;
  sig[sig.length - 1] = 2;
  expect(() => validateSignedPsbt(session, request, wrong.toBase64())).toThrow();
});

it("rejects a signature on an unrequested input", () => {
  const tx = new Psbt({ network: REGTEST_NETWORK });
  for (const byte of ["77", "88"]) tx.addInput({ hash: byte.repeat(32), index: 0, witnessUtxo: { script: p2w.output!, value: 10000n }, sighashType: 1 });
  tx.addOutput({ address: p2w.address!, value: 19000n });
  const request: SignRequest = { psbtBase64: tx.toBase64(), inputs: [{ index: 0, account: "payment", sighash: 1, path: "key" }] };
  tx.signInput(0, key); tx.signInput(1, key);
  expect(() => validateSignedPsbt(session, request, tx.toBase64())).toThrow();
});
