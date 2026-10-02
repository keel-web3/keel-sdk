// Seal & prove, main-process side. Uses the protocol's sealed API
// (@keel/protocol, docs/SEALED_CONTENT.md) and never invents crypto.
//
// What is kept where:
//   - Sealed envelopes are ordinary content-addressed workspace objects
//     (application/vnd.keel.sealed), so they attach to projects and publish
//     like any file.
//   - "This computer's keychain" is a raw-key slot whose 32-byte key is
//     wrapped by the operating system (Electron safeStorage) and kept in the
//     workspace database's sealed_keychain table, keyed by the envelope's
//     public content-key fingerprint. It is never in the workspace JSON, an
//     export, agent context or the renderer.
//   - Passphrases, recovery keys, passkey PRF outputs and opened plaintext are
//     never persisted. A recovery key is returned exactly once, to be shown.
// Nothing here logs.
import { createHash } from 'node:crypto';
import {
  KEEL_SEALED_MAX_PLAINTEXT_BYTES,
  KEEL_SEALED_MEDIA_TYPE,
  KeelSealedError,
  addKeelSealedSlot,
  createKeelMerkleReveal,
  createKeelProofReveal,
  createKeelRecoveryKey,
  describeKeelSealed,
  estimateKeelSealedSize,
  isKeelSealedEnvelope,
  openKeelContent,
  parseKeelRecoveryKey,
  parseKeelSealedHeader,
  sealKeelContent,
} from '@keel/protocol';

const MAX_MERKLE_FILES = 256;
// Every file of a many-file proof is read at once; keep that bounded.
const MAX_MERKLE_BYTES = 128 * 1024 * 1024;
const MAX_TEXT_RETURN = 2_000_000;

const bytesOf = (text) => new Uint8Array(Buffer.from(text, 'utf8'));
const toB64u = (bytes) => Buffer.from(bytes).toString('base64url');
function fromB64u(text, what, length) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(text)) throw new TypeError(`${what} must be base64url text.`);
  const bytes = new Uint8Array(Buffer.from(text, 'base64url'));
  if (length !== undefined && bytes.byteLength !== length) throw new TypeError(`${what} must be ${length} bytes.`);
  if (bytes.byteLength === 0 || bytes.byteLength > 1023) throw new TypeError(`${what} has an invalid length.`);
  return bytes;
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function mediaTypeOf(type) {
  // The protocol only accepts data-URI style media types; anything else is sealed as plain bytes.
  try { estimateKeelSealedSize(0, { mediaType: type, slots: ['raw-key'] }); return type; } catch { return 'application/octet-stream'; }
}

function sealedName(name) {
  const base = String(name || 'Sealed note').replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 240) || 'Sealed note';
  return base.endsWith('.sealed') ? base : `${base}.sealed`;
}

const WRONG = { passphrase: 'That passphrase doesn’t open this sealed file.', recovery: 'That recovery key doesn’t open this sealed file.', keychain: 'This computer’s keychain key doesn’t open this sealed file.', passkey: 'That passkey doesn’t open this sealed file.' };
const MISSING = { passphrase: 'This sealed file has no passphrase way in.', recovery: 'This sealed file has no recovery-key way in.', keychain: 'This sealed file has no key in this computer’s keychain.', passkey: 'This sealed file has no passkey way in.' };

/** Plain-language errors that never include the secret that was tried. */
function friendly(error, kind) {
  if (error instanceof KeelSealedError) {
    if (error.code === 'tampered') return new Error('This sealed file was altered or damaged, so it can’t be opened.');
    if (error.code === 'no-slot') return new Error(MISSING[kind] ?? 'This sealed file can’t be opened that way.');
    return new Error(WRONG[kind] ?? 'That doesn’t open this sealed file.');
  }
  return error;
}

/**
 * @typedef {{ available(): boolean, encrypt(text: string): Uint8Array, decrypt(bytes: Uint8Array): string }} Keychain
 * @typedef {{ kind: 'text', text: string, name?: string } | { kind: 'object', objectId: string }} SealSource
 * @typedef {{ kind: 'passphrase', passphrase: string } | { kind: 'recovery', key: string } | { kind: 'keychain' } | { kind: 'passkey', prfOutput: string, credentialId?: string, slotIndex?: number }} SealUnlock
 * @typedef {{ credentialId: string, prfSalt: string, prfOutput: string, rpId?: string, includeCredentialId?: boolean }} PasskeySlot
 * @typedef {{ kind: 'passphrase', passphrase: string } | { kind: 'recovery' } | { kind: 'keychain' } | ({ kind: 'passkey' } & PasskeySlot)} SealSlotRequest
 */

export class SealedService {
  /** @param {import('./workspace.mjs').WorkspaceStore} store @param {Keychain} keychain */
  constructor(store, keychain) {
    this.store = store;
    this.keychain = keychain;
    store.db.exec('CREATE TABLE IF NOT EXISTS sealed_keychain (fingerprint TEXT PRIMARY KEY, wrapped BLOB NOT NULL, created_at TEXT NOT NULL)');
  }

  keychainAvailable() {
    try { return Boolean(this.keychain?.available()); } catch { return false; }
  }

  status() {
    return { keychain: this.keychainAvailable(), maxPlaintextBytes: KEEL_SEALED_MAX_PLAINTEXT_BYTES, mediaType: KEEL_SEALED_MEDIA_TYPE };
  }

  /** @param {SealSource} source */
  #source(source) {
    if (source?.kind === 'text') {
      if (typeof source.text !== 'string' || !source.text.length) throw new TypeError('Write the text first.');
      const content = bytesOf(source.text);
      return { kind: 'text', content, text: source.text, name: String(source.name ?? '').trim(), mediaType: 'text/plain;charset=utf-8', byteLength: content.byteLength };
    }
    if (source?.kind === 'object') {
      const object = this.store.read().state.objects.find((item) => item.id === source.objectId);
      if (!object) throw new Error('That file is not in this workspace.');
      if (object.type === KEEL_SEALED_MEDIA_TYPE) throw new TypeError('That file is already sealed. Open it to add another way in.');
      const content = new Uint8Array(this.store.object(object.id));
      return { kind: 'file', content, name: object.name, mediaType: mediaTypeOf(object.type), byteLength: content.byteLength, objectId: object.id };
    }
    throw new TypeError('Choose text or a workspace file.');
  }

  #envelope(objectId) {
    const object = this.store.read().state.objects.find((item) => item.id === objectId);
    if (!object) throw new Error('That sealed file is not in this workspace.');
    const bytes = new Uint8Array(this.store.object(objectId));
    if (!isKeelSealedEnvelope(bytes)) throw new TypeError('That file is not a sealed KEEL file.');
    return { object, envelope: bytes };
  }

  /* ---------------------------------------------------------------- proofs */

  /**
   * A proof-of-existence commitment in the shared reveal format
   * (keel-proof-reveal@1, the same JSON Studio writes and checks). Publish
   * `commitment.digest`; the reveal file holds the salt and says what was
   * committed, so keep it private until the reveal.
   * @param {SealSource} source
   */
  async commit(source, { salted = true } = {}) {
    const item = this.#source(source);
    const options = { salt: salted ? 'random' : 'none' };
    return item.kind === 'text'
      ? createKeelProofReveal(item.text, options)
      : createKeelProofReveal({ name: item.name, bytes: item.content, mediaType: item.mediaType }, options);
  }

  /** One 32-byte root over several workspace files (keel-merkle-reveal@1); each file is salted on its own and revealed with its own proof. */
  async merkle(objectIds) {
    const ids = [...new Set(objectIds ?? [])];
    if (ids.length < 2 || ids.length > MAX_MERKLE_FILES) throw new TypeError(`Choose 2–${MAX_MERKLE_FILES} files.`);
    const objects = this.store.read().state.objects;
    const total = ids.reduce((sum, id) => sum + (objects.find((item) => item.id === id)?.byteLength ?? 0), 0);
    if (total > MAX_MERKLE_BYTES) throw new RangeError('Those files add up to more than 128 MB. Prove fewer at once.');
    const files = ids.map((id) => { const item = this.#source({ kind: 'object', objectId: id }); return { name: item.name, bytes: item.content, mediaType: item.mediaType }; });
    return createKeelMerkleReveal(files);
  }

  /* ---------------------------------------------------------------- sealing */

  /** @param {PasskeySlot} passkey */
  #passkeySlot(passkey) {
    return {
      kind: 'passkey-prf',
      credentialId: fromB64u(passkey.credentialId, 'Passkey credential id'),
      prfSalt: fromB64u(passkey.prfSalt, 'Passkey salt', 32),
      prfOutput: fromB64u(passkey.prfOutput, 'Passkey secret', 32),
      includeCredentialId: passkey.includeCredentialId === true,
      ...(passkey.rpId ? { rpId: String(passkey.rpId) } : {}),
    };
  }

  #keychainKey(fingerprint) {
    if (!this.keychainAvailable()) throw new Error('This computer’s keychain isn’t available, so it can’t open sealed files right now.');
    const row = this.store.db.prepare('SELECT wrapped FROM sealed_keychain WHERE fingerprint=?').get(fingerprint);
    if (!row) throw new Error(MISSING.keychain);
    let text;
    try { text = this.keychain.decrypt(new Uint8Array(row.wrapped)); } catch { throw new Error('This computer’s keychain couldn’t unwrap its key for this sealed file.'); }
    return fromB64u(text, 'Keychain key', 32);
  }

  #rememberKeychainKey(fingerprint, key) {
    const wrapped = this.keychain.encrypt(toB64u(key));
    this.store.db.prepare('INSERT INTO sealed_keychain VALUES (?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET wrapped=excluded.wrapped').run(fingerprint, Buffer.from(wrapped), new Date().toISOString());
  }

  hasKeychainKey(fingerprint) {
    return Boolean(this.store.db.prepare('SELECT 1 FROM sealed_keychain WHERE fingerprint=?').get(fingerprint));
  }

  /**
   * Compress, encrypt and store text or a workspace file as a new sealed
   * object. A recovery key is always one of its ways in; the passphrase,
   * keychain and passkey slots are optional. Returns the recovery key once.
   * @param {{ source: SealSource, name?: string, passphrase?: string, keychain?: boolean, passkey?: PasskeySlot, revision: number }} input
   */
  async seal(input) {
    const item = this.#source(input.source);
    if (item.byteLength > KEEL_SEALED_MAX_PLAINTEXT_BYTES) throw new RangeError('Sealed content is limited to 16 MB. Seal a smaller file.');
    if (input.keychain && !this.keychainAvailable()) throw new Error('This computer’s keychain isn’t available. Seal with a passphrase and your recovery key instead.');
    const recovery = createKeelRecoveryKey();
    const keychainKey = input.keychain ? createKeelRecoveryKey().key : undefined;
    try {
      const slots = [];
      if (typeof input.passphrase === 'string' && input.passphrase.length) slots.push({ kind: 'passphrase', passphrase: input.passphrase });
      if (input.passkey) slots.push(this.#passkeySlot(input.passkey));
      if (keychainKey) slots.push({ kind: 'raw-key', key: keychainKey });
      slots.push({ kind: 'raw-key', key: recovery.key });
      const sealed = await sealKeelContent(item.content, { mediaType: item.mediaType, compression: 'auto', slots });
      const name = sealedName(input.name || item.name);
      const workspace = this.store.importObject(Buffer.from(sealed.envelope), name, KEEL_SEALED_MEDIA_TYPE, input.revision);
      if (keychainKey) this.#rememberKeychainKey(sealed.contentKeyFingerprint, keychainKey);
      const objectId = sha256(sealed.envelope);
      return { workspace, objectId, name, sizes: sealed.sizes, fingerprint: sealed.contentKeyFingerprint, description: this.describe(objectId), recoveryKey: recovery.text };
    } catch (error) {
      throw friendly(error, 'passphrase');
    } finally {
      recovery.key.fill(0);
      keychainKey?.fill(0);
    }
  }

  /** What a sealed object is and which kinds of key open it. Needs no secret. */
  describe(objectId) {
    const { object, envelope } = this.#envelope(objectId);
    const description = describeKeelSealed(envelope);
    return { objectId, name: object.name, ...description, header: parseKeelSealedHeader(envelope), keychain: this.keychainAvailable() && this.hasKeychainKey(description.contentKeyFingerprint) };
  }

  /** @param {Uint8Array} envelope @param {SealUnlock} unlock */
  #unlock(envelope, unlock) {
    switch (unlock?.kind) {
      case 'passphrase':
        if (typeof unlock.passphrase !== 'string' || !unlock.passphrase.length) throw new TypeError('Enter the passphrase.');
        return { kind: 'passphrase', passphrase: unlock.passphrase };
      case 'recovery': {
        let key;
        try { key = parseKeelRecoveryKey(String(unlock.key ?? '')); } catch { throw new TypeError('That isn’t a recovery key. It is 43 letters, numbers, dashes and underscores.'); }
        return { kind: 'raw-key', key };
      }
      case 'keychain':
        return { kind: 'raw-key', key: this.#keychainKey(describeKeelSealed(envelope).contentKeyFingerprint) };
      case 'passkey':
        return {
          kind: 'passkey-prf',
          prfOutput: fromB64u(unlock.prfOutput, 'Passkey secret', 32),
          ...(unlock.credentialId ? { credentialId: fromB64u(unlock.credentialId, 'Passkey credential id') } : {}),
          ...(Number.isInteger(unlock.slotIndex) ? { slotIndex: unlock.slotIndex } : {}),
        };
      default:
        throw new TypeError('Choose how to open it.');
    }
  }

  async #open(objectId, unlock) {
    const { object, envelope } = this.#envelope(objectId);
    const secret = this.#unlock(envelope, unlock);
    try { return { object, opened: await openKeelContent(envelope, secret) }; }
    catch (error) { throw friendly(error, unlock.kind); }
    finally { if (secret.kind === 'raw-key' && secret.key instanceof Uint8Array) secret.key.fill(0); }
  }

  /**
   * Opens a sealed object. Text comes back to be shown; other content only
   * reports what it is (use openBytes to save a copy). Nothing is stored.
   * @param {string} objectId @param {SealUnlock} unlock
   */
  async open(objectId, unlock) {
    const { opened } = await this.#open(objectId, unlock);
    const text = opened.text !== undefined && opened.text.length <= MAX_TEXT_RETURN ? opened.text : undefined;
    return { mediaType: opened.mediaType, byteLength: opened.bytes.byteLength, slotIndex: opened.slotIndex, ...(text === undefined ? {} : { text }) };
  }

  /** The opened bytes, for saving a copy where the creator chooses. */
  async openBytes(objectId, unlock) {
    const { object, opened } = await this.#open(objectId, unlock);
    return { name: object.name.replace(/\.sealed$/u, '') || 'opened', mediaType: opened.mediaType, bytes: opened.bytes };
  }

  /**
   * Adds a backup way in without re-encrypting the content. The result is a
   * new sealed object; the original (and anything already published) keeps
   * its old slots.
   * @param {{ objectId: string, unlock: SealUnlock, slot: SealSlotRequest, revision: number }} input
   */
  async addSlot(input) {
    const { object, envelope } = this.#envelope(input.objectId);
    const fingerprint = describeKeelSealed(envelope).contentKeyFingerprint;
    let recovery;
    let keychainKey;
    let slot;
    switch (input.slot?.kind) {
      case 'passphrase': slot = { kind: 'passphrase', passphrase: input.slot.passphrase }; break;
      case 'recovery': recovery = createKeelRecoveryKey(); slot = { kind: 'raw-key', key: recovery.key }; break;
      case 'keychain':
        if (!this.keychainAvailable()) throw new Error('This computer’s keychain isn’t available.');
        if (this.hasKeychainKey(fingerprint)) {
          keychainKey = this.#keychainKey(fingerprint);
          const opens = await openKeelContent(envelope, { kind: 'raw-key', key: keychainKey }).then(() => true, () => false);
          if (opens) { keychainKey.fill(0); throw new TypeError('This computer’s keychain can already open this sealed file.'); }
        } else keychainKey = createKeelRecoveryKey().key;
        slot = { kind: 'raw-key', key: keychainKey };
        break;
      case 'passkey': slot = this.#passkeySlot(input.slot); break;
      default: throw new TypeError('Choose the way in to add.');
    }
    const secret = this.#unlock(envelope, input.unlock);
    try {
      const changed = await addKeelSealedSlot(envelope, secret, slot);
      const workspace = this.store.importObject(Buffer.from(changed.envelope), object.name, KEEL_SEALED_MEDIA_TYPE, input.revision);
      if (keychainKey && !this.hasKeychainKey(fingerprint)) this.#rememberKeychainKey(fingerprint, keychainKey);
      const objectId = sha256(changed.envelope);
      return { workspace, objectId, description: this.describe(objectId), ...(recovery ? { recoveryKey: recovery.text } : {}) };
    } catch (error) {
      throw friendly(error, input.unlock?.kind);
    } finally {
      if (secret.kind === 'raw-key' && secret.key instanceof Uint8Array) secret.key.fill(0);
      recovery?.key.fill(0);
      keychainKey?.fill(0);
    }
  }
}
