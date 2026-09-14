// A built game, as KeelHold objects: the plan, the publish, the read back.
//
// A game's KEEL document is an ordered list of parts -- the shell's two
// halves, one slot per module, the game's entry. Each part is stored as its
// own KeelHold object (a raw-percent fragment, uncompressed, so the builder
// can copy it straight into the document), and the game is one composite
// root over them. Objects are content-addressed, so a part is published once
// per chain: the shell and the engine's modules (everything the engine ships,
// and KEEL's audio scripts) are SHARED -- published once, by the engine
// release -- and a game publish stores only its own modules, its packs and
// its entry, then welds its root over the shared object ids.
//
// Nothing here holds a key: callers pass a viem wallet client (the practice
// chain's unlocked anvil account, or a wallet the owner connects).
import { buildKeelInlineRawPercentTokenURIGraph } from "@keel/sdk/inline-viewer-graph";
import { createKeelManagedCompositePlan, createKeelManagedObjectPlan } from "@keel/sdk/native-publication";
import { encodeFunctionData, toHex } from "viem";
import { builderAbi, holdAbi } from "./contracts.mjs";

export const RAW_PERCENT = "application/vnd.keel.token-uri-raw-percent-fragment";
const ZERO = `0x${"0".repeat(40)}`;
const MAX_SLUGS_PER_CAST = 3;

/**
 * Which parts are shared: the shell, and every module the engine (not the
 * game's project) provides -- engine parts, standard packs, ai, and the page
 * scripts KEEL gives audio games (Tone, keel-audio).
 */
export function shareOf(part, engineModuleIds) {
  if (part.role === "shell-prefix" || part.role === "shell-suffix") return "shell";
  if (part.role === "module" && part.moduleId && engineModuleIds.has(part.moduleId)) return "engine";
  return "game";
}

/**
 * Plan a built game (buildGameDocument's result) as KeelHold objects.
 * `engineModuleIds`: the ids of modules that come from the engine, not the project.
 */
export async function planGame({ doc, engineModuleIds, hold, gameId }) {
  const graph = await buildKeelInlineRawPercentTokenURIGraph(doc.document);
  const source = doc.document.parts;
  if (graph.parts.length !== source.length) throw new Error("The raw-percent graph does not line up with the document's parts.");
  const versions = new Map(doc.modules.map((m) => [m.id, m.version]));
  const parts = [];
  for (let index = 0; index < graph.parts.length; index += 1) {
    const fragment = graph.parts[index];
    const part = source[index];
    const plan = await createKeelManagedObjectPlan(fragment.bytes, { hold, mediaType: RAW_PERCENT, compression: "none" });
    const moduleId = part.moduleId;
    parts.push({
      index, role: fragment.role, share: shareOf(part, engineModuleIds),
      ...(moduleId ? { moduleId, version: part.moduleVersion ?? versions.get(moduleId) } : {}),
      byteLength: fragment.bytes.byteLength, digest: plan.digest, objectId: plan.objectId,
      chunks: plan.chunks, operations: plan.operations,
    });
  }
  const root = createKeelManagedCompositePlan(parts.map((p) => p.objectId), graph.fragmentBytes, { hold, mediaType: RAW_PERCENT });
  return {
    schema: "keel-game-publication-plan@1", gameId, hold, mediaType: RAW_PERCENT,
    root: { objectId: root.objectId, digest: root.digest, byteLength: Number(root.byteLength), operation: root.operation },
    htmlByteLength: graph.htmlBytes.byteLength, htmlDigest: graph.htmlIntegrity.digest, parts,
  };
}

/** A plan's size by share: bytes, chunks and objects (what would be stored with nothing on chain yet). */
export function planTotals(plan, shares = ["shell", "engine", "game"]) {
  const list = plan.parts.filter((p) => shares.includes(p.share));
  return {
    parts: list.length,
    bytes: list.reduce((n, p) => n + p.byteLength, 0),
    chunks: list.reduce((n, p) => n + p.chunks.length, 0),
    welds: list.reduce((n, p) => n + p.operations.length, 0),
  };
}

/** The same objects as a record other games (and the editor) can reference by module id@version. */
export function releaseRecordOf(plan, { chainId, hold, builder, engine = {} }) {
  const shared = plan.parts.filter((p) => p.share !== "game");
  return {
    schema: "keel-game-engine-release@1", chainId, hold, builder, engine,
    objects: shared.map((p) => ({ role: p.role, share: p.share, ...(p.moduleId ? { moduleId: p.moduleId, version: p.version } : {}), objectId: p.objectId, digest: p.digest, byteLength: p.byteLength })),
  };
}

/**
 * What still has to be written for a plan on a chain: chunks not yet cast,
 * part objects and the root not yet welded. Read-only.
 */
export async function missingOnChain({ publicClient, plan }) {
  const read = (functionName, args) => publicClient.readContract({ address: plan.hold, abi: holdAbi, functionName, args });
  const parts = [];
  for (const part of plan.parts) {
    if (await read("objectExists", [part.objectId])) { parts.push({ part, exists: true, chunks: [] }); continue; }
    const chunks = [];
    for (const chunk of part.chunks) if ((await read("slugPointer", [chunk.id])) === ZERO) chunks.push(chunk);
    parts.push({ part, exists: false, chunks });
  }
  return { parts, rootExists: await read("objectExists", [plan.root.objectId]) };
}

/**
 * The transactions that write a plan (only what's missing), in order: chunk
 * casts (three per transaction, KeelHold's batch limit), each part's welds,
 * the root. `shares` limits it to some of the parts (an engine release
 * publishes "shell" and "engine"; a game publish refuses when those are
 * missing unless it is told to include them).
 */
export function transactionsFor({ plan, missing, shares = ["shell", "engine", "game"], root = true }) {
  const txs = [];
  const seen = new Set();
  for (const { part, exists, chunks } of missing.parts) {
    if (exists || !shares.includes(part.share)) continue;
    const fresh = chunks.filter((c) => !seen.has(c.id));
    for (const c of fresh) seen.add(c.id);
    for (let at = 0; at < fresh.length; at += MAX_SLUGS_PER_CAST) {
      const batch = fresh.slice(at, at + MAX_SLUGS_PER_CAST);
      txs.push({ kind: "cast", share: part.share, label: `cast ${part.moduleId ?? part.role} ${at / MAX_SLUGS_PER_CAST + 1}`, bytes: batch.reduce((n, c) => n + c.bytes.byteLength, 0), chunks: batch.length,
        to: plan.hold, data: encodeFunctionData({ abi: holdAbi, functionName: "castSlugs", args: [batch.map((c) => toHex(c.bytes))] }) });
    }
  }
  for (const { part, exists } of missing.parts) {
    if (exists || !shares.includes(part.share)) continue;
    for (const op of part.operations) txs.push({ kind: "weld", share: part.share, label: `weld ${part.moduleId ?? part.role}`, bytes: 0, chunks: 0, to: op.target, data: op.data });
  }
  if (root && !missing.rootExists) txs.push({ kind: "root", share: "game", label: `weld root ${plan.gameId}`, bytes: 0, chunks: 0, to: plan.hold, data: plan.root.operation.data });
  return txs;
}

/** Shared parts a game needs that aren't on the chain yet (a game publish stops here unless told otherwise). */
export function missingShared(missing) {
  return missing.parts.filter(({ part, exists }) => !exists && part.share !== "game").map(({ part }) => ({ role: part.role, share: part.share, moduleId: part.moduleId, version: part.version, objectId: part.objectId }));
}

/** Send transactions one at a time with a wallet client; returns each receipt's gas. */
export async function sendAll({ publicClient, walletClient, account, txs, log = () => {} }) {
  const done = [];
  for (const tx of txs) {
    const hash = await walletClient.sendTransaction({ account, chain: null, to: tx.to, data: tx.data });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${tx.label} reverted (${hash}).`);
    done.push({ label: tx.label, kind: tx.kind, share: tx.share, hash, gasUsed: receipt.gasUsed, bytes: tx.bytes, chunks: tx.chunks });
    log(`${tx.label}: ${receipt.gasUsed} gas`);
  }
  return done;
}

/** Sum receipts (or estimates) by share. */
export function gasByShare(rows) {
  const out = { shell: 0n, engine: 0n, game: 0n, total: 0n, transactions: rows.length };
  for (const r of rows) { out[r.share] += BigInt(r.gasUsed); out.total += BigInt(r.gasUsed); }
  return out;
}

// (The builder returns "data:text/html;charset=utf-8," and the percent-carried HTML; every byte is ASCII.)
function percentDecode(text) {
  const out = [];
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (code === 0x25) { out.push(Number.parseInt(text.slice(at + 1, at + 3), 16)); at += 2; } else out.push(code);
  }
  return new Uint8Array(out);
}

/**
 * Read a published game back from the chain through the raw builder: the
 * token metadata a collection's tokenURI returns, and the exact document
 * (with its token-context tail) a viewer mounts. Read-only.
 *
 * (preEncodedTokenURI copies the stored fragments straight into the answer,
 * so a large game reads for little gas; the builder's HTML convenience read
 * percent-decodes every byte in Solidity and runs out of gas past ~200 KB.)
 */
export async function readGame({ publicClient, builder, rootId, digest, context = {}, name = "KEEL game" }) {
  const read = (functionName, args) => publicClient.readContract({ address: builder, abi: builderAbi, functionName, args });
  const encode = (text) => toHex(new TextEncoder().encode(text));
  const tail = await read("contextURI", [encode(JSON.stringify(context))]);
  const rawPrefix = `{"name":${JSON.stringify(name)},"animation_url":"data:text/html;charset=utf-8,`;
  const rawSuffix = `${Buffer.from(tail.slice(2), "hex").toString("latin1")}","keel_schema":"keel-inline-raw-percent-token-uri@1"}`;
  const uri = await read("preEncodedTokenURI", [rootId, digest, encode(rawPrefix), encode(rawSuffix)]);
  const jsonPrefix = "data:application/json;charset=utf-8,";
  if (!uri.startsWith(jsonPrefix)) throw new Error("The builder did not return token metadata.");
  const metadata = JSON.parse(new TextDecoder().decode(percentDecode(uri.slice(jsonPrefix.length))));
  const htmlPrefix = "data:text/html;charset=utf-8,";
  if (typeof metadata.animation_url !== "string" || !metadata.animation_url.startsWith(htmlPrefix)) throw new Error("The token metadata carries no HTML document.");
  return { uri, metadata: { ...metadata, animation_url: `${htmlPrefix}…` }, html: percentDecode(metadata.animation_url.slice(htmlPrefix.length)) };
}

/**
 * Links to a published game: the viewer (reads it from the chain and serves
 * the document), and the web3:// address of its root object in KeelHold (the
 * raw stored fragments, for web3 clients and auditors).
 */
export function shareLinks({ chainId, hold, rootId, digest, viewer }) {
  return {
    ...(viewer ? { viewer: `${viewer.replace(/\/$/, "")}/game/${chainId}/${rootId}?digest=${digest}` } : {}),
    web3: `web3://${hold}:${chainId}/haulObject/${rootId}`,
  };
}
