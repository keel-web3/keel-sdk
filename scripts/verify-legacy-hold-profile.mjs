import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import solc from 'solc';
import { keccak256 } from 'viem';

// Offline reproducible source audit, never an RPC or deployment command.
// A getter revert by itself must never select a fee-free legacy profile.
const [contractsRoot, output] = process.argv.slice(2);
if (!contractsRoot || !output) throw new Error('Supply the contracts checkout and audit output directory.');
const revision = '6d64c56ad7222e5f02b6590b6d91669235568da7';
const expectedRuntime = '0x077e7511ef8deb6d2c1d56041ee230a1f6ffac4b861bf264c37346835653e0e5';
const gitFile = file => execFileSync('git', ['show', `${revision}:${file}`], { cwd: resolve(contractsRoot), encoding: 'utf8' });
const config = gitFile('foundry.toml');
for (const line of ['solc_version = "0.8.36"', 'evm_version = "prague"', 'optimizer_runs = 200', 'via_ir = true', 'bytecode_hash = "none"', 'cbor_metadata = false']) assert.ok(config.includes(line), `Historical compiler setting changed: ${line}`);
assert.ok(solc.version().startsWith('0.8.36+commit.8a079791.'), 'Exact recorded Solidity compiler required.');
const sources = Object.fromEntries(['KeelHold.sol', 'Ingot.sol'].map(name => {
  const path = `src/modules/keel-hold/${name}`;
  return [path, { content: gitFile(path) }];
}));
const settings = { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'prague',
  metadata: { bytecodeHash: 'none', appendCBOR: false },
  outputSelection: { '*': { '*': ['abi', 'evm.deployedBytecode.object', 'evm.bytecode.object'] } } };
const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings })));
const errors = (compiled.errors ?? []).filter(item => item.severity === 'error');
assert.deepEqual(errors, [], 'Historical source must compile without errors.');
const artifact = compiled.contracts['src/modules/keel-hold/KeelHold.sol'].KeelHold;
const runtime = `0x${artifact.evm.deployedBytecode.object}`;
assert.equal(keccak256(runtime), expectedRuntime, 'Source does not reproduce the observed legacy runtime. No legacy policy can be inferred.');
assert.equal((runtime.length - 2) / 2, 6922);
for (const name of ['castSlugs', 'weldObject', 'weldComposite']) assert.equal(artifact.abi.find(item => item.name === name)?.stateMutability, 'nonpayable');
for (const name of ['manager', 'limits', 'sealFees', 'feeExempt', 'quoteWeld', 'initWeld', 'requireSystemsActive']) assert.equal(artifact.abi.some(item => item.name === name), false, `Unexpected modern policy: ${name}`);
const sha = text => createHash('sha256').update(text).digest('hex');
const report = { schema: 'keel-legacy-hold-source-audit@1', status: 'observed-runtime-reproduced-offline', sourceRevision: revision,
  compiler: solc.version(), settings, sources: Object.fromEntries(Object.entries(sources).map(([name, { content }]) => [name, { bytes: Buffer.byteLength(content), sha256: sha(content) }])),
  historicalFoundryConfigSha256: sha(config), chainId: 11155111, observedAddress: '0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267',
  runtimeBytes: 6922, runtimeCodeHash: expectedRuntime,
  observedEvidence: 'libfile_a6eb6b43c4348191b22966134117f6e9 / pr38/shell-public-preapproval.json, block 11888013',
  policy: { maxSlugBytes: 23000, maxBatchSlugs: 3, maxChildrenPerObject: 128, maxReadDepth: 16,
    writeMethods: ['castSlugs', 'weldObject', 'weldComposite'], contractProtocolFeeWei: '0', contractManager: null, contractPausePolicy: null },
  limitations: ['No fresh chain read, receipt authentication or signing occurred.', 'This profile applies only after the exact runtime and selected chain match, never merely after a modern getter reverts.',
    'Zero contract protocol fee is not a transaction fee quote or a statement about a separate managed publication service.',
    'Exact transaction capacity, fee envelopes, sequential simulation, keeper authorization and public readback remain required.',
    'Existing artwork, object identities, paid storage and journals remain unchanged.'],
  deploymentAllowed: false, submissionAllowed: false, liveSimulationQualified: false, publicationVerified: false };
const directory = resolve(output); await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, 'legacy-hold-profile.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(resolve(directory, 'legacy-hold-artifact.json'), `${JSON.stringify({ abi: artifact.abi, runtime, runtimeCodeHash: expectedRuntime }, null, 2)}\n`);
await writeFile(resolve(directory, 'historical-source.json'), `${JSON.stringify({ revision, config, sources }, null, 2)}\n`);
console.log(JSON.stringify({ directory, runtimeBytes: report.runtimeBytes, runtimeCodeHash: report.runtimeCodeHash, submissionAllowed: false }));
