/** Offline review of a consumed qualification. Never executes a program or makes RPCs. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validatePlan,validateCapture,executionIdentity,sourceCalls} from '/Users/ravonus/dev/wt/studio-publication-20261019/keel-site/docs/reviews/studio-publication-20261019/release/production-proof-factory/current-cache/identity.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const pipeline='/private/tmp/keel-gator-final-cache-one-shot-evidence-20261020';
const operator='/private/tmp/keel-current-cache-be5ffe-execute01-20261020';
const captureRoot='/private/tmp/keel-private-gator-cache-pipeline-20261020-02';
const late='/private/tmp/keel-gator-final-cache-late-review-20261020';
const checked=[];
async function pinned(path,expected){const b=await readFile(path);assert.equal(sha(b),expected);checked.push({path,bytes:b.length,sha256:sha(b)});return b;}
const config=JSON.parse(await pinned('/private/tmp/keel-gator-final-cache-pipeline-config-20261020/config.json','6eb1981d981fa0f18e6e58cba578d903157b79468ef76fd04e469f25c30cdc87'));
for(const row of config.sources){const b=await pinned(row.path,row.sha256);assert.equal(b.length,row.bytes);}
assert.equal(config.sources.length,54);
const result=await json(pipeline+'/result.json');
assert.equal(result.status,'COMPLETED_REQUIRES_INDEPENDENT_AUDIT');
assert.equal(result.configSHA256,'6eb1981d981fa0f18e6e58cba578d903157b79468ef76fd04e469f25c30cdc87');
assert.deepEqual(result.steps.map(s=>[s.name,s.exitCode]),[['normal-assembly',0],['qa-pure-audit',0],['exact-plan',0],['reviewed-predicate',0],['actual-native',0]]);
assert.equal(result.signing,false);assert.equal(result.submission,false);assert.equal(result.productionActivated,false);
const planBytes=await pinned(captureRoot+'/program-final.json','d6c14c345422206c83c2c2d48ca481a6ec8c1f9c4b9a1d6080bbf8bfa6e650eb');
const plan=JSON.parse(planBytes);validatePlan(plan);
const captureBytes=await pinned(captureRoot+'/normal.capture.json','8e1083ed3d1963c151bf12c94fc1672d01f241de4c0fd11f901c69bb23a37949');
const {capture,input}=validateCapture(captureBytes,plan);
assert.equal(sourceCalls(input).length,34);assert.equal(input.preparationCalls.length,30);
assert.equal(sourceCalls(input).reduce((sum,c)=>sum+(c.data.length-2)/2,0),937384);
const uri=Buffer.from(input.expectedTokenURI);assert.equal(uri.length,1026069);assert.equal(sha(uri),'ed0283c5db3680cc2b78d28ea1efb307cc87fe962784c8bb70acdd2bc7dd5fad');
assert.equal(input.expectedTokenURI.startsWith('data:application/json;charset=utf-8,'),true);
const metadata=JSON.parse(decodeURIComponent(input.expectedTokenURI.split(',').slice(1).join(',')));
assert.equal(metadata.image.startsWith('data:image/png;base64,'),true);
const png=Buffer.from(metadata.image.split(',')[1],'base64');assert.equal(png.length,5801);assert.equal(sha(png),'884f889b56e371694e58e79e781568691448c3a0bac2ee23588cb04ae2a83ab7');
assert.equal(metadata.animation_url.startsWith('data:text/html;charset=utf-8,'),true);
const animation=Buffer.from(decodeURIComponent(metadata.animation_url.split(',').slice(1).join(',')));
const producer=JSON.parse(await pinned(captureRoot+'/normal.receipt.json','3ce3741e7673847d5ea110368db181f3ff2e03de3fa52476616e3dc9f858d3e4'));
const qa=JSON.parse(await pinned('/private/tmp/keel-qa-gator-cache-admission-b524-20261020/pipeline-audit/capture-audit.json','52594538d4d9e321162670769c1eaedca8825d64827b00eac7ea7185cafe418c'));
assert.equal(qa.result,'PASS_STATIC_CAPTURE_EQUIVALENCE_ONLY');assert.deepEqual(qa.failures,[]);assert.deepEqual(qa.comparison.forbiddenInputDifferencePaths,[]);
assert.deepEqual(qa.input.resources,[{slot:1,mediaType:'image/png',bytes:5801,sha256:'884f889b56e371694e58e79e781568691448c3a0bac2ee23588cb04ae2a83ab7'},{slot:2,mediaType:'text/html',bytes:530981,sha256:'9761586c1f904925743521d3cba30e4c32f591ebb8f017864e2f34427a02bff1'}]);
assert.equal(producer.productionWrites,0);assert.equal(producer.fullProgramExecuted,false);assert.equal(producer.credentialDirectoryAbsentBeforeAndAfter,true);
const programReview=await pinned(late+'/program-review.json','917d3e204ad5eac332b35ed4d12f687c70fc571c4300769fda19385a1acb9614');
const hostReview=await pinned(late+'/host-review.json','283389315c72826fd255fdcd48a4ea9bf409a6bb938992201cbd1304c4d3cad6');
const commands=await pinned(late+'/admitted-commands.json','77e7ecccc947623669555be2de71327082d5fad6f9d900a3bcb181a7cb244635');
assert.equal(sha(await readFile(operator+'/admitted-commands.json')),sha(commands));
const actual=await json(operator+'/08-one-gator-native-execute.stdout');
const durable=await json(operator+'/09-actual-durable-native-receipt.stdout');
assert.deepEqual(actual,durable.record);
const durableBytes=Buffer.from(JSON.stringify(durable.record,null,2)+'\n');assert.equal(durableBytes.length,121484);assert.equal(durable.bytes,durableBytes.length);assert.equal(durable.sha256,sha(durableBytes));assert.equal(durable.sha256,'b39fd4207da5ae9462f935f362156aa337ea970cb505e1bd9ec9ea454dce1d6e');
assert.equal(actual.result,'PASS');assert.equal(actual.phase,'actual-shipped-public-factory');assert.equal(actual.clientExitCode,0);assert.equal(actual.applicationMutation,false);assert.equal(actual.databaseMutation,false);assert.equal(actual.signing,'not-performed');assert.equal(actual.submission,'not-performed');
assert.equal(actual.operatorSha256,'fd543fe16ff36e66a491b69d0f70da5f589a87f1c2e7407612f136f91cc15a63');assert.equal(actual.planSha256,'98334426551da7eb18308258e1278abf86b49813770ca0b30248aee1b0de439e');
assert.equal(actual.images.client,plan.clientImageId);assert.equal(actual.images.runner,plan.native.imageId);
assert.deepEqual(actual.originalBefore,actual.originalAfter);assert.equal(actual.originalBefore.running,true);assert.equal(actual.originalBefore.workerPaused,true);
for(const phase of ['01-original-before-normal-health','02-original-before-late-inputs','04-original-before-preflight','06-original-before-one-native']){const j=await json(operator+'/'+phase+'.stdout');assert.equal(j.result,'PASS');assert.equal(j.configSha256,'9543c71f9f506e5243c9a74a3d70007ab6919c9f4eb76c0fec8ad7cdb40a77eb');assert.equal(j.hostConfigSha256,'9ebb974a9d71321d58a0bb74a528d089a6a4337a54328460a9768ff260e56467');assert.equal(j.health,'healthy');assert.equal(j.running,true);assert.equal(j.pausedWorker,true);assert.equal(j.mutations,0);}
for(const phase of ['health-00','health-01','health-02']){const j=await json(operator+'/'+phase+'.stdout');assert.equal(j.status,200);assert.equal(j.sha256,'e089a4f800ea8a7e9b45fb2039b50614e6519a71017523a1c19e59624afbbd15');}
const wrapper=(await readFile(pipeline+'/4.stdout','utf8')).trim().split('\n').map(s=>JSON.parse(s));
const ended=wrapper.at(-1);assert.equal(ended.phase,'normal-health-window-ended');assert.equal(ended.stopped,true);assert.equal(ended.failed,false);assert.equal(wrapper.at(-2).receiptSHA256,durable.sha256);
for(const role of ['client','runner']){assert.equal(actual.cleanup[role].state,'stopped');assert.equal(actual.cleanup[role].retained,true);}
const f=actual.factory,p=f.proof;
assert.equal(f.status,'qualified-public-sdk-factory-program');assert.equal(f.planSha256,sha(planBytes));assert.equal(f.captureSha256,sha(captureBytes));assert.equal(f.inputSdkSha256,plan.sdkInputSha256);assert.equal(f.callIdentitySha256,executionIdentity(input));assert.deepEqual(f.canonicalBlock,plan.canonicalBlock);assert.deepEqual(f.native,plan.native);assert.deepEqual(f.sourceAttempts,[]);
assert.equal(f.sdkCommit,'b524bf5fc19939c7523aada2e53f79e3360970ea');assert.equal(f.qualificationOnly,true);assert.equal(f.productionUIProof,false);assert.equal(f.walletBoundaryProven,false);assert.equal(f.signing,'not-performed');assert.equal(f.submission,'not-performed');
assert.equal(p.schema,'keel-publication-simulation@1');assert.equal(p.planFingerprint,input.planFingerprint);assert.equal(p.chainId,11155111);assert.equal(p.blockHash,plan.canonicalBlock.hash);assert.equal(p.blockNumber,plan.canonicalBlock.number);assert.equal(p.completeTokenUriBytes,uri.length);assert.equal(p.metadataDigest,'0x'+sha(uri));assert.equal(p.simulatedCalls,34);assert.equal(p.validatedTransactionCalls,30);assert.equal(p.requiredReaderChecks,2);assert.equal(p.requiredReaderProofs.length,2);assert.equal(p.transactionGasLimits.length,30);assert.equal(p.transactionGasUsed.length,30);assert.equal(p.callGasUsed.length,34);assert.equal(p.signing,'not-performed');assert.equal(p.submission,'not-performed');assert.equal(p.state,'ephemeral-simulation');assert.deepEqual(p.readBoundaryAttempts,[]);assert.deepEqual(p.discoveryGas.capacityAttempts,[]);assert.equal(p.mintEligibilityVerified,false);
assert.equal(f.nativeExecutions.length,3);
for(const e of f.nativeExecutions){assert.equal(e.schema,'keel-proof-executor-evidence@1');assert.equal(e.binarySha256,plan.native.executorSha256);assert.equal(e.gethCommit,'a579077007b98217c3e253a66e4b452ca0c32b96');assert.equal(e.blockHash,plan.canonicalBlock.hash);assert.equal(e.chainId,11155111);assert.equal(e.gasBudget,plan.limits.gasBudget);assert.equal(e.signing,'not-performed');assert.equal(e.submission,'not-performed');assert.equal(e.state,'ephemeral-proof-backed');assert.equal(e.baseStateRoot,f.nativeExecutions[0].baseStateRoot);assert.match(e.baseStateRoot,/^0x[0-9a-f]{64}$/);assert.notEqual(e.baseStateRoot,'0x'+'0'.repeat(64));assert.ok(e.nativeWallTimeMs<180000);assert.ok(e.witnessBytes<=plan.limits.witnessBytes);assert.ok(e.responseBytes<=plan.limits.responseBytes);assert.ok(e.readRequests<=plan.limits.requests);}
assert.equal(f.physicalStateRequests.length,371);
const methodCounts={};let totalBodyBytes=0,maxBodyBytes=0;
for(const row of f.physicalStateRequests){assert.equal(row.status,200);assert.ok(['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_getProof'].includes(row.method));methodCounts[row.method]=(methodCounts[row.method]??0)+1;totalBodyBytes+=row.physicalHTTPBodyBytes;maxBodyBytes=Math.max(maxBodyBytes,row.physicalHTTPBodyBytes);}
assert.deepEqual(methodCounts,{eth_chainId:6,eth_getBlockByNumber:9,eth_getCode:27,eth_getProof:329});assert.equal(totalBodyBytes,94752);assert.equal(maxBodyBytes,284);
assert.equal(f.logicalSdkRequests.filter(x=>x.method==='eth_simulateV1').length,3);
const summary={schema:'keel-independent-consumed-gator-qualification-audit@1',checkedAt:new Date().toISOString(),result:'ACCEPT_EXACT_ISOLATED_NATIVE_QUALIFICATION_ONLY',reviewer:'cache-release-independent-reviewer',blockingFindings:[],sourceClosureFiles:54,allSourceHashesUnchanged:true,configSHA256:result.configSHA256,clientImageId:actual.images.client,nativeImageId:actual.images.runner,sdkCommit:f.sdkCommit,capture:{bytes:captureBytes.length,sha256:sha(captureBytes)},planSHA256:sha(planBytes),durable:{bytes:durable.bytes,sha256:durable.sha256,recordEqualsActualStdout:true,rawDigestIndependentlyRecomputed:true},originalBinding:{artifactId:capture.artifactId,artifactRevision:capture.artifactRevision,releaseId:capture.releaseId,releaseRevision:capture.releaseRevision},calls:34,preparationCalls:30,calldataBytes:937384,tokenURI:{bytes:uri.length,sha256:sha(uri),decodedMetadata:true,imageBytes:png.length,imageSHA256:sha(png),animationBytes:animation.length,animationSHA256:sha(animation)},physical:{requests:371,status200:371,methodCounts,totalBodyBytes,maxBodyBytes},nativeExecutions:f.nativeExecutions.map(e=>({wallTimeMs:e.nativeWallTimeMs,processCPUMicroseconds:e.processCPUMicroseconds,readRequests:e.readRequests,witnessBytes:e.witnessBytes,responseBytes:e.responseBytes,requestSHA256:e.requestSha256})),proof:{validatedTransactionCalls:p.validatedTransactionCalls,simulatedCalls:p.simulatedCalls,requiredReaderProofs:p.requiredReaderProofs.length,completeTokenURIHashMatches:true,allThreeAuthenticatedStateRootsAgree:true,SDKStartAndFinishCanonicalAnd180SecondFreshnessChecksUnchanged:true,sourceAttempts:0,readBoundaryAttempts:0,capacityAttempts:0},pipelineSeconds:result.seconds,health:{successfulChecks:3,stopped:true,failed:false},originalContainerUnchanged:true,ownedClientAndRunnerStoppedAndRetained:true,signing:false,submission:false,productionActivated:false,remainingGates:['deployed Studio UI and exact compiled app release acceptance','authenticated historical HTTP 200, decoded tokenURI, canonical shell and canvas evidence','correct Gator owner wallet authority and explicit human signing boundary'],limits:'Actual default public factory; no limits, clock, calldata, fee, sender or gas override supplied by driver',scopeLimits:['Offline post-run audit only; no program replay or RPC by reviewer','Native proof qualifies the exact isolated SDK factory run, not deployed Studio operation','Producer assembly derived current gas and fees using unchanged normal compiler; old and fresh inputs are not byte-identical','All prior failed artifacts and consumed runs remain preserved'],evidence:checked.map(row=>({path:row.path,bytes:row.bytes,sha256:row.sha256}))};
await writeFile(new URL('final-gator-postrun-audit.json',import.meta.url),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:summary.result,durable:summary.durable,physical:summary.physical,calls:34,tokenURISHA256:sha(uri),health:summary.health,remainingGates:summary.remainingGates}));
