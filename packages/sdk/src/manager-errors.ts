import { decodeErrorResult, type Hex } from "viem";
import { formatAbiItem } from "viem/utils";
import { ABIS } from "./abis/keel-artifacts.generated.js";

/** The manager and proxy share an address. Include both compiler ABIs so cold
 * recovery failures decode alongside ordinary governance and role failures. */
export const keelManagerErrorsAbi = [...new Map(
  [...ABIS.KeelManager, ...ABIS.KeelManagerProxy]
    .filter(entry => entry.type === "error")
    .map(entry => [formatAbiItem(entry), entry] as const),
).values()];

/** Decode without an RPC lookup. Preserve the caller's original error when the
 * revert belongs to another contract or contains malformed data. */
export function decodeKeelManagerError(data: Hex) {
  try {
    return decodeErrorResult({ abi: keelManagerErrorsAbi, data });
  } catch {
    return null;
  }
}
