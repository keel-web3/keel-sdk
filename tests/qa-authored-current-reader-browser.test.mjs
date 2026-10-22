import assert from 'node:assert/strict';
import test from 'node:test';
import {createKeelAuthoredProject,buildKeelAuthoredInlineDocument} from '../packages/sdk/dist/authored-project.js';
import {currentNativeMediaRecipe} from './helpers/native-media-fixtures.mjs';
import {observeOfflineShell} from './support/offline-shell-browser.mjs';
const cases=[
 ['raw-multiple-export-declarations','raw','export const red=17,green=31;\nexport function blue(){return 47;}','import {red,green,blue} from "./scene-state.js";\nexport function mount(root){const value=[red,green,blue()].join(",");root.textContent=value;parent.postMessage({keelOfflineProbe:value},"*");}','17,31,47'],
 ['compact-template-literal-module-text','compact','export function content(){return `first line\nexport const lost=1;\nlast line`;}','import {content} from "./scene-state.js";\nexport function mount(root){const value=content();root.textContent=value;parent.postMessage({keelOfflineProbe:value},"*");}','first line\nexport const lost=1;\nlast line'],
 ['compact-unicode-identifiers','compact','export function café(){return 17;}','import {café as color} from "./scene-state.js";\nexport function mount(root){const value=String(color());root.textContent=value;parent.postMessage({keelOfflineProbe:value},"*");}','17'],
 ['raw-legal-comment-module-text','raw','/*! retained license text\nexport const lost=1;\n*/\nexport function color(){return 17;}','import {color} from "./scene-state.js";\nexport function mount(root){const value=String(color());root.textContent=value;parent.postMessage({keelOfflineProbe:value},"*");}','17'],
 ['compact-local-main-identity','compact','export function color(){return 17;}','import {color} from "./main.js";\nexport function mount(root){const value=String(color());root.textContent=value;parent.postMessage({keelOfflineProbe:value},"*");}','17','main'],
];
for(const[name,payloadStorage,state,renderer,expected,stateId='scene-state'] of cases)test(`QA exact static reader ${name}`,{timeout:30000},async()=>{
 let document;
 try{
 const project=await createKeelAuthoredProject({title:'Independent reader parity',chainId:11155111,start:{module:'artwork-renderer',export:'mount'},modules:[{id:stateId,purpose:'Independent display state',source:state},{id:'artwork-renderer',purpose:'Render exact state',source:renderer}]}),recipe=await currentNativeMediaRecipe();
 document=await buildKeelAuthoredInlineDocument({...recipe,...project,modules:[],payloadStorage});
 }catch(error){assert.match(error.message,/unsupported|syntax|acyclic|alias|current.*reader|qualif/iu,'Unsupported source must fail explicitly before a successful publication artifact is produced');return;}
 const result=await observeOfflineShell(new TextDecoder().decode(document.rootBytes),'verified',expected);
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.pageNetworkRequests,[]);assert.deepEqual(result.proxyRequests,[]);assert.equal(result.seal,true);assert.equal(result.opaque,true);
});
