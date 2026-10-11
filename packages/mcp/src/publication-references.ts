import { readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Discovery metadata only. A manifest never substitutes for live receipts,
 * exact tokenURI/resource reconstruction, or the existing-object reuse gate. */
export async function searchKeelPublicationReferences(input: {
  readonly query: string;
  readonly limit?: number;
  readonly workspaceRoot?: string;
  readonly sdkRoot?: string;
}): Promise<readonly Record<string, unknown>[]> {
  const query = input.query.trim().toLowerCase();
  if (!query || query.length > 160) throw new TypeError("Invalid reference query.");
  const sdkRoot = input.sdkRoot ?? fileURLToPath(new URL("../../..", import.meta.url));
  const directories = [...new Set([path.join(sdkRoot, "deployments"),
    ...(input.workspaceRoot ? [path.join(input.workspaceRoot, "deployments")] : [])])];
  const matches: Record<string, unknown>[] = [];
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 20)));
  for (const directory of directories) {
    let names;
    try { names = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if ((error as { code?: string }).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of names.filter(entry => entry.isFile() && entry.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 128)) {
      const sourcePath = path.join(directory, entry.name);
      const info = await lstat(sourcePath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024) continue;
      let reference: Record<string, unknown>;
      try { reference = JSON.parse(await readFile(sourcePath, "utf8")) as Record<string, unknown>; }
      catch { continue; }
      if (!reference || reference.protocol !== "keel-sepolia-publication-reference@1"
        || !Number.isSafeInteger(reference.chainId) || Number(reference.chainId) <= 0
        || !/^0x[0-9a-f]{40}$/iu.test(String(reference.collection))
        || !/^\d{1,78}$/u.test(String(reference.tokenId))) continue;
      const tokenURI = reference.tokenURI as Record<string, unknown> | undefined;
      if (!tokenURI || !/^0x[0-9a-f]{64}$/iu.test(String(tokenURI.sha256))
        || !Number.isSafeInteger(tokenURI.byteLength) || Number(tokenURI.byteLength) <= 0) continue;
      const records = Array.isArray(reference.records) ? reference.records.slice(0, 128).map(record => ({
        contract: record?.contract, address: record?.address, txHash: record?.txHash,
        runtimeCodeHash: record?.runtimeCodeHash,
      })) : [];
      const candidate = {
        name: entry.name.replace(/\.json$/u, ""), chainId: reference.chainId,
        collection: reference.collection, tokenId: String(reference.tokenId),
        tokenURI: { byteLength: tokenURI.byteLength, sha256: tokenURI.sha256 },
        mintTransaction: reference.mintTransaction, shellId: reference.shellId, records,
        transport: reference.transport, uriCompatibility: reference.uriCompatibility,
        managedRoute: reference.managedRoute,
      };
      if (!JSON.stringify(candidate).toLowerCase().includes(query)) continue;
      matches.push({ ...candidate, source: "publication-reference-manifest", sourcePath,
        verification: "requires-selected-chain-readback", authenticatedThisRun: false,
        next: "Read the exact tokenURI, inspect any managedRoute with keel-manager-modules-inspect, resolve committed modules and reuse unchanged object IDs through keel-inline-reuse-plan. Do not infer absence from an empty index." });
      if (matches.length >= limit) return matches;
    }
  }
  return matches;
}
