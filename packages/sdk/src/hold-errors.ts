import { decodeErrorResult, type Hex } from "viem";
import { ABIS } from "./abis/keel-hold.generated.js";

/** The compiler's error ABI is the source of truth for scripts and frontends. */
export const keelHoldErrorsAbi = ABIS.KeelHold.filter(entry => entry.type === "error");

/** Decode raw revert data without an RPC or on-chain lookup. Unknown or malformed
 * data returns null so the caller can preserve its original transaction error.
 */
export function decodeKeelHoldError(data: Hex) {
  try {
    return decodeErrorResult({ abi: keelHoldErrorsAbi, data });
  } catch {
    return null;
  }
}
