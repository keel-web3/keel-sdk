import { createKeelRpcPool, KeelRpcResponseError, normalizeKeelRpcUrl, type KeelRpcPoolOptions } from "./rpc.js";
import { createPinnedKeelSimulationTransport } from "./simulation-connection.js";
import { KeelPublicationSimulationError, keelSimulationTransportDiagnostic, keelSimulationTransportFailure, type KeelPreflightTransport } from "./publication-preflight.js";
import { assertKeelAmsterdamSimulationHeader, resolveKeelTransactionGasPolicy } from "./transaction-gas-policy.js";
import { KEEL_SIMULATION_CAPABILITY_MAXIMUM_AGE_MS, keelSimulationChainDefaults, keelSimulationProviderCapacityFailure, measureKeelSimulationProgram, measureKeelSimulationExecution,
  snapshotKeelSimulationProviderLimits, type KeelMeasuredSimulationProviderCapability, type KeelSimulationProviderLimits } from "./simulation-capacity-policy.js";

export interface KeelPublicSimulationPoolOptions {
  readonly chainId?: number;
  /** Selected registry endpoint followed by the maintained indexed public pool. */
  readonly rpcUrls: readonly string[];
  /** Explicit recipients for project data; membership in a public index is not approval. */
  readonly approvedProjectRpcUrls: readonly string[];
  /** Existing selected-chain reader; initial reader/runtime reads stay here. */
  readonly readTransport: KeelPreflightTransport;
  readonly block: { readonly number: bigint; readonly hash: string };
  readonly fetchImpl?: typeof fetch;
  readonly minIntervalMs?: number;
  /** Entire qualification + project request deadline; callers may only lower the 120s bound. */
  readonly requestTimeoutMs?: number;
  readonly onAttempt?: (diagnostic: Readonly<Record<string, string | number>>) => void;
  /** Facts measured by the operator, for configured recipients only. */
  readonly providerCapabilities?: readonly KeelMeasuredSimulationProviderCapability[];
  /** Measured facts expire; callers may only lower the five-minute maximum. */
  readonly capabilityMaximumAgeMs?: number;
  /** Exact request and response gas metrics, never a publication proof. */
  readonly onMeasurement?: (measurement: Readonly<Record<string, string | number>>) => void;
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
export function createKeelPublicSimulationPool(options: KeelPublicSimulationPoolOptions & { readonly chainId: number }): KeelPreflightTransport & { close(): Promise<void> } {
  const chainId = options.chainId, defaults = keelSimulationChainDefaults(chainId);
  const requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 120_000)
    throw new KeelPublicationSimulationError("configuration-invalid", "The complete simulation request needs a bounded deadline of at most 120 seconds.");
  const urls = [...new Set(options.rpcUrls.map(url => normalizeKeelRpcUrl(url)))];
  const approved = new Set(options.approvedProjectRpcUrls.map(url => normalizeKeelRpcUrl(url)));
  if ([...approved].some(url => !urls.includes(url)) || typeof options.block.number !== "bigint" || options.block.number < 0n || !/^0x[0-9a-f]{64}$/iu.test(options.block.hash))
    throw new KeelPublicationSimulationError("configuration-invalid", "Publication needs explicit configured recipients and a selected block.");
  const block = { ...options.block }, blockTag = `0x${block.number.toString(16)}`;
  const readTransport = options.readTransport, onAttempt = options.onAttempt, onMeasurement = options.onMeasurement;
  const capabilityMaximumAgeMs = options.capabilityMaximumAgeMs ?? KEEL_SIMULATION_CAPABILITY_MAXIMUM_AGE_MS;
  if (!Number.isSafeInteger(capabilityMaximumAgeMs) || capabilityMaximumAgeMs < 0 || capabilityMaximumAgeMs > KEEL_SIMULATION_CAPABILITY_MAXIMUM_AGE_MS)
    throw new KeelPublicationSimulationError("configuration-invalid", "Measured capacity facts must expire within five minutes.");
  const capabilities = new Map<number, { readonly limits: Readonly<KeelSimulationProviderLimits>; readonly expiresAt: number }>();
  const limitsFor = (index: number) => { const value = capabilities.get(index); return value && Date.now() <= value.expiresAt ? value.limits : undefined; };
  if (options.providerCapabilities !== undefined && (!Array.isArray(options.providerCapabilities) || options.providerCapabilities.length > urls.length))
    throw new KeelPublicationSimulationError("configuration-invalid", "Measured capabilities must identify existing configured providers.");
  for (const profile of options.providerCapabilities ?? []) {
    if (!profile || profile.chainId !== chainId || typeof profile.rpcUrl !== "string" || typeof profile.measuredAt !== "string"
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(profile.measuredAt) || !Number.isFinite(Date.parse(profile.measuredAt))
      || Date.parse(profile.measuredAt) > Date.now()
      || new Date(profile.measuredAt).toISOString().replace(/\.000Z$/u, "Z") !== profile.measuredAt.replace(/\.000Z$/u, "Z"))
      throw new KeelPublicationSimulationError("configuration-invalid", "A measured capacity profile needs the exact selected chain and observation time.");
    const index = urls.indexOf(normalizeKeelRpcUrl(profile.rpcUrl));
    if (index < 0 || capabilities.has(index)) throw new KeelPublicationSimulationError("configuration-invalid", "Capacity profiles cannot add recipients or repeat a provider.");
    capabilities.set(index, { limits: snapshotKeelSimulationProviderLimits(profile.limits), expiresAt: Date.parse(profile.measuredAt) + capabilityMaximumAgeMs });
  }
  const poolKey = JSON.stringify([chainId, urls, options.minIntervalMs ?? 250]);
  const pool = (!options.fetchImpl ? sharedPools.get(poolKey) : undefined) ?? createKeelRpcPool({ rpcUrls: urls, chainId, timeoutMs: 30_000, simulationTimeoutMs: 90_000, maxResponseBytes: 64 * 1024 * 1024,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), ...(options.minIntervalMs === undefined ? {} : { minIntervalMs: options.minIntervalMs }) } satisfies KeelRpcPoolOptions);
  if (!options.fetchImpl) { sharedPools.set(poolKey, pool); if (sharedPools.size > 16) sharedPools.delete(sharedPools.keys().next().value!); }
  const abort = new AbortController(), rejected = new Set<number>();
  const capacityRejected = new Map<number, { cap: bigint; scope: string; expiresAt: number; failure: KeelPublicationSimulationError }>();
  const capacityFor = (index: number) => { const value = capacityRejected.get(index); return value && Date.now() <= value.expiresAt ? value : undefined; };
  type Candidate = { index: number; transport: ReturnType<typeof createPinnedKeelSimulationTransport> };
  let selected: Candidate | undefined, cursor = 0, closed = false;
  // One ordered stream per publication transport. Separate publications retain
  // their own snapshot and cancellation; no shared process singleton can poison them.
  let tail: Promise<unknown> = Promise.resolve();
  const create = (index: number): Candidate => {
    const pinned = pool.pin(index);
    const transport = createPinnedKeelSimulationTransport(async () => ({ protocol: "https", close() {}, async requestAsync({ body }) {
      try { return { result: await pinned.request({ ...body, signal: abort.signal }) }; }
      catch (error) {
        if (error instanceof KeelRpcResponseError) return { error };
        throw error;
      }
    } }), { chainId, maximumConnectionAttempts: 1 });
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
    const policy = resolveKeelTransactionGasPolicy({ chainId, blockTimestamp: timestamp!, blockGasLimit: blockGasLimit! });
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
  const request = async (exact: Parameters<KeelPreflightTransport["request"]>[0], deadlineAt: number) => {
    if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The publication check was cancelled.");
    if (!["eth_chainId", "eth_getBlockByNumber", "eth_getTransactionCount", "eth_getBalance", "eth_getCode", "eth_estimateGas", "eth_simulateV1"].includes(exact.method))
      throw new KeelPublicationSimulationError("configuration-invalid", "Publication transport accepts only reads and ephemeral simulation.");
    if (exact.method === "eth_estimateGas") {
      const call = object(exact.params[0]);
      if (exact.params.length !== 2 || exact.params[1] !== blockTag || !call
        || Object.keys(call).some(key => !["from", "to", "data", "value", "nonce", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"].includes(key))
        || ![call.from, call.to].every(value => typeof value === "string" && /^0x[0-9a-f]{40}$/iu.test(value))
        || typeof call.data !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(call.data)
        || quantity(call.value) === undefined || quantity(call.nonce) === undefined
        || (call.gasPrice === undefined
          ? quantity(call.maxFeePerGas) === undefined || quantity(call.maxPriorityFeePerGas) === undefined
          : quantity(call.gasPrice) === undefined || call.maxFeePerGas !== undefined || call.maxPriorityFeePerGas !== undefined))
        throw new KeelPublicationSimulationError("configuration-invalid", "Estimate the complete fee-bound transaction at its selected numbered block without overrides.");
      // Estimation executes unpublished calldata too. Never route it through the
      // ordinary reader or an unapproved public-pool candidate. An estimate is
      // only a discovery bound; it grants no simulation qualification or proof.
      const index = urls.findIndex(url => approved.has(url));
      if (index < 0) throw new KeelPublicationSimulationError("configuration-invalid", "A publication estimate needs an approved project-data recipient.", { recipientApprovalRequired: 1 });
      const pinned = pool.pin(index);
      try {
        const snapshot = object(await pinned.request({ method: "eth_getBlockByNumber", params: [blockTag, false], signal: abort.signal }));
        if (snapshot?.number !== blockTag || typeof snapshot.hash !== "string" || snapshot.hash.toLowerCase() !== block.hash.toLowerCase())
          throw new KeelPublicationSimulationError("chain-reorganized", "The estimate provider did not match the exact selected block.");
        const head = object(await pinned.request({ method: "eth_getBlockByNumber", params: ["latest", false], signal: abort.signal }));
        const time = quantity(head?.timestamp), number = quantity(head?.number), now = BigInt(Math.floor(Date.now() / 1000));
        if (time === undefined || number === undefined || number < block.number || time + 180n < now || time > now + 30n)
          throw new KeelPublicationSimulationError("rpc-unavailable", "The estimate provider does not have a fresh selected-chain head.");
        const result = await pinned.request({ ...exact, signal: abort.signal });
        if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The publication check was cancelled.");
        if (quantity(result) === undefined || quantity(result)! <= 0n)
          throw new KeelPublicationSimulationError("configuration-invalid", "The provider omitted a positive transaction estimate.");
        return result;
      } catch (error) {
        if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The publication check was cancelled.");
        const failure = keelSimulationTransportFailure(error, { method: "eth_estimateGas", phase: "project-estimate" });
        throw new KeelPublicationSimulationError(failure.kind, failure.message, failure.diagnostic);
      }
    }
    if (exact.method !== "eth_simulateV1") {
      const result = await readTransport.request(exact);
      if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The publication check was cancelled.");
      if (exact.method === "eth_getBlockByNumber" && exact.params[0] === blockTag
        && (object(result)?.hash !== block.hash || object(result)?.number !== blockTag))
        throw new KeelPublicationSimulationError("chain-reorganized", "The selected read provider's block changed. Recheck the saved plan.");
      return result;
    }
    const program = object(exact.params[0]), blocks = program?.blockStateCalls;
    if (exact.params.length !== 2 || exact.params[1] !== blockTag || !program || !Array.isArray(blocks) || !blocks.length || blocks.length > defaults.maximumBlocks
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
    const measurement = measureKeelSimulationProgram(exact);
    const metrics = { chainId, callCount: measurement.callCount, blockCount: measurement.blockCount, calldataBytes: measurement.calldataBytes,
      requestPayloadBytes: measurement.requestPayloadBytes, requestedEnvelopeGas: measurement.requestedEnvelopeGas.toString(),
      largestTransactionGas: measurement.largestTransactionGas.toString(), largestBlockEnvelopeGas: measurement.largestBlockEnvelopeGas.toString() };
    try { onMeasurement?.(Object.freeze({ ...metrics, gasMeasurement: "requested-envelopes" })); } catch { /* Metrics cannot alter proof. */ }
    let capacityFailure: KeelPublicationSimulationError | undefined, approvedCapacityFailure: KeelPublicationSimulationError | undefined,
      lastFailure: KeelPublicationSimulationError | undefined, awaitingApproval = false;
    let sameRecipientRetried = false;
    const retainApprovedCapacity = (index: number, cap: bigint, failure: KeelPublicationSimulationError) => {
      if (approved.has(urls[index]!) && (!approvedCapacityFailure || cap > BigInt(approvedCapacityFailure.diagnostic!.providerGasCap!)))
        approvedCapacityFailure = new KeelPublicationSimulationError(failure.kind, failure.message,
          { ...failure.diagnostic, ...(failure.diagnostic?.gasCapacityScope === "request" ? {} : { requestedGasLimit: requiredGas.toString() }), providerGasCap: cap.toString() });
    };
    const start = cursor;
    const order = Array.from({ length: urls.length }, (_, offset) => (start + offset) % urls.length);
    // Prefer measured request headroom among already-approved candidates. Unknown
    // providers keep their original slots; neither an index nor a capacity fact
    // authorizes disclosure. No universal 50M RPC default is assumed.
    const ranked = order.flatMap(index => { const cap = limitsFor(index)?.requestGasCap; return approved.has(urls[index]!) && cap !== undefined ? [{ index, cap }] : []; })
      .sort((a, b) => a.cap === b.cap ? 0 : a.cap > b.cap ? -1 : 1).map(value => value.index);
    let rank = 0;
    for (let i = 0; i < order.length; i++) if (ranked.includes(order[i]!)) order[i] = ranked[rank++]!;
    for (let offset = 0; offset < order.length; offset++) {
      if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The publication check was cancelled.");
      const index = order[offset]!;
      if (rejected.has(index)) continue;
      const profileFailure = keelSimulationProviderCapacityFailure(measurement, limitsFor(index) ?? {});
      if (profileFailure) {
        capacityFailure ??= profileFailure; lastFailure = profileFailure;
        const cap = profileFailure.diagnostic?.providerGasCap;
        if (typeof cap === "string") retainApprovedCapacity(index, BigInt(cap), profileFailure);
        try { onAttempt?.({ ...keelSimulationTransportDiagnostic(profileFailure), candidateIndex: index, candidateCount: urls.length }); } catch { /* Metrics cannot alter proof. */ }
        continue;
      }
      const capacity = capacityFor(index);
      if (capacity && requiredGas > capacity.cap) {
        capacityFailure ??= capacity.failure;
        retainApprovedCapacity(index, capacity.cap, capacity.failure);
        continue;
      }
      // A prior larger public read ceiling did not qualify this smaller request.
      // Reconnect and requalify its entire unchanged sequence; never change any
      // transaction or read here. Only the caller owns bounded read adaptation.

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
        if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The publication check was cancelled.");
        selected = candidate; cursor = index;
        const execution = measureKeelSimulationExecution(exact, result);
        if (execution) try { onMeasurement?.(Object.freeze({ ...metrics, candidateIndex: index, gasMeasurement: "simulation-response",
          measuredGasUsed: execution.gasUsed.toString(), measuredMaxUsedGas: execution.maxUsedGas.toString(), requiredRequestGas: execution.requiredRequestGas.toString(),
          requiredBlockGas: execution.requiredBlockGas.toString() })); } catch { /* Response metrics do not grant proof. */ }
        return result;
      } catch (error) {
        await candidate.transport.close(); if (selected === candidate) selected = undefined;
        if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The publication check was cancelled.");
        const classified = keelSimulationTransportFailure(error, { method: "eth_simulateV1", phase: projectRequest ? "project-request" : "public-qualification" });
        const failure = new KeelPublicationSimulationError(classified.kind, classified.message, { ...classified.diagnostic,
          // The nested transport calls every post-qualification request a
          // project request, including this pool's public sequence probe.
          // This boundary knows whether private calldata was actually sent.
          // Conservative envelope sum, not measured execution gas. Bytes exclude
          // only the pool-owned JSON-RPC id/version envelope.
          requiredProgramGas: gasLimits.reduce((sum, gas) => sum + gas, 0n).toString(),
          ...metrics, phase: projectRequest ? "project-request" : "public-qualification" });
        // Never reinterpret a deterministic transaction validation error or an
        // execution revert as a reason to try another backend for success.
        const code = failure.diagnostic?.rpcCode;
        const requestCapacityEvidence = failure.kind === "provider-limit" && (failure.diagnostic?.httpStatus === 413
          || failure.diagnostic?.gasCapacityScope === "request" && (failure.diagnostic?.providerGasCap !== undefined
            || failure.diagnostic?.requestedRequestGas !== undefined && failure.diagnostic?.remainingRequestGas !== undefined));
        // -38026 is Geth's client limit, also used for non-gas limits. Only
        // separately authenticated request-capacity evidence permits fallback.
        const clientCapacityRejection = code === -38026 && requestCapacityEvidence;
        const retryableRpcRejection = code === undefined || code === -32601
          || failure.kind === "provider-limit" && (failure.diagnostic?.providerGasCap !== undefined || failure.diagnostic?.httpStatus === 413
            || failure.diagnostic?.gasCapacityScope === "request" && failure.diagnostic?.requestedRequestGas !== undefined && failure.diagnostic?.remainingRequestGas !== undefined);
        if (projectRequest && (!["provider-limit", "unsupported-simulation", "rpc-unavailable"].includes(failure.kind)
          || !retryableRpcRejection || code === -32602 || typeof code === "number" && code <= -38000 && code >= -38099 && !clientCapacityRejection)) throw failure;
        // Prefer an available approved alternative, as before. If none remains,
        // one explicitly observed transient failure may retry this same approved
        // recipient after its cooldown. Unknown errors and contract/RPC rejections
        // never enter this path. Qualification and the entire immutable program
        // run again; no previous ephemeral state or successful suffix is reused.
        const health = pool.status();
        const hasAlternative = urls.some((url, i) => i !== index && approved.has(url) && !rejected.has(i)
          && !health[i]?.disabled && (health[i]?.retryAfterMs ?? 0) === 0
          && !keelSimulationProviderCapacityFailure(measurement, limitsFor(i) ?? {})
          && requiredGas <= (capacityFor(i)?.cap ?? requiredGas));
        const observedTransient = failure.kind === "rpc-unavailable" && code === undefined
          && ([502, 503, 504].includes(Number(failure.diagnostic?.httpStatus))
            || ["timeout", "connection-reset"].includes(String(failure.diagnostic?.transportFailure)));
        const cooldown = health[index]?.retryAfterMs ?? 0;
        if (projectRequest && approved.has(urls[index]!) && !hasAlternative && !sameRecipientRetried && observedTransient
          && cooldown <= 5_000 && deadlineAt - performance.now() > cooldown + 1_000) {
          sameRecipientRetried = true;
          try { onAttempt?.({ ...keelSimulationTransportDiagnostic(failure), candidateIndex: index, candidateCount: urls.length,
            sameRecipientRetry: 1, recoveryWaitMs: cooldown }); } catch { /* Observers cannot alter proof. */ }
          if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The publication check was cancelled.");
          await new Promise<void>((resolve, reject) => {
            const cancelled = () => { clearTimeout(timer); abort.signal.removeEventListener("abort", cancelled);
              reject(new KeelPublicationSimulationError("rpc-unavailable", "The publication check was cancelled.")); };
            const timer = setTimeout(() => { abort.signal.removeEventListener("abort", cancelled); resolve(); }, cooldown);
            abort.signal.addEventListener("abort", cancelled, { once: true });
            if (abort.signal.aborted) cancelled();
          });
          if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The publication check was cancelled.");
          offset--; // The next iteration creates and fully qualifies this same candidate.
          continue;
        }
        const reportedCap = failure.kind === "provider-limit" ? failure.diagnostic?.providerGasCap : undefined;
        if (typeof reportedCap === "string" && /^[1-9]\d*$/u.test(reportedCap)) {
          const previous = capacityFor(index);
          const cap = BigInt(reportedCap);
          const scope = String(failure.diagnostic?.gasCapacityScope ?? "unknown");
          const effectiveCap = previous && previous.scope === scope && previous.cap < cap ? previous.cap : cap;
          // A cumulative cap above each individual call remains a request fact,
          // not a permanently rejected candidate or a fresh per-call allowance.
          // A later envelope clamp is a remaining allowance for THIS sequence,
          // not a reusable per-call capacity for a different smaller program.
          if (scope !== "envelope" || failure.diagnostic?.blockIndex === 0 && failure.diagnostic?.callIndex === 0)
            capacityRejected.set(index, { cap: effectiveCap, scope, expiresAt: Date.now() + capabilityMaximumAgeMs, failure });
          retainApprovedCapacity(index, effectiveCap, failure);
        } else if (failure.kind !== "provider-limit") rejected.add(index);
        lastFailure = failure;
        if (failure.kind === "provider-limit") capacityFailure ??= failure;
        try { onAttempt?.({ ...keelSimulationTransportDiagnostic(failure), candidateIndex: index, candidateCount: urls.length }); } catch { /* Diagnostic observers cannot alter proof. */ }
      }
    }
    // Give the caller the largest reported capacity among approved recipients before
    // asking for a new disclosure recipient. Only the caller may adapt an
    // unmeasured discovery/read ceiling; this pool still replays exact requests.
    if (approvedCapacityFailure) throw approvedCapacityFailure;
    if (awaitingApproval) throw new KeelPublicationSimulationError("configuration-invalid", "A candidate passed public simulation checks but is not approved for private project data. The saved plan is unchanged.", { recipientApprovalRequired: 1 });
    throw capacityFailure ?? lastFailure ?? new KeelPublicationSimulationError("rpc-unavailable", "The configured simulation pool is unavailable. Retry the saved plan after provider recovery.");
  };
  return { request(input) {
    const exact = structuredClone(input);
    const pending = tail.then(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadlineAt = performance.now() + requestTimeoutMs;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => {
        const failure = new KeelPublicationSimulationError("rpc-unavailable", "The publication check exceeded its bounded time budget. The saved plan is unchanged.",
          { transportFailure: "timeout", phase: "publication-preflight" });
        closed = true; abort.abort(failure); void selected?.transport.close(); reject(failure);
      }, requestTimeoutMs); });
      try { return await Promise.race([request(exact, deadlineAt), timeout]); }
      finally { if (timer !== undefined) clearTimeout(timer); }
    });
    tail = pending.catch(() => undefined); return pending;
  },
    async close() { closed = true; abort.abort(); await selected?.transport.close(); } };
}

/** Legacy Sepolia entry point; new callers pass their selected chain explicitly. */
export function createKeelPublicSepoliaSimulationPool(options: KeelPublicSimulationPoolOptions): KeelPreflightTransport & { close(): Promise<void> } {
  if (options.chainId !== undefined && options.chainId !== 11155111) throw new KeelPublicationSimulationError("configuration-invalid", "Use the chain-keyed simulation pool for another network.");
  return createKeelPublicSimulationPool({ ...options, chainId: 11155111 });
}
