/** Installed canonical-host reader. Creator frames receive data, never RPC authority. */
import { parseAbi, encodeFunctionData, decodeFunctionResult, hexToBytes, keccak256, toFunctionSelector, type Hex } from "viem";
import { canonicalJson, intersectCapabilities, parseArtifactManifest, utf8ToBytes, verifyIntegrity, walletIntentToken, remoteUrlAllowed } from "@keel/protocol";
import { createPublishedViewReader, resolveArtifact } from "@keel/viewer";
import { keelGraphRegistryAbi, keelPluginRegistryAbi } from "./abi.js";

export const FRAY_CONTENT_VIEW_ABI = [
  "function readMarine(uint256 tokenId) view returns ((address wallet,address registry,uint32 ceiling,bytes32 catalogRoot,uint32 mintCeiling,uint32 rewardPool,uint32 viewerRevision,uint32 attributes,uint16[] pages,uint256[] words) state)",
  "function readContent(uint32 id) view returns ((bytes32 objectId,bytes32 digest,bytes32 rulesDigest,uint64 byteLength,uint16 slot,uint8 kind) entry,bytes data)",
] as const;
export const FRAY_CONTENT_ADAPTER = { protocol: "fray-content-view-adapter@1", operations: ["fray.content.marine", "fray.content.record"], maxRecords: 513, maxManifestBytes: 65536 };
export const FRAY_READ_RUNTIME = "export const protocol = 'keel-installed-read-only@1';";
export const FRAY_APPEARANCE_VIEW_ABI = [
  "function readAppearance(uint256 marineId,uint32[] campaignIds,bytes32[][] proofs) view returns ((address registry,address owner,address backpack,uint32 ceiling,bytes32 catalogRoot,uint32 campaignCeiling,uint32[] activeCampaignIds,uint256 originalSlots,string[] slotNames,(uint32 contentId,uint8 source,uint16 priority,uint256 originId,bytes32 variantSeed,uint256 slots)[] layers) state)",
] as const;
export const FRAY_APPEARANCE_ADAPTER = { protocol: "fray-appearance-view-adapter@1", operations: ["fray.appearance.marine"], maxCampaigns: 64, maxLayers: 128 };
const appearanceAbi = parseAbi(FRAY_APPEARANCE_VIEW_ABI);
const abi = parseAbi(FRAY_CONTENT_VIEW_ABI);
const proofAbi = parseAbi([...keelGraphRegistryAbi, ...keelPluginRegistryAbi,
  "function pluginProtocol() view returns (bytes32)", "function pluginId() view returns (bytes32)",
  "function pluginVersion() view returns (uint64)", "function supportsInterface(bytes4) view returns (bool)"]);
const hosts = ["publicnode.com", "rpc.thirdweb.com", "rpc.ankr.com", "base.org", "drpc.org"];
const methods = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call"]);
const decode = new TextDecoder("utf-8", { fatal: true });
const integer = (value: unknown, max: bigint): bigint => {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Invalid content identifier");
  const id = BigInt(value);
  if (id > max) throw new Error("Content identifier out of range");
  return id;
};

export async function resolveInlinePublishedContent(
  items: readonly { id: string; role?: string; mediaType: string; integrity: { algorithm: "sha256"; digest: Hex; byteLength: number } }[],
  resolved: ReadonlyMap<string, Uint8Array>, context: unknown,
) {
  const item = items.find(value => value.id === "keel.read-manifest" && (value.role === "data" || value.role === "asset") && value.mediaType === "application/json");
  if (!item) return undefined;
  const bytes = resolved.get(item.id);
  if (!bytes || bytes.length > 1_048_576 || !await verifyIntegrity(bytes, item.integrity)) throw new Error("Invalid published read manifest");
  const manifest = parseArtifactManifest(JSON.parse(decode.decode(bytes)));
  // The commitment covers canonical JSON, not an unverified context flag.
  if (!await verifyIntegrity(utf8ToBytes(canonicalJson(manifest)), item.integrity)) throw new Error("Read manifest must use canonical JSON");
  const policy = manifest.extensions?.["keel-read-intents@1"] as { enabled?: boolean; intents?: { plugin: string; id: string }[]; rpc?: string } | undefined;
  if (policy?.enabled !== true) return undefined;
  const required = ["fray.content.marine", "fray.content.record"];
  if (!required.every(id => policy.intents?.some(entry => entry.plugin === "fray-content" && entry.id === id))) throw new Error("Skin read intents are not declared");
  if (typeof policy.rpc !== "string") throw new Error("Skin RPC is not permitted by host policy");
  const endpoint = policy.rpc;
  const appearanceEnabled = policy.intents?.some(entry => entry.plugin === "fray-appearance" && entry.id === "fray.appearance.marine") === true;
  if (appearanceEnabled) required.push("fray.appearance.marine");
  const tokenId = integer(String((context as { tokenId?: unknown } | null)?.tokenId ?? ""), (1n << 256n) - 1n);
  // Only inline declared plugin resources may resolve here. No hidden fetches.
  const denyFetch = async (): Promise<never> => { throw new Error("Read intent resources must be inline"); };
  const outer = await resolveArtifact(manifest, { commitment: { integrity: item.integrity, digestVerified: true }, adapters: { fetch: denyFetch } });
  const reference = manifest.plugins?.plugins.find(value => value.id === "fray-content");
  if (!reference) throw new Error("Published skin plugin is missing");
  if (typeof endpoint !== "string" || (!remoteUrlAllowed(endpoint, hosts, false) && !localContentRpcAllowed(endpoint, String((context as {chainId?:unknown})?.chainId), String(reference.graph.chainId), typeof location === "undefined" ? "" : location.href))) throw new Error("Skin RPC is not permitted by host policy");
  let requests = 0;
  const deadline = Date.now() + 30000;
  async function rpc(method: string, params: unknown[]): Promise<any> {
    if (Date.now() > deadline || !methods.has(method) || ++requests > 760) throw new Error("Skin read budget exceeded");
    const response = await fetch(endpoint, { method: "POST", redirect: "error", credentials: "omit", referrerPolicy: "no-referrer",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: requests, method, params }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Skin RPC unavailable");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Skin RPC response missing");
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length;
      if (size > 262144) { await reader.cancel(); throw new Error("Skin RPC response too large"); } chunks.push(next.value); }
    const body = new Uint8Array(size); let at = 0; for (const chunk of chunks) { body.set(chunk, at); at += chunk.length; }
    const result = JSON.parse(decode.decode(body));
    if (result.error || result.result === undefined) throw new Error("Skin RPC read failed");
    return result.result;
  }
  if (BigInt(await rpc("eth_chainId", [])) !== BigInt(reference.graph.chainId)) throw new Error("Skin RPC chain mismatch");
  const block = await rpc("eth_getBlockByNumber", ["latest", false]);
  if (!/^0x[0-9a-f]{64}$/i.test(block?.hash) || !/^0x[0-9a-f]+$/i.test(block?.number)) throw new Error("Skin RPC block missing");
  const blockNumber = BigInt(block.number), blockHash = block.hash as Hex;
  // EIP-1898 prevents failover/reorgs from mixing blocks within this outfit.
  const blockTag = { blockHash, requireCanonical: true };
  const capabilities = intersectCapabilities([{ label: "canonical installed skin reader", ceiling: true,
    allow: ["network.manifested", ...required.map(walletIntentToken)] }], { strictCeiling: true });
  const verification = {
    blockNumber, blockHash, customDigest: async (algorithm: string, value: Uint8Array) => {
      if (algorithm !== "keccak256") throw new Error("Unsupported plugin digest"); return hexToBytes(keccak256(value));
    },
    installedRuntime: { abi: utf8ToBytes(canonicalJson(FRAY_CONTENT_VIEW_ABI)), adapter: utf8ToBytes(canonicalJson(FRAY_CONTENT_ADAPTER)), walletLibrary: utf8ToBytes(FRAY_READ_RUNTIME) },
    resolver: { adapters: { fetch: denyFetch } },
    readContract: async (request: { address: Hex; functionName: string; args: readonly unknown[] }) => {
      const data = encodeFunctionData({ abi: proofAbi, functionName: request.functionName as any, args: request.args as any });
      return decodeFunctionResult({ abi: proofAbi, functionName: request.functionName as any, data: await rpc("eth_call", [{ to: request.address, data }, blockTag]) });
    },
    readCode: async (request: { address: Hex }) => hexToBytes(await rpc("eth_getCode", [request.address, blockTag])),
  };
  const make = (intentId: string, name: "readMarine" | "readContent", limit: bigint) => createPublishedViewReader({ outer, plugin: "fray-content", intentId, capabilities, verification,
    operation: { selector: toFunctionSelector(name === "readMarine" ? "readMarine(uint256)" : "readContent(uint32)"), encode: proposal => {
      const id = integer(proposal, limit);
      return name === "readMarine" ? encodeFunctionData({ abi, functionName: name, args: [id] }) : encodeFunctionData({ abi, functionName: name, args: [Number(id)] });
    } }, read: request => rpc("eth_call", [{ to: request.address, data: request.data }, blockTag]),
  });
  const marine = await make(required[0]!, "readMarine", (1n << 256n) - 1n);
  const content = await make(required[1]!, "readContent", 0xffffffffn);
  const state = decodeFunctionResult({ abi, functionName: "readMarine", data: await marine.read(tokenId.toString()) as Hex });
  const binding = context as { chainId?: unknown; content?: { registry?: unknown } };
  if (String(binding.chainId) !== String(reference.graph.chainId)
    || typeof binding.content?.registry !== "string" || binding.content.registry.toLowerCase() !== state.registry.toLowerCase()) {
    throw new Error("Skin view does not match the token's declared chain and registry");
  }
  if (state.pages.length !== state.words.length || state.pages.length > 64) throw new Error("Invalid wallet equipment");
  const ids = new Set<number>(); const pages = new Set<number>();
  for (let i = 0; i < state.pages.length; i++) {
    const page = state.pages[i]!; if (page > 8191 || pages.has(page)) throw new Error("Invalid wallet page"); pages.add(page);
    for (let slot = 0; slot < 8; slot++) { const id = Number(state.words[i]! >> BigInt(slot * 32) & 0xffffffffn);
      if (id > state.ceiling) throw new Error("Skin exceeds catalog"); if (id) ids.add(id); }
  }
  if (state.attributes) { if (state.attributes > state.mintCeiling) throw new Error("Attributes exceed mint catalog"); ids.add(state.attributes); }
  let appearance: undefined | { originalSlots: string; slotNames: readonly string[]; backpack: Hex; campaignCeiling: number;
    layers: { contentId: number; source: number; priority: number; originId: string; variantSeed: Hex; slots: string }[] };
  let appearanceDisclosure: unknown;
  if (appearanceEnabled) {
    const appearanceReference = manifest.plugins?.plugins.find(value => value.id === "fray-appearance");
    if (!appearanceReference || appearanceReference.graph.chainId !== reference.graph.chainId) throw new Error("Appearance plugin chain mismatch");
    const reader = await createPublishedViewReader({ outer, plugin: "fray-appearance", intentId: "fray.appearance.marine", capabilities,
      verification: { ...verification, installedRuntime: { abi: utf8ToBytes(canonicalJson(FRAY_APPEARANCE_VIEW_ABI)),
        adapter: utf8ToBytes(canonicalJson(FRAY_APPEARANCE_ADAPTER)), walletLibrary: utf8ToBytes(FRAY_READ_RUNTIME) } },
      operation: { selector: toFunctionSelector("readAppearance(uint256,uint32[],bytes32[][])"), encode: proposal => {
        const page = proposal as { ids: number[]; proofs: Hex[][] };
        if (!Array.isArray(page.ids) || page.ids.length > 64 || !Array.isArray(page.proofs) || page.proofs.length !== page.ids.length
          || page.ids.some((id, i) => !Number.isInteger(id) || id < 1 || id > 0xffffffff || (i > 0 && id <= page.ids[i - 1]!))
          || page.proofs.some(proof => !Array.isArray(proof) || proof.length > 32 || proof.some(hash => !/^0x[0-9a-f]{64}$/i.test(hash)))) throw new Error("Invalid campaign proofs");
        return encodeFunctionData({ abi: appearanceAbi, functionName: "readAppearance", args: [tokenId, page.ids, page.proofs] });
      } }, read: request => rpc("eth_call", [{ to: request.address, data: request.data }, blockTag]) });
    const read = async (ids: number[], proofs: Hex[][]) => decodeFunctionResult({ abi: appearanceAbi, functionName: "readAppearance", data: await reader.read({ ids, proofs }) as Hex });
    const first = await read([], []);
    if (first.registry.toLowerCase() !== state.registry.toLowerCase() || first.owner.toLowerCase() !== state.wallet.toLowerCase()
      || first.ceiling !== state.ceiling || first.catalogRoot !== state.catalogRoot || first.activeCampaignIds.length > 64
      || first.activeCampaignIds.some((id, i) => id < 1 || id > first.campaignCeiling || (i > 0 && id <= first.activeCampaignIds[i - 1]!))
      || first.slotNames.length > 256 || new Set(first.slotNames).size !== first.slotNames.length
      || first.slotNames.some(name => !/^[a-z][a-z0-9-]{0,47}$/.test(name))
      || first.originalSlots >> BigInt(first.slotNames.length)) throw new Error("Invalid appearance binding");
    const layers = [...first.layers];
    // Proofs are input data only. Eligibility is checked by the pinned contract;
    // all campaign IDs are scanned, never silently omitted by a supplied ID list.
    const supplied = (context as { appearance?: { proofs?: Record<string, Hex[]> } })?.appearance?.proofs ?? {};
    for (let start = 0; start < first.activeCampaignIds.length; start += 64) {
      const page = first.activeCampaignIds.slice(start, start + 64);
      const next = await read(page, page.map(id => supplied[String(id)] ?? []));
      if (next.catalogRoot !== first.catalogRoot || next.campaignCeiling !== first.campaignCeiling) throw new Error("Appearance changed within pinned block");
      layers.push(...next.layers.filter(layer => layer.source === 1));
      if (layers.length > 128) throw new Error("Appearance layer budget exceeded");
    }
    const origins = new Set<string>();
    for (const layer of layers) {
      const key = `${layer.source}:${layer.originId}`;
      if (![1, 3].includes(layer.source) || layer.originId < 1n || origins.has(key) || layer.contentId < 1 || layer.contentId > state.ceiling
        || layer.slots >> BigInt(first.slotNames.length) || (layer.source === 3 && layer.slots === 0n)) throw new Error("Invalid appearance layer");
      origins.add(key); ids.add(layer.contentId);
    }
    appearance = { originalSlots: String(first.originalSlots), slotNames: first.slotNames, backpack: first.backpack,
      campaignCeiling: first.campaignCeiling, layers: layers.map(layer => ({ ...layer, originId: String(layer.originId), slots: String(layer.slots) })) };
    appearanceDisclosure = JSON.parse(JSON.stringify(reader.disclosure, (_key, value) => typeof value === "bigint" ? String(value) : value));
  }
  if (ids.size > 513) throw new Error("Content record budget exceeded");
  const records = [];
  for (const id of ids) {
    const [entry, hex] = decodeFunctionResult({ abi, functionName: "readContent", data: await content.read(String(id)) as Hex });
    const data = hexToBytes(hex);
    if (data.length > 65536 || !await verifyIntegrity(data, { algorithm: "sha256", digest: entry.digest, byteLength: Number(entry.byteLength) })) throw new Error("Skin data does not match immutable digest");
    const recordManifest = JSON.parse(decode.decode(data));
    if (entry.kind === 11) {
      const branches = recordManifest?.layer?.branches;
      if (!Array.isArray(branches) || branches.length > 16) throw new Error("Invalid attribute branches");
      for (const branch of branches) {
        if (!Array.isArray(branch.assets) || branch.assets.length > 16) throw new Error("Invalid attribute dependencies");
        for (const dependency of branch.assets) {
          if (!Number.isInteger(dependency) || dependency < 1 || dependency >= id || dependency > state.ceiling) throw new Error("Attribute dependency exceeds catalog");
          ids.add(dependency);
        }
      }
      if (ids.size > 513) throw new Error("Content dependency budget exceeded");
    }
    records.push({ id, entry: { ...entry, byteLength: Number(entry.byteLength) }, manifest: recordManifest });
  }
  return { protocol: "fray-content-view@1", state: { ...state, words: state.words.map(String), ...(appearance ? { appearance } : {}) }, records,
    disclosure: { ...marine.disclosure, ...(appearanceDisclosure ? { appearance: appearanceDisclosure } : {}), blockNumber: String(blockNumber), endpoint: new URL(endpoint).origin, requests } };
}

/** Local test access still requires the verified manifest and published intents above. */
export function localContentRpcAllowed(endpoint:string,contextChain:string,pluginChain:string,viewerURL:string):boolean {
  if(contextChain!=="31337"||pluginChain!=="31337")return false;
  try{const rpc=new URL(endpoint),viewer=new URL(viewerURL);return rpc.protocol==="http:"&&rpc.hostname==="127.0.0.1"&&rpc.port==="8545"&&rpc.pathname==="/"&&!rpc.search&&!rpc.hash&&!rpc.username&&!rpc.password&&viewer.protocol==="http:"&&["127.0.0.1","localhost"].includes(viewer.hostname);}catch{return false;}
}
