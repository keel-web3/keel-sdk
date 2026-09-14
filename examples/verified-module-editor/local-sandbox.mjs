export async function createLocalSandbox(input) {
  const { createIntegrity, encodeBase64, KEEL_MANIFEST_SCHEMA, KEEL_CANONICALIZATION,
    KEEL_RUNTIME_PROTOCOL, KEEL_VIEWER_PROTOCOL, KEEL_CONTENT_GATEWAY_PROTOCOL } = await import("../../packages/protocol/dist/index.js");
  const { resolveArtifact, createSandboxDocument } = await import("../../packages/viewer/dist/index.js");
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
  return { integrity, reviewStatus: "unverified", purpose: "local-module-test",
    document: createSandboxDocument(artifact, { capabilityCeiling: {} }) };
}
