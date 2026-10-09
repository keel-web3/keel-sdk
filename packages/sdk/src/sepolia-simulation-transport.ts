import { createPublicClient, webSocket } from "viem";
import { createPinnedKeelSepoliaSimulationTransport } from "./simulation-connection.js";

/** Select version and gas capacity before sending project calldata. All probes
 * use the exact low-level socket retained for simulation, without reconnection. */
export function createKeelSepoliaSimulationTransport() {
  return createPinnedKeelSepoliaSimulationTransport(async () => {
    const client = createPublicClient({ transport: webSocket("wss://ethereum-sepolia-rpc.publicnode.com", {
      timeout: 90_000, retryCount: 0, reconnect: false,
    }) });
    return client.transport.getRpcClient();
  });
}
