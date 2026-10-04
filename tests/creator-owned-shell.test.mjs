import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildKeelCreatorOwnedInlineDocument, buildKeelPreparedOneOfOneTokenURI, buildKeelInlineImageURI } from '../packages/sdk/dist/inline-viewer-graph.js';
import { KEEL_DEFAULT_SHELL, resolveKeelShell } from '../packages/protocol/dist/index.js';

const encoder = new TextEncoder();
const source = encoder.encode('<!doctype html><html><meta charset="utf-8"><style>body{background:#123}</style><main>Creator π · 100% # + &amp; / =</main><script>globalThis.creatorOwnsShell=true</script></html>');
const digest = bytes => `0x${createHash('sha256').update(bytes).digest('hex')}`;
const originalHtml = bytes => decodeURIComponent(decodeURIComponent(Buffer.from(bytes).toString('utf8')));
const imageURI = buildKeelInlineImageURI(encoder.encode('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>'), 'image/svg+xml');

test('the verification shell remains the strict shared default; creator-owned is explicit', () => {
  assert.equal(KEEL_DEFAULT_SHELL, 'keel-verification-shell');
  assert.equal(resolveKeelShell(), KEEL_DEFAULT_SHELL);
  assert.equal(resolveKeelShell('none'), 'none');
  assert.throws(() => resolveKeelShell('custom-fallback'), /shell|viewer/i);
});

test('creator-owned Compact and Raw retain exact UTF-8 HTML in one creator payload', async () => {
  for (const payloadStorage of [undefined, 'compact', 'raw']) {
    const input = source.slice();
    const { root, graph } = await buildKeelCreatorOwnedInlineDocument({ source: input, ...(payloadStorage ? { payloadStorage } : {}) });
    assert.deepEqual(root.rootBytes, source);
    assert.equal(root.rootIntegrity.digest, digest(source));
    assert.equal(root.parts.length, 1);
    assert.equal(root.parts[0].kind, 'creator');
    assert.equal(root.parts[0].role, 'entrypoint');
    assert.equal(graph.parts.length, 1);
    assert.equal(graph.mediaType, 'application/vnd.keel.token-uri-raw-percent-fragment');
    assert.equal(graph.creatorPublicationBytes, graph.fragmentBytes.byteLength);
    assert.equal(originalHtml(graph.fragmentBytes), Buffer.from(source).toString('utf8'));
    assert.equal(Buffer.from(graph.htmlBytes).includes('verify-corner'), false);
    assert.equal(Buffer.from(graph.htmlBytes).includes('storedBase64'), false);
    assert.equal(Buffer.from(graph.fragmentBytes).includes(';base64'), false);
    input.fill(0);
    assert.deepEqual(root.rootBytes, source, 'prepared bytes must not alias mutable caller input');
  }
});

test('prepared metadata carries creator-owned HTML through the existing raw COPY builder', async () => {
  const { graph } = await buildKeelCreatorOwnedInlineDocument({ source, payloadStorage: 'raw' });
  const input = { graph, chainId: 11155111, collection: `0x${'1'.repeat(40)}`, collectionName: 'Creator shell', description: 'Own HTML', imageURI, manifestURI: 'keel://fixture', manifestDigest: digest(source) };
  const prepared = await buildKeelPreparedOneOfOneTokenURI({ ...input, presentationPolicy: 'raw-artifact' });
  assert.equal(prepared.requiredBuilder, 'KeelRawTokenURIBuilder');
  assert.equal(prepared.animationEncoding, 'raw-percent');
  assert.ok(prepared.tokenURI.startsWith('data:application/json;charset=utf-8,'));
  const metadata = JSON.parse(decodeURIComponent(prepared.tokenURI.slice(prepared.tokenURI.indexOf(',') + 1)));
  assert.ok(metadata.animation_url.startsWith('data:text/html;charset=utf-8,'));
  const html = decodeURIComponent(metadata.animation_url.slice(metadata.animation_url.indexOf(',') + 1));
  assert.ok(html.startsWith(Buffer.from(source).toString('utf8')));
  assert.equal(html.includes('verify-corner'), false);
  await assert.rejects(buildKeelPreparedOneOfOneTokenURI(input), /canonical KEEL verification shell/);
});

test('explicit Raw preserves intentional creator-authored encoded markup without generating a sibling', async () => {
  const encoded = Buffer.alloc(8192, 42).toString('base64');
  const manual = encoder.encode(`<main>Manual decoder</main><script>globalThis.manual=atob("${encoded}")</script>`);
  const { root, graph } = await buildKeelCreatorOwnedInlineDocument({ source: manual, payloadStorage: 'raw' });
  assert.deepEqual(root.rootBytes, manual);
  assert.equal(originalHtml(graph.fragmentBytes), Buffer.from(manual).toString('utf8'));
  assert.equal(graph.parts.length, 1);
});

test('creator-owned HTML rejects missing, malformed, remote and adjacent runtime dependencies', async () => {
  for (const html of [
    '<script src="engine.js"></script>',
    '<script src=engine.js></script>',
    '<link href=local.css rel=stylesheet>',
    '<video poster=poster.png></video>',
    '<img src="https://example.invalid/art.png">',
    '<style>body{background:url(tile.png)}</style>',
    '<style>@import "local.css";</style>',
    "<style>@import 'local.css';</style>",
    '<script>import("./module.js")</script>',
    '<script>fetch("data.json")</script>',
  ]) {
    await assert.rejects(buildKeelCreatorOwnedInlineDocument({ source: encoder.encode(html), payloadStorage: 'raw' }), /self-contained|external|dependenc|resource/i);
  }
  await assert.rejects(buildKeelCreatorOwnedInlineDocument({ source: new Uint8Array() }), /nonempty/);
  await assert.rejects(buildKeelCreatorOwnedInlineDocument({ source: Uint8Array.of(0xff) }), /encoded|encoding|UTF/i);
  await assert.rejects(buildKeelCreatorOwnedInlineDocument({ source, payloadStorage: 'base64' }), /compact or raw/);
});

test('Raw keeps embedded unquoted references and CSS data imports exactly supplied', async () => {
  const embedded = encoder.encode('<main id=local>Own HTML</main><a href=#local>Local</a><img src=data:image/svg+xml,%3Csvg%2F%3E><style>@import "data:text/css,body%7Bcolor:teal%7D";</style>');
  const { root, graph } = await buildKeelCreatorOwnedInlineDocument({ source: embedded, payloadStorage: 'raw' });
  assert.deepEqual(root.rootBytes, embedded);
  assert.equal(originalHtml(graph.fragmentBytes), Buffer.from(embedded).toString('utf8'));
  assert.equal(graph.parts.length, 1);
});
