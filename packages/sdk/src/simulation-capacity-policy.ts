import { KeelPublicationSimulationError, type KeelPreflightTransport } from "./publication-preflight.js";
import type { KeelTransactionGasPolicy } from "./transaction-gas-policy.js";

/** Protocol defaults are keyed by chain. They are not claims about an RPC's
 * configured gas cap. Unknown chains need a reviewed transaction-gas profile. */
export const KEEL_SIMULATION_CHAIN_DEFAULTS = Object.freeze({
  1: Object.freeze({ maximumBlocks: 256 }),
  11155111: Object.freeze({ maximumBlocks: 256 }),
});
export const KEEL_SIMULATION_CAPABILITY_MAXIMUM_AGE_MS = 300_000;
export function keelSimulationChainDefaults(chainId: number) {
  const defaults = KEEL_SIMULATION_CHAIN_DEFAULTS[chainId as keyof typeof KEEL_SIMULATION_CHAIN_DEFAULTS];
  if (!Number.isSafeInteger(chainId) || !defaults) throw new KeelPublicationSimulationError("configuration-invalid", "This chain needs an explicitly registered transaction and simulation profile.");
  return defaults;
}
export interface KeelSimulationProviderLimits {
  /** Whole eth_simulateV1 request, shared across simulated blocks. For Geth,
   * used gas is deducted; the envelope sum is NOT its measured execution. */
  readonly requestGasCap?: bigint;
  readonly transactionGasCap?: bigint;
  readonly blockGasCap?: bigint;
  readonly maximumRequestBytes?: number;
  readonly maximumBlocks?: number;
}
/** Caller-supplied measured infrastructure facts, never permission to disclose.
 * A profile must match an existing configured URL and the selected chain. */
export interface KeelMeasuredSimulationProviderCapability {
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly measuredAt: string;
  readonly limits: KeelSimulationProviderLimits;
}
export function snapshotKeelSimulationProviderLimits(value: KeelSimulationProviderLimits): Readonly<KeelSimulationProviderLimits> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["requestGasCap", "transactionGasCap", "blockGasCap", "maximumRequestBytes", "maximumBlocks"].includes(key)))
    throw new KeelPublicationSimulationError("configuration-invalid", "Use separate measured request, transaction and block capacities.");
  const copy = { ...value };
  for (const key of ["requestGasCap", "transactionGasCap", "blockGasCap"] as const) {
    const cap = copy[key];
    if (cap !== undefined && (typeof cap !== "bigint" || cap <= 0n || cap > 18_446_744_073_709_551_615n))
      throw new KeelPublicationSimulationError("configuration-invalid", "Measured gas capacities must be positive bounded quantities.");
  }
  for (const [key, maximum] of [["maximumRequestBytes", 1_073_741_824], ["maximumBlocks", 256]] as const) {
    const cap = copy[key];
    if (cap !== undefined && (!Number.isSafeInteger(cap) || cap < 1 || cap > maximum))
      throw new KeelPublicationSimulationError("configuration-invalid", "Measured RPC size and block capacities must be bounded.");
  }
  return Object.freeze(copy);
}
const object = (v: unknown): Record<string, unknown> | undefined => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const quantity = (v: unknown): bigint | undefined => typeof v === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(v) ? BigInt(v) : undefined;
export interface KeelSimulationProgramMeasurement {
  readonly blockCount: number; readonly callCount: number; readonly calldataBytes: number; readonly requestPayloadBytes: number;
  readonly requestedEnvelopeGas: bigint; readonly largestTransactionGas: bigint; readonly largestBlockEnvelopeGas: bigint;
}
/** Measures the actual exact request, with no threshold based on resource count. */
export function measureKeelSimulationProgram(request: Parameters<KeelPreflightTransport["request"]>[0]): KeelSimulationProgramMeasurement {
  const blocks = object(request.params[0])?.blockStateCalls;
  if (request.method !== "eth_simulateV1" || !Array.isArray(blocks) || !blocks.length || blocks.length > 256)
    throw new KeelPublicationSimulationError("configuration-invalid", "Measure the complete bounded simulation program.");
  let callCount = 0, calldataBytes = 0, requestedEnvelopeGas = 0n, largestTransactionGas = 0n, largestBlockEnvelopeGas = 0n;
  for (const block of blocks) {
    const calls = object(block)?.calls; let blockGas = 0n;
    if (!Array.isArray(calls) || !calls.length) throw new KeelPublicationSimulationError("configuration-invalid", "Measure every original simulation call.");
    for (const item of calls) {
      const call = object(item), gas = quantity(call?.gas), data = call?.data;
      if (gas === undefined || gas <= 0n || gas > 18_446_744_073_709_551_615n || typeof data !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(data))
        throw new KeelPublicationSimulationError("configuration-invalid", "Measure exact call bytes and bounded gas envelopes.");
      callCount++; calldataBytes += (data.length - 2) / 2; blockGas += gas;
      if (gas > largestTransactionGas) largestTransactionGas = gas;
    }
    requestedEnvelopeGas += blockGas;
    if (blockGas > largestBlockEnvelopeGas) largestBlockEnvelopeGas = blockGas;
  }
  return Object.freeze({ blockCount: blocks.length, callCount, calldataBytes, requestPayloadBytes: new TextEncoder().encode(JSON.stringify(request)).byteLength,
    requestedEnvelopeGas, largestTransactionGas, largestBlockEnvelopeGas });
}
/** Actual selected-fork transaction/calldata lower bound, not execution usage
 * or the conservative 21000 allocation used by public qualification probes. */
export function measureKeelSimulationIntrinsicGas(request: Parameters<KeelPreflightTransport["request"]>[0], policy: KeelTransactionGasPolicy) {
  measureKeelSimulationProgram(request);
  const blocks = object(request.params[0])!.blockStateCalls as readonly { readonly calls: readonly Record<string, unknown>[] }[];
  let intrinsicProgramGas = 0n, largestIntrinsicCallGas = 0n, calldataFloorGas = 0n;
  for (const block of blocks) for (const call of block.calls) {
    if (![call.from, call.to].every(value => typeof value === "string" && /^0x[0-9a-f]{40}$/iu.test(value)) || quantity(call.value) === undefined)
      throw new KeelPublicationSimulationError("configuration-invalid", "Intrinsic measurement requires exact transaction identities and value.");
    const data = call.data as string;
    let regular = 0n, floor = 0n;
    for (let offset = 2; offset < data.length; offset += 2) {
      const zero = data.slice(offset, offset + 2) === "00";
      regular += BigInt(zero ? policy.zeroCalldataGas : policy.nonzeroCalldataGas);
      floor += BigInt(zero ? policy.zeroCalldataFloorGas : policy.nonzeroCalldataFloorGas);
    }
    const external = (call.from as string).toLowerCase() !== (call.to as string).toLowerCase();
    const base = BigInt(policy.transactionBaseGas + (external ? policy.recipientAccessGas : 0)
      + (external && quantity(call.value)! !== 0n ? policy.valueTransferGas : 0));
    const intrinsic = base + (regular > floor ? regular : floor);
    intrinsicProgramGas += intrinsic; calldataFloorGas += floor;
    if (intrinsic > largestIntrinsicCallGas) largestIntrinsicCallGas = intrinsic;
  }
  return Object.freeze({ intrinsicProgramGas, largestIntrinsicCallGas, calldataFloorGas });
}
/** Response metrics are not a publication proof. The caller still authenticates
 * headers, exact returns, state, nonce/fees and the complete strict replay. */
export function measureKeelSimulationExecution(request: Parameters<KeelPreflightTransport["request"]>[0], result: unknown) {
  const blocks = object(request.params[0])?.blockStateCalls;
  if (!Array.isArray(blocks) || !Array.isArray(result) || blocks.length !== result.length) return undefined;
  let gasUsed = 0n, maxUsedGas = 0n, requiredRequestGas = 0n, requiredBlockGas = 0n;
  for (const [i, block] of blocks.entries()) {
    let blockGasUsed = 0n;
    const calls = object(block)?.calls, outputs = object(result[i])?.calls, transactions = object(result[i])?.transactions;
    if (!Array.isArray(calls) || !Array.isArray(outputs) || !Array.isArray(transactions) || calls.length !== outputs.length || calls.length !== transactions.length) return undefined;
    for (const [j, call] of calls.entries()) {
      const envelope = quantity(object(call)?.gas), returnedGas = quantity(object(transactions[j])?.gas), output = object(outputs[j]);
      const used = quantity(output?.gasUsed), maximum = quantity(output?.maxUsedGas);
      if (envelope === undefined || returnedGas !== envelope || output?.status !== "0x1" || output.error !== undefined
        || used === undefined || used <= 0n || maximum === undefined || maximum < used || maximum > envelope) return undefined;
      // Geth deducts gasUsed across blocks. To keep EACH exact envelope, the
      // request budget must cover previous usage plus this transaction's gas.
      if (gasUsed + envelope > requiredRequestGas) requiredRequestGas = gasUsed + envelope;
      if (blockGasUsed + envelope > requiredBlockGas) requiredBlockGas = blockGasUsed + envelope;
      blockGasUsed += used;
      gasUsed += used; maxUsedGas += maximum;
    }
  }
  return Object.freeze({ gasUsed, maxUsedGas, requiredRequestGas, requiredBlockGas });
}
/** A known infrastructure limit may exclude a backend, never modify the program.
 * An envelope sum above requestGasCap alone is not a reason to exclude it. */
export function keelSimulationProviderCapacityFailure(measurement: KeelSimulationProgramMeasurement, limits: KeelSimulationProviderLimits,
  execution?: ReturnType<typeof measureKeelSimulationExecution>,
  intrinsic?: ReturnType<typeof measureKeelSimulationIntrinsicGas>): KeelPublicationSimulationError | undefined {
  const gas = execution?.requiredRequestGas ?? measurement.largestTransactionGas;
  const dimensions = [
    ["transaction", measurement.largestTransactionGas, limits.transactionGasCap],
    // A block gas pool also returns unused gas between transactions. Without
    // actual response usage, its envelope sum cannot exclude a valid program.
    ["block", execution?.requiredBlockGas ?? measurement.largestTransactionGas, limits.blockGasCap],
    ["request", gas, limits.requestGasCap],
  ] as const;
  const base = { callCount: measurement.callCount, blockCount: measurement.blockCount, calldataBytes: measurement.calldataBytes,
    requestPayloadBytes: measurement.requestPayloadBytes, requestedEnvelopeGas: measurement.requestedEnvelopeGas.toString(), requiredProgramGas: measurement.requestedEnvelopeGas.toString(),
    largestTransactionGas: measurement.largestTransactionGas.toString(), largestBlockEnvelopeGas: measurement.largestBlockEnvelopeGas.toString() };
  if (intrinsic && limits.requestGasCap !== undefined && intrinsic.intrinsicProgramGas > limits.requestGasCap)
    return new KeelPublicationSimulationError("provider-limit", "The exact selected-fork transaction and calldata floor exceeds this provider's measured whole-request capacity.",
      { ...base, gasCapacityScope: "request", requestedGasLimit: intrinsic.intrinsicProgramGas.toString(), providerGasCap: limits.requestGasCap.toString(),
        intrinsicProgramGas: intrinsic.intrinsicProgramGas.toString(), minimumProgramGas: intrinsic.intrinsicProgramGas.toString(),
        calldataFloorGas: intrinsic.calldataFloorGas.toString(), largestMinimumCallGas: intrinsic.largestIntrinsicCallGas.toString(), capacitySource: "measured-profile" });
  for (const [scope, required, cap] of dimensions) if (cap !== undefined && required > cap)
    return new KeelPublicationSimulationError("provider-limit", "The configured provider lacks capacity for the unchanged complete program. Retry through a compatible approved provider; no transaction was submitted.",
      { ...base, gasCapacityScope: scope, requestedGasLimit: required.toString(), providerGasCap: cap.toString(), capacitySource: "measured-profile" });
  for (const [scope, required, cap] of [["request-bytes", measurement.requestPayloadBytes, limits.maximumRequestBytes], ["request-blocks", measurement.blockCount, limits.maximumBlocks]] as const)
    if (cap !== undefined && required > cap) return new KeelPublicationSimulationError("provider-limit", "The configured provider cannot accept this complete program. Retry through a compatible approved provider; the content and plan are unchanged.",
      { ...base, gasCapacityScope: scope, requiredCapacity: required, providerCapacity: cap, capacitySource: "measured-profile" });
  return undefined;
}
