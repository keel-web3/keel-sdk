/** Selected-chain transaction rules. Public eth_call budgets are a separate policy.
 * Sepolia activation: EIP-7773. Amsterdam: EIP-8037, EIP-7976 and EIP-2780.
 * Never derive the fork from wall-clock time or from a successful estimate. */
export const KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP = 1_791_294_816n;
/** Pinned upstream chain schedules. New chains/forks need reviewed rules; an RPC estimate cannot register them. */
const schedules: Readonly<Record<number, { readonly prague: bigint; readonly osaka: bigint; readonly amsterdam?: bigint }>> = {
  1: { prague: 1_746_612_311n, osaka: 1_764_798_551n },
  11_155_111: { prague: 1_741_159_776n, osaka: 1_760_427_360n, amsterdam: KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP },
};
const source = "https://github.com/ethereum/go-ethereum/blob/v1.17.7/params/config.go";
function selectedFork(chainId: number, timestamp: bigint): "prague" | "osaka" | "amsterdam" {
  const schedule = schedules[chainId];
  if (!schedule || timestamp < schedule.prague) throw new TypeError("This historical chain/fork needs an explicitly registered transaction gas profile.");
  return schedule.amsterdam !== undefined && timestamp >= schedule.amsterdam ? "amsterdam" : timestamp >= schedule.osaka ? "osaka" : "prague";
}
export interface KeelTransactionGasPolicy {
  readonly profile: "ethereum-pre-amsterdam" | "sepolia-amsterdam";
  readonly chainId: number;
  readonly fork: "prague" | "osaka" | "amsterdam";
  readonly rulesSource: string;
  readonly feeModel: "ethereum-l1";
  readonly blockTimestamp: bigint;
  readonly maximumExecutionGas: bigint;
  readonly maximumTotalGas: bigint;
  readonly separateStateGas: boolean;
  readonly transactionBaseGas: number;
  readonly recipientAccessGas: number;
  readonly zeroCalldataGas: number;
  readonly nonzeroCalldataGas: number;
  readonly zeroCalldataFloorGas: number;
  readonly nonzeroCalldataFloorGas: number;
}
export function resolveKeelTransactionGasPolicy(input: { readonly chainId: number; readonly blockTimestamp: bigint; readonly blockGasLimit: bigint }): KeelTransactionGasPolicy {
  if (typeof input.blockTimestamp !== "bigint" || input.blockTimestamp < 0n || typeof input.blockGasLimit !== "bigint" || input.blockGasLimit <= 0n) throw new TypeError("Transaction gas policy requires the actual selected-chain block timestamp and gas limit.");
  const fork = selectedFork(input.chainId, input.blockTimestamp);
  const amsterdam = fork === "amsterdam";
  const total = amsterdam ? 4_294_967_295n : fork === "osaka" ? 16_777_216n : input.blockGasLimit;
  const execution = fork === "prague" ? input.blockGasLimit : 16_777_216n;
  return Object.freeze({ profile: amsterdam ? "sepolia-amsterdam" : "ethereum-pre-amsterdam", chainId: input.chainId, fork, rulesSource: source, feeModel: "ethereum-l1", blockTimestamp: input.blockTimestamp,
    maximumExecutionGas: execution < input.blockGasLimit ? execution : input.blockGasLimit, maximumTotalGas: input.blockGasLimit < total ? input.blockGasLimit : total,
    separateStateGas: amsterdam, transactionBaseGas: amsterdam ? 12_000 : 21_000, recipientAccessGas: amsterdam ? 3_000 : 0,
    zeroCalldataGas: 4, nonzeroCalldataGas: 16,
    zeroCalldataFloorGas: amsterdam ? 64 : 10, nonzeroCalldataFloorGas: amsterdam ? 64 : 40 });
}

/** Current Geth reports simulated block headers but no per-call gas dimensions.
 * Authenticate the simulated fork/header chain; strict execution then enforces
 * regular/state limits internally. This does not verify transaction signatures. */
export function assertKeelAmsterdamSimulationHeader(policy: KeelTransactionGasPolicy, value: unknown, parent: {
  readonly hash: string; readonly number: bigint; readonly timestamp: bigint; readonly slotNumber?: bigint;
}): void {
  const block = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const quantity = (v: unknown) => typeof v === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(v) ? BigInt(v) : undefined;
  const hash = (v: unknown) => typeof v === "string" && /^0x[0-9a-f]{64}$/iu.test(v);
  const timestamp = quantity(block?.timestamp);
  if (!block || timestamp === undefined || timestamp <= parent.timestamp || quantity(block.number) !== parent.number + 1n
    || !hash(block.hash) || typeof block.parentHash !== "string" || block.parentHash.toLowerCase() !== parent.hash.toLowerCase()
    || selectedFork(policy.chainId, timestamp) !== policy.fork) throw new TypeError("The simulator did not prove the selected fork linked to the exact pinned snapshot.");
  if (!policy.separateStateGas) return;
  const slotNumber = quantity(block?.slotNumber);
  if (!block || timestamp === undefined || timestamp < policy.blockTimestamp || timestamp < KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP
    || timestamp <= parent.timestamp || quantity(block.number) !== parent.number + 1n
    || slotNumber === undefined || (parent.slotNumber !== undefined && slotNumber <= parent.slotNumber)
    || !hash(block.blockAccessListHash) || !hash(block.hash)
    || typeof block.parentHash !== "string" || block.parentHash.toLowerCase() !== parent.hash.toLowerCase()) {
    throw new TypeError("The simulator did not prove an Amsterdam block linked to the exact pinned chain snapshot.");
  }
}
