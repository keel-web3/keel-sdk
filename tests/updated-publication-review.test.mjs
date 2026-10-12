import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi } from "viem";
import {
  buildKeelPublicationJobManifest,
  createKeelUpdatedPublicationReviewCandidate as create,
  assertKeelUpdatedPublicationReviewCandidate as verify,
  classifyKeelUpdatedPublicationReviewPromotion as promote,
  keelUpdatedPublicationReviewDigest as reviewDigest,
  keelUpdatedPublicationFundingCallDigest as fundingDigest,
  keelUpdatedPublicationOutputDigest as outputDigest,
} from "../packages/sdk/dist/managed-publication.js";

const hash = n => `0x${n.toString(16).padStart(2, "0").repeat(32)}`;
const owner = `0x${"11".repeat(20)}`, executor = `0x${"22".repeat(20)}`;
const publicationJob = `0x${"33".repeat(20)}`, storeAddress = `0x${"44".repeat(20)}`;
const fundingIdentity = { chainId: 11155111, owner, executor, publicationJob, runtimeCodeHash: hash(4) };
const block = { number: "11894657", hash: hash(1), timestamp: "1791757080" };
const now = "1791757085";
const carrierBatches = [["0x001234", "0xabcd"]], operations = [{ target: storeAddress, value: "0", data: "0x001122" }];
function plan(deadline, values = {}) {
  return buildKeelPublicationJobManifest({ owner, executor, carrierBatches, operations: operations.map(item => ({ ...item, value: BigInt(item.value) })), deadline: BigInt(deadline), ...values }).planDigest;
}
const openAbi = parseAbi(["function openJob(bytes32,address,uint64,bytes32[],bytes32[],address[]) payable returns(uint256)"]);
function fundingCall(deadline, planDigest = plan(deadline), identity = fundingIdentity) {
  const manifest = buildKeelPublicationJobManifest({ owner: identity.owner, executor: identity.executor, carrierBatches, operations: operations.map(item => ({ ...item, value: BigInt(item.value) })), deadline: BigInt(deadline) });
  return { chainId: identity.chainId, from: identity.owner, to: identity.publicationJob, value: "12345", data: encodeFunctionData({ abi: openAbi, functionName: "openJob",
    args: [planDigest, identity.executor, BigInt(deadline), manifest.chunkDigests, manifest.operationDigests, manifest.allowedTargets] }) };
}
function input() {
  // Observed Retro dates and archive occurrences, with synthetic identities and
  // calldata. This is no claim about the real project's missing wallet history.
  return {
    id: "candidate-1", artifact: { id: "original-artifact", revision: 2, manifestDigest: hash(2) }, release: { id: "original-release", revision: 7 },
    snapshotDigest: hash(3), owner, executor, publicationJob, storeAddress, publicationJobRuntimeCodeHash: hash(4), chainId: 11155111,
    canonicalBlock: { ...block }, originalPlanDigest: plan("1791673827"), originalDeadline: "1791673827", deadline: "1791843480",
    carrierBatches: structuredClone(carrierBatches), operations: structuredClone(operations), publicationsDigest: hash(5), expectedTokenURIHash: hash(6),
    history: [
      { journalDigest: hash(7), planDigest: plan("1791673827"), deadline: "1791673827", issuance: "unknown", fundingCallDigest: fundingDigest(fundingCall("1791673827")), occurrences: [{ planId: "preview", path: "managedPublication" }] },
      { journalDigest: hash(8), planDigest: plan("1791496029"), deadline: "1791496029", issuance: "unknown", fundingCallDigest: fundingDigest(fundingCall("1791496029")), occurrences: ["preview", "artwork", "manifest"].map(planId => ({ planId, path: "managedPublicationHistory[0]" })) },
      { journalDigest: hash(9), planDigest: plan("1791597208"), deadline: "1791597208", issuance: "unknown", fundingCallDigest: fundingDigest(fundingCall("1791597208")), occurrences: [{ planId: "preview", path: "managedPublicationHistory[1]" }] },
    ].map(item => ({ ...item, fundingIdentity: { ...fundingIdentity } })),
  };
}
function evidence(candidate = create(input())) {
  const feeFields = { fundingValueWei: "12345", fundingTransactionGasLimit: "400000", maxFeePerGas: "1000000", maxPriorityFeePerGas: "1000" };
  const simulation = { status: "verified", candidateDigest: candidate.candidateDigest, planDigest: candidate.planDigest, programDigest: hash(20),
    block: { ...block }, verifiedAt: "1791757084", expiresAt: "1791757200", fullProgram: true, allCallsSucceeded: true, completeMetadata: true,
    expectedTokenURIHash: candidate.expectedTokenURIHash, returnedTokenURIHash: candidate.expectedTokenURIHash, ...feeFields };
  const fees = { candidateDigest: candidate.candidateDigest, programDigest: simulation.programDigest, block: { ...block }, verifiedAt: simulation.verifiedAt, expiresAt: simulation.expiresAt, ...feeFields };
  const reconciliation = { status: "complete-no-funded-history", candidateDigest: candidate.candidateDigest, historyDigest: candidate.historyDigest, block: { ...block },
    deploymentBlock: "11000000", deploymentVerified: true, coverage: "deployment-through-canonical-pin", canonicalReceiptsVerified: true,
    pendingTransactions: "none-known-after-reconciliation", historyEvidenceDigest: hash(21), journals: candidate.history.map(item => ({ journalDigest: item.journalDigest,
      planDigest: item.planDigest, deadline: item.deadline, fundingCallDigest: item.fundingCallDigest, fundingCall: fundingCall(item.deadline, item.planDigest, item.fundingIdentity), publicationJob, runtimeCodeHash: candidate.publicationJobRuntimeCodeHash,
      immutableRuntime: true, deadlineRule: "openJob-deadline-lte-timestamp@1", runtimeEvidenceDigest: hash(22) })) };
  const value = { candidate, currentSnapshotDigest: candidate.snapshotDigest, lifecycle: "prepared", canonicalBlock: { ...block }, candidateCanonicalBlock: { ...block }, now, simulation, fees, reconciliation };
  return { ...value, choice: { candidateDigest: candidate.candidateDigest, reviewDigest: reviewDigest({ candidateDigest: candidate.candidateDigest, simulation, fees, reconciliation }), owner, chosenAt: now, action: "use-this-updated-review" } };
}
function choose(value) {
  return { ...value, choice: { ...value.choice, reviewDigest: reviewDigest({ candidateDigest: value.candidate.candidateDigest, simulation: value.simulation, fees: value.fees, reconciliation: value.reconciliation }) } };
}
function automatic(value = evidence()) {
  const { choice, ...rest } = value;
  return { ...rest, automaticRenewal: {
    schema: "keel-automatic-expiry-renewal@1", candidateDigest: value.candidate.candidateDigest,
    reviewDigest: reviewDigest({ candidateDigest: value.candidate.candidateDigest, simulation: value.simulation, fees: value.fees, reconciliation: value.reconciliation }),
    sourceSnapshotDigest: value.candidate.snapshotDigest, originalPlanDigest: value.candidate.originalPlanDigest,
    originalOutputDigest: outputDigest(value.candidate), refreshedOutputDigest: outputDigest(value.candidate),
  } };
}
function blocked(value, reason) {
  const result = promote(value); assert.equal(result.status, "blocked"); assert.equal(result.walletApprovalRequired, false);
  if (reason) assert.equal(result.reason, reason); assert.equal(result.approval, undefined); return result;
}

test("Retro 2/1/1 archives produce a separate deeply immutable unsigned candidate without changing unknown provenance", () => {
  const original = input(), before = structuredClone(original), candidate = create(original);
  assert.deepEqual(original, before); assert.deepEqual(candidate.history, original.history);
  assert.deepEqual(candidate.history.map(item => item.occurrences.length), [1, 3, 1]);
  assert.deepEqual(candidate.history.map(item => item.issuance), ["unknown", "unknown", "unknown"]);
  assert.deepEqual(candidate.carrierBatches, original.carrierBatches); assert.deepEqual(candidate.operations, original.operations);
  assert.equal(candidate.planDigest, plan(candidate.deadline)); assert.notEqual(candidate.planDigest, candidate.originalPlanDigest);
  assert.deepEqual(candidate.artifact, original.artifact); assert.deepEqual(candidate.release, original.release);
  for (const value of [candidate, candidate.history, candidate.history[1], candidate.history[1].occurrences, candidate.carrierBatches[0], candidate.operations[0]]) assert.equal(Object.isFrozen(value), true);
  for (const key of ["approval", "walletAttempt", "ownerObservation", "approvalBoundary"]) assert.equal(candidate[key], undefined);
  assert.equal(candidate.walletApprovalRequired, false); assert.equal(candidate.approvalReady, false);
  assert.throws(() => { candidate.history[1].occurrences.pop(); }, TypeError);
  blocked({ ...evidence(candidate), reconciliation: { status: "unknown" } }, "historical-funding-unknown");
});

test("candidate preparation tolerates missing original request/runtime evidence; promotion cannot", () => {
  const original = input(); delete original.publicationJobRuntimeCodeHash; delete original.history[1].fundingCallDigest;
  const candidate = create(original); verify(candidate);
  blocked(evidence(candidate), "prior-funding-call-not-proven-expired");
});

test("constructor rederives exact original manifest, rejects silent byte/group/value or expiry changes", () => {
  for (const alter of [value => { value.carrierBatches[0][0] = "0xffff"; }, value => { value.carrierBatches.reverse(); value.carrierBatches[0].reverse(); },
    value => { value.operations[0].value = "1"; }, value => { value.operations[0].data = "0x"; }, value => { value.originalDeadline = "1791673828"; },
    value => { value.originalPlanDigest = hash(99); }, value => { value.originalDeadline = String(BigInt(block.timestamp) + 1n); },
    value => { value.deadline = String(BigInt(block.timestamp) + 300n); }, value => { value.deadline = String(BigInt(block.timestamp) + 86401n); }]) {
    const value = input(); alter(value); assert.throws(() => create(value));
  }
});

test("reload and idempotent retry preserve identity; altered archive occurrences or extra approval data fail verification", () => {
  const candidate = create(input()), reloaded = JSON.parse(JSON.stringify(candidate)); verify(reloaded);
  assert.deepEqual(create(reloaded), candidate); assert.equal(create(input()).candidateDigest, candidate.candidateDigest);
  for (const alter of [value => { value.history[2].occurrences.push({ planId: "manifest", path: "managedPublicationHistory[1]" }); },
    value => { value.history[0].issuance = "never-issued"; }, value => { value.release.revision++; },
    value => { value.approval = { to: publicationJob, value: "1" }; }, value => { value.walletApprovalRequired = true; }]) {
    const modified = JSON.parse(JSON.stringify(candidate)); alter(modified); assert.throws(() => verify(modified)); blocked({ ...evidence(), candidate: modified }, "candidate-invalid");
  }
});

test("unknown historical issuance can reach the normal boundary only with full explicit expiry/history proof and exact review", () => {
  const value = evidence(), before = structuredClone(value), result = promote(value);
  assert.equal(result.status, "ready-for-normal-approval-boundary"); assert.equal(result.approvalReady, false); assert.equal(result.walletApprovalRequired, false);
  assert.equal(result.approval, undefined); assert.deepEqual(value, before);
  assert.deepEqual(value.candidate.history.map(item => item.issuance), ["unknown", "unknown", "unknown"]);
});

test("funded jobs are preserved, including already-recorded funded identities, without a replacement payment", () => {
  assert.deepEqual(promote({ ...evidence(), reconciliation: { status: "funded", jobId: "10" } }), { status: "preserve-funded-job", jobId: "10", walletApprovalRequired: false });
  const value = input(); value.history[2].knownJobId = "10";
  assert.equal(promote(evidence(create(value))).status, "preserve-funded-job");
  blocked({ ...evidence(), reconciliation: { status: "funded" } }, "historical-funding-unknown");
});

test("pending/unknown transaction results, missing history pages and getter-only evidence remain non-signable", () => {
  for (const status of ["pending", "unknown"]) blocked({ ...evidence(), reconciliation: { status } }, `historical-funding-${status}`);
  for (const patch of [{ coverage: "recent-jobs-only" }, { deploymentVerified: false }, { canonicalReceiptsVerified: false },
    { pendingTransactions: "same-latest-and-pending-nonce" }, { historyEvidenceDigest: undefined }, { journals: [] }, { deploymentBlock: "999999999" }]) {
    const value = evidence(); blocked(choose({ ...value, reconciliation: { ...value.reconciliation, ...patch } }), "historical-funding-coverage-incomplete");
  }
});

test("every historical identity requires exact funding bytes and matching immutable runtime expiry semantics", () => {
  for (const patch of [{ fundingCallDigest: hash(99) }, { runtimeCodeHash: hash(99) }, { immutableRuntime: false },
    { deadlineRule: "timestamp-guessed" }, { publicationJob: storeAddress }, { deadline: "1" }, { planDigest: hash(99) }, { journalDigest: hash(99) }]) {
    const value = evidence(); value.reconciliation.journals[1] = { ...value.reconciliation.journals[1], ...patch };
    blocked(choose(value), "prior-funding-call-not-proven-expired");
  }
  const original = input(); original.history[2].deadline = String(BigInt(block.timestamp) + 1n);
  blocked(evidence(create(original)), "prior-funding-call-not-proven-expired");
});

test("historical identity preserves a different original executor/owner without inferring the current plan identity", () => {
  const original = input(), history = original.history[1];
  history.fundingIdentity.owner = storeAddress;
  history.fundingIdentity.executor = publicationJob;
  history.planDigest = plan(history.deadline, { owner: storeAddress, executor: publicationJob });
  history.fundingCallDigest = fundingDigest(fundingCall(history.deadline, history.planDigest, history.fundingIdentity));
  const candidate = create(original), value = evidence(candidate);
  assert.equal(promote(value).status, "ready-for-normal-approval-boundary");
  assert.deepEqual(candidate.history[1].fundingIdentity, history.fundingIdentity);
  assert.equal(candidate.owner, owner); assert.equal(candidate.executor, executor);
  value.reconciliation.journals[1].fundingCall = fundingCall(history.deadline, history.planDigest);
  blocked(choose(value), "prior-funding-call-not-proven-expired");
  for (const patch of [undefined, { ...fundingIdentity, chainId: 1 }, { ...fundingIdentity, publicationJob: storeAddress }, { ...fundingIdentity, runtimeCodeHash: undefined }]) {
    const source = input(); source.history[1].fundingIdentity = patch;
    blocked(evidence(create(source)), "prior-funding-call-not-proven-expired");
  }
});

test("exact original funding envelope is required, not just a supplied digest or expired numeric deadline", () => {
  for (const patch of [{ data: "0x12345678" }, { data: "0x" }, { from: executor }, { to: storeAddress }, { chainId: 1 }, { value: "12346" }]) {
    const value = evidence(); Object.assign(value.reconciliation.journals[1].fundingCall, patch);
    blocked(choose(value), "prior-funding-call-not-proven-expired");
  }
  // Even a consistent caller-supplied digest cannot turn a wrong selector or
  // unbound owner/executor into proof of the exact old openJob program.
  for (const patch of [{ data: "0x12345678" }, { from: executor }, { to: storeAddress }, { chainId: 1 },
    { data: fundingCall("1791496030").data }, { data: fundingCall("1791496029", hash(99)).data },
    { data: fundingCall("1791496029", plan("1791496029"), { ...fundingIdentity, executor: owner }).data }]) {
    const source = input(), call = { ...fundingCall(source.history[1].deadline), ...patch };
    source.history[1].fundingCallDigest = fundingDigest(call);
    const value = evidence(create(source)); value.reconciliation.journals[1].fundingCall = call;
    blocked(choose(value), "prior-funding-call-not-proven-expired");
  }
});

test("reorg, changed snapshot, stale/future pin and expired candidate invalidate promotion", () => {
  blocked({ ...evidence(), currentSnapshotDigest: hash(90) }, "saved-snapshot-changed");
  blocked({ ...evidence(), candidateCanonicalBlock: { ...block, hash: hash(90) } }, "candidate-pin-reorganized");
  for (const canonicalBlock of [{ ...block, timestamp: String(BigInt(now) - 181n) }, { ...block, timestamp: String(BigInt(now) + 31n) }, { ...block, number: "1" }, { ...block, hash: hash(99) }])
    blocked({ ...evidence(), canonicalBlock }, "canonical-pin-or-candidate-expired");
  blocked({ ...evidence(), now: "1791843200", canonicalBlock: { number: "12000000", hash: hash(91), timestamp: "1791843200" } }, "canonical-pin-or-candidate-expired");
  const value = evidence(); value.reconciliation.block.hash = hash(90); blocked(choose(value), "historical-funding-coverage-incomplete");
});

test("full exact program, complete URI, fresh gas envelope and matching funding amount are mandatory", () => {
  blocked({ ...evidence(), simulation: undefined }, "complete-simulation-and-fees-required");
  for (const patch of [{ fullProgram: false }, { allCallsSucceeded: false }, { completeMetadata: false }, { returnedTokenURIHash: hash(99) },
    { candidateDigest: hash(99) }, { planDigest: hash(99) }, { expiresAt: now }, { verifiedAt: "1" }, { verifiedAt: "1791757110", expiresAt: "1791757100" }]) {
    const value = evidence(); blocked(choose({ ...value, simulation: { ...value.simulation, ...patch } }), "complete-simulation-stale-or-mismatched");
  }
  for (const patch of [{ fundingValueWei: "1" }, { fundingTransactionGasLimit: "0" }, { maxFeePerGas: "0" }, { maxPriorityFeePerGas: "9999999" }, { programDigest: hash(99) }, { expiresAt: now }]) {
    const value = evidence(); blocked(choose({ ...value, fees: { ...value.fees, ...patch } }), "fee-review-stale-or-mismatched");
  }
});

test("deployment consent, another candidate choice or an old quote cannot substitute for exact owner review", () => {
  blocked({ ...evidence(), choice: undefined }, "exact-owner-review-required");
  for (const patch of [{ action: "deploy-approved" }, { candidateDigest: hash(99) }, { reviewDigest: hash(99) }, { owner: executor }, { chosenAt: "1" }]) {
    const value = evidence(); blocked({ ...value, choice: { ...value.choice, ...patch } }, "exact-owner-review-required");
  }
  const value = evidence(); value.fees.fundingValueWei = "67890"; value.simulation.fundingValueWei = "67890";
  blocked(value, "exact-owner-review-required");
  assert.equal(promote(choose(value)).status, "ready-for-normal-approval-boundary");
});

test("cancel/reload and previously issued approval cannot reopen payment; pure checks retain original candidate", () => {
  for (const lifecycle of ["cancelled", "superseded"]) {
    const value = evidence(), before = JSON.stringify(value.candidate); blocked({ ...value, lifecycle }, `candidate-${lifecycle}`);
    assert.equal(JSON.stringify(value.candidate), before); blocked({ ...value, candidate: JSON.parse(before), lifecycle }, `candidate-${lifecycle}`);
  }
  assert.deepEqual(promote({ ...evidence(), lifecycle: "approval-issued" }), { status: "reconcile-existing-approval", walletApprovalRequired: false });
  blocked({ ...evidence(), lifecycle: "unknown" }, "candidate-lifecycle-unknown");
});

test("malformed or reordered identity/evidence is never promoted", () => {
  for (const patch of [{ snapshotDigest: "not-hex" }, { chainId: 0 }, { deadline: "01" }, { history: [] }, { canonicalBlock: { ...block, timestamp: "0" } }]) assert.throws(() => create({ ...input(), ...patch }));
  const original = input(); original.history[2].occurrences.push(original.history[1].occurrences[0]); assert.throws(() => create(original));
  const value = evidence(); value.reconciliation.journals.reverse(); blocked(choose(value), "prior-funding-call-not-proven-expired");
  blocked({ ...evidence(), reconciliation: undefined }, "historical-funding-unknown");
});

test("automatic unchanged expiry renewal retains unknown provenance and normal wallet approval", () => {
  const value = automatic(), before = structuredClone(value), result = promote(value);
  assert.equal(result.status, "ready-for-normal-approval-boundary");
  assert.equal(result.approvalReady, false); assert.equal(result.walletApprovalRequired, false);
  assert.equal(value.choice, undefined); assert.deepEqual(value, before);
  assert.ok(value.candidate.history.every(item => item.issuance === "unknown"));
});

test("automatic renewal binds source, candidate, original plan, complete output and fresh quote", () => {
  for (const key of ["candidateDigest", "reviewDigest", "sourceSnapshotDigest", "originalPlanDigest"]) {
    const value = automatic(); value.automaticRenewal[key] = hash(99);
    blocked(value, "automatic-renewal-binding-mismatch");
  }
  for (const key of ["originalOutputDigest", "refreshedOutputDigest"]) {
    const value = automatic(); value.automaticRenewal[key] = hash(99);
    blocked(value, "changed-output-review-required");
  }
  blocked({ ...automatic(), choice: evidence().choice }, "automatic-renewal-binding-mismatch");
  const value = evidence(); value.simulation.fundingValueWei = value.fees.fundingValueWei = "67890";
  assert.equal(promote(automatic(value)).status, "ready-for-normal-approval-boundary");
  const stale = automatic(); stale.fees.fundingValueWei = stale.simulation.fundingValueWei = "67890";
  blocked(stale, "automatic-renewal-binding-mismatch");
});

test("automatic renewal never bypasses paid, pending, unknown, stale or incomplete validation", () => {
  assert.equal(promote(automatic({ ...evidence(), reconciliation: { status: "funded", jobId: "10" } })).status, "preserve-funded-job");
  for (const status of ["pending", "unknown"]) blocked(automatic({ ...evidence(), reconciliation: { status } }), `historical-funding-${status}`);
  blocked({ ...automatic(), currentSnapshotDigest: hash(99) }, "saved-snapshot-changed");
  blocked({ ...automatic(), simulation: undefined }, "complete-simulation-and-fees-required");
  const stale = automatic(); stale.simulation.expiresAt = now;
  blocked(stale, "complete-simulation-stale-or-mismatched");
});

test("material output digest includes storage bytes, targets, values, revisions and the whole URI hash", () => {
  const original = input(), expected = outputDigest(original);
  assert.equal(outputDigest({ ...original, deadline: "9999999999", canonicalBlock: { ...block, number: "1" } }), expected);
  for (const change of [x => x.carrierBatches[0].reverse(), x => x.operations[0].target = owner,
    x => x.operations[0].value = "1", x => x.operations[0].data = "0xff", x => x.artifact.revision++,
    x => x.release.revision++, x => x.publicationsDigest = hash(99), x => x.expectedTokenURIHash = hash(99)]) {
    const value = structuredClone(original); change(value); assert.notEqual(outputDigest(value), expected);
  }
});
