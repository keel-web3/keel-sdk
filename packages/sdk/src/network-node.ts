/** Workspace selection is public configuration; provider credentials remain in rpc.json. */
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fetchKeelNetworkIndex, normalizeKeelIndexUrl, resolveKeelIndexedNetwork, KEEL_NETWORK_INDEX_URL, type KeelNetworkSelection, type KeelNetworkIndex } from './network-index.js';

export interface KeelNetworkEnvironment {
  readonly KEEL_CHAIN_ID?: string;
  readonly KEEL_DEPLOYMENT_INSTANCE?: string;
  readonly KEEL_NETWORK_INDEX_URL?: string;
}
export async function readKeelNetworkConfiguration(workspace = process.cwd()): Promise<KeelNetworkSelection> {
  const root = await realpath(workspace), path = resolve(root, '.keel/config.json');
  let actual: string;
  try { actual = await realpath(path); } catch (error) { if ((error as { code?: string }).code === 'ENOENT') return {}; throw new Error('Cannot read .keel/config.json.'); }
  const local = relative(root, actual);
  if (local === '..' || local.startsWith('../') || isAbsolute(local)) throw new Error('KEEL configuration must remain inside the workspace.');
  const info = await stat(actual);
  if (!info.isFile() || info.size > 16384) throw new Error('KEEL configuration must be a bounded regular JSON file.');
  try {
    const bytes = await readFile(actual); if (bytes.length > 16384) throw new Error();
    const v = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['schema', 'chainId', 'instance', 'indexUrl'].includes(k)) || v.schema !== undefined && v.schema !== 'keel-workspace-config@1'
      || v.chainId !== undefined && (!Number.isSafeInteger(v.chainId) || Number(v.chainId) < 1)
      || v.instance !== undefined && (typeof v.instance !== 'string' || !v.instance.length || v.instance.length > 256)
      || v.indexUrl !== undefined && typeof v.indexUrl !== 'string') throw new Error();
    return { ...(v.chainId === undefined ? {} : { chainId: Number(v.chainId) }), ...(v.instance === undefined ? {} : { instance: v.instance as string }),
      ...(v.indexUrl === undefined ? {} : { indexUrl: normalizeKeelIndexUrl(v.indexUrl as string) }) };
  } catch { throw new Error('Invalid .keel/config.json. Configure chainId, instance and/or public HTTPS indexUrl; keep provider API keys in .keel/rpc.json.'); }
}
export async function resolveKeelNodeNetworkSelection(options: { workspace?: string; explicit?: KeelNetworkSelection; environment?: KeelNetworkEnvironment } = {}): Promise<KeelNetworkSelection> {
  const file = await readKeelNetworkConfiguration(options.workspace), env = options.environment ?? process.env, explicit = options.explicit ?? {};
  const chainId = explicit.chainId ?? (env.KEEL_CHAIN_ID === undefined ? undefined : Number(env.KEEL_CHAIN_ID)) ?? file.chainId;
  const instance = explicit.instance ?? env.KEEL_DEPLOYMENT_INSTANCE ?? file.instance;
  if (chainId !== undefined && (!Number.isSafeInteger(chainId) || chainId < 1)) throw new TypeError('Configured chainId must be a positive safe integer.');
  if (instance !== undefined && (!instance.length || instance.length > 256)) throw new TypeError('Configured deployment instance is invalid.');
  return { ...(chainId === undefined ? {} : { chainId }), ...(instance === undefined ? {} : { instance }),
    indexUrl: normalizeKeelIndexUrl(explicit.indexUrl ?? env.KEEL_NETWORK_INDEX_URL ?? file.indexUrl ?? KEEL_NETWORK_INDEX_URL) };
}
const cache = new Map<string, { fetchedAt: number; index: KeelNetworkIndex }>();
export async function discoverKeelNodeNetworks(options: { workspace?: string; explicit?: KeelNetworkSelection; environment?: KeelNetworkEnvironment; fetchImpl?: typeof fetch; refresh?: boolean } = {}) {
  const selection = await resolveKeelNodeNetworkSelection(options), indexUrl = selection.indexUrl!;
  let entry = !options.refresh && !options.fetchImpl ? cache.get(indexUrl) : undefined;
  if (!entry || Date.now() - entry.fetchedAt > 60000) {
    const index = await fetchKeelNetworkIndex({ indexUrl, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
    entry = { fetchedAt: Date.now(), index };
    if (!options.fetchImpl) { if (cache.size > 8) cache.clear(); cache.set(indexUrl, entry); }
  }
  const network = resolveKeelIndexedNetwork(entry.index, selection);
  return { indexUrl, index: entry.index, selection: { ...selection, chainId: network.chainId }, network, source: 'public-index' as const };
}
