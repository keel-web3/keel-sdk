import assert from 'node:assert/strict';
import test from 'node:test';
const {createKeelStudioAgentDraftClient, executeKeelStudioAgentDraftOperation}=await import(process.env.KEEL_QA_SDK_DRAFTS_URL ?? 'file:///Users/ravonus/dev/wt/studio-proof-state-cache-20261020/keel-sdk/packages/sdk/dist/studio-agent-drafts.js');
const releaseId='11111111-1111-4111-8111-111111111111';
const projectId='44444444-4444-4444-8444-444444444444';
const wallet=`0x${'33'.repeat(20)}`;
const storage={schema:'keel-release-storage-review@1',releaseId,revision:4,projectId,projectRevision:1,manifestDigest:`0x${'dd'.repeat(32)}`,wallet,reviewPath:`/artifacts/${projectId}?studio=1`,status:'review-funding',message:'Unsigned verified storage review navigation',preflight:{status:'verified',verification:'collector-metadata',approvalDigest:`0x${'55'.repeat(32)}`,planFingerprint:`0x${'66'.repeat(32)}`,expiresAt:'2099-01-01T00:00:00Z'},signing:'not-performed',submission:'not-performed'};
const collection={schema:'keel-release-wallet-review@1',releaseId,revision:4,wallet,preparation:{operationId:'22222222-2222-4222-8222-222222222222',chainId:11155111,calls:[{kind:'fixture',to:wallet,data:'0xab',value:'0'}]},signing:'not-performed',submission:'not-performed'};
for(const operation of ['client.prepareReview','executeKeelStudioAgentDraftOperation']) {
  test(`${operation}: storage response must return actionable unsigned reviewUrl`, async()=>{
    const requests=[];
    const options={studioUrl:'https://studio.invalid',grantToken:'x'.repeat(48),fetchImplementation:async(url,init)=>{requests.push({url:String(url),method:init.method,body:JSON.parse(init.body)});return Response.json(storage);}};
    const result=operation==='client.prepareReview'?await createKeelStudioAgentDraftClient(options).prepareReview(releaseId,4):await executeKeelStudioAgentDraftOperation({...options,operation:'prepare-review',releaseId,expectedRevision:4});
    assert.equal(result.schema,storage.schema);assert.equal(result.reviewUrl,`https://studio.invalid${storage.reviewPath}`);
    assert.equal(result.preparation,undefined);assert.equal(result.signing,'not-performed');assert.equal(result.submission,'not-performed');
    assert.deepEqual(requests,[{url:`https://studio.invalid/api/agent/drafts/${releaseId}/review`,method:'POST',body:{expectedRevision:4}}]);
  });
}
test('current built b524 still accepts the existing collection response and derives owner reviewUrl',async()=>{
 const result=await createKeelStudioAgentDraftClient({studioUrl:'https://studio.invalid',grantToken:'x'.repeat(48),fetchImplementation:async()=>Response.json(collection)}).prepareReview(releaseId,4);
 assert.equal(result.reviewUrl,`https://studio.invalid/studio/releases/${releaseId}/review?operation=${collection.preparation.operationId}&revision=4`);
 assert.deepEqual(result.preparation,collection.preparation);
});

const {readFileSync}=await import('node:fs');
const vm=await import('node:vm');
const appPath=process.env.KEEL_QA_PUBLICATION_REVIEW_APP ?? '/private/tmp/keel-studio-live-flow-integration-20261020/apps/studio/src/server/agent/publication-review-app.ts';
const appSource=readFileSync(appPath,'utf8');
const exactSource=appSource.match(/^function exact\(result\)\{.*\}$/m)?.[0];
const uuidSource=appSource.match(/^const uuid=x=>.*;$/m)?.[0];
assert.ok(exactSource);assert.ok(uuidSource);
function appExact(){const context={URL};vm.createContext(context);vm.runInContext(`const origin='https://studio.invalid';let identity;${uuidSource}\n${exactSource}\nglobalThis.check=exact;`,context);return context.check;}
test('MCP Apps parser must expose the exact storage reviewUrl',()=>{
 const check=appExact();assert.equal(check({structuredContent:{...storage,reviewUrl:`https://studio.invalid${storage.reviewPath}`,permissions:{canPrepareReview:true,canSign:false}}}),`https://studio.invalid${storage.reviewPath}`);
});
test('same actual MCP Apps parser accepts existing collection result and URL',()=>{
 const url=`https://studio.invalid/studio/releases/${releaseId}/review?operation=${collection.preparation.operationId}&revision=4`;
 assert.equal(appExact()({structuredContent:{...collection,reviewUrl:url}}),url);
});
