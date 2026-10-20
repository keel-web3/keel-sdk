import { createKeelRpcPool, KeelRpcSetupError, normalizeKeelRpcUrl } from '../../packages/sdk/dist/rpc.js';
import { KeelPublicationSimulationError, keelSimulationTransportFailure } from '../../packages/sdk/dist/publication-preflight.js';

// Server-side only. Existing configured paid URLs may be eligible, but credentials
// or index membership alone never authorize disclosure of project address/key reads.
const sharedPools=new Map(), poolsByFetch=new WeakMap(), hash=/^0x[0-9a-f]{64}$/i, address=/^0x[0-9a-f]{40}$/i;
const fail=message=>new KeelPublicationSimulationError('configuration-invalid',message);
const maximumCacheBytes=8*1024*1024,maximumCacheEntries=1024,bytes=/^0x(?:[0-9a-f]{2})*$/i;
function cacheable(method,params,result) {
  if(method==='eth_getCode')return typeof result==='string'&&bytes.test(result);
  if(method!=='eth_getProof'||!result||typeof result!=='object'||Array.isArray(result)||typeof result.address!=='string'||result.address.toLowerCase()!==params[0].toLowerCase())return false;
  const nodes=value=>Array.isArray(value)&&value.every(item=>typeof item==='string'&&bytes.test(item));
  return nodes(result.accountProof)&&result.accountProof.length>0&&Array.isArray(result.storageProof)&&result.storageProof.length===params[1].length
    &&result.storageProof.every(item=>item&&typeof item==='object'&&!Array.isArray(item)&&nodes(item.proof));
}
export function createApprovedProofStateReader({rpcUrls,approvedStateRpcUrls,block,fetchImpl,minIntervalMs=250,onAttempt}) {
  const configured=[...new Set(rpcUrls.map(url=>normalizeKeelRpcUrl(url)))];
  const approved=new Set(approvedStateRpcUrls.map(url=>normalizeKeelRpcUrl(url)));
  if([...approved].some(url=>!configured.includes(url))||typeof block.number!=='bigint'||block.number<0n||!hash.test(block.hash))throw fail('State reads require explicit configured recipients and a pinned block.');
  const eligible=configured.filter(url=>approved.has(url));
  if(!eligible.length)throw fail('No configured recipient is approved for project address and storage-key reads.');
  const key=JSON.stringify([eligible,minIntervalMs]);
  const cache=fetchImpl?(poolsByFetch.get(fetchImpl)??new Map()):sharedPools;
  if(fetchImpl)poolsByFetch.set(fetchImpl,cache);
  const pool=cache.get(key)??createKeelRpcPool({rpcUrls:eligible,chainId:11155111,timeoutMs:15000,maxResponseBytes:2*1024*1024,minIntervalMs,...(fetchImpl?{fetchImpl}:{})});
  cache.set(key,pool);if(cache.size>16)cache.delete(cache.keys().next().value);
  const abort=new AbortController(),blockHash=block.hash.toLowerCase(),tag=`0x${block.number.toString(16)}`,qualified=new Set();
  // Immutable EIP-1898 responses belong only to this approved reader instance.
  // Native execution still verifies every reused proof/code against its base root.
  const reads=new Map();let cachedBytes=0,cacheEpoch=0,terminalFailure;
  let selected=0,closed=false;
  const invalidate=()=>{reads.clear();cachedBytes=0;cacheEpoch++;};
  const available=(signal,index)=>{
    signal.throwIfAborted();if(terminalFailure)throw terminalFailure;
    if(index!==undefined){const state=pool.status()[index];if(state?.disabled&&state.reason==='access-denied')throw new KeelRpcSetupError('access-denied',pool.status());}
  };
  function remember(key,result,index,epoch) {
    if(epoch!==cacheEpoch||!key)return;
    const size=Buffer.byteLength(key,'utf8')+Buffer.byteLength(JSON.stringify(result),'utf8');
    if(size>maximumCacheBytes)return;
    const value=structuredClone(result),prior=reads.get(key);
    if(prior){cachedBytes-=prior.bytes;reads.delete(key);}
    while(reads.size>=maximumCacheEntries||cachedBytes+size>maximumCacheBytes){
      const oldest=reads.keys().next().value;cachedBytes-=reads.get(oldest).bytes;reads.delete(oldest);
    }
    reads.set(key,{value,index,bytes:size});cachedBytes+=size;
  }
  function validate(method,p) {
    if(method==='eth_chainId'&&p.length===0)return;
    if(method==='eth_getBlockByNumber'&&p.length===2&&p[0]===tag&&p[1]===false)return;
    if(method==='eth_getBlockByHash'&&p.length===2&&hash.test(p[0])&&p[1]===false)return;
    if(method==='eth_getProof'||method==='eth_getCode'){
      const proof=method==='eth_getProof',anchor=p[proof?2:1];
      if(p.length===(proof?3:2)&&address.test(p[0])&&anchor&&typeof anchor==='object'&&Object.keys(anchor).length===2&&anchor.blockHash?.toLowerCase()===blockHash&&anchor.requireCanonical===true
        &&(!proof||Array.isArray(p[1])&&p[1].length<=1&&p[1].every(k=>hash.test(k))))return;
    }
    throw fail('The proof source refuses execution, submission, unpinned or unbounded reads.');
  }
  return {
    async request({method,params=[],signal}){
      if(closed)throw fail('The proof source was closed.');
      const p=structuredClone(params);validate(method,p);
      const combined=signal?AbortSignal.any([signal,abort.signal]):abort.signal;available(combined);
      const cacheKey=['eth_getProof','eth_getCode'].includes(method)?JSON.stringify([method,p[0].toLowerCase(),method==='eth_getProof'?p[1].map(value=>value.toLowerCase()):[],blockHash]):undefined;
      const epoch=cacheEpoch;
      let last;
      for(let offset=0;offset<eligible.length;offset++){
        const index=(selected+offset)%eligible.length,pinned=pool.pin(index);
        try{
          available(combined,index);
          const state=pool.status()[index];
          if(!qualified.has(index)){
            const header=await pinned.request({method:'eth_getBlockByNumber',params:[tag,false],signal:combined});available(combined,index);
            if(header?.hash?.toLowerCase()!==blockHash||header.number!==tag)throw new KeelPublicationSimulationError('chain-reorganized','The state source does not match the selected block.');
            qualified.add(index);
            if(method==='eth_getBlockByNumber'){selected=index;return header;}
          }
          const retained=cacheKey&&reads.get(cacheKey);
          if(retained?.index===index&&!state?.disabled){available(combined,index);return structuredClone(retained.value);}
          const result=await pinned.request({method,params:p,signal:combined});available(combined,index);
          // Some EIP-1898 providers return null for an unknown/pruned hash.
          // Missing pinned state is terminal, never an empty value or permission
          // to ask another recipient for a replacement snapshot.
          if(result===null||result===undefined)throw new KeelPublicationSimulationError('rpc-unavailable','The selected state block or proof is unavailable.');
          if(method==='eth_getBlockByNumber'&&(result?.hash?.toLowerCase()!==blockHash||result.number!==tag))throw new KeelPublicationSimulationError('chain-reorganized','The selected state block changed.');
          selected=index;
          if(cacheKey&&cacheable(method,p,result)){remember(cacheKey,result,index,epoch);return structuredClone(result);}
          return result;
        }catch(error){
          invalidate();
          if(error?.reason==='access-denied'||error instanceof KeelPublicationSimulationError&&error.kind==='chain-reorganized')terminalFailure??=keelSimulationTransportFailure(error);
          available(combined);
          // Never retry an invalid proof, transaction, request or reorg against
          // another provider. Only source availability/capability can select an
          // already-approved alternative. The pool retains cooldowns/restrictions.
          if(!(error instanceof KeelRpcSetupError)&&error?.code!==-32601)throw keelSimulationTransportFailure(error);
          last=keelSimulationTransportFailure(error);qualified.delete(index);
          try{onAttempt?.({candidateIndex:index,...last.diagnostic});}catch{/* Observers cannot alter a read. */}
        }
      }
      throw last??fail('Approved state sources are unavailable.');
    },
    status(){return pool.status().map(({checkedChainId,reason,retryAfterMs,disabled},candidateIndex)=>({candidateIndex,checkedChainId,reason,retryAfterMs,disabled}));},
    close(){closed=true;invalidate();abort.abort();},
  };
}
