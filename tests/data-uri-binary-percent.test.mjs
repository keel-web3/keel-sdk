import test from 'node:test';
import assert from 'node:assert/strict';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';

// This is a byte-reader proof, not support for raw binary in a UTF-8 tokenURI.
const percent = bytes => Array.from(bytes, byte => '%' + byte.toString(16).toUpperCase().padStart(2, '0')).join('');
test('percent data URI returns every octet without text decoding', async () => {
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
  const response = await fetch('data:application/octet-stream,' + percent(bytes));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(await (await fetch('data:text/plain,Hello%20world')).text(), 'Hello world');
});
test('percent escaped Brotli survives nested JSON data URI and decompresses exactly', async () => {
  const source = Buffer.from('Hello world\0🔥%#"<script>' .repeat(100));
  const compressed = brotliCompressSync(source);
  const payload = 'data:application/octet-stream,' + percent(compressed);
  const metadata = 'data:application/json,' + encodeURIComponent(JSON.stringify({ payload, compression: 'brotli' }));
  const parsed = await (await fetch(metadata)).json();
  const returned = Buffer.from(await (await fetch(parsed.payload)).arrayBuffer());
  assert.deepEqual(returned, compressed);
  assert.deepEqual(brotliDecompressSync(returned), source);
});
