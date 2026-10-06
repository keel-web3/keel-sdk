import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Install at keel-sdk/scripts/build-ppmd-runtime.mjs.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), input = args.find(arg => arg !== '--check');
if (!input) throw new Error('Usage: build-ppmd-runtime.mjs cooperative.mjs [--check]');
const require = createRequire(path.join(root, 'packages/builder/package.json'));
if (require('terser/package.json').version !== '5.44.0') throw new Error('Pinned Terser 5.44.0 required');
const {minify} = require('terser');
const generated = await readFile(input, 'utf8');
const end = generated.indexOf('export var memory =');
if (end < 0 || !generated.includes('retasmFunc.step')) throw new Error('Unexpected wasm2js output');
const wrapper = 'export function createPpmdRuntime() {\n' + generated.slice(0, end) + '\nreturn {memory:retasmFunc.memory,allocate:retasmFunc.allocate,start:retasmFunc.start,step:retasmFunc.step,reset:retasmFunc.reset};\n}\n';
const compact = await minify(wrapper, {module:true, compress:{passes:3}, mangle:true, format:{comments:false}});
if (!compact.code) throw new Error('Decoder minifier failed');
const source = '// @ts-nocheck\n// Decode-only ppmd-rust 1.4.1; CC0-1.0 OR MIT-0.\n// Rust 1.94 -> wasm2js 132 -> Terser 5.44.0 (3 passes). See ../PPMD.md.\n' + compact.code + '\n';
const output = path.join(root, 'packages/sdk/src/decoders/vendor/ppmd-runtime.ts');
const digest = createHash('sha256').update(source).digest('hex');
if (args.includes('--check')) {
  if (await readFile(output, 'utf8') !== source) throw new Error('Generated decoder differs from the committed runtime');
} else {
  await writeFile(output, source);
  const provenance = path.join(root, 'packages/sdk/src/decoders/provenance.ts');
  const previous = await readFile(provenance, 'utf8');
  const next = previous.replace(/("ppmd":.*?"derivedSha256":")[0-9a-f]+/s, '$1' + digest);
  if (next === previous && !previous.includes(digest)) throw new Error('PPMd provenance entry missing');
  await writeFile(provenance, next);
}
console.log(JSON.stringify({status:args.includes('--check') ? 'exact-runtime-replay' : 'generated', bytes:Buffer.byteLength(source), sha256:digest}));
