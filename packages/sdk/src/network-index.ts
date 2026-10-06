/** Deployed KEEL networks come from the deployment index, not a wallet/faucet catalog. */
import config from './networks.config.json' with { type: 'json' };
import { KEEL_DEPLOYMENTS, type KeelDeployment } from './modules.generated.js';
import { remoteUrlAllowed } from '@keel/protocol';

export interface KeelIndexedNetwork {
  readonly id: string;
  readonly family: 'ethereum';
  readonly chainId: number;
  readonly name: string;
  readonly environment: string;
  readonly explorerUrl?: string;
  readonly defaultInstance?: string;
  readonly rpcUrls: readonly string[];
  readonly deployments: readonly KeelDeployment[];
}
export interface KeelNetworkIndex {
  readonly schema: 'keel-network-index@1';
  readonly defaultChainId: number;
  readonly networks: readonly KeelIndexedNetwork[];
}
export interface KeelNetworkSelection {
  readonly chainId?: number;
  readonly instance?: string;
  readonly indexUrl?: string;
}
export const KEEL_NETWORK_INDEX_URL = config.indexUrl;
export const KEEL_NETWORK_CONFIGURATION = config;

/** New recorded chains appear automatically. A configured RPC/active instance is separate. */
export function buildKeelNetworkIndex(deployments: readonly KeelDeployment[] = KEEL_DEPLOYMENTS,
  settings: { defaultChainId: number; networks: readonly { chainId: number; name: string; environment: string; explorerUrl?: string; defaultInstance?: string; rpcUrls: readonly string[] }[] } = config): KeelNetworkIndex {
  return parseKeelNetworkIndex({ schema: 'keel-network-index@1', defaultChainId: settings.defaultChainId,
    networks: [...new Set(deployments.map(d => d.chainId))].sort((a,b) => a-b).map(chainId => {
      const policy = settings.networks.find(n => n.chainId === chainId);
      return { ...policy, id: `eip155:${chainId}`, family: 'ethereum', chainId,
        name: policy?.name ?? `EVM chain ${chainId}`, environment: policy?.environment ?? 'unspecified',
        rpcUrls: policy?.rpcUrls ?? [], deployments: deployments.filter(d => d.chainId === chainId) };
    }) });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid KEEL network index object.');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 256): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
export function normalizeKeelIndexUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError('KEEL index URL must be public HTTPS.'); }
  if (value.length > 2048 || url.protocol !== 'https:' || url.username || url.password || url.hash || !remoteUrlAllowed(url.href, [], false)) throw new TypeError('KEEL index URL must be public HTTPS.');
  return url.href;
}
export function parseKeelNetworkIndex(value: unknown): KeelNetworkIndex {
  const v = object(value);
  if (v.schema !== 'keel-network-index@1' || !Number.isSafeInteger(v.defaultChainId) || Number(v.defaultChainId) < 1 || !Array.isArray(v.networks) || !v.networks.length || v.networks.length > 100) throw new TypeError('Invalid KEEL network index schema/default/networks.');
  const chains = new Set<number>();
  const networks = v.networks.map(value => {
    const n = object(value), chainId = Number(n.chainId);
    if (!Number.isSafeInteger(n.chainId) || chainId < 1 || n.id !== `eip155:${chainId}` || n.family !== 'ethereum' || chains.has(chainId) || !text(n.name) || !text(n.environment) || !Array.isArray(n.rpcUrls) || n.rpcUrls.length > 6 || !Array.isArray(n.deployments) || !n.deployments.length || n.deployments.length > 1000) throw new TypeError('Invalid/duplicate KEEL network or missing deployment records.');
    chains.add(chainId);
    const rpcUrls = n.rpcUrls.map(value => { if (!text(value, 2048)) throw new TypeError('Invalid indexed RPC URL.'); return normalizeKeelIndexUrl(value); });
    const keys = new Set<string>();
    const deployments = n.deployments.map(value => {
      const d = object(value), key = `${d.instance}:${d.module}:${d.contract}`;
      if (d.chainId !== chainId || !text(d.instance) || !text(d.module) || !text(d.contract) || !/^0x[0-9a-fA-F]{40}$/u.test(String(d.address)) || keys.has(key)
        || d.txHash !== null && !/^0x[0-9a-fA-F]{64}$/u.test(String(d.txHash)) || d.block !== null && !/^\d+$/u.test(String(d.block))
        || d.runtimeCodeHash !== undefined && !/^0x[0-9a-fA-F]{64}$/u.test(String(d.runtimeCodeHash))) throw new TypeError('Invalid, conflicting or cross-chain deployment record.');
      keys.add(key);
      return Object.freeze({ module: d.module, chainId, instance: d.instance, contract: d.contract, address: d.address,
        block: d.block, txHash: d.txHash, ...(d.runtimeCodeHash === undefined ? {} : { runtimeCodeHash: d.runtimeCodeHash }) }) as KeelDeployment;
    });
    if (n.defaultInstance !== undefined && (!text(n.defaultInstance) || !deployments.some(d => d.instance === n.defaultInstance))) throw new TypeError('Active instance is not recorded on this chain.');
    return Object.freeze({ id: n.id, family: 'ethereum', chainId, name: n.name, environment: n.environment,
      ...(n.explorerUrl === undefined ? {} : { explorerUrl: normalizeKeelIndexUrl(String(n.explorerUrl)) }),
      ...(n.defaultInstance === undefined ? {} : { defaultInstance: n.defaultInstance }),
      rpcUrls: Object.freeze(rpcUrls), deployments: Object.freeze(deployments) }) as KeelIndexedNetwork;
  });
  if (!chains.has(Number(v.defaultChainId))) throw new TypeError('Default chain is not a deployed KEEL network.');
  return Object.freeze({ schema: 'keel-network-index@1', defaultChainId: Number(v.defaultChainId), networks: Object.freeze(networks) });
}
export const KEEL_BUNDLED_NETWORK_INDEX = buildKeelNetworkIndex();

export function resolveKeelIndexedNetwork(index: KeelNetworkIndex, selection: KeelNetworkSelection = {}): KeelIndexedNetwork {
  const chainId = selection.chainId ?? index.defaultChainId;
  const network = index.networks.find(n => n.chainId === chainId);
  if (!network) throw new Error(`KEEL has no indexed deployments on chain ${chainId}. Discover available networks before preparing a publication.`);
  if (selection.instance !== undefined && !network.deployments.some(d => d.instance === selection.instance)) throw new Error('Selected deployment instance is not recorded on the selected chain.');
  return network;
}
export function resolveKeelCreatorTarget(index: KeelNetworkIndex, selection: KeelNetworkSelection = {}) {
  const network = resolveKeelIndexedNetwork(index, selection), instance = selection.instance ?? network.defaultInstance;
  if (!instance) throw new Error('Choose a recorded creator deployment instance in .keel/config.json.');
  const deployments = network.deployments.filter(d => d.instance === instance);
  const contract = (name: string) => {
    const matches = deployments.filter(d => d.contract === name);
    if (matches.length !== 1) throw new Error(`Selected creator instance does not uniquely record ${name}.`);
    return matches[0]!.address;
  };
  return { chainId: network.chainId, instance, store: contract('KeelHold'), factory: contract('KeelCreatorFactory'),
    renderer: contract('KeelArtifactTokenRenderer'), mintRoutes: contract('KeelMintRouteRegistry'),
    deployments, verification: 'receipt-runtime-binding-readback-required' as const };
}

export class KeelNetworkIndexError extends Error {
  readonly code = 'network.index-unavailable';
  readonly setup = { configFile: '.keel/config.json', discoveryTool: 'keel-network-discover', instructions: 'Check the KEEL deployment index URL/connectivity in .keel/config.json or KEEL_NETWORK_INDEX_URL. Do not select a different chain or infer deployments from wallet/faucet lists.' };
  constructor() { super('The configured KEEL deployment index could not be validated. Check connectivity/configuration and run keel-network-discover.'); this.name = 'KeelNetworkIndexError'; }
}
export async function fetchKeelNetworkIndex(options: { indexUrl?: string; fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): Promise<KeelNetworkIndex> {
  const url = normalizeKeelIndexUrl(options.indexUrl ?? KEEL_NETWORK_INDEX_URL);
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, { signal, redirect: 'error', headers: { accept: 'application/json' } });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 1024 * 1024 || !response.body) throw new Error();
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 1024 * 1024) throw new Error(); chunks.push(value); } }
    finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return parseKeelNetworkIndex(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch { options.signal?.throwIfAborted(); throw new KeelNetworkIndexError(); }
}
