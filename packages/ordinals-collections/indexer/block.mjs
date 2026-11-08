import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest(), dsha=b=>sha(sha(b));
export function parseBlock(input) {
 const src=Buffer.from(input); if(src.length<81 || src.length>8*1024*1024) throw Error('invalid block size');
 let p=0; const take=n=>{if(!Number.isSafeInteger(n)||n<0||p+n>src.length) throw Error('truncated block');const v=src.subarray(p,p+n);p+=n;return v};
 const variable=()=>{const n=take(1)[0];if(n<253)return n;if(n===253){const x=take(2).readUInt16LE();if(x<253)throw Error('nonminimal integer');return x}if(n===254){const x=take(4).readUInt32LE();if(x<=65535)throw Error('nonminimal integer');return x}throw Error('integer exceeds block limit')};
 const header=take(80), count=variable(), transactions=[], txids=[];
 if(!count || count>1000000) throw Error('invalid transaction count');
 for(let index=0;index<count;index++) {
  const start=p, version=take(4), witness=src[p]===0 && src[p+1]===1;
  if(witness) take(2);
  const coreStart=p, ni=variable(); if(!ni || ni>100000)throw Error('invalid inputs');
  for(let i=0;i<ni;i++){take(36);take(variable());take(4)}
  const no=variable(); if(no>100000)throw Error('invalid outputs');
  for(let i=0;i<no;i++){take(8);take(variable())}
  const coreEnd=p;
  if(witness) for(let i=0;i<ni;i++){const n=variable();if(n>100000)throw Error('invalid witness count');for(let j=0;j<n;j++)take(variable())}
  const lock=take(4), stripped=Buffer.concat([version,src.subarray(coreStart,coreEnd),lock]), txid=dsha(stripped);
  txids.push(txid);transactions.push({txid:txid.toString('hex'),raw:src.subarray(start,p),txIndex:index});
 }
 if(p!==src.length)throw Error('trailing block bytes');
 let level=txids;
 while(level.length>1){const next=[];for(let i=0;i<level.length;i+=2){if(i+1<level.length && level[i].equals(level[i+1]))throw Error('mutated merkle tree');next.push(dsha(Buffer.concat([level[i],level[i+1]??level[i]])))}level=next}
 if(!level[0].equals(header.subarray(36,68)))throw Error('block merkle mismatch');
 return {hash:dsha(header).reverse().toString('hex'),internalHash:dsha(header).toString('hex'),previous:Buffer.from(header.subarray(4,36)).reverse().toString('hex'),header,transactions};
}
