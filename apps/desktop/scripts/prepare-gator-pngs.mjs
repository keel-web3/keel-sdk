/** Offline recovery: originals remain untouched; every optimized PNG is stream-verified. */
import {readdir,readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {optimizeLayerPNG} from '@keel/sdk/layered-png';
import {layerDigest} from '@keel/sdk/layered-art';
const root=process.argv[2]??'/tmp/keel-gator-recovery/public/layers';
const output=path.resolve(process.argv[3]??'apps/desktop/artifacts/gator-recovery/png-assets');
await mkdir(output,{recursive:true});
const files=[];for(const folder of (await readdir(root,{withFileTypes:true})).filter(f=>f.isDirectory()))for(const file of await readdir(path.join(root,folder.name)))if(file.endsWith('.png'))files.push(folder.name+'/'+file);
files.sort();const cache=new Map(),rows=[],start=Date.now();
for(const name of files){
 const bytes=new Uint8Array(await readFile(path.join(root,name))),sourceDigest=await layerDigest(bytes);
 let result=cache.get(sourceDigest);
 if(!result){const optimized=await optimizeLayerPNG(bytes);await writeFile(path.join(output,optimized.digest),optimized.bytes);const {bytes:_,...proof}=optimized;result={...proof,objectId:optimized.digest};cache.set(sourceDigest,result);}
 rows.push({path:name,...result});
 if(rows.length%25===0||rows.length===files.length){await writeFile(output+'.json.tmp',JSON.stringify(rows));await rename(output+'.json.tmp',output+'.json');console.log(JSON.stringify({prepared:rows.length,total:files.length,sourceBytes:rows.reduce((n,r)=>n+r.originalBytes,0),storedBytes:rows.reduce((n,r)=>n+r.storedBytes,0),seconds:Math.round((Date.now()-start)/1000)}));}
}
