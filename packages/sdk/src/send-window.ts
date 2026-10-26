import type { Hex } from "viem";

/** One planned, unsigned call, in execution order. */
export interface KeelPlannedCall {
  readonly to: Hex;
  readonly data: Hex;
  readonly value?: Hex;
}
export interface KeelSendWindowCall {
  readonly index: number;
  readonly to: Hex;
  readonly data: Hex;
  readonly value: Hex;
  readonly nonce: Hex;
  readonly gas: Hex;
  readonly simulatedGasUsed: Hex;
}
export interface KeelSendWindow {
  readonly schema: "keel-send-window@1";
  readonly chainId: number;
  readonly from: Hex;
  readonly simulatedAtBlock: Hex;
  readonly calls: readonly KeelSendWindowCall[];
  /** First call not in this window: the next window starts here once these receipts are in. */
  readonly nextIndex: number;
  /** Set when the call at nextIndex reverts in simulation after the window's calls. */
  readonly reverted?: { readonly index: number; readonly error: string };
  readonly signing: "not-performed";
  readonly submission: "not-performed";
}
export interface KeelSendWindowTransport {
  request(input: { readonly method: string; readonly params: readonly unknown[] }): Promise<unknown>;
}

const quantity = (value: unknown, label: string): bigint => {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(value)) throw new TypeError(`Invalid ${label}.`);
  return BigInt(value);
};
const hex = (value: bigint): Hex => `0x${value.toString(16)}`;

/**
 * Plan the next window of a long publication so it can be sent without waiting for each receipt.
 *
 * Storage programs are long chains of calls whose only ordering is their order: a weld needs its slugs, a
 * validation needs its object. Consecutive nonces already enforce that order, so the calls can be broadcast
 * together. What a sender lacks is each call's gas before the earlier ones are mined, and a live estimate cannot
 * see unmined state. This simulates the window in order with eth_simulateV1, one simulated block per call so a
 * window may exceed one block's gas, and gives every call its nonce and a gas limit of its simulated use times
 * the margin. Selected-chain state gas (Sepolia Amsterdam) is part of the simulated use.
 *
 * Send the calls in nonce order, read every receipt, stop on the first failure, then plan the next window from
 * nextIndex. Nothing is signed or submitted here.
 */
export async function planKeelSendWindow(input: {
  readonly transport: KeelSendWindowTransport;
  readonly chainId: number;
  readonly from: Hex;
  readonly calls: readonly KeelPlannedCall[];
  /** Index of the first call not yet mined. */
  readonly startIndex?: number;
  /** Defaults to 16; eth_simulateV1 bounds one request at 256 blocks. */
  readonly maximumCalls?: number;
  /** Summed simulated gas per window. Defaults to two blocks of the latest block's gas limit. */
  readonly maximumWindowGas?: bigint;
  /** Selected-chain transaction ceiling; a call simulated above it stops the plan. */
  readonly maximumTransactionGas: bigint;
  /** Gas limit = simulated use × marginBps / 10000. Defaults to 13000 (1.3×). */
  readonly marginBps?: number;
}): Promise<KeelSendWindow> {
  const { transport, chainId, from, calls } = input;
  const start = input.startIndex ?? 0, maximumCalls = input.maximumCalls ?? 16, margin = BigInt(input.marginBps ?? 13_000);
  if (!Number.isSafeInteger(chainId) || chainId < 1 || !/^0x[0-9a-f]{40}$/iu.test(from)) throw new TypeError("A send window needs a chain ID and a sender.");
  if (!Array.isArray(calls) || !Number.isSafeInteger(start) || start < 0 || start >= calls.length) throw new RangeError("startIndex must name a planned call.");
  if (!Number.isSafeInteger(maximumCalls) || maximumCalls < 1 || maximumCalls > 255) throw new RangeError("A send window holds 1..255 calls.");
  if (margin < 10_000n || margin > 30_000n || input.maximumTransactionGas <= 0n) throw new RangeError("Margin must be 1×..3× and the transaction ceiling positive.");
  if (quantity(await transport.request({ method: "eth_chainId", params: [] }), "chain ID") !== BigInt(chainId)) throw new TypeError("The RPC serves a different chain.");
  const block = await transport.request({ method: "eth_getBlockByNumber", params: ["latest", false] }) as { number?: unknown; gasLimit?: unknown } | null;
  const blockNumber = quantity(block?.number, "block number"), blockGasLimit = quantity(block?.gasLimit, "block gas limit");
  const nonce = quantity(await transport.request({ method: "eth_getTransactionCount", params: [from, "pending"] }), "nonce");
  const windowGas = input.maximumWindowGas ?? blockGasLimit * 2n;
  const slice = calls.slice(start, start + maximumCalls).map((call, offset) => {
    if (!/^0x[0-9a-f]{40}$/iu.test(call.to) || !/^0x(?:[0-9a-f]{2})*$/iu.test(call.data)) throw new TypeError(`Planned call ${start + offset} is malformed.`);
    return { from, to: call.to, data: call.data, value: call.value ?? "0x0", nonce: hex(nonce + BigInt(offset)),
      gas: hex(input.maximumTransactionGas < blockGasLimit ? input.maximumTransactionGas : blockGasLimit) };
  });
  const result = await transport.request({ method: "eth_simulateV1", params: [{ blockStateCalls: slice.map(call => ({ calls: [call] })), validation: false, traceTransfers: false, returnFullTransactions: false }, hex(blockNumber)] });
  if (!Array.isArray(result) || result.length !== slice.length) throw new TypeError("eth_simulateV1 did not return one block per call; this RPC cannot plan send windows.");
  const planned: KeelSendWindowCall[] = [];
  let used = 0n, reverted: KeelSendWindow["reverted"];
  for (const [offset, simulated] of result.entries()) {
    const call = (simulated as { calls?: readonly { status?: unknown; gasUsed?: unknown; error?: { message?: unknown } }[] }).calls?.[0];
    if (!call) throw new TypeError("eth_simulateV1 omitted a call result.");
    if (call.status !== "0x1") { reverted = { index: start + offset, error: String(call.error?.message ?? "reverted") }; break; }
    const gasUsed = quantity(call.gasUsed, "simulated gas");
    const gas = (gasUsed * margin + 9_999n) / 10_000n;
    if (gas > input.maximumTransactionGas || gas > blockGasLimit) throw new RangeError(`Planned call ${start + offset} needs ${gas} gas, above the selected-chain ceiling.`);
    if (planned.length && used + gasUsed > windowGas) break;
    used += gasUsed;
    planned.push({ index: start + offset, to: slice[offset]!.to, data: slice[offset]!.data, value: slice[offset]!.value as Hex, nonce: slice[offset]!.nonce as Hex, gas: hex(gas), simulatedGasUsed: hex(gasUsed) });
  }
  if (!planned.length && reverted) throw Object.assign(new Error(`Planned call ${reverted.index} reverts: ${reverted.error}`), { code: "KEEL_SEND_WINDOW_REVERT", index: reverted.index });
  return { schema: "keel-send-window@1", chainId, from, simulatedAtBlock: hex(blockNumber), calls: planned, nextIndex: start + planned.length,
    ...(reverted && reverted.index === start + planned.length ? { reverted } : {}), signing: "not-performed", submission: "not-performed" };
}
