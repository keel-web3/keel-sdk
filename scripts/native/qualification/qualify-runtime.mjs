#!/usr/bin/env node
// Runs only maintained, offline synthetic native qualification. No activation.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { machine } from 'node:os';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2), options = {};
if (args.join(' ') === '--help') {
  console.log('node scripts/native/qualification/qualify-runtime.mjs --native-build ABS --fixtures ABS --output NEW_ABS_DIRECTORY\nRequires native x86_64 Linux, pinned native build and offline synthetic fixtures. Never enables the capacity patch.');
  process.exit(0);
}
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--native-build', '--fixtures', '--output'].includes(args[i]) && !options[args[i]] && isAbsolute(args[i + 1] ?? ''), 'Explicit unique absolute paths required');
  options[args[i]] = args[i + 1];
}
assert.equal(Object.keys(options).length, 3);
assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64'); assert.equal(machine(), 'x86_64', 'Current reviewed executable requires a native x86_64 Linux kernel; do not bypass /proc identity under emulation');
assert.equal(process.version, 'v22.23.1');
const output = options['--output']; mkdirSync(output, { mode: 0o700 });
const env = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', LANG: 'C', TZ: 'UTC' };
function run(name, command, argv) {
  const result = spawnSync(command, argv, { cwd: repo, env, encoding: 'utf8', timeout: 600_000, maxBuffer: 32 * 1024 * 1024 });
  const log = (result.stdout ?? '') + (result.stderr ?? '');
  writeFileSync(join(output, name + '.log'), log, { flag: 'wx', mode: 0o600 });
  assert.equal(result.error, undefined, result.error?.message); assert.equal(result.status, 0, name + ' failed; preserve its log and stop');
  return log;
}
const receipt = { schema: 'keel-native-runtime-qualification@1', node: process.version, kernelMachine: machine(),
  mechanismQualified: false, actualCandidateExecuted: false, productionRuntimeMatched: false, capacityEnabled: false,
  signing: false, submission: false, networkRequests: 0, steps: [] };
try {
  const probeLog = run('namespace-probe', process.execPath, ['scripts/native/qualification/runtime-probe.mjs']);
  const probe = JSON.parse(probeLog); assert.equal(probe.namespaceProbePassed, true); receipt.runtime = probe;
  const nativeBuild = options['--native-build'], buildBytes = readFileSync(join(nativeBuild, 'build-receipt.json')), build = JSON.parse(buildBytes);
  const sourceManifest = readFileSync(join(repo, 'scripts/native/canonical-state-engine/source-manifest.json'));
  assert.equal(build.schema, 'keel-canonical-native-engine-build@1'); assert.equal(build.sourceManifestSHA256, sha(sourceManifest));
  const binaryPath = join(nativeBuild, 'keel-sparse'); assert.ok(lstatSync(binaryPath).isFile() && !lstatSync(binaryPath).isSymbolicLink());
  const binary = readFileSync(binaryPath); assert.equal(sha(binary), build.binarySHA256);
  assert.equal(binary.subarray(0, 4).toString('hex'), '7f454c46'); assert.equal(binary[4], 2); assert.equal(binary[5], 1); assert.equal(binary.readUInt16LE(18), 62, 'Require the reviewed amd64 ELF');
  receipt.binarySHA256 = build.binarySHA256; receipt.buildReceiptSHA256 = sha(buildBytes); receipt.sourceManifestSHA256 = sha(sourceManifest);
  run('complete-staged-native', process.execPath, ['scripts/verify-local-staged-publication.mjs', '--native-build', nativeBuild,
    '--fixtures', options['--fixtures'], '--output', join(output, 'staged')]);
  receipt.steps.push('actual native process controls, complete staged storage + strict replay + full metadata, reorg/cancellation/revert/atomic controls');
  run('authenticated-witness-expansion', process.execPath, ['scripts/verify-native-witness-resolution.mjs', '--native-build', nativeBuild,
    '--fixtures', options['--fixtures'], '--output', join(output, 'witness')]);
  receipt.steps.push('actual native missing-access discovery, proof expansion, replay, corruption/reorg/cancellation negatives');
  receipt.mechanismQualified = true;
} finally {
  writeFileSync(join(output, 'qualification.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
console.log('Offline native mechanism qualified in this exact runtime. Production identity and actual candidate qualification remain separate.');
