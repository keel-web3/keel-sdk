import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { gzipSync } from "node:zlib";

import {
  KEEL_AUDIO_MODULE_WEIGHTS,
  KEEL_AUDIO_RUNTIME,
  KEEL_TONE_15,
  assertKeelAudioRuntimeBytes,
  assertKeelToneOfficialBytes,
  buildKeelAudioInlineModuleFragments,
  buildKeelInlineLocalDocument,
  buildKeelInlineShellFragments,
  createKeelAudioModuleIndex,
  declareKeelAudioBrowserModule,
  declareKeelToneBrowserModules,
  keelToneIndexEntry,
  loadKeelAudioModuleBytes,
} from "../packages/sdk/dist/index.js";
import { getKeelCreativeRuntime } from "../packages/sdk/dist/creative-runtime-catalog.js";
import { defineModule, isBrowserModuleDescriptorVerified } from "../packages/sdk/dist/module/index.js";

const HOLD = "0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267";
const TONE_OBJECT = `0x${"3".repeat(64)}`;
const AUDIO_OBJECT = `0x${"4".repeat(64)}`;

test("pinned Tone and keel-audio digests match the committed artifact bytes exactly", async () => {
  const bytes = await loadKeelAudioModuleBytes({ repositoryRoot: process.cwd() });
  assert.deepEqual(await assertKeelToneOfficialBytes(bytes.tone), KEEL_TONE_15);
  assert.deepEqual(await assertKeelAudioRuntimeBytes(bytes.audio), KEEL_AUDIO_RUNTIME);
  assert.equal(bytes.tone.byteLength, KEEL_TONE_15.byteLength);
  assert.equal(bytes.audio.byteLength, KEEL_AUDIO_RUNTIME.byteLength);
  assert.equal(gzipSync(bytes.tone, { level: 9 }).byteLength, KEEL_TONE_15.gzipByteLength);
  assert.equal(gzipSync(bytes.audio, { level: 9 }).byteLength, KEEL_AUDIO_RUNTIME.gzipByteLength);
  await assert.rejects(() => assertKeelToneOfficialBytes(bytes.tone.subarray(1)), /digest or byte length/u);
  const flipped = new Uint8Array(bytes.audio);
  flipped[flipped.length - 2] ^= 1;
  await assert.rejects(() => assertKeelAudioRuntimeBytes(flipped), /digest or byte length/u);
});

test("the Tone artifact carries the MIT notice, no standardized-audio-context, and defines globalThis.Tone", async () => {
  const [source, license] = await Promise.all([
    readFile(KEEL_TONE_15.localPath, "utf8"),
    readFile(KEEL_TONE_15.licensePath, "utf8"),
  ]);
  assert.match(source, /^\/\*!\n \* Tone\.js 15\.1\.22/u);
  assert.match(source, /MIT License[\s\S]*Copyright \(c\) 2014-2020 Yotam Mann[\s\S]*THE SOFTWARE IS PROVIDED "AS IS"/u);
  assert.match(license, /MIT License/u);
  const body = source.slice(source.indexOf("*/") + 2);
  assert.doesNotMatch(body, /standardized-audio-context|automation-events|https?:\/\/(?!github\.com\/Tonejs)/u);
  assert.match(body, /^\nvar Tone=/u);
  // Without Web Audio globals Tone falls back to its DummyContext: no context, no timers, no network.
  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: KEEL_TONE_15.localPath });
  assert.equal(sandbox.Tone.version, "15.1.22");
  for (const name of ["PolySynth", "FMSynth", "Transport", "getTransport", "Reverb", "Filter", "Loop", "Sequence", "setContext", "getContext", "start"]) {
    assert.ok(name in sandbox.Tone, `Tone.${name}`);
  }
  assert.equal(await sandbox.Tone.supported(), false);
});

test("keel-audio artifact is the reproducible minified build of its readable source", () => {
  const output = execFileSync(process.execPath, ["scripts/build-keel-audio.mjs", "--check"], { encoding: "utf8" });
  const report = JSON.parse(output);
  assert.equal(report.matchesCommittedArtifact, true);
  assert.equal(report.matchesPin, true);
  assert.equal(report.digest, KEEL_AUDIO_RUNTIME.digest);
});

test("Tone and keel-audio are declared as exact shared modules in load order, never creator bytes", () => {
  const index = createKeelAudioModuleIndex({ chainId: 11155111, store: HOLD, toneObjectId: TONE_OBJECT, audioObjectId: AUDIO_OBJECT });
  const modules = declareKeelToneBrowserModules(index);
  assert.deepEqual(modules.tone.module.carrier, {
    moduleId: KEEL_TONE_15.id,
    version: KEEL_TONE_15.version,
    digest: KEEL_TONE_15.digest,
    objectId: TONE_OBJECT,
    store: HOLD,
    chain: "eip155:11155111",
  });
  assert.deepEqual(modules.audio.module.carrier, {
    moduleId: KEEL_AUDIO_RUNTIME.id,
    version: KEEL_AUDIO_RUNTIME.version,
    digest: KEEL_AUDIO_RUNTIME.digest,
    objectId: AUDIO_OBJECT,
    store: HOLD,
    chain: "eip155:11155111",
  });
  assert.equal(modules.tone.module.isolation, "shared-library");
  assert.equal(modules.tone.module.verification, "publisher-attested");
  assert.deepEqual(modules.audio.module.dependencies, [], "Tone is optional for keel-audio");
  assert.equal(modules.tone.descriptor.key, "tone");
  assert.equal(modules.audio.descriptor.key, "keelAudio");
  assert.deepEqual(modules.extends, [modules.tone.descriptor, modules.audio.descriptor]);
  assert.equal(Object.isFrozen(modules.extends), true);
  assert.equal(isBrowserModuleDescriptorVerified(modules.tone.descriptor), false);
  assert.equal(isBrowserModuleDescriptorVerified(modules.audio.descriptor), false);

  // A publishable browser target needs a CAIP-2 chain AND an exact on-chain byte read first.
  assert.throws(() => defineModule("Nocturne", { kind: "app", target: "@keel/eth/eip155:11155111/browser", extends: [...modules.extends] }), /has not passed an exact on-chain byte read/u);
  assert.throws(() => defineModule("Nocturne", { kind: "app", target: "@keel/eth/eip155:1/browser", extends: [...modules.extends] }), /resolved on eip155:11155111/u);

  const audioOnly = createKeelAudioModuleIndex({ chainId: 8453, store: HOLD, audioObjectId: AUDIO_OBJECT });
  assert.equal(declareKeelAudioBrowserModule(audioOnly).module.carrier.chain, "eip155:8453");
  assert.throws(() => declareKeelToneBrowserModules(audioOnly), /tone-native/u);
  assert.throws(() => keelToneIndexEntry({ chainId: 0, store: HOLD, objectId: TONE_OBJECT }), /chain id/u);
  assert.throws(() => keelToneIndexEntry({ chainId: 1, store: "0x1234", objectId: TONE_OBJECT }), /20-byte/u);
  assert.throws(() => keelToneIndexEntry({ chainId: 1, store: HOLD, objectId: "0x12" }), /bytes32/u);
});

test("inline fragments load Tone, then keel-audio, then creator runtime modules, as gzip classic scripts", async () => {
  const bytes = await loadKeelAudioModuleBytes({ repositoryRoot: process.cwd() });
  const fragments = await buildKeelAudioInlineModuleFragments(bytes);
  assert.deepEqual(fragments.map((fragment) => [fragment.moduleId, fragment.execution, fragment.phase, fragment.weight]), [
    [KEEL_TONE_15.id, "classic", "runtime", KEEL_AUDIO_MODULE_WEIGHTS.tone],
    [KEEL_AUDIO_RUNTIME.id, "classic", "runtime", KEEL_AUDIO_MODULE_WEIGHTS.audio],
  ]);
  assert.ok(fragments.every((fragment) => fragment.item.embedded?.compression === "gzip"));
  await assert.rejects(() => buildKeelAudioInlineModuleFragments({ audio: bytes.tone }), /keel-audio/u);
  const audioOnly = await buildKeelAudioInlineModuleFragments({ audio: bytes.audio });
  assert.deepEqual(audioOnly.map((fragment) => fragment.moduleId), [KEEL_AUDIO_RUNTIME.id]);

  const shell = await buildKeelInlineShellFragments({ repositoryRoot: process.cwd() });
  const local = await buildKeelInlineLocalDocument({
    shell,
    modules: [...fragments].reverse(),
    entry: { id: "score.js", mediaType: "text/javascript", source: new TextEncoder().encode("KEEL_AUDIO.mountButton();") },
  });
  const moduleParts = local.parts.filter((part) => part.role === "module").map((part) => part.moduleId);
  assert.deepEqual(moduleParts, [KEEL_TONE_15.id, KEEL_AUDIO_RUNTIME.id]);
  // The whole Tone + keel-audio graph costs about 55 KB of gzip carriage.
  const moduleBytes = local.parts.filter((part) => part.role === "module").reduce((total, part) => total + part.byteLength, 0);
  assert.ok(moduleBytes < 80_000, `module carriage ${moduleBytes}`);
});

test("creative runtime catalog lists Tone and keel-audio as local, unpublished classic scripts", () => {
  const tone = getKeelCreativeRuntime("tone");
  const audio = getKeelCreativeRuntime("keel-audio");
  assert.equal(tone.resources[0].localPath, KEEL_TONE_15.localPath);
  assert.equal(`sha256:${tone.resources[0].integrity.digest.slice(2)}`, KEEL_TONE_15.digest);
  assert.equal(`sha256:${audio.resources[0].integrity.digest.slice(2)}`, KEEL_AUDIO_RUNTIME.digest);
  assert.equal(tone.resources[0].format, "classic-script");
  assert.deepEqual(tone.publication, { status: "not-claimed", receiptBacked: false, carriers: [] });
  assert.deepEqual(audio.publication, { status: "not-claimed", receiptBacked: false, carriers: [] });
});
