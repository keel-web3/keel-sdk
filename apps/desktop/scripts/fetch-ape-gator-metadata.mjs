/** Read-only, resumable provenance capture. Never substitutes old generator IDs. */
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createPublicClient,http} from 'viem';
const root=path.resolve(process.argv[2]??'apps/desktop/artifacts/gator-ape-rebuild');
const address='0xd33edec311f8769c71f132a77f0c0796c22af1c5',chainId=33139;
const abi=JSON.parse(await readFile(path.join(root,'source/abi.json'),'utf8'));
const client=createPublicClient({transport:http(process.env.APE_READ_RPC??'https://rpc.apechain.com',{timeout:30000,retryCount:2,batch:{batchSize:25,wait:20}})});
if(await client.getChainId()!==chainId)throw Error('Wrong network: ApeChain 33139 required.');
const atomic=async(file,value)=>{await writeFile(file+'.tmp',JSON.stringify(value,null,2));await rename(file+'.tmp',file);};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const cached=async(file)=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
await mkdir(path.join(root,'metadata'),{recursive:true});await mkdir(path.join(root,'routes'),{recursive:true});
let snapshot=await cached(path.join(root,'snapshot.json'));
if(!snapshot){
 const block=await client.getBlock({blockTag:'finalized'}),blockNumber=block.number;
 const controls={};for(const name of ['name','owner','totalSupply','TOTAL_SUPPLY','useNewURI','originalBaseURI','baseURI','evolveBaseURI','pfpBaseURI','evolvePFPBaseURI','tokenURISuffix']){const value=await client.readContract({address,abi,functionName:name,blockNumber});controls[name]=typeof value==='bigint'?String(value):value;}
 snapshot={chainId,address,blockNumber:String(blockNumber),blockHash:block.hash,capturedAt:new Date().toISOString(),controls};
 await atomic(path.join(root,'snapshot.json'),snapshot);
}
if(snapshot.chainId!==chainId||snapshot.address!==address)throw Error('Snapshot belongs to another contract.');
const blockNumber=BigInt(snapshot.blockNumber);
if((await client.getBlock({blockNumber})).hash!==snapshot.blockHash)throw Error('Snapshot block changed.');
const count=Number(snapshot.controls.TOTAL_SUPPLY);if(count!==4000)throw Error('Review changed supply before enumerating IDs.');
const pool=async(size,items,fn)=>{let at=0;await Promise.all(Array.from({length:size},async()=>{while(at<items.length)await fn(items[at++]);}));};
const ids=Array.from({length:count},(_,i)=>i),routes=[],failures=[];let completed=0;
await pool(12,ids,async tokenId=>{
 const file=path.join(root,'routes',tokenId+'.json');
 try{let route=await cached(file);
  if(!route){const [uri,evolved,pfp]=await Promise.all(['tokenURI','tokenEvolveMap','tokenPFPViewMap'].map(functionName=>client.readContract({address,abi,functionName,args:[BigInt(tokenId)],blockNumber})));
   route={tokenId,uri,evolved,pfp,chainId,address,blockNumber:snapshot.blockNumber};await atomic(file,route);}
  if(route.tokenId!==tokenId||route.blockNumber!==snapshot.blockNumber||route.address!==address)throw Error('Stale route cache');routes.push(route);
 }catch(e){failures.push({tokenId,stage:'contract',error:e.shortMessage??e.message});}
 if(++completed%200===0)console.log(JSON.stringify({stage:'contract',completed,count,failures:failures.length}));
});
routes.sort((a,b)=>a.tokenId-b.tokenId);await atomic(path.join(root,'routes.json'),routes);
const gateways=['https://gateway.lighthouse.storage/ipfs/','https://ipfs.filebase.io/ipfs/','https://gateway.pinata.cloud/ipfs/'];
const summaries=[];completed=0;
await pool(8,routes,async route=>{
 const file=path.join(root,'metadata',route.tokenId+'.json'),proofFile=file+'.proof.json';
 try{
  let bytes,proof=await cached(proofFile);
  if(proof){bytes=await readFile(file);if(proof.uri!==route.uri||proof.sha256!==digest(bytes))throw Error('Metadata cache integrity mismatch');}
  else{
   let last;for(let attempt=0;attempt<3;attempt++)try{
    const url=route.uri.startsWith('ipfs://')?gateways[attempt]+route.uri.slice(7):route.uri;
    if(!/^https:\/\//.test(url))throw Error('Unsupported metadata URI '+route.uri);
    const response=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('HTTP '+response.status);
    bytes=Buffer.from(await response.arrayBuffer());const metadata=JSON.parse(bytes.toString('utf8'));
    if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||!Array.isArray(metadata.attributes)||typeof metadata.image!=='string')throw Error('Metadata lacks image or attributes');
    proof={...route,retrievedFrom:url,retrievedAt:new Date().toISOString(),sha256:digest(bytes),bytes:bytes.length};
    await writeFile(file,bytes);await atomic(proofFile,proof);break;
   }catch(e){last=e;console.log(JSON.stringify({stage:'gateway-retry',tokenId:route.tokenId,gateway:attempt,error:e.message}));}if(!proof)throw last;
  }
  const metadata=JSON.parse(bytes.toString('utf8'));summaries.push({tokenId:route.tokenId,uri:route.uri,sha256:proof.sha256,name:metadata.name,image:metadata.image,attributes:metadata.attributes,evolved:route.evolved,pfp:route.pfp});
 }catch(e){failures.push({tokenId:route.tokenId,stage:'metadata',uri:route.uri,error:e.message});}
 if(++completed%100===0){const progress={stage:'metadata',completed,total:routes.length,downloaded:summaries.length,failures:failures.length,lastFailures:failures.slice(-5)};await atomic(path.join(root,'metadata-progress.json'),progress);console.log(JSON.stringify(progress));}
});
summaries.sort((a,b)=>a.tokenId-b.tokenId);await atomic(path.join(root,'tokens.json'),summaries);
const report={...snapshot,expected:count,routes:routes.length,metadata:summaries.length,evolved:routes.filter(r=>r.evolved).length,pfp:routes.filter(r=>r.pfp).length,failures,complete:failures.length===0&&summaries.length===count,publicationReady:false};
await atomic(path.join(root,'metadata-report.json'),report);console.log(JSON.stringify({...report,failures:failures.length}));if(!report.complete)process.exitCode=1;
