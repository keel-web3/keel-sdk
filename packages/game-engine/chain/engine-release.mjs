// The engine release as the engine's resolver reads it (keel-engine
// packages/keel/src/resolver.ts): every verified module's shipped bytes
// (dist/<name>.min.js, what its source receipt binds) as one KeelHold object,
// and the release record -- the engine's catalog (keel-engine-module-catalog@1)
// with each module's deployment on this chain filled in -- as one more. The
// record's object id and sha256 are the pin (EngineReleasePin) editors and
// games resolve the engine by: the version a user picks.
//
// (Games' documents carry each module inside a KEEL module slot; those slot
// objects are published beside these by the release too -- see flows.mjs.
// Both are content-addressed, so every publish after the first reuses them.)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createKeelManagedObjectPlan, readKeelManagedObject } from "@keel/sdk/native-publication";
import { sha256, toHex } from "viem";
import { holdAbi } from "./contracts.mjs";

const ZERO = `0x${"0".repeat(40)}`;

/** Write one object to KeelHold (only the chunks and welds it doesn't have yet). Returns the receipts. */
export async function publishObject({ publicClient, walletClient, account, hold, bytes, mediaType, compression = "auto", label }) {
  const plan = await createKeelManagedObjectPlan(bytes, { hold, mediaType, compression });
  const read = (functionName, args) => publicClient.readContract({ address: hold, abi: holdAbi, functionName, args });
  const receipts = [];
  const send = async (data, what) => {
    const hash = await walletClient.sendTransaction({ account, chain: null, to: hold, data });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${what} reverted (${hash}).`);
    receipts.push({ label: what, hash, gasUsed: receipt.gasUsed, blockNumber: receipt.blockNumber });
  };
  if (!(await read("objectExists", [plan.objectId]))) {
    const missing = [];
    for (const chunk of plan.chunks) if ((await read("slugPointer", [chunk.id])) === ZERO) missing.push(chunk);
    const { encodeFunctionData } = await import("viem");
    for (let at = 0; at < missing.length; at += 3) await send(encodeFunctionData({ abi: holdAbi, functionName: "castSlugs", args: [missing.slice(at, at + 3).map((c) => toHex(c.bytes))] }), `cast ${label}`);
    for (const op of plan.operations) await send(op.data, `weld ${label}`);
  }
  return { objectId: plan.objectId, digest: plan.digest, byteLength: plan.byteLength, storedByteLength: plan.storedByteLength, receipts };
}

/** An ObjectReader for the resolver: one KeelHold object's decoded bytes, over RPC (readKeelManagedObject checks the tree). */
export function holdReader(publicClientFor) {
  return async ({ chainId, hold, objectId }) => {
    const publicClient = await publicClientFor(chainId);
    const read = (functionName, args) => publicClient.readContract({ address: hold, abi: holdAbi, functionName, args });
    return readKeelManagedObject(objectId, {
      record: async (id) => { const r = await read("getObject", [id]); return { ...r, chunkCount: Number(r.chunkCount) }; },
      parts: (id, count) => read("getObjectPartIds", [id, 0n, BigInt(count)]),
      slug: (id, index) => read("readSlug", [id, BigInt(index)]),
    });
  };
}

/** The engine's version (its root package.json) and the commit it was built from (a clone at a tag, or a checkout's HEAD). */
export function engineIdentity(root) {
  let version = "0.0.0";
  try { version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? version; } catch { /* no package.json */ }
  let revision = null;
  if (existsSync(join(root, ".git"))) {
    try {
      revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      // (A checkout with uncommitted changes isn't that commit.)
      if (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()) revision = null;
    } catch { revision = null; }
  }
  return { version, revision };
}

/**
 * Publish the verified modules as objects and the release record, and return
 * the pin. `previous`: an earlier pin on this chain -- kept when every module
 * is unchanged (a record carries publish times, so it is only rewritten when
 * the release changed).
 */
export async function publishEngineRecord({ publicClient, walletClient, account, chainId, hold, keel, root, verified, previous = null, log = () => {} }) {
  const identity = engineIdentity(root);
  const deployments = new Map();
  const receipts = [];
  for (const v of verified) {
    const object = await publishObject({ publicClient, walletClient, account, hold, bytes: v.bytes, mediaType: "text/javascript", label: `${v.id}@${v.version}` });
    receipts.push(...object.receipts);
    const last = object.receipts.at(-1);
    deployments.set(v.id, { chainId, hold: { address: hold, objectId: object.objectId }, version: v.version, outputDigest: v.outputDigest, receiptDigest: v.receiptDigest, block: last ? String(last.blockNumber) : null, txHash: last?.hash ?? null, publishedAt: new Date().toISOString(), status: "current" });
    if (object.receipts.length) log(`module ${v.id}@${v.version}: ${object.receipts.length} transactions`);
  }
  const catalog = await keel.buildCatalog(verified, { version: identity.version, revision: identity.revision, repository: keel.ENGINE_REPOSITORY });
  // (Unchanged since the previous record: every module's bytes and object the same.)
  if (previous?.pin && previous.modules?.length === verified.length && verified.every((v) => previous.modules.some((m) => m.id === v.id && m.version === v.version && m.outputDigest === v.outputDigest && m.objectId === deployments.get(v.id).hold.objectId))) {
    return { pin: previous.pin, modules: previous.modules, receipts, reused: true };
  }
  const filled = { ...catalog, modules: catalog.modules.map((m) => { const d = deployments.get(m.id); return d ? { ...m, deployments: [...m.deployments.filter((x) => x.chainId !== chainId), d], deployed: true } : m; }) };
  const bytes = new TextEncoder().encode(keel.catalogText(filled));
  const record = await publishObject({ publicClient, walletClient, account, hold, bytes, mediaType: "application/json", label: "engine release record" });
  receipts.push(...record.receipts);
  const pin = { version: identity.version, chainId, hold, objectId: record.objectId, digest: sha256(bytes) };
  log(`release record ${pin.version}: object ${pin.objectId}`);
  return { pin, revision: identity.revision, modules: verified.map((v) => ({ id: v.id, version: v.version, outputDigest: v.outputDigest, objectId: deployments.get(v.id).hold.objectId })), receipts, reused: false };
}

/**
 * Check a pinned engine release on a chain the way the editor's engine picker
 * does: load the record (its sha256 against the pin), read every module's
 * object (its sha256 against the catalog), compare this engine's own verified
 * build module by module, and say where each module's readable source is.
 */
export async function checkEngineRelease({ keel, root, workspace, pin, publicClient, local = true }) {
  const read = holdReader(async () => publicClient);
  const release = await keel.loadEngineRelease(pin, read);
  const built = local ? await keel.localEngineModules(workspace, root) : [];
  const resolved = await keel.resolveEngineModules(release, "all", { chainId: pin.chainId, read, local: built.map((v) => ({ id: v.id, version: v.version, outputDigest: v.outputDigest })) });
  return {
    pin, version: release.version, revision: release.revision, repository: release.repository,
    modules: resolved.map((r) => {
      const source = keel.readableSource(release, r.id);
      return { id: r.id, version: r.version, digest: r.digest, onchain: r.onchain, local: r.local, notes: r.notes, source: { repository: source.repository, commit: source.commit, path: source.path, files: source.files.length, verifyCommand: source.verifyCommand } };
    }),
  };
}
