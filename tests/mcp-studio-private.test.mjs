import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { createMcpServer } from "../packages/mcp/dist/index.js";
import { runStdio } from "../packages/mcp/dist/stdio.js";
const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "private-fixture", version: "1" } } };
const call = (id, name, args) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "keel-private-parity-"));
  const fetch = globalThis.fetch, token = process.env.KEEL_STUDIO_AGENT_TOKEN, origin = process.env.KEEL_STUDIO_URL;
  process.env.KEEL_STUDIO_AGENT_TOKEN = `keel_agent_${"x".repeat(48)}`; process.env.KEEL_STUDIO_URL = "https://studio.example";
  t.after(async () => { globalThis.fetch = fetch; token === undefined ? delete process.env.KEEL_STUDIO_AGENT_TOKEN : process.env.KEEL_STUDIO_AGENT_TOKEN = token; origin === undefined ? delete process.env.KEEL_STUDIO_URL : process.env.KEEL_STUDIO_URL = origin; await rm(dir, { recursive: true, force: true }); });
  await writeFile(path.join(dir, "original.bin"), Buffer.from([0,1,255])); return dir;
}
test("private MCP project/media adapters use authenticated SDK routes and retain exact original bytes", async t => {
  const dir = await fixture(t), requests = [];
  globalThis.fetch = async (url, request) => { requests.push({ url: String(url), ...request }); return Response.json({ id: "same-project", sourcePreserved: true }); };
  const server = await createMcpServer({ workspaceRoot: dir }); await server.handle(init);
  const created = await server.handle(call(2, "keel-studio-project", { action: "create", fields: { name: "Original", idempotencyKey: "stable-source-identity" }, files: [{ path: "original.bin", mediaType: "application/octet-stream" }] }));
  assert.notEqual(created.result.isError, true, JSON.stringify(created));
  assert.equal(requests[0].url, "https://studio.example/api/agent/projects"); assert.equal(requests[0].body.get("idempotencyKey"), "stable-source-identity");
  assert.deepEqual(Buffer.from(await requests[0].body.get("files").arrayBuffer()), Buffer.from([0,1,255]));
  const recipe = { schema: "keel-media-edit@1", mode: "original", format: "original", quality: 82, noSound: false };
  const media = await server.handle(call(3, "keel-studio-media", { action: "export", inputPath: "original.bin", recipe }));
  assert.notEqual(media.result.isError, true, JSON.stringify(media));
  assert.equal(requests[1].url, "https://studio.example/api/agent/media?action=export"); assert.deepEqual(JSON.parse(requests[1].body), { bytesBase64: "AAH/", fileName: "original.bin", recipe });
  assert.ok(requests.every(request => request.signal && new Headers(request.headers).get("authorization") === `Bearer keel_agent_${"x".repeat(48)}`));
  assert.deepEqual(await readFile(path.join(dir, "original.bin")), Buffer.from([0,1,255]));
  globalThis.fetch = async () => Response.json({ error: "Sign in again", code: "authentication-required" }, { status: 401 });
  const denied = await server.handle(call(4, "keel-studio-media", { action: "export", inputPath: "original.bin", recipe }));
  assert.equal(denied.result.isError, true); assert.match(denied.result.content[0].text, /Sign in again/);
});

test("MCP cancellation reaches active SDK fetch and ignores its late success; duplicate active ids are rejected", async t => {
  const dir = await fixture(t); let entered, finish, signal;
  const active = new Promise(resolve => entered = resolve);
  globalThis.fetch = async (_url, init) => { signal = init.signal; entered(); return new Promise(resolve => { finish = () => resolve(Response.json({ sourcePreserved: true })); }); };
  const server = await createMcpServer({ workspaceRoot: dir }); await server.handle(init);
  const request = call(2, "keel-studio-media", { action: "capabilities" }); const pending = server.handle(request); await active;
  assert.equal((await server.handle(request)).error.code, -32600);
  await server.handle({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 2 } });
  assert.equal(signal.aborted, true); finish(); assert.equal(await pending, undefined);
  assert.equal(await server.handle({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 999 } }), undefined);
});

test("stdio cancellation bypasses the busy request queue without forwarding source twice", async t => {
  const dir = await fixture(t), input = new PassThrough(), output = new PassThrough(); let lines = "", entered, signal;
  output.on("data", bytes => { lines += bytes.toString(); });
  const active = new Promise(resolve => entered = resolve);
  globalThis.fetch = async (_url, init) => { signal = init.signal; entered(); return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); };
  const running = runStdio(input, output, dir);
  input.write(`${JSON.stringify(init)}\n${JSON.stringify(call(2, "keel-studio-media", { action: "capabilities" }))}\n`);
  await active; input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 2 } })}\n`);
  input.end(); await running;
  assert.equal(signal.aborted, true); assert.deepEqual(lines.trim().split("\n").map(line => JSON.parse(line).id), [1]);
});
