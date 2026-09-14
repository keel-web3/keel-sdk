// The KEEL engine's audio, off the editor's main thread: music recipes and
// songs through the codec (MUSIC_RECIPE, SONG), their plans (scoreOf), seeded
// variations, sfx settings (SFX_SETTINGS) with how each sound is played, a
// project's sound file to its editable doc and back, sizes as bytes against
// JSON -- and the audition page, bundled once per engine checkout: Tone and
// keel-audio as page scripts (engine vendor/), then @keel-engine/audio. Nothing
// here plays sound: Web Audio only exists on a page, so the page plays and this
// worker writes what it plays. Like the other game-engine workers, Node runs
// the engine's TypeScript directly and only trusted main-process requests
// arrive here.
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { BODY_EVENTS, FOOTSTEP, SOUND_FORMAT, fileOfDoc, fromBase64url, readSoundFile, toBase64url, writeSoundFile } from './sound-project.mjs';

const root = workerData.root;
const src = (name) => pathToFileURL(join(root, 'packages', name, 'src', 'index.ts')).href;
let loaded;
async function engine() {
  if (!loaded) {
    const [audio, codec] = await Promise.all([import(src('audio')), import(src('codec'))]);
    loaded = { audio, codec };
  }
  return loaded;
}

const clean = (value) => JSON.parse(JSON.stringify(value ?? null));
const gz = (bytes) => gzipSync(bytes, { level: 9 }).byteLength;
const utf8 = (text) => Buffer.byteLength(text, 'utf8');
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Codec bytes against the JSON they stand for: bytes, gzip, JSON, JSON+gzip. */
const sizes = (bytes, json) => { const text = JSON.stringify(json); return { bytes: bytes.byteLength, gzip: gz(bytes), json: utf8(text), jsonGz: gz(Buffer.from(text)) }; };
/** What the editor shows of a plan. */
const summaryOf = (plan) => ({
  seed: plan.seed, theme: plan.theme, bpm: Math.round(plan.bpm * 10) / 10, key: NOTES[((plan.tonic % 12) + 12) % 12], mode: plan.mode, family: plan.family,
  keys: plan.keys, lead: plan.lead, bass: plan.bass, kit: plan.kit, loopBars: plan.loopBars, loopSec: Math.round(plan.loopSec * 10) / 10,
  form: plan.form.map(([sec, bars]) => `${sec}${bars}`).join(' '), weather: [...plan.weather], room: [...plan.room], energy: plan.energy ?? 0.5, swing: Math.round(plan.swing * 100) / 100,
});

async function catalogue() {
  const { audio } = await engine();
  return {
    bands: Object.keys(audio.BANDS), choices: clean(audio.CHOICES), weather: [...audio.WEATHER_KINDS], room: [...audio.ROOM_KINDS],
    sounds: [...audio.SFX_NAMES], loops: [...audio.LOOP_NAMES], styles: [...audio.STYLE_NAMES], surfaces: [...audio.SURFACES], shoes: ['sneaker', 'boot', 'soft'],
    events: BODY_EVENTS, footstep: FOOTSTEP,
  };
}

/** Which music schema a document is (by its header): a recipe or a song. */
async function kindOf(bytes) {
  const { codec } = await engine();
  const id = codec.readHeader(bytes).id?.slice(0, 8);
  if (id === codec.shortId(codec.MUSIC_RECIPE)) return 'recipe';
  if (id === codec.shortId(codec.SONG)) return 'song';
  throw new Error(`These bytes aren't music: their schema is ${id ?? 'not named'}, not keel/audio/recipe or keel/audio/song.`);
}

/**
 * One music entry, encoded: from a recipe (its JSON view: `{ from: "game", seed, spec, pins }` or `{ from: "mood",
 * seed, mood, pins }`) stored as that recipe or as the SONG of the plan it makes, or from codec bytes (a recipe or
 * a song, e.g. a hand-edited song from the codec inspector). The plan comes with it (the page plays it), and the
 * sizes: the stored bytes against the plan's JSON.
 */
async function music({ recipe, bytes, store = 'recipe', plan: withPlan = true }) {
  const { audio, codec } = await engine();
  let doc, kind, recipeJson;
  if (bytes) {
    doc = typeof bytes === 'string' ? fromBase64url(bytes) : new Uint8Array(bytes);
    kind = await kindOf(doc);
    if (kind === 'recipe') recipeJson = codec.toJSON(codec.MUSIC_RECIPE, codec.decode(codec.MUSIC_RECIPE, doc));
  } else {
    let value;
    try { value = codec.fromJSON(codec.MUSIC_RECIPE, recipe); } catch (error) { throw new Error(`That recipe doesn't check out: ${error.message}`); }
    recipeJson = codec.toJSON(codec.MUSIC_RECIPE, value);
    const recipeBytes = codec.encode(codec.MUSIC_RECIPE, value);
    // (A song is the plan itself: it keeps no recipe, as a song loaded from its bytes has none.)
    if (store === 'song') { doc = audio.storeMusic(audio.loadMusic(recipeBytes)); kind = 'song'; recipeJson = undefined; } else { doc = recipeBytes; kind = 'recipe'; }
  }
  const plan = audio.loadMusic(doc);
  return {
    kind, bytes: toBase64url(doc), ...(recipeJson !== undefined ? { recipe: recipeJson } : {}), summary: summaryOf(plan), ...(withPlan ? { plan: clean(plan) } : {}),
    sizes: { ...sizes(doc, plan), ...(recipeJson !== undefined ? { recipeJson: utf8(JSON.stringify(recipeJson)) } : {}) },
  };
}

/** The same recipe through other seeds: the strip of variations (the seed writes the song; pins stay). */
async function variations({ recipe, count = 6 }) {
  const out = [];
  const base = String(recipe?.seed ?? '1');
  for (let i = 1; i <= count; i += 1) {
    const r = await music({ recipe: { ...recipe, seed: `${base}.${i}` }, plan: false });
    out.push({ seed: `${base}.${i}`, recipe: r.recipe, summary: r.summary, bytes: r.sizes.bytes });
  }
  return { base, variations: out };
}

/** Variants per sound (the palette's one-shots are arrays played in turn), worked out once per style at a low rate. */
const variantCache = new Map();
async function variantsOf(style) {
  const { audio } = await engine();
  const key = JSON.stringify(style);
  if (!variantCache.has(key)) {
    const data = audio.sfxSamples(style, 8000);
    variantCache.set(key, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1])));
    if (variantCache.size > 16) variantCache.delete(variantCache.keys().next().value);
  }
  return variantCache.get(key);
}

/** SFX settings checked and encoded (SFX_SETTINGS), the palette they make, and how every sound plays with them. */
async function sfx({ settings }) {
  const { audio, codec } = await engine();
  let value;
  try { value = codec.fromJSON(codec.SFX_SETTINGS, settings); } catch (error) { throw new Error(`Those sfx settings don't check out: ${error.message}`); }
  const bytes = codec.encode(codec.SFX_SETTINGS, value);
  const json = codec.toJSON(codec.SFX_SETTINGS, value);
  const style = audio.sfxStyle(value.seed, typeof value.style === 'string' ? value.style : Object.fromEntries(Object.entries(value.style).filter(([, v]) => v !== undefined)));
  const variants = await variantsOf(style);
  const sounds = {};
  for (const name of [...audio.SFX_NAMES, ...audio.LOOP_NAMES]) {
    const tuning = audio.tuningOf(value, name);
    const samples = name === 'step' ? ['step_stone', 'step_metal', 'step_water'].map((k) => variants[k] ?? 1) : [variants[name] ?? (name === 'land' ? variants.land : 1)];
    sounds[name] = { loop: audio.LOOP_NAMES.includes(name), variants: Math.max(...samples), jitter: audio.jitterOf(name, tuning), tuning: clean(tuning ?? null), play: clean(audio.paramsFor(name, {}, style, tuning)) };
  }
  const events = { ...BODY_EVENTS, ...(value.body?.events ?? {}) };
  return { settings: json, bytes: toBase64url(bytes), sizes: sizes(bytes, json), style: clean(style), sounds, events, surfaces: clean(value.body?.surfaces ?? {}) };
}

/** A project's sound file to the doc the Sound tab edits (recipes and the sfx settings in their JSON view). */
async function decodeSound({ content }) {
  const { codec } = await engine();
  const file = content ? readSoundFile(content) : { format: SOUND_FORMAT, music: [], assign: [], sfx: null };
  const doc = { music: [], assign: file.assign.map((a) => ({ ...a })), sfx: null };
  for (const m of file.music) {
    const bytes = fromBase64url(m.bytes);
    const kind = await kindOf(bytes);
    if (kind !== m.kind) throw new Error(`The music ${m.id} says it's a ${m.kind} but its bytes are a ${kind}.`);
    doc.music.push({ id: m.id, ...(m.title ? { title: m.title } : {}), kind, bytes: m.bytes, ...(kind === 'recipe' ? { recipe: codec.toJSON(codec.MUSIC_RECIPE, codec.decode(codec.MUSIC_RECIPE, bytes)) } : {}) });
  }
  if (file.sfx) doc.sfx = codec.toJSON(codec.SFX_SETTINGS, codec.decode(codec.SFX_SETTINGS, fromBase64url(file.sfx)));
  return { doc };
}

/** The doc back to the file's content: the sfx settings encoded; every record checked by decoding it again. */
async function encodeSound({ doc }) {
  const { codec } = await engine();
  let sfxBytes = null;
  if (doc.sfx) sfxBytes = toBase64url(codec.encode(codec.SFX_SETTINGS, codec.fromJSON(codec.SFX_SETTINGS, doc.sfx)));
  for (const m of doc.music) await kindOf(fromBase64url(m.bytes));
  return { content: writeSoundFile(fileOfDoc(doc, sfxBytes)) };
}

/** Every record's summary and sizes (what the tab lists and the assistant reads), and the file against its JSON. */
async function describe({ doc }) {
  const music_ = [];
  for (const m of doc.music) { const r = await music({ bytes: m.bytes, plan: false }); music_.push({ id: m.id, title: m.title ?? null, kind: r.kind, summary: r.summary, sizes: r.sizes }); }
  const effects = doc.sfx ? await sfx({ settings: doc.sfx }) : null;
  const { content } = await encodeSound({ doc });
  const records = music_.reduce((n, m) => n + m.sizes.bytes, 0) + (effects?.sizes.bytes ?? 0);
  const asJson = music_.reduce((n, m) => n + m.sizes.json, 0) + (effects?.sizes.json ?? 0);
  return { music: music_, sfx: effects, content, totals: { records, recordsJson: asJson, file: utf8(content) } };
}

/** The plan a music entry (or a recipe) plays: what the page is sent. */
async function planOf({ bytes, recipe }) { return (await music({ bytes, recipe })).plan; }

// ---------------------------------------------------------------- the audition page

let page;
/** The page: Tone and keel-audio (engine vendor/) as page scripts, then sound-preview.mjs bundled with the engine's audio. */
async function preview() {
  if (page) return page;
  const here = dirname(new URL(import.meta.url).pathname);
  const entry = [join(here, 'sound-preview.mjs'), join(workerData.sourceDir ?? '', 'sound-preview.mjs')].find((file) => file && existsSync(file));
  if (!entry) throw new Error('The sound preview script is missing from this build of the editor.');
  const vendor = join(root, 'vendor');
  const tone = ['tone-15.1.22-native.js'].map((name) => join(vendor, name)).find(existsSync);
  const keelAudio = ['keel-audio-1.0.0.min.js'].map((name) => join(vendor, name)).find(existsSync);
  if (!tone || !keelAudio) throw new Error(`The engine's vendor/ has no Tone or keel-audio (looked in ${vendor}).`);
  let esbuild;
  for (const from of [import.meta.url, pathToFileURL(join(root, 'package.json')).href]) { try { esbuild = createRequire(from)('esbuild'); break; } catch { /* Try the engine's own. */ } }
  if (!esbuild) throw new Error('The sound preview is bundled with esbuild, which this editor build could not find (a development feature, like the engine itself).');
  const plugin = { name: 'keel-engine-source', setup(b) { b.onResolve({ filter: /^@keel-engine\/[\w-]+$/ }, (a) => { const file = join(root, 'packages', a.path.slice('@keel-engine/'.length), 'src', 'index.ts'); return existsSync(file) ? { path: file } : undefined; }); } };
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, write: false, logLevel: 'silent', plugins: [plugin], legalComments: 'none' });
  const script = (text) => `<script>${text.replaceAll('</script', '<\\/script')}</script>`;
  const css = 'html,body{margin:0;height:100%;background:#0d0d15;color:#cfd3e6;font:11px ui-monospace,Menlo,monospace;overflow:hidden}#meter{position:absolute;inset:0;width:100%;height:100%}#label{position:absolute;left:10px;bottom:8px;right:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#9aa0bb}#state{position:absolute;left:10px;top:8px;color:#6f7590}';
  page = `<!doctype html><meta charset="utf-8"><title>KEEL sound preview</title><style>${css}</style><canvas id="meter"></canvas><div id="state">stopped</div><div id="label"></div>${script(readFileSync(tone, 'utf8'))}${script(readFileSync(keelAudio, 'utf8'))}${script(out.outputFiles[0].text)}`;
  return page;
}

const operations = { catalogue, music, variations, sfx, decodeSound, encodeSound, describe, planOf, preview };
parentPort.on('message', async ({ id, op, input }) => {
  try {
    const run = operations[op];
    if (!run) throw new Error(`Unknown sound operation ${op}.`);
    parentPort.postMessage({ id, result: await run(input ?? {}) });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message ?? error).slice(0, 4000) });
  }
});
