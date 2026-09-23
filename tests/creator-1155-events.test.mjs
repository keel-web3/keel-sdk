import nodeTest from 'node:test';
import { siblingTest } from "./sibling-repository.mjs";
const test = siblingTest(nodeTest, "keel-contracts");
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeEventLog,encodeAbiParameters,keccak256,stringToHex,toHex} from 'viem';
import {ABIS} from '../packages/sdk/dist/abis/keel-die.generated.js';
const abi=ABIS.KeelCreator1155;
const manager='0x1111111111111111111111111111111111111111';
const topic=s=>keccak256(stringToHex(s));
const addressTopic=a=>`0x${'0'.repeat(24)}${a.slice(2)}`;
const recorded=()=>JSON.parse(readFileSync(new URL('../../keel-contracts/modules/keel-die/abi/KeelCreator1155.json',import.meta.url)));
test('creator1155 compiled, recorded and SDK ABI agree',()=>{
 const compiled=JSON.parse(readFileSync(new URL('../../keel-contracts/out/KeelCreator1155.sol/KeelCreator1155.json',import.meta.url))).abi;
 assert.deepEqual(abi,recorded());assert.deepEqual(recorded(),compiled);
});
for(const eventName of ['StrikeCapacityReserved','StrikeCapacityReleased','StrikeCapacityConsumed'])test(`${eventName} preserves item, manager and full quantity`,()=>{
 const quantity=(1n<<128n)-1n;
 const log=decodeEventLog({abi,strict:true,topics:[topic(`${eventName}(uint256,uint256,address)`),toHex(7n,{size:32}),addressTopic(manager)],data:encodeAbiParameters([{type:'uint256'}],[quantity])});
 assert.equal(log.eventName,eventName);assert.deepEqual(log.args,{tokenId:7n,manager,quantity});
});
test('standard ERC1155 and shared ownership events retain their prior schemas',()=>{
 const before=JSON.parse(readFileSync(new URL('../../keel-contracts/benchmarks/evm-creator-review/creator-1155/before.json',import.meta.url))).abi;
 for(const name of ['TransferSingle','TransferBatch','ApprovalForAll','URI','OwnershipTransferred','OwnershipTransferStarted','CollectionClosedPermanently','ItemCreated','ItemClosedPermanently']){
  assert.deepEqual(abi.find(x=>x.type==='event'&&x.name===name),before.find(x=>x.type==='event'&&x.name===name),name);
 }
});
