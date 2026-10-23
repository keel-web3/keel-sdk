import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchStudioCapabilities,
  parseStudioCapabilities,
  KEEL_STUDIO_CAPABILITIES_PROTOCOL,
} from "../packages/sdk/dist/index.js";

const capabilities = () => ({
  schema: KEEL_STUDIO_CAPABILITIES_PROTOCOL,
  generatedAt: "2026-08-19T00:00:00.000Z",
  studio: { name: "Fun-Art Studio", environment: "testnet" },
  protocols: {
    auctionIntent: "fray-auction-intent@1",
    quote: "fun-art-agent-quote@2",
    recovery: "fun-art-publication-recovery@2",
  },
  sandbox: {
    zeroSpend: true,
    productionViewer: true,
    rawNetwork: "deny-by-default",
    media: ["image", "audio", "video", "html", "wasm"],
  },
  staging: {
    endpoint: "/api/agent/staging",
    transport: "base64-json",
    maxSourceBytes: 268435456,
    maximumRetentionSeconds: 604800,
    resumable: false,
    oneUseHandoff: true,
    explicitClaim: true,
  },
  authorization: {
    accountSigns: true,
    agentSubmission: "explicitly-scoped",
    signedCallSimulation: true,
    quoteMaximumAgeSeconds: 15,
  },
  msp: {
    authentication: "shared-bearer",
    tenantIsolation: false,
    quotas: false,
    auditLog: false,
    webhooks: false,
  },
  chains: [
    { family: "ethereum", network: "sepolia", chainId: 11155111, nativeCurrency: "ETH", status: "ready" },
    { family: "tezos", network: "ghostnet", chainId: null, nativeCurrency: "ꜩ", status: "blocked", reason: "No deployment." },
  ],
});

const stagingCapabilities = () => ({
  schema: "keel-studio-capabilities@2", generatedAt: "2026-09-03T00:00:00.000Z", chainId: 11155111,
  staging: { endpoint: "/api/agent/staging", transport: "multipart-form-data", authentication: "bearer",
    maxSourceBytes: 134217728, maximumRetentionSeconds: 604800, resumable: false, oneUseHandoff: false },
  wallet: { signing: false, submission: false },
  publication: { readiness: "requires-project-verification", canonicalShellRequired: true },
});

test("multipart Studio reports actual staging without claiming publication readiness", () => {
  const value = stagingCapabilities();
  assert.deepEqual(parseStudioCapabilities(value), value);
  assert.throws(() => parseStudioCapabilities({ ...value, chainId: 0 }), /chainId/u);
  assert.throws(() => parseStudioCapabilities({ ...value, wallet: { signing: true, submission: false } }), /signing/u);
  assert.throws(() => parseStudioCapabilities({ ...value, publication: { ...value.publication, readiness: "ready" } }), /readiness/u);
  assert.throws(() => parseStudioCapabilities({ ...value, staging: { ...value.staging, oneUseHandoff: true } }), /oneUseHandoff/u);
  assert.throws(() => parseStudioCapabilities({ ...value, credential: "must-not-be-public" }), /credential/u);
});

test("Studio capabilities parse strictly and retain honest readiness boundaries", () => {
  const parsed = parseStudioCapabilities(capabilities());
  assert.equal(parsed.staging.resumable, false);
  assert.equal(parsed.msp.tenantIsolation, false);
  assert.equal(parsed.chains[1].status, "blocked");
  assert.throws(() => parseStudioCapabilities({ ...capabilities(), surprise: true }), /surprise is not supported/u);
  assert.throws(() => parseStudioCapabilities({ ...capabilities(), chains: [{ ...capabilities().chains[0], reason: "not blocked" }] }), /only valid when blocked/u);
});

test("SDK discovers a Studio without mutating it", async () => {
  let requested;
  const result = await fetchStudioCapabilities("https://studio.example/path", {
    fetch: async (input, init) => {
      requested = { input: String(input), init };
      return new Response(JSON.stringify(capabilities()), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(result.schema, KEEL_STUDIO_CAPABILITIES_PROTOCOL);
  assert.equal(requested.input, "https://studio.example/.well-known/keel-capabilities");
  assert.equal(requested.init.method, "GET");
  assert.equal(requested.init.cache, "no-store");
});
