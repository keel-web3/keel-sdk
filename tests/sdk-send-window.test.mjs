import test from "node:test";
import assert from "node:assert/strict";
import { planKeelSendWindow } from "../packages/sdk/dist/send-window.js";

const from = "0x" + "1".repeat(40), to = "0x" + "2".repeat(40);
const calls = Array.from({ length: 30 }, (_, i) => ({ to, data: "0x" + i.toString(16).padStart(8, "0") }));
function transport({ gas = () => 40_000_000n, revertAt = -1, chain = "0xaa36a7" } = {}) {
  const requests = [];
  return { requests, request: async ({ method, params }) => {
    requests.push({ method, params });
    if (method === "eth_chainId") return chain;
    if (method === "eth_getBlockByNumber") return { number: "0x100", gasLimit: "0xbebc200" }; // 200M
    if (method === "eth_getTransactionCount") return "0x5";
    assert.equal(method, "eth_simulateV1");
    return params[0].blockStateCalls.map(({ calls: [call] }) => {
      const i = parseInt(call.data, 16);
      return { calls: [i === revertAt ? { status: "0x0", gasUsed: "0x5208", error: { message: "SlugMissing" } } : { status: "0x1", gasUsed: "0x" + gas(i).toString(16) }] };
    });
  } };
}

test("a send window simulates calls in order, one block each, and gives each its nonce and margined gas", async () => {
  const t = transport();
  const w = await planKeelSendWindow({ transport: t, chainId: 11155111, from, calls, startIndex: 3, maximumTransactionGas: 200_000_000n });
  // Two 200M blocks hold ten 40M calls.
  assert.equal(w.calls.length, 10);
  assert.equal(w.nextIndex, 13);
  assert.deepEqual(w.calls.map(c => c.nonce), Array.from({ length: 10 }, (_, i) => "0x" + (5 + i).toString(16)));
  assert.equal(BigInt(w.calls[0].gas), 52_000_000n);
  assert.equal(w.calls[0].index, 3);
  assert.equal(w.signing, "not-performed");
  const simulated = t.requests.find(r => r.method === "eth_simulateV1").params[0];
  assert.equal(simulated.blockStateCalls.length, 16);
  assert.ok(simulated.blockStateCalls.every(b => b.calls.length === 1));
});

test("a window stops before a reverting call and names it; a revert first is an error", async () => {
  const w = await planKeelSendWindow({ transport: transport({ gas: () => 1_000_000n, revertAt: 6 }), chainId: 11155111, from, calls, maximumTransactionGas: 200_000_000n });
  assert.equal(w.nextIndex, 6);
  assert.deepEqual(w.reverted, { index: 6, error: "SlugMissing" });
  await assert.rejects(planKeelSendWindow({ transport: transport({ revertAt: 0 }), chainId: 11155111, from, calls, maximumTransactionGas: 200_000_000n }), /reverts: SlugMissing/u);
});

test("a call above the transaction ceiling, a wrong chain or a bad window size is refused", async () => {
  await assert.rejects(planKeelSendWindow({ transport: transport(), chainId: 11155111, from, calls, maximumTransactionGas: 16_777_216n }), /ceiling/u);
  await assert.rejects(planKeelSendWindow({ transport: transport({ chain: "0x1" }), chainId: 11155111, from, calls, maximumTransactionGas: 200_000_000n }), /different chain/u);
  await assert.rejects(planKeelSendWindow({ transport: transport(), chainId: 11155111, from, calls, maximumCalls: 300, maximumTransactionGas: 200_000_000n }), /1\.\.255/u);
});
