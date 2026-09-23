/** Shared, browser-safe discovery and decision layer. Plans never grant authority. */
import { KEEL_CREATIVE_RUNTIME_CATALOG } from "./creative-runtime-catalog.js";
import { KEEL_INLINE_COMPRESSED_ASSET_BYTES } from "./presentation.js";
import {
  KEEL_TEZOS_STANDARD_COMPATIBILITY_SURFACE,
  KEEL_TEZOS_STANDARD_MODULES,
  KEEL_TEZOS_STANDARD_PUBLIC_SURFACE,
  KEEL_TEZOS_STANDARD_ROUTE,
  KEEL_TEZOS_STANDARD_STORAGE,
} from "./tezos-standard.js";

export const KEEL_ENGINE_CHOICES = {
  outcome: ["explore", "storage-only", "release", "module"],
  runtime: ["static-media", "html", "p5", "three", "doom-wasm", "flash-ruffle"],
  family: ["ethereum", "tezos"],
  storage: ["inline", "native", "hybrid", "ipfs", "wake"],
  releaseType: ["one-of-one", "limited-edition", "open-edition", "series"],
  collection: ["erc721a", "erc721", "erc1155", "shared-erc1155", "tezos-fa2", "existing", "external"],
  mintSystem: ["admin-mint", "mint-gate", "one-mint", "fray-auction"],
  access: ["public", "allowlist", "erc20", "erc721", "erc721-token", "erc1155", "custom"],
  gateLogic: ["all", "any"],
  signature: ["none", "creator", "platform", "either"],
  stage: ["allowlist", "public", "token-payment", "claim", "premint"],
} as const;

type Choice<K extends keyof typeof KEEL_ENGINE_CHOICES> = (typeof KEEL_ENGINE_CHOICES)[K][number];
export interface KeelEngineIntent {
  title?: string;
  outcome?: Choice<"outcome">;
  runtime?: Choice<"runtime">;
  family?: Choice<"family">;
  chainId?: number;
  network?: string;
  storage?: Choice<"storage">;
  releaseType?: Choice<"releaseType">;
  collection?: Choice<"collection">;
  collectionAddress?: string;
  mintSystem?: Choice<"mintSystem">;
  access?: Choice<"access">[];
  gateLogic?: Choice<"gateLogic">;
  signature?: Choice<"signature">;
  stages?: Choice<"stage">[];
  supply?: string;
}

export const KEEL_ENGINE_CATALOG = {
  schema: "keel-engine-catalog@1",
  projectArchitecture: {
    default: "modular",
    audience: "Creators do not need development or storage expertise.",
    assetPlanning: {
      discovery: "Inventory every supplied asset and its actual type, digest, size and dependencies; preserve originals and search selected-chain registry/index for exact reusable objects.",
      selection: "Measure supported lossless compression and total publication/read costs including decoder costs. Keep independently reusable or replaceable assets separate; group only when measured access and cost benefits justify it without losing identity.",
      automatic: "Choose resource boundaries, dependency references and compatible codecs automatically. Do not ask creators to choose modules, chunks, ABI details or compression algorithms.",
      questions: "Ask only about missing creative intent, rights, budget or user-visible quality tradeoffs. Lossy conversion requires explicit authorization.",
      reporting: "Explain what is preserved, what is reused, what changes and measured cost in ordinary language. Estimates and unverified candidates must be labeled.",
    },
    selfContained: "Only when explicitly requested by the user; never inferred from Inline or onchain storage.",
    resources: ["separate HTML entry", "separate CSS stylesheets", "individual JavaScript ES modules with explicit imports", "separate assets"],
    discovery: "Search the selected-chain registry and index before creating reusable modules. Verify candidate interfaces, licenses, digests and onchain bytes before reuse.",
    publication: "Preserve logical module identities and dependency edges. Reuse unchanged published objects; publish changed modules and graph references only. Storage chunks are not application modules.",
    compression: "Compress each resource independently using a verified compatible decoder; compression must not flatten module boundaries.",
  },
  svgRenderer: {
    schema: "keel.svg-native@1", contract: "KeelSVGRenderer", sdk: "@keel/sdk/svg-renderer",
    reads: ["svg(uint256)", "svgProvenance(uint256)"], tools: ["keel-svg-create", "keel-svg-inspect", "keel-svg-call-plan"],
    editor: "SVG renderer creation tab", storage: "native EVM code and committed state",
    evidence: "Local inspection is unverified; exact finalized contract readback checks bytes against a trusted deployment.",
    docs: "docs/KEEL_SVG_RENDERER.md", publicationReady: false,
  },
  publicationReadiness: "not-established",
  assetPresentation: { compressedInlineCutoffBytes: KEEL_INLINE_COMPRESSED_ASSET_BYTES, atOrBelow: "inline", above: "hybrid", shellDefault: "registered-canonical-shell", directDisplay: "explicit-creator-choice", importPolicy: "Accept original file types; reader limitations are publication warnings, never file-format import rejection.", finalChecks: ["complete tokenURI bytes", "public read gas", "selected-chain bindings", "receipt and read-back"], directRetrieval: ["getObject(bytes32)", "haulObject(bytes32) for uncompressed objects", "readSlug(bytes32,uint256) plus decompression for compressed objects"] },
  tezosStandard: {
    route: KEEL_TEZOS_STANDARD_ROUTE,
    defaultStorage: KEEL_TEZOS_STANDARD_STORAGE,
    shell: "registered-canonical-shell",
    modules: KEEL_TEZOS_STANDARD_MODULES,
    publicSurface: KEEL_TEZOS_STANDARD_PUBLIC_SURFACE,
    compatibilitySurface: KEEL_TEZOS_STANDARD_COMPATIBILITY_SURFACE,
    presentation: "measure-complete-inline-return-then-hybrid-rpc",
    hybridMeaning: "Native OnchFS bytes remain onchain; the canonical shell reads them through a declared RPC reader when the complete inline return or public-read gate does not fit.",
    excludedOptionalModules: ["keel-crucible"],
  },
  choices: KEEL_ENGINE_CHOICES,
  collections: [
    { id: "erc721a", label: "Your own collection", behavior: "Dedicated ERC-721A clone; suggested for new unique works.", sdk: "buildKeelCreatorERC721ACall" },
    { id: "erc721", label: "Standard ERC-721", behavior: "Dedicated compatibility collection.", sdk: "buildKeelCreatorStandardERC721Call" },
    { id: "erc1155", label: "Your own editions", behavior: "Dedicated ERC-1155 with item-specific supply and binding.", sdk: "buildKeelCreatorERC1155Call" },
    { id: "shared-erc1155", label: "Shared editions collection", behavior: "Logical creator collection in a shared contract; requires explicit selection.", sdk: "buildKeelCreatorSharedERC1155Call" },
    { id: "tezos-fa2", label: "Standard Tezos FA2", behavior: "KEEL's native Tezos one-of-one lane: receipt-bound Hold/Index/HarnessBuilder, FA2/TZIP-12 metadata, and KeelSleeve compatibility.", sdk: "planKeelTezosStandardRoute" },
    { id: "existing", label: "Use my collection", behavior: "Read selected-chain identity, owner, roles, capacity and renderer before any change.", sdk: "selectKeelCreatorOperationRecovery" },
    { id: "external", label: "Bring another contract", behavior: "Authority-checked registration; minting requires a compatible narrow adapter.", sdk: "buildKeelCreatorBYORegistrationCall" },
  ],
  mintSystems: [
    { id: "admin-mint", label: "Mint to a recipient", behavior: "Creator-authorized mint; confirm recipient, item binding and remaining capacity.", sdk: "buildKeelCreatorAdminMintCall", mcp: "sdk-only" },
    { id: "mint-gate", label: "Sale or gated mint", behavior: "Independent campaign supply and wallet limits; native or exact ERC-20 payments; combinable gates and optional signatures.", sdk: "buildCampaign", mcp: "planning-only" },
    { id: "one-mint", label: "A drop with phases", behavior: "Ordered stages share a single drop allocation and per-wallet count. Claim consumes owned entitlements once; premint is authority-only.", sdk: "buildOneMintDrop", mcp: "planning-only", stages: KEEL_ENGINE_CHOICES.stage, unsupported: ["proof-of-work", "auction", "neural-payment", "airdrop"] },
    { id: "fray-auction", label: "Fray auction", behavior: "Family-specific economics from digest-bound intake; select one of four presets.", mcp: "fray-auction-intake", presets: [1, 2, 3, 4] },
  ],
  access: {
    mintEligibility: KEEL_ENGINE_CHOICES.access,
    combination: "All requires every gate; Any requires at least one. Merkle allowance is not imposed when another Any gate authorizes.",
    signature: KEEL_ENGINE_CHOICES.signature,
    libraryPolicy: ["closed", "open", "paid", "address-allowlist", "token-gate", "submission-only"],
    distinction: "Mint eligibility, library reuse/license, wallet delegation and collection administration are separate permissions. A token gate does not make public onchain bytes secret.",
  },
  authority: [
    { action: "inspect-plan-preview", requirement: "Selected local project; no chain or wallet authority." },
    { action: "edit-project", requirement: "Local workspace scope and current revision; preserve original sources." },
    { action: "stage-or-edit-studio-draft", requirement: "Configured Studio and scoped KEEL_STUDIO_AGENT_TOKEN; revision check on update." },
    { action: "create-campaign", requirement: "Target owner/admin or narrow campaign-creator authorization; manager minter rights alone are insufficient." },
    { action: "configure-one-mint", requirement: "Drop authority or full-trust sales delegate; narrow campaign-creator role does not grant this." },
    { action: "sign-submit-spend", requirement: "Separate wallet review bound to chain, account, exact calls, value and durable operation; MCP never executes." },
    { action: "freeze-transfer-grant", requirement: "Exact authority and explicit action review; local memory is not permission." },
  ],
  storage: [
    { id: "inline", label: "Inline", rule: "Automatic compact raw-percent saver; binary resource packed once; canonical shell and registered modules; enforce measured public-read ceiling." },
    { id: "native", label: "Native objects", rule: "Immutable chunks and recursive objects in KeelHold; verify exact bytes and read cost." },
    { id: "hybrid", label: "Hybrid presentation", rule: "Automatic for new assets above 1.75 MB compressed; explicit saved choices remain unchanged. Keep native bytes onchain and disclose RPC reader dependencies and direct retrieval." },
    { id: "ipfs", label: "IPFS carrier", rule: "Explicit external availability dependency; a content hash is not an onchain byte publication." },
    { id: "wake", label: "Historical evidence", rule: "Verify chain support and actual viewer read path before use; never infer availability from an SDK export." },
  ],
  runtimes: KEEL_CREATIVE_RUNTIME_CATALOG,
  moduleWorkflow: [
    { id: "discover", tool: "keel-library-search", instruction: "Search configured Studio by name, artist, tag or exact digest. Display all candidates with chain, version, license and proof status." },
    { id: "resolve", tool: "module-resolve", instruction: "Resolve a bounded local catalog snapshot. Ask for a choice when ambiguous; do not select the first result." },
    { id: "build", command: "keel module build --all --root ./keel-modules", instruction: "If unavailable, prepare creator-owned source and module declaration locally; do not substitute runtime bytes in an artwork." },
    { id: "test", command: "keel module test --all --root ./keel-modules", instruction: "Test local bytes and runtime dependencies before publication planning." },
    { id: "index", command: "keel module index --root ./keel-modules --repository <source-repository-url>", instruction: "Index reproducible source locally; this does not deploy a module." },
    { id: "publish", sdk: "buildKeelLibraryPublicationPlan", instruction: "Prepare selected-chain object and registry calls, reuse existing records, review license/access, simulate and hand off to the wallet." },
    { id: "bind", tool: "module-lock", instruction: "Only label published after receipts and exact selected-chain object/registry read-back. Lock identity, digest, bytes, dependencies and policy." },
  ],
  evidence: ["local-build", "unit-contract", "source-reproduction", "browser-runtime", "selected-chain-receipt", "object-registry-readback", "public-viewer"],
} as const;

function freezeCatalog(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const entry of Object.values(value)) freezeCatalog(entry);
  Object.freeze(value);
}
freezeCatalog(KEEL_ENGINE_CATALOG);

export function parseKeelEngineIntent(value: unknown): KeelEngineIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Engine intent must be an object.");
  const input = value as Record<string, unknown>;
  const arrayFields = ["access", "stages"];
  const textFields = ["title", "network", "collectionAddress", "supply"];
  const fields = [...Object.keys(KEEL_ENGINE_CHOICES).filter((k) => k !== "stage"), "stages", "chainId", ...textFields];
  for (const [key, item] of Object.entries(input)) {
    if (!fields.includes(key) || item === undefined) throw new TypeError(`Engine intent.${key} is not supported.`);
    if (key === "chainId") {
      if (!Number.isSafeInteger(item) || Number(item) < 1) throw new TypeError("chainId must be a positive safe integer.");
    } else if (textFields.includes(key)) {
      if (typeof item !== "string" || !item.trim() || item.length > 160 || /[\u0000-\u001f\u007f]/u.test(item)) throw new TypeError(`${key} must be bounded text.`);
      if (key === "supply" && !/^[1-9]\d{0,77}$/u.test(item)) throw new TypeError("supply must be a positive integer string.");
    } else {
      const choices: readonly string[] = KEEL_ENGINE_CHOICES[(key === "stages" ? "stage" : key) as keyof typeof KEEL_ENGINE_CHOICES];
      const values = arrayFields.includes(key) ? item : [item];
      if (!Array.isArray(values) || values.length === 0 || values.length > choices.length || new Set(values).size !== values.length || values.some((v) => !choices.includes(v))) throw new TypeError(`Invalid ${key} choice.`);
    }
  }
  const intent = JSON.parse(JSON.stringify(input)) as KeelEngineIntent;
  if (intent.family === "tezos" && intent.chainId !== undefined) throw new TypeError("Tezos uses an explicit network, not an EVM chainId.");
  if (intent.releaseType === "one-of-one" && intent.supply !== undefined && intent.supply !== "1") throw new TypeError("A one-of-one has supply 1.");
  if (intent.releaseType === "open-edition" && intent.supply !== undefined) throw new TypeError("An open edition must not carry a fixed supply.");
  if (intent.outcome !== undefined && intent.outcome !== "release" && ["collection", "collectionAddress", "releaseType", "mintSystem", "access", "gateLogic", "signature", "stages", "supply"].some((key) => key in intent)) throw new TypeError("Release choices require outcome=release.");
  if (intent.stages && intent.mintSystem !== "one-mint") throw new TypeError("stages require one-mint.");
  if (intent.access?.includes("public") && intent.access.length > 1) throw new TypeError("Public access cannot be combined with a gate.");
  if (intent.collectionAddress && !["existing", "external"].includes(intent.collection ?? "")) throw new TypeError("collectionAddress requires existing or external collection.");
  if (intent.family === "ethereum" && intent.collectionAddress && !/^0x[0-9a-fA-F]{40}$/u.test(intent.collectionAddress)) throw new TypeError("Invalid EVM collection address.");
  if (intent.family === "tezos" && intent.collection !== undefined && !["tezos-fa2", "existing", "external"].includes(intent.collection)) throw new TypeError("Tezos releases use tezos-fa2, existing, or external collections.");
  if (intent.family === "ethereum" && intent.collection === "tezos-fa2") throw new TypeError("tezos-fa2 is only available on the Tezos family.");
  return intent;
}

export function planKeelProject(value: unknown = {}) {
  let intent = parseKeelEngineIntent(value);
  if (intent.family === "tezos" && intent.outcome !== undefined && intent.outcome !== "explore") {
    intent = {
      ...intent,
      storage: intent.storage ?? "native",
      ...(intent.outcome === "release" && intent.mintSystem !== "fray-auction" && intent.collection === undefined ? { collection: "tezos-fa2" as const } : {}),
    };
  }
  const questions: { field: string; question: string; choices?: readonly string[] }[] = [];
  const ask = (field: string, question: string, choices?: readonly string[]) => questions.push({ field, question, ...(choices ? { choices } : {}) });
  if (!intent.outcome) ask("outcome", "What would you like to do with this project?", KEEL_ENGINE_CHOICES.outcome);
  if (!intent.runtime) ask("runtime", "What kind of work are you making?", KEEL_ENGINE_CHOICES.runtime);
  if (intent.outcome && intent.outcome !== "explore") {
    if (!intent.family) ask("family", "Which chain family should this project use?", KEEL_ENGINE_CHOICES.family);
    else if (intent.family === "ethereum" && !intent.chainId) ask("chainId", "Which EVM network should this project use? Enter its chain ID.");
    else if (intent.family === "tezos" && !intent.network) ask("network", "Which Tezos network should this project use?");
    if (!intent.storage) ask("storage", "Where should the work be stored? Compare measured costs before choosing.", KEEL_ENGINE_CHOICES.storage);
  }
  if (intent.outcome === "release" && intent.mintSystem !== "fray-auction") {
    if (!intent.releaseType) ask("releaseType", "One unique work, an edition, or a series?", KEEL_ENGINE_CHOICES.releaseType);
    if (!intent.collection) ask("collection", "Use one of your collections or create a new one?", KEEL_ENGINE_CHOICES.collection);
    if (["existing", "external"].includes(intent.collection ?? "") && !intent.collectionAddress) ask("collectionAddress", "What is the collection address on the selected network?");
    if (!intent.mintSystem) ask("mintSystem", "How should people receive the work?", KEEL_ENGINE_CHOICES.mintSystem);
    if (["limited-edition", "series"].includes(intent.releaseType ?? "") && !intent.supply) ask("supply", "How many copies or unique works should be available?");
    if (intent.mintSystem === "mint-gate") {
      if (!intent.access) ask("access", "Who should be eligible to mint?", KEEL_ENGINE_CHOICES.access);
      if ((intent.access?.length ?? 0) > 1 && !intent.gateLogic) ask("gateLogic", "Must collectors satisfy every gate, or any one gate?", KEEL_ENGINE_CHOICES.gateLogic);
      if (!intent.signature) ask("signature", "Should minting require a creator or platform signature?", KEEL_ENGINE_CHOICES.signature);
    }
    if (intent.mintSystem === "one-mint" && !intent.stages) ask("stages", "Which phases should share this drop's supply and wallet limits?", KEEL_ENGINE_CHOICES.stage);
  }
  const blockers: string[] = [];
  if (intent.mintSystem === "one-mint" && (intent.access || intent.signature || intent.gateLogic)) blockers.push("OneMint access is configured per stage. Independent campaign gate settings cannot be forwarded to this route.");
  if (intent.mintSystem === "admin-mint" && (intent.access || intent.signature || intent.gateLogic)) blockers.push("Admin mint uses creator authority and recipients, not campaign access gates.");
  if (intent.storage === "wake") blockers.push("Wake requires separate evidence and viewer integration checks; no live readiness is established by this planner.");
  const runtimeModules = intent.runtime === "static-media" ? ["keel.asset-display@1"]
    : intent.runtime === "p5" ? ["p5", "keel.seeded-random"]
    : intent.runtime === "three" ? ["three-r180-module", "three-r180-core"]
    : intent.runtime === "doom-wasm" ? ["declared Doom WASM runtime"]
    : intent.runtime === "flash-ruffle" ? ["Ruffle loader/runtime/core/WASM", "keel.seeded-random", "declared decoder"] : [];
  const modules = intent.family === "tezos" && intent.outcome !== undefined && intent.outcome !== "explore" && intent.mintSystem !== "fray-auction"
    ? [...KEEL_TEZOS_STANDARD_MODULES, ...runtimeModules]
    : runtimeModules;
  const nextTools = intent.mintSystem === "fray-auction" ? ["fray-auction-intake", "keel-library-search", "fray-stage-project"]
    : intent.outcome === "explore" ? ["analyze", "keel-library-search"]
    : [
      ...(intent.family === "tezos" ? ["keel-tezos-standard-route-plan"] : []),
      "keel-studio-capabilities", "analyze", "cost", "keel-library-search",
      ...(intent.family === "tezos" ? ["keel-tezos-publication-prepare"] : intent.storage === "inline" ? ["keel-inline-prepare"] : ["upload-plan"]), "keel-studio-stage-project",
    ];
  return {
    schema: "keel-engine-plan@1" as const,
    status: blockers.length ? "blocked" : questions.length ? "needs-input" : "planned",
    intent,
    defaults: {
      workspace: "local-first",
      viewer: "registered-canonical-shell",
      inlineCarriage: "raw-percent",
      moduleSelection: "exact-same-chain",
      signing: "external-wallet-only",
      ...(intent.family === "tezos" && intent.outcome !== undefined && intent.outcome !== "explore" ? {
        storage: KEEL_TEZOS_STANDARD_STORAGE,
        presentation: "auto-inline-then-hybrid-rpc",
        adapter: "keel-tezos-standard-fa2-onchfs",
        publicSurface: KEEL_TEZOS_STANDARD_PUBLIC_SURFACE,
        compatibilitySurface: KEEL_TEZOS_STANDARD_COMPATIBILITY_SURFACE,
      } : {}),
    },
    suggestions: intent.outcome === "release" && !intent.collection ? [{ field: "collection", value: intent.releaseType === "limited-edition" || intent.releaseType === "open-edition" ? "erc1155" : "erc721a", reason: "A dedicated creator-owned collection; confirm before preparing calls." }] : [],
    questions,
    nextQuestions: questions.slice(0, 3),
    blockers,
    modules: { required: modules, publicationStatus: "unverified", setup: KEEL_ENGINE_CATALOG.moduleWorkflow },
    nextTools,
    remainingReview: intent.outcome === "release" ? ["Exact price/payment asset, payout, royalties, schedule, recipients or access proofs", "Current owner/roles, manager authorization and reserved capacity", "Selected-chain contracts, simulation, durable operation and wallet review"] : ["Measured bytes, cost, selected-chain bindings and storage availability"],
    evidence: KEEL_ENGINE_CATALOG.evidence,
    authority: { approvalRequiredNow: false, signing: "not-performed", submission: "not-performed", publicationReady: false },
  };
}

/** Storage decisions are machinery, not questions for the artist. Costs must
 * come from the selected-chain estimator; unknown costs are not zero. */
export function planCreatorAssetStorage(assets: readonly {
  id: string;
  digest: string;
  options: readonly {
    kind: "existing" | "raw" | "gzip" | "brotli";
    verified: boolean;
    lossless: boolean;
    totalGas: bigint;
    objectId?: string;
  }[];
}[]) {
  const ids = new Set<string>();
  return assets.map(asset => {
    if (!asset.id || ids.has(asset.id)) throw new Error("Asset IDs must be unique and nonempty");
    ids.add(asset.id);
    if (!/^(?:0x|sha256:)[0-9a-f]{64}$/i.test(asset.digest)) throw new Error("Asset requires an exact SHA-256 digest");
    for (const option of asset.options) if (option.totalGas < 0n) throw new Error("Storage cost cannot be negative");
    const eligible = asset.options.filter(option => option.verified && option.lossless &&
      (option.kind !== "existing" || Boolean(option.objectId)));
    const selected = eligible.reduce<(typeof eligible)[number] | undefined>((best, option) =>
      !best || option.totalGas < best.totalGas ||
      (option.totalGas === best.totalGas && option.kind === "existing") ? option : best, undefined);
    return { id: asset.id, digest: asset.digest, preserveOriginal: true as const,
      status: selected ? "planned" as const : "measurement-required" as const,
      selected: selected ?? null };
  });
}
