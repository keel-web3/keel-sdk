// @ts-nocheck
// Pure Bitcoin builders. txid fields use internal byte order, like parseTx.
// PSBT v0 with BIP371 Taproot fields; no RPC, wallet, or broadcast side effects.
import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { b, hex, cat, sha, tagged, compact, le32, serializeTx, parseTx, tapleaf, tapOutput } from './core.ts';
const u64 = n => { const v = Buffer.alloc(8); v.writeBigUInt64LE(BigInt(n)); return v; };
const field = (key, value) => cat(compact(b(key).length), key, compact(b(value).length), value);
const outputBytes = o => cat(u64(o.value), compact(b(o.script).length), o.script);
const n = secp256k1.CURVE.n;
export function xOnly(privateKey) { return hex(schnorr.getPublicKey(b(privateKey))); }
export function keyOutput(internalKey, root = '') { return '5120' + tapOutput(internalKey, root).key; }
function sats(value) { if (!Number.isSafeInteger(value) || value < 0 || value > 2100000000000000) throw Error('invalid satoshis'); }
export function unsignedPsbt(tx, prevouts, paths = []) {
  tx = structuredClone(tx); prevouts = structuredClone(prevouts); paths = structuredClone(paths);
  if (tx.version !== 2 || !tx.inputs.length || !tx.outputs.length || prevouts.length !== tx.inputs.length) throw Error('transaction shape');
  const seen = new Set();
  tx.inputs.forEach((i, j) => {
    if (!/^[0-9a-f]{64}$/.test(i.txid) || !Number.isInteger(i.vout) || i.vout < 0 || i.vout > 0xffffffff || !Number.isInteger(i.sequence) || i.sequence < 0 || i.sequence > 0xffffffff) throw Error('invalid input');
    const id = `${i.txid}:${i.vout}`; if (seen.has(id)) throw Error('duplicate input'); seen.add(id);
    if (i.scriptSig || i.witness?.length) throw Error('unsigned inputs required');
    sats(prevouts[j].value);
  });
  for (const o of [...prevouts, ...tx.outputs]) { sats(o.value); if (o.script?.startsWith('5120') && o.value<330) throw Error('dust P2TR output'); if (!/^(?:[0-9a-f]{2})+$/.test(o.script)) throw Error('invalid script'); }
  const fee = prevouts.reduce((a,o) => a+o.value,0) - tx.outputs.reduce((a,o) => a+o.value,0);
  if (!Number.isSafeInteger(fee) || fee < 0) throw Error('insufficient funds');
  const maps = tx.inputs.map((_, i) => {
    const p = paths[i] || {};
    if (p.script) {
      let root = tapleaf(p.script); const c = b(p.controlBlock);
      if (c.length < 33 || (c.length-33)%32 || c.length > 4129 || (c[0]&0xfe)!==0xc0) throw Error('control block');
      for (let j=33;j<c.length;j+=32) root = tagged('TapBranch', ...[root,c.subarray(j,j+32)].sort(Buffer.compare));
      const q = tapOutput(hex(c.subarray(1,33)), root);
      if (prevouts[i].script !== '5120'+q.key || (c[0]&1)!==q.parity) throw Error('leaf does not authenticate prevout');
    } else if (!p.internalKey || keyOutput(p.internalKey,p.root || '') !== prevouts[i].script) throw Error('key does not authenticate prevout');
    return cat(field(b('01'), outputBytes(prevouts[i])),
      p.script ? field(cat(b('15'),b(p.controlBlock)),cat(b(p.script),b('c0'))) : Buffer.alloc(0),
      p.internalKey ? field(b('17'),b(p.internalKey)) : Buffer.alloc(0),
      p.root ? field(b('18'),b(p.root)) : Buffer.alloc(0), b('00'));
  });
  const psbt = cat(b('70736274ff'),field(b('00'),serializeTx(tx,false)),b('00'),...maps,...tx.outputs.map(()=>b('00')));
  return { psbt, tx, prevouts, paths, fee };
}
// BIP341 SIGHASH_DEFAULT, no annex, all inputs and outputs committed.
export function taprootSighash(plan, index) {
  const {tx,prevouts,paths} = plan; const path = paths[index] || {};
  return tagged('TapSighash', b('0000'), le32(tx.version), le32(tx.locktime || 0),
    sha(...tx.inputs.map(i=>cat(b(i.txid),le32(i.vout)))), sha(...prevouts.map(o=>u64(o.value))),
    sha(...prevouts.map(o=>cat(compact(b(o.script).length),b(o.script)))),
    sha(...tx.inputs.map(i=>le32(i.sequence))), sha(...tx.outputs.map(outputBytes)),
    Buffer.from([path.script ? 2 : 0]), le32(index),
    ...(path.script ? [tapleaf(path.script),b('00ffffffff')] : []));
}
function tweakedKey(key, root) {
  let d = BigInt('0x'+hex(key)); const pub = secp256k1.getPublicKey(key,true);
  if (pub[0] === 3) d = n-d;
  const tweak = BigInt('0x'+hex(tagged('TapTweak',pub.subarray(1),b(root))));
  if (tweak>=n || (d+tweak)%n===0n) throw Error('invalid private tweak');
  return b(((d+tweak)%n).toString(16).padStart(64,'0'));
}
// Returns a new finalized transaction. Missing script signers get empty slots,
// allowing negative consensus tests; wallet authorization is the caller's job.
export function signTransaction(plan, privateKeys) {
  const keys = new Map(privateKeys.map(k=>[xOnly(k),b(k)])); const tx = structuredClone(plan.tx);
  tx.inputs.forEach((input,i)=> {
    const p = plan.paths[i], digest = taprootSighash(plan,i);
    if (p.script) input.witness = [...p.signers].reverse().map(pub=> keys.has(pub) ? hex(schnorr.sign(digest,keys.get(pub),Buffer.alloc(32))) : '').concat([p.script,p.controlBlock]);
    else {
      const key = keys.get(p.internalKey); if (!key) throw Error('missing key-path signer');
      input.witness = [hex(schnorr.sign(digest,tweakedKey(key,p.root || ''),Buffer.alloc(32)))];
    }
  });
  return serializeTx(tx,true);
}
export function buildKeySpend({ inputs, outputs }) {
  return unsignedPsbt({version:2,locktime:0,inputs:inputs.map(i=>({txid:i.txid,vout:i.vout,sequence:0xfffffffd})),outputs},inputs.map(i=>({value:i.value,script:i.script})),inputs.map(i=>({internalKey:i.internalKey,root:i.root || ''})));
}
export function buildCancel({commit, template, outputScript, fee}) {
  const c = parseTx(commit); const o = c.outputs[0];
  if (!o || o.script !== template.scriptPubKey) throw Error('commit mismatch');
  sats(fee);
  return buildKeySpend({inputs:[{txid:c.txid,vout:0,...o,internalKey:template.internalKey,root:template.root}],outputs:[{value:o.value-fee,script:outputScript}]});
}
export function bumpRbf(plan, {fee, changeIndex}) {
  sats(fee);
  if (fee<=plan.fee || !plan.tx.inputs.some(i=>i.sequence<0xfffffffe)) throw Error('not an RBF fee increase');
  if (!Number.isInteger(changeIndex) || changeIndex < (plan.protectedOutputs || 0) || !plan.tx.outputs[changeIndex]) throw Error('change output required');
  const tx=structuredClone(plan.tx); tx.outputs[changeIndex].value-=fee-plan.fee;
  const result=unsignedPsbt(tx,plan.prevouts,plan.paths); return {...result,protectedOutputs:plan.protectedOutputs};
}
export function buildCpfp({parent,vout,internalKey,root='',outputScript,fee}) {
  sats(fee); const tx=parseTx(parent), o=tx.outputs[vout]; if (!o) throw Error('missing parent output');
  return buildKeySpend({inputs:[{txid:tx.txid,vout,...o,internalKey,root}],outputs:[{value:o.value-fee,script:outputScript}]});
}
