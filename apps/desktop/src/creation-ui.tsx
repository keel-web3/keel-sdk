import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Project, Shared, Workspace } from './types';
import { api, queryClient } from './client';
import { Field, Badge } from './ui';
import { CREATION_TEMPLATES, collectionChoices, mergeDiscoveredCollections } from './creation-workflow.mjs';
import { changeIntent } from './artist-workflow.mjs';

export function TemplatePicker({ create, disabled }: { create: (id: string, title: string) => void; disabled: boolean }) {
  return <section className="template-launcher" aria-label="Start from a template"><div className="section-line"><h2>What would you like to make?</h2><span>Choose a starting point</span></div><div className="template-grid">{CREATION_TEMPLATES.map(item => <button className="template-card" key={item.id} disabled={disabled} onClick={() => create(item.id, item.name)}><div className={`template-visual template-${item.id}`} aria-hidden="true"><i /><i /><i /></div><div><strong>{item.title}</strong><p>{item.description}</p><span>Start creating ↗</span></div></button>)}</div></section>;
}

export function CreationNetwork({ project, action, select, advanced }: { project: Project; action: Shared['action']; select: (id: string, snapshot: any) => Promise<void>; advanced: React.ReactNode }) {
  const profiles = useQuery<any[]>({ queryKey: ['network-profiles'], queryFn: () => api('networkProfiles') });
  const presets = useQuery<any[]>({ queryKey: ['network-presets'], queryFn: () => api('networkPresets') });
  const [loading, setLoading] = useState(false);
  const live = useQuery({ queryKey: ['live-network', project.targetNetworkId], queryFn: () => api('liveNetwork', project.targetNetworkId), enabled: !!project.targetNetworkId, refetchInterval: 20_000, staleTime: 15_000 });
  async function choose(value: string) {
    if (!value) return;
    setLoading(true);
    try {
      if (value.startsWith('preset:')) {
        const preset = presets.data?.find(item => item.id === value.slice(7));
        if (!preset) return;
        const { id, testnet, ...input } = preset;
        const result = await api('connectNetwork', input);
        await queryClient.invalidateQueries({ queryKey: ['network-profiles'] });
        await select(result.id, result.snapshot);
        queryClient.setQueryData(['live-network', result.id], result.snapshot);
      } else {
        const snapshot = await api('liveNetwork', value);
        await select(value, snapshot); queryClient.setQueryData(['live-network', value], snapshot);
      }
    } finally { setLoading(false); }
  }
  return <section className="creation-network"><Field label="Where will your collection live?"><select disabled={loading} value={project.targetNetworkId ?? ''} onChange={event => void action(() => choose(event.target.value))}><option value="">Choose a network…</option>{!!profiles.data?.length && <optgroup label="Your saved networks">{profiles.data.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</optgroup>}<optgroup label="Networks">{presets.data?.filter(item => !item.testnet).map(item => <option key={item.id} value={`preset:${item.id}`}>{item.label}</option>)}</optgroup><optgroup label="Test networks · practice first">{presets.data?.filter(item => item.testnet).map(item => <option key={item.id} value={`preset:${item.id}`}>{item.label} · test</option>)}</optgroup></select></Field>
    <p className="creation-hint" role="status">{loading ? 'Checking the network…' : live.error ? 'This network is unavailable. Retry or choose another connection to the same network.' : live.data ? `Connected · ${new Date(live.data.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. The wallet will show the final cost before you sign.` : project.intent.chainId || project.intent.network ? 'Your planned network is saved. Connect it here to find collections and check live costs.' : 'Choose where to publish. You can create and save your artwork before connecting.'}</p>
    {(profiles.error || presets.error) && <p role="alert">Network choices could not load. <button onClick={() => { void profiles.refetch(); void presets.refetch(); }}>Try again</button></p>}
    <details className="disclosure"><summary>Custom network & live costs</summary>{advanced}</details>
  </section>;
}

export function CollectionPicker({ project, state, change, action, persist, openContracts }: { project: Project; state: Workspace['state']; change: (patch: Partial<Project>) => void; action: Shared['action']; persist: () => Promise<any>; openContracts: (id?: string) => void }) {
  const [address, setAddress] = useState(''); const [search, setSearch] = useState(''); const [discovering, setDiscovering] = useState(false);
  const [discovery, setDiscovery] = useState<{ key: string; message: string; errors: string[] }>();
  const wallets = useQuery({ queryKey: ['wallet-extensions'], queryFn: () => api('walletExtensions') });
  const identity = `${project.intent.family}:${project.intent.chainId}:${project.targetNetworkId}`;
  const known = collectionChoices(state, project.intent);
  const filtered = known.filter((item: any) => `${item.name} ${item.contract.address}`.toLowerCase().includes(search.toLowerCase()));
  const candidates = new Map<string, string>();
  for (const record of wallets.data?.installed ?? []) if (record.connection?.chainId === project.intent.chainId) for (const account of record.connection.accounts) candidates.set(account, record.name ?? 'Connected wallet');
  for (const wallet of state.wallets) if (wallet.family === 'ethereum' && !candidates.has(wallet.address)) candidates.set(wallet.address, `${wallet.label} · saved address`);
  const creator = address || (candidates.size === 1 ? [...candidates.keys()][0] : '');
  async function discover() {
    setDiscovering(true); const key = identity;
    try {
      await persist();
      const result = await api('discoverProjectCollections', { profileId: project.targetNetworkId, creator });
      const current = queryClient.getQueryData<Workspace>(['workspace'])!;
      const next = await api('save', { state: mergeDiscoveredCollections(current.state, result.results), revision: current.revision });
      queryClient.setQueryData(['workspace'], next);
      const count = result.results.reduce((total: number, item: any) => total + item.records.length, 0);
      setDiscovery({ key, message: result.factories ? `${count} ${count === 1 ? 'collection' : 'collections'} found for this address.${result.truncated ? 'Checked the first eight factories; use Contracts for further discovery.' : ''}` : 'No KEEL factory is recorded here yet. You can still select a saved collection or add its address in More options.', errors: result.errors });
    } finally { setDiscovering(false); }
  }
  function choose(item: any) {
    change({ intent: { ...project.intent, collection: item.record?.deployment === 'external' ? 'external' : 'existing', collectionAddress: item.contract.address },
      contractIds: [...new Set([...project.contractIds, item.contract.id])],
      ...(project.creation ? { creation: { ...project.creation, selectedCollectionId: item.id } } : {}),
    });
  }
  const newCollection = !['existing', 'external'].includes(project.intent.collection ?? '');
  return <section className="collection-picker"><div className="section-line"><h3>Your collection</h3>{!!known.length && <span>{known.length} on this network</span>}</div>
    {project.intent.family === 'tezos' ? <p className="notice">Your Tezos choice is saved. Collection preparation needs a Tezos adapter; this editor’s EVM collection tools cannot create it. Keep creating here and use the assistant to prepare the supported Tezos workflow.</p> : <>
      <div className="collection-options"><button className={`collection-option ${newCollection ? 'selected' : ''}`} aria-pressed={newCollection} onClick={() => change({ intent: changeIntent(project.intent, 'collection', ['limited-edition', 'open-edition'].includes(project.intent.releaseType ?? '') ? 'erc1155' : 'erc721a'), ...(project.creation ? { creation: { ...project.creation, selectedCollectionId: undefined } } : {}) })}><span className="collection-symbol">＋</span><span><strong>Create a new collection</strong><small>Your own space for this work and future releases.</small></span></button>
        {known.length > 4 && <input aria-label="Find a saved collection" placeholder="Find a saved collection…" value={search} onChange={event => setSearch(event.target.value)} />}
        {filtered.map((item: any) => { const selected = !newCollection && (project.creation?.selectedCollectionId ? project.creation.selectedCollectionId === item.id : project.intent.collectionAddress?.toLowerCase() === item.contract.address.toLowerCase()); return <button key={item.id} className={`collection-option ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => choose(item)}><span className="collection-symbol">▧</span><span><strong>{item.name}</strong><small>Saved collection{item.record?.deployment === 'shared' ? ` · group ${item.record.sharedCollectionId}` : ''} · {item.contract.address.slice(0, 6)}…{item.contract.address.slice(-4)}</small></span><span aria-hidden="true">{selected ? '✓' : '→'}</span></button>; })}
      </div>
      {newCollection && project.creation && <Field label="Collection name"><input maxLength={160} value={project.creation.collectionName} placeholder="e.g. Studies in colour" onChange={event => change({ creation: { ...project.creation!, collectionName: event.target.value } })} /></Field>}
      {!newCollection && <p className="creation-hint">{project.intent.collectionAddress ? 'Collection selected. We’ll still need to check your permission to publish into it.' : 'Choose a collection above, find it below, or add its address in More options.'}</p>}
      <details className="disclosure find-collections"><summary>Find collections from my wallet</summary><p>Look up collections created through KEEL on this network.</p><Field label="Creator wallet"><input list={`creator-addresses-${project.id}`} placeholder="Choose a connected wallet or enter an address" value={creator} onChange={event => setAddress(event.target.value)} /><datalist id={`creator-addresses-${project.id}`}>{[...candidates].map(([value, name]) => <option key={value} value={value}>{name}</option>)}</datalist></Field><button disabled={discovering || !project.targetNetworkId || !/^0x[\da-fA-F]{40}$/.test(creator)} onClick={() => void action(discover)}>{discovering ? 'Finding collections…' : 'Find my collections'}</button>{!project.targetNetworkId && <p>Connect the selected network above to search.</p>}{discovery?.key === identity && <div role="status"><p>{discovery.message}</p>{discovery.errors.length > 0 && <details><summary>Some factories could not be checked</summary>{discovery.errors.map((error, index) => <p key={index}>{error}</p>)}</details>}</div>}</details>
    </>}
    <button className="text-button" onClick={() => openContracts()}>Manage contracts & permissions ↗</button>
  </section>;
}
