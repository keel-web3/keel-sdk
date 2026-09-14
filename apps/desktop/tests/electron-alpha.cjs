// Alpha acceptance: an alpha tester's whole path in the editor, in a
// disposable workspace. It starts a practice chain (pnpm game:sandbox: anvil,
// KeelHold, the raw builder, the engine release), then in the editor makes a
// new game from the Character builder sample template, makes a creature with
// the Builder and saves it into the project, runs the game in the canonical
// shell, publishes it to the practice chain, opens its share link (the
// practice viewer reads it back from the chain) and copies diagnostics.
// Screenshots: artifacts/alpha-electron-*.png. Needs anvil and a KEEL game
// engine (KEEL_GAME_ENGINE_ROOT, or a keel-engine checkout); skips otherwise.
// Nothing leaves this computer; the practice chain is stopped at the end.
const { app, BrowserWindow, clipboard } = require('electron');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
process.env.KEEL_DESKTOP_TEST_HIDDEN = '1';
BrowserWindow.prototype.show = function() {}; BrowserWindow.prototype.focus = function() {};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, tries = 400) { for (let i = 0; i < tries; i++) { try { if (await fn()) return; } catch { /* Frames come and go while the shell verifies. */ } await wait(150); } throw Error(label); }
const timeout = setTimeout(() => { console.error('Alpha acceptance timed out'); sandbox?.kill('SIGINT'); app.exit(1); }, 480000);
const engineRoot = process.env.KEEL_GAME_ENGINE_ROOT || path.resolve(__dirname, '../../../../keel-engine');
const sdkRoot = path.resolve(__dirname, '../../..');
let sandbox;
const node = process.env.KEEL_NODE || 'node';
(async () => {
  if (!fs.existsSync(path.join(engineRoot, 'packages', 'keel', 'src', 'index.ts'))) { console.log(JSON.stringify({ status: 'skipped', reason: `No KEEL game engine at ${engineRoot}. Set KEEL_GAME_ENGINE_ROOT.` })); clearTimeout(timeout); app.exit(0); return; }
  if (spawnSync('anvil', ['--version']).status !== 0) { console.log(JSON.stringify({ status: 'skipped', reason: 'anvil (Foundry) is not installed.' })); clearTimeout(timeout); app.exit(0); return; }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-alpha-ui-'));
  Object.assign(process.env, { KEEL_DESKTOP_DATA_DIR: directory, KEEL_GAME_SANDBOX_DIR: path.join(directory, 'sandbox'), KEEL_GAME_ENGINE_ROOT: engineRoot });
  delete process.env.KEEL_DESKTOP_PRACTICE_RPC;

  // (The editor registers its protocols before the app is ready: load it first; it finds the chain when it's up.)
  require('../dist/main.cjs');
  // 1. The practice chain, exactly as a tester starts it (a free port each).
  const port = 20000 + Math.floor(Math.random() * 20000);
  let log = '';
  sandbox = spawn(node, [path.join(sdkRoot, 'packages/game-engine/chain/sandbox.mjs'), '--port', String(port), '--viewer-port', String(port + 1)], { cwd: sdkRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  sandbox.stdout.on('data', (b) => { log += b; }); sandbox.stderr.on('data', (b) => { log += b; });
  await until(() => /is running/.test(log) || sandbox.exitCode !== null, 'The practice chain did not start', 2400);
  if (!/is running/.test(log)) throw Error(`The practice chain did not start:\n${log.slice(-2000)}`);
  await app.whenReady();
  await until(() => BrowserWindow.getAllWindows().length, 'Editor did not start');
  const window = BrowserWindow.getAllWindows()[0]; window.setSize(1512, 982); window.webContents.setBackgroundThrottling(false);
  const errors = []; window.webContents.on('console-message', e => { if (e.level === 'error' && !e.message.includes('Electron Security Warning')) errors.push(e.message); });
  const run = source => window.webContents.executeJavaScript(source, true);
  const request = (name, input) => run(`window.keel.request(${JSON.stringify(name)}, ${JSON.stringify(input ?? null)})`);
  const idle = () => until(() => run('document.querySelector(".main-panel")?.getAttribute("aria-busy")==="false"'), 'UI stayed busy');
  const click = async (label, scope = 'document') => { await idle(); await until(() => run(`[...${scope}.querySelectorAll('button')].some(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled)`), `Button not ready: ${label}`); await run(`[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled).click()`); };
  const field = (label, value) => run(`(()=>{const e=[...document.querySelectorAll('label.field')].find(e=>e.firstElementChild.textContent===${JSON.stringify(label)}).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const snap = async name => { await wait(300); fs.writeFileSync(path.resolve(__dirname, `../artifacts/alpha-electron-${name}.png`), (await window.webContents.capturePage()).toPNG()); };
  const gameFrame = () => { const outer = window.webContents.mainFrame.framesInSubtree.find(f => f.url.startsWith('keel-preview:')); return outer && { outer, child: outer.frames[0] }; };

  // 2. The practice chain shows in the editor.
  await until(async () => (await request('gamePractice')).running, 'The editor does not see the practice chain');
  await until(() => run('document.querySelector(".practice-banner")?.innerText.includes("KEEL practice chain")'), 'Practice banner missing');

  // 3. New game from a template on the Game engine page.
  await run(`[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.includes('Game engine')).click()`); await idle();
  await until(() => run('document.querySelectorAll(".game-templates button").length===5'), 'Game templates missing');
  await until(() => run('document.querySelector(".game-engine-picker")?.innerText.includes("PRACTICE CHAIN")&&!document.querySelector(".game-engine-picker").innerText.includes("Checking")'), 'Engine picker missing');
  const picker = await run('document.querySelector(".game-engine-picker").innerText');
  await snap('engine');
  await run(`[...document.querySelectorAll('.game-templates button')].find(e=>e.querySelector('strong').textContent==='Character builder sample').click()`);
  await field('Game name', 'Alpha tester game');
  await click('Create game ↗');
  await until(() => run('document.querySelector(".tabs .selected")?.textContent==="Game"'), 'The new game did not open in its Game tab');
  const workspace = await request('workspace'); const project = workspace.state.projects.at(-1);
  assert.equal(project.game.id, 'mygames/alpha-tester-game');

  // 4. The Builder: a creature from the builder's ops, saved into the project (as the Builder tab saves it).
  await request('gameBuilderOpen', { projectId: project.id, name: 'critter', ops: [{ op: 'generate', kind: 'critter', seed: '7' }, { op: 'target', as: 'entity', id: 'alpha-critter', title: 'Alpha critter' }], reset: true, pace: false });
  const exported = await request('gameBuilderExport', { projectId: project.id, name: 'critter', look: 'voxel' });
  assert.equal(exported.id, 'alpha-critter');
  // (Saved as the Builder tab saves it; the editor may be saving its own draft at the same moment, so retry on a conflict.)
  await idle(); await wait(1000);
  for (let attempt = 0; ; attempt++) {
    const latest = await request('workspace');
    const withAsset = latest.state.projects.map(item => item.id === project.id ? { ...item, files: [...item.files.filter(file => file.name !== 'packs/alpha-critter.ts'), { id: require('node:crypto').randomUUID(), name: 'packs/alpha-critter.ts', type: 'text/typescript', content: exported.code }] } : item);
    try { await request('save', { state: { ...latest.state, projects: withAsset }, revision: latest.revision }); break; }
    catch (error) { if (attempt >= 3) throw error; await wait(750); }
  }
  await run('window.location.reload()'); await wait(1500); await idle();
  await until(() => run('document.querySelector(".tabs .selected")?.textContent==="Game"||!!document.querySelector(".project-card")'), 'Editor did not come back');
  if (await run('!document.querySelector(".tabs .selected")')) { await run(`[...document.querySelectorAll('.project-card')].find(e=>e.innerText.includes('Alpha tester game')).click()`); await idle(); }
  await until(() => run('document.querySelector(".tabs .selected")?.textContent==="Game"'), 'Game tab missing after the Builder save');

  // 5. Save & run: the asset goes into the game's pack; the game runs in the canonical shell and shows it.
  assert.ok((await request('workspace')).state.projects.find(item => item.id === project.id).files.some(file => file.name === 'packs/alpha-critter.ts'), 'The Builder asset was saved to the project');
  await click('Save & run ↻');
  await until(async () => { const frame = gameFrame(); return frame && await frame.outer.executeJavaScript('document.body.dataset.verification==="verified"') && frame.child && await frame.child.executeJavaScript('document.body.innerText.includes("alpha-critter")'); }, 'The game with the Builder asset did not run in the canonical shell', 800)
    .catch(async (error) => { const frame = gameFrame(); const state = frame ? await frame.outer.executeJavaScript('document.body.dataset.verification+" "+(document.querySelector("#keel-status")?.textContent??"")').catch(() => '') : 'no preview frame'; throw Error(`${error.message}: ${state} | ${(await run('document.querySelector(".game-workspace")?.innerText ?? ""')).slice(0, 1500)}`); });
  await snap('game');

  // 6. Publish to practice chain, then the share link.
  await click('Publish to practice chain');
  await until(() => run('document.querySelector(".game-publish")?.innerText.includes("READ BACK FROM THE CHAIN")||!!document.querySelector(".game-publish .notice.error")'), 'Publishing did not finish', 1200);
  const publish = await run('document.querySelector(".game-publish").innerText');
  assert.ok(!/notice error/.test(await run('document.querySelector(".game-publish").innerHTML')), publish);
  assert.match(publish, /Matches/);
  await run('document.querySelector(".game-publish").scrollIntoView({block:"start"})'); await snap('published');
  const share = await run('document.querySelector("input[aria-label=\'Share link\']").value');
  assert.match(share, /^http:\/\/127\.0\.0\.1:\d+\/game\/31337\/0x[0-9a-f]{64}\?digest=0x[0-9a-f]{64}$/);

  // 7. The share link, read back from the chain by the practice viewer, in a plain window.
  // (Its own session: the editor's session denies the network, as it should; the viewer is an ordinary web page.)
  const viewer = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { sandbox: true, contextIsolation: true, partition: 'keel-alpha-viewer' } });
  viewer.webContents.setBackgroundThrottling(false);
  await viewer.loadURL(share);
  await until(() => viewer.webContents.executeJavaScript('document.body.dataset.verification==="verified"'), 'The game from the chain did not verify in the viewer');
  await wait(2500);
  fs.writeFileSync(path.resolve(__dirname, '../artifacts/alpha-electron-from-chain.png'), (await viewer.webContents.capturePage()).toPNG());
  viewer.destroy();

  // 8. Copy diagnostics.
  await run(`[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.includes('Game engine')).click()`); await idle();
  await click('Copy diagnostics');
  await until(() => run('document.querySelector(".game-diagnostics")?.innerText.includes("Diagnostics copied")||!!document.querySelector(".game-diagnostics textarea")'), 'Diagnostics were not copied');
  const diagnostics = (await request('gameDiagnostics')).text;
  assert.match(diagnostics, /## game engine/); assert.match(diagnostics, /## practice chain\nrunning: true/);
  assert.ok(!diagnostics.includes(os.homedir()), 'Diagnostics keep the home folder out');

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', engineRoot, game: project.game.id, share, picker: picker.split('\n').slice(0, 8).join(' | '), screenshots: ['engine', 'game', 'published', 'from-chain'].map(name => `artifacts/alpha-electron-${name}.png`) }));
  clearTimeout(timeout); sandbox.kill('SIGINT'); await wait(1500); app.exit(0);
})().catch((error) => { console.error(error); sandbox?.kill('SIGINT'); clearTimeout(timeout); setTimeout(() => app.exit(1), 1500); });
