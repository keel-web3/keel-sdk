import type { KeelPreflightTransport } from "../publication-preflight.js";
export function createProofBackedSimulationTransport(options: Record<string, unknown>): Promise<KeelPreflightTransport & { close(): Promise<void> }>;
