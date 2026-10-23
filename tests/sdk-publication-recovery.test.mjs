import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as viem from "viem";
const root = path.resolve(import.meta.dirname, "..");
function load(name, dependencies={}) {
  const file=path.join(root,"packages/sdk/src",name),exports={};
  const compiled=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},fileName:file}).outputText;
  vm.runInNewContext(compiled,{exports,require:name=>dependencies[name]??{},URL,URLSearchParams,Headers,Request,Response,fetch,AbortController,setTimeout,clearTimeout,Error,TypeError},{filename:file});return exports;
}
const model=load("studio-publication-failure.ts",{viem});
const {createKeelStudioAgentDraftClient,executeKeelStudioAgentDraftOperation}=load("studio-agent-drafts.ts",{"viem":viem,"./studio-publication-failure.js":model,"./endpoints.js":{KEEL_STUDIO_URL:"https://studio.example"}});
const releaseId="11111111-1111-4111-8111-111111111111",operationId="22222222-2222-4222-8222-222222222222",hash=`0x${"aa".repeat(32)}`;
function diagnostic(){return {schema:"keel-publication-failure@1",releaseId,operationId,releaseRevision:7,artifactId:null,chainId:11155111,walletBatchId:"batch",transactionHashes:[hash],identity:"confirmed",status:"failed",atomicity:"atomic-rollback",receipts:[{transactionHash:hash,blockNumber:"123",blockHash:`0x${"bb".repeat(32)}`,status:"reverted",canonical:true,gasUsed:"100",effectiveGasPrice:null}],calls:[{index:0,kind:"publish",to:`0x${"11".repeat(20)}`,value:"0",selector:"0x12345678",calldataDigest:`0x${"cc".repeat(32)}`,outcome:"unknown",certainty:"unknown",cause:{kind:"unknown",source:"none",errorSelector:null,revertReason:null,panicCode:null},gas:{provided:null,used:null,source:"none",stateGas:"not-established"}}],trace:{status:"unsupported"},paidStorage:{objectIds:[],reuseRequired:true,uploadedBytes:0},recovery:{status:"review-new-attempt",canPrepareNewAttempt:true,sameArtifact:true,mustReusePaidObjects:true,newStoragePaymentRequired:false,missingCallIndexes:[0],nextActions:["prepare-review-new-linked-attempt"]}};}
const command={expectedRevision:7,operationId,walletBatchId:"batch",txHashes:[hash],includeTrace:true};
function response(){return {schema:"keel-publication-reconcile@1",releaseId,revision:7,operationId,status:"failed-recoverable",publicationFailure:diagnostic(),changed:true,signing:"not-performed",submission:"not-performed",uploadedBytes:0};}
test("reconcile umbrella posts exact saved identity and hashes with no wallet payload",async()=>{
  const calls=[];const result=await executeKeelStudioAgentDraftOperation({studioUrl:"https://studio.example",grantToken:"test-token-that-is-synthetic-and-at-least-forty-eight-characters",operation:"reconcile",releaseId,reconciliation:command,fetchImplementation:async(url,init)=>{calls.push({url:String(url),init});return Response.json(response());}});
  assert.equal(result.status,"failed-recoverable");assert.equal(calls.length,1);assert.equal(calls[0].url,`https://studio.example/api/agent/drafts/${releaseId}/reconcile`);assert.equal(calls[0].init.method,"POST");assert.deepEqual(JSON.parse(calls[0].init.body),command);
});
test("diagnose remains read-only and trace opt-in does not become reconciliation",async()=>{
  const calls=[];const client=createKeelStudioAgentDraftClient({grantToken:"test-token-that-is-synthetic-and-at-least-forty-eight-characters",fetchImplementation:async(url,init)=>{calls.push({url:String(url),init});return Response.json({schema:"keel-release-diagnostics@1",releaseId,revision:7,changed:false,signing:"not-performed",submission:"not-performed",uploadedBytes:0,publicationFailure:diagnostic()});}});
  await client.diagnose(releaseId,{includePublicationTrace:true});assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith("/diagnostics?includePublicationTrace=true"));assert.equal(calls[0].init.method,undefined);
});
test("malformed hashes, duplicate hashes and injection fields fail before any HTTP call",async()=>{
  let calls=0;const client=createKeelStudioAgentDraftClient({grantToken:"test-token-that-is-synthetic-and-at-least-forty-eight-characters",fetchImplementation:async()=>{calls++;return Response.json(response());}});
  for(const patch of [{txHashes:["0x123"]},{txHashes:[hash,hash.toUpperCase().replace("0X","0x")]},{calls:[]},{wallet:"0x123"},{expectedRevision:0},{includeTrace:"yes"}]) await assert.rejects(()=>client.reconcile(releaseId,{...command,...patch}));
  assert.equal(calls,0);
});
test("another operation or optimistic recovery without canonical atomic rollback is rejected",async()=>{
  const mutations=[x=>x.operationId=releaseId,x=>x.publicationFailure.receipts[0].canonical=false,x=>x.publicationFailure.status="pending",x=>x.publicationFailure.atomicity="unknown",x=>x.publicationFailure.walletBatchId="another",x=>x.signing="performed",x=>x.publicationFailure.receipts[0].status="success",x=>x.publicationFailure.calls[0].gas.stateGas="depleted"];
  for(const mutate of mutations){const result=response();mutate(result);const client=createKeelStudioAgentDraftClient({grantToken:"test-token-that-is-synthetic-and-at-least-forty-eight-characters",fetchImplementation:async()=>Response.json(result)});await assert.rejects(()=>client.reconcile(releaseId,command));}
});

test("atomic review validates the canonical complete envelope and bounded transaction fields",()=>{
  const wallet=`0x${"11".repeat(20)}`,calls=[{to:`0x${"22".repeat(20)}`,data:"0x12345678",value:"0"}];
  const encoded=viem.encodeAbiParameters([{type:"tuple[]",components:[{name:"target",type:"address"},{name:"value",type:"uint256"},{name:"callData",type:"bytes"}]}],[calls.map(call=>({target:call.to,value:0n,callData:call.data}))]);
  const data=viem.encodeFunctionData({abi:viem.parseAbi(["function execute(bytes32 mode,bytes executionData) payable"]),functionName:"execute",args:[`0x01${"00".repeat(31)}`,encoded]});
  const tx={schema:"keel-release-atomic-transaction@1",type:"eip1559",chainId:11155111,from:wallet,to:wallet,data,value:"0",nonce:"1",gas:"500000",maxFeePerGas:"10",maxPriorityFeePerGas:"1",delegation:`0x${"33".repeat(20)}`,delegationRuntimeHash:`0x${"44".repeat(32)}`,blockNumber:"123",blockHash:`0x${"55".repeat(32)}`,checkedAt:"2026-01-01T00:00:00Z",expiresAt:"2026-01-01T00:01:00Z",simulationFingerprint:`0x${"66".repeat(32)}`};
  assert.equal(model.validateKeelAtomicPublicationTransaction(tx,{chainId:11155111,wallet,calls}),tx);
  for(const patch of [{data:`${data}00`},{to:calls[0].to},{value:"1"},{nonce:"9007199254740992"},{gas:"0"},{maxPriorityFeePerGas:"11"},{expiresAt:"2026-01-01T00:03:00Z"}])assert.throws(()=>model.validateKeelAtomicPublicationTransaction({...tx,...patch},{chainId:11155111,wallet,calls}));
});

test("legacy records with missing saved calls remain structured unknown and cannot authorize a retry",()=>{
  const value=diagnostic();Object.assign(value,{identity:"unverified",status:"unknown",atomicity:"unknown",calls:[],receipts:[]});
  Object.assign(value.recovery,{status:"blocked",canPrepareNewAttempt:false,missingCallIndexes:[],nextActions:["restore-saved-publication-evidence","do-not-resubmit"]});
  assert.equal(model.validateKeelPublicationFailureDiagnostic(value),value);
  assert.throws(()=>model.validateKeelPublicationFailureDiagnostic({...value,recovery:{...value.recovery,canPrepareNewAttempt:true,status:"review-new-attempt"}}));
});
