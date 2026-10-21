import {withCurrentCanonicalFrames,currentNativeGzipProof,currentCanonicalShell} from './support/current-canonical-fixture.mjs';
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  KEEL_ASSET_DISPLAY_MODULE_ID,
  buildKeelInlineAssetDisplayModuleFragment,
  buildKeelInlineLocalDocument,
  buildKeelInlineModuleFragment,
  buildKeelInlineImageURI,
  buildKeelInlineNormalMediaDocument,
  buildKeelInlineFollowLatestTokenURIBodyGraph,
  buildKeelInlineEscapedTokenURIGraph,
  buildKeelInlineRawPercentTokenURIGraph,
  buildKeelInlineTokenURIGraph,
  decodeKeelInlineGraphFragment,
  measureKeelInlineCompactGraph,
  buildKeelInlinePreEncodedTokenURIGraph,
  compareKeelInlineTokenURICarriages,
  buildKeelRegisteredInlineNormalMediaTokenURIGraph,
  buildKeelPreparedOneOfOneTokenURI,
  buildKeelInlineShellFragments,
  assertKeelInlineNoExternalDependencies,
  concatenateComposableBase64Fragments,
  createComposableBase64Fragment,
  keelAssetDisplayModuleBytes,
  keelAssetDisplayKind,
  serializeInlineScriptJSON,
  verifyKeelPublishedInlineModuleFragment,
} from "../packages/sdk/dist/inline-viewer-graph.js";
import { KEEL_INLINE_PROTECTION_SHELL_ID } from "../packages/sdk/dist/shell-registry.js";
import { assertKeelCollectorInlineMetadata, prepareKeelInlineImageCarriage } from "../packages/sdk/dist/collector-policy.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const chainId = 11155111;

const utf8 = (value) => new TextEncoder().encode(value);
const decoded = (value) => new Uint8Array(Buffer.from(value, "base64"));
const validPngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const validPngURI = `data:image/png;base64,${Buffer.from(validPngBytes).toString('base64')}`;
const validWebpBytes = Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBP', 'latin1');
const validWebpURI = `data:image/webp;base64,${validWebpBytes.toString('base64')}`;
const validAvifBytes = Uint8Array.from([0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00, 0x61, 0x76, 0x69, 0x66]);
const validGifBytes = decoded('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==');

test("Inline creator bytes reject hidden external URL sentinels before packing", () => {
  assert.doesNotThrow(() => assertKeelInlineNoExternalDependencies(
    utf8('const svg = "http://www.w3.org/2000/svg";'),
  ));
  assert.throws(
    () => assertKeelInlineNoExternalDependencies(utf8('new URL("https://keel.invalid/weapon-art/index.json")')),
    /external resource locator.*keel\.invalid/iu,
  );
  assert.throws(
    () => assertKeelInlineNoExternalDependencies(utf8('fetch("https://example.invalid/asset.js")')),
    /external resource locator.*https:\/\/example\.invalid/iu,
  );
  const hiddenModule = gzipSync(utf8('const asset = "https://keel.invalid/weapon-art/index.json";'));
  const fragment = utf8(`,%7B%22embedded%22:%7B%22compression%22:%22gzip%22,%22storedBase64%22:%22${hiddenModule.toString("base64")}%22%7D%7D`);
  assert.throws(
    () => assertKeelInlineNoExternalDependencies(fragment),
    /external resource locator.*keel\.invalid/iu,
  );
});

test('Inline locator check distinguishes minified ar variables from Arweave references', () => {
  assert.doesNotThrow(()=>assertKeelInlineNoExternalDependencies(utf8('const ar=2;const x={bar:ready?ar:1,empty:false};')));
  for(const uri of ['ar://asset','ar:'+ 'a'.repeat(43),'ar:'+ 'A_0-'.repeat(10)+'abc'+'/image.png']){
    assert.throws(()=>assertKeelInlineNoExternalDependencies(utf8(`const asset="${uri}";`)),/external resource locator/);
    assert.throws(()=>assertKeelInlineNoExternalDependencies(utf8(encodeURIComponent(uri))),/external resource locator/);
  }
});

test('inline SVG image carriage avoids double Base64 while retaining exact bytes', async () => {
  const svg=utf8('<svg xmlns="http://www.w3.org/2000/svg"><text>雪 # ? % &amp;</text><image href="data:image/avif;base64,'+'A+/='.repeat(5000)+'"/></svg>');
  const uri=buildKeelInlineImageURI(svg,'image/svg+xml');
  assert.ok(uri.startsWith('data:image/svg+xml,'));
  assert.deepEqual(utf8(decodeURIComponent(uri.slice(uri.indexOf(',')+1))),svg);
  assert.ok(uri.length<`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`.length);
  assert.equal(Buffer.from(await (await fetch(uri)).arrayBuffer()).equals(Buffer.from(svg)),true);
  assert.equal(buildKeelInlineImageURI(validAvifBytes,'image/avif'),`data:image/avif;base64,${Buffer.from(validAvifBytes).toString('base64')}`);
  const gifURI = buildKeelInlineImageURI(validGifBytes, 'image/gif');
  assert.equal(gifURI, `data:image/gif;base64,${Buffer.from(validGifBytes).toString('base64')}`);
  const carriage = prepareKeelInlineImageCarriage(validGifBytes, 'image/gif');
  assert.equal(carriage.uri, gifURI);
  assert.equal(carriage.header, 'data:image/gif;base64,');
  assert.equal(Buffer.from(carriage.payloadBytes).toString('ascii'), Buffer.from(validGifBytes).toString('base64'));
  assert.deepEqual(carriage.sourceBytes, validGifBytes);
  assert.deepEqual(Buffer.from(gifURI.slice(gifURI.indexOf(',') + 1), 'base64'), Buffer.from(validGifBytes));
  assert.doesNotMatch(gifURI, /svg/iu);
  assert.throws(() => buildKeelInlineImageURI(Uint8Array.from([0, 1, 2, 3]), 'image/gif'), /GIF source/u);
  assert.throws(()=>buildKeelInlineImageURI(validAvifBytes,'text/html'),/supported/);
  assert.throws(()=>buildKeelInlineImageURI(new Uint8Array(),'image/png'),/empty/);
});

test("collector Inline rejects off-chain resources while allowing navigation links and protocol text", () => {
  const image = validPngURI;
  const shellText = "<div class=\"verify-corner\"></div><a href=\"https://onkeel.io/gallery\">OnKEEL</a><script>const note=\"ipfs:// is only a mirror explanation\";</script>";
  assert.doesNotThrow(() => assertKeelCollectorInlineMetadata({ image, animation_url: `data:text/html;charset=utf-8,${encodeURIComponent(shellText)}` }));
  assert.throws(
    () => assertKeelCollectorInlineMetadata({ image: "data:image/png;base64,AA==", animation_url: `data:text/html;charset=utf-8,${encodeURIComponent(shellText)}` }),
    /PNG source/u,
  );
  for (const resource of [
    '<img src="/off-chain.png">',
    '<script src="https://example.invalid/remote.js"></script>',
    '<iframe src="https://example.invalid/artwork"></iframe>',
    '<style>body{background:url(https://example.invalid/remote.png)}</style>',
  ]) {
    assert.throws(
      () => assertKeelCollectorInlineMetadata({ image, animation_url: `data:text/html;charset=utf-8,${encodeURIComponent(shellText + resource)}` }),
      /external or relative resource/u,
    );
  }
});

test("composable Base64 fragments equal one traditional outer encoding across UTF-8 boundaries", () => {
  const values = [
    "",
    "abc",
    "abcd",
    "abcde",
    '{"quote":"\\\"","slash":"\\\\","line":"\\n"}',
    '{"unicode":"雪 🌊"}',
    "x".repeat(250_001),
  ];
  for (const value of values) {
    const first = createComposableBase64Fragment(value, { mustAllowFollowingFragment: true });
    const tail = createComposableBase64Fragment("</script>", { mustAllowFollowingFragment: false });
    const composable = concatenateComposableBase64Fragments([first, tail]);
    const paddedRaw = Buffer.concat([Buffer.from(utf8(value)), Buffer.from(" ".repeat(first.paddingBytes)), Buffer.from("</script>")]);
    assert.equal(composable, paddedRaw.toString("base64"));
    assert.deepEqual(decoded(composable), new Uint8Array(paddedRaw));
    assert.equal((first.rawByteLength + first.paddingBytes) % 3, 0);
    assert.doesNotMatch(first.base64, /=/u);
  }
});

test("hundreds of reordered composable JSON fragments remain one deterministic Base64 stream", () => {
  const order = Array.from({ length: 1_000 }, (_, index) => (index * 73) % 1_000);
  const raw = order.map((id, index) => `${JSON.stringify({ id, text: `row ${id} 雪` })}${index === order.length - 1 ? "" : ","}`);
  const pieces = ["const DATA=[", ...raw, "];"].map((value, index, values) =>
    createComposableBase64Fragment(value, {
      mustAllowFollowingFragment: index < values.length - 1,
      paddingStrategy: "json-whitespace",
    }));
  const composable = concatenateComposableBase64Fragments(pieces);
  const expectedRaw = pieces.map((piece, index) => `${["const DATA=[", ...raw, "];"][index]}${" ".repeat(piece.paddingBytes)}`).join("");
  assert.equal(composable, Buffer.from(expectedRaw).toString("base64"));
  assert.equal(Buffer.from(composable, "base64").toString("utf8"), expectedRaw);
});

test("inline JSON escaping closes script parser hazards before byte alignment", () => {
  const serialized = serializeInlineScriptJSON({ html: "</script><b>snow 雪</b>", lines: "a\u2028b\u2029c" });
  assert.doesNotMatch(serialized, /</u);
  assert.match(serialized, /\\u003c\/script\\u003e/u);
  assert.match(serialized, /\\u2028/u);
  assert.deepEqual(JSON.parse(serialized), { html: "</script><b>snow 雪</b>", lines: "a\u2028b\u2029c" });
});

test("composable Base64 rejects malformed Unicode and padded non-terminal fragments", () => {
  assert.throws(() => createComposableBase64Fragment("\ud800"), /unpaired high surrogate/u);
  assert.throws(() => createComposableBase64Fragment("\udc00"), /unpaired low surrogate/u);
  assert.throws(
    () => concatenateComposableBase64Fragments([
      { rawByteLength: 1, paddingBytes: 0, base64: "YQ==" },
      createComposableBase64Fragment("tail", { mustAllowFollowingFragment: false }),
    ]),
    /Non-terminal/u,
  );
  assert.throws(
    () => concatenateComposableBase64Fragments([{ rawByteLength: 1, paddingBytes: 0, base64: "%%%=" }]),
    /Malformed/u,
  );
});

test("Gzip Inline graph reuses shell and p5 fragments and publishes only creator bytes", async () => {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot });
  assert.equal(shell.codecProfile, "browser-gzip-deflate");
  // Pin current master chrome. cbd6b1f adds only ,"allow-downloads"
  // to the sandbox list: removing those 18 bytes restores the prior suffix hash.
  // Keep exact byte/hash guards against unreviewed growth or substitution.
  const canonicalFragments = [
    { byteLength: 15_108, digest: "0x4a5405a5794aa91206ef4cebebee127d8917735d4d33546a0bbf8c6bead9a58e" },
    { byteLength: 143_728, digest: "0xb40f97a95bf3ed016e6cf773486679ab842d90b40e820ffc8bde7d096c62cbf8" },
  ];
  for (const [index, fragment] of [shell.prefix, shell.suffix].entries()) {
    const expected = canonicalFragments[index];
    assert.equal(fragment.bytes.byteLength, expected.byteLength);
    assert.equal(`0x${createHash("sha256").update(fragment.bytes).digest("hex")}`, expected.digest);
    assert.deepEqual(fragment.integrity, { algorithm: "sha256", ...expected });
  }
  const shellText = new TextDecoder().decode(new Uint8Array([
    ...shell.prefix.bytes,
    ...shell.suffix.bytes,
  ]));
  assert.match(shellText, /DecompressionStream/u);
  assert.match(shellText, /globalThis\.crypto\?\.subtle/u);
  assert.match(shellText, /Uint32Array\.from/u);
  assert.match(shellText, /__KEEL_ITEMS__/u);
  assert.match(shellText, /id=["']verify-seal["']/u);
  assert.match(shellText, /id=["']verify-panel["']/u);
  assert.match(shellText, /verify-page-nav/u);
  assert.doesNotMatch(shellText, /brotli-dec-wasm|keel-verification-envelope|eth_call/iu);

  const p5 = await buildKeelInlineModuleFragment({
    moduleId: "p5",
    version: "1.11.11",
    mediaType: "text/javascript",
    aliases: ["p5.min.js"],
    decodedBytes: new TextEncoder().encode(`globalThis.p5=${JSON.stringify("x".repeat(200_000))}`),
    compression: "gzip",
    execution: "classic",
  });
  assert.equal(p5.item.embedded.compression, "gzip");

  const root = await buildKeelInlineLocalDocument({
    shell,
    modules: [p5],
    entry: {
      id: "sketch.js",
      mediaType: "text/javascript",
      source: new TextEncoder().encode("new p5(()=>{});"),
    },
  });
  assert.equal(root.parts.filter((part) => part.kind === "existing").length, 3);
  assert.equal(root.parts.filter((part) => part.kind === "creator").length, 1);
  assert.deepEqual(
    root.parts.filter((part) => part.role === "module").map((part) => [part.moduleId, part.moduleVersion, part.execution]),
    [["p5", "1.11.11", "classic"]],
  );
  assert.ok(root.byteLength < 2_000_000);
  const html = new TextDecoder().decode(root.rootBytes);
  assert.doesNotMatch(html, /\/content\/|\/api\/onchain\//u);
  // Canonical navigation links are allowed; artwork resource loads stay Inline.
  assert.doesNotThrow(() => assertKeelCollectorInlineMetadata({
    image: validPngURI, animation_url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  }));
  assert.match(html, /"compression":"gzip"/u);
  assert.match(html, /"id":"sketch\.js"/u);

  await assert.rejects(buildKeelInlineRawPercentTokenURIGraph(root), /forbids new storedBase64/u);
  const currentRoot=withCurrentCanonicalFrames(root),registeredNativeGzip=currentNativeGzipProof(currentRoot);
  const tokenGraph=await buildKeelInlineRawPercentTokenURIGraph(currentRoot,{registeredNativeGzip});
  assert.equal(tokenGraph.schema,"keel-inline-raw-percent-token-uri@1");
  assert.equal(tokenGraph.mediaType,"application/vnd.keel.token-uri-raw-percent-fragment");
  assert.equal(tokenGraph.parts.filter(p=>p.sourceKind==='existing').length,3);
  assert.equal(tokenGraph.parts.filter(p=>p.sourceKind==='creator').length,1);
  assert.equal(tokenGraph.creatorPublicationBytes,tokenGraph.parts.find(p=>p.sourceKind==='creator').bytes.length);
  assert.ok(tokenGraph.creatorPublicationBytes<tokenGraph.fragmentBytes.length/2);
  assert.deepEqual(decodeKeelInlineGraphFragment(tokenGraph.fragmentBytes,tokenGraph.mediaType),currentRoot.rootBytes);
  assert.match(new TextDecoder().decode(tokenGraph.htmlBytes), /"compression":"gzip"/u);
  const storedBase64=p5.item.embedded.storedBase64;
  assert.equal(new TextDecoder().decode(tokenGraph.escapedHtmlBytes).includes(storedBase64),true);
  const creatorSlot=JSON.parse(new TextDecoder().decode(root.parts.find(p=>p.kind==='creator').bytes).slice(1));
  assert.match(creatorSlot.embedded.storedText,/new p5\(\(\)=>\{\}\);/u);
  assert.equal(Object.hasOwn(creatorSlot.embedded,'storedBase64'),false);
  for(const build of [buildKeelInlinePreEncodedTokenURIGraph,buildKeelInlineEscapedTokenURIGraph,buildKeelInlineFollowLatestTokenURIBodyGraph,compareKeelInlineTokenURICarriages])await assert.rejects(build(root,{legacyCarriage:'acknowledged'}),/retired/);
  const prepared=await buildKeelPreparedOneOfOneTokenURI({graph:tokenGraph,registeredNativeGzip,chainId,
    collection:`0x${"ab".repeat(20)}`,collectionName:'Seed Current',description:'A deterministic p5 flow field </script> 雪',imageURI:validWebpURI,
    manifestURI:`web3://0x${"cd".repeat(20)}:${chainId}/object/0x${"ef".repeat(32)}`,manifestDigest:`0x${"12".repeat(32)}`,
    artifact:{store:`0x${"cd".repeat(20)}`,objectId:`0x${"34".repeat(32)}`,digest:`0x${"56".repeat(32)}`,byteLength:3300,mediaType:'text/javascript'}});
  assert.equal(prepared.schema,'keel-prepared-one-of-one-token-uri@1');assert.equal(prepared.requiredBuilder,'KeelRawTokenURIBuilder');
  assert.equal(prepared.tokenURI,`data:application/json;charset=utf-8,${new TextDecoder().decode(prepared.encodedPrefix)}${new TextDecoder().decode(tokenGraph.fragmentBytes)}${new TextDecoder().decode(prepared.encodedSuffix)}`);
  const metadata=JSON.parse(prepared.tokenJSON);assert.equal(metadata.name,'Seed Current #1');assert.equal(metadata.description,'A deterministic p5 flow field </script> 雪');
  assert.deepEqual(metadata.keel_artifact,{store:`0x${"cd".repeat(20)}`,object_id:`0x${"34".repeat(32)}`,digest:`0x${"56".repeat(32)}`,byte_length:3300,media_type:'text/javascript',uri:`web3://0x${"cd".repeat(20)}:${chainId}/haulObject/0x${"34".repeat(32)}?mime.type=text%2Fjavascript`});
  assert.match(metadata.animation_url,/^data:text\/html;charset=utf-8,/u);assert.equal(new URL(metadata.animation_url).href,metadata.animation_url);
  const animationHTML=decodeURIComponent(metadata.animation_url.slice(metadata.animation_url.indexOf(',')+1));
  assert.ok(animationHTML.startsWith(new TextDecoder().decode(currentRoot.rootBytes)));
  assert.match(animationHTML,/__KEEL_CONTEXT__/u);assert.match(animationHTML,/__KEEL_ONCHAIN_CONTEXT__/u);assert.match(animationHTML,new RegExp(prepared.contextDigest,'u'));
  assert.equal(JSON.parse(prepared.contextJSON).derivedTokenSeed,prepared.derivedTokenSeed);
  const compactImageURI = "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3C/svg%3E";
  const compactImagePrepared = await buildKeelPreparedOneOfOneTokenURI({
    graph: tokenGraph, registeredNativeGzip,
    chainId,
    collection: `0x${"ab".repeat(20)}`,
    collectionName: "Compact escaped image",
    description: "URI-safe punctuation remains literal",
    imageURI: compactImageURI,
    manifestURI: `web3://0x${"cd".repeat(20)}:${chainId}/object/0x${"ef".repeat(32)}`,
    manifestDigest: `0x${"12".repeat(32)}`,
    presentationPolicy: "raw-artifact",
  });
  assert.equal(JSON.parse(compactImagePrepared.tokenJSON).image, compactImageURI);

  await assert.rejects(
    buildKeelPreparedOneOfOneTokenURI({
      graph: tokenGraph, registeredNativeGzip,
      chainId,
      collection: `0x${"ab".repeat(20)}`,
      collectionName: "Unsafe image",
      description: "raw SVG data URI",
      imageURI: "data:image/svg+xml,<svg></svg>",
      manifestURI: `web3://0x${"cd".repeat(20)}:${chainId}/object/0x${"ef".repeat(32)}`,
      manifestDigest: `0x${"12".repeat(32)}`,
      presentationPolicy: "raw-artifact",
    }),
    /must be percent-escaped/u,
  );
  const web3ImageURI = `web3://0x${"cd".repeat(20)}:${chainId}/haulObject/0x${"ef".repeat(32)}?mime.type=image%2Fwebp`;
  const web3ImagePrepared = await buildKeelPreparedOneOfOneTokenURI({
    graph: tokenGraph, registeredNativeGzip,
    chainId,
    collection: `0x${"ab".repeat(20)}`,
    collectionName: "KEEL Web3 image in Inline",
    description: "The animation stays Inline while its poster reuses a KEEL object",
    imageURI: web3ImageURI,
    manifestURI: `web3://0x${"cd".repeat(20)}:${chainId}/haulObject/0x${"ef".repeat(32)}?mime.type=application%2Fjson`,
    manifestDigest: `0x${"12".repeat(32)}`,
    presentationPolicy: "external-resolver",
  });
  assert.equal(JSON.parse(web3ImagePrepared.tokenJSON).image, web3ImageURI);
  await assert.rejects(
    buildKeelPreparedOneOfOneTokenURI({
      graph: tokenGraph, registeredNativeGzip,
      chainId,
      collection: `0x${"ab".repeat(20)}`,
      collectionName: "Offchain image",
      description: "Unbound HTTP image",
      imageURI: "https://example.com/poster.webp",
      manifestURI: "",
      manifestDigest: `0x${"12".repeat(32)}`,
    }),
    /self-contained data URI or an exact KEEL web3 object URI/u,
  );
});

test("historical compressed assets remain exact locally while fresh Inline rejects encoded body copies", async () => {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot });
  const runtime = await buildKeelInlineModuleFragment({
    moduleId: "keel.gif-encoder",
    version: "1.0.0",
    mediaType: "text/javascript",
    decodedBytes: utf8("globalThis.KEELGif={ready:true};"),
    compression: "gzip",
    execution: "classic",
  });
  const animation = Uint8Array.from({ length: 16_384 }, (_, index) => (index * 73) & 0xff);
  const root = await buildKeelInlineLocalDocument({
    shell,
    modules: [runtime],
    assets: [{ id: "keel.animation", mediaType: "image/avif", source: animation, compression: "gzip" }],
    entry: {
      id: "entry",
      mediaType: "text/html",
      source: utf8("<!doctype html><img id='art'><script>art.src=__KEEL_CONTENT__.url('keel.animation')</script>"),
    },
  });
  assert.deepEqual(root.parts.map((part) => [part.kind, part.role]), [
    ["existing", "shell-prefix"],
    ["existing", "module"],
    ["creator", "asset"],
    ["creator", "entrypoint"],
    ["existing", "shell-suffix"],
  ]);
  const assetPart = root.parts.find((part) => part.role === "asset");
  const assetItem = JSON.parse(new TextDecoder().decode(assetPart.bytes).slice(1));
  const stored = Buffer.from(assetItem.embedded.storedBase64, "base64");
  assert.deepEqual(gunzipSync(stored), Buffer.from(animation));
  await assert.rejects(buildKeelInlineRawPercentTokenURIGraph(root), /forbids new storedBase64/u);
  await assert.rejects(buildKeelInlineRawPercentTokenURIGraph(root, { existingParts: [] }), /shell-prefix has no canonical published raw-percent fragment/u);
  await assert.rejects(
    buildKeelInlineLocalDocument({
      shell,
      modules: [runtime],
      assets: [{ id: "keel.gif-encoder", mediaType: "image/avif", source: animation }],
      entry: { id: "entry", mediaType: "text/html", source: utf8("<!doctype html><p>x</p>") },
    }),
    /duplicate resource ID/u,
  );
});

test("canonical Inline publication has one shell top, ordered middle, and one shell bottom", async () => {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot });
  const p5 = await buildKeelInlineModuleFragment({
    moduleId: "p5.js",
    version: "1.11.3",
    mediaType: "text/javascript",
    decodedBytes: utf8("globalThis.p5=class{}"),
    execution: "classic",
  });
  const seed = await buildKeelInlineModuleFragment({
    moduleId: "keel.seeded-random",
    version: "1.0.0",
    mediaType: "text/javascript",
    decodedBytes: utf8("globalThis.keelSeed=()=>1"),
    execution: "module",
  });
  const local = await buildKeelInlineLocalDocument({
    shell,
    modules: [p5, seed],
    entry: { id: "sketch.js", mediaType: "text/javascript", source: utf8("new p5(()=>{});") },
  });
  assert.deepEqual(local.parts.map((part) => part.role), ["shell-prefix", "module", "module", "entrypoint", "shell-suffix"]);
  const graph = await buildKeelInlineRawPercentTokenURIGraph(local);
  assert.deepEqual(graph.parts.map((part) => part.role), ["shell-prefix", "module", "module", "entrypoint", "shell-suffix"]);
  assert.equal(graph.parts.filter((part) => part.role === "shell-prefix").length, 1);
  assert.equal(graph.parts.filter((part) => part.role === "shell-suffix").length, 1);
  assert.equal(graph.parts.some((part) => part.sourceObjectId !== undefined), false);
});

test("creator HTML is one verified middle slot inside the canonical shell", async () => {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot });
  const source = utf8('<main id="work"><canvas></canvas><script>globalThis.rendered=true</script></main>');
  const local = await buildKeelInlineLocalDocument({
    shell,
    modules: [],
    entry: { id: "creator.html", mediaType: "text/html", source },
  });
  assert.deepEqual(local.parts.map((part) => part.role), ["shell-prefix", "entrypoint", "shell-suffix"]);
  assert.equal(local.parts.filter((part) => part.role === "shell-prefix").length, 1);
  assert.equal(local.parts.filter((part) => part.role === "shell-suffix").length, 1);
  assert.equal(new TextDecoder().decode(local.rootBytes).includes("creator.html"), true);
  assert.equal(local.rootBytes.byteLength < source.byteLength + shell.prefix.bytes.byteLength + shell.suffix.bytes.byteLength + 1_000, true);
});

test("normal raster/video uses the registered shell without a creator wrapper; malformed GLB is rejected", async () => {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot });
  const inputs = [
    { id: "poster.webp", mediaType: "image/webp", source: new Uint8Array([0x52, 0x49, 0x46, 0x46]) },
    { id: "loop.webm", mediaType: "video/webm", source: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]) },
    { id: "scene.glb", mediaType: "model/gltf-binary", source: new Uint8Array([0x67, 0x6c, 0x54, 0x46]) },
  ];
  const documents = await Promise.all(inputs.slice(0, 2).map((asset) => buildKeelInlineNormalMediaDocument({ shell, asset })));
  await assert.rejects(buildKeelInlineNormalMediaDocument({ shell, asset: inputs[2] }), /Malformed GLB/u);

  assert.deepEqual(documents.map((document) => document.parts.map((part) => part.role)), [
    ["shell-prefix", "module", "entrypoint", "shell-suffix"],
    ["shell-prefix", "module", "entrypoint", "shell-suffix"],
  ]);
  for (const [index, document] of documents.entries()) {
    const asset = inputs[index];
    assert.equal(document.declaration.shellId, KEEL_INLINE_PROTECTION_SHELL_ID);
    assert.equal(document.declaration.assetDisplay.moduleId, KEEL_ASSET_DISPLAY_MODULE_ID);
    assert.deepEqual(document.parts.filter((part) => part.kind === "creator").map((part) => part.role), ["entrypoint"]);
    assert.equal(document.declaration.creatorAsset.id, asset.id);
    assert.equal(document.declaration.creatorAsset.mediaType, asset.mediaType);
    assert.match(new TextDecoder().decode(document.rootBytes), new RegExp(`"id":"${asset.id}"`, "u"));
    assert.doesNotMatch(new TextDecoder().decode(document.rootBytes), /index\.html|local-shell|viewer\.js/u);
  }
  assert.deepEqual(inputs.slice(0, 2).map((asset) => keelAssetDisplayKind(asset.mediaType)), ["image", "video"]);
  assert.throws(() => keelAssetDisplayKind("model/gltf-binary"), /does not support/u);
  assert.throws(() => keelAssetDisplayKind("model/gltf+json"), /does not support/u);

  const display = await buildKeelInlineAssetDisplayModuleFragment();
  const firstDisplayBytes = keelAssetDisplayModuleBytes();
  const expectedFirstByte = firstDisplayBytes[0];
  firstDisplayBytes[0] ^= 0xff;
  const secondDisplayBytes = keelAssetDisplayModuleBytes();
  assert.equal(secondDisplayBytes[0], expectedFirstByte);
  assert.notDeepEqual(firstDisplayBytes, secondDisplayBytes);
  assert.equal(display.item.integrity.byteLength, secondDisplayBytes.byteLength);
  const displaySource = new TextDecoder().decode(secondDisplayBytes);
  assert.match(displaySource, /createElement\("img"\)/u);
  assert.match(displaySource, /createElement\("video"\)/u);
  assert.doesNotMatch(displaySource, /model\/gltf-binary/u);
  assert.doesNotMatch(displaySource, /getContext\("webgl"/u);
  assert.match(displaySource, /__KEEL_ENTRY__/u);
  assert.doesNotMatch(displaySource, /fetch\(|ethereum|wallet|XMLHttpRequest/u);

  await assert.rejects(
    buildKeelInlineLocalDocument({ shell, modules: [], entry: inputs[0] }),
    /exactly one registered keel\.asset-display/u,
  );
  const counterfeit = await buildKeelInlineModuleFragment({
    moduleId: KEEL_ASSET_DISPLAY_MODULE_ID,
    version: "1.0.0",
    mediaType: "text/javascript",
    decodedBytes: utf8("globalThis.notTheKeelAssetDisplay=true"),
    compression: "gzip",
    execution: "classic",
    phase: "render",
  });
  await assert.rejects(
    buildKeelInlineLocalDocument({ shell, modules: [counterfeit], entry: inputs[0] }),
    /exact registered keel\.asset-display/u,
  );
});

test("normal-media default compact graphs accept only the registered shell and display module", async () => {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot });
  const document = await buildKeelInlineNormalMediaDocument({
    shell,
    asset: { id: "poster.png", mediaType: "image/png", source: validPngBytes },
  });
  const local = await buildKeelInlineTokenURIGraph(document);
  const existingParts = local.parts.filter((part) => part.sourceKind === "existing").map((part, index) => ({
    bytes: part.bytes,
    integrity: part.integrity,
    carrier: {
      chainId,
      store: `0x${"ab".repeat(20)}`,
      objectId: `0x${String(index + 1).padStart(64, "0")}`,
      mediaType: local.mediaType,
      compression: "none",
      storedByteLength: part.bytes.byteLength,
    },
  }));
  const graph = await buildKeelRegisteredInlineNormalMediaTokenURIGraph({
    document,
    existingParts,
  });
  assert.deepEqual(graph.parts.map((part) => [part.sourceKind, part.role]), [
    ["existing", "shell-prefix"],
    ["existing", "module"],
    ["creator", "entrypoint"],
    ["existing", "shell-suffix"],
  ]);
  assert.equal(graph.creatorPublicationBytes, graph.parts[2].bytes.byteLength);
  assert.equal(graph.parts[1].sourceObjectId, existingParts[1].carrier.objectId);
  await assert.rejects(
    buildKeelRegisteredInlineNormalMediaTokenURIGraph({
      document,
      shellId: `0x${"ff".repeat(32)}`,
      existingParts,
    }),
    /canonical registered KEEL Inline protection shell/u,
  );
  const counterfeitShell = {
    ...document,
    parts: [
      { ...document.parts[0], bytes: utf8("counterfeit shell"), byteLength: 17 },
      ...document.parts.slice(1),
    ],
  };
  await assert.rejects(
    buildKeelRegisteredInlineNormalMediaTokenURIGraph({ document: counterfeitShell, existingParts }),
    /exact canonical KEEL shell and asset-display declarations/u,
  );
});

test("published canonical fragments survive platform-specific module recompression", async () => {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot });
  const moduleBytes = utf8(`globalThis.p5=${JSON.stringify("flow".repeat(20_000))}`);
  const aliases = ["p5.min.js", "./p5.min.js", "p5.js"];
  const canonicalModule = await buildKeelInlineModuleFragment({
    moduleId: "p5.js",
    version: "1.11.3",
    mediaType: "text/javascript",
    aliases,
    decodedBytes: moduleBytes,
    compression: "gzip",
    execution: "classic",
  });
  const canonicalRoot = withCurrentCanonicalFrames(await buildKeelInlineLocalDocument({
    shell,
    modules: [canonicalModule],
    entry: { id: "sketch.js", mediaType: "text/javascript", source: utf8("new p5(()=>{});") },
  }));
  const registeredNativeGzip=currentNativeGzipProof(canonicalRoot);
  const canonicalGraph = await buildKeelInlineRawPercentTokenURIGraph(canonicalRoot, { registeredNativeGzip });
  const published = canonicalGraph.parts.filter((part) => part.sourceKind === "existing").map((part, index) => ({
    bytes: part.bytes,
    integrity: part.integrity,
    carrier: {
      chainId,
      store: `0x${"ab".repeat(20)}`,
      objectId: `0x${String(index + 1).padStart(64, "0")}`,
      mediaType: canonicalGraph.mediaType,
      compression: "none",
      storedByteLength: part.bytes.byteLength,
    },
  }));
  await verifyKeelPublishedInlineModuleFragment({
    fragment: published[1],
    moduleId: "p5.js",
    mediaType: "text/javascript",
    aliases,
    decodedBytes: moduleBytes,
  });

  // Deflate stands in for another runtime's byte-different compression. The
  // creator graph must consume the already-published canonical gzip slot.
  const recompressedModule = await buildKeelInlineModuleFragment({
    moduleId: "p5.js",
    version: "1.11.3",
    mediaType: "text/javascript",
    aliases,
    decodedBytes: moduleBytes,
    compression: "deflate",
    execution: "classic",
  });
  const recompressedRoot = withCurrentCanonicalFrames(await buildKeelInlineLocalDocument({
    shell,
    modules: [recompressedModule],
    entry: { id: "sketch.js", mediaType: "text/javascript", source: utf8("new p5(()=>{});") },
  }));
  const reusedGraph = await buildKeelInlineRawPercentTokenURIGraph(recompressedRoot, { existingParts: published, registeredNativeGzip });
  assert.deepEqual(
    reusedGraph.parts.filter((part) => part.sourceKind === "existing").map((part) => part.integrity.digest),
    published.map((part) => part.integrity.digest),
  );
  assert.match(new TextDecoder().decode(reusedGraph.htmlBytes), /"compression":"gzip"/u);
  assert.doesNotMatch(new TextDecoder().decode(reusedGraph.htmlBytes), /"compression":"deflate"/u);

  for(const build of [buildKeelInlineEscapedTokenURIGraph,buildKeelInlinePreEncodedTokenURIGraph])await assert.rejects(build(recompressedRoot,{existingParts:published,legacyCarriage:'acknowledged'}),/retired/);
  await assert.rejects(
    verifyKeelPublishedInlineModuleFragment({
      fragment: published[1],
      moduleId: "p5.js",
      mediaType: "text/javascript",
      aliases,
      decodedBytes: utf8("tampered"),
    }),
    /payload does not match|metadata does not match/u,
  );
});

test("fresh Base64 encoding stays retired despite acknowledgement and environment", async () => {
  const { assertLegacyCarriageAllowed, KeelLegacyCarriageError } = await import("../packages/sdk/dist/inline-viewer-graph.js");
  const saved = process.env.KEEL_LEGACY_CARRIAGE;
  delete process.env.KEEL_LEGACY_CARRIAGE;
  try {
    assert.throws(() => assertLegacyCarriageAllowed("buildKeelInlinePreEncodedTokenURIGraph", undefined), KeelLegacyCarriageError);
    assert.throws(() => assertLegacyCarriageAllowed("buildKeelInlinePreEncodedTokenURIGraph", {}), /compact raw-percent/u);
    assert.throws(() => assertLegacyCarriageAllowed("buildKeelInlinePreEncodedTokenURIGraph", { legacyCarriage: "acknowledged" }), KeelLegacyCarriageError);
    process.env.KEEL_LEGACY_CARRIAGE = "allow";
    assert.throws(() => assertLegacyCarriageAllowed("buildKeelInlineEscapedTokenURIGraph", {}), KeelLegacyCarriageError);
  } finally {
    if (saved === undefined) delete process.env.KEEL_LEGACY_CARRIAGE; else process.env.KEEL_LEGACY_CARRIAGE = saved;
  }
});

test("default saver keeps raw text unchanged through SDK, publication reuse, and metadata", async () => {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot });
  const artwork = utf8("body{color:blue}/*水 # %*/\n".repeat(6000));
  const document = await buildKeelInlineLocalDocument({
    shell, modules: [],
    entry: { id: "entry.html", mediaType: "text/html", source: utf8("<main>雪 100% # + / =</main>") },
    assets: [{ id: "artwork.css", mediaType: "text/css", source: artwork }],
  });
  const graph = await buildKeelInlineTokenURIGraph(document);
  assert.equal(graph.mediaType, "application/vnd.keel.token-uri-raw-percent-fragment");
  assert.equal(measureKeelInlineCompactGraph(document).graphByteLength, graph.fragmentBytes.length);
  assert.equal(measureKeelInlineCompactGraph(document).creatorPublicationBytes, graph.creatorPublicationBytes);
  assert.deepEqual(decodeKeelInlineGraphFragment(graph.fragmentBytes, graph.mediaType), document.rootBytes);
  const asset = graph.parts.find((part) => part.role === "asset");
  const slot = JSON.parse(Buffer.from(asset.decodedHtmlBytes).toString().slice(1));
  assert.equal(slot.embedded.compression, "none");
  assert.equal(Object.hasOwn(slot.embedded, "storedBase64"), false);
  assert.deepEqual(utf8(slot.embedded.storedText), artwork);
  const returnedHTML = decodeURIComponent(decodeURIComponent(Buffer.from(graph.fragmentBytes).toString()));
  assert.equal(returnedHTML.split(JSON.stringify(slot.embedded.storedText)).length, 2);
  const existingParts = graph.parts.filter((part) => part.sourceKind === "existing").map((part, i) => ({
    bytes: part.bytes, integrity: part.integrity,
    carrier: { chainId, store: `0x${"ab".repeat(20)}`, objectId: `0x${String(i + 1).padStart(64, "0")}`,
      mediaType: graph.mediaType, compression: "none", storedByteLength: part.bytes.length },
  }));
  const reused = await buildKeelInlineTokenURIGraph(document, { existingParts });
  assert.deepEqual(reused.fragmentBytes, graph.fragmentBytes);
  assert.equal(reused.creatorPublicationBytes, graph.parts.filter((p) => p.sourceKind === "creator").reduce((n, p) => n + p.bytes.length, 0));
  const prepared = await buildKeelPreparedOneOfOneTokenURI({ graph: reused, chainId,
    collection: `0x${"ab".repeat(20)}`, collectionName: "雪", description: "100% # + / =",
      imageURI: validPngURI, manifestURI: "ipfs://test", manifestDigest: `0x${"11".repeat(32)}` });
  assert.equal(prepared.requiredBuilder, "KeelRawTokenURIBuilder");
  const metadata = JSON.parse(decodeURIComponent(prepared.tokenURI.split(",").slice(1).join(",")));
  assert.equal(metadata.description, "100% # + / =");
  assert.ok(metadata.animation_url.startsWith("data:text/html;charset=utf-8,"));
  assert.ok(decodeURIComponent(metadata.animation_url.slice(metadata.animation_url.indexOf(",") + 1)).startsWith(Buffer.from(document.rootBytes).toString()));
  await assert.rejects(buildKeelInlineTokenURIGraph(document, { carriage: "typo" }), /Unsupported Inline carriage/);
  await assert.rejects(buildKeelInlineTokenURIGraph(document, { existingParts: existingParts.map((p) => ({ ...p, carrier: { ...p.carrier, mediaType: "application/vnd.keel.token-uri-base64-fragment" } })) }), /not a raw-percent fragment/);
});

async function currentPublishedModule({compression='gzip',source=utf8('globalThis.currentArt="exact original";'),aliases=['exact.js']}={}){
 const module=await buildKeelInlineModuleFragment({moduleId:'keel.current-module',version:'1',mediaType:'text/javascript',decodedBytes:source,compression,aliases,execution:'classic'});
 const root=await buildKeelInlineLocalDocument({shell:currentCanonicalShell(),modules:[module],entry:{id:'entry.html',mediaType:'text/html',source:utf8('<!doctype html><p>original entry</p>')}});
 const proof=compression==='gzip'?currentNativeGzipProof(root):undefined;
 const graph=proof?await buildKeelInlineRawPercentTokenURIGraph(root,{registeredNativeGzip:proof}):undefined;
 const published=graph?.parts.filter(p=>p.sourceKind==='existing').map((p,i)=>({bytes:Uint8Array.from(p.bytes),integrity:{...p.integrity},carrier:{chainId,store:'0x'+'12'.repeat(20),objectId:'0x'+(i+1).toString(16).padStart(64,'0'),mediaType:graph.mediaType,compression:'none',storedByteLength:p.bytes.length}}));
 return{root,proof,graph,published};
}

test('direct and shared current COPY authenticate published Gzip bytes despite unused local Deflate compression',async()=>{
 const canonical=await currentPublishedModule(),local=await currentPublishedModule({compression:'deflate'});
 for(const build of [buildKeelInlineRawPercentTokenURIGraph,buildKeelInlineTokenURIGraph]){
  const result=await build(local.root,{existingParts:canonical.published,registeredNativeGzip:canonical.proof});
  assert.deepEqual(result.fragmentBytes,canonical.graph.fragmentBytes);assert.deepEqual(result.htmlBytes,canonical.root.rootBytes);
  assert.deepEqual(result.registeredNativeGzip,canonical.proof);
 }
});

test('a consistent registered frame proof cannot replace the declared source or module aliases',async()=>{
 const original=await currentPublishedModule({compression:'deflate'});
 for(const replacement of [await currentPublishedModule({source:utf8('globalThis.currentArt="different";')}),await currentPublishedModule({aliases:['different.js']})]){
  for(const build of [buildKeelInlineRawPercentTokenURIGraph,buildKeelInlineTokenURIGraph])await assert.rejects(build(original.root,{existingParts:replacement.published,registeredNativeGzip:replacement.proof}),/changed the declared source identity or metadata/);
 }
 const canonical=await currentPublishedModule(),deflate=await currentPublishedModule({compression:'deflate'});
 const invalid=canonical.published.map(p=>({...p,bytes:Uint8Array.from(p.bytes),integrity:{...p.integrity},carrier:{...p.carrier}}));
 const payload=deflate.root.parts.find(p=>p.role==='module').bytes;
 invalid[1].bytes=utf8(encodeURIComponent(encodeURIComponent(new TextDecoder().decode(payload))));
 invalid[1].integrity={algorithm:'sha256',digest:'0x'+createHash('sha256').update(invalid[1].bytes).digest('hex'),byteLength:invalid[1].bytes.length};invalid[1].carrier.storedByteLength=invalid[1].bytes.length;
 await assert.rejects(buildKeelInlineRawPercentTokenURIGraph(original.root,{existingParts:invalid,registeredNativeGzip:canonical.proof}),/Native Gzip/);
 await assert.rejects(buildKeelInlineTokenURIGraph(original.root,{existingParts:canonical.published,registeredNativeGzip:{...canonical.proof,binding:{...canonical.proof.binding,reader:'0x'+'99'.repeat(20)}}}),/Native Gzip|native Gzip/);
});

test('current COPY snapshots entry bytes, receipt order, source identities and proof before async digest',async()=>{
 for(const build of [buildKeelInlineRawPercentTokenURIGraph,buildKeelInlineTokenURIGraph]){
  const canonical=await currentPublishedModule();const expected=Uint8Array.from(canonical.graph.fragmentBytes);
  const digest=globalThis.crypto.subtle.digest;let enter,release,first=true;
  const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
  globalThis.crypto.subtle.digest=async function(...args){if(first){first=false;enter();await gate;}return digest.apply(this,args);};
  try{
   const promise=build(canonical.root,{existingParts:canonical.published,registeredNativeGzip:canonical.proof});await entered;
   canonical.root.rootBytes.fill(0);canonical.root.parts.find(p=>p.kind==='creator').bytes.fill(0);
   canonical.published[1].bytes.fill(0);canonical.published[1].carrier.objectId='0x'+'ff'.repeat(32);canonical.published.reverse();
   canonical.proof.binding.reader='0x'+'99'.repeat(20);release();
   assert.deepEqual((await promise).fragmentBytes,expected);
  }finally{release();globalThis.crypto.subtle.digest=digest;}
 }
});
