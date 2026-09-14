import test from 'node:test';
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

test('router non-event ABI and all error selectors remain unchanged', () => {
  const before=read('../../keel-contracts/benchmarks/evm-creator-review/router-style/KeelMintRouteRegistry.before.json').abi;
  assert.deepEqual(abi.filter(e=>e.type!=='event'),before.filter(e=>e.type!=='event'));
  assert.deepEqual(abi,read('../../keel-contracts/modules/keel-mint-access/abi/KeelMintRouteRegistry.json'));
  assert.deepEqual(abi,read('../../keel-contracts/out/KeelMintRouteRegistry.sol/KeelMintRouteRegistry.json').abi);
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
