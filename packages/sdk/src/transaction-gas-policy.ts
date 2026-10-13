/** Selected-chain transaction rules. Public eth_call budgets are a separate policy.
 * Sepolia activation: EIP-7773. Amsterdam: EIP-8037, EIP-7976 and EIP-2780.
 * Never derive the fork from wall-clock time or from a successful estimate. */
export const KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP = 1_791_294_816n;
export interface KeelTransactionGasPolicy {
  readonly profile: "ethereum-pre-amsterdam" | "sepolia-amsterdam";
  readonly chainId: number;
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
  if (input.chainId !== 1 && input.chainId !== 11_155_111) throw new TypeError("This chain needs an explicitly registered transaction gas profile.");
  const amsterdam = input.chainId === 11_155_111 && input.blockTimestamp >= KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP;
  const total = amsterdam ? 4_294_967_295n : 16_777_216n;
  return Object.freeze({ profile: amsterdam ? "sepolia-amsterdam" : "ethereum-pre-amsterdam", chainId: input.chainId, blockTimestamp: input.blockTimestamp,
    maximumExecutionGas: 16_777_216n, maximumTotalGas: input.blockGasLimit < total ? input.blockGasLimit : total,
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
  if (!policy.separateStateGas) {
    if (policy.chainId === 11_155_111 && timestamp !== undefined && timestamp >= KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP) throw new TypeError("The simulated sequence crossed the selected transaction gas fork. Replan from a current block.");
    return;
  }
  const slotNumber = quantity(block?.slotNumber);
  if (!block || timestamp === undefined || timestamp < policy.blockTimestamp || timestamp < KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP
    || timestamp <= parent.timestamp || quantity(block.number) !== parent.number + 1n
    // Geth's simulateV1 omits slotNumber while supplying the linked Amsterdam
    // access-list header. Validate slot order when the RPC exposes it.
    || (block.slotNumber !== undefined && slotNumber === undefined)
    || (slotNumber !== undefined && parent.slotNumber !== undefined && slotNumber <= parent.slotNumber)
    || !hash(block.blockAccessListHash) || !hash(block.hash)
    || typeof block.parentHash !== "string" || block.parentHash.toLowerCase() !== parent.hash.toLowerCase()) {
    throw new TypeError("The simulator did not prove an Amsterdam block linked to the exact pinned chain snapshot.");
  }
}
