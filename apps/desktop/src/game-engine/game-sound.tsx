// The Sound tab of a Game project: music written by the engine's composer from
// a mood (or pins: tempo, key, scale, instruments, intensity), auditioned live
// in a sandboxed page (Tone and keel-audio as page scripts, the engine's audio
// playing), its seeded variations, a loop rendered to WAV; music assigned to
// scenes, levels, races and states; and the sound effects: a palette, the
// body's event table, footstep surfaces by material, each sound's tuning.
// Everything is stored as the codec's bytes (MUSIC_RECIPE or SONG, and
// SFX_SETTINGS) in sound/sound.json, and every change is a sound op -- from
// here or from the assistant -- on the live doc main keeps, saved by the
// creator. The renderer never loads engine code: recipes and ops go to main,
// plans and sizes come back as JSON, the page gets plans by postMessage.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Project, Shared } from '../types';
import { api } from '../client';
import { Badge, Empty, Field } from '../ui';
import { ASSIGN_KINDS, BODY_EVENTS, FOOTSTEP, SOUND_FILE, SOUND_ID, SOUND_PREVIEW_URL, soundFileOf, withSoundFile } from './sound-project.mjs';
import { CodecInspectorHost, openCodecInspector } from './codec-inspector';

type Op = { op: string; [field: string]: unknown };
type Catalogue = { bands: string[]; choices: Record<string, string[]>; weather: string[]; room: string[]; sounds: string[]; loops: string[]; styles: string[]; surfaces: string[]; shoes: string[] };
type Summary = { seed: string; theme: string; bpm: number; key: string; mode: string; keys: string; lead: string; bass: string; kit: string; loopBars: number; loopSec: number; form: string; weather: string[]; energy: number };
type Sizes = { bytes: number; gzip: number; json: number; jsonGz: number; recipeJson?: number };
type Music = { kind: 'recipe' | 'song'; bytes: string; recipe?: any; summary: Summary; plan?: any; sizes: Sizes };
type Entry = { id: string; title?: string; kind: 'recipe' | 'song'; bytes: string; recipe?: any };
type Doc = { music: Entry[]; assign: { kind: string; name: string; music: string }[]; sfx: any | null };
type Live = { seq: number; doc: Doc; content: string; saved: string; unsaved: boolean; audition: any; did: string[]; idle?: boolean };
type PageState = { context: string; playing: boolean; intensity: number; plays: number; sfxPlayed: number; lastSfx: string | null; renders: number; error: string | null; keelAudio: boolean };
type Status = { available: boolean; reason?: string };
type Draft = { mood: 'game' | 'band'; band: string; energy: number; darkness: number; weather: string[]; hue: string; seed: string; tempo: string; key: string; mode: string; keys: string; lead: string; bass: string; kit: string };

const DRAFT: Draft = { mood: 'game', band: '', energy: 0.6, darkness: 0.6, weather: ['hush'], hue: '', seed: '1', tempo: '', key: '', mode: '', keys: '', lead: '', bass: '', kit: '' };
const kb = (n: number) => n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
const pct = (a: number, b: number) => b ? `${(100 * a / b).toFixed(a / b < 0.1 ? 1 : 0)}%` : '—';

/** The draft as the codec's recipe JSON view (MUSIC_RECIPE): a game's moodFor words or a band preset, and pins. */
export function recipeOfDraft(d: Draft) {
  const pins = Object.fromEntries(([['tempo', d.tempo && Number.isFinite(Number(d.tempo)) ? Number(d.tempo) : ''], ['key', d.key], ['mode', d.mode], ['keys', d.keys], ['lead', d.lead], ['bass', d.bass], ['kit', d.kit]] as [string, unknown][]).filter(([, v]) => v !== ''));
  const hue = d.hue !== '' && Number.isFinite(Number(d.hue)) ? { hue: Number(d.hue) } : {};
  const base = d.mood === 'band' && d.band
    ? { from: 'mood', seed: d.seed || '1', mood: { band: d.band, energy: d.energy, ...hue } }
    : { from: 'game', seed: d.seed || '1', spec: { energy: d.energy, darkness: d.darkness, ...(d.weather.length ? { weather: d.weather } : {}), ...hue } };
  return Object.keys(pins).length ? { ...base, pins } : base;
}
/** A saved recipe back into the composer (a band given as an object isn't: edit that one in the codec inspector). */
export function draftOfRecipe(r: any): Draft | null {
  if (!r || (r.from !== 'game' && r.from !== 'mood')) return null;
  const pins = r.pins ?? {};
  const common = { ...DRAFT, seed: String(r.seed ?? '1'), tempo: pins.tempo !== undefined ? String(pins.tempo) : '', key: pins.key !== undefined ? String(pins.key) : '', mode: pins.mode ?? '', keys: pins.keys ?? '', lead: pins.lead ?? '', bass: pins.bass ?? '', kit: pins.kit ?? '' };
  if (r.from === 'game') return { ...common, mood: 'game', energy: r.spec?.energy ?? 0.5, darkness: r.spec?.darkness ?? 0.6, weather: Array.isArray(r.spec?.weather) ? r.spec.weather : r.spec?.weather ? [r.spec.weather] : [], hue: r.spec?.hue !== undefined ? String(r.spec.hue) : '' };
  if (typeof r.mood?.band !== 'string') return null;
  return { ...common, mood: 'band', band: r.mood.band, energy: r.mood.energy ?? 0.5, hue: r.mood.hue !== undefined ? String(r.mood.hue) : '' };
}

/** The sandboxed audition page: requests in (play, intensity, stop, sfx, render), answers and its state out. */
function usePage() {
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<PageState | null>(null);
  const pending = useRef(new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>());
  const seq = useRef(0);
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (!ref.current || event.source !== ref.current.contentWindow) return;
      const m = event.data;
      if (!m || typeof m !== 'object') return;
      if (m.state) setState(m.state);
      if (m.type === 'ready') setReady(true);
      else if (m.id && pending.current.has(m.id)) { const p = pending.current.get(m.id)!; pending.current.delete(m.id); if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m); }
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);
  const request = (message: Record<string, unknown>, ms = 60_000) => new Promise<any>((resolve, reject) => {
    const id = ++seq.current;
    pending.current.set(id, { resolve, reject });
    ref.current?.contentWindow?.postMessage({ ...message, id }, '*');
    setTimeout(() => { if (pending.current.delete(id)) reject(new Error('The sound page did not answer.')); }, ms);
  });
  return { ref, ready, state, request };
}

/** A project's Sound tab. */
export function SoundWorkspace({ project, change, persist, action }: { project: Project; change: (patch: Partial<Project>) => void; persist: (next?: Project) => Promise<any>; action: Shared['action'] }) {
  const status = useQuery<Status>({ queryKey: ['game-sound-status'], queryFn: () => api('gameStatus') });
  const available = !!status.data?.available;
  const catalogue = useQuery<Catalogue>({ queryKey: ['game-sound-catalogue'], queryFn: () => api('gameSoundCatalogue'), enabled: available });
  const saved = soundFileOf(project);
  const [live, setLive] = useState<Live | null>(null);
  const [message, setMessage] = useState('');
  const [intensity, setIntensity] = useState(0.5);
  const [nowPlaying, setNowPlaying] = useState('');
  const page = usePage();
  const handled = useRef(0);
  const docRef = useRef<Doc | null>(null);
  docRef.current = live?.doc ?? null;
  const apply = async (ops: Op[], label = '') => {
    setMessage('');
    const r = await api('gameSoundApply', { projectId: project.id, ops });
    if (!r.ok) { setMessage(r.errors.map((e: any) => e.message).join(' ')); return r; }
    setLive(r); if (label || r.did?.length) setMessage(label || r.did.join('; '));
    return r;
  };
  const run = (ops: Op[], label = '') => void action(async () => { await apply(ops, label); });
  // Open from the saved file (the same content keeps unsaved work), then wait for changes: the assistant's ops and auditions land here.
  useEffect(() => {
    if (!available) return;
    let alive = true;
    api('gameSoundOpen', { projectId: project.id, content: saved }).then((r: Live & { how: string }) => { if (alive) { setLive(r); if (r.how === 'reloaded') setMessage('Reloaded the saved sound.'); } }).catch((error: Error) => alive && setMessage(error.message));
    return () => { alive = false; };
  }, [available, project.id, saved]);
  useEffect(() => {
    if (!available) return;
    let alive = true, after = 0;
    (async () => {
      while (alive) {
        try {
          const next: Live = await api('gameSoundDoc', { projectId: project.id, after });
          if (!alive) break;
          if (next.seq > after) { after = next.seq; setLive(next); }
        } catch { await new Promise((resolve) => setTimeout(resolve, 800)); }
      }
    })();
    return () => { alive = false; };
  }, [available, project.id]);
  // An audition someone asked for (the assistant): play it, report what the page did.
  useEffect(() => {
    const a = live?.audition;
    if (!a || a.id <= handled.current || !page.ready) return;
    handled.current = a.id;
    void (async () => {
      let report: Record<string, unknown>;
      try { report = (await audition(a)).state ?? {}; } catch (error) { report = { error: (error as Error).message }; }
      await api('gameSoundReport', { id: a.id, report }).catch(() => {});
    })();
  }, [live?.audition?.id, page.ready]);

  async function playMusic(source: { bytes?: string; recipe?: any; plan?: any }, label: string, level = intensity) {
    const plan = source.plan ?? (await api('gameSoundMusic', source.bytes ? { bytes: source.bytes } : { recipe: source.recipe })).plan;
    const r = await page.request({ type: 'play', plan, intensity: level });
    setNowPlaying(label); setIntensity(level);
    return r;
  }
  async function playSfx(name: string, params: Record<string, unknown> = {}, settings = docRef.current?.sfx) {
    if (!settings) throw Error('Start the sound effects first (Palette, below).');
    const r = await page.request({ type: 'sfx', settings, name, params, loop: (catalogue.data?.loops ?? []).includes(name) });
    return r;
  }
  async function audition(a: any) {
    if (a.sfx) return playSfx(a.sfx, a.params ?? {});
    const entry = a.music ? docRef.current?.music.find((m) => m.id === a.music) : null;
    if (a.music && !entry && !a.plan && !a.recipe) throw Error(`No music ${a.music}.`);
    return playMusic(entry ? { bytes: entry.bytes } : a.plan ? { plan: a.plan } : { recipe: a.recipe }, `${entry?.title ?? entry?.id ?? 'assistant'}${a.label ? ` · ${a.label}` : ''}`, a.intensity ?? intensity);
  }
  async function save() {
    const content = live!.content;
    const next = withSoundFile(project, content) as Project;
    change({ files: next.files }); await persist(next);
    await api('gameSoundSaved', { projectId: project.id, content });
    setMessage(`Saved ${SOUND_FILE} to the project.`);
  }

  if (status.data && !available) return <div className="sound"><div className="notice game-unavailable"><strong>Game engine not connected</strong><p>{status.data.reason}</p></div></div>;
  const doc = live?.doc;
  return <div className="sound">
    <CodecInspectorHost project={project} />
    <div className="game-heading sound-heading"><div><div className="eyebrow">SOUND · MUSIC AND EFFECTS</div><h2>Give it a mood; the seed writes the song.</h2><p>Music is the engine's generative lo-fi, written from a mood or pins and stored as its recipe — a few dozen bytes — or as the song itself. Sound effects come from a seeded palette, mapped to the game's events and surfaces. Everything here is saved as codec bytes.</p></div>
      <div className="builder-actions"><Badge tone={live?.unsaved ? 'warm' : ''}>{live?.unsaved ? 'Unsaved sound changes' : 'Sound saved'}</Badge><button className="primary" disabled={!live} onClick={() => void action(save)}>Save sound</button></div></div>
    {message && <p role="status" className="notice builder-message">{message}</p>}
    <div className="sound-layout">
      <MusicComposer catalogue={catalogue.data} doc={doc} action={action} apply={apply} play={playMusic} setMessage={setMessage} />
      <section className="sound-stage">
        <div className="pane-title">AUDITION <Badge>engine audio · Tone {page.state?.keelAudio ? '+ keel-audio ' : ''}· sandboxed</Badge></div>
        <div className="sound-frame">{available && <iframe ref={page.ref} title="Sound preview" sandbox="allow-scripts" src={SOUND_PREVIEW_URL} />}</div>
        <div className="sound-transport">
          <span className={`sound-light ${page.state?.playing ? 'on' : ''}`} aria-hidden="true" />
          <span className="sound-now" aria-live="polite">{page.state?.playing ? `Playing ${nowPlaying}` : page.ready ? 'Stopped' : 'Loading the page…'}</span>
          <button disabled={!page.state?.playing} onClick={() => void action(async () => { await page.request({ type: 'stop' }); })}>■ Stop</button>
        </div>
        <Field label={`Intensity · ${intensity.toFixed(2)}${page.state?.playing ? ' (live)' : ''}`}><input aria-label="Intensity" type="range" min={0} max={1} step={0.01} value={intensity} onChange={(event) => { const value = Number(event.target.value); setIntensity(value); if (page.state?.playing) void page.request({ type: 'intensity', value }).catch(() => {}); }} /></Field>
        <p className="builder-hint">0: keys through a wall, soft drums, no tune. 0.5: as composed. 1: everything in and a busier kit. The loop runs on; only the layers move.</p>
        <p className="builder-hint">Audio context: <code>{page.state?.context ?? '—'}</code>{page.state?.error ? ` · ${page.state.error}` : ''}</p>
      </section>
      <div className="sound-side">
        <MusicLibrary doc={doc} project={project} action={action} run={run} apply={apply} play={playMusic} page={page} setMessage={setMessage} intensity={intensity} />
        <Assignments doc={doc} run={run} />
        <Sizes projectId={project.id} seq={live?.seq ?? 0} />
      </div>
    </div>
    <SoundEffects catalogue={catalogue.data} doc={doc} run={run} action={action} play={playSfx} />
  </div>;
}

function MusicComposer({ catalogue, doc, action, apply, play, setMessage }: { catalogue?: Catalogue; doc?: Doc; action: Shared['action']; apply: (ops: Op[], label?: string) => Promise<any>; play: (source: any, label: string, level?: number) => Promise<any>; setMessage: (value: string) => void }) {
  const [d, setD] = useState<Draft>(DRAFT);
  const [store, setStore] = useState<'recipe' | 'song'>('recipe');
  const [id, setId] = useState('theme');
  const [result, setResult] = useState<Music | null>(null);
  const [variations, setVariations] = useState<any[] | null>(null);
  const set = (patch: Partial<Draft>) => { setD((current) => ({ ...current, ...patch })); setResult(null); };
  const recipe = useMemo(() => recipeOfDraft(d), [d]);
  const choices = catalogue?.choices ?? {};
  const make = async () => { const r = await api('gameSoundMusic', { recipe, store }); setResult(r); return r as Music; };
  useEffect(() => { const load = (event: Event) => { const r = (event as CustomEvent).detail; const next = draftOfRecipe(r.recipe); if (next) { setD(next); setId(r.id); setResult(null); setMessage(`Loaded ${r.id} into the composer.`); } else setMessage(`${r.id} isn't a recipe the composer writes (a song, or a band written out): open it in the codec inspector.`); }; window.addEventListener('keel-sound-edit', load); return () => window.removeEventListener('keel-sound-edit', load); }, []);
  const pick = (label: string, key: keyof Draft, list: string[], note = 'from the seed') => <Field label={label}><select aria-label={label} value={String(d[key])} onChange={(event) => set({ [key]: event.target.value } as Partial<Draft>)}><option value="">{note}</option>{list.map((item) => <option key={item}>{item}</option>)}</select></Field>;
  return <section className="builder-section sound-composer open-section" aria-label="Music composer"><h3>Music</h3>
    <div className="builder-tabs sound-mood" role="tablist">{(['game', 'band'] as const).map((item) => <button key={item} role="tab" aria-selected={d.mood === item} className={d.mood === item ? 'selected' : ''} onClick={() => set({ mood: item, band: item === 'band' ? d.band || catalogue?.bands[0] || '' : d.band })}>{item === 'game' ? 'Game mood' : 'Band preset'}</button>)}</div>
    {d.mood === 'game' ? <>
      <Field label={`Energy · ${d.energy.toFixed(2)}`}><input aria-label="Energy" type="range" min={0} max={1} step={0.01} value={d.energy} onChange={(event) => set({ energy: Number(event.target.value) })} /></Field>
      <Field label={`Darkness · ${d.darkness.toFixed(2)}`}><input aria-label="Darkness" type="range" min={0} max={1} step={0.01} value={d.darkness} onChange={(event) => set({ darkness: Number(event.target.value) })} /></Field>
      <div className="sound-chips" role="group" aria-label="Weather">{(catalogue?.weather ?? []).map((item) => <button key={item} aria-pressed={d.weather.includes(item)} className={d.weather.includes(item) ? 'selected' : ''} onClick={() => set({ weather: d.weather.includes(item) ? d.weather.filter((w) => w !== item) : [...d.weather, item] })}>{item}</button>)}</div>
    </> : <><Field label="Band"><select aria-label="Band" value={d.band} onChange={(event) => set({ band: event.target.value })}>{(catalogue?.bands ?? []).map((item) => <option key={item}>{item}</option>)}</select></Field>
      <Field label={`Intensity it starts at · ${d.energy.toFixed(2)}`}><input aria-label="Starting intensity" type="range" min={0} max={1} step={0.01} value={d.energy} onChange={(event) => set({ energy: Number(event.target.value) })} /></Field></>}
    <h4>Pins</h4>
    <div className="builder-choices">
      <Field label="Tempo (bpm)"><input aria-label="Tempo" type="number" min={40} max={200} value={d.tempo} placeholder="from the seed" onChange={(event) => set({ tempo: event.target.value })} /></Field>
      {pick('Key', 'key', choices.key ?? [])}{pick('Scale', 'mode', choices.mode ?? [])}{pick('Keys', 'keys', choices.keys ?? [])}{pick('Lead', 'lead', choices.lead ?? [])}{pick('Bass', 'bass', choices.bass ?? [])}{pick('Kit', 'kit', choices.kit ?? [])}
      <Field label="Hue (key round the fifths)"><input aria-label="Hue" type="number" min={0} max={360} value={d.hue} placeholder="none" onChange={(event) => set({ hue: event.target.value })} /></Field>
    </div>
    <div className="builder-row"><Field label="Seed"><input aria-label="Music seed" value={d.seed} maxLength={64} onChange={(event) => set({ seed: event.target.value })} /></Field>
      <Field label="Store as"><select aria-label="Store as" value={store} onChange={(event) => { setStore(event.target.value as 'recipe' | 'song'); setResult(null); }}><option value="recipe">recipe (MUSIC_RECIPE)</option><option value="song">song (SONG, the plan)</option></select></Field></div>
    <div className="inline-actions"><button className="primary" onClick={() => void action(async () => { const r = await make(); await play({ plan: r.plan }, `${r.summary.theme} · seed ${r.summary.seed}`, d.energy); })}>▶ Audition</button><button onClick={() => void action(async () => { await make(); })}>Write it</button>
      <button onClick={() => void action(async () => setVariations((await api('gameSoundVariations', { recipe, count: 6 })).variations))}>Six variations</button></div>
    {result && <MusicCard music={result} />}
    {variations && <div className="sound-variations" aria-label="Variations">{variations.map((v) => <figure key={v.seed}><button className="sound-variation" onClick={() => void action(async () => { await play({ recipe: v.recipe }, `seed ${v.seed}`, d.energy); })} aria-label={`Audition variation ${v.seed}`}><strong>{v.summary.key} {v.summary.mode}</strong><span>{v.summary.bpm} bpm</span><small>{v.summary.keys} · {v.summary.lead} · {v.summary.kit}</small></button><figcaption>seed {v.seed} · {v.bytes} B <button className="text-button" onClick={() => set({ seed: v.seed })}>Use seed</button></figcaption></figure>)}</div>}
    <div className="builder-row"><Field label="Music id"><input aria-label="Music id" value={id} maxLength={63} onChange={(event) => setId(event.target.value.toLowerCase())} /></Field>
      <button disabled={!SOUND_ID.test(id)} onClick={() => void action(async () => { const exists = doc?.music.some((m) => m.id === id); await apply([{ op: 'music', id, recipe, store }], `${exists ? 'Replaced' : 'Added'} ${id} (${store}).`); })}>{doc?.music.some((m) => m.id === id) ? 'Replace in project' : 'Add to project'}</button></div>
  </section>;
}

function MusicCard({ music }: { music: Music }) {
  const s = music.summary, z = music.sizes;
  return <div className="sound-card"><div><strong>{s.key} {s.mode}</strong> · {s.bpm} bpm · {s.loopBars} bars ({s.loopSec} s) · energy {s.energy}</div>
    <small>{s.keys} keys · {s.lead} lead · {s.bass} bass · {s.kit} kit · form {s.form}{s.weather.length ? ` · ${s.weather.join(', ')}` : ''}</small>
    <div className="sound-sizes" aria-label="Sizes"><span><b>{z.bytes} B</b> as a {music.kind}</span><span>{z.gzip} B gzipped</span><span>{kb(z.json)} as the plan's JSON ({kb(z.jsonGz)} gz)</span><span>{pct(z.bytes, z.json)} of the JSON</span></div></div>;
}

function MusicLibrary({ doc, project, action, run, apply, play, page, setMessage, intensity }: { doc?: Doc; project: Project; action: Shared['action']; run: (ops: Op[], label?: string) => void; apply: (ops: Op[], label?: string) => Promise<any>; play: (source: any, label: string, level?: number) => Promise<any>; page: ReturnType<typeof usePage>; setMessage: (value: string) => void; intensity: number }) {
  const [rate, setRate] = useState(22050);
  const [rendering, setRendering] = useState('');
  const renderWav = (entry: Entry) => void action(async () => {
    setRendering(entry.id);
    try {
      const plan = (await api('gameSoundMusic', { bytes: entry.bytes })).plan;
      const r = await page.request({ type: 'render', plan, rate, intensity }, 240_000);
      const saved = await api('gameSoundSaveWav', { name: `${project.title}-${entry.id}`, bytes: new Uint8Array(r.wav) });
      setMessage(saved ? `Rendered ${entry.id}: ${r.seconds.toFixed(1)} s loop, seam ${r.measure.seam?.toFixed?.(3) ?? '—'}, saved ${saved.file} (${kb(saved.bytes)}).` : `Rendered ${entry.id} (${r.seconds.toFixed(1)} s); not saved.`);
    } finally { setRendering(''); }
  });
  return <details className="builder-section" open><summary>Music · {doc?.music.length ?? 0}</summary>
    {!doc?.music.length && <p className="builder-hint">Write music in the composer, then add it to the project.</p>}
    {doc?.music.map((m) => <div className="sound-row" key={m.id}><div><strong>{m.title ?? m.id}</strong><small>{m.kind} · {Math.floor(m.bytes.length * 3 / 4)} B{m.title ? ` · ${m.id}` : ''}</small></div>
      <div className="inline-actions"><button aria-label={`Play ${m.id}`} onClick={() => void action(async () => { await play({ bytes: m.bytes }, m.title ?? m.id); })}>▶</button>
        {m.kind === 'recipe' && <button className="text-button" onClick={() => window.dispatchEvent(new CustomEvent('keel-sound-edit', { detail: m }))}>Edit</button>}
        <button className="text-button" onClick={() => openCodecInspector({ text: m.bytes, label: `${SOUND_FILE} · music ${m.id} (${m.kind})` }, { onApply: (r) => void action(async () => { await apply([{ op: 'music', id: m.id, bytes: r.base64url }], `${m.id}: the inspector's bytes (${r.bytes} B).`); }) })}>Inspect bytes</button>
        <button className="text-button" disabled={!!rendering} onClick={() => renderWav(m)}>{rendering === m.id ? 'Rendering…' : 'Loop → WAV'}</button>
        <button className="text-button" onClick={() => run([{ op: 'unmusic', id: m.id }])}>Remove</button></div></div>)}
    <Field label="WAV rate"><select aria-label="WAV rate" value={rate} onChange={(event) => setRate(Number(event.target.value))}><option value={22050}>22.05 kHz (smaller)</option><option value={44100}>44.1 kHz</option></select></Field>
    <p className="builder-hint">A loop renders offline from four bars before its top, so it repeats with no seam; it is saved where you choose.</p>
  </details>;
}

function Assignments({ doc, run }: { doc?: Doc; run: (ops: Op[], label?: string) => void }) {
  const [kind, setKind] = useState('scene');
  const [name, setName] = useState('');
  const [music, setMusic] = useState('');
  const list = doc?.assign ?? [];
  const ids = doc?.music.map((m) => m.id) ?? [];
  return <details className="builder-section" open><summary>Plays where · {list.length}</summary>
    <p className="builder-hint">Which music a scene, level, race or state plays. The game reads the names.</p>
    {list.length > 0 && <table className="game-table sound-assign"><tbody>{list.map((a) => <tr key={`${a.kind}:${a.name}`}><td><Badge>{a.kind}</Badge></td><td>{a.name}</td><td><select aria-label={`Music for ${a.kind} ${a.name}`} value={a.music} onChange={(event) => run([{ op: 'assign', kind: a.kind, name: a.name, music: event.target.value }])}>{ids.map((item) => <option key={item}>{item}</option>)}</select></td><td><button className="text-button" onClick={() => run([{ op: 'unassign', kind: a.kind, name: a.name }])}>✕</button></td></tr>)}</tbody></table>}
    <div className="builder-row"><Field label="Kind"><select aria-label="Assign kind" value={kind} onChange={(event) => setKind(event.target.value)}>{ASSIGN_KINDS.map((item: string) => <option key={item}>{item}</option>)}</select></Field><Field label="Name"><input aria-label="Assign name" value={name} maxLength={80} placeholder="menu, level-1, boss…" onChange={(event) => setName(event.target.value)} /></Field></div>
    <div className="inline-actions"><select aria-label="Assign music" value={music} onChange={(event) => setMusic(event.target.value)}><option value="">Choose music…</option>{ids.map((item) => <option key={item}>{item}</option>)}</select><button disabled={!name.trim() || !music} onClick={() => { run([{ op: 'assign', kind, name: name.trim(), music }]); setName(''); }}>Assign</button></div>
  </details>;
}

function Sizes({ projectId, seq }: { projectId: string; seq: number }) {
  const d = useQuery<any>({ queryKey: ['game-sound-describe', projectId, seq], queryFn: () => api('gameSoundDescribe', { projectId }), enabled: seq > 0 });
  if (!d.data) return null;
  const t = d.data.totals;
  return <div className="measurement-grid sound-totals"><div><span>CODEC RECORDS</span><strong>{kb(t.records)}</strong><small>{d.data.music.length} music{d.data.sfx ? ' + sfx settings' : ''}</small></div><div><span>AS JSON</span><strong>{kb(t.recordsJson)}</strong><small>the plans and settings they stand for · {pct(t.records, t.recordsJson)}</small></div><div><span>{SOUND_FILE.toUpperCase()}</span><strong>{kb(t.file)}</strong><small>the file with its envelope</small></div></div>;
}

function SoundEffects({ catalogue, doc, run, action, play }: { catalogue?: Catalogue; doc?: Doc; run: (ops: Op[], label?: string) => void; action: Shared['action']; play: (name: string, params?: Record<string, unknown>) => Promise<any> }) {
  const settings = doc?.sfx ?? null;
  const described = useQuery<any>({ queryKey: ['game-sound-sfx', JSON.stringify(settings)], queryFn: () => api('gameSoundSfx', { settings }), enabled: !!settings });
  const style = settings ? (typeof settings.style === 'string' ? { name: settings.style } : settings.style ?? {}) : {};
  const [seed, setSeed] = useState('sfx');
  const [styleName, setStyleName] = useState('lofi');
  const [shoe, setShoe] = useState('');
  useEffect(() => { if (settings) { setSeed(String(settings.seed)); setStyleName(style.name ?? 'lofi'); setShoe(style.shoe ?? ''); } }, [settings?.seed, JSON.stringify(settings?.style)]);
  const [event, setEvent] = useState('');
  const [eventSound, setEventSound] = useState('jump');
  const [material, setMaterial] = useState('');
  const [surface, setSurface] = useState('stone');
  const all = [...(catalogue?.sounds ?? []), ...(catalogue?.loops ?? [])];
  const events: Record<string, string> = { ...BODY_EVENTS, ...(settings?.body?.events ?? {}) };
  const custom = settings?.body?.events ?? {};
  const surfaces: Record<string, string> = settings?.body?.surfaces ?? {};
  const sounds = described.data?.sounds ?? {};
  const palette = () => run([{ op: 'palette', seed, style: shoe ? { name: styleName, shoe } : styleName }]);
  const listen = (name: string, params: Record<string, unknown> = {}) => void action(async () => { await play(name, params); });
  const tuneInput = (sound: string, field: 'gain' | 'rate' | 'pan' | 'jitter', min: number, max: number, step: number, value: number) => <input aria-label={`${sound} ${field}`} type="number" min={min} max={max} step={step} defaultValue={Number(value.toFixed(3))} key={`${sound}:${field}:${value}`} onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= min && v <= max && Math.abs(v - value) > 1e-9) run([{ op: 'tune', sound, [field]: v }]); }} />;
  return <section className="sound-effects" aria-label="Sound effects"><div className="section-line"><h2>Sound effects</h2><span>{settings ? `SFX_SETTINGS · ${described.data ? `${described.data.sizes.bytes} B (JSON ${described.data.sizes.json} B)` : '…'}` : 'none yet'}</span></div>
    <div className="sound-fx-grid">
      <div className="builder-section open-section"><h3>Palette</h3><p className="builder-hint">The seed picks the project's sound palette: shoes, pitch, brightness, how worn, the rails' metal, the water, the UI's key. A style colours it.</p>
        <div className="builder-row"><Field label="Seed"><input aria-label="Sfx seed" value={seed} maxLength={64} onChange={(e) => setSeed(e.target.value)} /></Field><Field label="Style"><select aria-label="Sfx style" value={styleName} onChange={(e) => setStyleName(e.target.value)}>{(catalogue?.styles ?? ['lofi']).map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Shoes"><select aria-label="Sfx shoes" value={shoe} onChange={(e) => setShoe(e.target.value)}><option value="">from the seed</option>{(catalogue?.shoes ?? []).map((item) => <option key={item}>{item}</option>)}</select></Field></div>
        <div className="inline-actions"><button className="primary" onClick={palette}>{settings ? 'Apply palette' : 'Start sound effects'}</button>{settings && <Field label={`Volume · ${settings.volume}`}><input aria-label="Sfx volume" type="range" min={0} max={1} step={0.05} defaultValue={settings.volume} onPointerUp={(e) => run([{ op: 'palette', volume: Number((e.target as HTMLInputElement).value) }])} onKeyUp={(e) => run([{ op: 'palette', volume: Number((e.target as HTMLInputElement).value) }])} /></Field>}</div>
        {described.data && <p className="builder-hint">Palette: {described.data.style.shoe} shoes · pitch {Number(described.data.style.pitch).toFixed(2)} · bright {Number(described.data.style.bright).toFixed(2)} · {described.data.style.bits} bits · {described.data.style.wave} UI in key {described.data.style.tonic}</p>}
        {settings && <div className="sound-chips" aria-label="UI sounds">{['blip', 'hover', 'select', 'back', 'confirm', 'error'].map((name) => <button key={name} onClick={() => listen(name)}>▶ {name}</button>)}</div>}
      </div>
      {settings ? <div className="builder-section open-section sound-events"><h3>Events</h3><p className="builder-hint">What each game event plays. Tuning (gain, rate, jitter) belongs to the sound, so every event playing it hears the same. Variations are the palette's takes, played in turn.</p>
        <div className="game-table-wrap"><table className="game-table sound-event-table"><thead><tr><th>Event</th><th>Sound</th><th>Variations</th><th>Jitter ±</th><th>Gain</th><th>Rate</th><th></th></tr></thead><tbody>
          {Object.entries(events).map(([name, sound]) => { const info = sounds[sound] ?? {}; const t = info.tuning ?? {}; return <tr key={name}><td><strong>{name}</strong>{name in custom ? <small>{name in BODY_EVENTS ? 'remapped' : 'custom'}</small> : <small>built in</small>}</td>
            <td><select aria-label={`Sound for ${name}`} value={sound} onChange={(e) => run([{ op: 'event', event: name, sound: e.target.value }])}>{all.map((item) => <option key={item}>{item}</option>)}</select></td>
            <td>{info.variants ?? '—'}</td><td>{tuneInput(sound, 'jitter', 0, 1, 0.005, info.jitter ?? 0)}</td><td>{tuneInput(sound, 'gain', 0, 2, 0.05, t.gain ?? 1)}</td><td>{tuneInput(sound, 'rate', 0.25, 4, 0.05, t.rate ?? 1)}</td>
            <td><button aria-label={`Audition ${name}`} onClick={() => listen(sound, name === 'landed' ? { speed: 8 } : {})}>▶</button>{name in custom && <button className="text-button" aria-label={`Unmap ${name}`} onClick={() => run([{ op: 'unevent', event: name }])}>✕</button>}</td></tr>; })}
          <tr><td><strong>{FOOTSTEP}</strong><small>footsteps · by surface</small></td><td>{FOOTSTEP}</td><td>{sounds.step?.variants ?? '—'}</td><td>{tuneInput('step', 'jitter', 0, 1, 0.005, sounds.step?.jitter ?? 0.035)}</td><td>{tuneInput('step', 'gain', 0, 2, 0.05, sounds.step?.tuning?.gain ?? 1)}</td><td>{tuneInput('step', 'rate', 0.25, 4, 0.05, sounds.step?.tuning?.rate ?? 1)}</td><td><button aria-label="Audition step" onClick={() => listen('step', { surface: 'stone', speed: 6 })}>▶</button></td></tr>
        </tbody></table></div>
        <div className="inline-actions"><input aria-label="New event" value={event} maxLength={40} placeholder="new event (e.g. ledgeGrab)" onChange={(e) => setEvent(e.target.value)} /><select aria-label="New event sound" value={eventSound} onChange={(e) => setEventSound(e.target.value)}>{all.map((item) => <option key={item}>{item}</option>)}</select><button disabled={!/^[a-zA-Z][a-zA-Z0-9_.-]{0,39}$/.test(event)} onClick={() => { run([{ op: 'event', event, sound: eventSound }]); setEvent(''); }}>Map event</button></div>
      </div> : <Empty title="No sound effects yet">Start them with a palette: every sound comes from its seed, nothing is fetched.</Empty>}
      {settings && <div className="builder-section open-section"><h3>Footsteps by material</h3><p className="builder-hint">A footstep plays the surface the material underfoot maps to (stone, metal, water); the game says what is underfoot.</p>
        {Object.entries(surfaces).map(([mat, surf]) => <div className="builder-list-row" key={mat}><span><strong>{mat}</strong></span><select aria-label={`Surface for ${mat}`} value={surf} onChange={(e) => run([{ op: 'surface', material: mat, surface: e.target.value }])}>{(catalogue?.surfaces ?? []).map((item) => <option key={item}>{item}</option>)}</select><button aria-label={`Audition ${mat}`} onClick={() => listen('step', { surface: surf, speed: 6 })}>▶</button><button className="text-button" aria-label={`Unmap ${mat}`} onClick={() => run([{ op: 'unsurface', material: mat }])}>✕</button></div>)}
        <div className="inline-actions"><input aria-label="Material" value={material} maxLength={40} placeholder="material (e.g. rail, grass)" onChange={(e) => setMaterial(e.target.value)} /><select aria-label="Material surface" value={surface} onChange={(e) => setSurface(e.target.value)}>{(catalogue?.surfaces ?? []).map((item) => <option key={item}>{item}</option>)}</select><button disabled={!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,39}$/.test(material)} onClick={() => { run([{ op: 'surface', material, surface }]); setMaterial(''); }}>Map material</button></div>
        <div className="inline-actions">{(catalogue?.surfaces ?? []).map((item) => <button key={item} onClick={() => listen('step', { surface: item, speed: 6 })}>▶ step on {item}</button>)}</div>
        {described.data && <button className="text-button" onClick={() => openCodecInspector({ text: described.data.bytes, label: `${SOUND_FILE} · sfx settings` })}>Inspect the SFX_SETTINGS bytes</button>}
      </div>}
    </div>
  </section>;
}
