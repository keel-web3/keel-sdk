import { KeelPublicationSimulationError, type KeelPreflightTransport } from "./publication-preflight.js";
import { resolveKeelTransactionGasPolicy } from "./transaction-gas-policy.js";

export interface KeelSimulationSocket {
  readonly socket: { readonly readyState: number };
  requestAsync(input: { readonly body: { readonly method: string; readonly params: readonly unknown[] }; readonly timeout: number }): Promise<{ readonly result?: unknown; readonly error?: unknown }>;
  close(): void;
}
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const quantity = (value: unknown): bigint | undefined => typeof value === "string" && /^0x[0-9a-f]+$/iu.test(value) ? BigInt(value) : undefined;
const call = async (rpc: KeelSimulationSocket, body: { readonly method: string; readonly params: readonly unknown[] }) => {
  const response = await rpc.requestAsync({ body, timeout: 90_000 });
  if (response.error) throw response.error;
  return response.result;
};

/** Reject silent RPC gas clamping before interpreting an apparent EVM revert. */
export function assertKeelSimulationEnvelopes(request: { readonly params: readonly unknown[] }, result: unknown): void {
  const blocks = object(request.params[0])?.blockStateCalls;
  if (!Array.isArray(blocks) || !Array.isArray(result) || blocks.length !== result.length) throw new KeelPublicationSimulationError("unsupported-simulation", "The simulator did not return complete transaction envelopes.");
  for (const [index, block] of blocks.entries()) {
    const calls = object(block)?.calls, transactions = object(result[index])?.transactions;
    if (!Array.isArray(calls) || !Array.isArray(transactions) || calls.length !== transactions.length) throw new KeelPublicationSimulationError("unsupported-simulation", "The simulator did not return complete transaction envelopes.");
    for (const [i, planned] of calls.entries()) {
      const requested = quantity(object(planned)?.gas), actual = quantity(object(transactions[i])?.gas);
      if (requested === undefined || actual === undefined) throw new KeelPublicationSimulationError("unsupported-simulation", "The simulator omitted the exact transaction gas envelope.");
      if (actual < requested) throw new KeelPublicationSimulationError("provider-limit", "The simulator silently reduced the requested transaction gas. Your saved plan is unchanged; use a compatible provider before wallet approval.", { requestedGasLimit: requested.toString(), providerGasCap: actual.toString() });
      if (actual !== requested) throw new KeelPublicationSimulationError("unsupported-simulation", "The simulator changed the requested transaction gas envelope.");
    }
  }
}

/** Select capacity using public empty calls, on the very socket used for calldata.
 * A program failure never triggers selection or replay on another connection. */
export function createPinnedKeelSepoliaSimulationTransport(connect: () => Promise<KeelSimulationSocket>): KeelPreflightTransport & { close(): Promise<void> } {
  let selected: Promise<KeelSimulationSocket> | undefined;
  const select = async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      let rpc: KeelSimulationSocket | undefined;
      try {
        rpc = await connect();
        const version = await call(rpc, { method: "web3_clientVersion", params: [] });
        const match = typeof version === "string" ? /^Geth\/v(\d+)\.(\d+)\.(\d+)(?:[-/]|$)/u.exec(version) : null;
        if (!match || !(Number(match[1]) > 1 || (Number(match[1]) === 1 && (Number(match[2]) > 17 || (Number(match[2]) === 17 && Number(match[3]) >= 7))))) throw Error("Incompatible simulator");
        const chain = await call(rpc, { method: "eth_chainId", params: [] });
        const block = object(await call(rpc, { method: "eth_getBlockByNumber", params: ["latest", false] }));
        const timestamp = quantity(block?.timestamp), limit = quantity(block?.gasLimit), number = quantity(block?.number);
        if (quantity(chain) !== 11155111n || timestamp === undefined || limit === undefined || number === undefined) throw Error("Invalid simulator snapshot");
        const gas = `0x${resolveKeelTransactionGasPolicy({ chainId: 11155111, blockTimestamp: timestamp, blockGasLimit: limit }).maximumTotalGas.toString(16)}`;
        const empty = { from: "0x0000000000000000000000000000000000000000", to: "0x0000000000000000000000000000000000000000", value: "0x0", data: "0x", gas };
        const probe = { method: "eth_simulateV1", params: [{ blockStateCalls: [{ calls: [empty] }], validation: false, traceTransfers: false, returnFullTransactions: true }, block!.number] };
        const evidence = await call(rpc, probe);
        assertKeelSimulationEnvelopes(probe, evidence);
        const results = Array.isArray(evidence) ? object(evidence[0])?.calls : undefined;
        if (!Array.isArray(results) || object(results[0])?.status !== "0x1" || object(results[0])?.error !== undefined) throw Error("Invalid capacity evidence");
        return rpc;
      } catch { rpc?.close(); /* No project calldata was sent during selection. */ }
    }
    throw new KeelPublicationSimulationError("unsupported-simulation", "No compatible Sepolia simulator with the selected chain’s transaction capacity is available. The saved job remains unchanged; no wallet review was created.");
  };
  return {
    async request(request) {
      selected ??= select();
      let rpc: KeelSimulationSocket;
      try { rpc = await selected; } catch (error) { selected = undefined; throw error; }
      if (rpc.socket.readyState !== 1) { selected = undefined; throw new KeelPublicationSimulationError("rpc-unavailable", "The pinned simulator connection closed. Recheck the saved plan before a wallet review."); }
      const exact = request.method === "eth_simulateV1" ? { ...request, params: [{ ...object(request.params[0]), returnFullTransactions: true }, ...request.params.slice(1)] } : request;
      const result = await call(rpc, exact);
      if (request.method === "eth_simulateV1") assertKeelSimulationEnvelopes(exact, result);
      return result;
    },
    async close() { const current = selected; selected = undefined; if (current) await current.then(rpc => rpc.close(), () => undefined); },
  };
}
