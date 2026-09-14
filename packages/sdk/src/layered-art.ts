import {parseGatorAssembly,gatorStack,type GatorAssembly} from './gator-assembly.js';
import {sha256} from 'viem';
/** Shared, browser-safe authoring and deterministic composition rules. No I/O or wallet authority. */
export const LAYERED_ART_PROTOCOL = 'keel-layered-art@1' as const;
export type Point = [number, number];
export type Rule = { attributeId: string; itemIds: string[]; mode: 'include' | 'exclude' };
export type LayerPlacement = { id: string; name: string; slot: number; x: number; y: number; width: number; height: number; rotation: number; opacity: number; mask: Point[]; mesh: { source: Point[]; target: Point[]; triangles: [number, number, number][] } | null; rules: Rule[] };
export type LayerItem = { id: string; name: string; weight: number; variants: { id: string; name: string; objectId: string; weight: number }[]; placements: LayerPlacement[]; rules: Rule[]; usage: { scope: 'ask' | 'renderer' | 'public'; renderer: string; license: string; tags: string[] } };
export type LayerExceptionAction = { kind: 'move'; attributeId: string; itemId: string; placementId?: string; slot: number } | { kind: 'hide'; attributeId: string; itemId: string; placementId?: string } | { kind: 'include'; attributeId: string; itemId: string; variantId: string } | { kind: 'replace'; attributeId: string; itemId: string; variantId: string };
export type LayerException = { id: string; name: string; enabled: boolean; match: 'all' | 'any'; conditions: Rule[]; actions: LayerExceptionAction[] };
export type LayeredArt = { schema: typeof LAYERED_ART_PROTOCOL; name: string; width: number; height: number; format: 'image/png' | 'image/jpeg' | 'image/webp'; quality: number; background: string; seed: string; attributes: { id: string; name: string; items: LayerItem[] }[]; exceptions?: LayerException[]; assembly?:GatorAssembly; reveal: { mode: 'visible' | 'creator' | 'future-block' | 'chainlink'; encrypted: boolean; revealAt: number }; };
export type LayerSelection = { attributeId: string; itemId: string; variantId: string; objectId: string };
export const validLayerTokenId=(value:unknown):value is string=>typeof value==='string'&&/^(0|[1-9]\d{0,77})$/.test(value)&&BigInt(value)<(1n<<256n);
const record = (value: unknown, keys: string[], name: string): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw Error(`Invalid ${name}.`);
  return value as Record<string, any>;
};
const text = (value: unknown, name: string, max = 160): string => { if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f]/.test(value)) throw Error(`Invalid ${name}.`); return value; };
const id = (value: unknown): string => { const result = text(value, 'identity', 100); if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw Error('Use a stable letter/number identity.'); return result; };
const number = (value: unknown, name: string, min: number, max: number, integer = false): number => { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) throw Error(`${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`); return value; };
const array = (value: unknown, name: string, max: number): any[] => { if (!Array.isArray(value) || value.length > max) throw Error(`Invalid ${name}; maximum ${max}.`); return value; };
const unique = (values: { id: string }[], name: string) => { if (new Set(values.map(value => value.id)).size !== values.length) throw Error(`Duplicate ${name} identity.`); };
const point = (value: unknown): Point => { const p = array(value, 'point', 2); if (p.length !== 2) throw Error('A point needs x and y.'); return [number(p[0], 'Point x', -4, 4), number(p[1], 'Point y', -4, 4)]; };
const rules = (value: unknown): Rule[] => array(value, 'rules', 32).map(raw => { const r = record(raw, ['attributeId', 'itemIds', 'mode'], 'rule'); if (!['include', 'exclude'].includes(r.mode)) throw Error('Choose include or exclude.'); return { attributeId: id(r.attributeId), itemIds: array(r.itemIds, 'target items', 128).map(id), mode: r.mode }; });
export function defaultPlacement(identity = 'piece-1', slot = 0): LayerPlacement { return { id: identity, name: 'Whole image', slot, x: 0, y: 0, width: 1, height: 1, rotation: 0, opacity: 1, mask: [], mesh: null, rules: [] }; }
export function newLayeredArt(name = 'My layered collection'): LayeredArt { return { schema: LAYERED_ART_PROTOCOL, name, width: 1024, height: 1024, format: 'image/png', quality: .92, background: '', seed: '1', attributes: [], reveal: { mode: 'visible', encrypted: false, revealAt: 0 } }; }
export function parseLayeredArt(value: unknown): LayeredArt {
  const v = record(value, ['schema','name','width','height','format','quality','background','seed','attributes','reveal','exceptions','assembly'], 'layered artwork');
  if (v.schema !== LAYERED_ART_PROTOCOL || !['image/png','image/jpeg','image/webp'].includes(v.format)) throw Error('Unsupported layered artwork schema or output format.');
  const reveal = record(v.reveal, ['mode','encrypted','revealAt'], 'reveal');
  if (!['visible','creator','future-block','chainlink'].includes(reveal.mode) || typeof reveal.encrypted !== 'boolean') throw Error('Invalid reveal mode.');
  if (reveal.mode === 'visible' && reveal.encrypted) throw Error('Choose a reveal phase before encrypting hidden layers.');
  const background = text(v.background, 'background', 7); if (background && !/^#[0-9a-fA-F]{6}$/.test(background)) throw Error('Use a six-digit background colour.');
  const attributes = array(v.attributes, 'attributes', 64).map(raw => {
    const a = record(raw, ['id','name','items'], 'attribute');
    const items = array(a.items, 'items', 256).map(rawItem => {
      const i = record(rawItem, ['id','name','weight','variants','placements','rules','usage'], 'item');
      const usage = record(i.usage, ['scope','renderer','license','tags'], 'reuse permission');
      if (!['ask','renderer','public'].includes(usage.scope)) throw Error('Choose a reuse scope.');
      const variants = array(i.variants, 'variants', 128).map(rawVariant => {
        const v = record(rawVariant, ['id','name','objectId','weight'], 'variant');
        if (typeof v.objectId !== 'string' || !/^[a-f0-9]{64}$/.test(v.objectId)) throw Error('A variant must refer to original bytes in the workspace.');
        return { id: id(v.id), name: text(v.name,'variant name'), objectId: v.objectId, weight: number(v.weight,'Variant weight',0,1_000_000,true) };
      }); unique(variants, 'variant');
      const placements = array(i.placements, 'pieces', 32).map(rawPlacement => {
        const p = record(rawPlacement, ['id','name','slot','x','y','width','height','rotation','opacity','mask','mesh','rules'], 'piece');
        const mask = array(p.mask, 'boundary vertices', 128).map(point); if (mask.length > 0 && mask.length < 3) throw Error('A closed boundary needs at least three points.');
        let mesh: LayerPlacement['mesh'] = null;
        if (p.mesh !== null) {
          const m = record(p.mesh, ['source','target','triangles'], 'mesh');
          const source = array(m.source,'source vertices',128).map(point), target = array(m.target,'target vertices',128).map(point);
          if (source.length !== target.length || source.length < 3) throw Error('Mesh source and target vertices must match.');
          const triangles = array(m.triangles, 'triangles', 256).map(rawTriangle => { const triangle = array(rawTriangle,'triangle',3); if (triangle.length !== 3) throw Error('A triangle needs three indices.'); const ids = triangle.map(n => number(n,'Vertex index',0,source.length-1,true)) as [number,number,number]; for (const vertices of [source,target]) { const [a,b,c] = ids.map(n => vertices[n]!) as [Point,Point,Point]; if (Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])) < 1e-8) throw Error('Mesh contains a flat triangle.'); } return ids; });
          if (!triangles.length) throw Error('A mesh needs triangles.'); mesh = { source, target, triangles };
        }
        return { id:id(p.id), name:text(p.name,'piece name'), slot:number(p.slot,'Layer slot',-1000,1000,true), x:number(p.x,'X',-4,4), y:number(p.y,'Y',-4,4), width:number(p.width,'Width',.001,8), height:number(p.height,'Height',.001,8), rotation:number(p.rotation,'Rotation',-360,360), opacity:number(p.opacity,'Opacity',0,1), mask, mesh, rules:rules(p.rules) };
      }); unique(placements,'piece');
      return { id:id(i.id), name:text(i.name,'item name'), weight:number(i.weight,'Item weight',0,1_000_000,true), variants, placements, rules:rules(i.rules), usage: { scope:usage.scope, renderer:text(usage.renderer,'renderer identity',256), license:text(usage.license,'license',1000), tags:array(usage.tags,'tags',20).map(tag=>text(tag,'tag',40)) } } as LayerItem;
    }); unique(items,'item'); return { id:id(a.id), name:text(a.name,'attribute name'), items };
  }); unique(attributes,'attribute');
  for (const [index, attribute] of attributes.entries()) for (const item of attribute.items) for (const [condition, itemRule] of [...item.rules.map(r=>[r,true] as const), ...item.placements.flatMap(p=>p.rules.map(r=>[r,false] as const))]) {
    const target = attributes.find(a=>a.id===condition.attributeId);
    if (!target || condition.itemIds.some(id=>!target.items.some(i=>i.id===id))) throw Error('A rule targets a missing attribute or item.');
    if (itemRule && attributes.indexOf(target) >= index) throw Error('Item selection rules must target an earlier attribute. Reorder the attributes first.');
  }
  const result: LayeredArt = { schema:LAYERED_ART_PROTOCOL, name:text(v.name,'name'), width:number(v.width,'Canvas width',16,8192,true), height:number(v.height,'Canvas height',16,8192,true), format:v.format, quality:number(v.quality,'Quality',.1,1), background, seed:text(v.seed,'preview seed',128), attributes, reveal:{mode:reveal.mode,encrypted:reveal.encrypted,revealAt:number(reveal.revealAt,'Reveal time',0,8_640_000_000_000,true)} };
  const exceptions: LayerException[] = v.exceptions === undefined ? [] : array(v.exceptions, 'exceptions', 128).map(raw => {
    const r = record(raw, ['id','name','enabled','match','conditions','actions'], 'exception');
    if (typeof r.enabled !== 'boolean' || !['all','any'].includes(r.match)) throw Error('Choose all or any exception conditions and an enabled state.');
    const conditions = rules(r.conditions);
    if (!conditions.length || conditions.some(c => !c.itemIds.length)) throw Error('An exception needs at least one item condition.');
    for (const c of conditions) { const a = attributes.find(a => a.id === c.attributeId); if (!a || c.itemIds.some(i => !a.items.some(item => item.id === i))) throw Error('An exception condition targets a missing item.'); }
    const actions: LayerExceptionAction[] = array(r.actions, 'exception actions', 32).map(rawAction => {
      const a = record(rawAction, ['kind','attributeId','itemId','placementId','slot','variantId'], 'exception action');
      const attributeId = id(a.attributeId), itemId = id(a.itemId);
      const item = attributes.find(a => a.id === attributeId)?.items.find(i => i.id === itemId);
      if (!item) throw Error('An exception action targets a missing item.');
      if (a.kind === 'include' || a.kind === 'replace') {
        if (a.placementId !== undefined || a.slot !== undefined) throw Error('Include and replace target a whole item.');
        const variantId = id(a.variantId);
        if (!item.variants.some(v => v.id === variantId && v.weight > 0)) throw Error('Choose an available, enabled image variant for this exception.');
        return {kind:a.kind,attributeId,itemId,variantId};
      }
      if (!['move','hide'].includes(a.kind) || a.variantId !== undefined || a.kind === 'hide' && a.slot !== undefined) throw Error('Invalid exception action.');
      const placementId = a.placementId === undefined ? undefined : id(a.placementId);
      if (placementId && !item.placements.some(p => p.id === placementId)) throw Error('An exception targets a missing drawing piece.');
      return {kind:a.kind,attributeId,itemId,...(placementId ? {placementId} : {}),...(a.kind === 'move' ? {slot:number(a.slot,'Exception layer slot',-1000,1000,true)} : {})};
    });
    if (!actions.length) throw Error('An exception needs an action.');
    return {id:id(r.id),name:text(r.name,'exception name'),enabled:r.enabled,match:r.match,conditions,actions};
  });
  unique(exceptions, 'exception');
  // Omission preserves all existing manifest commitments and deterministic draws.
  if (exceptions.length) result.exceptions = exceptions;
  if(v.assembly!==undefined){result.assembly=parseGatorAssembly(v.assembly);const names=result.assembly.sourceNames;
    if(attributes.length!==6||!['Background','Body','Eyes','Mouth','Hat','Costume'].every(name=>attributes.some(a=>(names?.[a.id]?.attribute??a.name)===name)))throw Error('Gator assembly needs its six original attributes.');
    for(const [id,binding]of Object.entries(names??{})){const a=attributes.find(a=>a.id===id);if(!a||Object.keys(binding.items).some(id=>!a.items.some(i=>i.id===id)))throw Error('Gator source binding refers to an absent item.');}
  }
  if(result.width*result.height>33_554_432)throw Error('Canvas exceeds 32 megapixels.');
  if (JSON.stringify(result).length > 2_000_000) throw Error('Layer manifest exceeds the authoring budget.'); return result;
}

export function canonicalLayerJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalLayerJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key=>(value as any)[key]!==undefined).map(key=>`${JSON.stringify(key)}:${canonicalLayerJSON((value as any)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function layerDigest(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  // Inline data-URI viewers may have no SubtleCrypto. Keep the exact same
  // SHA-256 identity and seeded choices in that sandbox using the portable hash.
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return sha256(bytes).slice(2);
  return [...new Uint8Array(await subtle.digest('SHA-256', Uint8Array.from(bytes)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function layeredManifestDigest(value: unknown): Promise<string> { const { seed, ...manifest } = parseLayeredArt(value); return layerDigest(canonicalLayerJSON(manifest)); }
function matches(rules: Rule[], selections: LayerSelection[]): boolean { return rules.every(rule=>{ const selected=selections.find(s=>s.attributeId===rule.attributeId); const hit=!!selected&&rule.itemIds.includes(selected.itemId); return rule.mode==='include'?hit:!hit; }); }
async function weighted<T extends { weight: number }>(values: T[], domain: string): Promise<T> {
  const total=values.reduce((sum,v)=>sum+v.weight,0); if (!total) throw Error('No eligible item with a positive weight.');
  const range=1n<<256n, bound=range-range%BigInt(total);
  for(let nonce=0;;nonce++){const draw=BigInt(`0x${await layerDigest(`${domain}:${nonce}`)}`);if(draw>=bound)continue;let n=Number(draw%BigInt(total));for(const value of values){if(n<value.weight)return value;n-=value.weight;}}
}
export async function selectLayeredArt(value: unknown, seed: string, tokenId = '1', overrides: Record<string,string> = {}, variantOverrides: Record<string,string> = {}): Promise<LayerSelection[]> {
  const manifest=parseLayeredArt(value);text(seed,'seed',256);if(!validLayerTokenId(tokenId))throw Error('Use a token number from zero through uint256 maximum.');
  // A published label correction must not reshuffle an existing seeded collection.
  const drawManifest=parseLayeredArt(manifest),sourceNames=drawManifest.assembly?.sourceNames;
  if(sourceNames){for(const a of drawManifest.attributes){const binding=sourceNames[a.id];if(binding){a.name=binding.attribute;for(const item of a.items)item.name=binding.items[item.id]??item.name;}}delete drawManifest.assembly!.sourceNames;}
  const root=await layeredManifestDigest(drawManifest);const selections:LayerSelection[]=[];
  for(const attribute of manifest.attributes){
    const candidates=attribute.items.filter(item=>item.weight>0&&matches(item.rules,selections));
    const item=overrides[attribute.id]?candidates.find(i=>i.id===overrides[attribute.id]):await weighted(candidates,`${LAYERED_ART_PROTOCOL}:${root}:${seed}:${tokenId}:${attribute.id}:item`);
    if(!item)throw Error(`The selected ${attribute.name} item does not meet its rules.`);
    const variant=variantOverrides[attribute.id]?item.variants.find(v=>v.id===variantOverrides[attribute.id]&&v.weight>0):await weighted(item.variants,`${LAYERED_ART_PROTOCOL}:${root}:${seed}:${tokenId}:${attribute.id}:${item.id}:variant`);
    if(!variant)throw Error('The pinned variant is disabled or unavailable.');
    selections.push({attributeId:attribute.id,itemId:item.id,variantId:variant.id,objectId:variant.objectId});
  }return selections;
}
/** Evaluate every exception against the original draw once; actions never trigger other rules. */
export function resolveLayeredArt(value: unknown, baseSelections: LayerSelection[]) {
  const manifest = parseLayeredArt(value);
  if (baseSelections.length !== manifest.attributes.length || new Set(baseSelections.map(s=>s.attributeId)).size !== baseSelections.length) throw Error('Provide exactly one selection per attribute.');
  for (const a of manifest.attributes) {
    const s = baseSelections.find(s=>s.attributeId===a.id), item = a.items.find(i=>i.id===s?.itemId);
    if (!s || !item || item.weight <= 0 || !item.variants.some(v=>v.id===s.variantId&&v.objectId===s.objectId&&v.weight>0)) throw Error(`Missing or invalid ${a.name} selection.`);
    if (!matches(item.rules,baseSelections)) throw Error('Selection violates an item compatibility rule.');
  }
  const appliedRules = (manifest.exceptions ?? []).filter(r=>r.enabled && (r.match === 'all' ? matches(r.conditions,baseSelections) : r.conditions.some(c=>matches([c],baseSelections))));
  const effects = new Map<string,{value:string;rule:string}>();
  function claim(key:string,value:string,rule:string) { const previous=effects.get(key); if(previous && previous.value!==value) throw Error(`Conflicting exceptions: “${previous.rule}” and “${rule}”. Adjust their conditions or actions.`); effects.set(key,{value,rule}); }
  const additions = new Map<string,LayerSelection>(), replacements = new Map<string,string>(), hidden = new Set<string>(), moved = new Map<string,number>();
  for (const rule of appliedRules) for (const action of rule.actions) {
    const key = `${action.attributeId}/${action.itemId}`, name = rule.name || rule.id;
    const item = manifest.attributes.find(a=>a.id===action.attributeId)!.items.find(i=>i.id===action.itemId)!;
    if (action.kind === 'include' || action.kind === 'replace') {
      if (!matches(item.rules,baseSelections)) throw Error(`Exception “${name}” includes ${item.name}, which does not meet its compatibility conditions.`);
      claim(`presence/${key}`,'show',name); claim(`variant/${key}`,action.variantId,name);
      if(action.kind==='replace'){claim(`replace/${action.attributeId}`,action.itemId,name); replacements.set(action.attributeId,action.itemId);}
      const variant=item.variants.find(v=>v.id===action.variantId)!;
      additions.set(key,{attributeId:action.attributeId,itemId:action.itemId,variantId:variant.id,objectId:variant.objectId});
    } else {
      if(action.kind==='hide'&&!action.placementId){claim(`presence/${key}`,'hide',name);hidden.add(key);}
      for(const p of item.placements.filter(p=>!action.placementId||p.id===action.placementId)) {
        const pieceKey=`${key}/${p.id}`;
        claim(`piece/${pieceKey}`,action.kind==='hide'?'hide':`move:${action.slot}`,name);
        if(action.kind==='hide')hidden.add(pieceKey); else moved.set(pieceKey,action.slot!);
      }
    }
  }
  const selections=baseSelections.filter(s=>!hidden.has(`${s.attributeId}/${s.itemId}`)&&(!replacements.has(s.attributeId)||replacements.get(s.attributeId)===s.itemId)&&!additions.has(`${s.attributeId}/${s.itemId}`));
  selections.push(...additions.values());
  // Stable attribute/item order makes action-list order irrelevant, including equal slots.
  selections.sort((a,b)=>manifest.attributes.findIndex(x=>x.id===a.attributeId)-manifest.attributes.findIndex(x=>x.id===b.attributeId)||manifest.attributes.find(x=>x.id===a.attributeId)!.items.findIndex(i=>i.id===a.itemId)-manifest.attributes.find(x=>x.id===b.attributeId)!.items.findIndex(i=>i.id===b.itemId));
  const pieces:{attributeId:string;itemId:string;objectId:string;placement:LayerPlacement}[]=[];
  if(manifest.assembly){
    const assembly=manifest.assembly;
    // Inclusion adds a second item; only replacement changes the primary stack.
    const primary=baseSelections.map(original=>selections.find(s=>s.attributeId===original.attributeId&&s.itemId===(replacements.get(original.attributeId)??original.itemId))??original);
    const sourceName=(a:LayeredArt['attributes'][number])=>assembly.sourceNames?.[a.id]?.attribute??a.name;
    const metadata=(draw:LayerSelection[])=>Object.fromEntries(draw.map(s=>{const a=manifest.attributes.find(a=>a.id===s.attributeId)!;return [sourceName(a).toLowerCase(),assembly.sourceNames?.[a.id]?.items[s.itemId]??a.items.find(i=>i.id===s.itemId)!.name];}));
    const owner=(file:{path:string})=>{const [folder,name]=file.path.split('/');const attributeName=Object.entries(assembly.config.attributes).find(([,c])=>c.main===folder||c.addons.includes(folder!))?.[0]??name!.replace(/^_?\d+_/,'').split('_')[0];return manifest.attributes.find(a=>sourceName(a)===attributeName)??manifest.attributes.find(a=>sourceName(a)==='Body')!;};
    const wholeMoves=new Map<string,number>();for(const rule of appliedRules)for(const action of rule.actions)if(action.kind==='move'&&!action.placementId)wholeMoves.set(`${action.attributeId}/${action.itemId}`,action.slot);
    const rendered=new Set<string>();
    const emit=(selection:LayerSelection,file:{path:string;objectId:string},index:number)=>{
      const attribute=manifest.attributes.find(a=>a.id===selection.attributeId)!,item=attribute.items.find(i=>i.id===selection.itemId)!;
      const p=item.placements.find(p=>p.name===file.path)??defaultPlacement('assembly-'+index,0),itemKey=`${attribute.id}/${item.id}`,key=`${itemKey}/${p.id}`;
      if(hidden.has(itemKey)||hidden.has(key)||!matches(p.rules,baseSelections))return;
      const main=assembly.config.attributes[sourceName(attribute)]!.main;
      const isMain=file.path.split('/')[0]===main;
      pieces.push({attributeId:attribute.id,itemId:item.id,objectId:isMain?selection.objectId:file.objectId,placement:{...p,slot:moved.get(key)??wholeMoves.get(itemKey)??index+p.slot}});rendered.add(itemKey);
    };
    const primaryStack=gatorStack(assembly,metadata(primary));
    for(const [index,file] of primaryStack.stack.entries()){const attribute=owner(file),selection=primary.find(s=>s.attributeId===attribute.id)!;emit(selection,file,index);}
    for(const addition of selections.filter(s=>!primary.some(p=>p.attributeId===s.attributeId&&p.itemId===s.itemId))){
      const draw=primary.map(p=>p.attributeId===addition.attributeId?addition:p);
      for(const [index,file]of gatorStack(assembly,metadata(draw)).stack.entries())if(owner(file).id===addition.attributeId)emit(addition,file,index);
    }
    // Artist-added split pieces draw the selected main image using their own boundaries.
    for(const selection of selections){const itemKey=`${selection.attributeId}/${selection.itemId}`;if(!rendered.has(itemKey))continue;const item=manifest.attributes.find(a=>a.id===selection.attributeId)!.items.find(i=>i.id===selection.itemId)!;
      for(const p of item.placements.filter(p=>!assembly.files.some(f=>f.path===p.name))){const key=`${itemKey}/${p.id}`;if(!hidden.has(key)&&matches(p.rules,baseSelections))pieces.push({attributeId:selection.attributeId,itemId:selection.itemId,objectId:selection.objectId,placement:{...p,slot:moved.get(key)??wholeMoves.get(itemKey)??p.slot}});}
    }
  }else for(const selection of selections){const item=manifest.attributes.find(a=>a.id===selection.attributeId)!.items.find(i=>i.id===selection.itemId)!;
    for(const placement of item.placements){const key=`${selection.attributeId}/${selection.itemId}/${placement.id}`;if(!hidden.has(key)&&matches(placement.rules,baseSelections))pieces.push({attributeId:selection.attributeId,itemId:selection.itemId,objectId:selection.objectId,placement:moved.has(key)?{...placement,slot:moved.get(key)!}:placement});}
  }
  pieces.sort((a,b)=>a.placement.slot-b.placement.slot);
  return {baseSelections,selections,pieces,appliedRules:appliedRules.map(({id,name,actions})=>({id,name,actions})),conditionSource:'original-draw' as const};
}
export function layeredDrawList(value: unknown, selections: LayerSelection[]) { return resolveLayeredArt(value,selections).pieces; }
export function checkLayeredArt(value: unknown, available?: string[]) {
  const manifest=parseLayeredArt(value);const issues:{level:'error'|'attention';message:string}[]=[];
  if(!manifest.attributes.length)issues.push({level:'error',message:'Add an attribute and its items.'});
  for(const attribute of manifest.attributes){if(!attribute.name.trim())issues.push({level:'error',message:'Give each attribute a name.'});if(!attribute.items.some(i=>i.weight>0))issues.push({level:'error',message:`${attribute.name} needs an item with a positive weight.`});for(const item of attribute.items){
    if(item.weight>0)for(const target of manifest.attributes){const conditions=item.rules.filter(r=>r.attributeId===target.id);if(conditions.length&&!target.items.some(candidate=>candidate.weight>0&&conditions.every(r=>r.mode==='include'?r.itemIds.includes(candidate.id):!r.itemIds.includes(candidate.id))))issues.push({level:'error',message:`${item.name} has impossible compatibility conditions for ${target.name}.`});}
    if(!item.variants.some(v=>v.weight>0))issues.push({level:'error',message:`${item.name} needs an image variant.`});
    if(!item.placements.length)issues.push({level:'error',message:`${item.name} has no visible pieces.`});
    if(item.usage.scope==='ask'||item.usage.scope==='renderer'&&!item.usage.renderer.trim())issues.push({level:'attention',message:`Choose who can reuse ${item.name}.`});
    if(item.usage.scope==='public'&&!item.usage.license.trim())issues.push({level:'attention',message:`Add reuse terms for ${item.name}.`});
    for(const variant of item.variants)if(available&&!available.includes(variant.objectId))issues.push({level:'error',message:`${item.name} / ${variant.name} is missing its original file.`});
  }}
  if(manifest.format==='image/jpeg'&&!manifest.background)issues.push({level:'error',message:'JPEG needs a background colour because it has no transparency.'});
  if(manifest.reveal.mode!=='visible'&&!manifest.reveal.revealAt)issues.push({level:'attention',message:'Choose when the reveal may begin.'});
  if(available)for(const id of manifest.assembly?.files.map(f=>f.objectId)??[])if(!available.includes(id))issues.push({level:'error',message:'An assembled layer file is missing.'});
  return {schema:'keel-layered-check@1',issues,ready:!issues.length,uniqueAssets:layeredAssetIds(manifest),proof:'local-manifest-only',publicationReady:false};
}
export async function sampleLayeredArt(value: unknown, count=100, seed='preview') {
  number(count,'Sample count',1,1000,true);const manifest=parseLayeredArt(value);const counts:Record<string,number>={};const outcomes=new Set<string>();const failures:{tokenId:string;message:string}[]=[];
  for(let index=1;index<=count;index++){try{const selection=await selectLayeredArt(manifest,seed,String(index));const resolved=resolveLayeredArt(manifest,selection);if(!resolved.pieces.some(p=>p.placement.opacity>0))throw Error('This combination has no visible drawing pieces.');const key=canonicalLayerJSON(resolved.pieces.filter(p=>p.placement.opacity>0).map(p=>({objectId:p.objectId,placement:p.placement})));outcomes.add(key);for(const s of resolved.selections.filter(s=>resolved.pieces.some(p=>p.attributeId===s.attributeId&&p.itemId===s.itemId&&p.placement.opacity>0))){const trait=`${s.attributeId}/${s.itemId}`;counts[trait]=(counts[trait]??0)+1;}}catch(e){failures.push({tokenId:String(index),message:(e as Error).message});}}
  return {count,counts,duplicates:count-failures.length-outcomes.size,failures,proof:'sample-only',guaranteedUnique:false};
}

export function layeredAssetIds(manifest:LayeredArt){return [...new Set([...manifest.attributes.flatMap(a=>a.items.flatMap(i=>i.variants.map(v=>v.objectId))),...(manifest.assembly?.files.map(f=>f.objectId)??[])])];}
