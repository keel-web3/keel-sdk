import {newLayeredArt,defaultPlacement,parseLayeredArt,type LayeredArt} from './layered-art.js';
import {parseGatorAssembly,gatorTrait,type GatorAssembly} from './gator-assembly.js';
export type GatorMetadataNames=Record<string,{name?:string;items?:Record<string,string>}>;
/** Published names are presentation labels. Stable IDs and original stack inputs stay intact. */
export function applyGatorMetadataNames(value:unknown,names:GatorMetadataNames):LayeredArt{
 const art=parseLayeredArt(value);if(!art.assembly)throw Error('Choose a Gator assembly before matching metadata names.');
 const bindings=art.assembly.sourceNames??{};
 for(const name of Object.keys(names))if(!Object.hasOwn(art.assembly.config.attributes,name))throw Error('Unknown source attribute '+name);
 for(const attribute of art.attributes){
  const previous=bindings[attribute.id],source=previous?.attribute??attribute.name,labels=names[source];
  const items=Object.fromEntries(attribute.items.map(item=>[item.id,previous?.items[item.id]??item.name]));
  bindings[attribute.id]={attribute:source,items};
  if(labels?.name!==undefined)attribute.name=labels.name;
  for(const item of attribute.items){const label=labels?.items?.[items[item.id]!];if(label!==undefined)item.name=label;}
 }
 art.assembly.sourceNames=bindings;return parseLayeredArt(art);
}
/** Import data, never execute a legacy repository or infer mint/publication authority. */
export function importGatorLayers(config:any,files:GatorAssembly['files'],renderer:string){
 if(!config||!config.weight||typeof config.weight!=='object')throw Error('Choose the original generatorConfig.json.');
 const assembly=parseGatorAssembly({kind:'token-gators@1',config:{stack:config.stack,TopperEyes:config.TopperEyes,extras:config.extras,attributes:config.attributes},files});
 const slug=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'none';const notes:string[]=[];
 const art:LayeredArt={...newLayeredArt('Token Gators · recovered generator'),assembly,width:1024,height:1024};
 for(const name of ['Background','Body','Eyes','Mouth','Hat','Costume']){
  const spec=assembly.config.attributes[name]!;const main=files.filter(f=>f.path.startsWith(spec.main+'/')).sort((a,b)=>a.path.localeCompare(b.path,'en'));
  const items=main.map(file=>{const trait=gatorTrait(file.path.split('/')[1]!);if(!trait)throw Error('A source layer has no trait name: '+file.path);const weight=name==='Background'?1:config.weight[name]?.[trait]?.weight;
   if(weight===undefined)notes.push(`${name} / ${trait}: image exists without a configured weight; disabled until its weight is chosen.`);
   const related=[file,...spec.addons.filter(Boolean).flatMap(folder=>{const other=files.filter(f=>f.path.startsWith(folder+'/')).sort((a,b)=>a.path.localeCompare(b.path,'en')).find(f=>gatorTrait(f.path.split('/')[1]!)===trait);return other?[other]:[];})];
   return {id:slug(trait),name:trait,weight:weight===undefined?0:Math.round(weight*1000000),variants:[{id:'original',name:'Original',objectId:file.objectId,weight:1}],placements:related.map((f,i)=>({...defaultPlacement('part-'+i,0),name:f.path})),rules:[],usage:{scope:'renderer' as const,renderer,license:'',tags:['token-gators']}};});
  for(const trait of Object.keys(config.weight[name]??{}))if(!items.some(i=>i.name===trait))notes.push(`${name} / ${trait}: weight exists without an image in the active layer folder.`);
  art.attributes.push({id:slug(name),name,items});
 }
 // Turn exclusions in either direction into constraints on the later selected attribute.
 for(const [sourceName,entries] of Object.entries(config.exclusions??{}) as [string,any][]){const a=art.attributes.find(a=>a.name.toLowerCase()===sourceName.toLowerCase());if(!a)throw Error('Unknown exclusion attribute '+sourceName);
  for(const [trait,conditions] of Object.entries(entries) as [string,any][]){const item=a.items.find(i=>i.name.toLowerCase()===trait.toLowerCase());if(!item){notes.push(`Unmatched exclusion: ${sourceName} / ${trait}`);continue;}
   for(const condition of conditions){const b=art.attributes.find(b=>b.name.toLowerCase()===condition.type.toLowerCase());if(!b||!Array.isArray(condition.items))throw Error('Invalid legacy exclusion');for(const otherName of condition.items){const other=b.items.find(i=>i.name.toLowerCase()===otherName.toLowerCase());if(!other){notes.push(`Unmatched exclusion: ${condition.type} / ${otherName}`);continue;}const [earlier,earlierItem,laterItem]=art.attributes.indexOf(a)<art.attributes.indexOf(b)?[a,item,other]:[b,other,item];let rule=laterItem.rules.find(r=>r.attributeId===earlier.id);if(!rule){rule={attributeId:earlier.id,itemIds:[],mode:'exclude'};laterItem.rules.push(rule);}if(!rule.itemIds.includes(earlierItem.id))rule.itemIds.push(earlierItem.id);}}
  }
 }
 notes.unshift('Background had no weight table; retain uniform background selection.','Weights are normalized over eligible available traits. Seeds use KEEL deterministic selection, not legacy Math.random.','Restored quoted Cheetah and Captain\'s Hat filenames. Missing folders are empty, not missing artwork.');
 return {manifest:parseLayeredArt(art),notes,source:'recovered-token-gators-server',proof:'local-import-only',publicationReady:false};
}
