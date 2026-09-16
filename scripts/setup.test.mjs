import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { connectWorkspace, parseSetup, sdkRoot } from './setup.mjs';
import { checkSepolia } from './check-sepolia.mjs';
import { keelContracts, SEPOLIA_KEEL } from '../packages/game-engine/chain/contracts.mjs';
import { keccak256 } from 'viem';
import { searchKeelRuntimeModules } from '../packages/sdk/dist/runtime-module-index.js';

test('local catalog discovery rejects non-loopback HTTP and credential-bearing origins', async () => {
  for (const studioUrl of ['http://example.com', 'http://127.0.0.1.example.com', 'http://user:password@127.0.0.1', 'http://localhost/private', 'http://localhost?token=secret']) {
    await assert.rejects(searchKeelRuntimeModules({ studioUrl, query: 'test', fetch: () => { throw Error('Must reject before fetching'); } }));
  }
});

test('workspace connection scopes reads and preserves existing settings and skills', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keel setup space-'));
  try {
    connectWorkspace(dir);
    const config = JSON.parse(readFileSync(join(dir, '.mcp.json')));
    assert.deepEqual(config.mcpServers.keel.args.slice(-2), ['--workspace', dir]);
    connectWorkspace(dir, sdkRoot, '/private/editor/workspace-connection.json');
    assert.equal(JSON.parse(readFileSync(join(dir, '.mcp.json'))).mcpServers.keel.env.KEEL_EDITOR_CONNECTION, '/private/editor/workspace-connection.json');
    const skill = join(dir, '.agents/skills/fray-keel-agent/SKILL.md');
    assert.match(readFileSync(skill, 'utf8'), /Fray KEEL Agent/);
    writeFileSync(skill, 'my customized skill');
    writeFileSync(join(dir, '.codex/config.toml'), 'model = "my-model"\n');
    const next = connectWorkspace(dir);
    assert.equal(JSON.parse(readFileSync(join(dir, '.mcp.json'))).mcpServers.keel.env.KEEL_EDITOR_CONNECTION, '/private/editor/workspace-connection.json');
    assert.ok(next.preserved.includes(dirname(skill)));
    assert.equal(readFileSync(skill, 'utf8'), 'my customized skill');
    assert.equal(readFileSync(join(dir, '.codex/config.toml'), 'utf8'), 'model = "my-model"\n');
    assert.match(readFileSync(join(dir, '.keel/codex.toml'), 'utf8'), /mcp_servers.keel/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('setup rejects unknown and incomplete options', () => {
  assert.throws(() => parseSetup(['--workspace']));
  assert.throws(() => parseSetup(['--network', 'mainnet']));
  assert.equal(parseSetup(['--skip-desktop']).desktop, false);
});

test('Sepolia checks reject wrong chain, code, receipt and builder binding', async () => {
  const record = structuredClone(keelContracts());
  for (const entry of Object.values(record.contracts)) entry.runtimeCodeHash = keccak256('0x1234');
  const client = {
    getChainId: async () => 11155111,
    getBlockNumber: async () => 100n,
    getCode: async () => '0x1234',
    getTransactionReceipt: async ({ hash }) => ({ status: 'success', blockNumber: 1n, contractAddress: Object.values(record.contracts).find(e => e.deploymentTransaction === hash).sepolia }),
    readContract: async () => SEPOLIA_KEEL.KeelHold,
  };
  assert.equal((await checkSepolia(client, record)).writes, 0);
  await assert.rejects(checkSepolia({ ...client, getChainId: async () => 1 }, record), /Expected Sepolia/);
  await assert.rejects(checkSepolia({ ...client, getCode: async () => '0x' }, record), /runtime code/);
  await assert.rejects(checkSepolia({ ...client, getTransactionReceipt: async () => ({ status: 'reverted' }) }, record), /receipt/);
  await assert.rejects(checkSepolia({ ...client, readContract: async () => '0x0000000000000000000000000000000000000000' }, record), /another storage/);
});
