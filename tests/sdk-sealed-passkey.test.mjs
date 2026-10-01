import test from "node:test";
import assert from "node:assert/strict";
import { addKeelSealedSlot, openKeelContent, parseKeelSealedHeader, sealKeelContent } from "../packages/protocol/dist/index.js";
import {
  KeelPasskeyError,
  createSealingPasskey,
  getPasskeySealingSupport,
  isPasskeySealingSupported,
  prepareSealingPasskeySlot,
  unlockSealedWithPasskey,
} from "../packages/sdk/dist/sealed-passkey.js";

const random = (length) => globalThis.crypto.getRandomValues(new Uint8Array(length));
const b64u = (bytes) => Buffer.from(bytes).toString("base64url");
const view = (source) => (source instanceof ArrayBuffer ? new Uint8Array(source) : new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
const same = (left, right) => Buffer.from(left).equals(Buffer.from(right));
const OPTIONS = { rp: { name: "KEEL", id: "onkeel.io" }, user: { name: "alice" } };

async function hmac(secret, salt) {
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, salt));
}

/**
 * A stand-in for navigator.credentials. `prf` decides how the "browser"
 * handles the extension: "results" (returns PRF output at creation),
 * "enabled-only" (reports support at creation, outputs on get), "disabled"
 * or "none" (extension ignored).
 */
function fakeAuthenticator({ prf = "results", discoverable = true, failWith, capabilities = { "extension:prf": true } } = {}) {
  const passkeys = [];
  const calls = [];
  let picked = 0;
  const credential = (id, extensions) => ({
    type: "public-key",
    id: b64u(id),
    rawId: id.slice().buffer,
    getClientExtensionResults() {
      return extensions;
    },
  });
  const environment = {
    PublicKeyCredential: { getClientCapabilities: async () => capabilities },
    credentials: {
      async create(options) {
        calls.push({ method: "create", options });
        if (failWith) throw new DOMException("The operation failed.", failWith);
        const id = random(16);
        const secret = random(32);
        passkeys.push({ id, secret });
        const extensions = { credProps: { rk: discoverable } };
        if (prf === "results") extensions.prf = { enabled: true, results: { first: (await hmac(secret, view(options.publicKey.extensions.prf.eval.first))).buffer } };
        if (prf === "enabled-only") extensions.prf = { enabled: true };
        if (prf === "disabled") extensions.prf = { enabled: false };
        return credential(id, extensions);
      },
      async get(options) {
        calls.push({ method: "get", options });
        if (failWith) throw new DOMException("The operation failed.", failWith);
        const allow = options.publicKey.allowCredentials ?? [];
        const passkey = allow.length > 0
          ? passkeys.find((entry) => allow.some((descriptor) => same(view(descriptor.id), entry.id)))
          : passkeys[picked];
        if (passkey === undefined) throw new DOMException("No credential.", "NotAllowedError");
        const extensions = {};
        if (prf === "results" || prf === "enabled-only") {
          const input = options.publicKey.extensions.prf;
          const salt = input.evalByCredential?.[b64u(passkey.id)]?.first ?? input.eval?.first;
          extensions.prf = { results: { first: (await hmac(passkey.secret, view(salt))).buffer } };
        }
        return credential(passkey.id, extensions);
      },
    },
  };
  return {
    environment,
    calls,
    passkeys,
    pick(index) {
      picked = index;
    },
  };
}

async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof KeelPasskeyError, `expected KeelPasskeyError, got ${error}`);
    assert.equal(error.code, code, error.message);
    return true;
  });
}

test("feature detection reads WebAuthn and the PRF client capability", async () => {
  assert.deepEqual(await getPasskeySealingSupport({}), { supported: false, prf: "no", reason: "Passkeys are not available here. Use a current browser on a secure (https) page." });
  assert.equal(await isPasskeySealingSupported({}), false);
  assert.equal(await isPasskeySealingSupported(), false, "Node has no WebAuthn");
  const credentials = fakeAuthenticator().environment.credentials;
  assert.deepEqual(await getPasskeySealingSupport({ credentials, PublicKeyCredential: { getClientCapabilities: async () => ({ "extension:prf": true }) } }), { supported: true, prf: "yes" });
  assert.equal((await getPasskeySealingSupport({ credentials, PublicKeyCredential: { getClientCapabilities: async () => ({ "extension:prf": false }) } })).supported, false);
  assert.equal(await isPasskeySealingSupported({ credentials, PublicKeyCredential: { getClientCapabilities: async () => ({ "extension:prf": false }) } }), false);
  assert.deepEqual(await getPasskeySealingSupport({ credentials, PublicKeyCredential: { getClientCapabilities: async () => ({}) } }), { supported: true, prf: "unknown" });
  assert.deepEqual(await getPasskeySealingSupport({ credentials, PublicKeyCredential: {} }), { supported: true, prf: "unknown" });
  assert.deepEqual(await getPasskeySealingSupport({ credentials, PublicKeyCredential: { getClientCapabilities: async () => { throw new Error("nope"); } } }), { supported: true, prf: "unknown" });
});

test("a new sealing passkey seals and unlocks content", async () => {
  const authenticator = fakeAuthenticator();
  const passkey = await createSealingPasskey(OPTIONS, authenticator.environment);
  assert.equal(passkey.discoverable, true);
  assert.equal(passkey.rpId, "onkeel.io");
  assert.equal(passkey.credentialIdText, b64u(passkey.credentialId));
  assert.equal(passkey.slot.includeCredentialId, false);

  const created = authenticator.calls[0].options.publicKey;
  assert.equal(created.authenticatorSelection.residentKey, "preferred");
  assert.equal(created.authenticatorSelection.userVerification, "required");
  assert.equal(view(created.extensions.prf.eval.first).byteLength, 32);
  assert.deepEqual(view(created.extensions.prf.eval.first), passkey.slot.prfSalt);
  assert.equal(created.extensions.credProps, true);
  assert.equal(created.user.id.byteLength, 16);

  const { envelope } = await sealKeelContent("hello from a passkey", { slots: [passkey.slot] });
  const slot = parseKeelSealedHeader(envelope).slots[0];
  assert.equal(slot.credentialId, undefined);
  assert.equal(slot.rpId, "onkeel.io");

  const unlock = await unlockSealedWithPasskey(envelope, {}, authenticator.environment);
  assert.equal(unlock.slotIndex, 0);
  assert.deepEqual(unlock.credentialId, passkey.credentialId);
  const request = authenticator.calls[1].options.publicKey;
  assert.deepEqual(request.allowCredentials, [], "a discoverable passkey is chosen by the user");
  assert.equal(request.rpId, "onkeel.io");
  assert.equal((await openKeelContent(envelope, unlock)).text, "hello from a passkey");
});

test("authenticators that only report PRF support at creation are evaluated once more", async () => {
  const authenticator = fakeAuthenticator({ prf: "enabled-only", discoverable: false });
  const passkey = await createSealingPasskey(OPTIONS, authenticator.environment);
  assert.deepEqual(authenticator.calls.map((call) => call.method), ["create", "get"]);
  assert.deepEqual(view(authenticator.calls[1].options.publicKey.allowCredentials[0].id), passkey.credentialId);
  assert.equal(passkey.slot.includeCredentialId, true, "not discoverable, so the id is stored");

  const { envelope } = await sealKeelContent("x", { slots: [passkey.slot] });
  assert.equal(parseKeelSealedHeader(envelope).slots[0].credentialId, passkey.credentialIdText);
  const unlock = await unlockSealedWithPasskey(envelope, {}, authenticator.environment);
  const request = authenticator.calls[2].options.publicKey;
  assert.equal(request.allowCredentials.length, 1, "stored ids are requested directly");
  assert.ok(request.extensions.prf.eval);
  assert.equal((await openKeelContent(envelope, unlock)).text, "x");
});

test("missing PRF support fails with a clear error", async () => {
  for (const prf of ["none", "disabled"]) {
    await rejectsWithCode(createSealingPasskey(OPTIONS, fakeAuthenticator({ prf }).environment), "prf-unsupported");
  }
  const working = fakeAuthenticator();
  const passkey = await createSealingPasskey(OPTIONS, working.environment);
  const { envelope } = await sealKeelContent("x", { slots: [passkey.slot] });
  const silent = { ...working.environment, credentials: { ...working.environment.credentials, get: async (options) => ({ ...(await working.environment.credentials.get(options)), getClientExtensionResults: () => ({}) }) } };
  await rejectsWithCode(unlockSealedWithPasskey(envelope, {}, silent), "prf-unsupported");
  const odd = { ...working.environment, credentials: { ...working.environment.credentials, get: async () => ({ rawId: passkey.credentialId.slice().buffer, getClientExtensionResults: () => ({ prf: { results: { first: new ArrayBuffer(16) } } }) }) } };
  await rejectsWithCode(unlockSealedWithPasskey(envelope, {}, odd), "failed");
});

test("cancelled, aborted and unsupported requests map to error codes", async () => {
  await rejectsWithCode(createSealingPasskey(OPTIONS, fakeAuthenticator({ failWith: "NotAllowedError" }).environment), "cancelled");
  await rejectsWithCode(createSealingPasskey(OPTIONS, fakeAuthenticator({ failWith: "AbortError" }).environment), "aborted");
  await rejectsWithCode(createSealingPasskey(OPTIONS, fakeAuthenticator({ failWith: "SecurityError" }).environment), "wrong-site");
  await rejectsWithCode(createSealingPasskey(OPTIONS, {}), "unsupported");
  const nothing = fakeAuthenticator();
  nothing.environment.credentials.create = async () => null;
  await rejectsWithCode(createSealingPasskey(OPTIONS, nothing.environment), "cancelled");

  const authenticator = fakeAuthenticator();
  const passkey = await createSealingPasskey(OPTIONS, authenticator.environment);
  const { envelope } = await sealKeelContent("x", { slots: [passkey.slot] });
  const cancelling = { ...authenticator.environment, credentials: { ...authenticator.environment.credentials, get: async () => { throw new DOMException("User cancelled.", "NotAllowedError"); } } };
  await rejectsWithCode(unlockSealedWithPasskey(envelope, {}, cancelling), "cancelled");
  await assert.rejects(createSealingPasskey({ rp: { name: "" }, user: { name: "alice" } }, authenticator.environment), TypeError);
});

test("the wrong passkey and objects without passkey slots are reported", async () => {
  const authenticator = fakeAuthenticator();
  const mine = await createSealingPasskey(OPTIONS, authenticator.environment);
  await createSealingPasskey(OPTIONS, authenticator.environment);
  const { envelope } = await sealKeelContent("x", { slots: [mine.slot] });
  authenticator.pick(1);
  await rejectsWithCode(unlockSealedWithPasskey(envelope, {}, authenticator.environment), "unknown-passkey");
  const passphraseOnly = await sealKeelContent("x", { slots: [{ kind: "passphrase", passphrase: "correct horse battery staple" }] });
  await rejectsWithCode(unlockSealedWithPasskey(passphraseOnly.envelope, {}, authenticator.environment), "no-passkey-slot");
  await rejectsWithCode(unlockSealedWithPasskey(envelope, { rpId: "example.com" }, authenticator.environment), "no-passkey-slot");
  await rejectsWithCode(unlockSealedWithPasskey(envelope, { strategy: "known" }, authenticator.environment), "unknown-passkey");
});

test("a backup passkey slot unlocks through a second, targeted prompt", async () => {
  const authenticator = fakeAuthenticator();
  const first = await createSealingPasskey(OPTIONS, authenticator.environment);
  const second = await createSealingPasskey(OPTIONS, authenticator.environment);
  const sealed = await sealKeelContent("two ways in", { slots: [first.slot] });

  authenticator.pick(1);
  const backup = await prepareSealingPasskeySlot({ rpId: "onkeel.io" }, authenticator.environment);
  assert.deepEqual(backup.credentialId, second.credentialId);
  assert.equal(backup.slot.includeCredentialId, false);
  assert.notDeepEqual(backup.slot.prfSalt, second.slot.prfSalt, "every slot gets a fresh salt");
  authenticator.pick(0);
  const firstUnlock = await unlockSealedWithPasskey(sealed.envelope, {}, authenticator.environment);
  const { envelope } = await addKeelSealedSlot(sealed.envelope, firstUnlock, backup.slot);

  authenticator.pick(1);
  const before = authenticator.calls.length;
  const unlock = await unlockSealedWithPasskey(envelope, {}, authenticator.environment);
  const gets = authenticator.calls.slice(before);
  assert.equal(gets.length, 2);
  assert.deepEqual(gets[0].options.publicKey.allowCredentials, []);
  assert.deepEqual(view(gets[1].options.publicKey.allowCredentials[0].id), second.credentialId);
  assert.equal(unlock.slotIndex, 1);
  assert.equal((await openKeelContent(envelope, unlock)).text, "two ways in");

  authenticator.pick(0);
  assert.equal((await unlockSealedWithPasskey(envelope, {}, authenticator.environment)).slotIndex, 0);
});

test("remembered credential ids are requested directly with per-credential salts", async () => {
  const authenticator = fakeAuthenticator();
  const first = await createSealingPasskey(OPTIONS, authenticator.environment);
  const second = await createSealingPasskey(OPTIONS, authenticator.environment);
  const sealed = await sealKeelContent("remembered", { slots: [first.slot] });
  const { envelope } = await addKeelSealedSlot(sealed.envelope, await unlockSealedWithPasskey(sealed.envelope, {}, authenticator.environment), (await prepareSealingPasskeySlot({ credentialId: second.credentialIdText, includeCredentialId: false }, authenticator.environment)).slot);

  const before = authenticator.calls.length;
  const unlock = await unlockSealedWithPasskey(envelope, { knownCredentialIds: [first.credentialIdText, second.credentialId, random(16)] }, authenticator.environment);
  const [call] = authenticator.calls.slice(before);
  assert.equal(authenticator.calls.length, before + 1, "one prompt");
  assert.equal(call.options.publicKey.allowCredentials.length, 2);
  assert.deepEqual(Object.keys(call.options.publicKey.extensions.prf.evalByCredential).sort(), [first.credentialIdText, second.credentialIdText].sort());
  assert.equal(unlock.slotIndex, 0);
  assert.equal((await openKeelContent(envelope, unlock)).text, "remembered");

  const header = parseKeelSealedHeader(envelope);
  const onlySecond = await unlockSealedWithPasskey(header, { knownCredentialIds: [second.credentialId] }, authenticator.environment);
  assert.equal(onlySecond.slotIndex, 0, "only one slot is covered, so the user picks; the fake picks passkey 0");
});
