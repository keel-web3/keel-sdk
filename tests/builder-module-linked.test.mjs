// Linked modules: a module that imports its neighbours instead of bundling them
// (keel.module.json "build": { format, external }) -- what a multi-module engine
// needs, where every part is its own verified module. The format and the
// externals are recipe options, so they land in the recipe and its digest, the
// vector test builds the readable source the same way, the compact stage keeps
// a classic script strict, and a reproduction from a source archive repeats them.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

import { KEEL_MODULE_BUILD_OPTIONS, parseKeelModuleManifest, verifyKeelModuleFromOrigin } from "../packages/builder/dist/index.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(repositoryRoot, "packages/builder/dist/cli.js");
const runCli = (args) => execFileAsync(process.execPath, [cli, ...args], { cwd: repositoryRoot, maxBuffer: 16 * 1024 * 1024 });

const STRICT = {
  compilerOptions: {
    target: "ES2022", module: "ES2022", moduleResolution: "bundler", lib: ["ES2022", "DOM"],
    strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noEmit: true,
  },
  include: ["src/**/*.ts"],
};

async function linkedModule(root) {
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "keel.module.json"), `${JSON.stringify({
    protocol: "keel-module-manifest@1",
    name: "linked-demo",
    version: "0.1.0",
    description: "A classic-script module that links a neighbour instead of copying it.",
    entry: "src/index.ts",
    license: "MIT",
    sourceRepository: { url: "https://example.invalid/your-org/your-repo", revision: "replace-with-a-commit-hash", path: "." },
    build: { format: "iife", external: ["@demo/neighbour"] },
  }, null, 2)}\n`);
  await writeFile(path.join(root, "tsconfig.json"), `${JSON.stringify(STRICT, null, 2)}\n`);
  await writeFile(path.join(root, "src/neighbour.d.ts"), 'declare module "@demo/neighbour" {\n  export const value: number;\n}\n');
  await writeFile(path.join(root, "src/index.ts"), [
    '"use strict";',
    'import { value } from "@demo/neighbour";',
    "",
    "/** Sloppy mode would let this write succeed silently; strict mode throws. */",
    "function strictProbe(): boolean {",
    "  const frozen = Object.freeze({ a: 1 });",
    "  try {",
    "    (frozen as { a: number }).a = 2;",
    "    return false;",
    "  } catch {",
    "    return true;",
    "  }",
    "}",
    "",
    "(globalThis as { DEMO?: unknown }).DEMO = { answer: (): number => value + 1, strict: strictProbe };",
    "",
  ].join("\n"));
  // The host answers the linked import; here the vectors file plays the host.
  await writeFile(path.join(root, "test/vectors.mjs"), [
    'globalThis.require = (name) => (name === "@demo/neighbour" ? { value: 41 } : undefined);',
    "export default [",
    '  { name: "the linked import is answered by the host", run: () => globalThis.DEMO.answer(), expect: 42 },',
    '  { name: "the classic script stays strict", run: () => globalThis.DEMO.strict(), expect: true },',
    "];",
    "",
  ].join("\n"));
}

function tarGz(rootName, files) {
  const header = (name, size) => {
    const h = new Uint8Array(512);
    const put = (text, at, len) => h.set(new TextEncoder().encode(text).subarray(0, len), at);
    put(name, 0, 100); put("0000644\0", 100, 8); put("0000000\0", 108, 8); put("0000000\0", 116, 8);
    put(`${size.toString(8).padStart(11, "0")}\0`, 124, 12); put("00000000000\0", 136, 12); put("        ", 148, 8);
    put("0", 156, 1); put("ustar\0", 257, 6); put("00", 263, 2);
    let sum = 0;
    for (const b of h) sum += b;
    put(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
    return h;
  };
  const parts = [];
  for (const [name, bytes] of files) parts.push(header(`${rootName}/${name}`, bytes.byteLength), bytes, new Uint8Array((512 - (bytes.byteLength % 512)) % 512));
  parts.push(new Uint8Array(1024));
  return new Uint8Array(gzipSync(Buffer.concat(parts)));
}

test("a linked module records its format and externals, stays a strict classic script, and passes its vectors on both builds", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "keel-linked-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await linkedModule(root);

  const build = await runCli(["module", "build", root, "--no-types"]);
  assert.match(build.stdout, /reproducible-build/u);
  const recipe = JSON.parse(await readFile(path.join(root, "dist/keel-build-recipe.json"), "utf8"));
  assert.equal(recipe.options.format, "iife");
  assert.deepEqual(recipe.options.external, ["@demo/neighbour"]);
  const shipped = await readFile(path.join(root, "dist/linked-demo.min.js"), "utf8");
  assert.ok(shipped.startsWith('"use strict";'), "the compact stage keeps a classic script's directive");
  assert.ok(!/^\s*(import|export)\b/mu.test(shipped), "no module syntax in a classic script");
  assert.match(shipped, /@demo\/neighbour/u, "the neighbour is linked, not copied");

  const again = await runCli(["module", "build", root, "--no-types"]);
  assert.equal(again.stdout.match(/output digest: +(0x[0-9a-f]{64})/u)[1], build.stdout.match(/output digest: +(0x[0-9a-f]{64})/u)[1], "byte-reproducible");

  const tested = await runCli(["module", "test", root]);
  assert.match(tested.stdout, /linked-demo: passed; shipped bytes match the readable source on 2\/2 vectors/u);

  const plan = await runCli(["module", "plan", root, "--compression", "gzip"]);
  assert.match(plan.stdout, /review-only/u);
  const upload = JSON.parse(await readFile(path.join(root, "dist/upload-plan.json"), "utf8"));
  assert.equal(upload.compression, "gzip", "gzip keeps the object readable with DecompressionStream");
});

test("a reproduction from a source archive repeats the recorded format and externals and lands on the same digest", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "keel-linked-origin-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const moduleRoot = path.join(root, "packages", "demo");
  await linkedModule(moduleRoot);
  await runCli(["module", "build", moduleRoot, "--no-types"]);
  const recipe = JSON.parse(await readFile(path.join(moduleRoot, "dist/keel-build-recipe.json"), "utf8"));
  const files = new Map();
  for (const file of ["keel.module.json", "tsconfig.json", "src/index.ts", "src/neighbour.d.ts", "test/vectors.mjs"]) {
    files.set(`packages/demo/${file}`, new Uint8Array(await readFile(path.join(moduleRoot, file))));
  }
  const commit = "a".repeat(40);
  const archive = tarGz(`demo-${commit}`, files);
  const verify = (options) => verifyKeelModuleFromOrigin({
    origin: { protocol: "keel-source-origin@1", provider: "github", owner: "demo", repo: "demo", commit, visibility: "public" },
    identity: { namespace: "keel", name: "linked-demo", version: "0.1.0", entry: "src/index.ts" },
    entry: "src/index.ts",
    recipeRoot: "packages/demo",
    compact: { keepComments: false },
    mediaType: "text/javascript",
    fetchImpl: async () => new Response(archive),
    ...options,
  });
  const linked = await verify({ options: { ...KEEL_MODULE_BUILD_OPTIONS, format: "iife", external: ["@demo/neighbour"] } });
  assert.equal(linked.verification.reproduced, true);
  assert.equal(linked.recipe.output.integrity.digest, recipe.output.integrity.digest, "the archive rebuilds to the published digest");
  // (Without the recorded linkage the neighbour can't even be resolved: the options are part of what is verified.)
  await assert.rejects(verify({}), /Could not resolve "@demo\/neighbour"/u);
});

test("keel.module.json build settings are checked, and absent settings mean the default ESM bundle", () => {
  const base = {
    protocol: "keel-module-manifest@1", name: "x", version: "0.1.0", description: "x", entry: "src/index.ts", license: "MIT",
    sourceRepository: { url: "https://example.invalid/a/b", revision: "replace-with-a-commit-hash", path: "." },
  };
  assert.equal(parseKeelModuleManifest(base).build, undefined);
  assert.deepEqual(parseKeelModuleManifest({ ...base, build: { format: "iife", external: ["@a/b"] } }).build, { format: "iife", external: ["@a/b"] });
  assert.throws(() => parseKeelModuleManifest({ ...base, build: { format: "umd" } }), /build.format must be esm, iife, or cjs/u);
  assert.throws(() => parseKeelModuleManifest({ ...base, build: { minify: false } }), /build.minify is not supported/u);
  assert.throws(() => parseKeelModuleManifest({ ...base, build: { external: "@a/b" } }), /build.external must be an array/u);
});
