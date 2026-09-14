// The alpha-tester pieces for games, without a chain or an engine: game
// projects from templates (ids, packs, links), Builder exports into a game's
// pack, where the engine is found (checkout, env, the pinned release), the
// practice chain's status when it isn't running, the publication plan's
// transaction order, and diagnostics that keep secrets and home paths out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_TEMPLATES, createGameProject, gameFolderOf, slugOf, syncBuilderAssets } from '../../../packages/game-engine/scripts/new-game.mjs';
import { findGameEngineRoot } from '../src/game-engine/game-engine-service.mjs';
import { LogRing, alphaPaths, diagnosticsText, engineLockOf, practiceChain } from '../src/game-engine/alpha-service.mjs';
import { shareOf, transactionsFor, planTotals, missingShared, shareLinks } from '../../../packages/game-engine/chain/publication.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sdkRoot = path.resolve(here, '../../..');

test('every template makes a game project of its own: ids, pack, manifest title and engine link', () => {
  const gamesDir = mkdtempSync(path.join(tmpdir(), 'keel-games-'));
  assert.deepEqual(GAME_TEMPLATES.map((t) => t.id), ['blank', 'top-down', 'level', 'dungeon', 'character']);
  for (const template of GAME_TEMPLATES) {
    const made = createGameProject({ sdkRoot, gamesDir, template: template.id, name: `My ${template.title}!` });
    assert.equal(made.slug, slugOf(`My ${template.title}!`));
    assert.equal(made.gameId, `mygames/${made.slug}`);
    const manifest = readFileSync(path.join(made.dir, 'game', 'src', 'module.ts'), 'utf8');
    assert.match(manifest, new RegExp(`id: "${made.gameId}"`), template.id);
    assert.doesNotMatch(manifest, /examples\//, `${template.id} kept an example id`);
    assert.match(manifest, new RegExp(`title: "My ${template.title}!"`.replace(/[()/]/g, '\\$&')));
    assert.match(readFileSync(path.join(made.dir, 'game', 'package.json'), 'utf8'), new RegExp(`"@mygames/${made.slug}"`));
    if (template.pack) {
      assert.equal(made.packId, `mygames/${made.slug}-pack`);
      assert.match(manifest, new RegExp(`"${made.packId}@\\^0\\.1"`), 'the game needs its own pack');
      assert.match(readFileSync(path.join(made.dir, 'pack', 'src', 'module.ts'), 'utf8'), new RegExp(`id: "${made.packId}"`));
    } else assert.equal(existsSync(path.join(made.dir, 'pack')), false);
    assert.deepEqual(gameFolderOf({ gamesDir, gameId: made.gameId }).record.gameId, made.gameId);
    assert.equal(existsSync(path.join(made.dir, 'game', 'out')), false, 'build output is not copied');
  }
  // (A second game with the same name gets its own folder and ids.)
  const again = createGameProject({ sdkRoot, gamesDir, template: 'blank', name: 'My Blank!' });
  assert.equal(again.gameId, 'mygames/my-blank-2');
  const link = path.join(gamesDir, 'node_modules', '@keel', 'game-engine');
  assert.ok(lstatSync(link).isSymbolicLink()); assert.equal(readlinkSync(link), path.join(sdkRoot, 'packages', 'game-engine'));
  assert.throws(() => createGameProject({ sdkRoot, gamesDir, template: 'nope', name: 'x' }), /No game template nope/);
  assert.equal(gameFolderOf({ gamesDir, gameId: 'examples/hello' }), null);
});

test('Builder exports go into the game pack, and the pack list follows the project', () => {
  const gamesDir = mkdtempSync(path.join(tmpdir(), 'keel-games-'));
  const made = createGameProject({ sdkRoot, gamesDir, template: 'blank', name: 'Pack test' });
  const hat = 'import { defineAttribute } from "@keel-engine/runtime";\nimport { loadVoxels, voxelAttribute } from "@keel-engine/builder";\nexport default defineAttribute({ id: "hat" } as never);\n';
  const crate = 'export default { type: "object", id: "crate" };\n';
  assert.deepEqual(syncBuilderAssets({ dir: made.dir, files: [{ name: 'packs/hat.ts', content: hat }, { name: 'packs/crate.ts', content: crate }, { name: 'index.html', content: '' }, { name: 'builds/main.build.json', content: '{}' }] }), ['crate', 'hat']);
  const assets = path.join(made.dir, 'pack', 'src', 'assets');
  assert.equal(readFileSync(path.join(assets, 'hat.ts'), 'utf8'), hat);
  const index = readFileSync(path.join(assets, 'index.ts'), 'utf8');
  assert.match(index, /import a0 from "\.\/crate\.ts";/); assert.match(index, /import a1 from "\.\/hat\.ts";/); assert.match(index, /usesBuilder = true;/);
  // (A file the project dropped leaves the pack; without Builder imports the pack stops needing keel/builder.)
  assert.deepEqual(syncBuilderAssets({ dir: made.dir, files: [{ name: 'packs/crate.ts', content: crate }] }), ['crate']);
  assert.equal(existsSync(path.join(assets, 'hat.ts')), false);
  assert.match(readFileSync(path.join(assets, 'index.ts'), 'utf8'), /usesBuilder = false;/);
  const top = createGameProject({ sdkRoot, gamesDir, template: 'top-down', name: 'No pack' });
  assert.deepEqual(syncBuilderAssets({ dir: top.dir, files: [{ name: 'packs/crate.ts', content: crate }] }), [], 'a template without a pack takes no assets');
});

test('the engine is found in a checkout, else the pinned release; the source says which', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'keel-engines-'));
  const engine = (name) => { const root = path.join(dir, name); mkdirSync(path.join(root, 'packages', 'keel', 'src'), { recursive: true }); writeFileSync(path.join(root, 'packages', 'keel', 'src', 'index.ts'), ''); return root; };
  const checkout = engine('checkout'); const release = engine('release');
  const before = process.env.KEEL_GAME_ENGINE_ROOT;
  try {
    delete process.env.KEEL_GAME_ENGINE_ROOT;
    assert.deepEqual(findGameEngineRoot([checkout], [release]).source, 'checkout');
    assert.deepEqual(findGameEngineRoot([path.join(dir, 'missing')], [release]), { root: release, searched: [path.join(dir, 'missing'), release], fromEnv: false, source: 'release' });
    process.env.KEEL_GAME_ENGINE_ROOT = checkout;
    assert.equal(findGameEngineRoot([release]).source, 'env');
    // (An env var pointing nowhere falls back to the pinned release -- the alpha tester's case.)
    process.env.KEEL_GAME_ENGINE_ROOT = path.join(dir, 'nowhere');
    assert.equal(findGameEngineRoot([checkout], [release]).root, release);
    assert.equal(findGameEngineRoot([checkout], [null]).root, null);
  } finally { if (before === undefined) delete process.env.KEEL_GAME_ENGINE_ROOT; else process.env.KEEL_GAME_ENGINE_ROOT = before; }
  const lock = engineLockOf(alphaPaths({ sdkRoot, userData: dir }));
  assert.equal(lock.repository, 'https://github.com/keel-web3/keel-engine'); assert.ok(Array.isArray(lock.onchain));
  assert.equal(lock.dir, lock.commit ? path.join(sdkRoot, 'packages', 'game-engine', '.engine', lock.commit) : null);
});

test('the practice chain says how to start it when it is not running', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'keel-sandbox-'));
  const paths = { ...alphaPaths({ sdkRoot, userData: dir }), sandboxDir: dir };
  const none = await practiceChain(paths);
  assert.equal(none.running, false); assert.match(none.reason, /pnpm game:sandbox/);
  writeFileSync(path.join(dir, 'deployment.json'), JSON.stringify({ chainId: 31337, rpc: 'http://127.0.0.1:9', KeelHold: `0x${'1'.repeat(40)}`, KeelRawTokenURIBuilder: `0x${'2'.repeat(40)}` }));
  const stopped = await practiceChain(paths);
  assert.equal(stopped.running, false); assert.match(stopped.reason, /isn't running/); assert.equal(stopped.KeelHold, `0x${'1'.repeat(40)}`);
});

test('a publication writes chunks first, then welds, then the root; shared parts only when asked', () => {
  const hold = `0x${'a'.repeat(40)}`;
  const chunk = (n) => ({ id: `0x${String(n).padStart(64, '0')}`, bytes: new Uint8Array([n]) });
  const part = (share, role, moduleId, chunks) => ({ share, role, moduleId, version: '1.0.0', byteLength: chunks.length, digest: '0x', objectId: `0x${role}${moduleId ?? ''}`, chunks, operations: [{ target: hold, value: 0n, data: `0xweld${role}` }] });
  const parts = [part('shell', 'shell-prefix', undefined, [chunk(1)]), part('engine', 'module', 'keel/core', [chunk(2), chunk(3), chunk(4), chunk(5)]), part('game', 'module', 'mygames/x', [chunk(6)]), part('game', 'entrypoint', undefined, [chunk(7)]), part('shell', 'shell-suffix', undefined, [chunk(8)])];
  const plan = { hold, gameId: 'mygames/x', parts, root: { operation: { data: '0xroot' } } };
  const missing = { parts: parts.map((p) => ({ part: p, exists: p.share === 'shell', chunks: p.chunks })), rootExists: false };
  assert.equal(shareOf({ role: 'shell-prefix' }, new Set()), 'shell');
  assert.equal(shareOf({ role: 'module', moduleId: 'keel/core' }, new Set(['keel/core'])), 'engine');
  assert.equal(shareOf({ role: 'module', moduleId: 'mygames/x' }, new Set(['keel/core'])), 'game');
  assert.deepEqual(missingShared(missing).map((p) => p.moduleId), ['keel/core']);
  const own = transactionsFor({ plan, missing, shares: ['game'] });
  assert.deepEqual(own.map((t) => t.kind), ['cast', 'cast', 'weld', 'weld', 'root']);
  const all = transactionsFor({ plan, missing });
  assert.deepEqual(all.map((t) => t.kind), ['cast', 'cast', 'cast', 'cast', 'weld', 'weld', 'weld', 'root'], 'four engine chunks are two casts of at most three');
  assert.equal(all[0].chunks, 3); assert.equal(all[1].chunks, 1);
  assert.deepEqual(planTotals(plan, ['game']), { parts: 2, bytes: 2, chunks: 2, welds: 2 });
  const links = shareLinks({ chainId: 31337, hold, rootId: `0x${'b'.repeat(64)}`, digest: `0x${'c'.repeat(64)}`, viewer: 'http://127.0.0.1:8646/' });
  assert.equal(links.viewer, `http://127.0.0.1:8646/game/31337/0x${'b'.repeat(64)}?digest=0x${'c'.repeat(64)}`);
  assert.equal(links.web3, `web3://${hold}:31337/haulObject/0x${'b'.repeat(64)}`);
});

test('diagnostics are text for the tester to paste, with keys and long hex shortened', () => {
  const logs = new LogRing(3);
  logs.push('error', ['failed with sk-abcdefgh1234567890 and', `0x${'f'.repeat(64)}`]);
  for (let i = 0; i < 4; i++) logs.push('log', [`line ${i}`]);
  assert.equal(logs.recent().length, 3); assert.doesNotMatch(logs.recent().join('\n'), /sk-abcdefgh1234/);
  const ring = new LogRing(); ring.push('error', ['publish failed: sk-abcdefgh1234567890', `0x${'e'.repeat(64)}`]);
  assert.match(ring.recent()[0], /sk-abcdefgh… 0xeeeeeeee…/);
  const text = diagnosticsText({ versions: { editor: '0.1.0' }, engine: { source: 'release' }, practice: { running: 'false' }, log: ring.recent() });
  assert.match(text, /^# KEEL editor diagnostics/); assert.match(text, /## versions\neditor: 0\.1\.0/); assert.match(text, /## game engine\nsource: release/); assert.match(text, /## recent log\n.*publish failed/);
});
