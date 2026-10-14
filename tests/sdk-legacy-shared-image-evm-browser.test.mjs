import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {decodeFunctionResult,encodeDeployData,encodeFunctionData,getContractAddress,toHex} from 'viem';
import {compileSharedImageContracts} from './support/shared-image-contracts.mjs';
import {sharedFixture,poster,sha} from './support/legacy-shared-image-fixture.mjs';
import {observeOfflineShell} from './support/offline-shell-browser.mjs';
import {auditKeelInlineTokenURI,assertKeelFreshPayloadAudit} from '../packages/sdk/dist/inline-transport-audit.js';
import {readKeelLegacyPreparedDenseSources} from '../packages/sdk/dist/legacy-prepared-dense-copy.js';

const image='ethereum/client-go@sha256:abf3605177f8bdcfce436985a8054cca4ae59256323a4ffb72c56c04f3d1fadd';
const owner='0x'+'11'.repeat(20), stranger='0x'+'22'.repeat(20);
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:64*1024*1024,timeout:60000,stdio:['ignore','pipe','pipe']});

test('compiled shared-image reader + normal KeelRouted721/image module returns and executes exact artwork with one stored native image', {timeout:600000}, async()=>{
 const f=await sharedFixture();
 const compilation=compileSharedImageContracts();
 const directory=mkdtempSync(join(tmpdir(),'keel-shared-image-evm-'));
 const container='keel-shared-image-proof-'+process.pid;
 const evidence={schema:'keel-legacy-shared-image-local-evm@1',image,compiler:compilation.compiler,contractsRoot:compilation.contractsRoot,
  contractSources:compilation.sources,network:'none',synthetic:true,productionStateUsed:false,
  storageAdapter:'LocalHold: actual deployed 23000-byte code carriers, synthetic registration policy',
  collection:'actual compiled KeelRouted721 extends normal KEEL721',imageModule:'actual compiled Keel721Presentation',
  mintPath:'normal strikeFromManager using synthetic local manager role; public drop/controller execution not qualified by this test',
  signing:'not-performed',submission:'not-performed',checks:[]};
 const artifact=name=>{const value=compilation.artifacts.get(name);assert.ok(value,`Missing compiled ${name}`);return value;};
 let nonce=0;const calls=[],addresses={};
 function call(name,to,data,from=owner){calls.push({name,from,to,data,value:'0x0',gas:toHex(150_000_000n),nonce:toHex(nonce++)});return calls.length-1;}
 function deploy(name,args=[]){
  const value=artifact(name);let bytecode=value.evm.bytecode.object;
  for(const entries of Object.values(value.evm.bytecode.linkReferences))for(const [library,refs] of Object.entries(entries)){
   assert.ok(addresses[library],`Undeployed link ${library}`);for(const ref of refs){const at=ref.start*2;bytecode=bytecode.slice(0,at)+addresses[library].slice(2)+bytecode.slice(at+ref.length*2);}
  }
  const address=getContractAddress({from:owner,nonce:BigInt(nonce)});addresses[name]=address;
  const data=encodeDeployData({abi:value.abi,bytecode:'0x'+bytecode,args});
  calls.push({name:'construct '+name,from:owner,data,value:'0x0',gas:toHex(150_000_000n),nonce:toHex(nonce++)});return address;
 }
 const lib=deploy('Keel721MetadataFormatting');
 const hold=deploy('LocalHold');
 const raw=deploy('KeelRawTokenURIBuilder',[hold]);
 const imageModule=deploy('Keel721Presentation');
 const builder=deploy('KeelLegacySharedImageTokenURIBuilder',[hold,raw]);
 const collection=deploy('KeelRouted721',['Saved original release','ORIG',owner,owner,'0x'+'00'.repeat(20),owner,250,1n]);
 const data=(name,fn,args=[])=>encodeFunctionData({abi:artifact(name).abi,functionName:fn,args});
 for(const [id,object]of f.objects){
  const label=id===f.imageObjectId?'native image':id===f.programObjectId?'program':'COPY frame';
  for(let offset=0;offset<object.bytes.length;offset+=23000)call('store '+label+' bounded carrier',hold,data('LocalHold','append',[id,toHex(object.bytes.subarray(offset,offset+23000))]));
  call('commit '+label,hold,data('LocalHold','finish',[id,sha(object.bytes),BigInt(object.bytes.length),object.mediaType]));
 }
 call('register unsigned test program',hold,data('LocalHold','register',[f.programObjectId,builder]));
 call('preserve manifest presentation',collection,data('KeelRouted721','setDefaultPresentation',['data:application/json,%7B%7D','0x'+'77'.repeat(32),'unused fallback','']));
 call('preserve description',collection,data('KeelRouted721','setCollectionDescription',['Original release sale terms']));
 call('select existing image module route',collection,data('KeelRouted721','setPresentationModule',[imageModule]));
 call('bind native image same object',imageModule,data('Keel721Presentation','setImageSource',[collection,0n,hold,f.imageObjectId]));
 const setupIndex=call('bind compatible program reader',collection,data('KeelRouted721','setPreEncodedOnchainHarness',[builder,f.programObjectId,f.program.integrity.digest]));
 call('normal manager strike',collection,data('KeelRouted721','strikeFromManager',[owner,1n,'0x']));
 const uriIndex=call('complete actual tokenURI',collection,data('KeelRouted721','tokenURI',[1n]));
 const imageSourceIndex=call('actual image binding',imageModule,data('Keel721Presentation','imageSources',[collection,0n]));
 const supplyIndex=call('supply remains one',collection,data('KeelRouted721','maxSupply'));
 const ownerIndex=call('mint recipient unchanged',collection,data('KeelRouted721','ownerOf',[1n]));
 const payloadIndex=call('physical payload accounting',hold,data('LocalHold','payloadBytes'));
 const copyCountIndex=call('physical object accounting',hold,data('LocalHold','putCount'));
 const royaltyIndex=call('royalty unchanged',collection,data('KeelRouted721','royaltyInfo',[1n,10000n]));
 const endNonce=nonce;
 let started=false;
 const rpc=(method,params)=>{
  assert.ok(['eth_chainId','web3_clientVersion','eth_getBlockByNumber','eth_simulateV1'].includes(method));
  writeFileSync(join(directory,'request.json'),JSON.stringify({jsonrpc:'2.0',id:1,method,params}));
  const response=JSON.parse(docker('exec',container,'wget','-Y','off','-q','-O','-','--header=Content-Type: application/json','--post-file=/fixture/request.json','http://127.0.0.1:8545'));
  if(response.error)throw new Error(JSON.stringify(response.error));return response.result;
 };
 const simulate=values=>rpc('eth_simulateV1',[{blockStateCalls:[{blockOverrides:{gasLimit:toHex(1_000_000_000n)},calls:values.map(({name,...value})=>value)}],validation:false,traceTransfers:false,returnFullTransactions:false},'0x0'])[0];
 try{
  docker('image','inspect',image);
  const genesis=JSON.parse(readFileSync(new URL('./fixtures/native-geth-publication/genesis.json',import.meta.url),'utf8'));
  genesis.gasLimit=toHex(1_000_000_000n);genesis.timestamp=toHex(1792100000n);
  writeFileSync(join(directory,'genesis.json'),JSON.stringify(genesis));
  const user=`${process.getuid()}:${process.getgid()}`;
  docker('run','--pull=never','--rm','--network','none','--user',user,'-v',`${directory}:/fixture`,image,'--datadir','/fixture/data','init','/fixture/genesis.json');
  docker('run','--pull=never','-d','--name',container,'--network','none','--user',user,'--memory','768m','--cpus','2','-v',`${directory}:/fixture`,image,
   '--datadir','/fixture/data','--networkid','31337','--nodiscover','--maxpeers','0','--cache','64','--ipcdisable','--http','--http.addr','127.0.0.1','--http.vhosts','localhost','--http.api','eth,net,web3','--rpc.gascap','1000000000','--rpc.evmtimeout','120s','--rpc.http-body-limit','32');started=true;
  for(let attempt=0;;attempt++){try{assert.equal(rpc('eth_chainId',[]),'0xaa36a7');break;}catch(error){if(attempt>60)throw error;await delay(100);}}
  assert.equal(JSON.parse(docker('inspect',container))[0].HostConfig.NetworkMode,'none');
  evidence.containerId=JSON.parse(docker('inspect',container))[0].Id;evidence.clientVersion=rpc('web3_clientVersion',[]);evidence.addresses=addresses;
  const result=simulate(calls);
  evidence.sequence=result.calls.map((value,index)=>({name:calls[index].name,status:value.status,gasUsed:value.gasUsed,returnDataSHA256:sha(Buffer.from((value.returnData??'0x').slice(2),'hex')),...(value.error?{error:value.error}:{})}));
  for(let i=0;i<result.calls.length;i++)assert.equal(result.calls[i].status,'0x1',`${calls[i].name}: ${JSON.stringify(result.calls[i].error)}`);
  const decoded=(index,name,fn)=>decodeFunctionResult({abi:artifact(name).abi,functionName:fn,data:result.calls[index].returnData});
  const tokenURI=decoded(uriIndex,'KeelRouted721','tokenURI');
  writeFileSync(join(directory,'actual-token-uri.txt'),tokenURI);
  const metadata=await(await fetch(tokenURI)).json();
  assert.equal(metadata.image,'data:image/png;base64,'+poster.toString('base64'));
  assert.equal(metadata.name,'Saved original release #1');assert.equal(metadata.description,'Original release sale terms');
  const html=await(await fetch(metadata.animation_url)).text();
  const resources=await readKeelLegacyPreparedDenseSources({htmlBytes:Buffer.from(html)});
  assert.deepEqual(resources.resources.map(r=>({id:r.id,aliases:r.aliases,role:r.role,mediaType:r.mediaType,bytes:Buffer.from(r.bytes)})),f.resources.map(r=>({...r,bytes:Buffer.from(r.bytes)})));
  assert.equal(decoded(supplyIndex,'KeelRouted721','maxSupply'),1n);assert.equal(decoded(ownerIndex,'KeelRouted721','ownerOf').toLowerCase(),owner);
  const imageBinding=decoded(imageSourceIndex,'Keel721Presentation','imageSources');assert.equal(imageBinding[0],f.imageObjectId);assert.equal(imageBinding[1].toLowerCase(),hold.toLowerCase());
  assert.deepEqual(decoded(royaltyIndex,'KeelRouted721','royaltyInfo'),[owner,250n]);
  const stored=decoded(payloadIndex,'LocalHold','payloadBytes');assert.equal(stored,BigInt([...f.objects.values()].reduce((sum,x)=>sum+x.bytes.length,0)));
  assert.equal(decoded(copyCountIndex,'LocalHold','putCount'),BigInt(f.objects.size));
  const audit=await auditKeelInlineTokenURI(tokenURI);assertKeelFreshPayloadAudit(audit.carriage);assert.equal(audit.completeDocumentBase64Layers,0);
  evidence.fullReturn={byteLength:Buffer.byteLength(tokenURI),sha256:sha(Buffer.from(tokenURI)),imageSHA256:sha(poster),imageBytes:poster.length,
   originalResourceCount:resources.resources.length,nativeImageObjectId:f.imageObjectId,storedNativeImagePayloadBytes:poster.length,storedEncodedImagePayloadBytes:0,
   imageCopiesInReturnedDocument:2,totalStoredPayloadBytes:stored.toString(),objectCount:f.objects.size,programIntegrity:f.program.integrity,renderedIntegrity:f.program.renderedIntegrity};
  const browser=await observeOfflineShell(html,'verified','shared:'+poster.toString('base64')+':1:true',{retainSignalsAcrossDocumentOpen:true});
  assert.deepEqual(browser.externalRequests,[]);assert.deepEqual(browser.pageNetworkRequests,[]);assert.deepEqual(browser.errors,[]);assert.equal(browser.frames,1);
  evidence.browser={externalRequests:browser.externalRequests,pageNetworkRequests:browser.pageNetworkRequests,errors:browser.errors,frames:browser.frames,signals:browser.signals,deniedProxyRequests:browser.proxyRequests};
  // Each control starts again from the same local genesis; no state or transaction is broadcast.
  const tamper=[...calls.slice(0,uriIndex),{name:'tamper native storage adapter',from:owner,to:hold,data:data('LocalHold','corrupt',[f.imageObjectId,'0x010203']),value:'0x0',gas:toHex(150_000_000n),nonce:toHex(BigInt(uriIndex))},{...calls[uriIndex],nonce:toHex(BigInt(uriIndex+1))}];
  const changed=simulate(tamper);assert.equal(changed.calls.at(-1).status,'0x0');evidence.checks.push('actual collection tokenURI rejects tampered native image before any child document');
  const unregistered=calls.filter(x=>x.name!=='register unsigned test program').slice(0,setupIndex).map((x,i)=>({...x,nonce:toHex(BigInt(i))}));
  unregistered.push({...calls[setupIndex],nonce:toHex(BigInt(unregistered.length))});
  const denied=simulate(unregistered);assert.equal(denied.calls.at(-1).status,'0x0');evidence.checks.push('normal collection setup rejects unregistered new reader program');
  const unauthorized=[...calls.slice(0,uriIndex),{name:'unauthorized image rebind',from:stranger,to:imageModule,data:data('Keel721Presentation','setImageSource',[collection,0n,hold,f.imageObjectId]),value:'0x0',gas:toHex(150_000_000n),nonce:'0x0'}];
  const deniedEdit=simulate(unauthorized);assert.equal(deniedEdit.calls.at(-1).status,'0x0');evidence.checks.push('existing collection authorization rejects stranger image binding');
  evidence.checks.push('actual compiled normal manager mint and tokenURI preserve supply, recipient, royalty, metadata and all original resources');
  evidence.checks.push('dynamic bytes lookup and escaped CSS image load succeed in actual offline Chromium');
  evidence.status='local-qualified';
  console.log(JSON.stringify(evidence));
 }finally{
  writeFileSync(join(directory,'evidence.json'),JSON.stringify(evidence,null,2));
  if(process.env.KEEL_SHARED_IMAGE_EVIDENCE_DIR){const dest=process.env.KEEL_SHARED_IMAGE_EVIDENCE_DIR;writeFileSync(join(dest,'evm-browser-proof.json'),JSON.stringify(evidence,null,2));try{writeFileSync(join(dest,'actual-token-uri.txt'),readFileSync(join(directory,'actual-token-uri.txt')));}catch{}}
  if(started)docker('rm','-f',container);
  // Only the synthetic chain's own regenerable data directory is removed; evidence remains.
  rmSync(join(directory,'data'),{recursive:true,force:true});
 }
});
