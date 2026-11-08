export { escrow, escrowPolicy, signerPolicy } from "./core.ts";

import { escrow, tapOutput } from './core.ts';
import { unsignedPsbt } from './builders.ts';
export function escrowTemplate(payment, minter) {
  const keys=[minter,payment.treasuryKey,...(payment.writerKeys || [])];
  if (payment.writerKeys?.length!==3 || new Set([payment.treasuryKey,...payment.writerKeys]).size!==4) throw Error('three distinct writer keys required');
  for (const key of keys) { if (!/^[0-9a-f]{64}$/.test(key)) throw Error('x-only key'); tapOutput(key,''); }
  if (![payment.collectAfter,payment.refundAfter].every(n=>Number.isInteger(n)&&n>=1&&n<=65535) || payment.refundAfter<=payment.collectAfter) throw Error('block CSV delays');
  return escrow(payment,minter);
}
export function buildEscrowSpend({payment,minter,leaf,utxo,outputScript,fee}) {
  const tree=escrowTemplate(payment,minter);
  if (!tree.scripts[leaf] || utxo.script!==tree.scriptPubKey) throw Error('escrow leaf/prevout mismatch');
  if (!Number.isSafeInteger(fee) || fee<0) throw Error('invalid fee');
  const sequence=leaf==='L_t'?payment.collectAfter:leaf==='L_m'?payment.refundAfter:0xfffffffd;
  const signers=leaf==='L_m'?[minter]:[leaf==='L_t'?payment.treasuryKey:minter,...payment.writerKeys];
  return unsignedPsbt({version:2,locktime:0,inputs:[{txid:utxo.txid,vout:utxo.vout,sequence}],outputs:[{value:utxo.value-fee,script:outputScript}]},[{value:utxo.value,script:utxo.script}],[{script:tree.scripts[leaf],controlBlock:tree.controlBlocks[leaf],signers}]);
}
