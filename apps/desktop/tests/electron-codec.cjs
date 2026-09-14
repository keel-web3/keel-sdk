// Codec inspector acceptance in a disposable workspace, against the local KEEL
// engine: the Game engine page's codec inspector reads a pasted document and a
// sample into a tree and a hex view painted by role; hovering a field lights
// its bytes and hovering a byte lights its field; an edited JSON view
// re-encodes to new canonical bytes; an invalid edit shows its field inline;
// the Solidity decoder is generated (or refused, with the reason); a Game
// project's saved build file and pack file (KC1: voxels) are inspected as the
// records they hold. Screenshots go to artifacts/codec-*. Needs a keel-engine
// checkout (skips with a clear message otherwise). Nothing is saved or deployed.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const assert = require('node:assert/strict');
process.env.KEEL_DESKTOP_TEST_HIDDEN = '1';
BrowserWindow.prototype.show = function() {}; BrowserWindow.prototype.focus = function() {};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, tries = 400) { for (let i = 0; i < tries; i++) { try { if (await fn()) return; } catch { /* The page is still drawing. */ } await wait(75); } throw Error(label); }
const timeout = setTimeout(() => { console.error('Codec acceptance timed out'); app.exit(1); }, 240000);
const root = path.resolve(__dirname, '..');
const engineRoot = process.env.KEEL_GAME_ENGINE_ROOT || path.resolve(__dirname, '../../../../keel-engine');

/** The editor's main (a keyless fixture as its assistant provider) next to a copy of everything the build made: artifacts/codec-native. */
function buildNative() {
  const out = path.join(root, 'artifacts', 'codec-native');
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  // (Every built file, so a new worker is never left behind.)
  for (const name of fs.readdirSync(path.join(root, 'dist'))) if (name !== 'main.cjs' && name !== 'main.cjs.map') fs.cpSync(path.join(root, 'dist', name), path.join(out, name), { recursive: true });
  const script = `import { build } from 'esbuild'; await build({ entryPoints: [${JSON.stringify(path.join(root, 'src/main.ts'))}], outfile: ${JSON.stringify(path.join(out, 'main.cjs'))}, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['electron', 'node:sqlite', '@keel/mcp', '@keel/sdk/inline-viewer-graph', 'langchain', '@langchain/*', '@modelcontextprotocol/sdk/*'], plugins: [{ name: 'keyless-agent-fixture', setup(b) { b.onResolve({ filter: /^\\.\\/agent-providers\\.mjs$/ }, () => ({ path: ${JSON.stringify(path.join(root, 'tests/agent-fixture-provider.mjs'))} })); } }] });`;
  require('node:child_process').execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  return path.join(out, 'main.cjs');
}

(async () => {
  if (!fs.existsSync(path.join(engineRoot, 'packages', 'codec', 'src', 'index.ts'))) { console.log(JSON.stringify({ status: 'skipped', reason: `No keel-engine checkout with the codec at ${engineRoot}. Set KEEL_GAME_ENGINE_ROOT.` })); clearTimeout(timeout); app.exit(0); return; }
  process.env.KEEL_GAME_ENGINE_ROOT = engineRoot;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-codec-ui-'));
  process.env.KEEL_DESKTOP_DATA_DIR = directory;
  require(buildNative()); await app.whenReady();
  await until(() => BrowserWindow.getAllWindows().length, 'Editor did not start');
  const window = BrowserWindow.getAllWindows()[0]; window.setSize(1512, 1100); window.webContents.setBackgroundThrottling(false);
  const errors = []; window.webContents.on('console-message', e => { if (e.level === 'error' && !e.message.includes('Electron Security Warning')) errors.push(e.message); });
  const run = source => window.webContents.executeJavaScript(`Promise.resolve().then(()=>(${source})).catch(e=>({__error:String(e&&e.message||e)}))`, true).then(value => { if (value && typeof value === 'object' && '__error' in value) throw Error(`${value.__error} (in ${source.slice(0, 120)})`); return value; });
  const request = (name, input) => run(`window.keel.request(${JSON.stringify(name)},${JSON.stringify(input)})`);
  const idle = () => until(() => run('document.querySelector(".main-panel")?.getAttribute("aria-busy")==="false" && document.querySelector(".codec-panel")?.getAttribute("aria-busy")!=="true"'), 'UI stayed busy');
  const click = async label => { await idle(); await until(() => run(`[...document.querySelectorAll('.codec-card button')].some(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled)`), `Button not ready: ${label}`); await run(`[...document.querySelectorAll('.codec-card button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled).click()`); };
  const setValue = (selector, value) => run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const proto=e.tagName==='SELECT'?HTMLSelectElement:e.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement;Object.getOwnPropertyDescriptor(proto.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;})()`);
  const text = selector => run(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
  const schemaName = () => text('.codec-schema-head h3');
  const codecBytes = () => text('.codec-sizes > div:first-child strong');
  const snap = async (name, selector) => { if (selector) await run(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'start'})`); await wait(250); fs.writeFileSync(path.resolve(__dirname, `../artifacts/codec-${name}.png`), (await window.webContents.capturePage()).toPNG()); };
  await until(() => run('document.querySelectorAll(".template-card").length>0'), 'Editor UI missing');

  // A Game project with a saved build and a pack file embedding KC1: voxels (as the Builder saves them).
  const voxels = await request('gameCodecSample', { kind: 'voxels' });
  const recipe = await request('gameCodecSample', { kind: 'recipe' });
  let current = await request('workspace');
  current = await request('createProject', { title: 'Codec yard', template: 'game', revision: current.revision });
  const project = current.state.projects.at(-1);
  const files = [
    { id: crypto.randomUUID(), name: 'builds/main.build.json', type: 'application/json', content: `${JSON.stringify({ format: 'keel-game-build@1', name: 'main', ops: [{ op: 'new', name: 'hut', unit: 0.12 }, { op: 'box', from: [0, 0, -4], to: [5, 6, 4], role: 'primary', hollow: true }, { op: 'target', as: 'object', id: 'hut' }] }, null, 1)}\n` },
    { id: crypto.randomUUID(), name: 'packs/crate.ts', type: 'text/typescript', content: `import { objectFromVoxels } from "@keel-engine/builder";\nconst VOXELS = ${JSON.stringify(voxels.text)};\nexport default objectFromVoxels(VOXELS);\n` },
    { id: crypto.randomUUID(), name: 'sound/sound.json', type: 'application/json', content: JSON.stringify({ format: 'keel-game-sound@1', music: [{ id: 'theme', title: 'Theme', kind: 'recipe', bytes: recipe.bytes }], assign: [], sfx: null }) },
  ];
  await request('save', { state: { ...current.state, projects: current.state.projects.map(p => p.id === project.id ? { ...p, files: [...p.files, ...files] } : p) }, revision: current.revision });
  window.webContents.send('keel:agent-event', { type: 'workspace' });

  // The Game engine page: the codec inspector card.
  await run(`[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.includes('Game engine')).click()`);
  await until(() => run('!!document.querySelector(".codec-card textarea[aria-label=\'Codec text\']")'), 'Codec inspector section missing');
  await run('document.querySelector(".codec-card").scrollIntoView({block:"start"})');
  await snap('empty');

  // Paste a document (the sfx sample as base64url) and inspect it: the tree and the hex view render.
  const sfx = await request('gameCodecSample', { kind: 'sfx' });
  await setValue('.codec-card textarea[aria-label="Codec text"]', sfx.bytes);
  await click('Inspect');
  await until(async () => (await schemaName()) === 'keel/audio/sfx@1', 'The pasted document did not explain');
  const rows = await run('document.querySelectorAll(".codec-tree .codec-row").length');
  const cells = await run('document.querySelectorAll(".codec-hex .codec-byte").length');
  assert.ok(rows > 10, `tree rows: ${rows}`); assert.equal(cells, sfx.byteLength, 'one hex cell per byte');
  assert.ok(await run('document.querySelectorAll(".codec-hex .codec-byte.role-header").length===5'), 'the five header bytes painted as header');
  assert.ok(await run('document.querySelectorAll(".codec-hex .codec-byte.role-mixed").length>0'), 'bytes shared by fields are painted per bit');
  assert.equal(await codecBytes(), `${sfx.byteLength} B`);
  assert.ok(await run('document.querySelectorAll(".codec-cost").length>3'), 'what’s big');

  // Hover a field: its bits light in the hex view. Hover a byte: its field lights in the tree.
  await run(`(()=>{const row=document.querySelector('.codec-row[data-path="sounds.jump.gain"]');row.scrollIntoView({block:'center'});row.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,relatedTarget:document.body}));return true;})()`);
  await until(() => run('document.querySelectorAll(".codec-hex .codec-byte.hl").length>0'), 'Hovering a field did not light its bytes');
  const lit = await run('[...document.querySelectorAll(".codec-hex .codec-byte.hl")].map(e=>Number(e.dataset.i))');
  assert.ok(lit.length >= 1 && lit.length <= 2, `an 8-bit field lights one or two bytes (${lit})`);
  await snap('hover-field', '.codec-legend');
  // (A byte's first bit: here the tail of the jump sound's gain, or the next field's start -- either way inside sounds.)
  await run(`document.querySelector('.codec-byte[data-i="${lit.at(-1)}"]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`);
  await until(() => run('!!document.querySelector(".codec-row.hl-deep")'), 'Hovering a byte did not light its field');
  const deep = await run('document.querySelector(".codec-row.hl-deep").dataset.path');
  assert.ok(deep.startsWith('sounds.'), deep);
  assert.ok(await run('document.querySelector(\'.codec-row[data-path="sounds"]\').classList.contains("hl")'), 'its ancestors light too');
  await snap('hover-byte', '.codec-legend');

  // Edit the JSON view and re-encode: new canonical bytes, a new size.
  const json = JSON.parse(await run('document.querySelector("textarea[aria-label=\'JSON view\']").value'));
  json.sounds.step = { gain: 0.5, pan: 0.2 }; json.sounds.jump.gain = 0.35;
  await setValue('textarea[aria-label="JSON view"]', JSON.stringify(json, null, 2));
  await click('Re-encode');
  await until(() => run('!!document.querySelector(".codec-reencoded")'), 'Re-encode did not finish');
  const after = await codecBytes();
  assert.notEqual(after, `${sfx.byteLength} B`, 'the size changed');
  const reencoded = await run('document.querySelector("input[aria-label=\'Re-encoded base64url\']").value');
  assert.notEqual(reencoded, sfx.bytes);
  assert.equal(JSON.parse(await run('document.querySelector("textarea[aria-label=\'JSON view\']").value')).sounds.step.gain, 0.5);
  assert.equal(await run('document.querySelectorAll(".codec-hex .codec-byte").length'), Buffer.from(reencoded, 'base64url').length);
  await snap('reencoded', '.codec-json');

  // An invalid edit: the field and why, inline in the tree and under the editor.
  json.sounds.jump.gain = 'loud';
  await setValue('textarea[aria-label="JSON view"]', JSON.stringify(json, null, 2));
  await click('Re-encode');
  await until(() => run('!!document.querySelector(".codec-edit-error")'), 'The invalid edit showed no error');
  assert.match(await text('.codec-edit-error'), /sounds\.jump\.gain.*"loud" is not a number/);
  assert.match(await text('.codec-field-error'), /sounds\.jump\.gain/);
  assert.equal(await run('document.querySelector(".codec-row-error")?.dataset.path'), 'sounds.jump.gain');
  await run('document.querySelector(".codec-field-error").scrollIntoView({block:"center"})'); await snap('invalid');
  await click('Reset');

  // Solidity: this schema is refused (the reason names the field); a fixed-layout sample gets code.
  await click('Generate Solidity decoder');
  await until(() => run('!!document.querySelector(".codec-refusal")'), 'No Solidity refusal');
  assert.match(await text('.codec-refusal'), /open struct has no fixed layout/);
  await setValue('select[aria-label="Codec sample"]', 'tile');
  await click('Try a sample');
  await until(async () => (await schemaName()) === 'keel/codec/sample-tile@1', 'The tile sample did not explain');
  await click('Generate Solidity decoder');
  await until(() => run('!!document.querySelector(".codec-code")'), 'No Solidity code');
  assert.match(await text('.codec-code'), /library SampleTileCodec[\s\S]*function decodeDocument/);
  await snap('solidity', '.codec-solidity');

  // The saved project's records: the build's op list (packed as stored) and the pack file's KC1: voxels.
  await until(() => run('!!document.querySelector("select[aria-label=\'Codec project\']")'), 'No project with codec records offered');
  await setValue('select[aria-label="Codec project"]', project.id);
  await until(() => run('document.querySelectorAll(".codec-record").length===3'), 'The project’s records are missing');
  await run(`[...document.querySelectorAll('.codec-record')].find(e=>e.textContent.includes('Build main')).click()`);
  await until(async () => (await schemaName()) === 'keel/builder/ops@1', 'The build record did not explain');
  assert.match(await text('.codec-result .game-hint'), /3 ops, packed/);
  await run(`[...document.querySelectorAll('.codec-record')].find(e=>e.textContent.includes('packs/crate.ts')).click()`);
  await until(async () => (await schemaName()) === 'keel/builder/voxels@1', 'The KC1 record did not explain');
  await run('document.querySelector(".codec-records").scrollIntoView({block:"start"})'); await snap('project');

  // The registry: engine schemas and what the workspace's manifests declare.
  await run('(()=>{const d=document.querySelector("details.codec-schemas");d.open=true;d.scrollIntoView({block:"start"});return true;})()');
  await until(() => run('document.querySelectorAll("details.codec-schemas tbody tr").length>10'), 'Registered schemas missing');
  assert.match(await text('details.codec-schemas'), /keel\/ui\/theme@1[\s\S]*keel\/ui/);
  await snap('schemas');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', engineRoot, rows, cells, lit, deep, reencodedBytes: after, screenshots: ['empty', 'hover-field', 'hover-byte', 'reencoded', 'invalid', 'solidity', 'project', 'schemas'].map(name => `artifacts/codec-${name}.png`) }));
  clearTimeout(timeout); app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
