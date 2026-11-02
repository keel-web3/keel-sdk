import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import {
  analyzeKeelTokenURIReadRoute, lintKeelTokenURIRelaySource, keelTokenURIForwardFloorGas,
  KEEL_STANDARD_COLLECTION_TOKEN_URI_READ_GAS, KEEL_STANDARD_TOKEN_URI_READ_GAS, KEEL_TOKEN_URI_DIRECT_BUILDER_REMEDY, KEEL_TOKEN_URI_ROUTE_RULE,
} from "../packages/sdk/dist/index.js";
import { createMcpServer, TOOL_DEFINITIONS } from "../packages/mcp/dist/index.js";

const REMEDY = "Use KeelComposed721: the collection itself assembles the URI from the prepared Hold fragments (KeelPreparedAssembly) and returns it, one frame; live state comes from a small IKeelTokenURIComposer that returns only the envelope and object IDs (KB). Where a collection cannot assemble, it calls the registered KEEL builder directly and forwards its returndata with KeelRawStringReturn.forward. Never relay the URI through companions, renderers, clones or proxies.";
const COLLECTION = "0x1000000000000000000000000000000000000001";
const COMPANION = "0x2000000000000000000000000000000000000002";
const BUILDER = "0x3000000000000000000000000000000000000003";
const IMPL = "0x4000000000000000000000000000000000000004";
const IDENTITY = "0x0000000000000000000000000000000000000004";
const gas = (value) => `0x${value.toString(16)}`;
const out = (bytes) => `0x${"ab".repeat(bytes)}`;
const N = 1_550_000;

test("constants: 20M collection standard, 60M ceiling, quadratic forward floor", () => {
  assert.equal(KEEL_STANDARD_COLLECTION_TOKEN_URI_READ_GAS, 20_000_000n);
  assert.equal(KEEL_STANDARD_TOKEN_URI_READ_GAS, 60_000_000n);
  assert.equal(KEEL_TOKEN_URI_DIRECT_BUILDER_REMEDY, REMEDY);
  assert.match(KEEL_TOKEN_URI_ROUTE_RULE, /20,000,000 gas/u);
  // ~4.5M gas per frame at 1.5MB.
  const floor = keelTokenURIForwardFloorGas(1_500_000);
  assert.ok(floor > 4_400_000 && floor < 4_700_000, String(floor));
});

test("route: builder + collection forwarding raw passes", () => {
  const trace = { type: "CALL", to: COLLECTION, gasUsed: gas(16_200_000), output: out(N), calls: [
    { type: "STATICCALL", to: "0x5000000000000000000000000000000000000005", gasUsed: gas(40_000), output: out(512) }, // small envelope module
    { type: "STATICCALL", to: BUILDER, gasUsed: gas(11_000_000), output: out(N), calls: [{ type: "STATICCALL", to: IDENTITY, gasUsed: gas(150_000), output: out(N) }] },
  ] };
  const route = analyzeKeelTokenURIReadRoute(trace);
  assert.equal(route.status, "pass");
  assert.equal(route.bigByteFrames, 2);
  assert.deepEqual(route.hops.map((hop) => hop.role), ["collection", "builder"]);
  assert.equal(route.hops[0].selfGasUsed, 16_200_000 - 11_040_000);
  assert.equal(route.hops[1].address, BUILDER);
  assert.deepEqual(route.findings, []);
});

test("route: collection -> companion -> renderer copying relays fail with the measured shape", () => {
  const trace = { type: "CALL", to: COLLECTION, gasUsed: gas(117_100_000), output: out(N), calls: [
    { type: "STATICCALL", to: COMPANION, gasUsed: gas(63_900_000), output: out(N), calls: [
      { type: "STATICCALL", to: BUILDER, gasUsed: gas(16_100_000), output: out(N) },
    ] },
  ] };
  const route = analyzeKeelTokenURIReadRoute(trace);
  assert.equal(route.status, "fail");
  assert.equal(route.bigByteFrames, 3);
  assert.deepEqual(route.hops.map((hop) => [hop.role, hop.address]), [["collection", COLLECTION], ["relay", COMPANION], ["builder", BUILDER]]);
  assert.deepEqual(route.findings.map((finding) => finding.code), ["token-uri-relay-chain", "token-uri-copying-relay", "token-uri-copying-relay"]);
  assert.deepEqual(route.findings.slice(1).map((finding) => finding.address), [COLLECTION, COMPANION]);
  assert.equal(route.remedy, REMEDY);
});

test("route: a proxy/clone in front is flagged even when it forwards", () => {
  const trace = { type: "CALL", to: COLLECTION, gasUsed: gas(21_000_000), output: out(N), calls: [
    { type: "DELEGATECALL", to: IMPL, gasUsed: gas(16_000_000), output: out(N), calls: [
      { type: "STATICCALL", to: BUILDER, gasUsed: gas(11_000_000), output: out(N) },
    ] },
  ] };
  const route = analyzeKeelTokenURIReadRoute(trace);
  assert.equal(route.status, "fail");
  assert.deepEqual(route.hops.map((hop) => hop.role), ["collection", "proxy", "builder"]);
  assert.deepEqual(route.findings.map((finding) => finding.code), ["token-uri-relay-chain", "token-uri-proxy-frame"]);
});

test("route: small returns are not applicable; a stripped trace is unverified", () => {
  assert.equal(analyzeKeelTokenURIReadRoute({ type: "CALL", to: COLLECTION, gasUsed: gas(90_000), output: out(1024) }).status, "not-applicable");
  assert.equal(analyzeKeelTokenURIReadRoute({ gasUsed: gas(5_000_000) }).status, "unverified");
  assert.equal(analyzeKeelTokenURIReadRoute(undefined).status, "unverified");
});

const RELAY_SOURCE = `
interface IRenderer { function tokenURI(uint256) external view returns (string memory); }
contract Companion {
  IRenderer renderer;
  function tokenURI(uint256 id) external view returns (string memory) {
    return IRenderer(renderer).tokenURI(id);
  }
}
contract Collection {
  address builder;
  function tokenURI(uint256 id) public view returns (string memory) {
    (bool ok, bytes memory data) = builder.staticcall(abi.encodeWithSignature("preparedTokenURI(uint256)", id));
    require(ok);
    return abi.decode(data, (string));
  }
}`;
const FORWARD_SOURCE = `
contract Collection is Base {
  address builder; IEnvelope envelope;
  // never: return IRenderer(r).tokenURI(id);
  /* also not: .preparedTokenURI( */
  function tokenURI(uint256 id) public view override returns (string memory) {
    bytes memory context = envelope.contextFor(id);
    return KeelRawStringReturn.forward(builder, abi.encodeCall(IBuilder.preEncodedTokenURIFragmentsWithImage, (id, context)), false);
  }
  function _legacy(uint256 id) internal view returns (string memory) { return super.tokenURI(id); }
  function name() external pure returns (string memory) { return "x.tokenURI(1)"; }
}`;

test("lint: relays in tokenURI functions are flagged; raw forward, comments, strings and super are allowed", () => {
  const findings = lintKeelTokenURIRelaySource([{ path: "src/Relay.sol", content: RELAY_SOURCE }]);
  assert.deepEqual(findings.map((finding) => [finding.code, finding.line, finding.function]), [["token-uri-source-relay", 6, "tokenURI"], ["token-uri-source-decode-relay", 14, "tokenURI"]]);
  assert.ok(findings.every((finding) => finding.remedy === REMEDY));
  assert.match(findings[0].snippet, /IRenderer\(renderer\)\.tokenURI\(id\)/u);
  assert.deepEqual(lintKeelTokenURIRelaySource([{ path: "src/Forward.sol", content: FORWARD_SOURCE }]), []);
  assert.equal(lintKeelTokenURIRelaySource([{ path: "a.sol", content: "contract A { function uri(uint256 id) external view returns (string memory) { return store.uri(id); } }" }]).length, 1);
});

async function workspace() {
  const directory = await mkdtemp(path.join("/tmp", "keel-token-uri-route-"));
  await writeFile(path.join(directory, "README.md"), "# target\n");
  await mkdir(path.join(directory, "docs"));
  await writeFile(path.join(directory, "docs", "ARCHITECTURE.md"), "# architecture\n");
  await mkdir(path.join(directory, "src"));
  await writeFile(path.join(directory, "src", "Relay.sol"), RELAY_SOURCE);
  const server = await createMcpServer({ workspaceRoot: directory, pluginConfig: false });
  const init = await server.handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "route-test", version: "1" } } });
  let id = 1;
  const call = async (name, args) => (await server.handle({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: args } }))?.result;
  return { directory, call, instructions: init.result.instructions };
}

test("MCP: the rule leads the instructions and every publication tool description", async () => {
  const { directory, instructions } = await workspace();
  try {
    assert.ok(instructions.startsWith("ONE FRAME: THE COLLECTION ASSEMBLES THE URI."), instructions.slice(0, 80));
    for (const name of ["keel-creator-inline-prepare", "publish-plan", "keel-inline-publication-check", "keel-inline-token-audit", "keel-contract-workflow-preflight"]) {
      const definition = TOOL_DEFINITIONS.find((entry) => entry.descriptor.name === name);
      assert.ok(definition, name);
      assert.match(definition.descriptor.description, /KeelRawStringReturn\.forward/u, name);
      assert.match(definition.descriptor.description, /20M gas/u, name);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("MCP preflight lints Solidity and fails closed for publication intent", async () => {
  const { directory, call } = await workspace();
  try {
    const refused = await call("keel-contract-workflow-preflight", { solidityPaths: ["src/Relay.sol"] });
    assert.equal(refused.isError, true);
    assert.equal(refused.structuredContent.code, "token-uri-relay-source");
    assert.match(refused.structuredContent.message, /src\/Relay\.sol:6 tokenURI\(\)/u);
    assert.ok(refused.structuredContent.message.includes(REMEDY));
    const review = (await call("keel-contract-workflow-preflight", { soliditySources: [{ path: "Relay.sol", content: RELAY_SOURCE }], intent: "review" })).structuredContent;
    assert.equal(review.status, "blocked-token-uri-relay");
    assert.equal(review.receipt, undefined);
    assert.equal(review.tokenUriRoute.findings.length, 2);
    const ok = (await call("keel-contract-workflow-preflight", { soliditySources: [{ path: "Forward.sol", content: FORWARD_SOURCE }] })).structuredContent;
    assert.equal(ok.tokenUriRoute.status, "pass");
    assert.match(ok.receipt.id, /^0x[0-9a-f]{64}$/u);
    const plain = (await call("keel-contract-workflow-preflight", {})).structuredContent;
    assert.equal(plain.tokenUriRoute.status, "not-run");
    assert.match(plain.tokenUriRoute.rule, /20,000,000 gas/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function abiString(text) {
  const data = Buffer.from(text, "utf8");
  const word = (value) => BigInt(value).toString(16).padStart(64, "0");
  return `0x${word(32)}${word(data.length)}${data.toString("hex").padEnd(Math.ceil(data.length / 32) * 64, "0")}`;
}

/** Loopback RPC: eth_call needs `requiredGas`; debug_traceCall returns `traceFor(result)`. */
async function traceRpc({ tokenUri, requiredGas, traceFor }) {
  const result = abiString(tokenUri);
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const { id, method, params } = JSON.parse(body);
      const reply = (payload) => response.end(JSON.stringify({ jsonrpc: "2.0", id, ...payload }));
      if (method === "eth_chainId") return reply({ result: "0xaa36a7" });
      if (method === "eth_blockNumber") return reply({ result: "0x10" });
      if (method === "eth_estimateGas") return reply({ result: gas(requiredGas) });
      if (method === "debug_traceCall") return reply({ result: traceFor(result) });
      if (method === "eth_call") return params[0].gas !== undefined && Number(BigInt(params[0].gas)) < requiredGas ? reply({ error: { code: -32000, message: "out of gas" } }) : reply({ result });
      return reply({ error: { code: -32601, message: "no" } });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAk+Uzr4AAAAASUVORK5CYII=";
const BIG_TOKEN = `data:application/json,${encodeURIComponent(JSON.stringify({ name: "big", image: `data:image/png;base64,${PNG}`, description: "x".repeat(600_000) }))}`;

test("MCP audit: good direct-builder route passes; a 3-frame copying relay under 20M still fails", async () => {
  const { directory, call } = await workspace();
  const good = await traceRpc({ tokenUri: BIG_TOKEN, requiredGas: 6_000_000, traceFor: (output) => ({ type: "CALL", to: COLLECTION, gasUsed: gas(6_000_000), output, calls: [{ type: "STATICCALL", to: BUILDER, gasUsed: gas(4_500_000), output }] }) });
  const bad = await traceRpc({ tokenUri: BIG_TOKEN, requiredGas: 9_000_000, traceFor: (output) => ({ type: "CALL", to: COLLECTION, gasUsed: gas(9_000_000), output, calls: [{ type: "STATICCALL", to: COMPANION, gasUsed: gas(6_000_000), output, calls: [{ type: "STATICCALL", to: BUILDER, gasUsed: gas(3_000_000), output }] }] }) });
  const heavy = await traceRpc({ tokenUri: BIG_TOKEN, requiredGas: 25_000_000, traceFor: (output) => ({ type: "CALL", to: COLLECTION, gasUsed: gas(25_000_000), output, calls: [{ type: "STATICCALL", to: BUILDER, gasUsed: gas(23_500_000), output }] }) });
  try {
    const passed = (await call("keel-token-standard-audit", { rpcUrl: good.url, contract: COLLECTION, tokenId: "1" })).structuredContent;
    assert.equal(passed.verdict, "pass", JSON.stringify(passed.findings));
    assert.equal(passed.read.standardReadGas, 20_000_000);
    assert.equal(passed.read.route.status, "pass");
    assert.deepEqual(passed.read.route.hops.map((hop) => hop.role), ["collection", "builder"]);

    const failed = (await call("keel-token-standard-audit", { rpcUrl: bad.url, contract: COLLECTION, tokenId: "1" })).structuredContent;
    assert.equal(failed.verdict, "fail");
    assert.deepEqual(failed.summary.blocking, ["token-uri-relay-chain", "token-uri-copying-relay"]);
    assert.ok(failed.findings.every((finding) => !finding.code.startsWith("token-uri-") || (finding.exceptable === false && finding.detail.includes("KeelRawStringReturn.forward"))));
    assert.ok(failed.next.includes(REMEDY));

    const over = (await call("keel-token-standard-audit", { rpcUrl: heavy.url, contract: COLLECTION, tokenId: "1" })).structuredContent;
    assert.equal(over.verdict, "fail");
    assert.deepEqual(over.summary.blocking, ["collection-read-gas-exceeds-standard"]);
    await assert.rejects(async () => {
      const waived = await call("keel-token-standard-audit", { rpcUrl: heavy.url, contract: COLLECTION, tokenId: "1", exception: { codes: ["collection-read-gas-exceeds-standard"], reason: "reviewed large token over the read standard", reviewer: "tester" } });
      if (waived.isError) throw new Error(waived.content[0].text);
    }, /cannot be excepted/u);
  } finally {
    await Promise.all([good.close(), bad.close(), heavy.close()]);
    await rm(directory, { recursive: true, force: true });
  }
});
