import test from 'node:test';import assert from 'node:assert/strict';
import {prepareKeelTezosCustodyPresentation,prepareKeelTezosCustodyRefresh} from '../packages/sdk/dist/index.js';
import {createMcpServer} from '../packages/mcp/dist/index.js';
const args={network:'NetXsqzbfFenSTS',sender:'tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx',collection:'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton',custodian:'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton',renderer:'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton'};
test('custody setup and permissionless refresh produce unsigned exact entrypoints',()=>{
 const setup=prepareKeelTezosCustodyPresentation(args),refresh=prepareKeelTezosCustodyRefresh({...args,tokenId:13});
 assert.equal(setup.operation.parameters.entrypoint,'set_custody_presentation');assert.equal(setup.operation.destination,args.collection);
 assert.equal(refresh.operation.parameters.entrypoint,'refresh_custody_metadata');assert.deepEqual(refresh.operation.parameters.value,{int:'13'});
 for(const x of [setup,refresh]){assert.equal(x.signing,'not-performed');assert.equal(x.submission,'not-performed');}
 assert.throws(()=>prepareKeelTezosCustodyRefresh({...args,tokenId:-1}));
 assert.throws(()=>prepareKeelTezosCustodyPresentation({...args,renderer:args.sender}));
});
test('MCP exposes only reviewed setup and ledger-derived refresh parameters',async()=>{
 const server=await createMcpServer({workspaceRoot:process.cwd()});await server.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'custody-test',version:'1'}}});
 for(const [i,name,input,entry] of [[2,'keel-tezos-custody-presentation-prepare',args,'set_custody_presentation'],[3,'keel-tezos-custody-refresh-prepare',{network:args.network,sender:args.sender,collection:args.collection,tokenId:13},'refresh_custody_metadata']]){
  const reply=await server.handle({jsonrpc:'2.0',id:i,method:'tools/call',params:{name,arguments:input}});assert.equal(reply.error,undefined);assert.equal(reply.result.isError,undefined);
  const value=JSON.parse(reply.result.content[0].text);assert.equal(value.operation.parameters.entrypoint,entry);assert.equal(value.submission,'not-performed');
 }
});
