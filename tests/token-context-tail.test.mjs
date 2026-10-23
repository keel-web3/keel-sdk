import test from 'node:test';import assert from 'node:assert/strict';import {runInNewContext} from 'node:vm';import {createHash} from 'node:crypto';import {prepareKeelTokenContextTail} from '../packages/sdk/dist/index.js';
test('canonical context tail restores exact JSON, UTF-8 state and byte commitment',()=>{
 const context={protocol:'keel-context@1',chainId:'31337',tokenId:'2',bridge:{escrowed:true},label:'NOCTURNES 🎃 é'};
 const t=prepareKeelTokenContextTail(context),globals={atob};runInNewContext(t.html.slice(8,-9),globals);
 assert.deepEqual(JSON.parse(JSON.stringify(globals.__KEEL_CONTEXT__)),context);
 assert.equal(t.digest,'0x'+createHash('sha256').update(t.json).digest('hex'));assert.equal(t.byteLength,Buffer.byteLength(t.json));
 assert.equal(decodeURIComponent(t.uriTail),t.html);assert.equal(globals.__KEEL_ONCHAIN_CONTEXT__.json,t.json);
 assert.equal(Object.getOwnPropertyDescriptor(globals,'__KEEL_CONTEXT__').writable,false);
 assert.throws(()=>prepareKeelTokenContextTail({text:'x'.repeat(40000)}));
});
