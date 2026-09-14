import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { inspectNetwork, estimateNetworkCall } from '../packages/sdk/dist/network-inspection.js';
import { createMcpServer } from '../packages/mcp/dist/server.js';

async function fixture() {
  const calls = []; let gasPrice = '0x77359400';
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.method === 'GET') {
      const value = request.url.endsWith('/chain_id') ? 'NetXdQprcVkpaWU' : request.url.endsWith('/header') ? { level: 100, timestamp: new Date().toISOString() } : { hard_gas_limit_per_operation: '1040000', hard_gas_limit_per_block: '2600000', cost_per_byte: '250' };
      response.end(JSON.stringify(value)); return;
    }
    let body = ''; request.on('data', (chunk) => { body += chunk; }); request.on('end', () => {
      const call = JSON.parse(body); calls.push(call);
      const result = { eth_chainId: '0xf423f', eth_getBlockByNumber: { number: '0x100', gasLimit: '0x2aea540', timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`, baseFeePerGas: '0x3b9aca00' }, eth_gasPrice: gasPrice, eth_maxPriorityFeePerGas: '0x3b9aca00', eth_getCode: '0x6000', eth_estimateGas: '0x5208' }[call.method];
      response.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, ...(result === undefined ? { error: { code: -32601, message: 'Unsupported' } } : { result }) }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { rpcUrl: `http://127.0.0.1:${server.address().port}`, calls, updateGas: (value) => { gasPrice = value; }, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

test('custom EVM networks return fresh fees and setup gaps without pretending deployments exist', async () => {
  const server = await fixture();
  try {
    const input = { family: 'ethereum', rpcUrl: server.rpcUrl };
    const first = await inspectNetwork(input);
    assert.equal(first.chainId, 999999); assert.equal(first.inlineReadGasLimit, '45000000');
    assert.equal(first.fees.gasPriceWei, '2000000000'); assert.ok(first.deployments.every((item) => item.status === 'needs-setup'));
    assert.equal(first.publicationReady, false);
    server.updateGas('0xee6b2800'); assert.equal((await inspectNetwork(input)).fees.gasPriceWei, '4000000000');
    await assert.rejects(inspectNetwork({ ...input, chainId: 1 }), /chain changed/);
    const custom = await inspectNetwork({ ...input, holdAddress: '0x'+'1'.repeat(40) });
    assert.equal(custom.deployments[0].status, 'code-present-identity-unverified');
    assert.ok(server.calls.every((call) => !/send|sign/.test(call.method)));
  } finally { await server.close(); }
});

test('exact call estimates distinguish publication expense from free read execution at a pinned head', async () => {
  const server = await fixture();
  try {
    const input = { family: 'ethereum', rpcUrl: server.rpcUrl, chainId: 999999, to: '0x'+'1'.repeat(40), data: '0x12345678', from: '0x'+'2'.repeat(40), value: '0x0', purpose: 'publication' };
    const result = await estimateNetworkCall(input);
    assert.equal(result.gas, '21000'); assert.equal(result.executionCostWei, '42000000000000');
    assert.equal(server.calls.at(-1).method, 'eth_estimateGas'); assert.equal(server.calls.at(-1).params[1], '0x100');
    assert.equal(server.calls.at(-1).params[0].data, input.data); assert.equal(result.execution, 'not-submitted');
    assert.match((await estimateNetworkCall({ ...input, purpose: 'presentation-read' })).note, /do not spend wallet gas/);
  } finally { await server.close(); }
});

test('Tezos network inspection uses its own gas and storage terms and checks saved identity', async () => {
  const server = await fixture();
  try {
    const input = { family: 'tezos', rpcUrl: server.rpcUrl };
    const result = await inspectNetwork(input);
    assert.equal(result.network, 'NetXdQprcVkpaWU'); assert.equal(result.storageCostMutezPerByte, '250');
    assert.equal(result.operationGasLimit, '1040000'); assert.equal(result.fees.status, 'requires-operation-simulation');
    await assert.rejects(inspectNetwork({ ...input, network: 'NetWrong' }), /network changed/);
    await assert.rejects(inspectNetwork({ ...input, chainId: 1 }), /EVM target/);
  } finally { await server.close(); }
});

test('MCP reads the same live network facts and rejects unsafe or unsupported inspection inputs', async () => {
  const server = await fixture();
  try {
    const mcp = await createMcpServer();
    await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'network-test', version: '1' } } });
    const result = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'keel-network-inspect', arguments: { family: 'ethereum', rpcUrl: server.rpcUrl } } });
    assert.equal(result.result.structuredContent.chainId, 999999); assert.equal(result.result.structuredContent.fees.gasPriceWei, '2000000000');
    await assert.rejects(inspectNetwork({ family: 'ethereum', rpcUrl: 'http://remote.example/rpc' }), /HTTPS/);
    await assert.rejects(inspectNetwork({ family: 'ethereum', rpcUrl: 'https://user:password@example.com/rpc' }), /HTTPS/);
    await assert.rejects(inspectNetwork({ family: 'ethereum', rpcUrl: server.rpcUrl, holdAddress: 'invalid' }), /exact contract/);
    await assert.rejects(inspectNetwork({ family: 'ethereum', rpcUrl: 'https://example.com/rpc' }, async () => new Response('x'.repeat(524289))), /inspection limit/);
  } finally { await server.close(); }
});
