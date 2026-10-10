import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createKeelProofSimulationTransport} from '../packages/sdk/dist/proof-simulation-node.js';
test('the shipped Node runtime is the exact reviewed adapter, reader and IPC implementation',()=>{
 for(const name of ['transport','state-reader','runner-client']){
  const source=readFileSync(`native/proof-executor/${name}.mjs`,'utf8').replaceAll("'../../packages/sdk/dist/publication-preflight.js'","'../publication-preflight.js'").replaceAll("'../../packages/sdk/dist/rpc.js'","'../rpc.js'");
  assert.equal(readFileSync(`packages/sdk/dist/proof-runtime/${name}.js`,'utf8'),source);
 }
});
test('the public Node entry refuses missing approval or a missing verified executable before any provider read',async t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('unexpected provider request'));
 const options={block:{number:1n,hash:`0x${'11'.repeat(32)}`},binaryPath:'/nonexistent/keel-executor',binarySha256:'a'.repeat(64),socketPath:'/nonexistent/runner.sock',rpcUrls:['https://fixture.invalid'],approvedStateRpcUrls:[]};
 await assert.rejects(createKeelProofSimulationTransport(options),/approved/);
 await assert.rejects(createKeelProofSimulationTransport({...options,approvedStateRpcUrls:options.rpcUrls}),/ENOENT/);
});
