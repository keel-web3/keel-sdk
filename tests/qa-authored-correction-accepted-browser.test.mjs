import assert from 'node:assert/strict';
import test from 'node:test';
import {createKeelAuthoredProject,buildKeelAuthoredInlineDocument} from '../packages/sdk/dist/authored-project.js';
import {currentNativeMediaRecipe} from './helpers/native-media-fixtures.mjs';
import {observeOfflineShell} from './support/offline-shell-browser.mjs';
const cases=[
 ['normal-main-entry','export function color(){return 17;}','color','String(color())','17','main'],
 ['internal-unicode-name','const café=17;export function color(){return café;}','color','String(color())','17'],
 ['destructured-multiple-const','export const {red,green}={red:17,green:31};','red,green','[red,green].join(",")','17,31'],
 ['safe-tagged-interpolation','export function color(){const value={[Symbol.toPrimitive](hint){return hint}};return String.raw`before\\n${value}after`;}','color','color()','before\\nstringafter'],
];
for(const[name,source,imports,expression,expected,entryId='artwork-renderer']of cases)test(`QA strict accepted Compact ${name}`,{timeout:30000},async()=>{
 const project=await createKeelAuthoredProject({title:'Independent accepted reader case',chainId:11155111,start:{module:entryId,export:'mount'},modules:[{id:'scene-state',purpose:'Exact state',source},{id:entryId,purpose:'Exact renderer',source:`import {${imports}} from "./scene-state.js";export function mount(root){const value=${expression};root.textContent=value;parent.postMessage({keelOfflineProbe:value},"*");}`}]});
 const recipe=await currentNativeMediaRecipe(),built=await buildKeelAuthoredInlineDocument({...recipe,...project,modules:[],payloadStorage:'compact'});
 const actual=await observeOfflineShell(new TextDecoder().decode(built.rootBytes),'verified',expected);
 assert.deepEqual(actual.errors,[]);assert.deepEqual(actual.externalRequests,[]);assert.deepEqual(actual.proxyRequests,[]);assert.deepEqual(actual.pageNetworkRequests,[]);assert.equal(actual.seal,true);assert.equal(actual.opaque,true);
});
test('QA strict accepted Compact local reexport retains exact dependency edges',{timeout:30000},async()=>{
 const project=await createKeelAuthoredProject({title:'Independent reexport',chainId:11155111,start:{module:'main',export:'mount'},modules:[
 {id:'scene-state',purpose:'Independent values',source:'export const red=17,green=31;'},
 {id:'color-interface',purpose:'Stable color interface',source:'export {red as r,green as g} from "./scene-state.js";export function colorText(red,green){return [red,green].join(",");}'},
 {id:'main',purpose:'Exact renderer',source:'import {r,g,colorText} from "./color-interface.js";export function mount(root){const value=colorText(r,g);root.textContent=value;parent.postMessage({keelOfflineProbe:value},"*");}'}]});
 const recipe=await currentNativeMediaRecipe(),built=await buildKeelAuthoredInlineDocument({...recipe,...project,modules:[],payloadStorage:'compact'}),actual=await observeOfflineShell(new TextDecoder().decode(built.rootBytes),'verified','17,31');
 assert.deepEqual(actual.errors,[]);assert.deepEqual(actual.externalRequests,[]);assert.deepEqual(actual.proxyRequests,[]);assert.deepEqual(actual.pageNetworkRequests,[]);assert.equal(actual.seal,true);assert.equal(actual.opaque,true);
});
