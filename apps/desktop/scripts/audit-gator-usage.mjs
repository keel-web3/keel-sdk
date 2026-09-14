/** Audit actual asset references; never infer unused layers from a random sample. */
import {readFile,writeFile} from 'node:fs/promises';
import {gatorStack,gatorTrait} from '@keel/sdk/gator-assembly';
const {manifest:art}=JSON.parse(await readFile('/tmp/keel-gator-original-manifest.json','utf8'));
const assembly=art.assembly,files=assembly.files,config=assembly.config;
const folders={};for(const f of files){const [folder,name]=f.path.split('/');(folders[folder]??=[]).push(name);}Object.values(folders).forEach(a=>a.sort());
const attributes=art.attributes.map(a=>({...a,items:a.items.filter(i=>i.weight>0)}));
const possible=new Set();const mark=p=>{if(files.some(f=>f.path===p))possible.add(p);};
for(const a of attributes){const spec=config.attributes[a.name];for(const i of a.items)for(const folder of [spec.main,...spec.addons]){const file=folders[folder]?.find(f=>gatorTrait(f)===i.name);if(!file)continue;const parts=file.split('_');const layer=file.endsWith('_Cheetah_.png')&&!parts[3]?'Body':parts.length>4?parts[3]:parts.length===2?parts[0]:parts[2];const type=parts.length>4?parts[2]:parts.length===2?'Background':parts[3];mark((type==='Costume'&&layer==='DepthArm'?'Costume_DepthArm':layer)+'/'+file);}}
// Every dynamic path in the recovered implementation has an explicit dependency here.
for(const match of ['Gamer','Bot','Bot_B','Monster_A','Monster_B']){const file=folders.Patches?.find(f=>f.includes(match));if(file)mark('Patches/'+file);}
const bodies=attributes.find(a=>a.name==='Body').items;for(const i of bodies){const f=folders.Body.find(f=>gatorTrait(f)===i.name);if(f)mark('BodynoHand/'+f);}
mark('Frog/0000_Eyes_UnderEyes_PatchRockFrog.png');
for(const eye of attributes.find(a=>a.name==='Eyes').items.filter(i=>config.TopperEyes.includes(i.name)))for(const hat of attributes.find(a=>a.name==='Hat').items){const file=folders.TopperEyes?.find(f=>f.includes(eye.name+'_'+hat.name));if(file)mark('TopperEyes/'+file);}
const cap=s=>s[0].toUpperCase()+s.slice(1);
for(const a of attributes)for(const item of a.items){const names=[a.name+'_'+cap(item.name)+'.png',...attributes.filter(b=>b.id!==a.id).flatMap(b=>b.items.map(other=>a.name+'_'+cap(item.name)+'_'+cap(other.name)+'.png'))];for(const folder of ['Top','Bottom','Middle','SuperTop'])for(const name of names){const file=folders[folder]?.find(f=>f.toLowerCase()===name.toLowerCase());if(file)mark(folder+'/'+file);}}
// Guard the audit against unreviewed new dependency shapes.
if(Object.keys(config.extras).sort().join(',')!=='Body,Costume,DepthArm'||JSON.stringify(config.extras.Costume)!==JSON.stringify({Pirate:{Body:'BodynoHand'}})||JSON.stringify(config.extras.DepthArm)!=='["Mech"]')throw Error('This configuration requires a new dependency audit.');
const costume=attributes.find(a=>a.name==='Costume');if(costume.items.every(i=>folders.Costume_DepthArm?.some(f=>gatorTrait(f)===i.name)))for(const p of [...possible])if(p.includes('Body_BodyShadow'))possible.delete(p);
const seen=new Map(),failures=[];let checked=0;
function complete(pins){const draw=[];const valid=(item)=>item.rules.every(r=>{const earlier=draw.find(s=>s.attributeId===r.attributeId);return !earlier||(r.mode==='include'?r.itemIds.includes(earlier.itemId):!r.itemIds.includes(earlier.itemId));});
 function walk(at){if(at===attributes.length)return [...draw];const a=attributes[at];for(const i of a.items.filter(i=>!pins[a.id]||pins[a.id]===i.id)){if(!valid(i))continue;draw.push({attributeId:a.id,itemId:i.id,name:i.name});if(attributes.slice(at+1).every(b=>!pins[b.id]||valid(b.items.find(i=>i.id===pins[b.id])))){const result=walk(at+1);if(result)return result;}draw.pop();}return null;}return walk(0);}
function inspect(pins){const draw=complete(pins);if(!draw)return;const metadata=Object.fromEntries(draw.map(s=>[s.attributeId,s.name]));try{const result=gatorStack(assembly,metadata);for(const f of result.stack)if(!seen.has(f.path))seen.set(f.path,metadata);checked++;}catch(e){failures.push({pins,message:e.message});}}
for(let a=0;a<attributes.length;a++)for(let b=a+1;b<attributes.length;b++)for(const x of attributes[a].items)for(const y of attributes[b].items)inspect({[attributes[a].id]:x.id,[attributes[b].id]:y.id});
const unexpected=[...seen.keys()].filter(p=>!possible.has(p));
// A discovered branch not represented by the static analysis is a failure, never an exclusion.
for(const p of unexpected)possible.add(p);
const excludedConditions={
 'Patches/_0000_Body_Patches_Bot_B.png':{body:'bot',costume:'grass-skirt'},
 'TopperEyes/_0000_TopperEyes_Aviators_Tiara.png':{eyes:'aviators',hat:'tiara'},
 'TopperEyes/_0000_TopperEyes_Office Glasses_Tiara.png':{eyes:'office-glasses',hat:'tiara'},
 'TopperEyes/_0000_TopperEyes_VR_Foam Hat.png':{eyes:'vr',hat:'foam-hat'},
 'TopperEyes/_0000_TopperEyes_Star Glasses_Vampire Hair.png':{eyes:'star-glasses',hat:'vampire-hair'},
 'Middle/Body_Gamer_Grass Skirt.png':{body:'gamer',costume:'grass-skirt'},
};
for(const [file,pins]of Object.entries(excludedConditions))if(!complete(pins)&&!seen.has(file))possible.delete(file);
const unproven=[...possible].filter(p=>!seen.has(p));
const report={schema:'keel-gator-usage-audit@1',inventory:files.length,possiblePaths:[...possible].sort(),witnessedPaths:[...seen.keys()].sort(),unusedPaths:files.map(f=>f.path).filter(p=>!possible.has(p)).sort(),unprovenPaths:unproven,unexpectedPaths:unexpected,checkedCombinations:checked,failures,witnesses:Object.fromEntries(seen),excludedConditions,scope:'recovered generator with current enabled traits; keep conditional paths without a witness until reviewed'};
await writeFile('apps/desktop/artifacts/gator-recovery/usage-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify({inventory:files.length,possible:possible.size,witnessed:seen.size,unused:report.unusedPaths.length,unproven,unexpected,checked,failures:failures.slice(0,5)}));
