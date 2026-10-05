import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {realpath,stat,lstat,readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {assertTimeline,assertSchema,TOOL_SCHEMAS,validateTimeline,TIMELINE_SCHEMA,CAPTURE_SCHEMA} from './schema.mjs';
import {editSeconds,beatToSeconds} from './timing.mjs';
import {captureWithAdapter,registerCaptureAdapter} from './adapters/index.mjs';
export {validateTimeline,TIMELINE_SCHEMA,TOOL_SCHEMAS,CAPTURE_SCHEMA,registerCaptureAdapter};
export {beatToSeconds,editSeconds,boundaryFrame,sourceFrame} from './timing.mjs';
const packageRoot=fileURLToPath(new URL('../',import.meta.url));
function inside(root,file) {
  const rel=path.relative(root,file);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Path must stay inside trailer workspace: '+file);
  return file;
}
async function file(root,base,p) {
  if(typeof p!=='string'||!p||/[\0\r\n]/.test(p))throw Error('Invalid file path');
  const candidate=inside(root,path.resolve(base,p));const resolved=inside(root,await realpath(candidate));
  if(!(await stat(resolved)).isFile())throw Error('Expected a file: '+p);return resolved;
}
async function noSymlinks(dir) {
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    if(entry.isSymbolicLink())throw Error('Output directory contains a symlink: '+entry.name);
    if(entry.isDirectory())await noSymlinks(path.join(dir,entry.name));
  }
}
async function output(root,p) {
  const candidate=inside(root,path.resolve(root,p));
  let parent=candidate;
  for(;;){try{inside(root,await realpath(parent));break;}catch(e){if(e.code!=='ENOENT')throw e;parent=path.dirname(parent);}}
  await mkdir(candidate,{recursive:true});inside(root,await realpath(candidate));await noSymlinks(candidate);return candidate;
}
export async function runWorker(op,input,{python=process.env.TRAILER_PYTHON??'python3',log=()=>{},signal}={}) {
  return new Promise((resolve,reject)=>{
    const proc=spawn(python,[path.join(packageRoot,'python/worker.py'),op],{stdio:['pipe','pipe','pipe'],signal});
    const out=[];let error='';
    proc.stdout.on('data',b=>out.push(b));proc.stderr.on('data',b=>{error=(error+b.toString()).slice(-12000);log(b.toString());});
    proc.once('error',reject);proc.once('close',code=>{
      let value;try{value=JSON.parse(Buffer.concat(out).toString());}catch{reject(Error('Trailer worker failed; install requirements.txt and ffmpeg. '+error));return;}
      if(code!==0)reject(Object.assign(Error(value.error?.message??error),{result:value}));else resolve(value);
    });proc.stdin.on('error',()=>{});proc.stdin.end(JSON.stringify(input));
  });
}
export function checkLoad(operation) {
  const oneMinute=os.loadavg()[0];
  if(oneMinute>40)throw Object.assign(Error('Mac load exceeds 40; offload '+operation+' to ssh yuna-mbp using the private offload helper.'),{code:'OFFLOAD_REQUIRED',load:oneMinute});
  return oneMinute;
}
function plan(x) {
  const visuals=x.sources.filter(s=>s.kind!=='audio');if(!visuals.length)throw Error('At least one visual source is required');
  const audio=x.sources.find(s=>s.kind==='audio');const total=x.durationBeats??64;let shots=[];let start=0;
  const count=visuals.length+(x.font?1:0),beats=total/count;
  for(const [i,s] of visuals.entries()){shots.push({id:'shot-'+(i+1),startBeat:start,beats,kind:s.kind==='image'?'image':'video',source:s.id,in:0,fit:(s.pixelArt??s.kind==='gameboy')?'integer':'contain',transition:{type:i?'dither':'cut',beats:Math.min(.25,beats),pixelScale:1}});start+=beats;}
  if(x.font)shots.push({id:'end-card',startBeat:start,beats,kind:'card',text:{lines:[x.brief],font:x.font,fontSize:8,scale:4,typingCps:40},transition:{type:'glitch',beats:Math.min(.25,beats),pixelScale:4}});
  const t={version:1,name:'launch-trailer',brief:x.brief,fps:30,seed:7,
    tempo:x.bpm?{bpm:x.bpm,...(audio?{audioSource:audio.id}:{})}:audio?{audioSource:audio.id,mode:'detected'}:{bpm:120},
    sources:x.sources,shots,audio:audio?[{id:'bed',source:audio.id,role:'bed',startBeat:0,beats:total,gain:1,fadeIn:.05,fadeOut:1.2}]:[],
    targets:x.targets??[{id:'16x9',width:1920,height:1080,maxBytes:14500000,loudness:-14,truePeak:-1.5},{id:'9x16',width:1080,height:1920,maxBytes:14500000,loudness:-14,truePeak:-1.5},{id:'1x1',width:1080,height:1080,maxBytes:14500000,loudness:-14,truePeak:-1.5}]};
  assertTimeline(t);return {timeline:t,notes:['Scaffold uses available sources in order. Replace in/out and ramp points using capture metadata.',
    'The brief is stored as creative direction; this tool does not call a language model.',...(!audio?['120 BPM is a declared placeholder. Supply original project audio before attack verification.']:[])]};
}
async function resolveTimeline(root,x,context) {
  let t,base=root;
  if((x.timeline===undefined)===(x.timelinePath===undefined))throw Error('Provide exactly one of timeline or timelinePath');
  if(x.timelinePath){const p=await file(root,root,x.timelinePath);base=path.dirname(p);t=JSON.parse(await readFile(p,'utf8'));}
  else t=structuredClone(x.timeline);
  assertTimeline(t);
  for(const s of t.sources){
    if(s.pixelArt===undefined && s.kind==='gameboy')s.pixelArt=true;
    s.path=await file(root,base,s.path);if(s.metadataPath)s.metadataPath=await file(root,base,s.metadataPath);
    for(const v of s.variants??[]){v.path=await file(root,base,v.path);if(v.metadataPath)v.metadataPath=await file(root,base,v.metadataPath);}
    if(s.sha256){const hash=createHash('sha256').update(await readFile(s.path)).digest('hex');if(hash!==s.sha256)throw Error('Source digest mismatch: '+s.id);}
  }
  for(const s of t.shots)for(const text of [s.text,s.caption])if(text)text.font=await file(root,base,text.font);
  if(t.reference){
    const r=t.reference;r.font=await file(root,base,r.font);
    r.capturesRoot=inside(root,await realpath(inside(root,path.resolve(base,r.capturesRoot))));
    const cap=r.capturesRoot;
    for(const rel of ['game/title.json','game/title.mkv','site/site-1920x1080.json','site/site-1920x1080.mkv',
      ...t.targets.flatMap(o=>['site/site-'+o.width+'x'+o.height+'-opening.json','site/site-'+o.width+'x'+o.height+'-opening.mkv'])])
      await file(root,cap,rel);
    if(t.tempo.beats)throw Error('CRUCIBLE v3 reference requires its constant beat period');
    const audio=t.sources.find(s=>s.id===t.tempo.audioSource);
    if(!audio)throw Error('Reference requires the original audio source');
  }
  if(!t.tempo.bpm&&!t.tempo.beatSeconds&&!t.tempo.beats){
    const s=t.sources.find(s=>s.id===t.tempo.audioSource);
    const analyzed=await runWorker('beats',{audioPath:s.path},context);t.tempo={...analyzed.tempo,audioSource:s.id};
  }
  for(const layer of t.audio??[])if(layer.role==='bed' && layer.source===t.tempo.audioSource && layer.in===undefined)layer.in=beatToSeconds(t.tempo,0);
  return t;
}
export async function runTrailerTool(name,input,{workspaceRoot='.',python,log,signal,checkMachineLoad=true,allowOffload=true}={}) {
  if(!TOOL_SCHEMAS[name])throw Error('Unknown trailer tool: '+name);
  assertSchema(input,TOOL_SCHEMAS[name]);const x=structuredClone(input);
  if(name==='trailer-plan')return plan(x);
  const root=await realpath(workspaceRoot);const context={...(python?{python}:{}),...(log?{log}:{}),...(signal?{signal}:{})};
  if(checkMachineLoad&&name==='trailer-capture')checkLoad(name);
  if(name==='trailer-beats'){
    x.audioPath=await file(root,root,x.audioPath);
    const result=await runWorker('beats',x,context);
    if(x.outPath){const dest=inside(root,path.resolve(root,x.outPath));await output(root,path.dirname(dest));try{if((await lstat(dest)).isSymbolicLink())throw Error('Cannot write beats to a symlink');}catch(e){if(e.code!=='ENOENT')throw e;}await writeFile(dest,JSON.stringify(result,null,2)+'\n');}
    return result;
  }
  if(name==='trailer-capture'){
    const c=x.capture;
    for(const k of ['path','rom','guestRom','symbolsPath'])if(c[k])c[k]=await file(root,root,c[k]);
    if(c.adapter==='web'&&!c.url)throw Error('Web capture requires url');
    if(c.adapter==='gameboy'&&!c.rom)throw Error('Game Boy capture requires rom');
    if(['video','image'].includes(c.adapter)&&!c.path)throw Error('File capture requires path');
    for(const e of c.events??[]){
      if(e.action==='press'||e.action==='release'){if(!e.button)throw Error('Input event requires button');}
      if(e.action==='write'&&(e.address===undefined||e.value===undefined||e.address>65535||e.value>255))throw Error('Memory write requires 16-bit address and byte value');
      if(e.side==='guest'&&!c.guestRom)throw Error('Guest input requires guestRom');
      if(e.frame>=(c.frames??600))throw Error('Input event falls outside capture');
    }
    for(const r of c.reads??[]){if(r.address===undefined&&!r.symbol)throw Error('Read requires address or symbol');if(r.side==='guest'&&!c.guestRom)throw Error('Guest read requires guestRom');}
    x.outDir=await output(root,x.outDir);
    return captureWithAdapter(c,x.outDir,{worker:(op,data)=>runWorker(op,data,context)});
  }
  x.timeline=await resolveTimeline(root,x,context);delete x.timelinePath;
  if(x.targets && x.targets.some(id=>!x.timeline.targets.some(t=>t.id===id)))throw Error('Unknown target');
  if(name==='trailer-stills'){
    const end=x.timeline.shots.at(-1);const total=editSeconds(x.timeline.tempo,end.startBeat+end.beats);
    if(x.times.some(t=>t>=total))throw Error('Still time falls outside timeline');
  }
  if(x.outDir)x.outDir=await output(root,x.outDir);
  if(x.renderDir){
    x.renderDir=await output(root,x.renderDir);
    const manifest=JSON.parse(await readFile(await file(root,x.renderDir,'render.json'),'utf8'));
    for(const item of manifest.outputs){
      // Never trust artifact paths supplied by an edited render manifest.
      item.path=await file(root,x.renderDir,item.path);
      inside(x.renderDir,item.path);
      if(!x.timeline.targets.some(t=>t.id===item.target))throw Error('Manifest has unknown target');
    }
  }
  if(['trailer-render','trailer-stills'].includes(name) && (x.remote || (checkMachineLoad && os.loadavg()[0]>40))) {
    if(!allowOffload){checkLoad(name);throw Error("Remote offload is disabled in this worker");}
    const {offload}=await import('./offload.mjs');
    return offload(name.slice('trailer-'.length),x,context);
  }
  return runWorker(name.slice('trailer-'.length),x,context);
}
