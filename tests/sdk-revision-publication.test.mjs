import test from "node:test";
import assert from "node:assert/strict";
import {
  KEEL_AUTOMATIC_REVISION_MAX_STORED_BYTES,
  assertKeelRevisionUploadMatchesPlan,
  planKeelGraphRevision,
} from "../packages/sdk/dist/index.js";

const hex = (character) => `0x${character.repeat(64)}`;
const address = (character) => `0x${character.repeat(40)}`;
const integrity = (character, byteLength) => ({ algorithm: "sha256", digest: hex(character), byteLength });
const resource = ({ id, role, version, object, digest, bytes, stored = bytes, mediaType }) => ({
  id,
  role,
  version,
  store: address("a"),
  objectId: hex(object),
  mediaType,
  integrity: integrity(digest, bytes),
  storedByteLength: stored,
});

function fixture(bindingMode = "follow-latest") {
  const liveResources = [
    resource({ id: "keel.shell.top", role: "shell-prefix", version: 3, object: "a", digest: "1", bytes: 910, mediaType: "text/html" }),
    resource({ id: "keel.asset-display", role: "module", version: 6, object: "b", digest: "2", bytes: 2_944, stored: 2_102, mediaType: "text/javascript" }),
    resource({ id: "keel.gif-encoder", role: "module", version: 1, object: "c", digest: "3", bytes: 41_000, stored: 13_400, mediaType: "text/javascript" }),
    resource({ id: "creator.animation", role: "asset", version: 1, object: "d", digest: "4", bytes: 3_682_392, stored: 468_223, mediaType: "image/avif" }),
    resource({ id: "creator.entry", role: "entrypoint", version: 1, object: "e", digest: "5", bytes: 2_700, stored: 2_100, mediaType: "text/html" }),
    resource({ id: "keel.shell.bottom", role: "shell-suffix", version: 3, object: "f", digest: "6", bytes: 850, mediaType: "text/html" }),
  ];
  const changed = resource({ id: "keel.asset-display", role: "module", version: 7, object: "7", digest: "7", bytes: 3_176, stored: 2_811, mediaType: "text/javascript" });
  return {
    kind: "module-revision",
    bindingMode,
    changedResourceIds: ["keel.asset-display"],
    live: { chainId: 11_155_111, graphRegistry: address("b"), graphId: hex("8"), graphVersion: 12, resources: liveResources },
    candidate: {
      chainId: 11_155_111,
      graphRegistry: address("b"),
      graphId: hex("8"),
      graphVersion: 13,
      resources: liveResources.map((item) => item.id === changed.id ? changed : item),
    },
  };
}

test("graph revision planner stores one module and reuses every unchanged object", () => {
  const input = fixture();
  const plan = planKeelGraphRevision(input);
  assert.equal(plan.status, "review-only");
  assert.deepEqual(plan.graph, { chainId: 11_155_111, graphRegistry: address("b"), graphId: hex("8"), fromVersion: 12, toVersion: 13 });
  assert.deepEqual(plan.changedResources.map(({ id }) => id), ["keel.asset-display"]);
  assert.deepEqual(plan.reusedResources.map(({ id }) => id), ["keel.shell.top", "keel.gif-encoder", "creator.animation", "creator.entry", "keel.shell.bottom"]);
  assert.equal(plan.bytes.newStoredBytes, 2_811);
  assert.equal(plan.bytes.avoidedRepublishBytes, 910 + 13_400 + 468_223 + 2_100 + 850);
  assert.equal(plan.bytes.newStoredPercent, (2_811 / plan.bytes.candidateStoredBytes) * 100);
  assert.equal(plan.bytes.reusedStoredPercent, 100 - plan.bytes.newStoredPercent);
  assert.equal(plan.publication.tokenPresentationAction, "none-follow-latest");
  assert.equal(plan.automaticGate.maximumNewStoredBytes, KEEL_AUTOMATIC_REVISION_MAX_STORED_BYTES);
  assert.equal(assertKeelRevisionUploadMatchesPlan(plan, {
    chainId: 11_155_111,
    store: address("a"),
    mediaType: plan.changedResources[0].mediaType,
    integrity: plan.changedResources[0].integrity,
    storedByteLength: plan.changedResources[0].storedByteLength,
  }).id, "keel.asset-display");
});

test("graph revision planner rejects unrelated artwork republishing", () => {
  const input = structuredClone(fixture());
  const artworkIndex = input.candidate.resources.findIndex((item) => item.id === "creator.animation");
  const liveArtwork = input.live.resources.find((item) => item.id === "creator.animation");
  input.candidate.resources[artworkIndex] = {
    ...liveArtwork,
    version: liveArtwork.version + 1,
    objectId: hex("9"),
    integrity: integrity("9", liveArtwork.integrity.byteLength),
  };
  assert.throws(() => planKeelGraphRevision(input), /graph changes keel\.asset-display, creator\.animation|Unrelated resources/iu);
});

test("graph revision planner rejects redundant and oversized resource copies", () => {
  const redundant = structuredClone(fixture());
  const module = redundant.candidate.resources.find((item) => item.id === "keel.asset-display");
  module.integrity = structuredClone(redundant.live.resources.find((item) => item.id === "keel.asset-display").integrity);
  assert.throws(() => planKeelGraphRevision(redundant), /identical bytes/iu);

  const oversized = structuredClone(fixture());
  oversized.candidate.resources.find((item) => item.id === "keel.asset-display").storedByteLength = KEEL_AUTOMATIC_REVISION_MAX_STORED_BYTES + 1;
  assert.throws(() => planKeelGraphRevision(oversized), /above the 65536-byte safety limit/iu);
});

test("graph revision upload binding rejects any source other than the accepted delta", () => {
  const pinned = planKeelGraphRevision(fixture("pinned"));
  assert.equal(pinned.publication.tokenPresentationAction, "update-binding-only");
  assert.throws(() => assertKeelRevisionUploadMatchesPlan(pinned, {
    chainId: 11_155_111,
    store: address("a"),
    mediaType: pinned.changedResources[0].mediaType,
    integrity: integrity("a", pinned.changedResources[0].integrity.byteLength),
    storedByteLength: pinned.changedResources[0].storedByteLength,
  }), /does not match the only permitted changed resource/iu);
});
