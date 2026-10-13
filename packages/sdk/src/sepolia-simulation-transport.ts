import { createPublicClient, webSocket } from "viem";
import { createPinnedKeelSepoliaSimulationTransport } from "./simulation-connection.js";

/** Qualify public API and fork/envelope behavior before sending project calldata. All probes
 * use modest gas on the exact retained socket, without reconnection. Full project
 * capacity is verified separately by its exact simulation. */
export function createKeelSepoliaSimulationTransport() {
  return createPinnedKeelSepoliaSimulationTransport(async () => {
    const client = createPublicClient({ transport: webSocket("wss://ethereum-sepolia-rpc.publicnode.com", {
      timeout: 90_000, retryCount: 0, reconnect: false,
    }) });
    return client.transport.getRpcClient();
  });
}
