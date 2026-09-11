import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseAbi, encodeErrorResult, decodeErrorResult, encodeEventTopics,
  encodeAbiParameters, decodeEventLog, encodeFunctionResult, decodeFunctionResult,
} from "viem";
import { keelSeedRegistryAbi } from "../packages/sdk/dist/abi.js";
import { isKeelDirectReadAllowed } from "../packages/sdk/dist/keel.js";
import { ABIS } from "../packages/sdk/dist/abis/keel-artifacts.generated.js";

const sdk = parseAbi(keelSeedRegistryAbi);
const contract = ABIS.KeelSeedRegistry;
const word = byte => `0x${byte.repeat(32)}`;
const address = byte => `0x${byte.repeat(20)}`;
const normalize = value => JSON.parse(JSON.stringify(value, (key, value) =>
  key === "internalType" || (key === "name" && value === "")
    || ((key === "indexed" || key === "anonymous") && value === false)
    ? undefined : value));

test("Seed SDK exposes every compiled function, error and event", () => {
  for (const type of ["function", "error", "event"]) {
    const actual = sdk.filter(item => item.type === type);
    const expected = contract.filter(item => item.type === type);
    assert.equal(actual.length, expected.length);
    for (const item of expected) {
      assert.deepEqual(normalize(actual.find(other => other.name === item.name)), normalize(item), item.name);
    }
  }
});

test("Seed module ABI matches the canonical contract package", () => {
  const canonical = JSON.parse(readFileSync(new URL("../../keel-contracts/modules/keel-artifacts/abi/KeelSeedRegistry.json", import.meta.url)));
  assert.deepEqual(contract, canonical);
});

test("Seed custom errors keep all ten selectors and decode through the SDK", () => {
  const errors = contract.filter(item => item.type === "error");
  assert.equal(errors.length, 10);
  for (const error of errors) {
    const data = encodeErrorResult({ abi: contract, errorName: error.name });
    assert.equal(data.length, 10);
    assert.equal(decodeErrorResult({ abi: sdk, data }).errorName, error.name);
  }
});

test("Seed event decodes every distinct value and retains all indexed identities", () => {
  const args = {
    harnessRevision: (1n << 64n) - 1n, rootSeed: word("11"), seedSetId: word("22"),
    harnessId: word("33"), provenanceDigest: word("44"), harnessManifestDigest: word("55"),
    revealer: address("66"), publisher: address("77"), collection: address("88"),
  };
  const event = contract.find(item => item.type === "event");
  assert.deepEqual(event.inputs.filter(item => item.indexed).map(item => item.name), ["harnessRevision", "seedSetId", "harnessId"]);
  const topics = encodeEventTopics({ abi: contract, eventName: "SeedSetPublished", args });
  const fields = event.inputs.filter(item => !item.indexed);
  const data = encodeAbiParameters(fields, fields.map(item => args[item.name]));
  assert.equal(topics.length, 4);
  assert.equal((data.length - 2) / 2, 192);
  assert.deepEqual(decodeEventLog({ abi: sdk, topics, data, strict: true }).args, args);
});

test("Seed record getters retain tuple order and full-width revisions and timestamps", () => {
  const result = {
    harnessId: word("11"), harnessRevision: (1n << 64n) - 1n, collection: address("22"),
    harnessManifestDigest: word("33"), rootSeed: word("44"), provenanceDigest: word("55"),
    createdAt: (1n << 64n) - 2n, publisher: address("66"), revealer: address("77"), exists: true,
  };
  for (const functionName of ["seedSet", "seedSetForHarnessRevision"]) {
    const data = encodeFunctionResult({ abi: contract, functionName, result });
    assert.deepEqual(decodeFunctionResult({ abi: sdk, functionName, data }), result);
  }
});

test("Seed direct reads allow the actual Harness getter", () => {
  assert.equal(isKeelDirectReadAllowed("keel-seed-registry", "seedSetForHarnessRevision"), true);
  assert.equal(isKeelDirectReadAllowed("keel-seed-registry", "seedSetForViewerRevision"), false);
  assert.equal(isKeelDirectReadAllowed("keel-seed-registry", "publishSeedSet"), false);
});
