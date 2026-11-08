export { formCheck, recipeCheck, marker } from "./core.ts";

import { b, hex, cat, cbor, push, ordIdValue, marker, tapleaf, tapOutput, parseTx } from './core.ts';
import { buildKeySpend, unsignedPsbt } from './builders.ts';
import { escrowTemplate } from './escrow.ts';
export function mintTemplate({recipe, viewer, minter, internalKey = minter, ch, seen}) {
  if (b(recipe).length!==36 || b(viewer).length!==36) throw Error('ID length');
  const metadata={p:'koc1',op:'mint',r:b(recipe),m:b(minter)};
  if (ch!==undefined) metadata.ch=ch; if (seen!==undefined) metadata.seen=seen;
  if (!/^[0-9a-f]{64}$/.test(minter)) throw Error('minter x-only key');
  tapOutput(minter,'');
  const encoded=cbor(metadata), fields=[[7,Buffer.from('koc1')],[11,ordIdValue(viewer)]];
  for (let i=0;i<encoded.length;i+=520) fields.push([5,encoded.subarray(i,i+520)]);
  const script=hex(cat(push(minter),b('ac0063'),push(Buffer.from('ord')),
    ...fields.flatMap(([tag,value])=>[push(Buffer.from([tag])),push(value)]),b('0068')));
  const root=hex(tapleaf(script)), q=tapOutput(internalKey,root);
  return {script,root,internalKey,scriptPubKey:'5120'+q.key,controlBlock:hex(cat(Buffer.from([0xc0|q.parity]),b(internalKey))),minter,recipe};
}
export function buildCommit({template,inputs,value,changeScript,fee}) {
  if (!Number.isSafeInteger(value) || value<330 || !Number.isSafeInteger(fee) || fee<0) throw Error('commit value/fee');
  const change=inputs.reduce((a,i)=>a+i.value,0)-value-fee;
  const outputs=[{value,script:template.scriptPubKey}];
  if (change<0) throw Error('insufficient funds'); if (change) outputs.push({value:change,script:changeScript});
  return {...buildKeySpend({inputs,outputs}),protectedOutputs:1};
}
export function buildReveal({commit,template,payment,recipientScript,postage=330,price,fee,changeScript}) {
  if (!Number.isSafeInteger(postage) || postage<330 || !Number.isSafeInteger(price) || price<0 || !Number.isSafeInteger(fee) || fee<0) throw Error('reveal amount');
  const c=parseTx(commit), prev=c.outputs[0]; if (!prev || prev.script!==template.scriptPubKey) throw Error('commit mismatch');
  const escrow=escrowTemplate(payment,template.minter);
  const paymentValue=Math.max(330,price);
  const change=prev.value-postage-paymentValue-fee;
  if (change<0) throw Error('insufficient funds');
  const outputs=[{value:postage,script:recipientScript},{value:paymentValue,script:escrow.scriptPubKey},{value:0,script:marker(template.recipe)}];
  if (change) outputs.push({value:change,script:changeScript});
  return {...unsignedPsbt({version:2,locktime:0,inputs:[{txid:c.txid,vout:0,sequence:0xfffffffd}],outputs},[prev],[{script:template.script,controlBlock:template.controlBlock,internalKey:template.internalKey,root:template.root,signers:[template.minter]}]),protectedOutputs:3};
}
