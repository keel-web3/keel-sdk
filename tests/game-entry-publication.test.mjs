import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineBuilds } from "../packages/game-engine/chain/build.mjs";

test("site and game publications use one module with distinct entries and optional audio scripts", async () => {
  const root = mkdtempSync(join(tmpdir(), "keel-entry-"));
  mkdirSync(join(root, "vendor"));
  const calls = [];
  const keel = {
    closureOf: () => [{ manifest: { id: "keel/audio" } }],
    keelAudioScripts: async () => ["audio-script"],
    buildGameDocument: async (gameId, workspace, options) => {
      calls.push({ gameId, workspace, options });
      return { html: new Uint8Array() };
    },
  };
  try {
    const builds = engineBuilds({ keel, root });
    const workspace = [];
    await builds.buildGame({ gameId: "mygames/redline", workspace });
    await builds.buildGame({ gameId: "mygames/redline", workspace, entryExport: "site" });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((call) => call.gameId), ["mygames/redline", "mygames/redline"]);
    assert.equal(calls[0].options.entryExport, "main");
    assert.deepEqual(calls[0].options.pageScripts, ["audio-script"]);
    assert.equal(calls[1].options.entryExport, "site");
    assert.equal(calls[1].options.pageScripts, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
