import { createPublicClient, http, webSocket } from "viem";
import { createPinnedKeelSepoliaSimulationTransport, type KeelSimulationConnectionOptions } from "./simulation-connection.js";

/** Qualify public API and fork/envelope behavior before sending project calldata. All probes
 * exercise the known program envelope within the selected chain limit (a modest
 * control for ordinary reads). A confirmed provider clamp or closed socket
 * permits bounded reselection of this same approved endpoint; full project
 * execution and the exact snapshot must still verify without reducing gas. */
export function createKeelSepoliaSimulationTransport(options: Pick<KeelSimulationConnectionOptions, "onAttempt"> = {}) {
  return createPinnedKeelSepoliaSimulationTransport(async () => {
    const client = createPublicClient({ transport: webSocket("wss://ethereum-sepolia-rpc.publicnode.com", {
      timeout: 90_000, retryCount: 0, reconnect: false,
    }) });
    return client.transport.getRpcClient();
  }, { ...options, messageSizeFallback: async () => {
    // Same approved recipient. No batching, request splitting or reduced gas.
    // raw preserves strict-nonce error codes for the identical qualification.
    const abort = new AbortController();
    const client = createPublicClient({ transport: http("https://ethereum-sepolia-rpc.publicnode.com", {
      timeout: 90_000, retryCount: 0, batch: false, raw: true, fetchOptions: { redirect: "error", signal: abort.signal },
    }) });
    return { protocol: "https", close() { abort.abort(); }, async requestAsync({ body, timeout }) {
      return client.request(body as never, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeout)]) }) as Promise<{ readonly result?: unknown; readonly error?: unknown }>;
    } };
  } });
}
