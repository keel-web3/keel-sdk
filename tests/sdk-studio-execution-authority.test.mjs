import assert from "node:assert/strict";
import test from "node:test";
import { describeKeelExecutionAuthority, parseKeelExecutionAuthority, KEEL_EXECUTION_ROUTES } from "../packages/sdk/dist/studio-execution-authority.js";
import { createKeelStudioAgentDraftClient } from "../packages/sdk/dist/studio-agent-drafts.js";
const releaseId = "11111111-1111-4111-8111-111111111111", operationId = "22222222-2222-4222-8222-222222222222";
const wallet = `0x${"33".repeat(20)}`, agent = `0x${"44".repeat(20)}`;
const identity = { route: "studio-release", releaseId, revision: 4, creatorAccount: wallet, requestedSigner: wallet };

test("owner review keeps every identity role separate and grants no authority", () => {
  const view = describeKeelExecutionAuthority(identity);
  assert.equal(view.identities.creatorAccount.address, wallet); assert.equal(view.identities.requestedSigner.address, wallet);
  for (const role of ["contractAuthority", "artworkCreator", "currentOwner", "recipient", "feePayer"]) assert.equal(view.identities[role].address, null);
  assert.equal(view.mode, "owner-review"); assert.equal(view.authorizesExecution, false); assert.equal(view.deployedAuthorityVerified, false);
  assert.equal(view.grantChanges, "not-performed"); assert.equal(view.options.find(option => option.mode === "delegated-agent").status, "unsupported");
  assert.equal(view.options.find(option => option.mode === "agent-owned").status, "separate-account-required");
  assert.throws(() => describeKeelExecutionAuthority({ ...identity, requestedSigner: agent }), /different signing account/u);
  assert.throws(() => describeKeelExecutionAuthority({ ...identity, privateKey: "must-not-enter-review" }), /identity context only/u);
  assert.throws(() => describeKeelExecutionAuthority({ ...identity, mode: "delegated-agent" }), /identity context only/u);
});

test("source delegation primitives remain configuration-required and never imply token spending limits", () => {
  const direct = describeKeelExecutionAuthority({ ...identity, route: "creator-factory-direct" });
  assert.match(direct.options[1].explanation, /msg.sender/u);
  const authorized = describeKeelExecutionAuthority({ ...identity, route: "factory-authorized-agent" });
  assert.equal(authorized.routeStatus, "authorization-preparation-implemented"); assert.equal(authorized.preparationTool, "wallet-link");
  assert.equal(authorized.options[1].status, "owner-authorization-required"); assert.equal(authorized.authorizesExecution, false);
  assert.match(authorized.options[1].explanation, /chainReady=false/u);
  for (const route of ["publication-job", "authority-delegate", "manager-automation"]) {
    const value = describeKeelExecutionAuthority({ ...identity, route });
    assert.equal(value.routeStatus, "source-primitive-only"); assert.equal(value.options[0].status, "configuration-required");
    assert.equal(value.options[1].status, "configuration-required"); assert.equal(value.authorizesExecution, false);
  }
  assert.match(KEEL_EXECUTION_ROUTES["authority-delegate"].reason, /not an ERC-20 or NFT spending limit/u);
  assert.match(KEEL_EXECUTION_ROUTES["manager-automation"].reason, /do not bound ERC-20 or NFT transfers/u);
  assert.throws(() => { KEEL_EXECUTION_ROUTES["studio-release"].delegated = "available"; }, TypeError);
});

test("execution explanation is bound to the same revision, operation, wallet and fixed source links", () => {
  const input = describeKeelExecutionAuthority({ ...identity, operationId });
  const expected = { releaseId, revision: 4, operationId, wallet };
  const parsed = parseKeelExecutionAuthority({ ...input, sourceUrl: "https://untrusted.example" }, expected);
  assert.match(parsed.sourceUrl, /^https:\/\/github.com\/Ravonus\/keel-contracts\/blob\//u);
  for (const changed of [{ revision: 5 }, { operationId: releaseId }, { wallet: agent }]) assert.throws(() => parseKeelExecutionAuthority(input, { ...expected, ...changed }));
  assert.throws(() => parseKeelExecutionAuthority({ ...input, grantChanges: "performed" }, expected));
  assert.throws(() => parseKeelExecutionAuthority({ ...input, deployedAuthorityVerified: true }, expected));
});

test("SDK shared plan consumes the same explanation and rejects a stale binding without additional requests", async () => {
  let requests = 0, bad = false;
  const client = createKeelStudioAgentDraftClient({ studioUrl: "https://studio.example", grantToken: "x".repeat(48), fetchImplementation: async () => {
    requests++; return Response.json({ schema: "keel-release-planning@1", releaseId, revision: 4, signing: "not-performed", submission: "not-performed", execution: describeKeelExecutionAuthority({ ...identity, revision: bad ? 3 : 4 }) });
  } });
  const plan = await client.plan(releaseId); assert.equal(plan.execution.identities.requestedSigner.address, wallet); assert.equal(plan.execution.authorizesExecution, false);
  bad = true; await assert.rejects(client.plan(releaseId), /another review/u); assert.equal(requests, 2);
});
