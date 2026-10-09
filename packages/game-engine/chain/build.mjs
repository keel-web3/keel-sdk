import { canonicalJson, createIntegrity, resolveKeelPayloadStorage } from "@keel/protocol";
// Builds for publishing: a game's KEEL document with exact UTF-8 COPY slots
// (Tone and keel-audio included for audio games), and the
// engine release -- every engine module as the same KEEL module slot a game
// document carries, so the objects an engine release publishes are the very
// objects every game's root points at.
//
// The engine's build is passed in (`keel`: the engine's packages/keel, and the
// engine root it came from), so the command line and the editor each use the
// engine they resolved -- a checkout, a clone of a release, one day the chain.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildKeelInlineLocalDocument, buildKeelInlineModuleFragment, buildKeelInlineShellFragments } from "@keel/sdk/inline-viewer-graph";
import { slotProgram } from "./reuse.mjs";

// The pinned engine's local-preview builder gzip-encodes its module slots and
// predates payloadStorage. Fresh raw-percent COPY supports exact UTF-8 slots,
// so prepare those from verified decoded bytes before any publication plan.
// This applies only to a newly built document; published slots are reconciled
// afterwards by reusePublishedSlots and never passed through this preparation.
async function freshCopyDocument(doc, payloadStorage) {
  const parts = [];
  const storedLengths = new Map();
  for (const part of doc.document.parts) {
    if (part.role !== "module") { parts.push(part); continue; }
    const { metadata, decoded } = await slotProgram(part.bytes);
    const item = JSON.parse(metadata);
    const module = await buildKeelInlineModuleFragment({
      moduleId: part.moduleId, version: part.moduleVersion, mediaType: item.mediaType,
      aliases: item.aliases, decodedBytes: decoded, compression: "none", payloadStorage,
      execution: part.execution, phase: part.phase, weight: part.weight,
    });
    const { embedded: _embedded, ...preparedMetadata } = module.item;
    if (canonicalJson(preparedMetadata) !== metadata) throw new Error(`Fresh COPY preparation changed module metadata: ${part.moduleId}`);
    parts.push({ ...part, bytes: module.bytes, byteLength: module.bytes.length, integrity: module.integrity });
    storedLengths.set(part.moduleId, decoded.length);
  }
  const rootBytes = new Uint8Array(Buffer.concat(parts.map(part => part.bytes)));
  return { ...doc, html: rootBytes,
    modules: doc.modules.map(module => ({ ...module, ...(storedLengths.has(module.id) ? { stored: storedLengths.get(module.id) } : {}) })),
    document: { ...doc.document, parts, rootBytes, byteLength: rootBytes.length, rootIntegrity: await createIntegrity(rootBytes) },
  };
}

/**
 * The engine's own build (its packages/keel) and root, found the way
 * link-engine and the editor find it (scripts/engine-source.mjs): a checkout
 * (KEEL_GAME_ENGINE_ROOT, or ../keel-engine), else the pinned release.
 */
export async function defaultEngine() {
  const { describeEngine, findEngine } = await import("../scripts/engine-source.mjs");
  const found = findEngine();
  if (!found.root) throw new Error(describeEngine(found));
  const keel = await import(pathToFileURL(join(found.root, "packages", "keel", "src", "index.ts")).href);
  return { keel, root: found.root, source: found.source };
}

export function engineBuilds(engine) {
  const { keel, root } = engine;
  const vendor = join(root, "vendor");

  /** The engine's modules and a project's, as the build sees them. */
  const workspaceOf = (projects = []) => keel.readWorkspace(root, { projects: projects.map((p) => resolve(p)) });

  /** The ids of every module that is the engine's (not a project's), plus KEEL's audio page scripts. */
  const engineModuleIds = async (workspace) => {
    const { KEEL_AUDIO_RUNTIME, KEEL_TONE_15 } = await import("@keel/sdk");
    return new Set([...workspace.filter((w) => w.origin === "engine").map((w) => w.manifest.id), KEEL_TONE_15.id, KEEL_AUDIO_RUNTIME.id]);
  };

  /** A game's source and shell, prepared for the raw-percent COPY reader. */
  const buildGame = async ({ project, projects, gameId, workspace, minify = true, entryExport = "main", audio = entryExport === "main", shell, payloadStorage }) => {
    payloadStorage = resolveKeelPayloadStorage(payloadStorage);
    const ws = workspace ?? await workspaceOf(projects ?? [project]);
    const withAudio = audio && keel.closureOf(gameId, ws).some((m) => m.manifest.id === "keel/audio") && existsSync(vendor);
    const local = await keel.buildGameDocument(gameId, ws, { minify, entryExport, payloadStorage, ...(shell ? { shell } : {}), ...(withAudio ? { pageScripts: await keel.keelAudioScripts(vendor) } : {}) });
    const doc = await freshCopyDocument(local, payloadStorage);
    return { doc, workspace: ws, engineModuleIds: await engineModuleIds(ws) };
  };

  /**
   * The engine release: every engine module (and the shell, and KEEL's audio
   * scripts) as a KEEL document whose parts are exactly the slots games carry.
   * A module that fails to bundle is reported, not published.
   */
  const buildEngineRelease = async ({ workspace, minify = true, shell, payloadStorage } = {}) => {
    payloadStorage = resolveKeelPayloadStorage(payloadStorage);
    const ws = workspace ?? await workspaceOf([]);
    const modules = [];
    const failed = [];
    const reports = [];
    if (existsSync(vendor)) {
      for (const p of await keel.keelAudioScripts(vendor)) {
        modules.push(await buildKeelInlineModuleFragment({ moduleId: p.id, version: p.version, mediaType: "text/javascript", ...(p.aliases ? { aliases: p.aliases } : {}), decodedBytes: p.bytes, compression: "none", payloadStorage, execution: "classic", phase: "runtime", weight: p.weight }));
        reports.push({ id: p.id, version: p.version, kind: "page-script", bytes: p.bytes.byteLength });
      }
    }
    // (An engine with the verified pipeline ships each module's receipt-bound bytes, dist/<name>.min.js -- the
    // bytes its game documents carry; an older engine's modules are its in-memory bundles.)
    const verified = [];
    const engineMods = ws.filter((w) => w.origin === "engine");
    for (const mod of typeof keel.dependencyOrder === "function" ? keel.dependencyOrder(engineMods) : engineMods) {
      try {
        const b = typeof keel.buildVerifiedModule === "function" ? await keel.buildVerifiedModule(mod, ws, root) : await keel.bundleModule(mod, ws, { minify });
        if (b.outputDigest) verified.push(b);
        modules.push(await buildKeelInlineModuleFragment({ moduleId: b.manifest.id, version: b.manifest.version, mediaType: "text/javascript", decodedBytes: b.bytes, compression: "none", payloadStorage, execution: "classic", phase: b.manifest.phase, weight: b.manifest.weight }));
        reports.push({ id: b.manifest.id, version: b.manifest.version, kind: b.manifest.kind, bytes: b.bytes.byteLength, ...(b.outputDigest ? { digest: b.outputDigest } : {}) });
      } catch (error) {
        failed.push({ id: mod.manifest.id, version: mod.manifest.version, error: String(error?.message ?? error).split("\n")[0] });
      }
    }
    const selectedShell = shell ?? await buildKeelInlineShellFragments();
    const document = await buildKeelInlineLocalDocument({ shell: selectedShell, payloadStorage, modules, entry: { id: "keel-engine/release", mediaType: "text/javascript", source: new TextEncoder().encode("void 0;\n"), compression: "none" } });
    return { doc: { document, modules: reports }, shell: selectedShell, engineModuleIds: new Set(reports.map((r) => r.id)), failed, verified };
  };

  return { root, source: engine.source ?? null, keel, workspaceOf, engineModuleIds, buildGame, buildEngineRelease };
}
