import {INSPECTION_TOOL_SCHEMAS} from './inspection-schema.mjs';
// Deliberately small JSON Schema vocabulary: also validated without a dependency.
const str = {type:'string', minLength:1, maxLength:4096};
const num = {type:'number'};
const pos = {type:'number', exclusiveMinimum:0};
const nonneg = {type:'number', minimum:0};
const uint = {type:'integer', minimum:0};
const integer = {type:'integer', minimum:1};
const bool = {type:'boolean'};
const array = (items, minItems=0) => ({type:'array', items, minItems, maxItems:10000});
const obj = (properties, required=[]) => ({type:'object', properties, required, additionalProperties:false});
const rect = obj({x:num,y:num,width:pos,height:pos}, ['x','y','width','height']);
const color = {type:'string',pattern:'^#[0-9a-fA-F]{6}$'};
const point = obj({beat:nonneg,frame:uint}, ['beat','frame']);
const target = obj({
  id:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,80}$'}, width:integer,height:integer,
  safeArea:rect,crop:rect,maxBytes:integer,loudness:{type:'number',minimum:-70,maximum:-5},
  truePeak:{type:'number',minimum:-9,maximum:0},posterBeat:nonneg
}, ['id','width','height']);
const source = obj({
  id:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,80}$'},kind:{enum:['web','gameboy','video','image','audio']},
  path:str, metadataPath:str,fps:pos,pixelArt:bool,sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},
  variants:array(obj({target:str,path:str,metadataPath:str}, ['target','path']))
}, ['id','kind','path']);
const transition = obj({
  type:{enum:['cut','dither','scanline-tear','glitch','match-cut','flash']}, beats:nonneg,
  pixelScale:integer,sourceRect:rect,targetRect:rect,rectSelector:str,zoomStartBeat:nonneg,
  // The CRUCIBLE reference preserves its original drop/head durations.
  referenceEffect:{enum:['cut','drop','glitch-in','tear','dither-in']}
}, ['type']);
const text = obj({
  lines:array(str,1),font:str,fontSize:integer,scale:integer,color:color,background:color,
  typingCps:pos,flicker:bool,x:num,y:num
}, ['lines','font']);
const shot = obj({
  id:str,startBeat:nonneg,beats:pos,kind:{enum:['video','image','pair','card','opening','end']},
  source:str,secondSource:str,in:nonneg,out:nonneg,speed:nonneg,ramp:array(point,2),rampVariants:array(obj({target:str,ramp:array(point,2)},['target','ramp'])),
  holdFrame:uint,transition,text,caption:text,
  fit:{enum:['contain','cover','integer']},pixelScale:integer,crop:rect,
  energy:bool,stutter:bool,shake:bool
}, ['id','startBeat','beats','kind']);
const layer = obj({
  id:str,source:str,role:{enum:['bed','sfx','riser']},startBeat:nonneg,beats:pos,
  in:nonneg,out:nonneg,gain:nonneg,fadeIn:nonneg,fadeOut:nonneg,fadeOutAt:nonneg,
  duck:array(obj({startBeat:nonneg,beats:pos,gain:nonneg,attack:nonneg,release:nonneg},['startBeat','beats','gain']))
}, ['id','source','role','startBeat']);
const tempo = obj({
  bpm:pos,beatSeconds:pos,firstDownbeat:nonneg,beats:array(nonneg,2),
  audioSource:str,mode:{enum:['declared','detected']},onsets:array(nonneg)
});
const reference = obj({
  profile:{enum:['crucible-v3']},capturesRoot:str,font:str,
  title:str,subtitle:str,url:str,handle:str
}, ['profile','capturesRoot','font','title','subtitle','url','handle']);
export const TIMELINE_SCHEMA = {
  $schema:'https://json-schema.org/draft/2020-12/schema',
  $id:'https://keel.local/private/trailer/timeline-v1.schema.json',
  title:'KEEL Trailer timeline v1',
  ...obj({
    version:{const:1},name:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,80}$'},fps:integer,seed:uint,tempo,
    sources:array(source,1),shots:array(shot,1),audio:array(layer),
    targets:array(target,1),background:color,reference,brief:str
  }, ['version','name','fps','tempo','sources','shots','targets'])
};
const button = {enum:['a','b','start','select','up','down','left','right']};
const event = obj({
  frame:uint,side:{enum:['host','guest']},action:{enum:['press','release','write','mark']},
  button,address:uint,bank:uint,value:uint,name:str
}, ['frame','action']);
const hook = obj({bank:uint,readHook:uint,currentByte:uint}, ['bank','readHook','currentByte']);
export const CAPTURE_SCHEMA = obj({
  adapter:{enum:['web','gameboy','video','image']},options:{type:'object',additionalProperties:true},
  path:str,url:str,cinematicFlag:str,width:integer,height:integer,fps:pos,frames:integer,
  epoch:str,readySelector:str,readyAttribute:str,readyValue:str,readyFrames:uint,seed:uint,
  rectSelectors:array(str),stateAttributes:array(str),inspectionFrames:array(uint),probeGlobal:str,
  steps:array(obj({frame:uint,action:{enum:['click','scroll','mark']},selector:str,x:num,y:num,name:str,endFrame:uint,fromX:num,fromY:num},['frame','action'])),
  rom:str,guestRom:str,symbolsPath:str,reads:array(obj({name:str,address:uint,bank:uint,symbol:str,side:{enum:['host','guest']}},['name'])),
  events:array(event),link:obj({host:hook,guest:hook},['host','guest']),
  cgb:bool,warmupFrames:uint
}, ['adapter']);
const timelineInput = obj({timeline:TIMELINE_SCHEMA,timelinePath:str});
export const TOOL_SCHEMAS = {
  ...INSPECTION_TOOL_SCHEMAS,
  'trailer-plan':obj({brief:str,sources:array(source,1),bpm:pos,durationBeats:pos,targets:array(target,1),font:str},['brief','sources']),
  'trailer-capture':obj({capture:CAPTURE_SCHEMA,outDir:str},['capture','outDir']),
  'trailer-beats':obj({audioPath:str,bpm:pos,beatSeconds:pos,firstDownbeat:nonneg,beats:array(nonneg,2),outPath:str},['audioPath']),
  'trailer-render':obj({...timelineInput.properties,outDir:str,preview:bool,targets:array(str,1),remote:{enum:['yuna-mbp']}},['outDir']),
  'trailer-verify':obj({...timelineInput.properties,renderDir:str,attackToleranceMs:pos,loudnessTolerance:pos},['renderDir']),
  'trailer-stills':obj({...timelineInput.properties,outDir:str,times:array(nonneg,1),targets:array(str,1),remote:{enum:['yuna-mbp']}},['outDir','times'])
};
export function schemaIssues(value, schema, at='$', issues=[]) {
  if (schema.const !== undefined && value !== schema.const) issues.push({path:at,message:'wrong constant'});
  if (schema.enum && !schema.enum.includes(value)) issues.push({path:at,message:'unsupported value'});
  const type = schema.type;
  const good = type === undefined || (type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : type === 'array' ? Array.isArray(value)
    : type === 'integer' ? Number.isSafeInteger(value)
    : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
    : typeof value === type);
  if (!good) { issues.push({path:at,message:'expected '+type}); return issues; }
  if (type === 'object') {
    for (const k of schema.required ?? []) if (!(k in value)) issues.push({path:at+'.'+k,message:'required'});
    for (const [k,v] of Object.entries(value)) {
      if (schema.properties?.[k]) schemaIssues(v,schema.properties[k],at+'.'+k,issues);
      else if (schema.additionalProperties === false) issues.push({path:at+'.'+k,message:'unknown field'});
    }
  }
  if (type === 'array') {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) issues.push({path:at,message:'array length out of range'});
    value.forEach((v,i)=>schemaIssues(v,schema.items,at+'['+i+']',issues));
  }
  if (typeof value === 'number' && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity) || (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum))) issues.push({path:at,message:'number out of range'});
  if (typeof value === 'string' && (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) issues.push({path:at,message:'invalid string'});
  return issues;
}
export function assertSchema(value,schema) {
  const issues=schemaIssues(value,schema);
  if(issues.length) throw Object.assign(new Error(JSON.stringify({code:'INVALID_SCHEMA',issues})),{issues});
  return value;
}
export function validateTimeline(t) {
  const issues=schemaIssues(t,TIMELINE_SCHEMA);
  if(issues.length) return {valid:false,issues};
  const err=(path,message)=>issues.push({path,message});
  const unique=(entries,path)=>{ const ids=new Set(); entries.forEach((x,i)=>{if(ids.has(x.id))err(path+'['+i+'].id','duplicate');ids.add(x.id);});return ids;};
  const ids=unique(t.sources,'$.sources');unique(t.shots,'$.shots');unique(t.targets,'$.targets');unique(t.audio??[],'$.audio');
  const tm=t.tempo;
  if(!tm.bpm && !tm.beatSeconds && !tm.beats && !tm.audioSource) err('$.tempo','provide bpm, beatSeconds, explicit beats, or audioSource');
  if(tm.bpm && tm.beatSeconds && Math.abs(60/tm.bpm-tm.beatSeconds)>1e-9) err('$.tempo','bpm and beatSeconds disagree');
  if(tm.onsets && tm.onsets.some((x,i)=>i && x<tm.onsets[i-1]))err('$.tempo.onsets','must be sorted');
  if(tm.beats && tm.beats.some((x,i)=>i && x<=tm.beats[i-1]))err('$.tempo.beats','must strictly increase');
  if(tm.audioSource && !t.sources.some(x=>x.id===tm.audioSource && x.kind==='audio'))err('$.tempo.audioSource','must refer to audio');
  let end=0;
  t.shots.forEach((s,i)=>{
    const at='$.shots['+i+']';
    if(Math.abs(s.startBeat-end)>1e-8)err(at+'.startBeat','shots must cover the timeline consecutively without gaps or overlap');
    end=s.startBeat+s.beats;
    if(s.kind==='card' && !s.text)err(at+'.text','card requires text');
    if(s.kind!=='card' && (!s.source || !ids.has(s.source)))err(at+'.source','unknown source');
    if(s.source && t.sources.find(x=>x.id===s.source)?.kind==='audio')err(at+'.source','visual shot cannot use audio');
    if(s.kind==='pair' && (!s.secondSource || !ids.has(s.secondSource)))err(at+'.secondSource','pair requires second source');
    if(['opening','end'].includes(s.kind) && !t.reference)err(at+'.kind','requires crucible-v3 profile');
    if(!t.reference && ['energy','stutter','shake'].some(k=>s[k]))err(at,'energy/stutter/shake belong to the reference profile; use declared transitions or ramps in generic edits');
    if(s.in !== undefined && s.out !== undefined && s.out<=s.in)err(at+'.out','must exceed in');
    for(const v of s.rampVariants??[]){
      if(!t.targets.some(t=>t.id===v.target))err(at+'.rampVariants','unknown target');
      if(v.ramp[0].beat!==0 || v.ramp.at(-1).beat!==s.beats || v.ramp.some((p,j)=>j && p.beat<=v.ramp[j-1].beat))err(at+'.rampVariants','ramp must span 0..beats in increasing order');
    }
    if(s.ramp && (s.ramp[0].beat!==0 || s.ramp.at(-1).beat!==s.beats || s.ramp.some((p,j)=>j && p.beat<=s.ramp[j-1].beat)))err(at+'.ramp','ramp must span 0..beats in increasing beat order');
    if(s.transition?.type==='match-cut' && !(s.transition.sourceRect || s.transition.rectSelector))err(at+'.transition','match-cut requires sourceRect or rectSelector');
    if(s.transition?.type==='match-cut' && !s.transition.targetRect)err(at+'.transition.targetRect','required');
    if(s.transition?.beats>s.beats)err(at+'.transition.beats','transition exceeds shot');
    if(s.transition?.zoomStartBeat!==undefined && s.transition.zoomStartBeat>=s.beats)err(at+'.transition.zoomStartBeat','must precede shot end');
  });
  for(const [i,l] of (t.audio??[]).entries()) {
    if(!t.sources.some(x=>x.id===l.source && x.kind==='audio'))err('$.audio['+i+'].source','must refer to audio');
    if(l.startBeat>=end)err('$.audio['+i+'].startBeat','outside timeline');
    if(l.in!==undefined && l.out!==undefined && l.out<=l.in)err('$.audio['+i+'].out','must exceed in');
  }
  for(const [i,o] of t.targets.entries()) {
    if(o.width%2 || o.height%2)err('$.targets['+i+']','H.264 dimensions must be even');
    const r=o.safeArea;
    if(r && (r.x<0 || r.y<0 || r.x+r.width>o.width || r.y+r.height>o.height))err('$.targets['+i+'].safeArea','outside output');
    if(o.posterBeat!==undefined && o.posterBeat>=end)err('$.targets['+i+'].posterBeat','outside timeline');
  }
  return {valid:issues.length===0,issues};
}
export function assertTimeline(t) {
  const r=validateTimeline(t);if(!r.valid)throw Object.assign(new Error(JSON.stringify({code:'INVALID_TIMELINE',issues:r.issues})),{issues:r.issues});return t;
}
