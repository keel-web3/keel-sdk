// The alpha-tester pieces of the game editor: a New game flow with templates,
// getting the engine, Copy diagnostics, the engine picker (this editor's
// engine against the practice chain and Sepolia), Publish to practice chain
// with share links, and a Sepolia publication prepared up to the wallet's
// signature through the editor's own wallet review.
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { decodeFunctionData, parseAbi } from 'viem';
import { createTrackedContract } from '@keel/sdk/contract-controls';
import type { Project, Workspace } from '../types';
import { api, queryClient } from '../client';
import { Badge, Field, fileSize } from '../ui';
import { WalletWrite } from '../wallet-ui';

type Template = { id: string; title: string; description: string; pack: boolean };
type Practice = { running: boolean; reason: string; rpc: string | null; chainId: number; KeelHold: string | null; KeelRawTokenURIBuilder: string | null; viewer: string | null; release: { objects: number; publishedAt: string; failed: { id: string; error: string }[] } | null; games: { gameId: string; root: string; digest: string; chainId: number; publishedAt: string }[] };
type Published = { gameId: string; root: string; digest: string; documentBytes: number; readBackBytes: number; readBackMatches: boolean; stored: { bytes: number; chunks: number }; shared: { bytes: number }; gas: { total: string; transactions: number }; transactions: number; reused: { role: string; moduleId?: string; version?: string }[]; links: { viewer?: string; web3: string }; log?: string[] };
type ChainObject = { key: string; role: string; moduleId: string | null; version: string | null; objectId: string; onChain: boolean; recorded: boolean; matchesRecord: boolean | null };
type ResolvedRow = { id: string; version: string; digest: string; onchain: 'verified' | 'not-deployed' | 'mismatch' | 'unread'; local: 'match' | 'mismatch' | 'absent'; notes: string[]; source: { repository: string; commit: string | null; path: string; files: number; verifyCommand: string | null } };
type Resolver = { error?: string; version?: string; revision?: string | null; repository?: string; pin?: { version: string; chainId: number; hold: string; objectId: string; digest: string }; modules?: ResolvedRow[] };
type OnChain = { local: { available: boolean; root: string | null; source: string | null; lock: { repository: string; tag: string | null; commit: string | null } }; practice: Practice & { check: null | { error?: string; objects?: ChainObject[]; allOnChain?: boolean; anyOnChain?: boolean; mismatched?: string[]; failed?: { id: string; error: string }[]; resolver?: Resolver | null } }; sepolia: { published: boolean; note: string; pin?: { version: string; objectId: string }; check?: { error?: string; resolver?: Resolver | null } } };
type Plan = { gameId: string; chainId: number; hold: string; root: string; documentBytes: number; own: { bytes: number; chunks: number; welds: number }; shared: { bytes: number; chunks: number }; sharedMissing: { role: string; moduleId?: string; version?: string }[]; transactions: { label: string; kind: string; share: string; to: string; bytes: number; data: `0x${string}` }[] };

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Copy diagnostics: versions, the engine and its fingerprint, the practice chain, recent log lines. Nothing is sent. */
export function CopyDiagnostics() {
  const [state, setState] = useState<{ text?: string; note?: string }>({});
  async function copy() {
    const { text } = await api('gameDiagnostics');
    try { await navigator.clipboard.writeText(text); setState({ note: 'Diagnostics copied. Paste them into your feedback.' }); }
    catch { setState({ text, note: 'Copy these into your feedback:' }); }
  }
  return <span className="game-diagnostics"><button onClick={() => void copy().catch((error) => setState({ note: message(error) }))}>Copy diagnostics</button>{state.note && <small role="status">{state.note}</small>}{state.text && <textarea readOnly aria-label="Diagnostics" value={state.text} rows={8} />}</span>;
}

/** Get the engine: clone the pinned engine release (pnpm game:engine), then restart. */
export function GetEngine() {
  const [state, setState] = useState<{ running?: boolean; ok?: boolean; output?: string }>({});
  return <div className="game-get-engine">
    <button className="primary" disabled={state.running} onClick={() => { setState({ running: true }); void api('gameGetEngine').then((result) => setState(result)).catch((error) => setState({ ok: false, output: message(error) })); }}>{state.running ? 'Getting the engine…' : 'Get the engine'}</button>
    {state.output !== undefined && <><p role={state.ok ? 'status' : 'alert'} className={`notice ${state.ok ? '' : 'error'}`}>{state.ok ? 'The engine is here. Restart the editor to load it.' : 'Couldn’t get the engine.'}</p><pre className="game-output">{state.output}</pre></>}
  </div>;
}

/** New game: a template, a name, and a Game project that plays it (or, with a project, that project plays it). */
export function NewGame({ projectId, compact = false }: { projectId?: string; compact?: boolean }) {
  const templates = useQuery<Template[]>({ queryKey: ['game-templates'], queryFn: () => api('gameTemplates') });
  const [template, setTemplate] = useState('blank');
  const [name, setName] = useState('');
  const [state, setState] = useState<{ busy?: boolean; error?: string; made?: string }>({});
  async function create() {
    setState({ busy: true });
    const current = queryClient.getQueryData<Workspace>(['workspace'])!;
    const result = await api('gameNew', { template, name: name.trim() || templates.data?.find((item) => item.id === template)?.title || 'My game', ...(projectId ? { projectId } : {}), revision: current.revision });
    queryClient.setQueryData(['workspace'], result.workspace);
    await queryClient.invalidateQueries({ queryKey: ['game-modules'] });
    setState({ made: `${result.made.title} is ready: ${result.made.gameId}` });
  }
  return <section className={`setup-card game-new ${compact ? 'compact' : ''}`}><h2>{projectId ? 'Start this game from a template' : 'New game'}</h2><p>Each template is a working game made with the engine, copied into a folder of your own with its own module ids. {projectId ? '' : 'You get a Game project that plays it.'}</p>
    <div className="game-templates" role="radiogroup" aria-label="Game template">{(templates.data ?? []).map((item) => <button key={item.id} role="radio" aria-checked={template === item.id} className={template === item.id ? 'selected' : ''} onClick={() => setTemplate(item.id)}><strong>{item.title}</strong><small>{item.description}</small>{item.pack && <Badge>your own pack</Badge>}</button>)}</div>
    <div className="game-new-form"><Field label="Game name"><input aria-label="Game name" maxLength={80} value={name} placeholder="My first game" onChange={(event) => setName(event.target.value)} /></Field>
      <button className="primary" disabled={state.busy || !templates.data} onClick={() => void create().catch((error) => setState({ error: message(error) }))}>{state.busy ? 'Making it…' : 'Create game ↗'}</button></div>
    {state.error && <p role="alert" className="notice error">{state.error}</p>}{state.made && <p role="status" className="notice">{state.made}</p>}
  </section>;
}

const short = (hex?: string | null) => hex ? `${hex.slice(0, 10)}…${hex.slice(-6)}` : '—';

/** The engine picker: which engine this editor builds with, and whether each chain holds the same engine. */
export function EnginePicker() {
  // (The cheap part shows at once; the check builds the engine release and reads every object, so it runs on request.)
  const info = useQuery<OnChain>({ queryKey: ['game-engine-info'], queryFn: () => api('gameEngineInfo') });
  const on = useQuery<OnChain>({ queryKey: ['game-engine-on-chain'], queryFn: () => api('gameEngineOnChain'), enabled: false });
  const [state, setState] = useState<{ busy?: boolean; error?: string; done?: string }>({});
  const data = on.data ?? info.data;
  const check = data?.practice.check;
  const objects = check && 'objects' in check ? check.objects ?? [] : [];
  const onChain = objects.filter((item) => item.onChain).length;
  const resolver = check?.resolver ?? null;
  const rows = resolver?.modules ?? [];
  const verifiedCount = rows.filter((row) => row.onchain === 'verified').length;
  const matchCount = rows.filter((row) => row.local === 'match').length;
  const badge = !data?.practice.running ? ['not running', 'warn'] : !check ? ['not checked yet', 'warn'] : check.error ? ['unknown', 'warn']
    : rows.length ? (rows.some((row) => row.onchain === 'mismatch' || row.local === 'mismatch') ? ['mismatch', 'danger'] : verifiedCount === rows.length ? [matchCount === rows.length ? 'verified · local build matches' : 'verified', 'ok'] : ['partly published', 'warn'])
    : check.mismatched?.length ? ['mismatch', 'danger'] : check.allOnChain ? ['on chain', 'ok'] : check.anyOnChain ? ['partly published', 'warn'] : ['not published', 'warn'];
  const sourceLink = (row: ResolvedRow) => row.source.commit && /^https:\/\/github\.com\//.test(row.source.repository) ? `${row.source.repository.replace(/\.git$/, '')}/tree/${row.source.commit}/${row.source.path}` : row.source.repository;
  const lock = data?.local.lock;
  const github = lock?.commit ? `${lock.repository}/tree/${lock.commit}` : lock?.repository;
  return <section className="setup-card game-engine-picker"><h2>Engine version</h2>
    <p>Games are built with the engine below and reference the engine's modules on chain by id@version, so a game publish stores only the game. Each chain holds one engine release per version.</p>
    <div className="button-row"><button disabled={on.isFetching || !data?.local.available} onClick={() => void on.refetch()}>{on.isFetching ? 'Checking the engine on each chain…' : on.data ? 'Check again' : 'Check the engine on chain'}</button></div>
    {(on.error || info.error) && <p role="alert" className="notice error">{(on.error ?? info.error)!.message}</p>}
    {data && <div className="game-engine-rows">
      <div><span>THIS EDITOR</span><strong>{data.local.available ? ({ env: 'Your checkout (KEEL_GAME_ENGINE_ROOT)', checkout: 'Local checkout', release: `Engine release ${lock?.tag ?? ''}` } as Record<string, string>)[data.local.source ?? 'checkout'] ?? 'Local engine' : 'No engine yet'}</strong><small>{data.local.root ?? 'Get the engine to build games.'}</small>{github && <button className="text-button" onClick={() => void api('gameOpenLink', github).catch((error: unknown) => setState({ error: message(error) }))}>View source on GitHub ↗</button>}</div>
      <div><span>PRACTICE CHAIN</span><strong><Badge tone={badge[1]}>{badge[0]}</Badge></strong><small>{data.practice.running ? (rows.length ? `Release ${resolver?.version} (record ${short(resolver?.pin?.objectId)}): ${verifiedCount}/${rows.length} modules verified on chain, ${matchCount}/${rows.length} match this editor's build` : `${onChain} of ${objects.length} engine objects on chain ${data.practice.chainId}${check?.mismatched?.length ? ` · your local build differs for ${check.mismatched.join(', ')}` : ''}`) : data.practice.reason}</small>{resolver?.error && <small className="notice error">{resolver.error}</small>}
        {data.practice.running && objects.length > 0 && onChain < objects.length && <button disabled={state.busy} onClick={() => { setState({ busy: true }); void api('gamePublishEngine').then((r) => { setState({ done: `Published ${r.objects} shared objects (${r.gas.transactions} transactions).` }); void on.refetch(); void info.refetch(); }).catch((error) => setState({ error: message(error) })); }}>{state.busy ? 'Publishing the engine…' : 'Publish this engine to the practice chain'}</button>}</div>
      <div><span>SEPOLIA</span><strong><Badge tone="warn">{data.sepolia.published ? 'published' : 'not published yet'}</Badge></strong><small>{data.sepolia.note}</small></div>
    </div>}
    {state.error && <p role="alert" className="notice error">{state.error}</p>}{state.done && <p role="status" className="notice">{state.done}</p>}
    {rows.length > 0 && <details className="disclosure"><summary>Engine modules in the pinned release ({verifiedCount}/{rows.length} verified)</summary><div className="game-table-wrap"><table className="game-table"><thead><tr><th>Module</th><th>On chain</th><th>This editor's build</th><th>Readable source</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.id}</strong><small>@{row.version} · {short(row.digest)}</small>{row.notes.map((note) => <small key={note}>{note}</small>)}</td><td><Badge tone={row.onchain === 'verified' ? 'ok' : 'warn'}>{row.onchain}</Badge></td><td><Badge tone={row.local === 'match' ? 'ok' : 'warn'}>{row.local}</Badge></td><td><button className="text-button" onClick={() => void api('gameOpenLink', sourceLink(row)).catch((error: unknown) => setState({ error: message(error) }))}>{row.source.commit ? `at ${row.source.commit.slice(0, 10)}` : 'repository'} ↗</button>{row.source.verifyCommand && <small><code>{row.source.verifyCommand}</code></small>}</td></tr>)}</tbody></table></div></details>}
    {objects.length > 0 && <details className="disclosure"><summary>Engine objects on the practice chain ({onChain}/{objects.length})</summary><div className="game-table-wrap"><table className="game-table"><thead><tr><th>Module</th><th>Object</th><th>On chain</th><th>Matches the release record</th></tr></thead><tbody>{objects.map((item) => <tr key={item.key}><td><strong>{item.moduleId ?? item.role}</strong>{item.version && <small>@{item.version}</small>}</td><td><code>{short(item.objectId)}</code></td><td>{item.onChain ? 'yes' : 'no'}</td><td>{item.matchesRecord === null ? '—' : item.matchesRecord ? 'yes' : 'NO'}</td></tr>)}</tbody></table></div></details>}
  </section>;
}

/** Publish to practice chain, with the links to share the result. */
export function PracticePublish({ project }: { project: Project }) {
  const gameId = project.game?.id;
  const chain = useQuery<Practice>({ queryKey: ['game-practice'], queryFn: () => api('gamePractice') });
  const [state, setState] = useState<{ busy?: boolean; error?: string; code?: string; result?: Published; copied?: string }>({});
  const earlier = chain.data?.games.find((item) => item.gameId === gameId);
  async function publish(includeEngine = false) {
    setState({ busy: true });
    try { setState({ result: await api('gamePublishPractice', { projectId: project.id, gameId, includeEngine }) }); void chain.refetch(); }
    catch (error) { setState({ error: message(error), code: /doesn't have \d+ of the shared objects/.test(message(error)) ? 'engine' : '' }); }
  }
  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => setState((s) => ({ ...s, copied: text }))).catch(() => setState((s) => ({ ...s, copied: '' })));
  const links = state.result?.links ?? (earlier && chain.data?.viewer ? { viewer: `${chain.data.viewer}/game/${earlier.chainId}/${earlier.root}?digest=${earlier.digest}`, web3: '' } : undefined);
  return <section className="game-publish"><div className="section-line"><h2>Publish to practice chain</h2><span>{chain.data?.running ? `Chain ${chain.data.chainId} on this computer · no real funds` : 'Not running'}</span></div>
    {!chain.data?.running && <p className="notice">{chain.data?.reason ?? 'Checking for the practice chain…'} <button className="text-button" onClick={() => void chain.refetch()}>Check again</button></p>}
    {chain.data?.running && <p className="game-hint">Stores this game on your practice chain — only its own modules and entry; the shell and engine modules are already there, shared by every game — then reads it back from the chain and checks it byte for byte.</p>}
    <div className="button-row"><button className="primary" disabled={!gameId || !chain.data?.running || state.busy} onClick={() => void publish()}>{state.busy ? 'Publishing…' : earlier ? 'Publish again' : 'Publish to practice chain'}</button>
      {state.code === 'engine' && <button disabled={state.busy} onClick={() => void publish(true)}>Publish with the engine modules it needs</button>}</div>
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    {state.result && <div className="measurement-grid game-sizes">
      <div><span>STORED FOR THIS GAME</span><strong>{fileSize(state.result.stored.bytes)}</strong><small>{state.result.transactions} transactions · {Number(state.result.gas.total).toLocaleString()} gas{state.result.transactions ? '' : ' (already on chain)'}</small></div>
      <div><span>REUSED FROM THE CHAIN</span><strong>{fileSize(state.result.shared.bytes)}</strong><small>The shell and {state.result.reused.filter((item) => item.moduleId).length} engine modules, not stored again</small></div>
      <div><span>READ BACK FROM THE CHAIN</span><strong>{state.result.readBackMatches ? 'Matches' : 'DIFFERS'}</strong><small>{fileSize(state.result.readBackBytes)} · root {short(state.result.root)}</small></div>
    </div>}
    {links?.viewer && <div className="game-share"><Field label="Share link (practice viewer)"><input readOnly aria-label="Share link" value={links.viewer} onFocus={(event) => event.currentTarget.select()} /></Field>
      <div className="button-row"><button onClick={() => copy(links.viewer!)}>Copy link</button><button onClick={() => void api('gameOpenLink', links.viewer).catch((error: unknown) => setState((s) => ({ ...s, error: message(error) })))}>Open in browser ↗</button>{links.web3 && <button onClick={() => copy(links.web3)}>Copy web3:// root</button>}</div>
      {state.copied && <small role="status">Copied.</small>}
      <p className="game-hint">The practice viewer reads the game from your practice chain each time it opens, and serves it in the KEEL verification shell. It works on this computer while <code>pnpm game:sandbox</code> runs.</p></div>}
  </section>;
}

const HOLD_WRITES = parseAbi(['function castSlugs(bytes[] payloads) returns (bytes32[] slugIds, address[] pointers)', 'function weldObject(bytes32[] slugIds, bytes32 digest, uint64 byteLength, uint8 compression, string mediaType) returns (bytes32 objectId)', 'function weldComposite(bytes32[] partObjectIds, bytes32 digest, uint64 byteLength, string mediaType) returns (bytes32 objectId)']);
const SIGNATURES: Record<string, string> = { castSlugs: 'castSlugs(bytes[])', weldObject: 'weldObject(bytes32[],bytes32,uint64,uint8,string)', weldComposite: 'weldComposite(bytes32[],bytes32,uint64,string)' };
const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

/**
 * Publish to Sepolia, prepared up to the signature: the plan against Sepolia's
 * KeelHold (read-only), then each transaction through the editor's wallet
 * review, where the wallet signs -- or doesn't. Nothing is sent from here.
 */
export function SepoliaPrepare({ project }: { project: Project }) {
  const gameId = project.game?.id;
  const [state, setState] = useState<{ busy?: boolean; error?: string; plan?: Plan; pick?: number }>({});
  const plan = state.plan;
  const contract = plan ? createTrackedContract({ chainId: plan.chainId, address: plan.hold as `0x${string}`, name: 'KeelHold (Sepolia)', kind: 'default', source: 'sdk-deployment', abi: HOLD_WRITES }) : null;
  const tx = plan && state.pick !== undefined ? plan.transactions[state.pick] : undefined;
  const prepareInput = () => {
    const call = decodeFunctionData({ abi: HOLD_WRITES, data: tx!.data });
    const args = (call.args ?? []).map((value) => typeof value === 'bigint' ? value.toString() : typeof value === 'number' ? String(value) : value);
    return { contract, signature: SIGNATURES[call.functionName], args, valueWei: '0' };
  };
  return <details className="disclosure game-sepolia"><summary>Publish to Sepolia (prepare, then your wallet signs)</summary>
    <p className="game-hint">Plans this game against Sepolia's KeelHold with read-only calls, then takes each transaction through your wallet's review. The engine release isn't on Sepolia yet, so until the owner publishes it a plan includes the shared engine modules too.</p>
    <button disabled={!gameId || state.busy} onClick={() => { setState({ busy: true }); void api('gamePlanSepolia', { projectId: project.id, gameId }).then((result) => setState({ plan: result })).catch((error) => setState({ error: message(error) })); }}>{state.busy ? 'Planning against Sepolia…' : 'Prepare for Sepolia'}</button>
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    {plan && <>
      <div className="measurement-grid game-sizes"><div><span>TRANSACTIONS</span><strong>{plan.transactions.length}</strong><small>{plan.sharedMissing.length ? `${plan.sharedMissing.length} shared objects aren't on Sepolia yet and are included` : 'Only this game: the engine is already there'}</small></div><div><span>THIS GAME</span><strong>{fileSize(plan.own.bytes)}</strong><small>{plan.own.chunks} chunks · root {short(plan.root)}</small></div><div><span>DOCUMENT</span><strong>{fileSize(plan.documentBytes)}</strong><small>read back through the builder</small></div></div>
      <Field label="Transaction to review"><select aria-label="Transaction to review" value={state.pick ?? ''} onChange={(event) => setState((s) => ({ ...s, pick: event.target.value === '' ? undefined : Number(event.target.value) }))}><option value="">Choose one…</option>{plan.transactions.map((item, index) => <option key={index} value={index}>{index + 1}. {item.label}{item.bytes ? ` · ${fileSize(item.bytes)}` : ''}</option>)}</select></Field>
      {tx && contract && <WalletWrite key={state.pick} contract={contract} prepareInput={prepareInput} rpcUrl={SEPOLIA_RPC} />}
    </>}
  </details>;
}
