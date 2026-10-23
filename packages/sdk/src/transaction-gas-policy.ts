/** Selected-chain transaction rules. Public eth_call budgets are a separate policy.
 * Sepolia activation: EIP-7773. Amsterdam: EIP-8037, EIP-7976 and EIP-2780.
 * Never derive the fork from wall-clock time or from a successful estimate. */
export const KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP = 1_791_294_816n;
/** Explicit non-production fixture evidence, never an unknown-chain fallback.
 * Only trusted development/test configuration may supply the node observations. */
export interface KeelLocalTestChainGasProfile {
  readonly schema: "keel-local-test-chain-gas-profile@1";
  readonly chainId: 31337;
  readonly hardfork: "Osaka";
  readonly clientVersion: "anvil/v1.8.5";
  readonly genesisHash: string;
  readonly blockGasLimit: string;
}
const localProfiles = new WeakSet<object>();
export function createKeelLocalTestChainGasProfile(input: { readonly environment: string; readonly rpcUrl: string;
  readonly clientVersion: unknown; readonly nodeInfo: unknown; readonly genesis: unknown }): KeelLocalTestChainGasProfile {
  const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const quantity = (value: unknown) => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(value) ? BigInt(value) : undefined;
  const url = new URL(input.rpcUrl), node = record(input.nodeInfo), environment = record(node.environment), genesis = record(input.genesis);
  const gasLimit = quantity(environment.gasLimit);
  if (!["development", "test"].includes(input.environment) || url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || input.clientVersion !== "anvil/v1.8.5" || node.hardFork !== "Osaka" || node.network !== "ethereum"
    || environment.chainId !== 31337 || record(node.forkConfig).forkUrl !== null
    || gasLimit === undefined || gasLimit <= 0n || quantity(genesis.number) !== 0n || quantity(genesis.gasLimit) !== gasLimit
    || typeof genesis.hash !== "string" || !/^0x[0-9a-f]{64}$/iu.test(genesis.hash)) {
    throw new TypeError("Local gas profiles require an explicit development/test loopback Anvil1.8.5 Osaka chain31337 with verified genesis and gas limits.");
  }
  const profile = Object.freeze({ schema: "keel-local-test-chain-gas-profile@1" as const, chainId: 31337 as const, hardfork: "Osaka" as const,
    clientVersion: "anvil/v1.8.5" as const, genesisHash: genesis.hash.toLowerCase(), blockGasLimit: gasLimit.toString() });
  localProfiles.add(profile); return profile;
}
export interface KeelTransactionGasPolicy {
  readonly profile: "ethereum-pre-amsterdam" | "sepolia-amsterdam" | "local-anvil-osaka";
  readonly chainId: number;
  readonly blockTimestamp: bigint;
  readonly maximumExecutionGas: bigint;
  readonly maximumTotalGas: bigint;
  readonly separateStateGas: boolean;
  readonly transactionBaseGas: number;
  readonly recipientAccessGas: number;
  readonly valueTransferGas: number;
  readonly zeroCalldataGas: number;
  readonly nonzeroCalldataGas: number;
  readonly zeroCalldataFloorGas: number;
  readonly nonzeroCalldataFloorGas: number;
}
export function resolveKeelTransactionGasPolicy(input: { readonly chainId: number; readonly blockTimestamp: bigint; readonly blockGasLimit: bigint; readonly localTestChainProfile?: KeelLocalTestChainGasProfile | undefined }): KeelTransactionGasPolicy {
  if (typeof input.blockTimestamp !== "bigint" || input.blockTimestamp < 0n || typeof input.blockGasLimit !== "bigint" || input.blockGasLimit <= 0n) throw new TypeError("Transaction gas policy requires the actual selected-chain block timestamp and gas limit.");
  const local = input.localTestChainProfile;
  if (local !== undefined && (input.chainId !== 31337 || !localProfiles.has(local) || input.blockGasLimit > BigInt(local.blockGasLimit))) throw new TypeError("The explicit local transaction gas profile does not match this chain or block.");
  if (input.chainId !== 1 && input.chainId !== 11_155_111 && !(input.chainId === 31337 && local !== undefined)) throw new TypeError("This chain needs an explicitly registered transaction gas profile.");
  const amsterdam = input.chainId === 11_155_111 && input.blockTimestamp >= KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP;
  const total = amsterdam ? 4_294_967_295n : 16_777_216n;
  // Anvil's simulator/txpool can accept larger envelopes. The local fixture
  // deliberately admits only the conservative 2^24 subset; no public-chain claim.
  return Object.freeze({ profile: local ? "local-anvil-osaka" : amsterdam ? "sepolia-amsterdam" : "ethereum-pre-amsterdam", chainId: input.chainId, blockTimestamp: input.blockTimestamp,
    maximumExecutionGas: 16_777_216n, maximumTotalGas: input.blockGasLimit < total ? input.blockGasLimit : total,
    separateStateGas: amsterdam, transactionBaseGas: amsterdam ? 12_000 : 21_000, recipientAccessGas: amsterdam ? 3_000 : 0, valueTransferGas: amsterdam ? 6_000 : 0,
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
