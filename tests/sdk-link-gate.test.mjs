import test from "node:test";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { encodeFunctionData, parseAbi } from "viem";

import {
  KEEL_LINK_GATE_ALLOWED_URLS,
  KEEL_TONE_15,
  KEEL_WALLET_REQUEST_PROTOCOL,
  KeelLinkGateRefusal,
  assertKeelLinkGate,
  buildKeelInlineShellFragments,
  createKeelWalletRequest,
  enforceKeelLinkGate,
  keelLinkGateLibraryFromUrl,
  keelLinkGatePinnedModules,
  prepareKeelCreatorInline,
  scanKeelLinkGate,
} from "../packages/sdk/dist/index.js";
import { createUploadPlan } from "../packages/builder/dist/index.js";
import { createMcpServer } from "../packages/mcp/dist/index.js";
import { TOOL_DEFINITIONS } from "../packages/mcp/dist/tools.js";
import { KEEL_LINK_GATE_EXEMPT_TOOLS, KEEL_LINK_GATED_TOOLS } from "../packages/mcp/dist/link-gate-tools.js";

const bytes = (value) => new TextEncoder().encode(value);
const scan = (resources, extra = {}) => scanKeelLinkGate({ route: "test", resources, ...extra });
const one = (id, value, extra) => scan([{ id, bytes: typeof value === "string" ? bytes(value) : value }], extra);
const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAk+Uzr4AAAAASUVORK5CYII=", "base64");
const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname);
const previewCommitment = uri => ({schema:"keel-explicit-external-preview@1",uri,mediaType:"image/png",sourceIntegrity:{algorithm:"sha256",digest:"0x"+createHash("sha256").update(ONE_PIXEL_PNG).digest("hex"),byteLength:ONE_PIXEL_PNG.length}});

test("a retired OCA locator is refused and named as retired", () => {
  const report = one("manifest.json", '{"manifestURI":"oca-onchain://11155111/0x0a4f/0x69c2"}');
  assert.equal(report.status, "blocked");
  assert.deepEqual(report.hits.map((hit) => [hit.scheme, hit.url]), [["oca-onchain", "oca-onchain://11155111/0x0a4f/0x69c2"]]);
  assert.throws(() => assertKeelLinkGate({ route: "publish-plan", resources: [{ id: "manifest.json", bytes: bytes('"oca-onchain://1/a/b"') }] }), /OCA is retired/u);
});

test("plain locators of every scheme are refused with resource, offset, URL and context", () => {
  const source = 'const a = 1;\nfetch("https://example.com/a.js");\nload("ipfs://bafybeigdyrzt/x.png");\nconst w = "web3://0xabc/1";\nconst k = "keel-onchain://object/1";\nconst r = "ar://abcdef";';
  const report = one("art.js", source);
  assert.equal(report.status, "blocked");
  assert.deepEqual(report.hits.map((hit) => hit.url), ["https://example.com/a.js", "ipfs://bafybeigdyrzt/x.png", "web3://0xabc/1", "keel-onchain://object/1", "ar://abcdef"]);
  const first = report.hits[0];
  assert.equal(first.resource, "art.js");
  assert.equal(first.offset, source.indexOf("https://"));
  assert.deepEqual(first.layers, []);
  assert.equal(first.scheme, "https");
  assert.match(first.context, /fetch\("\[https:\/\/example\.com\/a\.js\]"\)/u);
  assert.throws(() => assertKeelLinkGate({ route: "upload-plan", resources: [{ id: "art.js", bytes: bytes(source) }] }), (error) => {
    assert.ok(error instanceof KeelLinkGateRefusal);
    assert.equal(error.refusal.code, "external-link-found");
    assert.equal(error.refusal.tool, "upload-plan");
    assert.match(error.message, /art\.js @ byte \d+: https:\/\/example\.com\/a\.js/u);
    assert.match(error.message, /No wallet request or upload plan was produced/u);
    return true;
  });
});

test("only the SVG namespace is allowed; minified ternaries are not Arweave locators", () => {
  assert.deepEqual(KEEL_LINK_GATE_ALLOWED_URLS, ["http://www.w3.org/2000/svg"]);
  assert.equal(one("a.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>').status, "clear");
  assert.equal(one("b.js", "const v = ready ? ar : 1;").status, "clear");
  const xlink = one("c.svg", '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"/>');
  assert.equal(xlink.status, "blocked");
  assert.deepEqual(xlink.hits.map((hit) => hit.url), ["http://www.w3.org/1999/xlink"]);
});

test("locators hidden in compressed, encoded and nested layers are found", () => {
  const hidden = (url) => `run(() => import("${url}"))`;
  const cases = [
    ["gzip", gzipSync(bytes(hidden("https://gzip.example/m.js"))), "https://gzip.example/m.js", ["gzip@0"]],
    ["zlib", deflateSync(bytes(hidden("https://zlib.example/m.js"))), "https://zlib.example/m.js", ["zlib@0"]],
    ["brotli", brotliCompressSync(bytes(Array.from({ length: 64 }, (_, index) => `const v${index} = ${(index * 7919) % 104729};`).join("\n") + hidden("https://brotli.example/m.js"))), "https://brotli.example/m.js", ["brotli@0"]],
    ["base64", bytes(`{"storedBase64":"${Buffer.from(hidden("ipfs://bafybase64/x")).toString("base64")}"}`), "ipfs://bafybase64/x", ["base64@17"]],
    ["uri81/percent", bytes(`data:text/html,${encodeURIComponent(`<script>${hidden("web3://0x1234/5")}</script>`)}`), "web3://0x1234/5", ["percent@0"]],
    ["script escape", bytes(JSON.stringify({ src: "https:\\/\\/escaped.example\\/a" }).replaceAll("\\\\", "\\")), "https://escaped.example/a", ["escape@0"]],
  ];
  for (const [name, value, url, layers] of cases) {
    const report = one(name, value);
    assert.equal(report.status, "blocked", name);
    assert.equal(report.hits[0].url, url, name);
    assert.deepEqual(report.hits[0].layers.slice(0, layers.length), layers, name);
  }
  // A data: URI inside percent-encoded HTML inside a JSON tokenURI, its Base64 payload Brotli-packed.
  const module = Buffer.from(brotliCompressSync(bytes(hidden("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js")))).toString("base64");
  const html = `<script src="data:text/javascript;base64,${module}"></script>`;
  const token = `data:application/json,${encodeURIComponent(JSON.stringify({ name: "x", animation_url: `data:text/html,${encodeURIComponent(html)}` }))}`;
  const nested = one("tokenURI", token);
  assert.equal(nested.status, "blocked");
  const hit = nested.hits.find((entry) => entry.url.includes("three@0.160.0"));
  assert.ok(hit.layers.some((layer) => layer.startsWith("data-uri(text/javascript)-base64@")));
  assert.equal(hit.layers.at(-1), "brotli@0");
  assert.ok(hit.offset > 0 && hit.offset < token.length);
  // Concatenated gzip members inside a binary carrier are opened too.
  const carrier = Buffer.concat([Buffer.from([0, 1, 2, 3, 4, 5]), gzipSync(bytes("x https://member.example/y"))]);
  assert.equal(one("carrier.bin", carrier).hits[0].layers[0], "gzip@6");
});

test("exact registered module bytes and their chunks pass; a modified copy does not", async () => {
  const p5 = await readFile(path.join(repositoryRoot, "examples/demos/vendor/p5.min.js"));
  const exact = one("p5.min.js", p5);
  assert.equal(exact.status, "clear");
  assert.ok(exact.exemptions.length > 0 && exact.exemptions.every((entry) => entry.reason === "registered-module-bytes" && entry.moduleId === "p5-1-11-3"));
  assert.equal(exact.suggestions[0].module.moduleId, "p5-1-11-3");
  assert.equal(exact.suggestions[0].match.kind, "sha256");
  const at = p5.indexOf("http://processing.org");
  const chunk = one("p5 slug", p5.subarray(at - 4000, at + 4000));
  assert.equal(chunk.status, "clear");
  assert.ok(chunk.exemptions.some((entry) => entry.reason === "registered-module-context"));
  const edited = Buffer.concat([p5.subarray(0, at), Buffer.from("http://processing.example"), p5.subarray(at + "http://processing.org".length)]);
  assert.deepEqual(one("p5 copy", edited).hits.map((hit) => hit.url), ["http://processing.example"]);
});

test("a Tone.js banner points at KEEL's pinned Tone with digest and selected-chain availability", () => {
  const vendored = '/*!\n * Tone.js 15.1.22\n * MIT License\n */\nvar Tone=function(){console.warn("see https://github.com/Tonejs/Tone.js/wiki/Accurate-Timing");return{}}();\n';
  const report = one("vendor/tone.js", vendored, { chainId: 11155111 });
  assert.equal(report.status, "blocked");
  assert.equal(report.hits[0].url, "https://github.com/Tonejs/Tone.js/wiki/Accurate-Timing");
  const banner = report.suggestions.find((suggestion) => suggestion.match.kind === "banner");
  assert.equal(banner.library, "tone");
  assert.equal(banner.detectedVersion, "15.1.22");
  assert.equal(banner.match.versionMatch, "exact");
  assert.equal(banner.module.moduleId, KEEL_TONE_15.id);
  assert.equal(banner.module.version, KEEL_TONE_15.version);
  assert.equal(banner.module.digest, `0x${KEEL_TONE_15.digest.replace(/^sha256:/u, "")}`);
  assert.equal(banner.module.byteLength, KEEL_TONE_15.byteLength);
  assert.match(banner.module.pinnedIn, /audio-module\.ts \(KEEL_TONE_15\)/u);
  assert.equal(banner.substitution, "never-automatic");
  // deployments/redline-grid-trailer-sepolia-reference-uri81.json carries the same digest on Sepolia.
  assert.equal(banner.availability.status, "reference-on-selected-chain");
  assert.equal(banner.availability.verification, "requires-selected-chain-readback");
  assert.ok(banner.availability.references.some((reference) => reference.chainId === 11155111 && /^0x[0-9a-f]{64}$/u.test(reference.containerId)));
  // The wiki URL alone also maps to Tone.
  const url = one("player.js", 'console.warn("https://github.com/Tonejs/Tone.js/wiki/Accurate-Timing")');
  assert.equal(url.suggestions[0].match.kind, "url");
  assert.equal(url.suggestions[0].module.moduleId, "tone-native");
  assert.match(new KeelLinkGateRefusal(report).message, /tone-native@15\.1\.22 0x3c958bd7/u);
  assert.equal(one("tone", vendored, { chainId: 1 }).suggestions[0].availability.status, "reference-on-other-chain");
});

test("CDN and GitHub locators map to catalog modules", () => {
  assert.deepEqual(keelLinkGateLibraryFromUrl("https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.11.3/p5.min.js"), { library: "p5", version: "1.11.3", evidence: "cdnjs p5.js/1.11.3" });
  assert.deepEqual(keelLinkGateLibraryFromUrl("https://unpkg.com/tone@15.1.22/build/Tone.js"), { library: "tone", version: "15.1.22", evidence: "npm tone@15.1.22" });
  assert.equal(keelLinkGateLibraryFromUrl("https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.min.js").library, "three");
  assert.equal(keelLinkGateLibraryFromUrl("https://github.com/mrdoob/three.js/blob/dev/LICENSE").library, "three");
  assert.equal(keelLinkGateLibraryFromUrl("https://example.com/app.js"), undefined);

  const report = one("index.html", '<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.11.3/p5.min.js"></script><script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"></script>');
  assert.equal(report.status, "blocked");
  const p5 = report.suggestions.find((suggestion) => suggestion.module.moduleId === "p5-1-11-3");
  assert.equal(p5.match.kind, "url");
  assert.equal(p5.match.versionMatch, "exact");
  assert.equal(p5.module.digest, "0xaf51e6211e061b5ae463fbc5c3c1c272e5ca67fa560ed3513fde17325d837506");
  const three = report.suggestions.find((suggestion) => suggestion.module.moduleId === "three-r180-module");
  assert.equal(three.match.versionMatch, "different-version");
  assert.equal(three.availability.status, "not-claimed");
  assert.ok(keelLinkGatePinnedModules().some((module) => module.moduleId === "three-r180-gltf-loader"));
  assert.ok(!report.suggestions.some((suggestion) => suggestion.module.moduleId === "three-r180-gltf-loader"), "loader add-ons match only by sha256");
});

test("index entries and explicit external previews are honoured", () => {
  const digest = `0x${"ab".repeat(32)}`;
  const report = one("index.html", '<script src="https://unpkg.com/tone@15.1.22/build/Tone.js"></script>', {
    chainId: 8453, index: [{ moduleId: "keel.tone-native", version: "15.1.22", digest, names: ["tone"], chainId: 8453, source: "keel-index" }],
  });
  const indexed = report.suggestions.find((suggestion) => suggestion.module.source === "keel-index");
  assert.equal(indexed.module.digest, digest);
  assert.equal(indexed.availability.status, "reference-on-selected-chain");

  const uri = "https://preview.example/x.png";
  const token = `data:application/json,${encodeURIComponent(JSON.stringify({ image: uri }))}`;
  assert.equal(one("token", token).status, "blocked");
  const allowed = one("token", token, { externalPreviews: [previewCommitment(uri)] });
  assert.equal(allowed.status, "clear");
  assert.equal(allowed.exemptions[0].reason, "explicit-external-preview");
  assert.equal(one("token", token.replace("x.png", "y.png"), { externalPreviews: [previewCommitment(uri)] }).status, "blocked");
  // A percent-encoded preview stays the same commitment when an inner decoded view splits it at the space.
  const spaced = "https://preview.example/art%20image.png?v=1";
  const spacedToken = `data:application/json,${encodeURIComponent(JSON.stringify({ image: spaced }))}`;
  assert.equal(one("token", spacedToken, { externalPreviews: [previewCommitment(spaced)] }).status, "clear");

  // KEEL's manifest pointer (web3:// beside its digest) is metadata; any other web3:// locator is not.
  const manifest = `{"keel_manifest":"web3://0x1111111111111111111111111111111111111111:11155111/m","keel_manifest_digest":"0x${"cd".repeat(32)}"}`;
  const pointer = one("token", `data:application/json,${encodeURIComponent(manifest)}`);
  assert.equal(pointer.status, "clear");
  assert.equal(pointer.exemptions[0].reason, "keel-manifest-pointer");
  assert.equal(one("token", manifest.replace(`"keel_manifest_digest":"0x${"cd".repeat(32)}"`, '"other":1')).status, "blocked");
  assert.equal(one("index.js", 'import("web3://0x1111111111111111111111111111111111111111:11155111/m")').status, "blocked");
});

test("KEEL's registered shell passes verbatim; its links in a creator's own markup do not", async () => {
  const shell = await buildKeelInlineShellFragments({ codecProfile: "native" });
  const resources = [{ id: "shell prefix", bytes: shell.prefix.bytes }, { id: "shell suffix", bytes: shell.suffix.bytes }];
  assert.equal(scan(resources).status, "blocked", "the shell carries collector links a plain scan sees");
  const report = await enforceKeelLinkGate({ route: "test", resources });
  assert.equal(report.status, "clear");
  assert.ok(report.exemptions.some((exemption) => exemption.reason === "registered-shell-context" && exemption.url === "https://onkeel.io/"));
  const creator = bytes('<main><a href="https://onkeel.io/">home</a><img src="https://sepolia.etherscan.io/x.png"></main>');
  await assert.rejects(enforceKeelLinkGate({ route: "test", resources: [{ id: "index.html", bytes: creator }] }), (error) => error instanceof KeelLinkGateRefusal && error.report.hitCount === 2);
  // The shell embedded in a creator document passes; the creator's own link beside it does not.
  const mixed = new Uint8Array([...shell.prefix.bytes, ...bytes('<a href="https://onkeel.io/gallery?ref=me">x</a>'), ...shell.suffix.bytes]);
  await assert.rejects(enforceKeelLinkGate({ route: "test", resources: [{ id: "token.html", bytes: mixed }] }), (error) => error instanceof KeelLinkGateRefusal && error.report.hits.every((hit) => hit.url === "https://onkeel.io/gallery?ref=me"));
});

test("wallet requests, upload plans and creator preparation refuse before producing anything", async () => {
  const abi = parseAbi(["function castSlugs(bytes[] slugs)"]);
  const payload = gzipSync(bytes('globalThis.x = "https://hidden.example/a.js";'));
  const data = encodeFunctionData({ abi, functionName: "castSlugs", args: [[`0x${Buffer.from(payload.subarray(0, 9)).toString("hex")}`, `0x${Buffer.from(payload.subarray(9)).toString("hex")}`]] });
  const request = { protocol: KEEL_WALLET_REQUEST_PROTOCOL, requestId: "cast-1", label: "Store slugs", family: "ethereum", chainId: 11155111, to: "0x1111111111111111111111111111111111111111", data, valueWei: "0" };
  await assert.rejects(createKeelWalletRequest(request), (error) => {
    assert.ok(error instanceof KeelLinkGateRefusal);
    assert.equal(error.report.route, "wallet-request");
    assert.equal(error.report.hits[0].resource, "castSlugs payload");
    assert.equal(error.report.hits[0].url, "https://hidden.example/a.js");
    return true;
  });
  const clean = encodeFunctionData({ abi, functionName: "castSlugs", args: [[`0x${Buffer.from(gzipSync(bytes("globalThis.x = 1;"))).toString("hex")}`]] });
  assert.equal((await createKeelWalletRequest({ ...request, data: clean })).request.data, clean.toLowerCase());
  await assert.rejects(createKeelWalletRequest({ protocol: KEEL_WALLET_REQUEST_PROTOCOL, requestId: "tz-1", label: "Tezos", family: "tezos", network: "ghostnet", destination: "KT1AaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA", amountMutez: "0", entrypoint: "publish", parameters: JSON.stringify({ bytes: Buffer.from("ipfs://bafytezos").toString("hex") }) }), KeelLinkGateRefusal);

  const directory = await mkdtemp(path.join(tmpdir(), "keel-link-gate-plan-"));
  try {
    await assert.rejects(createUploadPlan(bytes('import "https://esm.sh/tone@15.1.22";'), { objectName: "art", mediaType: "text/javascript", outputDirectory: directory, compression: "none" }), (error) => {
      assert.ok(error instanceof KeelLinkGateRefusal);
      assert.equal(error.report.route, "upload-plan");
      assert.ok(error.report.suggestions.some((suggestion) => suggestion.module.moduleId === "tone-native"));
      return true;
    });
    assert.deepEqual(await import("node:fs/promises").then((fs) => fs.readdir(directory)), [], "no chunk files were written");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  await assert.rejects(prepareKeelCreatorInline({
    chainId: 11155111, store: "0x1111111111111111111111111111111111111111",
    resources: [{ id: "entry", role: "entrypoint", mediaType: "text/javascript", bytes: bytes('/*! Tone.js 15.1.22 */ new Image().src = "https://github.com/Tonejs/Tone.js/wiki/Accurate-Timing";') }],
    poster: { bytes: ONE_PIXEL_PNG, mediaType: "image/png" },
  }), (error) => {
    assert.ok(error instanceof KeelLinkGateRefusal);
    assert.equal(error.report.route, "keel-creator-inline-prepare");
    assert.equal(error.report.hits[0].resource, "entry");
    return true;
  });
});

test("every MCP tool is classified, and push tools refuse link-bearing bytes", async () => {
  const names = TOOL_DEFINITIONS.map((definition) => definition.descriptor.name);
  for (const name of [...names, "keel-plugins-list"]) {
    assert.ok(KEEL_LINK_GATED_TOOLS.has(name) !== Object.hasOwn(KEEL_LINK_GATE_EXEMPT_TOOLS, name), `${name} must be either link-gated or exempt with a reason`);
  }
  for (const name of KEEL_LINK_GATED_TOOLS) assert.ok(names.includes(name), `${name} is gated but not registered`);
  for (const route of ["upload-plan", "publish-plan", "wallet-request-prepare", "keel-inline-prepare", "keel-creator-inline-prepare", "keel-studio-stage-project", "keel-studio-draft", "keel-tezos-hold-resources-prepare", "keel-graph-weld-prepare"]) {
    assert.ok(KEEL_LINK_GATED_TOOLS.has(route), route);
  }

  const directory = await mkdtemp(path.join(tmpdir(), "keel-link-gate-mcp-"));
  try {
    await writeFile(path.join(directory, "tone.js"), "/*! Tone.js 15.1.22 */ console.log('https://github.com/Tonejs/Tone.js/wiki/Accurate-Timing');");
    await writeFile(path.join(directory, "clean.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const server = await createMcpServer({ workspaceRoot: directory, pluginConfig: false });
    const call = (id, name, args) => server.handle({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
    await server.handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } });

    const report = await call(1, "keel-link-gate", { files: ["tone.js", "clean.svg"], chainId: 11155111 });
    assert.equal(report.result.isError, undefined);
    assert.equal(report.result.structuredContent.status, "blocked");
    assert.equal(report.result.structuredContent.hits[0].resource, "tone.js");
    assert.equal(report.result.structuredContent.suggestions[0].module.moduleId, "tone-native");
    assert.match(report.result.structuredContent.summary, /tone-native@15\.1\.22/u);

    const upload = await call(2, "upload-plan", { input: "tone.js", objectName: "tone", mediaType: "text/javascript", compression: "none" });
    assert.equal(upload.result.isError, true);
    assert.equal(upload.result.structuredContent.code, "external-link-found");
    assert.equal(upload.result.structuredContent.nextTool, "keel-link-gate");
    assert.equal(upload.result.structuredContent.hits[0].url, "https://github.com/Tonejs/Tone.js/wiki/Accurate-Timing");

    const clean = await call(3, "upload-plan", { input: "clean.svg", objectName: "clean", mediaType: "image/svg+xml", compression: "none" });
    assert.equal(clean.result.isError, undefined);
    assert.equal(clean.result.structuredContent.status, "planned");

    const data = `0x${Buffer.from("ar://abcdefghij").toString("hex")}`;
    const wallet = await call(4, "wallet-request-prepare", { request: { protocol: KEEL_WALLET_REQUEST_PROTOCOL, requestId: "w", label: "w", family: "ethereum", chainId: 11155111, to: "0x1111111111111111111111111111111111111111", data, valueWei: "0" } });
    assert.equal(wallet.result.isError, true);

    // The result net: a gated tool whose result carries a link-bearing payload is refused.
    const net = (await import("../packages/mcp/dist/link-gate-tools.js")).withKeelLinkGate([{ descriptor: { name: "keel-svg-call-plan", description: "x", inputSchema: { type: "object" } }, run: async () => ({ calls: [{ data: `0x${Buffer.from("https://leak.example").toString("hex")}` }] }) }]);
    await assert.rejects(net[0].run({ workspace: { root: directory } }, {}), KeelLinkGateRefusal);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
