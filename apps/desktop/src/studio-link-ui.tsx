import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Field } from './ui';
import { api, queryClient } from './client';
import type { Shared } from './types';

// Connect to Studio: show a pairing code, let the creator approve it in
// Studio, then read their Studio (projects, releases, contracts) here. The
// Studio key stays in the main process, wrapped by the OS keychain; this page
// only sees it if the creator asks to set up Claude Code or Codex.

type Pairing = { code: string; studio: string; approveUrl: string; opened: boolean; expiresAt: string; state: 'waiting' | 'connected' | 'denied' | 'expired' | 'collected' | 'cancelled' | 'failed'; message?: string };
type Connection = { studio: string; studioUrl: string; mcpUrl: string; label: string; scopes: string[]; scopeLabels: string[]; grantId: string; expiresAt: string; expired: boolean; connectedAt: string };
type LinkStatus = { keychain: boolean; pairing: Pairing | null; connection: Connection | null; configured: string | null };
type Overview = { studio: string; readAt: string; projects: { id: string; name: string; status: string | null; chainId: number | null; kind: string | null; reviewUrl?: string }[]; releases: { id: string; title: string; slug: string | null; type: string | null; status: string | null; chainId: number | null; reviewUrl?: string }[]; contracts: { chainId: number; address: string; name: string; family: string | null; standard: string | null; category: string | null; tags: string[]; archived: boolean; collections: { key: string; name: string }[]; reviewUrl?: string }[]; workspaceUnavailable?: string; contractsUnavailable?: string };

export const STUDIO_LINK_QUERY = ['studio-link'];
export const useStudioLink = (poll = false) => useQuery<LinkStatus>({ queryKey: STUDIO_LINK_QUERY, queryFn: () => api('studioLinkStatus'), refetchInterval: (query) => poll || query.state.data?.pairing?.state === 'waiting' ? 1000 : false });
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function StudioLinkCard({ action }: { action: Shared['action'] }) {
  const link = useStudioLink();
  const status = link.data;
  const [address, setAddress] = useState('');
  useEffect(() => { if (status?.configured && !address) setAddress(status.configured); }, [status?.configured]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: STUDIO_LINK_QUERY });
  const pairing = status?.pairing;
  const connection = status?.connection;
  const start = () => void action(async () => { queryClient.setQueryData(STUDIO_LINK_QUERY, await api('studioLinkStart', address.trim() ? { studioUrl: address.trim() } : {})); });
  if (!status) return <section className="setup-card studio-link"><h2>Connect to Studio.</h2><p>Checking…</p></section>;

  if (connection) return <>
    <section className="setup-card studio-link" aria-label="Studio connection">
      <div className="section-line"><h2>Connected to Studio.</h2><Badge tone={connection.expired ? 'warm' : 'cool'}>{connection.expired ? 'Expired' : 'Connected'}</Badge></div>
      <p>This editor can read your Studio at <strong>{connection.studio}</strong> as “{connection.label}”. It can’t sign, publish or pay; anything on chain is still approved in your wallet.</p>
      <dl className="logical-facts"><dt>Allowed to</dt><dd>{connection.scopeLabels.join(' · ')}</dd><dt>Connected</dt><dd>{when(connection.connectedAt)}</dd><dt>Key expires</dt><dd>{when(connection.expiresAt)}</dd></dl>
      {connection.expired && <p className="notice error">This connection has expired. Disconnect, then connect again.</p>}
      <div className="inline-actions">
        <button onClick={() => void action(() => api('studioOpen', { url: `${connection.studio}/studio` }))}>Open Studio ↗</button>
        <button onClick={() => void action(async () => { await api('studioLinkDisconnect'); await refresh(); })}>Disconnect</button>
      </div>
      <p className="small">Disconnect forgets the key on this computer. To revoke it everywhere, open Studio home → Work with your AI agent.</p>
      <AgentSetup action={action} />
    </section>
    <StudioOverviewCard connection={connection} action={action} />
  </>;

  return <section className="setup-card studio-link" aria-label="Connect to Studio">
    <h2>Connect to Studio.</h2>
    <p>Approve this editor in your KEEL Studio with one code. Then your Studio projects, releases and contracts show up here, and your assistant can read them. Nothing in Studio changes from the editor.</p>
    {!status.keychain && <p className="notice error">This computer’s keychain isn’t available, so the editor can’t keep a Studio key safely. You can still connect your AI agent from Studio itself.</p>}
    {pairing?.state === 'waiting' ? <div className="pairing" role="status" aria-live="polite">
      <span className="field-caption">Your code</span>
      <div className="pair-code" aria-label={`Pairing code ${pairing.code.split('').join(' ')}`}>{pairing.code}</div>
      <p>{pairing.opened ? 'We opened Studio in your browser. Check that it shows this code, then approve.' : pairing.message ?? `Open ${pairing.studio}/studio/connect and enter this code.`}</p>
      {pairing.opened && pairing.message && <p className="small">{pairing.message}</p>}
      <p className="small">Waiting for your approval · the code expires at {new Date(pairing.expiresAt).toLocaleTimeString()}.</p>
      <div className="inline-actions">
        <button onClick={() => void action(() => api('studioOpen', { url: pairing.approveUrl }))}>Open the approval page again ↗</button>
        <button onClick={() => void action(async () => { queryClient.setQueryData(STUDIO_LINK_QUERY, { ...status, ...(await api('studioLinkCancel')) }); })}>Cancel</button>
      </div>
    </div> : <>
      {pairing && pairing.state !== 'connected' && <p className={`notice ${pairing.state === 'cancelled' ? '' : 'error'}`}>{pairing.message}</p>}
      <form className="inline-actions" onSubmit={(event) => { event.preventDefault(); start(); }}>
        <Field label="Studio address"><input type="url" required value={address} placeholder="https://your-keel-studio.example" onChange={(event) => setAddress(event.target.value)} /></Field>
        <button className="primary" disabled={!status.keychain}>Connect to Studio</button>
      </form>
      <p className="small">The editor asks to see your projects and drafts, create new drafts, and see your contracts. You can give it less when you approve.</p>
    </>}
  </section>;
}

/** Claude Code and Codex setup, shown only after the creator asks; the key is dropped again on Hide. */
function AgentSetup({ action }: { action: Shared['action'] }) {
  const [revealed, setRevealed] = useState<{ token: string; mcpUrl: string; commands: { client: string; title: string; code: string; note?: string }[] }>();
  const [copied, setCopied] = useState('');
  useEffect(() => () => setRevealed(undefined), []);
  return <details className="disclosure" onToggle={(event) => { if (!(event.currentTarget as HTMLDetailsElement).open) setRevealed(undefined); }}>
    <summary>Use this connection in Claude Code or Codex</summary>
    <p className="small">These commands contain your Studio key. Anyone with it can do what you allowed above until it expires or you revoke it in Studio.</p>
    {!revealed ? <button onClick={() => void action(async () => setRevealed(await api('studioLinkReveal')))}>Show the key and setup commands</button> : <>
      {revealed.commands.map((step) => <div className="setup-step" key={step.code}>
        <span className="field-caption">{step.client} · {step.title}</span>
        <code className="digest">{step.code}</code>
        {step.note && <small>{step.note}</small>}
        <button onClick={() => void action(async () => { await navigator.clipboard.writeText(step.code); setCopied(step.code); })}>{copied === step.code ? 'Copied' : 'Copy'}</button>
      </div>)}
      <button onClick={() => { setRevealed(undefined); setCopied(''); }}>Hide the key</button>
    </>}
  </details>;
}

/** The creator's Studio, read through keel_workspace and keel_contracts. */
export function StudioOverviewCard({ connection, action }: { connection: Connection; action: Shared['action'] }) {
  const [overview, setOverview] = useState<Overview>();
  const [query, setQuery] = useState('');
  const load = () => void action(async () => setOverview(await api('studioLinkOverview', query.trim() ? { query: query.trim() } : {})));
  useEffect(() => { if (!connection.expired) load(); }, [connection.grantId]);
  const open = (url?: string) => url && void action(() => api('studioOpen', { url }));
  return <section className="setup-card studio-overview" aria-label="Your Studio">
    <div className="section-line"><h2>Your Studio.</h2>{overview && <span>Read {new Date(overview.readAt).toLocaleTimeString()}</span>}</div>
    <form className="inline-actions" onSubmit={(event) => { event.preventDefault(); load(); }}><input aria-label="Filter Studio contracts" value={query} maxLength={120} placeholder="Filter contracts by name, tag or address" onChange={(event) => setQuery(event.target.value)} /><button>Refresh</button></form>
    {!overview ? <p className="small">Reading your Studio…</p> : <div className="studio-columns">
      <div>
        <h3>Projects &amp; releases</h3>
        {overview.workspaceUnavailable ? <p className="small">{overview.workspaceUnavailable}</p> : <>
          {overview.projects.map((item) => <div className="studio-row" key={`p-${item.id}`}><div><strong>{item.name || 'Untitled project'}</strong><small>{[item.kind, item.status, item.chainId ? `chain ${item.chainId}` : ''].filter(Boolean).join(' · ')}</small></div>{item.reviewUrl && <button onClick={() => open(item.reviewUrl)}>Open in Studio ↗</button>}</div>)}
          {overview.releases.map((item) => <div className="studio-row" key={`r-${item.id}`}><div><strong>{item.title || 'Untitled release'}</strong><small>{['Release', item.type, item.status, item.chainId ? `chain ${item.chainId}` : ''].filter(Boolean).join(' · ')}</small></div>{item.reviewUrl && <button onClick={() => open(item.reviewUrl)}>Open in Studio ↗</button>}</div>)}
          {!overview.projects.length && !overview.releases.length && <p className="small">No projects or releases in Studio yet.</p>}
        </>}
      </div>
      <div>
        <h3>Contracts</h3>
        {overview.contractsUnavailable ? <p className="small">{overview.contractsUnavailable}</p> : <>
          {overview.contracts.filter((item) => !item.archived).map((item) => <div className="studio-row" key={`${item.chainId}:${item.address}`}><div><strong>{item.name || short(item.address)}</strong><small>{[item.category, item.standard?.toUpperCase().replace('ERC', 'ERC-'), `chain ${item.chainId}`, short(item.address), item.collections.length ? `${item.collections.length} inside` : ''].filter(Boolean).join(' · ')}</small>{item.tags.length > 0 && <div className="tag-line">{item.tags.slice(0, 4).map((tag) => <span className="tag-chip" key={tag}>#{tag}</span>)}</div>}</div>{item.reviewUrl && <button onClick={() => open(item.reviewUrl)}>Open in Studio ↗</button>}</div>)}
          {!overview.contracts.length && <p className="small">No contracts in Studio{query ? ' match that filter' : ' yet'}.</p>}
        </>}
      </div>
    </div>}
  </section>;
}

/** Deep links from the editor's contract inspector into the same contract in Studio. */
export function StudioContractLinks({ chainId, address, action }: { chainId: number; address: string; action: Shared['action'] }) {
  const link = useStudioLink();
  if (!link.data?.connection && !link.data?.configured) return null;
  const tabs = [['overview', 'Overview'], ['collections', 'Collections'], ['rules', 'Trading rules'], ['signers', 'Signers'], ['admin', 'Admin']] as const;
  return <div className="studio-links small"><span>In Studio:</span>{tabs.map(([tab, label]) => <button key={tab} className="text-button" onClick={() => void action(() => api('studioOpenContract', { chainId, address, tab }))}>{label} ↗</button>)}</div>;
}
