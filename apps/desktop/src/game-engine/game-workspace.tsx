// The KEEL game engine in the editor: a project's Game tab (which game it
// plays, its module graph and sizes, the game running in the sandboxed
// preview) and the Game engine page (every engine module, each pack's
// contents, and a fit checker). Everything comes from main over IPC; the
// renderer never loads engine code.
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Project, Shared } from '../types';
import { api, queryClient } from '../client';
import { Badge, Empty, Field, fileSize } from '../ui';
import { withGame } from './game-project.mjs';
import { CodecInspectorHost, CodecInspectorSection } from './codec-inspector';
import { CopyDiagnostics, EnginePicker, GetEngine, NewGame, PracticePublish, SepoliaPrepare } from './alpha-ui';

type Socket = { name: string; size?: number[] };
type Entity = { id: string; body: string; title?: string; tags: string[]; choices: Record<string, unknown>; sockets: Socket[] };
type Target = { body: string; packs?: string[]; entities?: string[] };
type Attribute = { id: string; slot: string; title?: string; tags: string[]; targets: Target[]; choices: Record<string, unknown> };
type EngineModule = { id: string; version: string; kind: string; phase: string; weight: number; needs: string[]; provides: string[]; compatible: string[]; title?: string; description?: string; packageName: string; dir: string; pack?: { entities: Entity[]; attributes: Attribute[] }; packError?: string; contents?: unknown };
type Status = { available: boolean; root: string | null; reason?: string };
type ModuleReport = { id: string; version: string; kind: string; phase: string; weight: number; bytes: number; stored: number };
type Build = { gameId: string; byteLength: number; order: string[]; modules: ModuleReport[]; saver: { graphByteLength: number; creatorPublicationBytes: number }; uploads: { creatorByteLength: number; creatorCompressedByteLength: number; sharedOriginalByteLength: number; sharedCompressedByteLength: number } };
type Graph = { ok: boolean; order: string[]; problems: { module: string; kind: string; detail: string }[]; edges: { from: string; need: string; to: string[] }[]; modules: { id: string; version: string; kind: string; phase: string; weight: number; needs: string[]; title?: string }[] };

const KINDS = ['game', 'pack', 'runtime', 'system', 'ai', 'map'];
const KIND_TITLES: Record<string, [string, string]> = {
  game: ['Games', 'Rules, UI and the entry a token runs.'],
  pack: ['Packs', 'Entities, attributes, props, FX and sounds: one stored module each.'],
  runtime: ['Engine parts', 'The registry and the engine itself.'],
  system: ['Systems', 'Gameplay stepped by the world.'],
  ai: ['Behaviour', 'AI bound to bodies by contract, not by pack.'],
  map: ['Maps', 'Maps and scenarios for a game.'],
};
const ref = (pack: string, id: string) => `${pack}#${id}`;
const unref = (value: string) => { const at = value.lastIndexOf('#'); return { pack: value.slice(0, at), id: value.slice(at + 1) }; };
const sizeText = (size?: number[]) => size ? size.map((n) => n.toFixed(2)).join(' × ') : '';

function useEngine() {
  const status = useQuery<Status>({ queryKey: ['game-status'], queryFn: () => api('gameStatus') });
  const modules = useQuery<{ root: string; modules: EngineModule[] }>({ queryKey: ['game-modules'], queryFn: () => api('gameModules'), enabled: !!status.data?.available });
  return { status, modules };
}
const reloadEngine = () => Promise.all(['game-modules', 'game-graph', 'game-build', 'game-fit'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));

function Unavailable({ status }: { status?: Status }) {
  return <div className="notice game-unavailable"><strong>Game engine not connected</strong><p>{status?.reason ?? 'Checking for the KEEL game engine…'}</p>{status && <div className="button-row"><GetEngine /><CopyDiagnostics /></div>}</div>;
}

/** The Release guide's artwork step for a game project. */
export function GameArtworkButton({ project, open }: { project: Project; open?: () => void }) {
  return <button className={`artwork-upload ${project.game?.id ? 'has-art' : ''}`} onClick={open}><strong>{project.game?.id ? 'Edit the game' : 'Choose the game'}</strong><small>{project.game?.id ? `${project.game.id}${project.game.seed ? ` · seed ${project.game.seed}` : ''}` : 'Pick a game made with the KEEL pixel-art engine.'}</small><span>↗</span></button>;
}

/** A project's Game tab. */
export function GameWorkspace({ project, dirty, change, persist, action }: { project: Project; dirty: boolean; change: (patch: Partial<Project>) => void; persist: (next?: Project) => Promise<any>; action: Shared['action'] }) {
  const { status, modules } = useEngine();
  const [run, setRun] = useState(0);
  const gameId = project.game?.id;
  const available = !!status.data?.available;
  const games = (modules.data?.modules ?? []).filter((item) => item.kind === 'game');
  const graph = useQuery<Graph>({ queryKey: ['game-graph', gameId], queryFn: () => api('gameGraph', gameId), enabled: available && !!gameId });
  const build = useQuery<Build>({ queryKey: ['game-build', gameId, run], queryFn: () => api('gameBuild', { gameId }), enabled: available && !!gameId && !!graph.data?.ok });
  const set = (patch: Record<string, unknown>) => change({ game: withGame(project, patch).game } as Partial<Project>);
  const sizes = new Map((build.data?.modules ?? []).map((item) => [item.id, item]));
  const needs = (id: string) => (graph.data?.edges ?? []).filter((edge) => edge.from === id);
  // (Save first: the project's Builder exports then go into its game's pack, and the engine reloads.)
  async function saveAndRun() { await persist(); await api('gameSyncAssets', project.id); await reloadEngine(); setRun((value) => value + 1); }
  return <div className="game-workspace">
    <div className="game-heading"><div><div className="eyebrow">GAME · KEEL PIXEL-ART ENGINE</div><h2>Your game, built from engine modules.</h2><p>Every part of it — the engine, the packs of characters and attributes, the game itself — is a KEEL module. What runs here is the document KEEL assembles on chain.</p></div>
      <button className="primary" disabled={!available || !gameId} onClick={() => void action(saveAndRun)}>Save &amp; run ↻</button></div>
    {status.data && !available && <Unavailable status={status.data} />}
    {modules.error && <p role="alert" className="notice error">{modules.error.message}</p>}
    <div className="game-settings">
      <Field label="Game module"><select aria-label="Game module" value={gameId ?? ''} disabled={!available} onChange={(event) => set({ id: event.target.value })}><option value="">Choose a game…</option>{games.map((item) => <option key={item.id} value={item.id}>{item.title ? `${item.title} · ${item.id}` : item.id}</option>)}{gameId && !games.some((item) => item.id === gameId) && <option value={gameId}>{gameId} (not in this engine)</option>}</select></Field>
      <Field label="Seed"><input aria-label="Game seed" maxLength={128} value={project.game?.seed ?? ''} disabled={!gameId} placeholder="1 · any text · or bytes32 hex" onChange={(event) => set({ seed: event.target.value })} /></Field>
      <Field label="Pixel size"><input aria-label="Pixel size" type="number" min={1} max={64} value={project.game?.pixels ?? ''} disabled={!gameId} placeholder="Game default" onChange={(event) => { const value = Number(event.target.value); set({ pixels: event.target.value && Number.isInteger(value) && value >= 1 && value <= 64 ? value : undefined }); }} /></Field>
    </div>
    <p className="game-hint">The seed and pixel size reach the game as its token context (<code>__KEEL_CONTEXT__</code>, and <code>KEEL_SEED</code> from the seed), the way a tokenURI appends it. Without them the preview is the document’s exact bytes.</p>
    {!gameId && available && <Empty title="Choose a game">Pick a game module above. {games.length ? `${games.length} ${games.length === 1 ? 'game is' : 'games are'} in this engine.` : 'This engine has no game modules yet.'}</Empty>}
    {!gameId && available && <NewGame projectId={project.id} compact />}
    {gameId && <div className="game-layout">
      <section className="game-stage"><div className="pane-title">{dirty ? 'PREVIEW OF LAST SAVED VERSION' : 'SANDBOXED PREVIEW'} <Badge>KEEL verification shell</Badge></div>
        <div className="game-frame"><iframe title="Game preview" key={run} sandbox="allow-scripts allow-pointer-lock" allow="fullscreen" allowFullScreen src={`keel-preview://${project.id}/index.html?run=${run}`} /></div>
        <p className="game-hint">Runs in the same sandbox as every KEEL preview: no network, no storage. Pointer lock and fullscreen are allowed here for games.</p></section>
      <section className="game-report"><div className="section-line"><h2>Modules this game loads</h2><span>{graph.data ? `${graph.data.order.length} in start order` : graph.isFetching ? 'Resolving…' : ''}</span></div>
        {graph.error && <p role="alert" className="notice error">{graph.error.message}</p>}
        {graph.data?.problems.map((problem) => <p role="alert" className="notice error" key={`${problem.module}:${problem.detail}`}><strong>{problem.module}</strong> · {problem.kind}: {problem.detail}</p>)}
        {graph.data && <div className="game-table-wrap"><table className="game-table"><thead><tr><th>#</th><th>Module</th><th>Kind</th><th>Phase · weight</th><th>Raw</th><th>Stored</th></tr></thead><tbody>
          {(graph.data.order.length ? graph.data.order : graph.data.modules.map((item) => item.id)).map((id, index) => { const item = graph.data!.modules.find((m) => m.id === id); const size = sizes.get(id); return <tr key={id}><td>{index + 1}</td><td><strong>{id}</strong><small>@{item?.version}{item?.title ? ` · ${item.title}` : ''}</small>{needs(id).map((edge) => <small key={edge.need} className="game-need">needs {edge.need} → {edge.to.join(', ') || 'nothing'}</small>)}</td><td><Badge>{item?.kind}</Badge></td><td>{item?.phase} · {item?.weight}</td><td>{size ? fileSize(size.bytes) : '—'}</td><td>{size ? fileSize(size.stored) : '—'}</td></tr>; })}
        </tbody></table></div>}
        {build.error && <p role="alert" className="notice error">{build.error.message}</p>}
        {build.isFetching && <p className="game-hint">Building the game document…</p>}
        {build.data && <div className="measurement-grid game-sizes">
          <div><span>THE GAME DOCUMENT</span><strong>{fileSize(build.data.byteLength)}</strong><small>Shell, every module slot and the entry</small></div>
          <div><span>YOUR NEW UPLOAD</span><strong>{fileSize(build.data.uploads.creatorCompressedByteLength)}</strong><small>The game module and entry, stored compressed ({fileSize(build.data.uploads.creatorByteLength)} raw)</small></div>
          <div><span>SHARED ENGINE MODULES</span><strong>{fileSize(build.data.uploads.sharedCompressedByteLength)}</strong><small>Stored once per chain ({fileSize(build.data.uploads.sharedOriginalByteLength)} raw) · complete viewer read {fileSize(build.data.saver.graphByteLength)}</small></div>
        </div>}
        <p className="game-hint">Local measurements. Publishing below checks which engine modules the chain already has, and stores only the rest.</p>
      </section>
    </div>}
    {gameId && available && <><PracticePublish project={project} /><SepoliaPrepare project={project} /></>}
  </div>;
}

/** The Game engine page: every module, each pack's contents, and the fit checker. */
export function GameEnginePage({ search }: { search: string }) {
  const { status, modules } = useEngine();
  const [attribute, setAttribute] = useState('');
  const [entity, setEntity] = useState('');
  const list = modules.data?.modules ?? [];
  const term = search.trim().toLowerCase();
  const shown = list.filter((item) => !term || JSON.stringify(item).toLowerCase().includes(term));
  const packs = list.filter((item) => item.pack);
  const fit = useQuery<{ ok: boolean; why: string; socket: string | null }>({ queryKey: ['game-fit', attribute, entity], queryFn: () => api('gameFit', { attribute: unref(attribute), entity: unref(entity) }), enabled: !!attribute && !!entity });
  const counts = useMemo(() => ({ entities: packs.reduce((n, item) => n + item.pack!.entities.length, 0), attributes: packs.reduce((n, item) => n + item.pack!.attributes.length, 0) }), [packs]);
  const checkFit = (value: string) => { setAttribute(value); document.querySelector('.game-fit')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  return <div className="game-engine-page">
    <div className="page-heading compact"><div><div className="eyebrow">KEEL · THE PIXEL-ART GAME ENGINE</div><h1>Make games onchain.</h1><p>Every engine part, pack and game is a KEEL module. See what’s inside, check what fits what, then build a game from them in a Game project.</p></div>
      <div className="game-engine-actions"><CopyDiagnostics />{status.data?.available && <Badge>{list.length} {list.length === 1 ? 'module' : 'modules'} · {counts.entities} {counts.entities === 1 ? 'entity' : 'entities'} · {counts.attributes} {counts.attributes === 1 ? 'attribute' : 'attributes'}</Badge>}<button disabled={!status.data?.available || modules.isFetching} onClick={() => void reloadEngine()}>{modules.isFetching ? 'Reading engine…' : 'Reload engine'}</button></div></div>
    {status.data && !status.data.available && <div className="content-pad"><Unavailable status={status.data} /></div>}
    {modules.error && <div className="content-pad"><p role="alert" className="notice error">{modules.error.message}</p></div>}
    {status.data?.available && <>
      <NewGame />
      <EnginePicker />
      <section className="setup-card game-fit"><h2>Does it fit?</h2><p>An attribute fits an entity when the entity’s body contract matches one of its targets, and the packs allow it: the same pack, a pack the target names, or two packs that declare each other compatible.</p>
        <div className="game-fit-form"><Field label="Attribute"><select aria-label="Attribute to fit" value={attribute} onChange={(event) => setAttribute(event.target.value)}><option value="">Choose an attribute…</option>{packs.map((pack) => <optgroup key={pack.id} label={pack.title ?? pack.id}>{pack.pack!.attributes.map((item) => <option key={item.id} value={ref(pack.id, item.id)}>{item.id} · {item.slot}</option>)}</optgroup>)}</select></Field><span aria-hidden="true" className="game-fit-on">on</span>
          <Field label="Entity"><select aria-label="Entity to fit" value={entity} onChange={(event) => setEntity(event.target.value)}><option value="">Choose an entity…</option>{packs.map((pack) => <optgroup key={pack.id} label={pack.title ?? pack.id}>{pack.pack!.entities.map((item) => <option key={item.id} value={ref(pack.id, item.id)}>{item.id} · {item.body}</option>)}</optgroup>)}</select></Field></div>
        {fit.error && <p role="alert" className="notice error">{fit.error.message}</p>}
        {fit.data && <div className={`game-verdict ${fit.data.ok ? 'fits' : 'refused'}`} role="status"><strong>{fit.data.ok ? 'Fits' : 'Doesn’t fit'}</strong><span>{fit.data.why}{fit.data.ok && !fit.data.socket ? ' (This entity has no socket named for the attribute’s slot in its sample design.)' : ''}</span></div>}
      </section>
      <CodecInspectorSection /><CodecInspectorHost />
      {KINDS.map((kind) => { const group = shown.filter((item) => item.kind === kind); if (!group.length) return null; const [title, blurb] = KIND_TITLES[kind]!; return <section className="game-group" key={kind}><div className="section-line"><h2>{title}</h2><span>{blurb} · {group.length}</span></div>
        {group.map((item) => <EngineModuleCard key={item.id} item={item} checkFit={checkFit} />)}</section>; })}
      {!shown.length && list.length > 0 && <Empty title="Nothing matches">Try another module, entity, attribute, slot or body contract.</Empty>}
      <p className="game-root">Engine checkout: <code>{status.data.root}</code></p>
    </>}
  </div>;
}

function EngineModuleCard({ item, checkFit }: { item: EngineModule; checkFit: (value: string) => void }) {
  return <article className="game-module"><header><div><h3>{item.title ?? item.id}</h3><code>{item.id}@{item.version}</code></div><div className="game-badges"><Badge>{item.kind}</Badge><Badge>{item.phase} · {item.weight}</Badge></div></header>
    {item.description && <p>{item.description}</p>}
    <dl className="game-facts">{!!item.needs.length && <><dt>Needs</dt><dd>{item.needs.map((need) => <code key={need}>{need}</code>)}</dd></>}{!!item.provides.length && <><dt>Provides</dt><dd>{item.provides.map((contract) => <code key={contract}>{contract}</code>)}</dd></>}{!!item.compatible.length && <><dt>Compatible</dt><dd>{item.compatible.map((pack) => <code key={pack}>{pack}</code>)}</dd></>}<dt>Source</dt><dd><code>{item.dir}</code></dd></dl>
    {item.packError && <p className="notice">{item.packError}</p>}
    {item.pack && <div className="game-contents">
      <div><h4>Entities · {item.pack.entities.length}</h4>{item.pack.entities.length ? <div className="game-table-wrap"><table className="game-table"><thead><tr><th>Entity</th><th>Body</th><th>Sockets (sample)</th><th>Choices</th></tr></thead><tbody>{item.pack.entities.map((e) => <tr key={e.id}><td><strong>{e.id}</strong>{e.title && <small>{e.title}</small>}{!!e.tags.length && <small>{e.tags.join(' · ')}</small>}</td><td><code>{e.body}</code></td><td>{e.sockets.length ? e.sockets.map((s) => <small key={s.name}><strong>{s.name}</strong> {sizeText(s.size)}</small>) : '—'}</td><td>{Object.keys(e.choices).join(', ') || '—'}</td></tr>)}</tbody></table></div> : <p className="game-hint">No entities.</p>}</div>
      <div><h4>Attributes · {item.pack.attributes.length}</h4>{item.pack.attributes.length ? <div className="game-table-wrap"><table className="game-table"><thead><tr><th>Attribute</th><th>Slot</th><th>Fits</th><th></th></tr></thead><tbody>{item.pack.attributes.map((a) => <tr key={a.id}><td><strong>{a.id}</strong>{a.title && <small>{a.title}</small>}{!!a.tags.length && <small>{a.tags.join(' · ')}</small>}</td><td><Badge>{a.slot}</Badge></td><td>{a.targets.map((target, index) => <small key={index}><code>{target.body}</code>{target.packs ? ` from ${target.packs.join(', ')}` : ''}{target.entities ? ` · only ${target.entities.join(', ')}` : ''}</small>)}</td><td><button className="text-button" onClick={() => checkFit(ref(item.id, a.id))}>Check fit ↗</button></td></tr>)}</tbody></table></div> : <p className="game-hint">No attributes.</p>}</div>
    </div>}
  </article>;
}
