import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { encodeDeployData, getAddress } from "viem";
import { createKeelManagedCompositePlan, createKeelManagedObjectPlan } from "../packages/sdk/dist/native-managed.js";
import { createUploadPlan } from "../packages/builder/dist/index.js";
import { KEEL_ENGINE_CATALOG, planKeelProject } from "../packages/sdk/dist/engine.js";
import { canonicalShellFragments, createMcpServer, mcpToolListIssues, TOOL_DEFINITIONS } from "../packages/mcp/dist/index.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAk+Uzr4AAAAASUVORK5CYII=", "base64");
const IMAGE = `data:image/png;base64,${PNG.toString("base64")}`;
const HTML_PREFIX = "data:text/html;charset=utf-8,";
const rawPercent = (value) => `data:application/json,${encodeURIComponent(JSON.stringify(value))}`;
const CAR = "0x399850db36e00b7f82b4dca755059607de323e66";

async function workspace() {
  const directory = await mkdtemp(path.join("/tmp", "keel-mcp-standards-"));
  await writeFile(path.join(directory, "README.md"), "# target\n");
  await mkdir(path.join(directory, "docs"));
  await writeFile(path.join(directory, "docs", "ARCHITECTURE.md"), "# architecture\n");
  const server = await createMcpServer({ workspaceRoot: directory });
  await server.handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "standards-test", version: "1" } } });
  let id = 1;
  const call = async (name, args) => (await server.handle({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: args } }))?.result;
  return { directory, server, call };
}

async function audit(call, tokenUri, extra = {}) {
  return (await call("keel-token-standard-audit", { tokenUri, ...extra })).structuredContent;
}

const codes = (result) => [...new Set(result.findings.map((finding) => finding.code))].sort();

function abiString(text) {
  const data = Buffer.from(text, "utf8");
  const word = (value) => BigInt(value).toString(16).padStart(64, "0");
  return `0x${word(32)}${word(data.length)}${data.toString("hex").padEnd(Math.ceil(data.length / 32) * 64, "0")}`;
}

/** Loopback JSON-RPC that serves one tokenURI; `needsGas` makes calls capped at 30M fail as out-of-gas. */
async function mockRpc({ tokenUri, chainId = 11155111, needsGas = false, estimate = 60_000, requiredGas = needsGas ? 40_000_000 : 0, trace = false }) {
  const calls = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const { id, method, params } = JSON.parse(body);
      calls.push({ method, params });
      const reply = (payload) => response.end(JSON.stringify({ jsonrpc: "2.0", id, ...payload }));
      if (method === "eth_chainId") return reply({ result: `0x${chainId.toString(16)}` });
      if (method === "eth_blockNumber") return reply({ result: "0x10" });
      if (method === "eth_estimateGas") return reply({ result: `0x${estimate.toString(16)}` });
      if (method === "debug_traceCall" && trace) return reply({ result: { gasUsed: `0x${Math.floor(requiredGas * 0.98).toString(16)}` } });
      if (method === "eth_call") {
        if (params[0].gas !== undefined && Number(BigInt(params[0].gas)) < requiredGas) return reply({ error: { code: -32000, message: "out of gas" } });
        return reply({ result: abiString(tokenUri) });
      }
      return reply({ error: { code: -32601, message: "no" } });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("every listed tool passes the MCP client contract (one bad schema blanks the whole list)", async () => {
  const { directory, server } = await workspace();
  try {
    const listed = await server.handle({ jsonrpc: "2.0", id: 99, method: "tools/list", params: {} });
    assert.deepEqual(mcpToolListIssues(listed.result.tools), []);
    for (const tool of listed.result.tools) assert.equal(tool.inputSchema.type, "object", tool.name);
    const shell = listed.result.tools.find((tool) => tool.name === "keel-shell-prepare");
    assert.equal(shell.inputSchema.oneOf, undefined);
    assert.deepEqual(shell.inputSchema.properties.operation.enum, ["manifest", "register", "update", "freeze"]);
    // The validator catches exactly the regression that produced "connected, 0 tools".
    assert.match(mcpToolListIssues([{ name: "x", description: "d", inputSchema: { oneOf: [{ type: "object" }] } }]).join("\n"), /type must be "object"/u);
    // When the desktop app's copy of the official MCP SDK is installed, validate with the client's own schema too.
    const sdkTypes = path.resolve("apps/desktop/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js");
    if (existsSync(sdkTypes)) {
      const { ListToolsResultSchema } = await import(sdkTypes);
      const parsed = ListToolsResultSchema.safeParse(listed.result);
      assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues?.slice(0, 3)));
    }
    assert.equal(TOOL_DEFINITIONS.length, listed.result.tools.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("audit fails closed on the HashersCar shape: https image, raw-percent JSON", async () => {
  const { directory, call } = await workspace();
  try {
    const car = rawPercent({ name: "REDLINE #1", image: "https://hashers-test.example/api/cars/1/image.png", attributes: [{ trait_type: "Seed", value: "0x01" }] });
    const result = await audit(call, car);
    assert.equal(result.verdict, "fail");
    assert.equal(result.pass, false);
    assert.deepEqual(codes(result), ["external-locator", "image-not-onchain"]);
    assert.match(result.digest, /^0x[0-9a-f]{64}$/u);
    const record = JSON.parse(await readFile(path.join(directory, result.recordPath), "utf8"));
    assert.equal(record.id, result.digest);
    assert.equal(record.body.verdict, "fail");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("audit decodes every layer: nested data URIs, gzip slots, base64 JSON, and allows only the SVG namespace", async () => {
  const { directory, call } = await workspace();
  try {
    const { prefix, suffix } = await canonicalShellFragments();
    const passing = await audit(call, rawPercent({ name: "ok", image: IMAGE }));
    assert.equal(passing.verdict, "pass");
    assert.deepEqual(passing.findings, []);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>`;
    assert.equal((await audit(call, rawPercent({ name: "svg", image: `data:image/svg+xml,${encodeURIComponent(svg)}` }))).verdict, "pass");
    const xlink = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"/>`;
    assert.deepEqual(codes(await audit(call, rawPercent({ name: "x", image: `data:image/svg+xml;base64,${Buffer.from(xlink).toString("base64")}` }))), ["external-locator"]);

    // A URL packed inside a gzip slot of a creator module, inside the canonical shell, inside animation_url.
    const packed = gzipSync(Buffer.from('fetch("ipfs://bafyhidden/art.bin")')).toString("base64");
    const html = `${prefix}<script>const slot={"storedBase64":"${packed}"}</script>${suffix}`;
    const hidden = await audit(call, rawPercent({ name: "h", image: IMAGE, animation_url: `${HTML_PREFIX}${encodeURIComponent(html)}` }));
    assert.deepEqual(codes(hidden), ["external-locator"]);
    assert.match(hidden.findings[0].detail, /^ipfs:\/\/bafyhidden/u);
    assert.match(hidden.findings[0].at, /packed/u);

    // The canonical shell itself names protocols in verifier prose; it alone must pass.
    const clean = await audit(call, rawPercent({ name: "c", image: IMAGE, animation_url: `${HTML_PREFIX}${encodeURIComponent(`${prefix}<script>1</script>${suffix}`)}` }));
    assert.equal(clean.verdict, "pass");
    assert.equal(clean.metadata.canonicalShells, 1);

    const handRolled = await audit(call, rawPercent({ name: "v", image: IMAGE, animation_url: `${HTML_PREFIX}${encodeURIComponent("<!doctype html><html><body>mine</body></html>")}` }));
    assert.deepEqual(codes(handRolled), ["viewer-not-canonical-shell"]);

    const base64Html = await audit(call, rawPercent({ name: "b", image: IMAGE, animation_url: `data:text/html;base64,${Buffer.from(`${prefix}${suffix}`).toString("base64")}` }));
    assert.ok(codes(base64Html).includes("html-base64-not-raw-percent"));

    const relative = await audit(call, rawPercent({ name: "r", image: IMAGE, animation_url: `${HTML_PREFIX}${encodeURIComponent(`${prefix}<img src="car.png">${suffix}`)}` }));
    assert.deepEqual(codes(relative), ["viewer-relative-resource"]);

    for (const locator of ["web3://0x1111111111111111111111111111111111111111/1", "ar://abc123", "keel-onchain://object/1", "https://keel.invalid/x"]) {
      const result = await audit(call, rawPercent({ name: "l", image: IMAGE, description: `see ${locator}` }));
      assert.equal(result.verdict, "fail", locator);
      assert.ok(codes(result).includes("external-locator"), locator);
    }

    const b64 = await audit(call, `data:application/json;base64,${Buffer.from(JSON.stringify({ name: "b", image: IMAGE })).toString("base64")}`);
    assert.equal(b64.verdict, "pass");
    assert.deepEqual(b64.findings.map((finding) => [finding.code, finding.severity]), [["metadata-base64", "warning"]]);

    assert.deepEqual(codes(await audit(call, "https://api.example/token/1")), ["external-locator", "token-uri-not-data-json"]);
    assert.deepEqual(codes(await audit(call, rawPercent({ name: "no image" }))), ["image-missing"]);
    await writeFile(path.join(directory, "huge.txt"), rawPercent({ name: "big", image: `data:image/png;base64,${"A".repeat(2_100_000)}` }));
    assert.ok(codes((await call("keel-token-standard-audit", { tokenUriPath: "huge.txt" })).structuredContent).includes("token-uri-too-large"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("audit reads tokenURI live with a 30M gas cap and never trusts estimateGas", async () => {
  const { directory, call } = await workspace();
  const good = await mockRpc({ tokenUri: rawPercent({ name: "live", image: IMAGE }) });
  const heavy = await mockRpc({ tokenUri: rawPercent({ name: "heavy", image: IMAGE }), needsGas: true, estimate: 21_000 });
  try {
    const live = (await call("keel-token-standard-audit", { rpcUrl: good.url, contract: CAR, tokenId: "1", chainId: 11155111 })).structuredContent;
    assert.equal(live.verdict, "pass");
    assert.deepEqual(live.subject, { kind: "contract", chainId: 11155111, contract: CAR, tokenId: "1", block: "0x10" });
    const capped = good.calls.find((entry) => entry.method === "eth_call");
    assert.equal(capped.params[0].gas, "0x1c9c380");
    assert.equal(capped.params[0].data, `0xc87b56dd${"1".padStart(64, "0")}`);
    assert.equal(capped.params[1], "0x10");

    const gas = (await call("keel-token-standard-audit", { rpcUrl: heavy.url, contract: CAR, tokenId: "1" })).structuredContent;
    assert.equal(gas.verdict, "fail");
    assert.deepEqual(codes(gas), ["read-gas-exceeds-limit"]);
    assert.equal(gas.read.estimatedGas, 21_000);

    const wrongChain = await call("keel-token-standard-audit", { rpcUrl: good.url, contract: CAR, tokenId: "1", chainId: 1 });
    assert.equal(wrongChain.isError, true);
  } finally {
    await good.close();
    await heavy.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("exceptions are explicit, exact and never waive read limits", async () => {
  const { directory, call } = await workspace();
  try {
    const hosted = rawPercent({ name: "hosted", image: "https://cdn.example/1.png" });
    const waived = await audit(call, hosted, { exception: { codes: ["image-not-onchain", "external-locator"], reason: "Testnet placeholder reviewed by the owner before the onchain renderer lands.", reviewer: "0x1111111111111111111111111111111111111111" } });
    assert.equal(waived.verdict, "pass-with-exception");
    assert.equal(waived.exception.declared, true);
    assert.equal(waived.exception.signatureVerified, false);
    assert.equal(waived.summary.waived, 2);
    const partial = await audit(call, hosted, { exception: { codes: ["image-not-onchain"], reason: "Only the image was reviewed and nothing else was.", reviewer: "owner" } });
    assert.equal(partial.verdict, "fail");
    const phantom = await call("keel-token-standard-audit", { tokenUri: hosted, exception: { codes: ["viewer-not-canonical-shell"], reason: "Not present, should be refused outright.", reviewer: "owner" } });
    assert.equal(phantom.isError, true);
    const locked = await call("keel-token-standard-audit", { tokenUri: rawPercent({ name: "none" }), exception: { codes: ["image-missing"], reason: "An image cannot be waived by any reviewer.", reviewer: "owner" } });
    assert.equal(locked.isError, true);
    const short = await call("keel-token-standard-audit", { tokenUri: hosted, exception: { codes: ["external-locator"], reason: "ok", reviewer: "owner" } });
    assert.equal(short.isError, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("signing-request tools refuse without evidence and point at the exact next tool", async () => {
  const { directory, call } = await workspace();
  const rpc = await mockRpc({ tokenUri: rawPercent({ name: "live", image: IMAGE }) });
  const bad = await mockRpc({ tokenUri: rawPercent({ name: "bad", image: "https://host/1.png" }) });
  try {
    const request = { protocol: "keel-wallet-request@1", requestId: "mint", label: "Mint", family: "ethereum", chainId: 11155111, to: CAR, data: "0x1249c58b", valueWei: "0" };
    const none = await call("wallet-request-prepare", { request });
    assert.equal(none.isError, true);
    assert.equal(none.structuredContent.code, "standards-evidence-required");
    assert.equal(none.structuredContent.nextTool, "keel-contract-workflow-preflight");
    assert.match(none.content[0].text, /^REFUSED standards-evidence-required/u);
    assert.equal(none.structuredContent.signing, "not-performed");

    const forged = await call("wallet-request-prepare", { request, standards: { preflightReceipt: `0x${"ab".repeat(32)}` } });
    assert.equal(forged.structuredContent.code, "preflight-receipt-invalid");

    const preflight = (await call("keel-contract-workflow-preflight", {})).structuredContent;
    const preflightReceipt = preflight.receipt.id;
    assert.equal(preflight.workflow[0], "keel-contract-workflow-preflight");
    const noAudit = await call("wallet-request-prepare", { request, standards: { preflightReceipt } });
    assert.equal(noAudit.structuredContent.code, "token-standard-audit-required");
    assert.equal(noAudit.structuredContent.nextTool, "keel-token-standard-audit");

    const failed = (await call("keel-token-standard-audit", { rpcUrl: bad.url, contract: CAR, tokenId: "1" })).structuredContent;
    const blocked = await call("wallet-request-prepare", { request, standards: { preflightReceipt, auditDigest: failed.digest } });
    assert.equal(blocked.structuredContent.code, "token-standard-audit-failed");
    assert.match(blocked.structuredContent.message, /image-not-onchain/u);

    const bytesAudit = (await call("keel-token-standard-audit", { tokenUri: rawPercent({ name: "ok", image: IMAGE }) })).structuredContent;
    const wrongSubject = await call("wallet-request-prepare", { request, standards: { preflightReceipt, auditDigest: bytesAudit.digest } });
    assert.equal(wrongSubject.structuredContent.code, "token-standard-audit-subject-mismatch");

    const passed = (await call("keel-token-standard-audit", { rpcUrl: rpc.url, contract: CAR, tokenId: "1" })).structuredContent;
    const ok = await call("wallet-request-prepare", { request, standards: { preflightReceipt, auditDigest: passed.digest } });
    assert.equal(ok.isError, undefined);
    assert.equal(ok.structuredContent.status, "prepared-only");
    assert.equal(ok.structuredContent.standards.audit.digest, passed.digest);
    assert.equal(ok.structuredContent.standards.preflightReceipt.id, preflightReceipt);

    // Tampering with a stored record breaks its digest.
    const auditFile = path.join(directory, passed.recordPath);
    const record = JSON.parse(await readFile(auditFile, "utf8"));
    await writeFile(auditFile, JSON.stringify({ ...record, body: { ...record.body, verdict: "pass", findings: [] , subject: { ...record.body.subject, contract: "0x2222222222222222222222222222222222222222" } } }));
    assert.equal((await call("wallet-request-prepare", { request, standards: { preflightReceipt, auditDigest: passed.digest } })).structuredContent.code, "token-standard-audit-invalid");

    // Editing the docs the receipt read makes it stale.
    await writeFile(path.join(directory, "docs", "ARCHITECTURE.md"), "# architecture, revised\n");
    assert.equal((await call("wallet-request-prepare", { request, standards: { preflightReceipt, workKind: "viewer" } })).structuredContent.code, "preflight-receipt-stale");

    // Genuine KeelHold storage writes still need nothing.
    const storage = await call("wallet-request-prepare", { request: { ...request, to: "0x3333333333333333333333333333333333333333", data: "0x0d1ff9e2" } });
    assert.equal(storage.structuredContent.standards.workKind, "storage-only");
    const paidStorage = await call("wallet-request-prepare", { request: { ...request, data: "0x0d1ff9e2", valueWei: "1" } });
    assert.equal(paidStorage.structuredContent.code, "standards-evidence-required");

    // Collections cannot declare their way out of the audit.
    const fresh = (await call("keel-contract-workflow-preflight", {})).structuredContent.receipt.id;
    const reaudited = (await call("keel-token-standard-audit", { rpcUrl: rpc.url, contract: CAR, tokenId: "1" })).structuredContent;
    const collection = await call("keel-creator-collection-prepare", { chainId: 11155111, creator: "0x1111111111111111111111111111111111111111", creatorNonce: "0", operation: { kind: "external", tokenContract: "0x4444444444444444444444444444444444444444", name: "Theirs", metadataDigest: `0x${"a".repeat(64)}` }, standards: { preflightReceipt: fresh, auditDigest: reaudited.digest } });
    assert.equal(collection.structuredContent.code, "token-standard-audit-subject-mismatch");
    const dodge = await call("keel-creator-collection-prepare", { chainId: 11155111, creator: "0x1111111111111111111111111111111111111111", creatorNonce: "0", operation: { kind: "external", tokenContract: CAR, name: "x", metadataDigest: `0x${"a".repeat(64)}` }, standards: { preflightReceipt: fresh, workKind: "viewer" } });
    assert.equal(dodge.isError, true);
    assert.match(dodge.content[0].text, /does not accept standards\.workKind viewer/u);
  } finally {
    await rpc.close();
    await bad.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("large encodes are written to the workspace with a digest instead of result-too-large", async () => {
  const { directory, call } = await workspace();
  try {
    const content = Buffer.alloc(200_000);
    for (let index = 0; index < content.length; index += 1) content[index] = (index * 7919) % 251;
    await mkdir(path.join(directory, "big"));
    await createUploadPlan(new Uint8Array(content), { objectName: "big", mediaType: "application/octet-stream", compression: "none", outputDirectory: path.join(directory, "big") });
    const target = { plan: "big/upload-plan.json", family: "ethereum", chainId: 11155111, target: "0x5555555555555555555555555555555555555555" };
    const encoded = (await call("ethereum-encode", target)).structuredContent;
    assert.equal(encoded.status, "ready-for-review");
    assert.notEqual(encoded.code, "result-too-large");
    assert.equal(encoded.delivery.mode, "workspace-file");
    assert.equal(encoded.delivery.path, "big/upload-plan.ethereum-encode.json");
    const bytes = await readFile(path.join(directory, encoded.delivery.path));
    assert.equal(encoded.delivery.sha256, `0x${createHash("sha256").update(bytes).digest("hex")}`);
    const full = JSON.parse(bytes.toString("utf8"));
    assert.equal(full.operations.length, encoded.operationCount);
    assert.equal(full.operations[0].kind, "castSlugs");
    assert.equal(encoded.operations[0].dataSha256, `0x${createHash("sha256").update(full.operations[0].data).digest("hex")}`);

    const chainPlan = (await call("chain-plan", { ...target, out: "big/chain-plan.json" })).structuredContent;
    assert.equal(chainPlan.delivery.path, "big/chain-plan.json");
    const published = (await call("publish-plan", { chainPlanPath: "big/chain-plan.json", publicationIntent: "new-object" })).structuredContent;
    assert.equal(published.status, "review-only");
    assert.equal(published.standards.workKind, "storage-only");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("publishing viewer or metadata bytes needs the preflight receipt; plain assets do not", async () => {
  const { directory, call } = await workspace();
  try {
    await mkdir(path.join(directory, "viewer"));
    await createUploadPlan(new TextEncoder().encode("<!doctype html><p>viewer</p>"), { objectName: "viewer", mediaType: "text/html", compression: "none", outputDirectory: path.join(directory, "viewer") });
    const chainPlan = (await call("chain-plan", { plan: "viewer/upload-plan.json", family: "ethereum", chainId: 11155111, target: "0x5555555555555555555555555555555555555555" })).structuredContent;
    const refused = await call("publish-plan", { chainPlan, publicationIntent: "new-object" });
    assert.equal(refused.structuredContent.code, "standards-evidence-required");
    const storageClaim = await call("publish-plan", { chainPlan, publicationIntent: "new-object", standards: { workKind: "storage-only" } });
    assert.equal(storageClaim.structuredContent.code, "storage-only-not-verified");
    const preflightReceipt = (await call("keel-contract-workflow-preflight", {})).structuredContent.receipt.id;
    const ok = await call("publish-plan", { chainPlan, publicationIntent: "new-object", standards: { preflightReceipt } });
    assert.equal(ok.structuredContent.standards.workKind, "viewer");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("catalog documents mined-hash mints and the module-router controller with enforceable checks", () => {
  const mined = KEEL_ENGINE_CATALOG.mintSystems.find((entry) => entry.id === "mined-hash");
  assert.equal(mined.status, "documented-pattern");
  const text = mined.checks.join("\n");
  for (const needle of [/block\.chainid/u, /address\(this\)/u, /msg\.sender/u, /blockhash/u, /window <= 256/u, /spent/u, /One transaction/u]) assert.match(text, needle);
  const router = KEEL_ENGINE_CATALOG.contractPatterns.find((entry) => entry.id === "module-router-controller");
  const routerText = router.checks.join("\n");
  for (const needle of [/Fixed address/u, /bytes4 selector => address module/u, /KeelAuthority/u, /ERC-7201/u, /One-way freeze/u, /no unfreeze/u]) assert.match(routerText, needle);
  const plan = planKeelProject({ outcome: "release", mintSystem: "mined-hash" });
  assert.deepEqual(plan.patternChecks, mined.checks);
  assert.deepEqual(planKeelProject({ outcome: "release", mintSystem: "mined-hash", access: ["public"] }).status, "blocked");
});

test("keel-inline-prepare audits its own prepared tokenURI so build hands a digest to the request", async () => {
  const { directory, call } = await workspace();
  try {
    await writeFile(path.join(directory, "entry.js"), "document.body.append('hi')\n");
    await writeFile(path.join(directory, "poster.png"), PNG);
    const prepared = (await call("keel-inline-prepare", { entry: "entry.js", collection: "0x1111111111111111111111111111111111111111", imagePath: "poster.png", chainId: 11155111 })).structuredContent.prepared;
    assert.equal(prepared.standardAudit.verdict, "pass");
    assert.deepEqual(prepared.standardAudit.findings, []);
    const preflightReceipt = (await call("keel-contract-workflow-preflight", {})).structuredContent.receipt.id;
    const collection = await call("keel-creator-collection-prepare", {
      chainId: 11155111, creator: "0x1111111111111111111111111111111111111111", creatorNonce: "0",
      operation: { kind: "dedicated-erc721", config: { name: "One", symbol: "ONE", maxSupply: 1, metadataDigest: `0x${"a".repeat(64)}` } },
      standards: { preflightReceipt, auditDigest: prepared.standardAudit.digest },
    });
    assert.equal(collection.structuredContent.standards.audit.digest, prepared.standardAudit.digest);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const FORK_TOKEN_URI = gunzipSync(await readFile(new URL("./fixtures/redline-car-1-fork-tokenuri.txt.gz", import.meta.url))).toString("utf8");

test("regression: KEEL's own multi-module Inline graph (REDLINE car #1 fork tokenURI) passes", async () => {
  const { directory, call } = await workspace();
  try {
    await writeFile(path.join(directory, "fork.txt"), FORK_TOKEN_URI);
    const result = (await call("keel-token-standard-audit", { tokenUriPath: "fork.txt" })).structuredContent;
    assert.equal(result.verdict, "pass", JSON.stringify(result.findings));
    assert.deepEqual(result.findings, []);
    assert.equal(result.metadata.canonicalShells, 1);
    assert.equal(result.metadata.graphItems, 4);
    assert.match(result.metadata.image, /^data:image\/svg\+xml/u);

    // The packed entry may only reference ids that exist in the graph.
    const { prefix, suffix } = await canonicalShellFragments();
    const item = (id, mediaType, role, text, aliases = []) => {
      const bytes = Buffer.from(text);
      return { aliases, embedded: { compression: "gzip", storedBase64: gzipSync(bytes).toString("base64") }, id, integrity: { algorithm: "sha256", byteLength: bytes.length, digest: `0x${createHash("sha256").update(bytes).digest("hex")}` }, mediaType, role };
    };
    const graphHtml = (items) => `${prefix}${items.map((entry) => `,${JSON.stringify(entry)}`).join("")}${suffix}`;
    const token = (html) => rawPercent({ name: "g", image: IMAGE, animation_url: `${HTML_PREFIX}${encodeURIComponent(html)}` });
    const kit = item("demo.kit", "text/javascript", "module", "window.kit=1;", ["demo.kit"]);
    const good = graphHtml([kit, item("entry", "text/html", "entrypoint", '<!doctype html><html><head><link rel="stylesheet" href="demo.css"></head><body><script src="demo.kit"></script></body></html>'), item("demo.css", "text/css", "asset", "body{margin:0}")]);
    assert.equal((await audit(call, token(good))).verdict, "pass");
    const unknown = await audit(call, token(graphHtml([kit, item("entry", "text/html", "entrypoint", '<!doctype html><html><body><script src="missing.module"></script></body></html>')])));
    assert.deepEqual(codes(unknown), ["viewer-relative-resource"]);
    assert.match(unknown.findings[0].detail, /not a resource id in this KEEL graph/u);
    const leaking = await audit(call, token(graphHtml([item("demo.kit", "text/javascript", "module", 'fetch("https://api.example/car.json")'), item("entry", "text/html", "entrypoint", '<!doctype html><html><body><script src="demo.kit"></script></body></html>')])));
    assert.deepEqual(codes(leaking), ["external-locator"]);
    assert.match(leaking.findings[0].at, /demo\.kit/u);
    const tampered = { ...kit, integrity: { ...kit.integrity, digest: `0x${"0".repeat(64)}` } };
    assert.deepEqual(codes(await audit(call, token(graphHtml([tampered])))), ["graph-item-integrity-mismatch"]);

    // A hand-rolled page that is not the shell still fails, and so does the HashersCar shape.
    assert.deepEqual(codes(await audit(call, token('<!doctype html><html><body><script src="demo.kit"></script></body></html>'))), ["viewer-not-canonical-shell", "viewer-relative-resource"]);
    assert.equal((await audit(call, rawPercent({ name: "REDLINE #1", image: "https://hashers-test.example/api/cars/1/image.png" }))).verdict, "fail");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("audit measures real read gas by eth_call binary search, alongside the trace", async () => {
  const { directory, call } = await workspace();
  const rpc = await mockRpc({ tokenUri: rawPercent({ name: "g", image: IMAGE }), estimate: 21_000, requiredGas: 6_000_000, trace: true });
  try {
    const result = (await call("keel-token-standard-audit", { rpcUrl: rpc.url, contract: CAR, tokenId: "1" })).structuredContent;
    assert.equal(result.verdict, "pass");
    assert.ok(result.read.measuredGas >= 6_000_000 && result.read.measuredGas <= 6_000_000 * 1.01, String(result.read.measuredGas));
    assert.equal(result.read.measurement.method, "eth_call-binary-search");
    assert.equal(result.read.measurement.tracedGasUsed, 5_880_000);
    assert.equal(result.read.estimatedGas, 21_000);
  } finally {
    await rpc.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("wallet requests accept EIP-55 checksummed addresses and refuse a bad checksum", async () => {
  const { directory, call } = await workspace();
  try {
    const checksummed = getAddress("0x3333333333333333333333333333333333333abc");
    assert.notEqual(checksummed, checksummed.toLowerCase());
    const base = { protocol: "keel-wallet-request@1", requestId: "cs", label: "Cast", family: "ethereum", chainId: 11155111, data: "0x0d1ff9e2", valueWei: "0" };
    const ok = (await call("wallet-request-prepare", { request: { ...base, to: checksummed } })).structuredContent;
    assert.equal(ok.envelope.request.to, checksummed.toLowerCase());
    const wrong = checksummed.replace(/[a-f](?=[^a-f]*$)/u, (c) => c.toUpperCase());
    const bad = await call("wallet-request-prepare", { request: { ...base, to: wrong } });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /EIP-55/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("contract deployments go through wallet-request-prepare, checked against the compiler artifact and gated", async () => {
  const { directory, call } = await workspace();
  try {
    const abi = [{ type: "constructor", stateMutability: "nonpayable", inputs: [{ name: "supply", type: "uint256" }, { name: "authority", type: "address" }] }, { type: "function", name: "x", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] }];
    const bytecode = "0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea164736f6c6343000818000a";
    await writeFile(path.join(directory, "Car.json"), JSON.stringify({ abi, bytecode: { object: bytecode } }));
    const deploy = { artifactPath: "Car.json", chainId: 11155111, args: ["1000", "0x3333333333333333333333333333333333333abc"] };
    const refused = await call("wallet-request-prepare", { deploy });
    assert.equal(refused.structuredContent.code, "standards-evidence-required");
    const preflightReceipt = (await call("keel-contract-workflow-preflight", {})).structuredContent.receipt.id;
    const auditDigest = (await call("keel-token-standard-audit", { tokenUri: rawPercent({ name: "car", image: IMAGE }) })).structuredContent.digest;
    const prepared = (await call("wallet-request-prepare", { deploy, standards: { preflightReceipt, auditDigest } })).structuredContent;
    assert.equal(prepared.kind, "contract-deployment");
    assert.equal(prepared.envelope.request.to, null);
    assert.equal(prepared.envelope.request.data, encodeDeployData({ abi, bytecode, args: [1000n, getAddress("0x3333333333333333333333333333333333333abc")] }));
    assert.equal(prepared.standards.audit.digest, auditDigest);
    const mismatch = await call("wallet-request-prepare", { deploy: { ...deploy, bytecode: `${bytecode}00` }, standards: { preflightReceipt, auditDigest } });
    assert.match(mismatch.content[0].text, /does not match the compiler artifact/u);
    const arity = await call("wallet-request-prepare", { deploy: { ...deploy, args: ["1"] }, standards: { preflightReceipt, auditDigest } });
    assert.match(arity.content[0].text, /takes 2 argument/u);
    const registry = (await call("wallet-request-prepare", { deploy, standards: { preflightReceipt, workKind: "registry-or-module" } })).structuredContent;
    assert.equal(registry.standards.workKind, "registry-or-module");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keel-graph-weld-prepare plans every part and the root weld, matching the SDK", async () => {
  const { directory, call } = await workspace();
  try {
    const hold = "0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267";
    const media = "application/vnd.keel.token-uri-raw-percent-fragment";
    const parts = ["top-", "middle-".repeat(40_000), "-bottom"].map((text) => Buffer.from(text));
    for (const [index, part] of parts.entries()) await writeFile(path.join(directory, `p${index}.txt`), part);
    const result = (await call("keel-graph-weld-prepare", { hold, chainId: 11155111, parts: parts.map((_, index) => ({ path: `p${index}.txt` })), out: "weld.json" })).structuredContent;
    const plans = await Promise.all(parts.map((part) => createKeelManagedObjectPlan(new Uint8Array(part), { hold, mediaType: media, compression: "none" })));
    const root = createKeelManagedCompositePlan(plans.map((plan) => plan.objectId), new Uint8Array(Buffer.concat(parts)), { hold, mediaType: media });
    assert.equal(result.root.objectId, root.objectId);
    assert.deepEqual(result.parts.map((part) => part.objectId), plans.map((plan) => plan.objectId));
    const full = JSON.parse(await readFile(path.join(directory, "weld.json"), "utf8"));
    assert.equal(full.operations.at(-1).kind, "weldComposite");
    assert.equal(full.operations.at(-1).data, root.operation.data);
    assert.ok(full.operations.some((operation) => operation.kind === "castSlugs"));
    // Every operation is a KeelHold storage write, so wallet-request-prepare takes it without evidence.
    const request = (await call("wallet-request-prepare", { request: { protocol: "keel-wallet-request@1", requestId: "root", label: "Weld root", family: "ethereum", chainId: 11155111, to: hold, data: full.operations.at(-1).data, valueWei: "0" } })).structuredContent;
    assert.equal(request.standards.workKind, "storage-only");
    // Reusing a published part by id needs the exact content the root commits to.
    const reuse = await call("keel-graph-weld-prepare", { hold, parts: [{ objectId: plans[0].objectId }, { path: "p1.txt" }, { path: "p2.txt" }] });
    assert.match(reuse.content[0].text, /contentPath/u);
    await writeFile(path.join(directory, "all.txt"), Buffer.concat(parts));
    const reused = (await call("keel-graph-weld-prepare", { hold, parts: [{ objectId: plans[0].objectId }, { path: "p1.txt" }, { path: "p2.txt" }], contentPath: "all.txt" })).structuredContent;
    assert.equal(reused.root.objectId, root.objectId);
    const lying = await call("keel-graph-weld-prepare", { hold, parts: [{ path: "p0.txt", objectId: plans[1].objectId }] });
    assert.equal(lying.isError, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keel-inline-prepare writes part bytes, object ids and the root weld, and supports a contract-SVG image", async () => {
  const { directory, call } = await workspace();
  try {
    await writeFile(path.join(directory, "entry.js"), "document.body.append('hi')\n");
    await writeFile(path.join(directory, "car.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2" fill="red"/></svg>');
    const hold = "0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267";
    const result = (await call("keel-inline-prepare", { entry: "entry.js", collection: "0x1111111111111111111111111111111111111111", imageRoute: "contract-svg", imageSvgPath: "car.svg", chainId: 11155111, outputDirectory: "graph", hold })).structuredContent;
    assert.equal(result.image.route, "contract-svg");
    assert.equal(result.prepared.standardAudit.verdict, "pass");
    const token = await readFile(path.join(directory, "graph", "tokenURI.txt"), "utf8");
    assert.match(decodeURIComponent(token), /"image":"data:image\/svg\+xml/u);
    assert.ok(result.graph.parts.length >= 3);
    for (const part of result.graph.parts) assert.equal(`0x${createHash("sha256").update(await readFile(path.join(directory, part.path))).digest("hex")}`, part.sha256);
    const again = (await call("keel-graph-weld-prepare", { hold, parts: result.graph.parts.map((part) => ({ path: part.path })), contentPath: "graph/graph-fragment.txt" })).structuredContent;
    assert.equal(again.root.objectId, result.graph.weld.root.objectId);
    const unsafe = await writeFile(path.join(directory, "bad.svg"), '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>');
    void unsafe;
    const refused = await call("keel-inline-prepare", { entry: "entry.js", collection: "0x1111111111111111111111111111111111111111", imageRoute: "contract-svg", imageSvgPath: "bad.svg" });
    assert.match(refused.content[0].text, /passive/u);
    const missing = await call("keel-inline-prepare", { entry: "entry.js", collection: "0x1111111111111111111111111111111111111111", imageRoute: "contract-svg" });
    assert.match(missing.content[0].text, /imageSvgPath/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preflight reads KEEL's own standards docs when the target does not vendor them; instructions name real tools", async () => {
  const { directory, server, call } = await workspace();
  try {
    const preflight = (await call("keel-contract-workflow-preflight", {})).structuredContent;
    const bundled = preflight.keelDocuments.map((document) => document.path);
    for (const name of ["docs/KEEL_CONTRACTS.md", "docs/KEEL_PRESENTATION.md", "docs/KEEL_VERIFICATION_SHELL.md"]) assert.ok(bundled.includes(name), name);
    for (const name of bundled) assert.ok(!preflight.unavailable.includes(name));
    assert.ok(preflight.keelDocuments.every((document) => document.source === "keel-sdk" && /^0x[0-9a-f]{64}$/u.test(document.sha256)));
    const init = await server.handle({ jsonrpc: "2.0", id: 500, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    const tools = new Set((await server.handle({ jsonrpc: "2.0", id: 501, method: "tools/list", params: {} })).result.tools.map((tool) => tool.name));
    const prompts = new Set((await server.handle({ jsonrpc: "2.0", id: 502, method: "prompts/list", params: {} })).result.prompts.map((prompt) => prompt.name));
    // Every keel-* name the instructions mention is a real tool or a real prompt.
    for (const name of new Set(init.result.instructions.match(/\bkeel-[a-z0-9-]+/gu))) if (name !== "keel-onchain" /* a locator scheme, not a tool */) assert.ok(tools.has(name) || prompts.has(name), name);
    assert.match(init.result.instructions, /keel-project-plan: it is an MCP PROMPT/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
