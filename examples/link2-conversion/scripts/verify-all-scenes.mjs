import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('current/manifest.json',root)));
const scenes={};let verified=0,bytes=0;const missing=[],invalid=[];
for(const [path,entry] of Object.entries(manifest.paths)){
 if(!/^data\/\d+(?:_var)?\/(1600|4600)\//.test(path))continue;
 const key=path.split('/').slice(1,3).join('/');
 const scene=scenes[key]??={expected:0,verified:0};scene.expected++;
 try{const data=await readFile(new URL('current/'+path,root));
 if(createHash('sha256').update(data).digest('hex')!==entry.id){invalid.push(path);continue;}
 verified++;bytes+=data.length;scene.verified++;
 }catch(error){if(error.code==='ENOENT')missing.push(path);else throw error;}
}
const report={verified,bytes,missing,invalid,scenes,complete:missing.length===0&&invalid.length===0};
await writeFile(new URL('evidence/all-scenes-verification.json',root),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,missing:missing.length,invalid:invalid.length}));
if(!report.complete)process.exitCode=1;
