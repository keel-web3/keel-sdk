import { createPublicClient, webSocket } from "viem";
import { createPinnedKeelSepoliaSimulationTransport } from "./simulation-connection.js";

/** Qualify public API and fork/envelope behavior before sending project calldata. All probes
 * exercise the known program envelope within the selected chain limit (a modest
 * control for ordinary reads). A confirmed provider clamp or closed socket
 * permits bounded reselection of this same approved endpoint; full project
 * execution and the exact snapshot must still verify without reducing gas. */
export function createKeelSepoliaSimulationTransport() {
  return createPinnedKeelSepoliaSimulationTransport(async () => {
    const client = createPublicClient({ transport: webSocket("wss://ethereum-sepolia-rpc.publicnode.com", {
      timeout: 90_000, retryCount: 0, reconnect: false,
    }) });
    return client.transport.getRpcClient();
  });
}
