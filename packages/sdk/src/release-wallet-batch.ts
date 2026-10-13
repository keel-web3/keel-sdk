import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, getAddress, parseAbi, type Hex } from "viem";

export interface KeelReleaseWalletCall { readonly to: string; readonly data: string; readonly value: string }
const executeAbi = parseAbi(["function execute(bytes32 mode,bytes executionCalldata)"]);
const batchType = [{ type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "callData", type: "bytes" }] }] as const;
const atomicMode = `0x01${"00".repeat(31)}` as Hex;
export function encodeKeelAtomicWalletBatch(calls: readonly KeelReleaseWalletCall[]): Hex {
  if (!Array.isArray(calls) || calls.length === 0 || calls.length > 8) throw new TypeError("A release needs one to eight exact wallet calls.");
  return encodeFunctionData({ abi: executeAbi, functionName: "execute", args: [atomicMode, encodeAbiParameters(batchType, [calls.map(call => {
    if (!/^0x(?:[0-9a-f]{2})*$/iu.test(call.data) || !/^0x[0-9a-f]+$/iu.test(call.value)) throw new TypeError("Invalid release calldata or value.");
    return { target: getAddress(call.to), value: BigInt(call.value), callData: call.data as Hex };
  })])] });
}
/** A failed receipt alone is insufficient. Prove the exact creator-owned atomic
 * program first; another transaction or a partial sequential batch cannot unlock a retry. */
export function assertKeelFailedReleaseTransaction(input: {
  readonly chainId: number; readonly creator: string; readonly calls: readonly KeelReleaseWalletCall[];
  readonly transaction: { readonly chainId?: number | undefined; readonly from: string; readonly to: string | null; readonly input: string; readonly value: bigint };
  readonly receipt: { readonly status: string; readonly logs: readonly unknown[] };
}): void {
  const { transaction: tx, receipt } = input;
  if (tx.chainId !== input.chainId || tx.from.toLowerCase() !== input.creator.toLowerCase()
      || tx.to?.toLowerCase() !== input.creator.toLowerCase() || tx.value !== 0n
      || receipt.status !== "reverted" || receipt.logs.length !== 0) throw new TypeError("Recovery requires the exact creator's fully reverted atomic transaction.");
  if (tx.input.toLowerCase() !== encodeKeelAtomicWalletBatch(input.calls).toLowerCase()) throw new TypeError("The failed transaction does not contain the canonical saved atomic program.");
  const decoded = decodeFunctionData({ abi: executeAbi, data: tx.input as Hex });
  if (decoded.args[0] !== atomicMode) throw new TypeError("A non-atomic wallet program cannot authorize a complete release retry.");
  const [calls] = decodeAbiParameters(batchType, decoded.args[1]);
  if (calls.length !== input.calls.length || calls.some((call, i) => call.target.toLowerCase() !== input.calls[i]!.to.toLowerCase()
      || call.callData.toLowerCase() !== input.calls[i]!.data.toLowerCase() || call.value !== BigInt(input.calls[i]!.value))) throw new TypeError("The failed transaction does not match the saved release calls.");
}
