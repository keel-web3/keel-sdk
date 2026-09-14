/** Resumable, throttled recovery from the exact contract-selected URIs. */
import {readFile,writeFile,rename,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='apps/desktop/artifacts/gator-ape-rebuild';
const current=JSON.parse(await readFile(root+'/current-routes.json','utf8'));
if(!current.complete||current.total!==4000)throw Error('Require all 4000 fresh contract URI reads.');
const digest=b=>createHash('sha256').update(b).digest('hex');
const directory=JSON.parse(await readFile(root+'/contract-metadata-directory.json','utf8'));
const entries=new Map(directory.Links.map(entry=>[entry.Name,entry]));
const rawCID=bytes=>{const bits=[1,0x55,0x12,0x20,...createHash('sha256').update(bytes).digest()].map(b=>b.toString(2).padStart(8,'0')).join('');return 'b'+bits.match(/.{1,5}/g).map(v=>'abcdefghijklmnopqrstuvwxyz234567'[parseInt(v.padEnd(5,'0'),2)]).join('');};
function verifyBytes(route,bytes){const entry=entries.get(route.tokenId+'.json');if(!entry||entry.Tsize!==bytes.length||entry.Hash['/']!==rawCID(bytes))throw Error('Contract directory content hash mismatch');}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const hosts=[{url:'https://gateway.pinata.cloud/ipfs/',next:0,waitUntil:0,queue:Promise.resolve()},{url:'https://ipfs.filebase.io/ipfs/',next:0,waitUntil:0,queue:Promise.resolve()}];
const missing=[];let downloaded=0;
const atomic=async(p,data)=>{await writeFile(p+'.tmp',JSON.stringify(data,null,2));await rename(p+'.tmp',p);};
for(const route of current.routes){
 try{const bytes=await readFile(root+'/metadata/'+route.tokenId+'.json');const proof=JSON.parse(await readFile(root+'/metadata/'+route.tokenId+'.json.proof.json','utf8'));if(proof.uri!==route.uri||proof.sha256!==digest(bytes))throw Error('Conflicting existing metadata');verifyBytes(route,bytes);downloaded++;}
 catch(e){if(e.code!=='ENOENT')throw e;missing.push(route);}
}
let failures=[],done=0;const started=Date.now();
const progress=async()=>{const p={expected:4000,metadata:downloaded,remaining:4000-downloaded,attempted:done,failures:failures.length,elapsedSeconds:Math.round((Date.now()-started)/1000),complete:downloaded===4000};await atomic(root+'/recovery-progress.json',p);console.log(JSON.stringify(p));};
await progress();
async function request(route,index){
 const host=hosts[index%hosts.length];
 await (host.queue=host.queue.then(async()=>{
  await delay(Math.max(0,host.next-Date.now(),host.waitUntil-Date.now()));
  host.next=Date.now()+650;
 }));
 const url=route.uri.startsWith('ipfs://')?host.url+entries.get(route.tokenId+'.json').Hash['/']:route.uri;
 if(!url.startsWith('https://'))throw Error('Unsupported route');
 const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
 if(!response.ok){
  if(response.status===429||response.status===503){const retry=response.headers.get('retry-after');const seconds=retry&&/^\d+$/.test(retry)?Number(retry):60;host.waitUntil=Date.now()+Math.max(1000,seconds*1000);}
  throw Error('HTTP '+response.status);
 }
 const bytes=Buffer.from(await response.arrayBuffer()),metadata=JSON.parse(bytes);
 if(!metadata||!Array.isArray(metadata.attributes)||typeof metadata.image!=='string')throw Error('Unexpected token metadata');
 verifyBytes(route,bytes);
 const file=root+'/metadata/'+route.tokenId+'.json';
 await writeFile(file,bytes);await atomic(file+'.proof.json',{...route,retrievedFrom:url,retrievedAt:new Date().toISOString(),sha256:digest(bytes),bytes:bytes.length,rawFileCID:entries.get(route.tokenId+'.json').Hash['/'],contractDirectoryHashVerified:true});
 downloaded++;
}
let pending=missing;
for(let pass=0;pass<3&&pending.length;pass++){
 const next=[];let cursor=0;
 await Promise.all(Array.from({length:12},async()=>{while(cursor<pending.length){const index=cursor++,route=pending[index];try{await request(route,index+pass);}catch(e){next.push(route);failures.push({tokenId:route.tokenId,error:e.message});await appendFile(root+'/recovery-failures.jsonl',JSON.stringify({tokenId:route.tokenId,pass,error:e.message})+'\n');}if(++done%50===0)await progress();}}));
 pending=next;if(pending.length&&pass<2)await delay(60000);
}
await progress();await atomic(root+'/recovery-report.json',{...current,routes:current.routes.length,metadata:downloaded,missingTokenIds:pending.map(x=>x.tokenId),complete:downloaded===4000,failures,published:false});
if(downloaded!==4000)process.exitCode=1;
