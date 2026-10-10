import { KeelPublicationSimulationError, type KeelPreflightTransport } from "./publication-preflight.js";
import { createPinnedKeelSepoliaSimulationTransport, type KeelSimulationConnection } from "./simulation-connection.js";
import { resolveKeelTransactionGasPolicy } from "./transaction-gas-policy.js";

const SEPOLIA_GENESIS = "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9";
const MAX_UINT64 = 18_446_744_073_709_551_615n;
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const quantity = (value: unknown): bigint | undefined => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(value) ? BigInt(value) : undefined;
const invalid = (message: string): never => { throw new KeelPublicationSimulationError("configuration-invalid", message); };
const encode = (request: { readonly method: string; readonly params: readonly unknown[] }) => JSON.stringify({ jsonrpc: "2.0", id: 1, method: request.method, params: request.params });

/** Exact UTF-8 wire bytes for this adapter's fixed JSON-RPC envelope. Gas is a
 * conservative request-wide admission bound, never a transaction gas estimate. */
export function measureKeelPublicationSimulationRequest(request: { readonly method: string; readonly params: readonly unknown[] }) {
  const program = object(request.params[0]);
  const blocks = program?.blockStateCalls;
  if (request.method !== "eth_simulateV1" || request.params.length !== 2 || quantity(request.params[1]) === undefined
    || !program || Object.keys(program).some(key => !["blockStateCalls", "validation", "traceTransfers", "returnFullTransactions"].includes(key))
    || typeof program.validation !== "boolean" || program.traceTransfers !== false || program.returnFullTransactions !== true
    || !Array.isArray(blocks) || blocks.length < 1 || blocks.length > 256) invalid("Owned simulation requires the complete, numbered-block program without overrides.");
  let conservativeGasBudget = 0n, maximumCallGas = 0n;
  for (const item of blocks as unknown[]) {
    const block = object(item), calls = block?.calls;
    if (!block || Object.keys(block).length !== 1 || !Array.isArray(calls) || calls.length !== 1) invalid("Each simulation block must contain one exact planned call and no overrides.");
    const call = object((calls as unknown[])[0]);
    const gas = quantity(call?.gas);
    if (!call || Object.keys(call).some(key => !["from", "to", "data", "value", "gas", "nonce", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"].includes(key))
      || gas === undefined || gas <= 0n || gas > MAX_UINT64) invalid("Owned simulation requires explicit bounded call gas and no call overrides.");
    conservativeGasBudget += gas!;
    if (gas! > maximumCallGas) maximumCallGas = gas!;
  }
  if (conservativeGasBudget > MAX_UINT64) invalid("The complete simulation request exceeds the supported RPC budget range.");
  return Object.freeze({ blockCount: (blocks as unknown[]).length, callCount: (blocks as unknown[]).length,
    requestBytes: new TextEncoder().encode(encode(request)).byteLength, conservativeGasBudget, maximumCallGas });
}

export interface KeelOwnedSimulationOptions {
  /** Already approved private server endpoint. This adapter never chooses a recipient. */
  readonly url: string;
  /** Must match the owned node's finite --rpc.gascap. */
  readonly rpcGasCap: bigint;
  /** Must not exceed the node/proxy HTTP body limit, in bytes. */
  readonly maximumRequestBytes: number;
  /** Snapshot obtained independently by the caller from the selected chain. */
  readonly block: { readonly number: bigint; readonly hash: string };
}

// Bound expensive simulations per endpoint in each server process. Deployment
// must also enforce its total worker/node concurrency; there is no hidden queue.
const activeEndpoints = new Set<string>();

/** Geth 1.17.8 owned-node profile. Readiness and capacity admission supplement,
 * never replace, public behavior qualification and the SDK's exact full proof.
 * No provider fallback, redirect, request splitting, or transaction method. */
export function createKeelOwnedSepoliaSimulationTransport(options: KeelOwnedSimulationOptions): KeelPreflightTransport & { close(): Promise<void> } {
  options = structuredClone(options);
  let endpoint: URL;
  try { endpoint = new URL(options.url); } catch { return invalid("The owned simulator requires an explicitly configured HTTP endpoint."); }
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash
    || typeof options.rpcGasCap !== "bigint" || options.rpcGasCap <= 0n || options.rpcGasCap > MAX_UINT64
    || !Number.isSafeInteger(options.maximumRequestBytes) || options.maximumRequestBytes < 1024 || options.maximumRequestBytes > 64 * 1024 * 1024
    || typeof options.block.number !== "bigint" || options.block.number < 0n || !/^0x[0-9a-f]{64}$/iu.test(options.block.hash)) invalid("The owned simulator needs a valid pinned block and finite gas/body limits.");
  const blockTag = `0x${options.block.number.toString(16)}`;
  const abort = new AbortController();
  let closed = false;
  const requestAsync: KeelSimulationConnection["requestAsync"] = async ({ body, timeout }) => {
    if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The owned simulation was cancelled.");
    const payload = encode(body);
    if (new TextEncoder().encode(payload).byteLength > options.maximumRequestBytes) throw new KeelPublicationSimulationError("provider-limit", "The complete simulation exceeds the configured owned-node request size. The saved plan is unchanged.");
    const heavy = body.method === "eth_simulateV1";
    if (heavy && activeEndpoints.has(endpoint.href)) throw new KeelPublicationSimulationError("rpc-unavailable", "The owned simulator is busy. Retry the saved plan after its current check finishes.");
    if (heavy) activeEndpoints.add(endpoint.href);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: payload,
        redirect: "error", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(Math.min(timeout, 90_000))]) });
      if (!response.ok) {
        await response.body?.cancel();
        throw new KeelPublicationSimulationError(response.status === 413 ? "provider-limit" : "rpc-unavailable", "The owned simulation endpoint could not complete the request.", { httpStatus: response.status });
      }
      // Bound response allocation as well; full tokenURI and transaction bytes remain required.
      const stream = response.body?.getReader();
      if (!stream) throw new KeelPublicationSimulationError("rpc-unavailable", "The owned simulator returned no response.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const item = await stream.read(); if (item.done) break;
        size += item.value.byteLength;
        if (size > 64 * 1024 * 1024) { await stream.cancel(); throw new KeelPublicationSimulationError("provider-limit", "The owned simulator response exceeded its bounded read capacity."); }
        chunks.push(item.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const result = object(JSON.parse(new TextDecoder().decode(bytes)));
      if (!result || result.jsonrpc !== "2.0" || result.id !== 1 || ("result" in result) === ("error" in result)) throw new KeelPublicationSimulationError("rpc-unavailable", "The owned simulator returned an invalid RPC envelope.");
      return result;
    } catch (error) {
      if (error instanceof KeelPublicationSimulationError) throw error;
      throw new KeelPublicationSimulationError("rpc-unavailable", closed ? "The owned simulation was cancelled." : "The owned simulator connection did not complete. Retry the saved plan.");
    } finally { if (heavy) activeEndpoints.delete(endpoint.href); }
  };
  const raw = async (method: string, params: readonly unknown[]) => {
    const response = await requestAsync({ body: { method, params }, timeout: 90_000 });
    if (response.error) throw new KeelPublicationSimulationError("rpc-unavailable", "The owned simulator could not verify readiness.");
    return response.result;
  };
  const readiness = async () => {
    if (quantity(await raw("eth_chainId", [])) !== 11155111n) throw new KeelPublicationSimulationError("wrong-chain", "The owned simulator must use canonical Sepolia.");
    const version = await raw("web3_clientVersion", []);
    if (typeof version !== "string" || !/^Geth\/v1\.17\.8-stable-a5790770\//u.test(version)) throw new KeelPublicationSimulationError("unsupported-simulation", "The owned simulator does not match the reviewed native client profile.");
    if (await raw("eth_syncing", []) !== false) throw new KeelPublicationSimulationError("rpc-unavailable", "The owned simulator is still syncing. The saved plan can be retried when ready.");
    const genesis = object(await raw("eth_getBlockByNumber", ["0x0", false]));
    if (genesis?.hash !== SEPOLIA_GENESIS) throw new KeelPublicationSimulationError("wrong-chain", "The owned simulator did not return canonical Sepolia genesis.");
    const latest = object(await raw("eth_getBlockByNumber", ["latest", false]));
    const timestamp = quantity(latest?.timestamp), number = quantity(latest?.number), now = BigInt(Math.floor(Date.now() / 1000));
    if (timestamp === undefined || number === undefined || number < options.block.number || timestamp > now + 30n || timestamp + 180n < now)
      throw new KeelPublicationSimulationError("rpc-unavailable", "The owned simulator does not have a fresh synced chain head.");
    const pinned = object(await raw("eth_getBlockByNumber", [blockTag, false]));
    if (pinned?.number !== blockTag || typeof pinned.hash !== "string" || pinned.hash.toLowerCase() !== options.block.hash.toLowerCase())
      throw new KeelPublicationSimulationError("chain-reorganized", "The owned simulator did not match the independently selected block.");
    const blockTimestamp = quantity(pinned.timestamp), blockGasLimit = quantity(pinned.gasLimit);
    if (blockTimestamp === undefined || blockGasLimit === undefined) throw new KeelPublicationSimulationError("rpc-unavailable", "The owned simulator omitted selected-block gas rules.");
    return resolveKeelTransactionGasPolicy({ chainId: 11155111, blockTimestamp, blockGasLimit });
  };
  const qualified = createPinnedKeelSepoliaSimulationTransport(async () => ({ protocol: endpoint.protocol === "http:" ? "http" : "https", requestAsync, close() {} }));
  let ready: ReturnType<typeof readiness> | undefined;
  return {
    async request(request) {
      // Snapshot the request before any asynchronous work or network transmission.
      const exact = structuredClone(request);
      if (!["eth_chainId", "eth_getBlockByNumber", "eth_getTransactionCount", "eth_getBalance", "eth_getCode", "eth_simulateV1"].includes(exact.method)) invalid("The owned simulator permits only publication reads and ephemeral simulation.");
      const measured = exact.method === "eth_simulateV1" ? measureKeelPublicationSimulationRequest(exact) : undefined;
      if (measured && (exact.params[1] !== blockTag || measured.conservativeGasBudget > options.rpcGasCap || measured.requestBytes > options.maximumRequestBytes)) {
        if (exact.params[1] !== blockTag) invalid("The simulation must use the independently selected block.");
        throw new KeelPublicationSimulationError("provider-limit", "The complete program exceeds the configured owned-node capacity. Its calls and gas limits remain unchanged.", {
          requiredProgramGas: measured.conservativeGasBudget.toString(), requestPayloadBytes: measured.requestBytes, blockCount: measured.blockCount,
        });
      }
      try {
        ready = measured ? readiness() : ready ?? readiness();
        const policy = await ready;
        if (measured && measured.maximumCallGas > policy.maximumTotalGas) invalid("A call exceeds the selected-chain transaction ceiling.");
        return await qualified.request(exact);
      } catch (error) { ready = undefined; throw error; }
    },
    async close() { closed = true; abort.abort(); await qualified.close(); },
  };
}
