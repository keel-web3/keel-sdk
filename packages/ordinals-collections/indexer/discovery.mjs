import {parseTx} from '../src/tx.ts';
import {parseOrdEnvelopes,decodeCbor} from '../src/envelope.ts';
const recipeMarker='6a284b4f4331'+'00'.repeat(36);
// Returns candidates only. Caller must authenticate commit, charms and recipe references.
export function discoverRecipes(rawTx) {
 let tx;try {tx=parseTx(rawTx)}catch{return []}
 if(tx.end!==(typeof rawTx === "string" ? Buffer.from(rawTx,"hex").length : rawTx.length) || !tx.outputs.some(o=>o.value===0 && o.script===recipeMarker))return [];
 const found=[]; let inscriptionIndex=0;
 for(let input=0;input<tx.inputs.length;input++) {
  const witness=[...tx.inputs[input].witness];if(witness.at(-1)?.startsWith('50'))witness.pop();
  if(witness.length<2)continue;
  let envelopes;try {envelopes=parseOrdEnvelopes(witness.at(-2))}catch{continue}
  for(const envelope of envelopes) {
   const index=inscriptionIndex++;const fields=new Map();let i=0, malformed=false;
   while(i<envelope.payload.length && envelope.payload[i].length) {
    const tag=envelope.payload[i++], value=envelope.payload[i++];
    if(!value || !tag.length || (tag.length>1 && tag.at(-1)===0)){malformed=true;break}
    const key=tag.toString('hex');if(fields.has(key)&&key!=='05'){malformed=true;break}
    fields.set(key,Buffer.concat([fields.get(key)??Buffer.alloc(0),value]));
   }
   if(malformed || fields.get('07')?.toString('utf8')!=='koc1')continue;
   let metadata;try{metadata=decodeCbor(fields.get('05')??Buffer.alloc(0))}catch{continue}
   if(metadata?.p==='koc1'&&metadata.op==='recipe')found.push({txid:tx.txid,index,input,metadata});
  }
 }
 return found;
}
