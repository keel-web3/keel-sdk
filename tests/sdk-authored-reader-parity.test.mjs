/* Accepted cases must render, not pass by catching preparation rejection. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {createKeelAuthoredProject,buildKeelAuthoredInlineDocument} from '../packages/sdk/dist/authored-project.js';
import {currentNativeMediaRecipe} from './helpers/native-media-fixtures.mjs';
import {observeOfflineShell} from './support/offline-shell-browser.mjs';
const cases=[
 ['multiple-const-exports','export const red=17,green=31;export function blue(){return 47;}','red,green,blue','[red,green,blue()].join(",")','17,31,47'],
 ['legal-notice-module-text','/*! retained license text\nexport const lost=1;\n*/\nexport function color(){return 17;}','color','String(color())','17'],
 ['ordinary-string-module-text','export function color(){return ";export const lost=1;\\n}";}','color','color()',';export const lost=1;\n}'],
 ['template-interpolation-string-hint','export function color(){const value={[Symbol.toPrimitive](hint){return hint;}};return `first line\nexport const lost=${value};\nlast line`;}','color','color()','first line\nexport const lost=string;\nlast line'],
 ['adjacent-legal-comment','export function color(){return/*! notice;export const lost=1; */17;}','color','String(color())','17'],
 ['safe-tagged-template-raw','export function color(){return String.raw`first\\nlast`;}','color','color()','first\\nlast'],
 ['main-logical-identity','export function color(){return 17;}','color','String(color())','17','main'],
];
async function fixture(source,imports,expression,stateId='scene-state'){
 const spec={title:'Reader-compatible functional artwork',chainId:11155111,start:{module:'artwork-renderer',export:'mount'},modules:[
  {id:stateId,purpose:'Independent state',source},
  {id:'artwork-renderer',purpose:'Render exact state',source:`import {${imports}} from "./${stateId}.js";export function mount(root){const value=${expression};root.textContent=value;parent.postMessage({keelOfflineProbe:value},"*");}`},
 ]};return createKeelAuthoredProject(spec);
}
for(const[name,source,imports,expression,expected,stateId='scene-state']of cases)test(`Compact reader parity executes ${name}`,{timeout:30000},async()=>{
 const project=await fixture(source,imports,expression,stateId),recipe=await currentNativeMediaRecipe();
 const built=await buildKeelAuthoredInlineDocument({...recipe,...project,modules:[],payloadStorage:'compact'});
 assert.deepEqual(project.graph.nodes.map(node=>node.id),['index.html','main.js',`modules/${stateId}.js`,'modules/artwork-renderer.js']);
 for(const resource of built.authored.resources)assert.deepEqual(resource.sourceIntegrity,project.graph.nodes.find(node=>node.id===resource.path).integrity);
 if(name==='legal-notice-module-text'){
  const state=JSON.parse(new TextDecoder().decode(built.parts.find(part=>part.kind==='creator'&&JSON.parse(new TextDecoder().decode(part.bytes).slice(1)).id===`modules/${stateId}.js`).bytes).slice(1));
  assert.ok(state.embedded.storedText.includes('retained license text'));assert.ok(state.embedded.storedText.includes('export const lost=1;'),'Compact keeps notice words while formatting it as non-code comment text');
 }
 if(stateId==='main'){
  const items=built.parts.filter(part=>part.kind==='creator').map(part=>JSON.parse(new TextDecoder().decode(part.bytes).slice(1)));
  assert.ok(items.find(item=>item.id==='main.js').aliases.includes('./main.js'));
  assert.ok(!items.find(item=>item.id==='modules/main.js').aliases.includes('./main.js'));
  assert.ok(items.find(item=>item.id==='modules/main.js').aliases.includes('./modules/main.js'));
 }
 const actual=await observeOfflineShell(new TextDecoder().decode(built.rootBytes),'verified',expected);
 assert.deepEqual(actual.errors,[]);assert.deepEqual(actual.externalRequests,[]);assert.deepEqual(actual.proxyRequests,[]);assert.deepEqual(actual.pageNetworkRequests,[]);assert.equal(actual.seal,true);assert.equal(actual.opaque,true);
});
for(const[name,source,imports,expression,stateId='scene-state']of [
 ['multi-direct-const','export const red=17,green=31;','red,green','String(red+green)'],
 ['legal-comment-module-text','/*! retained notice\nexport const lost=1;\n*/export function color(){return 17;}','color','String(color())'],
 ['escaped-export-identifier','export const r\\u0065d=17;','red','String(red)'],
 ['main-relative-alias','export function color(){return 17;}','color','String(color())','main'],
 ['commented-import-binding','export function color(){return 17;}','/* retained import note */color','String(color())'],
 ['commented-export-binding','function color(){return 17;}export{/* retained export note */color};','color','String(color())'],
 ['hashbang-module','#!/usr/bin/env node\nexport function color(){return 17;}','color','String(color())'],
])test(`Raw rejects unsupported ${name} before a presentation artifact`,async()=>{
 const project=await fixture(source,imports,expression,stateId),recipe=await currentNativeMediaRecipe();
 await assert.rejects(buildKeelAuthoredInlineDocument({...recipe,...project,modules:[],payloadStorage:'raw'}),/current.reader|unsupported|alias|Compact/iu);
});
for(const[name,source]of[
 ['tagged-template-module-text','export function color(){return String.raw`first\nexport const lost=1;\nlast`;}'],
 ['regex-module-text','export function color(){return /;export const lost=1;/.source;}'],
 ['unicode-module-interface','export function café(){return 17;}'],
 ['prototype-namespace-key','export function __proto__(){return 17;}'],
])test(`Unqualified ${name} rejects before an authored graph`,async()=>{
 await assert.rejects(fixture(source,name==='unicode-module-interface'?'café as color':name==='prototype-namespace-key'?'__proto__ as color':'color','String(color())'),/current.reader|unsupported|syntax/iu);
});
