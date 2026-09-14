// Builder acceptance in a disposable workspace, against the local KEEL engine:
// a Game project's Builder tab draws through the engine's pixel renderer in the
// sandboxed preview frame; a click places a block; the assistant (a keyless
// fixture driving the real agent tools) builds a hut while the frame redraws
// op by op; a destructive batch waits on a review card, then streams in when
// applied; a rig joint is dragged in the view; variants, clips, a bake; the
// build and its pack file saved to the project; a 3D file imported through the
// file picker and opened in the builder. Screenshots go to artifacts/builder-*.
// Needs a keel-engine checkout (skips with a clear message otherwise).
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const assert = require('node:assert/strict');
process.env.KEEL_DESKTOP_TEST_HIDDEN = '1';
BrowserWindow.prototype.show = function() {}; BrowserWindow.prototype.focus = function() {};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, tries = 400) { for (let i = 0; i < tries; i++) { try { if (await fn()) return; } catch { /* Frames come and go. */ } await wait(75); } throw Error(label); }
const timeout = setTimeout(() => { console.error('Builder acceptance timed out'); app.exit(1); }, 300000);
const root = path.resolve(__dirname, '..');
const engineRoot = process.env.KEEL_GAME_ENGINE_ROOT || path.resolve(__dirname, '../../../../keel-engine');

/** The editor's main with the builder fixture as its assistant provider (keyless): built before the app is ready (builder-native.mjs, run as Node). */
function buildNative() {
  return require('node:child_process').execFileSync(process.execPath, [path.join(__dirname, 'builder-native.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }).trim().split('\n').at(-1);
}

/** A small OBJ a person might export: a figure (body, head) and a separate helmet on top. */
function figureObj() {
  const lines = ['# KEEL builder acceptance figure'];
  let base = 0;
  const box = (name, [x0, y0, z0], [x1, y1, z1]) => {
    lines.push(`o ${name}`);
    for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]) lines.push(`v ${x} ${y} ${z}`);
    for (const f of [[1, 2, 3, 4], [5, 8, 7, 6], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 8, 4], [4, 8, 5, 1]]) lines.push(`f ${f.map(i => i + base).join(' ')}`);
    base += 8;
  };
  box('leg.L', [-0.18, 0, -0.1], [-0.04, 0.7, 0.1]); box('leg.R', [0.04, 0, -0.1], [0.18, 0.7, 0.1]);
  box('body', [-0.22, 0.7, -0.12], [0.22, 1.3, 0.12]); box('arm.L', [-0.34, 0.75, -0.07], [-0.24, 1.28, 0.07]); box('arm.R', [0.24, 0.75, -0.07], [0.34, 1.28, 0.07]);
  box('head', [-0.13, 1.32, -0.13], [0.13, 1.58, 0.13]); box('helmet', [-0.16, 1.5, -0.16], [0.16, 1.68, 0.16]);
  return `${lines.join('\n')}\n`;
}

(async () => {
  if (!fs.existsSync(path.join(engineRoot, 'packages', 'builder', 'src', 'index.ts'))) { console.log(JSON.stringify({ status: 'skipped', reason: `No keel-engine checkout with the builder at ${engineRoot}. Set KEEL_GAME_ENGINE_ROOT.` })); clearTimeout(timeout); app.exit(0); return; }
  process.env.KEEL_GAME_ENGINE_ROOT = engineRoot;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-builder-ui-'));
  process.env.KEEL_DESKTOP_DATA_DIR = directory;
  const objFile = path.join(directory, 'figure.obj'); fs.writeFileSync(objFile, figureObj());
  require(buildNative()); await app.whenReady();
  await until(() => BrowserWindow.getAllWindows().length, 'Editor did not start');
  const window = BrowserWindow.getAllWindows()[0]; window.setSize(1512, 982); window.webContents.setBackgroundThrottling(false);
  const errors = []; window.webContents.on('console-message', e => { if (e.level === 'error' && !e.message.includes('Electron Security Warning')) errors.push(e.message); });
  const run = source => window.webContents.executeJavaScript(source, true);
  const request = (name, input) => run(`window.keel.request(${JSON.stringify(name)},${JSON.stringify(input)})`);
  const idle = () => until(() => run('document.querySelector(".main-panel")?.getAttribute("aria-busy")==="false"'), 'UI stayed busy');
  const click = async label => { await idle(); await until(() => run(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled)`), `Button not ready: ${label}`); await run(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled).click()`); };
  const open = summary => run(`(()=>{const d=[...document.querySelectorAll('details.builder-section')].find(e=>e.querySelector('summary').textContent.startsWith(${JSON.stringify(summary)}));d.open=true;d.scrollIntoView({block:'center'});return true;})()`);
  const snap = async (name, frameInView = ['agent-drawing', 'agent-hut', 'motion', 'rig', 'rig-dragged', 'import-open'].includes(name)) => { if (frameInView) await run('document.querySelector(".builder-frame iframe")?.scrollIntoView({block:"start"})'); await wait(250); fs.writeFileSync(path.resolve(__dirname, `../artifacts/builder-${name}.png`), (await window.webContents.capturePage()).toPNG()); };
  const current = async () => (await request('workspace')).state.projects.at(-1);
  const frame = () => window.webContents.mainFrame.framesInSubtree.find(f => f.url.startsWith('keel-preview://game-builder'));
  const preview = source => frame().executeJavaScript(source, true);
  const stats = () => preview('JSON.parse(JSON.stringify(globalThis.builderPreview.stats))');
  const state = async () => { const p = await current(); return request('gameBuilderState', { projectId: p.id, name: 'main' }); };
  const finished = async chatId => { await until(async () => { const h = await request('agentHistory', { id: chatId }); return h.runs.at(-1)?.status && h.runs.at(-1).status !== 'running'; }, 'The assistant did not finish', 800); const h = await request('agentHistory', { id: chatId }); assert.equal(h.runs.at(-1).status, 'completed', h.runs.at(-1).error); return h.runs.at(-1); };

  // A Game project, its Builder tab, the engine's renderer drawing in the sandboxed frame.
  await until(() => run('document.querySelectorAll(".template-card").length>0'), 'Template launch missing');
  await run(`[...document.querySelectorAll('.template-card')].find(e=>e.querySelector('strong').textContent==='A game').click()`); await idle();
  await until(() => run('[...document.querySelectorAll(".tabs button")].some(e=>e.textContent==="Builder")'), 'Builder tab missing');
  await run('[...document.querySelectorAll(".tabs button")].find(e=>e.textContent==="Builder").click()');
  await until(() => frame() && preview('!!globalThis.builderPreview && globalThis.builderPreview.stats.draws>0'), 'The builder preview did not draw');
  assert.equal(await preview('typeof window.keel'), 'undefined', 'the preview frame has no editor bridge');
  const project = await current();
  await snap('empty');

  // A click on the ground places a block (the frame picks, the editor sends a set op). Pointer events are
  // dispatched inside the frame: a hidden test window doesn't route real mouse input into a sandboxed frame.
  const pointer = (type, x, y) => preview(`(()=>{const v=document.getElementById("view");const r=v.getBoundingClientRect();v.dispatchEvent(new PointerEvent(${JSON.stringify(type)},{clientX:r.left+${x}*r.width,clientY:r.top+${y}*r.height,pointerId:1,bubbles:true,button:0}));return true;})()`);
  for (const type of ['pointermove', 'pointerdown', 'pointerup']) await pointer(type, 0.5, 0.62);
  await until(async () => (await state()).model.count === 1, 'A click did not place a block');
  const clicked = await state();
  assert.equal(clicked.history.recent[0].op, 'set');

  // The assistant builds a hut; the frame redraws while the ops stream in.
  const chat = await request('createAgentChat', { projectId: project.id, title: 'Builder', provider: 'codex', allowEdits: true });
  const drawsBefore = (await stats()).draws;
  await request('startAgent', { id: chat.id, prompt: 'Build a hut next to my block' });
  let midway = null, midCards = null;
  const cards = () => run('[...document.querySelectorAll(".builder-stats strong")].map(e=>e.textContent)');
  await until(async () => { const s = await stats(); if (!midway && s.voxels > 50) { midway = s; midCards = await cards(); await snap('agent-drawing'); } return midway; }, 'The hut never started drawing', 600);
  const reply = await finished(chat.id);
  assert.match(reply.reply, /Built the hut: \d+ ops/);
  await until(async () => (await stats()).voxels === (await state()).model.count, 'The preview did not catch up');
  const drawn = await stats();
  assert.ok(drawn.draws - drawsBefore >= 4, `the frame redrew as it drew (${drawn.draws - drawsBefore} draws)`);
  assert.ok(midway.voxels < drawn.voxels, 'a frame showed it half built');
  assert.ok(drawn.lit > 400, 'the hut is on screen');
  const hut = await state();
  assert.equal(hut.target.id, 'hut'); assert.deepEqual(hut.groups.map(g => g.name), ['door']);
  await until(() => run('document.body.innerText.includes("Unsaved build changes")'), 'Unsaved badge missing');
  // The stat cards follow the streamed ops (they read each frame, not the state that lags a stream).
  assert.ok(Number(midCards[0].replace(/,/g, '')) > 1, `mid-stream the cards counted voxels (${midCards.join(' | ')})`);
  await until(async () => { const c = await cards(); return Number(c[0].replace(/,/g, '')) === hut.model.count && c[2] === `${hut.history.total} ops`; }, 'The stat cards did not follow the hut');
  // The baked pixel sprite, as in game: eight directions, animated, next to the 3D view.
  await until(() => run('document.querySelector(".sprite-pane canvas[aria-label=\'Baked sprite\']")?.dataset.directions==="8"'), 'The baked sprite pane is missing', 600);
  const sprite = await run('(()=>{const c=document.querySelector(".sprite-pane canvas[aria-label=\'Baked sprite\']");const d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;let lit=0;for(let i=3;i<d.length;i+=4)if(d[i])lit++;return {w:+c.dataset.w,h:+c.dataset.h,frames:+c.dataset.frames,lit};})()');
  assert.ok(sprite.lit > 100 && sprite.frames >= 1, `the hut baked to a sprite (${JSON.stringify(sprite)})`);
  await snap('agent-hut');

  // Save the build and its pack file into the project.
  await click('Save build & pack file'); await idle();
  await until(async () => (await current()).files.some(f => f.name === 'packs/hut.ts'), 'Pack file not saved');
  const files = (await current()).files;
  assert.ok(files.some(f => f.name === 'builds/main.build.json'));
  assert.equal(JSON.parse(files.find(f => f.name === 'builds/main.build.json').content).ops.length, hut.history.total);
  assert.match(files.find(f => f.name === 'packs/hut.ts').content, /objectFromVoxels/);
  await until(() => run('document.body.innerText.includes("Build saved")'), 'Saved badge missing');

  // Motion: the door's hinge on the timeline; variants; the bake preview.
  await open('Motion'); await click('Load clips');
  await until(() => run('!!document.querySelector("input[aria-label=Timeline]")'), 'Timeline missing');
  await run('(()=>{const e=document.querySelector("input[aria-label=Timeline]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"4");e.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await until(async () => (await preview('globalThis.builderPreview.frame?.key')) === 'pose:idle', 'The clip frame was not drawn');
  await snap('motion');
  await click('Back to the build');
  await open('Bake preview'); await click('Bake 32 · 64 · 128');
  await until(() => run('document.querySelectorAll(".builder-bakes img").length===3'), 'Bake sheets missing');
  const bakes = await run('[...document.querySelectorAll(".builder-bakes figcaption")].map(e=>e.textContent)');
  assert.ok(bakes[0].startsWith('32 px') && bakes[2].startsWith('128 px'), bakes.join());
  await run('document.querySelector(".builder-bakes").scrollIntoView({block:"center"})'); await snap('bake');

  // A destructive batch: a review card first; applied, it streams in and the rig shows.
  await request('startAgent', { id: chat.id, prompt: 'Generate a critter instead' });
  const cardReply = await finished(chat.id);
  assert.match(cardReply.reply, /review card: replaces the build/);
  assert.equal((await state()).target.id, 'hut', 'nothing changed before the card');
  const card = (await request('agentHistory', { id: chat.id })).runs.at(-1).actions.find(a => a.kind === 'project-edit' && a.status === 'pending');
  assert.ok(card, 'the review card');
  await request('applyAgentAction', { id: card.id, reviewed: true });
  await until(async () => { const s = await state(); return s.rig?.plan === 'quadruped' && s.model.name === 'critter-9'; }, 'The applied card did not stream in');
  await until(async () => (await preview('globalThis.builderPreview.frame?.rig?.bones?.length ?? 0')) > 10, 'Rig overlay missing');
  await snap('rig');

  // Drag the head joint up in the view: a joint op.
  const before = JSON.stringify((await state()).rig.bones.find(b => b.name === 'head').vox);
  const head = await preview('globalThis.builderPreview.jointScreen("head")');
  const drag = (type, x, y) => preview(`document.getElementById("view").dispatchEvent(new PointerEvent(${JSON.stringify(type)},{clientX:${x},clientY:${y},pointerId:2,bubbles:true,button:0}))`);
  await drag('pointerdown', head.x, head.y);
  for (let k = 1; k <= 6; k++) await drag('pointermove', head.x, head.y - k * 6);
  await drag('pointerup', head.x, head.y - 36);
  await until(async () => (await state()).history.recent[0].op === 'joint', 'The joint drop was not an op');
  const after = JSON.stringify((await state()).rig.bones.find(b => b.name === 'head').vox);
  assert.notEqual(after, before, 'the head joint moved');
  await snap('rig-dragged');
  await open('Variants'); await click('Show six seeds');
  await until(() => run('document.querySelectorAll(".builder-strip img").length===6'), 'Variant strip missing');
  await run('document.querySelector(".builder-strip").scrollIntoView({block:"center"})'); await snap('variants');
  // Use a variant: its ops land in the history (a voxel variant loses nothing, so no review), and one Undo takes them back.
  const beforeVariant = (await state()).history.total;
  await run('document.querySelectorAll(".builder-strip .variant-use")[1].click()');
  await until(() => run('document.body.innerText.includes("Used variant 2")'), 'Use this variant did nothing');
  const usedVariant = await state();
  assert.ok(usedVariant.history.total > beforeVariant, 'the variant is ops in the history');
  await snap('variant-used');
  await click('Undo variant');
  await until(async () => (await state()).history.total === beforeVariant, 'Undo variant did not take it back');

  // Import: a 3D file through the app's file import (the picker, then the content-addressed store), then into the builder.
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [objFile] });
  await run('document.querySelector(".builder-tabs button:nth-child(2)").click()');
  await click('Choose a file…'); await idle();
  await until(() => run('document.querySelectorAll(".builder-views img").length===4'), 'Import views missing');
  const parts = await run('[...document.querySelectorAll(".builder-parts tbody tr td:nth-child(2) strong")].map(e=>e.textContent)');
  assert.ok(parts.length >= 2, parts.join());
  const objectId = (await request('workspace')).state.objects.find(o => o.name === 'figure.obj').id;
  await run('document.querySelector(".builder-import").scrollIntoView({block:"start"})'); await snap('import', false);
  await click('Open in builder'); await idle();
  await until(async () => (await state()).model.name === 'figure', 'The import did not open in the builder');
  await until(() => run('[...document.querySelectorAll(".builder-parts select")].length>0'), 'Per-part actions missing');
  await snap('import-open');
  // The engine's own sample, and the assistant importing the same file (a card: the build has work).
  await click('Try an engine sample'); await idle();
  await until(() => run('document.querySelector(".builder-hint")&&document.body.innerText.includes("robot")||document.querySelectorAll(".builder-views img").length===4'), 'Sample import missing');
  await request('startAgent', { id: chat.id, prompt: `Import ${objectId}` });
  const imported = await finished(chat.id);
  assert.match(imported.reply, /Imported figure: .*parts/);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', engineRoot, draws: drawn.draws - drawsBefore, midway: midway.voxels, hut: hut.model.count, passes: drawn.passes, bakes, parts, sprite, midCards, screenshots: ['empty', 'agent-drawing', 'agent-hut', 'motion', 'bake', 'rig', 'rig-dragged', 'variants', 'variant-used', 'import', 'import-open'].map(name => `artifacts/builder-${name}.png`) }));
  clearTimeout(timeout); app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
