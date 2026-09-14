#!/usr/bin/env node
// Minifies packages/sdk/resources/keel-audio.js into the pinned classic-script
// artifact packages/sdk/resources/keel-audio-1.0.0.min.js.
//
//   node scripts/build-keel-audio.mjs          # write the artifact and print its digest
//   node scripts/build-keel-audio.mjs --check  # rebuild in memory; fail unless it equals the committed, pinned bytes
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = join(ROOT, "packages/sdk/resources/keel-audio.js");
const OUTPUT = join(ROOT, "packages/sdk/resources/keel-audio-1.0.0.min.js");
const PIN_SOURCE = join(ROOT, "packages/sdk/src/audio-module.ts");
const ESBUILD_VERSION = "0.28.2";

const esbuild = await import("esbuild");
if (esbuild.version !== ESBUILD_VERSION) throw new Error(`esbuild ${esbuild.version} is installed; this build is pinned to ${ESBUILD_VERSION}.`);

const result = await esbuild.transform(await readFile(SOURCE, "utf8"), {
  loader: "js",
  minify: true,
  target: "es2020",
  charset: "ascii",
  legalComments: "inline",
});
const bytes = new TextEncoder().encode(result.code);
const digest = createHash("sha256").update(bytes).digest("hex");
const pinSource = await readFile(PIN_SOURCE, "utf8").catch(() => "");
const block = pinSource.slice(pinSource.indexOf("export const KEEL_AUDIO_RUNTIME"));
const pinnedDigest = /digest: "sha256:([0-9a-f]{64})"/u.exec(block)?.[1];
const pinnedLength = Number(/byteLength: ([0-9_]+),/u.exec(block)?.[1]?.replaceAll("_", ""));
const summary = {
  path: OUTPUT.slice(ROOT.length + 1),
  digest: `sha256:${digest}`,
  byteLength: bytes.byteLength,
  gzipByteLength: gzipSync(bytes, { level: 9 }).byteLength,
  matchesPin: pinnedDigest === digest && pinnedLength === bytes.byteLength,
};
if (process.argv.includes("--check")) {
  const committed = await readFile(OUTPUT);
  const same = Buffer.compare(Buffer.from(bytes), committed) === 0;
  console.log(JSON.stringify({ ...summary, matchesCommittedArtifact: same }, null, 2));
  if (!same || !summary.matchesPin) process.exitCode = 1;
} else {
  await writeFile(OUTPUT, bytes);
  console.log(JSON.stringify(summary, null, 2));
}
