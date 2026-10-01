/**
 * Proofs and private content for KEEL objects.
 *
 * Commitments (`keel-commitment@1`, `keel-merkle@1`) put 32 bytes on-chain now
 * and let their author reveal what those bytes stood for later.
 *
 * Sealed content (`keel-sealed@1`) compresses and encrypts bytes into an
 * envelope that is stored on-chain like any other KEEL object while the key
 * stays off-chain. A passkey (WebAuthn PRF), a passphrase or a saved recovery
 * key opens one of the envelope's key slots, and that slot releases the
 * content key.
 *
 * Only symmetric primitives are used (AES-256-GCM, HKDF-SHA-256,
 * PBKDF2-HMAC-SHA-256, SHA-256), all from Web Crypto. There is no public-key
 * math in the content path for a quantum computer to break; Grover's search
 * leaves AES-256 and SHA-256 with roughly 128-bit security.
 *
 * Envelope bytes:
 *
 * ```text
 * offset  size  field
 * 0       4     magic "KSLD" (4b 53 4c 44)
 * 4       1     frame version, 1
 * 5       4     header length H, unsigned big-endian, 2..65536
 * 9       H     header: RFC 8785 canonical JSON (UTF-8), see KeelSealedHeader
 * 9+H     P     payload: AES-256-GCM(compressed plaintext) with its 16-byte tag
 * ```
 *
 * Key schedule, with CK the random 256-bit content key every slot wraps:
 *
 * ```text
 * content cipher key  = HKDF(CK, salt "", info "keel-sealed/content-key@1")
 * key commitment      = HKDF(CK, salt "", info "keel-sealed/key-commitment@1")   public, in the header
 * plaintext salt      = HKDF(CK, salt "", info "keel-sealed/plaintext-salt@1")   secret, salts the commitment
 * content AAD         = "keel-sealed/content@1" 0x00 canonicalJson(header.content)
 * slot AAD            = "keel-sealed/slot@1" 0x00 canonicalJson({ keyCommitment, slot without wrappedKey })
 * passkey-prf KEK     = HKDF(PRF output, salt slot.salt, info slot.info)
 * passphrase KEK      = PBKDF2-HMAC-SHA-256(NFC(passphrase), slot.kdf.salt, slot.kdf.iterations)
 * raw-key KEK         = HKDF(recovery key, salt slot.salt, info "keel-sealed/raw-key@1")
 * slot.wrappedKey     = AES-256-GCM(KEK, slot.iv, CK, slot AAD)
 * ```
 *
 * See docs/SEALED_CONTENT.md for the threat model.
 */

import {
  assertDataUriMediaType,
  bytesToHex,
  bytesToUtf8,
  concatBytes,
  decodeText,
  encodeBase64,
  equalBytes,
  hexToBytes,
  toBufferSource,
  utf8ToBytes,
} from "./bytes.js";
import { canonicalJson } from "./canonical.js";
import { digestBytes } from "./integrity.js";
import type { Hex } from "./types.js";

// ------------------------------------------------------------------ constants

export const KEEL_COMMITMENT_PROTOCOL = "keel-commitment@1" as const;
export const KEEL_MERKLE_PROTOCOL = "keel-merkle@1" as const;
export const KEEL_MERKLE_PROOF_PROTOCOL = "keel-merkle-proof@1" as const;
export const KEEL_MERKLE_MAX_ITEMS = 1 << 20;

export const KEEL_SEALED_PROTOCOL = "keel-sealed@1" as const;
/** Media type for a stored envelope; the sealed content's own type is inside the header. */
export const KEEL_SEALED_MEDIA_TYPE = "application/vnd.keel.sealed" as const;
export const KEEL_SEALED_FRAME_VERSION = 1;
export const KEEL_SEALED_MAX_PLAINTEXT_BYTES = 16 * 1024 * 1024;
export const KEEL_SEALED_MAX_HEADER_BYTES = 64 * 1024;
/** Plaintext limit plus room for deflate's worst-case growth and the GCM tag. */
export const KEEL_SEALED_MAX_PAYLOAD_BYTES = KEEL_SEALED_MAX_PLAINTEXT_BYTES + 64 * 1024 + 16;
export const KEEL_SEALED_MAX_SLOTS = 8;
/** OWASP's 2023 floor for PBKDF2-HMAC-SHA-256. Readers and writers both enforce it. */
export const KEEL_SEALED_PBKDF2_MIN_ITERATIONS = 600_000;
/** Caps the work a hostile envelope can demand from a reader. */
export const KEEL_SEALED_PBKDF2_MAX_ITERATIONS = 5_000_000;
export const KEEL_SEALED_MIN_PASSPHRASE_LENGTH = 8;
export const KEEL_SEALED_PASSKEY_INFO = "keel-sealed/passkey-prf@1" as const;
/** Bytes a WebAuthn PRF salt must have for a `passkey-prf` slot. */
export const KEEL_SEALED_PRF_SALT_BYTES = 32;

const MAGIC = [0x4b, 0x53, 0x4c, 0x44] as const;
const FRAME_PREFIX_BYTES = 9;
const TAG_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const WRAPPED_KEY_BYTES = KEY_BYTES + TAG_BYTES;
const CREDENTIAL_HASH_BYTES = 16;
const KDF_SALT_BYTES = 16;
const MAX_SALT_BYTES = 64;
const MAX_CREDENTIAL_ID_BYTES = 1023;
const MAX_PASSPHRASE_LENGTH = 1024;
const MERKLE_MAX_DEPTH = 64;

const LABEL = {
  commitment: "keel-commitment@1",
  merkle: "keel-merkle@1",
  content: "keel-sealed/content@1",
  slot: "keel-sealed/slot@1",
  contentKey: "keel-sealed/content-key@1",
  keyCommitment: "keel-sealed/key-commitment@1",
  plaintextSalt: "keel-sealed/plaintext-salt@1",
  credential: "keel-sealed/credential@1",
  rawKey: "keel-sealed/raw-key@1",
} as const;

// ---------------------------------------------------------------------- types

export interface KeelCommitment {
  readonly protocol: typeof KEEL_COMMITMENT_PROTOCOL;
  readonly algorithm: "sha-256";
  /**
   * 32 bytes, ready to publish as a `bytes32`. Unsalted: plain SHA-256 of the
   * content. Salted: SHA-256("keel-commitment@1" 0x00 len(salt) salt content).
   */
  readonly digest: Hex;
  /** Keep private until you reveal the content; anyone holding it can test guesses. */
  readonly salt?: Hex;
}

export interface KeelCommitmentOptions {
  /** Defaults to "random" (32 bytes), so short or guessable content cannot be found by trial. */
  readonly salt?: "random" | "none" | Uint8Array;
}

export interface KeelMerkleProof {
  readonly protocol: typeof KEEL_MERKLE_PROOF_PROTOCOL;
  readonly index: number;
  readonly count: number;
  /** The item's own commitment, including its salt. */
  readonly item: KeelCommitment;
  readonly siblings: readonly Hex[];
}

export interface KeelMerkleCommitment {
  readonly protocol: typeof KEEL_MERKLE_PROTOCOL;
  readonly algorithm: "sha-256";
  /** Publish this. It commits to every item and to the item count. */
  readonly root: Hex;
  readonly count: number;
  /** Per-item commitments with their salts. Keep private; reveal items one proof at a time. */
  readonly items: readonly KeelCommitment[];
  proofFor(index: number): KeelMerkleProof;
}

export type KeelSealedCompression = "none" | "deflate-raw" | "gzip";
export type KeelSealedCipher = "aes-256-gcm";
export type KeelSealedSlotKind = "passkey-prf" | "passphrase" | "raw-key";
/** Binary fields in the header are unpadded base64url. */
export type KeelBase64Url = string;

export interface KeelSealedContentHeader {
  readonly cipher: KeelSealedCipher;
  readonly compression: KeelSealedCompression;
  /** 12 bytes. */
  readonly iv: KeelBase64Url;
  /** 32 bytes derived one-way from the content key; also the content key fingerprint. */
  readonly keyCommitment: KeelBase64Url;
  readonly mediaType: string;
  /** Plaintext bytes before compression. */
  readonly byteLength: number;
  /** Ciphertext bytes after the header, including the 16-byte tag. */
  readonly payloadBytes: number;
  /** 32-byte salted SHA-256 of the plaintext; the salt is derived from the content key. */
  readonly commitment?: KeelBase64Url;
}

export interface KeelSealedPasskeySlot {
  readonly kind: "passkey-prf";
  /** First 16 bytes of SHA-256("keel-sealed/credential@1" 0x00 salt credentialId). Unlinkable across envelopes. */
  readonly credentialHash: KeelBase64Url;
  /** Only present when the writer chose to store it, for passkeys that are not discoverable. */
  readonly credentialId?: KeelBase64Url;
  /** Hint: the site (WebAuthn relying party) the passkey belongs to. */
  readonly rpId?: string;
  /** 32 bytes: the PRF input and the HKDF salt. */
  readonly salt: KeelBase64Url;
  readonly info: string;
  readonly iv: KeelBase64Url;
  readonly wrappedKey: KeelBase64Url;
}

export interface KeelSealedPbkdf2 {
  readonly name: "pbkdf2-sha256";
  readonly iterations: number;
  readonly salt: KeelBase64Url;
}

/** `kdf.name` is the extension point: "argon2id" is planned and rejected until readers ship it. */
export interface KeelSealedPassphraseSlot {
  readonly kind: "passphrase";
  readonly kdf: KeelSealedPbkdf2;
  readonly iv: KeelBase64Url;
  readonly wrappedKey: KeelBase64Url;
}

export interface KeelSealedRawKeySlot {
  readonly kind: "raw-key";
  readonly salt: KeelBase64Url;
  readonly iv: KeelBase64Url;
  readonly wrappedKey: KeelBase64Url;
}

export type KeelSealedSlot = KeelSealedPasskeySlot | KeelSealedPassphraseSlot | KeelSealedRawKeySlot;

export interface KeelSealedHeader {
  readonly protocol: typeof KEEL_SEALED_PROTOCOL;
  readonly content: KeelSealedContentHeader;
  /** 1–8 slots; each one alone can release the content key. */
  readonly slots: readonly KeelSealedSlot[];
}

export interface KeelSealedPasskeySlotInput {
  readonly kind: "passkey-prf";
  readonly credentialId: Uint8Array;
  /** The 32-byte salt the passkey was evaluated with. */
  readonly prfSalt: Uint8Array;
  /** The 32-byte PRF result for `prfSalt`. Secret: use it, then drop it. */
  readonly prfOutput: Uint8Array;
  readonly rpId?: string;
  /** Store the raw credential id so non-discoverable passkeys can be asked for by id. Default false. */
  readonly includeCredentialId?: boolean;
  /** HKDF info. Defaults to {@link KEEL_SEALED_PASSKEY_INFO}. */
  readonly info?: string;
}

export interface KeelSealedPassphraseSlotInput {
  readonly kind: "passphrase";
  /** At least 8 characters after NFC normalization. Longer is much stronger: the envelope is public forever. */
  readonly passphrase: string;
  /** PBKDF2 iterations, 600,000–5,000,000. Defaults to 600,000. */
  readonly iterations?: number;
}

export interface KeelSealedRawKeySlotInput {
  readonly kind: "raw-key";
  /** 32 bytes, or the base64url text from {@link createKeelRecoveryKey}. */
  readonly key: Uint8Array | string;
}

export type KeelSealedSlotInput = KeelSealedPasskeySlotInput | KeelSealedPassphraseSlotInput | KeelSealedRawKeySlotInput;

export interface KeelSealedPasskeyUnlock {
  readonly kind: "passkey-prf";
  readonly prfOutput: Uint8Array;
  /** When given, only slots made for this passkey are tried. */
  readonly credentialId?: Uint8Array;
  readonly slotIndex?: number;
}

export interface KeelSealedPassphraseUnlock {
  readonly kind: "passphrase";
  readonly passphrase: string;
  readonly slotIndex?: number;
}

export interface KeelSealedRawKeyUnlock {
  readonly kind: "raw-key";
  readonly key: Uint8Array | string;
  readonly slotIndex?: number;
}

export type KeelSealedUnlock = KeelSealedPasskeyUnlock | KeelSealedPassphraseUnlock | KeelSealedRawKeyUnlock;

export interface KeelSealOptions {
  /** Defaults to "text/plain;charset=utf-8" for strings and "application/octet-stream" for bytes. */
  readonly mediaType?: string;
  /** "auto" (default) keeps deflate-raw only when it makes the payload smaller. */
  readonly compression?: "auto" | KeelSealedCompression;
  readonly slots: readonly KeelSealedSlotInput[];
  /** Include a salted plaintext commitment in the header. Default true. */
  readonly commitment?: boolean;
}

export interface KeelSealedSizes {
  readonly plaintext: number;
  readonly compressed: number;
  readonly header: number;
  readonly sealed: number;
}

export interface KeelSealResult {
  readonly envelope: Uint8Array;
  readonly header: KeelSealedHeader;
  /** Public, stable across slot changes: identifies the content key without revealing it. */
  readonly contentKeyFingerprint: Hex;
  /** The plaintext commitment with its secret salt; reveal it with the content to prove what was sealed. */
  readonly commitment?: KeelCommitment;
  readonly sizes: KeelSealedSizes;
}

export interface KeelOpenResult {
  readonly bytes: Uint8Array;
  /** Present when the media type is textual and the bytes are valid UTF-8. */
  readonly text?: string;
  readonly mediaType: string;
  readonly header: KeelSealedHeader;
  readonly slotIndex: number;
  readonly contentKeyFingerprint: Hex;
  readonly commitment?: KeelCommitment;
}

export interface KeelSealedSlotChange {
  readonly envelope: Uint8Array;
  readonly header: KeelSealedHeader;
}

export interface KeelSealedSlotSummary {
  readonly index: number;
  readonly kind: KeelSealedSlotKind;
  readonly rpId?: string;
  readonly credentialId?: KeelBase64Url;
  readonly iterations?: number;
}

export interface KeelSealedDescription {
  readonly protocol: typeof KEEL_SEALED_PROTOCOL;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly compression: KeelSealedCompression;
  readonly contentKeyFingerprint: Hex;
  readonly hasCommitment: boolean;
  readonly slots: readonly KeelSealedSlotSummary[];
  readonly sizes: { readonly header: number; readonly payload: number; readonly envelope: number };
}

export interface KeelSealedSizeEstimateOptions {
  readonly mediaType?: string;
  /** Defaults to one passkey slot. */
  readonly slots?: readonly KeelSealedSlotKind[];
  readonly commitment?: boolean;
  /** Bytes after compression, when known. Defaults to the plaintext size ("none" or no gain). */
  readonly compressedBytes?: number;
  /** For passkey slots that store their credential id. */
  readonly credentialIdBytes?: number;
  readonly rpId?: string;
}

export interface KeelSealedSizeEstimate {
  readonly plaintext: number;
  readonly header: number;
  readonly payload: number;
  /** Total envelope bytes: what an on-chain write stores. */
  readonly sealed: number;
  readonly overhead: number;
}

export type KeelSealedErrorCode = "no-slot" | "wrong-secret" | "tampered";

/**
 * A sealed object could not be opened. Malformed input throws TypeError and
 * size limits throw RangeError; this error is for the cryptographic outcomes.
 */
export class KeelSealedError extends Error {
  readonly code: KeelSealedErrorCode;

  constructor(code: KeelSealedErrorCode, message: string) {
    super(message);
    this.name = "KeelSealedError";
    this.code = code;
  }
}

// ------------------------------------------------------------------- helpers

type SlotParameters<S = KeelSealedSlot> = S extends KeelSealedSlot ? Omit<S, "wrappedKey"> : never;

const BASE64URL = /^[A-Za-z0-9_-]*$/u;
const HEX32 = /^0x[0-9a-fA-F]{64}$/u;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/u;
const RP_ID = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u;
const INFO = /^[ -~]{1,128}$/u;
const COMPRESSIONS: ReadonlySet<string> = new Set<KeelSealedCompression>(["none", "deflate-raw", "gzip"]);
const KIND_LABEL: Readonly<Record<KeelSealedSlotKind, string>> = { "passkey-prf": "passkey", passphrase: "passphrase", "raw-key": "recovery key" };

function record(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${what} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${what} must be a plain object.`);
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const name of Object.keys(value)) if (!allowed.includes(name)) throw new TypeError(`${what}: "${name}" is not supported.`);
}

function integer(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${what} must be a whole number from ${min} to ${max}.`);
  return value;
}

function bool(value: unknown, what: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${what} must be true or false.`);
  return value;
}

function bytesInput(value: unknown, what: string, min: number, max = min): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${what} must be Uint8Array bytes.`);
  if (value.byteLength < min || value.byteLength > max) throw new TypeError(`${what} must be ${min === max ? `${min}` : `${min}–${max}`} bytes.`);
  return value;
}

function contentBytes(value: unknown, what: string): Uint8Array {
  if (typeof value === "string") return utf8ToBytes(value);
  if (value instanceof Uint8Array) return value;
  throw new TypeError(`${what} must be text or Uint8Array bytes.`);
}

function toBase64Url(bytes: Uint8Array): KeelBase64Url {
  return encodeBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: unknown, what: string, min: number, max = min): Uint8Array {
  const message = `${what} must be ${min === max ? `${min}` : `${min}–${max}`} bytes of unpadded base64url.`;
  if (typeof value !== "string" || value.length > Math.ceil((max * 4) / 3) || !BASE64URL.test(value)) throw new TypeError(message);
  let bytes: Uint8Array;
  try {
    bytes = decodeText(value, "base64url");
  } catch {
    throw new TypeError(message);
  }
  if (bytes.byteLength < min || bytes.byteLength > max || toBase64Url(bytes) !== value) throw new TypeError(message);
  return bytes;
}

function hex32(value: unknown, what: string): Hex {
  if (typeof value !== "string" || !HEX32.test(value)) throw new TypeError(`${what} must be 32 bytes of 0x-prefixed hex.`);
  return value.toLowerCase() as Hex;
}

function uint32(value: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, false);
  return output;
}

function webCrypto(): Crypto {
  const runtime = globalThis.crypto;
  if (runtime?.subtle === undefined || typeof runtime.getRandomValues !== "function") {
    throw new Error("Web Crypto is unavailable; KEEL sealing needs crypto.subtle (browsers, Node 22+, Electron).");
  }
  return runtime;
}

function randomBytes(length: number): Uint8Array {
  const output = new Uint8Array(length);
  webCrypto().getRandomValues(output);
  return output;
}

function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  return digestBytes("sha256", concatBytes(parts));
}

async function hkdfBase(ikm: Uint8Array): Promise<CryptoKey> {
  return webCrypto().subtle.importKey("raw", toBufferSource(ikm), "HKDF", false, ["deriveBits", "deriveKey"]);
}

function hkdfParams(salt: Uint8Array, info: string): HkdfParams {
  return { name: "HKDF", hash: "SHA-256", salt: toBufferSource(salt), info: toBufferSource(utf8ToBytes(info)) };
}

async function hkdfBits(base: CryptoKey, salt: Uint8Array, info: string): Promise<Uint8Array> {
  return new Uint8Array(await webCrypto().subtle.deriveBits(hkdfParams(salt, info), base, KEY_BYTES * 8));
}

async function hkdfAesKey(ikm: Uint8Array, salt: Uint8Array, info: string): Promise<CryptoKey> {
  return webCrypto().subtle.deriveKey(hkdfParams(salt, info), await hkdfBase(ikm), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function pbkdf2AesKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const subtle = webCrypto().subtle;
  const base = await subtle.importKey("raw", toBufferSource(utf8ToBytes(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: toBufferSource(salt), iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function aesEncrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  const params: AesGcmParams = { name: "AES-GCM", iv: toBufferSource(iv), additionalData: toBufferSource(aad), tagLength: 128 };
  return new Uint8Array(await webCrypto().subtle.encrypt(params, key, toBufferSource(data)));
}

/** Undefined when authentication fails: AES-GCM does not say why, and neither do we. */
async function aesDecrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array, aad: Uint8Array): Promise<Uint8Array | undefined> {
  try {
    const params: AesGcmParams = { name: "AES-GCM", iv: toBufferSource(iv), additionalData: toBufferSource(aad), tagLength: 128 };
    return new Uint8Array(await webCrypto().subtle.decrypt(params, key, toBufferSource(data)));
  } catch {
    return undefined;
  }
}

interface ContentKeys {
  readonly cipher: CryptoKey;
  readonly keyCommitment: Uint8Array;
  readonly plaintextSalt: Uint8Array;
}

async function contentKeys(contentKey: Uint8Array): Promise<ContentKeys> {
  const empty = new Uint8Array(0);
  const base = await hkdfBase(contentKey);
  const [cipher, keyCommitment, plaintextSalt] = await Promise.all([
    webCrypto().subtle.deriveKey(hkdfParams(empty, LABEL.contentKey), base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]),
    hkdfBits(base, empty, LABEL.keyCommitment),
    hkdfBits(base, empty, LABEL.plaintextSalt),
  ]);
  return { cipher, keyCommitment, plaintextSalt };
}

function contentAad(content: KeelSealedContentHeader): Uint8Array {
  return concatBytes([utf8ToBytes(LABEL.content), Uint8Array.of(0), utf8ToBytes(canonicalJson(content))]);
}

function slotParameters(slot: KeelSealedSlot): SlotParameters {
  const parameters: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(slot)) if (name !== "wrappedKey") parameters[name] = value;
  return parameters as SlotParameters;
}

function slotAad(keyCommitment: KeelBase64Url, parameters: SlotParameters): Uint8Array {
  return concatBytes([utf8ToBytes(LABEL.slot), Uint8Array.of(0), utf8ToBytes(canonicalJson({ keyCommitment, slot: parameters }))]);
}

async function credentialHash(credentialId: Uint8Array, salt: Uint8Array): Promise<KeelBase64Url> {
  const digest = await sha256(utf8ToBytes(LABEL.credential), Uint8Array.of(0), salt, credentialId);
  return toBase64Url(digest.subarray(0, CREDENTIAL_HASH_BYTES));
}

async function commitmentDigest(bytes: Uint8Array, salt: Uint8Array | undefined): Promise<Uint8Array> {
  if (salt === undefined) return digestBytes("sha256", bytes);
  return sha256(utf8ToBytes(LABEL.commitment), Uint8Array.of(0, salt.byteLength), salt, bytes);
}

function sourceStream(bytes: Uint8Array): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(toBufferSource(bytes));
      controller.close();
    },
  });
}

/** Reads a stream into memory, stopping as soon as it passes `limit` bytes. */
async function collect(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array | undefined> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  return concatBytes(chunks);
}

async function compress(bytes: Uint8Array, format: "deflate-raw" | "gzip"): Promise<Uint8Array> {
  const output = await collect(sourceStream(bytes).pipeThrough(new CompressionStream(format)), KEEL_SEALED_MAX_PAYLOAD_BYTES);
  if (output === undefined) throw new RangeError("Compressed content exceeds the sealed payload limit.");
  return output;
}

async function decompress(bytes: Uint8Array, compression: KeelSealedCompression, byteLength: number): Promise<Uint8Array> {
  if (compression === "none") {
    if (bytes.byteLength !== byteLength) throw new KeelSealedError("tampered", "The opened content does not have its declared length.");
    return bytes;
  }
  let output: Uint8Array | undefined;
  try {
    output = await collect(sourceStream(bytes).pipeThrough(new DecompressionStream(compression)), byteLength);
  } catch {
    throw new KeelSealedError("tampered", "The sealed content could not be decompressed.");
  }
  if (output === undefined || output.byteLength !== byteLength) throw new KeelSealedError("tampered", "The opened content does not have its declared length.");
  return output;
}

function isTextual(mediaType: string): boolean {
  const [essence = ""] = mediaType.toLowerCase().split(";");
  return essence.startsWith("text/")
    || essence === "application/json"
    || essence === "application/xml"
    || essence === "application/javascript"
    || essence.endsWith("+json")
    || essence.endsWith("+xml")
    || /;charset=utf-8(?:;|$)/u.test(mediaType.toLowerCase());
}

function textOf(bytes: Uint8Array, mediaType: string): string | undefined {
  if (!isTextual(mediaType)) return undefined;
  try {
    return bytesToUtf8(bytes);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- commitments

/** Validates a commitment received as data and returns it with lowercase hex. */
export function normalizeKeelCommitment(value: unknown): KeelCommitment {
  const input = record(value, "Commitment");
  onlyKeys(input, ["protocol", "algorithm", "digest", "salt"], "Commitment");
  if (input.protocol !== KEEL_COMMITMENT_PROTOCOL) throw new TypeError(`Commitment must use ${KEEL_COMMITMENT_PROTOCOL}.`);
  if (input.algorithm !== "sha-256") throw new TypeError('Commitment algorithm must be "sha-256".');
  const digest = hex32(input.digest, "Commitment digest");
  if (input.salt === undefined) return { protocol: KEEL_COMMITMENT_PROTOCOL, algorithm: "sha-256", digest };
  if (typeof input.salt !== "string" || !HEX.test(input.salt)) throw new TypeError("Commitment salt must be 0x-prefixed hex.");
  bytesInput(hexToBytes(input.salt), "Commitment salt", 16, MAX_SALT_BYTES);
  return { protocol: KEEL_COMMITMENT_PROTOCOL, algorithm: "sha-256", digest, salt: input.salt.toLowerCase() as Hex };
}

/**
 * Commit to text or bytes. Publish `digest`; keep `salt` and the content until
 * you want to reveal them. Unsalted commitments equal plain SHA-256, so anyone
 * holding a public file can check it with ordinary tools.
 */
export async function createKeelCommitment(content: Uint8Array | string, options: KeelCommitmentOptions = {}): Promise<KeelCommitment> {
  const bytes = contentBytes(content, "Committed content");
  const input = record(options, "Commitment options");
  onlyKeys(input, ["salt"], "Commitment options");
  const choice = input.salt ?? "random";
  let salt: Uint8Array | undefined;
  if (choice === "random") salt = randomBytes(KEY_BYTES);
  else if (choice instanceof Uint8Array) salt = bytesInput(choice, "Commitment salt", 16, MAX_SALT_BYTES);
  else if (choice !== "none") throw new TypeError('Commitment salt must be "random", "none" or 16–64 bytes.');
  const digest = bytesToHex(await commitmentDigest(bytes, salt));
  return salt === undefined
    ? { protocol: KEEL_COMMITMENT_PROTOCOL, algorithm: "sha-256", digest }
    : { protocol: KEEL_COMMITMENT_PROTOCOL, algorithm: "sha-256", digest, salt: bytesToHex(salt) };
}

/** True when `content` is what the commitment was made for. Malformed commitments throw TypeError. */
export async function verifyKeelCommitment(commitment: KeelCommitment, content: Uint8Array | string): Promise<boolean> {
  const normalized = normalizeKeelCommitment(commitment);
  const bytes = contentBytes(content, "Revealed content");
  const salt = normalized.salt === undefined ? undefined : hexToBytes(normalized.salt);
  return equalBytes(await commitmentDigest(bytes, salt), hexToBytes(normalized.digest));
}

const leafHash = (digest: Uint8Array) => sha256(Uint8Array.of(0), digest);
const nodeHash = (left: Uint8Array, right: Uint8Array) => sha256(Uint8Array.of(1), left, right);
const merkleRoot = (count: number, top: Uint8Array) => sha256(utf8ToBytes(LABEL.merkle), Uint8Array.of(2), uint32(count), top);

function isCommitmentLike(value: unknown): boolean {
  return value !== null && typeof value === "object" && !(value instanceof Uint8Array);
}

/**
 * Commit to many items under one 32-byte root. Leaves are
 * SHA-256(0x00 itemDigest), inner nodes SHA-256(0x01 left right), an odd last
 * node is carried up unchanged, and the root is
 * SHA-256("keel-merkle@1" 0x02 uint32be(count) top). Each item is salted on its
 * own (unless `salt: "none"`), so revealing one says nothing about the others.
 * Items may also be existing commitments.
 */
export async function createKeelMerkleCommitment(
  items: readonly (Uint8Array | string | KeelCommitment)[],
  options: { readonly salt?: "random" | "none" } = {},
): Promise<KeelMerkleCommitment> {
  if (!Array.isArray(items) || items.length < 1 || items.length > KEEL_MERKLE_MAX_ITEMS) throw new TypeError(`A Merkle commitment needs 1–${KEEL_MERKLE_MAX_ITEMS} items.`);
  const input = record(options, "Merkle options");
  onlyKeys(input, ["salt"], "Merkle options");
  const salt = input.salt ?? "random";
  if (salt !== "random" && salt !== "none") throw new TypeError('Merkle salt must be "random" or "none".');
  const commitments: KeelCommitment[] = [];
  for (const item of items) commitments.push(isCommitmentLike(item) ? normalizeKeelCommitment(item) : await createKeelCommitment(item as Uint8Array | string, { salt }));
  const levels: Uint8Array[][] = [[]];
  for (const commitment of commitments) levels[0]!.push(await leafHash(hexToBytes(commitment.digest)));
  for (let level = levels[0]!; level.length > 1; level = levels[levels.length - 1]!) {
    const next: Uint8Array[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const right = level[index + 1];
      next.push(right === undefined ? level[index]! : await nodeHash(level[index]!, right));
    }
    levels.push(next);
  }
  const count = commitments.length;
  const root = bytesToHex(await merkleRoot(count, levels[levels.length - 1]![0]!));
  return {
    protocol: KEEL_MERKLE_PROTOCOL,
    algorithm: "sha-256",
    root,
    count,
    items: commitments,
    proofFor(index: number): KeelMerkleProof {
      integer(index, "Merkle proof index", 0, count - 1);
      const siblings: Hex[] = [];
      let position = index;
      for (const level of levels.slice(0, -1)) {
        const sibling = level[position % 2 === 1 ? position - 1 : position + 1];
        if (sibling !== undefined) siblings.push(bytesToHex(sibling));
        position = Math.floor(position / 2);
      }
      return { protocol: KEEL_MERKLE_PROOF_PROTOCOL, index, count, item: commitments[index]!, siblings };
    },
  };
}

/** Validates a Merkle proof received as data. */
export function normalizeKeelMerkleProof(value: unknown): KeelMerkleProof {
  const input = record(value, "Merkle proof");
  onlyKeys(input, ["protocol", "index", "count", "item", "siblings"], "Merkle proof");
  if (input.protocol !== KEEL_MERKLE_PROOF_PROTOCOL) throw new TypeError(`Merkle proof must use ${KEEL_MERKLE_PROOF_PROTOCOL}.`);
  const count = integer(input.count, "Merkle proof count", 1, KEEL_MERKLE_MAX_ITEMS);
  const index = integer(input.index, "Merkle proof index", 0, count - 1);
  if (!Array.isArray(input.siblings) || input.siblings.length > MERKLE_MAX_DEPTH) throw new TypeError(`Merkle proof siblings must be a list of at most ${MERKLE_MAX_DEPTH} hashes.`);
  const siblings = input.siblings.map((entry, position) => hex32(entry, `Merkle proof sibling ${position + 1}`));
  return { protocol: KEEL_MERKLE_PROOF_PROTOCOL, index, count, item: normalizeKeelCommitment(input.item), siblings };
}

/** True when `content` is item `proof.index` of the tree with this root. */
export async function verifyKeelMerkleProof(root: Hex, content: Uint8Array | string, proof: KeelMerkleProof): Promise<boolean> {
  const expected = hexToBytes(hex32(root, "Merkle root"));
  const normalized = normalizeKeelMerkleProof(proof);
  if (!(await verifyKeelCommitment(normalized.item, content))) return false;
  let hash = await leafHash(hexToBytes(normalized.item.digest));
  let position = normalized.index;
  let size = normalized.count;
  let used = 0;
  while (size > 1) {
    const hasSibling = position % 2 === 1 || position + 1 < size;
    if (hasSibling) {
      const sibling = normalized.siblings[used];
      if (sibling === undefined) return false;
      used += 1;
      hash = position % 2 === 1 ? await nodeHash(hexToBytes(sibling), hash) : await nodeHash(hash, hexToBytes(sibling));
    }
    position = Math.floor(position / 2);
    size = Math.ceil(size / 2);
  }
  if (used !== normalized.siblings.length) return false;
  return equalBytes(await merkleRoot(normalized.count, hash), expected);
}

// ------------------------------------------------------------- header format

function normalizeContentHeader(value: unknown): KeelSealedContentHeader {
  const input = record(value, "Sealed content header");
  onlyKeys(input, ["cipher", "compression", "iv", "keyCommitment", "mediaType", "byteLength", "payloadBytes", "commitment"], "Sealed content header");
  if (input.cipher !== "aes-256-gcm") throw new TypeError('Sealed content cipher must be "aes-256-gcm".');
  if (typeof input.compression !== "string" || !COMPRESSIONS.has(input.compression)) throw new TypeError('Sealed content compression must be "none", "deflate-raw" or "gzip".');
  const compression = input.compression as KeelSealedCompression;
  fromBase64Url(input.iv, "Sealed content iv", IV_BYTES);
  fromBase64Url(input.keyCommitment, "Sealed key commitment", KEY_BYTES);
  if (typeof input.mediaType !== "string") throw new TypeError("Sealed media type must be text.");
  const mediaType = assertDataUriMediaType(input.mediaType);
  const byteLength = integer(input.byteLength, "Sealed byte length", 0, KEEL_SEALED_MAX_PLAINTEXT_BYTES);
  const payloadBytes = integer(input.payloadBytes, "Sealed payload length", TAG_BYTES, KEEL_SEALED_MAX_PAYLOAD_BYTES);
  if (compression === "none" && payloadBytes !== byteLength + TAG_BYTES) throw new TypeError("Sealed payload length does not match the uncompressed byte length.");
  if (compression !== "none" && payloadBytes === TAG_BYTES) throw new TypeError("Compressed sealed content cannot be empty.");
  const header: KeelSealedContentHeader = {
    cipher: "aes-256-gcm",
    compression,
    iv: input.iv as string,
    keyCommitment: input.keyCommitment as string,
    mediaType,
    byteLength,
    payloadBytes,
  };
  if (input.commitment === undefined) return header;
  fromBase64Url(input.commitment, "Sealed plaintext commitment", KEY_BYTES);
  return { ...header, commitment: input.commitment as string };
}

function normalizeSlot(value: unknown, index: number): KeelSealedSlot {
  const what = `Sealed slot ${index + 1}`;
  const input = record(value, what);
  const wrap = () => {
    fromBase64Url(input.iv, `${what} iv`, IV_BYTES);
    fromBase64Url(input.wrappedKey, `${what} wrapped key`, WRAPPED_KEY_BYTES);
    return { iv: input.iv as string, wrappedKey: input.wrappedKey as string };
  };
  switch (input.kind) {
    case "passkey-prf": {
      onlyKeys(input, ["kind", "credentialHash", "credentialId", "rpId", "salt", "info", "iv", "wrappedKey"], what);
      fromBase64Url(input.credentialHash, `${what} credential hash`, CREDENTIAL_HASH_BYTES);
      fromBase64Url(input.salt, `${what} salt`, KEEL_SEALED_PRF_SALT_BYTES);
      if (typeof input.info !== "string" || !INFO.test(input.info)) throw new TypeError(`${what} info must be 1–128 printable ASCII characters.`);
      const slot: { -readonly [K in keyof KeelSealedPasskeySlot]: KeelSealedPasskeySlot[K] } = {
        kind: "passkey-prf",
        credentialHash: input.credentialHash as string,
        salt: input.salt as string,
        info: input.info,
        ...wrap(),
      };
      if (input.credentialId !== undefined) {
        fromBase64Url(input.credentialId, `${what} credential id`, 1, MAX_CREDENTIAL_ID_BYTES);
        slot.credentialId = input.credentialId as string;
      }
      if (input.rpId !== undefined) {
        if (typeof input.rpId !== "string" || !RP_ID.test(input.rpId)) throw new TypeError(`${what} rpId must be a lowercase domain name.`);
        slot.rpId = input.rpId;
      }
      return slot;
    }
    case "passphrase": {
      onlyKeys(input, ["kind", "kdf", "iv", "wrappedKey"], what);
      const kdf = record(input.kdf, `${what} kdf`);
      if (kdf.name === "argon2id") throw new TypeError(`${what} uses argon2id, which this reader does not support yet.`);
      if (kdf.name !== "pbkdf2-sha256") throw new TypeError(`${what} kdf must be "pbkdf2-sha256".`);
      onlyKeys(kdf, ["name", "iterations", "salt"], `${what} kdf`);
      const iterations = integer(kdf.iterations, `${what} PBKDF2 iterations`, KEEL_SEALED_PBKDF2_MIN_ITERATIONS, KEEL_SEALED_PBKDF2_MAX_ITERATIONS);
      fromBase64Url(kdf.salt, `${what} kdf salt`, KDF_SALT_BYTES, MAX_SALT_BYTES);
      return { kind: "passphrase", kdf: { name: "pbkdf2-sha256", iterations, salt: kdf.salt as string }, ...wrap() };
    }
    case "raw-key":
      onlyKeys(input, ["kind", "salt", "iv", "wrappedKey"], what);
      fromBase64Url(input.salt, `${what} salt`, KDF_SALT_BYTES, MAX_SALT_BYTES);
      return { kind: "raw-key", salt: input.salt as string, ...wrap() };
    case "recipient":
      throw new TypeError(`${what} is a recipient (public-key) slot, which is reserved for a future keel-sealed version.`);
    default:
      throw new TypeError(`${what} has an unsupported kind.`);
  }
}

/** Validates a sealed header received as data (every field, strictly). */
export function normalizeKeelSealedHeader(value: unknown): KeelSealedHeader {
  const input = record(value, "Sealed header");
  onlyKeys(input, ["protocol", "content", "slots"], "Sealed header");
  if (input.protocol !== KEEL_SEALED_PROTOCOL) {
    throw new TypeError(typeof input.protocol === "string" && input.protocol.startsWith("keel-sealed@")
      ? `Unsupported sealed protocol ${input.protocol}; this reader understands ${KEEL_SEALED_PROTOCOL}.`
      : `Sealed header must use ${KEEL_SEALED_PROTOCOL}.`);
  }
  const content = normalizeContentHeader(input.content);
  if (!Array.isArray(input.slots) || input.slots.length < 1 || input.slots.length > KEEL_SEALED_MAX_SLOTS) throw new TypeError(`A sealed header needs 1–${KEEL_SEALED_MAX_SLOTS} slots.`);
  const slots = input.slots.map(normalizeSlot);
  if (new Set(slots.map((slot) => slot.wrappedKey)).size !== slots.length) throw new TypeError("Sealed slots must not repeat.");
  return { protocol: KEEL_SEALED_PROTOCOL, content, slots };
}

function encodeEnvelope(header: KeelSealedHeader, payload: Uint8Array): Uint8Array {
  const headerBytes = utf8ToBytes(canonicalJson(header));
  if (headerBytes.byteLength > KEEL_SEALED_MAX_HEADER_BYTES) throw new RangeError(`A sealed header is limited to ${KEEL_SEALED_MAX_HEADER_BYTES} bytes.`);
  const prefix = new Uint8Array(FRAME_PREFIX_BYTES);
  prefix.set(MAGIC);
  prefix[4] = KEEL_SEALED_FRAME_VERSION;
  new DataView(prefix.buffer).setUint32(5, headerBytes.byteLength, false);
  return concatBytes([prefix, headerBytes, payload]);
}

interface SplitEnvelope {
  readonly header: KeelSealedHeader;
  readonly headerBytes: number;
  readonly payload: Uint8Array;
}

function splitEnvelope(envelope: unknown): SplitEnvelope {
  if (!(envelope instanceof Uint8Array)) throw new TypeError("A sealed envelope must be Uint8Array bytes.");
  if (envelope.byteLength > FRAME_PREFIX_BYTES + KEEL_SEALED_MAX_HEADER_BYTES + KEEL_SEALED_MAX_PAYLOAD_BYTES) throw new RangeError("Sealed envelope exceeds the size limit.");
  if (envelope.byteLength < MAGIC.length || MAGIC.some((byte, index) => envelope[index] !== byte)) throw new TypeError("These bytes are not a KEEL sealed envelope.");
  if (envelope.byteLength < FRAME_PREFIX_BYTES) throw new TypeError("Sealed envelope is truncated.");
  if (envelope[4] !== KEEL_SEALED_FRAME_VERSION) throw new TypeError(`Unsupported sealed envelope version ${envelope[4]}; this reader understands version ${KEEL_SEALED_FRAME_VERSION}.`);
  const headerLength = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength).getUint32(5, false);
  if (headerLength < 2 || headerLength > KEEL_SEALED_MAX_HEADER_BYTES) throw new RangeError(`Sealed header length must be 2–${KEEL_SEALED_MAX_HEADER_BYTES} bytes.`);
  if (FRAME_PREFIX_BYTES + headerLength > envelope.byteLength) throw new TypeError("Sealed envelope is truncated.");
  let parsed: unknown;
  let text: string;
  try {
    text = bytesToUtf8(envelope.subarray(FRAME_PREFIX_BYTES, FRAME_PREFIX_BYTES + headerLength));
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError("Sealed header is not valid UTF-8 JSON.");
  }
  const header = normalizeKeelSealedHeader(parsed);
  if (canonicalJson(header) !== text) throw new TypeError("Sealed header is not canonical JSON (RFC 8785).");
  const payload = envelope.subarray(FRAME_PREFIX_BYTES + headerLength);
  if (payload.byteLength < header.content.payloadBytes) throw new TypeError("Sealed envelope is truncated.");
  if (payload.byteLength > header.content.payloadBytes) throw new TypeError("Sealed envelope has trailing bytes.");
  return { header, headerBytes: headerLength, payload };
}

/** Reads and validates the header without any secret: what a sealed object is and which slots can open it. */
export function parseKeelSealedHeader(envelope: Uint8Array): KeelSealedHeader {
  return splitEnvelope(envelope).header;
}

/** True when the bytes start like a sealed envelope (magic only; parse to validate). */
export function isKeelSealedEnvelope(bytes: Uint8Array): boolean {
  return bytes instanceof Uint8Array && bytes.byteLength >= FRAME_PREFIX_BYTES && MAGIC.every((byte, index) => bytes[index] === byte);
}

/** A display summary of a sealed object, for UIs. */
export function describeKeelSealed(envelope: Uint8Array): KeelSealedDescription {
  const { header, headerBytes, payload } = splitEnvelope(envelope);
  return {
    protocol: KEEL_SEALED_PROTOCOL,
    mediaType: header.content.mediaType,
    byteLength: header.content.byteLength,
    compression: header.content.compression,
    contentKeyFingerprint: bytesToHex(fromBase64Url(header.content.keyCommitment, "Sealed key commitment", KEY_BYTES)),
    hasCommitment: header.content.commitment !== undefined,
    slots: header.slots.map((slot, index): KeelSealedSlotSummary => {
      if (slot.kind === "passphrase") return { index, kind: slot.kind, iterations: slot.kdf.iterations };
      if (slot.kind === "raw-key") return { index, kind: slot.kind };
      return { index, kind: slot.kind, ...(slot.rpId === undefined ? {} : { rpId: slot.rpId }), ...(slot.credentialId === undefined ? {} : { credentialId: slot.credentialId }) };
    }),
    sizes: { header: headerBytes, payload: payload.byteLength, envelope: envelope.byteLength },
  };
}

/** Indexes of the passkey slots that were made for this credential id. */
export async function matchKeelSealedPasskeySlots(header: KeelSealedHeader, credentialId: Uint8Array): Promise<number[]> {
  bytesInput(credentialId, "Credential id", 1, MAX_CREDENTIAL_ID_BYTES);
  const matches: number[] = [];
  for (const [index, slot] of header.slots.entries()) {
    if (slot.kind !== "passkey-prf") continue;
    if (await credentialHash(credentialId, fromBase64Url(slot.salt, "Passkey salt", KEEL_SEALED_PRF_SALT_BYTES)) === slot.credentialHash) matches.push(index);
  }
  return matches;
}

// ---------------------------------------------------------------- recovery key

/** A fresh 32-byte recovery key and its 43-character base64url text for saving offline. */
export function createKeelRecoveryKey(): { readonly key: Uint8Array; readonly text: string } {
  const key = randomBytes(KEY_BYTES);
  return { key, text: toBase64Url(key) };
}

/** Reads a recovery key written by {@link createKeelRecoveryKey}; surrounding whitespace is ignored. */
export function parseKeelRecoveryKey(text: string): Uint8Array {
  if (typeof text !== "string") throw new TypeError("A recovery key must be text.");
  return fromBase64Url(text.trim(), "Recovery key", KEY_BYTES);
}

// ----------------------------------------------------------------- slot input

type NormalizedSlotInput =
  | { readonly kind: "passkey-prf"; readonly credentialId: Uint8Array; readonly prfSalt: Uint8Array; readonly prfOutput: Uint8Array; readonly rpId?: string; readonly includeCredentialId: boolean; readonly info: string }
  | { readonly kind: "passphrase"; readonly passphrase: string; readonly iterations: number }
  | { readonly kind: "raw-key"; readonly key: Uint8Array };

function normalizePassphrase(value: unknown, minimum: number): string {
  if (typeof value !== "string") throw new TypeError("A passphrase must be text.");
  const normalized = value.normalize("NFC");
  if ([...normalized].length < minimum || normalized.length > MAX_PASSPHRASE_LENGTH) {
    throw new TypeError(minimum > 1 ? `A sealing passphrase needs ${minimum}–${MAX_PASSPHRASE_LENGTH} characters.` : "A passphrase cannot be empty.");
  }
  return normalized;
}

function rawKeyInput(value: unknown): Uint8Array {
  return typeof value === "string" ? parseKeelRecoveryKey(value) : bytesInput(value, "Recovery key", KEY_BYTES);
}

function normalizeSlotInput(value: unknown, index: number): NormalizedSlotInput {
  const what = `Slot input ${index + 1}`;
  const input = record(value, what);
  switch (input.kind) {
    case "passkey-prf": {
      onlyKeys(input, ["kind", "credentialId", "prfSalt", "prfOutput", "rpId", "includeCredentialId", "info"], what);
      const info = input.info ?? KEEL_SEALED_PASSKEY_INFO;
      if (typeof info !== "string" || !INFO.test(info)) throw new TypeError(`${what} info must be 1–128 printable ASCII characters.`);
      if (input.rpId !== undefined && (typeof input.rpId !== "string" || !RP_ID.test(input.rpId))) throw new TypeError(`${what} rpId must be a lowercase domain name.`);
      return {
        kind: "passkey-prf",
        credentialId: bytesInput(input.credentialId, `${what} credential id`, 1, MAX_CREDENTIAL_ID_BYTES),
        prfSalt: bytesInput(input.prfSalt, `${what} PRF salt`, KEEL_SEALED_PRF_SALT_BYTES),
        prfOutput: bytesInput(input.prfOutput, `${what} PRF output`, KEY_BYTES),
        includeCredentialId: input.includeCredentialId === undefined ? false : bool(input.includeCredentialId, `${what} includeCredentialId`),
        info,
        ...(input.rpId === undefined ? {} : { rpId: input.rpId as string }),
      };
    }
    case "passphrase":
      onlyKeys(input, ["kind", "passphrase", "iterations"], what);
      return {
        kind: "passphrase",
        passphrase: normalizePassphrase(input.passphrase, KEEL_SEALED_MIN_PASSPHRASE_LENGTH),
        iterations: input.iterations === undefined
          ? KEEL_SEALED_PBKDF2_MIN_ITERATIONS
          : integer(input.iterations, `${what} PBKDF2 iterations`, KEEL_SEALED_PBKDF2_MIN_ITERATIONS, KEEL_SEALED_PBKDF2_MAX_ITERATIONS),
      };
    case "raw-key":
      onlyKeys(input, ["kind", "key"], what);
      return { kind: "raw-key", key: rawKeyInput(input.key) };
    default:
      throw new TypeError(`${what} kind must be "passkey-prf", "passphrase" or "raw-key".`);
  }
}

async function wrapSlot(contentKey: Uint8Array, keyCommitment: KeelBase64Url, input: NormalizedSlotInput): Promise<KeelSealedSlot> {
  const iv = randomBytes(IV_BYTES);
  let parameters: SlotParameters;
  let kek: CryptoKey;
  switch (input.kind) {
    case "passkey-prf":
      parameters = {
        kind: "passkey-prf",
        credentialHash: await credentialHash(input.credentialId, input.prfSalt),
        salt: toBase64Url(input.prfSalt),
        info: input.info,
        iv: toBase64Url(iv),
        ...(input.includeCredentialId ? { credentialId: toBase64Url(input.credentialId) } : {}),
        ...(input.rpId === undefined ? {} : { rpId: input.rpId }),
      };
      kek = await hkdfAesKey(input.prfOutput, input.prfSalt, input.info);
      break;
    case "passphrase": {
      const salt = randomBytes(KDF_SALT_BYTES);
      parameters = { kind: "passphrase", kdf: { name: "pbkdf2-sha256", iterations: input.iterations, salt: toBase64Url(salt) }, iv: toBase64Url(iv) };
      kek = await pbkdf2AesKey(input.passphrase, salt, input.iterations);
      break;
    }
    case "raw-key": {
      const salt = randomBytes(KDF_SALT_BYTES);
      parameters = { kind: "raw-key", salt: toBase64Url(salt), iv: toBase64Url(iv) };
      kek = await hkdfAesKey(input.key, salt, LABEL.rawKey);
      break;
    }
  }
  const wrapped = await aesEncrypt(kek, iv, contentKey, slotAad(keyCommitment, parameters));
  return { ...parameters, wrappedKey: toBase64Url(wrapped) } as KeelSealedSlot;
}

// --------------------------------------------------------------------- unlock

type NormalizedUnlock =
  | { readonly kind: "passkey-prf"; readonly prfOutput: Uint8Array; readonly credentialId?: Uint8Array; readonly slotIndex?: number }
  | { readonly kind: "passphrase"; readonly passphrase: string; readonly slotIndex?: number }
  | { readonly kind: "raw-key"; readonly key: Uint8Array; readonly slotIndex?: number };

function normalizeUnlock(value: unknown): NormalizedUnlock {
  const input = record(value, "Unlock");
  const slot = input.slotIndex === undefined ? {} : { slotIndex: integer(input.slotIndex, "Unlock slotIndex", 0, KEEL_SEALED_MAX_SLOTS - 1) };
  switch (input.kind) {
    case "passkey-prf":
      onlyKeys(input, ["kind", "prfOutput", "credentialId", "slotIndex"], "Unlock");
      return {
        kind: "passkey-prf",
        prfOutput: bytesInput(input.prfOutput, "PRF output", KEY_BYTES),
        ...(input.credentialId === undefined ? {} : { credentialId: bytesInput(input.credentialId, "Credential id", 1, MAX_CREDENTIAL_ID_BYTES) }),
        ...slot,
      };
    case "passphrase":
      onlyKeys(input, ["kind", "passphrase", "slotIndex"], "Unlock");
      return { kind: "passphrase", passphrase: normalizePassphrase(input.passphrase, 1), ...slot };
    case "raw-key":
      onlyKeys(input, ["kind", "key", "slotIndex"], "Unlock");
      return { kind: "raw-key", key: rawKeyInput(input.key), ...slot };
    default:
      throw new TypeError('Unlock kind must be "passkey-prf", "passphrase" or "raw-key".');
  }
}

const WRONG_SECRET: Readonly<Record<KeelSealedSlotKind, string>> = {
  "passkey-prf": "This passkey does not unlock this sealed object.",
  passphrase: "That passphrase does not unlock this sealed object.",
  "raw-key": "That recovery key does not unlock this sealed object.",
};

interface UnlockedKey {
  readonly contentKey: Uint8Array;
  readonly keys: ContentKeys;
  readonly slotIndex: number;
}

async function unlockContentKey(header: KeelSealedHeader, unlock: KeelSealedUnlock): Promise<UnlockedKey> {
  const request = normalizeUnlock(unlock);
  let candidates = header.slots.flatMap((slot, index) => (slot.kind === request.kind ? [{ slot, index }] : []));
  if (request.slotIndex !== undefined) {
    candidates = candidates.filter((candidate) => candidate.index === request.slotIndex);
    if (candidates.length === 0) throw new KeelSealedError("no-slot", `Slot ${request.slotIndex + 1} is not a ${KIND_LABEL[request.kind]} slot.`);
  }
  if (candidates.length === 0) throw new KeelSealedError("no-slot", `This sealed object has no ${KIND_LABEL[request.kind]} slot.`);
  if (request.kind === "passkey-prf" && request.credentialId !== undefined) {
    const matching = new Set(await matchKeelSealedPasskeySlots(header, request.credentialId));
    candidates = candidates.filter((candidate) => matching.has(candidate.index));
    if (candidates.length === 0) throw new KeelSealedError("no-slot", "This passkey is not one of the passkeys that can open this sealed object.");
  }
  const expected = fromBase64Url(header.content.keyCommitment, "Sealed key commitment", KEY_BYTES);
  let mismatched = false;
  for (const { slot, index } of candidates) {
    let kek: CryptoKey;
    if (slot.kind === "passkey-prf" && request.kind === "passkey-prf") {
      kek = await hkdfAesKey(request.prfOutput, fromBase64Url(slot.salt, "Passkey salt", KEEL_SEALED_PRF_SALT_BYTES), slot.info);
    } else if (slot.kind === "passphrase" && request.kind === "passphrase") {
      kek = await pbkdf2AesKey(request.passphrase, fromBase64Url(slot.kdf.salt, "Passphrase salt", KDF_SALT_BYTES, MAX_SALT_BYTES), slot.kdf.iterations);
    } else if (slot.kind === "raw-key" && request.kind === "raw-key") {
      kek = await hkdfAesKey(request.key, fromBase64Url(slot.salt, "Recovery key salt", KDF_SALT_BYTES, MAX_SALT_BYTES), LABEL.rawKey);
    } else {
      continue;
    }
    const contentKey = await aesDecrypt(
      kek,
      fromBase64Url(slot.iv, "Slot iv", IV_BYTES),
      fromBase64Url(slot.wrappedKey, "Wrapped key", WRAPPED_KEY_BYTES),
      slotAad(header.content.keyCommitment, slotParameters(slot)),
    );
    if (contentKey === undefined) continue;
    const keys = await contentKeys(contentKey);
    if (contentKey.byteLength === KEY_BYTES && equalBytes(keys.keyCommitment, expected)) return { contentKey, keys, slotIndex: index };
    contentKey.fill(0);
    mismatched = true;
  }
  if (mismatched) throw new KeelSealedError("tampered", "A slot released a key that does not match this sealed object; the envelope was altered.");
  throw new KeelSealedError("wrong-secret", WRONG_SECRET[request.kind]);
}

// ------------------------------------------------------------- seal and open

/**
 * Compress (optionally) and encrypt content into a `keel-sealed@1` envelope.
 * Every slot input becomes a key slot that can open it on its own.
 */
export async function sealKeelContent(content: Uint8Array | string, options: KeelSealOptions): Promise<KeelSealResult> {
  const plaintext = contentBytes(content, "Sealed content");
  if (plaintext.byteLength > KEEL_SEALED_MAX_PLAINTEXT_BYTES) throw new RangeError(`Sealed content is limited to ${KEEL_SEALED_MAX_PLAINTEXT_BYTES} bytes (16 MiB).`);
  const input = record(options, "Seal options");
  onlyKeys(input, ["mediaType", "compression", "slots", "commitment"], "Seal options");
  let mediaType = typeof content === "string" ? "text/plain;charset=utf-8" : "application/octet-stream";
  if (input.mediaType !== undefined) {
    if (typeof input.mediaType !== "string") throw new TypeError("Sealed media type must be text.");
    mediaType = assertDataUriMediaType(input.mediaType);
  }
  const choice = input.compression ?? "auto";
  if (choice !== "auto" && (typeof choice !== "string" || !COMPRESSIONS.has(choice))) throw new TypeError('Compression must be "auto", "none", "deflate-raw" or "gzip".');
  if (!Array.isArray(input.slots) || input.slots.length < 1 || input.slots.length > KEEL_SEALED_MAX_SLOTS) throw new TypeError(`Sealing needs 1–${KEEL_SEALED_MAX_SLOTS} slots.`);
  const slotInputs = input.slots.map(normalizeSlotInput);
  const includeCommitment = input.commitment === undefined ? true : bool(input.commitment, "Seal option commitment");

  let compression: KeelSealedCompression = "none";
  let compressed = plaintext;
  if (choice === "deflate-raw" || choice === "gzip") {
    compression = choice;
    compressed = await compress(plaintext, choice);
  } else if (choice === "auto" && plaintext.byteLength > 0) {
    const candidate = await compress(plaintext, "deflate-raw");
    if (candidate.byteLength < plaintext.byteLength) {
      compression = "deflate-raw";
      compressed = candidate;
    }
  }
  if (compressed.byteLength + TAG_BYTES > KEEL_SEALED_MAX_PAYLOAD_BYTES) throw new RangeError("Compressed content exceeds the sealed payload limit.");

  const contentKey = randomBytes(KEY_BYTES);
  try {
    const keys = await contentKeys(contentKey);
    const plaintextDigest = includeCommitment ? await commitmentDigest(plaintext, keys.plaintextSalt) : undefined;
    const iv = randomBytes(IV_BYTES);
    const contentHeader: KeelSealedContentHeader = {
      cipher: "aes-256-gcm",
      compression,
      iv: toBase64Url(iv),
      keyCommitment: toBase64Url(keys.keyCommitment),
      mediaType,
      byteLength: plaintext.byteLength,
      payloadBytes: compressed.byteLength + TAG_BYTES,
      ...(plaintextDigest === undefined ? {} : { commitment: toBase64Url(plaintextDigest) }),
    };
    const payload = await aesEncrypt(keys.cipher, iv, compressed, contentAad(contentHeader));
    const slots: KeelSealedSlot[] = [];
    for (const slotInput of slotInputs) slots.push(await wrapSlot(contentKey, contentHeader.keyCommitment, slotInput));
    const header = normalizeKeelSealedHeader({ protocol: KEEL_SEALED_PROTOCOL, content: contentHeader, slots });
    const envelope = encodeEnvelope(header, payload);
    return {
      envelope,
      header,
      contentKeyFingerprint: bytesToHex(keys.keyCommitment),
      ...(plaintextDigest === undefined
        ? {}
        : { commitment: { protocol: KEEL_COMMITMENT_PROTOCOL, algorithm: "sha-256", digest: bytesToHex(plaintextDigest), salt: bytesToHex(keys.plaintextSalt) } }),
      sizes: { plaintext: plaintext.byteLength, compressed: compressed.byteLength, header: envelope.byteLength - FRAME_PREFIX_BYTES - payload.byteLength, sealed: envelope.byteLength },
    };
  } finally {
    contentKey.fill(0);
  }
}

/**
 * Open a sealed envelope with one secret. Verifies the key commitment, the
 * AES-GCM tag over the payload and header, the declared length and (when
 * present) the plaintext commitment.
 */
export async function openKeelContent(envelope: Uint8Array, unlock: KeelSealedUnlock): Promise<KeelOpenResult> {
  const { header, payload } = splitEnvelope(envelope);
  const { contentKey, keys, slotIndex } = await unlockContentKey(header, unlock);
  try {
    const compressed = await aesDecrypt(keys.cipher, fromBase64Url(header.content.iv, "Sealed content iv", IV_BYTES), payload, contentAad(header.content));
    if (compressed === undefined) throw new KeelSealedError("tampered", "The sealed content failed authentication: the envelope was altered or corrupted.");
    const bytes = await decompress(compressed, header.content.compression, header.content.byteLength);
    let commitment: KeelCommitment | undefined;
    if (header.content.commitment !== undefined) {
      const digest = await commitmentDigest(bytes, keys.plaintextSalt);
      if (!equalBytes(digest, fromBase64Url(header.content.commitment, "Sealed plaintext commitment", KEY_BYTES))) {
        throw new KeelSealedError("tampered", "The opened content does not match its sealed commitment.");
      }
      commitment = { protocol: KEEL_COMMITMENT_PROTOCOL, algorithm: "sha-256", digest: bytesToHex(digest), salt: bytesToHex(keys.plaintextSalt) };
    }
    const text = textOf(bytes, header.content.mediaType);
    return {
      bytes,
      ...(text === undefined ? {} : { text }),
      mediaType: header.content.mediaType,
      header,
      slotIndex,
      contentKeyFingerprint: bytesToHex(keys.keyCommitment),
      ...(commitment === undefined ? {} : { commitment }),
    };
  } finally {
    contentKey.fill(0);
  }
}

/**
 * Add a backup way in (a passphrase, another passkey, a recovery key) without
 * re-encrypting the content. `unlock` proves you can already open it. A
 * published envelope is immutable: store the returned bytes as a new revision.
 */
export async function addKeelSealedSlot(envelope: Uint8Array, unlock: KeelSealedUnlock, slot: KeelSealedSlotInput): Promise<KeelSealedSlotChange & { readonly slotIndex: number }> {
  const { header, payload } = splitEnvelope(envelope);
  if (header.slots.length >= KEEL_SEALED_MAX_SLOTS) throw new RangeError(`A sealed object holds at most ${KEEL_SEALED_MAX_SLOTS} slots.`);
  const input = normalizeSlotInput(slot, header.slots.length);
  if (input.kind === "passkey-prf" && (await matchKeelSealedPasskeySlots(header, input.credentialId)).length > 0) {
    throw new TypeError("This passkey can already open this sealed object.");
  }
  const { contentKey } = await unlockContentKey(header, unlock);
  try {
    const added = await wrapSlot(contentKey, header.content.keyCommitment, input);
    const next = normalizeKeelSealedHeader({ protocol: KEEL_SEALED_PROTOCOL, content: header.content, slots: [...header.slots, added] });
    return { envelope: encodeEnvelope(next, payload), header: next, slotIndex: header.slots.length };
  } finally {
    contentKey.fill(0);
  }
}

/**
 * Drop one slot (for example a lost passkey) from a draft envelope. This needs
 * no secret and revokes nothing: bytes already published keep every slot they
 * had. At least one slot must remain.
 */
export function removeKeelSealedSlot(envelope: Uint8Array, slotIndex: number): KeelSealedSlotChange {
  const { header, payload } = splitEnvelope(envelope);
  integer(slotIndex, "Slot index", 0, header.slots.length - 1);
  if (header.slots.length === 1) throw new TypeError("A sealed object must keep at least one slot.");
  const next = normalizeKeelSealedHeader({ protocol: KEEL_SEALED_PROTOCOL, content: header.content, slots: header.slots.filter((_, index) => index !== slotIndex) });
  return { envelope: encodeEnvelope(next, payload), header: next };
}

/**
 * Exact envelope size for the given shape. Compression can only shrink the
 * payload ("auto" never grows it), so without `compressedBytes` this is the
 * most a seal of `plaintextBytes` will store.
 */
export function estimateKeelSealedSize(plaintextBytes: number, options: KeelSealedSizeEstimateOptions = {}): KeelSealedSizeEstimate {
  const plaintext = integer(plaintextBytes, "Plaintext size", 0, KEEL_SEALED_MAX_PLAINTEXT_BYTES);
  const input = record(options, "Estimate options");
  onlyKeys(input, ["mediaType", "slots", "commitment", "compressedBytes", "credentialIdBytes", "rpId"], "Estimate options");
  const mediaType = input.mediaType === undefined ? "application/octet-stream" : assertDataUriMediaType(input.mediaType as string);
  const kinds = (input.slots ?? ["passkey-prf"]) as readonly unknown[];
  if (!Array.isArray(kinds) || kinds.length < 1 || kinds.length > KEEL_SEALED_MAX_SLOTS) throw new TypeError(`Estimate needs 1–${KEEL_SEALED_MAX_SLOTS} slots.`);
  const compressed = input.compressedBytes === undefined ? plaintext : integer(input.compressedBytes, "Compressed size", 1, KEEL_SEALED_MAX_PAYLOAD_BYTES - TAG_BYTES);
  const credentialIdBytes = input.credentialIdBytes === undefined ? 0 : integer(input.credentialIdBytes, "Credential id size", 1, MAX_CREDENTIAL_ID_BYTES);
  const placeholder = (bytes: number) => toBase64Url(new Uint8Array(bytes));
  const slots = kinds.map((kind, index): KeelSealedSlot => {
    const wrap = { iv: placeholder(IV_BYTES), wrappedKey: toBase64Url(Uint8Array.of(index, ...new Uint8Array(WRAPPED_KEY_BYTES - 1))) };
    if (kind === "passphrase") return { kind, kdf: { name: "pbkdf2-sha256", iterations: KEEL_SEALED_PBKDF2_MIN_ITERATIONS, salt: placeholder(KDF_SALT_BYTES) }, ...wrap };
    if (kind === "raw-key") return { kind, salt: placeholder(KDF_SALT_BYTES), ...wrap };
    if (kind !== "passkey-prf") throw new TypeError(`Estimate slot ${index + 1} has an unsupported kind.`);
    return {
      kind,
      credentialHash: placeholder(CREDENTIAL_HASH_BYTES),
      salt: placeholder(KEEL_SEALED_PRF_SALT_BYTES),
      info: KEEL_SEALED_PASSKEY_INFO,
      ...wrap,
      ...(credentialIdBytes > 0 ? { credentialId: placeholder(credentialIdBytes) } : {}),
      ...(input.rpId === undefined ? {} : { rpId: input.rpId as string }),
    };
  });
  const compression: KeelSealedCompression = compressed === plaintext ? "none" : "deflate-raw";
  const header = normalizeKeelSealedHeader({
    protocol: KEEL_SEALED_PROTOCOL,
    content: {
      cipher: "aes-256-gcm",
      compression,
      iv: placeholder(IV_BYTES),
      keyCommitment: placeholder(KEY_BYTES),
      mediaType,
      byteLength: plaintext,
      payloadBytes: compressed + TAG_BYTES,
      ...(input.commitment === false ? {} : { commitment: placeholder(KEY_BYTES) }),
    },
    slots,
  });
  const headerBytes = utf8ToBytes(canonicalJson(header)).byteLength;
  const payload = compressed + TAG_BYTES;
  const sealed = FRAME_PREFIX_BYTES + headerBytes + payload;
  return { plaintext, header: headerBytes, payload, sealed, overhead: sealed - plaintext };
}
