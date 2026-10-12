import assert from 'node:assert/strict';
import { openSync, closeSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { readBounded } from './captured-state-witness-cli.mjs';
import { planCapturedStateInventory, collectCapturedStateInventory } from './captured-state-inventory.mjs';

export async function main(args = process.argv.slice(2), dependencies = {}) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node capture-state-inventory.mjs --capture /absolute/capture.json --seed /absolute/seed.json --output /absolute/new-report.json\nFixed PublicNode, one captured pin, complete bound inventory in bounded pages. No simulation, wallet proof or automatic dependency expansion.');
    return 0;
  }
  assert.ok(args.length === 6 && args[0] === '--capture' && args[2] === '--seed' && args[4] === '--output' && isAbsolute(args[5]), 'Use --capture, --seed, --output with absolute paths');
  const capture = readBounded(args[1], 32 * 1024 * 1024), seed = readBounded(args[3], 1024 * 1024);
  const input = { capture: capture.value, captureBytes: capture.bytes, seed: seed.value };
  planCapturedStateInventory(input);
  const fd = openSync(args[5], 'wx', 0o600);
  try {
    const report = await collectCapturedStateInventory(input, dependencies);
    writeFileSync(fd, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, requests: report.requestCount,
      pages: report.pages.length, inventoryComplete: report.inventoryComplete,
      fullWitnessComplete: false, acceptance: false }));
    return report.inventoryComplete ? 0 : 1;
  } finally { closeSync(fd); }
}
