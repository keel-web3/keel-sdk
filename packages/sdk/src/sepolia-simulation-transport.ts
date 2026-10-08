import { createPublicClient, webSocket } from "viem";
import { KeelPublicationSimulationError, type KeelPreflightTransport } from "./publication-preflight.js";

/** The Sepolia public HTTP pool mixes simulators with incompatible reservoir
 * behavior. Select a compatible persistent connection before sending calldata.
 * A failed simulation is never retried to manufacture a successful result. */
export function createKeelSepoliaSimulationTransport(): KeelPreflightTransport & { close(): Promise<void> } {
  type Client = { readonly rpc: Awaited<ReturnType<ReturnType<typeof connect>["transport"]["getRpcClient"]>> };
  const connect = () => createPublicClient({ transport: webSocket("wss://ethereum-sepolia-rpc.publicnode.com", {
    timeout: 90_000, retryCount: 0, reconnect: false,
  }) });
  let selected: Promise<Client> | undefined;
  const select = async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const client = connect();
      const rpc = await client.transport.getRpcClient();
      try {
        const version = await client.request({ method: "web3_clientVersion" });
        const match = /^Geth\/v(\d+)\.(\d+)\.(\d+)(?:[-/]|$)/u.exec(version);
        if (match && (Number(match[1]) > 1 || (Number(match[1]) === 1 && (Number(match[2]) > 17 || (Number(match[2]) === 17 && Number(match[3]) >= 7))))) return { rpc };
      } catch { /* Selection sends no project calldata. */ }
      rpc.close();
    }
    throw new KeelPublicationSimulationError("unsupported-simulation", "No compatible persistent Sepolia simulator is available. The saved job remains unchanged; no wallet review was created.");
  };
  return {
    async request(request) {
      selected ??= select();
      let client: Client;
      try { client = await selected; } catch (error) { selected = undefined; throw error; }
      // A closed socket must not silently reconnect to an incompatible backend.
      const socket = client.rpc.socket;
      if (socket.readyState !== 1) { selected = undefined; throw new KeelPublicationSimulationError("rpc-unavailable", "The pinned simulator connection closed. Recheck the saved plan before a wallet review."); }
      const response = await client.rpc.requestAsync({ body: request as never, timeout: 90_000 });
      if (response.error) throw response.error;
      return response.result;
    },
    async close() {
      const current = selected; selected = undefined;
      if (current) await current.then(client => client.rpc.close(), () => undefined);
    },
  };
}
