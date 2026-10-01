import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import {
  KEEL_SEALED_MAX_PLAINTEXT_BYTES,
  KEEL_SEALED_PBKDF2_MAX_ITERATIONS,
  KEEL_SEALED_PBKDF2_MIN_ITERATIONS,
  KeelSealedError,
  addKeelSealedSlot,
  canonicalJson,
  createKeelCommitment,
  createKeelMerkleCommitment,
  createKeelRecoveryKey,
  describeKeelSealed,
  estimateKeelSealedSize,
  isKeelSealedEnvelope,
  matchKeelSealedPasskeySlots,
  normalizeKeelCommitment,
  normalizeKeelSealedHeader,
  openKeelContent,
  parseKeelRecoveryKey,
  parseKeelSealedHeader,
  removeKeelSealedSlot,
  sealKeelContent,
  verifyKeelCommitment,
  verifyKeelMerkleProof,
  createKeelProofReveal,
  createKeelMerkleReveal,
  normalizeKeelReveal,
  verifyKeelReveal,
} from "../packages/protocol/dist/index.js";

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const random = (length) => globalThis.crypto.getRandomValues(new Uint8Array(length));
const b64u = (bytes) => Buffer.from(bytes).toString("base64url");
const concat = (...parts) => new Uint8Array(Buffer.concat(parts.map((part) => Buffer.from(part))));
const sha256 = (bytes) => new Uint8Array(createHash("sha256").update(bytes).digest());

const PASSPHRASE = "correct horse battery staple";
const TEXT = "The quick brown fox jumps over the lazy dog. ".repeat(40);

/** A stand-in passkey: PRF output = HMAC(secret, salt), as an authenticator would compute it. */
async function fakePasskey() {
  const credentialId = random(20);
  const secret = random(32);
  const evaluate = async (salt) => {
    const key = await subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await subtle.sign("HMAC", key, salt));
  };
  return {
    credentialId,
    evaluate,
    async slot(extra = {}) {
      const prfSalt = random(32);
      return { kind: "passkey-prf", credentialId, prfSalt, prfOutput: await evaluate(prfSalt), ...extra };
    },
    async unlock(envelope, slotIndex) {
      const header = parseKeelSealedHeader(envelope);
      const slot = header.slots[slotIndex];
      return { kind: "passkey-prf", prfOutput: await evaluate(Buffer.from(slot.salt, "base64url")), credentialId };
    },
  };
}

function frame(header, payload, { version = 1, headerText = canonicalJson(header) } = {}) {
  const headerBytes = encoder.encode(headerText);
  const prefix = new Uint8Array(9);
  prefix.set([0x4b, 0x53, 0x4c, 0x44]);
  prefix[4] = version;
  new DataView(prefix.buffer).setUint32(5, headerBytes.byteLength, false);
  return concat(prefix, headerBytes, payload);
}

function split(envelope) {
  const length = new DataView(envelope.buffer, envelope.byteOffset).getUint32(5, false);
  return {
    header: JSON.parse(new TextDecoder().decode(envelope.subarray(9, 9 + length))),
    payload: envelope.slice(9 + length),
  };
}

/** Rebuilds an envelope with an edited header, keeping the payload. */
function reframe(envelope, edit) {
  const { header, payload } = split(envelope);
  edit(header);
  return frame(header, payload);
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof KeelSealedError, `expected KeelSealedError, got ${error}`);
    assert.equal(error.code, code, error.message);
    return true;
  });
}

/**
 * An independent writer that follows the key schedule documented in
 * sealed.ts and docs/SEALED_CONTENT.md. It also lets tests play a hostile
 * sealer who controls every byte.
 */
async function craftRawKeyEnvelope({ plaintext, compressed = plaintext, compression = "none", byteLength = plaintext.byteLength, recoveryKey, keyCommitment, commitment }) {
  const contentKey = random(32);
  const base = await subtle.importKey("raw", contentKey, "HKDF", false, ["deriveBits", "deriveKey"]);
  const hkdf = (info) => ({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode(info) });
  const cipherKey = await subtle.deriveKey(hkdf("keel-sealed/content-key@1"), base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const realCommitment = new Uint8Array(await subtle.deriveBits(hkdf("keel-sealed/key-commitment@1"), base, 256));
  const plaintextSalt = new Uint8Array(await subtle.deriveBits(hkdf("keel-sealed/plaintext-salt@1"), base, 256));
  const iv = random(12);
  const content = {
    cipher: "aes-256-gcm",
    compression,
    iv: b64u(iv),
    keyCommitment: b64u(keyCommitment ?? realCommitment),
    mediaType: "application/octet-stream",
    byteLength,
    payloadBytes: compressed.byteLength + 16,
    commitment: b64u(commitment ?? sha256(concat(encoder.encode("keel-commitment@1"), [0, 32], plaintextSalt, plaintext))),
  };
  const contentAad = concat(encoder.encode("keel-sealed/content@1"), [0], encoder.encode(canonicalJson(content)));
  const payload = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: contentAad }, cipherKey, compressed));
  const slotSalt = random(16);
  const slotIv = random(12);
  const kekBase = await subtle.importKey("raw", recoveryKey, "HKDF", false, ["deriveKey"]);
  const kek = await subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: slotSalt, info: encoder.encode("keel-sealed/raw-key@1") }, kekBase, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const slot = { kind: "raw-key", salt: b64u(slotSalt), iv: b64u(slotIv) };
  const slotAad = concat(encoder.encode("keel-sealed/slot@1"), [0], encoder.encode(canonicalJson({ keyCommitment: content.keyCommitment, slot })));
  const wrappedKey = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: slotIv, additionalData: slotAad }, kek, contentKey));
  return frame({ protocol: "keel-sealed@1", content, slots: [{ ...slot, wrappedKey: b64u(wrappedKey) }] }, payload);
}

// ------------------------------------------------------------- round trips

test("every slot kind opens with every compression", async () => {
  const passkey = await fakePasskey();
  const recovery = createKeelRecoveryKey();
  const binary = random(3000);
  for (const compression of ["auto", "none", "deflate-raw", "gzip"]) {
    for (const content of [TEXT, binary]) {
      const sealed = await sealKeelContent(content, {
        compression,
        slots: [await passkey.slot(), { kind: "passphrase", passphrase: PASSPHRASE }, { kind: "raw-key", key: recovery.key }],
      });
      const expectedCompression = compression === "auto" ? (typeof content === "string" ? "deflate-raw" : "none") : compression;
      assert.equal(sealed.header.content.compression, expectedCompression, `${compression} ${typeof content}`);
      assert.equal(sealed.sizes.sealed, sealed.envelope.byteLength);
      assert.ok(isKeelSealedEnvelope(sealed.envelope));
      const unlocks = [await passkey.unlock(sealed.envelope, 0), { kind: "passphrase", passphrase: PASSPHRASE }, { kind: "raw-key", key: recovery.text }];
      for (const [slotIndex, unlock] of unlocks.entries()) {
        const opened = await openKeelContent(sealed.envelope, unlock);
        assert.equal(opened.slotIndex, slotIndex);
        assert.equal(opened.contentKeyFingerprint, sealed.contentKeyFingerprint);
        assert.deepEqual(opened.commitment, sealed.commitment);
        if (typeof content === "string") {
          assert.equal(opened.text, content);
          assert.equal(opened.mediaType, "text/plain;charset=utf-8");
        } else {
          assert.deepEqual(opened.bytes, content);
          assert.equal(opened.text, undefined);
          assert.equal(opened.mediaType, "application/octet-stream");
        }
      }
    }
  }
});

test("auto compression only keeps deflate-raw when it is smaller", async () => {
  const slots = [{ kind: "raw-key", key: createKeelRecoveryKey().key }];
  const compressible = await sealKeelContent(TEXT, { slots });
  assert.equal(compressible.header.content.compression, "deflate-raw");
  assert.ok(compressible.sizes.compressed < compressible.sizes.plaintext);
  const incompressible = await sealKeelContent(random(512), { slots });
  assert.equal(incompressible.header.content.compression, "none");
  assert.equal(incompressible.sizes.compressed, 512);
  const empty = await sealKeelContent("", { slots });
  assert.equal(empty.header.content.compression, "none");
  assert.equal((await openKeelContent(empty.envelope, { kind: "raw-key", key: slots[0].key })).text, "");
});

test("media types are carried and only textual types decode to text", async () => {
  const key = createKeelRecoveryKey().key;
  const json = await sealKeelContent('{"bid":42}', { mediaType: "application/json", slots: [{ kind: "raw-key", key }] });
  const opened = await openKeelContent(json.envelope, { kind: "raw-key", key });
  assert.equal(opened.mediaType, "application/json");
  assert.equal(opened.text, '{"bid":42}');
  const png = await sealKeelContent("not really a png", { mediaType: "image/png", slots: [{ kind: "raw-key", key }] });
  assert.equal((await openKeelContent(png.envelope, { kind: "raw-key", key })).text, undefined);
  await assert.rejects(sealKeelContent("x", { mediaType: "text/plain, evil", slots: [{ kind: "raw-key", key }] }), TypeError);
});

test("an independent writer following the documented key schedule interoperates", async () => {
  const recoveryKey = random(32);
  const plaintext = encoder.encode("written by the spec, not the library");
  const envelope = await craftRawKeyEnvelope({ plaintext, recoveryKey });
  const opened = await openKeelContent(envelope, { kind: "raw-key", key: recoveryKey });
  assert.deepEqual(opened.bytes, plaintext);
  assert.ok(await verifyKeelCommitment(opened.commitment, plaintext));

  const compressed = new Uint8Array(deflateRawSync(Buffer.from(TEXT)));
  const deflated = await craftRawKeyEnvelope({ plaintext: encoder.encode(TEXT), compressed, compression: "deflate-raw", recoveryKey });
  assert.equal((await openKeelContent(deflated, { kind: "raw-key", key: recoveryKey })).text, undefined);
  assert.deepEqual((await openKeelContent(deflated, { kind: "raw-key", key: recoveryKey })).bytes, encoder.encode(TEXT));
});

// -------------------------------------------------------------- wrong secrets

test("wrong passphrase, PRF output or recovery key fail cleanly", async () => {
  const passkey = await fakePasskey();
  const other = await fakePasskey();
  const recovery = createKeelRecoveryKey();
  const { envelope } = await sealKeelContent(TEXT, {
    slots: [await passkey.slot(), { kind: "passphrase", passphrase: PASSPHRASE }, { kind: "raw-key", key: recovery.key }],
  });
  await rejectsWith(openKeelContent(envelope, { kind: "passphrase", passphrase: "correct horse battery stapler" }), "wrong-secret");
  await rejectsWith(openKeelContent(envelope, { kind: "raw-key", key: createKeelRecoveryKey().key }), "wrong-secret");
  await rejectsWith(openKeelContent(envelope, { kind: "passkey-prf", prfOutput: random(32) }), "wrong-secret");
  const header = parseKeelSealedHeader(envelope);
  const otherOutput = await other.evaluate(Buffer.from(header.slots[0].salt, "base64url"));
  await rejectsWith(openKeelContent(envelope, { kind: "passkey-prf", prfOutput: otherOutput }), "wrong-secret");
  await rejectsWith(openKeelContent(envelope, { kind: "passkey-prf", prfOutput: otherOutput, credentialId: other.credentialId }), "no-slot");
  await rejectsWith(openKeelContent(envelope, { kind: "passphrase", passphrase: PASSPHRASE, slotIndex: 0 }), "no-slot");

  const passphraseOnly = await sealKeelContent("x", { slots: [{ kind: "passphrase", passphrase: PASSPHRASE }] });
  await rejectsWith(openKeelContent(passphraseOnly.envelope, { kind: "raw-key", key: recovery.key }), "no-slot");
  await assert.rejects(openKeelContent(passphraseOnly.envelope, { kind: "passphrase", passphrase: "" }), TypeError);
  await assert.rejects(openKeelContent(passphraseOnly.envelope, { kind: "raw-key", key: random(31) }), TypeError);
  await assert.rejects(openKeelContent(passphraseOnly.envelope, { kind: "pin", pin: "1234" }), TypeError);
});

test("passphrases are NFC-normalized and must meet the minimum length", async () => {
  const composed = "café au lait, s'il vous plaît";
  const decomposed = composed.normalize("NFD");
  assert.notEqual(composed, decomposed);
  const { envelope } = await sealKeelContent("x", { slots: [{ kind: "passphrase", passphrase: composed }] });
  assert.equal((await openKeelContent(envelope, { kind: "passphrase", passphrase: decomposed })).text, "x");
  await assert.rejects(sealKeelContent("x", { slots: [{ kind: "passphrase", passphrase: "short" }] }), /8–1024 characters/u);
});

// ------------------------------------------------------------------ tampering

test("header, iv and ciphertext tampering are detected", async () => {
  const key = createKeelRecoveryKey().key;
  const unlock = { kind: "raw-key", key };
  const { envelope } = await sealKeelContent(TEXT, { slots: [unlock] });

  for (const edit of [
    (header) => { header.content.mediaType = "text/html"; },
    (header) => { header.content.byteLength += 1; },
    (header) => { header.content.compression = "gzip"; },
    (header) => { header.content.commitment = b64u(random(32)); },
    (header) => { delete header.content.commitment; },
    (header) => { header.content.iv = b64u(random(12)); },
  ]) {
    await rejectsWith(openKeelContent(reframe(envelope, edit), unlock), "tampered");
  }

  // Slot parameters and the key commitment are bound into each slot's AAD.
  await rejectsWith(openKeelContent(reframe(envelope, (header) => { header.content.keyCommitment = b64u(random(32)); }), unlock), "wrong-secret");
  await rejectsWith(openKeelContent(reframe(envelope, (header) => { header.slots[0].salt = b64u(random(16)); }), unlock), "wrong-secret");
  await rejectsWith(openKeelContent(reframe(envelope, (header) => { header.slots[0].iv = b64u(random(12)); }), unlock), "wrong-secret");

  const flipped = envelope.slice();
  flipped[flipped.length - 20] ^= 0x01;
  await rejectsWith(openKeelContent(flipped, unlock), "tampered");
  const tag = envelope.slice();
  tag[tag.length - 1] ^= 0x80;
  await rejectsWith(openKeelContent(tag, unlock), "tampered");
});

test("slots cannot be moved between envelopes", async () => {
  const key = createKeelRecoveryKey().key;
  const first = await sealKeelContent("first", { slots: [{ kind: "raw-key", key }] });
  const second = await sealKeelContent("second", { slots: [{ kind: "raw-key", key }] });
  const moved = reframe(second.envelope, (header) => { header.slots = parseKeelSealedHeader(first.envelope).slots; });
  await rejectsWith(openKeelContent(moved, { kind: "raw-key", key }), "wrong-secret");
});

test("a hostile sealer cannot smuggle oversize output, a wrong length or a false commitment", async () => {
  const recoveryKey = random(32);
  const unlock = { kind: "raw-key", key: recoveryKey };
  const bomb = new Uint8Array(1_000_000);
  const compressedBomb = new Uint8Array(deflateRawSync(Buffer.from(bomb)));
  await rejectsWith(openKeelContent(await craftRawKeyEnvelope({ plaintext: bomb, compressed: compressedBomb, compression: "deflate-raw", byteLength: 1000, recoveryKey }), unlock), "tampered");
  const short = encoder.encode(TEXT);
  await rejectsWith(openKeelContent(await craftRawKeyEnvelope({ plaintext: short, compressed: new Uint8Array(deflateRawSync(Buffer.from(short))), compression: "deflate-raw", byteLength: short.byteLength + 1, recoveryKey }), unlock), "tampered");
  await rejectsWith(openKeelContent(await craftRawKeyEnvelope({ plaintext: short, compressed: random(64), compression: "deflate-raw", recoveryKey }), unlock), "tampered");
  await rejectsWith(openKeelContent(await craftRawKeyEnvelope({ plaintext: short, recoveryKey, commitment: random(32) }), unlock), "tampered");
  await rejectsWith(openKeelContent(await craftRawKeyEnvelope({ plaintext: short, recoveryKey, keyCommitment: random(32) }), unlock), "tampered");
});

test("truncated, padded and oversized envelopes are rejected before any crypto", async () => {
  const key = createKeelRecoveryKey().key;
  const { envelope } = await sealKeelContent(TEXT, { slots: [{ kind: "raw-key", key }] });
  const headerLength = new DataView(envelope.buffer).getUint32(5, false);
  assert.throws(() => parseKeelSealedHeader(envelope.subarray(0, envelope.length - 1)), /truncated/u);
  assert.throws(() => parseKeelSealedHeader(envelope.subarray(0, 9 + headerLength)), /truncated/u);
  assert.throws(() => parseKeelSealedHeader(envelope.subarray(0, 9 + headerLength - 5)), /truncated/u);
  assert.throws(() => parseKeelSealedHeader(envelope.subarray(0, 6)), /truncated/u);
  assert.throws(() => parseKeelSealedHeader(concat(envelope, [0])), /trailing bytes/u);
  assert.throws(() => parseKeelSealedHeader(new Uint8Array(0)), /not a KEEL sealed envelope/u);
  assert.throws(() => parseKeelSealedHeader("KSLD"), TypeError);

  const hugeHeader = envelope.slice();
  new DataView(hugeHeader.buffer).setUint32(5, 0xffffffff, false);
  assert.throws(() => parseKeelSealedHeader(hugeHeader), RangeError);
  const tinyHeader = envelope.slice();
  new DataView(tinyHeader.buffer).setUint32(5, 1, false);
  assert.throws(() => parseKeelSealedHeader(tinyHeader), RangeError);

  for (const [edit, pattern] of [
    [(header) => { header.content.byteLength = KEEL_SEALED_MAX_PLAINTEXT_BYTES + 1; }, /byte length/u],
    [(header) => { header.content.payloadBytes = 2 ** 40; }, /payload length/u],
    [(header) => { header.content.payloadBytes = 8; }, /payload length/u],
    [(header) => { header.content.byteLength = -1; }, /byte length/u],
    [(header) => { header.content.byteLength = 1.5; }, /byte length/u],
    [(header) => { header.content.iv = b64u(random(16)); }, /iv/u],
    [(header) => { header.slots[0].wrappedKey = b64u(random(40)); }, /wrapped key/u],
    [(header) => { header.slots = []; }, /1–8 slots/u],
    [(header) => { header.slots = Array.from({ length: 9 }, () => header.slots[0]); }, /1–8 slots/u],
  ]) {
    assert.throws(() => parseKeelSealedHeader(reframe(envelope, edit)), pattern);
  }

  const uncompressed = await sealKeelContent(random(100), { slots: [{ kind: "raw-key", key }] });
  assert.throws(() => parseKeelSealedHeader(reframe(uncompressed.envelope, (header) => { header.content.byteLength = 99; })), /does not match/u);

  await assert.rejects(sealKeelContent(new Uint8Array(KEEL_SEALED_MAX_PLAINTEXT_BYTES + 1), { slots: [{ kind: "raw-key", key }] }), RangeError);
});

test("unknown versions, kinds, fields and non-canonical headers are rejected", async () => {
  const key = createKeelRecoveryKey().key;
  const { envelope } = await sealKeelContent("x", { slots: [{ kind: "raw-key", key }, { kind: "passphrase", passphrase: PASSPHRASE }] });
  const { header, payload } = split(envelope);
  assert.throws(() => parseKeelSealedHeader(frame(header, payload, { version: 2 })), /version 2/u);
  const wrongMagic = envelope.slice();
  wrongMagic[0] = 0x4a;
  assert.throws(() => parseKeelSealedHeader(wrongMagic), /not a KEEL sealed envelope/u);
  assert.throws(() => parseKeelSealedHeader(frame(header, payload, { headerText: JSON.stringify(header, null, 2) })), /canonical/u);
  assert.throws(() => parseKeelSealedHeader(frame(header, payload, { headerText: "{not json" })), /UTF-8 JSON/u);

  for (const [edit, pattern] of [
    [(value) => { value.protocol = "keel-sealed@2"; }, /keel-sealed@2/u],
    [(value) => { value.note = "hi"; }, /"note" is not supported/u],
    [(value) => { value.content.padding = 0; }, /"padding" is not supported/u],
    [(value) => { value.content.cipher = "chacha20-poly1305"; }, /cipher/u],
    [(value) => { value.content.compression = "brotli"; }, /compression/u],
    [(value) => { value.slots[0].label = "mine"; }, /"label" is not supported/u],
    [(value) => { value.slots[0].kind = "recipient"; }, /reserved for a future/u],
    [(value) => { value.slots[0].kind = "smartcard"; }, /unsupported kind/u],
    [(value) => { value.slots[1].kdf.name = "argon2id"; }, /argon2id/u],
    [(value) => { value.slots[1].kdf.name = "scrypt"; }, /pbkdf2-sha256/u],
    [(value) => { value.slots[1].kdf.memory = 65536; }, /"memory" is not supported/u],
    [(value) => { value.slots[1].kdf.iterations = KEEL_SEALED_PBKDF2_MIN_ITERATIONS - 1; }, /iterations/u],
    [(value) => { value.slots[1].kdf.iterations = KEEL_SEALED_PBKDF2_MAX_ITERATIONS + 1; }, /iterations/u],
    [(value) => { value.slots[1] = value.slots[0]; }, /must not repeat/u],
    [(value) => { value.slots[0].salt += "="; }, /base64url/u],
  ]) {
    const copy = structuredClone(header);
    edit(copy);
    assert.throws(() => parseKeelSealedHeader(frame(copy, payload)), pattern);
  }
  assert.throws(() => normalizeKeelSealedHeader(JSON.parse('{"__proto__":{},"protocol":"keel-sealed@1"}')), TypeError);
});

// ---------------------------------------------------------------------- slots

test("adding a slot keeps old slots working and leaves the payload untouched", async () => {
  const passkey = await fakePasskey();
  const second = await fakePasskey();
  const recovery = createKeelRecoveryKey();
  const sealed = await sealKeelContent(TEXT, { slots: [await passkey.slot()] });
  const passkeyUnlock = await passkey.unlock(sealed.envelope, 0);

  const withPassphrase = await addKeelSealedSlot(sealed.envelope, passkeyUnlock, { kind: "passphrase", passphrase: PASSPHRASE });
  assert.equal(withPassphrase.slotIndex, 1);
  const withRecovery = await addKeelSealedSlot(withPassphrase.envelope, { kind: "passphrase", passphrase: PASSPHRASE }, { kind: "raw-key", key: recovery.text });
  const withSecondPasskey = await addKeelSealedSlot(withRecovery.envelope, { kind: "raw-key", key: recovery.key }, await second.slot({ includeCredentialId: true, rpId: "onkeel.io" }));
  const final = withSecondPasskey.envelope;

  assert.deepEqual(split(final).payload, split(sealed.envelope).payload);
  for (const unlock of [passkeyUnlock, { kind: "passphrase", passphrase: PASSPHRASE }, { kind: "raw-key", key: recovery.key }, await second.unlock(final, 3)]) {
    const opened = await openKeelContent(final, unlock);
    assert.equal(opened.text, TEXT);
    assert.equal(opened.contentKeyFingerprint, sealed.contentKeyFingerprint);
  }

  const description = describeKeelSealed(final);
  assert.deepEqual(description.slots, [
    { index: 0, kind: "passkey-prf" },
    { index: 1, kind: "passphrase", iterations: KEEL_SEALED_PBKDF2_MIN_ITERATIONS },
    { index: 2, kind: "raw-key" },
    { index: 3, kind: "passkey-prf", rpId: "onkeel.io", credentialId: b64u(second.credentialId) },
  ]);
  assert.equal(description.contentKeyFingerprint, sealed.contentKeyFingerprint);
  assert.equal(description.byteLength, encoder.encode(TEXT).byteLength);
  assert.equal(description.sizes.envelope, final.byteLength);

  await assert.rejects(addKeelSealedSlot(final, passkeyUnlock, await passkey.slot()), /already open/u);
  await rejectsWith(addKeelSealedSlot(sealed.envelope, { kind: "passphrase", passphrase: PASSPHRASE }, { kind: "raw-key", key: recovery.key }), "no-slot");
  await rejectsWith(addKeelSealedSlot(sealed.envelope, { kind: "passkey-prf", prfOutput: random(32) }, { kind: "raw-key", key: recovery.key }), "wrong-secret");

  const removed = removeKeelSealedSlot(final, 0);
  assert.equal(removed.header.slots.length, 3);
  await rejectsWith(openKeelContent(removed.envelope, { kind: "passkey-prf", prfOutput: passkeyUnlock.prfOutput }), "wrong-secret");
  assert.equal((await openKeelContent(removed.envelope, { kind: "raw-key", key: recovery.key })).text, TEXT);
  assert.throws(() => removeKeelSealedSlot(sealed.envelope, 0), /at least one slot/u);
});

test("a sealed object holds at most eight slots", async () => {
  const key = createKeelRecoveryKey().key;
  const keys = Array.from({ length: 8 }, () => createKeelRecoveryKey().key);
  const { envelope } = await sealKeelContent("x", { slots: keys.map((entry) => ({ kind: "raw-key", key: entry })) });
  await assert.rejects(addKeelSealedSlot(envelope, { kind: "raw-key", key: keys[7] }, { kind: "raw-key", key }), RangeError);
  await assert.rejects(sealKeelContent("x", { slots: [] }), /1–8 slots/u);
  await assert.rejects(sealKeelContent("x", { slots: [...keys, key].map((entry) => ({ kind: "raw-key", key: entry })) }), /1–8 slots/u);
  assert.equal((await openKeelContent(envelope, { kind: "raw-key", key: keys[5] })).slotIndex, 5);
});

test("passkey slots hide the credential id unless asked to store it", async () => {
  const passkey = await fakePasskey();
  const first = await sealKeelContent("a", { slots: [await passkey.slot()] });
  const second = await sealKeelContent("b", { slots: [await passkey.slot()] });
  const [a, b] = [parseKeelSealedHeader(first.envelope).slots[0], parseKeelSealedHeader(second.envelope).slots[0]];
  assert.equal(a.credentialId, undefined);
  assert.notEqual(a.credentialHash, b.credentialHash);
  assert.equal(a.info, "keel-sealed/passkey-prf@1");
  assert.ok(!new TextDecoder().decode(first.envelope).includes(b64u(passkey.credentialId)));
  assert.deepEqual(await matchKeelSealedPasskeySlots(parseKeelSealedHeader(first.envelope), passkey.credentialId), [0]);
  assert.deepEqual(await matchKeelSealedPasskeySlots(parseKeelSealedHeader(first.envelope), random(20)), []);

  const stored = await sealKeelContent("c", { slots: [await passkey.slot({ includeCredentialId: true, rpId: "onkeel.io", info: "onkeel.io sealed note" })] });
  const slot = parseKeelSealedHeader(stored.envelope).slots[0];
  assert.equal(slot.credentialId, b64u(passkey.credentialId));
  assert.equal(slot.rpId, "onkeel.io");
  assert.equal((await openKeelContent(stored.envelope, await passkey.unlock(stored.envelope, 0))).text, "c");

  await assert.rejects(sealKeelContent("x", { slots: [{ ...(await passkey.slot()), prfOutput: random(16) }] }), /PRF output/u);
  await assert.rejects(sealKeelContent("x", { slots: [{ ...(await passkey.slot()), prfSalt: random(16) }] }), /PRF salt/u);
  await assert.rejects(sealKeelContent("x", { slots: [await passkey.slot({ rpId: "Not A Domain" })] }), /rpId/u);
});

test("PBKDF2 iterations are validated on write and on read", async () => {
  const strong = await sealKeelContent("x", { slots: [{ kind: "passphrase", passphrase: PASSPHRASE, iterations: 700_000 }] });
  assert.equal(parseKeelSealedHeader(strong.envelope).slots[0].kdf.iterations, 700_000);
  assert.equal((await openKeelContent(strong.envelope, { kind: "passphrase", passphrase: PASSPHRASE })).text, "x");
  await assert.rejects(sealKeelContent("x", { slots: [{ kind: "passphrase", passphrase: PASSPHRASE, iterations: KEEL_SEALED_PBKDF2_MIN_ITERATIONS - 1 }] }), /iterations/u);
  await assert.rejects(sealKeelContent("x", { slots: [{ kind: "passphrase", passphrase: PASSPHRASE, iterations: KEEL_SEALED_PBKDF2_MAX_ITERATIONS + 1 }] }), /iterations/u);
  await assert.rejects(sealKeelContent("x", { slots: [{ kind: "passphrase", passphrase: PASSPHRASE, iterations: 600_000.5 }] }), /iterations/u);
  await assert.rejects(sealKeelContent("x", { slots: [{ kind: "passphrase", passphrase: PASSPHRASE, testing: true }] }), /"testing" is not supported/u);
});

test("seal options are strict", async () => {
  const slots = [{ kind: "raw-key", key: createKeelRecoveryKey().key }];
  await assert.rejects(sealKeelContent("x", { slots, compression: "brotli" }), /Compression/u);
  await assert.rejects(sealKeelContent("x", { slots, extra: true }), /"extra" is not supported/u);
  await assert.rejects(sealKeelContent(42, { slots }), TypeError);
  await assert.rejects(sealKeelContent("x", { slots: [{ kind: "raw-key", key: "not a key" }] }), /Recovery key/u);
  const plain = await sealKeelContent("x", { slots, commitment: false });
  assert.equal(plain.commitment, undefined);
  assert.equal(plain.header.content.commitment, undefined);
  assert.equal((await openKeelContent(plain.envelope, { kind: "raw-key", key: slots[0].key })).commitment, undefined);
});

// ------------------------------------------------------------------ helpers

test("recovery keys round trip as 43 base64url characters", () => {
  const { key, text } = createKeelRecoveryKey();
  assert.equal(key.byteLength, 32);
  assert.match(text, /^[A-Za-z0-9_-]{43}$/u);
  assert.deepEqual(parseKeelRecoveryKey(`  ${text}\n`), key);
  assert.throws(() => parseKeelRecoveryKey(text.slice(1)), TypeError);
  assert.throws(() => parseKeelRecoveryKey(`${text}=`), TypeError);
});

test("size estimates match real envelopes", async () => {
  const passkey = await fakePasskey();
  const content = random(1234);
  const sealed = await sealKeelContent(content, {
    compression: "none",
    slots: [await passkey.slot(), { kind: "passphrase", passphrase: PASSPHRASE }, { kind: "raw-key", key: createKeelRecoveryKey().key }],
  });
  const estimate = estimateKeelSealedSize(1234, { slots: ["passkey-prf", "passphrase", "raw-key"] });
  assert.equal(estimate.sealed, sealed.envelope.byteLength);
  assert.equal(estimate.header, sealed.sizes.header);
  assert.equal(estimate.payload, 1234 + 16);
  assert.equal(estimate.overhead, estimate.sealed - 1234);

  const stored = await sealKeelContent(content, { compression: "none", commitment: false, mediaType: "image/png", slots: [await passkey.slot({ includeCredentialId: true, rpId: "onkeel.io" })] });
  assert.equal(estimateKeelSealedSize(1234, { mediaType: "image/png", commitment: false, credentialIdBytes: 20, rpId: "onkeel.io" }).sealed, stored.envelope.byteLength);
  const compressed = await sealKeelContent(TEXT, { slots: [await passkey.slot()] });
  assert.equal(estimateKeelSealedSize(compressed.sizes.plaintext, { mediaType: "text/plain;charset=utf-8", compressedBytes: compressed.sizes.compressed }).sealed, compressed.envelope.byteLength);
  assert.throws(() => estimateKeelSealedSize(-1), TypeError);
  assert.throws(() => estimateKeelSealedSize(1, { slots: ["recipient"] }), /unsupported kind/u);
});

// ---------------------------------------------------------------- commitments

test("salted commitments hide content; unsalted ones equal plain SHA-256", async () => {
  const salted = await createKeelCommitment("yes");
  const again = await createKeelCommitment("yes");
  assert.equal(salted.protocol, "keel-commitment@1");
  assert.match(salted.digest, /^0x[0-9a-f]{64}$/u);
  assert.match(salted.salt, /^0x[0-9a-f]{64}$/u);
  assert.notEqual(salted.digest, again.digest);
  assert.ok(await verifyKeelCommitment(salted, "yes"));
  assert.ok(await verifyKeelCommitment(salted, encoder.encode("yes")));
  assert.equal(await verifyKeelCommitment(salted, "no"), false);
  assert.equal(await verifyKeelCommitment({ ...salted, salt: again.salt }, "yes"), false);

  const file = random(4096);
  const unsalted = await createKeelCommitment(file, { salt: "none" });
  assert.equal(unsalted.salt, undefined);
  assert.equal(unsalted.digest, `0x${createHash("sha256").update(file).digest("hex")}`);
  assert.ok(await verifyKeelCommitment(unsalted, file));

  const fixedSalt = random(16);
  const fixed = await createKeelCommitment("bid: 42", { salt: fixedSalt });
  const expected = sha256(concat(encoder.encode("keel-commitment@1"), [0, 16], fixedSalt, encoder.encode("bid: 42")));
  assert.equal(fixed.digest, `0x${Buffer.from(expected).toString("hex")}`);
  assert.ok(await verifyKeelCommitment(JSON.parse(JSON.stringify(fixed)), "bid: 42"));

  await assert.rejects(createKeelCommitment("x", { salt: random(8) }), /16–64 bytes/u);
  await assert.rejects(createKeelCommitment("x", { salt: "weak" }), TypeError);
  assert.throws(() => normalizeKeelCommitment({ ...salted, algorithm: "sha-1" }), TypeError);
  assert.throws(() => normalizeKeelCommitment({ ...salted, digest: "0x1234" }), TypeError);
  assert.throws(() => normalizeKeelCommitment({ ...salted, extra: 1 }), TypeError);
  assert.equal(normalizeKeelCommitment({ ...unsalted, digest: unsalted.digest.toUpperCase().replace("0X", "0x") }).digest, unsalted.digest);
});

test("a sealed object's commitment proves its content without the key", async () => {
  const { commitment, header } = await sealKeelContent("sealed bid: 1.5 ETH", { slots: [{ kind: "raw-key", key: createKeelRecoveryKey().key }] });
  assert.equal(commitment.digest, `0x${Buffer.from(header.content.commitment, "base64url").toString("hex")}`);
  assert.ok(await verifyKeelCommitment(commitment, "sealed bid: 1.5 ETH"));
  assert.equal(await verifyKeelCommitment(commitment, "sealed bid: 2 ETH"), false);
});

test("Merkle commitments prove membership for every count, including odd ones", async () => {
  for (const count of [1, 2, 3, 5, 7, 8, 13]) {
    const items = Array.from({ length: count }, (_, index) => `item ${index}`);
    const tree = await createKeelMerkleCommitment(items);
    assert.equal(tree.count, count);
    assert.match(tree.root, /^0x[0-9a-f]{64}$/u);
    for (const [index, item] of items.entries()) {
      const proof = JSON.parse(JSON.stringify(tree.proofFor(index)));
      assert.ok(await verifyKeelMerkleProof(tree.root, item, proof), `count ${count} index ${index}`);
      assert.equal(await verifyKeelMerkleProof(tree.root, `${item}!`, proof), false);
    }
  }
  const single = await createKeelMerkleCommitment(["only"]);
  assert.deepEqual(single.proofFor(0).siblings, []);
  assert.ok(await verifyKeelMerkleProof(single.root, "only", single.proofFor(0)));
});

test("tampered Merkle proofs fail", async () => {
  const items = ["a", "b", "c", "d", "e"];
  const tree = await createKeelMerkleCommitment(items);
  const proof = tree.proofFor(2);
  const other = await createKeelMerkleCommitment(items);
  assert.notEqual(other.root, tree.root);
  assert.equal(await verifyKeelMerkleProof(other.root, "c", proof), false);
  assert.equal(await verifyKeelMerkleProof(tree.root, "c", { ...proof, siblings: [proof.siblings[1], proof.siblings[0]] }), false);
  assert.equal(await verifyKeelMerkleProof(tree.root, "c", { ...proof, siblings: [`0x${"00".repeat(32)}`, proof.siblings[1]] }), false);
  assert.equal(await verifyKeelMerkleProof(tree.root, "c", { ...proof, siblings: proof.siblings.slice(1) }), false);
  assert.equal(await verifyKeelMerkleProof(tree.root, "c", { ...proof, siblings: [...proof.siblings, proof.siblings[0]] }), false);
  assert.equal(await verifyKeelMerkleProof(tree.root, "c", { ...proof, index: 3 }), false);
  assert.equal(await verifyKeelMerkleProof(tree.root, "c", { ...proof, count: 4 }), false);
  assert.equal(await verifyKeelMerkleProof(tree.root, "c", { ...proof, count: 6 }), false);
  assert.equal(await verifyKeelMerkleProof(tree.root, "c", { ...proof, item: tree.proofFor(3).item }), false);
  await assert.rejects(verifyKeelMerkleProof(tree.root, "c", { ...proof, index: 5 }), TypeError);
  await assert.rejects(verifyKeelMerkleProof(tree.root, "c", { ...proof, protocol: "keel-merkle-proof@2" }), TypeError);
  await assert.rejects(verifyKeelMerkleProof("0x1234", "c", proof), TypeError);
  assert.throws(() => tree.proofFor(5), TypeError);
});

test("unsalted trees are deterministic and accept existing commitments as items", async () => {
  const files = [random(100), random(200), random(300)];
  const first = await createKeelMerkleCommitment(files, { salt: "none" });
  const second = await createKeelMerkleCommitment(files, { salt: "none" });
  assert.equal(first.root, second.root);
  assert.notEqual((await createKeelMerkleCommitment(files.slice(0, 2), { salt: "none" })).root, first.root);
  const fromCommitments = await createKeelMerkleCommitment(await Promise.all(files.map((file) => createKeelCommitment(file, { salt: "none" }))));
  assert.equal(fromCommitments.root, first.root);
  assert.ok(await verifyKeelMerkleProof(first.root, files[1], fromCommitments.proofFor(1)));
  await assert.rejects(createKeelMerkleCommitment([]), TypeError);
  await assert.rejects(createKeelMerkleCommitment(["a"], { salt: random(32) }), TypeError);
});

test("reveal files prove text and files and say which published value they prove", async () => {
  const text = await createKeelProofReveal("first sketch, 3 March");
  const roundTrip = normalizeKeelReveal(JSON.stringify(text.reveal));
  assert.deepEqual(roundTrip, text.reveal);
  assert.deepEqual(await verifyKeelReveal(roundTrip, { published: text.commitment.digest }), { valid: true, matchesPublished: true });
  const tampered = { ...text.reveal, content: { kind: "text", text: "first sketch, 4 March" } };
  assert.equal((await verifyKeelReveal(tampered)).valid, false);

  const bytes = new TextEncoder().encode("<svg/>");
  const file = await createKeelProofReveal({ name: "mark.svg", mediaType: "image/svg+xml", bytes });
  assert.equal(file.reveal.content.kind, "file");
  assert.equal(file.reveal.content.sha256, `0x${createHash("sha256").update(bytes).digest("hex")}`);
  assert.equal((await verifyKeelReveal(file.reveal)).valid, false);
  assert.deepEqual(await verifyKeelReveal(file.reveal, { file: bytes }), { valid: true, item: "mark.svg" });
  const other = await verifyKeelReveal(file.reveal, { file: new TextEncoder().encode("<svg />"), published: text.commitment.digest });
  assert.equal(other.valid, false);
  assert.equal(other.matchesPublished, false);
});

test("many-file reveals check each file on its own against one root", async () => {
  const files = ["a", "b", "c"].map((name) => ({ name: `${name}.txt`, bytes: new TextEncoder().encode(`file ${name}`) }));
  const { root, count, reveal } = await createKeelMerkleReveal(files);
  assert.equal(count, 3);
  const parsed = normalizeKeelReveal(JSON.parse(JSON.stringify(reveal)));
  for (const file of files) assert.deepEqual(await verifyKeelReveal(parsed, { file: file.bytes, published: root }), { valid: true, matchesPublished: true, item: file.name });
  const stranger = await verifyKeelReveal(parsed, { file: new TextEncoder().encode("file d") });
  assert.equal(stranger.valid, false);
  assert.match(stranger.reason, /not one of the proved files/u);
  assert.throws(() => normalizeKeelReveal({ ...reveal, items: [{ ...reveal.items[0], proof: { ...reveal.items[0].proof, count: 4 } }] }), /different tree|count/u);
  assert.throws(() => normalizeKeelReveal({ ...reveal, extra: 1 }), /not supported/u);
  assert.throws(() => normalizeKeelReveal("{nope"), /not JSON/u);
});
