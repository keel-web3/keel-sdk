import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODULE = pathToFileURL(path.join(ROOT, "packages", "sdk", "dist", "studio-agent-drafts.js")).href;

const baseDraft = {
  artifactId: "artifact-1",
  title: "Agent work",
  description: "Drafted through an explicit creator grant.",
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

test("shared planning reads and edits the same release revision without signing or trusting supplied URLs", async () => {
  const { createKeelStudioAgentDraftClient } = await import(MODULE);
  const releaseId = "11111111-1111-4111-8111-111111111111";
  const command = { operation: "answer", commandId: releaseId, expectedRevision: 4, answers: { title: "My work" } };
  const requests = [];
  const client = createKeelStudioAgentDraftClient({ grantToken: "x".repeat(48), fetchImplementation: async (url, init) => {
    requests.push({ url: String(url), ...init });
    return Response.json({ schema: "keel-release-planning@1", releaseId, revision: init.method === "PATCH" ? 5 : 4, planningUrl: "https://untrusted.example/token", signing: "not-performed", submission: "not-performed" });
  } });
  assert.equal((await client.plan(releaseId)).planningUrl, `https://studio.onkeel.io/studio/releases/${releaseId}/plan`);
  assert.equal(requests[0].method, undefined);
  assert.equal((await client.editPlan(releaseId, command)).revision, 5);
  assert.equal(requests[1].method, "PATCH");
  assert.deepEqual(JSON.parse(requests[1].body), command);
  await assert.rejects(client.editPlan(releaseId, { ...command, signingKey: "not-allowed" }), /Unsupported/u);
  assert.equal(requests.length, 2);
});

test("draft review links use the hosted default and never forward untrusted URLs or credentials", async () => {
  const { createKeelStudioAgentDraftClient } = await import(MODULE);
  const token = `keel_agent_${"q".repeat(48)}`;
  let requested;
  const client = createKeelStudioAgentDraftClient({ grantToken: token, fetchImplementation: async (url, init) => {
    requested = String(url);
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${token}`);
    return Response.json({ ...baseDraft, id: "release-1", slug: "saved-release-1", revision: 1, status: "draft", reviewUrl: `https://untrusted.example/?token=${token}` });
  } });
  const release = await client.create(baseDraft);
  assert.equal(requested, "https://studio.onkeel.io/api/agent/drafts");
  assert.equal(release.reviewUrl, "https://studio.onkeel.io/release/saved-release-1");
  assert.equal(release.reviewUrl.includes(token), false);
  assert.equal(new URL(release.reviewUrl).search, "");
  const hostile = createKeelStudioAgentDraftClient({ studioUrl: "https://secret@studio.example", grantToken: token, fetchImplementation: async () => { throw new Error("must not fetch"); } });
  await assert.rejects(hostile.list(), /HTTPS/u);
  for (const slug of ["", "../settings", "a?token=secret", "https://untrusted.example"]) {
    const broken = createKeelStudioAgentDraftClient({ grantToken: token, fetchImplementation: async () => Response.json({ ...release, slug }) });
    await assert.rejects(broken.read("release-1"), /invalid release review slug/u);
  }
});

test("agent draft client covers every Studio release type without wallet or publication methods", async () => {
  const { createKeelStudioAgentDraftClient, KEEL_STUDIO_RELEASE_TYPES } = await import(MODULE);
  const requests = [];
  const drafts = new Map();
  const client = createKeelStudioAgentDraftClient({
    studioUrl: "https://studio.example",
    grantToken: `keel_agent_${"a".repeat(48)}`,
    fetchImplementation: async (url, init = {}) => {
      requests.push({ url: String(url), init });
      const parsedUrl = new URL(url);
      if (init.method === "POST") {
        const draft = JSON.parse(init.body);
        const id = `release-${draft.releaseType}`;
        const saved = { ...draft, id, revision: 1, status: "draft", slug: id };
        drafts.set(id, saved);
        return Response.json(saved, { status: 201 });
      }
      const id = decodeURIComponent(parsedUrl.pathname.slice("/api/agent/drafts/".length));
      if (init.method === "PATCH") {
        const payload = JSON.parse(init.body);
        const current = drafts.get(id);
        assert.equal(payload.expectedRevision, current.revision);
        const saved = { ...payload.draft, id, revision: current.revision + 1, status: "draft", slug: id };
        drafts.set(id, saved);
        return Response.json(saved);
      }
      if (parsedUrl.pathname === "/api/agent/drafts") {
        return Response.json({ projects: [], releases: [...drafts.values()] });
      }
      return Response.json(drafts.get(id), { status: drafts.has(id) ? 200 : 404 });
    },
  });

  assert.deepEqual(Object.keys(client).sort(), ["create", "diagnose", "editPlan", "list", "plan", "read", "update"]);
  for (const releaseType of KEEL_STUDIO_RELEASE_TYPES) {
    const supply = releaseType === "open-edition" ? "open" : releaseType === "one-of-one" ? "1" : "100";
    const created = await client.create({ ...baseDraft, releaseType, supply, title: `Agent ${releaseType}` });
    assert.equal(created.reviewUrl, `https://studio.example/release/${created.slug}`);
    const listed = await client.list();
    assert.equal(listed.releases.some((draft) => draft.id === created.id), true);
    const reopened = await client.read(created.id);
    assert.equal(reopened.reviewUrl, created.reviewUrl);
    assert.equal(reopened.releaseType, releaseType);
    const updated = await client.update(created.id, { ...reopened, title: `${reopened.title} revised` }, reopened.revision);
    assert.equal(updated.releaseType, releaseType);
    assert.equal(updated.revision, 2);
    assert.equal(updated.reviewUrl, created.reviewUrl);
    assert.match(updated.title, /revised$/u);
  }
  assert.equal(requests.length, KEEL_STUDIO_RELEASE_TYPES.length * 4);
  assert.ok(requests.every(({ url }) => url.startsWith("https://studio.example/api/agent/drafts")));
  assert.ok(requests.every(({ init }) => new Headers(init.headers).get("authorization") === `Bearer keel_agent_${"a".repeat(48)}`));
});

test("agent draft client persists optimistic revisions and fails closed", async () => {
  const { createKeelStudioAgentDraftClient } = await import(MODULE);
  let payload;
  const client = createKeelStudioAgentDraftClient({
    studioUrl: "https://studio.example/base",
    grantToken: `keel_agent_${"b".repeat(48)}`,
    fetchImplementation: async (_url, init) => {
      payload = JSON.parse(init.body);
      return Response.json({ ...payload.draft, id: "release-1", revision: 2, status: "draft", slug: "renamed" });
    },
  });
  const updated = await client.update("release/1", { ...baseDraft, title: "Renamed" }, 1);
  assert.equal(updated.revision, 2);
  assert.equal(payload.expectedRevision, 1);
  await assert.rejects(client.update("release-1", baseDraft, 0), /positive integer/u);
  const insecure = createKeelStudioAgentDraftClient({ studioUrl: "http://studio.example", grantToken: "x".repeat(48) });
  await assert.rejects(insecure.list(), /HTTPS/u);

  const invalid = createKeelStudioAgentDraftClient({
    studioUrl: "https://studio.example",
    grantToken: "x".repeat(48),
    fetchImplementation: async () => new Response("broken", { status: 500 }),
  });
  await assert.rejects(invalid.list(), /HTTP 500 without JSON/u);

  const secret = `keel_agent_${"secret".repeat(8)}`;
  const hostile = createKeelStudioAgentDraftClient({
    studioUrl: "https://studio.example",
    grantToken: secret,
    fetchImplementation: async () => Response.json({ error: `invalid token ${secret}` }, { status: 401 }),
  });
  await assert.rejects(hostile.list(), (error) => {
    assert.match(error.message, /invalid token \[redacted\]/u);
    assert.doesNotMatch(error.message, new RegExp(secret, "u"));
    return true;
  });
});

test("agent draft operation config keeps stale edits and unsupported actions explicit", async () => {
  const { executeKeelStudioAgentDraftOperation } = await import(MODULE);
  const requests = [];
  const fetchImplementation = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (init.method === "POST") return Response.json({ ...JSON.parse(init.body), id: "release-json", revision: 1, status: "draft", slug: "release-json" }, { status: 201 });
    if (init.method === "PATCH") return Response.json({ ...JSON.parse(init.body).draft, id: "release-json", revision: 2, status: "draft", slug: "release-json" });
    return Response.json({ ...baseDraft, id: "release-json", revision: 1, status: "draft", slug: "release-json" });
  };
  const jsonConfig = {
    studioUrl: "http://127.0.0.1:43123",
    grantToken: `keel_agent_${"c".repeat(48)}`,
    operation: "create",
    draft: baseDraft,
  };
  const created = await executeKeelStudioAgentDraftOperation({ ...jsonConfig, fetchImplementation });
  assert.equal(created.id, "release-json");

  const editConfig = {
    ...jsonConfig,
    operation: "update",
    releaseId: "release-json",
    expectedRevision: 1,
    draft: { ...baseDraft, title: "Agent config edit" },
  };
  const edited = await executeKeelStudioAgentDraftOperation({ ...editConfig, fetchImplementation });
  assert.equal(edited.title, "Agent config edit");
  assert.equal(edited.revision, 2);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ init }) => new Headers(init.headers).get("authorization")?.startsWith("Bearer keel_agent_") === true));

  const stale = { ...editConfig, fetchImplementation: async () => Response.json({ error: "Draft revision is stale." }, { status: 409 }) };
  await assert.rejects(executeKeelStudioAgentDraftOperation(stale), /stale/u);
  await assert.rejects(executeKeelStudioAgentDraftOperation({ ...editConfig, expectedRevision: undefined, fetchImplementation }), /positive integer/u);
  await assert.rejects(executeKeelStudioAgentDraftOperation({ ...jsonConfig, chainId: 11155111, fetchImplementation }), /not supported/u);
});

test("portable draft validation rejects malformed or stale-agent payloads before network access", async () => {
  const { validateKeelStudioAgentReleaseDraft, createKeelStudioAgentDraftClient } = await import(MODULE);
  assert.deepEqual(validateKeelStudioAgentReleaseDraft(baseDraft), baseDraft);
  assert.throws(() => validateKeelStudioAgentReleaseDraft({ ...baseDraft, title: "" }), /title must not be empty/u);
  assert.throws(() => validateKeelStudioAgentReleaseDraft({ ...baseDraft, priceEth: "0.1234567890123456789" }), /at most 18/u);
  assert.throws(() => validateKeelStudioAgentReleaseDraft({ ...baseDraft, publicationState: "published" }), /publicationState is not supported/u);
  let requests = 0;
  const client = createKeelStudioAgentDraftClient({
    studioUrl: "https://studio.example",
    grantToken: `keel_agent_${"z".repeat(48)}`,
    fetchImplementation: async () => { requests += 1; return Response.json({}); },
  });
  await assert.rejects(client.create({ ...baseDraft, supply: "0" }), /positive integer/u);
  assert.equal(requests, 0);
});

test("diagnose retries the existing release with a read-only request and unchanged IDs", async () => {
  const { executeKeelStudioAgentDraftOperation } = await import(MODULE);
  const calls = [];
  const diagnostic = { schema: "keel-release-diagnostics@1", releaseId: "release-existing", artifactId: "artifact-existing", status: "blocked", code: "rpc-unavailable", actions: ["retry-read"], signing: "not-performed", submission: "not-performed", uploadedBytes: 0, changed: false };
  const result = await executeKeelStudioAgentDraftOperation({ operation: "diagnose", releaseId: "release-existing", grantToken: "a".repeat(48),
    fetchImplementation: async (url, init) => { calls.push({ url: String(url), init }); return Response.json(diagnostic); } });
  assert.deepEqual(result, diagnostic);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://studio.onkeel.io/api/agent/drafts/release-existing/diagnostics");
  assert.equal(calls[0].init.method, undefined);
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.cache, "no-store");
});
