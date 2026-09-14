import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatEther } from 'viem';
import { api, queryClient } from './client';
import { Badge, Field } from './ui';
import { TezosWalletHub } from './tezos-wallet-ui';

const refresh = () => queryClient.invalidateQueries({ queryKey: ['wallet-extensions'] });
export const useWallets = () => useQuery({ queryKey: ['wallet-extensions'], queryFn: () => api('walletExtensions'), refetchInterval: 4000 });
function useWalletAction() {
  const [pending, setPending] = useState(''); const [error, setError] = useState(''); const lock = useRef(false);
  const run = async (label: string, action: () => Promise<unknown>) => {
    if (lock.current) return; lock.current = true; setError(''); setPending(label);
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { lock.current = false; setPending(''); await refresh(); }
  };
  return { pending, error, run };
}

export function WalletHub() {
  const wallets = useWallets();
  const [tezosInstallation, setTezosInstallation] = useState<string>();
  return <section className="wallet-hub">
    <div className="page-heading compact"><div><h1>Your wallets.</h1><p>Connect accounts, choose a network, and approve your work without leaving KEEL.</p></div><Badge>KEYS STAY IN YOUR WALLET</Badge></div>
    <h2>Ethereum &amp; EVM wallets</h2>
    {wallets.data?.installed.map((wallet: any) => <ConnectedWallet key={wallet.installationId} wallet={wallet} />)}
    <WalletInstaller family="ethereum" />
    <TezosWalletHub installed={wallets.data?.installed ?? []} preferredInstallationId={tezosInstallation} installer={<WalletInstaller family="tezos" onInstalled={setTezosInstallation} />} />
    <WalletActivity />
  </section>;
}

function WalletInstaller({ family, onInstalled }: { family: 'ethereum' | 'tezos'; onInstalled?: (id: string) => void }) {
  const wallets = useWallets(); const operation = useWalletAction();
  const [review, setReview] = useState<any>(); const [accepted, setAccepted] = useState(false);
  useEffect(() => () => { if (review?.token) void api('discardWalletExtension', review.token).catch(() => {}); }, [review?.token]);
  return <div className="wallet-installer">
    <div className="wallet-install-card"><div><h3>{family === 'tezos' ? 'Install a Tezos extension' : 'Install an EVM extension'}</h3><p>Install a wallet here, then create or restore your accounts in its own window.</p></div>
      {wallets.data?.downloads.filter((wallet: any) => wallet.families.includes(family)).map((wallet: any) => <button className="primary" key={wallet.id} disabled={!!operation.pending || !!review} onClick={() => void operation.run('Downloading the official wallet…', async () => { setAccepted(false); setReview(await api('downloadWallet', wallet.id)); })}>Add {wallet.name} <small>{wallet.version}</small></button>)}
    </div>
    <details className="extension-lab"><summary>{family === 'tezos' ? 'Import another Tezos extension' : 'Import another wallet extension'}</summary><p>Import an unpacked extension folder. Then open it to finish setup and choose it in the wallet connection list.</p><button disabled={!!operation.pending || !!review} onClick={() => void operation.run('Reading extension…', async () => { setAccepted(false); setReview(await api('reviewWalletExtension')); })}>Choose extension folder</button></details>
    {review && <div className="wallet-review notice"><h2>Install {review.name}?</h2><p>Version {review.version} · {(review.bytes / 1024 / 1024).toFixed(1)} MB · separate, persistent wallet profile</p>
      {review.officialRelease && <p>Official wallet release · download fingerprint verified</p>}
      <p>The wallet can contact its network services and connect to KEEL’s wallet page. Its extension cannot read your artwork previews or editor files.</p>
      <details><summary>Requested extension access</summary>{[['Permissions', review.permissions], ['Website access', review.hostPermissions], ['Content scripts', review.contentScriptMatches], ['Optional access', review.optionalPermissions]].map(([title, values]) => <p key={title as string}><strong>{title as string}</strong><br />{(values as string[]).join(', ') || 'None'}</p>)}<code className="permission-list">{review.digest}</code></details>
      <label className="check"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />I trust this wallet and its requested access.</label>
      <div className="button-row"><button className="primary" disabled={!accepted || !!operation.pending} onClick={() => void operation.run('Installing wallet…', async () => { await api('installWalletExtension', { token: review.token, digest: review.digest, permissionsReviewed: true }); const id = review.token; setReview(undefined); await api('openWalletExtension', id); onInstalled?.(id); })}>Install & open wallet</button><button disabled={!!operation.pending} onClick={() => setReview(undefined)}>Cancel install</button></div>
    </div>}
    {operation.pending && <p role="status">{operation.pending}</p>}{(operation.error || wallets.error) && <p role="alert" className="notice error">{operation.error || wallets.error?.message}</p>}
  </div>;
}

function ConnectedWallet({ wallet }: { wallet: any }) {
  const operation = useWalletAction(); const [account, setAccount] = useState(''); const [providers, setProviders] = useState<any[]>(); const [proof, setProof] = useState<any>();
  const [balance, setBalance] = useState<any>(); const [chain, setChain] = useState(''); const [profileId, setProfileId] = useState(''); const [symbol, setSymbol] = useState('ETH');
  const networks = useQuery({ queryKey: ['network-profiles'], queryFn: () => api('networkProfiles') });
  const connection = wallet.connection;
  const selected = connection?.accounts.includes(account) ? account : connection?.accounts[0] ?? '';
  const checked = { id: wallet.installationId, account: selected, chainId: connection?.chainId };
  useEffect(() => { setBalance(undefined); setProof(undefined); }, [selected, connection?.chainId]);
  const connect = (providerId?: string) => operation.run('Approve the connection in your wallet.', async () => { const result = await api('connectWallet', { id: wallet.installationId, ...(providerId ? { providerId } : {}) }); setProviders(result.providers); });
  return <article className="connected-wallet">
    <div className="section-line"><div><h2>{wallet.name}</h2><small>{wallet.version}</small></div><Badge tone={connection ? 'cool' : undefined}>{connection ? 'Connected' : wallet.loaded ? 'Ready to connect' : wallet.enabled ? 'Needs attention' : 'Disabled'}</Badge></div>
    {wallet.error && <p className="notice error">{wallet.error}</p>}
    {connection && <><div className="wallet-account-grid"><Field label="Account shared with KEEL"><select value={selected} onChange={event => setAccount(event.target.value)}>{connection.accounts.map((value: string, index: number) => <option key={value} value={value}>Account {index + 1} · {value}</option>)}</select></Field><div><span className="field-label">Network</span><p>{networks.data?.find((network: any) => String(network.chainIdentity) === String(connection.chainId))?.label ?? `EVM chain ${connection.chainId}`}</p></div></div>
      <div className="button-row"><button disabled={!!operation.pending || wallet.pending} onClick={() => void operation.run('Reading balance…', async () => setBalance({ ...checked, value: formatEther(BigInt(await api('walletBalance', checked))) }))}>Show balance</button><button disabled={!!operation.pending || wallet.pending} onClick={() => void operation.run('Approve the connection check in your wallet. No gas is charged.', async () => setProof(await api('verifyWalletConnection', checked)))}>Check signing connection</button><button disabled={!!operation.pending || wallet.pending} onClick={() => void operation.run('Disconnecting…', () => api('disconnectWallet', wallet.installationId))}>Disconnect</button></div>
      {balance && balance.account === selected && balance.chainId === connection.chainId && <p>{balance.value} native tokens · selected network</p>}{proof && proof.account === selected && proof.chainId === connection.chainId && <p className="success-text">Signature verified for this account · {new Date(proof.checkedAt).toLocaleTimeString()}</p>}
      <details><summary>Choose a different network</summary><p>The wallet asks you to approve a network change. Choose the same chain as the project or contract you are using.</p><form className="inline-actions" onSubmit={event => { event.preventDefault(); void operation.run('Approve the network change in your wallet.', () => api('switchWalletNetwork', { id: wallet.installationId, chainId: Number(chain) })); }}><Field label="EVM chain ID"><input type="number" min="1" required value={chain} onChange={event => setChain(event.target.value)} placeholder="1, 8453, 11155111…" /></Field><button disabled={!!operation.pending || wallet.pending}>Switch network</button></form>
        <form className="inline-actions" onSubmit={event => { event.preventDefault(); void operation.run('Review the saved network in your wallet.', () => api('addWalletNetwork', { id: wallet.installationId, profileId, symbol })); }}><Field label="Add a saved project network"><select required value={profileId} onChange={event => setProfileId(event.target.value)}><option value="">Choose network…</option>{networks.data?.filter((network: any) => network.family === 'ethereum').map((network: any) => <option key={network.id} value={network.id}>{network.label} · {network.chainIdentity}</option>)}</select></Field><Field label="Native token symbol"><input value={symbol} required maxLength={11} onChange={event => setSymbol(event.target.value)} /></Field><button disabled={!!operation.pending || wallet.pending}>Add to wallet</button></form>
      </details>
    </>}
    <div className="button-row"><button disabled={!wallet.loaded} onClick={() => void operation.run('Opening wallet…', () => api('openWalletExtension', wallet.installationId))}>Open wallet</button>{!connection && <button className="primary" disabled={!wallet.loaded || !!operation.pending || wallet.pending} onClick={() => void connect()}>Connect wallet</button>}<details><summary>Manage installation</summary><p>Disabling preserves this wallet’s saved profile and recovery data.</p><button disabled={!!operation.pending || wallet.pending} onClick={() => void operation.run('Updating wallet…', () => api('enableWalletExtension', { id: wallet.installationId, enabled: !wallet.enabled }))}>{wallet.enabled ? 'Disable' : 'Enable'}</button></details></div>
    {providers?.map(provider => <button key={provider.id} onClick={() => void connect(provider.id)}>{provider.name}</button>)}
    {(operation.pending || wallet.pending) && <p role="status" className="notice">{operation.pending || 'A request is waiting in your wallet.'} You can reject the request there.</p>}{operation.error && <p role="alert" className="notice error">{operation.error}</p>}
  </article>;
}

export function WalletWrite({ contract, prepareInput, rpcUrl }: { contract: any; prepareInput: () => any; rpcUrl: string }) {
  const wallets = useWallets(); const operation = useWalletAction(); const [selection, setSelection] = useState(''); const [review, setReview] = useState<any>(); const mounted = useRef(true);
  const available = (wallets.data?.installed ?? []).flatMap((wallet: any) => (wallet.connection?.accounts ?? []).map((account: string) => ({ value: `${wallet.installationId}:${account}`, wallet, account })));
  const selected = available.find((choice: any) => choice.value === selection);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { if (review?.status === 'review') void api('cancelWalletTransaction', review.id).catch(() => {}); }, [review?.id]);
  return <div className="wallet-write"><h3>Use your wallet</h3>{!available.length ? <p>Open Wallets in the sidebar, then install or connect a wallet to approve this contract action.</p> : <>
    <Field label="Wallet account"><select value={selection} disabled={!!operation.pending} onChange={event => { if (review) void api('cancelWalletTransaction', review.id); setSelection(event.target.value); setReview(undefined); }}><option value="">Choose account…</option>{available.map((choice: any) => <option key={choice.value} value={choice.value}>{choice.wallet.name} · {choice.account}</option>)}</select></Field>
    {selected && selected.wallet.connection.chainId !== contract.chainId && <p className="notice">Select chain {contract.chainId} in your wallet before reviewing this action.</p>}
    {!review && <button className="primary" disabled={!selected || !rpcUrl || !!operation.pending || selected.wallet.pending || selected.wallet.connection.chainId !== contract.chainId} onClick={() => void operation.run('Checking the contract, simulating, and estimating gas…', async () => { const result = await api('prepareWalletTransaction', { ...prepareInput(), rpcUrl, installationId: selected.wallet.installationId, account: selected.account }); if (mounted.current) setReview(result); else await api('cancelWalletTransaction', result.id); })}>Review in wallet</button>}
    {review && <div className="wallet-call-review"><Badge>{review.status.replaceAll('-', ' ')}</Badge><h4>{review.signature}</h4><p>Chain {review.chainId} · {review.contract.name}</p><code>{review.to}</code><p>Value: {formatEther(BigInt(review.valueWei))} native tokens<br />Estimated network fee: {formatEther(BigInt(review.estimatedFeeWei))} native tokens</p><small>The wallet shows the final fee before you approve.</small><details><summary>Exact transaction and simulation</summary><pre>{JSON.stringify({ from: review.account, to: review.to, chainId: review.chainId, valueWei: review.valueWei, data: review.data, gas: review.gas, evidence: review.evidence }, null, 2)}</pre></details>
      {review.status === 'review' && <div className="button-row"><button className="primary" disabled={!!operation.pending} onClick={() => void operation.run('Approve or reject this exact transaction in your wallet.', async () => { try { setReview(await api('sendWalletTransaction', { id: review.id, reviewed: true })); } finally { await queryClient.invalidateQueries({ queryKey: ['wallet-activity'] }); const activity = await api('walletTransactions'); const current = activity.find((item: any) => item.id === review.id); if (current) setReview(current); } })}>Continue to wallet approval</button><button disabled={!!operation.pending} onClick={() => { void api('cancelWalletTransaction', review.id); setReview(undefined); }}>Cancel review</button></div>}
      {review.hash && <><code>{review.hash}</code><button disabled={!!operation.pending} onClick={() => void operation.run('Checking receipt…', async () => setReview(await api('walletReceipt', review.id)))}>Check transaction</button></>}{review.message && <p>{review.message}</p>}
    </div>}
  </>}{operation.pending && <p role="status">{operation.pending}</p>}{operation.error && <p className="notice error" role="alert">{operation.error}</p>}</div>;
}

function WalletActivity() {
  const activity = useQuery({ queryKey: ['wallet-activity'], queryFn: () => api('walletTransactions'), refetchInterval: 5000 }); const operation = useWalletAction();
  const records = activity.data?.filter((record: any) => !['review', 'cancelled', 'expired'].includes(record.status));
  if (!records?.length) return null;
  return <section className="wallet-activity"><div className="section-line"><h2>Wallet activity</h2><small>Saved on this computer</small></div>{records.map((record: any) => <article key={record.id}><Badge>{record.status.replaceAll('-', ' ')}</Badge><h3>{record.contract.name} · {record.signature}</h3><p>Chain {record.chainId} · {new Date(record.createdAt).toLocaleString()}</p>{record.hash && <code>{record.hash}</code>}{record.message && <p>{record.message}</p>}{record.receipt && <p>Read back at block {record.receipt.blockNumber} · {new Date(record.receipt.checkedAt).toLocaleTimeString()}</p>}{record.hash && <button disabled={!!operation.pending} onClick={() => void operation.run('Checking transaction…', async () => { await api('walletReceipt', record.id); await activity.refetch(); })}>Refresh receipt</button>}</article>)}{operation.error && <p className="notice error">{operation.error}</p>}</section>;
}
