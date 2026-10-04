import { resolveKeelEndpoints } from "./endpoints.js";

/** Runtime JavaScript discovery is separate from the infrastructure ABI index.
 * Catalog membership is metadata, never permission to execute code. */
export async function searchKeelRuntimeModules(options: {
  readonly query: string;
  readonly studioUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly maxPages?: number;
}) {
  // Match the desktop/MCP local Studio boundary without weakening public
  // endpoint configuration. Only an explicitly supplied loopback origin gets HTTP.
  const local = options.studioUrl === undefined ? undefined : new URL(options.studioUrl);
  const loopback = local?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(local.hostname);
  if (loopback && (local.username || local.password || local.search || local.hash || local.pathname !== '/')) throw new TypeError('Local Studio must be a credential-free loopback origin.');
  const base = loopback ? local.origin : resolveKeelEndpoints(options.studioUrl === undefined ? {} : { studioUrl: options.studioUrl }).studioUrl;
  const request = options.fetch ?? globalThis.fetch;
  const query = options.query.trim().toLowerCase();
  if (!query) throw new TypeError("A module name, ID, or hash is required.");
  const maxPages = options.maxPages ?? 100;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000) throw new TypeError("Invalid page budget.");
  const sources = await Promise.all(["modules", "verified-modules"].map(async (source) => {
    const matches: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    try {
      for (let page = 0; page < maxPages; page++) {
        // Read unfiltered pages: older APIs do not search digests or deployment IDs.
        const url = new URL(`/api/${source}`, base);
        url.searchParams.set("limit", "200");
        if (cursor !== undefined) url.searchParams.set("cursor", cursor);
        const response = await request(url, { signal: AbortSignal.timeout(15000), redirect: "error" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await readCatalogResponse(response);
        if (!Array.isArray(body.modules)) throw new Error("Malformed module catalog");
        for (const value of body.modules) {
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed module entry");
          const entry = value as Record<string, unknown>;
          if (contains(entry, query)) matches.push(entry);
        }
        if (body.nextCursor === undefined || body.nextCursor === null) return { source, complete: true, matches };
        cursor = String(body.nextCursor);
        if (seen.has(cursor)) throw new Error("Repeated catalog cursor");
        seen.add(cursor);
      }
      throw new Error("Catalog page budget exhausted");
    } catch (error) {
      return { source, complete: false, matches, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  return {
    schema: "keel-runtime-module-search@1" as const,
    query,
    studioUrl: base,
    sources,
    modules: sources.flatMap((source) => source.matches.map((entry) => ({ source: source.source, entry }))),
    complete: sources.every((source) => source.complete),
    coverage: "Published release and verification catalogs; absence does not prove absence onchain.",
    execution: "metadata-only; verify selected-chain bytes and sandbox before execution",
  };
}

function contains(value: unknown, query: string): boolean {
  if (typeof value === "string") return value.toLowerCase().includes(query);
  if (Array.isArray(value)) return value.some((item) => contains(item, query));
  if (value && typeof value === "object") return Object.values(value).some((item) => contains(item, query));
  return false;
}

/** Integrity checks do not confer review status. This creates a local test
 * document using the existing viewer sandbox; it does not execute the module. */
export async function createKeelRuntimeModuleSandbox(input: {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly maxBytes?: number;
}) {
  const { createIntegrity, encodeBase64, KEEL_MANIFEST_SCHEMA, KEEL_CANONICALIZATION,
    KEEL_RUNTIME_PROTOCOL, KEEL_VIEWER_PROTOCOL, KEEL_CONTENT_GATEWAY_PROTOCOL } = await import("@keel/protocol");
  const { resolveArtifact, createSandboxDocument } = await import("@keel/viewer");
  const limit = input.maxBytes ?? 16_000_000;
  if (!Number.isSafeInteger(limit) || limit < 1 || input.bytes.length > limit) throw new Error("Module exceeds sandbox byte budget.");
  const bytes = Uint8Array.from(input.bytes);
  const integrity = await createIntegrity(bytes);
  const expected = input.sha256.toLowerCase().replace(/^0x/, "");
  if (!/^[a-f0-9]{64}$/.test(expected) || integrity.digest.replace(/^0x/, "") !== expected) throw new Error("Module digest mismatch.");
  const poster = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const posterIntegrity = await createIntegrity(poster);
  const artifact = await resolveArtifact({
    schema: KEEL_MANIFEST_SCHEMA, canonicalization: KEEL_CANONICALIZATION,
    id: "runtime-module-test", name: "Untrusted module test",
    entrypoint: { resource: "module", mode: "module" },
    resources: [{ id: "module", role: "entrypoint", mediaType: "text/javascript", executable: true,
      sources: [{ kind: "inline", data: encodeBase64(bytes), encoding: "base64", integrity }] }, { id: "poster", role: "fallback", mediaType: "image/svg+xml", sources: [{ kind: "inline", data: encodeBase64(poster), encoding: "base64", integrity: posterIntegrity }] }],
    fallback: { image: "poster" },
    runtime: {
      engine: { protocol: KEEL_RUNTIME_PROTOCOL, viewerProtocol: KEEL_VIEWER_PROTOCOL, renderer: "browser" },
      determinism: { mode: "live" },
      content: { protocol: KEEL_CONTENT_GATEWAY_PROTOCOL, mode: "verified-only", externalSources: "host-verified", manifestTrust: "digest", blockUndeclared: true, resourcePathPrefix: "/content/", onchainPathPrefix: "/onchain/", ipfsPathPrefix: "/ipfs/" },
      sandbox: "strict", capabilities: {}, maxTotalBytes: limit + poster.length, maxResourceBytes: limit,
      maxRecursionDepth: 1, maxResources: 2, timeoutMs: 10000,
    },
    revision: { number: 1, compatibility: { min: 1, max: 1 }, policy: "creator" },
    provenance: { createdAt: "2026-09-10T00:00:00.000Z" },
  });
  return { integrity, reviewStatus: "unverified" as const, purpose: "local-module-test" as const,
    document: createSandboxDocument(artifact, { capabilityCeiling: {} }) };
}

async function readCatalogResponse(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty catalog response");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 8_000_000) throw new Error("Catalog page exceeds byte budget");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Malformed catalog response");
  return parsed as Record<string, unknown>;
}
