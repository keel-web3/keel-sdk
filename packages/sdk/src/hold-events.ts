import { decodeEventLog, parseAbiItem, type Hex } from "viem";

export const keelObjectWeldedEvent = parseAbiItem(
  "event ObjectWelded(bytes32 indexed objectId,bytes32 indexed digest,bytes32 indexed indexDigest,address descriptorPointer,bytes32 metadata,string mediaType)",
);

/** Expands the Hold event word. Counts are direct children, including repeats. */
export function unpackKeelObjectMetadata(metadata: Hex) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(metadata)) throw new Error("Expected a 32-byte KEEL object metadata word.");
  const word = BigInt(metadata);
  const mask64 = (1n << 64n) - 1n;
  const compression = Number((word >> 160n) & 255n);
  const composite = ((word >> 168n) & 1n) === 1n;
  if ((word >> 169n) !== 0n || compression > 3 || (composite && compression !== 0)) {
    throw new Error("Unsupported KEEL object metadata flags.");
  }
  return {
    byteLength: word & mask64,
    storedByteLength: (word >> 64n) & mask64,
    slugCount: (word >> 128n) & ((1n << 32n) - 1n),
    compression: compression as 0 | 1 | 2 | 3,
    composite,
  };
}

/** Decode a Hold log into named fields without an additional RPC read.
 * Check the emitting Hold address when consuming untrusted receipt/log data.
 */
export function decodeKeelObjectWeldedLog(log: { data: Hex; topics: readonly Hex[] }) {
  const decoded = decodeEventLog({
    abi: [keelObjectWeldedEvent], eventName: "ObjectWelded", strict: true,
    data: log.data, topics: [...log.topics] as [Hex, ...Hex[]],
  });
  return { ...decoded.args, ...unpackKeelObjectMetadata(decoded.args.metadata) };
}
