import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeFunctionData, parseAbi, keccak256 } from "viem";
const { simulateKeelPublicationBeforeFunding, simulateKeelStorageBeforeFunding, assertKeelFundingPreflight, keelFundingApprovalDigest, keelSimulationTransportDiagnostic, KeelPublicationSimulationError } = await import(process.env.KEEL_TEST_PUBLICATION_PREFLIGHT_MODULE ?? "../packages/sdk/dist/publication-preflight.js");

const reader = `0x${"11".repeat(20)}`, owner = `0x${"22".repeat(20)}`;
const block = { number: "0x12", hash: `0x${"aa".repeat(32)}`, timestamp: "0x68f00000", gasLimit: "0x1000000" };
const expected = "data:application/json,{\"name\":\"Exact work\"}";
const call = { from: owner, to: reader, data: "0x1234", value: "0x0", gas: "0xf4240", maxFeePerGas: "0x1000000", maxPriorityFeePerGas: "0xf4240" };
const input = () => ({ planFingerprint: `0x${"bb".repeat(32)}`, chainId: 11155111, reader, readerRuntimeCodeHash: keccak256("0x6000"), preparationCalls: [call], metadataCall: call,
  expectedTokenURI: expected, maximumTokenUriBytes: 2_000_000, maximumReadGas: 1_000_000n, collectionOverheadGas: 10_000n, maximumTransactionGas: 16_000_000n });

test('unknown RPC failures retain method, numeric code and HTTP cause without exposing payloads or credentials', async()=>{
  const error={name:'HttpRequestError',status:502,message:'https://SECRET.invalid/key?token=PRIVATE artwork 0x1234',body:'ARTWORK',cause:{code:-32098,message:'SECRET response body',data:'PRIVATE'}};
  await assert.rejects(simulateKeelPublicationBeforeFunding(input(),fixture({error}).transport),failure=>{
    assert.equal(failure.kind,'rpc-unavailable');
    assert.equal(failure.diagnostic.rpcMethod,'eth_simulateV1');assert.equal(failure.diagnostic.phase,'publication-preflight');
    assert.equal(failure.diagnostic.rpcCode,-32098);assert.equal(failure.diagnostic.httpStatus,502);
    assert.equal(failure.diagnostic.errorClass,'HttpRequestError');assert.equal(failure.diagnostic.causeDepth,1);
    assert.doesNotMatch(JSON.stringify(failure),/SECRET|PRIVATE|ARTWORK|0x1234|https:/);return true;
  });
});

test('diagnostics bound cyclic causes and allow only enumerated names, methods, phases and transport codes',()=>{
  const nested={name:'PRIVATE',code:'PRIVATE',status:999,message:'SECRET',diagnostic:{rpcMethod:'SECRET',phase:'PRIVATE',causeClass:'SECRET',socketReadyState:99,httpStatus:888,rpcCode:Infinity}};nested.cause=nested;
  const d=keelSimulationTransportDiagnostic(nested,{method:'PRIVATE',phase:'SECRET',socketReadyState:2});
  assert.equal(d.socketReadyState,2);assert.equal(d.causeDepth,0);assert.ok(JSON.stringify(d).length<400);assert.doesNotMatch(JSON.stringify(d),/SECRET|PRIVATE/);
  const timeout=keelSimulationTransportDiagnostic({name:'Error',cause:{code:'ETIMEDOUT'}},{method:'eth_getBlockByNumber',phase:'public-qualification'});
  assert.equal(timeout.transportFailure,'timeout');assert.equal(timeout.transportCode,'ETIMEDOUT');assert.equal(timeout.rpcMethod,'eth_getBlockByNumber');
  const estimate=keelSimulationTransportDiagnostic({name:'Error',diagnostic:{blockIndex:3,callIndex:0}},{method:'eth_estimateGas',phase:'project-estimate'});
  assert.equal(estimate.rpcMethod,'eth_estimateGas');assert.equal(estimate.phase,'project-estimate');assert.equal(estimate.blockIndex,3);assert.equal(estimate.callIndex,0);
  const invalid=keelSimulationTransportDiagnostic({diagnostic:{blockIndex:256,callIndex:-1}});assert.equal(invalid.blockIndex,undefined);assert.equal(invalid.callIndex,undefined);
});
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
      return request.params[0].blockStateCalls.map((item, index) => {
        const finalRead = simulationPass === 3 && index === request.params[0].blockStateCalls.length - 1;
        const gasUsed = finalRead ? change.readGas ?? change.gas ?? "0x186a0" : change.gas ?? "0x186a0";
        return { transactions: item.calls.map(({ gas, nonce }) => ({ gas, ...(nonce === undefined ? {} : { nonce }) })), ...(change.timestamp && !change.omitForkHeader ? { timestamp: `0x${(BigInt(change.timestamp) + BigInt(index + 1)).toString(16)}`, number: `0x${(BigInt(change.blockNumber ?? block.number) + BigInt(index + 1)).toString(16)}`, slotNumber: `0x${(index + 1).toString(16)}`, blockAccessListHash: block.hash,
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
    [{ blockStateCalls: [{ calls: [discovery] }], validation: false, traceTransfers: false, returnFullTransactions: true }, "0x12"],
    [{ blockStateCalls: [{ calls: [bounded] }], validation: true, traceTransfers: false, returnFullTransactions: true }, "0x12"],
    [{ blockStateCalls: [{ calls: [bounded] }, { calls: [{ ...call, gas: "0xf1b30" }] }], validation: false, traceTransfers: false, returnFullTransactions: true }, "0x12"],
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

function alteredEnvelopeTransport(pass, alter) {
  const f = fixture();
  let simulations = 0;
  return { requests: f.requests, transport: { request: async request => {
    const result = await f.transport.request(request);
    if (request.method === "eth_simulateV1" && ++simulations === pass) alter(result, request);
    return result;
  } } };
}

test("every direct transport simulation phase rejects silent gas clamping before an apparent revert", async () => {
  for (const pass of [1, 2, 3]) {
    let requestedGas;
    const f = alteredEnvelopeTransport(pass, (result, request) => {
      requestedGas = BigInt(request.params[0].blockStateCalls[0].calls[0].gas);
      result[0].transactions[0].gas = `0x${(requestedGas - 1n).toString(16)}`;
      result[0].calls[0].status = "0x0";
    });
    await assert.rejects(simulateKeelPublicationBeforeFunding(input(), f.transport), error => {
      assert.equal(error.kind, "provider-limit");
      assert.deepEqual(error.diagnostic, { requestedGasLimit: requestedGas.toString(), providerGasCap: (requestedGas - 1n).toString(), blockIndex: 0, callIndex: 0 });
      return true;
    });
    assert.equal(f.requests.filter(request => request.method === "eth_simulateV1").length, pass);
  }
});

test("every direct transport simulation phase requires complete exact transaction envelopes", async () => {
  const mutations = [
    result => { delete result[0].transactions; },
    result => { result[0].transactions = []; },
    result => { result[0].transactions.push({ ...result[0].transactions[0] }); },
    result => { result[0].transactions = [`0x${"dd".repeat(32)}`]; },
    result => { delete result[0].transactions[0].gas; },
    result => { result[0].transactions[0].gas = "0x00"; },
    result => { result[0].transactions[0].gas = `0x${(BigInt(result[0].transactions[0].gas) + 1n).toString(16)}`; },
  ];
  for (const pass of [1, 2, 3]) for (const mutate of mutations) {
    const f = alteredEnvelopeTransport(pass, result => { mutate(result); result[0].calls[0].status = "0x0"; });
    await assert.rejects(simulateKeelPublicationBeforeFunding(input(), f.transport), error => error.kind === "unsupported-simulation");
    assert.equal(f.requests.filter(request => request.method === "eth_simulateV1").length, pass);
  }
});

test("all returned envelopes are checked before interpreting any execution failure", async () => {
  const f = alteredEnvelopeTransport(1, result => {
    result[0].calls[0].status = "0x0";
    delete result[1].transactions;
  });
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...input(), preparationCalls: [call, { ...call, data: "0x5678" }] }, f.transport), error => error.kind === "unsupported-simulation");
  assert.equal(f.requests.filter(request => request.method === "eth_simulateV1").length, 1);
});

test("every direct transport replay verifies the explicit atomic nonce before interpreting a revert", async () => {
  const batch = { ...call, from: owner, to: owner, data: "0xe9ae5c530000", nonce: "0x5" };
  for (const pass of [1, 2, 3]) for (const nonce of [undefined, "0x4", "0x6", "0x05", 5]) {
    const f = alteredEnvelopeTransport(pass, result => {
      if (nonce === undefined) delete result[0].transactions[0].nonce;
      else result[0].transactions[0].nonce = nonce;
      result[0].calls[0].status = "0x0";
    });
    await assert.rejects(simulateKeelPublicationBeforeFunding({ ...input(), transactionContext: "atomic-wallet", preparationCalls: [batch] }, f.transport), error => error.kind === "unsupported-simulation");
    assert.equal(f.requests.filter(request => request.method === "eth_simulateV1").length, pass);
  }
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

test("atomic wallet preflight validates its real fee envelope on every preparation replay", async () => {
  const f = fixture();
  const batch = { ...call, from: owner, to: owner, data: "0xe9ae5c530000" };
  const planned = { ...input(), transactionContext: "atomic-wallet", preparationCalls: [batch] };
  const proof = await simulateKeelPublicationBeforeFunding(planned, f.transport);
  const simulations = f.requests.filter(request => request.method === "eth_simulateV1");
  assert.deepEqual(simulations.map(request => request.params[0].validation), [true, true, false]);
  assert.equal(simulations[0].params[0].blockStateCalls[0].calls[0].maxFeePerGas, call.maxFeePerGas);
  assert.equal(simulations[2].params[0].blockStateCalls[0].blockOverrides, undefined);
  assert.equal(simulations[2].params[0].blockStateCalls.at(-1).blockOverrides, undefined);
  assert.equal(proof.observationPolicy, "eth-call");
  assert.deepEqual(proof.transactionGasLimits, ["120000"]);
  for (const preparationCalls of [[call], [batch, batch]]) {
    await assert.rejects(simulateKeelPublicationBeforeFunding({ ...planned, preparationCalls }, fixture().transport), error => error.kind === "configuration-invalid");
  }
});

test("explicit atomic nonce survives every replay and invalid nonce fails before RPC", async () => {
  const f = fixture();
  const batch = { ...call, from: owner, to: owner, data: "0xe9ae5c530000", nonce: "0x5" };
  const planned = { ...input(), transactionContext: "atomic-wallet", preparationCalls: [batch] };
  await simulateKeelPublicationBeforeFunding(planned, f.transport);
  for (const request of f.requests.filter(item => item.method === "eth_simulateV1")) assert.equal(request.params[0].blockStateCalls[0].calls[0].nonce, "0x5");
  for (const nonce of ["0x05", "5", "-1", "0x10000000000000000"]) {
    const bad = fixture();
    await assert.rejects(simulateKeelPublicationBeforeFunding({ ...planned, preparationCalls: [{ ...batch, nonce }] }, bad.transport), error => error.kind === "configuration-invalid");
    assert.equal(bad.requests.length, 0);
  }
});

for (const fork of [
  { name: "pre-Amsterdam", timestamp: undefined, separateStateGas: false },
  { name: "Amsterdam", timestamp: "0x6ac51fe0", separateStateGas: true },
]) for (const atomic of [false, true]) for (const fee of [
  { name: "EIP-1559", fields: { maxFeePerGas: "0x1000000", maxPriorityFeePerGas: "0xf4240" } },
  { name: "legacy", fields: { gasPrice: "0x1000000" } },
]) test(`publication fee envelope: ${fork.name}, ${atomic ? "atomic" : "independent"}, ${fee.name}`, async () => {
  const { maxFeePerGas: _cap, maxPriorityFeePerGas: _tip, ...base } = call;
  const exact = { ...base, ...fee.fields, nonce: "0x9",
    ...(atomic ? { from: owner, to: owner, data: "0xe9ae5c530000" } : {}) };
  const planned = { ...input(), preparationCalls: [exact],
    ...(atomic ? { transactionContext: "atomic-wallet" } : {}) };
  const before = structuredClone(planned);
  const f = fixture({ timestamp: fork.timestamp });
  const proof = await simulateKeelPublicationBeforeFunding(planned, f.transport);
  const phases = f.requests.filter(request => request.method === "eth_simulateV1");
  assert.deepEqual(phases.map(request => request.params[0].validation), [atomic, true, false]);
  const phaseCalls = phases.map(request => request.params[0].blockStateCalls[0].calls[0]);
  for (const [index, replay] of phaseCalls.entries()) {
    for (const field of ["from", "to", "data", "value", "nonce"]) assert.equal(replay[field], exact[field]);
    for (const field of ["gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"]) {
      // Legacy independent discovery is fee-free; strict/review replay always
      // preserves the exact fees. Amsterdam discovery needs those same fees.
      assert.equal(replay[field], index === 0 && !atomic && !fork.separateStateGas ? undefined : exact[field]);
    }
  }
  assert.equal(phaseCalls[0].gas, exact.gas);
  assert.equal(BigInt(phaseCalls[1].gas), BigInt(proof.transactionGasLimits[0]));
  assert.equal(phaseCalls[2].gas, phaseCalls[1].gas);
  assert.ok(BigInt(phaseCalls[1].gas) > 0n && BigInt(phaseCalls[1].gas) <= BigInt(exact.gas));
  assert.deepEqual(planned, before);
  assert.equal(proof.verification, "collector-metadata");
  assert.equal(proof.submission, "not-performed");
});


test('close diagnostics allow only bounded codes, classified reasons and retry counts', () => {
  const source = { name: 'Error', diagnostic: { socketCloseCode: 1009, socketCloseReason: 'message-too-large', connectionAttempts: 3 }, cause: { name: 'SocketClosedError' } };
  const diagnostic = keelSimulationTransportDiagnostic(source);
  assert.equal(diagnostic.socketCloseCode, 1009); assert.equal(diagnostic.socketCloseReason, 'message-too-large');
  assert.equal(diagnostic.connectionAttempts, 3); assert.equal(diagnostic.transportFailure, 'connection-closed');
  for (const value of [-1, 999, 5000, Infinity, 1009.1, '1009']) {
    const rejected = keelSimulationTransportDiagnostic({ diagnostic: { socketCloseCode: value, socketCloseReason: 'PRIVATE https://secret.invalid', connectionAttempts: 4 } });
    assert.equal(rejected.socketCloseCode, undefined); assert.equal(rejected.socketCloseReason, undefined); assert.equal(rejected.connectionAttempts, undefined);
    assert.doesNotMatch(JSON.stringify(rejected), /PRIVATE|secret.invalid/);
  }
});

test('capacity and size attempt diagnostics preserve only bounded numeric evidence and approved protocol/stage', () => {
  const diagnostic = { requestedGasLimit: '200000000', providerGasCap: '50000000', requiredProgramGas: '200000000', requestPayloadBytes: 1200300, blockCount: 4, callCount: 20, stage: 'read-capacity', transport: 'https' };
  const safe = keelSimulationTransportDiagnostic({ diagnostic });
  for (const [key, value] of Object.entries(diagnostic)) assert.equal(safe[key], value);
  for (const value of ['PRIVATE', '0x1234', '01', '-1', '18446744073709551616', 200000000, Infinity]) {
    const rejected = keelSimulationTransportDiagnostic({ diagnostic: { requestedGasLimit: value, providerGasCap: value, requiredProgramGas: value, stage: 'PRIVATE', transport: 'https://SECRET', requestPayloadBytes: -1, blockCount: Infinity, callCount: 1.5 } });
    for (const key of Object.keys(diagnostic)) assert.equal(rejected[key], undefined);
  }
});


// These are synthetic wire fixtures. No current project/provider acceptance is
// claimed; the exact full successful sequence must still be checked live.
function capacityDiscoveryFixture({ cap = 150_000n, measured = 100_000n, chainId = 11155111, unsupported = false, revert = false, strictRevert = false, metadataMismatch = false, omitMaximum = false } = {}) {
  const f = fixture({ chainId: `0x${chainId.toString(16)}`, gas: `0x${measured.toString(16)}`, maximumGas: `0x${measured.toString(16)}`, ...(revert ? { revert: 0 } : {}), strictRevert, omitMaximum, ...(metadataMismatch ? { metadata: 'wrong complete metadata' } : {}) });
  const requests = [];
  return { requests, transport: { request: async request => {
    requests.push(structuredClone(request));
    if (request.method === 'eth_simulateV1') {
      if (unsupported) throw { code: -32601, message: 'unsupported' };
      const calls = request.params[0].blockStateCalls.map(block => block.calls[0]);
      if (calls.some(call => BigInt(call.gas) > cap)) return calls.map(call => ({ transactions: [{ gas: `0x${(BigInt(call.gas) > cap ? cap : BigInt(call.gas)).toString(16)}` }], calls: [{ status: '0x0' }] }));
    }
    return f.transport.request(request);
  } } };
}
function capacityDiscoveryInput(chainId = 11155111) {
  const source = input();
  return { ...source, chainId, discoveryGasPolicy: 'provider-capacity', preparationCalls: [
    { ...call, gas: `0x${source.maximumTransactionGas.toString(16)}`, data: '0x1234' },
    { ...call, gas: `0x${source.maximumTransactionGas.toString(16)}`, data: '0x5678' },
  ] };
}
for (const chainId of [1, 11155111]) test(`selected EVM chain ${chainId} discovers sufficient provider capacity below the chain maximum and strictly validates the complete program`, async () => {
  const f = capacityDiscoveryFixture({ chainId }), original = capacityDiscoveryInput(chainId), before = structuredClone(original);
  const proof = await simulateKeelPublicationBeforeFunding(original, f.transport);
  assert.deepEqual(original, before);
  assert.equal(proof.transactionGasPolicy.maximumTotalGas, '16777216');
  assert.deepEqual(proof.discoveryGas, { policy: 'provider-capacity', initialGasLimits: ['16000000', '16000000'], effectiveGasLimits: ['150000', '150000'], capacityAttempts: [{ requestedGas: '16000000', providerGasCap: '150000' }] });
  assert.deepEqual(proof.transactionGasLimits, ['105000', '105000']);
  const runs = f.requests.filter(r => r.method === 'eth_simulateV1');
  const program = r => r.params[0].blockStateCalls.map(b => b.calls[0]);
  const strip = ({ gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, ...c }) => c;
  for (const r of runs) assert.deepEqual(program(r).slice(0, 2).map(strip), original.preparationCalls.map(strip));
  const strict = runs.filter(r => r.params[0].validation);
  assert.equal(strict.length, 1);
  assert.deepEqual(program(strict[0]), original.preparationCalls.map(c => ({ ...c, gas: '0x19a28' })));
  assert.deepEqual(program(runs.at(-1)).slice(0, 2), program(strict[0]));
  assert.equal(proof.completeTokenUriBytes, Buffer.byteLength(expected));
  assert.equal(proof.signing, 'not-performed'); assert.equal(proof.submission, 'not-performed');
});
test('discovery cannot shrink the measured transaction margin to fit an insufficient provider', async () => {
  const f = capacityDiscoveryFixture({ cap: 102_000n });
  await assert.rejects(simulateKeelPublicationBeforeFunding(capacityDiscoveryInput(), f.transport), e => e.kind === 'provider-limit' && e.diagnostic.requestedGasLimit === '105000' && e.diagnostic.providerGasCap === '102000');
  assert.equal(f.requests.filter(r => r.method === 'eth_simulateV1' && r.params[0].validation).length, 0);
});
test('successful capacity discovery never accepts or retries a silently clamped strict transaction', async () => {
  const f = capacityDiscoveryFixture();
  let strictRequests = 0;
  const transport = { request: async request => {
    const result = await f.transport.request(request);
    if (request.method === 'eth_simulateV1' && request.params[0].validation) {
      strictRequests++;
      result[0].transactions[0].gas = '0x186a0';
    }
    return result;
  } };
  const source = capacityDiscoveryInput(), before = structuredClone(source);
  await assert.rejects(simulateKeelPublicationBeforeFunding(source, transport), error =>
    error.kind === 'provider-limit' && error.diagnostic.requestedGasLimit === '105000'
      && error.diagnostic.providerGasCap === '100000');
  assert.deepEqual(source, before);
  assert.equal(strictRequests, 1);
  assert.equal(f.requests.filter(request => request.method === 'eth_simulateV1').length, 3);
});
test('insufficient execution capacity, unsupported methods, missing pre-refund data, strict failure and wrong complete metadata remain blocked', async () => {
  for (const [options, kind] of [[{ cap: 80_000n, revert: true }, 'execution-reverted'], [{ unsupported: true }, 'unsupported-simulation'], [{ omitMaximum: true }, 'unsupported-simulation'], [{ strictRevert: true }, 'execution-reverted'], [{ metadataMismatch: true }, 'metadata-mismatch']]) {
    const f = capacityDiscoveryFixture(options), original = capacityDiscoveryInput(), before = structuredClone(original);
    await assert.rejects(simulateKeelPublicationBeforeFunding(original, f.transport), e => e.kind === kind);
    assert.deepEqual(original, before);
    if (options.unsupported) assert.equal(f.requests.filter(r => r.method === 'eth_simulateV1').length, 1);
  }
});
test('capacity discovery is explicit and cannot alter an atomic wallet, measured envelope, unknown policy or unsupported chain', async () => {
  for (const change of [{ transactionContext: 'atomic-wallet' }, { preparationCalls: [call] }, { discoveryGasPolicy: 'guess' }, { chainId: 31337 }]) {
    const source = { ...capacityDiscoveryInput(), ...change }, f = capacityDiscoveryFixture({ chainId: source.chainId });
    await assert.rejects(simulateKeelPublicationBeforeFunding(source, f.transport), e => e.kind === 'configuration-invalid');
    assert.equal(f.requests.filter(r => r.method === 'eth_simulateV1').length, 0);
  }
});

test('discovery retries only strictly smaller explicit capacity evidence and stops after three adjustments', async () => {
  for (const diagnostic of [{ providerGasCap:'100000' }, { requestedGasLimit:'1',providerGasCap:'100000' },
    { requestedGasLimit:'16000000',providerGasCap:'0' }, { requestedGasLimit:'16000000',providerGasCap:'16000000' },
    { requestedGasLimit:'16000000',providerGasCap:'0x186a0' }, { requestedGasLimit:'16000000',providerGasCap:'0100000' },
    { requestedGasLimit:'16000000',providerGasCap:'18446744073709551616' }, undefined]) {
    const base=fixture(); let simulations=0;
    const transport={request:async r=>{
      if(r.method!=='eth_simulateV1') return base.transport.request(r);
      simulations++; throw new KeelPublicationSimulationError('provider-limit','synthetic capacity',diagnostic);
    }};
    await assert.rejects(simulateKeelPublicationBeforeFunding(capacityDiscoveryInput(),transport),e=>e.kind==='provider-limit');
    assert.equal(simulations,1);
  }
  const base=fixture(), calls=[];
  const transport={request:async r=>{
    if(r.method!=='eth_simulateV1') return base.transport.request(r);
    assert.equal(r.params[0].validation,false);
    const sequence=r.params[0].blockStateCalls.map(b=>b.calls[0]);calls.push(sequence);
    const requested=BigInt(sequence[0].gas);
    throw new KeelPublicationSimulationError('provider-limit','synthetic changing capacity',{requestedGasLimit:String(requested),providerGasCap:String(requested/2n)});
  }};
  const source=capacityDiscoveryInput(),before=structuredClone(source);
  await assert.rejects(simulateKeelPublicationBeforeFunding(source,transport),e=>e.kind==='provider-limit');
  assert.deepEqual(source,before); assert.equal(calls.length,4);
  assert.deepEqual(calls.map(s=>s.map(c=>c.data)),Array.from({length:4},()=>['0x1234','0x5678']));
});

test('reverted execution retains exact pinned and returned evidence without raw error data or an inferred inner cause', async () => {
  const revertData = '0x534543524554';
  const f = alteredEnvelopeTransport(1, result => {
    result[0].calls[0] = { status: '0x0', gasUsed: '0x100', maxUsedGas: '0x110', returnData: revertData,
      error: { code: 3, message: 'PRIVATE execution error', data: revertData } };
  });
  await assert.rejects(simulateKeelPublicationBeforeFunding(input(), f.transport), error => {
    assert.equal(error.kind, 'execution-reverted');
    assert.deepEqual(Object.fromEntries(['callIndex','requestedGasLimit','returnedGasLimit','gasUsed','maxUsedGas','rpcCode','pinnedBlockNumber','pinnedBlockHash','readerRuntimeCodeHash','revertDataBytes','revertDataHash'].map(k => [k,error.diagnostic[k]])), {
      callIndex: 0, requestedGasLimit: '1000000', returnedGasLimit: '1000000', gasUsed: '256', maxUsedGas: '272', rpcCode: 3,
      pinnedBlockNumber: '18', pinnedBlockHash: block.hash, readerRuntimeCodeHash: keccak256('0x6000'), revertDataBytes: 6, revertDataHash: keccak256(revertData),
    });
    assert.equal(error.diagnostic.phase, 'ephemeral-execution');
    assert.equal(error.diagnostic.planFingerprint, input().planFingerprint);
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE|534543524554|out of gas/); return true;
  });
});

test('provider failure reason survives the publication boundary with bounded response evidence only', async () => {
  const transportError = Object.assign(new Error('SECRET https://private.invalid'), { name: 'KeelRpcSetupError', reason: 'invalid-response', diagnostic: {
    transportFailure: 'invalid-response', failureReason: 'invalid-response', responseFailure: 'response-too-large', responseBytes: 16777217, maximumResponseBytes: 16777216,
    body: 'PRIVATE', endpoint: 'SECRET', approval: '0x1234',
  } });
  await assert.rejects(simulateKeelPublicationBeforeFunding(input(), fixture({ error: transportError }).transport), error => {
    assert.equal(error.kind, 'rpc-unavailable'); assert.equal(error.diagnostic.failureReason, 'invalid-response');
    assert.equal(error.diagnostic.transportFailure, 'invalid-response'); assert.equal(error.diagnostic.responseFailure, 'response-too-large');
    assert.equal(error.diagnostic.responseBytes, 16777217); assert.equal(error.diagnostic.maximumResponseBytes, 16777216);
    assert.equal(error.diagnostic.pinnedBlockHash, block.hash); assert.doesNotMatch(JSON.stringify(error), /PRIVATE|SECRET|0x1234|https:|artwork.*too large/); return true;
  });
  const rejected = keelSimulationTransportDiagnostic({ diagnostic: { failureReason: 'SECRET', responseFailure: 'PRIVATE', responseBytes: Infinity,
    maximumResponseBytes: -1, gasUsed: '-1', pinnedBlockHash: 'SECRET', target: 'PRIVATE', selector: 'https://secret.invalid' } });
  for (const key of ['failureReason','responseFailure','responseBytes','maximumResponseBytes','gasUsed','pinnedBlockHash','target','selector']) assert.equal(rejected[key], undefined);
});


test('direct estimate reverts retain only error code and revert digest, including empty revert data', () => {
  for (const data of ['0x', '0xdeadbeef']) {
    const diagnostic = keelSimulationTransportDiagnostic({ code: 3, data, message: 'PRIVATE' }, { method: 'eth_estimateGas', phase: 'project-estimate' });
    assert.equal(diagnostic.rpcCode, 3); assert.equal(diagnostic.revertDataBytes, (data.length - 2) / 2);
    assert.equal(diagnostic.revertDataHash, keccak256(data)); assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE|deadbeef/);
  }
});

// Only exact authorized calldata LENGTHS are retained from the Retro capture.
// Payloads below are synthetic zero bytes, not creator data or a live replay.
const retroPreparationLengths = [3300,68,69316,69316,69316,69316,69316,69316,69316,64612,69316,69316,69316,69316,69316,69316,66692,69316,69316,69316,69316,69316,69316,64612,69316,69316,69316,69316,69316,54180,2212,1188,1092,484,580,1188,1028,484,484,36,420,68,2212,100,580];
const intrinsicForZeroBytes = (length, amsterdam = true) => BigInt(amsterdam ? 15000 + length * 64 : 21000 + length * 10);
const minimumForZeroBytes = (length, amsterdam = true) => { const intrinsic = intrinsicForZeroBytes(length, amsterdam); return intrinsic > 21000n ? intrinsic : 21000n; };
function minimumDiscoveryFixture(lengths, { budget = 50_000_000n, amsterdam = true, missingNumericCap = false, fundedFirst = false, explicitWholeRequest = true } = {}) {
  const base = fixture({ ...(amsterdam ? { timestamp: '0x6acf6e00' } : {}), blockGas: '0xbebc200' });
  const source = { ...input(), discoveryGasPolicy: 'provider-capacity', maximumTransactionGas: 200_000_000n,
    preparationCalls: lengths.map((length, index) => ({ ...call, gas: '0xbebc200', data: `0x${'00'.repeat(length)}`, value: fundedFirst && index === 0 ? '0x1' : '0x0' })) };
  // Pre-Amsterdam transactions retain their separately selected chain cap.
  if (!amsterdam) { source.maximumTransactionGas = 16_000_000n; source.preparationCalls = source.preparationCalls.map(call => ({ ...call, gas: '0xf42400' })); }
  const requests = [];
  const transport = { request: async request => {
    if (request.method !== 'eth_simulateV1') return base.transport.request(request);
    requests.push(structuredClone(request));
    const calls = request.params[0].blockStateCalls.map(block => block.calls[0]);
    if (requests.length === 1) {
      if (missingNumericCap) throw new KeelPublicationSimulationError('provider-limit', 'Synthetic HTTP capacity refusal', { httpStatus: 413 });
      if (explicitWholeRequest) throw new KeelPublicationSimulationError('provider-limit', 'Synthetic measured whole-request capacity', {
        gasCapacityScope: 'request', capacitySource: 'measured-profile', requestedGasLimit: BigInt(calls[0].gas).toString(), providerGasCap: budget.toString(),
      });
      return calls.map((call, index) => ({ transactions: [{ gas: index === 1 ? `0x${budget.toString(16)}` : call.gas }], calls: [] }));
    }
    for (let index = 0; index < lengths.length; index++) {
      assert.ok(BigInt(calls[index].gas) >= minimumForZeroBytes(lengths[index], amsterdam), `call ${index} fell below its selected-fork minimum`);
      assert.ok(BigInt(calls[index].gas) <= BigInt(source.preparationCalls[index].gas));
    }
    const result = await base.transport.request(request);
    for (let index = 0; index < lengths.length; index++) {
      const used = minimumForZeroBytes(lengths[index], amsterdam);
      result[index].calls[0].gasUsed = `0x${used.toString(16)}`;
      result[index].calls[0].maxUsedGas = `0x${used.toString(16)}`;
    }
    return result;
  } };
  return { source, requests, transport };
}

test('45 synthetic calldata lengths reject an explicit measured whole-request budget below their selected-fork minimum before resubmission', async () => {
  const f = minimumDiscoveryFixture(retroPreparationLengths, { fundedFirst: true }), before = structuredClone(f.source);
  await assert.rejects(simulateKeelPublicationBeforeFunding(f.source, f.transport), error => {
    assert.equal(error.kind, 'provider-limit');
    assert.equal(error.diagnostic.providerGasCap, '50000000');
    assert.equal(error.diagnostic.minimumProgramGas, '124157048');
    assert.equal(error.diagnostic.intrinsicProgramGas, '124150056');
    assert.equal(error.diagnostic.calldataFloorGas, '123469056');
    assert.equal(error.diagnostic.largestMinimumCallGas, '4451224');
    assert.equal(error.diagnostic.stage, 'discovery-minimum');
    assert.equal(error.diagnostic.planFingerprint, f.source.planFingerprint);
    assert.doesNotMatch(JSON.stringify(error.diagnostic), /0x00000000/);
    return true;
  });
  assert.equal(f.requests.length, 1); assert.deepEqual(f.source, before);
});

test('unequal calldata minima share an explicit measured whole-request budget without changing calldata or measured strict envelopes', async () => {
  const f = minimumDiscoveryFixture([69316,68,36], { budget: 8_000_000n }), before = structuredClone(f.source);
  const proof = await simulateKeelPublicationBeforeFunding(f.source, f.transport);
  assert.equal(proof.completeTokenUriBytes, Buffer.byteLength(expected));
  assert.equal(proof.state, 'ephemeral-simulation'); assert.equal(proof.submission, 'not-performed');
  const discovery = f.requests[1].params[0].blockStateCalls.map(block => block.calls[0]);
  const allocated = discovery.reduce((sum, call) => sum + BigInt(call.gas), 0n);
  assert.ok(allocated <= 8_000_000n && allocated > 7_999_997n);
  assert.ok(BigInt(discovery[0].gas) >= 4_451_224n);
  assert.deepEqual(discovery.map(call => call.data), before.preparationCalls.map(call => call.data));
  const strict = f.requests[2].params[0].blockStateCalls.map(block => block.calls[0]);
  assert.deepEqual(strict.map(call => call.gas), proof.transactionGasLimits.map(gas => `0x${BigInt(gas).toString(16)}`));
  assert.deepEqual(f.requests[3].params[0].blockStateCalls.slice(0, 3).map(block => block.calls[0]), strict);
  assert.deepEqual(f.source, before);
});

test('minimum discovery allocation uses the selected fork and never infers a numeric budget from HTTP status', async () => {
  const oldFork = minimumDiscoveryFixture([69316,68,36], { budget: 1_000_000n, amsterdam: false });
  const proof = await simulateKeelPublicationBeforeFunding(oldFork.source, oldFork.transport);
  assert.equal(proof.transactionGasPolicy.profile, 'ethereum-pre-amsterdam');
  assert.equal(proof.completeTokenUriBytes, Buffer.byteLength(expected));
  const unknown = minimumDiscoveryFixture(retroPreparationLengths, { missingNumericCap: true });
  await assert.rejects(simulateKeelPublicationBeforeFunding(unknown.source, unknown.transport), error => {
    assert.equal(error.kind, 'provider-limit'); assert.equal(error.diagnostic.httpStatus, 413);
    assert.equal(error.diagnostic.minimumProgramGas, undefined); assert.equal(error.diagnostic.providerGasCap, undefined); return true;
  });
  assert.equal(unknown.requests.length, 1);
  const atomic = minimumDiscoveryFixture([69316,68]);
  atomic.source.transactionContext = 'atomic-wallet';
  await assert.rejects(simulateKeelPublicationBeforeFunding(atomic.source, atomic.transport), error => error.kind === 'configuration-invalid');
  assert.equal(atomic.requests.length, 0);
});


test('discovery minima distinguish EIP-2780 self-calls, recipient access, nonzero value and bounded diagnostics', async () => {
  const f = minimumDiscoveryFixture([1000,1000,1000], { budget: 239_999n });
  f.source.preparationCalls[0] = { ...f.source.preparationCalls[0], to: owner, value: '0x1' };
  f.source.preparationCalls[1] = { ...f.source.preparationCalls[1], value: '0x1' };
  await assert.rejects(simulateKeelPublicationBeforeFunding(f.source, f.transport), error => {
    assert.equal(error.kind, 'provider-limit');
    const safe = keelSimulationTransportDiagnostic(error);
    assert.equal(safe.minimumProgramGas, '240000'); assert.equal(safe.intrinsicProgramGas, '240000');
    assert.equal(safe.calldataFloorGas, '192000'); assert.equal(safe.largestMinimumCallGas, '85000');
    assert.equal(safe.stage, 'discovery-minimum'); return true;
  });
  assert.equal(f.requests.length, 1);
  const keys = ['minimumProgramGas', 'intrinsicProgramGas', 'calldataFloorGas', 'largestMinimumCallGas'];
  for (const value of ['SECRET', '-1', '01', '18446744073709551616', 1, Infinity]) {
    const safe = keelSimulationTransportDiagnostic({ diagnostic: Object.fromEntries(keys.map(key => [key, value])) });
    for (const key of keys) assert.equal(safe[key], undefined);
  }
  assert.equal(keelSimulationTransportDiagnostic({ diagnostic: { calldataFloorGas: '0' } }).calldataFloorGas, '0');
});


test('later envelope remainder never becomes a whole-request budget or a repeated descending clamp retry', async () => {
  const f = minimumDiscoveryFixture(retroPreparationLengths, { explicitWholeRequest: false, fundedFirst: true });
  const before = structuredClone(f.source), attempts = [];
  const transport = { request: async request => {
    if (request.method !== 'eth_simulateV1') return f.transport.request(request);
    attempts.push(structuredClone(request));
    const calls = request.params[0].blockStateCalls.map(block => block.calls[0]);
    const clampIndex = attempts.length === 1 ? 0 : 1;
    const cap = attempts.length === 1 ? 50_000_000n : 49_988_000n;
    return calls.map((call, index) => ({ transactions: [{ gas: index === clampIndex ? `0x${cap.toString(16)}` : call.gas }], calls: [] }));
  } };
  await assert.rejects(simulateKeelPublicationBeforeFunding(f.source, transport), error => {
    assert.equal(error.kind, 'provider-limit');
    assert.equal(error.diagnostic.stage, 'discovery-capacity-scope');
    assert.equal(error.diagnostic.providerGasCap, '49988000');
    assert.equal(error.diagnostic.gasCapacityScope, 'envelope');
    assert.equal(error.diagnostic.minimumProgramGas, '124157048');
    assert.match(error.message, /without a verified whole-request gas limit/);
    assert.doesNotMatch(error.message, /minimum exceeds/);
    return true;
  });
  assert.equal(attempts.length, 2);
  assert.deepEqual(f.source, before);
  for (const attempt of attempts) {
    assert.equal(attempt.params[0].validation, false);
    const calls = attempt.params[0].blockStateCalls.map(block => block.calls[0]);
    assert.equal(calls.length, before.preparationCalls.length);
    assert.deepEqual(calls.map(({ gas, ...call }) => call), before.preparationCalls.map(({ gas, ...call }) => call));
  }
});
