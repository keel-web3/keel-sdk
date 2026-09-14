/** Independent content-addressed acceptance of all 4,000 source metadata files. */
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='apps/desktop/artifacts/gator-ape-rebuild',load=async p=>JSON.parse(await readFile(p,'utf8'));
const current=await load(root+'/current-routes.json'),snapshot=await load(root+'/snapshot.json');
assert.equal(current.routes.length,4000);assert.equal(current.complete,true);
const rootCID=execFileSync('ipfs',['dag','put','--input-codec=dag-json','--store-codec=dag-pb',root+'/contract-metadata-directory.json'],{env:{...process.env,IPFS_PATH:'/tmp/keel-gator-ipfs'},encoding:'utf8'}).trim();
const directoryBytes=await readFile(root+'/contract-metadata-directory.json');
const entries=new Map(JSON.parse(directoryBytes).Links.map(x=>[x.Name,x]));
const hash=b=>createHash('sha256').update(b).digest();
const rawCID=bytes=>{const bits=[1,0x55,0x12,0x20,...hash(bytes)].map(b=>b.toString(2).padStart(8,'0')).join('');return 'b'+bits.match(/.{1,5}/g).map(v=>'abcdefghijklmnopqrstuvwxyz234567'[parseInt(v.padEnd(5,'0'),2)]).join('');};
const tokens=[];let sourceBytes=0;const recoveredByHash=[];
for(let tokenId=0;tokenId<4000;tokenId++){
 const route=current.routes[tokenId];assert.equal(route.tokenId,tokenId);assert.equal(route.uri,`ipfs://${rootCID}/${tokenId}.json`);
 const bytes=await readFile(`${root}/metadata/${tokenId}.json`),entry=entries.get(tokenId+'.json');
 assert.equal(bytes.length,entry.Tsize);assert.equal(rawCID(bytes),entry.Hash['/']);
 const proof=await load(`${root}/metadata/${tokenId}.json.proof.json`);assert.equal(proof.uri,route.uri);assert.equal(proof.sha256,hash(bytes).toString('hex'));
 const metadata=JSON.parse(bytes);assert.ok(Array.isArray(metadata.attributes));assert.equal(typeof metadata.image,'string');
 if(proof.recoveryMethod)recoveredByHash.push(tokenId);
 sourceBytes+=bytes.length;tokens.push({tokenId,uri:route.uri,sha256:proof.sha256,name:metadata.name,image:metadata.image,attributes:metadata.attributes,mml:metadata.mml,evolved:false,pfp:false});
}
const proof={schema:'gator-complete-metadata-proof@1',chainId:33139,address:current.address,contractBlock:current.blockNumber,contractBlockHash:current.blockHash,contractURIsRead:4000,verifiedMetadataFiles:4000,rootCID,directoryJSONSHA256:hash(directoryBytes).toString('hex'),rawFileHashesVerified:4000,sourceBytes,downloadedMetadataFiles:4000-recoveredByHash.length,exactHashRecoveredFiles:recoveredByHash.length,unusedDirectoryEntries:directoryBytes?entries.size-4000:0,complete:true,published:false};
await writeFile(root+'/complete-metadata-proof.json',JSON.stringify(proof,null,2));
await writeFile(root+'/tokens.json',JSON.stringify(tokens,null,2));
await writeFile(root+'/metadata-report.json',JSON.stringify({...snapshot,expected:4000,routes:4000,metadata:4000,evolved:0,pfp:0,failures:[],complete:true,publicationReady:false,latestVerification:proof},null,2));
await writeFile(root+'/recovery-progress.json',JSON.stringify({expected:4000,metadata:4000,remaining:0,complete:true,verification:proof},null,2));
await writeFile(root+'/recovery-report.json',JSON.stringify({...proof,missingTokenIds:[],failures:[]},null,2));
console.log(JSON.stringify(proof));
