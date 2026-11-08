import {parseBlock} from './block.mjs';
// Reducer must authenticate and classify transactions; block parsing alone is not mint verification.
export async function scanBlocks({source,from,to,state,reduceBlock,expectedPrevious,network="testnet4",concurrency=8}) {
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from||typeof reduceBlock!=='function') throw Error('invalid scan parameters');
 const genesis=await source.blockHash(0);
 const expected={testnet4:"00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043",regtest:"0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206"}[network];
 if(!expected || genesis!==expected)throw Error("unsupported or mismatched network");
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>16)throw Error('invalid concurrency');
 let previous=expectedPrevious;
 for(let start=from;start<=to;start+=concurrency) {
  const end=Math.min(to,start+concurrency-1);
  const blocks=await Promise.all(Array.from({length:end-start+1},async(_,i)=>{
   const height=start+i, hash=await source.blockHash(height), block=parseBlock(await source.rawBlock(hash));
   if(block.hash!==hash)throw Error('block hash mismatch');
   return {...block,height};
  }));
  for(const block of blocks){
   if(previous && block.previous!==previous)throw Error('block chain mismatch');
   state=await reduceBlock(state,block); previous=block.hash;
  }
 }
 // Reject a range changed by a reorg during the scan.
 if(await source.blockHash(to)!==previous)throw Error('chain changed during scan');
 return {state,height:to,hash:previous};
}
