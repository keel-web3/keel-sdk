import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { KEEL_SEALED_MEDIA_TYPE, createKeelCommitment, createKeelMerkleCommitment, normalizeKeelReveal, verifyKeelCommitment, verifyKeelMerkleProof, verifyKeelReveal } from '@keel/protocol';
import { checkRevealFile, normalizePublished, readRevealFile } from '../src/reveal-check.mjs';
import { WorkspaceStore, newProject } from '../src/workspace.mjs';
import { SealedService } from '../src/sealed-service.mjs';

// Stands in for Electron safeStorage: reversible only through this object.
function fakeKeychain() {
  const keychain = {
    on: true,
    available: () => keychain.on,
    encrypt: (text) => Buffer.from(`os-wrapped:${[...text].reverse().join('')}`),
    decrypt: (bytes) => { const text = Buffer.from(bytes).toString(); if (!text.startsWith('os-wrapped:')) throw new Error('bad'); return [...text.slice(11)].reverse().join(''); },
  };
  return keychain;
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const PASSPHRASE = 'violet harbor lantern quietly';
const SECRET_TEXT = 'Meet at the north gate at dawn.';

function setup() {
  const store = new WorkspaceStore(':memory:');
  const keychain = fakeKeychain();
  return { store, keychain, sealed: new SealedService(store, keychain), revision: () => store.read().revision };
}
const everything = (store) => [store.db.prepare('SELECT body FROM workspace').get().body, ...store.db.prepare('SELECT wrapped FROM sealed_keychain').all().map((row) => Buffer.from(row.wrapped).toString())].join('\n');

test('keychain slots wrap their key with the OS keychain; passphrases, recovery keys and plaintext are never stored', async () => {
  const { store, keychain, sealed, revision } = setup();
  try {
    const result = await sealed.seal({ source: { kind: 'text', text: SECRET_TEXT, name: 'Plan' }, passphrase: PASSPHRASE, keychain: true, revision: revision() });
    assert.match(result.recoveryKey, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(result.name, 'Plan.sealed');
    const object = store.read().state.objects.find((item) => item.id === result.objectId);
    assert.equal(object.type, KEEL_SEALED_MEDIA_TYPE);
    assert.equal(sha256(store.object(object.id)), object.id, 'the envelope is stored content-addressed');
    assert.equal(result.sizes.sealed, object.byteLength);
    assert.deepEqual(result.description.slots.map((slot) => slot.kind), ['passphrase', 'raw-key', 'raw-key']);
    assert.equal(result.description.keychain, true);

    const rows = store.db.prepare('SELECT fingerprint, wrapped FROM sealed_keychain').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].fingerprint, result.fingerprint);
    const wrapped = Buffer.from(rows[0].wrapped).toString();
    assert.match(wrapped, /^os-wrapped:/u);
    const key = keychain.decrypt(rows[0].wrapped);
    const stored = everything(store);
    for (const secret of [PASSPHRASE, result.recoveryKey, SECRET_TEXT, key]) assert.ok(!stored.includes(secret), 'no secret or plaintext is persisted');
    assert.ok(!JSON.stringify(store.read().state).includes(result.fingerprint), 'keychain bookkeeping stays out of the workspace JSON');

    for (const unlock of [{ kind: 'keychain' }, { kind: 'passphrase', passphrase: PASSPHRASE }, { kind: 'recovery', key: ` ${result.recoveryKey}\n` }]) {
      const opened = await sealed.open(result.objectId, unlock);
      assert.equal(opened.text, SECRET_TEXT);
      assert.equal(opened.mediaType, 'text/plain;charset=utf-8');
    }

    // Without the OS keychain, or with a damaged wrapped key, the keychain slot refuses plainly.
    keychain.on = false;
    await assert.rejects(sealed.open(result.objectId, { kind: 'keychain' }), /keychain isn’t available/);
    await assert.rejects(sealed.seal({ source: { kind: 'text', text: 'x'.repeat(20) }, keychain: true, revision: revision() }), /keychain isn’t available/);
    assert.equal(sealed.describe(result.objectId).keychain, false);
    keychain.on = true;
    store.db.prepare('UPDATE sealed_keychain SET wrapped=?').run(Buffer.from('garbage'));
    await assert.rejects(sealed.open(result.objectId, { kind: 'keychain' }), /couldn’t unwrap/);
  } finally { store.close(); }
});

test('sealed workspace files keep their media type, open to the same bytes, and attach to projects like any file', async () => {
  const { store, sealed, revision } = setup();
  try {
    const image = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(4000, 7)]);
    store.importObject(image, 'cover.png', 'image/png', revision());
    const source = store.read().state.objects[0];
    const result = await sealed.seal({ source: { kind: 'object', objectId: source.id }, keychain: false, revision: revision() });
    assert.equal(result.name, 'cover.png.sealed');
    assert.equal(result.description.mediaType, 'image/png');
    assert.equal(result.description.byteLength, image.byteLength);
    assert.ok(result.sizes.compressed < result.sizes.plaintext, 'compressible content is compressed before sealing');
    assert.deepEqual(result.description.slots.map((slot) => slot.kind), ['raw-key'], 'the recovery key is always a way in');
    const opened = await sealed.open(result.objectId, { kind: 'recovery', key: result.recoveryKey });
    assert.equal(opened.text, undefined, 'binary content is reported, not returned as text');
    const copy = await sealed.openBytes(result.objectId, { kind: 'recovery', key: result.recoveryKey });
    assert.deepEqual(Buffer.from(copy.bytes), image);
    assert.equal(copy.name, 'cover.png');

    const project = { ...newProject('Sealed release'), objectIds: [result.objectId] };
    const saved = store.save({ ...store.read().state, projects: [project] }, revision());
    assert.deepEqual(saved.state.projects[0].objectIds, [result.objectId]);
    await assert.rejects(sealed.seal({ source: { kind: 'object', objectId: result.objectId }, keychain: false, revision: revision() }), /already sealed/);
  } finally { store.close(); }
});

test('a backup way in is a new sealed object; the original keeps its slots', async () => {
  const { store, sealed, revision } = setup();
  try {
    const first = await sealed.seal({ source: { kind: 'text', text: SECRET_TEXT }, keychain: false, revision: revision() });
    const recovery = { kind: 'recovery', key: first.recoveryKey };
    const withPassphrase = await sealed.addSlot({ objectId: first.objectId, unlock: recovery, slot: { kind: 'passphrase', passphrase: PASSPHRASE }, revision: revision() });
    assert.notEqual(withPassphrase.objectId, first.objectId);
    assert.equal(sealed.describe(first.objectId).slots.length, 1);
    assert.deepEqual(withPassphrase.description.slots.map((slot) => slot.kind), ['raw-key', 'passphrase']);
    assert.equal(withPassphrase.description.contentKeyFingerprint, first.fingerprint, 'the content key is unchanged');
    assert.equal((await sealed.open(withPassphrase.objectId, { kind: 'passphrase', passphrase: PASSPHRASE })).text, SECRET_TEXT);
    await assert.rejects(sealed.open(first.objectId, { kind: 'passphrase', passphrase: PASSPHRASE }), /no passphrase way in/);

    const withKeychain = await sealed.addSlot({ objectId: withPassphrase.objectId, unlock: { kind: 'passphrase', passphrase: PASSPHRASE }, slot: { kind: 'keychain' }, revision: revision() });
    assert.equal((await sealed.open(withKeychain.objectId, { kind: 'keychain' })).text, SECRET_TEXT);
    await assert.rejects(sealed.addSlot({ objectId: withKeychain.objectId, unlock: { kind: 'keychain' }, slot: { kind: 'keychain' }, revision: revision() }), /can already open/);

    const withRecovery = await sealed.addSlot({ objectId: withKeychain.objectId, unlock: { kind: 'keychain' }, slot: { kind: 'recovery' }, revision: revision() });
    assert.match(withRecovery.recoveryKey, /^[A-Za-z0-9_-]{43}$/u);
    assert.notEqual(withRecovery.recoveryKey, first.recoveryKey);
    assert.equal((await sealed.open(withRecovery.objectId, { kind: 'recovery', key: withRecovery.recoveryKey })).text, SECRET_TEXT);
    assert.equal(store.read().state.objects.length, 4);
  } finally { store.close(); }
});

test('refusals are plain and never echo the secret that was tried', async () => {
  const { store, sealed, revision } = setup();
  try {
    const result = await sealed.seal({ source: { kind: 'text', text: SECRET_TEXT }, passphrase: PASSPHRASE, keychain: false, revision: revision() });
    const wrong = 'not the passphrase at all';
    await assert.rejects(sealed.open(result.objectId, { kind: 'passphrase', passphrase: wrong }), (error) => /That passphrase doesn’t open/.test(error.message) && !error.message.includes(wrong));
    await assert.rejects(sealed.open(result.objectId, { kind: 'recovery', key: 'too-short' }), /isn’t a recovery key/);
    await assert.rejects(sealed.open(result.objectId, { kind: 'keychain' }), /no key in this computer’s keychain/);
    await assert.rejects(sealed.seal({ source: { kind: 'text', text: SECRET_TEXT }, passphrase: 'short', keychain: false, revision: revision() }), /needs 8/);
    await assert.rejects(sealed.seal({ source: { kind: 'text', text: SECRET_TEXT }, keychain: false, revision: revision() - 1 }), /changed/);
    await assert.rejects(sealed.seal({ source: { kind: 'text', text: '' }, keychain: false, revision: revision() }), /Write the text/);
    await assert.rejects(sealed.seal({ source: { kind: 'text', text: 'x'.repeat(16 * 1024 * 1024 + 1) }, keychain: false, revision: revision() }), /limited to 16 MB/);

    store.importObject(Buffer.from('plain bytes'), 'notes.txt', 'text/plain', revision());
    const plain = store.read().state.objects.find((item) => item.name === 'notes.txt');
    await assert.rejects(sealed.open(plain.id, { kind: 'passphrase', passphrase: PASSPHRASE }), /not a sealed KEEL file/);
    assert.throws(() => sealed.describe('f'.repeat(64)), /not in this workspace/);

    // A damaged envelope fails authentication instead of opening to something else.
    const damaged = Buffer.from(store.object(result.objectId));
    damaged[damaged.length - 5] ^= 0xff;
    store.importObject(damaged, 'damaged.sealed', KEEL_SEALED_MEDIA_TYPE, revision());
    await assert.rejects(sealed.open(sha256(damaged), { kind: 'passphrase', passphrase: PASSPHRASE }), /altered or damaged/);
  } finally { store.close(); }
});

test('proofs: salted text, plain-sha256 files, and one Merkle root over several files', async () => {
  const { store, sealed, revision } = setup();
  try {
    const text = await sealed.commit({ kind: 'text', text: 'I predict 42' }, { salted: true });
    assert.match(text.commitment.digest, /^0x[0-9a-f]{64}$/u);
    assert.match(text.commitment.salt, /^0x[0-9a-f]{64}$/u);
    assert.equal(text.reveal.protocol, 'keel-proof-reveal@1');
    assert.deepEqual(normalizeKeelReveal(JSON.parse(JSON.stringify(text.reveal))), text.reveal, 'the editor writes exactly the shared reveal format');
    assert.equal((await verifyKeelReveal(text.reveal, { published: text.commitment.digest })).matchesPublished, true);
    assert.equal(await verifyKeelCommitment(text.reveal.commitment, 'I predict 41'), false);

    for (const [name, body] of [['a.txt', 'first'], ['b.txt', 'second'], ['c.txt', 'third']]) store.importObject(Buffer.from(body), name, 'text/plain', revision());
    const files = store.read().state.objects;
    const unsalted = await sealed.commit({ kind: 'object', objectId: files[0].id }, { salted: false });
    assert.equal(unsalted.commitment.digest, `0x${files[0].id}`, 'unsalted file proofs equal plain sha256, like the file id');
    assert.equal(unsalted.reveal.content.sha256, `0x${files[0].id}`);
    assert.equal((await verifyKeelReveal(unsalted.reveal, { file: new Uint8Array(store.object(files[0].id)) })).valid, true);

    const tree = await sealed.merkle(files.map((file) => file.id));
    assert.equal(tree.count, 3);
    assert.equal(tree.reveal.protocol, 'keel-merkle-reveal@1');
    for (const item of tree.reveal.items) assert.equal(await verifyKeelMerkleProof(tree.root, store.object(item.sha256.slice(2)), item.proof), true);
    assert.equal(await verifyKeelMerkleProof(tree.root, Buffer.from('forged'), tree.reveal.items[0].proof), false);
    await assert.rejects(sealed.merkle([files[0].id]), /Choose 2/);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM sealed_keychain').get().count, 0);
  } finally { store.close(); }
});

test('reveal files: the shared format checks against files and published values, and earlier editor files still read', async () => {
  const { store, sealed, revision } = setup();
  try {
    store.importObject(Buffer.from('the artwork bytes'), 'work.txt', 'text/plain', revision());
    store.importObject(Buffer.from('the second work'), 'second.txt', 'text/plain', revision());
    const [first, second] = store.read().state.objects;
    const proof = await sealed.commit({ kind: 'object', objectId: first.id }, { salted: true });
    const revealText = JSON.stringify(proof.reveal, null, 2);
    const file = new Uint8Array(store.object(first.id));
    assert.deepEqual(readRevealFile(revealText).needsFile, true);
    assert.equal((await checkRevealFile({ revealText })).reason, 'Add work.txt to check it.');
    const ok = await checkRevealFile({ revealText, file, published: proof.commitment.digest.toUpperCase().replace('0X', '') });
    assert.equal(ok.valid, true); assert.equal(ok.matchesPublished, true); assert.equal(ok.item, 'work.txt');
    const wrongFile = await checkRevealFile({ revealText, file: new Uint8Array(store.object(second.id)) });
    assert.equal(wrongFile.valid, false); assert.match(wrongFile.reason, /not the work.txt/);
    assert.equal((await checkRevealFile({ revealText, file, published: `0x${'0'.repeat(64)}` })).matchesPublished, false);
    assert.throws(() => normalizePublished('0x1234'), /64 hex/);
    await assert.rejects(checkRevealFile({ revealText: '{"protocol":"something-else"}' }), /keel-proof-reveal@1/);
    await assert.rejects(checkRevealFile({ revealText: 'not json' }), /isn’t JSON/);

    const tree = await sealed.merkle([first.id, second.id]);
    const merkleText = JSON.stringify(tree.reveal);
    const item = await checkRevealFile({ revealText: merkleText, file: new Uint8Array(store.object(second.id)), published: tree.root });
    assert.equal(item.valid, true); assert.equal(item.item, 'second.txt'); assert.equal(item.matchesPublished, true);
    assert.equal((await checkRevealFile({ revealText: merkleText, file: new Uint8Array(Buffer.from('forged')) })).reason, 'This file is not one of the proved files.');

    // Reveal files written by the editor before the shared format: same proofs, a `verify` hint and unprefixed hashes.
    const legacyCommitment = await createKeelCommitment(file);
    const legacyProof = { protocol: 'keel-proof-reveal@1', createdAt: new Date().toISOString(), commitment: legacyCommitment, content: { kind: 'file', name: 'work.txt', mediaType: 'text/plain', byteLength: file.byteLength, sha256: first.id }, verify: 'verifyKeelCommitment(commitment, content) from @keel/protocol' };
    const legacyRead = await checkRevealFile({ revealText: JSON.stringify(legacyProof), file, published: legacyCommitment.digest });
    assert.equal(legacyRead.upgraded, true); assert.equal(legacyRead.valid, true); assert.equal(legacyRead.matchesPublished, true);
    const commitments = [await createKeelCommitment(file), await createKeelCommitment(new Uint8Array(store.object(second.id)))];
    const legacyTree = await createKeelMerkleCommitment(commitments);
    const legacyMerkle = { protocol: 'keel-merkle-reveal@1', createdAt: new Date().toISOString(), root: legacyTree.root, count: 2, items: [first, second].map((object, index) => ({ name: object.name, mediaType: 'text/plain', byteLength: object.byteLength, sha256: object.id, proof: legacyTree.proofFor(index) })), verify: 'verifyKeelMerkleProof(root, fileBytes, proof) from @keel/protocol, one file at a time.' };
    const legacyItem = await checkRevealFile({ revealText: JSON.stringify(legacyMerkle), file: new Uint8Array(store.object(second.id)) });
    assert.equal(legacyItem.valid, true); assert.equal(legacyItem.item, 'second.txt');
    // The shared format itself stays strict: an unknown key on a non-editor file is refused.
    await assert.rejects(checkRevealFile({ revealText: JSON.stringify({ ...proof.reveal, extra: true }) }), /extra/);
  } finally { store.close(); }
});
