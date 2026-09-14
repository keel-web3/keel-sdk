/** Recover only byte-for-byte matches to the contract's IPFS directory hashes.
 * Candidate generator records are never accepted on labels or token order alone.
 */
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='apps/desktop/artifacts/gator-ape-rebuild',backup='apps/desktop/artifacts/gator-sepolia/source-data';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const current=await json(root+'/current-routes.json'),directory=await json(root+'/contract-metadata-directory.json');
const expected=new Map(directory.Links.map(x=>[x.Name,x]));
const records=await json(backup+'/metadata.json'),ids=await json(backup+'/ids.json'),images=await json(backup+'/uploadedImages.json');
const source=await json(root+'/metadata/0.json');
const rawCID=bytes=>{const bits=[1,0x55,0x12,0x20,...createHash('sha256').update(bytes).digest()].map(b=>b.toString(2).padStart(8,'0')).join('');return 'b'+bits.match(/.{1,5}/g).map(v=>'abcdefghijklmnopqrstuvwxyz234567'[parseInt(v.padEnd(5,'0'),2)]).join('');};
const attributes=[['body','Skin'],['eyes','Eyes'],['mouth','Mouth'],['hat','Hat'],['costume','Outfit']];
const labels=new Map(),keyOrders=new Set();let idMatches=0,idMismatches=0;
const byCID=new Map(Object.entries(images).map(([file,value])=>[value.hash,file.replace(/\.png$/,'')]));
for(const name of await readdir(root+'/metadata')){if(!/^\d+\.json$/.test(name))continue;
 const data=await json(root+'/metadata/'+name);keyOrders.add(JSON.stringify(Object.keys(data)));const entry=expected.get(name);const bytes=await readFile(root+'/metadata/'+name);
 if(rawCID(bytes)!==entry.Hash['/'])throw Error('Cached source hash mismatch');
 const cid=data.image.split('/ipfs/')[1],recordID=byCID.get(cid),record=records[recordID];if(!record)continue;
 const originalID=ids.find(x=>x['Token ID']===Number(name.slice(0,-5)))?.ID;
 if(recordID===originalID)idMatches++;else idMismatches++;
 for(const [key,label] of attributes){const trait=data.attributes.find(x=>x.trait_type===label);if(trait&&record[key]){
  const mapKey=key+'\0'+record[key],values=labels.get(mapKey)??new Set();values.add(trait.value);labels.set(mapKey,values);
 }}
}
let recovered=0,alreadyVerified=0;const unmatched=[];
for(const route of current.routes){
 const file=root+'/metadata/'+route.tokenId+'.json';
 try{const b=await readFile(file);if(rawCID(b)!==expected.get(route.tokenId+'.json').Hash['/'])throw Error('Existing content differs from contract');alreadyVerified++;continue;}catch(e){if(e.code!=='ENOENT')throw e;}
 const id=ids.find(x=>x['Token ID']===route.tokenId)?.ID,record=records[id],image=images[id+'.png'];
 if(!record||!image){unmatched.push(route.tokenId);continue;}
 const traits=attributes.filter(([key])=>record[key]&&record[key]!=='None').map(([key,label])=>{
  const names=labels.get(key+'\0'+record[key]);return {trait_type:label,value:names?.size===1?[...names][0]:record[key]};
 });
 const candidate={name:`TokenGator #${route.tokenId}`,description:source.description,image:image.defaultUrl,mml:`https://storage.googleapis.com/tokengators/apechain/mml/${route.tokenId}.mml`,attributes:traits};
 let bytes;
 for(const order of keyOrders){const ordered=Object.fromEntries(JSON.parse(order).map(key=>[key,candidate[key]]));const value=Buffer.from(JSON.stringify(ordered,null,2).replaceAll('\n','\r\n'));if(rawCID(value)===expected.get(route.tokenId+'.json').Hash['/']){bytes=value;break;}}
 if(!bytes){unmatched.push(route.tokenId);continue;}
 const proof={...route,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,rawFileCID:expected.get(route.tokenId+'.json').Hash['/'],contractDirectoryHashVerified:true,recoveryMethod:'exact-content-hash-match-from-generator-backup',recoveredAt:new Date().toISOString(),backupRecordId:id};
 await writeFile(file,bytes);await writeFile(file+'.proof.json',JSON.stringify(proof,null,2));recovered++;
}
const report={contract:current.address,chainId:current.chainId,contractBlock:current.blockNumber,alreadyVerified,recovered,verified:alreadyVerified+recovered,unmatched,idMatches,idMismatches,complete:alreadyVerified+recovered===4000,noUnverifiedCandidatesAccepted:true};
await writeFile(root+'/hash-recovery-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,unmatched:unmatched.length}));
