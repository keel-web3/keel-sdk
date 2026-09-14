import { KEEL_MANAGED_SHELL_RUNTIME } from "./managed-shell-runtime.js";
import { getAddress, type Address, type Hex } from "viem";

/** A small Hybrid bridge that reads native KEEL chunks and mounts the existing
 * committed canonical shell. It contains no replacement shell or offchain art. */
export function buildKeelManagedShellLoader(input: {
  chainId: number; rpcUrl: string; store: Address; objectId: Hex; digest: Hex;
}): string {
  const url = new URL(input.rpcUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash
    || !Number.isSafeInteger(input.chainId) || input.chainId <= 0
    || !/^0x[0-9a-f]{64}$/i.test(input.objectId) || !/^0x[0-9a-f]{64}$/i.test(input.digest)) throw new Error("Invalid Hybrid KEEL reference");
  const literal = (v: unknown) => JSON.stringify(v).replaceAll("<", "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Loading artwork</title></head><body><p id="keel-loader-status">Loading onchain artwork…</p><script>globalThis.__KEEL_MANAGED_SHELL__=${literal({...input,store:getAddress(input.store),rpcUrl:url.toString()})};${KEEL_MANAGED_SHELL_RUNTIME.replaceAll("</script", "<\\/script")}</script></body></html>`;
}
