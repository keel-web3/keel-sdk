import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(new URL("../packages/sdk/package.json", import.meta.url));
const { decodeFunctionData, encodeFunctionResult, getAddress, toHex } = require("viem");
import {
  defineKeelMintSeedLayout, defineKeelMintSeedProfile, keelMintSeedFieldIndex,
  decodeKeelMintSeedField, packKeelMintSeedField, unpackKeelMintSeedField,
  packKeelMintSeedWords, packKeelMintSeedProfileWords, prepareKeelMintSeedUpdates,
  hashKeelMintSeedWords, KEEL_COMPACT_SEED_FIELDS,
} from "../packages/sdk/dist/mint-seeded.js";
import { keelMintSeededDataAbi, readKeelMintSeededData } from "../packages/sdk/dist/mint-seeded-data.js";
import { readOnchainData, buildOnchainDataFragment, assertOnchainDataRoundTrip } from "../packages/sdk/dist/onchain-data.js";

const MAX = (1n << 256n) - 1n;
const ADDRESS = "0x1234567890123456789012345678901234567890";
const record = { address: ADDRESS, recordId: "340282366920938463463374607431768211457" };

test("default profile has only a full seed; address and ID are optional", () => {
  const profile = defineKeelMintSeedProfile();
  assert.deepEqual(profile.layout.fields.map(f => f.name), ["seed"]);
  assert.equal(profile.seedField, 256n);
  const compact = defineKeelMintSeedLayout(KEEL_COMPACT_SEED_FIELDS);
  assert.equal(compact.wordCount, 1);
  assert.deepEqual(packKeelMintSeedWords(compact, { id: 7n, seed: 42n }), [{ wordIndex: 0, value: 7n << 224n | 42n }]);
});

test("profiles allocate multiple words, store addresses losslessly, and reject truncation", () => {
  const profile = defineKeelMintSeedProfile({ fields: [
    { name: "creator", format: "address" }, { name: "equipment", bits: 96 },
    { name: "seed", format: "bytes32" }, { name: "revealed", format: "bool" },
  ], seed: { kind: "field", name: "seed" } });
  const words = packKeelMintSeedProfileWords(profile, { creator: ADDRESS, equipment: (1n << 96n) - 1n,
    seed: toHex(MAX, { size: 32 }), revealed: true });
  assert.equal(words.length, 3);
  assert.equal(unpackKeelMintSeedField(words[0].value, profile.layout.byName.creator.index), BigInt(ADDRESS));
  assert.equal(words[1].value, MAX);
  assert.equal(words[2].value, 1n);
  assert.throws(() => packKeelMintSeedProfileWords(profile, { creator: toHex(MAX, { size: 32 }) }), /address/);
  assert.throws(() => packKeelMintSeedProfileWords(profile, { equipment: 1n << 96n }), /fit field/);
  assert.throws(() => packKeelMintSeedProfileWords(profile, { equipment: 12 }), /bigint/);
  assert.throws(() => packKeelMintSeedProfileWords(profile, { revealed: 1n }), /boolean/);
  assert.throws(() => defineKeelMintSeedProfile({ fields: [{ name: "creator", format: "address", bits: 64 }] }), /160 bits/);
});

test("profiles allow a seed field, whole word, whole record, or host derivation", () => {
  const fields = [{ name: "gear", bits: 64 }, { name: "roll", bits: 192 }];
  const field = defineKeelMintSeedProfile({ fields, seed: { kind: "field", name: "roll" } });
  assert.equal(field.seedField, keelMintSeedFieldIndex(0, 64, 192));
  const entire = defineKeelMintSeedProfile({ fields });
  assert.equal(entire.seedField, 256n);
  const hashed = defineKeelMintSeedProfile({ fields, seed: { kind: "words", start: 0, count: 1 } });
  assert.equal(hashed.seedField, 0n);
  const host = defineKeelMintSeedProfile({ fields, seed: { kind: "host" } });
  assert.equal(host.seedField, 0n);
  assert.equal(new Set([field, entire, hashed, host].map(p => p.profileId)).size, 4);
  assert.throws(() => defineKeelMintSeedProfile({ fields, seed: { kind: "field", name: "missing" } }), /Unknown/);
  assert.throws(() => defineKeelMintSeedProfile({ fields, seed: { kind: "words", start: 0xffffffff, count: 2 } }), /overflow/);
});

test("profiles reject overlapping, duplicate, reserved and malformed fields", () => {
  assert.throws(() => defineKeelMintSeedLayout([{ name: "a", bits: 8 }, { name: "a", bits: 8 }]), /duplicate/);
  assert.throws(() => defineKeelMintSeedLayout([{ name: "a", bits: 8 }, { name: "b", bits: 8, wordIndex: 0, offset: 0 }]), /overlap/);
  assert.throws(() => defineKeelMintSeedLayout([{ name: "a", bits: 8, offset: 3 }]), /both/);
  assert.throws(() => defineKeelMintSeedProfile({ fields: [{ name: "__proto__", bits: 8 }] }), /identifiers/);
  for (const [offset, width] of [[0, 0], [0, 257], [255, 2], [256, 1], [-1, 1]]) {
    assert.throws(() => keelMintSeedFieldIndex(0, offset, width));
  }
  for (const index of [0n, 511n, 1n << 49n | 256n, -1n]) assert.throws(() => decodeKeelMintSeedField(index));
});

test("sparse maximum indices do not allocate an enormous array", () => {
  const layout = defineKeelMintSeedLayout([{ name: "value", bits: 256, wordIndex: 0xffffffff, offset: 0 }]);
  assert.equal(layout.wordCount, 0x100000000);
  assert.deepEqual(packKeelMintSeedWords(layout, { value: MAX }), [{ wordIndex: 0xffffffff, value: MAX }]);
  assert.equal(decodeKeelMintSeedField(layout.byName.value.index).wordIndex, 0xffffffff);
});

test("grouped updates keep explicit placements and sort by word without changing named values", () => {
  const layout = defineKeelMintSeedLayout([
    { name: "later", bits: 8, wordIndex: 7, offset: 128 },
    { name: "early", bits: 8, wordIndex: 0, offset: 16 },
  ]);
  const updates = prepareKeelMintSeedUpdates(layout, { later: 5n, early: 6n });
  assert.deepEqual(updates.fields, [layout.byName.early.index, layout.byName.later.index]);
  assert.deepEqual(updates.values, [6n, 5n]);
  assert.throws(() => prepareKeelMintSeedUpdates(layout, { missing: 0n }), /Unknown/);
});

test("every bit width round-trips max values without touching neighboring bits", () => {
  for (let bits = 1; bits <= 256; bits += 1) {
    const offset = 256 - bits;
    const index = keelMintSeedFieldIndex(17, offset, bits);
    const mask = (1n << BigInt(bits)) - 1n;
    assert.equal(packKeelMintSeedField(MAX, index, mask), MAX);
    assert.equal(unpackKeelMintSeedField(MAX, index), mask);
    assert.equal(packKeelMintSeedField(MAX, index, 0n), MAX ^ mask << BigInt(offset));
  }
  assert.equal(hashKeelMintSeedWords([]), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
});

function fixture(overrides = {}) {
  const profile = defineKeelMintSeedProfile({ fields: [
    { name: "seed", format: "bytes32" }, { name: "creator", format: "address" }, { name: "equipment", bits: 96 },
  ] });
  const words = packKeelMintSeedProfileWords(profile, { seed: toHex(MAX, { size: 32 }), creator: ADDRESS, equipment: 7n });
  const calls = [];
  const call = async data => {
    const { functionName, args } = decodeFunctionData({ abi: keelMintSeededDataAbi, data });
    calls.push({ functionName, args });
    let result;
    if (functionName === "supportsInterface") result = true;
    if (functionName === "keelMintSeededProfile") result = [profile.profileId, profile.names, profile.layout.fields.map(f => f.index), profile.formatCodes, profile.seedField];
    if (functionName === "keelMintSeededWord") result = words.find(w => w.wordIndex === args[1])?.value ?? 0n;
    if (functionName === "keelMintSeededSeed") result = toHex(42n, { size: 32 });
    if (overrides[functionName]) return overrides[functionName](result, args);
    return encodeFunctionResult({ abi: keelMintSeededDataAbi, functionName, result });
  };
  return { profile, call, calls };
}

test("automatic discovery decodes each word once and gets seed without a duplicate read", async () => {
  const { call, calls } = fixture();
  const data = await readKeelMintSeededData(record, call);
  assert.equal(data.seed, toHex(MAX, { size: 32 }));
  assert.equal(data.fields.creator, getAddress(ADDRESS));
  assert.equal(data.fields.equipment, 7);
  assert.equal(data.recordId, record.recordId);
  assert.equal(calls.filter(c => c.functionName === "keelMintSeededWord").length, 2);
  assert.equal(calls.filter(c => c.functionName === "keelMintSeededSeed").length, 0);
  assert.equal(calls.find(c => c.functionName === "keelMintSeededProfile").args[0].toString(), record.recordId);
});

test("host-computed seed is used only when the profile selects it", async () => {
  const { call, calls } = fixture({ keelMintSeededProfile: result => encodeFunctionResult({ abi: keelMintSeededDataAbi,
    functionName: "keelMintSeededProfile", result: [...result.slice(0, 4), 0n] }) });
  const data = await readKeelMintSeededData(record, call);
  assert.equal(data.seed, toHex(42n, { size: 32 }));
  assert.equal(calls.filter(c => c.functionName === "keelMintSeededSeed").length, 1);
});

test("different records can select different profiles with different optional fields", async () => {
  const onlySeed = defineKeelMintSeedProfile();
  const { call } = fixture({ keelMintSeededProfile: (result, args) => encodeFunctionResult({ abi: keelMintSeededDataAbi,
    functionName: "keelMintSeededProfile", result: args[0] === 2n
      ? [onlySeed.profileId, onlySeed.names, onlySeed.layout.fields.map(f => f.index), onlySeed.formatCodes, onlySeed.seedField]
      : result }) });
  const first = await readKeelMintSeededData({ ...record, recordId: "1" }, call);
  const second = await readKeelMintSeededData({ ...record, recordId: "2" }, call);
  assert.notEqual(first.profileId, second.profileId);
  assert.ok(Object.hasOwn(first.fields, "creator"));
  assert.ok(!Object.hasOwn(second.fields, "creator"));
  assert.equal(second.words.length, 1);
});

test("absent capability is optional; broken supported profiles and transport errors fail", async () => {
  assert.equal(await readKeelMintSeededData(record, async () => "0x"), undefined);
  assert.equal(await readKeelMintSeededData(record, async () => toHex(0n, { size: 32 })), undefined);
  await assert.rejects(readKeelMintSeededData(record, async () => { throw new Error("offline"); }), /offline/);
  await assert.rejects(readKeelMintSeededData(record, async () => toHex(2n, { size: 32 })), /capability/);
  const broken = fixture({ keelMintSeededProfile: () => "0x" });
  await assert.rejects(readKeelMintSeededData(record, broken.call));
  await assert.rejects(readKeelMintSeededData({ ...record, maxWords: 1 }, fixture().call), /budget/);
  await assert.rejects(readKeelMintSeededData({ ...record, maxFields: 1 }, fixture().call), /dimensions/);
  const malformed = fixture({ keelMintSeededWord: () => "0x01" });
  await assert.rejects(readKeelMintSeededData(record, malformed.call), /word response/);
  await assert.rejects(readKeelMintSeededData({ ...record, recordId: Number.MAX_SAFE_INTEGER + 1 }, fixture().call), /exact/);
  await assert.rejects(readKeelMintSeededData({ ...record, recordId: "" }, fixture().call), /exact/);
});

test("untrusted profile names, overlaps, dimensions, and formats are checked before reading words", async () => {
  for (const change of [
    result => { result[1] = result[1].slice(1); },
    result => { result[1] = [toHex("__proto__", { size: 32 }), ...result[1].slice(1)]; },
    result => { result[2] = [result[2][0], result[2][0], result[2][2]]; },
    result => { result[3] = [1, ...result[3].slice(1)]; },
    result => { result[3] = [4, ...result[3].slice(1)]; },
  ]) {
    const { call, calls } = fixture({ keelMintSeededProfile: result => {
      change(result);
      return encodeFunctionResult({ abi: keelMintSeededDataAbi, functionName: "keelMintSeededProfile", result });
    } });
    await assert.rejects(readKeelMintSeededData(record, call));
    assert.equal(calls.filter(c => c.functionName === "keelMintSeededWord").length, 0);
  }
});

test("MCP record preparation discovers fields without individual read declarations", async () => {
  const { createMcpServer } = await import("../packages/mcp/dist/index.js");
  const { call } = fixture();
  const previous = globalThis.fetch;
  let batches = 0;
  globalThis.fetch = async (_url, request) => {
    const rpc = JSON.parse(request.body);
    if (Array.isArray(rpc)) batches++;
    const respond = async item => ({ jsonrpc: "2.0", id: item.id,
      result: item.method === "eth_chainId" ? "0x7a69" : item.method === "eth_blockNumber" ? "0x2a"
        : await call(item.params[0].data) });
    const body = Array.isArray(rpc) ? await Promise.all(rpc.map(respond)) : await respond(rpc);
    return { ok: true, json: async () => body };
  };
  try {
    const server = await createMcpServer({ workspaceRoot: "." });
    await server.handle({ jsonrpc: "2.0", id: 0, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "seed-test", version: "1" } } });
    const response = await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
      name: "keel-onchain-data-prepare", arguments: { rpcUrl: "http://127.0.0.1:8545", reads: [], record: { ...record, batchSize: 1 } },
    } });
    assert.equal(response.result.isError, undefined, JSON.stringify(response.result));
    const result = response.result.structuredContent;
    assert.equal(result.initVerified, true);
    assert.deepEqual(result.variables, ["token"]);
    assert.equal(result.values.token.fields.creator, getAddress(ADDRESS));
    assert.equal(result.values.token.recordId, record.recordId);
    assert.equal(batches, 0);
  } finally { globalThis.fetch = previous; }
});

test("data module pins the snapshot and initializes a deeply frozen object before rendering", async () => {
  const { call } = fixture();
  const tags = [];
  const fetchImpl = async (_url, request) => {
    const rpc = JSON.parse(request.body);
    const respond = async item => {
      let result;
      if (item.method === "eth_chainId") result = "0x7a69";
      if (item.method === "eth_blockNumber") result = "0x2a";
      if (item.method === "eth_call") {
        tags.push(item.params[1]);
        result = await call(item.params[0].data);
      }
      return { jsonrpc: "2.0", id: item.id, result };
    };
    const body = Array.isArray(rpc) ? await Promise.all(rpc.map(respond)) : await respond(rpc);
    return { ok: true, json: async () => body };
  };
  const layer = await readOnchainData({ rpcUrl: "http://127.0.0.1:8545", reads: [], record, fetchImpl });
  assert.deepEqual(new Set(tags), new Set(["0x2a"]));
  assert.equal(layer.blockNumber, 42);
  const fragment = buildOnchainDataFragment(layer);
  assertOnchainDataRoundTrip(layer, fragment);
  assert.throws(() => assertOnchainDataRoundTrip({ ...layer, values: { ...layer.values, extra: 1 } }, fragment), /differ/);
  const context = vm.createContext({ atob, TextDecoder, Uint8Array });
  vm.runInContext(fragment.source + ";globalThis.rendered=KEEL.data.token.fields.creator;", context);
  assert.equal(context.rendered, getAddress(ADDRESS));
  assert.ok(Object.isFrozen(context.KEEL.data.token.fields));
  assert.ok(Object.isFrozen(context.KEEL.data.token.words[0]));
  assert.throws(() => vm.runInContext('"use strict"; KEEL.data.token.seed="changed";', context), /read only/);
  assert.equal(fragment.phase, "data");
  const historical = await readOnchainData({ rpcUrl: "http://127.0.0.1:8545", reads: [], record, fetchImpl, blockTag: "0x10" });
  assert.equal(historical.blockNumber, 16);
  await assert.rejects(readOnchainData({ rpcUrl: "x", reads: [], record, fetchImpl, blockTag: "pending" }), /snapshots/);
});
