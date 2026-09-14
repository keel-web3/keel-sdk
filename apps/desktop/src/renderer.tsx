import {SVGRendererBuilder} from "./svg-renderer-builder";
import { LayerEditor } from './layer-editor';
import { withLayeredPreview } from './layered-project.mjs';
import { AgentWorkspace, AgentMemory, refreshChats } from './agent-ui';
import { WalletHub, WalletWrite } from './wallet-ui';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sameState } from './editor-state.mjs';
import { useLatestResult } from './use-latest-result';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { KEEL_ENGINE_CATALOG, KEEL_ENGINE_CHOICES, planKeelProject, type KeelEngineIntent } from '@keel/sdk/engine';
import { contractControls, createTrackedContract, type KeelTrackedContract } from '@keel/sdk/contract-controls';
import { planKeelAssetPresentation } from '@keel/sdk/presentation';
import { formatUnits } from 'viem';

declare global { interface Window { keel: { request(path: string, input?: unknown): Promise<any>; onAgentEvent(callback: (event: any) => void): () => void; onAgentText(callback: (event: { delta: string; provider: string; projectId?: string }) => void): () => void } } }
import type { File, Project, Workspace, Shared } from './types';
import { api, queryClient } from './client';
const PAGE_LABELS: Record<string, string> = { Projects: 'My work', Objects: 'Files', Modules: 'Library', GameEngine: 'Game engine', Contracts: 'Contracts', Wallets: 'Wallets', Memory: 'Memory', Agents: 'Chats', Connections: 'Setup' };
const uid = () => crypto.randomUUID();
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const label = (value: string) => ({ erc721a: 'Your own ERC-721A', erc721: 'Standard ERC-721', erc1155: 'Your own editions', 'shared-erc1155': 'Shared editions', existing: 'Existing collection', external: 'Custom contract', 'mint-gate': 'Sale or gated mint', 'one-mint': 'Drop with phases', 'admin-mint': 'Mint to a recipient', 'fray-auction': 'Fray auction', 'static-media': 'Image, video or model', 'storage-only': 'Store the work', module: 'Reusable module', release: 'Release to collectors', explore: 'Explore locally', ethereum: 'EVM networks', tezos: 'Tezos', 'flash-ruffle': 'Flash / Ruffle', 'doom-wasm': 'Doom / WASM' }[value] ?? value.replaceAll('-', ' '));
const shortAddress = (address: string) => `${address.slice(0, 8)}…${address.slice(-6)}`;

import { Badge, Empty, Field, Select, fileSize } from './ui';
import { CreativeLibraries, PublicationSize } from './runtime-ui';
import { projectWithRuntime } from './runtime-library.mjs';
import { ArtworkCover, MetadataEditor, Audience, ProjectManager } from './project-details';
import { ReleaseWizard } from './release-wizard';
import { TemplatePicker } from './creation-ui';
import { selectProjectNetwork, mergeDiscoveredCollections, attachArtwork } from './creation-workflow.mjs';
import { changeIntent, matchesArtwork, workPlan } from './artist-workflow.mjs';
import { GameWorkspace, GameEnginePage } from './game-engine/game-workspace';
import { isGameProject } from './game-engine/game-project.mjs';
import { GameBuilder } from './game-engine/game-builder';
import { SoundWorkspace } from './game-engine/game-sound';
import { LevelWorkspace } from './game-engine/game-level';

function App() {
  const [page, setPage] = useState('Projects');
  const [assistantOpen, setAssistantOpen] = useState(() => localStorage.getItem('keel-assistant-open') === 'true');
  const [search, setSearch] = useState('');
  const [chatId, setChatId] = useState<string>(() => localStorage.getItem('keel-active-chat') || undefined as any);
  const [projectTab, setProjectTab] = useState('Preview');
  const selectChat = (id: string) => { setChatId(id); localStorage.setItem('keel-active-chat', id); };
  const [selectedProject, setSelectedProject] = useState<string>();
  const [selectedContract, setSelectedContract] = useState<string>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const actionRunning = useRef(false);
  const beforeNavigate = useRef<(() => Promise<void>) | undefined>(undefined);
  const workspace = useQuery<Workspace>({ queryKey: ['workspace'], queryFn: () => api('workspace'), structuralSharing: false });
  const externalRevision = useQuery({queryKey:['workspace-revision'],queryFn:()=>api('workspaceRevision'),refetchInterval:2000});
  useEffect(()=>{if(externalRevision.data!==undefined&&workspace.data&&externalRevision.data>workspace.data.revision)void queryClient.invalidateQueries({queryKey:['workspace']});},[externalRevision.data,workspace.data?.revision]);
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => api('catalog'), enabled: page === 'Contracts' || page === 'Modules' });
  // (Re-checked now and then: the game practice chain (pnpm game:sandbox) can start after the editor.)
  const practice = useQuery({ queryKey: ['practice'], queryFn: () => api('practice'), refetchInterval: 15_000 });
  async function action(fn: () => Promise<unknown>) {
    if (actionRunning.current) return;
    actionRunning.current = true; setBusy(true); setMessage('');
    try { await fn(); }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { actionRunning.current = false; setBusy(false); }
  }
  const accept = (next: Workspace) => queryClient.setQueryData(['workspace'], next);
  async function save(state: Workspace['state']) { const expectedRevision = queryClient.getQueryData<Workspace>(['workspace'])!.revision; const next = await api('save', { state, revision: expectedRevision }); accept(next); return next; }
  async function navigate(target: {page:string;projectId?:string;contractId?:string;tab?:string;search?:string}, revealAssistant=true) {
    await beforeNavigate.current?.();
    setPage(target.page); setSearch(target.search ?? '');
    if (target.projectId) setSelectedProject(target.projectId);
    if (target.contractId) setSelectedContract(target.contractId);
    if (target.tab) setProjectTab(target.tab);
    if (target.page !== 'Agents' && revealAssistant) setAssistantOpen(true);
  }
  useEffect(() => { void api('agentView', {page, ...(selectedProject ? {projectId:selectedProject} : {}), ...(selectedContract ? {contractId:selectedContract} : {}), ...(page === 'Projects' ? {tab:projectTab} : {})}).catch(() => {}); }, [page,selectedProject,selectedContract,projectTab]);
  useEffect(() => window.keel.onAgentEvent((event:any) => {
    if(event.type==='workspace-navigate'){
      void navigate(event.target,false).catch(error=>setMessage(error.message));return;
    }
    if (event.type === 'text') {
      queryClient.setQueriesData({queryKey:['agent-history',event.chatId]}, (old:any) => old ? {...old,runs:old.runs.map((run:any)=>run.id===event.runId?{...run,reply:run.reply+event.delta}:run)} : old);
      return;
    }
    if (event.type === 'workspace') void queryClient.invalidateQueries({queryKey:['workspace']});
    if (event.type === 'navigate' && event.chatId === chatId) {
      void navigate(event.action.payload).then(()=>api('agentNavigationResult',{id:event.action.id,ok:true})).catch(error=>{setMessage(error.message);return api('agentNavigationResult',{id:event.action.id,ok:false,error:error.message.slice(0,500)});}).finally(()=>refreshChats(event.chatId));
    }
    if (event.type !== 'tool' || event.status !== 'running') void refreshChats(event.chatId);
  }), [chatId]);
  if (workspace.error) return <main className="boot"><h1>KEEL</h1><p>{workspace.error.message}</p><button onClick={() => workspace.refetch()}>Try again</button></main>;
  if (!workspace.data) return <main className="boot"><h1>KEEL</h1><p>Opening your workspace…</p></main>;
  const { state, revision } = workspace.data;
  const project = state.projects.find((p) => p.id === selectedProject);
  const searchTerm = search.trim().toLowerCase();
  const match = (value: unknown) => !searchTerm || pretty(value).toLowerCase().includes(searchTerm);
  return <div className={`app-shell ${assistantOpen && page !== 'Agents' ? 'with-assistant' : ''}`}>
    <header className="titlebar"><div className="brand">KEEL <span>EDITOR</span></div><div className="crumb">Workspace <span>/</span> {project && page === 'Projects' ? project.title : PAGE_LABELS[page]}</div><div className="save-state" role="status"><i /> {busy ? 'Working…' : `Saved locally · revision ${revision}`}</div><button className="assistant-toggle" aria-expanded={assistantOpen} onClick={() => { const next = !assistantOpen; setAssistantOpen(next); localStorage.setItem('keel-assistant-open', String(next)); }}>✳ Assistant</button></header>
    <nav className="sidebar"><div className="workspace-label">YOUR WORKSPACE</div>{['Projects', 'Agents', 'Objects', 'Modules', 'GameEngine', 'Contracts', 'Wallets', 'Memory', 'Connections'].map((item, index) => <button className={page === item ? 'nav-item active' : 'nav-item'} key={item} disabled={busy} onClick={() => void action(async () => { await beforeNavigate.current?.(); setPage(item); setSearch(''); })}><span className="nav-symbol">{['▧', '✳', '◇', '⊞', '▦', '⌘', '◈', '◷', '↗'][index]}</span>{PAGE_LABELS[item]}<span className="nav-count">{item === 'Projects' ? state.projects.length : item === 'Contracts' ? state.contracts.length : item === 'Objects' ? state.objects.length : ''}</span></button>)}<div className="sidebar-bottom"><div className="local-orb" />Local workspace<small>Make. Test. Remember.</small><Badge>DESKTOP PREVIEW</Badge></div></nav>
    <main className={`main-panel ${page === 'Agents' ? 'agent-page' : ''}`} aria-busy={busy}><div className="toolbar"><span>{page === 'Projects' && project ? 'PROJECT EDITOR' : PAGE_LABELS[page].toUpperCase()}</span><input aria-label={`Search ${PAGE_LABELS[page]}`} className="search" placeholder={`Search ${PAGE_LABELS[page].toLowerCase()}…`} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      {practice.data?.rpcUrl && (practice.data.sandbox ? <div className="practice-banner"><strong>KEEL practice chain · this computer</strong><span>RPC: <code>{practice.data.rpcUrl}</code></span><small>Chain {practice.data.chainId} · anvil · real local transactions, no real funds</small></div> : <div className="practice-banner"><strong>Practice workspace · local fixtures</strong><span>Studio / RPC: <code>{practice.data.rpcUrl}</code></span><small>Chain 31337 · simulated data only · no transactions</small></div>)}{message && <div role="alert" className="notice error">{message}<button onClick={() => setMessage('')}>Dismiss</button></div>}
      {page === 'Projects' && !project && <><div className="page-heading creation-heading"><div><div className="eyebrow">YOUR CREATIVE WORKSPACE</div><h1>Make it yours.</h1><p>Start with your artwork. We’ll guide you from there.</p></div></div><TemplatePicker disabled={busy} create={(template, title) => void action(async () => { const current = queryClient.getQueryData<Workspace>(['workspace'])!; const next = await api('createProject', { title, template, revision: current.revision }); accept(next); setSelectedProject(next.state.projects.at(-1).id); setProjectTab(template === 'layered' ? 'Layers' : template === 'game' ? 'Game' : 'Release'); })} /><details className="blank-project disclosure"><summary>Or start a blank project</summary><form onSubmit={(e) => { e.preventDefault(); const title = String(new FormData(e.currentTarget).get('title')); void action(async () => { const current = queryClient.getQueryData<Workspace>(['workspace'])!; const next = await api('createProject', { title, revision: current.revision }); accept(next); setSelectedProject(next.state.projects.at(-1).id); setProjectTab('Preview'); }); }} className="new-project"><Field label="Project name"><input name="title" required maxLength={160} placeholder="A new world" /></Field><button className="primary" disabled={busy}>Create project <span>↗</span></button></form></details><div className="section-line"><h2>Projects</h2><span>{state.projects.length} saved</span></div><div className="project-grid">{state.projects.filter((item) => matchesArtwork(item, search)).map((p) => <button className="project-card" key={p.id} onClick={() => { setSelectedProject(p.id); setProjectTab(p.layered ? 'Layers' : isGameProject(p) ? 'Game' : p.creation ? 'Release' : 'Preview'); }}><ArtworkCover project={p} objects={state.objects} /><div className="project-info"><h3>{p.metadata?.name || p.title}</h3><p>{p.listing.artist ? `${p.listing.artist} · ` : ''}{p.files.length + p.objectIds.length} {p.files.length + p.objectIds.length === 1 ? 'file' : 'files'} · {label(p.intent.outcome ?? 'explore')}</p><span>↗</span></div></button>)}</div>{!state.projects.length && <Empty title="Start with an idea">Create a project, add your files, and preview it locally. Choose a chain when you are ready.</Empty>}<div className="engine-note"><span>01 / THE WORK</span><span>02 / THE WORLD AROUND IT</span><span>03 / THE RELEASE</span></div></>}
      {page === 'Projects' && project && <ProjectEditor key={project.id} project={project} state={state} save={save} action={action} beforeNavigate={beforeNavigate} assist={async () => {
        const previous = chatId ? await api('agentChat', chatId) : undefined;
        const created = await api('createAgentChat', { projectId: project.id, provider: previous?.provider ?? 'codex', model: previous?.model ?? '' });
        await api('updateAgentChat', { id: created.id, fields: { title: `Release · ${project.title}`.slice(0,160), draft: 'Help me prepare the saved release for this project. Use the artwork, collection, network and choices already saved. Ask only for missing decisions, check compatible contracts and permissions, and prepare a reviewable release. Keep this as preparation until I review and sign in my wallet.' } });
        selectChat(created.id); await refreshChats(created.id); setPage('Agents'); setSearch('');
      }} tab={projectTab} setTab={setProjectTab} back={() => setSelectedProject(undefined)} openContracts={(id) => void action(async () => { await beforeNavigate.current?.(); setPage('Contracts'); setSearch(''); setSelectedContract(id ?? state.contracts.find((item) => item.projectId === project.id || project.contractIds.includes(item.id))?.id); })} />}
      {page === 'Contracts' && <Contracts state={state} catalog={catalog.data} selectedId={selectedContract} select={setSelectedContract} save={save} action={action} search={search} />}
      {page === 'Modules' && <Modules catalog={catalog.data} search={search} state={state} save={save} action={action} />}
      {page === 'GameEngine' && <GameEnginePage search={search} />}
      {page === 'Objects' && <><div className="page-heading compact"><div><h1>Your files.</h1><p>Keep the original artwork and resources here, ready to use in your projects.</p></div><button className="primary" onClick={() => void action(async () => { const next = await api('importObject', { revision }); if (next) accept(next); })}>Import a file ↗</button></div><div className="object-grid">{state.objects.filter(match).map((object) => <ObjectCard key={object.id} object={object} action={action} />)}</div>{!state.objects.length && <Empty title="A home for your source material">Import images, video, audio, models, or data. The original file stays where it is.</Empty>}</>}
      {page === 'Wallets' && <><WalletHub /><details className="watch-wallets"><summary>Remember a public address without connecting</summary><p>Track an EVM or Tezos identity, including an address you do not control.</p><form className="inline-form" onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); void action(() => save({ ...state, wallets: [...state.wallets, { id: uid(), label: String(data.get('label')), family: String(data.get('family')), address: String(data.get('address')) }] })); }}><Field label="Label"><input name="label" required placeholder="Creator wallet" /></Field><Field label="Family"><select name="family"><option value="ethereum">EVM</option><option value="tezos">Tezos</option></select></Field><Field label="Public address"><input name="address" required placeholder="0x… or tz…" /></Field><button className="primary">Remember address</button></form></details>{state.wallets.filter(match).map((wallet) => <div className="record-row" key={wallet.id}><div><h3>{wallet.label}</h3><code>{wallet.address}</code></div><Badge>{wallet.family}</Badge><Badge>Watch only</Badge><button onClick={() => void action(() => save({ ...state, wallets: state.wallets.filter((w) => w.id !== wallet.id) }))}>Forget</button></div>)}</>}
      {page === 'Memory' && <AgentMemory state={state} save={save} action={action} />}
      {page === 'Agents' && <AgentWorkspace state={state} chatId={chatId} select={selectChat} projectId={selectedProject} navigate={navigate} beforeAction={async()=>{await beforeNavigate.current?.();}} openChats={()=>setPage('Agents')} search={search} />}
      {page === 'Connections' && <Connections action={action} state={state} save={save} />}
    </main>{assistantOpen && page !== 'Agents' && <aside className="assistant-panel agent-dock"><AgentWorkspace compact state={state} chatId={chatId} select={selectChat} projectId={selectedProject} navigate={navigate} beforeAction={async()=>{await beforeNavigate.current?.();}} openChats={()=>void action(async()=>{await beforeNavigate.current?.();setPage('Agents');setSearch('');})} /></aside>}
  </div>;
}

function Readiness({ action }: { action: Shared['action'] }) {
  const [result, setResult] = useState<any>(); const [codex, setCodex] = useState<any>();
  return <section className="setup-card"><h2>Ready to test?</h2><p>Check local storage, available assistants, and the KEEL MCP. These checks do not send a model request.</p><div className="inline-actions"><button onClick={() => void action(async () => setResult(await api('diagnostics')))}>Check this computer</button><button onClick={() => void action(async () => setCodex(await api('checkCodex')))}>Check Codex connection</button></div>{result && <div className="health-grid"><Badge>{Object.values(result.storage).includes('ok') ? 'Local storage ready' : 'Storage needs attention'}</Badge><Badge>{result.encryption ? 'Credential encryption ready' : 'Set up OS credential storage'}</Badge><Badge>{result.mcp.toolCount} MCP tools ready</Badge>{[result.codex,result.claude].map((agent: any) => <div key={agent.provider}><strong>{agent.provider}</strong><p>{agent.installed ? agent.version : agent.message ?? 'Not installed'}</p>{agent.provider === 'claude' && agent.installed && <p>{agent.signedIn ? 'Signed in' : 'Sign in to Claude Code, then check again.'}</p>}</div>)}</div>}{codex && <p className="success-text">Codex protocol ready · external tools disabled · no inference performed.</p>}</section>;
}
function WorkspaceTransfer({ state, action }: Shared) {
  const [review, setReview] = useState<any>(); const [status, setStatus] = useState('');
  useEffect(() => () => {
    if (review?.token) void api('discardWorkspaceImport', review.token).catch(() => {});
  }, [review?.token]);
  return <section className="setup-card"><h2>Keep a copy of your work.</h2><p>Export projects, original object bytes, contract records, public addresses and notes. API keys, wallet profiles and assistant conversations stay on this computer.</p><div className="inline-actions"><button onClick={() => void action(async () => { const saved = await api('exportWorkspace'); if (saved) setStatus(`Saved ${saved.name}`); })}>Export workspace</button><button onClick={() => void action(async () => setReview(await api('reviewWorkspaceImport')))}>Import workspace</button></div>{status && <p role="status">{status}</p>}{review && <div className="notice"><h3>{review.name}</h3><p>{review.projects} projects · {review.contracts} contracts · {review.objects} objects · {review.memories} notes</p><p>Projects are added as copies. Existing contract records are preserved.</p><button className="primary" onClick={() => void action(async () => { const current = queryClient.getQueryData<Workspace>(['workspace'])!; const next = await api('importWorkspace', { token: review.token, digest: review.digest, revision: current.revision }); queryClient.setQueryData(['workspace'], next); setReview(undefined); setStatus('Workspace imported as additional projects.'); })}>Add imported workspace</button><button onClick={() => setReview(undefined)}>Cancel</button></div>}<small>{state.projects.length} projects currently saved here.</small></section>;
}
function StudioConnection({ action }: { action: Shared['action'] }) {
  const settings = useQuery({ queryKey: ['studio-settings'], queryFn: () => api('studioSettings') });
  const [value, setValue] = useState(''); const [result, setResult] = useState<any>();
  useEffect(() => { if (settings.data?.url) setValue(settings.data.url); }, [settings.data?.url]);
  return <section className="setup-card"><h2>Connect your Studio.</h2><p>Read the Studio's capabilities and search its module library from this editor.</p><form className="inline-actions" onSubmit={(event) => { event.preventDefault(); void action(async () => { setResult(await api('connectStudio', value)); await settings.refetch(); }); }}><input aria-label="Studio URL" type="url" required placeholder="https://your-keel-studio.example" value={value} onChange={(event) => setValue(event.target.value)} /><button className="primary">Check & connect Studio</button></form>{result && <div className="notice"><strong>Studio connected</strong><p>{result.capabilities.schema} · capability document validated</p><details><summary>Available chains and publishing setup</summary><pre>{pretty(result.capabilities)}</pre></details></div>}</section>;
}
function ModuleSearch({ state, save, action }: Shared) {
  const [query, setQuery] = useState(''); const [projectId, setProjectId] = useState(''); const [result, setResult] = useState<any>();
  const textValue = (value: unknown, fallback: string) => typeof value === 'string' && value ? value.slice(0, 160) : fallback;
  const candidates = [...(result?.library ?? []), ...(result?.modules ?? [])];
  return <section className="setup-card"><h2>Find a reusable module.</h2><form className="inline-actions" onSubmit={(event) => { event.preventDefault(); setResult(undefined); void action(async () => setResult(await api('searchStudio', query))); }}><input aria-label="Library query" value={query} required maxLength={160} placeholder="Name, creator, tag or digest" onChange={(event) => setQuery(event.target.value)} /><button className="primary">Search Studio library</button><select aria-label="Save reference to project" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Choose project for references…</option>{state.projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></form>{result && <><p>{candidates.length} candidates · {result.status} · catalog metadata only</p>{result.errors.map((error: string) => <p role="alert" className="error-text" key={error}>{error}</p>)}{candidates.map((candidate: Record<string, unknown>, index: number) => <article className="module-result" key={index}><h3>{textValue(candidate.name ?? candidate.title, 'Unnamed catalog record')}</h3><p>{textValue(candidate.description ?? candidate.summary, 'Review the catalog identity, chain and access terms before binding.')}</p><details><summary>Identity, version and permissions</summary><pre>{pretty(candidate)}</pre></details><button disabled={!projectId} onClick={() => void action(async () => { await save({ ...state, moduleSelections: [...state.moduleSelections, { id: uid(), projectId, name: textValue(candidate.name ?? candidate.title, 'Catalog reference'), studioUrl: result.studioUrl, metadata: candidate, observedAt: new Date().toISOString(), evidence: 'catalog-metadata-only' }] }); })}>Save reference to project</button></article>)}{!candidates.length && <p>{result.status === 'ok' ? 'No matching records. Try another name or review the module setup guide below.' : 'Search was incomplete. Retry the unavailable index before creating another copy.'}</p>}</>}</section>;
}
function ProjectEditor({ project, state, save, action, back, beforeNavigate, openContracts, tab, setTab, assist }: Shared & { project: Project; assist: () => Promise<void>; tab: string; setTab: (value:string)=>void; back: () => void; openContracts: (id?: string) => void; beforeNavigate: React.RefObject<(() => Promise<void>) | undefined> }) {
  const [draft, setDraft] = useState(project);
  const lastSavedProject = useRef(project);
  const draftBase = useRef(project);
  useEffect(() => {
    const previous = lastSavedProject.current;
    if (!sameState(previous, project)) {
      setDraft(current => {if(sameState(current, previous)){draftBase.current=project;return project;}return current;});
      lastSavedProject.current = project;
    }
  }, [project]);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [fileId, setFileId] = useState(project.files[0]?.id);
  const [showCode, setShowCode] = useState(false);
  useEffect(() => { if (tab === 'Source') { setShowCode(true); setTab('Preview'); } }, [tab]);
  const [viewport, setViewport] = useState('fit');
  const [focus, setFocus] = useState(false);
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setFocus(false); }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, []);
  const [preview, setPreview] = useState(0);
  const [decisionError, setDecisionError] = useState('');
  const [pendingSource, setPendingSource] = useState<Omit<File, 'id'>>();
  const dirty = useMemo(() => !sameState(project, draft), [project, draft]);
  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [dirty]);
  const file = draft.files.find((f) => f.id === fileId);
  const plan = useMemo(() => workPlan(draft, state.objects), [draft, state.objects]);
  async function persist(next = draftRef.current, refresh = true) {
    if (next.layered) next = withLayeredPreview(next) as Project;
    const current = queryClient.getQueryData<Workspace>(['workspace'])!;
    if(!sameState(current.state.projects.find(p=>p.id===next.id),draftBase.current))throw Error('This project was updated outside this editor. Your draft is preserved. Reopen the saved project before applying further changes.');
    const saved = await save({ ...current.state, projects: current.state.projects.map((p) => p.id === next.id ? next : p) });
    draftBase.current=saved.state.projects.find((p:Project)=>p.id===next.id)!;
    if (refresh) setPreview((value) => value + 1);
    void queryClient.invalidateQueries({ queryKey: ['project-checks', next.id] });
    return saved;
  }
  async function applyPresentation(fields: Partial<Project['presentation']>) {
    const current = draftRef.current;
    const next = { ...current, presentation: { ...current.presentation, ...fields } };
    if (fields.entryObjectId && !next.objectIds.includes(fields.entryObjectId)) next.objectIds = [...next.objectIds, fields.entryObjectId];
    setDraft(next);
    await persist(next);
  }
  async function importFile() {
    const snapshot = dirty ? await persist() : queryClient.getQueryData<Workspace>(['workspace'])!;
    const imported = await api('importProjectFile', { revision: snapshot.revision });
    if (!imported) return;
    queryClient.setQueryData(['workspace'], imported.workspace);
    const current = draftRef.current;
    if (imported.source && current.files.some((file) => file.name === imported.source.name)) { setPendingSource(imported.source); return; }
    const added = imported.source ? { id: uid(), ...imported.source } : null;
    const next = added
      ? { ...current, files: [...current.files, added] }
      : { ...current, objectIds: [...new Set([...current.objectIds, imported.object.id])], presentation: { ...current.presentation, entryObjectId: imported.object.id } };
    setDraft(next);
    if (added) setFileId(added.id);
    await persist(next);
  }
  async function importArtwork() {
    const snapshot = await persist(); const submitted = draftRef.current;
    const imported = await api('importArtwork', { projectId: project.id, revision: snapshot.revision });
    if (!imported) return;
    queryClient.setQueryData(['workspace'], imported.workspace);
    const updated = imported.workspace.state.projects.find((item: Project) => item.id === project.id);
    if (sameState(submitted, draftRef.current)) setDraft(updated);
    else {
      const added = imported.workspace.state.objects.filter((item: any) => updated.objectIds.includes(item.id) && !submitted.objectIds.includes(item.id));
      const merged = attachArtwork(draftRef.current, added) as Project; setDraft(merged); await persist(merged);
    }
    setPreview(value => value + 1);
    if (imported.errors.length) throw Error(imported.errors.join(' '));
  }
  async function replaceSource() {
    if (!pendingSource) return;
    const current = draftRef.current;
    const existing = current.files.find((file) => file.name === pendingSource.name)!;
    const next = { ...current, files: current.files.map((file) => file.id === existing.id ? { ...file, ...pendingSource } : file), presentation: pendingSource.type === 'text/html' ? { ...current.presentation, entryObjectId: undefined } : current.presentation };
    setDraft(next); setFileId(existing.id); setPendingSource(undefined);
    await persist(next);
  }
  useEffect(() => {
    beforeNavigate.current = async () => {
      if (!dirty) return;
      const submitted = draftRef.current;
      await persist(submitted);
      if (!sameState(submitted, draftRef.current)) throw new Error('You made more changes while saving. Save them before leaving this project.');
    };
    return () => { beforeNavigate.current = undefined; };
  });
  const change = (patch: Partial<Project>) => setDraft((current) => ({ ...current, ...patch }));
  async function importCover() {
    const snapshot = await persist();
    const imported = await api('importObject', { revision: snapshot.revision });
    if (!imported) return;
    queryClient.setQueryData(['workspace'], imported);
    const object = imported.state.objects.at(-1);
    if (!object.type.startsWith('image/')) throw new Error('The file is preserved in Files. Choose an image for the metadata cover.');
    const current = draftRef.current;
    const next = { ...current, metadata: { ...current.metadata, image: `keel-asset://${object.id}/raw` }, objectIds: [...new Set([...current.objectIds, object.id])] };
    setDraft(next); await persist(next);
  }
  function choice(field: string, value: unknown) {
    try {
      const current = draftRef.current;
      const intent = changeIntent(current.intent, field, value);
      const next = { ...current, intent, ...(['family', 'chainId', 'network'].includes(field) ? { targetNetworkId: undefined } : {}), ...(current.creation && ['family', 'chainId', 'network', 'collection'].includes(field) ? { creation: { ...current.creation, selectedCollectionId: undefined } } : {}) };
      setDraft(field === 'runtime' && ['three', 'p5', 'html'].includes(String(value)) ? projectWithRuntime(next, String(value)) : next);
      setDecisionError('');
    } catch (error) { setDecisionError(error instanceof Error ? error.message : String(error)); }
  }
  async function selectNetwork(id: string, snapshot: any) {
    const next = selectProjectNetwork(draftRef.current, id, snapshot) as Project;
    setDraft(next); await persist(next, false);
  }
  const networkPanel = <NetworkPanel project={draft} action={action} select={selectNetwork} />;
  return <><div className="project-heading"><button className="text-button" onClick={() => void action(async () => { await beforeNavigate.current?.(); back(); })}>← All projects</button><h1>{draft.title}</h1><Badge tone={dirty ? 'warm' : ''}>{dirty ? 'Unsaved changes' : 'Saved locally'}</Badge><button className="primary" onClick={() => void action(persist)}>Save & preview</button></div><div className="tabs">{[...(isGameProject(draft) ? ['Game', 'Builder', 'Sound', 'Level'] : []), 'Layers', 'SVG renderer', 'Preview', 'Metadata', 'Viewing', 'Release', 'Manage', 'Resources', 'Notes'].map((item) => <button className={tab === item ? 'selected' : ''} key={item} onClick={() => setTab(item)}>{item}</button>)}</div>
    {decisionError && <p role="alert" className="notice error">{decisionError}</p>}
    {tab === 'Preview' && <div className={`workbench ${focus ? 'focus-preview' : ''}`}><div className="preview-tools"><button className="primary" onClick={() => void action(importFile)}>+ Import file</button><button aria-pressed={showCode} onClick={() => setShowCode(!showCode)}>{showCode ? 'Hide code' : 'Show code'}</button><div className="viewport-switch" role="group" aria-label="Preview size">{['fit', 'desktop', 'phone'].map((size) => <button aria-pressed={viewport === size} className={viewport === size ? 'selected' : ''} key={size} onClick={() => setViewport(size)}>{size === 'fit' ? 'Fit' : size === 'desktop' ? 'Desktop' : 'Phone'}</button>)}</div><button onClick={() => setFocus(!focus)}>{focus ? 'Exit focus' : 'Focus view'}</button></div>
      {pendingSource && <div className="notice import-review"><span><strong>{pendingSource.name}</strong> already exists. The original import is preserved in Files. Replace the editable file?</span><button onClick={() => void action(replaceSource)}>Replace source</button><button onClick={() => setPendingSource(undefined)}>Keep existing</button></div>}
      <div className="asset-selection"><span>{draft.presentation.entryObjectId ? <>Displaying <strong>{state.objects.find((object) => object.id === draft.presentation.entryObjectId)?.name}</strong></> : 'Displaying the project webpage'}</span><button onClick={() => { setFocus(false); setTab('Viewing'); }}>Display &amp; shell settings ↗</button></div>
      <div className={`artist-workbench ${showCode ? 'with-code' : ''}`}>
        {showCode && <div className="code-pane"><div className="file-tabs">{draft.files.map((source) => <button key={source.id} className={fileId === source.id ? 'selected' : ''} onClick={() => setFileId(source.id)}>{source.name}</button>)}</div><textarea className="code-editor" spellCheck={false} aria-label="Source editor" value={file?.content ?? ''} onChange={(event) => change({ files: draft.files.map((source) => source.id === fileId ? { ...source, content: event.target.value } : source) })} /></div>}
        <div className="preview-pane"><div className="pane-title">{dirty ? 'PREVIEW OF LAST SAVED VERSION' : 'LOCAL PREVIEW'} <Badge>{draft.presentation.shell === 'canonical' ? 'Canonical shell' : 'Direct display'}</Badge></div><div className={`preview-stage viewport-${viewport}`}><iframe title="Project preview" key={preview} sandbox="allow-scripts allow-pointer-lock" src={`keel-preview://${project.id}/index.html?revision=${preview}`} /></div></div>
      </div><details className="project-objects"><summary>Files attached to this work · {draft.objectIds.length}</summary>{state.objects.map((object) => <label key={object.id} className="checkbox"><input type="checkbox" checked={draft.objectIds.includes(object.id)} disabled={draft.presentation.entryObjectId === object.id || draft.metadata.image === `keel-asset://${object.id}/raw`} onChange={(event) => change({ objectIds: event.target.checked ? [...draft.objectIds, object.id] : draft.objectIds.filter((id) => id !== object.id) })} />{object.name}</label>)}{!state.objects.length && <p>Import artwork or source material to attach it here.</p>}</details><div className="workbench-foot">{dirty ? 'Save & preview to see your changes. ' : ''}This preview uses saved local files. Network publication and public viewer compatibility need their own checks.</div>
    </div>}
    {tab === 'SVG renderer' && <SVGRendererBuilder project={draft} change={change} action={action} />}
    {tab === 'Metadata' && <MetadataEditor project={draft} objects={state.objects} change={(patch) => { if (patch.metadata?.image) { const id = /^keel-asset:\/\/([a-f0-9]{64})\/raw$/.exec(patch.metadata.image)?.[1]; if (id && state.objects.some((item) => item.id === id)) patch.objectIds = [...new Set([...draftRef.current.objectIds, id])]; } change(patch); }} importCover={importCover} action={action} persist={persist} />}
    {tab === 'Viewing' && <><ShellSettings project={draft} objects={state.objects} dirty={dirty} change={(fields) => void action(() => applyPresentation(fields))} /><details className="network-disclosure disclosure"><summary>Target network & live costs</summary>{networkPanel}</details><div className="content-pad"><Audience project={draft} change={change} action={action} /></div></>}
    {tab === 'Game' && <GameWorkspace project={draft} dirty={dirty} change={change} persist={persist} action={action} />}
    {tab === 'Builder' && <GameBuilder project={draft} change={change} persist={persist} action={action} />}
    {tab === 'Sound' && <SoundWorkspace project={draft} change={change} persist={persist} action={action} />}
    {tab === 'Level' && <LevelWorkspace project={draft} change={change} persist={persist} action={action} />}
    {tab === 'Layers' && <LayerEditor project={draft} state={state} change={change} action={action} save={persist} release={async () => { await persist(); setTab('Release'); }} />}
    {tab === 'Release' && <ReleaseWizard project={draft} state={state} choice={choice} change={change} network={networkPanel} selectNetwork={selectNetwork} action={action} save={persist} importArtwork={importArtwork} layers={() => setTab('Layers')} game={() => setTab('Game')} metadata={() => setTab('Metadata')} preview={() => setTab('Preview')} openContracts={openContracts} assist={assist} />}
    {tab === 'Manage' && <ProjectManager project={draft} state={state} action={action} persist={persist} dirty={dirty} change={change} go={setTab} openContracts={openContracts} />}
    {tab === 'Resources' && <div className="content-pad"><h2>What this work needs.</h2><CreativeLibraries project={draft} change={change} />{state.moduleSelections.filter((item) => item.projectId === project.id).map((item) => <article className="memory-card" key={item.id}><h3>{item.name}</h3><Badge>Saved reference · binding needed</Badge><details><summary>Catalog identity & access</summary><pre>{pretty(item.metadata)}</pre></details></article>)}{plan.modules.required.length ? plan.modules.required.map((name) => <div className="record-row" key={name}><h3>{name}</h3><Badge>Selected-chain binding needed</Badge></div>) : <p>No runtime dependency has been selected.</p>}<ModuleSteps /></div>}
    {tab === 'Notes' && <div className="content-pad"><Field label="Project decisions and creative direction"><textarea rows={12} maxLength={4000} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field></div>}
  </>;
}

function NetworkPanel({ project, action, select }: { project: Project; action: Shared['action']; select: (id: string, snapshot: any) => Promise<void> }) {
  const profiles = useQuery({ queryKey: ['network-profiles'], queryFn: () => api('networkProfiles') });
  const live = useQuery({ queryKey: ['live-network', project.targetNetworkId], queryFn: () => api('liveNetwork', project.targetNetworkId), enabled: !!project.targetNetworkId, refetchInterval: 20_000, staleTime: 15_000, refetchOnWindowFocus: true, retry: false });
  const [family, setFamily] = useState('ethereum');
  const estimateQuery = useLatestResult();
  const estimate = estimateQuery.data;
  useEffect(() => estimateQuery.clear(), [project.targetNetworkId]);
  const snapshot = live.error ? undefined : live.data;
  const connect = (form: HTMLFormElement) => { const fields = new FormData(form); const input: any = { label: String(fields.get('label')), rpcUrl: String(fields.get('rpcUrl')), family }; if (fields.get('chainId')) input.chainId = Number(fields.get('chainId')); for (const name of ['holdAddress', 'builderAddress']) if (fields.get(name)) input[name] = String(fields.get(name)); void action(async () => { const connected = await api('connectNetwork', input); await queryClient.invalidateQueries({ queryKey: ['network-profiles'] }); await select(connected.id, connected.snapshot); queryClient.setQueryData(['live-network', connected.id], connected.snapshot); }); };
  return <section className="setup-card live-network"><div className="section-line"><h2>Your target network.</h2><Badge>{live.isFetching ? 'Reading network…' : snapshot ? 'Live RPC facts' : 'Choose a network'}</Badge></div><p>Choose any compatible EVM or Tezos RPC. Fees and limits refresh every 20 seconds while this area is open. Network access and KEEL deployment readiness are checked separately.</p>{profiles.data?.length > 0 && <Field label="Saved network"><select aria-label="Saved target network" value={project.targetNetworkId ?? ''} onChange={(event) => { const id = event.target.value; estimateQuery.clear(); if (id) void action(async () => select(id, await api('liveNetwork', id))); }}><option value="">Choose a network…</option>{profiles.data.map((profile: any) => <option key={profile.id} value={profile.id}>{profile.label} · {profile.chainIdentity}</option>)}</select></Field>}<details open={!project.targetNetworkId} className="network-setup"><summary>Connect another network</summary><form className="network-form" onSubmit={(event) => { event.preventDefault(); connect(event.currentTarget); }}><div className="form-grid"><Field label="Name"><input name="label" required maxLength={100} placeholder="My network" /></Field><Field label="Network family"><select name="family" value={family} onChange={(event) => setFamily(event.target.value)}><option value="ethereum">EVM</option><option value="tezos">Tezos</option></select></Field><Field label="RPC URL"><input name="rpcUrl" type="url" required placeholder="https://… or http://localhost:…" autoComplete="off" /></Field>{family === 'ethereum' && <Field label="Expected chain ID (optional)"><input name="chainId" type="number" min={1} placeholder="Detect from RPC" /></Field>}</div>{family === 'ethereum' && <details><summary>KEEL contract addresses (optional)</summary><p>Use your deployment on this exact network. Known networks can resolve catalog records; ambiguous or missing instances require a choice. A missing SDK record is not proof that no deployment exists—check the target Studio catalog before deploying another copy.</p><div className="form-grid"><Field label="KeelHold"><input name="holdAddress" placeholder="0x…" /></Field><Field label="KeelRawTokenURIBuilder"><input name="builderAddress" placeholder="0x…" /></Field></div></details>}<button className="primary">Check &amp; use network</button><p>RPC URLs are encrypted on this computer and excluded from portable project exports.</p></form></details>{live.error && <p role="alert" className="notice error">{live.error.message} Previous fee data is not shown as live.</p>}{snapshot && <><div className="measurement-grid"><div><span>NETWORK / HEAD</span><strong>{snapshot.family === 'ethereum' ? snapshot.chainId : snapshot.network}</strong><small>Block {snapshot.block}</small></div><div><span>{snapshot.family === 'ethereum' ? 'RPC GAS PRICE' : 'STORAGE BURN'}</span><strong>{snapshot.family === 'ethereum' ? snapshot.fees.gasPriceWei === null ? 'Unavailable' : `${formatUnits(BigInt(snapshot.fees.gasPriceWei), 9)} Gwei` : `${snapshot.storageCostMutezPerByte} mutez / byte`}</strong></div><div><span>{snapshot.family === 'ethereum' ? 'INLINE READ BUDGET' : 'OPERATION GAS LIMIT'}</span><strong>{BigInt(snapshot.inlineReadGasLimit ?? snapshot.operationGasLimit).toLocaleString()}</strong><small>Block limit {BigInt(snapshot.blockGasLimit).toLocaleString()}</small></div></div><p>Read at {new Date(snapshot.checkedAt).toLocaleTimeString()} · {snapshot.fees.note}</p><p>The Inline budget is capped by the current block limit and KEEL's 60M policy. A provider can impose a lower cap; estimate the exact finished-work read to check it.</p><button onClick={() => void live.refetch()}>Refresh network</button><details className="network-deployments"><summary>KEEL setup on this network</summary>{snapshot.deployments.map((deployment: any) => <div key={deployment.contract} className="network-deployment"><strong>{deployment.contract}</strong><Badge>{deployment.status.replaceAll('-', ' ')}</Badge>{deployment.address && <code>{deployment.address}</code>}</div>)}<p>{snapshot.setup}</p><p>Code at an address does not prove the ABI, owner or registered shell. Add the correct contracts in Contracts, inspect their identities, then bind the selected-chain shell and modules.</p><p>For a new EVM deployment, prepare dependencies in order: KeelHold, Inline token URI builder and harness, shared shell/resources, then the creator factory and chosen mint/access modules. Run the local build and contract tests before preparing deployment transactions.</p></details>{snapshot.family === 'ethereum' && <details className="network-estimate"><summary>Estimate an exact prepared call</summary><p>Paste an unsigned call from contract review or the SDK publication plan. Estimates apply to this call only; a complete upload may require several transactions.</p><form onChange={() => estimateQuery.clear()} onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); void action(() => estimateQuery.load(() => api('estimateOnNetwork', { profileId: project.targetNetworkId, to: String(values.get('to')), data: String(values.get('data')), value: String(values.get('value') || '0x0'), ...(values.get('from') ? { from: String(values.get('from')) } : {}), purpose: String(values.get('purpose')) }))); }}><div className="form-grid"><Field label="Purpose"><select name="purpose"><option value="publication">Publication transaction</option><option value="presentation-read">Finished-work read</option></select></Field><Field label="Contract"><input name="to" required placeholder="0x…" /></Field><Field label="Public account (optional)"><input name="from" placeholder="0x…" /></Field><Field label="Value (hex wei)"><input name="value" defaultValue="0x0" /></Field></div><Field label="Exact calldata"><textarea name="data" required defaultValue="0x" rows={3} /></Field><button>Estimate on selected network</button></form>{estimate && <div className="result"><Badge>Read-only estimate · block {estimate.block}</Badge><p>{BigInt(estimate.gas).toLocaleString()} gas{estimate.purpose === 'publication' && estimate.executionCostWei !== null ? ` · ${BigInt(estimate.executionCostWei).toLocaleString()} native base units at this quote` : ''}</p><p>{estimate.note}</p>{estimate.purpose === 'presentation-read' && BigInt(estimate.gas) > BigInt(estimate.inlineReadGasLimit) && <p className="error-text">This read exceeds the current Inline boundary. Use paged reads and RPC reconstruction.</p>}<p>Estimated at {new Date(estimate.checkedAt).toLocaleTimeString()}. Re-estimate after changing the call or before wallet review.</p></div>}</details>}</>}</section>;
}

function ShellSettings({ project, objects, dirty, change }: { project: Project; objects: Workspace['state']['objects']; dirty: boolean; change: (fields: Partial<Project['presentation']>) => void }) {
  const workspaceRevision = queryClient.getQueryData<Workspace>(['workspace'])?.revision;
  const measurement = useQuery({ queryKey: ['project-presentation', project.id, workspaceRevision], queryFn: () => api('projectPresentation', project.id), retry: false });
  const selected = objects.find((object) => object.id === project.presentation.entryObjectId);
  const plan = selected?.compressedByteLength === undefined ? measurement.data?.plan : planKeelAssetPresentation({ originalByteLength: selected.byteLength, compressedByteLength: selected.compressedByteLength, mode: project.presentation.delivery });
  return <div className="shell-settings"><div className="shell-heading"><div className="eyebrow">THE WORK &amp; ITS PRESENTATION</div><h2>A shell around your world.</h2><p>KEEL verifies the original bytes before displaying them. You control the presentation.</p></div><div className="shell-choice-grid"><button className={project.presentation.shell === 'canonical' ? 'selected' : ''} onClick={() => change({ shell: 'canonical' })}><strong>KEEL verification shell</strong><span>Default · protected K, Proof, Files and Trail.</span></button><button className={project.presentation.shell === 'none' ? 'selected' : ''} onClick={() => change({ shell: 'none' })}><strong>Direct display</strong><span>Bypass the shell. Your file or HTML is the presentation.</span></button></div>{project.presentation.shell === 'none' && <p className="notice">Direct display omits the protected verification interface. Original bytes and contract retrieval remain available. Executable work stays inside the preview sandbox.</p>}<div className="form-grid"><Field label="Display this"><select value={project.presentation.entryObjectId ?? ''} onChange={(event) => change({ entryObjectId: event.target.value || undefined })}><option value="">Project HTML</option>{objects.map((object) => <option key={object.id} value={object.id}>{object.name}</option>)}</select></Field><Field label="Delivery after publication"><select value={project.presentation.delivery} onChange={(event) => change({ delivery: event.target.value as Project['presentation']['delivery'] })}><option value="auto">Automatic · measured compressed size</option><option value="inline">Inline · explicit choice</option><option value="hybrid">HTML with RPC reconstruction</option></select></Field></div><p>Delivery uses the complete scene, including shared libraries. Automatic uses Inline at or below <strong>1.75 MB compressed</strong> (1,750,000 bytes). Above that, Automatic recommends RPC reconstruction. You can still choose Inline for larger works; your saved choice is preserved. Import keeps the original file intact.</p>{dirty && <p className="notice">Save your source edits to refresh the measured graph.</p>}{measurement.error && <p className="notice">{measurement.error.message}</p>}{plan && <><PublicationSize measurement={measurement.data} plan={plan} /><div className="compatibility"><h3>Compatibility &amp; next steps</h3><p>These are local measurements. The completed token URI and a read through the selected chain still need testing before publication.</p>{plan.warnings.map((warning: any) => <article key={warning.code}><strong>{warning.message}</strong><p>{warning.remedy}</p></article>)}{measurement.data?.byteLength > 2_000_000 && <article><strong>The verified preview graph alone is {fileSize(measurement.data.byteLength)}.</strong><p>Metadata and URI packing add more bytes. The complete Inline return can exceed KEEL's 2 MB public-reader limit even when the compressed asset fits 1.75 MB. Reuse shared modules, reduce optional preview/metadata overhead, or choose RPC reconstruction explicitly.</p></article>}<p>A large file does not violate ERC-721 by itself. Viewer support, RPC response size and read gas are separate compatibility limits. Import remains available when these limits are exceeded.</p></div><details className="contract-retrieval"><summary>Get the full onchain file without the HTML viewer</summary><p>{plan.retrieval.explanation}</p><ol><li>Read <code>{plan.retrieval.descriptor}</code> for the exact compression, length and digest.</li><li>For an uncompressed object, call <code>{plan.retrieval.fullUncompressedObject}</code>. An RPC endpoint must permit the full response and read gas.</li><li>For compressed or large objects, call <code>{plan.retrieval.pagedStoredBytes}</code> in order until <code>hasNext</code> is false, join the bytes, decompress the declared codec and verify the digest.</li></ol><p>{plan.retrieval.fullCallOption}</p><pre>{'// Read-only contract calls after publication\nconst record = await hold.read.getObject([objectId]);\n// Uncompressed object only:\nconst originalBytes = await hold.read.haulObject([objectId]);\n// Paged carrier retrieval (also works for compressed objects):\nconst [part, hasNext] = await hold.read.readSlug([objectId, 0n]);'}</pre><p>A local file digest is not a published object ID. The receipt and selected-chain read-back supply the contract and object identity for these calls.</p></details></>}</div>;
}

function Contracts({ state, catalog, selectedId, select, save, action, search }: Shared & { catalog: any; selectedId?: string; select: (id?: string) => void; search: string }) {
  const [adding, setAdding] = useState(false);
  const [abi, setAbi] = useState<unknown[]>([]);
  const [kind, setKind] = useState('custom');
  const selected = state.contracts.find((c) => c.id === selectedId);
  const [defaultFilter, setDefaultFilter] = useState('');
  async function add(contract: KeelTrackedContract) {
    if (state.contracts.some((c) => c.id === contract.id)) { select(contract.id); return; }
    await save({ ...state, contracts: [...state.contracts, contract] }); select(contract.id); setAdding(false);
  }
  return <><div className="page-heading compact"><div><h1>Your contracts.<br /><em>One connected system.</em></h1><p>Collections, shared infrastructure, custom contracts, and their implementations.</p></div><button className="primary" onClick={() => { setAdding(!adding); select(undefined); }}>+ Track a contract</button></div>
    <CreatorDiscovery state={state} save={save} action={action} catalog={catalog} select={select} />
    {adding && <form className="contract-form" onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); void action(async () => { await add(createTrackedContract({ name: String(data.get('name')), address: String(data.get('address')) as `0x${string}`, chainId: Number(data.get('chainId')), kind: kind as KeelTrackedContract['kind'], source: 'manual', abi, ...(data.get('projectId') ? { projectId: String(data.get('projectId')) } : {}), notes: String(data.get('notes') ?? ''), ...(kind === 'proxy' ? { proxy: { kind: String(data.get('proxyKind')) as 'eip1967', ...(data.get('implementation') ? { implementation: String(data.get('implementation')) as `0x${string}` } : {}) } } : {}) })); }); }}><h2>Add to your contract workspace</h2><div className="form-grid"><Field label="Name"><input name="name" required placeholder="My collection" /></Field><Field label="Contract address"><input name="address" required placeholder="0x…" /></Field><Field label="Chain ID"><input name="chainId" type="number" min="1" required placeholder="11155111" /></Field><Field label="Kind"><Select value={kind} onChange={setKind} choices={['collection', 'standalone', 'custom', 'proxy', 'implementation']} /></Field><Field label="Project"><select name="projectId"><option value="">Workspace-wide</option>{state.projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>{kind === 'proxy' && <><Field label="Proxy pattern"><select name="proxyKind">{['eip1967', 'beacon', 'minimal', 'custom'].map((k) => <option key={k}>{k}</option>)}</select></Field><Field label="Expected implementation (optional)"><input name="implementation" placeholder="0x…" /></Field></>}<Field label="Notes"><input name="notes" placeholder="How this contract fits into the project" /></Field></div><div className="form-footer"><button type="button" onClick={() => void action(async () => { const imported = await api('importAbi'); if (imported) setAbi(imported.abi); })}>Import ABI or artifact</button><span>{abi.length} ABI entries</span><button className="primary">Track contract</button></div></form>}
    <div className="contract-layout"><div className="contract-list"><button className="text-button" onClick={() => void action(async () => { const imported = await api('importCreatorOperation'); if (!imported) return; const known = new Set(state.contracts.map((c) => c.id)); await save({ ...state, contracts: [...state.contracts, ...imported.filter((c: KeelTrackedContract) => !known.has(c.id))] }); })}>Import my KEEL creation record ↗</button><div className="section-line"><h2>Your registry</h2><span>{state.contracts.length}</span></div>{state.contracts.filter((c) => pretty(c).toLowerCase().includes(search.toLowerCase())).map((c) => <button className={`contract-row ${c.id === selectedId ? 'selected' : ''}`} key={c.id} onClick={() => select(c.id)}><span className="contract-icon">{c.kind === 'proxy' ? '⤳' : '◇'}</span><div><h3>{c.name}</h3><p>{shortAddress(c.address)} · {c.chainId}</p></div><Badge>{c.kind}</Badge></button>)}{!state.contracts.length && <Empty title="Your contracts, together">Track an existing collection, import an ABI, or add recorded KEEL infrastructure below.</Empty>}<details className="default-catalog"><summary>Default KEEL infrastructure <Badge>{catalog?.deployments.length ?? 0} records</Badge></summary><p>These are protocol deployment records, not contracts proven to belong to your wallet.</p><input aria-label="Filter default contracts" placeholder="Name, chain, instance…" value={defaultFilter} onChange={(e) => setDefaultFilter(e.target.value)} /><div className="deployment-list">{catalog?.deployments.map((d: any, index: number) => ({ ...d, index })).filter((d: any) => pretty(d).toLowerCase().includes(defaultFilter.toLowerCase())).map((d: any) => <button className="deployment-row" key={`${d.index}`} onClick={() => void action(async () => add(await api('defaultContract', d.index)))}><strong>{d.contract}</strong><span>{d.chainId} / {d.instance}</span><small>{shortAddress(d.address)} +</small></button>)}</div></details></div><div>{selected ? <ContractPanel key={selected.id} contract={selected} state={state} save={save} action={action} /> : <div className="contract-placeholder"><div className="orbit">◇<span>◇</span></div><h2>One place for the whole system.</h2><p>Select a contract to inspect its relationships and generate controls from its ABI.</p><Badge>Identity includes the chain</Badge></div>}</div></div></>;
}

function CreatorDiscovery({ state, save, action, catalog, select }: Shared & { catalog: any; select: (id?: string) => void }) {
  const [result, setResult] = useState<any>();
  const [factory, setFactory] = useState('');
  const factories = catalog?.deployments.filter((d: any) => d.contract === 'KeelCreatorFactory') ?? [];
  return <div className="discovery"><details><summary>Find collections created for your wallet <span>Read a selected KEEL factory ↗</span></summary><form className="form-grid" onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); const selected = factories[Number(factory)]; if (!selected) return; setResult(undefined); void action(async () => setResult(await api('discoverCreator', { chainId: selected.chainId, factoryAddress: selected.address, creator: String(data.get('creator')), rpcUrl: String(data.get('rpc')) }))); }}><Field label="Factory deployment"><select value={factory} onChange={(e) => { setFactory(e.target.value); setResult(undefined); }} required><option value="">Choose chain and deployment…</option>{factories.map((f: any, i: number) => <option key={i} value={i}>{f.chainId} / {f.instance} / {shortAddress(f.address)}</option>)}</select></Field><Field label="Creator’s public address"><input name="creator" required placeholder="0x…" list="saved-wallets" /><datalist id="saved-wallets">{state.wallets.filter((w) => w.family === 'ethereum').map((w) => <option key={w.id} value={w.address}>{w.label}</option>)}</datalist></Field><Field label="RPC for the selected chain"><input name="rpc" type="url" required placeholder="https://…" /></Field><button className="primary">Find my collections</button></form><p className="small">Reads at one block. A factory record links a creator and collection; account authority and bytecode identity require separate verification.</p>{result && <div className="discovery-results"><div className="section-line"><h2>{result.records.length} collections found</h2><Badge>Block {result.blockNumber}</Badge></div>{result.records.map((record: any) => <div className="record-row" key={record.collectionId}><div><h3>{record.name}</h3><code>{record.contract.address}</code></div><Badge>{record.deployment}</Badge><small>#{record.collectionId}{record.deployment === 'shared' ? ` / shared #${record.sharedCollectionId}` : ''}</small></div>)}<button className="primary" onClick={() => void action(async () => {
    const current = queryClient.getQueryData<Workspace>(['workspace'])!;
    await save(mergeDiscoveredCollections(current.state, [result]));
  })}>Remember collections & related contracts</button></div>}</details>{state.collections.length > 0 && <details><summary>Your collections <Badge>{state.collections.length}</Badge></summary>{state.collections.map((c) => <button className="collection-row" key={c.id} onClick={() => select(c.contractId)}><strong>{c.name}</strong><span>Chain {c.chainId} · {c.deployment} · collection #{c.collectionId}</span><small>{c.deployment === 'shared' ? `Shared item group #${c.sharedCollectionId}` : 'Dedicated registry identity'} ↗</small></button>)}</details>}</div>;
}

function ContractPanel({ contract, state, save, action }: Shared & { contract: KeelTrackedContract }) {
  const controls = useMemo(() => contractControls(contract.abi), [contract.abi]);
  const [mode, setMode] = useState('read');
  const [filter, setFilter] = useState('');
  const [signature, setSignature] = useState('');
  const [args, setArgs] = useState<string[]>([]);
  const [rpc, setRpc] = useState('');
  const [valueWei, setValueWei] = useState('0');
  const resultQuery = useLatestResult();
  const result = resultQuery.data;
  const control = controls.find((c) => c.signature === signature);
  const inspectionQuery = useLatestResult();
  const inspection = inspectionQuery.data;
  const [account, setAccount] = useState('');
  useEffect(() => { resultQuery.clear(); inspectionQuery.clear(); }, [contract.abi]);
  const call = () => ({ contract, signature, valueWei, args: args.map((value, index) => {
    const type = control!.inputs[index].type;
    return type.includes('[') || type.startsWith('tuple') ? JSON.parse(value) : value;
  }) });
  return <section className="contract-panel"><div className="eyebrow">CONTRACT INSPECTOR</div><h2>{contract.name}</h2><code className="address">{contract.address}</code><div className="badge-row"><Badge>Chain {contract.chainId}</Badge><Badge>{contract.source}</Badge><Badge tone="warm">Authority unverified</Badge></div>{contract.proxy && <div className="proxy-link"><span>PROXY → IMPLEMENTATION</span><code>{contract.proxy.implementation ?? 'Not yet identified'}</code><small>{contract.proxy.kind} · controls target the proxy</small></div>}{contract.notes && <p>{contract.notes}</p>}<Field label="RPC for this chain"><input type="url" value={rpc} placeholder="https://…" onChange={(e) => { setRpc(e.target.value); inspectionQuery.clear(); resultQuery.clear(); }} /></Field><div className="button-row"><button onClick={() => void action(() => inspectionQuery.load(() => api('contractInspect', { contract, rpcUrl: rpc })))}>Check code & proxy</button><button onClick={() => void action(async () => { const imported = await api('importAbi'); if (imported) await save({ ...state, contracts: state.contracts.map((c) => c.id === contract.id ? createTrackedContract({ ...c, abi: imported.abi }) : c) }); })}>Replace ABI</button></div>{inspection && <div className={`notice ${inspection.importedImplementationMismatch ? 'error' : ''}`}><strong>{inspection.importedImplementationMismatch ? 'Implementation changed — review the ABI binding' : `Code observed at block ${inspection.blockNumber}`}</strong><p>{inspection.kind} · ABI match and account authority remain unverified.</p>{inspection.implementation && <code>{inspection.implementation}</code>}<details><summary>Read-back evidence</summary><pre>{pretty(inspection)}</pre></details></div>}
    <div className="tabs">{['read', 'write'].map((m) => <button key={m} className={mode === m ? 'selected' : ''} onClick={() => { setMode(m); setSignature(''); resultQuery.clear(); }}>{m === 'read' ? 'Read' : 'Write review'} <span>{controls.filter((c) => c.mode === m).length}</span></button>)}</div><input className="method-search" placeholder="Find a contract method…" aria-label="Find contract method" value={filter} onChange={(e) => setFilter(e.target.value)} /><div className="method-list">{controls.filter((c) => c.mode === mode && c.signature.toLowerCase().includes(filter.toLowerCase())).map((c) => <button key={c.signature} className={signature === c.signature ? 'selected' : ''} onClick={() => { setSignature(c.signature); setArgs(c.inputs.map(() => '')); resultQuery.clear(); setValueWei('0'); }}><span>{c.name}</span><small>{c.inputs.length} inputs {c.payable ? '· payable' : ''}</small><code>{c.signature}</code></button>)}</div>{control && <div className="control-form"><h3>{control.name}</h3>{control.inputs.map((input, index) => <Field key={index} label={`${input.name || `Argument ${index + 1}`} · ${input.type}`}><input value={args[index] ?? ''} placeholder={input.type.includes('[') || input.type.startsWith('tuple') ? 'Ordered JSON array; integers as strings' : input.type} onChange={(e) => { setArgs(args.map((v, i) => i === index ? e.target.value : v)); resultQuery.clear(); }} /></Field>)}{control.payable && <Field label="Native value (wei)"><input value={valueWei} onChange={(e) => { setValueWei(e.target.value); resultQuery.clear(); }} /></Field>}<button className="primary" onClick={() => void action(() => resultQuery.load(() => api(control.mode === 'read' ? 'contractRead' : 'contractReview', { ...call(), ...(control.mode === 'read' ? { rpcUrl: rpc } : {}) })))}>{control.mode === 'read' ? 'Read from this chain' : 'Prepare unsigned call'}</button>{control.mode === 'write' && <div className="simulation"><Field label="Simulate as public address"><input value={account} placeholder="0x…" onChange={(event) => { setAccount(event.target.value); resultQuery.clear(); }} /></Field><button disabled={!rpc || !account} onClick={() => void action(() => resultQuery.load(() => api('contractSimulate', { ...call(), rpcUrl: rpc, account })))}>Simulate unsigned call</button></div>}{control.mode === 'write' && <WalletWrite key={JSON.stringify([contract, signature, args, valueWei, rpc])} contract={contract} prepareInput={call} rpcUrl={rpc} />}</div>}{result !== undefined && <div className="result"><div className="eyebrow">{control?.mode === 'read' ? 'READ RESULT' : 'UNSIGNED CALL REVIEW'}</div><pre>{pretty(result)}</pre></div>}{!controls.length && <Empty title="Add the contract’s vocabulary">Import an ABI to generate its controls. Overloaded methods stay separate by full signature.</Empty>}</section>;
}

function ModuleSteps() { return <div className="module-steps"><h3>From source to a reusable module</h3>{KEEL_ENGINE_CATALOG.moduleWorkflow.map((step, i) => <details key={step.id}><summary><span>0{i + 1}</span>{label(step.id)}</summary><p>{step.instruction}</p>{'command' in step && <code>{step.command}</code>}{'tool' in step && <code>{step.tool}</code>}</details>)}</div>; }
function Modules({ catalog, search, state, save, action }: Shared & { catalog: any; search: string }) { return <><div className="page-heading compact"><div><h1>Build on what exists.</h1><p>Discover the protocol and creative runtimes. Local source availability and onchain publication are separate.</p></div><Badge>{catalog?.modules.length ?? 0} protocol modules</Badge></div><ModuleSearch state={state} save={save} action={action} /><div className="module-grid">{KEEL_ENGINE_CATALOG.runtimes.filter((r) => pretty(r).toLowerCase().includes(search.toLowerCase())).map((runtime) => <article className="module-card" key={runtime.id}><div className="module-glyph">{runtime.id === 'p5' ? 'p5' : runtime.id === 'three' ? '3D' : runtime.id === 'doom-wasm' ? 'W' : 'ƒ'}</div><h2>{runtime.title}</h2><p>{runtime.summary}</p><Badge>{runtime.availability}</Badge><details><summary>Resources & exact local evidence</summary>{runtime.resources.map((resource) => <div className="resource" key={resource.id}><strong>{resource.id}</strong><p>{resource.version} · {resource.mediaType}</p><code>{resource.integrity?.digest ?? 'Source required'}</code></div>)}</details></article>)}</div><div className="content-pad"><details className="disclosure"><summary>Advanced: all protocol systems</summary>{catalog?.modules.filter((module: any) => pretty(module).toLowerCase().includes(search.toLowerCase())).map((module: any) => <details className="protocol-module" key={module.id}><summary><strong>{module.title}</strong><Badge>{module.group}</Badge><span>{module.version}</span></summary><p>{module.summary}</p><p>Dependencies: {module.deps.join(', ') || 'None'}</p><code>{module.repo ?? 'Local source'}</code></details>)}<ModuleSteps /></details></div></>; }
function ObjectCard({ object, action }: { object: Workspace['state']['objects'][number]; action: Shared['action'] }) {
  const [preview, setPreview] = useState(false);
  const plan = object.compressedByteLength === undefined ? null : planKeelAssetPresentation({ originalByteLength: object.byteLength, compressedByteLength: object.compressedByteLength });
  return <article className="object-card"><div className="object-preview">{preview ? <iframe title={`Verified preview of ${object.name}`} sandbox="allow-scripts allow-pointer-lock" src={`keel-asset://${object.id}/view`} /> : <button onClick={() => setPreview(true)}>◇<span>Open verified preview</span></button>}</div><h3>{object.name}</h3><p>{fileSize(object.byteLength)} original · {object.type}</p>{plan && <p>{fileSize(plan.compressedByteLength)} Gzip · {plan.mode === 'inline' ? 'Inline by default' : 'RPC reconstruction by default'}</p>}<code>{object.id}</code><div className="inline-actions"><Badge>Local bytes</Badge><button onClick={() => void action(() => api('exportObject', object.id))}>Export original</button></div></article>;
}

function ExternalWorkspaceConnection() {
  const connection=useQuery({queryKey:['workspace-connection'],queryFn:()=>api('workspaceConnection')});
  return <section className="setup-card"><h2>Use your assistant from another app.</h2><p>Connect an external KEEL MCP or SDK to this workspace. It can read and update these same projects while you work here. You do not need to start a chat in the editor.</p><details><summary>Connection for SDK and MCP</summary><p>Set <code>KEEL_EDITOR_CONNECTION</code> in your KEEL MCP configuration to:</p><code style={{overflowWrap:'anywhere'}}>{connection.data?.connectionFile ?? 'Loading connection…'}</code><p>Updates appear here automatically. Conflicting edits are preserved for review. Wallet signing stays in Wallets.</p></details></section>;
}
function Connections({ action, state, save }: Shared) {
  const query = useQuery({ queryKey: ['connections'], queryFn: () => api('connections') });
  return <><div className="page-heading compact"><div><h1>Set up at your pace.</h1><p>You can create, import, preview and save artwork right away. Add connections when your work needs them.</p></div></div><div className="setup-journey"><article><h3>1 · Make the work</h3><p>Start in My work. Add a file, edit its metadata, and try the preview. Your drafts stay on this computer.</p></article><article><h3>2 · Prepare its home</h3><p>Choose a target network inside the project. Connect Studio below to find reusable resources and inspect release capabilities.</p></article><article><h3>3 · Review a release</h3><p>Use the Release guide and project checks. Connect your account in Wallets. Contract controls can simulate an update and send it to your wallet for approval.</p></article></div><Readiness action={action} /><WorkspaceTransfer state={state} save={save} action={action} /><StudioConnection action={action} /><ExternalWorkspaceConnection /><div className="connection-grid">{['codex', 'claude'].map((provider) => <article className="connection-card" key={provider}><Badge>LOCAL CLI</Badge><h2>{provider === 'codex' ? 'Codex' : 'Claude Code'}</h2><p>Uses your installed CLI and its sign-in. The model service may still run in the cloud.</p><code>{provider === 'codex' ? 'codex app-server' : 'claude --print'}</code><p className="small">Choose this provider in the Chats. Chats can inspect your work, create drafts, suggest edits, and prepare wallet reviews.</p></article>)}{(['openai', 'anthropic'] as const).map((provider) => <form className="connection-card" key={provider} onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const key = String(new FormData(form).get('key')); void action(async () => { await api('saveKey', { provider, key }); form.reset(); await query.refetch(); }); }}><Badge>{query.data?.[provider] ? 'KEY SAVED' : 'DIRECT API'}</Badge><h2>{provider === 'openai' ? 'OpenAI' : 'Anthropic'}</h2><Field label="API key"><input name="key" type="password" autoComplete="off" required placeholder="Stored with OS encryption" /></Field><div className="button-row"><button className="primary">Save key</button>{query.data?.[provider] && <button type="button" onClick={() => void action(async () => { await api('deleteKey', provider); await query.refetch(); })}>Remove key</button>}</div><p className="small">The key is encrypted outside project memory. Enter the model ID in the Chats. Sending a request uses your API account.</p></form>)}</div></>;
}

createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><App /></QueryClientProvider>);
