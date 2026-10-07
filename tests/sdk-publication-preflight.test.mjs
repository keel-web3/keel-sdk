import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeFunctionData, parseAbi, keccak256 } from "viem";
import { simulateKeelPublicationBeforeFunding, simulateKeelStorageBeforeFunding, assertKeelFundingPreflight, keelFundingApprovalDigest } from "../packages/sdk/dist/publication-preflight.js";

const reader = `0x${"11".repeat(20)}`, owner = `0x${"22".repeat(20)}`;
const block = { number: "0x12", hash: `0x${"aa".repeat(32)}`, gasLimit: "0x1000000" };
const expected = "data:application/json,{\"name\":\"Exact work\"}";
const call = { from: owner, to: reader, data: "0x1234", value: "0x0", gas: "0xf4240", maxFeePerGas: "0x1000000", maxPriorityFeePerGas: "0xf4240" };
const input = () => ({ planFingerprint: `0x${"bb".repeat(32)}`, chainId: 11155111, reader, readerRuntimeCodeHash: keccak256("0x6000"), preparationCalls: [call], metadataCall: call,
  expectedTokenURI: expected, maximumTokenUriBytes: 2_000_000, maximumReadGas: 1_000_000n, collectionOverheadGas: 10_000n, maximumTransactionGas: 16_000_000n });
function fixture(change = {}) {
  const requests = [];
  let blockReads = 0, simulationPass = 0;
  return { requests, transport: { request: async request => {
    requests.push(request);
    if (request.method === "eth_chainId") return change.chainId ?? "0xaa36a7";
    if (request.method === "eth_getBlockByNumber") { blockReads++; const current = { ...block, number: change.blockNumber ?? block.number, gasLimit: change.blockGas ?? block.gasLimit }; return blockReads > 1 && change.reorganized ? { ...current, hash: `0x${"cc".repeat(32)}` } : current; }
    if (request.method === "eth_getCode") return change.code ?? "0x6000";
    if (request.method === "eth_simulateV1") {
      if (change.error) throw change.error;
      simulationPass++;
      return request.params[0].blockStateCalls.map((_, index) => {
        const finalRead = simulationPass === 3 && index === request.params[0].blockStateCalls.length - 1;
        const gasUsed = finalRead ? change.readGas ?? change.gas ?? "0x186a0" : change.gas ?? "0x186a0";
        return { calls: [{ status: change.revert === index ? "0x0" : "0x1", ...(change.contradictoryError ? { error: { code: 3, message: "execution reverted SECRET" } } : {}), gasUsed,
          ...(change.omitMaximum ? {} : { maxUsedGas: finalRead ? gasUsed : change.maximumGas ?? gasUsed }),
          returnData: finalRead ? change.storage ? encodeAbiParameters([{ type: "bool" }], [change.exists ?? true]) : encodeAbiParameters([{ type: "string" }], [change.metadata ?? expected]) : "0x" }] };
      });
    }
    throw new Error(`Unexpected method ${request.method}`);
  } } };
}

test("pre-funding simulation uses exact ordered calls without signing or state overrides and verifies full bytes", async () => {
  const f = fixture(); const proof = await simulateKeelPublicationBeforeFunding(input(), f.transport);
  assert.equal(proof.state, "ephemeral-simulation"); assert.equal(proof.completeTokenUriBytes, new TextEncoder().encode(expected).length);
  assert.equal(proof.collectionReadGas, "110000"); assert.equal(proof.simulatedCalls, 2);
  const simulations = f.requests.filter(request => request.method === "eth_simulateV1");
  const { maxFeePerGas, maxPriorityFeePerGas, ...discovery } = call;
  const bounded = { ...call, gas: "0x19a28" };
  assert.deepEqual(simulations.map(request => request.params), [
    [{ blockStateCalls: [{ calls: [discovery] }], validation: false, traceTransfers: false, returnFullTransactions: false }, "0x12"],
    [{ blockStateCalls: [{ calls: [bounded] }], validation: true, traceTransfers: false, returnFullTransactions: false }, "0x12"],
    [{ blockStateCalls: [{ calls: [bounded] }, { calls: [call] }], validation: false, traceTransfers: false, returnFullTransactions: false }, "0x12"],
  ]);
  assert.equal(proof.validatedTransactionCalls, 1);
  assert.ok(f.requests.every(request => ["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_simulateV1"].includes(request.method)));
});

test("complete metadata oversize and invalid override-like fields fail before any RPC", async () => {
  const f = fixture();
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...input(), expectedTokenURI: "x".repeat(2_000_001) }, f.transport), error => error.kind === "metadata-size-limit");
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...input(), metadataCall: { ...call, stateOverride: {} } }, f.transport), error => error.kind === "configuration-invalid");
  assert.equal(f.requests.length, 0);
});

test("wrong chain, code, byte mismatch, revert, gas limit and reorg cannot produce a proof", async () => {
  for (const [change, kind] of [[{ chainId: "0x1" }, "wrong-chain"], [{ code: "0x6001" }, "reader-mismatch"], [{ metadata: expected + "x" }, "metadata-mismatch"], [{ revert: 0 }, "execution-reverted"], [{ gas: "0xf4240" }, "read-gas-limit"], [{ reorganized: true }, "chain-reorganized"]]) {
    await assert.rejects(simulateKeelPublicationBeforeFunding(input(), fixture(change).transport), error => error.kind === kind);
  }
});

test("unsupported and capped providers remain explicit unavailable evidence without secrets or automatic fallback", async () => {
  for (const [error, kind] of [[{ code: -38014, message: "Insufficient funds for gas * price + value private-secret" }, "insufficient-balance"], [{ code: -32601, message: "https://rpc/private-secret data=0xdead" }, "unsupported-simulation"], [{ message: "gas limit exceeds RPC gas cap; https://rpc/private-secret" }, "provider-limit"], [new Error("timeout https://rpc/private-secret Request body: 0x1234"), "rpc-unavailable"], [{ message: "gas limit exceeds RPC gas cap", cause: { code: 3, message: "execution reverted SECRET" } }, "execution-reverted"]]) {
    await assert.rejects(simulateKeelPublicationBeforeFunding(input(), fixture({ error }).transport), result => { assert.equal(result.kind, kind); assert.ok(!result.message.includes("private-secret")); assert.ok(!result.message.includes("0x1234")); return true; });
  }
});

test("proof fingerprint changes with the exact plan, calldata and complete metadata", async () => {
  const first = await simulateKeelPublicationBeforeFunding(input(), fixture().transport);
  const second = await simulateKeelPublicationBeforeFunding({ ...input(), preparationCalls: [{ ...call, data: "0x5678" }] }, fixture().transport);
  const third = await simulateKeelPublicationBeforeFunding({ ...input(), planFingerprint: `0x${"cc".repeat(32)}` }, fixture().transport);
  assert.notEqual(first.simulationFingerprint, second.simulationFingerprint); assert.notEqual(first.simulationFingerprint, third.simulationFingerprint);
});

test("the wallet-boundary guard rejects missing, expired or changed funding evidence", async () => {
  const proof = await simulateKeelPublicationBeforeFunding(input(), fixture().transport);
  const now = Date.parse("2026-10-07T04:00:00Z"), approval = { to: reader, data: "0x1234", value: "100" };
  const preflight = { ...proof, status: "verified", artifactId: "work", artifactRevision: 3, manifestDigest: `0x${"dd".repeat(32)}`,
    checkedAt: new Date(now).toISOString(), expiresAt: new Date(now + 120_000).toISOString(), approvalDigest: keelFundingApprovalDigest({ chainId: input().chainId, owner, approval }) };
  const preparation = { status: "approval-required", walletApprovalRequired: true, approval, preflight };
  const check = { preparation, chainId: input().chainId, owner, artifactId: "work", artifactRevision: 3, manifestDigest: preflight.manifestDigest, now };
  assert.equal(assertKeelFundingPreflight(check).planFingerprint, input().planFingerprint);
  assert.throws(() => assertKeelFundingPreflight({ ...check, preparation: { ...preparation, preflight: { status: "verified" } } }), /simulation/u);
  assert.throws(() => assertKeelFundingPreflight({ ...check, now: now + 120_000 }), /expired/u);
  assert.throws(() => assertKeelFundingPreflight({ ...check, artifactRevision: 4 }), /project/u);
  assert.throws(() => assertKeelFundingPreflight({ ...check, owner: reader }), /calldata or value/u);
  assert.throws(() => assertKeelFundingPreflight({ ...check, preparation: { ...preparation, approval: { ...approval, value: "101" } } }), /calldata or value/u);
});

test("explicit storage-only simulation verifies its predicted object without claiming collector metadata readiness", async () => {
  const objectId = `0x${"dd".repeat(32)}`;
  const data = encodeFunctionData({ abi: parseAbi(["function objectExists(bytes32 objectId) view returns (bool)"]), functionName: "objectExists", args: [objectId] });
  const { expectedTokenURI, maximumTokenUriBytes, collectionOverheadGas, ...base } = input();
  const planned = { ...base, expectedObjectId: objectId, metadataCall: { ...call, data } };
  const proof = await simulateKeelStorageBeforeFunding(planned, fixture({ storage: true }).transport);
  assert.equal(proof.verification, "storage-only"); assert.equal(proof.collectorMetadataVerified, false); assert.equal(proof.manifestObjectId, objectId);
  assert.equal(proof.completeTokenUriBytes, undefined); assert.equal(proof.metadataDigest, undefined);
  await assert.rejects(simulateKeelStorageBeforeFunding({ ...planned, observationCalls: [call] }, fixture({ storage: true }).transport), error => error.kind === "configuration-invalid");
  await assert.rejects(simulateKeelStorageBeforeFunding({ ...planned, metadataTarget: owner, metadataCall: { ...planned.metadataCall, to: owner } }, fixture({ storage: true }).transport), error => error.kind === "configuration-invalid");
  await assert.rejects(simulateKeelStorageBeforeFunding(planned, fixture({ storage: true, exists: false }).transport), error => error.kind === "storage-mismatch");
  await assert.rejects(simulateKeelStorageBeforeFunding({ ...planned, metadataCall: call }, fixture({ storage: true }).transport), error => error.kind === "configuration-invalid");
});

test("public metadata read gas is independent of the transaction cap while every planned transaction stays validated", async () => {
  const f = fixture({ blockGas: "0x3938700", readGas: "0x1a6dc1c" });
  const proof = await simulateKeelPublicationBeforeFunding({ ...input(), maximumReadGas: 60_000_000n, metadataCall: { ...call, gas: "0x3938700" } }, f.transport);
  assert.equal(proof.assemblyReadGas, "27712540");
  assert.equal(proof.validatedTransactionCalls, 1);
  assert.equal(f.requests.filter(request => request.method === "eth_simulateV1")[1].params[0].validation, true);
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...input(), preparationCalls: [{ ...call, gas: "0x3938700" }] }, fixture().transport), error => error.kind === "configuration-invalid");
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...input(), blockNumber: -1n }, fixture().transport), error => error.kind === "configuration-invalid");
});

test("ephemeral mint context is excluded from validated wallet transactions and bound to the exact collection target", async () => {
  const collection = `0x${"55".repeat(20)}`;
  const contextCall = { ...call, from: reader, to: collection, data: "0x5678" };
  const planned = { ...input(), metadataTarget: collection, observationCalls: [contextCall], metadataCall: { ...call, to: collection } };
  const f = fixture(); const proof = await simulateKeelPublicationBeforeFunding(planned, f.transport);
  const simulations = f.requests.filter(request => request.method === "eth_simulateV1");
  assert.equal(simulations[0].params[0].blockStateCalls.length, 1);
  assert.deepEqual(simulations[2].params[0].blockStateCalls[1].calls, [contextCall]);
  assert.equal(proof.metadataTarget, collection); assert.equal(proof.ephemeralContextCalls, 1); assert.equal(proof.mintEligibilityVerified, false);
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...planned, metadataTarget: reader }, fixture().transport), error => error.kind === "configuration-invalid");
});

test("a provider cannot substitute the pinned block or contradict success with an execution error", async () => {
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...input(), blockNumber: 18n }, fixture({ blockNumber: "0x13" }).transport), error => error.kind === "rpc-unavailable" && /another block/.test(error.message));
  await assert.rejects(simulateKeelPublicationBeforeFunding(input(), fixture({ contradictoryError: true }).transport), error => error.kind === "rpc-unavailable" && !error.message.includes("SECRET"));
});

test("transaction validation cannot rely on zero-fee RPC defaults or a malformed mixed fee envelope", async () => {
  const { maxFeePerGas, maxPriorityFeePerGas, ...missing } = call;
  const f = fixture();
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...input(), preparationCalls: [missing] }, f.transport), error => error.kind === "configuration-invalid");
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...input(), preparationCalls: [{ ...call, gasPrice: "0x1" }] }, f.transport), error => error.kind === "configuration-invalid");
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...input(), preparationCalls: [{ ...call, maxFeePerGas: "0x1" }] }, f.transport), error => error.kind === "configuration-invalid");
  assert.equal(f.requests.length, 0);
});


test("validated gas envelopes use pre-refund maximum gas and reject absent or contradictory evidence", async () => {
  const f = fixture({ gas: "0x186a0", maximumGas: "0x1e848" });
  const proof = await simulateKeelPublicationBeforeFunding(input(), f.transport);
  assert.deepEqual(proof.transactionGasLimits, ["131250"]);
  assert.equal(proof.gasMeasurement, "pre-refund-max-used");
  const validated = f.requests.find(request => request.method === "eth_simulateV1" && request.params[0].validation);
  assert.equal(BigInt(validated.params[0].blockStateCalls[0].calls[0].gas), 131250n);
  await assert.rejects(simulateKeelPublicationBeforeFunding(input(), fixture({ omitMaximum: true }).transport), error => error.kind === "unsupported-simulation");
  for (const maximumGas of ["0x1869f", "0xf4241", "invalid"]) await assert.rejects(simulateKeelPublicationBeforeFunding(input(), fixture({ maximumGas }).transport), error => error.kind === "rpc-unavailable");
});
