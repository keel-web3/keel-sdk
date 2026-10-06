import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpServer } from "../packages/mcp/dist/server.js";

test("MCP starts with hosted Studio wallet review and advertises the same default", async () => {
  const root = await mkdtemp(join(tmpdir(), "keel-studio-default-"));
  try {
    const server = await createMcpServer({ workspaceRoot: root });
    const rpc = (method, params = {}) => server.handle({ jsonrpc: "2.0", id: 1, method, params });
    const hello = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    assert.match(hello.result.instructions, /Studio website at https:\/\/studio\.onkeel\.io/u);
    assert.match(hello.result.instructions, /Desktop is entirely optional/u);
    const resource = await rpc("resources/read", { uri: "keel://mcp/studio-wallet-review" });
    const policy = JSON.parse(resource.result.contents[0].text);
    assert.equal(policy.default, "studio-web");
    assert.equal(policy.desktopRequired, false);
    assert.equal(policy.agentSigning, false);
    assert.equal(policy.agentSubmission, false);
    // Explicit RPC avoids public-index I/O while exercising the Studio default.
    const endpoint = await rpc("tools/call", { name: "keel-endpoint-config", arguments: { publicRpcUrl: "https://rpc.fixture.example" } });
    assert.equal(endpoint.result.structuredContent.studioUrl, "https://studio.onkeel.io");
    const tools = await rpc("tools/list");
    assert.match(tools.result.tools.find(tool => tool.name === "keel-studio-draft").description, /reviewUrl/u);
    const prompt = await rpc("prompts/get", { name: "keel-project-plan", arguments: { request: "Prepare an image release" } });
    assert.match(prompt.result.messages[0].content.text, /Desktop is entirely optional/u);
    assert.match(prompt.result.messages[0].content.text, /handoffUrl or reviewUrl/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
