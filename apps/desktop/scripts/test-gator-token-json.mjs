/** Local full-route acceptance: original Gator clone -> URI -> shared KEEL
 * metadata resolver -> reusable object graph. Never sends a public transaction.
 */
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createPublicClient,createWalletClient,http,toHex,sha256,keccak256,encodeFunctionData} from 'viem';
import {createKeelManagedObjectPlan,createKeelManagedCompositePlan} from '@keel/sdk/native-publication';
import {gatorStack} from '@keel/sdk/gator-assembly';
import {Client} from '/tmp/keel-web3-jpeg-proof/node_modules/web3protocol/src/index.js';

const root='apps/desktop/artifacts/gator-inline-sepolia/3750-standard-json';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const artifact=async name=>json(`/Users/ravonus/dev/keel-contracts/out/${name}.sol/${name}.json`);
const [holdBuild,resolverBuild,original,source,graph,mcp]=await Promise.all([
 artifact('KeelHold'),artifact('KeelStoredTokenJSON'),json('apps/desktop/artifacts/gator-sepolia/compiled-original.json'),
 json('apps/desktop/artifacts/gator-sepolia/mainnet-source.json'),json(root+'/json-graph.json'),json(root+'/mcp-prepare.json')]);
assert.equal(graph.integrity.digest,mcp.result.structuredContent.web3Metadata.integrity.digest);
assert.equal(mcp.result.structuredContent.web3Metadata.tokenId,'0');
const parts=await Promise.all(graph.parts.map(async p=>({...p,bytes:await readFile(p.path)})));
for(const p of parts)assert.equal(sha256(p.bytes),p.integrity.digest);
const expected=Buffer.concat(parts.map(p=>p.bytes));assert.equal(sha256(expected),graph.integrity.digest);
assert.equal(expected.length,graph.integrity.byteLength);
const sourceMetadata=await readFile('apps/desktop/artifacts/gator-ape-rebuild/metadata/0.json');
const provenance=await json('apps/desktop/artifacts/gator-ape-rebuild/metadata/0.json.proof.json');
assert.equal(sha256(sourceMetadata),'0x'+provenance.sha256);
const audit=(await json('apps/desktop/artifacts/gator-ape-rebuild/layer-audit.json')).tokens.find(t=>t.tokenId===0);
assert.equal(audit.metadataSHA256,provenance.sha256);
const snapshot=await json('apps/desktop/artifacts/gator-inline-sepolia/offline-project-snapshot.json');
assert.deepEqual(gatorStack(snapshot.project.layered.assembly,audit.assetTraits).stack.map(p=>p.path),audit.stack);
const assets=await json('apps/desktop/artifacts/gator-ape-rebuild/mixed-codec-test-3750/selected.json');
const child=spawn('/Users/ravonus/.foundry/bin/anvil',['--port','0','--chain-id','31337','--gas-limit','60000000'],{stdio:['ignore','pipe','pipe']});
try {
 const url=await new Promise((resolve,reject)=>{let log='';const timeout=setTimeout(()=>reject(Error('Local EVM timeout')),15000);child.once('error',e=>{clearTimeout(timeout);reject(e);});child.stdout.on('data',d=>{log+=d;const m=log.match(/Listening on (127\.0\.0\.1:\d+)/);if(m){clearTimeout(timeout);resolve('http://'+m[1]);}});});
 const c=createPublicClient({transport:http(url,{timeout:60000})}),w=createWalletClient({transport:http(url,{timeout:60000})});
 assert.equal(await c.getChainId(),31337);const [account]=await w.getAddresses();
 let setupGas=0n;
 const receipt=async hash=>{const r=await c.waitForTransactionReceipt({hash});assert.equal(r.status,'success');setupGas+=r.gasUsed;return r;};
 const hold=(await receipt(await w.deployContract({account,chain:null,abi:holdBuild.abi,bytecode:holdBuild.bytecode.object}))).contractAddress;
 const args=source.decoded_constructor_args.map(([v,t])=>t.type.startsWith('uint')?BigInt(v):v);
 const collection=(await receipt(await w.deployContract({account,chain:null,abi:original.abi,bytecode:'0x'+original.evm.bytecode.object,args}))).contractAddress;
 const resolver=(await receipt(await w.deployContract({account,chain:null,abi:resolverBuild.abi,bytecode:resolverBuild.bytecode.object,args:[hold,collection,account]}))).contractAddress;
 const uploaded=new Set();let storedBytes=0;
 async function publishFixture(bytes,mediaType='text/plain') {
  const plan=await createKeelManagedObjectPlan(bytes,{hold,mediaType,compression:'none'});
  const missing=plan.chunks.filter(x=>!uploaded.has(x.id));
  for(let i=0;i<missing.length;i+=3){const batch=missing.slice(i,i+3);await receipt(await w.writeContract({account,chain:null,address:hold,abi:holdBuild.abi,functionName:'castSlugs',args:[batch.map(x=>toHex(x.bytes))]}));for(const x of batch){uploaded.add(x.id);storedBytes+=x.bytes.length;}}
  for(const operation of plan.operations)await receipt(await w.sendTransaction({account,chain:null,to:hold,data:operation.data}));
  return plan;
 }
 const partPlans=[];for(const p of parts)partPlans.push(await publishFixture(p.bytes));
 const composite=createKeelManagedCompositePlan(partPlans.map(p=>p.objectId),expected,{hold,mediaType:'application/json'});
 await receipt(await w.sendTransaction({account,chain:null,to:hold,data:composite.operation.data}));
 const metadataPlan=await publishFixture(sourceMetadata,'application/json');
 const viewerAssets=parts.flatMap((part,i)=>part.role==='asset'?[{descriptor:JSON.parse(decodeURIComponent(part.bytes.toString()).slice(1)),objectId:partPlans[i].objectId}]:[]);
 const selection={schema:'keel-token-selection@1',tokenId:'0',source:{chainId:provenance.chainId,collection:provenance.address,metadataURI:provenance.uri,metadataDigest:sha256(sourceMetadata),image:JSON.parse(sourceMetadata).image},assetTraits:audit.assetTraits,trace:audit.trace,layers:audit.stack.map(path=>{const asset=assets.find(a=>a.path===path);assert.ok(asset);const resource=viewerAssets.find(a=>a.descriptor.id==='asset-'+asset.objectId);assert.ok(resource);return {path,resourceId:resource.descriptor.id,contentDigest:'0x'+asset.objectId,preparedResourceObjectId:resource.objectId};})};
 const selectionBytes=Buffer.from(JSON.stringify(selection));const recipePlan=await publishFixture(selectionBytes,'application/json');
 await receipt(await w.writeContract({account,chain:null,address:resolver,abi:resolverBuild.abi,functionName:'setTokens',args:[[0n],[{jsonObjectId:composite.objectId,metadataObjectId:metadataPlan.objectId,recipeObjectId:recipePlan.objectId}]]}));
 const call=async(name,args)=>receipt(await w.writeContract({account,chain:null,address:collection,abi:original.abi,functionName:name,args}));
 await call('ownerMint',[2,account]);
 const baseURI=`web3://${resolver}:31337/tokenJSON/`,suffix='?mime.type=application/json';
 await call('setTokenURISuffix',[suffix]);await call('setBaseURI',[baseURI]);
 const tokenURI=await c.readContract({address:collection,abi:original.abi,functionName:'tokenURI',args:[0n]});assert.equal(tokenURI,baseURI+'0'+suffix);
 const data=encodeFunctionData({abi:resolverBuild.abi,functionName:'tokenJSON',args:[0n]});
 const readGas=await c.estimateGas({to:resolver,data,gas:60_000_000n});assert.ok(readGas<60_000_000n);
 const w3=new Client([{id:31337,name:'Local KEEL test',rpcUrls:[url]}]);const result=await w3.fetchUrl(tokenURI);assert.equal(result.httpCode,200);
 const actual=Buffer.from(await new Response(result.output).arrayBuffer());assert.deepEqual(actual,expected);
 const returned=JSON.parse(actual);const decode=uri=>Buffer.from(decodeURIComponent(uri.slice(uri.indexOf(',')+1)));
 assert.deepEqual(decode(returned.image),await readFile(root+'/image.svg'));
 assert.deepEqual(decode(returned.animation_url),await readFile(root+'/viewer.html'));
 const {image:_image,animation_url:_animation,...fields}=returned;const {image:_oldImage,animation_url:_oldAnimation,...originalFields}=JSON.parse(sourceMetadata);assert.deepEqual(fields,originalFields);
 await assert.rejects(c.readContract({address:resolver,abi:resolverBuild.abi,functionName:'tokenJSON',args:[1n]}));
 assert.equal(await c.readContract({address:hold,abi:holdBuild.abi,functionName:'haulObject',args:[metadataPlan.objectId]}),toHex(sourceMetadata));
 assert.equal(await c.readContract({address:hold,abi:holdBuild.abi,functionName:'haulObject',args:[recipePlan.objectId]}),toHex(selectionBytes));
 const report={schema:'gator-web3-json-local-acceptance@1',localOnly:true,published:false,readGas:String(readGas),jsonBytes:actual.length,jsonDigest:sha256(actual),graphParts:parts.length,uniqueStoredBytes:storedBytes,setupGas:String(setupGas),originalContractURIControls:true,web3Client:'web3protocol@0.6.3',web3ContentType:result.httpHeaders,originalMetadataExact:true,selectionRecipeExact:true,svgExact:true,verifiedHTMLExact:true,unmappedTokenRejected:true,selectedChainShellModuleBindingsVerified:false};
 await writeFile(root+'/local-token-selection-0.json',JSON.stringify(selection,null,2));
 await writeFile(root+'/token-json-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {child.kill('SIGTERM');}
