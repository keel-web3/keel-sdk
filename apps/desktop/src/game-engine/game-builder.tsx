// The Builder tab of a Game project: the KEEL builder (voxel models built like
// a block builder, and the capsule-and-rig characters the games use), drawn
// by the engine's pixel renderer in a sandboxed preview frame. Clicks in the
// view and the tool panels become builder ops; so do the assistant's -- every
// op streams into the engine's session and the frame redraws as they land.
// The renderer never loads engine code: ops go to main, frames and states come
// back as JSON, the frame gets them by postMessage.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Project, Shared, Workspace } from '../types';
import { api, queryClient } from '../client';
import { Badge, Empty, Field } from '../ui';
import { BUILDER_PREVIEW_URL, buildFileName, buildName as buildNameSchema, destructiveOps, importable, opsHash, packFileName, projectBuilds, withBuildFile, withPackFiles } from './builder-project.mjs';
import { SpritePane } from './builder-sprite';
import { CodecInspectorHost, openCodecInspector } from './codec-inspector';

type Op = { op: string; [field: string]: unknown };
type Look = { colours: number[][]; ramps: Record<string, [number, number]>; materials: { ramp: string }[] };
type Frame = { key: string; n?: number; kind: string; boxes: any[]; capsules: any[]; wedges?: any[]; look: Look; unit: number; pivot: number[]; voxels: number; rig: any; label?: string; reset?: boolean; history?: { total: number; undone: number }; target?: any; roles?: number };
type State = any;
type Hit = { on: number[] | null; add: number[]; normal: number[]; ground?: boolean; shift?: boolean; alt?: boolean };
type Status = { available: boolean; reason?: string };

const TOOLS: { id: string; label: string; clicks: 0 | 1 | 2; hint: string }[] = [
  { id: 'orbit', label: 'Orbit', clicks: 0, hint: 'Drag to turn the view, scroll to zoom.' },
  { id: 'set', label: 'Block', clicks: 1, hint: 'Click a face to add a block against it (or the ground).' },
  { id: 'box', label: 'Box', clicks: 2, hint: 'Click two corners.' },
  { id: 'fill', label: 'Fill', clicks: 2, hint: 'Two corners: fills only the empty cells between them.' },
  { id: 'sphere', label: 'Sphere', clicks: 1, hint: 'Click where its centre goes; the brush size is its radius.' },
  { id: 'line', label: 'Line', clicks: 2, hint: 'Click both ends; the brush size thickens it.' },
  { id: 'paint', label: 'Paint', clicks: 1, hint: 'Click a block to give it the role.' },
  { id: 'erase', label: 'Erase', clicks: 1, hint: 'Click a block to take it out (two corners with Shift: a box).' },
  { id: 'group', label: 'Group', clicks: 2, hint: 'Two corners name a region for the group below.' },
];
const SYMMETRY = ['none', 'x', 'z', 'xz', 'radial4'];
const CHARACTER_ROLES = ['fur', 'furAlt', 'cloth', 'clothAlt', 'accent', 'dark', 'blush', 'hair'];
const SAMPLES = ['robot', 'dog', 'knight', 'chest', 'crate', 'statue'];
const MOTIONS = ['hinge', 'spin', 'sway', 'bob', 'wave', 'flicker', 'pivot'];
const vec = (text: string, size = 3) => { const list = text.split(/[\s,]+/).filter(Boolean).map(Number); return list.length === size && list.every(Number.isFinite) ? list : null; };
const rgb = (look: Look | undefined, role: string) => { const ramp = look?.ramps[role]; const c = ramp ? look!.colours[ramp[0] + Math.floor(ramp[1] * 0.6)] : null; return c ? `rgb(${c[0]},${c[1]},${c[2]})` : '#555'; };

/** The sandboxed preview frame: messages in, picks, joint drops, shots and bakes out. */
function usePreview(onPick: (hit: Hit) => void, onJoint: (bone: string, at: number[]) => void) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>());
  const seq = useRef(0);
  const handlers = useRef({ onPick, onJoint });
  handlers.current = { onPick, onJoint };
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (!ref.current || event.source !== ref.current.contentWindow) return;
      const m = event.data;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'ready') { setReady(true); if (!m.webgl) setError('The preview needs WebGL2, which this display does not offer.'); }
      else if (m.type === 'pick') handlers.current.onPick(m);
      else if (m.type === 'joint' && typeof m.bone === 'string' && Array.isArray(m.at)) handlers.current.onJoint(m.bone, m.at);
      else if (m.id && pending.current.has(m.id)) { const p = pending.current.get(m.id)!; pending.current.delete(m.id); if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m); }
      else if (m.type === 'error') setError(String(m.message));
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);
  const post = (message: unknown) => ref.current?.contentWindow?.postMessage(message, '*');
  const request = (message: Record<string, unknown>) => new Promise<any>((resolve, reject) => {
    const id = ++seq.current;
    pending.current.set(id, { resolve, reject });
    post({ ...message, id });
    setTimeout(() => { if (pending.current.delete(id)) reject(new Error('The preview did not answer.')); }, 90_000);
  });
  return { ref, ready, error, post, request };
}

/** A project's Builder tab. */
export function GameBuilder({ project, change, persist, action }: { project: Project; change: (patch: Partial<Project>) => void; persist: (next?: Project) => Promise<any>; action: Shared['action'] }) {
  const status = useQuery<Status>({ queryKey: ['game-builder-status'], queryFn: () => api('gameStatus') });
  const available = !!status.data?.available;
  const builds = useMemo(() => projectBuilds(project), [project]);
  const [name, setName] = useState(() => builds[0]?.name ?? 'main');
  const fileContent = project.files.find((file) => file.name === buildFileName(name))?.content ?? '';
  const saved = useMemo(() => builds.find((item) => item.name === name), [fileContent, name]);
  const savedOps: Op[] = saved?.ops ?? [];
  const savedHash = useMemo(() => opsHash(savedOps), [saved]);
  const [state, setState] = useState<State>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [message, setMessage] = useState('');
  const [tool, setTool] = useState('set');
  const [role, setRole] = useState('primary');
  const [brush, setBrush] = useState(2);
  const [group, setGroup] = useState('');
  const [corner, setCorner] = useState<number[] | null>(null);
  const [showRig, setShowRig] = useState(true);
  const [panel, setPanel] = useState<'build' | 'import'>('build');
  const [pose, setPose] = useState<any>(null);
  const [look, setLook] = useState<'pixel' | 'voxel'>('pixel');
  const latest = useRef<Frame | null>(null);
  const run = async (ops: Op[], label = '') => {
    setMessage('');
    const result = await api('gameBuilderApply', { projectId: project.id, name, ops });
    setState(result.state);
    if (!result.ok) setMessage(result.errors.map((e: any) => e.message).join(' '));
    else if (label) setMessage(label);
    return result;
  };
  const apply = (ops: Op[], label = '') => void action(async () => { await run(ops, label); });

  const preview = usePreview((hit) => void onPick(hit).catch((error) => setMessage(error.message)), (bone, at) => apply([{ op: 'joint', bone, at }], `Moved ${bone}.`));
  // Open the build from its saved ops (saved ops that extend the open build stream in; unsaved work on top is kept).
  useEffect(() => {
    if (!available) return;
    let alive = true;
    api('gameBuilderOpen', { projectId: project.id, name, ops: savedOps, pace: true }).then((result: any) => { if (alive) { setState(result.state); if (result.how === 'reloaded') setMessage('Reloaded the saved build.'); } }).catch((error: Error) => alive && setMessage(error.message));
    return () => { alive = false; };
  }, [available, project.id, name, savedHash]);
  // Frames as they come: the latest after the one drawn, waited for in main (a slow screen skips frames, never queues them).
  useEffect(() => {
    if (!available) return;
    let alive = true, after = 0, refresh: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      while (alive) {
        try {
          const next = await api('gameBuilderFrame', { projectId: project.id, name, after });
          if (!alive) break;
          after = next.seq;
          if (!next.frame) continue;
          latest.current = next.frame; setFrame(next.frame); setPose(null);
          preview.post({ type: 'frame', frame: next.frame });
          clearTimeout(refresh);
          refresh = setTimeout(() => { if (alive) api('gameBuilderState', { projectId: project.id, name }).then((value: State) => alive && setState(value)).catch(() => {}); }, 350);
        } catch { await new Promise((resolve) => setTimeout(resolve, 800)); }
      }
    })();
    return () => { alive = false; clearTimeout(refresh); };
  }, [available, project.id, name]);
  useEffect(() => { if (preview.ready && latest.current) preview.post({ type: 'frame', frame: latest.current }); }, [preview.ready]);
  const spec = TOOLS.find((item) => item.id === tool)!;
  useEffect(() => { preview.post({ type: 'tool', mode: spec.clicks && state?.mode !== 'character' && !pose ? 'pick' : 'orbit', erase: tool === 'erase' || tool === 'paint', showRig }); setCorner(null); }, [tool, showRig, preview.ready, state?.mode, !!pose]);

  async function onPick(hit: Hit) {
    const cell = (hit.alt || tool === 'paint' || tool === 'erase') ? hit.on : hit.add;
    if (!cell) return;
    const r = tool === 'erase' ? null : role;
    if (spec.clicks === 1 && !(tool === 'erase' && hit.shift)) {
      if (tool === 'sphere') return void await run([{ op: 'sphere', center: cell, radius: brush, role: r }]);
      return void await run([{ op: 'set', at: cell, role: r }]);
    }
    if (!corner) { setCorner(cell); return; }
    const from = corner; setCorner(null);
    if (tool === 'group') { if (!group) throw Error('Name the group first (Groups, below).'); await run([{ op: 'group', name: group, from, to: cell }], `Grouped a region as ${group}.`); return; }
    if (tool === 'fill') return void await run([{ op: 'fill', from, to: cell, role: r, only: null }]);
    if (tool === 'line') return void await run([{ op: 'line', from, to: cell, role: r, radius: Math.max(0, brush - 1) }]);
    await run([{ op: 'box', from, to: cell, role: r }]);
  }

  async function saveBuild(withPack: boolean) {
    const log = (await api('gameBuilderState', { projectId: project.id, name, log: true })).ops as Op[];
    let next = withBuildFile(project, name, log) as Project;
    const files: string[] = [`builds/${name}.build.json`];
    if (withPack) {
      const pack = await api('gameBuilderExport', { projectId: project.id, name, look });
      const list = [{ name: packFileName(pack.id), content: pack.code }, ...pack.attributes.map((a: any) => ({ name: packFileName(a.id), content: a.code }))];
      next = withPackFiles(next, list) as Project;
      files.push(...list.map((file) => file.name));
    }
    change({ files: next.files }); await persist(next);
    setMessage(`Saved ${files.join(', ')} to the project.`);
  }

  if (status.data && !available) return <div className="builder"><div className="notice game-unavailable"><strong>Game engine not connected</strong><p>{status.data.reason}</p></div></div>;
  const model = state?.model;
  const roles: string[] = [...new Set([...(state?.catalogue?.roles ?? ['primary', 'secondary', 'trim', 'accent', 'skin', 'dark', 'glow']), ...(model?.roles ?? [])])];
  const unsaved = !!state && state.opsHash !== savedHash;
  // (The frame is the build as it is now; the state lags a stream, so the counts come from the frame.)
  const live = state && frame?.history && frame.key === state.key ? { ...state, model: { ...state.model, count: frame.kind === 'voxels' ? frame.voxels : state.model.count }, history: { ...state.history, ...frame.history }, target: frame.target ?? state.target } : state;
  return <div className="builder">
    <CodecInspectorHost project={project} />
    <div className="game-heading builder-heading"><div><div className="eyebrow">BUILDER · VOXELS AND CHARACTERS</div><h2>Build it, rig it, or ask for it.</h2><p>Block by block like a voxel builder, or a capsule-and-rig character like the games use. Every click and every assistant step is a builder op: it lands in the history, draws as it streams, and saves as a pack file.</p></div>
      <div className="builder-actions"><Badge tone={unsaved ? 'warm' : ''}>{unsaved ? 'Unsaved build changes' : 'Build saved'}</Badge>
        <button onClick={() => void action(() => saveBuild(false))}>Save build</button><button className="primary" onClick={() => void action(() => saveBuild(true))}>Save build &amp; pack file</button></div></div>
    <div className="builder-bar">
      <Field label="Build"><select aria-label="Build" value={name} onChange={(event) => setName(event.target.value)}>{[...new Set([name, ...builds.map((item) => item.name)])].map((item) => <option key={item} value={item}>{item}{builds.some((b) => b.name === item) ? '' : ' (new)'}</option>)}</select></Field>
      <NewBuild onCreate={(value) => setName(value)} />
      <div className="builder-tabs" role="tablist">{(['build', 'import'] as const).map((item) => <button key={item} role="tab" aria-selected={panel === item} className={panel === item ? 'selected' : ''} onClick={() => setPanel(item)}>{item === 'build' ? 'Build' : 'Import 3D'}</button>)}</div>
    </div>
    {saved?.error && <p role="alert" className="notice error">{saved.error}</p>}
    {message && <p role="status" className="notice builder-message">{message}</p>}
    <div className="builder-layout">
      <aside className="builder-tools">
        <div className="builder-tool-grid" role="toolbar" aria-label="Brushes">{TOOLS.map((item) => <button key={item.id} aria-pressed={tool === item.id} className={tool === item.id ? 'selected' : ''} disabled={state?.mode === 'character' && item.clicks > 0} title={item.hint} onClick={() => setTool(item.id)}>{item.label}</button>)}</div>
        <p className="builder-hint">{corner ? `First corner ${corner.join(', ')}: click the other.` : spec.hint}{spec.clicks ? ' Alt-click works on the block itself.' : ''}</p>
        <div className="builder-palette" role="radiogroup" aria-label="Role">{roles.map((item) => <button key={item} role="radio" aria-checked={role === item} className={role === item ? 'selected' : ''} onClick={() => setRole(item)}><i style={{ background: rgb(frame?.look, item) }} />{item}</button>)}</div>
        <Field label={`Brush size · ${brush}`}><input aria-label="Brush size" type="range" min={1} max={8} value={brush} onChange={(event) => setBrush(Number(event.target.value))} /></Field>
        <Field label="Symmetry"><select aria-label="Symmetry" value={model?.symmetry?.mode ?? 'none'} onChange={(event) => apply([{ op: 'symmetry', mode: event.target.value }])}>{SYMMETRY.map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="Group"><select aria-label="Group" value={group} onChange={(event) => setGroup(event.target.value)}><option value="">(none)</option>{(state?.groups ?? []).map((g: any) => <option key={g.name}>{g.name}</option>)}</select></Field>
        <form className="inline-actions builder-inline" onSubmit={(event) => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get('group') ?? '').trim(); if (/^[a-z0-9][a-z0-9.-]*$/i.test(value)) { setGroup(value); setTool('group'); } }}><input name="group" aria-label="New group name" placeholder="new group (e.g. door)" maxLength={40} /><button>Name</button></form>
        <RoleLook roles={roles} look={frame?.look} apply={apply} />
      </aside>
      <section className="builder-stage">
        <div className="pane-title">{pose ? `CLIP · ${pose.clip}` : 'LIVE BUILD'} <Badge>engine pixel renderer · sandboxed</Badge></div>
        <div className="builder-views-row"><div className="builder-frame">{available && <iframe ref={preview.ref} title="Builder preview" sandbox="allow-scripts" src={BUILDER_PREVIEW_URL} onLoad={() => undefined} />}</div>
          <SpritePane project={project} build={name} preview={preview} drawn={frame ? `${frame.key}:${frame.n ?? 0}` : ''} /></div>
        {preview.error && <p role="alert" className="notice error">{preview.error}</p>}
        <div className="builder-stage-actions">
          <button disabled={!live?.history?.total} onClick={() => apply([{ op: 'undo' }])}>↶ Undo</button><button disabled={!live?.history?.undone} onClick={() => apply([{ op: 'redo' }])}>↷ Redo</button>
          <button onClick={() => preview.post({ type: 'camera', fit: true })}>Frame it</button>
          <label className="checkbox"><input type="checkbox" checked={showRig} onChange={(event) => setShowRig(event.target.checked)} />Rig overlay</label>
          <select aria-label="Preview resolution" defaultValue="256" onChange={(event) => preview.post({ type: 'tool', size: Number(event.target.value) })}><option value="128">128 px</option><option value="192">192 px</option><option value="256">256 px</option></select>
          {pose && <button onClick={() => { setPose(null); if (latest.current) preview.post({ type: 'frame', frame: { ...latest.current, reset: false } }); }}>Back to the build</button>}
        </div>
        <p className="game-hint">{frame?.label ?? 'Opening the build…'}</p>
        {live && <Stats state={live} />}
      </section>
      <div className="builder-side">
        {panel === 'import' ? <ImportPanel project={project} build={name} state={state} action={action} run={run} setMessage={setMessage} /> : <>
          <StartPanel state={state} apply={apply} />
          {state?.mode === 'character' ? <CharacterPanel state={state} apply={apply} /> : <><GroupsPanel state={state} group={group} setGroup={setGroup} apply={apply} /><RigPanel state={state} apply={apply} /></>}
          <TargetPanel state={state} apply={apply} />
          <MotionPanel project={project} build={name} preview={preview} setPose={setPose} action={action} />
          <VariantsPanel project={project} build={name} preview={preview} action={action} state={state} run={run} setMessage={setMessage} />
          <BakePanel project={project} build={name} preview={preview} action={action} />
          <PackPanel project={project} build={name} action={action} look={look} setLook={setLook} />
          <OpsPanel apply={apply} />
          <HistoryPanel state={live} />
        </>}
      </div>
    </div>
  </div>;
}

function NewBuild({ onCreate }: { onCreate: (name: string) => void }) {
  const [value, setValue] = useState('');
  const ok = buildNameSchema.safeParse(value).success;
  return <form className="inline-actions builder-new" onSubmit={(event) => { event.preventDefault(); if (ok) { onCreate(value); setValue(''); } }}><input aria-label="New build name" value={value} maxLength={63} placeholder="new build (e.g. war-banner)" onChange={(event) => setValue(event.target.value.toLowerCase())} /><button disabled={!ok}>New build</button></form>;
}

function Stats({ state }: { state: State }) {
  const m = state.model, c = state.character;
  return <div className="measurement-grid builder-stats">
    <div><span>{c ? 'CHARACTER' : 'VOXELS'}</span><strong>{c ? `${c.kind} ${c.species}` : m.count.toLocaleString()}</strong><small>{c ? c.contract : `${m.unit} m a voxel · ${m.roles.length} roles`}</small></div>
    <div><span>BECOMES</span><strong>{state.target?.as ?? 'object'}</strong><small>{state.target?.id ?? m.name}{state.target?.slot ? ` · ${state.target.slot}` : ''}</small></div>
    <div><span>HISTORY</span><strong>{state.history.total} ops</strong><small>{state.history.undone ? `${state.history.undone} to redo` : 'each one undoable'}</small></div>
  </div>;
}

function RoleLook({ roles, look, apply }: { roles: string[]; look?: Look; apply: (ops: Op[], label?: string) => void }) {
  const [target, setTarget] = useState('primary');
  const [hue, setHue] = useState(55);
  return <details className="builder-section"><summary>Role colours</summary><p className="builder-hint">A role's suggested colour (OKLCH); a game's looks can replace it. Recolouring cells is a separate op.</p>
    <Field label="Role"><select aria-label="Role to colour" value={target} onChange={(event) => setTarget(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></Field>
    <Field label={`Hue · ${hue}°`}><input aria-label="Role hue" type="range" min={0} max={359} value={hue} onChange={(event) => setHue(Number(event.target.value))} onPointerUp={() => apply([{ op: 'look', role: target, colour: [0.62, 0.13, hue] }])} onKeyUp={() => apply([{ op: 'look', role: target, colour: [0.62, 0.13, hue] }])} /></Field>
    <div className="builder-swatch" style={{ background: rgb(look, target) }} /></details>;
}

function StartPanel({ state, apply }: { state: State; apply: (ops: Op[], label?: string) => void }) {
  const cat = state?.catalogue;
  const [kind, setKind] = useState('critter');
  const [seed, setSeed] = useState('7');
  const [plan, setPlan] = useState('quadruped');
  const [ck, setCk] = useState('anthro');
  const [species, setSpecies] = useState('fox');
  const speciesList: string[] = cat?.species?.[ck] ?? [];
  return <details className="builder-section" open={!state?.history?.total}><summary>Start</summary>
    <p className="builder-hint">Everything here is an op too, so Undo takes it back.</p>
    <div className="builder-row"><Field label="Generate"><select aria-label="Generator" value={kind} onChange={(event) => setKind(event.target.value)}>{(cat?.generators ?? ['critter']).map((item: string) => <option key={item}>{item}</option>)}</select></Field>
      <Field label="Seed"><input aria-label="Generator seed" value={seed} maxLength={32} onChange={(event) => setSeed(event.target.value)} /></Field>
      {kind === 'critter' && <Field label="Legs"><select aria-label="Critter legs" value={plan} onChange={(event) => setPlan(event.target.value)}><option value="quadruped">four</option><option value="humanoid">two</option></select></Field>}</div>
    <div className="inline-actions"><button onClick={() => apply([{ op: 'generate', kind, seed: seed || '1', ...(kind === 'critter' ? { plan } : {}) }], `Generated a ${kind}.`)}>Generate</button><button onClick={() => apply([{ op: 'new', name: 'model', unit: 0.1 }], 'A new empty model.')}>New empty model</button></div>
    <div className="builder-row"><Field label="Character"><select aria-label="Character kind" value={ck} onChange={(event) => { setCk(event.target.value); setSpecies((cat?.species?.[event.target.value] ?? [''])[0]); }}>{(cat?.kinds ?? ['humanoid', 'anthro', 'animal']).map((item: string) => <option key={item}>{item}</option>)}</select></Field>
      <Field label="Species"><select aria-label="Character species" value={species} onChange={(event) => setSpecies(event.target.value)}>{speciesList.map((item) => <option key={item}>{item}</option>)}</select></Field></div>
    <button onClick={() => apply([{ op: 'character', kind: ck, ...(species ? { species } : {}), seed: seed || '1' }], `A ${ck} ${species}.`)}>Start a character</button>
  </details>;
}

function CharacterPanel({ state, apply }: { state: State; apply: (ops: Op[], label?: string) => void }) {
  const c = state.character;
  const [part, setPart] = useState({ id: 'horn.L', shape: 'capsule', on: 'head', role: 'dark', a: '-0.22,-0.1,0.05', b: '-0.4,0.7,-0.1', r: '0.09', c: '0,0.15,-0.45', h: '0.08,0.45,0.5', lo: '0.05' });
  const [wear, setWear] = useState('');
  const set = (field: string, value: string) => setPart((current) => ({ ...current, [field]: value }));
  const addPart = () => {
    const op: Op = { op: 'part', id: part.id, shape: part.shape, on: part.on, role: part.role };
    if (part.shape === 'capsule') { op.a = vec(part.a); op.b = vec(part.b); op.r = Number(part.r); } else { op.c = vec(part.c); op.h = vec(part.h); if (part.shape === 'wedge') op.lo = Number(part.lo); }
    apply([op], `Part ${part.id} on ${part.on}.`);
  };
  return <>
    <details className="builder-section" open><summary>Character · {c.kind} {c.species}</summary>
      <p className="builder-hint">{c.contract} · seed {c.seed}. Unpinned choices come from the seed.</p>
      <div className="builder-choices">{c.choices.filter((choice: any) => choice.options || choice.range).map((choice: any) => <Field key={choice.name} label={`${choice.name}${choice.name in c.pins ? ' · pinned' : ''}`}>{choice.options
        ? <select aria-label={`Choice ${choice.name}`} value={choice.name in c.pins ? JSON.stringify(c.pins[choice.name]) : ''} onChange={(event) => apply([event.target.value ? { op: 'pin', choice: choice.name, value: JSON.parse(event.target.value) } : { op: 'unpin', choice: choice.name }])}><option value="">from seed ({String(choice.value)})</option>{choice.options.map((option: unknown) => <option key={JSON.stringify(option)} value={JSON.stringify(option)}>{String(option)}</option>)}</select>
        : <input aria-label={`Choice ${choice.name}`} type="number" step={0.01} min={choice.range[0]} max={choice.range[1]} defaultValue={Number(c.pins[choice.name] ?? choice.value).toFixed(2)} onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value !== Number(c.pins[choice.name] ?? choice.value)) apply([{ op: 'pin', choice: choice.name, value }]); }} />}</Field>)}</div>
    </details>
    <details className="builder-section"><summary>Proportions</summary><div className="builder-proportions">{Object.entries(c.proportions).map(([key, value]) => <div key={key}><span>{key}</span><small>{Number(value).toFixed(3)} m</small><button aria-label={`Shrink ${key}`} onClick={() => apply([{ op: 'proportion', name: key, scale: 0.9 }])}>−</button><button aria-label={`Grow ${key}`} onClick={() => apply([{ op: 'proportion', name: key, scale: 1.1 }])}>+</button></div>)}</div></details>
    <details className="builder-section"><summary>Parts · {c.parts.length}</summary>
      {c.parts.map((p: any) => <div className="builder-list-row" key={p.id}><span><strong>{p.id}</strong> {p.shape} on {p.on} · {p.role}</span><button className="text-button" onClick={() => apply([{ op: 'unpart', id: p.id }])}>Remove</button></div>)}
      <div className="builder-row"><Field label="Id"><input aria-label="Part id" value={part.id} onChange={(event) => set('id', event.target.value)} /></Field><Field label="Shape"><select aria-label="Part shape" value={part.shape} onChange={(event) => set('shape', event.target.value)}><option>capsule</option><option>box</option><option>wedge</option></select></Field></div>
      <div className="builder-row"><Field label="On"><select aria-label="Part on" value={part.on} onChange={(event) => set('on', event.target.value)}><optgroup label="Sockets">{c.sockets.map((item: string) => <option key={`s-${item}`}>{item}</option>)}</optgroup><optgroup label="Bones">{c.bones.filter((item: string) => !c.sockets.includes(item)).map((item: string) => <option key={`b-${item}`}>{item}</option>)}</optgroup></select></Field><Field label="Role"><select aria-label="Part role" value={part.role} onChange={(event) => set('role', event.target.value)}>{CHARACTER_ROLES.map((item) => <option key={item}>{item}</option>)}</select></Field></div>
      {part.shape === 'capsule' ? <div className="builder-row"><Field label="a"><input aria-label="Part a" value={part.a} onChange={(event) => set('a', event.target.value)} /></Field><Field label="b"><input aria-label="Part b" value={part.b} onChange={(event) => set('b', event.target.value)} /></Field><Field label="r"><input aria-label="Part r" value={part.r} onChange={(event) => set('r', event.target.value)} /></Field></div>
        : <div className="builder-row"><Field label="centre"><input aria-label="Part c" value={part.c} onChange={(event) => set('c', event.target.value)} /></Field><Field label="half size"><input aria-label="Part h" value={part.h} onChange={(event) => set('h', event.target.value)} /></Field>{part.shape === 'wedge' && <Field label="lo"><input aria-label="Part lo" value={part.lo} onChange={(event) => set('lo', event.target.value)} /></Field>}</div>}
      <p className="builder-hint">On a socket the numbers are shares of its size, so a part fits a mouse's head and a bear's.</p>
      <button onClick={addPart}>Add / edit part</button>
    </details>
    <details className="builder-section"><summary>Wears · {c.wear.length}</summary>
      {c.wear.map((w: any) => <div className="builder-list-row" key={w.attribute}><span>{w.attribute}</span><button className="text-button" onClick={() => apply([{ op: 'unwear', attribute: w.attribute }])}>Take off</button></div>)}
      <div className="inline-actions"><select aria-label="Attribute to wear" value={wear} onChange={(event) => setWear(event.target.value)}><option value="">Choose an attribute…</option>{state.attributes.map((a: any) => <option key={a.id} value={a.id}>{a.id} · {a.slot}</option>)}</select><button disabled={!wear} onClick={() => apply([{ op: 'wear', attribute: wear }], `Wearing ${wear}.`)}>Wear</button></div>
    </details>
  </>;
}

function GroupsPanel({ state, group, setGroup, apply }: { state: State; group: string; setGroup: (value: string) => void; apply: (ops: Op[], label?: string) => void }) {
  const groups: any[] = state?.groups ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  const [socket, setSocket] = useState('head');
  const [motion, setMotion] = useState('sway');
  const [from, setFrom] = useState('primary');
  const [to, setTo] = useState('secondary');
  const sockets: string[] = state?.rig?.sockets?.length ? state.rig.sockets : ['head', 'face', 'neck', 'chest', 'back', 'waist', 'hand.L', 'hand.R', 'foot.L', 'foot.R', 'tail'];
  const g = groups.find((item) => item.name === group);
  return <details className="builder-section" open={groups.length > 0}><summary>Groups · {groups.length}</summary>
    {!groups.length && <p className="builder-hint">Name a region with the Group brush: groups name parts, move (motions), vary, and can be worn in a socket.</p>}
    {groups.map((item) => <label key={item.name} className={`builder-list-row ${group === item.name ? 'selected' : ''}`}><input type="checkbox" aria-label={`Select group ${item.name}`} checked={picked.includes(item.name)} onChange={(event) => setPicked(event.target.checked ? [...picked, item.name] : picked.filter((name) => name !== item.name))} /><button className="text-button" onClick={(event) => { event.preventDefault(); setGroup(item.name); }}>{item.name}</button><small>{item.cells} voxels{item.attached ? ` · worn in ${item.attached.socket}` : ''}</small></label>)}
    {picked.length > 1 && <button onClick={() => { apply([{ op: 'merge', groups: picked }], `Merged into ${picked[0]}.`); setPicked([]); }}>Merge {picked.length} groups</button>}
    {g && <div className="builder-group-actions"><h4>{g.name}</h4>
      <div className="inline-actions"><select aria-label="Socket" value={socket} onChange={(event) => setSocket(event.target.value)}>{sockets.map((item) => <option key={item}>{item}</option>)}</select><button onClick={() => apply([{ op: 'attach', group: g.name, socket }], `${g.name} is worn in ${socket}.`)}>Wear in socket</button>{g.attached && <button onClick={() => apply([{ op: 'detach', group: g.name }], `${g.name} is body again.`)}>Make body</button>}</div>
      <div className="inline-actions"><select aria-label="Motion" value={motion} onChange={(event) => setMotion(event.target.value)}>{MOTIONS.map((item) => <option key={item}>{item}</option>)}</select><button onClick={() => apply([{ op: 'animate', group: g.name, motion }], `${g.name}: ${motion}.`)}>Add motion</button></div>
      <div className="inline-actions"><button onClick={() => apply([{ op: 'vary', group: g.name, y: [0.8, 1.25], anchor: 'bottom' }], `${g.name} varies in height.`)}>Vary its height</button><button onClick={() => apply([{ op: 'vary', group: g.name, optional: 0.6 }], `${g.name} is optional.`)}>Make it optional</button></div>
      <div className="inline-actions"><select aria-label="Recolour from" value={from} onChange={(event) => setFrom(event.target.value)}>{state.model.roles.map((item: string) => <option key={item}>{item}</option>)}</select><span>→</span><select aria-label="Recolour to" value={to} onChange={(event) => setTo(event.target.value)}>{(state.catalogue?.roles ?? []).map((item: string) => <option key={item}>{item}</option>)}</select><button onClick={() => apply([{ op: 'recolour', from, to, group: g.name }])}>Recolour</button></div>
      <button className="text-button" onClick={() => apply([{ op: 'ungroup', name: g.name }])}>Forget this group</button>
    </div>}
  </details>;
}

function RigPanel({ state, apply }: { state: State; apply: (ops: Op[], label?: string) => void }) {
  const rig = state?.rig;
  const [limbs, setLimbs] = useState('auto');
  return <details className="builder-section" open={!!rig}><summary>Rig{rig?.plan ? ` · ${rig.plan}` : ''}</summary>
    <p className="builder-hint">Rig it on the engine's own bones: read from the shape, or say which. Then drag the yellow joints in the view; each drop is a joint op.</p>
    <div className="inline-actions">{['auto', 'humanoid', 'quadruped'].map((as) => <button key={as} disabled={!state?.model?.count} onClick={() => apply([{ op: 'rig', as, limbs }], `Rigged (${as}).`)}>{as === 'auto' ? 'Auto-rig' : `As ${as}`}</button>)}<select aria-label="Limbs" value={limbs} onChange={(event) => setLimbs(event.target.value)}><option value="auto">limbs: auto</option><option value="capsule">limbs: capsules</option><option value="rigid">limbs: rigid</option></select></div>
    {rig?.kind === 'error' && <p className="notice error">{rig.error}</p>}
    {rig?.missing?.length > 0 && <p className="builder-hint">Missing sockets: {rig.missing.join(', ')}.</p>}
    {rig?.bones?.length > 0 && <p className="builder-hint">{rig.bones.length} bones · sockets {rig.sockets?.join(', ')}</p>}
  </details>;
}

function TargetPanel({ state, apply }: { state: State; apply: (ops: Op[], label?: string) => void }) {
  const t = state?.target ?? { as: 'object' };
  const [as, setAs] = useState<string>(t.as);
  const [id, setId] = useState<string>(t.id ?? '');
  const [slot, setSlot] = useState<string>(t.slot ?? 'head');
  useEffect(() => { setAs(t.as); setId(t.id ?? ''); if (t.slot) setSlot(t.slot); }, [t.as, t.id, t.slot]);
  return <details className="builder-section"><summary>Becomes · {t.as}{t.id ? ` ${t.id}` : ''}</summary>
    <div className="builder-row"><Field label="As"><select aria-label="Target" value={as} onChange={(event) => setAs(event.target.value)} disabled={state?.mode === 'character'}><option value="object">object</option><option value="attribute">attribute (worn)</option><option value="entity">entity (rigged)</option></select></Field><Field label="Id"><input aria-label="Target id" value={id} maxLength={60} onChange={(event) => setId(event.target.value.toLowerCase())} /></Field>{as === 'attribute' && <Field label="Slot"><input aria-label="Target slot" value={slot} onChange={(event) => setSlot(event.target.value)} /></Field>}</div>
    <button onClick={() => apply([{ op: 'target', as, ...(id ? { id } : {}), ...(as === 'attribute' ? { slot } : {}) }], `It becomes an ${as}.`)}>Set</button>
  </details>;
}

function MotionPanel({ project, build, preview, setPose, action }: { project: Project; build: string; preview: ReturnType<typeof usePreview>; setPose: (value: any) => void; action: Shared['action'] }) {
  const [clips, setClips] = useState<any>(null);
  const [frame, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const show = (data: any, index: number, reset = false) => { const f = data.frames[index]; preview.post({ type: 'frame', frame: { key: `pose:${data.clip}`, kind: 'pose', ...f, look: data.look, unit: 1, pivot: [0, 0, 0], voxels: 0, rig: null, reset, label: `${data.clip} · frame ${index + 1}/${data.frames.length}` } }); };
  const load = (clip?: string) => void action(async () => { const data = await api('gameBuilderPoses', { projectId: project.id, name: build, ...(clip ? { clip } : {}) }); setClips(data); setFrameIndex(0); setPose(data); show(data, 0, true); });
  useEffect(() => {
    if (!playing || !clips) return;
    const period = (clips.info?.period ?? 1) * 1000 / Math.max(1, clips.frames.length);
    const timer = setInterval(() => setFrameIndex((value) => { const next = (value + 1) % clips.frames.length; show(clips, next); return next; }), Math.max(60, period));
    return () => clearInterval(timer);
  }, [playing, clips]);
  return <details className="builder-section"><summary>Motion &amp; clips</summary>
    <p className="builder-hint">An object's motions (hinge, spin, sway, bob, wave, flicker) and a rigged creature's or character's walk cycles, posed frame by frame the way the baker poses them.</p>
    <div className="inline-actions"><button onClick={() => load()}>Load clips</button>{clips && <select aria-label="Clip" value={clips.clip} onChange={(event) => load(event.target.value)}>{clips.clips.map((c: any) => <option key={c.name} value={c.name}>{c.name} · {c.frames} frames</option>)}</select>}</div>
    {clips && <div className="builder-timeline"><button aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>{playing ? '❚❚' : '▶'}</button><input aria-label="Timeline" type="range" min={0} max={clips.frames.length - 1} value={frame} onChange={(event) => { const index = Number(event.target.value); setPlaying(false); setFrameIndex(index); show(clips, index); }} /><small>{frame + 1}/{clips.frames.length}</small></div>}
  </details>;
}

function VariantsPanel({ project, build, preview, action, state, run, setMessage }: { project: Project; build: string; preview: ReturnType<typeof usePreview>; action: Shared['action']; state: State; run: (ops: Op[], label?: string) => Promise<any>; setMessage: (value: string) => void }) {
  const [result, setResult] = useState<{ images: string[]; data: any } | null>(null);
  const [review, setReview] = useState<{ index: number; ops: Op[]; why: string[]; label: string } | null>(null);
  const [used, setUsed] = useState<{ index: number; ops: number } | null>(null);
  const load = () => void action(async () => { setReview(null); setUsed(null); const data = await api('gameBuilderVariants', { projectId: project.id, name: build, count: 6 }); const shots = data.variants.length ? await preview.request({ type: 'shots', shots: data.variants.map((v: any) => ({ ...v, size: 96 })) }) : { images: [] }; setResult({ images: shots.images, data }); });
  const caption = (index: number) => result!.data.variants[index].seed ?? (Object.entries(result!.data.variants[index].picked ?? {}).map(([k, v]) => `${k} ${typeof v === 'number' ? v.toFixed(2) : String(v)}`).join(' · ') || `#${index + 1}`);
  // Picking a variant previews it; "Use this variant" makes the build into it with ops (undoable), a review first when those ops would throw work away.
  const apply = async (index: number, ops: Op[], label: string) => { const r = await run(ops, label); if (r.ok) { setUsed({ index, ops: r.applied }); setMessage(`${label} ${r.applied} ops, each undoable (Undo variant takes them all back).`); } };
  const use = (index: number) => void action(async () => {
    const made = await api('gameBuilderVariantOps', { projectId: project.id, name: build, index, count: 6 });
    if (!made.ops.length) { setMessage('That variant is the build as it is: nothing to change.'); return; }
    const label = `Used variant ${index + 1} (${caption(index)}):`;
    const risky = destructiveOps(made.ops, state);
    if (risky.length) { setReview({ index, ops: made.ops, why: [...new Set(risky.map((item: { why: string }) => item.why))], label }); return; }
    await apply(index, made.ops, label);
  });
  return <details className="builder-section"><summary>Variants</summary>
    <p className="builder-hint">What the generative asset becomes per seed: a voxel build through its variation rules, a character through other seeds with the same pins, parts and wear. Pick one to see it; use it to make the build into it.</p>
    <button onClick={load}>Show six seeds</button>
    {result?.data.note && <p className="builder-hint">{result.data.note}</p>}
    {result && <div className="builder-strip">{result.images.map((url, index) => <figure key={index}><img src={url} alt={`Variant ${index + 1}`} /><figcaption>{caption(index)}</figcaption><button className="text-button variant-use" onClick={() => use(index)}>Use this variant</button></figure>)}</div>}
    {review && <div className="agent-action variant-review" role="alertdialog" aria-label="Review variant"><div className="agent-action-title"><strong>Review: use variant {review.index + 1}</strong></div><p className="builder-hint">{review.ops.length} ops that {review.why.join('; ')}. Your build stays in the history: Undo brings it back.</p>
      <div className="inline-actions"><button className="primary" onClick={() => void action(async () => { const r = review; setReview(null); await apply(r.index, r.ops, r.label); })}>Apply variant</button><button onClick={() => setReview(null)}>Cancel</button></div></div>}
    {used && <div className="inline-actions"><small className="builder-hint">Variant {used.index + 1} is in the build ({used.ops} ops).</small><button onClick={() => void action(async () => { const n = used.ops; setUsed(null); await run([{ op: 'undo', steps: n }], `Took variant back (${n} ops).`); })}>Undo variant</button></div>}
  </details>;
}

function BakePanel({ project, build, preview, action }: { project: Project; build: string; preview: ReturnType<typeof usePreview>; action: Shared['action'] }) {
  const [sheets, setSheets] = useState<any[] | null>(null);
  const bake = () => void action(async () => { const source = await api('gameBuilderPoses', { projectId: project.id, name: build }); const result = await preview.request({ type: 'bake', source, sizes: [32, 64, 128], directions: 4 }); setSheets(result.sheets); });
  return <details className="builder-section"><summary>Bake preview</summary>
    <p className="builder-hint">The engine's baker: the first clip from four sides at 32, 64 and 128 pixels tall, palette, dither and outline as a game draws it.</p>
    <button onClick={bake}>Bake 32 · 64 · 128</button>
    {sheets && <div className="builder-bakes">{sheets.map((sheet) => <figure key={sheet.size}><img src={sheet.url} alt={`Baked at ${sheet.size} px`} style={{ width: Math.min(560, sheet.size <= 32 ? 4 * sheet.frames * (sheet.w + 2) : sheet.size <= 64 ? 2 * sheet.frames * (sheet.w + 2) : sheet.frames * (sheet.w + 2)) }} /><figcaption>{sheet.size} px · {sheet.sprites} sprites · {sheet.ms} ms</figcaption></figure>)}</div>}
  </details>;
}

function PackPanel({ project, build, action, look, setLook }: { project: Project; build: string; action: Shared['action']; look: 'pixel' | 'voxel'; setLook: (value: 'pixel' | 'voxel') => void }) {
  const [pack, setPack] = useState<any>(null);
  return <details className="builder-section"><summary>Pack file</summary>
    <p className="builder-hint">One TypeScript file per asset, like every asset in the engine's packs; worn groups get a file each. “Save build &amp; pack file” writes them to the project under packs/.</p>
    <Field label="Look"><select aria-label="Pack look" value={look} onChange={(event) => { setLook(event.target.value as 'pixel' | 'voxel'); setPack(null); }}><option value="pixel">pixel (default: capsules for long boxes, baked as pixel art)</option><option value="voxel">voxel (blocky, as built)</option></select></Field>
    <button onClick={() => void action(async () => setPack(await api('gameBuilderExport', { projectId: project.id, name: build, look })))}>Show the pack file</button>
    {pack && <><p className="builder-hint">{packFileName(pack.id)} · {pack.kind} · {pack.look} look · {pack.code.length.toLocaleString()} characters{pack.attributes.length ? ` · and ${pack.attributes.map((a: any) => packFileName(a.id)).join(', ')}` : ''}</p><pre className="builder-code">{pack.code}</pre>{/KC1:[A-Za-z0-9_-]+/.test(pack.code) && <button className="text-button" onClick={() => openCodecInspector({ text: /KC1:[A-Za-z0-9_-]+/.exec(pack.code.replace(/"\s*\+\s*"/g, ''))![0], label: `${packFileName(pack.id)} · voxels (KC1)` })}>Inspect the voxel bytes</button>}</>}
  </details>;
}

function OpsPanel({ apply }: { apply: (ops: Op[], label?: string) => void }) {
  const [text, setText] = useState('[\n  { "op": "box", "from": [-2, 0, -2], "to": [1, 3, 1], "role": "primary" }\n]');
  const [error, setError] = useState('');
  return <details className="builder-section"><summary>Ops (JSON)</summary>
    <p className="builder-hint">The same op list the assistant writes. It streams in and draws; each op is undoable.</p>
    <textarea aria-label="Builder ops" className="builder-ops" rows={6} spellCheck={false} value={text} onChange={(event) => setText(event.target.value)} />
    {error && <p className="notice error">{error}</p>}
    <button onClick={() => { try { const ops = JSON.parse(text); if (!Array.isArray(ops)) throw Error('An array of ops.'); setError(''); apply(ops); } catch (e) { setError((e as Error).message); } }}>Run ops</button>
  </details>;
}

function HistoryPanel({ state }: { state: State }) {
  return <details className="builder-section"><summary>History · {state?.history?.total ?? 0}</summary>
    <ol className="builder-history">{(state?.history?.recent ?? []).map((item: any) => <li key={item.seq}><code>{item.op}</code> {item.did}</li>)}</ol>
  </details>;
}

/** The 3D import: a file from the workspace store (or an engine sample) through the engine's import, then into the build. */
function ImportPanel({ project, build, state, action, run, setMessage }: { project: Project; build: string; state: State; action: Shared['action']; run: (ops: Op[], label?: string) => Promise<any>; setMessage: (value: string) => void }) {
  const workspace = queryClient.getQueryData<Workspace>(['workspace']);
  const files = (workspace?.state.objects ?? []).filter((item) => importable(item.name));
  const [objectId, setObjectId] = useState(files[0]?.id ?? '');
  const [sample, setSample] = useState('robot');
  const [voxels, setVoxels] = useState(48);
  const [as, setAs] = useState('auto');
  const [result, setResult] = useState<any>(null);
  const [opened, setOpened] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const run1 = (load: () => Promise<any>) => void action(async () => { setResult(null); setOpened(false); setResult(await load()); });
  async function choose() {
    const current = queryClient.getQueryData<Workspace>(['workspace'])!;
    const next = await api('importObject', { revision: current.revision });
    if (!next) return;
    queryClient.setQueryData(['workspace'], next);
    const object = next.state.objects.at(-1);
    if (!importable(object.name)) throw Error(`${object.name} is kept in Files, but the 3D import reads ${['glTF/GLB', 'OBJ', 'STL', '.vox'].join(', ')}.`);
    setObjectId(object.id);
    setResult(null); setResult(await api('gameImport', { objectId: object.id, voxels, as }));
  }
  const open = () => void action(async () => {
    const r = await run(result.ops, `Opened ${result.name} in the builder: ${result.ops.length} ops.`);
    if (r.ok) setOpened(true);
    setMessage(r.ok ? `Opened ${result.name} in ${build}: ${r.applied} ops drew it.` : r.errors.map((e: any) => e.message).join(' '));
  });
  const parts: any[] = result?.proposal.parts ?? [];
  const worn = new Map<string, any>((result?.proposal.attributes ?? []).map((a: any) => [a.part, a]));
  const sockets: string[] = state?.rig?.sockets?.length ? state.rig.sockets : ['head', 'face', 'neck', 'chest', 'back', 'waist', 'hand.L', 'hand.R', 'foot.L', 'foot.R', 'tail'];
  return <div className="builder-import">
    <section className="builder-section open-section"><h3>Import a 3D model</h3>
      <p className="builder-hint">glTF/GLB, OBJ, STL or MagicaVoxel .vox: voxelised, colours clustered into roles, split into parts, a creature's worn things proposed for sockets. The file stays in Files, content-addressed.</p>
      <div className="builder-row"><Field label="File"><select aria-label="Import file" value={objectId} onChange={(event) => setObjectId(event.target.value)}><option value="">Choose a file…</option>{files.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><button onClick={() => void action(choose)}>Choose a file…</button></div>
      <Field label={`Resolution · ${voxels} voxels along the longest side`}><input aria-label="Import resolution" type="range" min={16} max={96} step={4} value={voxels} onChange={(event) => setVoxels(Number(event.target.value))} /></Field>
      <div className="builder-row"><Field label="Read it as"><select aria-label="Import as" value={as} onChange={(event) => setAs(event.target.value)}><option value="auto">auto</option><option value="creature">a creature</option><option value="object">an object</option></select></Field></div>
      <div className="inline-actions"><button className="primary" disabled={!objectId} onClick={() => run1(() => api('gameImport', { objectId, voxels, as }))}>Import</button><select aria-label="Engine sample" value={sample} onChange={(event) => setSample(event.target.value)}>{SAMPLES.map((item) => <option key={item}>{item}</option>)}</select><button onClick={() => run1(() => api('gameImportSample', { name: sample, voxels, as }))}>Try an engine sample</button></div>
    </section>
    {!result && <Empty title="Nothing imported yet">Choose a file, or try one of the engine's samples (written in code, nothing downloaded).</Empty>}
    {result && <>
      <div className="builder-views">{result.views.map((v: any) => <figure key={v.id}><img src={v.url} alt={v.label} /><figcaption>{v.label}</figcaption></figure>)}</div>
      <p className="builder-hint">{result.proposal.kind === 'creature' ? `A creature (${result.proposal.creature?.plan}, from its ${result.proposal.creature?.source}; ${Math.round((result.proposal.creature?.confidence ?? 0) * 100)}% sure)` : `An object`} · {result.stats.voxels.toLocaleString()} voxels on a {result.stats.grid.join('×')} grid · {result.stats.parts} parts · {result.ops.length} ops · {result.ms} ms</p>
      <div className="inline-actions"><button className="primary" onClick={open}>{opened ? 'Open again in the builder' : 'Open in builder'}</button>{!opened && state?.model?.count > 0 && <small className="builder-hint">It replaces what the build shows now (Undo brings it back).</small>}</div>
      <table className="game-table builder-parts"><thead><tr><th></th><th>Part</th><th>Reads as</th><th>Socket</th><th>Sure</th><th></th></tr></thead><tbody>{parts.map((part) => { const a = worn.get(part.id); const hue = result.hues[part.id]; return <tr key={part.id}>
        <td><input type="checkbox" aria-label={`Pick part ${part.id}`} checked={picked.includes(part.id)} onChange={(event) => setPicked(event.target.checked ? [...picked, part.id] : picked.filter((id) => id !== part.id))} /></td>
        <td><i className="builder-hue" style={{ background: `rgb(${hue.join(',')})` }} /><strong>{part.id}</strong><small>{part.cells} voxels · {part.why?.[0] ?? ''}</small></td>
        <td><Badge tone={part.kind === 'attribute' ? 'warm' : ''}>{part.kind === 'attribute' ? 'worn' : part.kind}</Badge></td>
        <td>{opened ? <select aria-label={`Socket for ${part.id}`} value={a?.slot ?? ''} onChange={(event) => void action(async () => { await run([{ op: 'attach', group: part.id, socket: event.target.value }], `${part.id} worn in ${event.target.value}.`); })}><option value="">body</option>{sockets.map((item) => <option key={item}>{item}</option>)}</select> : (a?.slot ?? '—')}</td>
        <td>{Math.round(((a?.confidence ?? part.confidence) ?? 0) * 100)}%</td>
        <td>{opened && a && <button className="text-button" onClick={() => void action(async () => { await run([{ op: 'detach', group: part.id }], `${part.id} is body now.`); })}>Make body</button>}</td>
      </tr>; })}</tbody></table>
      {opened && <div className="inline-actions">{picked.length > 1 && <button onClick={() => void action(async () => { await run([{ op: 'merge', groups: picked }], `Merged ${picked.join(', ')}.`); setPicked([]); })}>Merge picked parts</button>}
        {picked.length === 1 && <RoleFor part={picked[0]!} roles={state?.model?.roles ?? []} all={state?.catalogue?.roles ?? []} run={run} action={action} />}</div>}
      {!opened && <p className="builder-hint">Open it in the builder to change parts: a socket per worn part (attach), make one body (detach), merge picked parts, a role per part (recolour in its group) — each a builder op, each undoable.</p>}
    </>}
  </div>;
}

function RoleFor({ part, roles, all, run, action }: { part: string; roles: string[]; all: string[]; run: (ops: Op[], label?: string) => Promise<any>; action: Shared['action'] }) {
  const [from, setFrom] = useState(roles[0] ?? 'primary');
  const [to, setTo] = useState(all[0] ?? 'primary');
  return <><select aria-label="Part role from" value={from} onChange={(event) => setFrom(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select><span>→</span><select aria-label="Part role to" value={to} onChange={(event) => setTo(event.target.value)}>{all.map((item) => <option key={item}>{item}</option>)}</select><button onClick={() => void action(async () => { await run([{ op: 'recolour', from, to, group: part }], `${part}: ${from} → ${to}.`); })}>Set {part}'s role</button></>;
}
