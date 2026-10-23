#!/usr/bin/env node
// Mandatory real native execution against synthetic proved state. No live RPC.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {keccak256,encodeAbiParameters,fromRlp} from 'viem';
import {createCapturedNativeWitnessResolver} from './lib/native-witness-resolver.mjs';
import {createCanonicalNativeProcessFactory} from './lib/native-session-process.mjs';
import {normalizeAssemblyCapture,encodeCapturedHeader,sha256,stable,REQUIRED_CASES,verifyWitness} from './lib/captured-publication-fixture.mjs';
const args=process.argv.slice(2),opts={};
for(let i=0;i<args.length;i+=2){assert.ok(['--native-build','--fixtures','--output'].includes(args[i])&&!opts[args[i]]&&isAbsolute(args[i+1]??''));opts[args[i]]=args[i+1];}
assert.equal(Object.keys(opts).length,3);
const root=opts['--output'],fixture=opts['--fixtures'],native=opts['--native-build'];mkdirSync(root,{mode:0o700});
const buildReceipt=JSON.parse(readFileSync(join(native,'build-receipt.json'))),binaryPath=join(native,'keel-sparse');
assert.equal(sha256(readFileSync(binaryPath)),buildReceipt.binarySHA256);
assert.equal(sha256(readFileSync('scripts/native/canonical-state-engine/source-manifest.json')),buildReceipt.sourceManifestSHA256);
const fixtureReceipt=JSON.parse(readFileSync(join(fixture,'fixture-receipt.json')));assert.equal(fixtureReceipt.binarySHA256,buildReceipt.binarySHA256);
for(const [name,value]of Object.entries(fixtureReceipt.files)){const bytes=readFileSync(join(fixture,name));assert.equal(bytes.length,value.bytes);assert.equal(sha256(bytes),value.sha256);}
const input=JSON.parse(readFileSync(join(fixture,'input.json'))),header=JSON.parse(readFileSync(join(fixture,'input.json.header.json')));
const originalProgram=JSON.parse(readFileSync(join(fixture,'program.json'))),manifest=JSON.parse(readFileSync(join(fixture,'manifest.json')));
const calls=originalProgram.blockStateCalls.map(b=>b.calls[0]),reader=calls[0].to;
const {nonce:_a,...readCall}=calls[45],{nonce:_b,...metadataCall}=calls[46];
const planned={chainId:11155111,blockNumber:{$keelDiagnosticBigInt:BigInt(header.number).toString()},preparationCalls:calls.slice(0,45),
 requiredReaderCalls:[{call:readCall,expectedReturn:encodeAbiParameters([{type:'uint256'}],[87n]),gasMargin:{$keelDiagnosticBigInt:'10000'}}],metadataCall,
 expectedTokenURI:manifest.expectedURI,reader,readerRuntimeCodeHash:manifest.runtimeHash};
const raw={schema:'keel-private-full-plan-diagnostic@1',status:'exact-input-captured-no-simulation',assemblyOnly:true,databaseReadOnlyVerified:true,approval:false,signing:'not-performed',submission:'not-performed',expectedCaptureHalt:true,synthetic:true,
 source:{siteCommit:'1'.repeat(40),sdkCommit:'2'.repeat(40)},scope:{...REQUIRED_CASES['retro-45'],artifactRevision:2,blockNumber:header.number,blockHash:header.hash},canonicalBefore:header,canonicalAfterAssembly:structuredClone(header),exactSimulationInput:planned,completeInputSHA256:sha256(JSON.stringify(planned)),preparationCallCount:45,completeUnallocatedCallCount:47,completeExpectedTokenURI:manifest.expectedURI,completeTokenURIBytes:Buffer.byteLength(manifest.expectedURI),completeTokenURIKeccak256:keccak256('0x'+Buffer.from(manifest.expectedURI).toString('hex'))};
const capture=normalizeAssemblyCapture(raw),captureBytes=Buffer.from(JSON.stringify(raw)),clock=Number(BigInt(header.timestamp))*1000;
const seed={schema:'keel-private-fresh-retro-seeds@1',captureSHA256:sha256(captureBytes),captureObjectSHA256:sha256(stable(raw)),completeInputSHA256:raw.completeInputSHA256,sourceFingerprint:sha256(stable({identity:capture.identity,source:capture.source,completeInputSHA256:raw.completeInputSHA256})),
 pin:{number:header.number,hash:header.hash,stateRoot:header.stateRoot,timestamp:header.timestamp},headerRlp:encodeCapturedHeader(header),accounts:[{address:calls[0].from.toLowerCase(),slots:[]}]};
const accounts=new Map(input.accounts.map(a=>[a.address.toLowerCase(),a]));
const allProofNodes=[...new Set(input.accounts.flatMap(a=>a.accountProof))],empty=keccak256('0x80');
const proofFor=(address,slots)=>{
 const original=accounts.get(address.toLowerCase());
 const account=original??{address,code:'0x',codeHash:keccak256('0x'),balance:'0x0',nonce:'0x0',storageHash:empty,accountProof:allProofNodes,storageProof:[]};
 const storageProof=slots.map(key=>{const proved=account.storageProof.find(p=>BigInt(p.key)===BigInt(key));return proved??{key,value:'0x0',proof:[...new Set(account.storageProof.flatMap(p=>p.proof))]};});
 const result={...account,storageProof};verifyWitness(header,{accounts:[result]});return result;
};
function headerFromRLP(rlp){const a=fromRlp(rlp),quantity=h=>'0x'+BigInt(h==='0x'?'0x0':h).toString(16);
 return {parentHash:a[0],sha3Uncles:a[1],miner:a[2],stateRoot:a[3],transactionsRoot:a[4],receiptsRoot:a[5],logsBloom:a[6],difficulty:quantity(a[7]),number:quantity(a[8]),gasLimit:quantity(a[9]),gasUsed:quantity(a[10]),timestamp:quantity(a[11]),extraData:a[12],mixHash:a[13],nonce:a[14],baseFeePerGas:quantity(a[15]),hash:keccak256(rlp)};}
const headerMap=new Map([header,...input.ancestorHeaders.map(headerFromRLP)].map(h=>[h.number,h]));
const rpc=[];let networkAttempts=0;globalThis.fetch=async()=>{networkAttempts++;throw Error('Native qualification forbids ambient network');};
const fetchImpl=async(url,options)=>{assert.equal(url,'https://ethereum-sepolia-rpc.publicnode.com');const request=JSON.parse(options.body);rpc.push(request);let result;
 if(request.method==='eth_chainId')result='0xaa36a7';
 else if(request.method==='eth_getBlockByNumber'){result=headerMap.get(request.params[0]);assert.ok(result,'No fabricated history');}
 else if(request.method==='eth_getProof')result=proofFor(request.params[0],request.params[1]);
 else if(request.method==='eth_getCode')result=proofFor(request.params[0],[]).code;
 else throw Error('Unapproved method');return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));};
const bundle=join(root,'sdk.mjs');await build({stdin:{contents:'export {createKeelLocalSimulationTransport} from "./packages/sdk/src/local-simulation-session.ts";export {simulateKeelPublicationBeforeFunding} from "./packages/sdk/src/publication-preflight.ts";',resolveDir:process.cwd(),sourcefile:'native-resolution-qualification.mjs'},outfile:bundle,bundle:true,platform:'node',format:'esm',target:'node22'});
const {createKeelLocalSimulationTransport,simulateKeelPublicationBeforeFunding}=await import(pathToFileURL(bundle).href);
const report={schema:'keel-real-native-witness-resolution-qualification@1',synthetic:true,actualProjectAcceptance:false,networkAttempts:0,binarySHA256:buildReceipt.binarySHA256,sourceManifestSHA256:buildReceipt.sourceManifestSHA256,runs:[]};
async function run(label,{corrupt=false,cancel=false,reorg=false}={}){
 const controller=new AbortController(),processes=[],wire=[];let missingSeen=false;
 const factory=createCanonicalNativeProcessFactory({binaryPath,binarySHA256:buildReceipt.binarySHA256,onProcess:e=>processes.push(e)});
 const resolver=createCapturedNativeWitnessResolver({capture:raw,captureBytes,seed},{now:()=>clock,signal:controller.signal,fetchImpl:async(url,options)=>{
  const r=await fetchImpl(url,options),body=await r.json();if(corrupt&&missingSeen&&JSON.parse(options.body).method==='eth_getProof')body.result.balance='0x1';return new Response(JSON.stringify(body));},newNativeClient:async state=>{
   const client=await factory(state);return {close:()=>client.close(),async request(command,options){const response=await client.request(command,options);wire.push({command,response});if(response.error?.diagnostic){missingSeen=true;if(cancel)controller.abort();}return response;}};
  }});
 const transport=createKeelLocalSimulationTransport({block:{number:BigInt(header.number),hash:header.hash,stateRoot:header.stateRoot},signal:controller.signal,
  readTransport:{async request({method,params}){if(method==='eth_chainId')return '0xaa36a7';if(method==='eth_getBlockByNumber')return reorg&&missingSeen?{...header,hash:'0x'+'ff'.repeat(32)}:header;if(method==='eth_getCode')return proofFor(params[0],[]).code;throw Error('Unexpected shared SDK read');}},
  createClient:()=>resolver.createClient(),witnessResolution:resolver.witnessResolution,onSession:e=>resolver.onSession(e)});
 const request=transport.request.bind(transport);const transportFailures=[];
 transport.request=async input=>{try{return await request(input);}catch(error){transportFailures.push({message:error.message,stack:error.stack,reason:error.reason,code:error.code});throw error;}};
 let proof,error;
 try{proof=await simulateKeelPublicationBeforeFunding({...capture.exactSimulationInput,planFingerprint:keccak256('0x1234'),maximumTokenUriBytes:2_000_000,maximumReadGas:16_000_000n,collectionOverheadGas:10_000n,maximumTransactionGas:200_000_000n},transport);}
 catch(e){error={name:e.name,kind:e.kind,reason:e.reason,message:e.message};}
 finally{await transport.close();await resolver.close();assert.ok(processes.every(p=>p.isolated&&p.exitConfirmed));}
 writeFileSync(join(root,label+'.wire.json'),JSON.stringify(wire,null,2)+'\n',{mode:0o600});
 const outcome={label,proof,error,missingSeen,processes,transportFailures,resolution:resolver.evidence,wireSHA256:sha256(readFileSync(join(root,label+'.wire.json')))};report.runs.push(outcome);return outcome;
}
try{
 const success=await run('resolved');assert.equal(success.error,undefined,JSON.stringify(success.error));assert.equal(success.proof.simulatedCalls,47);assert.equal(success.proof.completeTokenUriBytes,Buffer.byteLength(manifest.expectedURI));
 assert.equal(success.proof.abiReturnDigest,keccak256(manifest.metadataABI));assert.ok(success.resolution.rounds.some(r=>r.dependency.kind==='missing-witness'&&r.dependency.access.slot));
 assert.ok(success.processes.length>3);assert.equal(success.resolution.sessions.length,3);assert.equal(success.resolution.acceptance,false);
 for(const [label,options]of [['corrupt-proof',{corrupt:true}],['cancelled',{cancel:true}],['changed-canonical-pin',{reorg:true}]]){const result=await run(label,options);assert.equal(result.proof,undefined);assert.ok(result.error);}
 assert.equal(networkAttempts,0);report.status='passed';report.networkAttempts=networkAttempts;console.log('PASS actual native dependency discovery, canonical proof expansion, clean replay, full SDK metadata, corruption/cancel/reorg rejection');
}finally{writeFileSync(join(root,'qualification.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});}
