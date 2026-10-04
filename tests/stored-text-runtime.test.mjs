import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';

const sdkRoot = fileURLToPath(new URL('..', import.meta.url));
const stageRoot = sdkRoot;
const sourceRoot = path.join(sdkRoot, 'packages/sdk/src');
const requireSdk = createRequire(path.join(sdkRoot, 'package.json'));
const { build } = requireSdk('esbuild');
const scratch = await mkdtemp(path.join(tmpdir(), 'keel-stored-text-proof-'));
after(() => rm(scratch, { recursive: true, force: true }));
const verificationPath = path.join(sourceRoot, 'verification-shell.ts');
const inlinePath = path.join(sourceRoot, 'inline-viewer-graph.ts');
const result = await build({
  stdin: {
    contents: `export * from ${JSON.stringify(verificationPath)};export * from ${JSON.stringify(inlinePath)};`,
    loader: 'ts', resolveDir: sourceRoot,
  },
  bundle: true, platform: 'node', format: 'esm', target: 'node22', write: false,
  banner: { js: `import {createRequire as __proofRequire} from 'node:module';const require=__proofRequire(${JSON.stringify(path.join(sdkRoot, 'package.json'))});` },
  plugins: [{
    name: 'read-only-sdk-overlay',
    setup(builder) {
      builder.onResolve({ filter: /^\.\.?\// }, args => {
        if (!args.resolveDir.startsWith(sourceRoot)) return;
        const candidate = path.resolve(args.resolveDir, args.path);
        const typescript = candidate.replace(/\.js$/u, '.ts');
        if (existsSync(candidate) || existsSync(typescript)) return { path: existsSync(candidate) ? candidate : typescript };
        return { path: path.join(sdkRoot, 'packages/sdk/dist', path.relative(sourceRoot, candidate)), external: true };
      });
      builder.onResolve({ filter: /^[^./]/ }, args => {
        if (args.path.startsWith('node:') || path.isAbsolute(args.path)) return;
        if (args.path === '@keel/protocol') return { path: path.join(sdkRoot, 'packages/protocol/dist/index.js'), external: true };
        return { path: requireSdk.resolve(args.path), external: true };
      });
      builder.onLoad({ filter: /verification-shell\.ts$/ }, async args => ({
        contents: (await readFile(args.path, 'utf8')).replace('function compactInlineRuntime(', 'export function compactInlineRuntime('),
        loader: 'ts', resolveDir: path.dirname(args.path),
      }));
    },
  }],
});
const bundlePath = path.join(scratch, 'staged-sdk.mjs');
await writeFile(bundlePath, result.outputFiles[0].contents);
const sdk = await import(pathToFileURL(bundlePath));
const original = await import(pathToFileURL(path.join(sdkRoot, 'packages/sdk/dist/verification-shell.js')));
const utf8 = value => new TextEncoder().encode(value);
const text = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const integrity = bytes => ({ algorithm: 'sha256', byteLength: bytes.length, digest: '0x' + createHash('sha256').update(bytes).digest('hex') });
const slotItem = fragment => JSON.parse(text(fragment).slice(1));
const shell = {
  schema: 'keel-inline-shell-fragments@1', codecProfile: 'browser-gzip-deflate',
  prefix: { bytes: utf8('<script>globalThis.__KEEL_ITEMS__=[null'), integrity: integrity(utf8('<script>globalThis.__KEEL_ITEMS__=[null')) },
  suffix: { bytes: utf8('];</script>'), integrity: integrity(utf8('];</script>')) },
};
const published = fragment => {
  const bytes = utf8(encodeURIComponent(encodeURIComponent(text(fragment))));
  return { bytes, integrity: integrity(bytes), carrier: { chainId: 31337, store: '0x' + '11'.repeat(20), objectId: '0x' + '22'.repeat(32),
    mediaType: 'application/vnd.keel.token-uri-raw-percent-fragment', compression: 'none', storedByteLength: bytes.length } };
};

// Return the real compact reader before UI launch; the source change exists only in this proof bundle.
const compactSource = sdk.compactInlineRuntime.toString().replace('const dataURL =', 'return resolve;\nconst dataURL =');
assert.notEqual(compactSource, sdk.compactInlineRuntime.toString());
class Element {}
const compactRead = vm.runInNewContext(`(${compactSource})(()=>{},'',()=>{throw Error('unexpected Keccak')})`, {
  HTMLElement: Element, document: { querySelector: () => new Element() }, TextEncoder, TextDecoder, Uint8Array, DataView,
  crypto: webcrypto, atob, Blob, Response, DecompressionStream, URL, AbortController, setTimeout, clearTimeout,
});

// Exercise the canonical standalone reader and its commitment verifier without mounting its UI.
const runtime = await readFile(path.join(stageRoot, 'examples/demos/keel-creative-lab/keel-verifier-runtime.js'), 'utf8');
const between = (start, end) => {
  const from = runtime.indexOf(start), to = runtime.indexOf(end, from);
  assert(from >= 0 && to > from, `missing standalone proof hook ${start}`);
  return runtime.slice(from, to);
};
const standaloneRead = vm.runInNewContext(`(()=>{${between('async function verify(', 'async function decompress(')}
${between('async function decompress(', 'const rpcUrls =')}
${between('async function readEmbeddedItem(', 'async function resolveItem(')}
return readEmbeddedItem;})()`, {
  TextEncoder, TextDecoder, Uint8Array, Blob, Response, DecompressionStream,
  fromBase64: value => Uint8Array.from(atob(value), ch => ch.charCodeAt(0)),
  equal: (a, b) => a.length === b.length && a.every((value, index) => value === b[index]),
  bytesFromHex: value => Uint8Array.from(Buffer.from(value.slice(2), 'hex')),
  digest: async bytes => new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes)),
});
const hostile = '\uFEFFconst literal = "</ScRiPt><script>globalThis.INJECTED=true</script>";\r\n// π 🚀\u2028\u2029 & < > " \\ \0';

test('raw slot preserves BOM, UTF-8 bytes, digests and script terminators without Base64 conversion', async () => {
  const bytes = utf8(hostile);
  const previous = Buffer.prototype.toString;
  let conversions = 0;
  Buffer.prototype.toString = function (encoding, ...args) {
    if (encoding === 'base64') { conversions++; throw Error('unexpected fresh Base64 conversion'); }
    return previous.call(this, encoding, ...args);
  };
  let slot;
  try { slot = await sdk.buildEmbeddedKeelViewerSlot({ id: 'raw.js', role: 'module', mediaType: 'text/javascript', bytes }); }
  finally { Buffer.prototype.toString = previous; }
  assert.equal(conversions, 0);
  assert.equal(slot.item.embedded.storedText, hostile);
  assert.equal(Object.hasOwn(slot.item.embedded, 'storedBase64'), false);
  assert.equal(slot.item.embedded.compression, 'none');
  assert.deepEqual(slot.item.integrity, integrity(bytes));
  assert.deepEqual(slot.item.embedded.storedIntegrity, integrity(bytes));
  assert.doesNotMatch(text(slot.fragment), /<\/script/iu);
  assert.match(text(slot.fragment), /\\u003c/u);
  assert.deepEqual(utf8(slotItem(slot.fragment).embedded.storedText), bytes);
  assert.deepEqual(await compactRead(slot.item), bytes);
  assert.deepEqual(await standaloneRead(slot.item), bytes);
});

test('fresh modules, HTML entry, text asset and platform display helper default to raw text', async () => {
  const module = await sdk.buildKeelInlineModuleFragment({ moduleId: 'raw.module', version: '1', mediaType: 'text/javascript', decodedBytes: utf8(hostile) });
  const entry = utf8('\uFEFF<!doctype html><body><script>globalThis.answer="</script>";</script></body>');
  const style = utf8('\uFEFFbody::before{content:"π </script>"}\r\n');
  const local = await sdk.buildKeelInlineLocalDocument({ shell, modules: [module], entry: { id: 'entry', mediaType: 'text/html', source: entry },
    assets: [{ id: 'style', mediaType: 'text/css', source: style }] });
  for (const part of local.parts.filter(part => part.role === 'module' || part.kind === 'creator')) {
    const item = slotItem(part.bytes);
    assert.equal(item.embedded.compression, 'none');
    assert.equal(typeof item.embedded.storedText, 'string');
    assert.equal(Object.hasOwn(item.embedded, 'storedBase64'), false);
    const expected = item.id === 'entry' ? entry : item.id === 'style' ? style : utf8(hostile);
    assert.deepEqual(await compactRead(item), expected);
  }
  const display = await sdk.buildKeelInlineAssetDisplayModuleFragment();
  assert.equal(display.item.embedded.compression, 'none');
  assert.equal(typeof display.item.embedded.storedText, 'string');
  assert.equal(Object.hasOwn(display.item.embedded, 'storedBase64'), false);
});

test('published raw-text module verifier preserves exact BOM bytes and legacy gzip module bytes', async () => {
  for (const compression of [undefined, 'gzip']) {
    const decodedBytes = utf8(hostile);
    const module = await sdk.buildKeelInlineModuleFragment({ moduleId: 'reused.module', version: '1', mediaType: 'text/javascript', aliases: ['alias'],
      decodedBytes, ...(compression ? { compression } : {}) });
    await sdk.verifyKeelPublishedInlineModuleFragment({ fragment: published(module.bytes), moduleId: module.moduleId,
      mediaType: 'text/javascript', aliases: ['alias'], decodedBytes });
  }
});

test('legacy binary and compressed slots keep their exact original serialized bytes and both readers', async () => {
  const bytes = Uint8Array.of(0, 255, 127, 128, 1, 13, 10);
  for (const compression of ['none', 'gzip']) {
    const options = { id: 'binary', role: 'asset', mediaType: 'application/octet-stream', bytes, compression };
    const before = await original.buildEmbeddedKeelViewerSlot(options);
    const after = await sdk.buildEmbeddedKeelViewerSlot(options);
    assert.deepEqual(after, before);
    assert.deepEqual(await compactRead(after.item), bytes);
    assert.deepEqual(await standaloneRead(after.item), bytes);
    const expectedStored = compression === 'gzip' ? gzipSync(bytes, { level: 9 }) : bytes;
    assert.deepEqual(Uint8Array.from(Buffer.from(after.item.embedded.storedBase64, 'base64')), new Uint8Array(expectedStored));
  }
});

test('readers reject ambiguous, compressed-text, malformed UTF-16 and altered raw-text commitments', async () => {
  const { item } = await sdk.buildEmbeddedKeelViewerSlot({ id: 'valid', role: 'asset', mediaType: 'text/plain', bytes: utf8(hostile) });
  for (const embedded of [
    { ...item.embedded, storedBase64: 'AA==' },
    { ...item.embedded, compression: 'gzip' },
    { ...item.embedded, storedText: '\ud800' },
    { ...item.embedded, storedText: hostile.slice(1) },
    { compression: 'none' },
  ]) {
    await assert.rejects(() => compactRead({ ...item, embedded }));
    await assert.rejects(() => standaloneRead({ ...item, embedded }));
  }
  await assert.rejects(() => sdk.buildEmbeddedKeelViewerSlot({ id: 'invalid', role: 'asset', mediaType: 'text/plain', bytes: Uint8Array.of(255) }));
});
