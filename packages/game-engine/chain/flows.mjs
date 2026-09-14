// The two publishes, end to end, against a chain whose KEEL contracts are
// known (the practice sandbox's record, or Sepolia's addresses for a dry run):
//
//   publishEngineRelease  the shell and every engine module, once per chain
//   publishGame           one game: only its own modules, packs and entry, then
//                         its root over the shared objects; read back and
//                         checked byte-for-byte against the local build
import { defaultEngine, engineBuilds } from "./build.mjs";
import { publishEngineRecord } from "./engine-release.mjs";
import { clientsFor, readRecord, writeRecord } from "./local-chain.mjs";
import { gasByShare, missingOnChain, missingShared, planGame, planTotals, readGame, releaseRecordOf, sendAll, shareLinks, transactionsFor } from "./publication.mjs";

const hex = (bytes) => Buffer.from(bytes).toString("hex");
// (The engine's build: passed in by the editor, which resolved its own engine; the command line's otherwise.)
const buildsOf = async (builds) => builds ?? engineBuilds(await defaultEngine());

/** Publish the engine release (shell + engine modules) that games reference. Skips what is already on chain. */
export async function publishEngineRelease({ rpc, deployment, builds, shell, log = () => {}, record = true }) {
  const { publicClient, walletClient, account, chainId } = await clientsFor(rpc);
  const engine = await buildsOf(builds);
  const release = await engine.buildEngineRelease({ shell });
  if (release.failed.length) log(`Not published (didn't bundle): ${release.failed.map((f) => `${f.id} (${f.error})`).join("; ")}`);
  const plan = await planGame({ doc: release.doc, engineModuleIds: release.engineModuleIds, hold: deployment.KeelHold, gameId: "keel-engine/release" });
  const missing = await missingOnChain({ publicClient, plan });
  const txs = transactionsFor({ plan, missing, shares: ["shell", "engine"], root: false });
  log(`Engine release: ${plan.parts.filter((p) => p.share !== "game").length} shared objects, ${txs.length} transactions to send.`);
  const receipts = await sendAll({ publicClient, walletClient, account, txs, log });
  // The resolver's side: each verified module's bytes as an object, and the release record (the pin).
  let pinned = null;
  if (release.verified?.length) {
    const previous = readRecord("engine-release");
    pinned = await publishEngineRecord({ publicClient, walletClient, account, chainId, hold: deployment.KeelHold, keel: engine.keel, root: engine.root, verified: release.verified, previous: previous?.chainId === chainId && previous?.hold === deployment.KeelHold ? previous.release : null, log });
    receipts.push(...pinned.receipts.map((r) => ({ ...r, kind: "record", share: "engine", bytes: 0, chunks: 0 })));
  }
  const out = { ...releaseRecordOf(plan, { chainId, hold: deployment.KeelHold, builder: deployment.KeelRawTokenURIBuilder, engine: { root: engine.root, source: engine.source ?? null } }), ...(pinned ? { release: { pin: pinned.pin, revision: pinned.revision ?? null, modules: pinned.modules } } : {}), failed: release.failed, gas: gasByShare(receipts), totals: planTotals(plan, ["shell", "engine"]), publishedAt: new Date().toISOString() };
  if (record) writeRecord("engine-release", out);
  return out;
}

/**
 * Publish one game. Shared parts must already be on chain (the engine
 * release) unless `includeEngine`: then this publish stores them too.
 */
export async function publishGame({ rpc, deployment, project, projects, gameId, builds, shell, includeEngine = false, context = {}, log = () => {}, record = true }) {
  const { publicClient, walletClient, account, chainId } = await clientsFor(rpc);
  const engine = await buildsOf(builds);
  const { doc, engineModuleIds } = await engine.buildGame({ project, projects, gameId, shell });
  const plan = await planGame({ doc, engineModuleIds, hold: deployment.KeelHold, gameId });
  const missing = await missingOnChain({ publicClient, plan });
  const absent = missingShared(missing);
  if (absent.length && !includeEngine) {
    const names = absent.map((p) => p.moduleId ? `${p.moduleId}@${p.version}` : p.role).join(", ");
    throw Object.assign(new Error(`This chain doesn't have ${absent.length} of the shared objects ${gameId} needs (${names}). Publish the engine release first (pnpm game:sandbox does it), or pass --include-engine to store them with this game.`), { code: "KEEL_ENGINE_NOT_PUBLISHED", absent });
  }
  const txs = transactionsFor({ plan, missing, shares: includeEngine ? ["shell", "engine", "game"] : ["game"] });
  log(`${gameId}: ${plan.parts.length} parts (${plan.parts.filter((p) => p.share === "game").length} its own), ${txs.length} transactions to send.`);
  const receipts = await sendAll({ publicClient, walletClient, account, txs, log });
  // Read it back from the chain and hold it against the local build.
  const back = await readGame({ publicClient, builder: deployment.KeelRawTokenURIBuilder, rootId: plan.root.objectId, digest: plan.root.digest, context, name: gameId });
  const local = new Uint8Array(doc.html);
  const same = back.html.byteLength >= local.byteLength && hex(back.html.subarray(0, local.byteLength)) === hex(local);
  if (!same) throw new Error(`${gameId} read back from the chain does not match the local build.`);
  const viewer = readRecord("sandbox")?.viewer;
  // (The engine release this game's shared objects belong to, by its pin: what the game references by id@version.)
  const releaseRecord = readRecord("engine-release");
  const enginePin = releaseRecord?.chainId === chainId && releaseRecord?.hold === deployment.KeelHold ? releaseRecord.release?.pin ?? null : null;
  const result = {
    gameId, chainId, root: plan.root.objectId, digest: plan.root.digest, builder: deployment.KeelRawTokenURIBuilder, hold: deployment.KeelHold,
    documentBytes: local.byteLength, readBackBytes: back.html.byteLength, readBackMatches: same,
    stored: planTotals(plan, ["game"]), shared: planTotals(plan, ["shell", "engine"]), gas: gasByShare(receipts), transactions: receipts.length,
    reused: plan.parts.filter((p) => p.share !== "game").map((p) => ({ role: p.role, ...(p.moduleId ? { moduleId: p.moduleId, version: p.version } : {}), objectId: p.objectId })),
    engineRelease: enginePin,
    links: shareLinks({ chainId, hold: deployment.KeelHold, rootId: plan.root.objectId, digest: plan.root.digest, viewer }),
    publishedAt: new Date().toISOString(),
  };
  if (record) {
    const games = readRecord("games")?.games ?? [];
    writeRecord("games", { games: [...games.filter((g) => !(g.gameId === gameId && g.chainId === chainId)), { gameId, chainId, root: result.root, digest: result.digest, project, publishedAt: result.publishedAt, documentBytes: result.documentBytes, engineRelease: enginePin }] });
  }
  return { result, html: back.html };
}
