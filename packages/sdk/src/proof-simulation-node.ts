import type { KeelPreflightTransport } from "./publication-preflight.js";
import { createProofBackedSimulationTransport } from "./proof-runtime/transport.js";
import { createApprovedProofStateReader } from "./proof-runtime/state-reader.js";
import { createIsolatedRunnerSpawner } from "./proof-runtime/runner-client.js";

export interface KeelProofSimulationOptions {
  readonly block: { readonly number: bigint; readonly hash: string };
  /** Immutable application copy of the exact executor from the cloud receipt. */
  readonly binaryPath: string;
  readonly binarySha256: string;
  readonly socketPath: string;
  readonly rpcUrls: readonly string[];
  /** Explicit approval for address/key reads; distinct from full-program approval. */
  readonly approvedStateRpcUrls: readonly string[];
  readonly signal?: AbortSignal;
  readonly onAttempt?: (diagnostic: Readonly<Record<string, string | number>>) => void;
  readonly onEvidence?: (evidence: Readonly<Record<string, unknown>>) => void;
}

/** Server-only, local proof execution. Never falls back to remote execution.
 * Deployment must verify the sidecar image, isolation and socket mount first.
 */
export async function createKeelProofSimulationTransport(options: KeelProofSimulationOptions): Promise<KeelPreflightTransport & { close(): Promise<void> }> {
  const block = { ...options.block };
  const stateReader = createApprovedProofStateReader({ rpcUrls: [...options.rpcUrls], approvedStateRpcUrls: [...options.approvedStateRpcUrls], block, onAttempt: options.onAttempt });
  try {
    const transport = await createProofBackedSimulationTransport({
      ...options, block, stateReader,
      spawnExecutor: createIsolatedRunnerSpawner({ socketPath: options.socketPath, binarySha256: options.binarySha256 }),
      limits: { gasBudget: 10_000_000_000, requests: 10_000, witnessBytes: 64 * 1024 * 1024, responseBytes: 256 * 1024 * 1024, wallTimeMs: 180_000 },
    });
    return {
      request: input => transport.request(input),
      async close() { try { await transport.close(); } finally { stateReader.close(); } },
    };
  } catch (error) { stateReader.close(); throw error; }
}
