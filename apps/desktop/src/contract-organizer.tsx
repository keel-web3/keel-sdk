import React, { useMemo, useState } from 'react';
import type { KeelContractEntry, KeelContractInspection, KeelLogicalCollection } from '@keel/sdk/contract-registry';
import { Badge, Field } from './ui';
import { queryClient } from './client';
import type { Shared, Workspace, WorkspaceContract } from './types';
import {
  COLLECTION_KIND_LABELS, SIGNER_FLOWS, SIGNER_FLOW_LABELS, SIGNER_ROLES, SIGNER_ROLE_LABELS, SIGNER_STATUSES,
  addTokenRange, attachSigner, chainLabel, contractEntry, describeKeelContract, detachSigner, displayName,
  filterContractEntries, groupKeelContracts, labelLogicalCollection, organizeContract, parseTagText,
  removeLogicalCollection, rememberInspection, workspaceContractEntries,
} from './contract-registry.mjs';

// The editor's shell around the shared SDK contract registry: the same
// grouping, names and descriptions as Studio, with the editor's own look.
// Everything here is bookkeeping in the local workspace. Nothing signs.

export type ContractEntry = KeelContractEntry & { contractId: string };
type Save = Shared['save'];
type Action = Shared['action'];

const shortAddress = (address: string) => `${address.slice(0, 8)}…${address.slice(-6)}`;
const FAMILY_GLYPHS: Record<string, string> = { 'creator-collection': '◇', 'shared-collection': '◈', 'fray-auction': '⌁', 'drop-controller': '◷', infrastructure: '⊞', custom: '◇' };
const SOURCE_LABELS: Record<string, string> = { factory: 'KEEL factory record', indexer: 'Indexed events', release: 'A release', drop: 'A drop', fray: 'FRAY', manual: 'Added by you', agent: 'Your assistant' };
const STATUS_LABELS: Record<string, string> = { unverified: 'Not verified', pending: 'Pending', active: 'Active (as recorded)', revoked: 'Revoked' };
const PROXY_LABELS: Record<string, string> = { none: 'Plain contract — no proxy detected', eip1967: 'Upgradeable proxy (EIP-1967)', beacon: 'Beacon proxy', 'minimal-clone': 'Lightweight copy of a template (EIP-1167 clone)' };
const STANDARD_LABELS: Record<string, string> = { erc721: 'ERC-721', erc1155: 'ERC-1155', erc20: 'ERC-20', unknown: 'Not reported' };
const CATEGORY_SUGGESTIONS = ['Editions', 'Drops', 'Auctions', 'Experiments', 'Archive', 'Infrastructure'];
const DEFAULT_ROLE: Record<string, string> = { wallet: 'owner', 'eip712-authorization': 'stage-signer', 'agent-grant': 'agent', bridge: 'minter', 'server-signer': 'minter' };

export const entryFor = (contract: WorkspaceContract, state: Workspace['state']) => contractEntry(contract, state.collections) as ContractEntry;

/** Saves a change to one contract against the newest saved workspace, so concurrent edits are not overwritten. */
export async function updateContract(save: Save, id: string, change: (contract: WorkspaceContract) => WorkspaceContract) {
  const state = queryClient.getQueryData<Workspace>(['workspace'])!.state;
  if (!state.contracts.some((item) => item.id === id)) throw new Error('This contract is no longer tracked.');
  await save({ ...state, contracts: state.contracts.map((item) => item.id === id ? change(item) : item) });
}

/* --------------------------------------------------------------- directory */

export function ContractDirectory({ state, selectedId, select, search }: { state: Workspace['state']; selectedId?: string; select: (id?: string) => void; search: string }) {
  const entries = useMemo(() => workspaceContractEntries(state) as ContractEntry[], [state.contracts, state.collections]);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [category, setCategory] = useState('');
  const [chainId, setChainId] = useState('');
  const tags = useMemo(() => [...new Set(entries.flatMap((entry) => entry.tags ?? []))].sort(), [entries]);
  const categories = useMemo(() => [...new Set(entries.flatMap((entry) => entry.category ? [entry.category] : []))].sort(), [entries]);
  const chains = useMemo(() => [...new Set(entries.map((entry) => entry.chainId))].sort((a, b) => a - b), [entries]);
  const filtered = filterContractEntries(entries, { query: `${search} ${query}`.trim(), tag, category, chainId: chainId ? Number(chainId) : undefined }) as ContractEntry[];
  const groups = groupKeelContracts(filtered);
  const filtering = Boolean(query || tag || category || chainId || search.trim());
  const clear = () => { setQuery(''); setTag(''); setCategory(''); setChainId(''); };
  const rows = (list: readonly KeelContractEntry[]) => list.map((entry) => <ContractRow key={entry.key} entry={entry} selected={entry.key === selectedId} select={select} />);
  if (!entries.length) return null;
  return <div className="contract-directory">
    <div className="contract-filters">
      <input aria-label="Find a contract" placeholder="Find by name, tag, collection or address…" value={query} onChange={(event) => setQuery(event.target.value)} />
      {(chains.length > 1 || categories.length > 0) && <div className="contract-filter-row">
        {chains.length > 1 && <select aria-label="Network" value={chainId} onChange={(event) => setChainId(event.target.value)}><option value="">All networks</option>{chains.map((id) => <option key={id} value={id}>{chainLabel(id)}</option>)}</select>}
        {categories.length > 0 && <select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select>}
      </div>}
      {tags.length > 0 && <div className="tag-filter" role="group" aria-label="Filter by tag">{tags.map((item) => <button type="button" key={item} className={tag === item ? 'tag-chip selected' : 'tag-chip'} aria-pressed={tag === item} onClick={() => setTag(tag === item ? '' : item)}>#{item}</button>)}</div>}
    </div>
    {groups.map((group) => group.id === 'archived'
      ? <details className="contract-group archived" key={group.id}><summary>{group.title} <Badge>{group.entries.length}</Badge></summary><p className="small">{group.description}</p>{rows(group.entries)}</details>
      : <section className="contract-group" key={group.id} aria-label={group.title}><div className="section-line"><h2>{group.title}</h2><span>{group.entries.length}</span></div><p className="small">{group.description}</p>{rows(group.entries)}</section>)}
    {filtering && !groups.length && <p className="small contract-no-match">Nothing matches these filters. <button className="text-button" onClick={clear}>Clear filters</button></p>}
  </div>;
}

function ContractRow({ entry, selected, select }: { entry: KeelContractEntry; selected: boolean; select: (id?: string) => void }) {
  const tags = entry.tags ?? [];
  return <button className={`contract-row ${selected ? 'selected' : ''}`} onClick={() => select(entry.key)}>
    <span className="contract-icon" aria-hidden="true">{entry.pinned ? '★' : FAMILY_GLYPHS[entry.family] ?? '◇'}</span>
    <div>
      <h3>{displayName(entry)}</h3>
      <p className="contract-kind">{describeKeelContract(entry)}</p>
      <p>{chainLabel(entry.chainId)} · {shortAddress(entry.address)}{entry.category ? ` · ${entry.category}` : ''}</p>
      {tags.length > 0 && <div className="tag-line">{tags.slice(0, 4).map((item) => <span className="tag-chip" key={item}>#{item}</span>)}{tags.length > 4 && <span className="tag-chip">+{tags.length - 4}</span>}</div>}
    </div>
    {entry.collections.length > 0 && <Badge>{entry.collections.length} inside</Badge>}
  </button>;
}

/* --------------------------------------------------------------- heading */

export function ContractHeading({ contract, entry, save, action }: { contract: WorkspaceContract; entry: ContractEntry; save: Save; action: Action }) {
  const flag = (key: 'pinned' | 'archived') => void action(() => updateContract(save, contract.id, (item) => organizeContract(item, { [key]: !item.organization?.[key] })));
  return <>
    <div className="contract-title">
      <h2>{displayName(entry)}</h2>
      <div className="segmented" role="group" aria-label="Keep at hand">
        <button type="button" className={entry.pinned ? 'selected' : ''} aria-pressed={!!entry.pinned} onClick={() => flag('pinned')}>{entry.pinned ? '★ Pinned' : '☆ Pin'}</button>
        <button type="button" className={entry.archived ? 'selected' : ''} aria-pressed={!!entry.archived} onClick={() => flag('archived')}>{entry.archived ? 'Archived' : 'Archive'}</button>
      </div>
    </div>
    {entry.label && entry.label !== contract.name && <small>Recorded as “{contract.name}”</small>}
    <p className="contract-kind">{describeKeelContract(entry)}</p>
  </>;
}

/* --------------------------------------------------------------- organize */

type Draft = { label: string; category: string; tags: string; notes: string };

export function ContractOrganizer({ contract, state, save, action }: { contract: WorkspaceContract; state: Workspace['state']; save: Save; action: Action }) {
  const organization = contract.organization ?? {};
  const saved: Draft = { label: organization.label ?? '', category: organization.category ?? '', tags: (organization.tags ?? []).join(', '), notes: organization.notes ?? '' };
  const [draft, setDraft] = useState<Draft | null>(null);
  const shown = draft ?? saved;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const change = (key: keyof Draft, value: string) => setDraft({ ...shown, [key]: value });
  let tagError = '';
  try { parseTagText(shown.tags); } catch (error) { tagError = error instanceof Error ? error.message : String(error); }
  const categories = [...new Set([...state.contracts.flatMap((item) => item.organization?.category ? [item.organization.category] : []), ...CATEGORY_SUGGESTIONS])];
  const summary = [organization.category, ...(organization.tags ?? []).slice(0, 3).map((tag) => `#${tag}`)].filter(Boolean).join(' · ');
  return <details className="disclosure contract-organize">
    <summary>Name &amp; organize{summary ? <span className="summary-note"> · {summary}</span> : ''}</summary>
    <p className="small">Your name, category, tags and notes are saved in this workspace. They never change the contract or what it reports on chain.</p>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); if (!dirty || tagError) return; void action(async () => {
      await updateContract(save, contract.id, (item) => organizeContract(item, { label: shown.label, category: shown.category, tags: parseTagText(shown.tags), notes: shown.notes }));
      setDraft(null);
    }); }}>
      <Field label="Your name"><input value={shown.label} maxLength={120} placeholder={contract.name} onChange={(event) => change('label', event.target.value)} /></Field>
      <Field label="Category"><input value={shown.category} maxLength={48} list={`contract-categories-${contract.id}`} placeholder="Editions, drops, experiments…" onChange={(event) => change('category', event.target.value)} /><datalist id={`contract-categories-${contract.id}`}>{categories.map((item) => <option key={item} value={item} />)}</datalist></Field>
      <div className="wide"><Field label="Tags"><input value={shown.tags} placeholder="spring-drop, editions" aria-invalid={!!tagError} onChange={(event) => change('tags', event.target.value)} /></Field>{tagError && <p className="field-error" role="alert">{tagError}</p>}</div>
      <div className="wide"><Field label="Notes"><textarea rows={3} maxLength={4000} value={shown.notes} placeholder="What this contract is for, who to ask, what to remember" onChange={(event) => change('notes', event.target.value)} /></Field></div>
      <div className="inline-actions wide"><button className="primary" disabled={!dirty || !!tagError}>Save</button>{dirty && <button type="button" onClick={() => setDraft(null)}>Discard changes</button>}</div>
    </form>
  </details>;
}

/* --------------------------------------------------------------- collections inside */

function TokenRange({ item }: { item: KeelLogicalCollection }) {
  if (!item.tokenIds) return null;
  const { from, to } = item.tokenIds;
  return <>{item.kind === 'shared-collection' && item.externalId && <span className="range-rule">Every token whose id starts with shared collection #{item.externalId}</span>}
    <code title={`${from ?? '…'} – ${to ?? '…'}`}>{from ?? 'start'} – {to ?? 'open-ended'}</code></>;
}

const idLabel = (kind: string) => ({ 'factory-collection': 'Factory collection', 'shared-collection': 'Shared collection', drop: 'Drop', 'fray-auction': 'Auction' } as Record<string, string>)[kind] ?? 'Id';

export function LogicalCollections({ contract, entry, state, save, action }: { contract: WorkspaceContract; entry: ContractEntry; state: Workspace['state']; save: Save; action: Action }) {
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState('');
  const rename = (key: string, label: string) => action(async () => { await updateContract(save, contract.id, (item) => labelLogicalCollection(item, key, label, state.collections)); setEditing(undefined); });
  const shared = entry.family === 'shared-collection' || entry.family === 'fray-auction';
  return <section className="contract-section" aria-label="Collections inside">
    <div className="section-line"><h2>Collections inside</h2><span>{entry.collections.length}</span></div>
    <p className="small">{shared ? 'This contract holds many artists’ work. These are yours, and each one owns an exact range of token ids.' : 'Collections, drops and token ranges that live in this contract. Rename them the way you think of them.'}</p>
    {entry.collections.map((item) => <article className="logical-collection" key={item.key}>
      <div className="logical-heading">
        <div><h3>{item.label ?? (item.name || 'Unnamed collection')}</h3>{item.label && item.name && item.label !== item.name && <small>Recorded as “{item.name}”</small>}</div>
        <Badge>{COLLECTION_KIND_LABELS[item.kind] ?? item.kind}</Badge>{item.open === false && <Badge tone="warm">Closed</Badge>}{item.open === true && <Badge tone="cool">Open</Badge>}
      </div>
      <dl className="logical-facts">
        {item.externalId && <><dt>{idLabel(item.kind)}</dt><dd><code>#{item.externalId}</code></dd></>}
        {item.tokenIds && <><dt>Token ids</dt><dd><TokenRange item={item} /></dd></>}
        {item.tags?.length ? <><dt>Tags</dt><dd>{item.tags.map((tag) => `#${tag}`).join(' ')}</dd></> : null}
        <dt>Found by</dt><dd>{SOURCE_LABELS[item.source] ?? item.source}</dd>
      </dl>
      {editing === item.key
        ? <form className="inline-actions" onSubmit={(event) => { event.preventDefault(); void rename(item.key, name); }}><input aria-label={`Name for ${item.name || 'this collection'}`} value={name} maxLength={120} placeholder={item.name || 'Collection name'} autoFocus onChange={(event) => setName(event.target.value)} /><button className="primary">Save name</button><button type="button" onClick={() => setEditing(undefined)}>Cancel</button></form>
        : <div className="inline-actions">
          <button className="text-button" onClick={() => { setEditing(item.key); setName(item.label ?? ''); }}>Rename</button>
          {item.label && <button className="text-button" onClick={() => void rename(item.key, '')}>Use recorded name</button>}
          {item.source === 'manual' && <button className="text-button" onClick={() => void action(() => updateContract(save, contract.id, (current) => removeLogicalCollection(current, item.key)))}>Remove</button>}
        </div>}
    </article>)}
    {!entry.collections.length && <p className="small">Nothing is listed inside this contract yet. Find collections from your wallet above, or add a token range you manage.</p>}
    <details className="disclosure">
      <summary>Add a token range you manage</summary>
      <p className="small">Bookkeeping only: this names ids you already use. Nothing is minted, reserved or changed on chain.</p>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); void action(async () => {
        await updateContract(save, contract.id, (item) => addTokenRange(item, { name: String(data.get('name') ?? ''), from: String(data.get('from') ?? ''), to: String(data.get('to') ?? '') }));
        form.reset();
      }); }}>
        <div className="wide"><Field label="Name"><input name="name" required maxLength={120} placeholder="Spring drop" /></Field></div>
        <Field label="First token id"><input name="from" inputMode="numeric" placeholder="1" /></Field>
        <Field label="Last token id"><input name="to" inputMode="numeric" placeholder="250" /></Field>
        <div className="wide"><button className="primary">Add range</button></div>
      </form>
    </details>
  </section>;
}

/* --------------------------------------------------------------- signers */

export function SignerRecords({ contract, entry, state, save, action, reportedOwner }: { contract: WorkspaceContract; entry: ContractEntry; state: Workspace['state']; save: Save; action: Action; reportedOwner?: string }) {
  const [flow, setFlow] = useState<string>('wallet');
  const [address, setAddress] = useState('');
  const [role, setRole] = useState<string>('owner');
  const wallets = state.wallets.filter((wallet) => wallet.family === 'ethereum');
  return <section className="contract-section" aria-label="Signers and automation">
    <div className="section-line"><h2>Signers &amp; automation</h2><span>{entry.signers.length}</span></div>
    <p className="small">A record of who acts for this contract and how. KEEL never signs from this list: each flow still signs in its own place — a wallet, the signer you named, or the bridge server’s queue.</p>
    {entry.signers.map((signer) => <article className="memory-card signer-card" key={signer.id}>
      <div className="logical-heading">
        <div><h3>{signer.label}</h3><small>{SIGNER_FLOW_LABELS[signer.flow]?.label ?? signer.flow} · {SIGNER_ROLE_LABELS[signer.role] ?? signer.role}</small></div>
        <Badge tone={signer.status === 'active' ? 'cool' : signer.status === 'revoked' ? 'warm' : ''}>{STATUS_LABELS[signer.status] ?? signer.status}</Badge>
      </div>
      <p>{SIGNER_FLOW_LABELS[signer.flow]?.detail}</p>
      <dl className="logical-facts">
        {signer.address && <><dt>Address</dt><dd><code>{signer.address}</code></dd></>}
        {signer.bridge && <><dt>Bridge server</dt><dd>{signer.bridge.server}</dd><dt>Queue</dt><dd><code>{signer.bridge.queue}</code></dd>{signer.bridge.lastSeenAt && <><dt>Last seen</dt><dd>{new Date(signer.bridge.lastSeenAt).toLocaleString()}</dd></>}</>}
      </dl>
      <button onClick={() => void action(() => updateContract(save, contract.id, (item) => detachSigner(item, signer.id)))}>Remove record</button>
    </article>)}
    <details className="disclosure">
      <summary>Attach a signer record</summary>
      <div className="segmented" role="group" aria-label="How it signs">{SIGNER_FLOWS.map((item: string) => <button type="button" key={item} className={flow === item ? 'selected' : ''} aria-pressed={flow === item} onClick={() => { setFlow(item); setRole(DEFAULT_ROLE[item] ?? 'custom'); }}>{SIGNER_FLOW_LABELS[item as keyof typeof SIGNER_FLOW_LABELS].label}</button>)}</div>
      <p className="small">{SIGNER_FLOW_LABELS[flow as keyof typeof SIGNER_FLOW_LABELS].detail}</p>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); void action(async () => {
        await updateContract(save, contract.id, (item) => attachSigner(item, { label: String(data.get('label') ?? ''), role, flow, address, status: String(data.get('status') ?? 'unverified'), server: String(data.get('server') ?? ''), queue: String(data.get('queue') ?? '') }));
        form.reset(); setAddress('');
      }); }}>
        <Field label="Name"><input name="label" required maxLength={80} placeholder={flow === 'bridge' ? 'Mint relay' : flow === 'agent-grant' ? 'Release assistant' : 'Studio wallet'} /></Field>
        <Field label="Role"><select value={role} onChange={(event) => setRole(event.target.value)}>{SIGNER_ROLES.map((item: string) => <option key={item} value={item}>{SIGNER_ROLE_LABELS[item as keyof typeof SIGNER_ROLE_LABELS]}</option>)}</select></Field>
        <div className="wide"><Field label={flow === 'wallet' ? 'Wallet address' : 'Public address (optional)'}><input value={address} required={flow === 'wallet'} placeholder="0x…" list={`signer-addresses-${contract.id}`} onChange={(event) => setAddress(event.target.value)} /><datalist id={`signer-addresses-${contract.id}`}>{wallets.map((wallet) => <option key={wallet.id} value={wallet.address}>{wallet.label}</option>)}{reportedOwner && <option value={reportedOwner}>Owner the contract reports</option>}</datalist></Field>
          {reportedOwner && address.toLowerCase() !== reportedOwner.toLowerCase() && <button type="button" className="text-button" onClick={() => { setAddress(reportedOwner); setRole('owner'); }}>Use the owner this contract reports ({shortAddress(reportedOwner)})</button>}</div>
        {flow === 'bridge' && <><Field label="Bridge server"><input name="server" required maxLength={120} placeholder="relay.example.com or https://…" /></Field><Field label="Queue path"><input name="queue" required maxLength={200} placeholder="/api/bridge/jobs" /></Field></>}
        <Field label="Status as you know it"><select name="status" defaultValue="unverified">{SIGNER_STATUSES.map((item: string) => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}</select></Field>
        <div className="wide"><button className="primary">Attach record</button><p className="small">Public details only. Never paste a private key, seed phrase or API token here.</p></div>
      </form>
    </details>
  </section>;
}

/* --------------------------------------------------------------- facts */

export function ContractFacts({ facts, contract, entry, state, save, action }: { facts: KeelContractInspection; contract: WorkspaceContract; entry: ContractEntry; state: Workspace['state']; save: Save; action: Action }) {
  const observed = { ...entry, standard: facts.standard !== 'unknown' ? facts.standard : entry.standard, proxy: facts.proxy };
  const extras = [facts.interfaces.erc2981 && 'royalties (ERC-2981)', facts.interfaces.accessControl && 'roles (AccessControl)', facts.interfaces.erc721Metadata && 'token metadata'].filter(Boolean);
  const kept = contract.registry?.observedBlock === facts.blockNumber && contract.registry?.proxy?.kind === facts.proxy.kind;
  return <div className="contract-facts">
    <div className="eyebrow">WHAT THIS IS · BLOCK {facts.blockNumber}</div>
    <h3>{describeKeelContract(observed)}</h3>
    {facts.proxy.conflict && <p className="notice error" role="alert"><strong>Both proxy slots are set.</strong> This contract stores an upgradeable-proxy implementation and a beacon at the same time, which standard proxies never do. The editor refuses reads, simulations and wallet reviews for it until you have checked its code with whoever deployed it.</p>}
    <dl className="logical-facts">
      <dt>Shape</dt><dd>{PROXY_LABELS[facts.proxy.kind]}</dd>
      {facts.proxy.implementation && <><dt>{facts.proxy.kind === 'minimal-clone' ? 'Template' : 'Implementation'}</dt><dd><code>{facts.proxy.implementation}</code></dd></>}
      {facts.proxy.beacon && <><dt>Beacon</dt><dd><code>{facts.proxy.beacon}</code></dd></>}
      {facts.proxy.admin && <><dt>Proxy admin</dt><dd><code>{facts.proxy.admin}</code></dd></>}
      <dt>Standard</dt><dd>{STANDARD_LABELS[facts.standard]}{extras.length ? ` · also ${extras.join(', ')}` : ''}</dd>
      {(facts.name || facts.symbol) && <><dt>Reports its name as</dt><dd>{facts.name ?? '—'}{facts.symbol ? ` (${facts.symbol})` : ''}</dd></>}
      {facts.owner && <><dt>Reported owner</dt><dd><code>{facts.owner}</code></dd></>}
      <dt>Code</dt><dd>{facts.codeSize.toLocaleString()} bytes</dd>
    </dl>
    <p className="small">This is what the contract reports at this block. A reported owner is not proof of who controls it.</p>
    <button disabled={kept} onClick={() => void action(() => updateContract(save, contract.id, (item) => rememberInspection(item, facts, state.collections)))}>{kept ? 'Kept with this record' : 'Keep these facts with the record'}</button>
  </div>;
}
