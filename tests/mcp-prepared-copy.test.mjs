import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createIntegrity } from "../packages/protocol/dist/index.js";
import { createMcpServer } from "../packages/mcp/dist/index.js";

const bytes = text => new TextEncoder().encode(text);
const hash = n => `0x${n.toString(16).padStart(64, "0")}`;
const address = n => `0x${n.toString(16).padStart(40, "0")}`;
const media = {
  base64: "application/vnd.keel.token-uri-base64-fragment",
  body: "application/vnd.keel.token-uri-base64-body-fragment",
  percent: "application/vnd.keel.token-uri-percent-fragment",
  raw: "application/vnd.keel.token-uri-raw-percent-fragment",
};
const roles = ["shell-prefix", "entrypoint", "shell-suffix"];
const source = ["<main>   ", "Water    ", "</main>  "];
const initialize = { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "prepared-copy-test", version: "1" } };

async function fixture(t, lane = "base64") {
  const dir = await mkdtemp(path.join("/tmp", "keel-copy-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const server = await createMcpServer({ workspaceRoot: dir });
  const init = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: initialize });
  const input = { chainId: 11155111, store: address(1), builder: address(2),
    readback: { blockNumber: "11800000", blockHash: hash(3), orderedObjectIds: [hash(10), hash(11), hash(12)] }, parts: [] };
  for (const [i, text] of source.entries()) {
    let payload;
    if (lane === "raw") payload = bytes(encodeURIComponent(encodeURIComponent(text)));
    else if (lane === "percent") {
      let percent = encodeURIComponent(text);
      while (percent.length % 3) percent += "."; // Legal HTML text; unpadded outer Base64.
      payload = bytes(Buffer.from(percent).toString("base64"));
    } else payload = bytes(Buffer.from(Buffer.from(text).toString("base64")).toString("base64"));
    const digest = await createIntegrity(payload);
    await writeFile(path.join(dir, `${i}.bin`), payload);
    input.parts.push({ id: `part-${i}`, role: roles[i], objectId: hash(i + 10),
      mediaType: lane === "follow-latest" && i === 1 ? media.body : media[lane] ?? media.base64,
      compression: "none", bytesPath: `${i}.bin`, digest: digest.digest,
      byteLength: payload.length, transactionHash: hash(i + 20) });
  }
  let nextId = 2;
  const call = async (name, args) => server.handle({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } });
  return { dir, server, init, input, call };
}

for (const lane of ["base64", "raw", "percent", "follow-latest"]) test(`MCP copies exact ${lane} references with zero writes`, async t => {
  const { input, call } = await fixture(t, lane);
  const result = await call("keel-inline-reuse-plan", input);
  assert.equal(result.result.isError, undefined, JSON.stringify(result));
  const plan = result.result.structuredContent;
  assert.equal(plan.status, "review-only");
  assert.equal(plan.assembly.bodyTransform, "none");
  assert.equal(plan.assembly.selectedChainBindingVerified, false);
  assert.equal(plan.assembly.carriage, lane === "base64" ? "pinned" : lane === "raw" ? "raw-percent" : lane);
  assert.deepEqual(plan.assembly.objectOrder, input.parts.map(({ bytesPath, compression, ...part }) => part));
  assert.equal(plan.bytes.newStoredBytes, 0);
  assert.deepEqual(plan.objectWrites, []);
  assert.equal(plan.uploadPlan, null);
  assert.equal(plan.submission, "not-performed");
  assert.match(plan.readback.authentication, /caller-supplied/);
});

test("MCP preserves an existing asset slot without preparing another copy", async t => {
  const { input, call } = await fixture(t, "raw");
  input.parts[1].role = "asset";
  const result = await call("keel-inline-reuse-plan", input);
  assert.equal(result.result.isError, undefined, JSON.stringify(result));
  assert.equal(result.result.structuredContent.assembly.objectOrder[1].role, "asset");
  assert.equal(result.result.structuredContent.bytes.newStoredBytes, 0);
});

test("MCP rejects binary, mixed carriage, altered bytes, and unsafe preparation overrides", async t => {
  const { dir, input, call } = await fixture(t);
  const rejected = async (candidate, pattern) => {
    const response = await call("keel-inline-reuse-plan", candidate);
    assert.equal(response.result.isError, true, JSON.stringify(response));
    assert.match(response.result.content[0].text, pattern);
  };
  await rejected({ ...input, encodeBody: true }, /unsupported fields/);
  await rejected({ ...input, parts: input.parts.map((part, i) => i === 1 ? { ...part, mediaType: "application/octet-stream" } : part) }, /incompatible prepared-copy media/);
  await rejected({ ...input, parts: input.parts.map((part, i) => i === 1 ? { ...part, mediaType: media.raw } : part) }, /incompatible mixed/);
  await rejected({ ...input, parts: input.parts.map((part, i) => i === 1 ? { ...part, digest: hash(100) } : part) }, /commitment/);
  await rejected({ ...input, parts: input.parts.map((part, i) => i === 1 ? { ...part, compression: "gzip" } : part) }, /uncompressed prepared/);
  await rejected({ ...input, parts: input.parts.map((part, i) => i === 1 ? { ...part, objectId: hash(99) } : part) }, /reference vector/);
  await rejected({ ...input, parts: [input.parts[2], input.parts[1], input.parts[0]] }, /ordered shell/);
  await writeFile(path.join(dir, "1.bin"), bytes("different bytes!"));
  await rejected(input, /commitment/);
});

test("MCP rejects padded raw LZMA labeled as a prepared Base64 body", async t => {
  const { dir, input, call } = await fixture(t);
  const raw = Uint8Array.from([93, 0, 0, 128, 0, 255, 255, 255, 255, 255, 255, 255, 255, 32, 32, 32]);
  const integrity = await createIntegrity(raw);
  await writeFile(path.join(dir, "1.bin"), raw);
  input.parts[1] = { ...input.parts[1], digest: integrity.digest, byteLength: raw.length };
  const result = await call("keel-inline-reuse-plan", input);
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /Base64|UTF-8|encoding|encoded/);
});

test("handshake, preflight, resource and tool discovery expose the same copy policy", async t => {
  const { dir, server, init, call } = await fixture(t);
  assert.match(init.result.instructions, /^Existing onchain objects come first/);
  assert.match(init.result.instructions, /preparedTokenURI\/preEncodedTokenURI/);
  await mkdir(path.join(dir, "docs"));
  await writeFile(path.join(dir, "README.md"), "Test workspace");
  await writeFile(path.join(dir, "docs/KEEL_PREPARED_COPY_ASSEMBLY.md"), "Copy exact prepared bytes");
  const preflight = (await call("keel-contract-workflow-preflight", {})).result.structuredContent;
  assert.equal(preflight.preparedCopy.existingObjectsFirst, "keel-inline-reuse-plan");
  assert.equal(preflight.preparedCopy.newSourcePublicationBytes, 0);
  assert(preflight.documents.some(doc => doc.path === preflight.preparedCopy.documentation));
  const resource = await server.handle({ jsonrpc: "2.0", id: 50, method: "resources/read", params: { uri: "keel://mcp/publication-modes" } });
  const modes = JSON.parse(resource.result.contents[0].text);
  assert.deepEqual(modes.existingObjectAssembly, preflight.preparedCopy);
  assert.deepEqual(modes.presentation.sdkPlanner.existingObjectReuse, preflight.preparedCopy);
  assert.deepEqual(modes.staging.existingObjectReuse, preflight.preparedCopy);
  assert.match(modes.staging.imageCarriage, /Never|never/);
  const tools = await server.handle({ jsonrpc: "2.0", id: 51, method: "tools/list", params: {} });
  assert.match(tools.result.tools.find(tool => tool.name === "keel-inline-prepare").description, /^NEW SOURCE ONLY/);
});


test("distributed MCP skill includes its exact prepared-copy documentation", async () => {
  const skill = await readFile(new URL("../packages/mcp/dist/skills/keel-sdk-mcp/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /\.\.\/\.\.\/docs\/KEEL_PREPARED_COPY_ASSEMBLY\.md/);
  for (const name of ["KEEL_PREPARED_COPY_ASSEMBLY.md", "KEEL_PRESENTATION.md", "KEEL_OBJECT_STORAGE_FOR_CHEAP_READS.md"]) {
    const packaged = await readFile(new URL(`../packages/mcp/dist/docs/${name}`, import.meta.url));
    const canonical = await readFile(new URL(`../docs/${name}`, import.meta.url));
    assert.deepEqual(packaged, canonical, name);
  }
});
