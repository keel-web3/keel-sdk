import React, { useState } from 'react';
import {
  CREATOR_TOKEN_VALIDATORS, KNOWN_TRANSFER_OPERATORS, OPENSEA_DEFAULT_FILTER_SUBSCRIPTION, V3_SECURITY_LEVELS, V5_RULESETS,
  prepareKeelTransferRuleChange, type KeelOperatorEntry, type KeelTransferRuleChange, type KeelTransferRules,
} from '@keel/sdk/transfer-rules';
import { Badge, Field } from './ui';
import { api } from './client';
import { WalletWrite } from './wallet-ui';
import { useLatestResult } from './use-latest-result';
import { parseAccountList, transferRuleControl } from './transfer-rules-control.mjs';
import type { Shared, Workspace, WorkspaceContract } from './types';
import { isNetworkUnavailable } from './network-errors.mjs';

/** Shown in place of an error dump when an RPC doesn't answer; nothing from the failed read is kept. */
export function NetworkRetry({ what, retry }: { what: string; retry: () => void }) {
  return <div className="notice network-retry" role="status"><strong>Couldn’t reach the network.</strong><p>The RPC didn’t answer, timed out or is limiting requests, so {what} couldn’t be read. Nothing was changed. Check the RPC address or try again in a moment.</p><button onClick={retry}>Try again</button></div>;
}

/** Runs a read; a network failure becomes inline retry state instead of an error message. */
export async function readOrOffline(read: () => Promise<unknown>, offline: (value: boolean) => void) {
  offline(false);
  try { await read(); } catch (error) { if (isNetworkUnavailable(error)) { offline(true); return; } throw error; }
}

// Who may trade a collection's tokens: the creator-token (ERC721-C) validator's
// policy and lists, and the older operator filter registry. Read with the
// shared SDK at one block; every change is an exact call that goes through the
// editor's unsigned review, a simulation, and the wallet's own approval.

type Rules = KeelTransferRules & { chainId: number; blockNumber: string; summary: string };
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const KNOWN = Object.entries(KNOWN_TRANSFER_OPERATORS);

function Operators({ title, entries, empty }: { title: string; entries: readonly KeelOperatorEntry[]; empty: string }) {
  return <div className="rule-list"><span className="small">{title} · {entries.length}</span>
    {entries.length ? <div className="tag-line">{entries.map((entry) => <span key={entry.address} className="tag-chip" title={entry.address}>{entry.name ?? short(entry.address)}</span>)}</div> : <small>{empty}</small>}
  </div>;
}

export function TradingRules({ contract, name, rpc, state, action }: { contract: WorkspaceContract; name: string; rpc: string; state: Workspace['state']; action: Shared['action'] }) {
  const rules = useLatestResult<Rules>();
  const [change, setChange] = useState<KeelTransferRuleChange>();
  const [accountsText, setAccountsText] = useState('');
  const [listName, setListName] = useState('');
  const [otherList, setOtherList] = useState('');
  const [offline, setOffline] = useState(false);
  const check = () => void action(async () => { setChange(undefined); await readOrOffline(() => rules.load(() => api('contractTransferRules', { contract, rpcUrl: rpc })), setOffline); });
  const data = rules.data;
  const token = data?.creatorToken;
  const parsed = parseAccountList(accountsText);
  const single = parsed.accounts.length === 1 ? parsed.accounts[0] : undefined;
  const version = token?.status === 'validated' && token.version !== 'custom' ? token.version : undefined;
  const validator = token?.status === 'validated' ? token.validator : undefined;
  const listId = token?.status === 'validated' && token.policy ? token.policy.listId : '0';
  const address = contract.address;
  return <details className="disclosure trading-rules">
    <summary>Trading rules{data ? <span className="summary-note"> · {data.summary}</span> : ''}</summary>
    <p className="small">Which marketplaces may trade this collection’s tokens. Read from the chain at one block. Every change is an exact transaction you review, simulate and approve in your wallet; nothing is sent for you.</p>
    <div className="inline-actions"><button disabled={!rpc} onClick={check}>{data ? 'Check again' : 'Check trading rules'}</button>{!rpc && <small>Enter an RPC for this chain above first.</small>}{data && <Badge>Block {data.blockNumber}</Badge>}</div>
    {offline && <NetworkRetry what="the trading rules" retry={check} />}
    {data && token && <>
      <section className="rule-section" aria-label="Creator token rules">
        <h3>Creator token rules (ERC721-C)</h3>
        {token.status === 'not-creator-token' && <p className="small">This contract doesn’t support creator-token rules, so any marketplace can trade it and royalties depend on each marketplace. Collections built on Limit Break’s ERC721-C let you choose which marketplaces may trade them.</p>}
        {token.status === 'no-validator' && <>
          <p className="small">This is a creator token, but no validator is set, so transfers aren’t restricted. Choose Limit Break’s validator to start enforcing rules.</p>
          <div className="inline-actions"><button onClick={() => setChange({ kind: 'set-validator', collection: address, validator: CREATOR_TOKEN_VALIDATORS.v5 })}>Use validator v5 (latest)</button><button onClick={() => setChange({ kind: 'set-validator', collection: address, validator: CREATOR_TOKEN_VALIDATORS.v3 })}>Use validator v3</button></div>
        </>}
        {token.status === 'validated' && <>
          <div className="badge-row"><Badge tone="cool">Validator {token.version === 'custom' ? 'custom' : token.version}</Badge><Badge>{short(token.validator)}</Badge>{token.policy && <Badge tone="cool">{token.policy.title}</Badge>}{token.policy && <Badge>List #{token.policy.listId}</Badge>}</div>
          {token.policy?.detail && <p className="small">{token.policy.detail}</p>}
          {token.version === 'custom' && <p className="small">This validator isn’t one KEEL recognizes, so its policy can’t be described or changed here.</p>}
          <Operators title="Blocked marketplaces" entries={token.blocked} empty="None blocked." />
          <Operators title="Allowed marketplaces" entries={token.allowed} empty="None listed." />
          {token.authorizers.length > 0 && <Operators title="Authorizers" entries={token.authorizers} empty="" />}
          {token.frozen.length > 0 && <div className="rule-list"><span className="small">Frozen accounts · {token.frozen.length}</span><div className="tag-line">{token.frozen.map((item) => <span key={item} className="tag-chip" title={item}>{short(item)}</span>)}</div></div>}
          {version && validator && <details className="disclosure">
            <summary>Change these rules</summary>
            <Field label="Trading rule">{version === 'v3'
              ? <select value={change?.kind === 'v3-set-level' ? change.level : ''} onChange={(event) => setChange({ kind: 'v3-set-level', validator, collection: address, level: Number(event.target.value) })}><option value="" disabled>Choose…</option>{V3_SECURITY_LEVELS.map((level) => <option key={level.level} value={level.level}>{level.title}</option>)}</select>
              : <select value={change?.kind === 'v5-set-ruleset' ? change.rulesetId : ''} onChange={(event) => setChange({ kind: 'v5-set-ruleset', validator, collection: address, rulesetId: Number(event.target.value) })}><option value="" disabled>Choose…</option>{Object.entries(V5_RULESETS).filter(([id]) => id !== '255').map(([id, ruleset]) => <option key={id} value={id}>{ruleset.title}</option>)}</select>}
            </Field>
            <Field label={`Edit list #${listId}: addresses, one per line or comma separated`}><textarea rows={3} value={accountsText} placeholder="0x…" onChange={(event) => setAccountsText(event.target.value)} /></Field>
            {parsed.invalid.length > 0 && <p className="field-error">Not addresses: {parsed.invalid.slice(0, 3).join(', ')}</p>}
            <div className="tag-line known-operators"><span className="small">Known marketplaces:</span>{KNOWN.map(([known, label]) => <button key={known} type="button" className="tag-chip" onClick={() => setAccountsText((text) => text.toLowerCase().includes(known) ? text : `${text}${text ? '\n' : ''}${known}`)}>{label}</button>)}</div>
            <div className="inline-actions">{(['blocked', 'allowed'] as const).flatMap((list) => (['add', 'remove'] as const).map((verb) => <button key={`${list}-${verb}`} disabled={!parsed.accounts.length || listId === '0'} onClick={() => setChange({ kind: 'list-accounts', version, validator, listId, list, action: verb, accounts: parsed.accounts })}>{verb === 'add' ? 'Add to' : 'Remove from'} {list}</button>))}
              <button disabled={!parsed.accounts.length} onClick={() => setChange({ kind: 'freeze-accounts', version, validator, collection: address, action: 'freeze', accounts: parsed.accounts })}>Freeze</button>
              <button disabled={!parsed.accounts.length} onClick={() => setChange({ kind: 'freeze-accounts', version, validator, collection: address, action: 'unfreeze', accounts: parsed.accounts })}>Unfreeze</button></div>
            {listId === '0' && <p className="small">List #0 is Limit Break’s default list and only Limit Break can edit it. Create your own list (it can start as a copy), then use it.</p>}
            <div className="form-grid">
              <Field label="New list name"><input value={listName} maxLength={64} placeholder="My marketplaces" onChange={(event) => setListName(event.target.value)} /></Field>
              <div className="inline-actions rule-actions"><button disabled={!listName.trim()} onClick={() => setChange({ kind: 'create-list', version, validator, name: listName, copyFrom: listId })}>Create as a copy of #{listId}</button><button disabled={!listName.trim()} onClick={() => setChange({ kind: 'create-list', version, validator, name: listName })}>Create empty</button></div>
              <Field label="Use a different list (id)"><input value={otherList} inputMode="numeric" placeholder="List id" onChange={(event) => setOtherList(event.target.value.trim())} /></Field>
              <div className="inline-actions rule-actions"><button disabled={!/^\d{1,20}$/u.test(otherList)} onClick={() => setChange({ kind: 'apply-list', version, validator, collection: address, listId: otherList })}>Use list #{otherList || '…'}</button></div>
            </div>
          </details>}
        </>}
      </section>
      <section className="rule-section" aria-label="Operator filter">
        <h3>Operator filter registry</h3>
        {data.operatorFilter.status === 'unavailable' && <p className="small">The registry isn’t reachable on this network.</p>}
        {data.operatorFilter.status === 'not-registered' && <p className="small">Not registered. This older system (from OpenSea, retired in 2023) only matters if your contract checks it.</p>}
        {data.operatorFilter.status === 'registered' && <>
          <p className="small">{data.operatorFilter.subscribedToOpenSeaDefault ? 'Follows OpenSea’s default list.' : data.operatorFilter.subscription ? `Follows the list of ${short(data.operatorFilter.subscription)}.` : 'Uses its own list.'}</p>
          <Operators title="Filtered marketplaces" entries={data.operatorFilter.filtered} empty="Nothing filtered." />
          <div className="inline-actions">
            {data.operatorFilter.subscription
              ? <button onClick={() => setChange({ kind: 'operator-filter-subscription', collection: address, copyExistingEntries: true })}>Stop following (keep a copy)</button>
              : <button onClick={() => setChange({ kind: 'operator-filter-subscription', collection: address, subscription: OPENSEA_DEFAULT_FILTER_SUBSCRIPTION })}>Follow OpenSea’s list</button>}
            {single && <><button onClick={() => setChange({ kind: 'operator-filter', collection: address, operator: single, filtered: true })}>Filter {short(single)}</button><button onClick={() => setChange({ kind: 'operator-filter', collection: address, operator: single, filtered: false })}>Unfilter {short(single)}</button></>}
          </div>
          {!single && <p className="small">To filter one marketplace, put its single address in the list box above.</p>}
        </>}
      </section>
    </>}
    {change && <RuleChangeReview key={JSON.stringify(change)} change={change} contract={contract} name={name} rpc={rpc} state={state} action={action} done={() => setChange(undefined)} />}
  </details>;
}

/**
 * One change, routed through the editor's existing flow: the exact call is
 * shown, it must simulate from a chosen account at a pinned block, and only
 * then can it go to the wallet, where the creator approves or rejects it.
 */
function RuleChangeReview({ change, contract, name, rpc, state, action, done }: { change: KeelTransferRuleChange; contract: WorkspaceContract; name: string; rpc: string; state: Workspace['state']; action: Shared['action']; done: () => void }) {
  const [account, setAccount] = useState('');
  const simulation = useLatestResult();
  let control: ReturnType<typeof transferRuleControl> | undefined;
  let problem = '';
  try { control = transferRuleControl(prepareKeelTransferRuleChange(change), { chainId: contract.chainId, collection: contract.address, collectionName: name }); }
  catch (error) { problem = error instanceof Error ? error.message : String(error); }
  if (!control) return <p className="notice error" role="alert">{problem} <button className="text-button" onClick={done}>Discard</button></p>;
  const input = { contract: control.contract, signature: control.signature, args: control.args, valueWei: '0' };
  const wallets = state.wallets.filter((wallet) => wallet.family === 'ethereum');
  return <section className="rule-change" aria-label="Review change">
    <div className="eyebrow">CHANGE TO REVIEW</div>
    <h3>{control.title}</h3>
    <p className="small">{control.detail}</p>
    <dl className="logical-facts">
      <dt>Sent to</dt><dd>{control.contract.name} <code>{control.contract.address}</code></dd>
      <dt>Method</dt><dd><code>{control.signature}</code></dd>
      <dt>Arguments</dt><dd><code>{JSON.stringify(control.args)}</code></dd>
    </dl>
    <div className="simulation">
      <Field label="Simulate as public address"><input value={account} placeholder="0x…" list={`rule-accounts-${contract.id}`} onChange={(event) => { setAccount(event.target.value.trim()); simulation.clear(); }} /><datalist id={`rule-accounts-${contract.id}`}>{wallets.map((wallet) => <option key={wallet.id} value={wallet.address}>{wallet.label}</option>)}</datalist></Field>
      <button disabled={!rpc || !/^0x[0-9a-fA-F]{40}$/u.test(account)} onClick={() => void action(() => simulation.load(() => api('contractSimulate', { ...input, rpcUrl: rpc, account })))}>Simulate first</button>
    </div>
    {simulation.data
      ? <><p className="notice">Simulation succeeded at block {simulation.data.evidence.blockNumber} for {short(account)}. That is not a signature or a promise it will still succeed later.</p><WalletWrite key={JSON.stringify(input)} contract={control.contract} prepareInput={() => input} rpcUrl={rpc} /></>
      : <p className="small">Simulate the change from the account that will send it. After that you can send it to your wallet, which shows the final details for your approval.</p>}
    <button className="text-button" onClick={done}>Discard this change</button>
  </section>;
}
