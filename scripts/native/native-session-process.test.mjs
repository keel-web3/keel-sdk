import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { keccak256, stringToHex } from 'viem';
import { createNativeProcessClient } from '../lib/native-session-process.mjs';

const required = name => { assert.ok(process.env[name], `Missing required native qualification input ${name}`); return process.env[name]; };
const binaryPath = required('KEEL_NATIVE_SESSION_BINARY');
const binarySHA256 = required('KEEL_NATIVE_SESSION_BINARY_SHA256');
const inputPath = required('KEEL_NATIVE_SESSION_INPUT');
const inputSHA256 = required('KEEL_NATIVE_SESSION_INPUT_SHA256');
const options = { binaryPath, binarySHA256, inputPath, inputSHA256 };
const input = JSON.parse(readFileSync(inputPath));
const programJSON = JSON.stringify(JSON.parse(readFileSync(required('KEEL_NATIVE_SESSION_PROGRAM'))));
const binding = { sessionId: 'private-process-test', programDigest: keccak256(stringToHex(programJSON)), canonicalHash: input.headerHash };
const evidence = [];
const use = async action => { const client = await createNativeProcessClient(options); try { await action(client); } finally { await client.close(); evidence.push(client.evidence); assert.equal(client.evidence.exitConfirmed, true); } };

test('actual native process verifies running binary/network namespace and closes after abort', () => use(async client => {
  assert.equal(client.evidence.isolated, true); assert.deepEqual(client.evidence.interfaces, ['lo']); assert.deepEqual(client.evidence.routes, []);
  const begin = await client.request({ id: 'begin', type: 'begin', ...binding, programJSON });
  assert.equal(begin.result.stageCount, 47); assert.equal(begin.result.status, 'open');
  assert.equal(begin.result.acceptance, false);
  const abort = await client.request({ id: 'abort', type: 'abort', ...binding });
  assert.equal(abort.result.status, 'aborted');
  const late = await client.request({ id: 'late', type: 'stage', ...binding, index: 0, expectedCheckpoint: input.headerHash });
  assert.equal(late.error.code, 'session-closed');
}));
test('unqualified binary hash fails before process launch', async () => {
  await assert.rejects(createNativeProcessClient({ ...options, binarySHA256: '0'.repeat(64) }), /reviewed build/);
});
test('witness byte drift fails before process launch', async () => {
  await assert.rejects(createNativeProcessClient({ ...options, inputSHA256: '0'.repeat(64) }), /witness input changed/);
});
test('oversized command and signing method fail without writing native request', () => use(async client => {
  await assert.rejects(client.request({ id: 'big', type: 'begin', ...binding, programJSON: '"'.repeat(9 * 1024 * 1024) }), /oversized/);
  await assert.rejects(client.request({ id: 'send', type: 'eth_sendRawTransaction' }), /Unsupported/);
  assert.equal(client.evidence.requests.length, 0);
}));
test('actual malformed-ID response cannot be attributed to requested identity', () => use(async client => {
  await assert.rejects(client.request({ id: 1, type: 'begin', ...binding, programJSON }), /response identity differs/);
}));
test('cancelled request closes process and cannot be reused', () => use(async client => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.request({ id: 'begin', type: 'begin', ...binding, programJSON }, { signal: controller.signal }), /cancelled/);
  await client.close();
  await assert.rejects(client.request({ id: 'reuse', type: 'begin', ...binding, programJSON }), /closed/);
}));
test('early process exit cannot qualify as a live isolated native session', async () => {
  const executable = '/usr/bin/true', digest = createHash('sha256').update(readFileSync(executable)).digest('hex');
  await assert.rejects(createNativeProcessClient({ ...options, binaryPath: executable, binarySHA256: digest }));
});
test.after(() => {
  if (process.env.KEEL_NATIVE_SESSION_EVIDENCE) writeFileSync(process.env.KEEL_NATIVE_SESSION_EVIDENCE,
    JSON.stringify({ synthetic: true, actualRetroAcceptance: false, evidence }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
});
