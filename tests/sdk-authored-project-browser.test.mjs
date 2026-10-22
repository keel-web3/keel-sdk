import assert from 'node:assert/strict';
import test from 'node:test';
import {createKeelAuthoredProject,buildKeelAuthoredInlineDocument} from '../packages/sdk/dist/authored-project.js';
import {authoredFixture,expectedPixels} from './helpers/authored-project-fixture.mjs';
import {currentNativeMediaRecipe} from './helpers/native-media-fixtures.mjs';
import {observeOfflineShell} from './support/offline-shell-browser.mjs';
test('current retained canonical reader executes distinct functional ESM modules with exact canvas pixels offline',{timeout:30000},async()=>{
 const project=await createKeelAuthoredProject(authoredFixture()),recipe=await currentNativeMediaRecipe();
 const document=await buildKeelAuthoredInlineDocument({...recipe,...project,modules:[]});
 const result=await observeOfflineShell(new TextDecoder().decode(document.rootBytes),'verified',JSON.stringify(expectedPixels));
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.externalRequests,[]);assert.deepEqual(result.proxyRequests,[]);assert.deepEqual(result.pageNetworkRequests,[]);assert.equal(result.seal,true);assert.equal(result.opaque,true);
});

test('Raw current reader preserves exact authored source and initialization import order',{timeout:30000},async()=>{
 const spec=authoredFixture();spec.modules[0].source='globalThis.order=["state"];\n'+spec.modules[0].source;
 spec.modules[1].source=spec.modules[1].source.replace('export function mount(root){','globalThis.order.push("renderer");\nexport function mount(root){if(JSON.stringify(globalThis.order)!==JSON.stringify(["state","renderer"]))throw Error("module order changed");');
 const project=await createKeelAuthoredProject(spec),recipe=await currentNativeMediaRecipe(),document=await buildKeelAuthoredInlineDocument({...recipe,...project,modules:[],payloadStorage:'raw'});
 const result=await observeOfflineShell(new TextDecoder().decode(document.rootBytes),'verified',JSON.stringify(expectedPixels));assert.deepEqual(result.errors,[]);assert.deepEqual(result.pageNetworkRequests,[]);assert.equal(result.seal,true);
});
test('current reader resolves a declared binary data resource to exact original bytes',{timeout:30000},async()=>{
 const spec=authoredFixture();spec.assets=[{path:'assets/palette.bin',mediaType:'application/octet-stream',purpose:'Exact binary scene data',bytes:Uint8Array.of(255,0,128,42)}];
 spec.modules[1].source=spec.modules[1].source.replace('export function mount(root){','export async function mount(root){const resource=await __KEEL_CONTENT__.bytes("assets/palette.bin");if(JSON.stringify([...resource])!=="[255,0,128,42]")throw Error("data bytes changed");');
 const project=await createKeelAuthoredProject(spec),recipe=await currentNativeMediaRecipe(),document=await buildKeelAuthoredInlineDocument({...recipe,...project,modules:[]});
 const result=await observeOfflineShell(new TextDecoder().decode(document.rootBytes),'verified',JSON.stringify(expectedPixels));assert.deepEqual(result.errors,[]);assert.deepEqual(result.pageNetworkRequests,[]);assert.equal(result.seal,true);
});

test('declared import order governs side-effect initialization rather than lexical module IDs',{timeout:30000},async()=>{
 const spec=authoredFixture();spec.modules.push({id:'z-initialization',purpose:'Initialize scene lifetime',source:'globalThis.order=["init"];export function ready(){return true}'});
 spec.modules[0].source='globalThis.order.push("state");'+spec.modules[0].source;
 spec.modules[1].source='import {ready} from "./z-initialization.js";\n'+spec.modules[1].source;
 spec.modules[1].source=spec.modules[1].source.replace('export function mount(root){','export function mount(root){if(!ready()||JSON.stringify(globalThis.order)!==JSON.stringify(["init","state"]))throw Error("initialization order changed");');
 const project=await createKeelAuthoredProject(spec),recipe=await currentNativeMediaRecipe(),document=await buildKeelAuthoredInlineDocument({...recipe,...project,modules:[]});
 const result=await observeOfflineShell(new TextDecoder().decode(document.rootBytes),'verified',JSON.stringify(expectedPixels));assert.deepEqual(result.errors,[]);assert.deepEqual(result.pageNetworkRequests,[]);assert.equal(result.seal,true);
});
