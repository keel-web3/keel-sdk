import {parseLayeredArt,validLayerTokenId,layeredManifestDigest,layerDigest,canonicalLayerJSON,selectLayeredArt,resolveLayeredArt,type LayeredArt} from './layered-art.js';
export type LayerCandidate={id:string;versionId:string;seed:string;tokenId:string;overrides:Record<string,string>;variantOverrides:Record<string,string>;origin:'generated'|'curated'};
export type LayerCuration={schema:'keel-layer-curation@1';mode:'curated'|'seeded'|'mixed';supply:number;versions:{id:string;manifest:LayeredArt}[];candidates:LayerCandidate[];set:string[];targets:{attributeId:string;itemId:string;count:number}[]};
export function newLayerCuration():LayerCuration{return {schema:'keel-layer-curation@1',mode:'curated',supply:100,versions:[],candidates:[],set:[],targets:[]};}
const keys=(v:any,allowed:string[])=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw Error('Invalid collection workbench record.');};
const digest=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const identity=(v:any)=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const list=(v:any,max:number)=>{if(!Array.isArray(v)||v.length>max)throw Error(`Collection list exceeds ${max} entries.`);return v;};
const positive=(v:any,max:number)=>Number.isInteger(v)&&v>0&&v<=max;
const pins=(v:any)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length>64||Object.entries(v).some(([k,value])=>!identity(k)||!identity(value)))throw Error('Invalid curated trait choices.');return {...v} as Record<string,string>;};
export function parseLayerCuration(value:unknown):LayerCuration{
 const v=value as LayerCuration;keys(v,['schema','mode','supply','versions','candidates','set','targets']);if(v.schema!=='keel-layer-curation@1'||!['curated','seeded','mixed'].includes(v.mode)||!positive(v.supply,100000))throw Error('Invalid collection mode or supply.');
 const versions=list(v.versions,25).map(x=>{keys(x,['id','manifest']);if(!digest(x.id))throw Error('Invalid generator version.');return {id:x.id,manifest:parseLayeredArt(x.manifest)};});
 const candidates=list(v.candidates,5000).map(x=>{keys(x,['id','versionId','seed','tokenId','overrides','variantOverrides','origin']);if(!digest(x.id)||!digest(x.versionId)||!versions.some(v=>v.id===x.versionId)||typeof x.seed!=='string'||x.seed.length>256||/[\u0000-\u001f]/.test(x.seed)||!validLayerTokenId(x.tokenId)||!['generated','curated'].includes(x.origin))throw Error('Invalid generation candidate.');return {...x,overrides:pins(x.overrides),variantOverrides:pins(x.variantOverrides)} as LayerCandidate;});
 const set=list(v.set,5000).map(id=>{if(!candidates.some(c=>c.id===id))throw Error('A set entry is missing from the candidate pool.');return id as string;});
 const targets=list(v.targets,256).map(x=>{keys(x,['attributeId','itemId','count']);if(!identity(x.attributeId)||!identity(x.itemId)||!Number.isInteger(x.count)||x.count<0||x.count>v.supply)throw Error('Invalid rarity target.');return {...x};});
 for(const ids of [versions.map(v=>v.id),candidates.map(c=>c.id),set,targets.map(t=>t.attributeId+'/'+t.itemId)])if(new Set(ids).size!==ids.length)throw Error('Duplicate collection entry.');
 if(set.length>v.supply)throw Error('The set exceeds the planned collection size.');
 const result={schema:v.schema,mode:v.mode,supply:v.supply,versions,candidates,set,targets};if(JSON.stringify(result).length>8_000_000)throw Error('Collection workbench exceeds its saved-data budget.');return result;
}
function validatePins(manifest:LayeredArt,overrides:Record<string,string>,variantOverrides:Record<string,string>){for(const id of [...Object.keys(overrides),...Object.keys(variantOverrides)])if(!manifest.attributes.some(a=>a.id===id))throw Error('A pinned attribute no longer exists.');}
export async function addLayerCandidate(value:unknown,art:unknown,input:{seed:string;tokenId:string;overrides?:Record<string,string>;variantOverrides?:Record<string,string>;origin?:'generated'|'curated'}){
 const state=parseLayerCuration(value),manifest=parseLayeredArt(art),versionId=await layeredManifestDigest(manifest),overrides=pins(input.overrides??{}),variantOverrides=pins(input.variantOverrides??{});
 validatePins(manifest,overrides,variantOverrides);
 const selection=await selectLayeredArt(manifest,input.seed,input.tokenId,overrides,variantOverrides);const rendered=resolveLayeredArt(manifest,selection);if(!rendered.pieces.some(p=>p.placement.opacity>0))throw Error('This candidate has no visible pieces.');
 const body={versionId,seed:input.seed,tokenId:input.tokenId,overrides,variantOverrides},id=await layerDigest(canonicalLayerJSON(body));if(state.candidates.some(c=>c.id===id))return {state,candidate:state.candidates.find(c=>c.id===id)!,added:false};
 const candidate={...body,id,origin:input.origin??'generated' as 'generated'|'curated'};
 return {state:parseLayerCuration({...state,versions:state.versions.some(v=>v.id===versionId)?state.versions:[...state.versions,{id:versionId,manifest}],candidates:[...state.candidates,candidate]}),candidate,added:true};
}
async function resolveParsed(state:LayerCuration,id:string,verified=new Set<string>()){
 const candidate=state.candidates.find(c=>c.id===id);if(!candidate)throw Error('Candidate not found.');const version=state.versions.find(v=>v.id===candidate.versionId)!;
 if(!verified.has(version.id)){if(await layeredManifestDigest(version.manifest)!==version.id)throw Error('This saved generator version has changed.');verified.add(version.id);}
 const {id:_,origin,...body}=candidate;if(await layerDigest(canonicalLayerJSON(body))!==candidate.id)throw Error('This saved candidate has changed.');
 validatePins(version.manifest,candidate.overrides,candidate.variantOverrides);
 const base=await selectLayeredArt(version.manifest,candidate.seed,candidate.tokenId,candidate.overrides,candidate.variantOverrides);
 return {candidate,manifest:version.manifest,...resolveLayeredArt(version.manifest,base)};
}
export async function resolveLayerCandidate(value:unknown,id:string){return resolveParsed(parseLayerCuration(value),id);}
export function assignLayerCandidate(value:unknown,id:string,index?:number){const state=parseLayerCuration(value);if(!state.candidates.some(c=>c.id===id))throw Error('Candidate not found.');const set=state.set.filter(x=>x!==id);const previous=state.set.indexOf(id);const at=index===undefined?set.length:index-(previous>=0&&previous<index?1:0);if(!Number.isInteger(at)||at<0||at>set.length)throw Error('Choose a valid set position.');set.splice(at,0,id);return parseLayerCuration({...state,set});}
export function removeLayerCandidateFromSet(value:unknown,id:string){const state=parseLayerCuration(value);return {...state,set:state.set.filter(x=>x!==id)};}
export async function layerCurationStats(value:unknown,ids?:string[]){const state=parseLayerCuration(value);const verified=new Set<string>();const selected=ids??state.set,counts:Record<string,number>={},compositions=new Set<string>(),failures:{id:string;message:string}[]=[];
 for(const id of selected){try{const r=await resolveParsed(state,id,verified);const pieces=r.pieces.filter(p=>p.placement.opacity>0);for(const s of r.selections.filter(s=>pieces.some(p=>p.attributeId===s.attributeId&&p.itemId===s.itemId))){const key=s.attributeId+'/'+s.itemId;counts[key]=(counts[key]??0)+1;}compositions.add(canonicalLayerJSON({width:r.manifest.width,height:r.manifest.height,background:r.manifest.background,pieces:pieces.map(p=>{const {id,name,rules,...placement}=p.placement;return {objectId:p.objectId,placement};})}));}catch(error){failures.push({id,message:(error as Error).message});}}
 return {count:selected.length,counts,duplicates:selected.length-failures.length-compositions.size,failures,targets:state.targets.map(t=>({...t,actual:counts[t.attributeId+'/'+t.itemId]??0,remaining:t.count-(counts[t.attributeId+'/'+t.itemId]??0)})),proof:'local-curation-only' as const,publicationReady:false};
}

export async function layerCurationPlan(value:unknown){const state=parseLayerCuration(value);const stats=await layerCurationStats(state);if(stats.failures.length)throw Error(stats.failures[0]!.message);return {schema:'keel-curation-plan@1',mode:state.mode,supply:state.supply,workbench:state,allocations:state.set.map((id,index)=>{const candidate=state.candidates.find(c=>c.id===id)!;return {setPosition:index+1,candidateId:id,manifestDigest:candidate.versionId,drawSeed:candidate.seed,drawTokenId:candidate.tokenId,overrides:candidate.overrides,variantOverrides:candidate.variantOverrides};}),unassigned:state.supply-state.set.length,stats,privateAuthoringData:true,publicationReady:false,required:['Creator review of the ordered set and rarity targets','Verified collection allocation adapter preserving each original draw input','Selected-chain module bindings and asset receipts/read-back',...(state.mode!=='curated'?['Verified mint-time seed adapter and frozen curated/generated allocation']:[])],signing:'not-performed'};}
