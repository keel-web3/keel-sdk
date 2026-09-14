import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../original/',import.meta.url),evidence=new URL('../evidence/',import.meta.url);
const source=JSON.parse(await readFile(new URL('source.json',evidence)));
const manifest=JSON.parse(await readFile(new URL('manifest.json',root)));
const mode=process.argv[2]||'sample';
let paths=[];
for(const e of source.editions.filter(e=>mode!=='edition1'||e.id===1))for(const variation of e.variation?['','_var']:[''])for(const resolution of [1600,4600]){
 const frames=['all','edition1'].includes(mode)?Array.from({length:e.frames},(_,i)=>i):mode==='playback'&&resolution===1600?Array.from({length:e.frames},(_,i)=>i):[0,Math.floor(e.frames/2),e.frames-1];
 for(const frame of frames){const p=`data/${e.id}${variation}/${resolution}/${e.id}_${String(frame).padStart(3,'0')}.${resolution===1600?'webp':'jpg'}`;if(!manifest.paths[p])throw Error(`Missing original manifest path ${p}`);paths.push(p);}
}
let done=0;const records=[],errors=[];const started=Date.now();
async function worker(){while(paths.length){const path=paths.shift();const file=new URL(path,root);let bytes;try{bytes=await readFile(file)}catch{for(let attempt=0;attempt<3;attempt++){try{const r=await fetch(new URL(path,source.base),{signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error(`HTTP ${r.status}`);bytes=Buffer.from(await r.arrayBuffer());if(bytes.length<100||r.headers.get('content-type')?.includes('text/html'))throw Error('Invalid image response');await mkdir(new URL('.',file),{recursive:true});await writeFile(file,bytes);break}catch(e){if(attempt===2)errors.push({path,error:e.message})}}}if(bytes)records.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),sourceManifest:manifest.paths[path]});if(++done%25===0)console.log(JSON.stringify({done,remaining:paths.length,bytes:records.reduce((s,r)=>s+r.bytes,0),seconds:Math.round((Date.now()-started)/1000)}));}}
await Promise.all(Array.from({length:4},()=>worker()));records.sort((a,b)=>a.path.localeCompare(b.path));await writeFile(new URL(`frames-${mode}.json`,evidence),JSON.stringify({mode,records,errors},null,2));console.log(JSON.stringify({done,bytes:records.reduce((s,r)=>s+r.bytes,0),errors}));if(errors.length)process.exitCode=1;
