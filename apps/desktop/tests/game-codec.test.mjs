// The codec inspector: pasted text and project records (pure), then against a
// real engine checkout (skipped without one): documents explained field by
// field with spans that tile the buffer, sizes, schemas resolved by header, by
// name and through a workspace manifest, a JSON edit re-encoded to canonical
// bytes, an invalid edit naming its field, the Solidity decoder (a fixed layout,
// and a refusal), a project's records (sound, KC1 voxels, a build's op list),
// and the assistant's tool staying well under its result limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { newTemplateProject, WorkspaceStore } from '../src/workspace.mjs';
import { findGameEngineRoot } from '../src/game-engine/game-engine-service.mjs';
import { GameCodecService } from '../src/game-engine/codec-service.mjs';
import { codecSourcesOf, fromBase64Any, isCodecDocument, parseCodecText, recordBytes, SOUND_FILE, SOUND_FORMAT, toBase64, toBase64Url, toHexText } from '../src/game-engine/codec-project.mjs';
import { withBuildFile, withPackFiles } from '../src/game-engine/builder-project.mjs';
import { AgentStore } from '../src/agent-store.mjs';
import { createAgentTools } from '../src/agent-tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(here, '../src/game-engine/codec-worker.mjs');
const found = findGameEngineRoot([path.resolve(here, '../../../../keel-engine')]);
const engineTest = found.root ? test : test.skip;
const DOC = Uint8Array.from([0xb1, 0x35, 0xe0, 0x32, 0xc0, 0x00, 0xff, 0x10, 0x2a]);
const withFile = (project, name, content) => ({ ...project, files: [...project.files, { id: crypto.randomUUID(), name, type: 'text/plain', content }] });

test('pasted text: KC1:, 0x hex, bare hex, base64 and base64url, whitespace ignored', () => {
  const url = toBase64Url(DOC), std = toBase64(DOC), hex = toHexText(DOC);
  assert.equal(hex, 'b135e032c000ff102a');
  for (const [text, format] of [[`KC1:${url}`, 'kc1'], [`0x${hex}`, 'hex'], [hex.toUpperCase(), 'hex'], [std, 'base64'], [url, 'base64url'], [` ${std.slice(0, 5)}\n ${std.slice(5)} `, 'base64']]) {
    const r = parseCodecText(text);
    assert.equal(r.format, format, text); assert.deepEqual([...r.bytes], [...DOC], text);
  }
  assert.deepEqual([...fromBase64Any('sQ==')], [0xb1]);
  assert.ok(isCodecDocument(DOC) && !isCodecDocument(Uint8Array.from([1, 2, 3])) && isCodecDocument(Uint8Array.from([0xb2, 3])));
  assert.throws(() => parseCodecText(''), /Paste a codec document/);
  assert.throws(() => parseCodecText('0xabc'), /even number of hex digits/);
  assert.throws(() => parseCodecText('KC1:not base64!'), /base64url after the prefix/);
  assert.throws(() => parseCodecText('hello world?'), /isn’t KC1: text, hex or base64/);
});

test('a project\'s codec records: sound/sound.json, KC1: voxels in a pack file, a build\'s op list, a whole-file document', () => {
  let project = newTemplateProject('Codec yard', 'game');
  const sound = { format: SOUND_FORMAT, music: [{ id: 'theme', title: 'Main theme', kind: 'recipe', bytes: toBase64Url(DOC) }, { id: 'boss', kind: 'song', bytes: toBase64Url(DOC.slice(0, 6)) }], assign: [], sfx: toBase64Url(DOC) };
  project = withFile(project, SOUND_FILE, JSON.stringify(sound));
  project = withPackFiles(project, [{ name: 'packs/crate.ts', content: `import { objectFromVoxels } from "@keel-engine/builder";\nconst VOXELS = "KC1:${toBase64Url(DOC)}";\nconst OTHER = "KC1:${toBase64Url(DOC.slice(0, 5))}";\nexport default objectFromVoxels(VOXELS);\n` }]);
  project = withBuildFile(project, 'main', [{ op: 'new', name: 'hut', unit: 0.1 }, { op: 'box', from: [0, 0, 0], to: [1, 1, 1], role: 'primary' }]);
  project = withFile(project, 'data/level.b64', `\n${toBase64(DOC)}\n`);
  project = withFile(project, 'notes.txt', 'nothing codec here');
  project = withFile(project, 'builds/broken.build.json', '{"nope":1}');
  const records = codecSourcesOf(project);
  assert.deepEqual(records.map((r) => [r.file, r.record, r.kind]), [
    [SOUND_FILE, 'music:theme', 'music'], [SOUND_FILE, 'music:boss', 'music'], [SOUND_FILE, 'sfx', 'sfx'],
    ['packs/crate.ts', 'kc1:0', 'kc1'], ['packs/crate.ts', 'kc1:1', 'kc1'],
    ['builds/main.build.json', 'ops', 'ops'], ['data/level.b64', 'document', 'document'],
  ]);
  assert.match(records[0].label, /Main theme · music recipe/); assert.match(records[1].label, /boss · song/); assert.match(records[5].label, /2 ops/);
  assert.deepEqual([...recordBytes(project, SOUND_FILE, 'music:theme').bytes], [...DOC]);
  assert.deepEqual([...recordBytes(project, SOUND_FILE, 'sfx').bytes], [...DOC]);
  assert.deepEqual([...recordBytes(project, 'packs/crate.ts', 'kc1:1').bytes], [...DOC.slice(0, 5)]);
  assert.deepEqual(recordBytes(project, 'builds/main.build.json', 'ops').ops.map((o) => o.op), ['new', 'box']);
  assert.deepEqual([...recordBytes(project, 'data/level.b64', 'document').bytes], [...DOC]);
  const fileId = project.files.find((f) => f.name === 'packs/crate.ts').id;
  assert.deepEqual([...recordBytes(project, fileId, 'kc1:0').bytes], [...DOC], 'a file by its id');
  assert.throws(() => recordBytes(project, 'missing.txt', 'document'), /no saved file missing\.txt/);
  assert.throws(() => recordBytes(project, SOUND_FILE, 'music:nope'), /has no music:nope/);
  assert.throws(() => recordBytes(project, 'packs/crate.ts', 'kc1:9'), /no KC1 record #10/);
  assert.deepEqual(codecSourcesOf({ files: [{ name: SOUND_FILE, content: 'not json' }] }), []);
});

engineTest('documents explained: spans tile the buffer, sizes, schemas by header, by name and through a manifest', async () => {
  const codec = new GameCodecService({ workerPath, root: found.root });
  try {
    const listed = await codec.schemas();
    const by = (name) => listed.schemas.find((s) => s.name === name);
    assert.equal(by('keel/audio/sfx').source, 'engine'); assert.equal(by('keel/population/hybrid').source, 'engine');
    assert.equal(by('keel/level').source, 'keel/level'); assert.equal(by('keel/builder/ops').source, 'keel/builder'); assert.equal(by('keel/builder/data').source, 'keel/builder');
    assert.equal(by('keel/ui/theme').source, 'keel/ui', 'a schema only a workspace manifest declares');
    assert.ok(listed.modules.some((m) => m.id === 'keel/ui' && m.schemas.includes('keel/ui/theme@1')));
    assert.deepEqual(listed.problems, []);

    const sfx = await codec.sample('sfx');
    const x = await codec.explain({ text: sfx.bytes });
    assert.equal(x.schema.name, 'keel/audio/sfx'); assert.equal(x.schema.resolved, 'registry'); assert.equal(x.header.mode, 'id'); assert.equal(x.header.bytes, 5);
    assert.equal(x.bytes, sfx.byteLength); assert.equal(x.totalBits, sfx.byteLength * 8); assert.equal(x.check, null);
    // (Every leaf range in bit order, no gaps, no overlaps: the header, the values and overheads, the padding, the text.)
    let at = 0;
    for (const s of x.spans) { assert.equal(s.bit, at, `a span starts where the last ended (${s.path})`); at += s.bits; }
    assert.equal(at, x.totalBits); assert.equal(x.spansTruncated, false);
    assert.ok(x.spans.some((s) => s.role === 'text') && x.spans.some((s) => s.role === 'header') && x.spans.some((s) => s.role === 'overhead'));
    assert.deepEqual([...Buffer.from(x.hex, 'base64')], [...Buffer.from(sfx.bytes, 'base64url')]);
    assert.equal(x.sizes.bytes, sfx.byteLength); assert.ok(x.sizes.gzip > 0);
    assert.equal(x.sizes.json, Buffer.byteLength(JSON.stringify(JSON.parse(x.json))));
    assert.ok(x.sizes.jsonGz > 0 && x.sizes.json > x.sizes.bytes, 'the codec beats its JSON');
    assert.equal(x.costs[0].path, '#header'); assert.ok(x.costs.length <= 24);
    assert.equal(x.tree.kind, 'named'); assert.ok(x.tree.children.some((c) => c.label === 'sounds'));
    assert.equal(x.schemaTree.kind, 'named'); assert.equal(x.schemaTree.name, 'keel/audio/sfx');
    assert.equal(x.solidity.available, false); assert.match(x.solidity.reason, /open struct/);
    assert.equal(JSON.parse(x.json).sounds.jump.gain, 1.2);

    // A bare body needs its schema: here named without a version (its newest), then by short id.
    const bare = await codec.reencode({ schema: x.schema.id, json: x.json, header: 'none' });
    assert.equal(bare.ok, true); assert.equal(bare.bytes, sfx.byteLength - 5);
    await assert.rejects(() => codec.explain({ text: bare.base64url }), /bare body, so say which schema/);
    const named = await codec.explain({ text: bare.base64url, schema: 'keel/audio/sfx' });
    assert.equal(named.schema.resolved, 'given'); assert.equal(named.header.mode, 'none'); assert.equal(named.json, x.json);
    assert.equal((await codec.explain({ text: bare.base64url, schema: x.schema.short })).schema.id, x.schema.id);
    await assert.rejects(() => codec.explain({ text: bare.base64url, schema: 'keel/nope@1' }), /No schema keel\/nope@1/);

    // A schema declared only in keel/ui's manifest (packages/ui/src/schemas.ts): a document naming it resolves.
    const engine = await import(pathToFileURL(path.join(found.root, 'packages/codec/src/index.ts')).href);
    const ui = await import(pathToFileURL(path.join(found.root, 'packages/ui/src/schemas.ts')).href);
    const theme = engine.encode(ui.UI_THEME, { generator: 'keel/ui', seed: '7', culture: 'arcane', pins: { hue: 210, radius: 2 } });
    const tx = await codec.explain({ text: Buffer.from(theme).toString('base64') });
    assert.equal(tx.schema.name, 'keel/ui/theme'); assert.equal(tx.schema.source, 'keel/ui'); assert.equal(tx.schema.resolved, 'registry');
    assert.equal(JSON.parse(tx.json).culture, 'arcane');

    // Every sample reads cleanly; the big ones compact their tree.
    for (const kind of ['recipe', 'song', 'voxels', 'ops', 'level', 'tile']) {
      const s = await codec.sample(kind);
      const e = await codec.explain({ text: s.text ?? s.bytes, maxNodes: 60 });
      assert.equal(e.check, null, kind); assert.ok(e.nodes <= 60, `${kind}: ${e.nodes} nodes`);
    }
    const level = await codec.explain({ text: (await codec.sample('level')).bytes, maxNodes: 40 });
    const markers = [], folded = []; const walk = (n) => { if (n.kind === 'more') markers.push(n); else if (n.more) folded.push(n); (n.children ?? []).forEach(walk); }; walk(level.tree);
    assert.ok(markers.length || folded.length, 'the rest is marked');
    assert.ok(markers.every((m) => m.more > 0 && /more$/.test(m.label) && m.bits > 0), 'a "… N more" marker stands for the rest, with its bit range');
    assert.ok(folded.every((n) => /parts not listed/.test(n.note)), 'a node with no room left says how many parts are not listed');
    const voxels = await codec.sample('voxels');
    assert.match(voxels.text, /^KC1:/); assert.equal((await codec.explain({ text: voxels.text })).schema.name, 'keel/builder/voxels');
  } finally { codec.close(); }
});

engineTest('the JSON view re-encodes to canonical bytes; an invalid edit names its field; Solidity for a fixed layout', async () => {
  const codec = new GameCodecService({ workerPath, root: found.root });
  try {
    const sfx = await codec.sample('sfx');
    const x = await codec.explain({ text: sfx.bytes });
    const same = await codec.reencode({ schema: x.schema.id, json: x.json, header: x.header.mode });
    assert.equal(same.ok, true); assert.equal(same.base64url, sfx.bytes, 'the unchanged JSON view is the same bytes');
    // (Key order and spacing are free in the JSON; the bytes are canonical.)
    const shuffled = Object.fromEntries(Object.entries(JSON.parse(x.json)).reverse());
    assert.equal((await codec.reencode({ schema: x.schema.id, json: JSON.stringify(shuffled), header: 'id' })).base64url, sfx.bytes);
    const edited = JSON.parse(x.json); edited.sounds.jump.gain = 0.35; edited.sounds.step = { gain: 0.5 };
    const r = await codec.reencode({ schema: x.schema.id, json: JSON.stringify(edited), header: 'id' });
    assert.equal(r.ok, true); assert.notEqual(r.base64url, sfx.bytes); assert.ok(r.bytes > sfx.byteLength, 'a new sound costs bits');
    assert.equal(r.base64, Buffer.from(r.base64url, 'base64url').toString('base64'));
    assert.equal(r.explain.bytes, r.bytes); assert.equal(r.explain.sizes.bytes, r.bytes);
    assert.deepEqual(JSON.parse(r.explain.json).sounds.step, { gain: 0.5 });
    const again = await codec.reencode({ schema: x.schema.id, json: r.explain.json, header: 'id' });
    assert.equal(again.base64url, r.base64url, 'its own JSON view gives the same bytes back');
    // Invalid: the field path and why.
    edited.sounds.jump.gain = 'loud';
    const bad = await codec.reencode({ schema: x.schema.id, json: JSON.stringify(edited), header: 'id' });
    assert.equal(bad.ok, false); assert.equal(bad.path, 'sounds.jump.gain'); assert.match(bad.error, /"loud" is not a number/);
    const notJson = await codec.reencode({ schema: x.schema.id, json: '{"seed": 7,', header: 'id' });
    assert.equal(notJson.ok, false); assert.equal(notJson.path, null); assert.match(notJson.error, /isn't JSON/);
    const wrongShape = await codec.reencode({ schema: x.schema.id, json: JSON.stringify({ ...JSON.parse(x.json), body: { wind: 'yes' } }), header: 'id' });
    assert.equal(wrongShape.ok, false); assert.equal(wrongShape.path, 'body.wind'); assert.match(wrongShape.error, /"yes"/);
    // Solidity: a fixed layout the document carries (header "self"); the sfx schema is refused, naming why.
    const tile = await codec.sample('tile');
    const t = await codec.explain({ text: tile.bytes });
    assert.equal(t.header.mode, 'self'); assert.equal(t.schema.resolved, 'document'); assert.equal(t.schema.name, 'keel/codec/sample-tile'); assert.equal(t.solidity.available, true);
    assert.deepEqual(JSON.parse(t.json), { x: 37, y: 512, kind: 'rock', height: 3.4, solid: true, tint: -12 });
    const sol = await codec.solidity(t.schema.id, 'TileCodec');
    assert.equal(sol.ok, true); assert.match(sol.code, /library TileCodec/); assert.match(sol.code, /enum Kind \{ grass, rock, water, sand \}/); assert.match(sol.code, new RegExp(`SCHEMA_ID = 0x${t.schema.short}`));
    const tileEdit = await codec.reencode({ schema: t.schema.id, json: JSON.stringify({ ...JSON.parse(t.json), x: 1023 }), header: 'self' });
    assert.equal(tileEdit.ok, true); assert.equal(tileEdit.explain.header.mode, 'self'); assert.equal(tileEdit.bytes, tile.byteLength);
    assert.equal((await codec.reencode({ schema: t.schema.id, json: JSON.stringify({ ...JSON.parse(t.json), x: 1024 }), header: 'self' })).path, 'x');
    const refused = await codec.solidity(x.schema.id);
    assert.equal(refused.ok, false); assert.match(refused.reason, /open struct has no fixed layout/);
  } finally { codec.close(); }
});

engineTest('a saved project\'s records, a Files object, and the assistant\'s tool under its limit', async () => {
  const workspace = new WorkspaceStore(':memory:');
  const codec = new GameCodecService({ workerPath, root: found.root });
  try {
    const [recipe, sfx, voxels] = await Promise.all(['recipe', 'sfx', 'voxels'].map((kind) => codec.sample(kind)));
    let project = newTemplateProject('Codec yard', 'game');
    project = withFile(project, SOUND_FILE, JSON.stringify({ format: SOUND_FORMAT, music: [{ id: 'theme', title: 'Theme', kind: 'recipe', bytes: recipe.bytes }], assign: [], sfx: sfx.bytes }));
    project = withPackFiles(project, [{ name: 'packs/crate.ts', content: `const VOXELS = ${JSON.stringify(voxels.text)};\nexport default VOXELS;\n` }]);
    project = withBuildFile(project, 'main', [{ op: 'new', name: 'hut', unit: 0.12 }, { op: 'box', from: [0, 0, -4], to: [5, 6, 4], role: 'primary', hollow: true }, { op: 'target', as: 'object', id: 'hut' }]);
    workspace.save({ ...workspace.read().state, projects: [project] }, 0);
    const music = await codec.explain({ projectId: project.id, file: SOUND_FILE, record: 'music:theme' }, { store: workspace });
    assert.equal(music.schema.name, 'keel/audio/recipe'); assert.equal(music.source.label, `${SOUND_FILE} · music:theme`);
    assert.equal((await codec.explain({ projectId: project.id, file: SOUND_FILE, record: 'sfx' }, { store: workspace })).schema.name, 'keel/audio/sfx');
    const kc1 = await codec.explain({ projectId: project.id, file: 'packs/crate.ts', record: 'kc1:0' }, { store: workspace });
    assert.equal(kc1.schema.name, 'keel/builder/voxels');
    const ops = await codec.explain({ projectId: project.id, file: 'builds/main.build.json', record: 'ops' }, { store: workspace });
    assert.equal(ops.schema.name, 'keel/builder/ops'); assert.equal(ops.source.ops, 3); assert.equal(ops.source.format, 'ops');
    assert.deepEqual(JSON.parse(ops.json).map((o) => o.op), ['new', 'box', 'target']);
    await assert.rejects(() => codec.explain({ projectId: project.id, file: 'nope.json', record: 'document' }, { store: workspace }), /no saved file nope\.json/);
    // A Files object (content-addressed, verified before it's read).
    const imported = workspace.importObject(Buffer.from(sfx.bytes, 'base64url'), 'sfx.bin', 'application/octet-stream', workspace.read().revision);
    const object = imported.state.objects.at(-1);
    const file = await codec.explain({ objectId: object.id }, { store: workspace });
    assert.equal(file.schema.name, 'keel/audio/sfx'); assert.equal(file.source.label, 'sfx.bin');
    await assert.rejects(() => codec.resolve({ text: 'aa', objectId: object.id }, { store: workspace }), /one thing at a time/);

    // The assistant's tool: records listed, a big document compact enough, Solidity or its refusal.
    const hooks = { workRoot: '/tmp/keel-agent-test-codec', view: () => ({ page: 'Projects' }), networks: () => [], wallets: () => [], readKey: () => { throw Error('Tests do not use credentials.'); }, gameCodec: codec };
    const chats = new AgentStore(workspace.db); const chat = chats.create({ projectId: project.id }); const run = chats.begin(chat.id, 'What is in my sound file?', null);
    const tools = createAgentTools({ workspace, chats, chat, run, hooks, signal: new AbortController().signal, emit: () => {} });
    const tool = tools.find((item) => item.name === 'keel_game_codec_explain');
    assert.ok(tool, 'the codec tool is registered (read-only, workspace access)');
    const call = async (input) => { const text = await tool.invoke(input); assert.ok(text.length < 90_000, `${text.length} characters`); return JSON.parse(text); };
    const listing = await call({});
    assert.deepEqual(listing.records.map((r) => r.record), ['music:theme', 'sfx', 'kc1:0', 'ops']);
    const explained = await call({ file: SOUND_FILE, record: 'music:theme', solidity: true });
    assert.equal(explained.schema.name, 'keel/audio/recipe'); assert.equal(explained.solidity.available, false); assert.ok(explained.solidity.reason);
    assert.ok(explained.tree[0].startsWith('(root) : keel/audio/recipe@1'), explained.tree[0]); assert.ok(explained.costs.length > 0);
    assert.equal(JSON.parse(explained.json.text).from, 'mood');
    const big = await call({ text: (await codec.sample('level')).bytes, maxNodes: 2000 });
    assert.equal(big.schema.name, 'keel/level'); assert.ok(big.json.truncated, 'the level\'s JSON view is cut, and says so'); assert.ok(big.json.text.length <= 12_000);
    const tile = await call({ text: (await codec.sample('tile')).bytes, solidity: true });
    assert.equal(tile.solidity.available, true); assert.match(tile.solidity.code.text, /library SampleTileCodec/);
    await assert.rejects(() => tool.invoke({ text: 'aa', file: SOUND_FILE }), /one thing at a time/);
  } finally { codec.close(); workspace.close(); }
});
