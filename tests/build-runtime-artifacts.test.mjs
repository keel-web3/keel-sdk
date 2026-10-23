import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanBuildOutputs } from "../scripts/build-output.mjs";

const root = new URL("../", import.meta.url);

test("normal build supplies the declared public wrapper-viewer runtime", async () => {
  const viewer = await import("@keel/viewer/wrapper-viewer");
  assert.equal(typeof viewer.keelWrapperViewerDocument, "function");
  assert.match(viewer.keelWrapperViewerDocument({ title: "Build artifact smoke" }), /<!doctype html>/iu);
});

test("normal build packages exact current storage policy documents", async () => {
  for (const name of ["KEEL_PAYLOAD_STORAGE.md", "KEEL_BINARY_RESOURCE_DELIVERY.md", "KEEL_INLINE_PAYLOAD_BOUNDARIES.md"]) {
    assert.deepEqual(await readFile(new URL(`packages/sdk/dist/docs/${name}`, root)), await readFile(new URL(`docs/${name}`, root)));
  }
});

test("normal build refreshes the dependency-free mint-queue public entry", async () => {
  const pkg = JSON.parse(await readFile(new URL("packages/mint-queue/package.json", root), "utf8"));
  for (const [source, exported] of [["mint-queue.js", pkg.exports["."].default], ["mint-queue.d.ts", pkg.exports["."].types]]) {
    assert.deepEqual(await readFile(new URL(`packages/mint-queue/${exported}`, root)), await readFile(new URL(`packages/sdk/dist/${source}`, root)));
  }
  const queue = await import(new URL(`packages/mint-queue/${pkg.exports["."].default}`, root));
  assert.equal(typeof queue.projectMintQueue, "function");
});

test("clean build removes stale mint-queue output and keeps unrelated source", async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), "keel-build-mint-queue-"));
  try {
    const dist = path.join(scratch, "packages/mint-queue/dist");
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, "retired-output.js"), "stale");
    await writeFile(path.join(scratch, "packages/mint-queue/source.txt"), "preserve");
    await cleanBuildOutputs(scratch);
    await assert.rejects(access(dist), { code: "ENOENT" });
    assert.equal(await readFile(path.join(scratch, "packages/mint-queue/source.txt"), "utf8"), "preserve");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
