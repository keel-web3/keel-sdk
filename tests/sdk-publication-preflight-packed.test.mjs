import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, keccak256 } from "viem";
const { simulateKeelPublicationBeforeFunding } = await import("../packages/sdk/dist/publication-preflight.js");

const reader = `0x${"11".repeat(20)}`, owner = `0x${"22".repeat(20)}`;
const expected = "data:application/json,{\"name\":\"Exact work\"}";
const call = (i, gas = "0xf4240") => ({ from: owner, to: reader, data: `0x1234${i.toString(16).padStart(4, "0")}`, value: "0x0", gas, maxFeePerGas: "0x1000000", maxPriorityFeePerGas: "0xf4240" });
const input = (count, gas) => ({ planFingerprint: `0x${"bb".repeat(32)}`, chainId: 11155111, reader, readerRuntimeCodeHash: keccak256("0x6000"),
  preparationCalls: Array.from({ length: count }, (_, i) => call(i, gas)), metadataCall: call(0xffff),
  expectedTokenURI: expected, maximumTokenUriBytes: 2_000_000, maximumReadGas: 1_000_000n, collectionOverheadGas: 10_000n, maximumTransactionGas: 16_000_000n });

// A simulator that executes several calls per block, links every header to its parent
// and returns the complete metadata from the last call of a read replay.
function packedSimulator(timestamp) {
  const block = { number: "0x12", hash: `0x${"aa".repeat(32)}`, timestamp, gasLimit: "0xbebc200" };
  const requests = [];
  return { requests, transport: { request: async request => {
    requests.push(request);
    if (request.method === "eth_chainId") return "0xaa36a7";
    if (request.method === "eth_getBlockByNumber") return block;
    if (request.method === "eth_getCode") return "0x6000";
    if (request.method !== "eth_simulateV1") throw new Error(`Unexpected method ${request.method}`);
    const blocks = request.params[0].blockStateCalls, last = blocks.at(-1).calls.at(-1);
    return blocks.map((item, index) => ({
      timestamp: `0x${(BigInt(timestamp) + BigInt(index + 1)).toString(16)}`, number: `0x${(0x12 + index + 1).toString(16)}`, slotNumber: `0x${(index + 1).toString(16)}`,
      blockAccessListHash: block.hash, hash: `0x${(index + 1).toString(16).padStart(64, "0")}`, parentHash: index === 0 ? block.hash : `0x${index.toString(16).padStart(64, "0")}`,
      transactions: item.calls.map(({ gas }) => ({ gas })),
      calls: item.calls.map(planned => ({ status: "0x1", gasUsed: "0x186a0", maxUsedGas: "0x186a0",
        returnData: planned === last && planned.data.endsWith("ffff") ? encodeAbiParameters([{ type: "string" }], [expected]) : "0x" })),
    }));
  } } };
}

for (const [fork, timestamp] of [["legacy", "0x68f00000"], ["Amsterdam", "0x6ad00000"]]) {
  test(`a ${fork} publication over 256 calls shares simulation blocks in order and still proves the complete tokenURI`, async () => {
    const f = packedSimulator(timestamp), planned = input(600).preparationCalls;
    const proof = await simulateKeelPublicationBeforeFunding(input(600), f.transport);
    assert.equal(proof.validatedTransactionCalls, 600);
    assert.equal(proof.simulatedCalls, 601);
    assert.equal(proof.completeTokenUriBytes, new TextEncoder().encode(expected).length);
    const simulations = f.requests.filter(request => request.method === "eth_simulateV1");
    assert.equal(simulations.length, 3);
    for (const request of simulations) {
      const blocks = request.params[0].blockStateCalls;
      assert.ok(blocks.length <= 256);
      assert.ok(blocks.every(item => Object.keys(item).join() === "calls" && item.calls.length >= 1 && item.calls.length <= 3));
      // Flattened, the blocks are the exact planned program in its original order.
      assert.deepEqual(blocks.flatMap(item => item.calls).slice(0, 600).map(c => c.data), planned.map(c => c.data));
    }
    if (fork === "Amsterdam") assert.ok(proof.transactionForkHeaders.length <= 256);
  });
}

test("a program that cannot share blocks within the block gas limit stops before any payment", async () => {
  // On Amsterdam, 190M envelopes in a 200M block leave one call per block, so 600 calls need 600 blocks.
  const f = packedSimulator("0x6ad00000");
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...input(600, "0xb532b80"), maximumTransactionGas: 190_000_000n }, f.transport),
    error => error.kind === "configuration-invalid" && /more than 256 simulation blocks/u.test(error.message) && /maximumTransactionGas/u.test(error.message));
  assert.equal(f.requests.filter(request => request.method === "eth_simulateV1").length, 0);
});

test("up to 256 calls keep one call per simulation block", async () => {
  const f = packedSimulator("0x68f00000");
  await simulateKeelPublicationBeforeFunding(input(200), f.transport);
  for (const request of f.requests.filter(request => request.method === "eth_simulateV1"))
    assert.ok(request.params[0].blockStateCalls.every(item => item.calls.length === 1));
});
