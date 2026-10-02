// The editor's view of the shared KEEL contract registry (@keel/sdk/contract-registry).
//
// A tracked contract keeps its reviewed ABI binding exactly as before
// (createTrackedContract). Next to it, a record can carry:
//   organization  creator-owned label, category, tags, notes, pinned, archived
//   collections   logical collections inside the contract, each nameable
//   signers       bookkeeping records of who acts for the contract and how
//   registry      discovered or inspected facts (family, standard, proxy shape)
// All four are optional so workspaces saved before them load unchanged. None
// of them grants authority, and nothing here signs or sends anything.
import { z } from 'zod';
import { getAddress } from 'viem';
import { createTrackedContract } from '@keel/sdk/contract-controls';
import {
  KEEL_CONTRACT_REGISTRY_PROTOCOL,
  KEEL_SIGNER_FLOW_LABELS,
  KEEL_SIGNER_ROLE_LABELS,
  describeKeelContract,
  displayName,
  groupKeelContracts,
  keelSharedCollectionTokenRange,
  mergeKeelContractEntries,
  normalizeKeelCollectionLabels,
  normalizeKeelContractOrganization,
  normalizeKeelContractSigner,
  normalizeKeelContractSigners,
  normalizeKeelContractTags,
} from '@keel/sdk/contract-registry';

// Signer flow and role names come from the SDK so Studio and the editor say the same thing.
export { describeKeelContract, displayName, groupKeelContracts, KEEL_SIGNER_FLOW_LABELS as SIGNER_FLOW_LABELS, KEEL_SIGNER_ROLE_LABELS as SIGNER_ROLE_LABELS };

export const CONTRACT_FAMILIES = ['creator-collection', 'shared-collection', 'fray-auction', 'drop-controller', 'infrastructure', 'custom'];
export const CONTRACT_STANDARDS = ['erc721', 'erc1155', 'erc20', 'unknown'];
export const CONTRACT_SOURCES = ['factory', 'indexer', 'release', 'drop', 'fray', 'manual', 'agent'];
export const LOGICAL_COLLECTION_KINDS = ['factory-collection', 'shared-collection', 'die-collection', 'drop', 'fray-auction', 'token-range', 'custom'];
export const SIGNER_FLOWS = Object.keys(KEEL_SIGNER_FLOW_LABELS);
export const SIGNER_ROLES = Object.keys(KEEL_SIGNER_ROLE_LABELS);
export const SIGNER_STATUSES = ['unverified', 'pending', 'active', 'revoked'];
export const COLLECTION_KIND_LABELS = { 'factory-collection': 'Factory collection', 'shared-collection': 'Shared collection', 'die-collection': 'Collection', drop: 'Drop', 'fray-auction': 'FRAY auction', 'token-range': 'Token range', custom: 'Custom group' };

const CHAIN_NAMES = { 1: 'Ethereum', 10: 'Optimism', 137: 'Polygon', 8453: 'Base', 42161: 'Arbitrum', 84532: 'Base Sepolia', 11155111: 'Sepolia', 31337: 'Local chain' };
export const chainLabel = (chainId) => CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;

/* ------------------------------------------------------------------ schemas */

const CONTROL = /[\u0000-\u001f\u007f]/u;
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/u, 'Enter a public 0x address.').transform((value) => getAddress(value));
const decimal = z.string().regex(/^(0|[1-9]\d{0,77})$/u, 'Token ids are whole numbers.').refine((value) => BigInt(value) < 2n ** 256n, 'Token ids must fit in uint256.');

function normalized(read) {
  return (value, ctx) => {
    try { return read(value); } catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) }); return z.NEVER; }
  };
}

const proxySchema = z.object({
  kind: z.enum(['none', 'eip1967', 'beacon', 'minimal-clone']),
  // Both EIP-1967 implementation and beacon slots were set when inspected: reads and simulations refuse it.
  conflict: z.literal(true).optional(),
  implementation: address.optional(), admin: address.optional(), beacon: address.optional(),
}).strict();

/** Evidence about what the contract is. Never proof of who controls it. */
export const registryFactsSchema = z.object({
  family: z.enum(CONTRACT_FAMILIES),
  standard: z.enum(CONTRACT_STANDARDS).default('unknown'),
  deployment: z.enum(['dedicated', 'shared', 'external', 'standalone']).default('standalone'),
  proxy: proxySchema.default({ kind: 'none' }),
  abiId: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,63}$/u).optional(),
  symbol: z.string().max(64).refine((value) => !CONTROL.test(value)).optional(),
  sources: z.array(z.enum(CONTRACT_SOURCES)).max(CONTRACT_SOURCES.length).default([]).transform((items) => [...new Set(items)]),
  observedBlock: z.string().regex(/^\d{1,30}$/u).optional(),
}).strict();

/**
 * A collection inside a contract. Its key and the creator's label and tags go
 * through the SDK's normalizeKeelCollectionLabels (the same rules Studio
 * applies); the discovered facts (kind, ids, token range) are checked here.
 */
export const logicalCollectionSchema = z.object({
  key: z.string().min(1).max(110),
  kind: z.enum(LOGICAL_COLLECTION_KINDS),
  name: z.string().max(200).refine((value) => !CONTROL.test(value), 'Collection names cannot contain control characters.'),
  externalId: z.string().min(1).max(80).regex(/^[A-Za-z0-9._:-]+$/u).optional(),
  tokenIds: z.object({ from: decimal.optional(), to: decimal.optional() }).strict()
    .refine((range) => range.from === undefined || range.to === undefined || BigInt(range.from) <= BigInt(range.to), 'A token range must start at or before its end.').optional(),
  open: z.boolean().optional(),
  source: z.enum(CONTRACT_SOURCES),
  label: z.unknown().optional(),
  tags: z.unknown().optional(),
}).strict().transform(normalized((item) => {
  const { label, tags, ...rest } = item;
  const creator = normalizeKeelCollectionLabels({ [item.key]: { ...(label === undefined ? {} : { label }), ...(tags === undefined ? {} : { tags }) } })[item.key];
  return { ...rest, ...creator };
}));

/**
 * Editor-only checks on top of the SDK's normalizeKeelContractSigner: a wallet
 * record names its address, a bridge record names both its server and queue,
 * and a bridge server written as a URL must be https/wss (http only on this
 * computer).
 */
function editorSignerChecks(signer) {
  if (signer.flow === 'wallet' && !signer.address) throw new TypeError('A wallet signer needs its public address.');
  if (signer.flow === 'bridge' && !signer.bridge) throw new TypeError('A bridge needs a server name and a queue.');
  const server = signer.bridge?.server;
  if (server && /^[a-z][a-z0-9+.-]*:\/\//iu.test(server)) {
    let url;
    try { url = new URL(server); } catch { throw new TypeError('The bridge server address is not a valid URL.'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!(['https:', 'wss:'].includes(url.protocol) || (local && ['http:', 'ws:'].includes(url.protocol)))) throw new TypeError('Use an https or wss bridge address (http only for this computer).');
  }
  return signer;
}

const unique = (items, key, what) => new Set(items.map(key)).size === items.length || `Each ${what} must be listed once.`;
const collectionsSchema = z.array(logicalCollectionSchema).max(500).superRefine((items, ctx) => { const ok = unique(items, (item) => item.key, 'collection'); if (ok !== true) ctx.addIssue({ code: 'custom', message: ok }); });
const signersSchema = z.unknown().transform(normalized((value) => normalizeKeelContractSigners(value).map(editorSignerChecks)));
const organizationSchema = z.unknown().transform(normalized((value) => {
  const organization = normalizeKeelContractOrganization(value);
  return Object.fromEntries(Object.entries(organization).filter(([, item]) => item !== false && !(Array.isArray(item) && item.length === 0)));
}));

// Our own messages are written for creators; zod's generic ones keep the field path so they can be found.
function readable(error, section = '') {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    if (!issue) return new TypeError('Invalid contract record.');
    const where = [section, ...issue.path].filter((part) => part !== '').join('.');
    return new TypeError(issue.code === 'custom' || !where ? issue.message : `${where}: ${issue.message}`);
  }
  return error;
}

/**
 * Validates one saved contract record. The ABI binding goes through the SDK's
 * createTrackedContract exactly as before (unknown legacy keys are dropped
 * there); the registry additions are strict.
 */
/**
 * @param {unknown} value
 * @returns {import('./types').WorkspaceContract}
 */
export function parseWorkspaceContract(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A contract record must be an object.');
  const { organization, collections, signers, registry, ...core } = value;
  const tracked = createTrackedContract(core);
  const extras = {};
  const read = (section, schema, input) => { try { return schema.parse(input); } catch (error) { throw readable(error, section); } };
  if (organization !== undefined) { const parsed = read('organization', organizationSchema, organization); if (Object.keys(parsed).length) extras.organization = parsed; }
  if (collections !== undefined) { const parsed = read('collections', collectionsSchema, collections); if (parsed.length) extras.collections = parsed; }
  if (signers !== undefined) { const parsed = read('signers', signersSchema, signers); if (parsed.length) extras.signers = parsed; }
  if (registry !== undefined) extras.registry = read('registry', registryFactsSchema, registry);
  return { ...tracked, ...extras };
}

/* ------------------------------------------------------------------ entries */

const PROXY_KINDS = { eip1967: 'eip1967', beacon: 'beacon', minimal: 'minimal-clone' };
const TRACKED_SOURCES = { 'sdk-deployment': 'manual', 'creator-operation': 'factory', 'factory-readback': 'factory', manual: 'manual' };

function sharedRange(id) {
  try { return { tokenIds: keelSharedCollectionTokenRange(id) }; } catch { return {}; }
}

function factoryCollection(record) {
  return record.deployment === 'shared'
    ? { key: `shared:${record.sharedCollectionId}`, kind: 'shared-collection', name: record.name, externalId: record.sharedCollectionId, ...sharedRange(record.sharedCollectionId), source: 'factory' }
    : { key: `factory:${record.collectionId}`, kind: 'factory-collection', name: record.name, externalId: record.collectionId, source: 'factory' };
}

/** Saved collections win over ones derived from factory records, so creator labels stay. */
function combineCollections(derived, saved) {
  const byKey = new Map(derived.map((item) => [item.key, item]));
  for (const item of saved) byKey.set(item.key, { ...byKey.get(item.key), ...item });
  return [...byKey.values()];
}

function inferredFamily(contract, linked, collections) {
  if (linked.some((record) => record.deployment === 'shared')) return 'shared-collection';
  if (linked.length && linked.every((record) => record.deployment === 'external')) return 'custom';
  if (contract.kind === 'collection') return 'creator-collection';
  if (contract.kind === 'default') {
    if (/^(OneMintController|KeelMintGate|KeelMintRouteRegistry)\b/u.test(contract.name)) return 'drop-controller';
    if (/fray|auction/iu.test(contract.name)) return 'fray-auction';
    if (/^KeelShared1155\b/u.test(contract.name) && collections.length) return 'shared-collection';
    return 'infrastructure';
  }
  return 'custom';
}

/**
 * The registry entry for one tracked contract. Legacy records without
 * registry facts get them inferred from their kind and from the factory
 * collection records that point at them.
 *
 * @param {any} contract
 * @param {readonly any[]} [factoryRecords] workspace `collections` records
 * @returns {import('@keel/sdk/contract-registry').KeelContractEntry & { readonly contractId: string }}
 */
export function contractEntry(contract, factoryRecords = []) {
  const linked = factoryRecords.filter((record) => record.contractId === contract.id && record.chainId === contract.chainId);
  const collections = combineCollections(linked.map(factoryCollection), contract.collections ?? []);
  const registry = contract.registry;
  const shared = linked.some((record) => record.deployment === 'shared');
  return {
    protocol: KEEL_CONTRACT_REGISTRY_PROTOCOL,
    key: contract.id,
    contractId: contract.id,
    chainId: contract.chainId,
    address: contract.address,
    family: registry?.family ?? inferredFamily(contract, linked, collections),
    standard: registry?.standard ?? (shared ? 'erc1155' : 'unknown'),
    deployment: registry?.deployment ?? (shared ? 'shared' : linked.some((record) => record.deployment === 'dedicated') ? 'dedicated' : 'standalone'),
    proxy: registry?.proxy ?? (contract.proxy && PROXY_KINDS[contract.proxy.kind] ? { kind: PROXY_KINDS[contract.proxy.kind], ...(contract.proxy.implementation ? { implementation: contract.proxy.implementation } : {}), ...(contract.proxy.beacon ? { beacon: contract.proxy.beacon } : {}), ...(contract.proxy.admin ? { admin: contract.proxy.admin } : {}) } : { kind: 'none' }),
    name: contract.name,
    ...(registry?.symbol ? { symbol: registry.symbol } : {}),
    ...(registry?.abiId ? { abiId: registry.abiId } : {}),
    sources: registry?.sources?.length ? registry.sources : [TRACKED_SOURCES[contract.source] ?? 'manual'],
    collections,
    signers: contract.signers ?? [],
    ...(contract.organization ?? {}),
  };
}

/** @returns {Array<import('@keel/sdk/contract-registry').KeelContractEntry & { readonly contractId: string }>} */
export function workspaceContractEntries(state) {
  return state.contracts.map((contract) => contractEntry(contract, state.collections ?? []));
}

/** Registry fields to store on a tracked contract from an SDK entry (e.g. one built from factory records). */
export function registryFieldsFromEntry(entry) {
  return {
    registry: registryFactsSchema.parse({ family: entry.family, standard: entry.standard, deployment: entry.deployment, proxy: entry.proxy, ...(entry.abiId ? { abiId: entry.abiId } : {}), ...(entry.symbol ? { symbol: entry.symbol } : {}), sources: entry.sources }),
    ...(entry.collections.length ? { collections: entry.collections } : {}),
    ...(entry.signers.length ? { signers: entry.signers } : {}),
  };
}

const ORGANIZATION_KEYS = ['label', 'category', 'tags', 'notes', 'pinned', 'archived'];

/**
 * Folds newly discovered facts into a contract the creator already tracks.
 * The saved ABI binding, name, notes and project link always win, as do the
 * creator's labels; discovery only adds facts and logical collections.
 */
/** @returns {import('./types').WorkspaceContract} */
export function mergeTrackedContract(existing, incoming) {
  if (existing.id !== incoming.id) throw new TypeError('Only records for the same chain and address can be merged.');
  const abi = existing.abi.length === 0 && incoming.abi?.length ? incoming.abi : existing.abi;
  if (!incoming.registry && !incoming.collections?.length && !incoming.signers?.length) return abi === existing.abi ? existing : parseWorkspaceContract({ ...existing, abi });
  const next = contractEntry(incoming);
  const saved = contractEntry(existing);
  // Facts inferred for a legacy record (no registry yet) must not out-rank facts discovery just read.
  const previous = existing.registry ? saved : { ...saved, family: next.family, standard: 'unknown', deployment: next.deployment };
  const [merged] = mergeKeelContractEntries([previous, next]);
  const organization = Object.fromEntries(ORGANIZATION_KEYS.filter((key) => existing.organization?.[key] !== undefined).map((key) => [key, existing.organization[key]]));
  const { collections, signers, registry } = registryFieldsFromEntry(merged);
  const observedBlock = incoming.registry?.observedBlock ?? existing.registry?.observedBlock;
  return parseWorkspaceContract({
    ...existing, abi,
    registry: { ...registry, ...(observedBlock ? { observedBlock } : {}) },
    ...(collections ? { collections } : {}),
    ...(signers ? { signers } : {}),
    ...(Object.keys(organization).length ? { organization } : {}),
  });
}

/* ------------------------------------------------------------------ edits */

/** Applies creator changes to label, category, tags, notes, pinned or archived. */
/**
 * @param {import('./types').WorkspaceContract} contract
 * @param {Record<string, unknown>} changes
 * @returns {import('./types').WorkspaceContract}
 */
export function organizeContract(contract, changes) {
  const next = { ...(contract.organization ?? {}), ...changes };
  for (const key of Object.keys(next)) if (next[key] === undefined || next[key] === null || next[key] === '') delete next[key];
  return parseWorkspaceContract({ ...contract, organization: next });
}

/** Parses a comma-separated tag field with the SDK rules. */
/** @param {string} text @returns {string[]} */
export function parseTagText(text) {
  return normalizeKeelContractTags(String(text ?? '').split(',').map((item) => item.trim()).filter(Boolean));
}

/** Names (or un-names, with an empty label) one logical collection inside a contract. */
/** @param {import('./types').WorkspaceContract} contract @param {string} key @param {string} label @param {readonly any[]} [factoryRecords] @returns {import('./types').WorkspaceContract} */
export function labelLogicalCollection(contract, key, label, factoryRecords = []) {
  const entry = contractEntry(contract, factoryRecords);
  const target = entry.collections.find((item) => item.key === key);
  if (!target) throw new TypeError('That collection is not listed inside this contract.');
  const clean = normalizeKeelContractOrganization({ label: label ?? '' }).label;
  const { label: _previous, ...rest } = target;
  const updated = { ...rest, ...(clean ? { label: clean } : {}) };
  const saved = contract.collections ?? [];
  return parseWorkspaceContract({ ...contract, collections: saved.some((item) => item.key === key) ? saved.map((item) => item.key === key ? updated : item) : [...saved, updated] });
}

/** Records a named token range (or group) inside a contract. Bookkeeping only. */
/** @param {import('./types').WorkspaceContract} contract @param {{ name: string, from?: string, to?: string }} range @returns {import('./types').WorkspaceContract} */
export function addTokenRange(contract, { name, from, to }) {
  const label = normalizeKeelContractOrganization({ label: name }).label;
  if (!label) throw new TypeError('Name the token range.');
  const tokenIds = { ...(String(from ?? '').trim() ? { from: String(from).trim() } : {}), ...(String(to ?? '').trim() ? { to: String(to).trim() } : {}) };
  const item = { key: `custom:${globalThis.crypto.randomUUID()}`, kind: Object.keys(tokenIds).length ? 'token-range' : 'custom', name: label, ...(Object.keys(tokenIds).length ? { tokenIds } : {}), source: 'manual' };
  return parseWorkspaceContract({ ...contract, collections: [...(contract.collections ?? []), item] });
}

/** @param {import('./types').WorkspaceContract} contract @param {string} key @returns {import('./types').WorkspaceContract} */
export function removeLogicalCollection(contract, key) {
  const item = contract.collections?.find((entry) => entry.key === key);
  if (!item || item.source !== 'manual') throw new TypeError('Only ranges you added yourself can be removed. Discovered collections stay listed.');
  return parseWorkspaceContract({ ...contract, collections: contract.collections.filter((entry) => entry.key !== key) });
}

/**
 * Attaches a bookkeeping record of a signer flow. It stores public details
 * only (address, role, flow, bridge server and queue) and never signs. The
 * SDK's normalizeKeelContractSigner refuses anything that looks like a key or
 * token and bridge addresses carrying credentials or query strings.
 *
 * @param {import('./types').WorkspaceContract} contract
 * @param {{ label: string, role: string, flow: string, address?: string, status?: string, server?: string, queue?: string }} input
 * @returns {import('./types').WorkspaceContract}
 */
export function attachSigner(contract, input) {
  const account = String(input.address ?? '').trim();
  if (account && !/^0x[0-9a-fA-F]{40}$/u.test(account)) throw new TypeError('Enter a public 0x address.');
  const signer = editorSignerChecks(normalizeKeelContractSigner({
    id: globalThis.crypto.randomUUID(),
    label: input.label,
    role: input.role,
    flow: input.flow,
    status: input.status || 'unverified',
    ...(account ? { address: account } : {}),
    ...(input.flow === 'bridge' ? { bridge: { server: input.server ?? '', queue: input.queue ?? '' } } : {}),
  }));
  return parseWorkspaceContract({ ...contract, signers: [...(contract.signers ?? []), signer] });
}

/** @param {import('./types').WorkspaceContract} contract @param {string} id @returns {import('./types').WorkspaceContract} */
export function detachSigner(contract, id) {
  return parseWorkspaceContract({ ...contract, signers: (contract.signers ?? []).filter((item) => item.id !== id) });
}

/**
 * Keeps what an on-chain inspection observed (standard, proxy shape, symbol)
 * as registry facts. The ABI binding and its expected implementation are not
 * changed; reads still refuse a mismatched implementation.
 */
/** @param {import('./types').WorkspaceContract} contract @param {any} facts @param {readonly any[]} [factoryRecords] @returns {import('./types').WorkspaceContract} */
export function rememberInspection(contract, facts, factoryRecords = []) {
  const entry = contractEntry(contract, factoryRecords);
  return parseWorkspaceContract({
    ...contract,
    registry: {
      family: entry.family,
      standard: facts.standard && facts.standard !== 'unknown' ? facts.standard : entry.standard,
      deployment: entry.deployment,
      proxy: facts.proxy ?? entry.proxy,
      ...(entry.abiId ? { abiId: entry.abiId } : {}),
      ...(facts.symbol ? { symbol: String(facts.symbol).slice(0, 64) } : entry.symbol ? { symbol: entry.symbol } : {}),
      sources: entry.sources,
      ...(facts.blockNumber ? { observedBlock: String(facts.blockNumber) } : {}),
    },
  });
}

/* ------------------------------------------------------------------ search */

export function contractSearchText(entry) {
  return [
    entry.label, entry.name, entry.category, ...(entry.tags ?? []), entry.notes, entry.address, entry.symbol, String(entry.chainId), chainLabel(entry.chainId),
    describeKeelContract(entry), entry.family,
    ...entry.collections.flatMap((item) => [item.label, item.name, item.externalId, ...(item.tags ?? []), COLLECTION_KIND_LABELS[item.kind]]),
    ...entry.signers.flatMap((item) => [item.label, item.address, KEEL_SIGNER_FLOW_LABELS[item.flow]?.label, KEEL_SIGNER_ROLE_LABELS[item.role]]),
  ].filter(Boolean).join(' ').toLowerCase();
}

/** Every word of the query must appear somewhere in the contract or its collections. */
/**
 * @template {import('@keel/sdk/contract-registry').KeelContractEntry} T
 * @param {readonly T[]} entries
 * @param {{ query?: string, tag?: string, category?: string, chainId?: number }} [filters]
 * @returns {T[]}
 */
export function filterContractEntries(entries, { query = '', tag = '', category = '', chainId } = {}) {
  const words = String(query).toLowerCase().split(/\s+/u).filter(Boolean);
  return entries.filter((entry) => {
    if (tag && !(entry.tags ?? []).includes(tag)) return false;
    if (category && (entry.category ?? '') !== category) return false;
    if (chainId && entry.chainId !== Number(chainId)) return false;
    if (!words.length) return true;
    const text = contractSearchText(entry);
    return words.every((word) => text.includes(word));
  });
}

const terms = (text) => new Set(String(text).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
function relevance(entry, ask) {
  const text = terms(contractSearchText(entry));
  return [...terms(ask)].reduce((sum, word) => sum + Number(text.has(word)), 0) + (entry.pinned ? 0.5 : 0);
}

/**
 * A compact, read-only inventory for assistants: names, tags, categories,
 * logical collections (with creator labels and token ranges) and signer
 * records. ABIs are left out; use the contract controls tool for those.
 */
export function contractInventory(state, { contractIds, query = '', limit = 60 } = {}) {
  const all = workspaceContractEntries(state);
  const groups = new Map(groupKeelContracts(all).flatMap((group) => group.entries.map((entry) => [entry.key, group.title])));
  const entries = all.filter((entry) => !contractIds || contractIds.includes(entry.key));
  const ranked = query ? [...entries].sort((a, b) => relevance(b, query) - relevance(a, query)) : entries;
  return ranked.slice(0, limit).map((entry) => {
    const contract = state.contracts.find((item) => item.id === entry.key);
    return {
      id: entry.key,
      name: displayName(entry),
      ...(entry.label && entry.label !== entry.name ? { recordedName: entry.name } : {}),
      description: describeKeelContract(entry),
      group: groups.get(entry.key),
      family: entry.family,
      standard: entry.standard,
      chainId: entry.chainId,
      network: chainLabel(entry.chainId),
      address: entry.address,
      ...(contract?.projectId ? { projectId: contract.projectId } : {}),
      ...(entry.category ? { category: entry.category } : {}),
      ...(entry.tags?.length ? { tags: entry.tags } : {}),
      ...(entry.notes ? { notes: entry.notes } : {}),
      ...(entry.pinned ? { pinned: true } : {}),
      ...(entry.archived ? { archived: true } : {}),
      proxy: entry.proxy,
      collections: entry.collections.map((item) => ({ key: item.key, name: item.label ?? item.name, ...(item.label && item.name && item.label !== item.name ? { recordedName: item.name } : {}), kind: item.kind, ...(item.externalId ? { externalId: item.externalId } : {}), ...(item.tokenIds ? { tokenIds: item.tokenIds } : {}), ...(item.open !== undefined ? { open: item.open } : {}), ...(item.tags?.length ? { tags: item.tags } : {}) })),
      signers: entry.signers.map((item) => ({ label: item.label, role: item.role, flow: item.flow, status: item.status, ...(item.address ? { address: item.address } : {}), ...(item.bridge ? { bridge: { server: item.bridge.server, queue: item.bridge.queue } } : {}) })),
      controls: contract?.abi.filter((item) => item.type === 'function').length ?? 0,
      authority: 'unverified',
    };
  });
}
