// The Level tab of a Game project: a world or level editor over the engine's
// world generation. The RECIPE (a generator pipeline: overworld, dungeons,
// caves, towns, keel/level's templates, re-skins; masks, pins, lock text; a
// seed and its strip of variations) regenerates live; PAINT tools (biome,
// material, raise / lower / flatten, ramps, water, rivers, roads, lock
// regions) and PLACE tools (pack objects, spawns, resources, markers) make
// level ops -- every one undoable, and a regenerate replays them over the new
// ground while lock regions keep their tiles. The preview is the engine's own
// ground baker and sprites in a sandboxed frame (pan, zoom, an infinite world
// streamed); dungeons show their room graph, multiplayer maps their fairness,
// tilesets their autotile. Saved as codec records in levels/<name>.level. The
// renderer never loads engine code: ops go to main, states and snapshots come
// back as JSON, the frame gets snapshots by postMessage.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Project, Shared, Workspace } from '../types';
import { api, queryClient } from '../client';
import { Badge, Empty, Field } from '../ui';
import { LEVEL_NAME, LEVEL_PREVIEW_URL, LEVEL_PRESETS, MASK_KINDS, RESOURCE_KINDS, SEASONS, STAGE_PARAMS, TILESET_LAYOUTS, fromBase64url, levelFileName, levelFileOf, pathThrough, projectLevels, readLevelFile, withLevelFile } from './level-project.mjs';
import { CodecInspectorHost, openCodecInspector } from './codec-inspector';

type Op = { op: string; [field: string]: unknown };
type Stage = { id: string; use: string; seed?: string; params?: Record<string, any>; mask?: any };
type Recipe = { seed: string; width: number; depth: number; act?: string | null; stages: Stage[]; pins?: any[]; locks?: string; [key: string]: unknown };
type LevelState = { name: string; gen: number; version: number; recipe: Recipe; players: number; finite: boolean; size: [number, number]; genMs: number; counts: Record<string, number>; spawns: any[]; resources: any[]; locks: any[]; markers: any[]; things: any[]; history: { undo: number; redo: number; frozen: number }; skipped: { op: string; why: string }[]; did: string[]; note: string; tileset: any; fairness: any; dungeons: any[] };
type Live = { name: string; seq: number; state: LevelState; snapshot: any; saved: string; unsaved: boolean; did: string[]; errors: { message: string }[]; idle?: boolean };
type Catalogue = { stages: { use: string; local: boolean; describe: string; params: any[] }[]; biomes: { id: string; kind: string }[]; acts: { id: string; name: string; theme: string }[]; types: string[]; algorithms: string[]; themes: string[]; rooms: { id: string; roles: string[]; rows: string[] }[]; packs: { id: string; objects: { id: string; tags: string[]; tier: string | null; choices: Record<string, unknown> }[] }[]; resourceKinds: string[] };
type Status = { available: boolean; reason?: string };
type Tool = { tool: string; radius: number };

const TOOLS: { id: string; label: string; hint: string; group: 'view' | 'paint' | 'place' }[] = [
  { id: 'pan', label: 'Pan', group: 'view', hint: 'Drag to pan, scroll to zoom (any tool pans with the right button).' },
  { id: 'biome', label: 'Biome', group: 'paint', hint: 'Paint a biome: its materials, colours and plants. Kept through a regenerate.' },
  { id: 'material', label: 'Material', group: 'paint', hint: 'Paint a terrain material.' },
  { id: 'raise', label: 'Raise', group: 'paint', hint: 'Raise the ground a step under the brush.' },
  { id: 'lower', label: 'Lower', group: 'paint', hint: 'Lower the ground a step.' },
  { id: 'flatten', label: 'Flatten', group: 'paint', hint: 'Flatten to the height where the stroke starts.' },
  { id: 'ramp', label: 'Ramp', group: 'paint', hint: 'Click a tile below a one-step rise: a ramp climbs it.' },
  { id: 'water', label: 'Water', group: 'paint', hint: 'Click a basin: water fills it to the level above the tile.' },
  { id: 'river', label: 'River', group: 'paint', hint: 'Drag from the source: a river carves down along it.' },
  { id: 'road', label: 'Road', group: 'paint', hint: 'Drag a road (or a path).' },
  { id: 'lock', label: 'Lock', group: 'paint', hint: 'Drag a rectangle: a regenerate keeps everything in it.' },
  { id: 'place', label: 'Place', group: 'place', hint: 'Click to place the chosen object.' },
  { id: 'spawn', label: 'Spawn', group: 'place', hint: 'Click a player\'s main base.' },
  { id: 'resource', label: 'Resource', group: 'place', hint: 'Click to add a resource node.' },
  { id: 'marker', label: 'Marker', group: 'place', hint: 'Click to add a named marker for scripts.' },
  { id: 'erase', label: 'Erase', group: 'place', hint: 'Click a thing, spawn, resource, marker or lock region to remove it.' },
];
const SWAPS = ['', 'desert', 'forest', 'taiga', 'jungle', 'savanna', 'snowy-peaks', 'badlands', 'volcanic', 'corruption', 'alien'];
const kb = (n: number) => n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
const pct = (a: number, b: number) => b ? `${(100 * a / b).toFixed(a / b < 0.1 ? 1 : 0)}%` : '—';
const cleanParams = (p: Record<string, any> = {}) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== undefined && !(Array.isArray(v) && !v.length)));

/** The sandboxed preview frame: snapshots and settings in; dabs, paths, rectangles and clicks out. */
function usePreview(handlers: { dab: (m: any) => void; path: (m: any) => void; rect: (m: any) => void; click: (m: any) => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState('');
  const [hover, setHover] = useState<number[] | null>(null);
  const h = useRef(handlers); h.current = handlers;
  const pending = useRef(new Map<number, (value: any) => void>());
  const seq = useRef(0);
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (!ref.current || event.source !== ref.current.contentWindow) return;
      const m = event.data;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'ready') { setReady(true); if (!m.webgl) setError('The preview needs WebGL2, which this display does not offer.'); }
      else if (m.type === 'applied') setApplied(m.key);
      else if (m.type === 'hover') setHover(m.at);
      else if (m.type === 'dab') h.current.dab(m);
      else if (m.type === 'path') h.current.path(m);
      else if (m.type === 'rect') h.current.rect(m);
      else if (m.type === 'click') h.current.click(m);
      else if (m.id && pending.current.has(m.id)) { pending.current.get(m.id)!(m); pending.current.delete(m.id); }
      else if (m.type === 'error') setError(String(m.message));
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);
  const post = (message: Record<string, unknown>) => ref.current?.contentWindow?.postMessage(message, '*');
  const request = (message: Record<string, unknown>) => new Promise<any>((resolve) => { const id = ++seq.current; pending.current.set(id, resolve); post({ ...message, id }); setTimeout(() => { if (pending.current.delete(id)) resolve(null); }, 20_000); });
  return { ref, ready, error, applied, hover, post, request };
}

/** A project's Level tab. */
export function LevelWorkspace({ project, change, persist, action }: { project: Project; change: (patch: Partial<Project>) => void; persist: (next?: Project) => Promise<any>; action: Shared['action'] }) {
  const status = useQuery<Status>({ queryKey: ['game-level-status'], queryFn: () => api('gameStatus') });
  const available = !!status.data?.available;
  const catalogue = useQuery<Catalogue>({ queryKey: ['game-level-catalogue'], queryFn: () => api('gameLevelCatalogue'), enabled: available, staleTime: 60_000 });
  const levels: { name: string; file: string; content: string }[] = projectLevels(project);
  const [name, setName] = useState<string>(levels[0]?.name ?? '');
  const [live, setLive] = useState<Live | null>(null);
  const [message, setMessage] = useState('');
  const [tool, setTool] = useState<Tool>({ tool: 'pan', radius: 3 });
  const [brush, setBrush] = useState({ biome: 'desert', material: 'sand', waterDepth: 1, roadKind: 'road', riverWidth: 2, player: 0, resource: 'mass', markerKind: 'relic', pack: 'packs/buildings', object: 'cottage', pins: '{}', yaw: 0, scale: 1, tier: 'foreground' });
  const [view, setView] = useState({ season: 'summer', swap: '', style: 'pixel', plants: true, overlays: { locks: true, graph: true, markers: true } });
  const saved = name ? levelFileOf(project, name) : '';
  const state = live?.state;
  const sent = useRef('');
  const justSaved = useRef('');
  const firstOfGen = useRef('');
  const dabs = useRef<Op[]>([]);
  const flushing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const b = useRef(brush); b.current = brush;
  const st = useRef(state); st.current = state;
  const apply = async (ops: Op[], label = '') => {
    const r = await api('gameLevelApply', { projectId: project.id, ops });
    setLive((current) => (current && current.seq > r.seq ? current : r));
    setMessage(r.ok ? (label || r.did.slice(-3).join('; ')) : r.errors.map((e: any) => e.message).join(' '));
    return r;
  };
  const run = (ops: Op[], label = '') => void action(async () => { await apply(ops, label); });
  const flush = () => { flushing.current = null; const ops = dabs.current; dabs.current = []; if (ops.length) void apply(ops).catch((error) => setMessage(error.message)); };
  const queueOp = (op: Op) => { dabs.current.push(op); if (!flushing.current) flushing.current = setTimeout(flush, 70); };
  const tileHeight = (pos: number[]) => Math.round((pos?.[1] ?? 0) / (live?.snapshot?.stepHeight ?? 1));
  const preview = usePreview({
    dab: (m) => {
      const x = b.current, at = m.at;
      queueOp(m.tool === 'biome' ? { op: 'biome', biome: x.biome, at, radius: tool.radius, stroke: m.stroke } : m.tool === 'material' ? { op: 'paint', type: x.material, at, radius: Math.max(0.5, tool.radius), stroke: m.stroke } : { op: 'brush', mode: m.tool, at, radius: tool.radius, stroke: m.stroke });
    },
    path: (m) => run([m.tool === 'river' ? { op: 'river', path: m.tiles, width: b.current.riverWidth, stroke: m.stroke } : { op: 'road', path: pathThrough(m.tiles), kind: b.current.roadKind, stroke: m.stroke }]),
    rect: (m) => { if (m.tool === 'lock') { const ids = new Set((st.current?.locks ?? []).map((l: any) => l.id)); let n = 0; while (ids.has(`lock-${n}`)) n += 1; run([{ op: 'lockRegion', id: `lock-${n}`, rect: m.rect }]); } else run([{ op: 'drain', rect: m.rect }]); },
    click: (m) => {
      const x = b.current, T = live?.snapshot?.tileSize ?? 2, at = m.at, pos = [(at[0] + 0.5) * T, m.pos?.[1] ?? 0, (at[1] + 0.5) * T];
      let pins = {};
      try { pins = JSON.parse(x.pins || '{}'); } catch { setMessage('Pins are JSON: {"floors": 2}.'); return; }
      const op: Op | null = m.tool === 'ramp' ? { op: 'ramp', at, width: Math.max(1, Math.round(tool.radius)) }
        : m.tool === 'water' ? { op: 'water', at, level: tileHeight(m.pos) + x.waterDepth }
        : m.tool === 'place' ? { op: 'place', pack: x.pack, object: x.object, pos, yaw: x.yaw, scale: x.scale, pins, tier: x.tier, layer: x.pack === 'packs/buildings' ? 'buildings' : 'props' }
        : m.tool === 'spawn' ? { op: 'spawn', player: x.player, at }
        : m.tool === 'resource' ? { op: 'resource', kind: x.resource, at }
        : m.tool === 'marker' ? { op: 'marker', id: `${x.markerKind}-${Date.now().toString(36)}`, kind: x.markerKind, pos }
        : m.tool === 'erase' ? (m.hit ? (m.hit.kind === 'lock' ? { op: 'unlockRegion', id: m.hit.id } : { op: 'remove', id: m.hit.id }) : null)
        : null;
      if (m.tool === 'erase' && !m.hit) setMessage('Nothing to erase there.');
      if (op) run([op]);
    },
  });

  // Open the chosen level from its saved file (the same content keeps unsaved work); then wait for changes (the assistant's land here too).
  useEffect(() => {
    if (!available || !name) return;
    let alive = true;
    if (!saved || justSaved.current === saved) return;
    api('gameLevelOpen', { projectId: project.id, name, content: saved }).then((r: Live & { how: string }) => { if (alive) { setLive(r); if (r.how === 'reloaded') setMessage(`Reloaded ${levelFileName(name)}.`); } }).catch((error: Error) => alive && setMessage(error.message));
    return () => { alive = false; };
  }, [available, project.id, name, saved]);
  useEffect(() => {
    if (!available) return;
    let alive = true, after = 0;
    (async () => {
      while (alive) {
        try {
          const next: Live = await api('gameLevelDoc', { projectId: project.id, after });
          if (!alive) break;
          if (next.seq > after) { after = next.seq; if (next.name) { setLive(next); setName((current) => current || next.name); } }
        } catch { await new Promise((resolve) => setTimeout(resolve, 800)); }
      }
    })();
    return () => { alive = false; };
  }, [available, project.id]);
  // The frame gets each new snapshot (fitted to the view when the ground's size changes).
  useEffect(() => {
    const snap = live?.snapshot;
    if (!preview.ready || !snap || sent.current === snap.key) return;
    const shape = `${live!.name}|${snap.kind}|${snap.w}x${snap.d}`;
    preview.post({ type: 'snapshot', snap, fit: firstOfGen.current !== shape });
    firstOfGen.current = shape; sent.current = snap.key;
  }, [preview.ready, live?.snapshot?.key]);
  useEffect(() => { if (preview.ready) preview.post({ type: 'tool', ...tool }); }, [preview.ready, tool]);
  useEffect(() => { if (preview.ready) preview.post({ type: 'view', ...view }); }, [preview.ready, view]);
  // A level saved with a tileset draws with it: the atlas cut again from Files, handed to the frame.
  const tilesetKey = state?.tileset ? `${state.tileset.objectId}:${JSON.stringify(state.tileset.rules)}` : '';
  useEffect(() => {
    if (!preview.ready || !state?.tileset) return;
    void api('gameLevelTileset', { objectId: state.tileset.objectId, rules: state.tileset.rules }).then((r: any) => preview.request({ type: 'tileset', tileset: { width: r.width, height: r.height, rgba: r.rgba, rules: r.rules }, apply: true })).catch((error: Error) => setMessage(`The level's tileset: ${error.message}`));
  }, [preview.ready, tilesetKey]);

  async function create(preset: string, levelNameText: string) {
    if (!LEVEL_NAME.test(levelNameText)) throw Error('Name the level like valley or crypt-1.');
    if (levels.some((l) => l.name === levelNameText)) throw Error(`${levelFileName(levelNameText)} already exists: open it from the list.`);
    const r = await api('gameLevelOpen', { projectId: project.id, name: levelNameText, preset });
    setName(levelNameText); setLive(r); setMessage(`New level ${levelNameText} from the ${LEVEL_PRESETS[preset as keyof typeof LEVEL_PRESETS].title.toLowerCase()} preset: save it to keep it.`);
  }
  async function save() {
    const { content } = await api('gameLevelEncode', { projectId: project.id });
    const next = withLevelFile(project, live!.name, content) as Project;
    // (The tab's own save: the open level already is this content, so the file changing doesn't reopen it.)
    justSaved.current = content;
    change({ files: next.files }); await persist(next);
    await api('gameLevelSaved', { projectId: project.id, name: live!.name, content });
    setMessage(`Saved ${levelFileName(live!.name)} (${kb(content.length)}).`);
    void queryClient.invalidateQueries({ queryKey: ['game-level-sizes'] });
  }

  if (status.data && !available) return <div className="level"><div className="notice game-unavailable"><strong>Game engine not connected</strong><p>{status.data.reason}</p></div></div>;
  const cat = catalogue.data;
  const current = TOOLS.find((t) => t.id === tool.tool)!;
  return <div className="level">
    <CodecInspectorHost project={project} />
    <div className="game-heading level-heading"><div><div className="eyebrow">LEVEL · WORLD EDITOR</div><h2>Grow the world, then make it yours.</h2><p>A level is a recipe the engine generates — overworlds, dungeons, caves, towns — and the hand edits you paint over it. Change the recipe and the ground regenerates under your edits; lock a region and it stays exactly as you left it. Saved as codec records.</p></div>
      <div className="builder-actions"><Badge tone={live?.unsaved ? 'warm' : ''}>{!live ? 'No level open' : live.unsaved ? 'Unsaved level changes' : 'Level saved'}</Badge><button className="primary" disabled={!live} onClick={() => void action(save)}>Save level</button></div></div>
    <LevelBar levels={levels.map((l) => l.name)} name={name} live={live} setName={setName} action={action} create={create} />
    {message && <p role="status" className="notice builder-message">{message}</p>}
    {state?.note && <p className="notice">{state.note}</p>}
    {!!state?.skipped?.length && <p role="alert" className="notice">The last regenerate dropped {state.skipped.length} hand edit{state.skipped.length === 1 ? '' : 's'} that no longer fit: {state.skipped.slice(0, 4).map((s) => `${s.op} (${s.why})`).join('; ')}.</p>}
    {!live && <Empty title={levels.length ? 'Open a level' : 'Start a level'}>{levels.length ? 'Choose a level above.' : 'Name it and pick a starting recipe above: an infinite overworld, an island, a mixed map, a dungeon floor or an RTS arena.'}</Empty>}
    {live && state && <div className="level-layout">
      <RecipePanel state={state} cat={cat} run={run} action={action} setMessage={setMessage} />
      <section className="level-stage">
        <div className="level-tools" role="toolbar" aria-label="Level tools">{TOOLS.map((t) => <button key={t.id} className={`${tool.tool === t.id ? 'selected' : ''} tool-${t.group}`} aria-pressed={tool.tool === t.id} title={t.hint} disabled={!state.finite && !['pan', 'biome'].includes(t.id)} onClick={() => setTool({ ...tool, tool: t.id })}>{t.label}</button>)}
          <span className="level-tools-gap" /><button aria-label="Undo" disabled={!state.history.undo} onClick={() => run([{ op: 'undo' }])}>↶ Undo</button><button aria-label="Redo" disabled={!state.history.redo} onClick={() => run([{ op: 'redo' }])}>↷ Redo</button></div>
        <ToolOptions tool={tool} setTool={setTool} brush={brush} setBrush={setBrush} cat={cat} players={Math.max(state.players, 2)} />
        <div className="level-frame">{available && <iframe ref={preview.ref} title="Level preview" sandbox="allow-scripts" src={LEVEL_PREVIEW_URL} />}</div>
        <div className="level-view-bar">
          <Field label="Season"><select aria-label="Season" value={view.season} onChange={(e) => setView({ ...view, season: e.target.value })}>{SEASONS.map((s: string) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Preview as biome"><select aria-label="Preview as biome" value={view.swap} onChange={(e) => setView({ ...view, swap: e.target.value })}>{SWAPS.map((s) => <option key={s} value={s}>{s || 'as painted'}</option>)}</select></Field>
          <Field label="Ground"><select aria-label="Ground style" value={view.style} onChange={(e) => setView({ ...view, style: e.target.value })}><option value="pixel">pixel</option><option value="voxel">voxel</option></select></Field>
          {(['locks', 'graph', 'markers'] as const).map((k) => <label key={k} className="checkbox"><input type="checkbox" checked={view.overlays[k]} onChange={(e) => setView({ ...view, overlays: { ...view.overlays, [k]: e.target.checked } })} />{k === 'graph' ? 'room graph' : k}</label>)}
          <label className="checkbox"><input type="checkbox" checked={view.plants} onChange={(e) => setView({ ...view, plants: e.target.checked })} />plants</label>
          <button onClick={() => preview.post({ type: 'camera', fit: true })}>Fit</button>
        </div>
        <p className="builder-hint level-hint">{current.hint} {preview.hover ? `· tile ${preview.hover[0]}, ${preview.hover[1]}` : ''} {preview.error ? `· ${preview.error}` : ''}</p>
        <p className="builder-hint level-hint">{state.finite ? `${state.size[0]} × ${state.size[1]} tiles` : 'An infinite world: pan anywhere; paint biomes, or give it a size to edit tiles.'} · generated in {state.genMs} ms · {state.history.undo} undo{state.history.redo ? ` · ${state.history.redo} redo` : ''} · {state.counts.edits} hand edits{state.counts.locks ? ` · ${state.counts.locks} locked` : ''}</p>
      </section>
      <div className="level-side">
        <PlacePanel cat={cat} brush={brush} setBrush={setBrush} setTool={(id: string) => setTool({ ...tool, tool: id })} state={state} run={run} />
        <GamePanel state={state} run={run} brush={brush} setBrush={setBrush} setTool={(id: string) => setTool({ ...tool, tool: id })} />
        <DungeonPanel state={state} cat={cat} run={run} />
        <TilesetPanel project={project} state={state} preview={preview} action={action} setMessage={setMessage} />
        <RecordsPanel projectId={project.id} live={live} action={action} />
      </div>
    </div>}
  </div>;
}

function LevelBar({ levels, name, live, setName, action, create }: { levels: string[]; name: string; live: Live | null; setName: (value: string) => void; action: Shared['action']; create: (preset: string, name: string) => Promise<void> }) {
  const [newName, setNewName] = useState(levels.length ? `level-${levels.length + 1}` : 'level-1');
  const [preset, setPreset] = useState('mixed');
  const names = [...new Set([...levels, ...(live?.name ? [live.name] : [])])];
  return <div className="builder-bar level-bar">
    {names.length > 0 && <Field label="Level"><select aria-label="Level" value={name} onChange={(e) => setName(e.target.value)}>{names.map((n) => <option key={n} value={n}>{n}{levels.includes(n) ? '' : ' (unsaved)'}</option>)}</select></Field>}
    <Field label="New level"><input aria-label="New level name" value={newName} maxLength={63} onChange={(e) => setNewName(e.target.value.toLowerCase())} /></Field>
    <Field label="From"><select aria-label="Level preset" value={preset} onChange={(e) => setPreset(e.target.value)}>{Object.entries(LEVEL_PRESETS).map(([id, p]) => <option key={id} value={id}>{p.title}</option>)}</select></Field>
    <button className="primary" disabled={!LEVEL_NAME.test(newName)} onClick={() => void action(() => create(preset, newName))}>New level</button>
  </div>;
}

function ToolOptions({ tool, setTool, brush, setBrush, cat, players }: { tool: Tool; setTool: (t: Tool) => void; brush: any; setBrush: (b: any) => void; cat?: Catalogue; players: number }) {
  const set = (patch: Record<string, unknown>) => setBrush({ ...brush, ...patch });
  const t = tool.tool;
  return <div className="level-options">
    {['biome', 'material', 'raise', 'lower', 'flatten', 'ramp'].includes(t) && <Field label={t === 'ramp' ? `Width · ${Math.max(1, Math.round(tool.radius))}` : `Brush · ${tool.radius}`}><input aria-label="Brush size" type="range" min={t === 'ramp' ? 1 : 0} max={t === 'biome' ? 16 : 10} step={t === 'ramp' ? 1 : 0.5} value={tool.radius} onChange={(e) => setTool({ ...tool, radius: Number(e.target.value) })} /></Field>}
    {t === 'biome' && <Field label="Biome"><select aria-label="Brush biome" value={brush.biome} onChange={(e) => set({ biome: e.target.value })}>{(cat?.biomes ?? []).map((x) => <option key={x.id}>{x.id}</option>)}</select></Field>}
    {t === 'material' && <Field label="Material"><select aria-label="Brush material" value={brush.material} onChange={(e) => set({ material: e.target.value })}>{(cat?.types ?? []).map((x) => <option key={x}>{x}</option>)}</select></Field>}
    {t === 'water' && <Field label="Water above the tile"><input aria-label="Water depth" type="number" min={1} max={6} value={brush.waterDepth} onChange={(e) => set({ waterDepth: Math.max(1, Number(e.target.value) || 1) })} /></Field>}
    {t === 'river' && <Field label="River width"><input aria-label="River width" type="number" min={1} max={8} value={brush.riverWidth} onChange={(e) => set({ riverWidth: Math.max(1, Number(e.target.value) || 1) })} /></Field>}
    {t === 'road' && <Field label="Kind"><select aria-label="Road kind" value={brush.roadKind} onChange={(e) => set({ roadKind: e.target.value })}><option>road</option><option>path</option></select></Field>}
    {t === 'spawn' && <Field label="Player"><select aria-label="Spawn player" value={brush.player} onChange={(e) => set({ player: Number(e.target.value) })}>{Array.from({ length: Math.min(8, players + 1) }, (_, n) => <option key={n} value={n}>Player {n + 1}</option>)}</select></Field>}
    {t === 'resource' && <Field label="Resource"><select aria-label="Resource kind" value={brush.resource} onChange={(e) => set({ resource: e.target.value })}>{RESOURCE_KINDS.map((k: string) => <option key={k}>{k}</option>)}</select></Field>}
    {t === 'marker' && <Field label="Marker kind"><input aria-label="Marker kind" value={brush.markerKind} maxLength={40} onChange={(e) => set({ markerKind: e.target.value.replace(/[^a-z0-9-]/gi, '') || 'marker' })} /></Field>}
    {t === 'place' && <span className="builder-hint">Placing <strong>{brush.object}</strong> from {brush.pack} (choose in Place).</span>}
  </div>;
}

/** The recipe: the generator pipeline as a stage list, the seed and its variations, size, players, act, pins and locks. */
function RecipePanel({ state, cat, run, action, setMessage }: { state: LevelState; cat?: Catalogue; run: (ops: Op[], label?: string) => void; action: Shared['action']; setMessage: (value: string) => void }) {
  const r = state.recipe;
  const [seed, setSeed] = useState(r.seed);
  const [size, setSize] = useState({ w: r.width || 128, d: r.depth || 96 });
  const [kind, setKind] = useState('dungeon@1');
  const [strip, setStrip] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [locks, setLocks] = useState(r.locks ?? '');
  useEffect(() => { setSeed(r.seed); setSize({ w: r.width || size.w, d: r.depth || size.d }); setLocks(r.locks ?? ''); }, [r.seed, r.width, r.depth, r.locks]);
  const addStage = () => {
    let n = 1; while (r.stages.some((s) => s.id === `${kind.split('@')[0]}-${n}`)) n += 1;
    const w = r.width || 96, d = r.depth || 72;
    const regional = !['overworld@1', 'biome@1', 'foliage@1'].includes(kind) || !r.width;
    const mask = regional ? (kind === 'biome@1' ? { kind: 'circle', at: [Math.round(w / 2), Math.round(d / 2)], r: Math.round(Math.min(w, d) / 5), feather: 3 } : { kind: 'rect', rect: [Math.round(w * 0.25), Math.round(d * 0.25), Math.round(w * 0.75), Math.round(d * 0.75)] }) : undefined;
    const params = cleanParams(Object.fromEntries((STAGE_PARAMS[kind as keyof typeof STAGE_PARAMS] ?? []).filter((p: any) => p.default !== '' && !Array.isArray(p.default) && ['enum', 'biome'].includes(p.kind)).map((p: any) => [p.name, p.default])));
    run([{ op: 'stage', stage: { id: `${kind.split('@')[0]}-${n}`, use: kind, ...(Object.keys(params).length ? { params } : {}), ...(mask ? { mask } : {}) } }], `Added stage ${kind}.`);
  };
  const variations = () => void action(async () => { setLoading(true); try { setStrip((await api('gameLevelVariations', { recipe: r, players: state.players, count: 6 })).variations); } finally { setLoading(false); } });
  return <section className="builder-section level-recipe open-section" aria-label="Recipe"><h3>Recipe</h3>
    <div className="builder-row"><Field label="Seed"><input aria-label="Level seed" value={seed} maxLength={64} onChange={(e) => setSeed(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && seed && seed !== r.seed) run([{ op: 'seed', seed }]); }} onBlur={() => { if (seed && seed !== r.seed) run([{ op: 'seed', seed }]); }} /></Field>
      <button onClick={() => run([{ op: 'seed', seed: `${r.seed.replace(/\+\d+$/, '')}+${Math.floor(Math.random() * 9000 + 1000)}` }])}>Reroll</button></div>
    <div className="builder-row"><label className="checkbox"><input type="checkbox" aria-label="Infinite world" checked={!r.width} disabled={state.players > 0} onChange={(e) => run([{ op: 'size', width: e.target.checked ? 0 : size.w, depth: e.target.checked ? 0 : size.d }])} />infinite</label>
      {!!r.width && <><Field label="Width"><input aria-label="Level width" type="number" min={16} max={512} value={size.w} onChange={(e) => setSize({ ...size, w: Number(e.target.value) })} /></Field><Field label="Depth"><input aria-label="Level depth" type="number" min={16} max={512} value={size.d} onChange={(e) => setSize({ ...size, d: Number(e.target.value) })} /></Field>
        <button disabled={size.w === r.width && size.d === r.depth} onClick={() => run([{ op: 'size', width: Math.max(16, Math.min(512, size.w)), depth: Math.max(16, Math.min(512, size.d)) }])}>Resize</button></>}</div>
    <div className="builder-row"><Field label="Players"><select aria-label="Players" value={state.players} disabled={!r.width} onChange={(e) => run([{ op: 'players', players: Number(e.target.value) }])}>{[0, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n ? `${n} players` : 'none (adventure)'}</option>)}</select></Field>
      <Field label="Act"><select aria-label="Act" value={r.act ?? ''} onChange={(e) => run([{ op: 'act', act: e.target.value || null }])}><option value="">no act</option>{(cat?.acts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} · {a.theme}</option>)}</select></Field></div>
    <h4>Stages · run in order</h4>
    {r.stages.map((s, n) => <StageCard key={s.id} stage={s} index={n} count={r.stages.length} cat={cat} run={run} />)}
    <div className="inline-actions"><select aria-label="Stage kind" value={kind} onChange={(e) => setKind(e.target.value)}>{(cat?.stages ?? []).map((s) => <option key={s.use} value={s.use}>{s.use}</option>)}</select><button onClick={addStage}>Add stage</button></div>
    <p className="builder-hint">{cat?.stages.find((s) => s.use === kind)?.describe}</p>
    <h4>Pins · the hand-placed wins</h4>
    {(r.pins ?? []).map((p: any, n: number) => <div className="builder-list-row" key={n}><span>[{p.rect.join(', ')}]{p.height !== undefined ? ` h${p.height}` : ''}{p.type ? ` ${p.type}` : ''}{p.biome ? ` ${p.biome}` : ''}</span><button className="text-button" aria-label={`Remove pin ${n}`} onClick={() => run([{ op: 'unpin', index: n }])}>✕</button></div>)}
    <PinForm run={run} types={cat?.types ?? []} biomes={(cat?.biomes ?? []).map((b) => b.id)} />
    <Field label="Lock text (rolled params)"><input aria-label="Recipe locks" value={locks} placeholder="id:crypt/rooms=12" maxLength={4000} onChange={(e) => setLocks(e.target.value)} onBlur={() => { if (locks !== (r.locks ?? '')) run([{ op: 'locks', locks }]); }} /></Field>
    <h4>Seed strip</h4>
    <div className="inline-actions"><button onClick={variations} disabled={loading}>{loading ? 'Generating…' : 'Six variations'}</button></div>
    {strip && <div className="level-strip" aria-label="Variations">{strip.map((v) => <figure key={v.seed}>{v.url ? <button className="level-variation" aria-label={`Use seed ${v.seed}`} onClick={() => { run([{ op: 'seed', seed: v.seed }]); setMessage(`Seed ${v.seed}.`); }}><img src={v.url} alt={`Seed ${v.seed}`} /></button> : <small>{v.error}</small>}<figcaption>{v.seed}{v.fair ? ` · ${v.fair.pass ? 'fair' : v.fair.connected ? `${v.fair.worst.metric} ${v.fair.worst.spread === null ? '∞' : `${Math.round(v.fair.worst.spread * 100)}%`}` : 'not connected'}` : ''}{v.genMs ? ` · ${v.genMs} ms` : ''}</figcaption></figure>)}</div>}
  </section>;
}

function PinForm({ run, types, biomes }: { run: (ops: Op[]) => void; types: string[]; biomes: string[] }) {
  const [rect, setRect] = useState('10, 10, 16, 16');
  const [height, setHeight] = useState('');
  const [type, setType] = useState('');
  const [biome, setBiome] = useState('');
  const parsed = rect.split(/[\s,]+/).filter(Boolean).map(Number);
  const ok = parsed.length === 4 && parsed.every(Number.isInteger) && parsed[2] > parsed[0] && parsed[3] > parsed[1] && (height !== '' || type || biome);
  return <div className="level-pin"><input aria-label="Pin rect" value={rect} onChange={(e) => setRect(e.target.value)} placeholder="i0, j0, i1, j1" />
    <input aria-label="Pin height" type="number" value={height} placeholder="h" onChange={(e) => setHeight(e.target.value)} />
    <select aria-label="Pin type" value={type} onChange={(e) => setType(e.target.value)}><option value="">type</option>{types.map((t) => <option key={t}>{t}</option>)}</select>
    <select aria-label="Pin biome" value={biome} onChange={(e) => setBiome(e.target.value)}><option value="">biome</option>{biomes.map((t) => <option key={t}>{t}</option>)}</select>
    <button disabled={!ok} onClick={() => run([{ op: 'pin', pin: { rect: parsed, ...(height !== '' ? { height: Number(height) } : {}), ...(type ? { type } : {}), ...(biome ? { biome } : {}) } }])}>Pin</button></div>;
}

/** One stage: its kind's params, seed and mask; edits land (debounced) as a stage op, which regenerates. */
function StageCard({ stage, index, count, cat, run }: { stage: Stage; index: number; count: number; cat?: Catalogue; run: (ops: Op[], label?: string) => void }) {
  const [draft, setDraft] = useState<Stage>(stage);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (!timer.current) setDraft(stage); }, [JSON.stringify(stage)]);
  const commit = (next: Stage) => { setDraft(next); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => { timer.current = null; const s: Stage = { id: next.id, use: next.use, ...(next.seed ? { seed: next.seed } : {}), ...(Object.keys(cleanParams(next.params)).length ? { params: cleanParams(next.params) } : {}), ...(next.mask && next.mask.kind !== 'all' ? { mask: next.mask } : {}) }; run([{ op: 'stage', stage: s }], `Regenerated with ${s.id}.`); }, 450); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const params: any[] = STAGE_PARAMS[stage.use as keyof typeof STAGE_PARAMS] ?? [];
  const setParam = (name: string, value: unknown) => commit({ ...draft, params: { ...(draft.params ?? {}), [name]: value } });
  const value = (p: any) => draft.params?.[p.name] ?? '';
  const rolled = (p: any) => { const v = draft.params?.[p.name]; return v && typeof v === 'object' && !Array.isArray(v); };
  const m = draft.mask ?? { kind: 'all' };
  const setMask = (patch: any) => commit({ ...draft, mask: { ...patch } });
  const num = (label: string, v: number, onChange: (n: number) => void) => <input aria-label={`${stage.id} ${label}`} title={label} type="number" value={v} onChange={(e) => onChange(Number(e.target.value))} />;
  return <div className="level-stage-card" aria-label={`Stage ${stage.id}`}>
    <header><strong>{stage.id}</strong><Badge>{stage.use}</Badge><span className="level-stage-moves"><button aria-label={`Move ${stage.id} up`} disabled={!index} onClick={() => run([{ op: 'moveStage', id: stage.id, to: index - 1 }])}>↑</button><button aria-label={`Move ${stage.id} down`} disabled={index === count - 1} onClick={() => run([{ op: 'moveStage', id: stage.id, to: index + 1 }])}>↓</button><button aria-label={`Remove stage ${stage.id}`} disabled={count === 1} onClick={() => run([{ op: 'unstage', id: stage.id }])}>✕</button></span></header>
    <div className="level-params">{params.map((p) => rolled(p) ? <Field key={p.name} label={p.name}><code title="A roll: pin it with the recipe's lock text">{JSON.stringify(draft.params![p.name])}</code></Field>
      : p.kind === 'bool' ? <label key={p.name} className="checkbox" title={p.doc}><input type="checkbox" aria-label={`${stage.id} ${p.name}`} checked={value(p) === '' ? !!p.default : !!value(p)} onChange={(e) => setParam(p.name, e.target.checked)} />{p.name}</label>
      : p.kind === 'enum' ? <Field key={p.name} label={p.name}><select aria-label={`${stage.id} ${p.name}`} title={p.doc} value={value(p)} onChange={(e) => setParam(p.name, e.target.value)}><option value="">{p.default ? `${p.default} (default)` : 'default'}</option>{p.values.map((v: string) => <option key={v}>{v}</option>)}</select></Field>
      : p.kind === 'biome' || p.kind === 'type' ? <Field key={p.name} label={p.name}><select aria-label={`${stage.id} ${p.name}`} title={p.doc} value={value(p)} onChange={(e) => setParam(p.name, e.target.value)}><option value="">{p.default ? `${p.default} (default)` : 'none'}</option>{(p.kind === 'biome' ? (cat?.biomes ?? []).map((b) => b.id) : cat?.types ?? []).map((v) => <option key={v}>{v}</option>)}</select></Field>
      : p.kind === 'biomes' ? <Field key={p.name} label={p.name}><input aria-label={`${stage.id} ${p.name}`} title={p.doc} defaultValue={(draft.params?.[p.name] ?? []).join(', ')} placeholder="plains, forest…" onBlur={(e) => setParam(p.name, e.target.value.split(/[\s,]+/).filter(Boolean))} /></Field>
      : <Field key={p.name} label={p.name}><input aria-label={`${stage.id} ${p.name}`} title={p.doc} type="number" min={p.min} max={p.max} step={p.step ?? 1} value={value(p)} placeholder={String(p.default)} onChange={(e) => setParam(p.name, e.target.value === '' ? '' : Number(e.target.value))} /></Field>)}</div>
    <div className="level-mask"><Field label="Where"><select aria-label={`${stage.id} mask`} value={m.kind} onChange={(e) => { const k = e.target.value; setMask(k === 'rect' ? { kind: 'rect', rect: [8, 8, 40, 32] } : k === 'circle' ? { kind: 'circle', at: [32, 24], r: 12, feather: 3 } : k === 'noise' ? { kind: 'noise', freq: 0.05, threshold: 0.55 } : k === 'biome' ? { kind: 'biome', biomes: ['plains'] } : k === 'height' ? { kind: 'height', min: 2 } : { kind: 'all' }); }}>{[...MASK_KINDS, ...(MASK_KINDS.includes(m.kind) ? [] : [m.kind])].map((k: string) => <option key={k}>{k}</option>)}</select></Field>
      {m.kind === 'rect' && <span className="level-mask-fields">{['i0', 'j0', 'i1', 'j1'].map((l, n) => <React.Fragment key={l}>{num(l, m.rect[n], (v) => { const rect = [...m.rect]; rect[n] = v; setMask({ ...m, rect }); })}</React.Fragment>)}{num('feather', m.feather ?? 0, (v) => setMask({ ...m, feather: v }))}</span>}
      {m.kind === 'circle' && <span className="level-mask-fields">{num('i', m.at[0], (v) => setMask({ ...m, at: [v, m.at[1]] }))}{num('j', m.at[1], (v) => setMask({ ...m, at: [m.at[0], v] }))}{num('radius', m.r, (v) => setMask({ ...m, r: Math.max(1, v) }))}{num('feather', m.feather ?? 0, (v) => setMask({ ...m, feather: v }))}</span>}
      {m.kind === 'noise' && <span className="level-mask-fields">{num('freq', m.freq, (v) => setMask({ ...m, freq: v }))}{num('threshold', m.threshold, (v) => setMask({ ...m, threshold: v }))}</span>}
      {m.kind === 'height' && <span className="level-mask-fields">{num('min', m.min ?? 0, (v) => setMask({ ...m, min: v }))}{num('max', m.max ?? 20, (v) => setMask({ ...m, max: v }))}</span>}
      {m.kind === 'biome' && <input aria-label={`${stage.id} mask biomes`} defaultValue={m.biomes.join(', ')} onBlur={(e) => setMask({ ...m, biomes: e.target.value.split(/[\s,]+/).filter(Boolean) })} />}
    </div>
    <Field label="Stage seed"><input aria-label={`${stage.id} seed`} defaultValue={draft.seed ?? ''} placeholder="the recipe's seed / id" maxLength={64} onBlur={(e) => { if ((e.target.value || undefined) !== draft.seed) commit({ ...draft, seed: e.target.value || undefined }); }} /></Field>
  </div>;
}

function PlacePanel({ cat, brush, setBrush, setTool, state, run }: { cat?: Catalogue; brush: any; setBrush: (b: any) => void; setTool: (id: string) => void; state: LevelState; run: (ops: Op[]) => void }) {
  const pack = cat?.packs.find((p) => p.id === brush.pack) ?? cat?.packs[0];
  const object = pack?.objects.find((o) => o.id === brush.object);
  return <details className="builder-section" open><summary>Place · {state.counts.things ?? 0} things</summary>
    <div className="builder-row"><Field label="Pack"><select aria-label="Place pack" value={pack?.id ?? ''} onChange={(e) => { const p = cat?.packs.find((x) => x.id === e.target.value); setBrush({ ...brush, pack: e.target.value, object: p?.objects[0]?.id ?? '' }); }}>{(cat?.packs ?? []).map((p) => <option key={p.id}>{p.id}</option>)}</select></Field>
      <Field label="Object"><select aria-label="Place object" value={brush.object} onChange={(e) => setBrush({ ...brush, object: e.target.value })}>{(pack?.objects ?? []).map((o) => <option key={o.id}>{o.id}</option>)}</select></Field></div>
    {object && <p className="builder-hint">{object.tags.slice(0, 6).join(' · ')}{Object.keys(object.choices).length ? ` · pins: ${Object.keys(object.choices).slice(0, 8).join(', ')}` : ''}</p>}
    <div className="builder-row"><Field label="Pins (JSON)"><input aria-label="Place pins" value={brush.pins} onChange={(e) => setBrush({ ...brush, pins: e.target.value })} placeholder='{"floors": 2}' /></Field></div>
    <div className="builder-row"><Field label="Yaw"><input aria-label="Place yaw" type="number" step={0.1} min={-3.14} max={3.14} value={brush.yaw} onChange={(e) => setBrush({ ...brush, yaw: Number(e.target.value) })} /></Field><Field label="Scale"><input aria-label="Place scale" type="number" step={0.1} min={0.1} max={8} value={brush.scale} onChange={(e) => setBrush({ ...brush, scale: Number(e.target.value) || 1 })} /></Field>
      <Field label="Tier"><select aria-label="Place tier" value={brush.tier} onChange={(e) => setBrush({ ...brush, tier: e.target.value })}>{['foreground', 'background', 'main', 'ground'].map((t) => <option key={t}>{t}</option>)}</select></Field></div>
    <div className="inline-actions"><button className="primary" onClick={() => setTool('place')}>Place on the map</button><button onClick={() => setTool('erase')}>Erase</button></div>
    {state.things.length > 0 && <div className="level-list">{state.things.slice(-8).reverse().map((t: any) => <div className="builder-list-row" key={t.id}><span><strong>{t.id}</strong> <small>{t.pack}/{t.object}</small></span><button className="text-button" aria-label={`Remove ${t.id}`} onClick={() => run([{ op: 'remove', id: t.id }])}>✕</button></div>)}</div>}
  </details>;
}

function GamePanel({ state, run, brush, setBrush, setTool }: { state: LevelState; run: (ops: Op[]) => void; brush: any; setBrush: (b: any) => void; setTool: (id: string) => void }) {
  const f = state.fairness;
  const byKind = RESOURCE_KINDS.map((k: string) => [k, state.resources.filter((r) => r.kind === k).length] as const).filter(([, n]) => n);
  return <details className="builder-section" open><summary>Game · spawns {state.spawns.length} · resources {state.resources.length}</summary>
    <p className="builder-hint">Spawns (a player's main and natural expansion), resource fields and markers are the level's own lists: the RTS reads them.</p>
    {state.spawns.map((s) => <div className="builder-list-row" key={s.id}><span><strong>Player {s.player + 1}</strong> at {s.at.join(', ')}{s.natural ? ` · natural ${s.natural.join(', ')}` : ''}</span><button className="text-button" aria-label={`Remove ${s.id}`} onClick={() => run([{ op: 'remove', id: s.id }])}>✕</button></div>)}
    <div className="inline-actions"><button onClick={() => { setBrush({ ...brush, player: state.spawns.length % 8 }); setTool('spawn'); }}>Place spawn</button><button onClick={() => setTool('resource')}>Place resource</button><button onClick={() => setTool('marker')}>Place marker</button></div>
    {byKind.length > 0 && <p className="builder-hint">Resources: {byKind.map(([k, n]) => `${n} ${k}`).join(' · ')}</p>}
    {state.markers.length > 0 && <p className="builder-hint">Markers: {[...new Set(state.markers.map((m) => m.kind))].slice(0, 10).join(', ')}</p>}
    {f ? <div className={`level-fair ${f.pass ? 'pass' : 'fail'}`} role="status" aria-label="Fairness"><strong>{f.pass ? 'Fair' : f.connected ? 'Not fair yet' : 'Not connected'}</strong><span>worst: {f.worst.metric} {f.worst.spread === null ? '∞' : `${Math.round(f.worst.spread * 100)}%`} (tolerance {Math.round(f.tolerance * 100)}%)</span>
      <table className="game-table"><thead><tr><th>P</th><th>natural</th><th>enemy</th><th>middle</th><th>choke</th><th>res.</th></tr></thead><tbody>{f.players.map((p: any) => <tr key={p.player}><td>{p.player + 1}</td>{['toNatural', 'toEnemy', 'toMiddle', 'choke', 'resources'].map((k) => <td key={k}>{p[k] === null ? '∞' : Math.round(p[k])}</td>)}</tr>)}</tbody></table></div>
      : <p className="builder-hint">Fairness appears with two spawns or more (Players in the recipe, or place them).</p>}
  </details>;
}

/** Dungeon mode: each dungeon stage's generator, rooms and theme, its room graph and the fairness gate; the room templates. */
function DungeonPanel({ state, cat, run }: { state: LevelState; cat?: Catalogue; run: (ops: Op[]) => void }) {
  const stages = state.recipe.stages.filter((s) => s.use === 'dungeon@1');
  const [showRooms, setShowRooms] = useState(false);
  const update = (s: Stage, params: Record<string, unknown>) => run([{ op: 'stage', stage: { ...s, params: cleanParams({ ...(s.params ?? {}), ...params }) } }]);
  return <details className="builder-section" open={stages.length > 0}><summary>Dungeon · {stages.length} stage{stages.length === 1 ? '' : 's'}</summary>
    {!stages.length && <p className="builder-hint">Add a dungeon@1 stage (Recipe) — or start from the Dungeon floor preset.</p>}
    {stages.map((s) => { const d = state.dungeons.find((x) => x.stage === s.id); return <div key={s.id} className="level-dungeon" aria-label={`Dungeon ${s.id}`}>
      <div className="builder-row"><Field label={`${s.id} · generator`}><select aria-label={`${s.id} generator`} value={s.params?.algorithm ?? 'rooms'} onChange={(e) => update(s, { algorithm: e.target.value })}>{(cat?.algorithms ?? []).map((a) => <option key={a}>{a}</option>)}</select></Field>
        <Field label="Rooms"><input aria-label={`${s.id} rooms`} type="number" min={3} max={30} defaultValue={s.params?.rooms ?? 10} onBlur={(e) => { const n = Number(e.target.value); if (n !== (s.params?.rooms ?? 10)) update(s, { rooms: n }); }} /></Field>
        <Field label="Theme"><select aria-label={`${s.id} theme`} value={s.params?.theme ?? ''} onChange={(e) => update(s, { theme: e.target.value })}><option value="">the act's</option>{(cat?.themes ?? []).map((a) => <option key={a}>{a}</option>)}</select></Field></div>
      {d && <><RoomGraph d={d} /><p className={`builder-hint ${d.check.pass ? '' : 'error-text'}`}>{d.algorithm} · {d.rooms.length} rooms · {d.edges.length} links · start → exit {d.check.startToExit} steps{d.key ? ` · start → key ${d.check.startToKey}` : ''} · {d.check.pass ? 'passes the gate' : d.check.problems.join('; ')}{d.attempt ? ` (reroll ${d.attempt})` : ''}</p></>}
    </div>; })}
    <button className="text-button" onClick={() => setShowRooms(!showRooms)}>{showRooms ? 'Hide' : 'Show'} the room templates ({cat?.rooms.length ?? 0})</button>
    {showRooms && <><p className="builder-hint">The stitched generator's prefab rooms by role (# wall · . floor · D door · T torch · K key · B boss · S start · E exit). The dungeon stage uses the engine's set; a level can't choose its own yet.</p><div className="level-rooms">{cat?.rooms.map((r) => <figure key={r.id}><pre>{r.rows.join('\n')}</pre><figcaption>{r.id} · {r.roles.join(', ')}</figcaption></figure>)}</div></>}
  </details>;
}
function RoomGraph({ d }: { d: any }) {
  const [a, b, c, e] = d.rect, w = c - a, h = e - b, s = Math.min(300 / w, 180 / h);
  const X = (x: number) => (x - a) * s, Y = (y: number) => (y - b) * s;
  const colour: Record<string, string> = { start: '#5adc78', key: '#fad246', boss: '#f05050', exit: '#4ee2ff', treasure: '#c86ef0', room: '#8a90a8', cave: '#8a90a8' };
  const centre = (r: any) => [X(r.x + r.w / 2), Y(r.y + r.h / 2)];
  return <svg className="level-graph" viewBox={`-6 -6 ${w * s + 12} ${h * s + 12}`} role="img" aria-label="Room graph">
    <rect x={0} y={0} width={w * s} height={h * s} fill="#0d0e16" stroke="#2a2d3e" />
    {d.rooms.map((r: any) => <rect key={`r${r.id}`} x={X(r.x)} y={Y(r.y)} width={r.w * s} height={r.h * s} fill="#ffffff08" stroke={colour[r.kind] ?? '#8a90a8'} strokeWidth={r.kind === 'room' ? 0.6 : 1.4} />)}
    {d.edges.map((ed: any, n: number) => { const p = centre(d.rooms[ed.from]), q = centre(d.rooms[ed.to]); return <line key={`e${n}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={ed.locked ? '#f05050' : '#d8dcf0'} strokeWidth={1.2} strokeDasharray={ed.locked ? '3 2' : undefined} />; })}
    {d.rooms.map((r: any) => { const p = centre(r); return <g key={`n${r.id}`}><circle cx={p[0]} cy={p[1]} r={r.kind === 'room' ? 2.5 : 4.5} fill={colour[r.kind] ?? '#8a90a8'} />{r.kind !== 'room' && <text x={p[0] + 6} y={p[1] + 3} fill={colour[r.kind]} fontSize={8}>{r.kind}</text>}</g>; })}
    {!d.rooms.length && [['start', d.start], ['key', d.key], ['boss', d.boss], ['exit', d.exit]].filter(([, p]) => p).map(([k, p]: any) => <g key={k}><circle cx={X(p[0] + 0.5)} cy={Y(p[1] + 0.5)} r={4} fill={colour[k]} /><text x={X(p[0]) + 7} y={Y(p[1]) + 3} fill={colour[k]} fontSize={8}>{k}</text></g>)}
  </svg>;
}

/** A tileset: a PNG atlas from Files cut by its layout, its autotile demo, and (applied) the map's materials drawn with it. */
function TilesetPanel({ project, state, preview, action, setMessage }: { project: Project; state: LevelState; preview: ReturnType<typeof usePreview>; action: Shared['action']; setMessage: (value: string) => void }) {
  const workspace = queryClient.getQueryData<Workspace>(['workspace']);
  const pngs = (workspace?.state.objects ?? []).filter((o) => o.type === 'image/png' || /\.png$/i.test(o.name));
  const [objectId, setObjectId] = useState(state.tileset?.objectId ?? pngs[0]?.id ?? '');
  const [layout, setLayout] = useState('blob47');
  const [tile, setTile] = useState(16);
  const [materials, setMaterials] = useState('grass@0,0');
  const [result, setResult] = useState<any>(null);
  const rules = () => ({ id: 'tiles', layout, tile, materials: materials.split(/[;\n]+/).map((m) => m.trim()).filter(Boolean).map((m) => { const [type, at] = m.split('@'); const [x, y] = (at ?? '0,0').split(',').map(Number); return { type: type.trim(), at: [x || 0, y || 0] }; }) });
  const load = (use: boolean) => void action(async () => {
    const r = await api('gameLevelTileset', { projectId: project.id, objectId, rules: rules(), use });
    setResult(r);
    const applied = await preview.request({ type: 'tileset', tileset: { width: r.width, height: r.height, rgba: r.rgba, rules: r.rules }, apply: use });
    setMessage(`${r.name}: ${r.materials.length} material${r.materials.length === 1 ? '' : 's'}, ${r.colours} colours${use ? ` · applied to the map${applied?.applied ? '' : ' (the preview did not take it)'} · saved with the level` : ''}.`);
  });
  const choose = () => void action(async () => {
    const current = queryClient.getQueryData<Workspace>(['workspace'])!;
    const next = await api('importObject', { revision: current.revision });
    if (!next) return;
    queryClient.setQueryData(['workspace'], next);
    setObjectId(next.state.objects.at(-1).id);
  });
  return <details className="builder-section" open={!!state.tileset}><summary>Tileset{state.tileset ? ' · in use' : ''}</summary>
    <p className="builder-hint">Your own ground art: a PNG atlas in one of the layouts pixel artists draw (blob-47, Wang-16 corners, RPG Maker A2), cut by the engine and drawn palette-true by the same baker.</p>
    <div className="builder-row"><Field label="Atlas (Files)"><select aria-label="Tileset atlas" value={objectId} onChange={(e) => setObjectId(e.target.value)}><option value="">Choose a PNG…</option>{pngs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field><button onClick={choose}>Import…</button></div>
    <div className="builder-row"><Field label="Layout"><select aria-label="Tileset layout" value={layout} onChange={(e) => setLayout(e.target.value)}>{TILESET_LAYOUTS.map((l: string) => <option key={l}>{l}</option>)}</select></Field><Field label="Tile px"><input aria-label="Tileset tile size" type="number" min={2} max={256} step={2} value={tile} onChange={(e) => setTile(Number(e.target.value))} /></Field></div>
    <Field label="Materials (type@col,row; …)"><input aria-label="Tileset materials" value={materials} onChange={(e) => setMaterials(e.target.value)} /></Field>
    <div className="inline-actions"><button disabled={!objectId} onClick={() => load(false)}>Preview autotile</button><button className="primary" disabled={!objectId || !state.finite} onClick={() => load(true)}>Use on this level</button>{state.tileset && <button className="text-button" onClick={() => void action(async () => { await api('gameLevelNoTileset', { projectId: project.id }); await preview.request({ type: 'tileset', tileset: null }); setResult(null); })}>Stop using</button>}</div>
    {result && <figure className="level-tileset"><img src={result.demo} alt="Autotile demo" /><figcaption>{result.width} × {result.height} atlas · {result.materials.join(', ')} · rules {result.sizes.bytes} B (JSON {result.sizes.json} B) <button className="text-button" onClick={() => openCodecInspector({ text: result.rulesBytes, label: 'Tileset rules (keel/worldgen/tileset)' })}>Inspect</button></figcaption></figure>}
  </details>;
}

/** The records a save writes (LEVEL, the recipe, the tileset rules) against their JSON; each opens in the codec inspector. */
function RecordsPanel({ projectId, live, action }: { projectId: string; live: Live; action: Shared['action'] }) {
  // (Measured once the edits settle: a stroke's batches don't each re-encode the level.)
  const [settled, setSettled] = useState(live.seq);
  useEffect(() => { const timer = setTimeout(() => setSettled(live.seq), 900); return () => clearTimeout(timer); }, [live.seq]);
  const sizes = useQuery<any>({ queryKey: ['game-level-sizes', projectId, settled], queryFn: () => api('gameLevelEncode', { projectId }), enabled: settled > 0, staleTime: 5_000, placeholderData: (previous: any) => previous });
  const d = sizes.data;
  const file = useMemo(() => { try { return d ? readLevelFile(d.content) : null; } catch { return null; } }, [d?.content]);
  const inspect = (text: string, label: string) => openCodecInspector({ text, label });
  return <details className="builder-section" open><summary>Records · {d ? kb(d.sizes.file) : '…'}</summary>
    {d && <div className="measurement-grid level-sizes">
      {d.sizes.level && <div><span>LEVEL · keel/level</span><strong>{kb(d.sizes.level.bytes)}</strong><small>{kb(d.sizes.level.json)} as JSON ({pct(d.sizes.level.bytes, d.sizes.level.json)}) · gz {kb(d.sizes.level.gzip)} vs {kb(d.sizes.level.jsonGz)}</small></div>}
      <div><span>RECIPE · keel/worldgen/recipe</span><strong>{d.sizes.recipe.bytes} B</strong><small>{d.sizes.recipe.json} B as JSON ({pct(d.sizes.recipe.bytes, d.sizes.recipe.json)})</small></div>
      <div><span>{live.name.toUpperCase()}.LEVEL</span><strong>{kb(d.sizes.file)}</strong><small>the file: records, {file?.edits.length ?? 0} hand edits ({kb(d.sizes.edits)}){d.sizes.tileset ? `, tileset rules ${d.sizes.tileset} B` : ''}</small></div>
    </div>}
    {file && <div className="inline-actions">{file.level && <button className="text-button" onClick={() => inspect(file.level!, `${levelFileName(live.name)} · level (keel/level)`)}>Inspect the LEVEL record</button>}<button className="text-button" onClick={() => inspect(file.recipe, `${levelFileName(live.name)} · recipe (keel/worldgen/recipe)`)}>Inspect the recipe</button>{file.tileset && <button className="text-button" onClick={() => inspect(file.tileset!.rules, `${levelFileName(live.name)} · tileset rules`)}>Inspect the tileset rules</button>}</div>}
    {file?.level && <p className="builder-hint">{fromBase64url(file.level).length.toLocaleString()} bytes of level: terrain as runs, things by name tables, settings with their locks. Plants aren't stored — the biomes grow them from the seed.</p>}
    <button className="text-button" onClick={() => void action(async () => { await sizes.refetch(); })}>Re-measure</button>
  </details>;
}
