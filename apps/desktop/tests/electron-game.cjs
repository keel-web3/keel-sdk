// Game acceptance in a disposable workspace: a Game project plays examples/hello
// from the local KEEL engine inside the canonical shell, the Game engine page
// lists every module and checks a fit. Needs a keel-engine checkout (skips
// with a clear message otherwise). Nothing is published or signed.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const assert = require('node:assert/strict');
process.env.KEEL_DESKTOP_TEST_HIDDEN = '1';
BrowserWindow.prototype.show = function() {}; BrowserWindow.prototype.focus = function() {};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let i = 0; i < 240; i++) { try { if (await fn()) return; } catch { /* Frames come and go while the shell verifies. */ } await wait(75); } throw Error(label); }
const timeout = setTimeout(() => { console.error('Game acceptance timed out'); app.exit(1); }, 120000);
const engineRoot = process.env.KEEL_GAME_ENGINE_ROOT || path.resolve(__dirname, '../../../../keel-engine');
(async () => {
  if (!fs.existsSync(path.join(engineRoot, 'packages', 'keel', 'src', 'index.ts'))) { console.log(JSON.stringify({ status: 'skipped', reason: `No keel-engine checkout at ${engineRoot}. Set KEEL_GAME_ENGINE_ROOT.` })); clearTimeout(timeout); app.exit(0); return; }
  process.env.KEEL_GAME_ENGINE_ROOT = engineRoot;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-game-ui-'));
  process.env.KEEL_DESKTOP_DATA_DIR = directory;
  // Observe (not replace) the editor's permission decisions.
  const decisions = [];
  require('../dist/main.cjs'); await app.whenReady();
  // (The editor installs its handler after startup work; wrap the setter before it does.)
  const setHandler = session.defaultSession.setPermissionRequestHandler.bind(session.defaultSession);
  session.defaultSession.setPermissionRequestHandler = handler => setHandler(handler && ((contents, permission, callback, details) => handler(contents, permission, granted => { decisions.push({ permission, requestingUrl: details.requestingUrl, focusedFrame: (() => { try { return contents.focusedFrame?.url ?? null; } catch { return null; } })(), granted }); callback(granted); }, details)));
  await until(() => BrowserWindow.getAllWindows().length, 'Editor did not start');
  const window = BrowserWindow.getAllWindows()[0]; window.setSize(1512, 982); window.webContents.setBackgroundThrottling(false);
  const errors = []; window.webContents.on('console-message', e => { if (e.level === 'error' && !e.message.includes('Electron Security Warning')) errors.push(e.message); });
  const run = source => window.webContents.executeJavaScript(source, true);
  const idle = () => until(() => run('document.querySelector(".main-panel")?.getAttribute("aria-busy")==="false"'), 'UI stayed busy');
  const click = async label => { await idle(); await until(() => run(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled)`), `Button not ready: ${label}`); await run(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled).click()`); await idle(); };
  const field = (label, value, tag = 'input') => run(`(()=>{const e=[...document.querySelectorAll('label.field')].find(e=>e.firstElementChild.textContent===${JSON.stringify(label)}).querySelector(${JSON.stringify(tag)});Object.getOwnPropertyDescriptor(${tag === 'select' ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${tag === 'select' ? "'change'" : "'input'"},{bubbles:true}));})()`);
  const snap = async name => { await wait(200); fs.writeFileSync(path.resolve(__dirname, `../artifacts/game-${name}.png`), (await window.webContents.capturePage()).toPNG()); };
  const current = async () => (await run('window.keel.request("workspace")')).state.projects.at(-1);
  const gameFrame = () => { const outer = window.webContents.mainFrame.framesInSubtree.find(f => f.url.startsWith('keel-preview:')); return outer && { outer, child: outer.frames[0] }; };

  await until(() => run('document.querySelectorAll(".template-card").length>0'), 'Template launch missing');
  await snap('templates');
  await run(`[...document.querySelectorAll('.template-card')].find(e=>e.querySelector('strong').textContent==='A game').click()`); await idle();
  assert.equal((await current()).creation.template, 'game');
  await until(() => run('document.querySelector(".tabs .selected")?.textContent==="Game"'), 'Game tab did not open');
  await until(() => run('[...document.querySelectorAll("select[aria-label=\'Game module\'] option")].some(o=>o.value==="examples/hello")'), 'examples/hello was not offered');
  await snap('empty');
  await field('Game module', 'examples/hello', 'select'); await field('Seed', '7');
  await click('Save & run ↻');
  assert.deepEqual((await current()).game, { id: 'examples/hello', seed: '7' });
  await until(async () => { const frame = gameFrame(); return frame && await frame.outer.executeJavaScript('document.body.dataset.verification==="verified"') && frame.child && await frame.child.executeJavaScript('!!document.querySelector("canvas")'); }, 'examples/hello did not render inside the canonical shell');
  const { outer, child } = gameFrame();
  const inside = await child.executeJavaScript('(()=>{const c=document.querySelector("canvas"),g=c.getContext("2d"),d=g.getImageData(0,0,c.width,c.height).data;let lit=0;for(let i=0;i<d.length;i+=4)if(d[i]+d[i+1]+d[i+2]>90)lit++;return {seed:globalThis.KEEL_SEED,context:globalThis.__KEEL_CONTEXT__,width:c.width,lit};})()');
  assert.equal(inside.seed, `0x${'0'.repeat(63)}7`, 'The seed reached the game as KEEL_SEED'); assert.equal(inside.width, 128); assert.ok(inside.lit > 200, 'The game drew its blobs');
  await until(() => run('document.querySelectorAll(".game-table tbody tr").length===3&&!document.querySelector(".game-table").innerText.includes("—")'), 'Module graph with sizes missing');
  const order = await run('[...document.querySelectorAll(".game-table tbody tr td:nth-child(2) strong")].map(e=>e.textContent)');
  assert.deepEqual(order, ['keel/runtime', 'examples/hello-pack', 'examples/hello']);
  assert.ok(await run('document.querySelector(".game-sizes").innerText.includes("THE GAME DOCUMENT")'));
  await snap('tab');
  // Pointer lock: granted only when the request comes from (or focus is inside) a keel-preview frame.
  window.webContents.focus();
  const box = await run('(()=>{const r=document.querySelector(".game-frame iframe").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()');
  for (const type of ['mouseDown', 'mouseUp']) window.webContents.sendInputEvent({ type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await child.executeJavaScript('window.focus()', true).catch(() => {});
  await wait(150);
  const locked = await child.executeJavaScript('new Promise(r=>{document.addEventListener("pointerlockchange",()=>r("locked"),{once:true});document.addEventListener("pointerlockerror",()=>r("refused"),{once:true});Promise.resolve(document.body.requestPointerLock()).catch(()=>r("refused"));setTimeout(()=>r("no answer"),1500);})', true).catch(error => `error: ${error.message}`);
  await child.executeJavaScript('document.exitPointerLock()').catch(() => {});
  // (A hidden test window never moves focus into the game frame, so Chromium attributes the request to the
  // editor and it must be refused. With a visible window the focused game frame is inside keel-preview.)
  const preview = value => typeof value === 'string' && value.startsWith('keel-preview:');
  assert.ok(decisions.every(item => ['pointerLock', 'fullscreen'].includes(item.permission) && (item.granted === (preview(item.requestingUrl) || preview(item.focusedFrame)))), JSON.stringify(decisions));
  // The Release guide knows the game is the artwork.
  await click('Release'); await until(() => run('document.querySelector(".artwork-upload")?.innerText.includes("examples/hello")'), 'Release guide did not show the game');
  assert.equal(await run('[...document.querySelectorAll("button")].find(e=>e.textContent==="Continue to collection →").disabled'), false);
  // The Game engine page.
  await run(`[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.includes('Game engine')).click()`); await idle();
  await until(() => run('document.querySelectorAll(".game-module").length>=3&&document.body.innerText.includes("party-hat")'), 'Engine modules missing');
  const groups = await run('[...document.querySelectorAll(".game-group .section-line h2")].map(e=>e.textContent)');
  assert.ok(groups.includes('Games') && groups.includes('Packs') && groups.includes('Engine parts'), groups.join());
  await field('Attribute', 'examples/hello-pack#party-hat', 'select'); await field('Entity', 'examples/hello-pack#tall-blob', 'select');
  await until(() => run('document.querySelector(".game-verdict.fits")?.innerText.includes("both from examples/hello-pack")'), 'Fit verdict missing');
  await snap('engine');
  await run('document.querySelector(".game-fit").scrollIntoView({block:"start"})'); await snap('fit');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', engineRoot, inside: { seed: inside.seed, context: inside.context, lit: inside.lit }, order, pointerLock: locked, permissions: decisions, screenshots: ['game-templates.png', 'game-empty.png', 'game-tab.png', 'game-engine.png', 'game-fit.png'].map(name => `artifacts/${name}`) }));
  clearTimeout(timeout); app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
