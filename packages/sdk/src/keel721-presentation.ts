import { encodeFunctionData, parseAbi } from "viem";
import { ZERO_ADDRESS, ZERO_BYTES32, type Address, type Hex } from "./types.js";
import { normalizedAddress, normalizedBytes32, uint } from "./validation.js";

export const keel721PresentationAbi = parseAbi([
  "function setImageSource(address collection,uint256 tokenId,address store,bytes32 objectId)",
  "function setTokenURIRoute(address collection,uint256 tokenId,string prefix,string postfix,bool appendTokenId)",
  "function imageSources(address collection,uint256 tokenId) view returns (bytes32 objectId,address store,bool configured,bool frozen)",
  "function tokenURIRoutes(address collection,uint256 tokenId) view returns (bool configured,bool appendTokenId,string prefix,string postfix)",
  "function frozen(address collection,uint256 tokenId) view returns (bool)",
  "function tokenURI(address collection,uint256 tokenId) view returns (bool overridden,string uri)",
  "function imageURI(address collection,uint256 tokenId,string fallbackURI) view returns (string)",
  "event ImageSourceSet(bytes32 indexed objectId,address store,address indexed collection,uint256 indexed tokenId)",
  "event TokenURIRouteSet(bool appendTokenId,string prefix,string postfix,address indexed collection,uint256 indexed tokenId)",
]);

export type Keel721PresentationAction =
  | { readonly kind: "bind-module" }
  | { readonly kind: "image"; readonly tokenId?: bigint | number; readonly store: Address; readonly objectId: Hex }
  | { readonly kind: "uri"; readonly tokenId?: bigint | number; readonly prefix: string; readonly postfix?: string; readonly appendTokenId?: boolean };

/** Builds unsigned calls for KeelRouted721. Bind the shared module before the first mint. */
export function buildKeel721PresentationCall(input: {
  readonly collection: Address;
  readonly module: Address;
  readonly action: Keel721PresentationAction;
}) {
  const collection = normalizedAddress(input.collection, ZERO_ADDRESS, "collection");
  const module = normalizedAddress(input.module, ZERO_ADDRESS, "module");
  if (collection === ZERO_ADDRESS || module === ZERO_ADDRESS) throw new TypeError("collection and module must be non-zero.");
  const action = input.action;
  if (action.kind === "bind-module") return {
    to: collection, value: 0n,
    data: encodeFunctionData({ abi: parseAbi(["function setPresentationModule(address module)"]), functionName: "setPresentationModule", args: [module] }),
  };
  const tokenId = uint(action.tokenId, 0n, "tokenId");
  if (action.kind === "image") {
    const store = normalizedAddress(action.store, ZERO_ADDRESS, "store");
    const objectId = normalizedBytes32(action.objectId, ZERO_BYTES32, "objectId");
    if ((store === ZERO_ADDRESS) !== (objectId === ZERO_BYTES32)) throw new TypeError("Clear both store and objectId, or provide both.");
    return { to: module, value: 0n, data: encodeFunctionData({ abi: keel721PresentationAbi, functionName: "setImageSource", args: [collection, tokenId, store, objectId] }) };
  }
  return { to: module, value: 0n, data: encodeFunctionData({ abi: keel721PresentationAbi, functionName: "setTokenURIRoute", args: [collection, tokenId, action.prefix, action.postfix ?? "", action.appendTokenId ?? true] }) };
}

/** Advisory only. The caller chooses a warning threshold or null to disable it. */
export function reviewKeel721URI(value: string, warningBytes: number | null = 32_768) {
  if (warningBytes !== null && (!Number.isSafeInteger(warningBytes) || warningBytes < 0)) throw new RangeError("warningBytes must be a non-negative safe integer or null.");
  const bytes = new TextEncoder().encode(value).length;
  return {
    bytes,
    warnings: warningBytes !== null && bytes > warningBytes
      ? ["Large URI: estimate write gas and test the final tokenURI response with your intended readers before submitting."]
      : [],
  };
}

/** Existing Routed721 hook with optional native media. These calls are unsigned
 * encodings, not runtime/registration/receipt/read-budget qualification. */
export const KEEL_NATIVE_MEDIA_PRESENTATION_ROUTES = ["native-fallback", "image-only-inline", "media-with-poster-inline", "embedded-program", "direct-reference"] as const;
export type KeelNativeMediaPresentationRoute = (typeof KEEL_NATIVE_MEDIA_PRESENTATION_ROUTES)[number];
export const keelNativeMediaPresentationAbi = parseAbi([
  "function setNativeMediaSource(address collection,uint256 tokenId,uint8 route,address store,bytes32 objectId,bool omitImage)",
  "function nativeMediaSources(address collection,uint256 tokenId) view returns(bytes32 objectId,address store,uint8 route,bool omitImage,bool configured)",
  "event NativeMediaSourceSet(bool omitImage,uint8 route,address store,bytes32 indexed objectId,address indexed collection,uint256 indexed tokenId)",
]);
/** Native source must be the actual uncompressed Hold record. Never replace an
 * existing encoded descriptor's identity with the decoded artwork's hash. The
 * contract rechecks its live record/bytes; the publication gate still needs the
 * actual registered runtime/library/profile, source readback and full program. */
export function buildKeelNativeMediaPresentationCall(input: {
  readonly collection: Address;
  readonly module: Address;
  readonly tokenId?: bigint | number;
  readonly route: KeelNativeMediaPresentationRoute;
  readonly source?: { readonly store: Address; readonly objectId: Hex };
  /** Only an explicit embedded-program selection can omit the grid image. */
  readonly omitImage?: boolean;
}) {
  const collection = normalizedAddress(input.collection, ZERO_ADDRESS, "collection");
  const module = normalizedAddress(input.module, ZERO_ADDRESS, "module");
  if (collection === ZERO_ADDRESS || module === ZERO_ADDRESS) throw new TypeError("collection and module must be non-zero.");
  const route = KEEL_NATIVE_MEDIA_PRESENTATION_ROUTES.indexOf(input.route);
  if (route < 0) throw new TypeError("Unsupported native media presentation route.");
  if (input.omitImage !== undefined && typeof input.omitImage !== "boolean") throw new TypeError("omitImage must be an explicit boolean.");
  const omitImage = input.omitImage === true;
  if (omitImage && input.route !== "embedded-program") throw new TypeError("Only an explicit embedded program can omit its grid image.");
  const store = normalizedAddress(input.source?.store, ZERO_ADDRESS, "store");
  const objectId = normalizedBytes32(input.source?.objectId, ZERO_BYTES32, "objectId");
  if (route === 0 ? store !== ZERO_ADDRESS || objectId !== ZERO_BYTES32 : store === ZERO_ADDRESS || objectId === ZERO_BYTES32) throw new TypeError("Native fallback clears the source; every other route requires its exact native store and object ID.");
  return { to: module, value: 0n, data: encodeFunctionData({ abi: keelNativeMediaPresentationAbi,
    functionName: "setNativeMediaSource", args: [collection, uint(input.tokenId, 0n, "tokenId"), route, store, objectId, omitImage] }) };
}
