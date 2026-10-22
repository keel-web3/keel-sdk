import path from "node:path";
import { mkdir, open } from "node:fs/promises";
import type { KeelAuthoredProjectGraph, KeelAuthoredProjectInput, KeelAuthoredPublishedModuleInput } from "@keel/sdk/authored-project-graph";
import type { KeelStudioStagedProjectFile } from "@keel/sdk/studio-upload";
import type { ToolContext, ToolDefinition } from "./types.js";

export async function loadAuthoredProject(context: ToolContext, manifest: string, files: readonly KeelStudioStagedProjectFile[]) {
  const loaded = await context.workspace.readFile(manifest, 1_000_000);
  const graph = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(loaded.bytes)) as KeelAuthoredProjectGraph;
  const directory = path.dirname(loaded.path);
  const local = files.map(file => {
    const relative = path.relative(directory, path.resolve(context.workspace.root, file.path)).split(path.sep).join("/");
    if (!relative || relative.startsWith("../") || relative === ".." || path.isAbsolute(relative)) throw new TypeError("Authored stage file escapes its exact graph directory.");
    return { ...file, path: relative };
  });
  const { assertKeelAuthoredProjectFiles } = await import("@keel/sdk/authored-project/node");
  const published: KeelAuthoredPublishedModuleInput[] = [];
  if (graph.publishedModules?.length) {
    const saved = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode((await context.workspace.readFile(path.join(directory, "keel-authored-published-sources.json"), 16_384)).bytes)) as { moduleId: string; sourcePath: string }[];
    if (!Array.isArray(saved) || saved.length !== graph.publishedModules.length) throw new TypeError("The exact private published dependency cache changed.");
    for (const [index, module] of graph.publishedModules.entries()) {
      const cached = saved[index];
      if (!cached || Object.keys(cached).some(key => !["moduleId", "sourcePath"].includes(key)) || cached.moduleId !== module.binding.moduleId || typeof cached.sourcePath !== "string") throw new TypeError("The exact published source cache changed.");
      published.push({ binding: module.binding, source: (await context.workspace.readFile(cached.sourcePath, 2_000_000)).bytes });
    }
  }
  await assertKeelAuthoredProjectFiles(graph, local, published);
  return { graph, files: local };
}

export const AUTHORED_PROJECT_TOOL_DEFINITIONS: readonly ToolDefinition[] = [{
  descriptor: {
    name: "keel-project-author",
    description: "Default authoring path for NEW agent-created JavaScript artwork. The agent chooses functional boundaries and authors exact ES module sources; this tool generates only a small bootstrap and HTML, parses real imports, rejects unresolved/disconnected modules and writes an immutable digest-bound source graph. Keep behavior/data/rendering modules separate; byte chunks or an entry importing one flattened bundle do not satisfy the design. Existing uploaded code is preserved through ordinary staging. Search and verify selected-chain runtime reuse before authoring replacements. Output stageArguments must pass unchanged through keel-studio-stage-project; no publication, signatures or spend occurs.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      title: { type: "string", minLength: 1, maxLength: 160 }, chainId: { type: "integer", minimum: 1 },
      modules: { type: "array", minItems: 2, maxItems: 64, items: { type: "object", additionalProperties: false, properties: {
        id: { type: "string", minLength: 1, maxLength: 96, description: "Stable functional identity, for example scene-state or artwork-renderer. Never a byte offset or hash." },
        purpose: { type: "string", minLength: 1, maxLength: 320 }, source: { type: "string", minLength: 1, maxLength: 2_000_000 },
      }, required: ["id", "purpose", "source"] } },
      start: { type: "object", additionalProperties: false, properties: { module: { type: "string", minLength: 1, maxLength: 96 }, export: { type: "string", minLength: 1, maxLength: 128 } }, required: ["module", "export"] },
      publishedModules: { type: "array", minItems: 2, maxItems: 2, description: "Agent-resolved exact current Three r180 core/main closure. Discover current selected-chain bindings with keel-library-search; read/hash their public sources into the private workspace. Never ask the creator for cache paths or bindings and never embed these library bytes in creator modules.", items: { type: "object", additionalProperties: false, properties: {
        binding: { type: "object", additionalProperties: false, properties: { moduleId: { type: "string" }, version: { type: "string" }, digest: { type: "string" }, objectId: { type: "string" }, store: { type: "string" }, chain: { type: "string" } }, required: ["moduleId", "version", "digest", "objectId", "store", "chain"] },
        sourcePath: { type: "string", minLength: 1, maxLength: 2048, description: "Agent-owned exact cached PUBLIC module source. Used only for parsing/hashing; not copied into the authored revision or staged." },
      }, required: ["binding", "sourcePath"] } },
      stylesheet: { type: "string", minLength: 1, maxLength: 1_000_000 },
      assets: { type: "array", maxItems: 64, items: { type: "object", additionalProperties: false, properties: {
        path: { type: "string", maxLength: 103, description: "Stable logical target under assets/, for example assets/palette.json." },
        sourcePath: { type: "string", maxLength: 2048, description: "Exact existing private workspace file; source bytes are preserved." },
        mediaType: { type: "string", maxLength: 128 }, purpose: { type: "string", maxLength: 320 },
      }, required: ["path", "sourcePath", "mediaType", "purpose"] } },
      out: { type: "string", minLength: 1, maxLength: 512, description: "Private workspace output directory. Exact immutable revisions make interrupted identical calls resumable without overwriting originals." },
    }, required: ["title", "chainId", "modules", "start", "out"] },
  },
  async run(context, value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Authored project arguments must be an object.");
    const { out, assets, publishedModules, ...input } = value as Record<string, unknown>;
    if (typeof out !== "string" || !out || out.length > 512) throw new TypeError("Authored output directory is required.");
    const root = await context.workspace.resolveOutputDirectory(out);
    if (assets !== undefined && (!Array.isArray(assets) || assets.length > 64)) throw new TypeError("Authored assets must be a bounded list of exact private workspace sources.");
    const loadedAssets = [];
    for (const candidate of (assets ?? []) as Record<string, unknown>[]) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || Object.keys(candidate).some(key => !["path", "sourcePath", "mediaType", "purpose"].includes(key)) || typeof candidate.sourcePath !== "string") throw new TypeError("Invalid authored workspace asset.");
      const original = await context.workspace.readFile(candidate.sourcePath, 32_000_000);
      loadedAssets.push({ path: candidate.path, purpose: candidate.purpose, mediaType: candidate.mediaType, bytes: original.bytes });
    }
    const published: KeelAuthoredPublishedModuleInput[] = [];
    const sourceCache: { moduleId: string; sourcePath: string }[] = [];
    if (publishedModules !== undefined && (!Array.isArray(publishedModules) || publishedModules.length !== 2)) throw new TypeError("Published dependencies require the complete maintained core/main closure.");
    for (const candidate of (publishedModules ?? []) as Record<string, unknown>[]) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || Object.keys(candidate).some(key => !["binding", "sourcePath"].includes(key)) || typeof candidate.sourcePath !== "string" || !candidate.binding || typeof candidate.binding !== "object") throw new TypeError("Invalid exact published module cache.");
      const selected = candidate.binding as KeelAuthoredPublishedModuleInput["binding"];
      published.push({ binding: selected, source: (await context.workspace.readFile(candidate.sourcePath, 2_000_000)).bytes });
      sourceCache.push({ moduleId: selected.moduleId, sourcePath: candidate.sourcePath });
    }
    const { createKeelAuthoredProject } = await import("@keel/sdk/authored-project/node");
    const project = await createKeelAuthoredProject({ ...input, ...(loadedAssets.length ? { assets: loadedAssets } : {}), ...(published.length ? { publishedModules: published } : {}) } as unknown as KeelAuthoredProjectInput);
    const directory = path.join(root, "revisions", project.graph.digest.digest.slice(2));
    const relativeDirectory = path.relative(context.workspace.root, directory).split(path.sep).join("/");
    const manifest = `${relativeDirectory}/keel-authored-project.json`;
    const entries = project.files.map(file => ({ path: `${relativeDirectory}/${file.path}`, bytes: file.bytes as Uint8Array }));
    if (sourceCache.length) entries.push({ path: `${relativeDirectory}/keel-authored-published-sources.json`, bytes: new TextEncoder().encode(`${JSON.stringify(sourceCache)}\n`) });
    entries.push({ path: manifest, bytes: new TextEncoder().encode(`${JSON.stringify(project.graph, null, 2)}\n`) });
    // Validate every destination first. Existing exact revisions are safe to
    // resume; no differing source or unrelated file may be overwritten.
    const missing: typeof entries = [];
    for (const entry of entries) {
      try {
        const prior = await context.workspace.readFile(entry.path, 32_000_000);
        if (prior.bytes.length !== entry.bytes.length || prior.bytes.some((byte, index) => byte !== entry.bytes[index])) throw new TypeError("An immutable authored revision changed on disk. Preserve it and use a clean output directory.");
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
        missing.push(entry);
      }
    }
    for (const entry of missing) {
      await mkdir(await context.workspace.resolveOutputDirectory(path.dirname(entry.path)), { recursive: true });
      // Exclusive creation prevents an overlapping retry or editor change from
      // being replaced after the earlier full-revision comparison.
      const destination = path.resolve(context.workspace.root, entry.path);
      const handle = await open(destination, "wx", 0o600).catch(async error => {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
        const prior = await context.workspace.readFile(entry.path, 32_000_000);
        if (prior.bytes.length !== entry.bytes.length || prior.bytes.some((byte, index) => byte !== entry.bytes[index])) throw new TypeError("The immutable authored revision is being written or changed. Preserve it and retry after its owner finishes.");
        return undefined;
      });
      if (handle) try { await handle.writeFile(entry.bytes); await handle.sync(); } finally { await handle.close(); }
    }
    return {
      schema: "keel-project-author-result@1", graph: project.graph, manifest,
      sourceBytes: project.sourceBytes, completePresentationBytes: null,
      stageArguments: { title: input.title, storageStrategy: "onchain", authoredProject: manifest,
        files: project.files.map(({ bytes: _bytes, ...file }) => ({ ...file, path: `${relativeDirectory}/${file.path}` })) },
      sharedReuse: { status: "selected-chain-verification-required", knownRuntimeRoute: "Studio-selected verified runtime catalog", arbitrarySharedBindings: "unqualified-custom-profiles-blocked", publishedModuleIds: project.graph.publishedModules?.map(module => module.binding.moduleId) ?? [], publishedBytesStaged: 0 },
      publicationReady: false, signing: "not-performed", submission: "not-performed",
    };
  },
}];
