import { decodeEventLog, type Hex } from "viem";
import { formatAbiItem } from "viem/utils";
import { ABIS } from "./abis/keel-artifacts.generated.js";

/** Compiler-owned log layouts for the manager and its recovery proxy. */
export const keelManagerEventsAbi = [...new Map(
  [...ABIS.KeelManager, ...ABIS.KeelManagerProxy]
    .filter(entry => entry.type === "event")
    .map(entry => [formatAbiItem(entry), entry] as const),
).values()];

/** Decode named fields without a follow-up read. Check the emitting manager
 * address before trusting a receipt; an event signature alone proves no origin.
 * Unknown or malformed logs return null for the caller's other decoders. */
export function decodeKeelManagerLog(log: { data: Hex; topics: readonly Hex[] }) {
  try {
    const decoded = decodeEventLog({
      abi: keelManagerEventsAbi, strict: true,
      data: log.data, topics: [...log.topics] as [Hex, ...Hex[]],
    });
    const event = keelManagerEventsAbi.find(entry => entry.name === decoded.eventName)!;
    if (log.topics.length !== 1 + event.inputs.filter(input => input.indexed).length) return null;
    return decoded;
  } catch {
    return null;
  }
}
