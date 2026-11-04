import { Buffer } from "node:buffer";
import { initEccLib, networks, payments, Psbt, script, Transaction } from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { assertVaultTaprootSpendProof, vaultTaprootRequiredPublicKeys } from "./psbt-review.js";
import type { BtcSession, SignRequest } from "./types.js";

initEccLib(ecc);

const hex = (v: Uint8Array): string => Buffer.from(v).toString("hex");
function canonical(value: unknown): unknown {
  if (value instanceof Uint8Array) return hex(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const signatures = (input: Psbt["data"]["inputs"][number]) => ({
  partialSig: input.partialSig ?? [], tapScriptSig: input.tapScriptSig ?? [], tapKeySig: input.tapKeySig,
});
function metadata(input: Psbt["data"]["inputs"][number]) {
  const { partialSig: _p, tapScriptSig: _s, tapKeySig: _k, ...rest } = input;
  return rest;
}
function retained<T>(before: T[], after: T[]): boolean {
  return before.every(item => after.some(candidate => equal(item, candidate)));
}

/** Verify a wallet return against the reviewed PSBT. It never finalizes or broadcasts. */
export function validateSignedPsbt(session: BtcSession, request: SignRequest, signedBase64: string): string {
  if (!["mainnet", "testnet3", "testnet4", "signet", "regtest"].includes(session.network)) throw new Error("Unknown network");
  const network = session.network === "mainnet" ? networks.bitcoin : session.network === "regtest" ? networks.regtest : networks.testnet;
  const expected = Psbt.fromBase64(request.psbtBase64, { network });
  const returned = Psbt.fromBase64(signedBase64, { network });
  if (hex(expected.data.globalMap.unsignedTx.toBuffer()) !== hex(returned.data.globalMap.unsignedTx.toBuffer())) throw new Error("Wallet changed transaction");
  const { unsignedTx: _e, ...eg } = expected.data.globalMap;
  const { unsignedTx: _r, ...rg } = returned.data.globalMap;
  if (!equal(eg, rg) || (expected.data.outputs.length !== returned.data.outputs.length || expected.data.outputs.some((item, i) => !equal(item, returned.data.outputs[i]))) || expected.data.inputs.length !== returned.data.inputs.length) throw new Error("Wallet changed PSBT metadata");
  const requests = new Map<number, SignRequest["inputs"][number]>();
  for (const item of request.inputs) {
    if (!Number.isInteger(item.index) || item.index < 0 || item.index >= expected.data.inputs.length || requests.has(item.index) || !["ordinals", "payment"].includes(item.account)) throw new Error("Invalid signing scope");
    requests.set(item.index, item);
  }
  if (!requests.size) throw new Error("Empty signing scope");
  for (let i = 0; i < expected.data.inputs.length; i++) {
    const before = expected.data.inputs[i]!;
    const after = returned.data.inputs[i]!;
    if (!equal(metadata(before), metadata(after)) || after.finalScriptSig || after.finalScriptWitness) throw new Error("Wallet changed input metadata or finalized");
    const a = signatures(before), b = signatures(after);
    if (!retained(a.partialSig, b.partialSig) || !retained(a.tapScriptSig, b.tapScriptSig) || (a.tapKeySig && !equal(a.tapKeySig, b.tapKeySig))) throw new Error("Wallet changed existing signature");
    const newPartial = b.partialSig.filter(s => !a.partialSig.some(t => equal(s, t)));
    const newScript = b.tapScriptSig.filter(s => !a.tapScriptSig.some(t => equal(s, t)));
    const newKey = b.tapKeySig && !a.tapKeySig ? b.tapKeySig : undefined;
    const req = requests.get(i);
    if (!req && (newPartial.length || newScript.length || newKey)) throw new Error("Wallet signed unrequested input");
    if (req) {
      const account = session[req.account];
      if (!account || account.purpose !== req.account || before.sighashType !== req.sighash || !before.witnessUtxo) throw new Error("Missing bound account, sighash or prevout");
      const pub = Buffer.from(account.publicKey, "hex");
      if (!/^(02|03)[0-9a-f]{64}$/i.test(account.publicKey) && !/^[0-9a-f]{64}$/i.test(account.publicKey)) throw new Error("Invalid public key");
      const x = pub.length === 33 ? pub.subarray(1) : pub;
      if (account.addressType === "p2tr") {
        if (!account.internalKeyXOnly || account.internalKeyXOnly.toLowerCase() !== hex(x) || payments.p2tr({ internalPubkey: x, network }).address !== account.address) throw new Error("Unbound Taproot account");
        if (newPartial.length) throw new Error("Wrong signature type");
        if (req.path === "key") {
          if (!account.internalKeyXOnly || account.internalKeyXOnly.toLowerCase() !== hex(x) || !equal(before.tapInternalKey, x)) throw new Error("Wrong internal key");
          const output = payments.p2tr({ internalPubkey: x, network });
          if (output.address !== account.address || !equal(output.output, before.witnessUtxo.script) || !newKey || newScript.length) throw new Error("Wrong Taproot key path");
        } else {
          const leafHash = assertVaultTaprootSpendProof(before);
          if (!/^[0-9a-f]{64}$/i.test(req.path.leafHash) || hex(leafHash) !== req.path.leafHash.toLowerCase() || !vaultTaprootRequiredPublicKeys(before.tapLeafScript?.[0]?.script).includes(hex(x)) || newKey || newScript.length !== 1 || hex(newScript[0]!.pubkey) !== hex(x) || hex(newScript[0]!.leafHash) !== hex(leafHash)) throw new Error("Wrong Taproot leaf or signer");
        }
        for (const sig of [...newScript.map(s => s.signature), ...(newKey ? [newKey] : [])]) {
          if ((req.sighash === 0 && sig.length !== 64) || (req.sighash !== 0 && (sig.length !== 65 || sig[64] !== req.sighash))) throw new Error("Wrong Taproot sighash");
        }
      } else if (account.addressType === "p2wpkh" || account.addressType === "p2sh-p2wpkh") {
        if (req.path !== "key" || pub.length !== 33 || newPartial.length !== 1 || newKey || newScript.length || hex(newPartial[0]!.pubkey) !== hex(pub)) throw new Error("Wrong segwit signer");
        const witness = payments.p2wpkh({ pubkey: pub, network });
        const output = account.addressType === "p2wpkh" ? witness : payments.p2sh({ redeem: witness, network });
        if (output.address !== account.address || !equal(output.output, before.witnessUtxo.script) || (account.addressType === "p2sh-p2wpkh" && !equal(before.redeemScript, witness.output))) throw new Error("Wrong segwit prevout");
        if (script.signature.decode(newPartial[0]!.signature).hashType !== req.sighash) throw new Error("Wrong segwit sighash");
      } else throw new Error("Unsupported address type");
    }
    if ((b.tapKeySig || b.tapScriptSig.length) && b.partialSig.length) throw new Error("Mixed signature types");
    if (b.tapKeySig || b.tapScriptSig.length) {
      const tx = Transaction.fromBuffer(returned.data.globalMap.unsignedTx.toBuffer());
      const prevouts = returned.data.inputs.map(candidate => {
        if (!candidate.witnessUtxo) throw new Error("Missing Taproot prevout");
        return candidate.witnessUtxo;
      });
      const verify = (sig: Uint8Array, key: Uint8Array, leaf?: Uint8Array) => {
        const mode = sig.length === 64 ? 0 : sig.length === 65 ? sig[64]! : -1;
        if (![0, 1, 2, 3, 129, 130, 131].includes(mode) || (sig.length === 65 && mode === 0) || after.sighashType !== mode) throw new Error("Invalid Taproot sighash");
        const digest = tx.hashForWitnessV1(i, prevouts.map(p => p.script), prevouts.map(p => p.value), mode, leaf);
        if (!ecc.verifySchnorr(digest, key, sig.slice(0, 64))) throw new Error("Invalid Taproot signature");
      };
      if (b.tapKeySig) {
        const out = after.witnessUtxo?.script;
        if (!out || out.length !== 34 || out[0] !== 0x51 || out[1] !== 0x20) throw new Error("Invalid Taproot output");
        verify(b.tapKeySig, out.slice(2));
      }
      if (b.tapScriptSig.length) {
        const leaf = assertVaultTaprootSpendProof(after);
        const keys = vaultTaprootRequiredPublicKeys(after.tapLeafScript?.[0]?.script);
        for (const sig of b.tapScriptSig) {
          if (hex(sig.leafHash) !== hex(leaf) || !keys.includes(hex(sig.pubkey))) throw new Error("Unbound script signature");
          verify(sig.signature, sig.pubkey, leaf);
        }
      }
    }
    if (b.partialSig.length && !returned.validateSignaturesOfInput(i, (pubkey, hash, sig) => ecc.verify(hash, pubkey, sig))) throw new Error("Invalid signature");
  }
  return returned.toBase64();
}
