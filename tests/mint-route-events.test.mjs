import { canonicalAbiEntries, readCompiledContractAbi } from "./abi-conformance.mjs";
import { fileURLToPath } from "node:url";
import nodeTest from 'node:test';
import { siblingTest } from "./sibling-repository.mjs";
const test = siblingTest(nodeTest, "keel-contracts");
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeEventLog, encodeAbiParameters, keccak256, parseAbi, stringToHex} from 'viem';
import {ABIS} from '../packages/sdk/dist/abis/keel-mint-access.generated.js';
import {keelMintRouteRegistryAbi} from '../packages/sdk/dist/abi.js';

const abi = ABIS.KeelMintRouteRegistry;
const humanAbi = parseAbi(keelMintRouteRegistryAbi);
const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const values = {
  approved:true, enabled:false,
  controller:'0x1111111111111111111111111111111111111111',
  target:'0x2222222222222222222222222222222222222222',
  creator:'0x3333333333333333333333333333333333333333',
  hook:'0x4444444444444444444444444444444444444444',
  authority:'0x5555555555555555555555555555555555555555',
  recipient:'0x6666666666666666666666666666666666666666',
  routeId:7n, tokenId:23n, quantity:19n, standard:1,
  allocationId:`0x${'aa'.repeat(32)}`, hookCodeHash:`0x${'bb'.repeat(32)}`, targetCodeHash:`0x${'cc'.repeat(32)}`,
};
// Independent expected wire order; this is intentionally not generated from the production ABI.
const schemas = [
  'event ControlledMinterUpdated(bool approved,address indexed controller)',
  'event MintRouteStatusUpdated(bool enabled,uint256 indexed routeId,address indexed authority)',
  'event CreatorAdminMintingUpdated(bool enabled,uint256 indexed routeId,address indexed authority)',
  'event RouteCapacityReserved(address indexed controller,uint256 indexed routeId,uint256 quantity,bytes32 indexed allocationId)',
  'event RouteCapacityReleased(address indexed controller,uint256 indexed routeId,uint256 quantity,bytes32 indexed allocationId)',
  'event RouteMinted(address recipient,address indexed controller,uint256 indexed routeId,uint256 quantity,bytes32 indexed allocationId)',
  'event CreatorAdminMinted(uint256 indexed routeId,uint256 quantity,bytes32 indexed allocationId,address indexed creator,address recipient)',
  'event MintRouteRegistered(uint256 indexed routeId,uint256 tokenId,address hook,address indexed target,address indexed creator,bytes32 hookCodeHash,bytes32 targetCodeHash,uint8 standard)',
];

for (const text of schemas) test(`${text.split('(')[0]} preserves named values and indexed fields`, () => {
  const [event] = parseAbi([text]);
  const inputs = event.inputs;
  const topics = [keccak256(stringToHex(`${event.name}(${inputs.map(i=>i.type).join(',')})`)), ...inputs.filter(i=>i.indexed).map(i=>encodeAbiParameters([{type:i.type}], [values[i.name]]))];
  const plain = inputs.filter(i=>!i.indexed);
  const data = encodeAbiParameters(plain, plain.map(i=>values[i.name]));
  const expected = Object.fromEntries(inputs.map(i=>[i.name,values[i.name]]));
  for (const decoder of [abi,humanAbi]) assert.deepEqual(decodeEventLog({abi:decoder,topics,data,strict:true}).args, expected);
});

test('router historical non-event ABI and errors change only by the reviewed release additions', () => {
  const before=read('../../keel-contracts/benchmarks/evm-creator-review/router-style/KeelMintRouteRegistry.before.json').abi;
  const expected=before.filter(e=>e.type!=='event');
  // The frozen style snapshot predates deferred releases (eb8cc73) and the named
  // routeKey return (8cc57c2). Keep every other field, tuple and error exact.
  const routeKey=expected.find(e=>e.type==='function' && e.name==='routeKey');
  assert.deepEqual(routeKey.outputs,[{name:'',type:'bytes32',internalType:'bytes32'}]);
  routeKey.outputs[0].name='key';
  const insertion=expected.findIndex(e=>e.type==='function' && e.name==='registerERC1155Route');
  assert.ok(insertion>=0);
  expected.splice(insertion,0,{
    type:'function', name:'registerDeferredRelease',
    inputs:[
      {name:'creator',type:'address',internalType:'address'},
      {name:'target',type:'address',internalType:'address'},
      {name:'tokenId',type:'uint256',internalType:'uint256'},
      {name:'controller',type:'address',internalType:'address'},
      {name:'allocationId',type:'bytes32',internalType:'bytes32'},
      {name:'supply',type:'uint32',internalType:'uint32'},
    ],
    outputs:[{name:'routeId',type:'uint256',internalType:'uint256'}],
    stateMutability:'nonpayable',
  });
  assert.deepEqual(abi.filter(e=>e.type!=='event'),expected);
});

test('SDK router ABI exactly matches the current checked-in contract ABI', () => {
  assert.deepEqual(abi,read('../../keel-contracts/modules/keel-mint-access/abi/KeelMintRouteRegistry.json'));
});

test('SDK router ABI exactly matches the current compiled contract ABI', () => {
  assert.deepEqual(canonicalAbiEntries(abi),canonicalAbiEntries(readCompiledContractAbi(fileURLToPath(new URL('../../keel-contracts', import.meta.url)), 'KeelMintRouteRegistry')));
});

test('SDK decodes actual router receipts using generated and human ABIs', () => {
  const samples=read('../../keel-contracts/benchmarks/evm-creator-review/router-style/event-logs.json');
  assert.ok(samples.length>=4);
  const normalize=x=>JSON.parse(JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v));
  for (const sample of samples) for (const decoder of [abi,humanAbi]) {
    const log=decodeEventLog({abi:decoder,topics:sample.topics,data:sample.data,strict:true});
    assert.equal(log.eventName,sample.eventName);
    assert.deepEqual(normalize(log.args),sample.args);
  }
});
