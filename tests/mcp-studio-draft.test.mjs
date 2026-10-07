import { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMcpServer } from "../packages/mcp/dist/index.js";

const initializeParams = { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "draft-test", version: "1" } };
const previousStudioOrigin = process.env.KEEL_STUDIO_URL;
process.env.KEEL_STUDIO_URL = "https://studio.example";
after(() => { if (previousStudioOrigin === undefined) delete process.env.KEEL_STUDIO_URL; else process.env.KEEL_STUDIO_URL = previousStudioOrigin; });

const token = `keel_agent_${"d".repeat(48)}`;
const draft = {
  artifactId: null,
  title: "Agent repair",
  description: "Editable through a scoped Studio grant.",
  story: "",
  releaseType: "one-of-one",
  accessMode: "public",
  supply: "1",
  priceEth: "0.1",
  maxPerTransaction: 1,
  maxPerWallet: 1,
  startsAt: null,
  endsAt: null,
  networkLabel: "Sepolia",
  payoutAddress: null,
  page: {},
};

async function call(server, id, args) {
  return server.handle({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "keel-studio-draft", arguments: args } });
}

test("MCP edits Studio drafts with an origin-bound environment override and optimistic revision", async () => {
  const previousToken = process.env.KEEL_STUDIO_AGENT_TOKEN;
  const previousFetch = globalThis.fetch;
  const requests = [];
  process.env.KEEL_STUDIO_AGENT_TOKEN = token;
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (init.method === "PATCH") {
      const payload = JSON.parse(init.body);
      return Response.json({ ...payload.draft, id: "release-1", revision: 2, status: "draft", slug: "agent-repair" });
    }
    return Response.json({ projects: [], releases: [{ ...draft, id: "release-1", revision: 1, status: "draft", slug: "agent-repair" }] });
  };
  try {
    const server = await createMcpServer();
    await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams });
    const listed = await call(server, 2, { studioUrl: "https://studio.example", operation: "list" });
    assert.equal(listed?.result.structuredContent.releases[0].title, "Agent repair");
    const updated = await call(server, 3, {
      studioUrl: "https://studio.example",
      operation: "update",
      releaseId: "release-1",
      expectedRevision: 1,
      draft: { ...draft, title: "Agent repair complete" },
    });
    assert.equal(updated?.result.structuredContent.title, "Agent repair complete");
    assert.equal(updated?.result.structuredContent.revision, 2);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(({ init }) => new Headers(init.headers).get("authorization") === `Bearer ${token}`));
    assert.ok(requests.every(({ url }) => url.startsWith("https://studio.example/api/agent/drafts")));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.KEEL_STUDIO_AGENT_TOKEN;
    else process.env.KEEL_STUDIO_AGENT_TOKEN = previousToken;
  }
});

test("MCP never accepts a draft key in tool arguments and fails closed without an approved connection", async () => {
  const previousToken = process.env.KEEL_STUDIO_AGENT_TOKEN;
  delete process.env.KEEL_STUDIO_AGENT_TOKEN;
  try {
    const server = await createMcpServer();
    await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams });
    const missing = await call(server, 2, { studioUrl: "https://studio.example", operation: "list" });
    assert.equal(missing?.result.isError, true);
    assert.match(missing?.result.content[0].text, /keel-studio-connect/u);
    const exposed = await call(server, 3, { studioUrl: "https://studio.example", operation: "list", grantToken: token });
    assert.equal(exposed?.result.isError, true);
    assert.match(exposed?.result.content[0].text, /grantToken is not supported/u);
  } finally {
    if (previousToken === undefined) delete process.env.KEEL_STUDIO_AGENT_TOKEN;
    else process.env.KEEL_STUDIO_AGENT_TOKEN = previousToken;
  }
});

test("MCP stages an image-only KEEL shell project without uploading a local viewer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "keel-mcp-stage-"));
  const previousToken = process.env.KEEL_STUDIO_AGENT_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.KEEL_STUDIO_AGENT_TOKEN = token;
  await writeFile(path.join(root, "signal.webp"), Uint8Array.of(82, 73, 70, 70, 1, 2, 3, 4));
  let metadata;
  let uploadedFiles = [];
  globalThis.fetch = async (_url, init = {}) => {
    metadata = JSON.parse(init.body.get("metadata"));
    uploadedFiles = init.body.getAll("files");
    return Response.json({
      schema: "keel-studio-project-handoff@1",
      id: "stage-1",
      handoffUrl: "https://studio.example/studio/projects/new?handoff=secret",
      expiresAt: "2026-09-01T00:00:00.000Z",
      fileCount: 1,
      totalBytes: 8,
      wallet: { signing: "not-performed", submission: "not-performed" },
    });
  };
  try {
    const server = await createMcpServer({ workspaceRoot: root });
    await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams });
    const result = await server.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "keel-studio-stage-project",
        arguments: {
          studioUrl: "https://studio.example",
          title: "Signal Bloom",
          description: "Image-only project",
          storageStrategy: "onchain",
          files: [{ path: "signal.webp", mediaType: "image/webp", role: "image", format: "asset" }],
        },
      },
    });
    assert.equal(result?.result.structuredContent.fileCount, 1);
    assert.equal(result?.result.structuredContent.wallet.signing, "not-performed");
    assert.equal(metadata.viewer, "keel-verification-shell");
    assert.deepEqual(metadata.components.map(({ path: filePath, role }) => [filePath, role]), [["signal.webp", "image"]]);
    assert.equal(metadata.publicationIntent.viewer.mode, "keel-sandbox");
    assert.equal(metadata.components.some(({ path: filePath }) => filePath === "viewer.js" || filePath === "index.html"), false);
    assert.equal(uploadedFiles.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.KEEL_STUDIO_AGENT_TOKEN;
    else process.env.KEEL_STUDIO_AGENT_TOKEN = previousToken;
    await rm(root, { recursive: true, force: true });
  }
});

test("MCP stages standard video and model roles through the canonical viewer policy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "keel-mcp-media-stage-"));
  const previousToken = process.env.KEEL_STUDIO_AGENT_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.KEEL_STUDIO_AGENT_TOKEN = token;
  await writeFile(path.join(root, "loop.webm"), Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3));
  await writeFile(path.join(root, "scene.glb"), Uint8Array.of(0x67, 0x6c, 0x54, 0x46));
  let metadata;
  globalThis.fetch = async (_url, init = {}) => {
    metadata = JSON.parse(init.body.get("metadata"));
    return Response.json({
      schema: "keel-studio-project-handoff@1",
      id: "stage-media",
      handoffUrl: "https://studio.example/studio/projects/new?handoff=secret",
      expiresAt: "2026-09-01T00:00:00.000Z",
      fileCount: 2,
      totalBytes: 8,
      wallet: { signing: "not-performed", submission: "not-performed" },
    });
  };
  try {
    const server = await createMcpServer({ workspaceRoot: root });
    await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams });
    const result = await server.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "keel-studio-stage-project",
        arguments: {
          studioUrl: "https://studio.example",
          title: "Media roles",
          storageStrategy: "onchain",
          files: [
            { path: "loop.webm", mediaType: "video/webm", role: "video", format: "asset" },
            { path: "scene.glb", mediaType: "model/gltf-binary", role: "model", format: "asset" },
          ],
        },
      },
    });
    assert.equal(result?.result.isError, undefined, result?.result.content?.[0]?.text);
    assert.equal(result?.result.structuredContent.fileCount, 2);
    assert.deepEqual(metadata.components.map(({ path: filePath, role }) => [filePath, role]), [
      ["loop.webm", "video"],
      ["scene.glb", "model"],
    ]);
    assert.equal(metadata.publicationIntent.viewer.mode, "keel-sandbox");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.KEEL_STUDIO_AGENT_TOKEN;
    else process.env.KEEL_STUDIO_AGENT_TOKEN = previousToken;
    await rm(root, { recursive: true, force: true });
  }
});

test("MCP rejects a locally declared KEEL shell before staging while allowing creator HTML", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "keel-mcp-shell-"));
  const previousToken = process.env.KEEL_STUDIO_AGENT_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.KEEL_STUDIO_AGENT_TOKEN = token;
  await writeFile(path.join(root, "viewer.js"), "console.log('creator');");
  let uploads = 0;
  globalThis.fetch = async () => {
    uploads += 1;
    throw new Error("rejected before upload");
  };
  try {
    const server = await createMcpServer({ workspaceRoot: root });
    await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams });
    const result = await server.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "keel-studio-stage-project",
        arguments: {
          studioUrl: "https://studio.example",
          title: "No local shell",
          storageStrategy: "onchain",
          files: [{ path: "viewer.js", label: "KEEL verification shell", mediaType: "text/javascript", role: "script", format: "classic-script" }],
        },
      },
    });
    assert.equal(result?.result.isError, true);
    assert.match(result?.result.content[0].text, /creator resources\/modules only/u);
    assert.equal(uploads, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.KEEL_STUDIO_AGENT_TOKEN;
    else process.env.KEEL_STUDIO_AGENT_TOKEN = previousToken;
    await rm(root, { recursive: true, force: true });
  }
});

test("portable MCP forwards explicit defaults operations through the same account-scoped endpoint", async () => {
  const previousToken = process.env.KEEL_STUDIO_AGENT_TOKEN, previousFetch = globalThis.fetch;
  process.env.KEEL_STUDIO_AGENT_TOKEN = token;
  const requests = [], command = { commandId: "11111111-1111-4111-8111-111111111111", expectedRevision: 0, scope: { kind: "global" }, values: { delivery: "inline" } };
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json({ schema: "keel-studio-defaults-view@1", profile: { schema: "keel-studio-default-profile@1", revision: 0, askToSave: false, global: {}, byMedia: {} }, signing: "not-performed" });
  };
  try {
    const server = await createMcpServer();
    await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams });
    for (const args of [{ operation: "defaults" }, { operation: "defaults-edit", defaultsCommand: command }]) {
      const response = await call(server, 2, args); assert.notEqual(response?.result.isError, true, response?.result.content?.[0]?.text);
      assert.equal(response?.result.structuredContent.signing, "not-performed");
    }
    assert.deepEqual(requests.map(request => request.url), ["https://studio.example/api/agent/project-defaults", "https://studio.example/api/agent/project-defaults"]);
    assert.deepEqual(JSON.parse(requests[1].init.body), command);
    const unsupported = await call(server, 3, { operation: "defaults-edit", defaultsCommand: { ...command, signingKey: "forbidden" } });
    assert.equal(unsupported?.result.isError, true); assert.equal(requests.length, 2);
  } finally { globalThis.fetch = previousFetch; if (previousToken === undefined) delete process.env.KEEL_STUDIO_AGENT_TOKEN; else process.env.KEEL_STUDIO_AGENT_TOKEN = previousToken; }
});

test("portable MCP reads and shares reviewable conversation forms without model execution or plan mutation", async () => {
  const previousToken = process.env.KEEL_STUDIO_AGENT_TOKEN, previousFetch = globalThis.fetch;
  process.env.KEEL_STUDIO_AGENT_TOKEN = token;
  const releaseId = "11111111-1111-4111-8111-111111111111", requests = [];
  const suggestion = { commandId: "22222222-2222-4222-8222-222222222222", expectedRevision: 3, message: "A suggested title", answers: { title: "The proposal" } };
  globalThis.fetch = async (url, init) => { requests.push({ url: String(url), init }); return Response.json(init.method === "POST"
    ? { schema: "keel-release-conversation-suggestion@1", releaseId, revision: 3, turn: { id: suggestion.commandId }, signing: "not-performed", submission: "not-performed" }
    : { schema: "keel-release-conversation@1", releaseId, revision: 3, turns: [], bridge: { configured: false, online: false }, editable: true, planningUrl: "https://untrusted.example" }); };
  try {
    const server = await createMcpServer(); await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams });
    for (const args of [{ operation: "conversation", releaseId }, { operation: "conversation-suggest", releaseId, conversationCommand: suggestion }]) {
      const result = await call(server, 2, args); assert.notEqual(result?.result.isError, true, result?.result.content?.[0]?.text);
      assert.equal(result?.result.structuredContent.planningUrl, `https://studio.example/studio/releases/${releaseId}/plan`);
    }
    assert.ok(requests.every(request => request.url === `https://studio.example/api/agent/drafts/${releaseId}/conversation`));
    assert.equal(requests[1].init.method, "POST"); assert.deepEqual(JSON.parse(requests[1].init.body), suggestion);
    const forbidden = await call(server, 3, { operation: "conversation-suggest", releaseId, conversationCommand: { ...suggestion, transaction: { data: "0x" } } });
    assert.equal(forbidden?.result.isError, true); assert.equal(requests.length, 2);
  } finally { globalThis.fetch = previousFetch; if (previousToken === undefined) delete process.env.KEEL_STUDIO_AGENT_TOKEN; else process.env.KEEL_STUDIO_AGENT_TOKEN = previousToken; }
});

test("portable MCP prepares the same owner review and never accepts caller wallet or calldata", async () => {
  const previousToken = process.env.KEEL_STUDIO_AGENT_TOKEN, previousFetch = globalThis.fetch;
  const releaseId = "11111111-1111-4111-8111-111111111111", operationId = "22222222-2222-4222-8222-222222222222";
  let requests = 0;
  process.env.KEEL_STUDIO_AGENT_TOKEN = token;
  globalThis.fetch = async (url, init) => {
    requests++; assert.equal(String(url), `https://studio.example/api/agent/drafts/${releaseId}/review`); assert.equal(init.method, "POST"); assert.deepEqual(JSON.parse(init.body), { expectedRevision: 3 });
    return Response.json({ schema: "keel-release-wallet-review@1", releaseId, revision: 3, wallet: `0x${"33".repeat(20)}`, preparation: { operationId, chainId: 11155111,
      calls: [{ kind: "create-drop", to: `0x${"44".repeat(20)}`, data: "0x1234", value: "0x0" }] }, signing: "not-performed", submission: "not-performed" });
  };
  try {
    const server = await createMcpServer(); await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams });
    const answer = await call(server, 2, { operation: "prepare-review", releaseId, expectedRevision: 3 });
    assert.notEqual(answer.result.isError, true); assert.equal(answer.result.structuredContent.schema, "keel-release-wallet-review@1"); assert.equal(answer.result.structuredContent.reviewUrl, `https://studio.example/studio/releases/${releaseId}/review?operation=${operationId}&revision=3`);
    assert.equal(answer.result.structuredContent.submission, "not-performed");
    const rejected = await call(server, 3, { operation: "prepare-review", releaseId, expectedRevision: 3, wallet: "attacker", data: "0x1234" });
    assert.equal(rejected.result.isError, true); assert.equal(requests, 1);
  } finally { globalThis.fetch = previousFetch; if (previousToken === undefined) delete process.env.KEEL_STUDIO_AGENT_TOKEN; else process.env.KEEL_STUDIO_AGENT_TOKEN = previousToken; }
});
