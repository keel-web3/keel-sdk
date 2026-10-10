import { createKeelRpcPool, KeelRpcResponseError, normalizeKeelRpcUrl, type KeelRpcPoolOptions } from "./rpc.js";
import { createPinnedKeelSepoliaSimulationTransport } from "./simulation-connection.js";
import { KeelPublicationSimulationError, keelSimulationTransportDiagnostic, keelSimulationTransportFailure, type KeelPreflightTransport } from "./publication-preflight.js";
import { assertKeelAmsterdamSimulationHeader, resolveKeelTransactionGasPolicy } from "./transaction-gas-policy.js";

export interface KeelPublicSimulationPoolOptions {
  /** Selected registry endpoint followed by the maintained indexed public pool. */
  readonly rpcUrls: readonly string[];
  /** Explicit recipients for project data; membership in a public index is not approval. */
  readonly approvedProjectRpcUrls: readonly string[];
  /** Existing selected-chain reader; initial reader/runtime reads stay here. */
  readonly readTransport: KeelPreflightTransport;
  readonly block: { readonly number: bigint; readonly hash: string };
  readonly fetchImpl?: typeof fetch;
  readonly minIntervalMs?: number;
  readonly onAttempt?: (diagnostic: Readonly<Record<string, string | number>>) => void;
}
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const quantity = (value: unknown): bigint | undefined => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(value) ? BigInt(value) : undefined;
// Retain the maintained pool's rate-limit cooldown across new reviews/reloads.
// Test-injected fetchers are isolated; production candidates share only RPC
// transport state, never a creator's proof, request, or selected block.
const sharedPools = new Map<string, ReturnType<typeof createKeelRpcPool>>();

/** Capability-aware selection over the existing RPC pool. Each candidate keeps
 * its own pacing/cooldowns and cannot swap underneath qualification or a request.
 * Every simulation contains its complete ordered state sequence. Public probes
 * establish compatibility, not the private program's aggregate execution budget. */
export function createKeelPublicSepoliaSimulationPool(options: KeelPublicSimulationPoolOptions): KeelPreflightTransport & { close(): Promise<void> } {
  const urls = [...new Set(options.rpcUrls.map(url => normalizeKeelRpcUrl(url)))];
  const approved = new Set(options.approvedProjectRpcUrls.map(url => normalizeKeelRpcUrl(url)));
  if ([...approved].some(url => !urls.includes(url)) || typeof options.block.number !== "bigint" || options.block.number < 0n || !/^0x[0-9a-f]{64}$/iu.test(options.block.hash))
    throw new KeelPublicationSimulationError("configuration-invalid", "Publication needs explicit configured recipients and a selected block.");
  const block = { ...options.block }, blockTag = `0x${block.number.toString(16)}`;
  const poolKey = JSON.stringify([urls, options.minIntervalMs ?? 250]);
  const pool = (!options.fetchImpl ? sharedPools.get(poolKey) : undefined) ?? createKeelRpcPool({ rpcUrls: urls, chainId: 11155111, timeoutMs: 30_000, simulationTimeoutMs: 90_000, maxResponseBytes: 64 * 1024 * 1024,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), ...(options.minIntervalMs === undefined ? {} : { minIntervalMs: options.minIntervalMs }) } satisfies KeelRpcPoolOptions);
  if (!options.fetchImpl) { sharedPools.set(poolKey, pool); if (sharedPools.size > 16) sharedPools.delete(sharedPools.keys().next().value!); }
  const abort = new AbortController(), rejected = new Set<number>();
  type Candidate = { index: number; transport: ReturnType<typeof createPinnedKeelSepoliaSimulationTransport> };
  let selected: Candidate | undefined, cursor = 0, closed = false;
  // One ordered stream per publication transport. Separate publications retain
  // their own snapshot and cancellation; no shared process singleton can poison them.
  let tail: Promise<unknown> = Promise.resolve();
  const create = (index: number): Candidate => {
    const pinned = pool.pin(index);
    const transport = createPinnedKeelSepoliaSimulationTransport(async () => ({ protocol: "https", close() {}, async requestAsync({ body }) {
      try { return { result: await pinned.request({ ...body, signal: abort.signal }) }; }
      catch (error) {
        if (error instanceof KeelRpcResponseError) return { error };
        throw error;
      }
    } }), { maximumConnectionAttempts: 1 });
    return { index, transport };
  };
  const qualifySequence = async (candidate: Candidate, snapshot: Record<string, unknown>, gasLimits: readonly bigint[]) => {
    const zero = `0x${"0".repeat(40)}`, hex = (n: bigint) => `0x${n.toString(16)}`;
    const publicRead = (method: string, params: readonly unknown[]) => candidate.transport.request({ method, params });
    const nonce = quantity(await publicRead("eth_getTransactionCount", [zero, blockTag]));
    const balance = quantity(await publicRead("eth_getBalance", [zero, blockTag]));
    const code = await publicRead("eth_getCode", [zero, blockTag]);
    const baseFee = quantity(snapshot.baseFeePerGas), timestamp = quantity(snapshot.timestamp), blockGasLimit = quantity(snapshot.gasLimit);
    const unsupported = (): never => { throw new KeelPublicationSimulationError("unsupported-simulation", "The public complete-sequence check did not return exact fork and transaction evidence."); };
    if (nonce === undefined || balance === undefined || baseFee === undefined || timestamp === undefined || blockGasLimit === undefined || code !== "0x"
      || nonce + BigInt(gasLimits.length) > 18_446_744_073_709_551_615n) unsupported();
    const policy = resolveKeelTransactionGasPolicy({ chainId: 11155111, blockTimestamp: timestamp!, blockGasLimit: blockGasLimit! });
    const gasPrice = baseFee! * 2n + 1n;
    if (gasLimits.some(gas => gas < 21_000n || gas > policy.maximumTotalGas)) throw new KeelPublicationSimulationError("configuration-invalid", "The complete program exceeds selected-chain transaction gas bounds.");
    // Conservative upfront-balance check for public constants only. Never fund or
    // override this account; a missing probe precondition cannot grant a proof.
    if (balance! < gasLimits.reduce((sum, gas) => sum + gas, 0n) * gasPrice) unsupported();
    const blockStateCalls = gasLimits.map((gas, i) => ({ calls: [{ from: zero, to: zero, data: "0x", value: "0x0", gas: hex(gas), nonce: hex(nonce! + BigInt(i)), gasPrice: hex(gasPrice) }] }));
    for (const validation of [false, true]) {
      const result = await candidate.transport.request({ method: "eth_simulateV1", params: [{ blockStateCalls, validation, traceTransfers: false, returnFullTransactions: true }, blockTag] });
      if (!Array.isArray(result) || result.length !== gasLimits.length) unsupported();
      let parent = snapshot;
      for (const [i, value] of (result as unknown[]).entries()) {
        const header = object(value), calls = header?.calls, transactions = header?.transactions;
        const call = Array.isArray(calls) && calls.length === 1 ? object(calls[0]) : undefined;
        const tx = Array.isArray(transactions) && transactions.length === 1 ? object(transactions[0]) : undefined;
        const used = quantity(call?.gasUsed), maximum = quantity(call?.maxUsedGas), slot = quantity(parent.slotNumber);
        try { assertKeelAmsterdamSimulationHeader(policy, value, { hash: String(parent.hash), number: quantity(parent.number) ?? -1n,
          timestamp: quantity(parent.timestamp) ?? -1n, ...(slot === undefined ? {} : { slotNumber: slot }) }); } catch { unsupported(); }
        if (!header || call?.status !== "0x1" || call.error !== undefined || call.returnData !== "0x" || used === undefined || used <= 0n
          || maximum === undefined || maximum < used || maximum > gasLimits[i]! || quantity(tx?.nonce) !== nonce! + BigInt(i) || quantity(tx?.gasPrice) !== gasPrice) unsupported();
        parent = header!;
      }
    }
  };
  const request = async (exact: Parameters<KeelPreflightTransport["request"]>[0]) => {
    if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The publication check was cancelled.");
    if (!["eth_chainId", "eth_getBlockByNumber", "eth_getTransactionCount", "eth_getBalance", "eth_getCode", "eth_simulateV1"].includes(exact.method))
      throw new KeelPublicationSimulationError("configuration-invalid", "Publication transport accepts only reads and ephemeral simulation.");
    if (exact.method !== "eth_simulateV1") {
      const result = await options.readTransport.request(exact);
      if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The publication check was cancelled.");
      if (exact.method === "eth_getBlockByNumber" && exact.params[0] === blockTag
        && (object(result)?.hash !== block.hash || object(result)?.number !== blockTag))
        throw new KeelPublicationSimulationError("chain-reorganized", "The selected read provider's block changed. Recheck the saved plan.");
      return result;
    }
    const program = object(exact.params[0]), blocks = program?.blockStateCalls;
    if (exact.params.length !== 2 || exact.params[1] !== blockTag || !program || !Array.isArray(blocks) || !blocks.length || blocks.length > 256
      || Object.keys(program).some(key => !["blockStateCalls", "validation", "traceTransfers", "returnFullTransactions"].includes(key))
      || typeof program.validation !== "boolean" || program.traceTransfers !== false || program.returnFullTransactions !== true)
      throw new KeelPublicationSimulationError("configuration-invalid", "Keep the complete override-free simulation at its selected numbered block.");
    let requiredGas = 0n; const gasLimits: bigint[] = [];
    for (const item of blocks) {
      const state = object(item), calls = state?.calls, call = Array.isArray(calls) && calls.length === 1 ? object(calls[0]) : undefined, gas = quantity(call?.gas);
      if (!state || Object.keys(state).some(key => key !== "calls") || !call || gas === undefined || gas <= 0n || gas > 18_446_744_073_709_551_615n
        || Object.keys(call).some(key => !["from", "to", "data", "value", "gas", "nonce", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"].includes(key)))
        throw new KeelPublicationSimulationError("configuration-invalid", "Keep every exact bounded call in its original simulation block.");
      if (gas > requiredGas) requiredGas = gas;
      gasLimits.push(gas);
    }
    let capacityFailure: KeelPublicationSimulationError | undefined, lastFailure: KeelPublicationSimulationError | undefined, awaitingApproval = false;
    const start = cursor;
    for (let offset = 0; offset < urls.length; offset++) {
      if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The publication check was cancelled.");
      const index = (start + offset) % urls.length;
      if (rejected.has(index)) continue;
      let candidate = selected?.index === index ? selected : create(index), projectRequest = false;
      try {
        const head = object(await pool.pin(index).request({ method: "eth_getBlockByNumber", params: ["latest", false], signal: abort.signal }));
        const headTime = quantity(head?.timestamp), headNumber = quantity(head?.number), now = BigInt(Math.floor(Date.now() / 1000));
        if (headTime === undefined || headNumber === undefined || headNumber < block.number || headTime + 180n < now || headTime > now + 30n)
          throw new KeelPublicationSimulationError("rpc-unavailable", "The candidate does not have a fresh selected-chain head. The saved plan is unchanged.");
        if ((candidate.transport.qualifiedProbeGas ?? 0n) < requiredGas) {
          if (candidate.transport.qualifiedProbeGas !== undefined) { await candidate.transport.close(); selected = undefined; candidate = create(index); }
          await candidate.transport.qualify(requiredGas);
        }
        const snapshot = object(await candidate.transport.request({ method: "eth_getBlockByNumber", params: [blockTag, false] }));
        if (snapshot?.number !== blockTag || typeof snapshot.hash !== "string" || snapshot.hash.toLowerCase() !== block.hash.toLowerCase())
          throw new KeelPublicationSimulationError("chain-reorganized", "The candidate did not match the exact selected block.");
        // Recheck every phase's entire envelope sequence, including larger
        // aggregate requests on an already-selected candidate. Empty calls cannot
        // prove the real program's gas use; the unchanged full replay still must.
        await qualifySequence(candidate, snapshot, gasLimits);
        if (!approved.has(urls[index]!)) { awaitingApproval = true; await candidate.transport.close(); continue; }
        projectRequest = true;
        const result = await candidate.transport.request(exact);
        selected = candidate; cursor = index;
        return result;
      } catch (error) {
        await candidate.transport.close(); if (selected === candidate) selected = undefined;
        if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The publication check was cancelled.");
        const classified = keelSimulationTransportFailure(error, { method: "eth_simulateV1", phase: projectRequest ? "project-request" : "public-qualification" });
        const failure = new KeelPublicationSimulationError(classified.kind, classified.message, { ...classified.diagnostic,
          // Conservative envelope sum, not measured execution gas. Bytes exclude
          // only the pool-owned JSON-RPC id/version envelope.
          requiredProgramGas: gasLimits.reduce((sum, gas) => sum + gas, 0n).toString(),
          requestPayloadBytes: new TextEncoder().encode(JSON.stringify(exact)).byteLength, blockCount: blocks.length, callCount: blocks.length });
        // Never reinterpret a deterministic transaction validation error or an
        // execution revert as a reason to try another backend for success.
        const code = failure.diagnostic?.rpcCode;
        const retryableRpcRejection = code === undefined || code === -32601
          || failure.kind === "provider-limit" && (failure.diagnostic?.providerGasCap !== undefined || failure.diagnostic?.httpStatus === 413);
        if (projectRequest && (!["provider-limit", "unsupported-simulation", "rpc-unavailable"].includes(failure.kind)
          || !retryableRpcRejection || code === -32602 || typeof code === "number" && code <= -38000 && code >= -38099)) throw failure;
        rejected.add(index); lastFailure = failure;
        if (failure.kind === "provider-limit") capacityFailure ??= failure;
        try { options.onAttempt?.({ ...keelSimulationTransportDiagnostic(failure), candidateIndex: index, candidateCount: urls.length }); } catch { /* Diagnostic observers cannot alter proof. */ }
      }
    }
    if (awaitingApproval) throw new KeelPublicationSimulationError("configuration-invalid", "A candidate passed public simulation checks but is not approved for private project data. The saved plan is unchanged.", { recipientApprovalRequired: 1 });
    throw capacityFailure ?? lastFailure ?? new KeelPublicationSimulationError("rpc-unavailable", "The configured simulation pool is unavailable. Retry the saved plan after provider recovery.");
  };
  return { request(input) { const exact = structuredClone(input); const pending = tail.then(() => request(exact)); tail = pending.catch(() => undefined); return pending; },
    async close() { closed = true; abort.abort(); await selected?.transport.close(); } };
}
