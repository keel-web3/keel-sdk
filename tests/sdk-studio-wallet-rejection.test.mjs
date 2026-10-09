import assert from "node:assert/strict";
import test from "node:test";
import { createKeelStudioAgentDraftClient, executeKeelStudioAgentDraftOperation } from "../packages/sdk/dist/studio-agent-drafts.js";

const releaseId = "11111111-1111-4111-8111-111111111111", operationId = "22222222-2222-4222-8222-222222222222";
const input = { operationId, attemptId: "44444444-4444-4444-8444-444444444444", expectedRevision: 7, chainId: 11155111, preparedDigest: `0x${"aa".repeat(32)}`,
  walletProofFingerprint: `0x${"bb".repeat(32)}`,
  rejection: { kind: "wallet-policy-rejected", provider: "metamask", method: "eth_sendTransaction", code: -32602, reason: "internal-account-data" } };
const response = { schema: "keel-release-wallet-rejection-recovery@1", releaseId, operationId, attemptId: input.attemptId,
  status: "recovered", releaseStatus: "ready", nextAction: "prepare-review", storagePreserved: true,
  uploadedBytes: 0, signing: "not-performed", submission: "not-performed" };
function fixture(reply = response) {
  const calls = [];
  const token = "x".repeat(48);
  const client = createKeelStudioAgentDraftClient({ studioUrl: "https://studio.example", grantToken: token,
    fetchImplementation: async (url, init) => { calls.push({ url: String(url), ...init }); return Response.json(reply); } });
  return { client, calls, token };
}

test("SDK uses the existing creator grant and same-operation wallet rejection endpoint", async () => {
  const f = fixture();
  assert.deepEqual(await f.client.recoverWalletRejection(releaseId, input), response);
  assert.equal(f.calls[0].url, `https://studio.example/api/agent/drafts/${releaseId}/wallet-rejection`);
  assert.equal(f.calls[0].method, "POST");
  assert.deepEqual(JSON.parse(f.calls[0].body), input);
  assert.equal(new Headers(f.calls[0].headers).get("authorization"), `Bearer ${f.token}`);
  assert.ok(!f.calls[0].body.includes(f.token));
});

test("SDK accepts ordinary explicit 4001 and rejects unknown or excessive evidence before transmitting", async () => {
  const f = fixture();
  const userRejected = { kind: "user-rejected", provider: "eip1193", method: "wallet_sendCalls", code: 4001, reason: "user-declined" };
  await f.client.recoverWalletRejection(releaseId, { ...input, rejection: userRejected });
  for (const bad of [
    { ...input, creatorId: "another-owner" }, { ...input, transactionHashes: [] }, { ...input, expectedRevision: 0 },
    { ...input, chainId: 0 }, { ...input, walletProofFingerprint: "0xbad" }, { ...input, operationId: "unknown" },
    { ...input, rejection: { ...input.rejection, code: -32000 } },
    { ...input, rejection: { ...input.rejection, method: "wallet_sendCalls" } },
    { ...input, rejection: { ...input.rejection, message: "private raw provider response" } },
  ]) await assert.rejects(f.client.recoverWalletRejection(releaseId, bad));
  assert.equal(f.calls.length, 1);
});

test("SDK rejects mismatched, submitted, mutating and unverified server responses", async () => {
  for (const mutation of [{ releaseId: operationId }, { operationId: releaseId }, { releaseStatus: "publishing" },
    { status: "pending" }, { storagePreserved: false }, { uploadedBytes: 1 }, { signing: "signed" }, { submission: "submitted" }]) {
    const f = fixture({ ...response, ...mutation });
    await assert.rejects(f.client.recoverWalletRejection(releaseId, input), /invalid wallet rejection recovery evidence/u);
  }
});

test("portable recovery operation maps the diagnostic identity and explicit rejection to the same endpoint", async () => {
  const calls = [], options = { studioUrl: "https://studio.example", grantToken: "x".repeat(48), operation: "recover-wallet-rejection", releaseId,
    fetchImplementation: async (url, init) => { calls.push({ url: String(url), ...init }); return Response.json(response); } };
  assert.deepEqual(await executeKeelStudioAgentDraftOperation({ ...options, recoveryInput: input }), response);
  assert.equal(calls[0].url, `https://studio.example/api/agent/drafts/${releaseId}/wallet-rejection`);
  assert.deepEqual(JSON.parse(calls[0].body), input);
  await assert.rejects(executeKeelStudioAgentDraftOperation(options), /explicitly confirmed typed wallet rejection/u);
  await assert.rejects(executeKeelStudioAgentDraftOperation({ ...options, recoveryInput: { ...input, rejection: undefined } }));
  assert.equal(calls.length, 1);
});

test("diagnostic recovery input is revision-bound and never supplies a rejection on the user's behalf", async () => {
  const { rejection: _rejection, ...recoveryInput } = input;
  const diagnostic = { schema: "keel-release-diagnostics@1", releaseId, revision: input.expectedRevision, chainId: input.chainId,
    recoveryInput, signing: "not-performed", submission: "not-performed", uploadedBytes: 0, changed: false };
  const f = fixture(diagnostic);
  assert.deepEqual((await f.client.diagnose(releaseId)).recoveryInput, recoveryInput);
  for (const mutation of [{ expectedRevision: 8 }, { chainId: 1 }, { walletProofFingerprint: "0xbad" }, { rejection: input.rejection }, { calldata: "0x12345678" }]) {
    const invalid = fixture({ ...diagnostic, recoveryInput: { ...recoveryInput, ...mutation } });
    await assert.rejects(invalid.client.diagnose(releaseId), /invalid wallet rejection recovery input/u);
  }
});

test("SDK forwards a recorded dispatch abort without accepting a fabricated wallet error code", async () => {
  const f = fixture(), aborted = { ...input,
    rejection: { kind: "dispatch-aborted", provider: "studio", method: "wallet_sendCalls", reason: "browser-journal-unavailable" } };
  await f.client.recoverWalletRejection(releaseId, aborted);
  assert.equal(JSON.parse(f.calls[0].body).rejection.code, undefined);
  await assert.rejects(f.client.recoverWalletRejection(releaseId, { ...aborted, rejection: { ...aborted.rejection, code: 4001 } }));
  assert.equal(f.calls.length, 1);
});
