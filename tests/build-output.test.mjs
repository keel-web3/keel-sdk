import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPackages, cleanBuildOutputs } from "../scripts/build-output.mjs";

test("a repeated build removes stale modules while retaining source, evidence and assets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "keel-build-output-"));
  try {
    for (const name of buildPackages) {
      const dir = path.join(root, "packages", name);
      await mkdir(path.join(dir, "dist", "old-runtime"), { recursive: true });
      await mkdir(path.join(dir, "src"));
      await writeFile(path.join(dir, "dist", "old-runtime", "deleted.js"), "stale");
      await writeFile(path.join(dir, "src", "current.ts"), "source");
    }
    for (const name of [".verification", "assets", "packages/contracts/artifacts"]) {
      await mkdir(path.join(root, name), { recursive: true });
      await writeFile(path.join(root, name, "preserved"), "evidence");
    }
    await cleanBuildOutputs(root);
    await cleanBuildOutputs(root); // Retry after interrupted/missing output is safe.
    for (const name of buildPackages) {
      await assert.rejects(lstat(path.join(root, "packages", name, "dist")), { code: "ENOENT" });
      assert.equal(await readFile(path.join(root, "packages", name, "src", "current.ts"), "utf8"), "source");
    }
    for (const name of [".verification", "assets", "packages/contracts/artifacts"]) {
      assert.equal(await readFile(path.join(root, name, "preserved"), "utf8"), "evidence");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cleaning a linked dist preserves the external target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "keel-linked-output-"));
  try {
    const target = path.join(root, "retained-build");
    await mkdir(target);
    await writeFile(path.join(target, "receipt.json"), "retained");
    await mkdir(path.join(root, "packages", "sdk"), { recursive: true });
    await symlink(target, path.join(root, "packages", "sdk", "dist"), "dir");
    await cleanBuildOutputs(root);
    assert.equal(await readFile(path.join(target, "receipt.json"), "utf8"), "retained");
    await assert.rejects(lstat(path.join(root, "packages", "sdk", "dist")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
