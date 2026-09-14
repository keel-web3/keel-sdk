import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {newLayeredArt,defaultPlacement,parseLayeredArt,selectLayeredArt,resolveLayeredArt,sampleLayeredArt,layerDigest,layeredManifestDigest,canonicalLayerJSON} from '@keel/sdk/layered-art';
import {withLayeredPreview} from '../src/layered-project.mjs';
import {resolveRuntimeReferences} from '../src/runtime-library.mjs';
const item=(id,slot,weight=1)=>({id,name:id,weight,variants:[{id:'v',name:'Image',objectId:(id==='x'?'1':'2').repeat(64),weight:1}],placements:[defaultPlacement('whole',slot)],rules:[],usage:{scope:'public',renderer:'',license:'CC0',tags:[]}});
function art(){return {...newLayeredArt(),attributes:[{id:'hair',name:'Hair',items:[item('x',1),item('y',2)]},{id:'hat',name:'Hat',items:[item('z',5),item('visor',6,0)]}]};}
const condition=(attributeId,item,mode='include')=>({attributeId,itemIds:[item],mode});
const rule=(actions,conditions=[condition('hair','x'),condition('hat','z')],extra={})=>({id:'combination',name:'Helmet and hair',enabled:true,match:'all',conditions,actions,...extra});
const select=a=>selectLayeredArt(a,'test','1',{hair:'x',hat:'z'});
test('all/any and negative conditions use original draw, independent of actions',async()=>{
 for(const [match,conditions,expected] of [['all',[condition('hair','x'),condition('hat','z')],true],['all',[condition('hair','y'),condition('hat','z')],false],['any',[condition('hair','y'),condition('hat','z')],true],['any',[condition('hair','y'),condition('hat','visor')],false],['all',[condition('hair','y','exclude')],true]]){
 const a=art();a.exceptions=[rule([{kind:'move',attributeId:'hair',itemId:'x',slot:3}],conditions,{match})];const r=resolveLayeredArt(a,await select(a));assert.equal(r.appliedRules.length,expected?1:0);assert.equal(r.pieces.find(p=>p.itemId==='x').placement.slot,expected?3:1);
 }
 const a=art();a.exceptions=[rule([{kind:'include',attributeId:'hat',itemId:'visor',variantId:'v'}]),rule([{kind:'hide',attributeId:'hair',itemId:'x'}],[condition('hat','visor')],{id:'no-cascade',name:'Only originally drawn visor'})];
 const r=resolveLayeredArt(a,await select(a));assert.deepEqual(r.selections.map(s=>s.itemId),['x','z','visor']);assert.equal(r.appliedRules.length,1);assert.equal(r.conditionSource,'original-draw');
});
test('piece moves, whole item hide, replace and additional items share one compositor',async()=>{
 const a=art();a.attributes[0].items[0].placements.push(defaultPlacement('front',9));
 a.exceptions=[rule([{kind:'move',attributeId:'hair',itemId:'x',placementId:'front',slot:3},{kind:'replace',attributeId:'hat',itemId:'visor',variantId:'v'}])];
 let r=resolveLayeredArt(a,await select(a));assert.deepEqual(r.pieces.map(p=>p.placement.slot),[1,3,6]);assert.deepEqual(r.selections.map(s=>s.itemId),['x','visor']);assert.equal(a.attributes[0].items[0].placements[1].slot,9);
 a.exceptions[0].actions=[{kind:'hide',attributeId:'hair',itemId:'x',placementId:'front'}];r=resolveLayeredArt(a,await select(a));assert.deepEqual(r.pieces.map(p=>p.placement.slot),[1,5]);
 a.exceptions[0].actions=[{kind:'hide',attributeId:'hair',itemId:'x'}];r=resolveLayeredArt(a,await select(a));assert.deepEqual(r.selections.map(s=>s.itemId),['z']);
 a.exceptions[0].actions=[{kind:'include',attributeId:'hat',itemId:'z',variantId:'v'}];r=resolveLayeredArt(a,await select(a));assert.equal(r.selections.length,2);
});
test('conflicting rules fail by name; identical actions deduplicate and paused rules do not act',async()=>{
 const a=art(),move={kind:'move',attributeId:'hair',itemId:'x',slot:3};a.exceptions=[rule([move]),rule([{...move,slot:4}],undefined,{id:'other',name:'Other rule'})];
 assert.throws(()=>resolveLayeredArt(a,[{attributeId:'hair',itemId:'x',variantId:'v',objectId:'1'.repeat(64)},{attributeId:'hat',itemId:'z',variantId:'v',objectId:'2'.repeat(64)}]),/Helmet and hair.*Other rule/);
 assert.ok((await sampleLayeredArt(a,30)).failures.some(f=>f.message.includes('Conflicting exceptions')));
 a.exceptions[1].enabled=false;assert.equal(resolveLayeredArt(a,await select(a)).pieces[0].placement.slot,3);
 a.exceptions[1].enabled=true;a.exceptions[1].actions=[move];assert.equal(resolveLayeredArt(a,await select(a)).pieces.length,2);
 for(const actions of [[{kind:'hide',attributeId:'hair',itemId:'x'},move],[{kind:'include',attributeId:'hat',itemId:'visor',variantId:'v'},{kind:'hide',attributeId:'hat',itemId:'visor'}],[{kind:'replace',attributeId:'hat',itemId:'visor',variantId:'v'},{kind:'replace',attributeId:'hat',itemId:'z',variantId:'v'}]]){a.exceptions=[rule(actions)];assert.throws(()=>resolveLayeredArt(a,[{attributeId:'hair',itemId:'x',variantId:'v',objectId:'1'.repeat(64)},{attributeId:'hat',itemId:'z',variantId:'v',objectId:'2'.repeat(64)}]),/Conflicting/);}
});
test('invalid references and incompatible forced items fail; exceptions change commitment, empty list does not',async()=>{
 const a=art(),root=await layeredManifestDigest(a);assert.equal(await layeredManifestDigest({...a,exceptions:[]}),root);
 a.exceptions=[rule([{kind:'include',attributeId:'hat',itemId:'visor',variantId:'v'}])];assert.notEqual(await layeredManifestDigest(a),root);
 for(const patch of [{itemId:'missing'},{variantId:'missing'},{slot:3}]){const b=structuredClone(a);Object.assign(b.exceptions[0].actions[0],patch);assert.throws(()=>parseLayeredArt(b));}
 a.attributes[1].items[1].rules=[condition('hair','y')];assert.throws(()=>resolveLayeredArt(a,[{attributeId:'hair',itemId:'x',variantId:'v',objectId:'1'.repeat(64)},{attributeId:'hat',itemId:'z',variantId:'v',objectId:'2'.repeat(64)}]),/compatibility/);
});
test('samples count effective visible traits after removal and inclusion',async()=>{
 const a=art();a.attributes[0].items[1].weight=0;a.exceptions=[rule([{kind:'replace',attributeId:'hat',itemId:'visor',variantId:'v'},{kind:'hide',attributeId:'hair',itemId:'x'}])];
 const s=await sampleLayeredArt(a,10);assert.deepEqual(s.counts,{'hat/visor':10});assert.equal(s.duplicates,9);assert.equal(s.failures.length,0);
});
test('legacy runtime remains byte-pinned and old commitments and selections remain identical',async()=>{
 const old=JSON.parse(await readFile(new URL('../src/legacy-layered-runtime.json',import.meta.url)));
 const bytes=await readFile(new URL('../../../packages/sdk/resources/layered-runtime-v1.js',import.meta.url));assert.equal('0x'+await layerDigest(bytes),old.integrity.digest);assert.equal(bytes.length,old.integrity.byteLength);
 const {runInNewContext}=await import('node:vm');const context={crypto:globalThis.crypto,TextEncoder,Uint8Array};runInNewContext(bytes.toString(),context);
 const a=art();assert.equal(await layeredManifestDigest(a),await context.KEEL_LAYERS.layeredManifestDigest(a));assert.equal(canonicalLayerJSON(await selectLayeredArt(a,'seed','8')),canonicalLayerJSON(await context.KEEL_LAYERS.selectLayeredArt(a,'seed','8')));
 const ref={id:old.id,version:old.version,digest:old.integrity.digest,byteLength:old.integrity.byteLength};assert.equal(resolveRuntimeReferences([ref])[0].id,old.id);
 const p={layered:a,intent:{},presentation:{},runtimeModules:[ref],files:[]};assert.deepEqual(withLayeredPreview(p).runtimeModules,[ref]);p.layered.exceptions=[rule([{kind:'move',attributeId:'hair',itemId:'x',slot:3}])];assert.equal(withLayeredPreview(p).runtimeModules[0].id,'keel-layered-runtime-v4');
});
