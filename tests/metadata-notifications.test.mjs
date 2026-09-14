import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, toEventSelector } from 'viem';
import { decodeKeelMetadataNotification } from '../packages/sdk/dist/metadata-notifications.js';
const address = '0x000000000000000000000000000000000000cafe';
const word = value => encodeAbiParameters([{type:'uint256'}], [value]);
test('ERC4906 data decodes at clone address and preserves reorg removal', () => {
  const log = { address, topics:[toEventSelector('MetadataUpdate(uint256)')], data:word(5n), removed:true };
  assert.deepEqual(decodeKeelMetadataNotification(log), {collection:address,firstTokenId:5n,lastTokenId:5n,standard:'erc721',removed:true});
  assert.equal(decodeKeelMetadataNotification({...log,topics:[...log.topics,word(5n)],data:'0x'}), undefined);
});
test('huge ranges stay compact and reversed bounds are rejected', () => {
  const topics=[toEventSelector('BatchMetadataUpdate(uint256,uint256)')];
  const data=encodeAbiParameters([{type:'uint256'},{type:'uint256'}],[0n,(1n<<256n)-1n]);
  assert.equal(decodeKeelMetadataNotification({address,topics,data}).lastTokenId,(1n<<256n)-1n);
  assert.equal(decodeKeelMetadataNotification({address,topics,data:encodeAbiParameters([{type:'uint256'},{type:'uint256'}],[2n,1n])}),undefined);
});
test('1155 URI uses indexed ID and ordinary string data', () => {
  const log={address,topics:[toEventSelector('URI(string,uint256)'),word(0n)],data:encodeAbiParameters([{type:'string'}],['ipfs://object'])};
  assert.equal(decodeKeelMetadataNotification(log).uri,'ipfs://object');
  assert.equal(decodeKeelMetadataNotification(log).firstTokenId,0n);
});
