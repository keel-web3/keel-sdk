import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { toHex } from 'viem';
import { createTrackedContract } from '@keel/sdk/contract-controls';
import { EIP1967_BEACON_SLOT, keelSharedCollectionTokenRange } from '@keel/sdk/contract-registry';
import { WorkspaceStore, newProject } from '../src/workspace.mjs';
import { discoverCreatorContracts } from '../src/creator-discovery.mjs';
import { mergeDiscoveredCollections, collectionChoices } from '../src/creation-workflow.mjs';
import { inspectContractFacts } from '../src/contract-rpc.mjs';
import { AgentStore } from '../src/agent-store.mjs';
import { buildAgentContext } from '../src/agent-context.mjs';
import { createAgentTools } from '../src/agent-tools.mjs';
import {
  addTokenRange, attachSigner, contractEntry, contractInventory, detachSigner, filterContractEntries, groupKeelContracts,
  labelLogicalCollection, mergeTrackedContract, organizeContract, parseTagText, parseWorkspaceContract, rememberInspection,
  removeLogicalCollection, workspaceContractEntries,
} from '../src/contract-registry.mjs';

const CREATOR = '0x1111111111111111111111111111111111111111';
const FACTORY = '0x2222222222222222222222222222222222222222';
const SEEDED = '0x3333333333333333333333333333333333333333';
const SHARED = '0x4444444444444444444444444444444444444444';
const RENDERER = '0x5555555555555555555555555555555555555555';
const OTHER = '0x6666666666666666666666666666666666666666';
const IMPL = '0x7777777777777777777777777777777777777777';

const tracked = (address, extra = {}) => createTrackedContract({ chainId: 11155111, address, name: 'Legacy record', kind: 'collection', source: 'manual', abi: [], ...extra });

// Factory directory at one block: a seeded ERC-721A clone and two shared ERC-1155 collections (swap-and-pop order).
const TEMPLATE = '0x9999999999999999999999999999999999999999';
function factoryClient({ records, kinds = { 4: 2 }, count, ids: forcedIds } = {}) {
  const directory = records ?? {
    4: { creator: CREATOR, tokenContract: SEEDED, sharedCollectionId: 0n, name: 'Night Seeds', standard: 0, deployment: 0, open: true },
    9: { creator: CREATOR, tokenContract: SHARED, sharedCollectionId: 21n, name: 'Spring postcards', standard: 1, deployment: 1, open: true },
    2: { creator: CREATOR, tokenContract: SHARED, sharedCollectionId: 3n, name: 'Letters', standard: 1, deployment: 1, open: false },
  };
  const ids = forcedIds ?? Object.keys(directory).map(BigInt).reverse();
  return {
    getChainId: async () => 11155111,
    getBlockNumber: async () => 77n,
    getCode: async () => '0x6000',
    readContract: async ({ functionName, args, blockNumber }) => {
      assert.equal(blockNumber, 77n, 'every directory read is pinned to one block');
      if (functionName === 'creatorCollectionCount') return count ?? BigInt(ids.length);
      if (functionName === 'creatorCollectionIds') return ids;
      if (functionName === 'metadataRenderer') return RENDERER;
      if (functionName === 'collection') return directory[String(args[0])];
      if (functionName === 'erc721ImplementationKind') return kinds[String(args[0])];
      if (functionName === 'implementationSeeded721') return TEMPLATE;
      throw new Error(`Unexpected read ${functionName}`);
    },
  };
}
const discoveryInput = { chainId: 11155111, creator: CREATOR, factoryAddress: FACTORY, rpcUrl: '' };

test('workspaces saved before the registry fields load and save unchanged', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'keel-desktop-registry-'));
  const file = path.join(dir, 'workspace.sqlite');
  let store = new WorkspaceStore(file);
  try {
    const legacyShared = tracked(SHARED, { name: 'Shared edition 1', notes: 'Creator …; read at block 40.' });
    const legacyProxy = createTrackedContract({ chainId: 11155111, address: OTHER, name: 'Old proxy', kind: 'proxy', source: 'manual', abi: [], proxy: { kind: 'eip1967', implementation: IMPL } });
    const legacyCollections = [{ id: `11155111:${FACTORY.toLowerCase()}:1`, name: 'Shared edition 1', chainId: 11155111, creator: CREATOR, factory: FACTORY, contractId: legacyShared.id, collectionId: '1', sharedCollectionId: '101', deployment: 'shared', observedBlock: '40' }];
    // A body exactly as an older editor wrote it: no moduleSelections, no registry fields, one long-gone key.
    const body = { projects: [], contracts: [{ ...legacyShared, retiredField: 'dropped as before' }, legacyProxy], collections: legacyCollections, wallets: [], memories: [], objects: [] };
    store.db.prepare('UPDATE workspace SET body=? WHERE id=1').run(JSON.stringify(body)); store.snapshot = null;
    const loaded = store.read();
    assert.deepEqual(loaded.state.contracts, [legacyShared, legacyProxy]);
    assert.deepEqual(loaded.state.collections, legacyCollections);
    const saved = store.save(loaded.state, loaded.revision);
    assert.deepEqual(saved.state.contracts, [legacyShared, legacyProxy]);
    store.close(); store = new WorkspaceStore(file);
    assert.deepEqual(store.read().state.contracts, [legacyShared, legacyProxy]);

    // Legacy records still read as the right kind of contract, with exact shared token ranges.
    const [shared, proxy] = workspaceContractEntries(store.read().state);
    assert.equal(shared.family, 'shared-collection');
    assert.equal(shared.standard, 'erc1155');
    assert.deepEqual(shared.collections.map((item) => [item.key, item.tokenIds]), [['shared:101', keelSharedCollectionTokenRange(101n)]]);
    assert.equal(proxy.family, 'custom');
    assert.deepEqual(proxy.proxy, { kind: 'eip1967', implementation: IMPL });
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('creator organization, collections inside and signer records are validated and survive restart', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'keel-desktop-registry-'));
  const file = path.join(dir, 'workspace.sqlite');
  let store = new WorkspaceStore(file);
  try {
    let contract = organizeContract(tracked(SEEDED), { label: '  Spring   drop ', category: 'Drops', tags: parseTagText('Spring Drop, spring drop, 2026'), notes: 'Ask Ana before closing.', pinned: true });
    assert.deepEqual(contract.organization, { label: 'Spring drop', category: 'Drops', tags: ['spring-drop', '2026'], notes: 'Ask Ana before closing.', pinned: true });
    contract = addTokenRange(contract, { name: 'Artist proofs', from: '1', to: '25' });
    const range = contract.collections[0];
    assert.equal(range.kind, 'token-range');
    contract = labelLogicalCollection(contract, range.key, 'AP run');
    contract = attachSigner(contract, { label: 'Studio wallet', role: 'owner', flow: 'wallet', address: CREATOR.toLowerCase() });
    contract = attachSigner(contract, { label: 'Mint relay', role: 'minter', flow: 'bridge', server: 'https://relay.example/keel', queue: '/api/bridge/jobs', status: 'active' });
    assert.equal(contract.signers[0].address, CREATOR);
    assert.equal(contract.signers[0].status, 'unverified');
    const saved = store.save({ ...store.read().state, contracts: [contract] }, 0);
    store.close(); store = new WorkspaceStore(file);
    assert.deepEqual(store.read().state.contracts, saved.state.contracts);
    assert.deepEqual(store.read().state.contracts[0].collections[0].label, 'AP run');

    // Unpinning and clearing fields removes them instead of storing empty values.
    const cleared = organizeContract(contract, { pinned: false, notes: '', tags: [] });
    assert.deepEqual(cleared.organization, { label: 'Spring drop', category: 'Drops' });
    assert.deepEqual(detachSigner(contract, contract.signers[0].id).signers.map((item) => item.label), ['Mint relay']);
    assert.equal(removeLogicalCollection(contract, range.key).collections, undefined);

    // Bad input is refused, and nothing reaches the database.
    const base = store.read().state; const revision = store.read().revision;
    const bad = (change, pattern) => assert.throws(() => store.save({ ...base, contracts: [{ ...contract, ...change }] }, revision), pattern);
    bad({ organization: { tags: ['no/slash'] } }, /not a valid tag/);
    bad({ organization: { label: 'x'.repeat(121) } }, /at most 120/);
    bad({ organization: { owner: CREATOR } }, /cannot be set on a contract/);
    bad({ collections: [range, range] }, /listed once/);
    bad({ collections: [{ ...range, tokenIds: { from: '9', to: '1' } }] }, /start at or before/);
    bad({ collections: [{ ...range, tags: ['ok', 'not ok!'] }] }, /not a valid tag/);
    bad({ signers: [{ ...contract.signers[0], privateKey: '0x1' }] }, /"privateKey" cannot be set on a signer/);
    bad({ registry: { family: 'custom', proxy: { kind: 'diamond' } } }, /kind/);
    assert.equal(store.read().revision, revision);

    assert.throws(() => organizeContract(contract, { tags: ['ok', 'bad tag!'] }), /not a valid tag/);
    assert.throws(() => parseTagText('fine, no/slash'), /not a valid tag/);
    // Shared SDK rules (the same ones Studio applies server-side)…
    assert.throws(() => attachSigner(contract, { label: `0x${'ab'.repeat(32)}`, role: 'owner', flow: 'wallet', address: CREATOR }), /looks like a key or token/);
    assert.throws(() => attachSigner(contract, { label: 'Relay', role: 'minter', flow: 'bridge', server: 'https://relay.example/q?token=secret', queue: '/api/bridge/jobs' }), /must not contain credentials or query strings/);
    assert.throws(() => attachSigner(contract, { label: 'Relay', role: 'minter', flow: 'bridge', server: 'relay-1', queue: 'mint-requests' }), /must be a path/);
    assert.throws(() => attachSigner(contract, { label: 'Relay', role: 'minter', flow: 'bridge', server: '', queue: '' }), /needs a server name and a queue/);
    assert.throws(() => attachSigner(contract, { label: 'x'.repeat(81), role: 'owner', flow: 'wallet', address: CREATOR }), /at most 80/);
    // …plus the editor's own extras.
    assert.throws(() => attachSigner(contract, { label: 'Wallet', role: 'owner', flow: 'wallet' }), /needs its public address/);
    assert.throws(() => attachSigner(contract, { label: 'Relay', role: 'minter', flow: 'bridge', server: 'ftp://relay.example', queue: '/jobs' }), /https or wss/);
    assert.throws(() => attachSigner(contract, { label: 'Wallet', role: 'owner', flow: 'wallet', address: 'not an address' }), /public 0x address/);
    bad({ collections: [{ ...range, key: 'Not A Key' }] }, /not a collection key/);
    assert.throws(() => labelLogicalCollection(contract, 'factory:999', 'Missing'), /not listed/);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('discovery finds seeded ERC-721A clones and folds shared ERC-1155 collections into one contract with exact ranges', async () => {
  const result = await discoverCreatorContracts(discoveryInput, factoryClient());
  assert.deepEqual(result.records.map((record) => record.collectionId), ['2', '4', '9']);
  const seeded = result.records.find((record) => record.collectionId === '4');
  assert.equal(seeded.implementation, 'seeded-erc721a');
  assert.ok(seeded.contract.abi.some((item) => item.type === 'function'), 'seeded clones get the seeded template ABI');
  assert.equal(seeded.contract.registry.abiId, 'keel-creator-seeded-721a');
  assert.equal(seeded.contract.registry.family, 'creator-collection');
  assert.deepEqual(seeded.contract.registry.proxy, { kind: 'minimal-clone', implementation: TEMPLATE }, 'clones name the template they copy');
  assert.equal(seeded.contract.registry.observedBlock, '77');

  const shared = result.records.filter((record) => record.deployment === 'shared');
  assert.equal(shared.length, 2);
  assert.equal(shared[0].contract, shared[1].contract, 'both shared collections reference one tracked contract');
  const contract = shared[0].contract;
  assert.equal(contract.name, 'KEEL shared editions');
  assert.equal(contract.registry.family, 'shared-collection');
  assert.equal(contract.authority, 'unverified');
  assert.deepEqual(contract.collections.map((item) => [item.key, item.name, item.tokenIds.from, item.open]).sort(), [
    ['shared:21', 'Spring postcards', (21n << 128n).toString(), true],
    ['shared:3', 'Letters', (3n << 128n).toString(), false],
  ]);
  assert.equal(contract.collections.find((item) => item.key === 'shared:3').tokenIds.to, ((4n << 128n) - 1n).toString());
  assert.deepEqual(result.infrastructure.map((item) => item.registry.family), ['infrastructure', 'infrastructure']);

  // The editor's existing refusals still hold.
  await assert.rejects(discoverCreatorContracts(discoveryInput, factoryClient({ kinds: { 4: 3 } })), /invalid or unrelated creator record.*unknown ERC-721 template/);
  await assert.rejects(discoverCreatorContracts(discoveryInput, factoryClient({ records: { 5: { creator: OTHER, tokenContract: SEEDED, sharedCollectionId: 0n, name: 'Not mine', standard: 0, deployment: 0, open: true } }, kinds: { 5: 0 } })), /invalid or unrelated creator record/);
  await assert.rejects(discoverCreatorContracts(discoveryInput, factoryClient({ count: 101n })), /at most 100/);
  // Strict SDK discovery: duplicate ids and a count that disagrees with the ids are refused, not repaired.
  await assert.rejects(discoverCreatorContracts(discoveryInput, factoryClient({ ids: [4n, 4n], count: 2n })), /duplicate collection ids/);
  await assert.rejects(discoverCreatorContracts(discoveryInput, factoryClient({ count: 2n })), /disagree/);
});

test('remembering discovery keeps the creator’s names and labels while adding collections and facts', async () => {
  const result = await discoverCreatorContracts(discoveryInput, factoryClient());
  // The creator tracked the shared contract by hand before, named it and labelled one collection.
  const mine = organizeContract(tracked(SHARED, { name: 'My editions', notes: 'Added by hand', abi: [] }), { label: 'Postcards house', tags: ['postcards'] });
  const labelled = parseWorkspaceContract({ ...mine, collections: [{ key: 'shared:21', kind: 'shared-collection', name: 'Old name', source: 'factory', label: 'Spring drop' }] });
  const merged = mergeDiscoveredCollections({ contracts: [labelled], collections: [] }, [result]);
  const shared = merged.contracts.find((item) => item.id === labelled.id);
  assert.equal(shared.name, 'My editions');
  assert.equal(shared.notes, 'Added by hand');
  assert.deepEqual(shared.organization, { label: 'Postcards house', tags: ['postcards'] });
  assert.equal(shared.registry.family, 'shared-collection', 'a legacy guess never out-ranks discovered facts');
  assert.ok(shared.abi.length > 0, 'an empty ABI is filled; a reviewed one would be kept');
  const spring = shared.collections.find((item) => item.key === 'shared:21');
  assert.equal(spring.label, 'Spring drop');
  assert.equal(spring.name, 'Spring postcards');
  assert.deepEqual(spring.tokenIds, keelSharedCollectionTokenRange(21n));
  assert.equal(shared.collections.length, 2);
  assert.equal(merged.collections.length, 3);
  // Release pickers show the creator's label for that collection.
  assert.ok(collectionChoices(merged, { family: 'ethereum', chainId: 11155111 }).some((choice) => choice.name === 'Spring drop'));
  // Merging again is stable, and a reviewed ABI is never replaced.
  const reviewed = { ...shared, ...createTrackedContract({ ...shared, abi: [{ type: 'function', name: 'ping', stateMutability: 'view', inputs: [], outputs: [] }] }) };
  assert.deepEqual(mergeTrackedContract(reviewed, result.records.find((item) => item.deployment === 'shared').contract).abi, reviewed.abi);
});

test('contracts group like Studio and filter by tag, category, network and collection labels', () => {
  const pinned = organizeContract(tracked(SEEDED, { name: 'Night Seeds' }), { pinned: true, tags: ['seeds'] });
  const shared = labelLogicalCollection(parseWorkspaceContract({ ...tracked(SHARED, { name: 'KEEL shared editions' }), registry: { family: 'shared-collection', standard: 'erc1155', deployment: 'shared', sources: ['factory'] }, collections: [{ key: 'shared:21', kind: 'shared-collection', name: 'Postcards', externalId: '21', source: 'factory' }] }), 'shared:21', 'Spring drop');
  const sale = organizeContract(createTrackedContract({ chainId: 8453, address: OTHER, name: 'OneMintController · base', kind: 'default', source: 'sdk-deployment', abi: [] }), { category: 'Sales' });
  const factory = createTrackedContract({ chainId: 11155111, address: FACTORY, name: 'Creator factory', kind: 'default', source: 'factory-readback', abi: [] });
  const old = organizeContract(tracked(RENDERER, { name: 'Old test', kind: 'custom' }), { archived: true });
  const state = { contracts: [pinned, shared, sale, factory, old], collections: [] };
  const entries = workspaceContractEntries(state);
  assert.deepEqual(groupKeelContracts(entries).map((group) => [group.id, group.entries.map((entry) => entry.key)]), [
    ['pinned', [pinned.id]], ['shared', [shared.id]], ['sales', [sale.id]], ['infrastructure', [factory.id]], ['archived', [old.id]],
  ]);
  assert.deepEqual(filterContractEntries(entries, { query: 'spring' }).map((entry) => entry.key), [shared.id]);
  assert.deepEqual(filterContractEntries(entries, { tag: 'seeds' }).map((entry) => entry.key), [pinned.id]);
  assert.deepEqual(filterContractEntries(entries, { category: 'Sales' }).map((entry) => entry.key), [sale.id]);
  assert.deepEqual(filterContractEntries(entries, { chainId: 8453 }).map((entry) => entry.key), [sale.id]);
  assert.deepEqual(filterContractEntries(entries, { query: 'base onemint' }).map((entry) => entry.key), [sale.id]);
  assert.equal(contractEntry(shared).collections[0].label, 'Spring drop');
});

test('inspection reports proxy shape and standard without weakening the ABI mismatch refusal', async () => {
  const proxy = createTrackedContract({ chainId: 11155111, address: OTHER, name: 'Beacon proxy', kind: 'proxy', source: 'manual', abi: [{ type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }], proxy: { kind: 'beacon', implementation: IMPL } });
  const client = { getChainId: async () => 11155111, getBlockNumber: async () => 300n, getCode: async () => '0x6000',
    getStorageAt: async ({ slot }) => slot === EIP1967_BEACON_SLOT ? toHex(BigInt(RENDERER), { size: 32 }) : toHex(0, { size: 32 }),
    readContract: async ({ address, functionName, args, blockNumber }) => {
      assert.equal(blockNumber, 300n);
      if (address === RENDERER && functionName === 'implementation') return IMPL;
      if (functionName === 'supportsInterface') return ['0x01ffc9a7', '0xd9b67a26', '0x2a55205a'].includes(args[0]);
      if (functionName === 'owner') return CREATOR;
      throw new Error('revert');
    } };
  const evidence = await inspectContractFacts(proxy, '', client);
  assert.equal(evidence.importedImplementationMismatch, false);
  assert.deepEqual(evidence.facts.proxy, { kind: 'beacon', beacon: RENDERER, implementation: IMPL });
  assert.equal(evidence.facts.standard, 'erc1155');
  assert.equal(evidence.facts.interfaces.erc2981, true);
  assert.equal(evidence.facts.owner, CREATOR);
  assert.equal(evidence.facts.authority, 'unverified');
  const remembered = rememberInspection(proxy, evidence.facts);
  assert.equal(remembered.registry.standard, 'erc1155');
  assert.equal(remembered.registry.proxy.kind, 'beacon');
  assert.equal(remembered.registry.observedBlock, '300');
  assert.deepEqual(remembered.proxy, proxy.proxy, 'the expected implementation used by reads is unchanged');
  // A changed implementation is still visible and still blocks reads, even with registry facts attached.
  const moved = await inspectContractFacts({ ...remembered, proxy: { kind: 'beacon', implementation: SEEDED } }, '', client);
  assert.equal(moved.importedImplementationMismatch, true);
  assert.equal(moved.facts.proxy.implementation, IMPL);
});

test('assistants can find contracts by creator labels and tags, read-only and within project scope', async () => {
  const workspace = new WorkspaceStore(':memory:');
  try {
    const project = newProject('Spring release'); const other = newProject('Elsewhere');
    const spring = labelLogicalCollection(parseWorkspaceContract({ ...tracked(SHARED, { name: 'KEEL shared editions', projectId: project.id }), registry: { family: 'shared-collection', standard: 'erc1155', deployment: 'shared', sources: ['factory'] }, collections: [{ key: 'shared:21', kind: 'shared-collection', name: 'Postcards', externalId: '21', tokenIds: keelSharedCollectionTokenRange(21n), source: 'factory' }] }), 'shared:21', 'My spring drop');
    const signed = attachSigner(organizeContract(spring, { tags: ['spring-2026'], category: 'Drops' }), { label: 'Mint relay', role: 'minter', flow: 'bridge', server: 'relay-1', queue: '/api/bridge/spring' });
    const unrelated = organizeContract(tracked(SEEDED, { name: 'Night Seeds' }), { tags: ['seeds'] });
    workspace.save({ ...workspace.read().state, projects: [{ ...project, contractIds: [signed.id] }, other], contracts: [signed, unrelated] }, 0);

    const inventory = contractInventory(workspace.read().state, { query: 'my spring drop collection' });
    assert.equal(inventory[0].id, signed.id);
    assert.equal(inventory[0].collections[0].name, 'My spring drop');
    assert.equal(inventory[0].collections[0].recordedName, 'Postcards');
    assert.deepEqual(inventory[0].signers[0], { label: 'Mint relay', role: 'minter', flow: 'bridge', status: 'unverified', bridge: { server: 'relay-1', queue: '/api/bridge/spring' } });
    assert.ok(!('abi' in inventory[0]));

    const context = buildAgentContext({ chat: { contextMode: 'auto' }, prompt: 'Open my spring drop collection', workspace: workspace.read(), view: { page: 'Projects' } });
    assert.match(JSON.stringify(context), /My spring drop/);

    const chats = new AgentStore(workspace.db);
    const hooks = { workRoot: '/tmp/keel-agent-test-tools', view: () => ({ page: 'Contracts' }), networks: () => [], wallets: () => [], readKey: () => { throw Error('Tests do not use credentials.'); } };
    const make = (chat) => createAgentTools({ workspace, chats, chat, run: chats.begin(chat.id, 'Find it', null), hooks, signal: new AbortController().signal, emit: () => {} });
    const tools = make(chats.create({}));
    assert.ok(!tools.some((tool) => /send|approve|sign/.test(tool.name)));
    const find = (list, input) => list.find((tool) => tool.name === 'keel_find_contracts').invoke(input).then(JSON.parse);
    assert.deepEqual((await find(tools, { query: 'spring drop' })).contracts.map((item) => item.id), [signed.id]);
    assert.deepEqual((await find(tools, { tag: 'Seeds' })).contracts.map((item) => item.id), [unrelated.id]);
    assert.equal((await find(tools, { query: 'spring', chainId: 1 })).total, 0);
    const index = JSON.parse(await tools.find((tool) => tool.name === 'keel_editor_context').invoke({}));
    assert.deepEqual(index.contracts.find((item) => item.id === signed.id).collections, ['My spring drop']);
    // A project chat only sees its project's contracts.
    const scoped = make(chats.create({ projectId: project.id }));
    assert.deepEqual((await find(scoped, { query: '' })).contracts.map((item) => item.id), [signed.id]);
    assert.equal(workspace.read().revision, 1, 'finding contracts never writes');
  } finally { workspace.close(); }
});

test('inspection reports a proxy-slot conflict as a warning while reads and simulations still refuse it', async () => {
  const { EIP1967_IMPLEMENTATION_SLOT } = await import('@keel/sdk/contract-registry');
  const { simulateControl } = await import('../src/contract-rpc.mjs');
  const contract = createTrackedContract({ chainId: 11155111, address: OTHER, name: 'Odd proxy', kind: 'custom', source: 'manual', abi: [{ type: 'function', name: 'setValue', stateMutability: 'nonpayable', inputs: [{ name: 'value', type: 'uint256' }], outputs: [] }] });
  const client = { getChainId: async () => 11155111, getBlockNumber: async () => 300n, getCode: async () => '0x6000',
    getStorageAt: async ({ slot }) => slot === EIP1967_BEACON_SLOT ? toHex(BigInt(RENDERER), { size: 32 }) : slot === EIP1967_IMPLEMENTATION_SLOT ? toHex(BigInt(IMPL), { size: 32 }) : toHex(0, { size: 32 }),
    readContract: async ({ address, functionName }) => { if (address === RENDERER && functionName === 'implementation') return IMPL; throw new Error('revert'); },
    call: async () => { throw new Error('a refused contract must not be simulated'); } };
  const evidence = await inspectContractFacts(contract, '', client);
  assert.match(evidence.refused, /Both implementation and beacon slots/);
  assert.equal(evidence.facts.proxy.conflict, true);
  assert.equal(evidence.facts.proxy.kind, 'beacon');
  assert.equal(rememberInspection(contract, evidence.facts).registry.proxy.conflict, true, 'the conflict survives being saved as a fact');
  await assert.rejects(simulateControl({ contract, signature: 'setValue(uint256)', args: ['1'], account: CREATOR }, client), /Both implementation and beacon slots/);
});

test('trading rules are read with the shared SDK at one pinned block, and changes become ordinary unsigned reviews', async () => {
  const { readTransferRules, simulateControl } = await import('../src/contract-rpc.mjs');
  const { CREATOR_TOKEN_VALIDATORS, OPERATOR_FILTER_REGISTRY, OPENSEA_DEFAULT_FILTER_SUBSCRIPTION, prepareKeelTransferRuleChange } = await import('@keel/sdk/transfer-rules');
  const { transferRuleControl, parseAccountList } = await import('../src/transfer-rules-control.mjs');
  const { prepareContractControl } = await import('@keel/sdk/contract-controls');
  const { encodeFunctionData } = await import('viem');
  const SEAPORT = '0x0000000000000068F116a894984e2DB1123eB395';
  const collection = createTrackedContract({ chainId: 11155111, address: SEEDED, name: 'Night Seeds', kind: 'collection', source: 'manual', abi: [] });
  const reads = [];
  const client = {
    getChainId: async () => 11155111, getBlockNumber: async () => 500n, getCode: async () => '0x6000',
    readContract: async ({ address, functionName, args, blockNumber }) => {
      assert.equal(blockNumber, 500n, 'every trading-rule read is pinned to one block');
      reads.push(functionName);
      if (address === SEEDED && functionName === 'getTransferValidator') return CREATOR_TOKEN_VALIDATORS.v5;
      if (address === CREATOR_TOKEN_VALIDATORS.v5) {
        if (functionName === 'getListAccountsByCollection') return args[1] === 0 ? [SEAPORT] : [];
        if (functionName === 'getCollectionSecurityPolicy') return { rulesetId: 4, listId: 7n, customRuleset: '0x0000000000000000000000000000000000000000', globalOptions: 0, rulesetOptions: 0 };
        if (functionName === 'getFrozenAccountsByCollection') return [OTHER];
        if (functionName === 'getListCodeHashesByCollection') return [];
      }
      if (address === OPERATOR_FILTER_REGISTRY) {
        if (functionName === 'isRegistered') return true;
        if (functionName === 'subscriptionOf') return OPENSEA_DEFAULT_FILTER_SUBSCRIPTION;
        if (functionName === 'filteredOperators') return [];
      }
      throw new Error('revert');
    },
  };
  const rules = await readTransferRules(collection, '', client);
  assert.equal(rules.blockNumber, '500');
  assert.equal(rules.creatorToken.version, 'v5');
  assert.equal(rules.creatorToken.policy.title, 'Allowed marketplaces only');
  assert.equal(rules.creatorToken.policy.listId, '7');
  assert.deepEqual(rules.creatorToken.blocked, [{ address: SEAPORT, name: 'OpenSea Seaport 1.6' }]);
  assert.deepEqual(rules.creatorToken.frozen, [OTHER]);
  assert.equal(rules.operatorFilter.subscribedToOpenSeaDefault, true);
  assert.match(rules.summary, /validator v5.*Allowed marketplaces only/u);
  assert.equal(rules.authority, 'unverified');
  await assert.rejects(readTransferRules(collection, '', { ...client, getChainId: async () => 1 }), /does not match/);
  await assert.rejects(readTransferRules(collection, '', { ...client, getCode: async () => '0x' }), /No contract code/);

  // Each change is the SDK's exact call, re-expressed as the editor's control input; the calldata is identical.
  const { accounts, invalid } = parseAccountList(`${SEAPORT.toLowerCase()}, nope\n${SEAPORT}`);
  assert.deepEqual(accounts, [SEAPORT]); assert.deepEqual(invalid, ['nope']);
  const changes = [
    { kind: 'list-accounts', version: 'v5', validator: CREATOR_TOKEN_VALIDATORS.v5, listId: '7', list: 'allowed', action: 'add', accounts },
    { kind: 'v3-set-level', validator: CREATOR_TOKEN_VALIDATORS.v3, collection: SEEDED, level: 3 },
    { kind: 'operator-filter', collection: SEEDED, operator: SEAPORT, filtered: true },
    { kind: 'set-validator', collection: SEEDED, validator: CREATOR_TOKEN_VALIDATORS.v5 },
  ];
  for (const change of changes) {
    const call = prepareKeelTransferRuleChange(change);
    const control = transferRuleControl(call, { chainId: 11155111, collection: SEEDED, collectionName: 'Night Seeds' });
    const review = prepareContractControl(control);
    assert.equal(review.data, encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args }));
    assert.equal(review.to, call.address);
    assert.equal(review.signing, 'not-performed');
    assert.equal(review.submission, 'not-performed');
  }
  assert.equal(transferRuleControl(prepareKeelTransferRuleChange(changes[2]), { chainId: 11155111, collection: SEEDED }).contract.name, 'Operator filter registry');
  assert.equal(transferRuleControl(prepareKeelTransferRuleChange(changes[3]), { chainId: 11155111, collection: SEEDED, collectionName: 'Night Seeds' }).contract.name, 'Night Seeds');

  // Simulation goes through the same pinned-block, chain-checked path as every other write review.
  const control = transferRuleControl(prepareKeelTransferRuleChange(changes[0]), { chainId: 11155111, collection: SEEDED });
  let calls = 0;
  const simulated = await simulateControl({ ...control, account: CREATOR }, { ...client, getStorageAt: async () => toHex(0, { size: 32 }), call: async (request) => { calls++; assert.equal(request.to, CREATOR_TOKEN_VALIDATORS.v5); assert.equal(request.blockNumber, 500n); return { data: '0x' }; } });
  assert.equal(simulated.simulation, 'succeeded-at-observed-block');
  assert.equal(simulated.signing, 'not-performed');
  assert.equal(calls, 1);
});

test('the assistant can read trading rules but has no tool that changes or sends them', async () => {
  const workspace = new WorkspaceStore(':memory:');
  try {
    const collection = tracked(SEEDED, { name: 'Night Seeds' });
    workspace.save({ ...workspace.read().state, contracts: [collection] }, 0);
    const chats = new AgentStore(workspace.db);
    const seen = [];
    const hooks = { workRoot: '/tmp/keel-agent-test-tools', view: () => ({ page: 'Contracts' }), networks: () => [], wallets: () => [], readKey: () => { throw Error('no'); }, readTransferRules: async (input) => { seen.push(input); return { summary: 'Creator token (validator v5)' }; } };
    const chat = chats.create({});
    const tools = createAgentTools({ workspace, chats, chat, run: chats.begin(chat.id, 'Who can trade it?', null), hooks, signal: new AbortController().signal, emit: () => {} });
    assert.ok(!tools.some((tool) => /send|approve|sign/.test(tool.name)));
    const profileId = '00000000-0000-4000-8000-000000000001';
    const result = JSON.parse(await tools.find((tool) => tool.name === 'keel_trading_rules').invoke({ contractId: collection.id, profileId }));
    assert.equal(result.summary, 'Creator token (validator v5)');
    assert.equal(seen[0].contract.id, collection.id);
    assert.equal(seen[0].profileId, profileId);
    assert.equal(workspace.read().revision, 1);
  } finally { workspace.close(); }
});

test('an RPC that doesn’t answer is reported as a network problem, never as “not a creator token” or missing data', async () => {
  const { readTransferRules, inspectContractFacts: inspectFacts, simulateControl } = await import('../src/contract-rpc.mjs');
  const { isNetworkUnavailable } = await import('../src/network-errors.mjs');
  const outage = (name) => Object.assign(new Error('HTTP request failed. URL: https://rpc.example/v2/SECRET-API-KEY'), { name });
  const wrapped = (name) => Object.assign(new Error('The contract function "getTransferValidator" reverted.'), { name: 'ContractFunctionExecutionError', cause: outage(name) });
  const collection = createTrackedContract({ chainId: 11155111, address: SEEDED, name: 'Night Seeds', kind: 'collection', source: 'manual', abi: [{ type: 'function', name: 'setValue', stateMutability: 'nonpayable', inputs: [{ name: 'value', type: 'uint256' }], outputs: [] }] });
  const base = { getChainId: async () => 11155111, getBlockNumber: async () => 9n, getCode: async () => '0x6000', getStorageAt: async () => toHex(0, { size: 32 }) };
  const expectOffline = async (promise) => {
    await assert.rejects(promise, (error) => isNetworkUnavailable(error) && !error.message.includes('SECRET') && !error.message.includes('rpc.example'));
  };
  // A rate limit in the middle of the validator probe must not become "not a creator token".
  await expectOffline(readTransferRules(collection, '', { ...base, readContract: async () => { throw wrapped('LimitExceededRpcError'); } }));
  await expectOffline(readTransferRules(collection, '', { ...base, getBlockNumber: async () => { throw outage('TimeoutError'); } }));
  // Inspection: an outage during the SDK's optional probes is not "no ERC-165" or "no owner".
  await expectOffline(inspectFacts(collection, '', { ...base, readContract: async () => { throw wrapped('HttpRequestError'); } }));
  await expectOffline(simulateControl({ contract: collection, signature: 'setValue(uint256)', args: ['1'], account: CREATOR }, { ...base, getStorageAt: async () => { throw outage('HttpRequestError'); } }));
  await expectOffline(discoverCreatorContracts(discoveryInput, { ...factoryClient(), getChainId: async () => { throw outage('HttpRequestError'); } }));
  // A contract that really reverts is still answered normally.
  const plain = await readTransferRules(collection, '', { ...base, readContract: async () => { throw new Error('execution reverted'); } });
  assert.equal(plain.creatorToken.status, 'not-creator-token');
  assert.equal(plain.operatorFilter.status, 'unavailable');
});
