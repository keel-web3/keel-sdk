import type { McpResource, McpResourceReadResult } from "./types.js";
import { KEEL_ENGINE_CATALOG } from "@keel/sdk/engine";
import { ARENA_RESOURCE_DEFINITION, ARENA_RESOURCE_TEXT } from "./arena-tools.js";

export const KEEL_WORKFLOW_RESOURCE = "keel://mcp/workflow" as const;
export const KEEL_LIMITS_RESOURCE = "keel://mcp/limits" as const;
export const KEEL_PUBLICATION_MODES_RESOURCE = "keel://mcp/publication-modes" as const;
export const KEEL_PROJECT_ROUTES_RESOURCE = "keel://mcp/project-routes" as const;
const MAX_RESOURCE_BYTES = 64 * 1024;

export class McpResourceNotFoundError extends Error {
  constructor(uri: string) {
    super(`Unknown resource URI: ${uri}.`);
    this.name = "McpResourceNotFoundError";
  }
}

const resourceJson = (value: unknown): string => `${JSON.stringify(value)}\n`;

const RESOURCE_TEXT: Readonly<Record<string, string>> = {
  "keel://mcp/svg-renderer": resourceJson({
    ...KEEL_ENGINE_CATALOG.svgRenderer,
    usage: { create: { tool: "keel-svg-create", inputs: ["preset or recipeJson", "tokenId (optional)"] }, inspect: { tool: "keel-svg-inspect", inputs: ["svg"] }, read: { tool: "keel-svg-call-plan", inputs: ["chainId", "address", "tokenId"] } },
    hiddenRecord: ["renderer chain/address/token/code hash", "artwork SHA-256/length", "proof source/job/statement/beneficiary/kind/work/seed"],
    security: ["Never trust a contract or RPC chosen by SVG metadata", "Inspect returns unverified", "SDK verifies code and exact svg(uint256) bytes at one finalized block", "Proof statement is not the full seal; inspect the source acceptance transaction", "Native code/state rendering does not claim a KeelHold upload or replace the canonical HTML shell"],
  }),
  "keel://mcp/engine": resourceJson(KEEL_ENGINE_CATALOG),
  ...ARENA_RESOURCE_TEXT,
  [KEEL_WORKFLOW_RESOURCE]: resourceJson({
    schema: "keel-mcp-resource@1",
    kind: "offline-workflow",
    contractFirst: ["keel-contract-workflow-preflight", "keel-engine-catalog", "keel-network-inspect", "keel-library-search", "edge-case-resolution", "keel-contract-controls", "wallet-review"],
    steps: ["studio-capabilities", "analyze", "media-optimize", "media-optimize-apply", "cost", "keel-revision-plan", "upload-plan", "build", "verify", "module-resolve", "module-lock", "studio-stage-project", "studio-draft", "chain-plan", "ethereum-encode", "publish-plan", "wallet-request-prepare", "wallet-link"],
    repair: {
      prompt: "keel-draft-repair",
      order: ["studio-draft:read", "media-optimize", "creator-review", "media-optimize-apply", "studio-stage-project", "creator-prepare", "studio-draft:update"],
      revisionBound: true,
      sourcePreserved: true,
      walletAuthority: "none",
    },
    caveats: ["cost is a modeled estimate", "media optimization never changes storage mode and requires exact creator-reviewed digest and byte length before writing a new file", "draft repair stops on a stale revision or reviewed publish action", "carriers are metadata-only until bytes are supplied", "ethereum-encode emits unsigned calldata only and does not produce QR payloads", "wallet-link requires and verifies the exact collectionConfig before emitting typed data; account signature, wallet approval, and chain submission are never performed by MCP"],
  }),
  [KEEL_LIMITS_RESOURCE]: resourceJson({
    schema: "keel-mcp-resource@1",
    kind: "offline-limits",
    stdioMaxLineBytes: 1048576,
    mediaInputMaxBytes: 268435456,
    manifestMaxBytes: 4194304,
    sourceMaxBytes: 268435456,
    uploadPlanResponseMaxBytes: 262144,
    chainPlanResponseMaxBytes: 262144,
    ethereumAdapterPlanMaxBytes: 4194304,
    ethereumAdapterChunkMaxBytes: 23000,
    ethereumAdapterResponseMaxBytes: 262144,
    ethereumAdapterQr: "unsupported",
    publishPlanResponseMaxBytes: 262144,
    recursivePlanMaxObjects: 512,
    recursivePlanMaxDepth: 8,
    recursiveDecodedBytesBudget: 268435456,
    networkAccess: "explicit-studio-metadata-and-staging-only",
    walletSigning: "disabled",
    chainSubmission: "disabled",
  }),
  [KEEL_PROJECT_ROUTES_RESOURCE]: resourceJson({
    schema: "keel-project-routes@1",
    planningPrompt: "keel-project-plan",
    intakeTool: "keel-studio-project-intake",
    intent: ["scope", "outcome", "runtime", "chain", "storage", "presentation", "module reuse", "test evidence", "approval boundary"],
    intakeMapping: {
      ordinary: {
        tool: "keel-studio-project-intake",
        scope: "Map one-of-one/open-edition/limited-edition to release.type; never forward scope.",
        runtime: "Keep runtime in the plan and staging/module route; never forward runtime.",
        chain: "Resolve network text to numeric chainId; never forward textual chain.",
        outcomes: {
          "storage-only": { outcome: "storage-only" },
          release: { outcome: "release", nestedFields: ["release.type", "release.saleMechanism", "release.priceEth"] },
          "fixed-price": { outcome: "release", saleMechanism: "fixed-price" },
          claim: { outcome: "release", saleMechanism: "claim" },
        },
      },
      frayAuction: {
        tool: "fray-auction-intake",
        chain: "Resolve to family plus network.",
        presets: [1, 2, 3, 4],
        forbiddenTool: "keel-studio-project-intake",
      },
    },
    shell: {
      default: "keel-verification-shell",
      selection: "Omit viewer for every collector-facing viewer so Studio resolves the registered selected-chain shell graph.",
      forbidden: ["creator-authored replacement shell", "copied shell", "shrunk shell", "local fallback shell", "shell bytes uploaded as project content"],
      noViewer: "viewer=none is an explicit raw-artifact route without a viewer, not permission to use a custom shell.",
    },
    creationRoutes: [{
      id: "one-of-one",
      intake: { outcome: "release", releaseType: "one-of-one" },
      next: ["keel-studio-stage-project", "keel-creator-collection-prepare"],
      note: "Collection preparation is review-only and does not mint the token or create a sale.",
    }, {
      id: "collection",
      intake: { outcome: "release", releaseTypes: ["limited-edition", "open-edition"] },
      next: ["keel-studio-stage-project", "keel-creator-collection-prepare"],
      note: "Choose dedicated ERC-721, dedicated ERC-1155, shared ERC-1155, or external explicitly; never substitute a lane.",
    }, {
      id: "one-mint-drop",
      classification: "contract release behavior, not a storage or upload mode",
      sdkBuilder: "buildOneMintDrop",
      contractEvidence: ["OneMintController", "OneMintCreatorCollections"],
      requiredChecks: ["registered mint route and authority", "reserved collection capacity", "stage schedule", "access and replay rules", "wallet limits", "payment asset and amount", "pause and close behavior"],
      note: "MCP may plan and stage the release but does not create the drop, mint a token, or submit a wallet request. Require sibling Forge evidence and a separate creator-reviewed wallet flow.",
    }, {
      id: "fixed-price-or-claim",
      intake: { outcome: "release", saleMechanisms: ["fixed-price", "claim"] },
      next: ["keel-studio-stage-project", "keel-studio-draft"],
      note: "The release intent stays editable in Studio; no sale is created by MCP.",
    }, {
      id: "fray-auction",
      prompt: "fray-auction-review",
      next: ["fray-auction-intake", "keel-library-search", "fray-stage-project"],
      presets: [1, 2, 3, 4],
      note: "Preset numbers are conversation shorthand. Exact terms come from the digest-bound SDK policy returned by intake.",
    }],
    runtimeRoutes: [{
      id: "static-media",
      projectBytes: "Direct creator media only; registered keel.asset-display@1 is resolved as a same-chain module.",
      example: "examples/image-wrapper",
    }, {
      id: "p5",
      projectBytes: "Creator script and assets only.",
      requiredReuse: ["p5", "keel.seeded-random"],
      example: "examples/agent-p5-project",
    }, {
      id: "three",
      projectBytes: "Creator scene/model/assets only.",
      requiredReuse: ["exact selected-chain Three.js module graph"],
      examples: ["examples/starters/three-model", "examples/immutable-three-one-of-one"],
    }, {
      id: "doom-wasm",
      projectBytes: "Creator WASM/WAD-derived artifact descriptors; large bytes use recursive native objects.",
      previewExecution: "doom-wasm-sandbox",
      example: "examples/demos/doom-wasm",
    }, {
      id: "flash-as3",
      projectBytes: "Compiled SWF plus project declaration only.",
      requiredReuse: ["Ruffle loader/runtime/core/WASM", "Brotli decoder when declared", "keel.seeded-random"],
      verificationCommand: "npm run verify",
      note: "Every module binding needs object and registry receipt/read-back proof; a planned module ID is not a published module.",
    }],
    proofLayers: ["sdk-unit", "forge-contract", "module-catalog", "browser-runtime", "live-chain-receipt-and-readback"],
  }),
  [KEEL_PUBLICATION_MODES_RESOURCE]: resourceJson({
    schema: "keel-publication-modes@1",
    defaultMode: "native-carrier-v1",
    tezosStandard: {
      defaultRoute: "keel-tezos-standard-fa2-onchfs@1",
      storage: "native-keel-onchfs",
      modules: ["keel-hold-onchfs", "keel-index", "keel-harness-builder", "keel-collection-fa2", "keel-sleeve"],
      publicSurface: "FA2/TZIP-12 token_metadata",
      compatibilitySurface: "KeelSleeve.token_uri -> token_json",
      presentationGate: "Measure the complete inline return. Use Inline only when the canonical shell, builder, public-read size, and read-gas checks pass; otherwise use the RPC-backed Hybrid presentation.",
      hybridStorageRule: "Hybrid changes the reader path, not storage: immutable artwork and shell resources remain native OnchFS bytes onchain. It is not IPFS.",
      excludedOptionalModules: ["keel-crucible"],
    },
    presentation: {
      storageIndependent: true,
      terms: {
        bootShell: "Small uncompressed HTML that the contract can read directly.",
        resourceGraph: "Digest-bound scripts, modules, assets, and data; child resources may be compressed.",
        browserDecoder: "Committed browser or WASM code that verifies stored bytes, decompresses them, and verifies decoded bytes before execution.",
        inline: "Complete onchain-assembled data:text/html animation_url with no gateway, IPFS, /content, or RPC fetch.",
        hybrid: "Native KEEL objects resolved by the boot shell through an RPC reader; still fully onchain when every resource is a native KEEL object.",
        ipfs: "Explicitly selected IPFS delivery; never inferred from Hybrid.",
      },
      inlineGate: {
        rootCompression: "none",
        maximumReconstructedBytes: 2000000,
        maximumReadGas: 30000000,
        requiresConfiguredBuilder: true,
        forbidsRuntimeFetch: true,
      },
      codecs: {
        none: "Boot shell and small uncompressed resources.",
        gzip: "Capability-checked browser DecompressionStream path in the committed shell.",
        deflate: "Capability-checked browser DecompressionStream path in the committed shell.",
        brotli: "Exact digest-locked KEEL decoder module, normally the reusable thin WASM decoder published once per chain; never copied into every creator upload.",
      },
      sdkPlanner: {
        package: "@keel/sdk/inline-viewer-graph",
        shell: "buildKeelInlineShellFragments",
        module: "buildKeelInlineModuleFragment",
        localDocument: "buildKeelInlineLocalDocument",
        automaticCompactGraph: "buildKeelInlineRawPercentTokenURIGraph",
        recommendedPublishableBody: "buildKeelInlineRawPercentTokenURIGraph; prepare each direct image carriage once, store one exact ASCII payload/URI slot, copy it opaquely at tokenURI, and keep the complete HTML and metadata in raw-percent form.",
        embeddedResourceAudit: "Before staging, decode every raw-percent layer and unpack every embedded gzip/deflate resource. Reject concrete http(s), IPFS, Arweave, web3 and keel-onchain locators in creator bytes; an onchain URL sentinel is not exempt. Allow only http://www.w3.org/2000/svg as the SVG namespace literal.",
        legacyFollowLatestBody: "buildKeelInlineFollowLatestTokenURIBodyGraph; explicit only because it adds the nested Base64 carriage.",
        creatorAssets: "Declare artwork, animation, palettes, timing, and project data as creator assets. Reusable modules are executable libraries or runtimes published once per chain.",
        sizeReporting: "Always report original creator source bytes, creator graph bytes, complete prepared tokenURI bytes, packing-layer count, and percentage overhead before staging.",
        pinnedPublishableGraph: "buildKeelInlinePreEncodedTokenURIGraph",
        shellLifecycle: "The recommended body graph resolves the current registered KEEL shell when tokenURI is read. A full graph pins the selected shell revision. Creator shells can publish new revisions until their creator irreversibly freezes them.",
        portableP5Default: "Once-per-chain Gzip p5 fragment plus the browser Gzip/Deflate shell profile.",
        portableThreeDefault: "Once-per-chain exact Three.js r180 ESM main/core graph. Bind both verified current-chain objects; never embed Three.js in each creator project.",
        normalMediaDefault: "A standalone image, video, or self-contained GLB is exactly registered KEEL shell prefix, registered keel.asset-display@1 module, direct creator media entrypoint, registered shell suffix. It is never a zero-module project or a creator-uploaded index.html wrapper.",
        assetDisplay: "keel.asset-display@1 self-mounts the frozen verified direct entry descriptor: AVIF/WebP use an intrinsic-size canvas with a PNG save surface; other images and videos use direct data URLs; self-contained model/gltf-binary uses WebGL. It has no network or wallet authority; external-dependency .gltf is rejected from this compact path.",
        revisionGate: "planKeelGraphRevision compares the live selected-chain graph to the next candidate version. The automatic path permits one declared changed resource, requires exact reuse of every other object ID and commitment, and caps new stored bytes at 65536 before wallet review.",
      },
    },
    staging: {
      defaultViewer: "keel-verification-shell",
      defaultPresentation: "Use collector-inline automatically: the compact raw-percent graph, exact supplied data:image/* bytes, complete data:text/html;charset=utf-8 HTML, and the registered canonical verification shell. Store original binary image bytes once; construct the final data:image/<type>;base64 URI header plus canonical Base64 of those exact bytes plus its JSON delimiter/footer only at the metadata boundary. For GIF use a direct data:image/gif URI, never an SVG wrapper or placeholder. The complete HTML and metadata are not Base64-wrapped again. IPFS, HTTP, web3 resolvers, and other carriages require an explicit reviewed policy and measured overhead.",
      imageCarriage: "Binary image source is stored once, never as a second Base64 text object. At the final JSON image field, assemble header + canonical Base64 exact source bytes + JSON delimiter/footer; verify source digest, decoded bytes, output length and public-RPC read-back. GIF remains direct GIF and is never auto-wrapped in SVG.",
      activeBuilderResolution: "For the automatic compact route, resolve the exact selected-chain KeelRawTokenURIBuilder and canonical raw-percent shell fragments from the Studio Inline catalog. Verify their receipts and read-back before binding. Legacy pre-encoded carriage separately requires the active keel-harness-builder plus INLINE_PROTECTION_SHELL_ID and the exact shells(shellId) prefix, suffix, metadata, exists=true, and PreEncodedGraph mode. Do not infer readiness from an old deployment journal or another builder address, and never fall back from compact to legacy carriage silently.",
      legacyProtectorLane: "protectorPrefix, protectorSuffix, protectedHarnessDataURI, and NoProtector belong to the older complete-document protector lane. They are not the readiness check for the default registered Inline shell and must not trigger a locally manufactured fallback.",
      normalMedia: "Normal standalone image/video/GLB preparation resolves the registered keel.asset-display@1 module as part of that catalog graph; agents provide only the direct creator asset and never manufacture an index.html wrapper.",
      viewerNone: "Explicit shell opt-out. The immutable artifact remains independently releasable and contract-readable; selecting a shell never replaces that raw artifact route.",
      agentScope: "Agents supply only creator resources/modules and never manufacture or upload Studio's default KEEL shell, protected-harness wrapper, or local replacement wrapper.",
      creatorHtml: "Creator-authored HTML is project content, not a replacement verification shell.",
      catalogFailure: "Studio must fail closed when the selected chain's canonical Inline graph catalog is incomplete; agents must not substitute a protected-harness or local wrapper.",
      existingGraphRevision: "Studio derives this state without asking the creator. Call keel-revision-plan before upload-plan. A follow-latest graph publishes and activates the next version without rewriting token presentation; a pinned graph may update only its small binding. Any undeclared resource, reused-byte upload, or digest mismatch is blocked before wallet review.",
    },
    modes: [{
      id: "native-carrier-v1",
      status: "implemented",
      contractReadable: true,
      chunkBytes: 23000,
      maximumChunksPerExecutorTransaction: 3,
      description: "Immutable native KEEL carriers plus one logical object operation.",
    }, {
      id: "history-inscription-v1",
      status: "benchmark-only",
      contractReadable: false,
      description: "Ethereum calldata/log history recovered by an indexer or archival receipt provider; not native KEEL storage.",
    }, {
      id: "external-chain-inscription-v1",
      status: "design-only",
      contractReadable: false,
      description: "Payload history on a configured external chain with Ethereum identity/commitment; requires an explicit indexer and viewer route.",
    }],
    rules: [
      "Never silently change the selected mode.",
      "Benchmark-only and design-only modes must not be presented as chain-ready.",
      "One wallet approval, one logical object operation, and multiple executor transactions are distinct concepts.",
      "Native carrier gas, calldata intrinsic gas, object gas, logical operation gas, escrow, and transaction fees must be reported separately.",
      "Storage mode and presentation mode are separate; Hybrid does not mean IPFS or offchain storage.",
      "Compress heavy child resources, not the contract-readable boot shell.",
    ],
  }),
};

export const RESOURCE_DEFINITIONS: readonly McpResource[] = [
  { uri: "keel://mcp/engine", name: "keel-engine", description: "Shared SDK and desktop collection, mint, permission, storage and module inventory.", mimeType: "application/json" },
  { uri: "keel://mcp/svg-renderer", name: "keel-svg-renderer", description: "Contract-generated SVGs, hidden proof provenance, SDK/MCP/editor usage and verification boundaries.", mimeType: "application/json" },
  { uri: KEEL_WORKFLOW_RESOURCE, name: "keel-workflow", description: "Machine-readable offline analyze-to-review workflow.", mimeType: "application/json" },
  { uri: KEEL_LIMITS_RESOURCE, name: "keel-limits", description: "Machine-readable MCP and planner safety limits.", mimeType: "application/json" },
  { uri: KEEL_PROJECT_ROUTES_RESOURCE, name: "keel-project-routes", description: "Machine-readable intent, artifact/runtime, token, sale, and auction routing without duplicated contract logic.", mimeType: "application/json" },
  { uri: KEEL_PUBLICATION_MODES_RESOURCE, name: "keel-publication-modes", description: "Machine-readable KEEL storage modes, readiness, and accounting boundaries.", mimeType: "application/json" },
  ARENA_RESOURCE_DEFINITION,
];

export function getMcpResource(uri: unknown): McpResourceReadResult {
  if (typeof uri !== "string" || uri.length === 0 || uri.length > 256) throw new TypeError("resources/read uri is invalid.");
  const text = RESOURCE_TEXT[uri];
  if (text === undefined) throw new McpResourceNotFoundError(uri);
  if (new TextEncoder().encode(text).byteLength > MAX_RESOURCE_BYTES) throw new Error("Static resource exceeds the MCP resource size limit.");
  const definition = RESOURCE_DEFINITIONS.find((entry) => entry.uri === uri);
  if (definition === undefined) throw new Error("Static resource definition is missing.");
  return { contents: [{ uri, mimeType: definition.mimeType, text }] };
}
