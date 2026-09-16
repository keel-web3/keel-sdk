import { readFile } from "node:fs/promises";
import path from "node:path";

import { createIntegrity, type KeelModuleIdentity } from "@keel/protocol";
import { buildKeelInlineModuleFragment, type KeelInlineModuleFragment } from "./inline-viewer-graph.js";
import {
  createExternalModuleIndex,
  customExternalBrowserModule,
  externalModuleIndexEntry,
  moduleApi,
  type BrowserModuleDescriptor,
  type ExternalBrowserModuleDeclaration,
  type ExternalModuleIndex,
  type ExternalModuleIndexEntry,
  type ExternalModuleProvenance,
} from "./module/index.js";

/**
 * Tone.js 15.1.22 rebuilt by KEEL as ONE minified classic script that defines
 * `globalThis.Tone`. The npm ESM build is bundled unchanged except that
 * `standardized-audio-context` is aliased to a native Web Audio shim
 * (scripts/tone-native/standardized-audio-context.js). Rebuild and compare with
 * `node scripts/build-tone-native.mjs --check`.
 *
 * Nothing is deployed: publication stays "not-claimed" until a carrier is
 * written, read back and hashed against `digest`.
 */
export const KEEL_TONE_15 = Object.freeze({
  id: "tone-native",
  version: "15.1.22",
  license: "MIT",
  upstreamAuthors: "Yotam Mann and Tone.js contributors",
  mediaType: "text/javascript",
  format: "classic-script",
  /** The global the script defines and the `extends` alias pieces read. */
  global: "Tone",
  alias: "tone",
  identity: Object.freeze({ namespace: "npm", name: "tone", version: "15.1.22", entry: "keel/tone.native.min.js" }) satisfies KeelModuleIdentity,
  sourceRepository: "https://github.com/Tonejs/Tone.js",
  sourceUrl: "https://registry.npmjs.org/tone/-/tone-15.1.22.tgz",
  npmIntegrity: "sha512-TCScAGD4sLsama5DjvTUXlLDXSqPealhL64nsdV1hhr6frPWve0DeSo63AKnSJwgfg55fhvxj0iPPRwPN5o0ag==",
  buildRecipe: "scripts/build-tone-native.mjs",
  localPath: "examples/demos/vendor/tone-15.1.22.native.min.js",
  licensePath: "examples/demos/vendor/tone-15.1.22-LICENSE.txt",
  digest: "sha256:3c958bd766743343128220942f9798375c6d9782c61703cf3c84633cf3f74d76",
  byteLength: 235_774,
  gzipByteLength: 51_913,
});

/**
 * The KEEL audio runtime every sounding piece extends: one shared
 * AudioContext (Tone's, when Tone is loaded), gesture-only start, a master
 * gain, visibility pause, a standard sound button and per-piece preferences
 * that survive the opaque-origin sandbox. Defines `globalThis.KEEL_AUDIO`.
 * Rebuild and compare with `node scripts/build-keel-audio.mjs --check`.
 */
export const KEEL_AUDIO_RUNTIME = Object.freeze({
  id: "keel-audio",
  version: "1.0.0",
  license: "MIT",
  mediaType: "text/javascript",
  format: "classic-script",
  global: "KEEL_AUDIO",
  alias: "keelAudio",
  identity: Object.freeze({ namespace: "keel", name: "keel-audio", version: "1.0.0", entry: "keel-audio.min.js" }) satisfies KeelModuleIdentity,
  sourceRepository: "keel-sdk",
  sourcePath: "packages/sdk/resources/keel-audio.js",
  buildRecipe: "scripts/build-keel-audio.mjs",
  localPath: "packages/sdk/resources/keel-audio-1.0.0.min.js",
  digest: "sha256:75cbdc41afc1636c4c5fd1c8a0508e2dbef2ed0d0af4c66c14149bdc8983efd3",
  byteLength: 8_405,
  gzipByteLength: 3_538,
});

/**
 * How sound relates to the viewer's `audioAutoplay` runtime capability:
 * a piece starts on a real gesture inside its own frame by default. A viewer
 * that grants `audioAutoplay` (the reference sandbox maps it to
 * `allow="autoplay"`) hands the page a running context; keel-audio starts on
 * it only when the piece opts in with `KEEL_AUDIO.configure({ autoplay: true })`
 * or calls `start()`, and never when the listener last turned sound off.
 */
export const KEEL_AUDIO_AUTOPLAY_POLICY = Object.freeze({
  capability: "audioAutoplay",
  default: "gesture-start",
  granted: "piece-opt-in-only",
});

/** Load order inside the Inline shell: Tone, then keel-audio, then creator runtime modules (weight 0). */
export const KEEL_AUDIO_MODULE_WEIGHTS = Object.freeze({ tone: -200, audio: -100 });

export interface KeelAudioCarrierBinding {
  /** EIP-155 chain the carrier lives on; becomes the CAIP-2 `eip155:<chainId>`. */
  readonly chainId: number;
  readonly store: string;
  readonly objectId: string;
}

export interface KeelAudioModuleBindings {
  readonly chainId: number;
  readonly store: string;
  /** Omit for pieces that use plain Web Audio through keel-audio only. */
  readonly toneObjectId?: string;
  readonly audioObjectId: string;
}

export interface KeelToneBrowserModules {
  readonly tone: ExternalBrowserModuleDeclaration<unknown, ExternalModuleProvenance>;
  readonly audio: ExternalBrowserModuleDeclaration<unknown, ExternalModuleProvenance>;
  /** Pass to `defineModule({ extends })`, in load order: Tone first. */
  readonly extends: readonly [BrowserModuleDescriptor<string, string, unknown>, BrowserModuleDescriptor<string, string, unknown>];
}

const ADDRESS = /^0x[0-9a-f]{40}$/iu;
const BYTES32 = /^0x[0-9a-f]{64}$/iu;
const PUBLISHER = "keel.system";

function requireAddress(value: string, label: string): string {
  if (!ADDRESS.test(value)) throw new TypeError(`${label} must be a 20-byte EVM address.`);
  return value.toLowerCase();
}

function requireBytes32(value: string, label: string): string {
  if (!BYTES32.test(value)) throw new TypeError(`${label} must be a bytes32 value.`);
  return value.toLowerCase();
}

function requireChain(chainId: number): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new RangeError("Audio module carriers need a positive EIP-155 chain id.");
  return `eip155:${chainId}`;
}

async function assertPinned(
  bytes: Uint8Array,
  expected: { readonly digest: string; readonly byteLength: number; readonly id: string; readonly version: string },
): Promise<void> {
  const integrity = await createIntegrity(bytes);
  if (integrity.byteLength !== expected.byteLength || `sha256:${integrity.digest.slice(2)}` !== expected.digest) {
    throw new Error(`${expected.id}@${expected.version} digest or byte length does not match the pinned artifact.`);
  }
}

/** Proves supplied bytes are the exact pinned KEEL Tone.js 15.1.22 native build. */
export async function assertKeelToneOfficialBytes(bytes: Uint8Array): Promise<typeof KEEL_TONE_15> {
  await assertPinned(bytes, KEEL_TONE_15);
  return KEEL_TONE_15;
}

/** Proves supplied bytes are the exact pinned keel-audio runtime. */
export async function assertKeelAudioRuntimeBytes(bytes: Uint8Array): Promise<typeof KEEL_AUDIO_RUNTIME> {
  await assertPinned(bytes, KEEL_AUDIO_RUNTIME);
  return KEEL_AUDIO_RUNTIME;
}

/** Node helper: reads both pinned artifacts from a keel-sdk checkout and verifies them. */
export async function loadKeelAudioModuleBytes(input: { readonly repositoryRoot: string }): Promise<{ readonly tone: Uint8Array; readonly audio: Uint8Array }> {
  const [tone, audio] = await Promise.all([
    readFile(path.join(input.repositoryRoot, KEEL_TONE_15.localPath)),
    readFile(path.join(input.repositoryRoot, KEEL_AUDIO_RUNTIME.localPath)),
  ]);
  const result = { tone: new Uint8Array(tone), audio: new Uint8Array(audio) };
  await Promise.all([assertKeelToneOfficialBytes(result.tone), assertKeelAudioRuntimeBytes(result.audio)]);
  return Object.freeze(result);
}

/**
 * Index entry for a claimed Tone carrier. It records a location only; callers
 * still read and hash the carrier (`verifyExternalBrowserModuleOnchain` or the
 * Studio gateway) before it can enter a publishable graph.
 */
export function keelToneIndexEntry(binding: KeelAudioCarrierBinding): ExternalModuleIndexEntry {
  return externalModuleIndexEntry(
    KEEL_TONE_15.id,
    KEEL_TONE_15.version,
    PUBLISHER,
    KEEL_TONE_15.digest,
    KEEL_TONE_15.byteLength,
    KEEL_TONE_15.mediaType,
    requireBytes32(binding.objectId, "Tone objectId"),
    requireAddress(binding.store, "Tone store"),
    requireChain(binding.chainId),
    KEEL_TONE_15.sourceUrl,
    KEEL_TONE_15.digest,
    undefined,
    undefined,
    "shared-library",
    "publisher-attested",
  );
}

/** Index entry for a claimed keel-audio carrier. Tone is optional, so it is not a declared dependency. */
export function keelAudioIndexEntry(binding: KeelAudioCarrierBinding): ExternalModuleIndexEntry {
  return externalModuleIndexEntry(
    KEEL_AUDIO_RUNTIME.id,
    KEEL_AUDIO_RUNTIME.version,
    PUBLISHER,
    KEEL_AUDIO_RUNTIME.digest,
    KEEL_AUDIO_RUNTIME.byteLength,
    KEEL_AUDIO_RUNTIME.mediaType,
    requireBytes32(binding.objectId, "keel-audio objectId"),
    requireAddress(binding.store, "keel-audio store"),
    requireChain(binding.chainId),
    `${KEEL_AUDIO_RUNTIME.sourceRepository}:${KEEL_AUDIO_RUNTIME.sourcePath}@${KEEL_AUDIO_RUNTIME.version}`,
    KEEL_AUDIO_RUNTIME.digest,
    undefined,
    undefined,
    "shared-library",
    "publisher-attested",
  );
}

/** One- or two-entry shared-library index (keel-audio, plus Tone when bound) on one chain and store. */
export function createKeelAudioModuleIndex(input: KeelAudioModuleBindings): Readonly<ExternalModuleIndex> {
  const audio = keelAudioIndexEntry({ chainId: input.chainId, store: input.store, objectId: input.audioObjectId });
  if (input.toneObjectId === undefined) return createExternalModuleIndex(audio);
  const tone = keelToneIndexEntry({ chainId: input.chainId, store: input.store, objectId: input.toneObjectId });
  return createExternalModuleIndex(tone, audio);
}

/** Declares keel-audio alone, for pieces that write plain Web Audio. */
export function declareKeelAudioBrowserModule(index: Readonly<ExternalModuleIndex>): ExternalBrowserModuleDeclaration<unknown, ExternalModuleProvenance> {
  return customExternalBrowserModule(index, KEEL_AUDIO_RUNTIME.id, KEEL_AUDIO_RUNTIME.version, moduleApi(), KEEL_AUDIO_RUNTIME.alias);
}

/** Declares Tone plus keel-audio without embedding either in creator bytes. */
export function declareKeelToneBrowserModules(index: Readonly<ExternalModuleIndex>): KeelToneBrowserModules {
  const tone = customExternalBrowserModule(index, KEEL_TONE_15.id, KEEL_TONE_15.version, moduleApi(), KEEL_TONE_15.alias);
  const audio = declareKeelAudioBrowserModule(index);
  return Object.freeze({ tone, audio, extends: Object.freeze([tone.descriptor, audio.descriptor] as const) });
}

/**
 * Inline-shell module fragments for local documents and sandbox checks:
 * classic scripts in the runtime phase, Tone before keel-audio, both before
 * creator runtime modules. Pass `tone: undefined` for a Web Audio-only piece.
 */
export async function buildKeelAudioInlineModuleFragments(input: {
  readonly tone?: Uint8Array;
  readonly audio: Uint8Array;
}): Promise<readonly KeelInlineModuleFragment[]> {
  await assertKeelAudioRuntimeBytes(input.audio);
  const fragments: KeelInlineModuleFragment[] = [];
  if (input.tone !== undefined) {
    await assertKeelToneOfficialBytes(input.tone);
    fragments.push(await buildKeelInlineModuleFragment({
      moduleId: KEEL_TONE_15.id,
      version: KEEL_TONE_15.version,
      mediaType: KEEL_TONE_15.mediaType,
      aliases: [KEEL_TONE_15.id, KEEL_TONE_15.alias],
      decodedBytes: input.tone,
      compression: "gzip",
      execution: "classic",
      phase: "runtime",
      weight: KEEL_AUDIO_MODULE_WEIGHTS.tone,
    }));
  }
  fragments.push(await buildKeelInlineModuleFragment({
    moduleId: KEEL_AUDIO_RUNTIME.id,
    version: KEEL_AUDIO_RUNTIME.version,
    mediaType: KEEL_AUDIO_RUNTIME.mediaType,
    aliases: [KEEL_AUDIO_RUNTIME.id],
    decodedBytes: input.audio,
    compression: "gzip",
    execution: "classic",
    phase: "runtime",
    weight: KEEL_AUDIO_MODULE_WEIGHTS.audio,
  }));
  return Object.freeze(fragments);
}
