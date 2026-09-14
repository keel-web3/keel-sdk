#!/usr/bin/env node
// Reproducible KEEL build of Tone.js 15.1.22 as ONE classic script.
//
//   node scripts/build-tone-native.mjs            # fetch via `npm pack`, build, write, verify pin
//   node scripts/build-tone-native.mjs --check    # build to memory and compare with the committed artifact
//   node scripts/build-tone-native.mjs --tarballs <dir>   # offline: use tone-15.1.22.tgz + tslib-2.8.1.tgz from <dir>
//
// The only change from upstream is that `standardized-audio-context` (a large
// polyfill layer) is aliased to scripts/tone-native/standardized-audio-context.js,
// which hands Tone the page's native Web Audio constructors. Everything else is
// the published npm ESM build, bundled by the pinned esbuild into an IIFE that
// defines `globalThis.Tone`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = resolve(import.meta.dirname, "..");
const OUTPUT = join(ROOT, "examples/demos/vendor/tone-15.1.22.native.min.js");
const LICENSE_OUTPUT = join(ROOT, "examples/demos/vendor/tone-15.1.22-LICENSE.txt");
const SHIM = join(ROOT, "scripts/tone-native/standardized-audio-context.js");
const PIN_SOURCE = join(ROOT, "packages/sdk/src/audio-module.ts");

/** Exact npm inputs. A different tarball is refused before anything is built. */
const INPUTS = Object.freeze([
  { name: "tone", version: "15.1.22", integrity: "sha512-TCScAGD4sLsama5DjvTUXlLDXSqPealhL64nsdV1hhr6frPWve0DeSo63AKnSJwgfg55fhvxj0iPPRwPN5o0ag==" },
  { name: "tslib", version: "2.8.1", integrity: "sha512-oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==" },
]);
const ESBUILD_VERSION = "0.28.2";

const args = process.argv.slice(2);
const check = args.includes("--check");
const tarballDir = args.includes("--tarballs") ? resolve(args[args.indexOf("--tarballs") + 1]) : undefined;

function sri(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

async function tarball(work, input) {
  const file = `${input.name}-${input.version}.tgz`;
  let path;
  if (tarballDir !== undefined) {
    path = join(tarballDir, file);
  } else {
    execFileSync("npm", ["pack", `${input.name}@${input.version}`, "--pack-destination", work, "--silent"], { stdio: ["ignore", "ignore", "inherit"] });
    path = join(work, file);
  }
  const bytes = await readFile(path);
  const actual = sri(bytes);
  if (actual !== input.integrity) throw new Error(`${file} integrity ${actual} does not match the pinned ${input.integrity}.`);
  const destination = join(work, "node_modules", input.name);
  await mkdir(destination, { recursive: true });
  execFileSync("tar", ["-xzf", path, "-C", destination, "--strip-components=1"]);
  return destination;
}

function banner(license) {
  const body = license.trim().split("\n").map((line) => ` * ${line}`.trimEnd()).join("\n");
  return [
    "/*!",
    " * Tone.js 15.1.22 (https://github.com/Tonejs/Tone.js) - KEEL native classic build",
    " * Built by keel-sdk scripts/build-tone-native.mjs from npm tone@15.1.22 with esbuild " + ESBUILD_VERSION + ".",
    " * standardized-audio-context is replaced by a native Web Audio shim; tslib 2.8.1 (0BSD) helpers are inlined.",
    " *",
    body,
    " */",
  ].join("\n");
}

async function pinned() {
  const source = await readFile(PIN_SOURCE, "utf8").catch(() => "");
  const block = source.slice(source.indexOf("export const KEEL_TONE_15"));
  const digest = /digest: "sha256:([0-9a-f]{64})"/u.exec(block)?.[1];
  const byteLength = /byteLength: ([0-9_]+),/u.exec(block)?.[1]?.replaceAll("_", "");
  return { digest, byteLength: byteLength === undefined ? undefined : Number(byteLength) };
}

const esbuild = await import("esbuild");
if (esbuild.version !== ESBUILD_VERSION) throw new Error(`esbuild ${esbuild.version} is installed; this build is pinned to ${ESBUILD_VERSION}.`);

const work = await mkdtemp(join(tmpdir(), "keel-tone-native-"));
try {
  const [tone] = await Promise.all(INPUTS.map((input) => tarball(work, input)));
  const license = await readFile(join(tone, "LICENSE.md"), "utf8");
  const result = await esbuild.build({
    entryPoints: [join(tone, "build/esm/index.js")],
    absWorkingDir: work,
    nodePaths: [join(work, "node_modules")],
    bundle: true,
    format: "iife",
    globalName: "Tone",
    platform: "browser",
    target: ["es2020"],
    minify: true,
    legalComments: "none",
    charset: "ascii",
    sourcemap: false,
    alias: { "standardized-audio-context": SHIM },
    banner: { js: banner(license) },
    write: false,
    logLevel: "warning",
  });
  const bytes = result.outputFiles[0].contents;
  const source = new TextDecoder().decode(bytes);
  if (/standardized-audio-context|automation-events/u.test(source.slice(source.indexOf("*/") + 2))) {
    throw new Error("The native build still carries standardized-audio-context code.");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  const gzip = gzipSync(bytes, { level: 9 }).byteLength;
  const summary = { path: OUTPUT.slice(ROOT.length + 1), digest: `sha256:${digest}`, byteLength: bytes.byteLength, gzipByteLength: gzip };
  const pin = await pinned();
  const matchesPin = pin.digest === digest && pin.byteLength === bytes.byteLength;
  if (check) {
    const committed = await readFile(OUTPUT);
    const same = Buffer.compare(Buffer.from(bytes), committed) === 0;
    console.log(JSON.stringify({ ...summary, matchesCommittedArtifact: same, matchesPin }, null, 2));
    if (!same || !matchesPin) process.exitCode = 1;
  } else {
    await writeFile(OUTPUT, bytes);
    await writeFile(LICENSE_OUTPUT, `Tone.js 15.1.22 - ${OUTPUT.slice(ROOT.length + 1)}\n\n${license.trim()}\n\n`
      + "Bundled helpers from tslib 2.8.1 are distributed under the 0BSD license (no attribution required).\n"
      + "The standardized-audio-context dependency is NOT included; scripts/tone-native/standardized-audio-context.js replaces it.\n");
    console.log(JSON.stringify({ ...summary, matchesPin }, null, 2));
    if (!matchesPin) console.warn("The pinned digest in packages/sdk/src/audio-module.ts (KEEL_TONE_15) differs; update it deliberately.");
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
