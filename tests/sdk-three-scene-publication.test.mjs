import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { decodeFunctionData, parseAbi } from "viem";

import {
  KEEL_NATIVE_CHUNK_BYTES,
  KEEL_NATIVE_CHUNKS_PER_TRANSACTION,
  KEEL_NATIVE_CARRIER_V1,
  KEEL_HISTORY_INSCRIPTION_V1,
  KEEL_THREE_SCENE_PUBLICATION_PROTOCOL,
  buildKeelPublicationPlan,
  buildKeelImmutableThreeScenePublicationPlan,
  keelHoldAbi,
  recoverKeelImmutableThreeScenePublication,
} from "../packages/sdk/dist/index.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const EXECUTOR = "0x2222222222222222222222222222222222222222";
const HOLD = "0x3333333333333333333333333333333333333333";

// The fixture is deliberately one immutable HTML scene. It is large enough to
// cross a native carrier boundary without importing a generated/binary asset.
const SCENE_BYTES = new TextEncoder().encode(
  `<!doctype html><script type="module">import * as THREE from "/content/three.js";const scene=new THREE.Scene();document.documentElement.dataset.scene="keel-one-of-one";</script>${"x".repeat(KEEL_NATIVE_CHUNK_BYTES * 3 + 17)}`,
);

function input(overrides = {}) {
  return {
    chainId: 31_337,
    owner: OWNER,
    executor: EXECUTOR,
    hold: HOLD,
    deadline: 2_000n,
    scene: {
      id: "keel-three-one",
      name: "Keel Three One",
      description: "One immutable Three.js scene.",
      bytes: SCENE_BYTES,
      mediaType: "text/html",
    },
    ...overrides,
  };
}

test("the exact one-of-one Three.js scene fixture uses native storage and default proof controls", async () => {
  const result = await buildKeelImmutableThreeScenePublicationPlan(input());

  assert.equal(result.protocol, KEEL_THREE_SCENE_PUBLICATION_PROTOCOL);
  assert.deepEqual(result.edition, { size: 1, serial: 1 });
  assert.equal(result.immutable, true);
  assert.equal(result.walletApproval, "required");
  assert.equal(result.signing, "not-performed");
  assert.equal(result.submitted, false);
  assert.equal(result.publication.storageMode, KEEL_NATIVE_CARRIER_V1);

  const manifest = result.viewer.manifest;
  assert.equal(manifest.runtime.content.manifestTrust, "digest");
  assert.equal(manifest.runtime.sandbox, "strict");
  assert.deepEqual(manifest.runtime.capabilities, {});
  assert.equal(manifest.revision.policy, "immutable");
  assert.equal(manifest.revision.frozen, true);
  assert.equal(manifest.entrypoint.resource, "scene");
  assert.deepEqual(manifest.fallback, { image: "scene", animation: "scene", backgroundColor: "#05060b" });

  const resource = manifest.resources.find(({ id }) => id === "scene");
  assert.ok(resource);
  assert.equal(resource.sources.length, 1);
  assert.equal(resource.sources[0].kind, "onchain");
  assert.equal(resource.sources[0].store, HOLD);
  assert.equal(resource.sources[0].objectId, result.sceneObjectId);
  assert.equal(resource.sources[0].integrity.byteLength, SCENE_BYTES.byteLength);
});

test("the scene publication has one logical weld operation and bounded native batches", async () => {
  const result = await buildKeelImmutableThreeScenePublicationPlan(input());
  const batches = result.publication.nativeCarrierBatches;

  assert.ok(batches);
  assert.equal(result.publication.operations.length, 1);
  assert.equal(batches.flat().length, 4);
  assert.ok(batches.every((batch) => batch.length >= 1 && batch.length <= KEEL_NATIVE_CHUNKS_PER_TRANSACTION));
  assert.ok(batches.flat().every((payload) => (payload.length - 2) / 2 <= KEEL_NATIVE_CHUNK_BYTES));
  assert.equal(result.publication.gas.chunkCount, 4);
  assert.equal(result.publication.gas.carrierTransactionCount, 2);

  const operation = result.publication.operations[0];
  assert.equal(operation.target, HOLD);
  assert.equal(decodeFunctionData({ abi: parseAbi(keelHoldAbi), data: operation.data }).functionName, "weldObject");
});

test("the scene cannot redirect or fund the reviewed Hold weld", async () => {
  await assert.rejects(
    buildKeelImmutableThreeScenePublicationPlan(input({ operationTarget: EXECUTOR })),
    /always welds to its reviewed Hold with zero value/u,
  );
  await assert.rejects(
    buildKeelImmutableThreeScenePublicationPlan(input({ operationValue: 1n })),
    /always welds to its reviewed Hold with zero value/u,
  );
});

test("the scene snapshots caller-owned bytes before hashing", async () => {
  const bytes = Uint8Array.from(SCENE_BYTES);
  const expected = Uint8Array.from(bytes);
  const promise = buildKeelImmutableThreeScenePublicationPlan(input({
    scene: { ...input().scene, bytes },
  }));
  bytes.fill(0x62);
  const result = await promise;
  const published = Uint8Array.from(
    result.publication.nativeCarrierBatches.flat().flatMap((payload) => [...Buffer.from(payload.slice(2), "hex")]),
  );

  assert.deepEqual(published, expected);
  assert.equal(result.sceneDigest, `0x${createHash("sha256").update(expected).digest("hex")}`);
});

test("history publication snapshots caller-owned bytes before hashing and batching", async () => {
  const bytes = new Uint8Array(50_000).fill(0x61);
  const expected = Uint8Array.from(bytes);
  const digest = `0x${createHash("sha256").update(expected).digest("hex")}`;
  const promise = buildKeelPublicationPlan({
    storageMode: KEEL_HISTORY_INSCRIPTION_V1,
    owner: OWNER,
    executor: EXECUTOR,
    deadline: 2_000n,
    decodedDigest: digest,
    storedDigest: digest,
    decodedByteLength: expected.byteLength,
    storedBytes: bytes,
    compression: "none",
    mediaType: "application/octet-stream",
    history: { chainId: 31_337, coordinator: HOLD, publicationIdForQuote: 42n },
  });
  bytes.fill(0x62);
  const result = await promise;
  const published = Uint8Array.from(
    result.historyBatches.flatMap((batch) => batch.payloads)
      .flatMap((payload) => [...Buffer.from(payload.slice(2), "hex")]),
  );

  assert.deepEqual(published, expected);
  assert.equal(result.storedDigest, digest);
});

test("receipt evidence resumes the immutable scene without a second wallet approval", async () => {
  const result = await buildKeelImmutableThreeScenePublicationPlan(input());
  const resumed = recoverKeelImmutableThreeScenePublication({
    plan: result,
    savedJobId: "41",
    confirmedJobIds: [42n],
    recovery: {
      planDigest: result.publication.planDigest,
      completedChunks: 3,
      completedOperations: 0,
      failedChunkIndexes: [2],
      failedOperationIndexes: [],
      transactionHashes: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    },
  });

  assert.equal(resumed.jobId, 42n);
  assert.equal(resumed.walletApproval, "not-requested");
  assert.equal(resumed.storageMode, KEEL_NATIVE_CARRIER_V1);
  assert.deepEqual(resumed.recovery.failedChunkIndexes, [2]);
  assert.equal(resumed.recovery.completedChunks, 3);
});

test("recovery omits an absent saved job id", async () => {
  const result = await buildKeelImmutableThreeScenePublicationPlan(input());
  const resumed = recoverKeelImmutableThreeScenePublication({
    plan: result,
    confirmedJobIds: [],
    recovery: {
      planDigest: result.publication.planDigest,
      completedChunks: 0,
      completedOperations: 0,
      failedChunkIndexes: [],
      failedOperationIndexes: [],
      transactionHashes: [],
    },
  });

  assert.equal("jobId" in resumed, false);
  assert.equal(resumed.walletApproval, "not-requested");
});

test("recovery rejects another immutable plan or job", async () => {
  const result = await buildKeelImmutableThreeScenePublicationPlan(input());
  const other = await buildKeelImmutableThreeScenePublicationPlan(input({ deadline: 2_001n }));
  const progress = {
    jobId: "99",
    planDigest: result.publication.planDigest,
    completedChunks: 1,
    completedOperations: 0,
    failedChunkIndexes: [],
    failedOperationIndexes: [],
    transactionHashes: [],
  };

  assert.throws(
    () => recoverKeelImmutableThreeScenePublication({
      plan: result,
      confirmedJobIds: [42n],
      recovery: progress,
    }),
    /different job/u,
  );
  assert.throws(
    () => recoverKeelImmutableThreeScenePublication({
      plan: result,
      confirmedJobIds: [99n],
      recovery: { ...progress, planDigest: other.publication.planDigest },
    }),
    /different immutable plan/u,
  );
});
