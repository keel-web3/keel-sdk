// Sound acceptance in a disposable workspace, against the local KEEL engine: a
// Game project's Sound tab auditions music in the sandboxed page (Tone and
// keel-audio as page scripts, the engine's audio playing), moves its intensity
// live, lists six seeded variations, adds and assigns music, starts the sound
// effects and maps an event and a material, auditions them, saves the sound
// file (codec bytes), renders a loop to WAV through the save dialog, opens a
// record in the codec inspector, and the assistant (a keyless fixture driving
// the real agent tools) adds, assigns and auditions music -- then a
// destructive change waits on a review card. A hidden window may not make
// sound, so this asserts what the page reports: its audio context started and
// the player playing. Screenshots go to artifacts/sound-*. Needs a
// keel-engine checkout (skips with a clear message otherwise).
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const assert = require('node:assert/strict');
process.env.KEEL_DESKTOP_TEST_HIDDEN = '1';
BrowserWindow.prototype.show = function() {}; BrowserWindow.prototype.focus = function() {};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, tries = 400) { for (let i = 0; i < tries; i++) { try { if (await fn()) return; } catch { /* Frames come and go. */ } await wait(75); } throw Error(label); }
const timeout = setTimeout(() => { console.error('Sound acceptance timed out'); app.exit(1); }, 420000);
const engineRoot = process.env.KEEL_GAME_ENGINE_ROOT || path.resolve(__dirname, '../../../../keel-engine');

function buildNative() {
  return require('node:child_process').execFileSync(process.execPath, [path.join(__dirname, 'sound-native.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }).trim().split('\n').at(-1);
}

(async () => {
  if (!fs.existsSync(path.join(engineRoot, 'packages', 'audio', 'src', 'index.ts')) || !fs.existsSync(path.join(engineRoot, 'vendor'))) { console.log(JSON.stringify({ status: 'skipped', reason: `No keel-engine checkout with audio and vendor/ at ${engineRoot}. Set KEEL_GAME_ENGINE_ROOT.` })); clearTimeout(timeout); app.exit(0); return; }
  process.env.KEEL_GAME_ENGINE_ROOT = engineRoot;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-sound-ui-'));
  process.env.KEEL_DESKTOP_DATA_DIR = directory;
  require(buildNative()); await app.whenReady();
  await until(() => BrowserWindow.getAllWindows().length, 'Editor did not start');
  const window = BrowserWindow.getAllWindows()[0]; window.setSize(1512, 982); window.webContents.setBackgroundThrottling(false);
  const errors = []; window.webContents.on('console-message', e => { if (e.level === 'error' && !e.message.includes('Electron Security Warning')) errors.push(e.message); });
  const run = source => window.webContents.executeJavaScript(source, true);
  const request = (name, input) => run(`window.keel.request(${JSON.stringify(name)},${JSON.stringify(input)})`);
  const idle = () => until(() => run('document.querySelector(".main-panel")?.getAttribute("aria-busy")==="false"'), 'UI stayed busy');
  const click = async (label, scope = 'document') => { await idle(); await until(() => run(`[...${scope}.querySelectorAll('button')].some(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled)`), `Button not ready: ${label}`); await run(`[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled).click()`); };
  const clickLabel = async label => { await idle(); await until(() => run(`!!document.querySelector('button[aria-label=${JSON.stringify(label)}]:not([disabled])')`), `Button not ready: ${label}`); await run(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`); };
  const setValue = (selector, value) => run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const proto=e instanceof HTMLSelectElement?HTMLSelectElement:HTMLInputElement;Object.getOwnPropertyDescriptor(proto.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));return true;})()`);
  const snap = async name => { await wait(300); fs.writeFileSync(path.resolve(__dirname, `../artifacts/sound-${name}.png`), (await window.webContents.capturePage()).toPNG()); };
  const current = async () => (await request('workspace')).state.projects.at(-1);
  const frame = () => window.webContents.mainFrame.framesInSubtree.find(f => f.url.startsWith('keel-preview://game-sound'));
  const page = source => frame().executeJavaScript(source, true);
  const player = () => page('(()=>{const s=globalThis.soundPreview;return {playing:s.playing,plays:s.plays,intensity:s.intensity,sfxPlayed:s.sfxPlayed,lastSfx:s.lastSfx,renders:s.renders,error:s.error,context:globalThis.Tone.getContext().rawContext.state,bpm:s.plan?.bpm,mode:s.plan?.mode,keelAudio:!!globalThis.KEEL_AUDIO,tone:!!globalThis.Tone};})()');
  const finished = async chatId => { await until(async () => { const h = await request('agentHistory', { id: chatId }); return h.runs.at(-1)?.status && h.runs.at(-1).status !== 'running'; }, 'The assistant did not finish', 900); const h = await request('agentHistory', { id: chatId }); assert.equal(h.runs.at(-1).status, 'completed', h.runs.at(-1).error); return h.runs.at(-1); };

  // A Game project's Sound tab: the audition page loads with Tone and keel-audio as page scripts.
  await until(() => run('document.querySelectorAll(".template-card").length>0'), 'Template launch missing');
  await run(`[...document.querySelectorAll('.template-card')].find(e=>e.querySelector('strong').textContent==='A game').click()`); await idle();
  await until(() => run('[...document.querySelectorAll(".tabs button")].some(e=>e.textContent==="Sound")'), 'Sound tab missing');
  await run('[...document.querySelectorAll(".tabs button")].find(e=>e.textContent==="Sound").click()');
  await until(() => frame() && page('!!globalThis.soundPreview'), 'The sound page did not load', 600);
  const loaded = await player();
  assert.ok(loaded.tone && loaded.keelAudio, 'Tone and keel-audio are page scripts');
  assert.equal(await page('typeof window.keel'), 'undefined', 'the sound page has no editor bridge');
  await until(() => run('document.querySelectorAll("select[aria-label=Keys] option").length>3'), 'The composer catalogue did not load');
  const project = await current();
  await snap('empty');

  // Pins, then audition: the page's audio context starts and the player reports playing.
  await setValue('input[aria-label=Tempo]', 90); await setValue('select[aria-label=Key]', 'A'); await setValue('select[aria-label=Scale]', 'dorian'); await setValue('select[aria-label=Keys]', 'rhodes');
  await click('▶ Audition');
  await until(async () => { const p = await player(); return p.playing && p.plays >= 1; }, 'The player never reported playing', 600);
  const playing = await player();
  assert.equal(playing.context, 'running', `the audio context started (${playing.context})`);
  assert.equal(playing.bpm, 90); assert.equal(playing.mode, 'dorian');
  await until(() => run('document.querySelector(".sound-now")?.textContent.startsWith("Playing")'), 'The transport did not say playing');
  const card = await run('document.querySelector(".sound-card").innerText');
  assert.match(card, /A dorian · 90 bpm/); assert.match(card, /B as a recipe/);
  // Intensity moves live while it plays.
  await setValue('input[aria-label=Intensity]', 0.9);
  await until(async () => Math.abs((await player()).intensity - 0.9) < 1e-9, 'Intensity did not reach the player');
  await snap('playing');

  // Six seeded variations; one auditioned.
  await click('Six variations');
  await until(() => run('document.querySelectorAll(".sound-variations figure").length===6'), 'Variations strip missing');
  const before = (await player()).plays;
  await run('document.querySelectorAll(".sound-variation")[2].click()');
  await until(async () => (await player()).plays > before, 'A variation did not play');
  await run('document.querySelector(".sound-variations").scrollIntoView({block:"center"})'); await snap('variations');

  // Add it and assign it; start the sound effects, map an event and a material, audition them.
  await click('Add to project');
  await until(() => run('[...document.querySelectorAll(".sound-row strong")].some(e=>e.textContent==="theme")'), 'The music was not added');
  await setValue('input[aria-label="Assign name"]', 'menu'); await setValue('select[aria-label="Assign music"]', 'theme');
  await click('Assign');
  await until(() => run('!!document.querySelector("select[aria-label=\'Music for scene menu\']")'), 'Assignment missing');
  await click('Start sound effects');
  await until(() => run('document.querySelectorAll(".sound-event-table tbody tr").length>=10'), 'Event table missing');
  await setValue('input[aria-label="New event"]', 'boostStart'); await setValue('select[aria-label="New event sound"]', 'railStart');
  await click('Map event');
  await until(() => run('!!document.querySelector("select[aria-label=\'Sound for boostStart\']")'), 'Mapped event missing');
  await setValue('input[aria-label=Material]', 'rail'); await setValue('select[aria-label="Material surface"]', 'metal');
  await click('Map material');
  await until(() => run('!!document.querySelector("select[aria-label=\'Surface for rail\']")'), 'Mapped material missing');
  const variantsText = await run('[...document.querySelectorAll(".sound-event-table tbody tr")].find(r=>r.textContent.includes("footsteps")).children[2].textContent');
  assert.equal(variantsText, '4', 'four takes of a footstep');
  await clickLabel('Audition jumped');
  await until(async () => (await player()).sfxPlayed >= 1, 'The sfx did not play');
  await clickLabel('Audition rail');
  await until(async () => (await player()).lastSfx === 'step' && (await player()).sfxPlayed >= 2, 'The footstep did not play');
  await run('document.querySelector(".sound-effects").scrollIntoView({block:"start"})'); await snap('effects');

  // Save: sound/sound.json holds codec bytes.
  await until(() => run('document.body.innerText.includes("Unsaved sound changes")'), 'Unsaved badge missing');
  await click('Save sound'); await idle();
  await until(async () => (await current()).files.some(f => f.name === 'sound/sound.json'), 'Sound file not saved');
  const file = JSON.parse((await current()).files.find(f => f.name === 'sound/sound.json').content);
  assert.equal(file.format, 'keel-game-sound@1'); assert.deepEqual(file.music.map(m => [m.id, m.kind]), [['theme', 'recipe']]); assert.deepEqual(file.assign, [{ kind: 'scene', name: 'menu', music: 'theme' }]); assert.match(file.sfx, /^s/);
  await until(() => run('document.body.innerText.includes("Sound saved")'), 'Saved badge missing');
  const sizes = await run('document.querySelector(".sound-totals")?.innerText ?? ""');
  assert.match(sizes, /CODEC RECORDS/);

  // A loop rendered to WAV, through the save dialog.
  const wavFile = path.join(directory, 'loop.wav');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: wavFile });
  await click('Loop → WAV');
  await until(() => fs.existsSync(wavFile) && fs.statSync(wavFile).size > 1000, 'The WAV was not saved', 3000);
  const wav = fs.readFileSync(wavFile);
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF'); assert.equal(wav.subarray(8, 12).toString(), 'WAVE'); assert.equal(wav.readUInt32LE(24), 22050);
  await until(() => run('document.body.innerText.includes("Rendered theme")'), 'Render message missing');

  // The codec inspector on the saved recipe.
  await click('Inspect bytes');
  await until(() => run('!!document.querySelector("[role=dialog][aria-label=\'Codec inspector\']")'), 'The codec inspector did not open');
  await until(() => run('document.querySelector("[role=dialog][aria-label=\'Codec inspector\']").innerText.includes("keel/audio/recipe")'), 'The inspector did not resolve the recipe schema', 600);
  await snap('inspector');
  await run('[...document.querySelectorAll("[role=dialog][aria-label=\'Codec inspector\'] button")].find(b=>/close/i.test(b.textContent+b.getAttribute("aria-label"))).click()');

  // The assistant scores the race: added, assigned and auditioned live; the page reports playing.
  const chat = await request('createAgentChat', { projectId: project.id, title: 'Sound', provider: 'codex', allowEdits: true });
  const playsBefore = (await player()).plays;
  await request('startAgent', { id: chat.id, prompt: 'Score the race' });
  const reply = await finished(chat.id);
  assert.match(reply.reply, /Scored the race: .* 96 bpm, \d+ bytes/); assert.match(reply.reply, /Audition playing \(running\)/); assert.match(reply.reply, /boostStart plays railStart/);
  assert.ok((await player()).plays > playsBefore, 'the assistant\'s audition played on the page');
  await until(() => run('[...document.querySelectorAll(".sound-row strong")].some(e=>e.textContent==="Race theme")'), 'The assistant\'s music did not show');
  await until(() => run('!!document.querySelector("select[aria-label=\'Music for race final-lap\']")'), 'The assistant\'s assignment did not show');
  await snap('assistant');
  // A destructive change: a review card; nothing changes until it is applied.
  await request('startAgent', { id: chat.id, prompt: 'Replace the race music' });
  const cardReply = await finished(chat.id);
  assert.match(cardReply.reply, /review card: replaces the music race/);
  const pending = (await request('agentHistory', { id: chat.id })).runs.at(-1).actions.find(a => a.kind === 'project-edit' && a.status === 'pending');
  assert.ok(pending, 'the review card');
  await request('applyAgentAction', { id: pending.id, reviewed: true });
  await until(async () => { const f = (await current()).files.find(x => x.name === 'sound/sound.json'); return f && JSON.parse(f.content).music.some(m => m.id === 'race'); }, 'The applied card did not save the sound');
  await until(() => run('document.body.innerText.includes("Sound saved")'), 'The Sound tab did not reload the saved sound');
  await page('0');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', engineRoot, context: playing.context, bpm: playing.bpm, wavBytes: wav.length, screenshots: ['empty', 'playing', 'variations', 'effects', 'inspector', 'assistant'].map(name => `artifacts/sound-${name}.png`) }));
  clearTimeout(timeout); app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
