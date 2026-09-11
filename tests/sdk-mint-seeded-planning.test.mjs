import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(new URL("../packages/sdk/package.json", import.meta.url));
const { decodeFunctionData, encodeFunctionResult, toHex } = require("viem");
import { planKeelMintSeedProfile, defineKeelMintSeedProfile, packKeelMintSeedProfileWords,
  unpackKeelMintSeedField } from "../packages/sdk/dist/mint-seeded.js";
import { keelMintSeededDataAbi } from "../packages/sdk/dist/mint-seeded-data.js";
import { readOnchainData } from "../packages/sdk/dist/onchain-data.js";

test("new profiles fill holes, keep names in order and leave the original layout intact", () => {
  const input = { fields: [160, 160, 96, 96].map((bits, i) => ({ name: `f${i}`, bits })), seed: { kind: "field", name: "f0" } };
  const original = defineKeelMintSeedProfile(input);
  const plan = planKeelMintSeedProfile(input);
  assert.equal(plan.sequentialWords, 3);
  assert.equal(plan.packedWords, 2);
  assert.equal(plan.savedWords, 1);
  assert.equal(plan.sequentialProfile.profileId, original.profileId);
  assert.notEqual(plan.profile.profileId, original.profileId);
  assert.deepEqual(plan.profile.layout.fields.map(f => f.name), ["f0", "f1", "f2", "f3"]);
  assert.equal(defineKeelMintSeedProfile(input).profileId, original.profileId);
  assert.ok(Object.isFrozen(plan.profile.layout.fields[0]));
  assert.equal(planKeelMintSeedProfile().savedWords, 0);
});

test("explicit ranges stay pinned, sparse indices stay sparse, equal-size plans retain identity", () => {
  const plan = planKeelMintSeedProfile({ fields: [
    { name: "fixed", bits: 160, wordIndex: 5, offset: 0 },
    { name: "other", bits: 160 }, { name: "left", bits: 96 }, { name: "right", bits: 96 },
  ], seed: { kind: "field", name: "fixed" } });
  assert.equal(plan.profile.layout.byName.fixed.index, plan.sequentialProfile.layout.byName.fixed.index);
  assert.equal(plan.savedWords, 1);
  const sparse = planKeelMintSeedProfile({ fields: [{ name: "seed", bits: 256, wordIndex: 0xffffffff, offset: 0 }], seed: { kind: "field", name: "seed" } });
  assert.equal(sparse.packedWords, 1);
  assert.equal(sparse.profile.layout.wordCount, 0x100000000);
  assert.equal(sparse.profile.profileId, sparse.sequentialProfile.profileId);
  assert.throws(() => planKeelMintSeedProfile({ fields: [{ name: "bad", bits: 0 }] }), /fit/);
});

test("address formats survive optimized placement without hashing or truncation", () => {
  const plan = planKeelMintSeedProfile({ fields: [
    { name: "creator", format: "address" }, { name: "recipient", format: "address" },
    { name: "left", bits: 96 }, { name: "right", bits: 96 },
  ], seed: { kind: "field", name: "left" } });
  const creator = "0xffffffffffffffffffffffffffffffffffffffff";
  const recipient = "0x1234567890123456789012345678901234567890";
  const words = new Map(packKeelMintSeedProfileWords(plan.profile, { creator, recipient, left: 42n, right: 77n }).map(w => [w.wordIndex, w.value]));
  assert.equal(plan.savedWords, 1);
  for (const [name, value] of [["creator", creator], ["recipient", recipient]]) {
    const field = plan.profile.layout.byName[name];
    assert.equal(unpackKeelMintSeedField(words.get(field.wordIndex), field.index), BigInt(value));
  }
  assert.equal(plan.profile.seedField, plan.profile.layout.byName.left.index);
});

test("1000 deterministic layouts preserve every field at maximum value and never use more words", () => {
  let state = 90210;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const fields = Array.from({ length: random() % 64 + 1 }, (_, i) => ({ name: `f${i}`, bits: random() % 256 + 1 }));
    const plan = planKeelMintSeedProfile({ fields, seed: { kind: "field", name: "f0" } });
    assert.ok(plan.packedWords <= plan.sequentialWords);
    const values = Object.fromEntries(fields.map(f => [f.name, (1n << BigInt(f.bits)) - 1n]));
    const words = new Map(packKeelMintSeedProfileWords(plan.profile, values).map(w => [w.wordIndex, w.value]));
    for (const field of plan.profile.layout.fields) assert.equal(unpackKeelMintSeedField(words.get(field.wordIndex), field.index), values[field.name]);
    assert.equal(planKeelMintSeedProfile({ fields, seed: { kind: "field", name: "f0" } }).profile.profileId, plan.profile.profileId);
  }
});

function provider({ count = 130, alter, unsupported = false } = {}) {
  const requests = [];
  const profile = defineKeelMintSeedProfile({ fields: Array.from({ length: count }, (_, i) => ({ name: `w${i}`, bits: 256 })) });
  const respond = request => {
    let result;
    if (request.method === "eth_chainId") result = "0x7a69";
    else if (request.method === "eth_blockNumber") result = "0x2a";
    else {
      assert.equal(request.params[1], "0x2a");
      const { functionName, args } = decodeFunctionData({ abi: keelMintSeededDataAbi, data: request.params[0].data });
      const value = functionName === "supportsInterface" ? true : functionName === "keelMintSeededProfile"
        ? [profile.profileId, profile.names, profile.layout.fields.map(f => f.index), profile.formatCodes, profile.seedField]
        : BigInt(args[1]) + 1n;
      result = encodeFunctionResult({ abi: keelMintSeededDataAbi, functionName, result: value });
    }
    return { jsonrpc: "2.0", id: request.id, result };
  };
  return { requests, fetchImpl: async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    if (Array.isArray(request)) {
      if (unsupported) return { ok: true, json: async () => ({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "batch unsupported" } }) };
      const response = request.map(respond).reverse();
      return { ok: true, json: async () => alter ? alter(response) : response };
    }
    return { ok: true, json: async () => respond(request) };
  } };
}

const options = { rpcUrl: "http://local.test", reads: [], record: { address: "0x1234567890123456789012345678901234567890", recordId: "1" } };

test("130 words use three bounded batches and reordered replies preserve word identity", async () => {
  const rpc = provider();
  const result = await readOnchainData({ ...options, fetchImpl: rpc.fetchImpl });
  assert.deepEqual(rpc.requests.filter(Array.isArray).map(batch => batch.length), [64, 64, 2]);
  assert.equal(rpc.requests.length, 7);
  assert.equal(result.values.token.seed, toHex(1n, { size: 32 }));
  for (let i = 0; i < 130; i++) assert.equal(result.values.token.fields[`w${i}`], i + 1);
});

test("explicit unsupported-batch replies fall back once; batchSize 1 stays serial", async () => {
  const rpc = provider({ count: 5, unsupported: true });
  const result = await readOnchainData({ ...options, record: { ...options.record, batchSize: 2 }, fetchImpl: rpc.fetchImpl });
  assert.equal(result.values.token.fields.w4, 5);
  assert.equal(rpc.requests.filter(Array.isArray).length, 1);
  const serial = provider({ count: 5 });
  await readOnchainData({ ...options, record: { ...options.record, batchSize: 1 }, fetchImpl: serial.fetchImpl });
  assert.equal(serial.requests.filter(Array.isArray).length, 0);
});

test("missing, duplicate, unknown IDs, malformed words and per-call failures fail closed", async () => {
  for (const alter of [
    replies => replies.slice(1),
    replies => replies.map(() => replies[0]),
    replies => [{ ...replies[0], id: 999999 }, ...replies.slice(1)],
    replies => [{ ...replies[0], result: "0x01" }, ...replies.slice(1)],
    replies => [{ ...replies[0], error: { code: 3, message: "execution reverted" } }, ...replies.slice(1)],
    () => ({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "provider offline" } }),
  ]) {
    const rpc = provider({ count: 5, alter });
    await assert.rejects(readOnchainData({ ...options, fetchImpl: rpc.fetchImpl }));
    assert.equal(rpc.requests.length, 5);
  }
  for (const batchSize of [0, 257, 1.5]) await assert.rejects(readOnchainData({ ...options,
    record: { ...options.record, batchSize }, fetchImpl: provider().fetchImpl }), /batch size/);
});
