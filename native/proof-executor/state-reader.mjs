import { createKeelRpcPool, KeelRpcSetupError, normalizeKeelRpcUrl } from '../../packages/sdk/dist/rpc.js';
import { KeelPublicationSimulationError, keelSimulationTransportFailure } from '../../packages/sdk/dist/publication-preflight.js';

// Server-side only. Existing configured paid URLs may be eligible, but credentials
// or index membership alone never authorize disclosure of project address/key reads.
const sharedPools=new Map(), poolsByFetch=new WeakMap(), hash=/^0x[0-9a-f]{64}$/i, address=/^0x[0-9a-f]{40}$/i;
const fail=message=>new KeelPublicationSimulationError('configuration-invalid',message);
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
  let selected=0,closed=false;
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
      const combined=signal?AbortSignal.any([signal,abort.signal]):abort.signal;combined.throwIfAborted();
      let last;
      for(let offset=0;offset<eligible.length;offset++){
        const index=(selected+offset)%eligible.length,pinned=pool.pin(index);
        try{
          if(!qualified.has(index)){
            const header=await pinned.request({method:'eth_getBlockByNumber',params:[tag,false],signal:combined});
            if(header?.hash?.toLowerCase()!==blockHash||header.number!==tag)throw new KeelPublicationSimulationError('chain-reorganized','The state source does not match the selected block.');
            qualified.add(index);
            if(method==='eth_getBlockByNumber'){selected=index;return header;}
          }
          const result=await pinned.request({method,params:p,signal:combined});
          if(method==='eth_getBlockByNumber'&&(result?.hash?.toLowerCase()!==blockHash||result.number!==tag))throw new KeelPublicationSimulationError('chain-reorganized','The selected state block changed.');
          selected=index;return result;
        }catch(error){
          combined.throwIfAborted();
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
    close(){closed=true;abort.abort();},
  };
}
