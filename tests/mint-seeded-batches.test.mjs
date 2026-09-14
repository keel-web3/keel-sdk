import test from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, keccak256, toHex } from "viem";
import { deriveKeelMintBatchSeed } from "../packages/sdk/dist/mint-seeded.js";

test("shared seeds preserve every bit, including zero", () => {
  for (const seed of [toHex(0n, { size: 32 }), toHex((1n << 256n) - 1n, { size: 32 })]) {
    assert.equal(deriveKeelMintBatchSeed(seed, 1n, "shared"), seed);
    assert.equal(deriveKeelMintBatchSeed(seed, 1000n, "shared"), seed);
  }
});

test("derived seeds match the exact Solidity ABI domain and token ID", () => {
  const seed = keccak256(toHex("batch"));
  for (const id of [1n, 255n, 256n, 257n, (1n << 248n) - 1n]) {
    const expected = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
      [keccak256(toHex("keel.batch-seed@1")), seed, id],
    ));
    assert.equal(deriveKeelMintBatchSeed(seed, id, "derived"), expected);
  }
  assert.notEqual(deriveKeelMintBatchSeed(seed, 1n, "derived"), deriveKeelMintBatchSeed(seed, 2n, "derived"));
});

test("invalid modes, widths and token boundaries fail before building a seed", () => {
  const seed = toHex(0n, { size: 32 });
  for (const id of [0n, -1n, 1n << 248n, 1]) assert.throws(() => deriveKeelMintBatchSeed(seed, id, "shared"));
  assert.throws(() => deriveKeelMintBatchSeed("0x12", 1n, "derived"));
  assert.throws(() => deriveKeelMintBatchSeed(seed, 1n, "mutable"));
});
