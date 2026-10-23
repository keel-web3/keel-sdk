import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { decodeFunctionData, encodeFunctionResult, toFunctionSelector } from 'viem';
import {
  KEEL_CAMPAIGN_CONTROLS_INTERFACE_ID, buildKeelCampaignLimitUpdate, decodeKeelCampaignControlsConfiguration,
  describeKeelCampaignControls, encodeKeelCampaignControlsConfiguration, keelCampaignControlsAbi,
  keelCampaignControlsFromConfig, keelCampaignLimitBits, keelCampaignLimitMask, keelCampaignLimitModes,
  readKeelCampaignControls, readKeelEffectiveLimits, withAdjustableCampaignLimits,
} from '../packages/sdk/dist/campaign-controls.js';
import { buildCampaign } from '../packages/sdk/dist/campaign.js';

const plate = '0x00000000000000000000000000000000000000c0';
const inner = '0x00000000000000000000000000000000000000aa';
const target = '0x0000000000000000000000000000000000000001';
const creator = '0x0000000000000000000000000000000000000002';
const campaignId = `0x${'11'.repeat(32)}`;
// cast abi-encode "f(uint256,address,bytes)" 5 0x..aa 0x1234 (KeelCampaignControls.encodeConfiguration).
const CONTRACT_BYTES = '0x000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000000000000000000aa000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000021234000000000000000000000000000000000000000000000000000000000000';

test('field bits, interface id and creation copy match the contract', () => {
  assert.deepEqual(Object.values(keelCampaignLimitBits), [1n, 2n, 4n, 8n, 16n]);
  const selectors = ['campaignControls(bytes32)', 'effectiveLimits(bytes32,address)', 'updateCampaignLimits(bytes32,uint256,(uint64,uint64,uint64,uint64,uint64))']
    .map(signature => BigInt(toFunctionSelector(signature)));
  assert.equal(`0x${(selectors[0] ^ selectors[1] ^ selectors[2]).toString(16).padStart(8, '0')}`, KEEL_CAMPAIGN_CONTROLS_INTERFACE_ID);
  assert.equal(keelCampaignLimitModes.locked.label, 'Locked: limits can never change (recommended)');
  assert.equal(keelCampaignLimitModes.adjustable.label, 'Adjustable: you can change these limits later; collectors will see this');
});

test('configuration encoding is byte-identical to encodeConfiguration', () => {
  const data = encodeKeelCampaignControlsConfiguration({ fields: ['maxPerWallet', 'maxSupply'], innerGate: inner, innerConfiguration: '0x1234' });
  assert.equal(data, CONTRACT_BYTES);
  const decoded = decodeKeelCampaignControlsConfiguration(data);
  assert.deepEqual(decoded.fields, ['maxPerWallet', 'maxSupply']);
  assert.equal(decoded.innerGate.toLowerCase(), inner);
  assert.throws(() => keelCampaignLimitMask(['unitPrice']), /Unsupported/u);
});

test('opting in keeps an existing project gate inside the plate and refuses bypassable Any logic', () => {
  const base = { target, payout: creator, maxSupply: 13, maxPerWallet: 2, customGate: inner, customGateData: '0x1234' };
  const config = buildCampaign(withAdjustableCampaignLimits(base, { controls: plate, fields: ['maxPerWallet', 'maxSupply'] }));
  assert.equal(config.customGate.toLowerCase(), plate);
  assert.equal(config.customGateData, CONTRACT_BYTES);
  assert.equal(config.accessFlags, 4);
  assert.equal(keelCampaignControlsFromConfig(config, plate).mode, 'adjustable');
  assert.deepEqual(keelCampaignControlsFromConfig(config, plate).fields, ['maxPerWallet', 'maxSupply']);

  assert.throws(() => withAdjustableCampaignLimits({ ...base, gateLogic: 1, merkleRoot: `0x${'ab'.repeat(32)}` }, { controls: plate, fields: ['maxPerWallet'] }), /All gate logic/u);
  assert.throws(() => withAdjustableCampaignLimits(base, { controls: plate, fields: [] }), /locked/u);
});

test('offline classification never guesses for an unknown custom gate', () => {
  const locked = buildCampaign({ target, payout: creator, maxSupply: 10, maxPerWallet: 2 });
  assert.equal(keelCampaignControlsFromConfig(locked).mode, 'locked');
  assert.equal(keelCampaignControlsFromConfig(locked).badge, 'Locked limits');
  const custom = buildCampaign({ target, payout: creator, maxSupply: 10, maxPerWallet: 2, customGate: inner });
  assert.equal(keelCampaignControlsFromConfig(custom), null);
  assert.equal(keelCampaignControlsFromConfig(custom, plate).mode, 'locked');
  const anyLogic = { ...custom, customGate: plate, customGateData: encodeKeelCampaignControlsConfiguration({ fields: ['maxPerWallet'] }), accessFlags: 5, gateLogic: 1 };
  assert.equal(keelCampaignControlsFromConfig(anyLogic, plate).mode, 'locked');
  assert.match(describeKeelCampaignControls(true, 1n).detail, /per-wallet limit/u);
});

test('limit update call encodes only the named fields', () => {
  const action = buildKeelCampaignLimitUpdate(plate, campaignId, { maxPerWallet: 1, endTime: 9_000 });
  assert.equal(action.authorization, 'campaign-authority');
  const decoded = decodeFunctionData({ abi: keelCampaignControlsAbi, data: action.data });
  assert.equal(decoded.functionName, 'updateCampaignLimits');
  assert.equal(decoded.args[1], 17n);
  assert.equal(decoded.args[2].maxPerWallet, 1n);
  assert.equal(decoded.args[2].endTime, 9_000n);
  assert.equal(decoded.args[2].maxSupply, 0n);
  assert.throws(() => buildKeelCampaignLimitUpdate(plate, campaignId, {}), /at least one/u);
  assert.throws(() => buildKeelCampaignLimitUpdate(plate, campaignId, { maxSupply: -1 }), /uint64/u);
});

const LIMITS = {
  adjustable: true, adjustableMask: 1n, overriddenMask: 1n, authority: creator, innerGate: '0x0000000000000000000000000000000000000000',
  maxSupply: 13n, maxPerWallet: 1n, maxPerTransaction: 0n, startTime: 0n, endTime: 0n, unitPrice: 10n ** 16n,
  minted: 4n, accountMinted: 1n, mintableNow: 0n, paused: false, closed: false, open: true,
};

test('typed reads pin one block and describe the mode', async () => {
  const client = {
    getBlockNumber: async options => { assert.equal(options.cacheTime, 0); return 9n; },
    readContract: async call => {
      assert.equal(call.blockNumber, 9n);
      return call.functionName === 'campaignControls' ? [true, 1n, creator] : LIMITS;
    },
  };
  const controls = await readKeelCampaignControls(client, plate, campaignId);
  assert.equal(controls.mode, 'adjustable');
  assert.deepEqual(controls.fields, ['maxPerWallet']);
  const limits = await readKeelEffectiveLimits(client, plate, campaignId, creator);
  assert.equal(limits.controls.badge, 'Adjustable limits');
  assert.deepEqual(limits.adjustedFields, ['maxPerWallet']);
});

test('keel-campaign-controls MCP tool reads live controls and classifies offline terms', async () => {
  const root = await mkdtemp('/tmp/keel-campaign-controls-'), previous = globalThis.fetch;
  try {
    await mkdir(`${root}/.keel`);
    await writeFile(`${root}/.keel/rpc.json`, JSON.stringify({ rpcUrls: ['https://rpc.example/sepolia'], minIntervalMs: 0 }));
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      let result = '0x10';
      if (body.method === 'eth_chainId') result = '0xaa36a7';
      if (body.method === 'eth_call') {
        const { functionName } = decodeFunctionData({ abi: keelCampaignControlsAbi, data: body.params[0].data });
        const values = { supportsInterface: true, campaignControls: [true, 1n, creator], effectiveLimits: LIMITS, gate: target };
        result = encodeFunctionResult({ abi: keelCampaignControlsAbi, functionName, result: values[functionName] });
      }
      return Response.json({ jsonrpc: '2.0', id: body.id, result });
    };
    const { createMcpServer } = await import('../packages/mcp/dist/index.js');
    const server = await createMcpServer({ workspaceRoot: root });
    await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'controls-test', version: '1' } } });
    const call = async (id, args) => (await server.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'keel-campaign-controls', arguments: args } })).result;
    const live = (await call(2, { chainId: 11155111, controls: plate, campaignId, account: creator })).structuredContent;
    assert.equal(live.source, 'live');
    assert.equal(live.controls.mode, 'adjustable');
    assert.equal(live.effectiveLimits.maxPerWallet, '1');
    assert.equal(live.signing, 'not-performed');

    const offline = (await call(3, { controls: plate, campaign: { customGate: inner, customGateData: '0x', accessFlags: 4, gateLogic: 0 } })).structuredContent;
    assert.equal(offline.controls.mode, 'locked');
    assert.equal(offline.modes.locked.label, keelCampaignLimitModes.locked.label);
  } finally {
    globalThis.fetch = previous;
    await rm(root, { recursive: true, force: true });
  }
});
