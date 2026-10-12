import assert from 'node:assert/strict';
import { closeSync, constants, fstatSync, openSync, readSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { collectCapturedStateWitness, validateCapturedStateSeed } from './captured-state-witness.mjs';

function readBounded(path, maximum) {
  assert.ok(isAbsolute(path), 'Use absolute input paths');
  // Opening the descriptor first binds the bytes read to this regular file.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    assert.ok(info.isFile() && info.size > 0 && info.size <= maximum, 'Input file exceeds bounds');
    const buffer = Buffer.alloc(info.size + 1); let count = 0, read;
    while (count < buffer.length && (read = readSync(fd, buffer, count, buffer.length - count, null)) > 0) count += read;
    assert.equal(count, info.size, 'Input size changed during read');
    const bytes = buffer.subarray(0, count);
    return { bytes, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } finally { closeSync(fd); }
}
export async function main(args = process.argv.slice(2), dependencies = {}) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node capture-state-witness.bundle.mjs --capture /absolute/capture.json --seed /absolute/seed.json --output /absolute/new-report.json\nFixed approved PublicNode, existing captured pin only. Seed proof collection does not establish full witness or publication acceptance.');
    return 0;
  }
  assert.ok(args.length === 6 && args[0] === '--capture' && args[2] === '--seed' && args[4] === '--output' && isAbsolute(args[5]), 'Use --capture, --seed, --output with absolute paths');
  const capture = readBounded(args[1], 32 * 1024 * 1024), seed = readBounded(args[3], 1024 * 1024);
  const input = { capture: capture.value, captureBytes: capture.bytes, seed: seed.value };
  validateCapturedStateSeed(input);
  const fd = openSync(args[5], 'wx', 0o600);
  try {
    const report = await collectCapturedStateWitness(input, dependencies);
    writeFileSync(fd, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, requests: report.requests.length, provedAccounts: report.provedAccounts,
      provedSlots: report.provedSlots, seedComplete: report.seedComplete, fullWitnessComplete: false, acceptance: false }));
    return report.seedComplete ? 0 : 1;
  } finally { closeSync(fd); }
}
