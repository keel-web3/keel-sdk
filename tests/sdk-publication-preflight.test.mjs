import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeFunctionData, parseAbi, keccak256 } from "viem";
import { simulateKeelPublicationBeforeFunding, simulateKeelStorageBeforeFunding, assertKeelFundingPreflight, keelFundingApprovalDigest } from "../packages/sdk/dist/publication-preflight.js";

const reader = `0x${"11".repeat(20)}`, owner = `0x${"22".repeat(20)}`;
const block = { number: "0x12", hash: `0x${"aa".repeat(32)}`, timestamp: "0x68f00000", gasLimit: "0x1000000" };
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
    if (request.method === "eth_getBlockByNumber") { blockReads++; const current = { ...block, number: change.blockNumber ?? block.number, gasLimit: change.blockGas ?? block.gasLimit, timestamp: change.omitTimestamp ? undefined : change.timestamp ?? block.timestamp }; return blockReads > 1 && change.reorganized ? { ...current, hash: `0x${"cc".repeat(32)}` } : current; }
    if (request.method === "eth_getCode") return change.code ?? "0x6000";
    if (request.method === "eth_simulateV1") {
      if (change.error) throw change.error;
      simulationPass++;
      return request.params[0].blockStateCalls.map((_, index) => {
        const finalRead = simulationPass === 3 && index === request.params[0].blockStateCalls.length - 1;
        const gasUsed = finalRead ? change.readGas ?? change.gas ?? "0x186a0" : change.gas ?? "0x186a0";
        return { ...(!change.omitForkHeader ? { timestamp: `0x${(BigInt(change.timestamp ?? block.timestamp) + BigInt(index + 1)).toString(16)}`, number: `0x${(BigInt(change.blockNumber ?? block.number) + BigInt(index + 1)).toString(16)}`, slotNumber: `0x${(index + 1).toString(16)}`, blockAccessListHash: block.hash,
          hash: `0x${(index + 1).toString(16).padStart(64, "0")}`, parentHash: index === 0 ? block.hash : `0x${index.toString(16).padStart(64, "0")}` } : {}), calls: [{ status: change.revert === index || (change.strictRevert && request.params[0].validation) ? "0x0" : "0x1", ...(change.contradictoryError ? { error: { code: 3, message: "execution reverted SECRET" } } : {}), gasUsed,
          ...(change.omitMaximum ? {} : { maxUsedGas: finalRead ? gasUsed : change.maximumGas ?? gasUsed }),
          returnData: simulationPass === 3 && change.readerReturns && index > 0 && !finalRead ? change.readerReturns[index - 1] : finalRead ? change.storage ? encodeAbiParameters([{ type: "bool" }], [change.exists ?? true]) : encodeAbiParameters([{ type: "string" }], [change.metadata ?? expected]) : "0x" }] };
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
    [{ blockStateCalls: [{ calls: [bounded] }, { calls: [{ ...call, gas: "0xf1b30" }] }], validation: false, traceTransfers: false, returnFullTransactions: false }, "0x12"],
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
  for (const [change, kind] of [[{ chainId: "0x1" }, "wrong-chain"], [{ code: "0x6001" }, "reader-mismatch"], [{ metadata: expected + "x" }, "metadata-mismatch"], [{ revert: 0 }, "execution-reverted"], [{ gas: "0xf4240" }, "rpc-unavailable"], [{ reorganized: true }, "chain-reorganized"]]) {
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
  assert.throws(() => assertKeelFundingPreflight({ ...check, preparation: { ...preparation, preflight: { ...preflight, readPolicy: undefined } } }), /simulation/u);
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


test("required standalone reader gates are bounded, byte-verified and included in proof identity", async () => {
  const returned = encodeAbiParameters([{ type: "string" }], ["standalone exact envelope"]);
  const check = { call: { ...call, data: "0xbbbb" }, expectedReturn: returned, gasMargin: 10_000n };
  const planned = { ...input(), requiredReaderCalls: [check] };
  const f = fixture({ readerReturns: [returned] });
  const proof = await simulateKeelPublicationBeforeFunding(planned, f.transport);
  assert.equal(proof.requiredReaderChecks, 1);
  assert.equal(proof.readPolicy, "keel-inline-read-policy@1");
  assert.equal(proof.abiReturnBytes, (encodeAbiParameters([{ type: "string" }], [expected]).length - 2) / 2);
  assert.equal(proof.validatedTransactionCalls, 1);
  assert.equal(proof.simulatedCalls, 3);
  const baseline = await simulateKeelPublicationBeforeFunding(input(), fixture().transport);
  assert.notEqual(proof.simulationFingerprint, baseline.simulationFingerprint);
  await assert.rejects(simulateKeelPublicationBeforeFunding(planned, fixture({ readerReturns: ["0x"] }).transport), error => error.kind === "metadata-mismatch");
  await assert.rejects(simulateKeelPublicationBeforeFunding(planned, fixture({ readerReturns: [returned], revert: 1 }).transport), error => error.kind === "execution-reverted");
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...planned, requiredReaderCalls: [{ ...check, gasMargin: 999_999n }] }, fixture({ readerReturns: [returned] }).transport), error => error.kind === "rpc-unavailable");
  for (const bad of [{ ...check, call: { ...call, to: owner } }, { ...check, call: { ...call, value: "0x1" } }, { ...check, gasMargin: -1n }, { ...check, call: { ...call, gas: "0xf4241" } }]) {
    const blocked = fixture();
    await assert.rejects(simulateKeelPublicationBeforeFunding({ ...input(), requiredReaderCalls: [bad] }, blocked.transport), error => error.kind === "configuration-invalid");
    assert.equal(blocked.requests.length, 0);
  }
});

test("read replay retries only an explicit smaller provider ceiling and records it without changing transactions", async () => {
  const f = fixture(); const attempts = [];
  const transport = { request: async request => {
    if (request.method === "eth_simulateV1" && request.params[0].blockStateCalls.length > 1) {
      attempts.push(request.params[0].blockStateCalls);
      if (BigInt(request.params[0].blockStateCalls.at(-1).calls[0].gas) > 500_000n) throw new Error("gas limit too high: cap: 500000");
    }
    return f.transport.request(request);
  } };
  const proof = await simulateKeelPublicationBeforeFunding(input(), transport);
  assert.equal(proof.requestedReadGasLimit, "1000000");
  assert.equal(proof.effectiveReadGasLimit, "500000");
  assert.deepEqual(proof.readBoundaryAttempts, [{ requestedGas: "1000000", providerGasCap: "500000" }]);
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0][0], attempts[1][0]);
  assert.equal(attempts[1].at(-1).calls[0].gas, "0x77a10");
  assert.equal(proof.submission, "not-performed");
});

test("callers cannot raise shared Inline gas/output ceilings to manufacture preflight success", async () => {
  for (const plan of [{ ...input(), maximumReadGas: 60_000_001n }, { ...input(), maximumTokenUriBytes: 2_000_001 }]) {
    const f = fixture();
    await assert.rejects(simulateKeelPublicationBeforeFunding(plan, f.transport), error => error.kind === "configuration-invalid");
    assert.equal(f.requests.length, 0);
  }
});


test("asynchronous caller mutation cannot raise snapshotted read limits or output policy", async () => {
  const planned = input();
  const f = fixture({ readGas: "0xf4240" });
  const transport = { request: request => { planned.maximumReadGas = 100_000_000n; planned.maximumTokenUriBytes = 99_000_000; return f.transport.request(request); } };
  await assert.rejects(simulateKeelPublicationBeforeFunding(planned, transport), error => error.kind === "rpc-unavailable");
});


test("nested execution must actually succeed with its margin reserved, not merely report low consumed gas", async () => {
  const returned = encodeAbiParameters([{ type: "string" }], ["nested envelope"]);
  const plan = { ...input(), requiredReaderCalls: [{ call: { ...call, data: "0xbbbb" }, expectedReturn: returned, gasMargin: 200_000n }] };
  const f = fixture({ readerReturns: [returned] });
  const requested = [];
  const transport = { request: async request => {
    if (request.method === "eth_simulateV1" && request.params[0].blockStateCalls.length === 3) {
      const nested = request.params[0].blockStateCalls[1].calls[0]; requested.push(BigInt(nested.gas));
      // EIP-150-style minimum envelope is 900K despite low eventual consumption.
      if (BigInt(nested.gas) < 900_000n) throw new Error("out of gas");
    }
    return f.transport.request(request);
  } };
  await assert.rejects(simulateKeelPublicationBeforeFunding(plan, transport), error => error.kind === "execution-reverted");
  assert.deepEqual(requested, [800_000n]);
});


test("reserved reader allowance honors smaller per-call gas and rejects impossible margins before RPC", async () => {
  const returned = encodeAbiParameters([{ type: "string" }], ["smaller call"]);
  const f = fixture({ readerReturns: [returned] });
  const proof = await simulateKeelPublicationBeforeFunding({ ...input(), requiredReaderCalls: [{ call: { ...call, gas: "0x7a120" }, expectedReturn: returned, gasMargin: 100_000n }] }, f.transport);
  assert.equal(proof.requiredReaderProofs[0].gasLimit, "400000");
  assert.equal(proof.requiredReaderProofs[0].gasMargin, "100000");
  const blocked = fixture();
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...input(), collectionOverheadGas: 1_000_000n }, blocked.transport), error => error.kind === "read-gas-limit");
  assert.equal(blocked.requests.length, 0);
});

test("provider-cap retries reserve the standalone margin again at the reduced ceiling", async () => {
  const returned = encodeAbiParameters([{ type: "string" }], ["retry envelope"]);
  const plan = { ...input(), requiredReaderCalls: [{ call, expectedReturn: returned, gasMargin: 200_000n }] };
  const f = fixture({ readerReturns: [returned] }); const budgets = [];
  const transport = { request: request => {
    if (request.method === "eth_simulateV1" && request.params[0].blockStateCalls.length === 3) {
      budgets.push(BigInt(request.params[0].blockStateCalls[1].calls[0].gas));
      if (budgets.length === 1) throw new Error("gas limit too high cap: 500000");
    }
    return f.transport.request(request);
  } };
  const proof = await simulateKeelPublicationBeforeFunding(plan, transport);
  assert.deepEqual(budgets, [800_000n, 300_000n]);
  assert.equal(proof.requiredReaderProofs[0].gasLimit, "300000");
  assert.equal(proof.effectiveReadGasLimit, "500000");
});


test("Amsterdam accepts high aggregate only through bounded strict fork validation and fingerprints its policy", async () => {
  const funded = { ...input(), maximumTransactionGas: 150_000_000n, preparationCalls: [{ ...call, gas: "0x8f0d180" }] };
  const f = fixture({ timestamp: "0x6ac51fe0", blockGas: "0xbebc200", gas: "0x52b9ba7", readGas: "0x186a0" });
  const proof = await simulateKeelPublicationBeforeFunding(funded, f.transport);
  assert.equal(proof.transactionGasPolicy.profile, "sepolia-amsterdam");
  assert.equal(proof.transactionGasPolicy.maximumExecutionGas, "16777216");
  assert.ok(BigInt(proof.transactionGasLimits[0]) > 16_777_216n);
  const strict = f.requests.find(r => r.method === "eth_simulateV1" && r.params[0].validation);
  assert.equal(BigInt(strict.params[0].blockStateCalls[0].calls[0].gas), BigInt(proof.transactionGasLimits[0]));
  await assert.rejects(simulateKeelPublicationBeforeFunding(funded, fixture({blockGas:"0xbebc200"}).transport), error=>error.kind==="configuration-invalid");
});

test("Amsterdam simulation without linked current-fork block headers cannot issue funding proof", async () => {
 await assert.rejects(simulateKeelPublicationBeforeFunding(input(),fixture({timestamp:"0x6ac51fe0",omitForkHeader:true}).transport),error=>error.kind==="unsupported-simulation");
});

test("Amsterdam discovery success cannot bypass strict execution-dimension rejection", async () => {
 const f=fixture({timestamp:"0x6ac51fe0",strictRevert:true});
 await assert.rejects(simulateKeelPublicationBeforeFunding(input(),f.transport),error=>error.kind==="execution-reverted");
 assert.ok(f.requests.some(r=>r.method==="eth_simulateV1"&&r.params[0].validation));
});
test("missing selected-block timestamp fails before any simulation", async () => {
 const f=fixture({omitTimestamp:true});
 await assert.rejects(simulateKeelPublicationBeforeFunding(input(),f.transport),error=>error.kind==="rpc-unavailable");
 assert.ok(!f.requests.some(r=>r.method==="eth_simulateV1"));
});

test("a synthetic future sequence crossing the selected fork must replan instead of reusing old policy", async () => {
 const f=fixture({timestamp:"0x6ac4fd5f"});
 await assert.rejects(simulateKeelPublicationBeforeFunding(input(),f.transport),error=>error.kind==="unsupported-simulation");
});
