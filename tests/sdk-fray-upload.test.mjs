import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { keccak256 } from "viem";

import { KEEL_TEZOS_MODULES, createFrayKeelUploadPlan } from "../packages/sdk/dist/index.js";

// Octez mockup addresses (never live deployments).
const hold = "KT1NrHn1Rzp8vinyw1f9i8VzyAS7XcnQojgN";
const registry = "KT1S4Hhx4mobXcez38C8aiKeLiwtb18AnRUz";
const owner = "tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx";
const bytes = new TextEncoder().encode("x".repeat(5_000));
const sha = `0x${createHash("sha256").update(bytes).digest("hex")}`;
const identity = {
  hold,
  expected_index_root: `0x${"11".repeat(32)}`,
  expected_slug_count: 2,
  expected_stored_sha256: sha,
  expected_stored_byte_length: bytes.length,
  decoded_sha256: sha,
  decoded_byte_length: bytes.length,
  media_type: "0x746578742f706c61696e",
  compression: "0x6e6f6e65",
};
const objectId = `0x${"22".repeat(32)}`;
const plan = (tezos) => createFrayKeelUploadPlan({
  family: "tezos", network: "NetXynUjJNZm7wi", objectName: "fray.txt", mediaType: "text/plain", maxChunkBytes: 4_096,
  keccak256: (chunk) => keccak256(chunk), bytes, tezos: { keelHold: hold, checkpointRegistry: registry, owner, objectId, identity, ...tezos },
});

test("the Fray Tezos plan calls the checkpoint registry's real entrypoints with its owner-bound object ID", async () => {
  const result = await plan();
  const entrypoints = result.tezos.operations.map((operation) => operation.entrypoint);
  assert.deepEqual(entrypoints, ["write_chunk", "write_chunk", "begin_checkpoint", "append_checkpoint_slug", "append_checkpoint_slug", "seal_checkpoint"]);
  const catalog = Object.fromEntries(KEEL_TEZOS_MODULES.flatMap((module) => Object.entries(module.entrypoints)));
  const views = Object.fromEntries(KEEL_TEZOS_MODULES.flatMap((module) => Object.entries(module.views)));
  for (const operation of result.tezos.operations) {
    const contract = operation.contract === registry ? "KeelImmutableCheckpointRegistry" : "KeelHoldOnchFS";
    assert.ok(catalog[contract].includes(operation.entrypoint), `${contract}.${operation.entrypoint} is catalogued`);
  }
  assert.ok(views.KeelImmutableCheckpointRegistry.includes("predict_object_id"));
  assert.ok(views.KeelImmutableCheckpointRegistry.includes(result.tezos.readView));
  assert.deepEqual(result.tezos.objectIdView, { contract: registry, view: "predict_object_id", input: { owner, identity } });
  const appends = result.tezos.operations.filter((operation) => operation.kind === "append_checkpoint_slug");
  assert.deepEqual(appends.map((operation) => operation.slug_pointer), result.chunks.chunks.map((chunk) => chunk.slugId));
  assert.equal(result.tezos.owner, owner);
  assert.equal(result.signing, "not-performed");
});

test("the plan refuses a missing owner, a foreign Hold and a malformed object ID", async () => {
  await assert.rejects(plan({ owner: undefined }), /checkpoint owner/u);
  await assert.rejects(plan({ identity: { ...identity, hold: registry } }), /name the Hold/u);
  await assert.rejects(plan({ objectId: "0x22" }), /32 bytes/u);
});
