/** Bitcoin first-envelope proof v3. Big-endian packed public values, 281 bytes. */
export type BitcoinProofHex = `0x${string}`;
export interface BitcoinProofValues {
  originHash: BitcoinProofHex; originHeight: number; originBits: number;
  originTimestamp: number; originEpochStart: number;
  tipHash: BitcoinProofHex; tipHeight: number; tipBits: number;
  tipTimestamp: number; tipEpochStart: number;
  anchorRoot: BitcoinProofHex; payloadLen: bigint; blockHash: BitcoinProofHex;
  blockHeight: number; confirmations: number; cumulativeWork: BitcoinProofHex;
  sourceTxid: BitcoinProofHex; sourceInput: number; headersRoot: BitcoinProofHex;
  maxTimestamp: number; claimKind: number;
}
export const BITCOIN_PROOF_PUBLIC_VALUES_LENGTH = 281;
const layout = [
  ["originHash",32], ["originHeight",4], ["originBits",4], ["originTimestamp",4], ["originEpochStart",4],
  ["tipHash",32], ["tipHeight",4], ["tipBits",4], ["tipTimestamp",4], ["tipEpochStart",4],
  ["anchorRoot",32], ["payloadLen",8], ["blockHash",32], ["blockHeight",4], ["confirmations",4],
  ["cumulativeWork",32], ["sourceTxid",32], ["sourceInput",4], ["headersRoot",32], ["maxTimestamp",4], ["claimKind",1],
] as const;
function hexBytes(value: string, length?: number): string {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value) || (length !== undefined && value.length !== 2 + length * 2)) {
    throw new Error("Invalid Bitcoin proof byte encoding");
  }
  return value.slice(2).toLowerCase();
}
export function encodeBitcoinProofValues(values: BitcoinProofValues): BitcoinProofHex {
  let result = "0x";
  for (const [name,width] of layout) {
    const value = values[name];
    if (width === 32) { result += hexBytes(String(value),32); continue; }
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error(`Invalid ${name}`);
    const integer = BigInt(value);
    if (integer < 0n || integer >= 1n << BigInt(width * 8)) throw new Error(`Out of range ${name}`);
    result += integer.toString(16).padStart(width * 2,"0");
  }
  if (values.claimKind !== 0 && values.claimKind !== 1) throw new Error("Unsupported Bitcoin proof claim kind");
  return result as BitcoinProofHex;
}
export function decodeBitcoinProofValues(encoded: string): BitcoinProofValues {
  const bytes = hexBytes(encoded,BITCOIN_PROOF_PUBLIC_VALUES_LENGTH);
  const result: Record<string,string | number | bigint> = {};
  let offset = 0;
  for (const [name,width] of layout) {
    const value = `0x${bytes.slice(offset,offset + width * 2)}`;
    result[name] = width === 32 ? value : width === 8 ? BigInt(value) : Number(BigInt(value));
    offset += width * 2;
  }
  if (result.claimKind !== 0 && result.claimKind !== 1) throw new Error("Unsupported Bitcoin proof claim kind");
  return result as unknown as BitcoinProofValues;
}
/** Internal Bitcoin txid order; input index is not an Ordinals inscription ordinal. */
export function bitcoinFirstEnvelopeLocator(txid: BitcoinProofHex, inputIndex: number): string {
  const value = hexBytes(txid,32);
  if (!Number.isInteger(inputIndex) || inputIndex < 0 || inputIndex > 0xffffffff) throw new Error("Invalid input index");
  return `ord://f9beb4d9/0x${value}/input/${inputIndex}/envelope/0`;
}
