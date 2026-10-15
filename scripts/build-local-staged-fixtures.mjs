#!/usr/bin/env node
// Offline synthetic fixture builder. Never loads a creator/project capture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import solc from 'solc';
import { encodeAbiParameters, encodeFunctionData, parseAbi, keccak256 } from 'viem';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2), options = {};
if (args.length === 1 && args[0] === '--help') {
  console.log('node scripts/build-local-staged-fixtures.mjs --native-build ABS --module-cache ABS --build-cache ABS --output NEW_ABS_DIRECTORY\nOffline only; uses the verified native build and pinned local solc. Produces synthetic witnesses, never project state.');
  process.exit(0);
}
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--native-build', '--module-cache', '--build-cache', '--output'].includes(args[i]) && !options[args[i]] && isAbsolute(args[i + 1] ?? ''), 'Explicit unique absolute paths required');
  options[args[i]] = args[i + 1];
}
assert.equal(Object.keys(options).length, 4, 'All four paths are required');
const nativeBuild = options['--native-build'], output = options['--output'];
const buildReceiptBytes = readFileSync(join(nativeBuild, 'build-receipt.json')), buildReceipt = JSON.parse(buildReceiptBytes);
const sourceManifestBytes = readFileSync(join(root, 'scripts/native/canonical-state-engine/source-manifest.json'));
assert.equal(buildReceipt.schema, 'keel-canonical-native-engine-build@1');
assert.equal(buildReceipt.sourceManifestSHA256, sha(sourceManifestBytes), 'Rebuild the exact maintained native sources first');
assert.equal(sha(readFileSync(join(nativeBuild, 'keel-sparse'))), buildReceipt.binarySHA256);
assert.equal(sha(readFileSync(join(nativeBuild, 'go/bin/go'))), buildReceipt.toolchain.compilerSHA256);
assert.match(solc.version(), /^0\.8\.36\+/);
mkdirSync(output, { mode: 0o700 }); // Existing fixture directories are never replaced.
const files = {};
function save(name, content) {
  const bytes = typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n';
  writeFileSync(join(output, name), bytes, { flag: 'wx', mode: 0o600 });
  files[name] = { bytes: Buffer.byteLength(bytes), sha256: sha(bytes) };
}
function compile(name) {
  const source = readFileSync(join(root, 'tests/fixtures/native-geth-publication', name + '.sol'), 'utf8');
  const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { [name + '.sol']: { content: source } }, settings: {
    evmVersion: 'osaka', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['evm.deployedBytecode.object'] } }
  } })));
  assert.deepEqual((compiled.errors ?? []).filter(error => error.severity === 'error'), []);
  return { sourceSHA256: sha(source), runtime: '0x' + compiled.contracts[name + '.sol'][name].evm.deployedBytecode.object };
}
const state = compile('StateSequence'), atomic = compile('SyntheticAtomicExecutor');
save('runtime.hex', state.runtime + '\n'); save('atomic-runtime.hex', atomic.runtime + '\n');
const owner = '0x' + '11'.repeat(20), reader = '0x' + '22'.repeat(20);
const abi = parseAbi(['function write(uint256) returns(uint256)', 'function read() view returns(uint256)', 'function tokenURIForCount(uint256) view returns(string)']);
const call = (data, nonce, to = reader) => ({ from: owner, to, data, value: '0x0', gas: '0xf42400', gasPrice: '0x30', nonce: '0x' + nonce.toString(16) });
const program = calls => ({ blockStateCalls: calls.map(item => ({ calls: [item] })), validation: true, traceTransfers: false, returnFullTransactions: true });
const calls = Array.from({ length: 45 }, (_, i) => call(encodeFunctionData({ abi, functionName: 'write', args: [1n] }), i));
calls.push(call(encodeFunctionData({ abi, functionName: 'read' }), 45), call(encodeFunctionData({ abi, functionName: 'tokenURIForCount', args: [87n] }), 46));
save('program.json', program(calls));
const inner = Array.from({ length: 6 }, () => ({ target: reader, value: 0n, callData: encodeFunctionData({ abi, functionName: 'write', args: [1n] }) }));
const atomicData = encodeFunctionData({ abi: parseAbi(['function execute(bytes32 mode, bytes executionCalldata) payable']), functionName: 'execute', args: [
  '0x01' + '00'.repeat(31), encodeAbiParameters([{ type: 'tuple[]', components: [{ name: 'target', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'callData', type: 'bytes' }] }], [inner])
] });
save('atomic-program.json', program([call(atomicData, 0, owner)]));
const expectedURI = 'data:application/json,{"name":"Synthetic state sequence"}';
save('manifest.json', { schema: 'keel-local-staged-synthetic-fixture@1', synthetic: true, productionStateUsed: false, compiler: solc.version(), sourceHashes: {
  StateSequence: state.sourceSHA256, SyntheticAtomicExecutor: atomic.sourceSHA256
}, runtimeHash: keccak256(state.runtime), delegateRuntimeHash: keccak256(atomic.runtime), calls: 47, initialSlotZero: '42', expectedFinalSlotZero: '87',
  expectedURI, metadataABI: encodeAbiParameters([{ type: 'string' }], [expectedURI]), atomicInnerCalls: 6, atomicOuterCalls: 1, atomicExpectedFinalSlotZero: '48' });
for (const variant of ['staged', 'atomic']) {
  const inputName = variant === 'staged' ? 'input.json' : 'atomic-input.json';
  const result = spawnSync(join(nativeBuild, 'go/bin/go'), ['test', '-count=1', '-v', '-run', '^TestKeelExportSyntheticFixture$', './internal/ethapi'], {
    cwd: join(nativeBuild, 'go-ethereum-' + buildReceipt.upstream.commit), encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, GOTOOLCHAIN: 'local', GOPROXY: 'off', CGO_ENABLED: '0', GOMODCACHE: options['--module-cache'], GOCACHE: options['--build-cache'],
      KEEL_SYNTHETIC_RUNTIME: join(output, 'runtime.hex'), KEEL_SYNTHETIC_PROGRAM: join(output, variant === 'staged' ? 'program.json' : 'atomic-program.json'),
      KEEL_SYNTHETIC_FIXTURE_OUTPUT: join(output, inputName), ...(variant === 'atomic' ? { KEEL_SYNTHETIC_DELEGATE_RUNTIME: join(output, 'atomic-runtime.hex') } : {}) }
  });
  save(variant + '-export.log', (result.stdout ?? '') + (result.stderr ?? ''));
  assert.equal(result.status, 0, result.error?.message ?? 'Native proof fixture export failed');
  assert.match(result.stdout, /--- PASS: TestKeelExportSyntheticFixture/);
  for (const name of [inputName, inputName + '.header.json']) { const bytes = readFileSync(join(output, name)); files[name] = { bytes: bytes.length, sha256: sha(bytes) }; }
}
save('fixture-receipt.json', { schema: 'keel-local-staged-fixture-build@1', synthetic: true, projectAcceptance: false, nativeBuildReceiptSHA256: sha(buildReceiptBytes),
  sourceManifestSHA256: sha(sourceManifestBytes), binarySHA256: buildReceipt.binarySHA256, builderSHA256: sha(readFileSync(fileURLToPath(import.meta.url))), files });
console.log(JSON.stringify({ fixtureDirectory: output, fixtureReceiptSHA256: sha(readFileSync(join(output, 'fixture-receipt.json'))), synthetic: true, projectAcceptance: false }));
