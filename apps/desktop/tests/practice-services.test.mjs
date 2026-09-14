import test from 'node:test';
import assert from 'node:assert/strict';
import { startPracticeServices, PRACTICE_CONTRACT, PRACTICE_CHAIN, PRACTICE_ABI, PRACTICE_ACCOUNT } from '../scripts/practice-services.mjs';
import { createTrackedContract } from '@keel/sdk/contract-controls';
import { readControl, simulateControl } from '../src/contract-rpc.mjs';
import { inspectStudio } from '../src/studio.mjs';
import { checkPublishedMetadata } from '../src/project-checks.mjs';

test('practice workspace services exercise real editor transport while rejecting transaction submission', async () => {
  const server = await startPracticeServices();
  try {
    const contract = createTrackedContract({ name: 'Practice', address: PRACTICE_CONTRACT, chainId: PRACTICE_CHAIN, abi: PRACTICE_ABI, kind: 'custom', source: 'manual' });
    assert.equal((await inspectStudio(server.url)).capabilities.chainId, PRACTICE_CHAIN);
    assert.equal((await readControl({ contract, signature: 'owner()', args: [], rpcUrl: server.url })).result, PRACTICE_ACCOUNT);
    assert.equal((await simulateControl({ contract, signature: 'setValue(uint256)', args: ['2'], rpcUrl: server.url, account: PRACTICE_ACCOUNT })).simulation, 'succeeded-at-observed-block');
    const metadata = await checkPublishedMetadata({ family: 'ethereum', chainId: PRACTICE_CHAIN, rpcUrl: server.url }, { chainId: PRACTICE_CHAIN, contractAddress: PRACTICE_CONTRACT, tokenId: '1', standard: 'erc721' });
    assert.equal(metadata.document.name, 'Practice / Signal Garden');
    assert.equal(metadata.block, '42');
    const forbidden = await fetch(server.url, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: ['0x'] }) });
    assert.equal((await forbidden.json()).error.code, -32601);
  } finally { await server.close(); }
});
