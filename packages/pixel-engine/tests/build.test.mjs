// Every project with a keel-entry.js bundles into one script KEEL can hold:
// it builds, it parses, and it stays small (KeelHold stores it gzipped).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUDGET_KB = 300; // (stored, gzip -- NOCTURNES' own ceiling)
const projects = readdirSync(join(root, "projects")).filter((p) => existsSync(join(root, "projects", p, "keel-entry.js")));

for (const p of projects) {
  test(`${p} bundles for KEEL`, () => {
    execFileSync(process.execPath, [join(root, "scripts/build-keel.mjs"), p], { cwd: root, stdio: "pipe" });
    const file = join(root, "keel", p, `${p}.js`);
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    const kb = gzipSync(readFileSync(file), { level: 9 }).byteLength / 1024;
    assert.ok(kb <= BUDGET_KB, `${p}: ${kb.toFixed(1)} KB stored, over ${BUDGET_KB}`);
    // (A game carries no GIF encoder and no capture code unless its entry asks for them: output formats are opt-in.)
    const code = readFileSync(file, "utf8");
    if (!/capture\/capture\.js|core\/gif\.js/.test(readFileSync(join(root, "projects", p, "keel-entry.js"), "utf8"))) {
      assert.ok(!code.includes('"src/core/gif.js"') && !code.includes('"src/capture/capture.js"'), `${p}: the bundle pulled in capture/GIF code it didn't ask for`);
    }
  });
}
