import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { createKeelHoldObjectReader } from "../packages/viewer/dist/chunk-store.js";

const id = value => `0x${value.repeat(64)}`;
const root = id("1"), left = id("2"), right = id("3"), shared = id("4");
const pointer = `0x${"55".repeat(20)}`, descriptor = `0x${"66".repeat(20)}`;
const request = { chainId: 11155111, store: `0x${"77".repeat(20)}`, objectId: root };
const payload = Uint8Array.of(7);
const digest = bytes => `0x${createHash("sha256").update(bytes).digest("hex")}`;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function within(promise) {
  let timer;
  return Promise.race([promise, new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Reader did not settle within the test deadline")), 400);
  })]).finally(() => clearTimeout(timer));
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const record = (bytes, composite = false, chunkCount = 1) => ({
  digest: digest(bytes), byteLength: bytes.length, storedByteLength: bytes.length,
  chunkCount, compression: 0, composite,
});
function leafClient(overrides = {}) {
  return {
    async getObject() { return record(payload); },
    async getObjectSlugPointers() { return [pointer]; },
    async getObjectPartIds() { assert.fail("Leaf must not read object IDs"); },
    async getCode() { return Uint8Array.of(0, ...payload); },
    ...overrides,
  };
}

for (const indirect of [false, true]) {
  test(`recursive reader rejects ${indirect ? "two-object" : "self"} cycles before cached-promise reuse`, async () => {
    let metadataReads = 0;
    const reader = createKeelHoldObjectReader(leafClient({
      async getObject() { metadataReads++; return record(payload, true); },
      async getObjectPartIds({ objectId }) { return [indirect && objectId === root ? left : root]; },
    }));
    await assert.rejects(within(reader(request, new AbortController().signal)), /KeelHold object cycle/u);
    assert.equal(metadataReads, indirect ? 2 : 1);
  });
}

test("recursive reader preserves verified shared DAG bytes and reads a reused leaf once", async () => {
  const calls = new Map();
  const joined = Uint8Array.of(7, 7);
  const children = new Map([[root, [left, right]], [left, [shared]], [right, [shared]]]);
  let carrierReads = 0;
  const reader = createKeelHoldObjectReader(leafClient({
    async getObject({ objectId }) {
      calls.set(objectId, (calls.get(objectId) ?? 0) + 1);
      return record(objectId === root ? joined : payload, children.has(objectId), children.get(objectId)?.length ?? 1);
    },
    async getObjectPartIds({ objectId }) { return children.get(objectId); },
    async getCode() { carrierReads++; return Uint8Array.of(0, ...payload); },
  }), { maxNodes: 4 });
  assert.deepEqual(await within(reader(request, new AbortController().signal)), joined);
  assert.equal(calls.get(shared), 1);
  assert.equal(calls.size, 4);
  assert.equal(carrierReads, 1);
});

test("pre-aborted reads preserve the exact reason without starting a client operation", async () => {
  const controller = new AbortController(), reason = { kind: "caller-stopped" };
  controller.abort(reason);
  const reader = createKeelHoldObjectReader(leafClient({ getObject() { assert.fail("No read after pre-abort"); } }));
  await assert.rejects(within(reader(request, controller.signal)), error => error === reason);
});

test("abort settles an uncooperative metadata read and discards its late response", async () => {
  const entered = deferred(), result = deferred(), controller = new AbortController();
  const reason = { kind: "metadata-cancelled" };
  let pages = 0;
  const reader = createKeelHoldObjectReader(leafClient({
    async getObject() { entered.resolve(); return result.promise; },
    async getObjectSlugPointers() { pages++; return [pointer]; },
  }));
  const pending = reader(request, controller.signal);
  await entered.promise;
  controller.abort(reason);
  await assert.rejects(within(pending), error => error === reason);
  result.resolve(record(payload));
  await tick();
  assert.equal(pages, 0);
});

test("cancelled pointer pagination preserves the abort reason and does not start descriptor fallback", async () => {
  const entered = deferred(), result = deferred(), controller = new AbortController();
  const reason = new Error("pointer-page-cancelled");
  let codeReads = 0;
  const reader = createKeelHoldObjectReader(leafClient({
    async getObject() { return { ...record(payload), descriptorPointer: descriptor }; },
    async getObjectSlugPointers() { entered.resolve(); return result.promise; },
    async getCode() { codeReads++; assert.fail("No descriptor or carrier read after abort"); },
  }));
  const pending = reader(request, controller.signal);
  await entered.promise;
  controller.abort(reason);
  await assert.rejects(within(pending), error => error === reason);
  result.reject(new Error("late page transport failure"));
  await tick();
  assert.equal(codeReads, 0);
});

for (const lateFailure of [false, true]) {
  test(`abort settles pending decompression and discards a late ${lateFailure ? "failure" : "valid result"}`, async () => {
    const entered = deferred(), result = deferred(), controller = new AbortController();
    const reason = new Error("decode-cancelled");
    const reader = createKeelHoldObjectReader(leafClient({
      async getObject() { return { ...record(payload), compression: 1 }; },
    }), { decompress: async () => { entered.resolve(); return result.promise; } });
    const pending = reader(request, controller.signal);
    await entered.promise;
    controller.abort(reason);
    await assert.rejects(within(pending), error => error === reason);
    if (lateFailure) result.reject(new Error("late decoder failure"));
    else result.resolve(payload);
    await tick();
    await assert.rejects(pending, error => error === reason);
  });
}

test("decompression that aborts while returning bytes cannot report a successful read", async () => {
  const controller = new AbortController(), reason = "stopped-in-decoder";
  const reader = createKeelHoldObjectReader(leafClient({
    async getObject() { return { ...record(payload), compression: 1 }; },
  }), { decompress: async () => { controller.abort(reason); return payload; } });
  await assert.rejects(within(reader(request, controller.signal)), error => error === reason);
});

test("default gzip decoding still verifies the exact decoded payload", async () => {
  const packed = gzipSync(payload);
  const reader = createKeelHoldObjectReader(leafClient({
    async getObject() { return { ...record(payload), compression: 1, storedByteLength: packed.length }; },
    async getCode() { return Uint8Array.of(0, ...packed); },
  }));
  assert.deepEqual(await within(reader(request, new AbortController().signal)), payload);
});

test("abort interrupts a pending custom digest without accepting a late valid hash", async () => {
  const entered = deferred(), result = deferred(), controller = new AbortController();
  const reason = new Error("digest-cancelled");
  const reader = createKeelHoldObjectReader(leafClient(), {
    digestAlgorithm: "keccak256",
    customDigest: async () => { entered.resolve(); return result.promise; },
  });
  const pending = reader(request, controller.signal);
  await entered.promise;
  controller.abort(reason);
  await assert.rejects(within(pending), error => error === reason);
  result.resolve(Uint8Array.from(Buffer.from(digest(payload).slice(2), "hex")));
  await tick();
  await assert.rejects(pending, error => error === reason);
});

test("carrier fanout shares one abort listener and starts no further reads after cancellation", async () => {
  const entered = deferred(), result = deferred(), controller = new AbortController();
  const reason = new Error("carrier-cancelled"), signal = controller.signal;
  let added = 0, removed = 0, codeReads = 0;
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (...args) => { if (args[0] === "abort") added++; return add(...args); };
  signal.removeEventListener = (...args) => { if (args[0] === "abort") removed++; return remove(...args); };
  const reader = createKeelHoldObjectReader(leafClient({
    async getObject() { return record(new Uint8Array(13), false, 13); },
    async getObjectSlugPointers() { return Array(13).fill(pointer); },
    async getCode() { if (++codeReads === 12) entered.resolve(); return result.promise; },
  }));
  const pending = reader(request, signal);
  await entered.promise;
  controller.abort(reason);
  await assert.rejects(within(pending), error => error === reason);
  result.resolve(Uint8Array.of(0, 7));
  await tick();
  assert.equal(codeReads, 12);
  assert.equal(added, 1);
  assert.equal(removed, 1);
});
