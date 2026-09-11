import { decodeFunctionResult, encodeFunctionData, getAddress, hexToString, parseAbi, toFunctionSelector, toHex, type Hex } from "viem";
import { decodeKeelMintSeedField, defineKeelMintSeedLayout, unpackKeelMintSeedField } from "./mint-seeded.js";
import type { KeelDataValue } from "./data-layer.js";

export const keelMintSeededDataAbi = parseAbi([
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function keelMintSeededProfile(uint256 recordId) view returns (bytes32 profileId, bytes32[] names, uint64[] fields, uint8[] formats, uint64 seedField)",
  "function keelMintSeededWord(uint256 recordId, uint32 wordIndex) view returns (uint256)",
  "function keelMintSeededSeed(uint256 recordId) view returns (bytes32)",
]);

export const KEEL_MINT_SEEDED_INTERFACE_ID = toHex(
  BigInt(toFunctionSelector("keelMintSeededProfile(uint256)"))
  ^ BigInt(toFunctionSelector("keelMintSeededWord(uint256,uint32)"))
  ^ BigInt(toFunctionSelector("keelMintSeededSeed(uint256)")),
  { size: 4 },
);

export interface KeelMintSeededRecord {
  readonly address: Hex;
  readonly recordId: bigint | string;
  /** Read budget, not a storage/profile limit. */
  readonly maxFields?: number;
  readonly maxWords?: number;
  /** Word reads per HTTP batch, 1..256. One disables batching. Defaults to 64. */
  readonly batchSize?: number;
}

/** The caller pins every call to the same chain/block and selected contract. */
export async function readKeelMintSeededData(
  record: KeelMintSeededRecord,
  call: (data: Hex, probe?: boolean) => Promise<Hex>,
  callMany?: (data: readonly Hex[]) => Promise<readonly Hex[]>,
): Promise<KeelDataValue | undefined> {
  const address = getAddress(record.address);
  const maxFields = record.maxFields ?? 4096;
  const maxWords = record.maxWords ?? 4096;
  const batchSize = record.batchSize ?? 64;
  if (![maxFields, maxWords].every(n => Number.isSafeInteger(n) && n >= 0)) throw new RangeError("Invalid seed-data read budget");
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 256) throw new RangeError("Invalid seed-data batch size");
  if ((typeof record.recordId !== "bigint" && typeof record.recordId !== "string")
    || (typeof record.recordId === "string" && !/^(?:[0-9]+|0x[0-9a-f]+)$/i.test(record.recordId))) {
    throw new TypeError("Record ID must be exact decimal/hex text or bigint");
  }
  const recordId = BigInt(record.recordId);
  if (recordId < 0n || recordId >= 1n << 256n) throw new RangeError("Record ID must fit uint256");
  const supported = await call(encodeFunctionData({ abi: keelMintSeededDataAbi,
    functionName: "supportsInterface", args: [KEEL_MINT_SEEDED_INTERFACE_ID] }), true);
  // Missing ERC165 and a canonical false mean no seed-data capability.
  if (supported === "0x" || supported === toHex(0n, { size: 32 })) return undefined;
  if (supported !== toHex(1n, { size: 32 })) throw new Error("Invalid seed-data capability response");
  const raw = await call(encodeFunctionData({ abi: keelMintSeededDataAbi,
    functionName: "keelMintSeededProfile", args: [recordId] }));
  const [profileId, names, fields, formats, seedField] = decodeFunctionResult({ abi: keelMintSeededDataAbi,
    functionName: "keelMintSeededProfile", data: raw });
  if (fields.length !== names.length || fields.length !== formats.length || fields.length > maxFields) {
    throw new Error("Invalid seed-data profile dimensions");
  }
  const decodedNames = names.map(name => {
    const value = hexToString(name, { size: 32 });
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) || ["__proto__", "constructor", "prototype"].includes(value)) {
      throw new Error("Invalid seed-data field name");
    }
    return value;
  });
  const layout = defineKeelMintSeedLayout(fields.map((field, i) => ({
    name: decodedNames[i]!, ...decodeKeelMintSeedField(field),
  })));
  for (let i = 0; i < fields.length; i += 1) {
    const format = formats[i]!;
    const bits = layout.fields[i]!.bits;
    if (format > 3 || (format === 1 && bits !== 160) || (format === 2 && bits !== 256) || (format === 3 && bits !== 1)) {
      throw new Error("Invalid seed-data field format");
    }
  }
  const indices = new Set(layout.fields.map(field => field.wordIndex));
  if (seedField !== 0n) indices.add(decodeKeelMintSeedField(seedField).wordIndex);
  if (indices.size > maxWords) throw new RangeError("Seed-data word budget exceeded");
  const words = new Map<number, bigint>();
  const ordered = [...indices].sort((a, b) => a - b);
  for (let start = 0; start < ordered.length; start += batchSize) {
    const selected = ordered.slice(start, start + batchSize);
    const requests = selected.map(wordIndex => encodeFunctionData({ abi: keelMintSeededDataAbi,
      functionName: "keelMintSeededWord", args: [recordId, wordIndex] }));
    const results = callMany && requests.length > 1 ? await callMany(requests) : await (async () => {
      const output: Hex[] = [];
      for (const request of requests) output.push(await call(request));
      return output;
    })();
    if (results.length !== selected.length) throw new Error("Invalid seed-data batch dimensions");
    for (let i = 0; i < selected.length; i += 1) {
      const result = results[i]!;
      if (typeof result !== "string" || !/^0x[0-9a-f]{64}$/i.test(result)) throw new Error("Invalid seed-data word response");
      words.set(selected[i]!, decodeFunctionResult({ abi: keelMintSeededDataAbi, functionName: "keelMintSeededWord", data: result }));
    }
  }
  const values: Record<string, KeelDataValue> = Object.create(null);
  for (let i = 0; i < layout.fields.length; i += 1) {
    const field = layout.fields[i]!;
    const value = unpackKeelMintSeedField(words.get(field.wordIndex)!, field.index);
    values[field.name] = formats[i] === 1 ? getAddress(toHex(value, { size: 20 }))
      : formats[i] === 2 ? toHex(value, { size: 32 })
      : formats[i] === 3 ? value === 1n
      : value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  }
  let seed: Hex;
  if (seedField !== 0n) {
    const { wordIndex } = decodeKeelMintSeedField(seedField);
    seed = toHex(unpackKeelMintSeedField(words.get(wordIndex)!, seedField), { size: 32 });
  } else {
    const result = await call(encodeFunctionData({ abi: keelMintSeededDataAbi,
      functionName: "keelMintSeededSeed", args: [recordId] }));
    if (!/^0x[0-9a-f]{64}$/i.test(result)) throw new Error("Invalid seed-data seed response");
    seed = result;
  }
  return {
    recordId: recordId.toString(), address, profileId, seed, fields: values,
    words: [...words].map(([wordIndex, value]) => ({ wordIndex, value: toHex(value, { size: 32 }) })),
  };
}
