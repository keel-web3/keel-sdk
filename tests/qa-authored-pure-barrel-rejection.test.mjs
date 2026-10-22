import assert from 'node:assert/strict';
import test from 'node:test';
import {createKeelAuthoredProject} from '../packages/sdk/dist/authored-project.js';
test('pure reexport-only module is explicitly unqualified before an authored graph',async()=>{
 await assert.rejects(createKeelAuthoredProject({title:'Independent reexport',chainId:11155111,start:{module:'main',export:'mount'},modules:[
 {id:'scene-state',purpose:'Independent values',source:'export const red=17,green=31;'},
 {id:'color-interface',purpose:'Stable color interface',source:'export {red as r,green as g} from "./scene-state.js";'},
 {id:'main',purpose:'Exact renderer',source:'import {r,g} from "./color-interface.js";export function mount(root){const value=[r,g].join(",");root.textContent=value;parent.postMessage({keelOfflineProbe:value},"*");}'}]}),
 error=>error instanceof TypeError&&/Nonfunctional authored module: modules\/color-interface\.js/u.test(error.message));
});
