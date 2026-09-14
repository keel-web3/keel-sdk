import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../original/',import.meta.url);
const base='https://qsiyevbhujiucs4qarcdf2jibzph4bvl2dua2xwhdvckgixq3sla.ar.io/hJGCVCeiUUFLkAREMukoDl5-BqvQ6A1exx1EoyLw3JY/';
const paths=['index.html','js/js.js','js/settings.js','js/asyncpool.js','js/timings.js','manifest.json'];let records=[];
for(const path of paths){const url=new URL(path==='index.html'?'':path,base).href;const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`${r.status} ${path}`);const data=Buffer.from(await r.arrayBuffer());const file=new URL(path,root);await mkdir(new URL('.',file),{recursive:true});await writeFile(file,data);records.push({path,url,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}
const html=await readFile(new URL('index.html',root),'utf8');const entries=[...html.matchAll(/'(\d+)'\s*:\s*\{frames\s*:\s*(\d+),\s*var\s*:\s*(true|false)/g)].map(m=>({id:Number(m[1]),frames:Number(m[2]),variation:m[3]==='true'}));
await writeFile(new URL('../evidence/source.json',import.meta.url),JSON.stringify({base,contract:'0xac7e693f337739b195a5eef321aa62921d314085',records,editions:entries},null,2));console.log(JSON.stringify({records,editions:entries}));
