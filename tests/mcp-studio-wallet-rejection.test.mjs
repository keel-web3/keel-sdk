import assert from "node:assert/strict";
import test from "node:test";
import { createMcpServer } from "../packages/mcp/dist/index.js";

test("local MCP advertises and invokes bounded rejection recovery using only the existing creator grant", async () => {
  const previousToken = process.env.KEEL_STUDIO_AGENT_TOKEN, previousOrigin = process.env.KEEL_STUDIO_URL, previousFetch = globalThis.fetch;
  const token = `keel_agent_${"r".repeat(48)}`;
  process.env.KEEL_STUDIO_AGENT_TOKEN = token; process.env.KEEL_STUDIO_URL = "https://studio.example";
  const releaseId = "11111111-1111-4111-8111-111111111111", operationId = "22222222-2222-4222-8222-222222222222";
  const recoveryInput = { operationId, attemptId: "44444444-4444-4444-8444-444444444444", expectedRevision: 7, chainId: 11155111, preparedDigest: `0x${"aa".repeat(32)}`,
    walletProofFingerprint: `0x${"bb".repeat(32)}`,
    rejection: { kind: "wallet-policy-rejected", provider: "metamask", method: "eth_sendTransaction", code: -32602, reason: "internal-account-data" } };
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), ...init });
    return Response.json({ schema: "keel-release-wallet-rejection-recovery@1", releaseId, operationId, attemptId: recoveryInput.attemptId, status: "recovered", releaseStatus: "ready",
      nextAction: "prepare-review", storagePreserved: true, uploadedBytes: 0, signing: "not-performed", submission: "not-performed" }); };
  try {
    const server = await createMcpServer();
    await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "rejection-test", version: "1" } } });
    const listed = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const schema = listed.result.tools.find(tool => tool.name === "keel-studio-draft").inputSchema;
    assert.ok(schema.properties.operation.enum.includes("recover-wallet-rejection"));
    assert.equal(schema.properties.recoveryInput.additionalProperties, false);
    assert.ok(schema.properties.recoveryInput.required.includes("rejection"));
    const call = async args => server.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "keel-studio-draft", arguments: args } });
    const args = { operation: "recover-wallet-rejection", releaseId, recoveryInput };
    const result = await call(args);
    assert.equal(result.result.isError, undefined, result.result.content?.[0]?.text);
    assert.equal(result.result.structuredContent.operationId, operationId);
    assert.equal(calls[0].url, `https://studio.example/api/agent/drafts/${releaseId}/wallet-rejection`);
    assert.deepEqual(JSON.parse(calls[0].body), recoveryInput);
    assert.equal(new Headers(calls[0].headers).get("authorization"), `Bearer ${token}`);
    for (const invalid of [{ ...args, grantToken: token }, { ...args, recoveryInput: { ...recoveryInput, calldata: "0x1234" } },
      { ...args, recoveryInput: { ...recoveryInput, rejection: { ...recoveryInput.rejection, code: -32000 } } },
      { ...args, recoveryInput: undefined }]) assert.equal((await call(invalid)).result.isError, true);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.KEEL_STUDIO_AGENT_TOKEN; else process.env.KEEL_STUDIO_AGENT_TOKEN = previousToken;
    if (previousOrigin === undefined) delete process.env.KEEL_STUDIO_URL; else process.env.KEEL_STUDIO_URL = previousOrigin;
  }
});
