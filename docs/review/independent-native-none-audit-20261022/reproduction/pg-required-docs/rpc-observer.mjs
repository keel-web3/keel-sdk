/** Diagnostic only. Invoke only around the already guarded fetch. Never grants RPC authority. */
import{createHash}from'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
function safeBlock(x){
 if(typeof x==='string')return /^(?:latest|earliest|pending|safe|finalized|0x[0-9a-f]{1,64})$/u.test(x)?x:null;
 if(!x||typeof x!=='object'||Array.isArray(x)||!Object.keys(x).every(k=>['blockHash','blockNumber','requireCanonical'].includes(k)))return null;
 if(x.requireCanonical!==undefined&&typeof x.requireCanonical!=='boolean')return null;
 if(x.blockHash!==undefined&&(typeof x.blockHash!=='string'||!/^0x[0-9a-f]{64}$/u.test(x.blockHash)))return null;
 if(x.blockNumber!==undefined&&(typeof x.blockNumber!=='string'||!/^0x[0-9a-f]{1,64}$/u.test(x.blockNumber)))return null;
 if(x.blockHash===undefined&&x.blockNumber===undefined)return null;
 return{...(x.blockHash===undefined?{}:{blockHash:x.blockHash}),...(x.blockNumber===undefined?{}:{blockNumber:x.blockNumber}),...(x.requireCanonical===undefined?{}:{requireCanonical:x.requireCanonical})};
}
function block(method,params){const position=({eth_call:1,eth_getCode:1,eth_getBalance:1,eth_getTransactionCount:1,eth_getProof:2,eth_getStorageAt:2,eth_getBlockByNumber:0,eth_getBlockByHash:0})[method];return position===undefined?null:safeBlock(params?.[position]);}
export function observeGuardedRpcFetch(guardedFetch,{maxRows=4096,maxResponseBytes=4*1024*1024,maxResponseReaders=8,readDeadlineMs=2000,onSecurityObservation=()=>{}}={}){
 if(!Number.isInteger(maxRows)||maxRows<1||maxRows>4096||!Number.isInteger(maxResponseBytes)||maxResponseBytes<1||maxResponseBytes>4*1024*1024||!Number.isInteger(maxResponseReaders)||maxResponseReaders<1||maxResponseReaders>8||!Number.isInteger(readDeadlineMs)||readDeadlineMs<1||readDeadlineMs>2000)throw Error('diagnostic_bounds_invalid');
 if(typeof onSecurityObservation!=='function')throw Error('diagnostic_security_callback_invalid');
 const rows=[],pending=new Set();let discarded=0,retainedBytes=0,securityObservationFailed=false,securityObservationIncomplete=false;
 const security=row=>{try{onSecurityObservation(row);}catch{securityObservationFailed=true;}};
 const inspectEnvelope=(body,row)=>{
  let parsed;try{parsed=JSON.parse(body);}catch{securityObservationIncomplete=true;return;}
  const items=Array.isArray(parsed)?parsed:[parsed];if(items.length>1000){securityObservationFailed=true;return;}
  for(const item of items){const error=item?.error;if(!error||typeof error!=='object')continue;
   const code=error.code,denied=code===401||code===403||code==='401'||code==='403'||(typeof error.message==='string'&&error.message.length<=8192&&/(?:unauthorized|forbidden|access.denied|permission.denied)/iu.test(error.message));
   if(denied){row.rpcAccessDenied=true;row.rpcCode=code===401||code==='401'?401:code===403||code==='403'?403:null;security({status:row.status,rpcCode:row.rpcCode,rpcAccessDenied:true});}
  }
 };
 const retain=row=>{const size=Buffer.byteLength(JSON.stringify(row),'utf8')+256;if(rows.length>=maxRows||retainedBytes+size>2*1024*1024){discarded++;return false;}retainedBytes+=size;rows.push(row);return true;};
 async function countResponse(response,row){
  if(pending.size>=maxResponseReaders){securityObservationIncomplete=true;row.responseCount='reader-budget';return;}
  let reader;try{reader=response.clone().body?.getReader();if(!reader){row.responseBytes=0;row.responseCount='complete';return;}}catch{securityObservationIncomplete=true;row.responseCount='clone-unavailable';return;}
  let finish,timer;const deadline=new Promise(resolve=>{finish=resolve;timer=setTimeout(()=>resolve(null),readDeadlineMs);timer.unref?.();});
  try{let bytes=0;const chunks=[];while(true){const part=await Promise.race([reader.read(),deadline]);if(part===null){securityObservationIncomplete=true;row.responseCount='deadline';return;}if(part.done){row.responseBytes=bytes;row.responseCount='complete';inspectEnvelope(Buffer.concat(chunks,bytes).toString('utf8'),row);return;}bytes+=part.value.byteLength;if(bytes>maxResponseBytes){securityObservationIncomplete=true;row.responseCount='byte-budget';return;}chunks.push(Buffer.from(part.value));}}catch{securityObservationIncomplete=true;row.responseCount='read-failed';}finally{clearTimeout(timer);finish(null);try{void reader.cancel().catch(()=>{});}catch{}}
 }
 const fetch=async(resource,init)=>{
  const startedAt=new Date().toISOString(),start=performance.now();
  let response;try{response=await guardedFetch(resource,init);}catch(error){
   // A rejected guard is never fingerprinted, including its target/body.
   if(error?.code!=='KEEL_QUALIFICATION_RPC_DENIED')retain({startedAt,durationMs:performance.now()-start,requestMeasurement:'unavailable',outcome:'fetch-rejected'});else discarded++;
   throw error;
  }
  security({status:response.status});
  if(rows.length>=maxRows){securityObservationIncomplete=true;discarded++;return response;}
  const row={startedAt,durationMs:performance.now()-start,status:response.status,requestMeasurement:'unavailable',responseBytes:null,responseCount:'pending'};
  // The guard's successful return proves its recipient/method/shape checks passed.
  // Strings can be observed without consuming, reconstructing or modifying a body.
  if(typeof init?.body==='string')try{
   const parsed=JSON.parse(init.body),items=Array.isArray(parsed)?parsed:[parsed];
   row.requestMeasurement='exact-string';row.physicalHTTPBodyBytes=Buffer.byteLength(init.body,'utf8');
   row.canonicalRecipientSHA256=sha(new URL(String(resource)).toString());
   row.items=items.map(item=>({method:item.method,semanticSHA256:sha(canonical({method:item.method,params:item.params??[]})),block:block(item.method,item.params)}));
  }catch{row.requestMeasurement='unavailable';}
  if(!retain(row)){securityObservationIncomplete=true;return response;}
  const task=countResponse(response,row);pending.add(task);void task.finally(()=>pending.delete(task));
  return response;
 };
 async function finish(){
  let timer;await Promise.race([Promise.allSettled([...pending]),new Promise(resolve=>{timer=setTimeout(resolve,2000);timer.unref?.();})]);clearTimeout(timer);
  return{schema:'keel.bounded-allowed-rpc-diagnostics@1',publicationChainId:11155111,providerChainNotInferred:true,rows:structuredClone(rows),discarded,retainedBytes,pendingReaders:pending.size,securityObservationFailed,securityObservationIncomplete,maxRows,maxResponseBytes,maxResponseReaders,maxRetainedBytes:2*1024*1024,containsRawParameters:false,containsResponseBody:false,changesRetriesOrProvider:false};
 }
 return{fetch,finish};
}
