import {
  checkKeelTezosCollectionPublication,
  planKeelTezosCollectionLaunch,
  prepareKeelTezosCollectionOriginations,
  prepareKeelTezosHoldResources,
  prepareKeelTezosMint,
  prepareKeelTezosMintGate,
  prepareKeelTezosMintGateAction,
  prepareKeelTezosPresentationBinding,
  prepareKeelTezosTokenMetadata,
  type KeelTezosCompiledCode,
  type KeelTezosHoldResourceInput,
} from "@keel/sdk/tezos-collection";
import type { JsonSchema, ToolContext, ToolDefinition } from "./types.js";

/**
 * MCP doors to the KEEL Tezos creator-collection route. Every tool except the
 * read-back is offline preparation; the read-back performs public read-only
 * RPC/TzKT GETs and view simulations against the selected network. None of
 * them accept key material, sign, or submit.
 */

const NETWORK: JsonSchema = { type: "string", pattern: "^Net[1-9A-HJ-NP-Za-km-z]{12}$", description: "Exact selected Tezos chain identity (Net...)." };
const ADDRESS: JsonSchema = { type: "string", pattern: "^(?:tz[1-4]|KT1)[1-9A-HJ-NP-Za-km-z]{33}$" };
const KT1: JsonSchema = { type: "string", pattern: "^KT1[1-9A-HJ-NP-Za-km-z]{33}$" };
const ROYALTY: JsonSchema = { type: "object", additionalProperties: false, required: ["receiver", "bps"], properties: { receiver: ADDRESS, bps: { type: "integer", minimum: 1, maximum: 10000 } } };
const DIGEST: JsonSchema = { type: "string", pattern: "^(?:0x)?[0-9a-fA-F]{64}$" };
const NATURAL: JsonSchema = { anyOf: [{ type: "integer", minimum: 0 }, { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" }] };
const ALLOWLIST: JsonSchema = { type: "array", maxItems: 65_536, items: { type: "object", additionalProperties: false, required: ["account", "allowance"], properties: { account: ADDRESS, allowance: { type: "integer", minimum: 1 } } } };
const SECRET = /(?:private|secret|mnemonic|seed|passphrase)/iu;
const MAX_CODE_BYTES = 4 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 16 * 1024 * 1024;

function input(value: unknown, label: string): Record<string, any> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} requires an object.`);
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) { node.forEach((item, index) => walk(item, `${path}[${index}]`)); return; }
    if (node === null || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (SECRET.test(key)) throw new TypeError(`Private signer material is never accepted by ${label}: ${path}.${key}`);
      walk(child, `${path}.${key}`);
    }
  };
  walk(value, "input");
  return value as Record<string, any>;
}

function tool(name: string, description: string, inputSchema: JsonSchema, run: ToolDefinition["run"]): ToolDefinition {
  return { descriptor: { name, description, inputSchema }, run };
}

const COMPILED_DIRECTORIES = {
  hold: "collection_route_hold",
  index: "collection_route_index",
  collection: "collection_route_collection",
  presentation: "collection_route_presentation",
  creatorProfile: "collection_route_creator_profile",
  oneMint: "collection_route_one_mint",
} as const;

async function compiledCode(context: ToolContext, args: Record<string, any>): Promise<Partial<Record<keyof typeof COMPILED_DIRECTORIES, KeelTezosCompiledCode>>> {
  const code: Partial<Record<keyof typeof COMPILED_DIRECTORIES, KeelTezosCompiledCode>> = {};
  const digests = (args.codeSha256 ?? {}) as Record<string, string>;
  if (typeof args.artifactsDir === "string") {
    for (const [key, directory] of Object.entries(COMPILED_DIRECTORIES) as [keyof typeof COMPILED_DIRECTORIES, string][]) {
      let loaded: { readonly bytes: Uint8Array } | undefined;
      try { loaded = await context.workspace.readFile(`${args.artifactsDir}/${directory}/step_001_cont_0_contract.json`, MAX_CODE_BYTES); }
      catch { loaded = undefined; }
      if (loaded === undefined) continue;
      const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(loaded.bytes)) as KeelTezosCompiledCode["code"];
      code[key] = { code: parsed, ...(digests[key] === undefined ? {} : { sha256: digests[key] }) };
    }
  }
  return code;
}

async function resourceBytes(context: ToolContext, resource: Record<string, any>, index: number): Promise<Uint8Array> {
  const sources = ["path", "text", "hex"].filter((key) => resource[key] !== undefined);
  if (sources.length !== 1) throw new TypeError(`resources[${index}] needs exactly one of path, text or hex.`);
  if (typeof resource.path === "string") return (await context.workspace.readFile(resource.path, MAX_RESOURCE_BYTES)).bytes;
  if (typeof resource.text === "string") return new TextEncoder().encode(resource.text);
  const hex = String(resource.hex).replace(/^0x/u, "");
  if (!/^(?:[0-9a-fA-F]{2})+$/u.test(hex)) throw new TypeError(`resources[${index}].hex must be even-length hex.`);
  return Uint8Array.from(hex.match(/../gu) as string[], (byte) => Number.parseInt(byte, 16));
}

const STAGE: JsonSchema = {
  type: "object", additionalProperties: false, required: ["kind", "startTime", "endTime"],
  properties: {
    kind: { type: "string", enum: ["off", "public", "premint", "end", "merkle"] },
    startTime: { type: "integer", minimum: 0 }, endTime: { type: "integer", minimum: 1 },
    priceMutez: NATURAL, maxPerTransaction: { type: "integer", minimum: 0 }, maxPerWallet: { type: "integer", minimum: 0 },
    metadataDigest: DIGEST, allowlist: ALLOWLIST,
  },
};

const TOKEN: JsonSchema = {
  type: "object", additionalProperties: false, required: ["tokenId", "name"],
  properties: {
    tokenId: { type: "integer", minimum: 1 }, name: { type: "string", minLength: 1, maxLength: 256 }, description: { type: "string", maxLength: 4096 }, symbol: { type: "string", maxLength: 32 },
    html: { type: "string", description: "Self-contained HTML stored inline as a raw-percent data:text/html artifactUri." },
    htmlPath: { type: "string", description: "Workspace path of self-contained HTML (alternative to html)." },
    previewSvg: { type: "string", description: "Self-contained SVG preview stored inline as displayUri." },
    previewSvgPath: { type: "string" },
    artifactUri: { type: "string", maxLength: 2048, description: "onchfs://<cid> from keel-tezos-hold-resources-prepare." }, artifactMediaType: { type: "string" },
    displayUri: { type: "string", maxLength: 2048 }, displayMediaType: { type: "string" }, thumbnailUri: { type: "string", maxLength: 2048 },
    attributes: { type: "array", maxItems: 64, items: { type: "object", additionalProperties: false, required: ["name", "value"], properties: { name: { type: "string" }, value: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } } } },
    creators: { type: "array", maxItems: 16, items: ADDRESS }, tags: { type: "array", maxItems: 32, items: { type: "string" } }, rights: { type: "string", maxLength: 1024 },
    royalties: { type: "object", additionalProperties: false, required: ["decimals", "shares"], description: "TZIP-21 royalties: each recipient's share out of 10^decimals.", properties: { decimals: { type: "integer", minimum: 0, maximum: 6 }, shares: { type: "array", minItems: 1, maxItems: 16, items: { type: "object", additionalProperties: false, required: ["recipient", "share"], properties: { recipient: ADDRESS, share: NATURAL } } } } },
  },
};

export const TEZOS_COLLECTION_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  tool(
    "keel-tezos-collection-launch-plan",
    "Plan a complete Tezos KEEL collection launch: originate Hold/Index/presentation/FA2/OneMint, store creator resources in the Hold (OnchFS), bind the presentation, configure the mint gate, mint a pilot, write TZIP-21 token metadata with self-contained presentation, read back, then open minting. Review-only; lists the exact tool and SDK function for each step.",
    { type: "object", additionalProperties: false, required: ["network", "creator", "maxSupply"], properties: { network: NETWORK, creator: ADDRESS, maxSupply: NATURAL, pilotFirst: { type: "boolean", default: true }, sharedCreatorProfileRegistry: KT1 } },
    async (_context, value) => planKeelTezosCollectionLaunch(input(value, "the Tezos launch plan") as never),
  ),
  tool(
    "keel-tezos-collection-originate-prepare",
    "Prepare the staged Tezos originations for a KEEL collection: KeelHoldOnchFS, KeelIndex, KeelPresentationStateRegistry, KeelCreatorProfileRegistry (unless a shared one is bound), KeelCollectionFA2 (max supply, TZIP-16 metadata) and OneMintController. Storage is built from typed inputs; compiled code is read from artifactsDir (script/tezos/compile-collection-route.sh output) and every catalogued entrypoint is checked. Dependent contracts stay unresolved until receipt-backed KT1 bindings are supplied. Review-only.",
    {
      type: "object", additionalProperties: false, required: ["network", "creator", "maxSupply"],
      properties: {
        network: NETWORK, creator: ADDRESS, maxSupply: NATURAL,
        holderMetadataEditing: { type: "boolean", default: false, description: "Let holders rewrite their own token metadata. Default false: only the creator's administrators edit; a holder may still freeze their own token." },
        royalty: { ...ROYALTY, description: "Collection default royalty in basis points (ERC-2981 counterpart). The KEEL market reads it through royalty_info; the result includes the matching TZIP-21 token-metadata royalties." },
        collectionMetadata: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 256 }, description: { type: "string" }, version: { type: "string" }, homepage: { type: "string" }, authors: { type: "array", items: { type: "string" } }, license: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string" }, details: { type: "string" } } }, interfaces: { type: "array", items: { type: "string" } } } },
        artifactsDir: { type: "string", description: "Workspace directory holding collection_route_<contract>/step_001_cont_0_contract.json." },
        codeSha256: { type: "object", description: "Optional expected SHA-256 of each compiled code array, keyed by hold/index/collection/presentation/creatorProfile/oneMint." },
        bindings: { type: "object", additionalProperties: false, properties: { hold: KT1, index: KT1, presentation: KT1, creatorProfile: KT1, manager: KT1 } },
      },
    },
    async (context, value) => {
      const args = input(value, "the Tezos origination tool");
      return prepareKeelTezosCollectionOriginations({ network: args.network, creator: args.creator, maxSupply: args.maxSupply, ...(args.holderMetadataEditing === undefined ? {} : { holderMetadataEditing: args.holderMetadataEditing }), ...(args.royalty === undefined ? {} : { royalty: args.royalty }), ...(args.collectionMetadata === undefined ? {} : { collectionMetadata: args.collectionMetadata }), code: await compiledCode(context, args), ...(args.bindings === undefined ? {} : { bindings: args.bindings }) });
    },
  ),
  tool(
    "keel-tezos-hold-resources-prepare",
    "Prepare KeelHoldOnchFS writes for creator resources: content-addressed write_chunk, create_file (exact OnchFS CID and HPACK metadata), weld_object (KEEL SHA-256 object id) and optionally create_directory. Returns onchfs:// URIs, object ids and operation batches sized under the Tezos operation limit. Native bytes are stored once. Review-only.",
    {
      type: "object", additionalProperties: false, required: ["network", "creator", "hold", "resources"],
      properties: {
        network: NETWORK, creator: ADDRESS, hold: KT1, chunkBytes: { type: "integer", minimum: 1, maximum: 28_000 }, directory: { type: "boolean" },
        resources: { type: "array", minItems: 1, maxItems: 256, items: { type: "object", additionalProperties: false, required: ["name", "mediaType"], properties: { name: { type: "string" }, mediaType: { type: "string" }, path: { type: "string" }, text: { type: "string" }, hex: { type: "string" }, compression: { type: "string" }, decoded: { type: "object", additionalProperties: false, required: ["sha256", "byteLength"], properties: { sha256: DIGEST, byteLength: { type: "integer", minimum: 1 } } } } } },
      },
    },
    async (context, value) => {
      const args = input(value, "the Tezos Hold resources tool");
      const resources: KeelTezosHoldResourceInput[] = [];
      for (const [index, resource] of (args.resources as Record<string, any>[]).entries()) {
        resources.push({ name: resource.name, mediaType: resource.mediaType, bytes: await resourceBytes(context, resource, index), ...(resource.compression === undefined ? {} : { compression: resource.compression }), ...(resource.decoded === undefined ? {} : { decoded: resource.decoded }) });
      }
      return prepareKeelTezosHoldResources({ network: args.network, creator: args.creator, hold: args.hold, resources, ...(args.chunkBytes === undefined ? {} : { chunkBytes: args.chunkBytes }), ...(args.directory === undefined ? {} : { directory: args.directory }) });
    },
  ),
  tool(
    "keel-tezos-presentation-bind-prepare",
    "Bind the renderer/presentation to a Tezos KEEL collection: KeelIndex register/publish/activate collection revision, KeelCollectionFA2 set_default_presentation and, optionally, a KeelPresentationStateRegistry policy plus resource revision for the renderer object. Freezing needs an explicit freeze=true. Review-only.",
    {
      type: "object", additionalProperties: false, required: ["network", "creator", "collection", "index", "manifestUri", "manifestDigest"],
      properties: {
        network: NETWORK, creator: ADDRESS, collection: KT1, index: KT1, manifestUri: { type: "string", maxLength: 2048 }, manifestDigest: DIGEST, previewUri: { type: "string", maxLength: 2048 },
        registerCollection: { type: "boolean" }, revision: { type: "integer", minimum: 1 }, revisionPolicy: { type: "string", enum: ["immutable", "creator", "timelocked"] }, freeze: { type: "boolean" },
        presentationPolicy: { type: "object", additionalProperties: false, required: ["registry", "salt", "mediaType", "maxBytes", "valueDigest", "byteLength"], properties: { registry: KT1, salt: { type: "string", pattern: "^(?:0x)?(?:[0-9a-fA-F]{2})+$" }, tokenId: { type: "integer", minimum: 0 }, mediaType: { type: "string" }, maxBytes: { type: "integer", minimum: 1 }, valueDigest: DIGEST, byteLength: { type: "integer", minimum: 1 }, authority: { type: "string", enum: ["immutable", "creator", "token-owner", "creator-or-token-owner"] }, updateKind: { type: "string", enum: ["resource-revision", "harness-revision"] }, expectedParent: { type: "integer", minimum: 0 }, create: { type: "boolean" } } },
      },
    },
    async (_context, value) => prepareKeelTezosPresentationBinding(input(value, "the Tezos presentation binding tool") as never),
  ),
  tool(
    "keel-tezos-mint-gate-prepare",
    "Configure the Tezos mint gate (OneMintController): creator profile, FA2 minter capability, create_drop with price (mutez), supply, per-transaction/per-wallet limits and contiguous public/merkle-allowlist/premint stages, merkle roots and an optional paused start. With `action` it prepares one governed change instead: pause, unpause, close, set-supply, set-merkle-root, withdraw, set-minter, set-holder-metadata-editing (creator opt-in for holder metadata edits), set-collection-metadata or freeze-collection-metadata (TZIP-16), set-default-royalty or remove-default-royalty. Review-only.",
    {
      type: "object", additionalProperties: false, required: ["network", "creator"],
      properties: {
        network: NETWORK, creator: ADDRESS, oneMint: KT1, collection: KT1,
        action: { type: "string", enum: ["pause", "unpause", "close", "set-supply", "set-merkle-root", "withdraw", "set-minter", "set-holder-metadata-editing", "set-collection-metadata", "freeze-collection-metadata", "set-default-royalty", "remove-default-royalty"] },
        royalty: ROYALTY,
        collectionMetadata: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 256 }, description: { type: "string" }, version: { type: "string" }, homepage: { type: "string" }, authors: { type: "array", items: { type: "string" } }, license: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string" }, details: { type: "string" } } }, interfaces: { type: "array", items: { type: "string" } } } },
        dropId: DIGEST, stageIndex: { type: "integer", minimum: 0 }, allowlist: ALLOWLIST, recipient: ADDRESS, account: ADDRESS, enabled: { type: "boolean" },
        supply: { anyOf: [NATURAL, { type: "string", enum: ["open"] }] }, maxPerTransaction: { type: "integer", minimum: 1 }, maxPerWallet: { type: "integer", minimum: 1 }, payout: ADDRESS, metadataDigest: DIGEST,
        stages: { type: "array", minItems: 1, maxItems: 16, items: STAGE }, setMinter: { type: "boolean" }, startPaused: { type: "boolean" }, creatorNonce: { type: "integer", minimum: 0 },
        creatorProfile: { type: "object", additionalProperties: false, required: ["registry", "username", "metadataUri"], properties: { registry: KT1, username: { type: "string", minLength: 1, maxLength: 64 }, metadataUri: { type: "string", minLength: 1, maxLength: 2048 }, recoveryAddress: ADDRESS } },
      },
    },
    async (_context, value) => {
      const args = input(value, "the Tezos mint gate tool");
      return args.action === undefined ? prepareKeelTezosMintGate(args as never) : prepareKeelTezosMintGateAction(args as never);
    },
  ),
  tool(
    "keel-tezos-mint-prepare",
    "Prepare Tezos KEEL mints: OneMint public_mint (exact mutez payment), merkle_mint with allowlist proof, admin_strike for a premint stage, or a direct FA2 strike by an authorized minter (unreserved=true never consumes a drop's reserved supply). Several requests become one batch; quantity >1 is a batch mint. Review-only.",
    {
      type: "object", additionalProperties: false, required: ["network", "sender", "mints"],
      properties: {
        network: NETWORK, sender: ADDRESS, oneMint: KT1, collection: KT1, mintData: { type: "string", pattern: "^(?:0x)?(?:[0-9a-fA-F]{2})*$" },
        mints: { type: "array", minItems: 1, maxItems: 64, items: { type: "object", additionalProperties: false, required: ["mode", "quantity"], properties: { mode: { type: "string", enum: ["public", "merkle", "premint", "direct"] }, dropId: DIGEST, stageIndex: { type: "integer", minimum: 0 }, quantity: { type: "integer", minimum: 1, maximum: 500 }, priceMutez: NATURAL, allowance: { type: "integer", minimum: 1 }, proof: { type: "array", maxItems: 64, items: DIGEST }, recipient: ADDRESS, unreserved: { type: "boolean" } } } },
      },
    },
    async (_context, value) => prepareKeelTezosMint(input(value, "the Tezos mint tool") as never),
  ),
  tool(
    "keel-tezos-token-metadata-prepare",
    "Prepare FA2 set_token_metadata calls with TZIP-12/TZIP-21 token_info: self-contained artifactUri (raw-percent data:text/html, never Base64, or an onchfs:// Hold file), displayUri/thumbnailUri preview, formats, attributes and creators. KEEL pointers (keel-onchain://, keel+tezos://) and external carriers are refused by default; oversize inline HTML is refused with the Hold remedy. Administrators rewrite metadata until a token is frozen; holders edit only when the creator enabled it. Optional per-token freeze. Review-only.",
    {
      type: "object", additionalProperties: false, required: ["network", "creator", "collection", "tokens"],
      properties: { network: NETWORK, creator: ADDRESS, collection: KT1, tokens: { type: "array", minItems: 1, maxItems: 256, items: TOKEN }, freeze: { type: "boolean" }, allowExternalCarrier: { type: "boolean" } },
    },
    async (context, value) => {
      const args = input(value, "the Tezos token metadata tool");
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const tokens = [];
      for (const token of args.tokens as Record<string, any>[]) {
        const { htmlPath, previewSvgPath, royalties, ...rest } = token;
        if (htmlPath !== undefined && rest.html !== undefined) throw new TypeError("Choose html or htmlPath, not both.");
        if (previewSvgPath !== undefined && rest.previewSvg !== undefined) throw new TypeError("Choose previewSvg or previewSvgPath, not both.");
        tokens.push({
          ...rest,
          ...(royalties === undefined ? {} : { royalties: { decimals: royalties.decimals, shares: Object.fromEntries((royalties.shares as { recipient: string; share: number | string }[]).map((entry) => [entry.recipient, entry.share])) } }),
          ...(htmlPath === undefined ? {} : { html: decoder.decode((await context.workspace.readFile(htmlPath, MAX_RESOURCE_BYTES)).bytes) }),
          ...(previewSvgPath === undefined ? {} : { previewSvg: decoder.decode((await context.workspace.readFile(previewSvgPath, MAX_RESOURCE_BYTES)).bytes) }),
        });
      }
      return prepareKeelTezosTokenMetadata({ ...args, tokens } as never);
    },
  ),
  tool(
    "keel-tezos-readback-check",
    "Read the selected Tezos network (public RPC, optional TzKT) and verify a published KEEL collection: chain identity, originated contracts, total_supply, OneMint minter capability, creator-only metadata editing (token_owner_can_edit), default royalty (royalty_info), default_presentation digest, Hold objects, and decoded token_metadata (self-contained artifactUri/displayUri, exact token_info or its SHA-256). Read-only GETs and view simulations; no signing or submission.",
    {
      type: "object", additionalProperties: false, required: ["network", "rpcUrl", "collection"],
      properties: {
        network: NETWORK, rpcUrl: { type: "string", minLength: 1, maxLength: 2048 }, tzktUrl: { type: "string", minLength: 1, maxLength: 2048 },
        collection: KT1, oneMint: KT1, hold: KT1, index: KT1, expectedManifestDigest: DIGEST, expectedHolderMetadataEditing: { type: "boolean", default: false }, expectedRoyalty: ROYALTY, expectNoRoyalty: { type: "boolean", description: "Require that the collection reports no default royalty." }, expectedObjects: { type: "array", maxItems: 64, items: DIGEST },
        expectedTokens: { type: "array", maxItems: 64, items: { type: "object", additionalProperties: false, required: ["tokenId"], properties: { tokenId: { type: "integer", minimum: 1 }, tokenInfo: { type: "object" }, tokenInfoSha256: DIGEST } } },
      },
    },
    async (_context, value) => {
      const { expectNoRoyalty, ...args } = input(value, "the Tezos read-back tool");
      if (expectNoRoyalty === true && args.expectedRoyalty !== undefined) throw new TypeError("Pass expectedRoyalty or expectNoRoyalty, not both.");
      return checkKeelTezosCollectionPublication({ ...args, ...(expectNoRoyalty === true ? { expectedRoyalty: null } : {}) } as never);
    },
  ),
];
