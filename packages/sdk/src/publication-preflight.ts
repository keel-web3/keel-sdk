import { KEEL_INLINE_MAX_TOKEN_URI_BYTES, KEEL_INLINE_SAFE_RPC_GAS } from "./presentation.js";
import { keelExecutorGasLimit } from "./managed-publication.js";
import { resolveKeelTransactionGasPolicy, assertKeelAmsterdamSimulationHeader } from "./transaction-gas-policy.js";
import { canonicalJson, createIntegrity } from "@keel/protocol";
import { encodeAbiParameters, encodeFunctionData, parseAbi, getAddress, keccak256, stringToHex, type Hex } from "viem";

export interface KeelSimulationCall {
  readonly from: Hex;
  readonly to: Hex;
  readonly data: Hex;
  readonly value: Hex;
  readonly gas: Hex;
  readonly nonce?: Hex;
  readonly gasPrice?: Hex;
  readonly maxFeePerGas?: Hex;
  readonly maxPriorityFeePerGas?: Hex;
}
export interface KeelPublicationSimulationInput {
  /** Server-owned identity of the exact prepared source, release, defaults, and quote. */
  readonly transactionContext?: "atomic-wallet";
  readonly planFingerprint: string;
  readonly chainId: number;
  readonly blockNumber?: bigint;
  readonly reader: Hex;
  readonly readerRuntimeCodeHash: Hex;
  /** A collection created by the validated calls can be the final target. */
  readonly metadataTarget?: Hex;
  /** Ephemeral context only (for example minting token 1 to inspect tokenURI). Never wallet calls. */
  readonly observationCalls?: readonly KeelSimulationCall[];
  /** Exact standalone reader gates that release preparation will require after storage. */
  readonly requiredReaderCalls?: readonly { readonly call: KeelSimulationCall; readonly expectedReturn: Hex; readonly gasMargin: bigint }[];
  /** Exact planned, unsigned storage/contract calls, in execution order. */
  readonly preparationCalls: readonly KeelSimulationCall[];
  readonly assertions?: readonly { readonly callIndex: number; readonly returnData: Hex }[];
  /** Last call reads the complete tokenURI from the selected registered reader. */
  readonly metadataCall: KeelSimulationCall;
  readonly expectedTokenURI: string;
  readonly maximumTokenUriBytes: number;
  readonly maximumReadGas: bigint;
  readonly collectionOverheadGas: bigint;
  /** Configured selected-chain transaction cap. Never inferred from a successful simulation. */
  readonly maximumTransactionGas: bigint;
}
export interface KeelPreflightTransport {
  request(input: { readonly method: string; readonly params: readonly unknown[] }): Promise<unknown>;
}

export function keelFundingApprovalDigest(input: { readonly chainId: number; readonly owner: string; readonly approval: { readonly to: string; readonly data: string; readonly value: string } }): Hex {
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1 || !/^0x(?:[0-9a-f]{2})*$/iu.test(input.approval.data) || BigInt(input.approval.value) < 0n) throw new TypeError("Invalid exact funding approval.");
  return keccak256(stringToHex(JSON.stringify({ chainId: input.chainId, owner: getAddress(input.owner).toLowerCase(), to: getAddress(input.approval.to).toLowerCase(), data: input.approval.data.toLowerCase(), value: BigInt(input.approval.value).toString() })));
}

/** Revalidate at the wallet boundary. A successful planning flag is never a substitute. */
export function assertKeelFundingPreflight(input: {
  readonly preparation: unknown; readonly chainId: number; readonly owner: string; readonly artifactId: string; readonly artifactRevision: number; readonly manifestDigest: string; readonly now: number;
}) {
  const value = record(input.preparation), approval = record(value?.approval), proof = record(value?.preflight);
  if (value?.status !== "approval-required" || value.walletApprovalRequired !== true || !approval || typeof approval.to !== "string" || typeof approval.data !== "string" || typeof approval.value !== "string"
    || proof?.status !== "verified" || proof.schema !== "keel-publication-simulation@1" || proof.readPolicy !== "keel-inline-read-policy@1" || !["collector-metadata", "storage-only"].includes(String(proof.verification)) || proof.state !== "ephemeral-simulation" || proof.signing !== "not-performed" || proof.submission !== "not-performed") throw new TypeError("A completed, exact publication simulation is required before a new funding request.");
  if (proof.chainId !== input.chainId || proof.artifactId !== input.artifactId || proof.artifactRevision !== input.artifactRevision || typeof proof.manifestDigest !== "string" || proof.manifestDigest.toLowerCase() !== input.manifestDigest.toLowerCase()) throw new TypeError("The project or network changed after preflight. Review the current plan again.");
  if (!Number.isFinite(input.now) || typeof proof.expiresAt !== "string" || !Number.isFinite(Date.parse(proof.expiresAt)) || Date.parse(proof.expiresAt) <= input.now || typeof proof.checkedAt !== "string" || Date.parse(proof.checkedAt) > input.now || !Number.isFinite(Date.parse(proof.checkedAt)) || Date.parse(proof.expiresAt) <= Date.parse(proof.checkedAt) || Date.parse(proof.expiresAt) - Date.parse(proof.checkedAt) > 120_000) throw new TypeError("The funding preflight expired. Check the current plan before opening the wallet.");
  const digest = keelFundingApprovalDigest({ chainId: input.chainId, owner: input.owner, approval: { to: approval.to, data: approval.data, value: approval.value } });
  if (proof.approvalDigest !== digest || typeof proof.planFingerprint !== "string" || !/^0x[0-9a-f]{64}$/iu.test(proof.planFingerprint)) throw new TypeError("The exact funding calldata or value changed after preflight.");
  const gas = Array.isArray(proof.transactionGasLimits) ? proof.transactionGasLimits[0] : undefined;
  if (proof.gasMeasurement !== "pre-refund-max-used" || typeof gas !== "string" || !/^[1-9]\d*$/u.test(gas)) throw new TypeError("The funding call needs its exact validated gas envelope.");
  return { approvalDigest: digest, planFingerprint: proof.planFingerprint, fundingGasLimit: BigInt(gas) };
}
export type KeelSimulationFailure = "unsupported-simulation" | "insufficient-balance" | "provider-limit" | "rpc-unavailable" | "wrong-chain" | "reader-mismatch" | "execution-reverted" | "metadata-mismatch" | "storage-mismatch" | "metadata-size-limit" | "read-gas-limit" | "configuration-invalid" | "chain-reorganized";
export class KeelPublicationSimulationError extends Error {
  constructor(readonly kind: KeelSimulationFailure, message: string, readonly diagnostic?: Readonly<Record<string, string | number>>) { super(message); this.name = "KeelPublicationSimulationError"; }
}
const failure = (kind: KeelSimulationFailure, message: string, diagnostic?: Readonly<Record<string, string | number>>): never => { throw new KeelPublicationSimulationError(kind, message, diagnostic); };
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const quantity = (value: unknown): bigint | undefined => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(value) ? BigInt(value) : undefined;
const bytes = (value: unknown): value is Hex => typeof value === "string" && /^0x(?:[0-9a-f]{2})*$/iu.test(value);

function validatedCall(value: KeelSimulationCall, maximumGas: bigint, transaction = false): KeelSimulationCall {
  if (!value || typeof value !== "object" || Object.keys(value).some(key => !["from", "to", "data", "value", "gas", "nonce", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"].includes(key))) return failure("configuration-invalid", "Simulation accepts only exact planned calls, without state or code overrides.");
  const gas = quantity(value.gas);
  if (!bytes(value.data) || quantity(value.value) === undefined || gas === undefined || gas <= 0n || gas > maximumGas) return failure("configuration-invalid", "A planned call has invalid bytes, value, or selected-chain gas bounds.");
  if (value.nonce !== undefined && (!transaction || quantity(value.nonce) === undefined || BigInt(value.nonce) > 18_446_744_073_709_551_615n)) return failure("configuration-invalid", "An explicit transaction nonce must be a bounded canonical quantity.");
  const legacy = value.gasPrice !== undefined;
  const dynamic = value.maxFeePerGas !== undefined || value.maxPriorityFeePerGas !== undefined;
  if ((legacy && dynamic) || (transaction && !legacy && !dynamic)
    || (legacy && quantity(value.gasPrice) === undefined)
    || (dynamic && (quantity(value.maxFeePerGas) === undefined || quantity(value.maxPriorityFeePerGas) === undefined
      || BigInt(value.maxPriorityFeePerGas!) > BigInt(value.maxFeePerGas!)))) return failure("configuration-invalid", "Transaction simulation requires one explicit valid fee envelope; fee styles cannot be mixed.");
  const fees = legacy ? { gasPrice: value.gasPrice! } : dynamic ? { maxFeePerGas: value.maxFeePerGas!, maxPriorityFeePerGas: value.maxPriorityFeePerGas! } : {};
  try { return Object.freeze({ from: getAddress(value.from), to: getAddress(value.to), data: value.data, value: value.value, gas: value.gas, ...(value.nonce === undefined ? {} : { nonce: value.nonce }), ...fees }); }
  catch { return failure("configuration-invalid", "A planned call needs valid sender and target addresses."); }
}
function classifiedTransportFailure(error: unknown): never {
  if (error instanceof KeelPublicationSimulationError) throw error;
  let cursor: unknown = error;
  const seen = new Set<unknown>();
  let unsupported = false, limited = false, reverted = false, insufficient = false;
  let providerGasCap: bigint | undefined;
  for (let depth = 0; depth < 8 && cursor && !seen.has(cursor); depth++) {
    seen.add(cursor); const item = record(cursor); if (!item) break;
    unsupported ||= item.code === -32601 || item.code === 4200;
    const message = [item.message, item.shortMessage, item.details].filter(value => typeof value === "string").join(" ");
    for (const match of message.matchAll(/(?:gas cap|maximum allowed gas|gas limit too high[^\n]*?cap)\s*[:=(]\s*(0x[\da-f]+|\d+)/giu)) {
      const raw = match[1];
      if (raw && raw.length <= 20) { const cap = BigInt(raw); if (cap > 0n && (providerGasCap === undefined || cap < providerGasCap)) providerGasCap = cap; }
    }
    insufficient ||= item.code === -38014 || /insufficient funds for (?:gas|transfer)|insufficient balance/iu.test(message);
    reverted ||= item.code === 3 || item.name === "ContractFunctionRevertedError" || /execution reverted|reverted with|out of gas/iu.test(message);
    limited ||= /gas limit (?:is )?(?:too high|exceeds|higher than)|exceeds (?:the )?(?:rpc|simulation) gas cap|maximum (?:simulation|response) size exceeded/iu.test(message);
    cursor = item.cause;
  }
  if (reverted) return failure("execution-reverted", "A planned contract execution reverted or exhausted its gas bound. Resolve that failure before payment; do not infer a delivery-size limit.");
  if (insufficient) return failure("insufficient-balance", "A planned transaction lacks the balance for its exact validated gas and value. Review the sender funding before payment; no transaction was submitted.");
  if (unsupported) return failure("unsupported-simulation", "This RPC does not support the required read-only publication simulation. Choose a compatible configured provider before a new payment.");
  if (limited || providerGasCap !== undefined) return failure("provider-limit", "The provider rejected the simulation at its configured limit. This does not prove that the artwork or its complete metadata is too large.", providerGasCap === undefined ? undefined : { providerGasCap: providerGasCap.toString() });
  return failure("rpc-unavailable", "The publication simulation could not finish. Retry the same prepared plan; no transaction was submitted.");
}

/**
 * Execute the exact ordered calls only in the RPC's ephemeral eth_simulateV1 state.
 * No code, storage, balance or block-limit override is accepted. All calls must
 * succeed in transaction validation, followed by an exact public-read replay whose
 * complete ABI return must match byte for byte. A browser preview,
 * a size estimate, or a provider error can never produce a passing result.
 * Reference: https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-eth#eth-simulate-v1
 */
export async function simulateKeelPublicationBeforeFunding(input: KeelPublicationSimulationInput, transport: KeelPreflightTransport) {
  return performPublicationSimulation(input, transport, { kind: "collector-metadata" });
}

/** Explicit storage-only intent verifies the exact object-creation plan, without claiming NFT metadata readiness. */
export async function simulateKeelStorageBeforeFunding(input: Omit<KeelPublicationSimulationInput, "expectedTokenURI" | "maximumTokenUriBytes" | "collectionOverheadGas"> & { readonly expectedObjectId: Hex }, transport: KeelPreflightTransport) {
  if ((input.requiredReaderCalls !== undefined && (!Array.isArray(input.requiredReaderCalls) || input.requiredReaderCalls.length !== 0))
    || (input.observationCalls !== undefined && (!Array.isArray(input.observationCalls) || input.observationCalls.length !== 0))
    || (input.metadataTarget !== undefined && (typeof input.metadataTarget !== "string" || input.metadataTarget.toLowerCase() !== input.reader.toLowerCase()))) {
    return failure("configuration-invalid", "Storage-only proof cannot add ephemeral writes or read a different contract than the selected store.");
  }
  if (!/^0x[0-9a-f]{64}$/iu.test(input.expectedObjectId)) return failure("configuration-invalid", "Storage simulation needs the exact predicted manifest object ID.");
  const expectedCall = encodeFunctionData({ abi: parseAbi(["function objectExists(bytes32 objectId) view returns (bool)"]), functionName: "objectExists", args: [input.expectedObjectId] });
  if (input.metadataCall.data.toLowerCase() !== expectedCall.toLowerCase()) return failure("configuration-invalid", "The storage observation must check the exact predicted manifest object.");
  return performPublicationSimulation({ ...input, expectedTokenURI: "", maximumTokenUriBytes: 1, collectionOverheadGas: 0n }, transport, { kind: "storage-only", objectId: input.expectedObjectId });
}

async function performPublicationSimulation(input: KeelPublicationSimulationInput, transport: KeelPreflightTransport,
  expectation: { readonly kind: "collector-metadata" } | { readonly kind: "storage-only"; readonly objectId: Hex }) {
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1 || !/^(?:0x|sha256:)[0-9a-f]{64}$/iu.test(input.planFingerprint)
    || !/^0x[0-9a-f]{64}$/iu.test(input.readerRuntimeCodeHash) || !Number.isSafeInteger(input.maximumTokenUriBytes) || input.maximumTokenUriBytes < 1
    || (input.blockNumber !== undefined && (typeof input.blockNumber !== "bigint" || input.blockNumber < 0n))
    || input.maximumReadGas <= 0n || input.maximumTransactionGas <= 0n || input.collectionOverheadGas < 0n
    || !Array.isArray(input.preparationCalls) || input.preparationCalls.length > 255 || (input.observationCalls !== undefined && !Array.isArray(input.observationCalls)) || typeof input.expectedTokenURI !== "string") return failure("configuration-invalid", "The exact publication fingerprint, network, reader, and measured-read limits are required.");
  if (input.maximumReadGas > KEEL_INLINE_SAFE_RPC_GAS || input.maximumTokenUriBytes > KEEL_INLINE_MAX_TOKEN_URI_BYTES) return failure("configuration-invalid", "Inline simulation cannot exceed the shared SDK read-gas and complete-metadata policy ceilings.");
  const completeBytes = new TextEncoder().encode(input.expectedTokenURI).byteLength;
  if (completeBytes > input.maximumTokenUriBytes) return failure("metadata-size-limit", "The complete prepared tokenURI exceeds this delivery mode's byte limit. Review a supported Hybrid or IPFS route before paying for new storage.");
  const preparationCalls = input.preparationCalls.map(call => validatedCall(call, input.maximumTransactionGas, true));
  const observationCalls = (input.observationCalls ?? []).map(call => validatedCall(call, input.maximumTransactionGas));
  if (input.requiredReaderCalls !== undefined && !Array.isArray(input.requiredReaderCalls)) return failure("configuration-invalid", "Required reader checks must be exact calls and return bytes.");
  const requiredReaderCalls = (input.requiredReaderCalls ?? []).map(check => {
    const call = validatedCall(check.call, input.maximumReadGas);
    if (call.to.toLowerCase() !== input.reader.toLowerCase() || BigInt(call.value) !== 0n || !bytes(check.expectedReturn) || (check.expectedReturn.length - 2) / 2 > 64 + Math.ceil(input.maximumTokenUriBytes / 32) * 32
      || typeof check.gasMargin !== "bigint" || check.gasMargin < 0n || check.gasMargin >= BigInt(call.gas)) return failure("configuration-invalid", "Required reader checks must use the selected reader, zero value, exact return bytes and a bounded gas margin.");
    return { call, expectedReturn: check.expectedReturn.toLowerCase(), gasMargin: check.gasMargin.toString() };
  });
  if (preparationCalls.length + observationCalls.length + requiredReaderCalls.length > 255) return failure("configuration-invalid", "The exact simulation exceeds its block bound.");
  const metadataCall = validatedCall(input.metadataCall, input.maximumReadGas);
  if (input.collectionOverheadGas >= BigInt(metadataCall.gas)) return failure("read-gas-limit", "The metadata call budget cannot accommodate its required read margin.");
  if (BigInt(metadataCall.value) !== 0n) return failure("configuration-invalid", "The final metadata observation cannot transfer value.");
  const assertions = (input.assertions ?? []).map(assertion => {
    if (!Number.isSafeInteger(assertion.callIndex) || assertion.callIndex < 0 || assertion.callIndex >= preparationCalls.length || !bytes(assertion.returnData)) return failure("configuration-invalid", "Simulation assertions must address exact prepared calls and bytes.");
    return Object.freeze({ callIndex: assertion.callIndex, returnData: assertion.returnData.toLowerCase() });
  });
  if (assertions.length > preparationCalls.length || new Set(assertions.map(assertion => assertion.callIndex)).size !== assertions.length) return failure("configuration-invalid", "Simulation assertions must be unique and bounded.");
  let reader: Hex, metadataTarget: Hex;
  try { reader = getAddress(input.reader); metadataTarget = getAddress(input.metadataTarget ?? input.reader); } catch { return failure("configuration-invalid", "The selected reader address is invalid."); }
  if (metadataCall.to.toLowerCase() !== metadataTarget.toLowerCase()) return failure("configuration-invalid", "The final simulation call must target the exact planned metadata contract.");
  const expectedReturn = expectation.kind === "storage-only" ? encodeAbiParameters([{ type: "bool" }], [true]).toLowerCase() : encodeAbiParameters([{ type: "string" }], [input.expectedTokenURI]).toLowerCase();
  const identityBase = { readPolicy: "keel-inline-read-policy@1", policyGasCeiling: KEEL_INLINE_SAFE_RPC_GAS.toString(), policyTokenUriByteCeiling: KEEL_INLINE_MAX_TOKEN_URI_BYTES, planFingerprint: input.planFingerprint, chainId: input.chainId, reader, runtimeCodeHash: input.readerRuntimeCodeHash.toLowerCase(),
    transactionContext: input.transactionContext ?? "independent-transactions", completeTokenUriBytes: completeBytes, maximumTokenUriBytes: input.maximumTokenUriBytes, maximumReadGas: input.maximumReadGas.toString(), collectionOverheadGas: input.collectionOverheadGas.toString(), maximumTransactionGas: input.maximumTransactionGas.toString(), preparationCalls, observationCalls, requiredReaderCalls, metadataTarget, metadataCall, assertions,
    blockTag: input.blockNumber === undefined ? "latest" : `0x${input.blockNumber.toString(16)}`, expectation, validation: "transactions-then-public-read" };
  const metadataDigest = (await createIntegrity(new TextEncoder().encode(input.expectedTokenURI))).digest;
  // Snapshot all inputs before the first asynchronous transport call.
  const identity = { ...identityBase, metadataDigest };

  const request = async (method: string, params: readonly unknown[]) => { try { return await transport.request({ method, params }); } catch (error) { return classifiedTransportFailure(error); } };
  if (quantity(await request("eth_chainId", [])) !== BigInt(identity.chainId)) return failure("wrong-chain", "The configured RPC returned another chain. No payment can be prepared from this proof.");
  const block = record(await request("eth_getBlockByNumber", [identity.blockTag, false]));
  const blockNumber = quantity(block?.number), blockGasLimit = quantity(block?.gasLimit);
  if (blockNumber === undefined || blockGasLimit === undefined || typeof block?.hash !== "string" || !/^0x[0-9a-f]{64}$/iu.test(block.hash)) return failure("rpc-unavailable", "The simulation needs a verifiable selected-chain block.");
  if (identity.blockTag !== "latest" && blockNumber !== BigInt(identity.blockTag)) return failure("rpc-unavailable", "The provider returned another block than the exact requested simulation snapshot.");
  const blockTimestamp = quantity(block.timestamp);
  if (blockTimestamp === undefined) return failure("rpc-unavailable", "The simulation needs the actual selected-chain timestamp for its transaction gas rules.");
  let transactionPolicy;
  try { transactionPolicy = resolveKeelTransactionGasPolicy({ chainId: identity.chainId, blockTimestamp, blockGasLimit }); }
  catch { return failure("configuration-invalid", "This selected chain needs an explicitly registered transaction gas profile."); }
  if (BigInt(identity.maximumTransactionGas) > transactionPolicy.maximumTotalGas) return failure("configuration-invalid", "The configured total transaction envelope exceeds the selected fork or block limit.");
  const transactionGasPolicy = { profile: transactionPolicy.profile, blockTimestamp: blockTimestamp.toString(),
    maximumExecutionGas: transactionPolicy.maximumExecutionGas.toString(), maximumTotalGas: transactionPolicy.maximumTotalGas.toString(),
    separateStateGas: transactionPolicy.separateStateGas, validation: "selected-fork-transaction-validation" as const };
  if ([...preparationCalls, ...requiredReaderCalls.map(check => check.call), ...observationCalls, metadataCall].some(call => BigInt(call.gas) > blockGasLimit)) return failure("configuration-invalid", "A planned call exceeds the actual selected-chain block gas limit.");
  const code = await request("eth_getCode", [reader, block.number]);
  if (!bytes(code) || code === "0x" || keccak256(code).toLowerCase() !== identity.runtimeCodeHash) return failure("reader-mismatch", "The selected reader's deployed code does not match its registered identity.");
  // Transaction validity and public-call gas budgets are different. First validate
  // every real transaction; then replay those exact calls in eth_call semantics to
  // observe the result with its configured public read budget. No overrides apply.
  const atomicContext = input.transactionContext === "atomic-wallet";
  if (atomicContext && (preparationCalls.length !== 1 || preparationCalls[0]!.from.toLowerCase() !== preparationCalls[0]!.to.toLowerCase() || !preparationCalls[0]!.data.startsWith("0xe9ae5c53"))) return failure("configuration-invalid", "An atomic-wallet preflight requires its complete creator self-call program.");
  const simulate = async (calls: readonly KeelSimulationCall[], validation: boolean) => {
    if (!calls.length) return [];
    const response = await request("eth_simulateV1", [{ blockStateCalls: calls.map(call => ({ calls: [call] })), validation, traceTransfers: false, returnFullTransactions: true }, block.number]);
    if (!Array.isArray(response) || response.length !== calls.length) return failure("rpc-unavailable", "The provider returned an incomplete publication simulation.");
    // Every transport must prove the requested envelopes before any apparent
    // execution failure is interpreted. A successful socket capacity probe is
    // not evidence for these exact calls or an explicit HTTP override.
    for (const [index, call] of calls.entries()) {
      const transactions = record(response[index])?.transactions;
      if (!Array.isArray(transactions) || transactions.length !== 1) return failure("unsupported-simulation", "The simulator did not return complete transaction envelopes.");
      const transaction = record(transactions[0]);
      const actualGas = quantity(transaction?.gas), requestedGas = BigInt(call.gas);
      if (actualGas === undefined) return failure("unsupported-simulation", "The simulator omitted the exact transaction gas envelope.");
      if (actualGas < requestedGas) return failure("provider-limit", "The simulator silently reduced the requested transaction gas. The exact prepared plan requires a compatible provider before wallet approval.", { requestedGasLimit: requestedGas.toString(), providerGasCap: actualGas.toString() });
      if (actualGas !== requestedGas) return failure("unsupported-simulation", "The simulator changed the requested transaction gas envelope.");
      if (call.nonce !== undefined && quantity(transaction?.nonce) !== BigInt(call.nonce)) return failure("unsupported-simulation", "The simulator omitted or changed the explicit transaction nonce.");
    }
    return response.map((item, index) => {
      const parent = index === 0 ? block : record(response[index - 1]);
      const parentSlot = quantity(parent?.slotNumber);
      try { assertKeelAmsterdamSimulationHeader(transactionPolicy, item, { hash: String(parent?.hash), number: quantity(parent?.number) ?? -1n,
        timestamp: quantity(parent?.timestamp) ?? -1n, ...(parentSlot === undefined ? {} : { slotNumber: parentSlot }) }); }
      catch { return failure("unsupported-simulation", "This simulator did not return fork-correct block evidence linked to the selected snapshot."); }
      const results = record(item)?.calls;
      if (!Array.isArray(results) || results.length !== 1) return failure("rpc-unavailable", "A planned call is missing from the simulation result.");
      const result = record(results[0]);
      if (result?.status === "0x0") return failure("execution-reverted", `Planned simulation call ${index + 1} reverted. Its contract failure must be resolved before payment; it is not a delivery-size diagnosis.`, { callIndex: index, target: calls[index]!.to, selector: calls[index]!.data.slice(0, 10), requestedGasLimit: BigInt(calls[index]!.gas).toString(), phase: validation ? "transaction-validation" : "ephemeral-execution" });
      const gasUsed = quantity(result?.gasUsed);
      if (result?.status !== "0x1" || result.error !== undefined || gasUsed === undefined || gasUsed > BigInt(calls[index]!.gas) || !bytes(result.returnData)) return failure("rpc-unavailable", "The provider returned invalid execution evidence.");
      const assertion = assertions.find(assertion => assertion.callIndex === index);
      if (assertion && result.returnData.toLowerCase() !== assertion.returnData) return failure("metadata-mismatch", `Planned simulation call ${index + 1} did not return its required verification bytes.`);
      const maximumUsedGas = quantity(result.maxUsedGas);
      if (result.maxUsedGas !== undefined && (maximumUsedGas === undefined || maximumUsedGas < gasUsed || maximumUsedGas > BigInt(calls[index]!.gas))) return failure("rpc-unavailable", "The provider returned contradictory pre-refund gas evidence.");
      const header = record(item);
      return { gasUsed, maximumUsedGas, returnData: result.returnData.toLowerCase(),
        ...(transactionPolicy.separateStateGas ? { forkHeader: { hash: String(header?.hash), parentHash: String(header?.parentHash),
          timestamp: String(header?.timestamp), blockAccessListHash: String(header?.blockAccessListHash), ...(header?.slotNumber === undefined ? {} : { slotNumber: String(header.slotNumber) }) } } : {}) };
    });
  };
  // Discover pre-refund execution gas without reserving the entire network cap
  // at a nonzero fee. No state/balance override and no transaction is submitted.
  const gasDiscovery = await simulate(atomicContext ? preparationCalls : preparationCalls.map(({ gasPrice: _legacy, maxFeePerGas: _cap, maxPriorityFeePerGas: _tip, ...call }) => call), atomicContext);
  const boundedCalls = preparationCalls.map((call, index) => {
    const maximumUsedGas = gasDiscovery[index]!.maximumUsedGas;
    if (maximumUsedGas === undefined || maximumUsedGas <= 0n) return failure("unsupported-simulation", "This provider does not report pre-refund call gas. A compatible simulator is required before funding.");
    const desired = atomicContext ? (maximumUsedGas * 120n + 99n) / 100n : keelExecutorGasLimit(maximumUsedGas, BigInt(call.gas));
    return { ...call, gas: `0x${(desired > BigInt(call.gas) ? BigInt(call.gas) : desired).toString(16)}` as Hex };
  });
  const transactions = await simulate(boundedCalls, true);
  if (transactions.some((result, index) => result.returnData !== gasDiscovery[index]!.returnData)) return failure("metadata-mismatch", "Bounded transaction validation changed the prepared contract results.");
  let effectiveReadGas = BigInt(identity.maximumReadGas);
  const reserveReadMargin = (call: KeelSimulationCall, margin: bigint): KeelSimulationCall => {
    const budget = BigInt(call.gas) < effectiveReadGas ? BigInt(call.gas) : effectiveReadGas;
    if (budget <= margin) return failure("read-gas-limit", "The available public-read cap cannot accommodate the required release preparation margin.");
    return { ...call, gas: `0x${(budget - margin).toString(16)}` as Hex };
  };
  const readReplayCalls = () => [...boundedCalls,
    ...requiredReaderCalls.map(check => reserveReadMargin(check.call, BigInt(check.gasMargin))),
    ...observationCalls.map(call => reserveReadMargin(call, 0n)),
    reserveReadMargin(metadataCall, BigInt(identity.collectionOverheadGas))];
  let calls = readReplayCalls();
  const readBoundaryAttempts: { readonly requestedGas: string; readonly providerGasCap: string }[] = [];
  let observations;
  for (;;) {
    try { observations = await simulate(calls, false); break; }
    catch (error) {
      const reported = error instanceof KeelPublicationSimulationError && error.kind === "provider-limit" ? error.diagnostic?.providerGasCap : undefined;
      const cap = typeof reported === "string" ? BigInt(reported) : undefined;
      if (cap === undefined || cap <= 0n || cap >= effectiveReadGas || readBoundaryAttempts.length >= 3 || boundedCalls.some(call => BigInt(call.gas) > cap)) throw error;
      readBoundaryAttempts.push({ requestedGas: effectiveReadGas.toString(), providerGasCap: cap.toString() });
      effectiveReadGas = cap;
      // Replay the identical planned transactions and reads. Only reduce the
      // explicitly rejected read request ceiling; never alter transaction bounds.
      calls = readReplayCalls();
    }
  }
  if (transactions.some((result, index) => result.returnData !== observations[index]!.returnData)) return failure("metadata-mismatch", "Transaction validation and public-read replay produced different contract results. This configuration needs a compatible simulation profile.");
  for (const [index, check] of requiredReaderCalls.entries()) {
    const result = observations[boundedCalls.length + index]!;
    if (result.returnData !== check.expectedReturn) return failure("metadata-mismatch", "An exact standalone reader check differs from the bytes required by release preparation. Do not fund this plan.");
    if (result.gasUsed > BigInt(calls[boundedCalls.length + index]!.gas)) return failure("read-gas-limit", "A required standalone reader check exceeds the release preparation read budget. Resolve it before storage payment.");
  }
  if (observations.at(-1)!.returnData !== expectedReturn) return expectation.kind === "storage-only"
    ? failure("storage-mismatch", "The simulated storage does not contain the exact predicted manifest object. Do not fund this plan.")
    : failure("metadata-mismatch", "The complete simulated metadata differs from the exact prepared bytes. Do not fund this plan.");
  const measured = observations.map(value => value.gasUsed);
  const readGas = measured.at(-1)!;
  const collectionReadGas = readGas + BigInt(identity.collectionOverheadGas);
  if (collectionReadGas > effectiveReadGas) return failure("read-gas-limit", "The exact complete-metadata read plus its collection overhead exceeds the selected read budget. Review a supported delivery or reader choice before storage payment.");
  const canonical = record(await request("eth_getBlockByNumber", [block.number, false]));
  if (canonical?.hash !== block.hash) return failure("chain-reorganized", "The chain changed during the preflight. Recheck the same prepared plan before payment.");
  const transactionForkHeaders = transactions.flatMap(result => result.forkHeader ? [result.forkHeader] : []);
  const simulationFingerprint = (await createIntegrity(new TextEncoder().encode(canonicalJson({ ...identity, transactionGasPolicy, transactionForkHeaders, validatedTransactionCalls: boundedCalls, effectiveReadGas: effectiveReadGas.toString(), readBoundaryAttempts })))).digest;
  return Object.freeze({ schema: "keel-publication-simulation@1" as const, readPolicy: identity.readPolicy, policyGasCeiling: identity.policyGasCeiling, policyTokenUriByteCeiling: identity.policyTokenUriByteCeiling, planFingerprint: identity.planFingerprint, simulationFingerprint,
    chainId: identity.chainId, transactionGasPolicy, transactionForkHeaders, reader, metadataTarget, ephemeralContextCalls: observationCalls.length, requiredReaderChecks: requiredReaderCalls.length,
    requiredReaderProofs: requiredReaderCalls.map((check, index) => ({ reader: check.call.to, selector: check.call.data.slice(0, 10), calldataDigest: keccak256(check.call.data),
      returnDigest: keccak256(check.expectedReturn as Hex), returnBytes: (check.expectedReturn.length - 2) / 2,
      gasUsed: observations[boundedCalls.length + index]!.gasUsed.toString(), gasLimit: BigInt(calls[boundedCalls.length + index]!.gas).toString(), gasMargin: check.gasMargin })),
    metadataCallGasLimit: BigInt(calls.at(-1)!.gas).toString(), collectionGasMargin: identity.collectionOverheadGas,
    requestedReadGasLimit: identity.maximumReadGas, effectiveReadGasLimit: effectiveReadGas.toString(), readBoundaryAttempts,
    mintEligibilityVerified: false as const, readerRuntimeCodeHash: identity.runtimeCodeHash, blockNumber: blockNumber.toString(), blockHash: block.hash,
    observationPolicy: "eth-call" as const, verification: expectation.kind,
    ...(expectation.kind === "collector-metadata" ? { completeTokenUriBytes: completeBytes, metadataDigest, abiReturnBytes: (expectedReturn.length - 2) / 2, abiReturnDigest: keccak256(expectedReturn as Hex), maximumAbiReturnBytes: 64 + Math.ceil(identity.maximumTokenUriBytes / 32) * 32, assemblyReadGas: readGas.toString(), collectionReadGas: collectionReadGas.toString() }
      : { manifestObjectId: expectation.objectId, collectorMetadataVerified: false as const, storageObservationGas: readGas.toString() }),
    validatedTransactionCalls: transactions.length, transactionGasLimits: boundedCalls.map(call => BigInt(call.gas).toString()), gasMeasurement: "pre-refund-max-used" as const, transactionGasUsed: transactions.map(value => value.gasUsed.toString()),
    simulatedCalls: calls.length, callGasUsed: measured.map(value => value.toString()), state: "ephemeral-simulation" as const,
    signing: "not-performed" as const, submission: "not-performed" as const });
}
