import assert from "node:assert/strict";
import test from "node:test";
import { createKeelStudioAgentDraftClient, executeKeelStudioAgentDraftOperation } from "../packages/sdk/dist/studio-agent-drafts.js";
import { createKeelStudioDefaultProfile } from "../packages/sdk/dist/studio-project-defaults.js";
import { KEEL_PROJECT_STARTER_PROFILES, snapshotKeelProjectProfile } from "../packages/sdk/dist/studio-project-profiles.js";
import { stageKeelStudioProject } from "../packages/sdk/dist/studio-upload.js";
import { createMcpServer } from "../packages/mcp/dist/index.js";
const first = KEEL_PROJECT_STARTER_PROFILES[0]; assert.ok(first);
const snapshot = snapshotKeelProjectProfile(first);
const token = `keel_agent_${"p".repeat(48)}`;
const view = () => ({ schema: "keel-studio-defaults-view@1", profile: createKeelStudioDefaultProfile(), starters: KEEL_PROJECT_STARTER_PROFILES, signing: "not-performed" });
const selected = () => ({ snapshot, defaults: { revision: "profile:1", global: {}, byMedia: {} }, signing: "not-performed", submission: "not-performed" });
const command = { operation: "create", commandId: "11111111-1111-4111-8111-111111111111", expectedRevision: 0, profileId: "22222222-2222-4222-8222-222222222222", profile: { ...first, id: undefined, revision: undefined } };
delete command.profile.id; delete command.profile.revision;

test("SDK profile operations validate scope-independent inputs and verify exact selected revision", async () => {
  const requests = [];
  const options = { studioUrl: "https://studio.example", grantToken: token, fetchImplementation: async (url, init) => { requests.push({ url: String(url), ...init }); return Response.json(init.method === "POST" ? selected() : view()); } };
  const client = createKeelStudioAgentDraftClient(options);
  await client.profiles(); await client.editProfiles(command);
  const copied = await executeKeelStudioAgentDraftOperation({ ...options, operation: "profile-select", profileSelection: { profileId: first.id, expectedProfileRevision: 1 } });
  assert.equal(copied.snapshot.id, first.id); assert.equal(requests.length, 3);
  assert.ok(requests.every(request => request.url === "https://studio.example/api/agent/project-profiles"));
  assert.equal(requests[1].method, "PATCH"); assert.equal(requests[2].method, "POST");
  await assert.rejects(client.editProfiles({ ...command, wallet: "sign" }), /explicit profile operation/u);
  await assert.rejects(client.selectProfile(first.id, 2), /another profile/u);
  const denied = createKeelStudioAgentDraftClient({ ...options, fetchImplementation: async () => Response.json({ error: "preferences:write required" }, { status: 403 }) });
  await assert.rejects(denied.editProfiles(command), /preferences:write/u);
});

test("SDK staging retains the selected private copy and respects explicit payload overrides", async () => {
  const copy = { snapshot: { ...snapshot, configuration: { ...snapshot.configuration, viewer: "none", payloadStorage: "raw" } }, defaults: { revision: "copied:1", global: { delivery: "hybrid" } } };
  for (const explicit of [false, true]) {
    let metadata;
    await stageKeelStudioProject({ studioUrl: "https://studio.example", agentToken: token, title: "Profile work", description: "My original HTML", storageStrategy: "onchain", projectProfile: copy,
      ...(explicit ? { payloadStorage: "compact" } : {}), files: [{ path: "art.html", mediaType: "text/html", bytes: new TextEncoder().encode("<!doctype html><html>Art</html>"), role: "entrypoint", format: "asset", updateMode: "locked" }],
      fetchImplementation: async (_url, init) => { metadata = JSON.parse(init.body.get("metadata")); return Response.json({ schema: "keel-studio-project-handoff@1", id: "draft", handoffUrl: "https://studio.example/studio/projects/new?handoff=draft", expiresAt: "2030-01-01T00:00:00Z", fileCount: 1, totalBytes: 41, wallet: { signing: "not-performed", submission: "not-performed" } }); } });
    assert.deepEqual(metadata.projectProfile.snapshot, copy.snapshot); assert.equal(metadata.viewer, "none"); assert.equal(metadata.payloadStorage, explicit ? "compact" : "raw"); assert.equal(metadata.publicationIntent, undefined);
  }
});

test("portable MCP dispatches the profile operations through the origin-bound connection", async () => {
  const previous = { fetch: globalThis.fetch, url: process.env.KEEL_STUDIO_URL, token: process.env.KEEL_STUDIO_AGENT_TOKEN };
  const requests = []; process.env.KEEL_STUDIO_URL = "https://studio.example"; process.env.KEEL_STUDIO_AGENT_TOKEN = token;
  globalThis.fetch = async (url, init) => { requests.push({ url: String(url), ...init }); return Response.json(init.method === "POST" ? selected() : view()); };
  try {
    const server = await createMcpServer();
    await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "profiles-test", version: "1" } } });
    for (const arguments_ of [{ operation: "profiles" }, { operation: "profiles-edit", profileCommand: command }, { operation: "profile-select", profileSelection: { profileId: first.id, expectedProfileRevision: 1 } }]) {
      const result = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "keel-studio-draft", arguments: arguments_ } }); assert.equal(result.error, undefined); assert.notEqual(result.result.isError, true, result.result.content?.[0]?.text); assert.ok(result.result.structuredContent.snapshot || result.result.structuredContent.profile);
    }
    assert.equal(requests.length, 3); assert.ok(requests.every(request => request.url === "https://studio.example/api/agent/project-profiles"));
  } finally { globalThis.fetch = previous.fetch; for (const [key, value] of [["KEEL_STUDIO_URL", previous.url], ["KEEL_STUDIO_AGENT_TOKEN", previous.token]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
