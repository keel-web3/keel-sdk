import { keccak256, stringToHex } from "viem";
import { KeelPublicationSimulationError, type KeelPreflightTransport } from "./publication-preflight.js";

/** Experimental local-only engine boundary. It does not create a wallet proof;
 * all existing complete-program SDK validators still consume the returned RPC
 * result. Each complete eth_simulateV1 request gets a fresh native session. */
export interface KeelLocalSessionClient {
  request(command: Readonly<Record<string, unknown>>, options: { readonly signal: AbortSignal }): Promise<unknown>;
  close(): Promise<void>;
}
export interface KeelLocalSessionEvidence {
  readonly schema: "keel-local-simulation-session@1";
  readonly canonicalHash: string;
  readonly programDigest: string;
  readonly stages: number;
  readonly finalCheckpoint: string;
  readonly fullWitnessComplete: true;
  readonly headerHistoryComplete: true;
  readonly stickyStateError: false;
  readonly acceptance: false;
}
export interface KeelLocalSimulationOptions {
  /** Existing approved chain reader. This module selects no RPC recipient. */
  readonly readTransport: KeelPreflightTransport;
  /** Separate explicit capability for project-bearing estimates. It must use
   * an already approved recipient; ordinary chain readers never receive them. */
  readonly projectEstimateTransport?: KeelPreflightTransport;
  readonly block: { readonly number: bigint; readonly hash: string; readonly stateRoot: string };
  /** Caller supplies a reviewed local process, never an HTTP fallback. */
  readonly createClient: () => Promise<KeelLocalSessionClient>;
  readonly signal?: AbortSignal;
  readonly requestTimeoutMs?: number;
  readonly onSession?: (evidence: KeelLocalSessionEvidence) => void;
}
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const digest = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{64}$/iu.test(value);
const quantity = (value: unknown): value is string => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(value);
const unavailable = () => new KeelPublicationSimulationError("rpc-unavailable", "The local publication check ended before complete verification. The saved plan is unchanged.");
const invalid = (message: string) => new KeelPublicationSimulationError("configuration-invalid", message);
const incompatible = () => new KeelPublicationSimulationError("unsupported-simulation", "The local engine did not return complete, bound stage evidence.");

export function createKeelLocalSimulationTransport(options: KeelLocalSimulationOptions): KeelPreflightTransport & { close(): Promise<void> } {
  const timeout = options.requestTimeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 120_000 || typeof options.block.number !== "bigint" || options.block.number < 0n || !digest(options.block.hash) || !digest(options.block.stateRoot))
    throw invalid("Local simulation requires a canonical pin and a bounded request deadline.");
  const pin = Object.freeze({ ...options.block, hash: options.block.hash.toLowerCase(), stateRoot: options.block.stateRoot.toLowerCase() });
  const blockTag = `0x${pin.number.toString(16)}`, shutdown = new AbortController(), clients = new Set<KeelLocalSessionClient>();
  let closed = false, serial = 0;
  const readMethods = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getTransactionCount", "eth_getBalance", "eth_getCode"]);
  const disposal = new WeakMap<KeelLocalSessionClient, Promise<void>>();
  const closeClient = (client: KeelLocalSessionClient): Promise<void> => {
    const existing = disposal.get(client); if (existing) return existing;
    let timer: ReturnType<typeof setTimeout>;
    const pending = Promise.race([Promise.resolve().then(() => client.close()), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(unavailable()), 5_000);
    })]).finally(() => clearTimeout(timer));
    disposal.set(client, pending); return pending;
  };
  const close = async () => {
    if (closed) return;
    closed = true; shutdown.abort();
    await Promise.allSettled([...clients].map(closeClient));
  };
  const request = async (input: { readonly method: string; readonly params: readonly unknown[]; readonly signal?: AbortSignal }): Promise<unknown> => {
    if (closed || options.signal?.aborted || input.signal?.aborted) throw unavailable();
    if (input.method !== "eth_simulateV1" && !readMethods.has(input.method) && !(input.method === "eth_estimateGas" && options.projectEstimateTransport))
      throw invalid("Project estimates require an explicitly approved estimate transport; local validation otherwise accepts only chain reads and simulation.");
    // Snapshot the complete caller program before the first asynchronous read.
    let exact: { method: string; params: unknown[] };
    try { exact = JSON.parse(JSON.stringify({ method: input.method, params: input.params })) as typeof exact; }
    catch { throw invalid("The complete unsigned program must use JSON RPC values."); }
    const abort = new AbortController(), external = [shutdown.signal, options.signal, input.signal].filter((value): value is AbortSignal => !!value);
    const cancel = () => abort.abort();
    external.forEach(signal => signal.addEventListener("abort", cancel, { once: true }));
    const timer = setTimeout(cancel, timeout);
    let client: KeelLocalSessionClient | undefined, identity: Record<string, unknown> | undefined, primaryFailure = false;
    const check = () => { if (closed || abort.signal.aborted) throw unavailable(); };
    const bounded = <T>(operation: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
      const onAbort = () => reject(unavailable());
      abort.signal.addEventListener("abort", onAbort, { once: true });
      if (abort.signal.aborted) onAbort();
      operation.then(value => { abort.signal.removeEventListener("abort", onAbort); try { check(); resolve(value); } catch (error) { reject(error); } }, error => { abort.signal.removeEventListener("abort", onAbort); reject(error); });
    });
    const read = (method: string, params: readonly unknown[]) => {
      check();
      const readInput = { method, params, signal: abort.signal };
      return bounded(options.readTransport.request(readInput));
    };
    const canonical = async () => {
      if (await read("eth_chainId", []) !== "0xaa36a7") throw invalid("The local publication witness requires the selected Sepolia chain.");
      const value = record(await read("eth_getBlockByNumber", [blockTag, false]));
      if (value?.number !== blockTag || typeof value.hash !== "string" || value.hash.toLowerCase() !== pin.hash || typeof value.stateRoot !== "string" || value.stateRoot.toLowerCase() !== pin.stateRoot)
        throw new KeelPublicationSimulationError("chain-reorganized", "The local witness no longer matches the canonical selected block.");
    };
    let commandID = 0;
    const command = async (type: string, extra: Record<string, unknown> = {}, retryLostResponse = false): Promise<Record<string, unknown>> => {
      check();
      const body = Object.freeze({ id: `command-${++commandID}`, type, ...identity, ...extra });
      let raw: unknown;
      for (let attempt = 0; ; attempt++) {
        try { raw = await bounded(client!.request(body, { signal: abort.signal })); break; }
        catch (error) {
          // Only an explicitly typed lost local reply may repeat the exact
          // idempotent stage. Never retry unknown, revert, stale or proof errors.
          check();
          if (!retryLostResponse || attempt !== 0 || record(error)?.code !== "LOCAL_RESPONSE_LOST") throw error;
        }
      }
      const envelope = record(raw);
      if (envelope?.id !== body.id) throw incompatible();
      if (envelope.error !== undefined) {
        const code = record(envelope.error)?.code;
        if (code === "session-stale") throw new KeelPublicationSimulationError("chain-reorganized", "The local stage binding or checkpoint changed.");
        if (code === "session-closed") throw unavailable();
        throw new KeelPublicationSimulationError("unsupported-simulation", "The local engine stopped without complete authenticated execution evidence.");
      }
      const value = record(envelope.result);
      if (!value || value.sessionId !== identity!.sessionId || value.programDigest !== identity!.programDigest || value.canonicalHash !== pin.hash) throw incompatible();
      return value;
    };
    try {
      if (exact.method === "eth_estimateGas") {
        check();
        const estimateInput = { method: exact.method, params: exact.params, signal: abort.signal };
        return await bounded(options.projectEstimateTransport!.request(estimateInput));
      }
      if (exact.method !== "eth_simulateV1") return await read(exact.method, exact.params);
      const program = record(exact.params[0]), blocks = program?.blockStateCalls;
      if (exact.params.length !== 2 || exact.params[1] !== blockTag || !program || !Array.isArray(blocks) || blocks.length === 0 || blocks.length > 256
        || Object.keys(program).some(key => !["blockStateCalls", "validation", "traceTransfers", "returnFullTransactions"].includes(key))
        || typeof program.validation !== "boolean" || program.traceTransfers !== false || program.returnFullTransactions !== true)
        throw invalid("Keep the entire override-free simulation at its immutable canonical pin.");
      for (const block of blocks) {
        const state = record(block), calls = state?.calls, call = Array.isArray(calls) && calls.length === 1 ? record(calls[0]) : undefined;
        if (!state || Object.keys(state).some(key => key !== "calls") || !call || !quantity(call.gas) || BigInt(call.gas) <= 0n
          || Object.keys(call).some(key => !["from", "to", "data", "value", "gas", "nonce", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"].includes(key)))
          throw invalid("Preserve each original bounded transaction in its own simulation block.");
      }
      const programJSON = JSON.stringify(program);
      if (new TextEncoder().encode(programJSON).length > 8 * 1024 * 1024) throw invalid("The local program exceeds its explicit request byte bound.");
      await canonical();
      const opening = options.createClient();
      // If cancellation wins while the process starts, dispose the late client.
      void opening.then(value => { if (closed || abort.signal.aborted) void closeClient(value).catch(() => {}); }, () => {});
      client = await bounded(opening); clients.add(client);
      identity = { sessionId: `keel-session-${++serial}`, programDigest: keccak256(stringToHex(programJSON)), canonicalHash: pin.hash };
      const begun = await command("begin", { programJSON });
      if (begun.nextIndex !== 0 || begun.stageCount !== blocks.length || begun.checkpoint !== pin.hash || begun.status !== "open" || begun.acceptance !== false) throw incompatible();
      let checkpoint = pin.hash;
      const results: unknown[] = [];
      for (let index = 0; index < blocks.length; index++) {
        const stage = await command("stage", { index, expectedCheckpoint: checkpoint }, true);
        if (stage.index !== index || stage.previousCheckpoint !== checkpoint || !digest(stage.checkpoint) || !record(stage.result)) throw incompatible();
        results.push(stage.result); checkpoint = stage.checkpoint;
      }
      const finished = await command("finish");
      if (finished.status !== "completed" || finished.acceptance !== false || finished.stageCount !== blocks.length || finished.checkpoint !== checkpoint
        || finished.fullWitnessComplete !== true || finished.headerHistoryComplete !== true || finished.stickyStateError !== false
        || !Array.isArray(finished.results) || JSON.stringify(finished.results) !== JSON.stringify(results)) throw incompatible();
      await canonical(); check();
      options.onSession?.(Object.freeze({ schema: "keel-local-simulation-session@1", canonicalHash: pin.hash,
        programDigest: String(identity.programDigest), stages: blocks.length, finalCheckpoint: checkpoint,
        fullWitnessComplete: true, headerHistoryComplete: true, stickyStateError: false, acceptance: false }));
      return results;
    } catch (error) {
      primaryFailure = true; throw error;
    } finally {
      clearTimeout(timer); external.forEach(signal => signal.removeEventListener("abort", cancel));
      // Killing this request-scoped local process discards its full ephemeral
      // state on every path, including stale pin, timeout, cancellation and error.
      abort.abort();
      if (client) { clients.delete(client); try { await closeClient(client); } catch (error) { if (!primaryFailure) throw error; } }
    }
  };
  return { request, close };
}
