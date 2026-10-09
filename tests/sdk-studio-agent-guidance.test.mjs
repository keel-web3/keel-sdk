import assert from 'node:assert/strict';
import test from 'node:test';
import { createKeelStudioAgentDraftClient, parseKeelStudioAgentProgress, KeelStudioAgentError } from '../packages/sdk/dist/studio-agent-drafts.js';
import { createMcpServer } from '../packages/mcp/dist/index.js';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const binding = { ownerId:id(1), projectId:id(2), projectRevision:3, projectManifestDigest:`0x${'aa'.repeat(32)}`, releaseId:id(3), releaseRevision:34, operationId:id(4) };
const action = { kind:'tool', operation:'continue-publication', tool:'keel_release_continue', arguments:{releaseId:id(3), expectedRevision:34, expectedOperationId:id(4), expectedState:binding}, binding, requiredScope:'drafts:write', allowed:true, reason:'Reconcile first', retryable:true, ownerWalletRequired:false };
const progress = { schema:'keel-agent-progress@1', binding, observedAt:'2026-10-09T00:00:00Z', lifecycle:'ready', storage:{totalPlans:1,completedPlans:1,failedPlans:0,recordedJobIds:['10'],fundingReceiptRecorded:true,completedChunks:85,completedOperations:8,evidence:'saved-state-only'}, operation:{id:id(4),revision:34,status:'prepared',transactionHash:null,receiptStatus:null,walletResponseRecorded:false,ownerRejectionRecorded:true,recoveryRecorded:true},publication:'not-established', completedWork:[], blockers:[],nextActions:[action],signing:'not-performed',submission:'not-performed' };
const release = {id:id(3),revision:34,slug:'fixture',agentProgress:progress};
const token='keel_agent_'+ 'x'.repeat(48);
test('SDK refuses cross-object, forged tool/owner paths and inconsistent operation guidance', () => {
  assert.deepEqual(parseKeelStudioAgentProgress(progress),progress);
  for(const change of [p=>p.binding.ownerId='bad',p=>p.nextActions[0].arguments.expectedState.projectRevision++,p=>p.nextActions[0].arguments.releaseId=id(9),p=>p.nextActions[0].tool='send_transaction',p=>p.nextActions[0].ownerWalletRequired=true,p=>p.operation=null,p=>p.nextActions[0].arguments.expectedOperationId=id(9),p=>p.nextActions[0].arguments.expectedRevision=35]) {
    const copy=JSON.parse(JSON.stringify(progress));change(copy);assert.throws(()=>parseKeelStudioAgentProgress(copy));
  }
  const owner=JSON.parse(JSON.stringify(progress));owner.nextActions=[{...action,kind:'owner',operation:'owner-review',tool:null,requiredScope:null,ownerWalletRequired:true,ownerPath:'https://attacker.example'}];assert.throws(()=>parseKeelStudioAgentProgress(owner));
});
test('SDK paginates and forwards exact current state without signing; stale errors retain safe recovery data', async () => {
  const calls=[];let status=200;
  const client=createKeelStudioAgentDraftClient({studioUrl:'https://studio.example',grantToken:token,fetchImplementation:async(url,init)=>{
    calls.push({url:String(url),init}); if(status!==200)return Response.json({error:`failed ${token}`,nextAction:'sign'}, {status});
    if(new URL(url).pathname==='/api/agent/drafts')return Response.json({ownerId:id(1),projects:[],releases:[release],pagination:{limit:7,nextCursor:'next',hasMore:true,order:'created-desc-id-desc',snapshotAt:'2026-10-09T00:00:00Z'}});
    return Response.json(release);
  }});
  assert.equal((await client.list({limit:7,cursor:'old',projectId:id(2)})).pagination.nextCursor,'next');
  assert.equal(new URL(calls[0].url).searchParams.get('cursor'),'old');
  assert.equal(new Headers(calls[0].init.headers).get('x-keel-agent-discovery'),'1');
  await client.read(id(3),binding);assert.deepEqual(JSON.parse(new URL(calls[1].url).searchParams.get('expectedState')),binding);
  assert.equal(new Headers(calls[1].init.headers).get('x-keel-agent-discovery'),'1');
  for(const [code,next] of [[403,'request-scope'],[409,'refresh-status'],[503,'retry']]){status=code;await assert.rejects(client.read(id(3)),e=>e instanceof KeelStudioAgentError&&e.status===code&&e.nextAction===next&&!e.message.includes(token));}
});
test('SDK negotiates default discovery and accepts a complete legacy server response', async () => {
  const calls=[];
  const legacyRelease={id:id(3),revision:34,slug:'fixture'};
  const client=createKeelStudioAgentDraftClient({studioUrl:'https://studio.example',grantToken:token,fetchImplementation:async(url,init)=>{
    calls.push({url:String(url),init});return Response.json(new URL(url).pathname==='/api/agent/drafts'
      ? {projects:Array.from({length:123},(_,n)=>({id:id(n+10)})),releases:[legacyRelease]}:legacyRelease);
  }});
  assert.equal((await client.list()).projects.length,123);assert.equal((await client.read(id(3))).agentProgress,undefined);
  assert.ok(calls.every(call=>new Headers(call.init.headers).get('x-keel-agent-discovery')==='1'));
  assert.ok(calls.every(call=>new URL(call.url).search===''));
});
test('portable MCP advertises pagination/bindings/read-review and follows returned continuation arguments', async () => {
  const previous={fetch:globalThis.fetch,token:process.env.KEEL_STUDIO_AGENT_TOKEN,url:process.env.KEEL_STUDIO_URL};const calls=[];let fail=false;
  process.env.KEEL_STUDIO_AGENT_TOKEN=token;process.env.KEEL_STUDIO_URL='https://studio.example';
  globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});if(fail)return Response.json({error:`stale ${token}`},{status:409});if(String(url).includes('/continue'))return Response.json({schema:'keel-release-continuation@1',releaseId:id(3),revision:34,status:'pending',nextAction:'retry-saved-progress',reviewPath:`/studio/releases/${id(3)}`,message:'Pending canonical check',storagePreserved:true,uploadedBytes:0,signing:'not-performed',submission:'not-performed',agentProgress:progress});return Response.json(release);};
  try{const server=await createMcpServer();await server.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'guidance-test',version:'1'}}});
    const tool=(await server.handle({jsonrpc:'2.0',id:2,method:'tools/list'})).result.tools.find(t=>t.name==='keel-studio-draft');
    for(const key of ['limit','cursor','expectedState','expectedOperationId'])assert.ok(tool.inputSchema.properties[key]);assert.ok(tool.inputSchema.properties.operation.enum.includes('read-review'));assert.match(tool.description,/pending outcomes cannot unlock/);
    const call=args=>server.handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'keel-studio-draft',arguments:args}});
    const saved=(await call({operation:'read',releaseId:id(3)})).result.structuredContent;
    const next=saved.agentProgress.nextActions[0];const outcome=(await call({operation:next.operation,...next.arguments})).result.structuredContent;
    assert.equal(outcome.status,'pending');assert.deepEqual(JSON.parse(calls[1].init.body),{expectedRevision:34,expectedOperationId:id(4),expectedState:binding});
    fail=true;const error=(await call({operation:'read',releaseId:id(3)})).result;assert.equal(error.isError,true);assert.equal(error.structuredContent.nextAction,'refresh-status');assert.equal(error.structuredContent.code,'stale-state');assert.ok(!JSON.stringify(error).includes(token));
  }finally{globalThis.fetch=previous.fetch;for(const [key,value]of [['KEEL_STUDIO_AGENT_TOKEN',previous.token],['KEEL_STUDIO_URL',previous.url]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
test('read-review sends the exact saved operation and rejects an operation substituted in the response', async () => {
  let returned=id(9);const calls=[];
  const client=createKeelStudioAgentDraftClient({studioUrl:'https://studio.example',grantToken:token,fetchImplementation:async(url,init)=>{calls.push({url:String(url),init});return Response.json({schema:'keel-release-wallet-review@1',releaseId:id(3),revision:34,wallet:`0x${'11'.repeat(20)}`,preparation:{operationId:returned,chainId:11155111,calls:[{kind:'fixture',to:`0x${'22'.repeat(20)}`,data:'0xab',value:'0'}]},signing:'not-performed',submission:'not-performed'});}});
  await assert.rejects(client.readReview(id(3),34,id(4),binding),/invalid wallet-review identity/);
  returned=id(4);const ready=await client.readReview(id(3),34,id(4),binding);assert.match(ready.reviewUrl,/operation=00000000-0000-4000-8000-000000000004&revision=34$/);
  assert.equal(calls[1].init.method,undefined);assert.deepEqual(JSON.parse(new URL(calls[1].url).searchParams.get('expectedState')),binding);
});
