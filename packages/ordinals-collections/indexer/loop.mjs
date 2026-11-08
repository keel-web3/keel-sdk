import {parseBlock} from './block.mjs';
// The host chooses the best chain. Offline mode replays a captured snapshot only.
export async function scanBlocks({source,from,to,state,reduceBlock,expectedPrevious,network='testnet4',concurrency=2,cache,offline=false}) {
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from||typeof reduceBlock!=='function')throw Error('invalid scan parameters');
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>2)throw Error('invalid concurrency');
 if(offline&&!cache)throw Error('offline scan requires cache');
 const expected={testnet4:'00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',regtest:'0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206'}[network];
 if(!expected)throw Error('unsupported network');
 let hashes=offline?await cache.getRange(network,from,to):new Array(to-from+1);
 if(!hashes)throw Error('cached range missing');
 const memory=new Map();let memoryBytes=0;
 async function readBlock(hash,allowFetch){
  let raw=cache?await cache.getBlock(hash):memory.get(hash);
  if(!raw){
   if(!allowFetch)throw Error('cached block missing');
   raw=await source.rawBlock(hash);
   const block=parseBlock(raw);if(block.hash!==hash)throw Error('block hash mismatch');
   if(cache)await cache.putBlock(hash,raw);
   else {memoryBytes+=raw.length;if(memoryBytes>256*1024*1024)throw Error('scan requires a disk cache');memory.set(hash,raw)}
   return block;
  }
  const block=parseBlock(raw);if(block.hash!==hash)throw Error('block hash mismatch');return block;
 }
 if(!offline){
  if(await source.blockHash(0)!==expected)throw Error('unsupported or mismatched network');
  let hash=await source.blockHash(to);
  for(let height=to;height>=from;height--){
   hashes[height-from]=hash;
   const block=await readBlock(hash,true);hash=block.previous;
  }
  if(from===0 && hashes[0]!==expected)throw Error('genesis mismatch');
  if(expectedPrevious && hash!==expectedPrevious)throw Error('block chain mismatch');
  if(await source.blockHash(to)!==hashes.at(-1))throw Error('chain changed during scan');
 }
 let previous=expectedPrevious;
 for(let height=from;height<=to;height++){
  const block=await readBlock(hashes[height-from],false);
  if(previous && block.previous!==previous)throw Error('block chain mismatch');
  state=await reduceBlock(state,{...block,height});previous=block.hash;
 }
 if(cache&&!offline)await cache.putRange(network,from,to,hashes);
 return {state,height:to,hash:previous};
}
