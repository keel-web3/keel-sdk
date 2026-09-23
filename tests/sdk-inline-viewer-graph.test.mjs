import assert from "node:assert/strict";
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

test("collector Inline rejects actual off-chain resource tags while allowing shell protocol text", () => {
  const image = validPngURI;
  const shellText = "<div class=\"verify-corner\"></div><script>const note=\"ipfs:// is only a mirror explanation\";</script>";
  assert.doesNotThrow(() => assertKeelCollectorInlineMetadata({ image, animation_url: `data:text/html;charset=utf-8,${encodeURIComponent(shellText)}` }));
  assert.throws(
    () => assertKeelCollectorInlineMetadata({ image: "data:image/png;base64,AA==", animation_url: `data:text/html;charset=utf-8,${encodeURIComponent(shellText)}` }),
    /PNG source/u,
  );
  assert.throws(
    () => assertKeelCollectorInlineMetadata({ image, animation_url: `data:text/html;charset=utf-8,${encodeURIComponent(`${shellText}<img src=\"/off-chain.png\">`)}` }),
    /external or relative resource/u,
  );
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
  assert.ok(shell.prefix.bytes.byteLength + shell.suffix.bytes.byteLength < 100_000);
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
  assert.doesNotMatch(html, /\/content\/|\/api\/onchain\/|https?:\/\//u);
  assert.match(html, /"compression":"gzip"/u);
  assert.match(html, /"id":"sketch\.js"/u);

  const tokenGraph = await buildKeelInlinePreEncodedTokenURIGraph(root, { legacyCarriage: "acknowledged" });
  assert.equal(tokenGraph.schema, "keel-inline-preencoded-token-uri@1");
  assert.equal(tokenGraph.mediaType, "application/vnd.keel.token-uri-base64-fragment");
  assert.equal(tokenGraph.contextDelivery, "base64-html-tail");
  assert.equal(tokenGraph.parts.filter((part) => part.sourceKind === "existing").length, 3);
  assert.equal(tokenGraph.parts.filter((part) => part.sourceKind === "creator").length, 1);
  assert.equal(
    tokenGraph.creatorPublicationBytes,
    tokenGraph.parts.find((part) => part.sourceKind === "creator").bytes.byteLength,
  );
  assert.ok(tokenGraph.creatorPublicationBytes < tokenGraph.fragmentBytes.byteLength / 2);
  assert.doesNotMatch(new TextDecoder().decode(tokenGraph.fragmentBytes), /=/u);
  assert.match(new TextDecoder().decode(tokenGraph.htmlBytes), /"compression":"gzip"/u);
  assert.doesNotMatch(new TextDecoder().decode(tokenGraph.htmlBytes), /\/content\/|\/api\/onchain\/|https?:\/\//u);

  const decodedMiddle = Buffer.from(new TextDecoder().decode(tokenGraph.fragmentBytes), "base64").toString("utf8");
  assert.match(decodedMiddle, /^[A-Za-z0-9+/]+$/u);
  assert.deepEqual(Buffer.from(decodedMiddle, "base64"), Buffer.from(tokenGraph.htmlBytes));

  const escapedGraph = await buildKeelInlineEscapedTokenURIGraph(root, { legacyCarriage: "acknowledged" });
  assert.equal(escapedGraph.schema, "keel-inline-escaped-token-uri@1");
  assert.equal(escapedGraph.mediaType, "application/vnd.keel.token-uri-percent-fragment");
  assert.equal(escapedGraph.contextDelivery, "percent-html-tail");
  assert.deepEqual(Buffer.from(escapedGraph.htmlBytes), Buffer.from(root.rootBytes));
  assert.doesNotMatch(new TextDecoder().decode(escapedGraph.fragmentBytes), /=/u);
  assert.equal(escapedGraph.parts.filter((part) => part.sourceKind === "creator").length, 1);
  assert.equal(escapedGraph.parts.every((part) => part.escapedHtmlBytes.byteLength % 3 === 0), true);
  const escapedPayload = new TextDecoder().decode(escapedGraph.escapedHtmlBytes);
  assert.equal(new TextEncoder().encode(decodeURIComponent(escapedPayload)).byteLength, escapedGraph.htmlBytes.byteLength);
  assert.equal(decodeURIComponent(escapedPayload), new TextDecoder().decode(root.rootBytes));
  const storedBase64 = JSON.parse(new TextDecoder().decode(root.parts.find((part) => part.kind === "creator").bytes).slice(1)).embedded.storedBase64;
  assert.equal(escapedPayload.includes(storedBase64), true, "compressed resource Base64 must remain literal");

  const rawPercentGraph = await buildKeelInlineRawPercentTokenURIGraph(root);
  assert.equal(rawPercentGraph.schema, "keel-inline-raw-percent-token-uri@1");
  assert.equal(rawPercentGraph.mediaType, "application/vnd.keel.token-uri-raw-percent-fragment");
  assert.deepEqual(Buffer.from(rawPercentGraph.htmlBytes), Buffer.from(root.rootBytes));
  assert.equal(
    decodeURIComponent(new TextDecoder().decode(rawPercentGraph.fragmentBytes)),
    new TextDecoder().decode(rawPercentGraph.escapedHtmlBytes),
  );
  assert.equal(decodeURIComponent(new TextDecoder().decode(rawPercentGraph.escapedHtmlBytes)), new TextDecoder().decode(root.rootBytes));

  const comparison = await compareKeelInlineTokenURICarriages(root);
  assert.equal(comparison.schema, "keel-inline-token-uri-carriage-comparison@1");
  assert.equal(comparison.percentStorageBytes, escapedGraph.fragmentBytes.byteLength);
  assert.equal(comparison.base64StorageBytes, tokenGraph.fragmentBytes.byteLength);
  assert.equal(comparison.preferred, "percent");
  assert.ok(comparison.percentStorageBytes < comparison.base64StorageBytes);
  assert.equal(comparison.savingsBytes, comparison.base64StorageBytes - comparison.percentStorageBytes);

  const followLatest = await buildKeelInlineFollowLatestTokenURIBodyGraph(root, { legacyCarriage: "acknowledged" });
  assert.equal(followLatest.schema, "keel-inline-preencoded-token-uri-body@1");
  assert.equal(followLatest.mediaType, "application/vnd.keel.token-uri-base64-body-fragment");
  assert.equal(followLatest.shellSelection, "follow-latest");
  assert.equal(followLatest.shellId, KEEL_INLINE_PROTECTION_SHELL_ID);
  assert.deepEqual(followLatest.parts.map((part) => part.role), ["module", "entrypoint"]);
  assert.equal(followLatest.parts.some((part) => part.role === "shell-prefix" || part.role === "shell-suffix"), false);
  assert.deepEqual(
    Buffer.from(followLatest.fragmentBytes),
    Buffer.concat(tokenGraph.parts.slice(1, -1).map((part) => Buffer.from(part.bytes))),
  );
  assert.ok(followLatest.fragmentBytes.byteLength < tokenGraph.fragmentBytes.byteLength);
  assert.equal(followLatest.creatorPublicationBytes, tokenGraph.creatorPublicationBytes);

  await assert.rejects(
    buildKeelPreparedOneOfOneTokenURI({
      graph: tokenGraph,
      chainId,
      collection: `0x${"ab".repeat(20)}`,
      collectionName: "Legacy without policy",
      description: "Legacy carriage must never be the collector default",
      imageURI: validWebpURI,
      manifestURI: "",
      manifestDigest: `0x${"12".repeat(32)}`,
    }),
    /Collector-facing Inline requires the automatic raw-percent carriage/u,
  );

  const prepared = await buildKeelPreparedOneOfOneTokenURI({
    graph: tokenGraph,
    chainId,
    collection: `0x${"ab".repeat(20)}`,
    collectionName: "Seed Current",
    description: "A deterministic p5 flow field </script> 雪",
    imageURI: validWebpURI,
    manifestURI: `web3://0x${"cd".repeat(20)}:${chainId}/object/0x${"ef".repeat(32)}`,
    manifestDigest: `0x${"12".repeat(32)}`,
    artifact: {
      store: `0x${"cd".repeat(20)}`,
      objectId: `0x${"34".repeat(32)}`,
      digest: `0x${"56".repeat(32)}`,
      byteLength: 3_300,
      mediaType: "text/javascript",
    },
    presentationPolicy: "raw-artifact",
  });
  assert.equal(prepared.schema, "keel-prepared-one-of-one-token-uri@1");
  assert.equal(prepared.requiredBuilder, "KeelHarnessBuilder");
  assert.equal(prepared.tokenURI, `data:application/json;base64,${new TextDecoder().decode(prepared.encodedPrefix)}${new TextDecoder().decode(tokenGraph.fragmentBytes)}${new TextDecoder().decode(prepared.encodedSuffix)}`);
  const metadata = JSON.parse(prepared.tokenJSON);
  assert.equal(metadata.name, "Seed Current #1");
  assert.equal(metadata.description, "A deterministic p5 flow field </script> 雪");
  assert.deepEqual(metadata.keel_artifact, {
    store: `0x${"cd".repeat(20)}`,
    object_id: `0x${"34".repeat(32)}`,
    digest: `0x${"56".repeat(32)}`,
    byte_length: 3_300,
    media_type: "text/javascript",
    uri: `web3://0x${"cd".repeat(20)}:${chainId}/haulObject/0x${"34".repeat(32)}?mime.type=text%2Fjavascript`,
  });
  assert.match(metadata.animation_url, /^data:text\/html;base64,/u);
  assert.match(metadata.animation_url, /^data:text\/html;base64,/u);
  const animationPayload = metadata.animation_url.slice(metadata.animation_url.indexOf(",") + 1);
  assert.match(animationPayload, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
  assert.doesNotMatch(animationPayload, /[#?&_-]/u);
  const animationHTML = Buffer.from(animationPayload, "base64").toString("utf8");
  assert.match(animationHTML, /__KEEL_CONTEXT__/u);
  assert.match(animationHTML, /__KEEL_ONCHAIN_CONTEXT__/u);
  assert.match(animationHTML, new RegExp(prepared.contextDigest, "u"));
  assert.equal(JSON.parse(prepared.contextJSON).derivedTokenSeed, prepared.derivedTokenSeed);
  assert.doesNotMatch(new TextDecoder().decode(prepared.encodedPrefix), /=/u);

  const escapedPrepared = await buildKeelPreparedOneOfOneTokenURI({
    graph: escapedGraph,
    chainId,
    collection: `0x${"ab".repeat(20)}`,
    collectionName: "Seed Current",
    description: "A deterministic p5 flow field </script> 雪",
      imageURI: validWebpURI,
    manifestURI: `web3://0x${"cd".repeat(20)}:${chainId}/object/0x${"ef".repeat(32)}`,
    manifestDigest: `0x${"12".repeat(32)}`,
    presentationPolicy: "raw-artifact",
  });
  assert.equal(escapedPrepared.animationEncoding, "percent");
  assert.equal(escapedPrepared.requiredBuilder, "KeelPercentTokenURIBuilder");
  assert.match(escapedPrepared.tokenURI, /^data:application\/json;base64,[A-Za-z0-9+/]+=*$/u);
  const escapedMetadata = JSON.parse(escapedPrepared.tokenJSON);
  assert.match(escapedMetadata.animation_url, /^data:text\/html;charset=utf-8,/u);
  assert.equal(escapedMetadata.animation_url.startsWith("data:text/html;base64,"), false);
  const escapedAnimationPayload = escapedMetadata.animation_url.slice(escapedMetadata.animation_url.indexOf(",") + 1);
  assert.doesNotMatch(escapedAnimationPayload, /[\s<>"'&#?\\]/u);
  assert.equal(new URL(escapedMetadata.animation_url).href, escapedMetadata.animation_url, "animation URI must survive URL parsing without normalization");
  assert.equal(escapedAnimationPayload.includes(storedBase64), true);
  const escapedAnimationHTML = decodeURIComponent(escapedAnimationPayload);
  assert.ok(escapedAnimationHTML.startsWith(new TextDecoder().decode(root.rootBytes)));
  assert.match(escapedAnimationHTML, /__KEEL_CONTEXT__/u);
  assert.ok(escapedPrepared.tokenURI.length < prepared.tokenURI.length);

  const rawPercentPrepared = await buildKeelPreparedOneOfOneTokenURI({
    graph: rawPercentGraph,
    chainId,
    collection: `0x${"ab".repeat(20)}`,
    collectionName: "Seed Current",
    description: "A deterministic p5 flow field </script> 雪",
    imageURI: validWebpURI,
    manifestURI: `web3://0x${"cd".repeat(20)}:${chainId}/object/0x${"ef".repeat(32)}`,
    manifestDigest: `0x${"12".repeat(32)}`,
  });
  assert.equal(rawPercentPrepared.animationEncoding, "raw-percent");
  assert.equal(rawPercentPrepared.requiredBuilder, "KeelRawTokenURIBuilder");
  assert.match(rawPercentPrepared.tokenURI, /^data:application\/json;charset=utf-8,/u);
  assert.equal(decodeURIComponent(rawPercentPrepared.tokenURI.slice(rawPercentPrepared.tokenURI.indexOf(",") + 1)), rawPercentPrepared.tokenJSON);
  const rawPercentMetadata = JSON.parse(rawPercentPrepared.tokenJSON);
  assert.match(rawPercentMetadata.animation_url, /^data:text\/html;charset=utf-8,/u);
  assert.equal(decodeURIComponent(rawPercentMetadata.animation_url.slice(rawPercentMetadata.animation_url.indexOf(",") + 1)).startsWith(new TextDecoder().decode(root.rootBytes)), true);
  assert.ok(rawPercentPrepared.tokenURI.length < escapedPrepared.tokenURI.length);

  const followLatestPrepared = await buildKeelPreparedOneOfOneTokenURI({
    graph: followLatest,
    shellFragments: {
      prefix: tokenGraph.parts[0].bytes,
      suffix: tokenGraph.parts.at(-1).bytes,
    },
    chainId,
    collection: `0x${"ab".repeat(20)}`,
    collectionName: "Seed Current",
    description: "A deterministic p5 flow field </script> 雪",
      imageURI: validWebpURI,
    manifestURI: `web3://0x${"cd".repeat(20)}:${chainId}/object/0x${"ef".repeat(32)}`,
    manifestDigest: `0x${"12".repeat(32)}`,
    artifact: {
      store: `0x${"cd".repeat(20)}`,
      objectId: `0x${"34".repeat(32)}`,
      digest: `0x${"56".repeat(32)}`,
      byteLength: 3_300,
      mediaType: "text/javascript",
    },
    presentationPolicy: "raw-artifact",
  });
  assert.equal(followLatestPrepared.tokenURI, prepared.tokenURI);
  assert.equal(followLatestPrepared.tokenJSON, prepared.tokenJSON);

  const compactImageURI = "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3C/svg%3E";
  const compactImagePrepared = await buildKeelPreparedOneOfOneTokenURI({
    graph: tokenGraph,
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
      graph: tokenGraph,
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
    graph: tokenGraph,
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
      graph: tokenGraph,
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

test("creator binary assets stay creator-owned and use one resource-slot Base64 packing layer", async () => {
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
  const graph = await buildKeelInlineRawPercentTokenURIGraph(root);
  assert.equal(
    graph.creatorPublicationBytes,
    graph.parts.filter((part) => part.sourceKind === "creator").reduce((total, part) => total + part.bytes.byteLength, 0),
  );
  assert.equal(new TextDecoder().decode(graph.htmlBytes).includes(assetItem.embedded.storedBase64), true);
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
  const graph = await buildKeelInlinePreEncodedTokenURIGraph(local, { legacyCarriage: "acknowledged" });
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

test("normal media uses the registered shell and asset-display module without a creator wrapper", async () => {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot });
  const inputs = [
    { id: "poster.webp", mediaType: "image/webp", source: new Uint8Array([0x52, 0x49, 0x46, 0x46]) },
    { id: "loop.webm", mediaType: "video/webm", source: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]) },
    { id: "scene.glb", mediaType: "model/gltf-binary", source: new Uint8Array([0x67, 0x6c, 0x54, 0x46]) },
  ];
  const documents = await Promise.all(inputs.map((asset) => buildKeelInlineNormalMediaDocument({ shell, asset })));

  assert.deepEqual(documents.map((document) => document.parts.map((part) => part.role)), [
    ["shell-prefix", "module", "entrypoint", "shell-suffix"],
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
  assert.deepEqual(inputs.map((asset) => keelAssetDisplayKind(asset.mediaType)), ["image", "video", "model"]);
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
  assert.match(displaySource, /model\/gltf-binary/u);
  assert.match(displaySource, /getContext\("webgl"/u);
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
    asset: { id: "poster.png", mediaType: "image/png", source: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
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
  const canonicalRoot = await buildKeelInlineLocalDocument({
    shell,
    modules: [canonicalModule],
    entry: { id: "sketch.js", mediaType: "text/javascript", source: utf8("new p5(()=>{});") },
  });
  const canonicalGraph = await buildKeelInlinePreEncodedTokenURIGraph(canonicalRoot, { legacyCarriage: "acknowledged" });
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
  const recompressedRoot = await buildKeelInlineLocalDocument({
    shell,
    modules: [recompressedModule],
    entry: { id: "sketch.js", mediaType: "text/javascript", source: utf8("new p5(()=>{});") },
  });
  const reusedGraph = await buildKeelInlinePreEncodedTokenURIGraph(recompressedRoot, { existingParts: published , legacyCarriage: "acknowledged" });
  assert.deepEqual(
    reusedGraph.parts.filter((part) => part.sourceKind === "existing").map((part) => part.integrity.digest),
    published.map((part) => part.integrity.digest),
  );
  assert.match(new TextDecoder().decode(reusedGraph.htmlBytes), /"compression":"gzip"/u);
  assert.doesNotMatch(new TextDecoder().decode(reusedGraph.htmlBytes), /"compression":"deflate"/u);

  const canonicalEscaped = await buildKeelInlineEscapedTokenURIGraph(canonicalRoot, { legacyCarriage: "acknowledged" });
  const publishedEscaped = canonicalEscaped.parts.filter((part) => part.sourceKind === "existing").map((part, index) => ({
    bytes: part.bytes,
    integrity: part.integrity,
    carrier: {
      chainId,
      store: `0x${"ab".repeat(20)}`,
      objectId: `0x${String(index + 11).padStart(64, "0")}`,
      mediaType: canonicalEscaped.mediaType,
      compression: "none",
      storedByteLength: part.bytes.byteLength,
    },
  }));
  const reusedEscaped = await buildKeelInlineEscapedTokenURIGraph(recompressedRoot, { existingParts: publishedEscaped , legacyCarriage: "acknowledged" });
  assert.match(new TextDecoder().decode(reusedEscaped.htmlBytes), /"compression":"gzip"/u);
  assert.doesNotMatch(new TextDecoder().decode(reusedEscaped.htmlBytes), /"compression":"deflate"/u);
  await assert.rejects(
    buildKeelInlineEscapedTokenURIGraph(recompressedRoot, { existingParts: published , legacyCarriage: "acknowledged" }),
    /not a compact percent fragment/u,
  );
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

test("the legacy Base64 lanes refuse to run without an acknowledgment or the environment switch", async () => {
  const { assertLegacyCarriageAllowed, KeelLegacyCarriageError } = await import("../packages/sdk/dist/inline-viewer-graph.js");
  const saved = process.env.KEEL_LEGACY_CARRIAGE;
  delete process.env.KEEL_LEGACY_CARRIAGE;
  try {
    assert.throws(() => assertLegacyCarriageAllowed("buildKeelInlinePreEncodedTokenURIGraph", undefined), KeelLegacyCarriageError);
    assert.throws(() => assertLegacyCarriageAllowed("buildKeelInlinePreEncodedTokenURIGraph", {}), /compact raw-percent/u);
    assert.doesNotThrow(() => assertLegacyCarriageAllowed("buildKeelInlinePreEncodedTokenURIGraph", { legacyCarriage: "acknowledged" }));
    process.env.KEEL_LEGACY_CARRIAGE = "allow";
    assert.doesNotThrow(() => assertLegacyCarriageAllowed("buildKeelInlineEscapedTokenURIGraph", {}));
  } finally {
    if (saved === undefined) delete process.env.KEEL_LEGACY_CARRIAGE; else process.env.KEEL_LEGACY_CARRIAGE = saved;
  }
});

test("default saver keeps resource packing unchanged through SDK, publication reuse, and metadata", async () => {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot });
  const artwork = Uint8Array.from({ length: 171_425 }, (_, i) => (i * 73 + (i >>> 8)) & 255);
  const document = await buildKeelInlineLocalDocument({
    shell, modules: [],
    entry: { id: "entry.html", mediaType: "text/html", source: utf8("<main>雪 100% # + / =</main>") },
    assets: [{ id: "artwork.bin", mediaType: "application/octet-stream", source: artwork, compression: "gzip" }],
  });
  const graph = await buildKeelInlineTokenURIGraph(document);
  assert.equal(graph.mediaType, "application/vnd.keel.token-uri-raw-percent-fragment");
  assert.equal(measureKeelInlineCompactGraph(document).graphByteLength, graph.fragmentBytes.length);
  assert.equal(measureKeelInlineCompactGraph(document).creatorPublicationBytes, graph.creatorPublicationBytes);
  assert.deepEqual(decodeKeelInlineGraphFragment(graph.fragmentBytes, graph.mediaType), document.rootBytes);
  const asset = graph.parts.find((part) => part.role === "asset");
  const slot = JSON.parse(Buffer.from(asset.decodedHtmlBytes).toString().slice(1));
  assert.deepEqual(new Uint8Array(gunzipSync(Buffer.from(slot.embedded.storedBase64, "base64"))), artwork);
  // The exact already-packed alphabet appears once, unwrapped, in the stored graph.
  const stored = Buffer.from(graph.fragmentBytes).toString();
  assert.equal(stored.split(slot.embedded.storedBase64).length, 2);
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
  assert.throws(() => buildKeelInlineTokenURIGraph(document, { carriage: "typo" }), /Unsupported Inline carriage/);
  await assert.rejects(buildKeelInlineTokenURIGraph(document, { existingParts: existingParts.map((p) => ({ ...p, carrier: { ...p.carrier, mediaType: "application/vnd.keel.token-uri-base64-fragment" } })) }), /not a raw-percent fragment/);
});
