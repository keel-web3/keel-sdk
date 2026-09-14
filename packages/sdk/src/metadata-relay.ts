import { encodeFunctionData, parseAbi, isAddress, zeroAddress, type Address, type Hex } from 'viem';

export const keelMetadataRelayAbi = parseAbi([
  'function sync(bytes32 watchId,uint256 cursor,uint256 count) returns (uint256 next)',
  'function deliver(uint256 id,uint32 deliveryGas)',
  'function followerCount(bytes32 id) view returns (uint256)',
  'function followerAt(bytes32 id,uint256 index) view returns (uint256)',
  'function subscriptions(uint256 id) view returns (address collection,uint64 generation,bool editions,bool active,bool complete,bytes32 watchId,uint256 first,uint256 last,uint256 cursor)',
  'event DependencyRegistered(bytes32 indexed watchId,address indexed source,bytes query,uint32 readGas)',
]);
export const keelMetadataConsumerAbi = parseAbi([
  'function subscribeMetadataDependency(address source,bytes query,uint32 readGas,uint256 first,uint256 last) returns (uint256)',
  'function setMetadataRelay(address relay)',
  'function removeMetadataDependency(address relay,uint256 id)',
]);
export const keelMetadataDependencyAbi = parseAbi([
  'function metadataDependency(uint256 tokenId) view returns (address target,bytes query,uint256 first,uint256 last)',
]);

/** Both StoredTokenJSON and TokenMatrix expose this discovery call. The latter
 * returns the complete row-block range, so it needs one subscription per block.
 * Preparation performs no signing or publication.
 */
export async function prepareKeelMetadataDependency(options: {
  source: Address;
  tokenId: bigint;
  readDependency: (source: Address, tokenId: bigint) => Promise<readonly [Address, Hex, bigint, bigint]>;
  readGas?: number;
}) {
  const [collection, query, first, last] = await options.readDependency(options.source, options.tokenId);
  if (!isAddress(collection) || collection === zeroAddress || !isAddress(options.source) || options.source === zeroAddress || query.length < 10 || query.length > 2050) throw new Error('Invalid metadata dependency');
  const readGas = options.readGas ?? 100_000;
  if (!Number.isInteger(readGas) || readGas < 25_000 || readGas > 2_000_000 || first > last) throw new Error('Invalid metadata dependency');
  return { to: collection, value: 0n, data: encodeFunctionData({
    abi: keelMetadataConsumerAbi, functionName: 'subscribeMetadataDependency',
    args: [options.source, query, readGas, first, last],
  }), collection, source: options.source, query, first, last };
}

export type MetadataRelayWork =
  | { kind: 'sync'; watchId: Hex; cursor: bigint; count: bigint }
  | { kind: 'deliver'; subscriptionId: bigint };
export type MetadataRelayState = {
  cursors: Record<string, string>;
  watchCursor?: number;
  pending: string[];
  inFlight?: { hash: Hex; work: MetadataRelayWork };
};
export type MetadataRelayPorts = {
  /** Discover DependencyRegistered logs on the selected chain, starting at relay deployment. */
  watches: () => Promise<readonly Hex[]>;
  followerCount: (watchId: Hex) => Promise<bigint>;
  followerAt: (watchId: Hex, index: bigint) => Promise<bigint>;
  subscription: (id: bigint) => Promise<{ active: boolean; complete: boolean }>;
  /** Must simulate, then submit to the configured relay on the same chain. */
  submit: (work: MetadataRelayWork) => Promise<Hex>;
  /** Resolve only after a confirmed receipt; throw on a reverted or uncertain receipt. */
  confirm: (hash: Hex) => Promise<void | 'success' | 'reverted'>;
  /** Persist before waiting for confirmation. Bigints in work need a bigint-aware serializer. */
  save: (state: MetadataRelayState) => Promise<void>;
};

/** A resumable, bounded delivery cycle. Confirmation uncertainty retains the
 * submitted hash, so a later cycle confirms it instead of blindly resubmitting.
 * The contract owns generation/cursor truth; this state is only a work journal.
 */
export async function runKeelMetadataRelayCycle(ports: MetadataRelayPorts, state: MetadataRelayState, budget = 8) {
  if (!Number.isInteger(budget) || budget < 2 || budget > 64) throw new Error('Invalid relay work budget');
  async function finish() {
    const flight = state.inFlight;
    if (!flight) return;
    const outcome = await ports.confirm(flight.hash);
    if (outcome === 'reverted') {
      delete state.inFlight;
      await ports.save(state);
      throw new Error('Metadata relay transaction reverted');
    }
    if (flight.work.kind === 'sync') {
      const work = flight.work;
      const total = await ports.followerCount(work.watchId);
      const end = work.cursor + work.count < total ? work.cursor + work.count : total;
      for (let i = work.cursor; i < end; ++i) {
        const id = (await ports.followerAt(work.watchId, i)).toString();
        if (!state.pending.includes(id)) state.pending.push(id);
      }
      state.cursors[work.watchId] = end >= total ? '0' : end.toString();
    }
    delete state.inFlight;
    await ports.save(state);
  }
  await finish();
  let submitted = 0;
  async function send(work: MetadataRelayWork) {
    const hash = await ports.submit(work);
    state.inFlight = { hash, work };
    await ports.save(state);
    await finish();
    ++submitted;
  }
  const errors: unknown[] = [];
  async function attempt(work: MetadataRelayWork) {
    try { await send(work); }
    catch (error) {
      if (state.inFlight) throw error;
      // A rejected simulation or confirmed revert must not starve other sources.
      ++submitted;
      errors.push(error);
    }
  }
  const pendingBudget = Math.min(state.pending.length, Math.floor(budget / 2));
  for (let i = 0; i < pendingBudget; ++i) {
    const id = state.pending.shift()!;
    try {
      const sub = await ports.subscription(BigInt(id));
      if (!sub.active || sub.complete) continue;
      state.pending.push(id);
      await attempt({ kind: 'deliver', subscriptionId: BigInt(id) });
    } catch (error) {
      if (!state.pending.includes(id)) state.pending.push(id);
      if (state.inFlight) throw error;
      errors.push(error);
    }
  }
  const watches = [...new Set(await ports.watches())];
  const start = (state.watchCursor ?? 0) % Math.max(watches.length, 1);
  for (let offset = 0; offset < watches.length && submitted < budget; ++offset) {
    const index = (start + offset) % watches.length;
    const watchId = watches[index]!;
    state.watchCursor = (index + 1) % watches.length;
    try {
      const total = await ports.followerCount(watchId);
      if (total === 0n) continue;
      const saved = BigInt(state.cursors[watchId] ?? '0');
      const cursor = saved < total ? saved : 0n;
      await attempt({ kind: 'sync', watchId, cursor, count: 4n });
    } catch (error) {
      if (state.inFlight) throw error;
      errors.push(error);
    }
  }
  await ports.save(state);
  return { submitted, pending: state.pending.length, errors };
}

/** Attach to the service's confirmed-block feed. There is only one writer;
 * a block arriving during delivery schedules another cycle rather than racing it.
 */
export function startKeelMetadataRelay(options: {
  ports: MetadataRelayPorts;
  state: MetadataRelayState;
  watchBlocks: (changed: () => void) => () => void;
  onError: (error: unknown) => void;
  budget?: number;
}) {
  let stopped = false, busy = false, queued = false;
  async function pump() {
    queued = true;
    if (busy || stopped) return;
    busy = true;
    try {
      while (queued && !stopped) {
        queued = false;
        const result = await runKeelMetadataRelayCycle(options.ports, options.state, options.budget);
        for (const error of result.errors) options.onError(error);
      }
    } catch (error) { options.onError(error); }
    finally { busy = false; }
  }
  const stop = options.watchBlocks(() => { void pump(); });
  void pump();
  return () => { stopped = true; stop(); };
}

/** Concrete viem adapter. Watch IDs come from the application's authorized
 * collection registry; do not fund arbitrary subscriptions discovered globally.
 */
export function createKeelMetadataRelayPorts(options: {
  publicClient: import('viem').PublicClient;
  walletClient: import('viem').WalletClient;
  account: Address | import('viem').Account;
  chainId: number;
  relay: Address;
  watches: MetadataRelayPorts['watches'];
  save: MetadataRelayPorts['save'];
  confirmations?: number;
  deliveryGas?: number;
}): MetadataRelayPorts {
  const { publicClient: client, walletClient: wallet, relay } = options;
  return {
    watches: options.watches,
    save: options.save,
    followerCount: id => client.readContract({address:relay,abi:keelMetadataRelayAbi,functionName:'followerCount',args:[id]}),
    followerAt: (id,index) => client.readContract({address:relay,abi:keelMetadataRelayAbi,functionName:'followerAt',args:[id,index]}),
    subscription: async id => {
      const result = await client.readContract({address:relay,abi:keelMetadataRelayAbi,functionName:'subscriptions',args:[id]});
      return { active: result[3], complete: result[4] };
    },
    submit: async work => {
      const [readChain, writeChain] = await Promise.all([client.getChainId(),wallet.getChainId()]);
      if (readChain !== options.chainId || writeChain !== options.chainId) throw new Error('Metadata relay chain mismatch');
      if (work.kind === 'sync') {
        const { request } = await client.simulateContract({address:relay,abi:keelMetadataRelayAbi,functionName:'sync',args:[work.watchId,work.cursor,work.count],account:options.account});
        return wallet.writeContract({...request,chain:wallet.chain});
      }
      const { request } = await client.simulateContract({address:relay,abi:keelMetadataRelayAbi,functionName:'deliver',args:[work.subscriptionId,options.deliveryGas ?? 1_000_000],account:options.account});
      return wallet.writeContract({...request,chain:wallet.chain});
    },
    confirm: async hash => (await client.waitForTransactionReceipt({hash,confirmations:options.confirmations ?? 2})).status,
  };
}

const revisionQueryAbi = parseAbi([
  'function latestArtifactRevision(bytes32 id) view returns (uint64)',
  'function latestHarnessRevision(bytes32 id) view returns (uint64)',
  'function presentationPolicy(bytes32 id) view',
  'function presentationBuilders(bytes32 id) view returns (address)',
  'function artistViewerConfigured(address artist) view returns (bool)',
]);

/** Pinned consumers do not subscribe to latest-revision pointers. A custom
 * fixed-revision getter can still be supplied to the generic subscription API.
 */
export function keelMetadataRevisionQuery(options:
  | { kind:'artifact'|'harness'|'presentation'|'link-builder'; id:Hex; pinned?:boolean }
  | { kind:'artist-viewer'; artist:Address; pinned?:boolean }
): Hex | undefined {
  if (options.pinned) return undefined;
  if (options.kind === 'artist-viewer') return encodeFunctionData({abi:revisionQueryAbi,functionName:'artistViewerConfigured',args:[options.artist]});
  const names = {artifact:'latestArtifactRevision',harness:'latestHarnessRevision',presentation:'presentationPolicy','link-builder':'presentationBuilders'} as const;
  return encodeFunctionData({abi:revisionQueryAbi,functionName:names[options.kind],args:[options.id]});
}
