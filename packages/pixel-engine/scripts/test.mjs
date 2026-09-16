import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const reference = resolve(process.env.NOCTURNES ?? resolve(root, '../keel-nocturnes'));
const references = new Set(['audio-equality.test.mjs', 'audio.test.mjs', 'core-equality.test.mjs', 'scene-kit.test.mjs']);
const available = existsSync(resolve(reference, 'src/kit.js'));
const files = readdirSync(resolve(root, 'tests')).filter(name => name.endsWith('.test.mjs')).filter(name => {
  if (!available && references.has(name)) { console.log(`SKIP ${name}: set NOCTURNES to run external reference comparisons.`); return false; }
  return true;
});
const result = spawnSync(process.execPath, ['--test', ...files.map(name => resolve(root, 'tests', name))], { cwd: root, env: { ...process.env, NOCTURNES: reference }, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
