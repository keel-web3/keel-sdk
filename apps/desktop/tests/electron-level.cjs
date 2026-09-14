// Level acceptance in a disposable workspace, against the local KEEL engine: a
// Game project's Level tab generates a mixed map (overworld, cave, WFC town,
// crypt, desert re-skin) into the sandboxed preview (the engine's ground baker
// and sprites), shows the seed strip and takes a variation, paints biome,
// raises ground, draws a road and a lock region with pointer strokes inside
// the frame (every one a level op: undo and redo), regenerates under the lock,
// shows the crypt's room graph, imports a tileset atlas from Files and applies
// its autotile, saves levels/<name>.level (codec records) and opens the LEVEL
// record in the codec inspector -- and the assistant (a keyless fixture
// driving the real agent tools) sets up a camp whose ops stream into the open
// preview, then a removal waits on a review card. Screenshots go to
// artifacts/level-*. Needs a keel-engine checkout (skips with a clear message
// otherwise).
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const assert = require('node:assert/strict'); const zlib = require('node:zlib');
process.env.KEEL_DESKTOP_TEST_HIDDEN = '1';
BrowserWindow.prototype.show = function() {}; BrowserWindow.prototype.focus = function() {};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, tries = 400) { for (let i = 0; i < tries; i++) { try { if (await fn()) return; } catch { /* Frames come and go. */ } await wait(75); } throw Error(label); }
const timeout = setTimeout(() => { console.error('Level acceptance timed out'); app.exit(1); }, 540000);
const engineRoot = process.env.KEEL_GAME_ENGINE_ROOT || path.resolve(__dirname, '../../../../keel-engine');

function buildNative() {
  return require('node:child_process').execFileSync(process.execPath, [path.join(__dirname, 'level-native.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }).trim().split('\n').at(-1);
}
/** A blob-47 atlas (8 x 6 tiles of 8 px): a grass tile with a dark rim where the mask says "edge", so the autotile shows. */
function atlasPng(file) {
  const T = 8, W = 64, H = 48, raw = Buffer.alloc((W * 4 + 1) * H);
  const BLOB = [0, 1, 4, 5, 7, 16, 17, 20, 21, 23, 28, 29, 31, 64, 65, 68, 69, 71, 80, 81, 84, 85, 87, 92, 93, 95, 112, 113, 116, 117, 119, 124, 125, 127, 193, 197, 199, 209, 213, 215, 221, 223, 241, 245, 247, 253, 255];
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const idx = Math.floor(y / T) * 8 + Math.floor(x / T), m = BLOB[idx] ?? 255, u = x % T, v = y % T;
    const edge = (!(m & 1) && v === 0) || (!(m & 4) && u === T - 1) || (!(m & 16) && v === T - 1) || (!(m & 64) && u === 0);
    const o = y * (W * 4 + 1) + 1 + x * 4, speck = (u * 3 + v * 5) % 7 === 0;
    raw[o] = edge ? 38 : speck ? 150 : 96; raw[o + 1] = edge ? 58 : speck ? 190 : 156; raw[o + 2] = edge ? 30 : 64; raw[o + 3] = 255;
  }
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; };
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length); out.write(type, 4); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

(async () => {
  if (!fs.existsSync(path.join(engineRoot, 'packages', 'worldgen', 'src', 'index.ts'))) { console.log(JSON.stringify({ status: 'skipped', reason: `No keel-engine checkout with worldgen at ${engineRoot}. Set KEEL_GAME_ENGINE_ROOT.` })); clearTimeout(timeout); app.exit(0); return; }
  process.env.KEEL_GAME_ENGINE_ROOT = engineRoot;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-level-ui-'));
  process.env.KEEL_DESKTOP_DATA_DIR = directory;
  const atlas = path.join(directory, 'meadow-blob47.png'); atlasPng(atlas);
  require(buildNative()); await app.whenReady();
  await until(() => BrowserWindow.getAllWindows().length, 'Editor did not start');
  const window = BrowserWindow.getAllWindows()[0]; window.setSize(1600, 1000); window.webContents.setBackgroundThrottling(false);
  const errors = []; window.webContents.on('console-message', e => { if (e.level === 'error' && !e.message.includes('Electron Security Warning')) errors.push(e.message); });
  const run = source => window.webContents.executeJavaScript(source, true);
  const request = (name, input) => run(`window.keel.request(${JSON.stringify(name)},${JSON.stringify(input)})`);
  const idle = () => until(() => run('document.querySelector(".main-panel")?.getAttribute("aria-busy")==="false"'), 'UI stayed busy', 1200);
  const click = async (label, scope = 'document') => { await idle(); await until(() => run(`[...${scope}.querySelectorAll('button')].some(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled)`), `Button not ready: ${label}`); await run(`[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled).click()`); };
  const clickLabel = async label => { await idle(); await until(() => run(`!!document.querySelector('[aria-label=${JSON.stringify(label)}]:not([disabled])')`), `Control not ready: ${label}`); await run(`document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`); };
  const setValue = (selector, value) => run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const proto=e instanceof HTMLSelectElement?HTMLSelectElement:HTMLInputElement;Object.getOwnPropertyDescriptor(proto.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));return true;})()`);
  const stage = () => run('document.querySelector(".level-stage")?.scrollIntoView({block:"start"})');
  const snap = async (name, { atStage = false } = {}) => { if (atStage) await stage(); await wait(400); fs.writeFileSync(path.resolve(__dirname, `../artifacts/level-${name}.png`), (await window.webContents.capturePage()).toPNG()); };
  const current = async () => (await request('workspace')).state.projects.at(-1);
  const frame = () => window.webContents.mainFrame.framesInSubtree.find(f => f.url.startsWith('keel-preview://game-level'));
  const page = source => frame().executeJavaScript(source, true);
  const preview = () => page('(()=>{const s=globalThis.levelPreview;return {applied:s.applied,ready:s.ready,frames:s.frames,drawn:s.drawn,baked:s.baked,error:s.error,snap:s.lastSnap,k:s.k,finite:s.finite,stats:s.stats,tool:s.tool.tool};})()');
  const settle = async (label) => { await until(async () => { const p = await preview(); return p.ready && !p.error; }, `The preview did not settle (${label})`, 1200); const p = await preview(); assert.equal(p.error, null); return p; };
  const live = async (projectId) => (await request('gameLevelState', { projectId })).state;
  /** A pointer stroke inside the frame, tile to tile (a hidden test window doesn't route real mouse input into a sandboxed frame). */
  const stroke = (tiles, { button = 0 } = {}) => page(`(async()=>{const s=globalThis.levelPreview,v=document.getElementById("view");const pts=${JSON.stringify(tiles)}.map(([i,j])=>s.cssOfTile(i,j));const ev=(type,[x,y])=>v.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:7,bubbles:true,button:${button}}));ev("pointermove",pts[0]);ev("pointerdown",pts[0]);for(const p of pts.slice(1)){ev("pointermove",p);await new Promise(r=>setTimeout(r,30));}ev("pointerup",pts[pts.length-1]);return pts.length;})()`);
  const finished = async chatId => { await until(async () => { const h = await request('agentHistory', { id: chatId }); return h.runs.at(-1)?.status && h.runs.at(-1).status !== 'running'; }, 'The assistant did not finish', 1200); const h = await request('agentHistory', { id: chatId }); assert.equal(h.runs.at(-1).status, 'completed', h.runs.at(-1).error); return h.runs.at(-1); };

  // A Game project's Level tab: a new level from the mixed-map preset; the preview draws it.
  await until(() => run('document.querySelectorAll(".template-card").length>0'), 'Template launch missing');
  await run(`[...document.querySelectorAll('.template-card')].find(e=>e.querySelector('strong').textContent==='A game').click()`); await idle();
  await until(() => run('[...document.querySelectorAll(".tabs button")].some(e=>e.textContent==="Level")'), 'Level tab missing');
  await run('[...document.querySelectorAll(".tabs button")].find(e=>e.textContent==="Level").click()');
  await until(() => run('!!document.querySelector("input[aria-label=\'New level name\']")'), 'The level bar did not show');
  const project = await current();
  await setValue('input[aria-label="New level name"]', 'valley'); await setValue('select[aria-label="Level preset"]', 'mixed');
  await click('New level');
  await until(() => frame() && page('!!globalThis.levelPreview'), 'The level preview did not load', 1200);
  assert.equal(await page('typeof window.keel'), 'undefined', 'the level page has no editor bridge');
  await until(async () => (await preview()).applied >= 1, 'The preview never drew a snapshot', 1200);
  const first = await settle('generated');
  assert.equal(first.finite, true); assert.ok(first.baked >= 4, `chunks baked (${first.baked})`); assert.ok(first.drawn > 50, `sprites drawn (${first.drawn})`);
  await until(() => run('document.querySelectorAll(".level-stage-card").length===5'), 'The recipe\'s five stages did not show');
  let state = await live(project.id);
  assert.deepEqual(state.size, [160, 120]); assert.equal(state.dungeons.length, 1);
  await snap('generated', { atStage: true });

  // The seed strip: six variations as pixel-art thumbnails; one taken.
  await click('Six variations');
  await until(() => run('document.querySelectorAll(".level-strip img").length===6'), 'The seed strip did not fill', 1200);
  await run('document.querySelector(".level-strip").scrollIntoView({block:"center"})'); await snap('variations');
  await run('document.querySelectorAll(".level-variation")[1].click()');
  await until(async () => (await live(project.id)).recipe.seed === 'mixed-1.2', 'The variation\'s seed was not taken', 800);
  await until(async () => (await preview()).snap.includes(`#${(await live(project.id)).gen}.`), 'The preview did not take the regenerated level', 800);
  await settle('variation');

  // Paint with pointer strokes inside the frame: biome, raise, a road, a lock region; each a level op.
  await page('globalThis.levelPreview.setScale(4)');
  const centre = [110, 88];
  await page(`(()=>{const s=globalThis.levelPreview;s.center=[${centre[0] * 2},0,${centre[1] * 2}];return true;})()`);
  await click('Biome'); await setValue('select[aria-label="Brush biome"]', 'corruption'); await setValue('input[aria-label="Brush size"]', 4);
  await until(async () => (await preview()).tool === 'biome', 'The biome tool did not reach the frame');
  const before = await live(project.id);
  await stroke([[100, 84], [104, 85], [108, 86], [112, 87]]);
  await until(async () => (await live(project.id)).counts.edits > before.counts.edits, 'The biome stroke did not land', 400);
  await click('Raise'); await setValue('input[aria-label="Brush size"]', 3);
  await until(async () => (await preview()).tool === 'raise', 'The raise tool did not reach the frame');
  await stroke([[118, 92]]);
  await click('Road');
  await until(async () => (await preview()).tool === 'road', 'The road tool did not reach the frame');
  await stroke([[96, 96], [100, 96], [104, 97], [108, 98], [114, 98]]);
  await until(async () => (await live(project.id)).counts.roads >= before.counts.roads + 1, 'The road did not land', 400);
  await click('Lock');
  await until(async () => (await preview()).tool === 'lock', 'The lock tool did not reach the frame');
  await stroke([[98, 80], [106, 86], [116, 94]]);
  await until(async () => (await live(project.id)).counts.locks === 1, 'The lock region did not land', 400);
  state = await live(project.id);
  const edits = state.counts.edits;
  assert.ok(edits >= 4, `hand edits ${edits}`);
  const lockRect = state.locks[0].rect;
  assert.ok([98, 80, 117, 95].every((v, n) => Math.abs(v - lockRect[n]) <= 1), `the lock region follows the drag (${lockRect})`);
  await until(async () => (await preview()).snap.endsWith(`.${state.version}`), 'The preview did not draw the edits', 400);
  await settle('painted');
  await snap('painted', { atStage: true });
  // Undo the lock, redo it (history in the tab).
  await clickLabel('Undo');
  try { await until(async () => (await live(project.id)).counts.locks === 0, 'Undo did not take the lock back'); } catch (e) { const st = await live(project.id); console.error(JSON.stringify({ did: st.did, history: st.history, counts: st.counts, msg: await run('document.querySelector(".builder-message")?.innerText') })); throw e; }
  await clickLabel('Redo');
  await until(async () => (await live(project.id)).counts.locks === 1, 'Redo did not bring the lock back');
  // Regenerate (a reroll) under the lock: the region keeps its tiles, the edits replay.
  const locked = await request('gameLevelState', { projectId: project.id });
  await click('Reroll');
  await until(async () => (await live(project.id)).recipe.seed !== locked.state.recipe.seed, 'The reroll did not regenerate', 800);
  state = await live(project.id);
  assert.equal(state.counts.locks, 1); assert.ok(state.counts.edits >= edits, 'hand edits replayed'); assert.match(state.did.join(' '), /kept lock region lock-0/);
  await settle('regenerated');
  await snap('regenerated', { atStage: true });

  // Dungeon mode: the crypt's generator, its room graph with start / key / boss / exit.
  await until(() => run('!!document.querySelector("svg[aria-label=\'Room graph\']")'), 'The room graph did not show');
  const graph = await run('[...document.querySelectorAll("svg[aria-label=\'Room graph\'] text")].map(t=>t.textContent)');
  for (const k of ['start', 'boss', 'exit']) assert.ok(graph.includes(k), `the graph names ${k} (${graph})`);
  await setValue('select[aria-label="crypt generator"]', 'bsp');
  await until(async () => (await live(project.id)).dungeons[0]?.algorithm === 'bsp', 'The crypt did not regenerate as BSP', 800);
  await page(`(()=>{const s=globalThis.levelPreview;s.center=[76,0,58];return true;})()`); await page('globalThis.levelPreview.setScale(3)');
  await settle('dungeon');
  await snap('dungeon', { atStage: true });
  await page(`(()=>{const s=globalThis.levelPreview;s.center=[${centre[0] * 2},0,${centre[1] * 2}];return true;})()`); await page('globalThis.levelPreview.setScale(4)');

  // The assistant sets up a camp: its ops stream into the open preview (several snapshots land), live.
  const chat = await request('createAgentChat', { projectId: project.id, title: 'Level', provider: 'codex', allowEdits: true });
  const appliedBefore = (await preview()).applied;
  await request('startAgent', { id: chat.id, prompt: 'Set up the camp' });
  const reply = await finished(chat.id);
  assert.match(reply.reply, /Set up the camp: 11 ops, 2 spawns, 3 resources, the watchtower placed/);
  await until(async () => (await preview()).applied >= appliedBefore + 2, 'The assistant\'s ops did not stream into the preview', 800);
  state = await live(project.id);
  assert.ok(state.things.some((t) => t.id === 'watchtower')); assert.equal(state.spawns.length, 2);
  await until(() => run('document.querySelector("[aria-label=Fairness]")?.innerText.length>0'), 'The fairness readout did not show');
  await page(`(()=>{const s=globalThis.levelPreview;s.center=[${Math.round(160 * 0.62) * 2},0,${Math.round(120 * 0.7) * 2}];return true;})()`); await page('globalThis.levelPreview.setScale(6)');
  await settle('assistant');
  await snap('assistant', { atStage: true });

  // A tileset: the atlas imported into Files, cut as blob-47, its autotile demo, then used on the level.
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [atlas] });
  await run('[...document.querySelectorAll("details.builder-section summary")].find(s=>s.textContent.startsWith("Tileset")).parentElement.open=true');
  await click('Import…');
  await until(() => run('[...document.querySelectorAll("select[aria-label=\'Tileset atlas\'] option")].some(o=>o.textContent==="meadow-blob47.png")'), 'The atlas did not reach Files');
  await setValue('input[aria-label="Tileset tile size"]', 8); await setValue('input[aria-label="Tileset materials"]', 'grass@0,0');
  await click('Preview autotile');
  await until(() => run('!!document.querySelector(".level-tileset img")'), 'The autotile demo did not show', 800);
  await click('Use on this level');
  await until(async () => !!(await live(project.id)).tileset, 'The tileset was not set on the level', 800);
  await settle('tileset');
  await run('document.querySelector(".level-tileset").scrollIntoView({block:"center"})'); await snap('tileset');
  await snap('tileset-map', { atStage: true });

  // Save: levels/valley.level holds codec records; the records panel measures them; the inspector reads the LEVEL.
  await until(() => run('document.body.innerText.includes("Unsaved level changes")'), 'Unsaved badge missing');
  await click('Save level'); await idle();
  await until(async () => (await current()).files.some(f => f.name === 'levels/valley.level'), 'The level file was not saved');
  const file = JSON.parse((await current()).files.find(f => f.name === 'levels/valley.level').content);
  assert.equal(file.format, 'keel-game-level@1'); assert.equal(file.name, 'valley'); assert.match(file.recipe, /^s/); assert.match(file.level, /^s/); assert.ok(file.edits.length >= 12, `edits saved (${file.edits.length})`); assert.equal(file.tileset.objectId.length, 64);
  await until(() => run('document.body.innerText.includes("Level saved")'), 'Saved badge missing');
  await until(() => run('document.querySelector(".level-sizes")?.innerText.includes("LEVEL")'), 'The records panel did not measure the level', 800);
  const sizes = await run('document.querySelector(".level-sizes").innerText');
  assert.match(sizes, /as JSON/);
  await click('Inspect the LEVEL record');
  await until(() => run('!!document.querySelector("[role=dialog][aria-label=\'Codec inspector\']")'), 'The codec inspector did not open');
  await until(() => run('document.querySelector("[role=dialog][aria-label=\'Codec inspector\']").innerText.includes("keel/level")'), 'The inspector did not resolve the level schema', 800);
  await snap('inspector');
  await run('[...document.querySelectorAll("[role=dialog][aria-label=\'Codec inspector\'] button")].find(b=>/close/i.test(b.textContent+b.getAttribute("aria-label"))).click()');
  await click('Inspect the recipe');
  await until(() => run('document.querySelector("[role=dialog][aria-label=\'Codec inspector\']")?.innerText.includes("keel/worldgen/recipe")'), 'The inspector did not resolve the recipe schema', 800);
  await run('[...document.querySelectorAll("[role=dialog][aria-label=\'Codec inspector\'] button")].find(b=>/close/i.test(b.textContent+b.getAttribute("aria-label"))).click()');

  // A destructive change from the assistant: a review card; nothing changes until it is applied, then the tab reloads the saved level.
  await request('startAgent', { id: chat.id, prompt: 'Remove the watchtower' });
  const cardReply = await finished(chat.id);
  assert.match(cardReply.reply, /review card: removes watchtower/);
  assert.ok((await live(project.id)).things.some((t) => t.id === 'watchtower'), 'still there before the card');
  const pending = (await request('agentHistory', { id: chat.id })).runs.at(-1).actions.find(a => a.kind === 'project-edit' && a.status === 'pending');
  assert.ok(pending, 'the review card');
  await request('applyAgentAction', { id: pending.id, reviewed: true });
  await until(async () => { const f = (await current()).files.find(x => x.name === 'levels/valley.level'); return f && JSON.parse(f.content).edits.some(op => op.op === 'remove' && op.id === 'watchtower'); }, 'The applied card did not save the level');
  await until(async () => !(await live(project.id)).things.some((t) => t.id === 'watchtower'), 'The Level tab did not reload the saved level', 800);
  await until(() => run('document.body.innerText.includes("Level saved")'), 'The Level tab did not show the saved level');
  await page('0');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', engineRoot, chunks: first.baked, sprites: first.drawn, edits: file.edits.length, screenshots: ['generated', 'variations', 'painted', 'regenerated', 'dungeon', 'assistant', 'tileset', 'tileset-map', 'inspector'].map(name => `artifacts/level-${name}.png`) }));
  clearTimeout(timeout); app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
