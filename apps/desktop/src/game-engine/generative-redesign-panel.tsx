import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, queryClient } from '../client';
import type { Project, Workspace } from '../types';
import { Badge, Empty, Field } from '../ui';
import { importable } from './builder-project.mjs';
import { withGenerativeAsset } from './generative-redesign-project.mjs';
import { STYLED_PREVIEW_URL } from './styled-asset-project.mjs';

type Style = { kind: 'original' | 'pixel' | 'dither' | 'voxel'; pixelSize: number; toneLevels: number; screen: string };
type Reference = { programReference: unknown; providers: string[]; styles: { kinds: Style['kind'][]; screens: string[]; defaults?: Partial<Style> } };
type Candidate = {
  requestId: string; runtimeVersion: string; program: { id: string; title?: string; [key: string]: unknown }; seed: string;
  ops: { op: string; [key: string]: unknown }[]; playback: unknown;
  source: { objectId: string; name: string; descriptor?: unknown };
  settings: { provider: string; model?: string; mode: 'original' | 'theme'; theme: string; guidance: string; style: Style };
  stats?: Record<string, number>; validation: { ok: boolean; errors?: { path?: string; message: string }[] };
};
type Busy = '' | 'picking' | 'generating' | 'previewing' | 'accepting';
const labels = { original: 'Original', pixel: 'Pixel', dither: 'Dither', voxel: 'Voxel' };
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const cancelRequest = (requestId: string | null) => { if (requestId) void api('gameRedesignCancel', { requestId }).catch(() => {}); };

/** A separate author/review session. Nothing applies to the open builder. */
export function GenerativeRedesignPanel({ project, change, persist }: {
  project: Project; change: (patch: Partial<Project>) => void; persist: (next?: Project) => Promise<unknown>;
}) {
  const workspace = useQuery<Workspace>({ queryKey: ['workspace'], queryFn: () => api('workspace') });
  const reference = useQuery<Reference>({ queryKey: ['game-redesign-reference'], queryFn: () => api('gameRedesignReference') });
  const files = (workspace.data?.state.objects ?? []).filter(item => importable(item.name));
  // Choosing a source is deliberate, even when Files contains only one model.
  const [objectId, setObjectId] = useState('');
  const [provider, setProvider] = useState('codex');
  const [model, setModel] = useState('');
  const [seed, setSeed] = useState('1');
  const [mode, setMode] = useState<'original' | 'theme'>('original');
  const [theme, setTheme] = useState('');
  const [guidance, setGuidance] = useState('');
  const [style, setStyle] = useState<Style>({ kind: 'original', pixelSize: 4, toneLevels: 4, screen: '' });
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [drawn, setDrawn] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState<Busy>('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true), epoch = useRef(0), activeRequest = useRef<string | null>(null), busyRef = useRef<Busy>('');
  const latestProject = useRef(project); latestProject.current = project;
  const setWorking = (value: Busy) => { busyRef.current = value; setBusy(value); };
  const current = (token: number) => mounted.current && token === epoch.current;
  const invalidate = () => {
    ++epoch.current;
    const previous = activeRequest.current; activeRequest.current = null;
    cancelRequest(previous);
    setCandidate(null); setDrawn(null); setWorking(''); setMessage(''); setError('');
  };
  const edit = (update: () => void) => { if (busyRef.current === 'accepting') return; invalidate(); update(); };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ++epoch.current; cancelRequest(activeRequest.current); activeRequest.current = null; };
  }, []);
  useEffect(() => {
    const styles = reference.data?.styles;
    if (styles && !style.screen) setStyle(value => ({ ...value, ...styles.defaults, screen: styles.defaults?.screen ?? styles.screens[0] ?? '' }));
  }, [reference.data]);
  useEffect(() => {
    if (workspace.data && objectId && !files.some(file => file.id === objectId)) { invalidate(); setObjectId(''); }
  }, [workspace.data, objectId]);

  async function chooseFile() {
    if (busyRef.current) return;
    invalidate(); const token = epoch.current; setWorking('picking');
    try {
      const before = queryClient.getQueryData<Workspace>(['workspace']);
      if (!before) throw Error('Wait for the workspace files to load.');
      const next: Workspace | null = await api('importObject', { revision: before.revision });
      if (!next) return;
      queryClient.setQueryData(['workspace'], next);
      if (!current(token)) return;
      const file = next.state.objects.at(-1);
      if (!file || !importable(file.name)) throw Error('Choose a GLB, glTF, OBJ, STL, VOX or .keelasset model. The chosen file is still available in Files.');
      setObjectId(file.id);
    } catch (reason) { if (current(token)) setError(messageOf(reason)); }
    finally { if (current(token)) setWorking(''); }
  }

  async function generate() {
    if (busyRef.current || !objectId || !reference.data || !style.screen || !seed.trim() || (mode === 'theme' && !theme.trim())) return;
    invalidate();
    const token = epoch.current, requestId = crypto.randomUUID();
    activeRequest.current = requestId; setWorking('generating');
    try {
      const next: Candidate = await api('gameRedesignGenerate', {
        requestId, objectId, provider, ...(model.trim() ? { model: model.trim() } : {}), seed,
        mode, theme: mode === 'theme' ? theme : '', guidance, style,
      });
      if (!current(token)) { cancelRequest(requestId); return; }
      if (next.requestId !== requestId) throw Error('The redesign response did not match this request.');
      setCandidate(next); setDrawn(null);
    } catch (reason) {
      cancelRequest(requestId);
      if (current(token)) { activeRequest.current = null; setError(messageOf(reason)); }
    } finally { if (current(token)) setWorking(''); }
  }

  async function previewSeed() {
    if (busyRef.current || !candidate || !activeRequest.current || !seed.trim()) return;
    const token = ++epoch.current, requestId = activeRequest.current;
    setWorking('previewing'); setError(''); setDrawn(null);
    try {
      const next: Candidate = await api('gameRedesignPreview', { requestId, seed });
      if (!current(token)) { cancelRequest(requestId); return; }
      if (next.requestId !== requestId || next.seed !== seed) throw Error('The seed preview did not match this request.');
      setCandidate(next);
    } catch (reason) { if (current(token)) setError(messageOf(reason)); }
    finally { if (current(token)) setWorking(''); }
  }

  const valid = !!candidate?.validation?.ok && !candidate.validation.errors?.length;
  const matchingSeed = !!candidate && candidate.seed === seed;
  const canAccept = valid && matchingSeed && drawn === candidate && !busy;
  async function accept() {
    if (busyRef.current || !canAccept || !candidate || !activeRequest.current) return;
    const token = epoch.current, requestId = activeRequest.current;
    setWorking('accepting'); setError('');
    try {
      // Accept rechecks the retained candidate but does not consume it. A failed
      // disk/workspace save can therefore be retried without another LLM call.
      const accepted: Candidate = await api('gameRedesignAccept', { requestId });
      if (!current(token)) return;
      if (accepted.requestId !== requestId || accepted.seed !== candidate.seed || accepted.runtimeVersion !== candidate.runtimeVersion ||
          accepted.source.objectId !== candidate.source.objectId ||
          JSON.stringify(accepted.program) !== JSON.stringify(candidate.program) ||
          JSON.stringify(accepted.ops) !== JSON.stringify(candidate.ops) ||
          JSON.stringify(accepted.settings) !== JSON.stringify(candidate.settings)) {
        throw Error('The candidate changed after review. Generate and review it again.');
      }
      const next = withGenerativeAsset(latestProject.current, accepted) as Project;
      await persist(next);
      // Persist first: never show a saved asset, or discard the review, on a
      // failed save. Switching away while a save completes cannot revive UI.
      cancelRequest(requestId);
      if (!current(token)) return;
      change({ files: next.files, objectIds: next.objectIds });
      activeRequest.current = null; setCandidate(null); setDrawn(null);
      setMessage(`Accepted ${accepted.program.title || accepted.program.id} as a new asset: recipe, reusable loader and resolved build saved. The source is unchanged.`);
    } catch (reason) { if (current(token)) setError(messageOf(reason)); }
    finally { if (current(token)) setWorking(''); }
  }

  const source = files.find(file => file.id === objectId);
  return <section className="builder-section open-section" aria-label="Generative redesign">
    <h3>Generative redesign <Badge>new asset · source preserved</Badge></h3>
    <p className="builder-hint">Author a native, seeded model from one selected source. Original design keeps the source as the design guide; Theme reimagines it with your theme. Visual style is a separate choice.</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 24 }}>
      <div>
        <fieldset disabled={busy === 'accepting'} style={{ border: 0, margin: 0, padding: 0 }}>
          <Field label="Source model"><select aria-label="Redesign source model" value={objectId} onChange={event => edit(() => setObjectId(event.target.value))}>
            <option value="">Choose exactly one source…</option>{files.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}
          </select></Field>
          <button disabled={!!busy} onClick={() => void chooseFile()}>Choose a model file…</button>
          <Field label="Provider"><select aria-label="Redesign provider" value={provider} onChange={event => edit(() => setProvider(event.target.value))}>
            {(reference.data?.providers ?? ['codex', 'claude']).map(value => <option key={value} value={value}>{value === 'codex' ? 'Codex' : 'Claude'}</option>)}
          </select></Field>
          <Field label="Model override (optional)"><input aria-label="Redesign model override" value={model} maxLength={120} placeholder="Use provider default" onChange={event => edit(() => setModel(event.target.value))} /></Field>
          <Field label="Design mode"><select aria-label="Redesign design mode" value={mode} onChange={event => edit(() => setMode(event.target.value as typeof mode))}>
            <option value="original">Original</option><option value="theme">Theme</option>
          </select></Field>
          {mode === 'theme' && <Field label="Theme"><input aria-label="Redesign theme" value={theme} maxLength={500} placeholder="e.g. weathered lunar explorer" onChange={event => edit(() => setTheme(event.target.value))} /></Field>}
          <Field label="Extra guidance (optional)"><textarea aria-label="Redesign guidance" rows={3} value={guidance} maxLength={2000} placeholder="Details to retain or change…" onChange={event => edit(() => setGuidance(event.target.value))} /></Field>
          <Field label="Visual style"><select aria-label="Redesign visual style" value={style.kind} onChange={event => edit(() => setStyle({ ...style, kind: event.target.value as Style['kind'] }))}>
            {(reference.data?.styles.kinds ?? ['original', 'pixel', 'dither', 'voxel']).map(kind => <option key={kind} value={kind}>{labels[kind as Style['kind']]}</option>)}
          </select></Field>
          <Field label={`Pixel size · ${style.pixelSize}`}><input aria-label="Redesign pixel size" type="range" min={1} max={64} step={1} value={style.pixelSize} onChange={event => edit(() => setStyle({ ...style, pixelSize: Number(event.target.value) }))} /></Field>
          <Field label={`Tone levels · ${style.toneLevels}`}><input aria-label="Redesign tone levels" type="range" min={2} max={256} step={1} value={style.toneLevels} onChange={event => edit(() => setStyle({ ...style, toneLevels: Number(event.target.value) }))} /></Field>
          <Field label="Screen"><select aria-label="Redesign screen" value={style.screen} disabled={!reference.data} onChange={event => edit(() => setStyle({ ...style, screen: event.target.value }))}>
            {!reference.data && <option value="">Loading engine screens…</option>}{reference.data?.styles.screens.map(screen => <option key={screen} value={screen}>{screen}</option>)}
          </select></Field>
          <Field label="Seed"><input aria-label="Redesign seed" value={seed} maxLength={128} disabled={busy === 'previewing'} onChange={event => {
            if (busyRef.current === 'generating') invalidate();
            setSeed(event.target.value); setDrawn(null); setError('');
          }} /></Field>
        </fieldset>
        <p className="builder-hint">Generate sends {source ? source.name : 'only your selected model'}’s bounded text-only geometry, parts and palette descriptor (no source picture), plus the settings above, to {provider === 'codex' ? 'Codex' : 'Claude'}. It sends no other project files, conversation history or workspace context. Credentials use the existing provider setup.</p>
        <div className="inline-actions">
          <button className="primary" disabled={!!busy || !source || !reference.data || !style.screen || !seed.trim() || (mode === 'theme' && !theme.trim())} onClick={() => void generate()}>{busy === 'generating' ? 'Authoring and validating…' : 'Generate redesign'}</button>
          {(busy || candidate) && <button disabled={busy === 'accepting'} onClick={() => { invalidate(); setMessage('Cancelled. The source is unchanged.'); }}>Cancel</button>}
        </div>
        <p className="builder-hint">Separate LLM authoring requests may differ, even with the same seed. A saved program and the same seed produce the same native asset. Changing source or authoring/style settings discards this candidate.</p>
      </div>
      <div>
        {candidate ? <>
          <h4>{candidate.program.title || candidate.program.id} · seed {candidate.seed}</h4>
          {matchingSeed && !busy && valid ? <CandidatePreview key={`${candidate.requestId}:${candidate.seed}`} candidate={candidate} onDrawn={() => setDrawn(candidate)} /> :
            <Empty title={busy === 'previewing' ? 'Validating this seed…' : !matchingSeed ? 'Seed changed' : 'Candidate is not validated'}>{!matchingSeed ? 'Preview the seed to review and validate this variation before accepting.' : 'Only a validated candidate can be accepted.'}</Empty>}
          <p role="status" className="builder-hint">{valid ? 'Native program and resolved geometry validated.' : 'Validation failed.'} {candidate.ops?.length ?? 0} resolved ops{candidate.stats?.voxels !== undefined ? ` · ${candidate.stats.voxels.toLocaleString()} voxels` : ''}</p>
          {candidate.validation.errors?.length ? <ul role="alert">{candidate.validation.errors.map((issue, index) => <li key={index}>{issue.path ? `${issue.path}: ` : ''}{issue.message}</li>)}</ul> : null}
          <div className="inline-actions"><button disabled={!!busy || !seed.trim()} onClick={() => void previewSeed()}>{busy === 'previewing' ? 'Previewing seed…' : 'Preview seed variation'}</button><small>No provider request; uses this program</small></div>
          <div className="inline-actions" style={{ marginTop: 12 }}>
            <button className="primary" disabled={!canAccept} onClick={() => void accept()}>{busy === 'accepting' ? 'Saving new asset…' : 'Accept as new asset'}</button>
            <button disabled={busy === 'accepting'} onClick={() => { invalidate(); setMessage('Kept the source. The candidate was discarded.'); }}>Keep source</button>
          </div>
          <p className="builder-hint">Acceptance appends a recipe, trusted runtime loader and separate build. Your source file and open build are untouched. New previews are static native geometry.</p>
        </> : <Empty title={busy === 'generating' ? 'Authoring a new native model…' : 'No redesign candidate yet'}>Choose one source, then Generate. Review the separate preview before accepting a new asset.</Empty>}
        {message && <p role="status" className="notice">{message}</p>}
        {(error || reference.error || workspace.error) && <p role="alert" className="notice error">{error || messageOf(reference.error || workspace.error)}</p>}
      </div>
    </div>
  </section>;
}

/** Only validated JSON goes to the existing sandboxed, trusted styled player. */
function CandidatePreview({ candidate, onDrawn }: { candidate: Candidate; onDrawn: () => void }) {
  const ref = useRef<HTMLIFrameElement>(null), sequence = useRef(0), onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  const [ready, setReady] = useState(false), [message, setMessage] = useState('Loading trusted native preview…');
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (!ref.current || event.source !== ref.current.contentWindow) return;
      const data = event.data;
      if (data?.type === 'styled-asset-ready') setReady(true);
      else if (data?.id === sequence.current && data?.type === 'styled-asset-loaded') { setMessage('Preview ready. Drag to orbit and scroll to zoom.'); onDrawnRef.current(); }
      else if (data?.id === sequence.current && data?.type === 'styled-asset-error') setMessage(`Preview unavailable: ${String(data.message)}`);
    };
    window.addEventListener('message', listen);
    return () => { ++sequence.current; window.removeEventListener('message', listen); };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const id = ++sequence.current;
    ref.current?.contentWindow?.postMessage({ type: 'styled-asset-load', id, asset: candidate.playback }, '*');
    return () => { ++sequence.current; };
  }, [ready, candidate]);
  return <div><div style={{ height: 400 }}><iframe ref={ref} title="Generative redesign candidate preview" sandbox="allow-scripts" src={STYLED_PREVIEW_URL} style={{ width: '100%', height: '100%', border: 0 }} /></div><p role="status" className="builder-hint">{message}</p></div>;
}
