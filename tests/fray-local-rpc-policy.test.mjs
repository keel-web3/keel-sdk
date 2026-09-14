import test from 'node:test';import assert from 'node:assert/strict';
import {localContentRpcAllowed} from '../packages/sdk/dist/fray-content-view-runtime.js';
test('Anvil read exception requires both local chains and a loopback viewer',()=>{
 const check=(rpc='http://127.0.0.1:8545/',chain='31337',plugin='31337',viewer='http://127.0.0.1:4182/1.html')=>localContentRpcAllowed(rpc,chain,plugin,viewer);
 assert.equal(check(),true);
 for(const rpc of ['https://127.0.0.1:8545/','http://127.0.0.1:8546/','http://localhost:8545/','http://127.0.0.1:8545/path','http://u@127.0.0.1:8545/','http://127.0.0.1:8545/?x=1'])assert.equal(check(rpc),false);
 assert.equal(check(undefined,'11155111'),false);assert.equal(check(undefined,undefined,'11155111'),false);
 assert.equal(check(undefined,undefined,undefined,'https://example.com'),false);assert.equal(check(undefined,undefined,undefined,'data:text/html,x'),false);
});
