import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi, zeroAddress } from "viem";
import {
  planQueueReadAdapter,
  queueReadAdapterPlanAbi,
  QUEUE_READ_ADAPTER_LIMITS,
} from "./queue-read-adapter-plan-core.mjs";

const address = (value) => `0x${BigInt(value).toString(16).padStart(40, "0")}`;
const QUEUE = address(1);
const TARGET = address(2);
const CAPACITY = address(3);
const STATS = address(4);
const SCOPE = `0x${"11".repeat(32)}`;
const base = { chainId: 11155111, queue: QUEUE, scope: SCOPE };

test("preserves boolean polarity and encodes mapping getter arguments", () => {
  const plan = planQueueReadAdapter({
    ...base,
    gates: [
      { read: { target: TARGET, getter: "mintPaused()" }, allowedValue: false },
      { read: { target: TARGET, getter: "paused(bytes32)", args: [SCOPE] }, allowedValue: true },
    ],
  });
  assert.equal(plan.gates[0].allowedValue, false);
  assert.equal(plan.gates[1].allowedValue, true);
  assert.equal(plan.reads[0].data, encodeFunctionData({ abi: parseAbi(["function mintPaused()"]).slice(0, 1), functionName: "mintPaused", args: [] }));
  assert.equal(
    plan.reads[1].data,
    encodeFunctionData({ abi: parseAbi(["function paused(bytes32)"]), functionName: "paused", args: [SCOPE] }),
  );
  assert.equal(plan.reads[1].fixedValue, 0n);
});

test("deduplicates shared issued reads across live-cap and lifetime bounds", () => {
  const issued = { target: STATS, getter: "totalMinted()" };
  const plan = planQueueReadAdapter({
    ...base,
    gates: [{ read: { value: "1" }, allowedValue: true }],
    limits: [
      {
        limit: { target: CAPACITY, getter: "liveCap()" },
        used: issued,
        restored: { target: STATS, getter: "departedMinted()" },
      },
      {
        limit: { target: STATS, getter: "lifetimeCap()" },
        used: { target: STATS, getter: "totalMinted()" },
      },
    ],
    adapterAddress: address(5),
  });
  assert.equal(plan.reads.length, 6);
  assert.equal(plan.bounds.length, 2);
  assert.equal(plan.bounds[0].usedIndex, plan.bounds[1].usedIndex);
  assert.equal(plan.reads[plan.bounds[1].restoredIndex].target, zeroAddress);
  assert.equal(plan.reads[plan.bounds[1].restoredIndex].fixedValue, 0n);
  assert.equal(plan.setReadAdapter.to, getAddress(QUEUE));
  const decoded = decodeFunctionData({ abi: queueReadAdapterPlanAbi, data: plan.setReadAdapter.data });
  assert.equal(decoded.functionName, "setReadAdapter");
  assert.deepEqual(decoded.args, [getAddress(address(5))]);
  assert.equal(plan.calls.length, 1);
  assert.equal(plan.signed, false);
  assert.equal(plan.submitted, false);
});

test("accepts raw four-byte reads and canonical fixed uint256 values", () => {
  const plan = planQueueReadAdapter({
    ...base,
    gates: [{ read: { target: TARGET, data: "0x12345678" }, allowedValue: true }],
    limits: [{ limit: { value: "42" }, used: { value: "7" } }],
  });
  assert.equal(plan.reads[0].data, "0x12345678");
  assert.equal(plan.reads[1].target, zeroAddress);
  assert.equal(plan.reads[1].fixedValue, 42n);
  assert.equal(plan.reads[2].fixedValue, 7n);
  assert.equal(plan.reads[3].fixedValue, 0n);
});

test("rejects read, gate, bound, address, scope and uint256 violations", () => {
  const dynamic = (index) => ({ target: address(index + 20), getter: `read${index}()` });
  assert.throws(
    () => planQueueReadAdapter({ ...base, gates: Array.from({ length: QUEUE_READ_ADAPTER_LIMITS.gates + 1 }, () => ({ read: { value: "1" }, allowedValue: true })) }),
    /gate count/u,
  );
  assert.throws(
    () => planQueueReadAdapter({ ...base, limits: Array.from({ length: QUEUE_READ_ADAPTER_LIMITS.bounds + 1 }, () => ({ limit: { value: "1" } })) }),
    /bound count/u,
  );
  assert.throws(
    () => planQueueReadAdapter({ ...base, gates: Array.from({ length: 8 }, (_, index) => ({ read: dynamic(index), allowedValue: true })), limits: Array.from({ length: 4 }, (_, index) => ({ limit: dynamic(index + 8), used: dynamic(index + 12) })) }),
    /read count/u,
  );
  assert.throws(() => planQueueReadAdapter({ ...base, queue: zeroAddress }), /queue must be nonzero/u);
  assert.throws(() => planQueueReadAdapter({ ...base, scope: "0x12" }), /scope/u);
  assert.throws(() => planQueueReadAdapter({ ...base, chainId: 0 }), /chainId/u);
  assert.throws(() => planQueueReadAdapter({ ...base, limits: [{ limit: { value: 1 } }] }), /value must be a string/u);
  assert.throws(() => planQueueReadAdapter({ ...base, gates: [{ read: { target: TARGET, data: "0x1234" }, allowedValue: true }] }), /4\.\.260/u);
  assert.throws(() => planQueueReadAdapter({ ...base, gates: [{ read: { target: TARGET, getter: "paused(bytes32)", args: ["0x12"] }, allowedValue: true }] }), /encodable/u);
  assert.throws(() => planQueueReadAdapter({ ...base, limits: [{ limit: { value: (1n << 256n).toString() } }] }), /uint256/u);
});

test("lifecycle mode binds capacity only and requires controller state hooks", () => {
  const plan = planQueueReadAdapter({
    ...base,
    registrationMode: "lifecycle-hooks",
    adapterAddress: address(5),
    limits: [{ limit: { target: TARGET, getter: "remainingSupply()" } }],
  });
  assert.equal(plan.setReadAdapter, null);
  assert.equal(plan.registrationMode, "lifecycle-hooks");
  const decoded = decodeFunctionData({ abi: queueReadAdapterPlanAbi, data: plan.setSupplySource.data });
  assert.equal(decoded.functionName, "setSupplySource");
  assert.deepEqual(decoded.args, [getAddress(address(5))]);
  assert.equal(plan.calls.length, 1);
  assert.equal(plan.requiredControllerHooks.length, 5);
  assert.throws(() => planQueueReadAdapter({ ...base, registrationMode: "invalid" }), /registrationMode/u);
  assert.throws(() => planQueueReadAdapter({
    ...base,
    registrationMode: "lifecycle-hooks",
    gates: [{ read: { target: TARGET, getter: "mintPaused()" }, allowedValue: false }],
  }), /push pause\/closure state/u);
});
