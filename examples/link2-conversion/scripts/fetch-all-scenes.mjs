import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const capture=JSON.parse(await readFile(new URL('evidence/current-source.json',root)));
const manifest=JSON.parse(await readFile(new URL('current/manifest.json',root)));
const jobs=Object.entries(manifest.paths).filter(([p])=>/^data\/\d+(?:_var)?\/(1600|4600)\/\d+_\d+\.(webp|jpg)$/.test(p)).sort(([a],[b])=>Number(b.includes('/1600/'))-Number(a.includes('/1600/'))||a.localeCompare(b));
const bases=[process.env.LINK2_SOURCE_BASE ?? capture.base,'https://qsiyevbhujiucs4qarcdf2jibzph4bvl2dua2xwhdvckgixq3sla.ar.io/hJGCVCeiUUFLkAREMukoDl5-BqvQ6A1exx1EoyLw3JY/'];
const total=jobs.length;const records=[],errors=[];let reused=0,done=0,bytes=0;const started=Date.now();
const hash=b=>createHash('sha256').update(b).digest('hex');
async function status(){const s={total,done,remaining:total-done,reused,bytes,seconds:Math.round((Date.now()-started)/1000),errors:errors.length,playbackComplete:records.filter(r=>r.path.includes('/1600/')).length===total/2};await writeFile(new URL('evidence/all-scenes-progress.json',root),JSON.stringify(s,null,2));console.log(JSON.stringify(s));}
async function worker(){while(jobs.length){const [path,entry]=jobs.shift();const file=new URL('current/'+path,root);let data;try{const cached=await readFile(file);if(hash(cached)!==entry.id)throw Error('Existing local file has wrong hash: '+path);data=cached;reused++;}catch(e){if(e.code!=='ENOENT')throw e;}
if(!data)for(let attempt=0;attempt<6;attempt++){try{const response=await fetch(new URL(path,bases[attempt%bases.length]),{signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error(`HTTP ${response.status}`);const candidate=Buffer.from(await response.arrayBuffer());if(hash(candidate)!==entry.id)throw Error('Source digest mismatch');await mkdir(new URL('.',file),{recursive:true});const temp=new URL(file.href+'.part');await writeFile(temp,candidate);await rename(temp,file);data=candidate;break;}catch(e){console.log(JSON.stringify({retry:path,attempt:attempt+1,error:e.message}));if(attempt===5)errors.push({path,error:e.message});else await new Promise(resolve=>setTimeout(resolve,Math.min(20000,1000*2**attempt)));}}
if(data){records.push({path,bytes:data.length,sha256:entry.id});bytes+=data.length;}done++;if(done%100===0)await status();}}
await Promise.all(Array.from({length:16},()=>worker()));await status();records.sort((a,b)=>a.path.localeCompare(b.path));await writeFile(new URL('evidence/all-scenes.json',root),JSON.stringify({source:capture.base,downloadGateways:bases,total,records,errors},null,2));if(errors.length)process.exitCode=1;
