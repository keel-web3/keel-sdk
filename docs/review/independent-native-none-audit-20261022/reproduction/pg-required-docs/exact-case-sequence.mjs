/** Diagnostic-only finite two-case policy. No terminal condition can be reset. */
import assert from'node:assert/strict';
import{types}from'node:util';
const ordinaryNames=new Set(['TypeError','RangeError','AssertionError','AbortError','TimeoutError','InitialStoragePreflightError','KeelPublicationSimulationError','UpdatedPublicationReviewError','CreatorStorageReviewError']);
const denialText=/(?:\b401\b|\b403\b|unauthorized|forbidden|access.denied|permission.denied|signing.denied|credential|unknown.guard|KEEL_QUALIFICATION_.*DENIED)/iu;
const safeReasons=new Set(['rate-limited','unavailable','wrong-chain','history-unavailable','invalid-response']);
// Fixed fields only. Descriptors never invoke accessors; Proxy objects and
// prototype/graph/budget uncertainty are terminal. No arbitrary Object.values.
function field(object,key){
 let cursor=object;
 for(let depth=0;cursor!==null&&depth<5;depth++){
  if(types.isProxy(cursor))throw Error('proxy');
  const d=Object.getOwnPropertyDescriptor(cursor,key);
  if(d){if(!Object.hasOwn(d,'value'))throw Error('accessor');return d.value;}
  cursor=Object.getPrototypeOf(cursor);
 }
 if(cursor!==null)throw Error('prototype-bound');
 return undefined;
}
const deniedCode=value=>value===401||value===403||value==='401'||value==='403';
export function inspectCaseFailure(error){
 let denial=false,unknown=false,rootName;const seen=new Set();let nodes=0;
 function visit(value,depth,diagnostic=false){
  if(!value||typeof value!=='object'||types.isProxy(value)||depth>6||++nodes>32){unknown=true;return;}
  if(seen.has(value)){unknown=true;return;}seen.add(value);
  const name=field(value,'name');if(depth===0)rootName=name;
  if(!diagnostic&&!ordinaryNames.has(name)&&name!=='AggregateError')unknown=true;
  for(const key of ['name','message','code','reason','kind','failureReason','rpcCode','httpStatus','status','transportFailure']){
   const item=field(value,key);if(item===undefined||item===null)continue;
   if(typeof item==='string'){if(item.length>8192){unknown=true;continue;}if(denialText.test(item))denial=true;}
   else if(typeof item!=='number'||!Number.isFinite(item)){unknown=true;continue;}
   if(['code','rpcCode','httpStatus','status'].includes(key)&&deniedCode(item))denial=true;
   if(key==='failureReason'&&item!=='access-denied'&&!safeReasons.has(item))unknown=true;
  }
  for(const key of ['diagnostic','cause']){const child=field(value,key);if(child!==undefined&&child!==null)visit(child,depth+1,key==='diagnostic');}
  const errors=field(value,'errors');
  if(errors!==undefined){
   if(!Array.isArray(errors)||types.isProxy(errors)){unknown=true;return;}
   const length=field(errors,'length');if(!Number.isInteger(length)||length<1||length>16){unknown=true;return;}
   for(let i=0;i<length;i++){const d=Object.getOwnPropertyDescriptor(errors,String(i));if(!d||!Object.hasOwn(d,'value')){unknown=true;continue;}visit(d.value,depth+1);}
  }
 }
 try{visit(error,0);}catch{unknown=true;}
 return Object.freeze({ordinary:!denial&&!unknown&&ordinaryNames.has(rootName),terminal:denial||unknown||!ordinaryNames.has(rootName),reason:denial?'access-or-guard-denied':unknown?'inspection-unknown':ordinaryNames.has(rootName)?'ordinary-case-failure':'unknown-error'});
}
export function nonSecurityCaseFailure(error){return inspectCaseFailure(error).ordinary;}
export function createTerminalLatch(){
 let terminal=false,reason=null;
 const mark=value=>{if(!terminal){terminal=true;reason=value;}};
 return Object.freeze({
  observeError(error){const result=inspectCaseFailure(error);if(result.terminal)mark(result.reason);return result;},
  observeGuard(snapshot){try{const count=field(snapshot,'denials');if(!Number.isInteger(count)||count<0)mark('guard-unknown');else if(count>0)mark('signing-or-credential-denied');}catch{mark('guard-unknown');}},
  observeResponse(row){try{const status=field(row,'status'),code=field(row,'rpcCode'),kind=field(row,'kind'),denied=field(row,'rpcAccessDenied');if(deniedCode(status)||deniedCode(code)||denied===true||kind==='denied-before-disclosure')mark('provider-or-rpc-denied');}catch{mark('response-unknown');}},
  assertClear(){if(terminal)throw Object.assign(Error('Qualification terminal security latch is set.'),{code:'KEEL_QUALIFICATION_TERMINAL_DENIED',reason});},
  snapshot(){return{terminal,reason};}
 });
}
export async function runExactOwnedCases({runCase,assertContinuationSafe,recordFailure,results,terminalLatch=createTerminalLatch()}){
 assert.ok(Array.isArray(results)&&results.length===0);assert.equal(typeof assertContinuationSafe,'function');
 for(const kind of ['gator','gif']){
  terminalLatch.assertClear();
  try{const result=await runCase(kind);terminalLatch.assertClear();assert.equal(result.kind,kind);assert.equal(result.status,'PASS');results.push(result);}
  catch(error){const classification=terminalLatch.observeError(error);
   const failure=await recordFailure(kind,error);assert.equal(failure.kind,kind);assert.equal(failure.status,'FAIL');results.push(failure);
   // Preservation/security checks still execute for all failed cases. Even a
   // later AbortError or successful observation cannot clear the first latch.
   await assertContinuationSafe(kind,error);terminalLatch.assertClear();if(!classification.ordinary)throw error;
  }
 }
 return{bothPass:results.length===2&&results.every(x=>x.status==='PASS'),results};
}
