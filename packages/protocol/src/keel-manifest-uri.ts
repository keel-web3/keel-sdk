import type { Hex } from "./types.js";

/** The manifest's media type in its standard link. */
export const KEEL_MANIFEST_MEDIA_TYPE = "application/json" as const;

/** Schemes from the retired OCA platform. KEEL rejects them by name instead of resolving them. */
const RETIRED_SCHEMES = /^(?:oca-onchain|oca):/iu;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;

export interface KeelManifestReference {
  readonly chainId: number;
  readonly store: Hex;
  readonly objectId: Hex;
}

export class KeelRetiredLocatorError extends TypeError {
  constructor(uri: string) {
    super(`"${uri.slice(0, 32)}…" uses a retired OCA scheme. OCA is gone; link a KEEL manifest with keelManifestURI() (web3://<store>:<chainId>/haulObject/<objectId>).`);
    this.name = "KeelRetiredLocatorError";
  }
}

/** True for a locator in a retired OCA scheme. */
export function isRetiredKeelLocator(uri: string): boolean {
  return RETIRED_SCHEMES.test(uri.trim());
}

function reference(input: KeelManifestReference): KeelManifestReference {
  const store = input.store.toLowerCase() as Hex;
  const objectId = input.objectId.toLowerCase() as Hex;
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new TypeError("A KEEL manifest link needs a positive safe chain ID.");
  if (!ADDRESS.test(store)) throw new TypeError("A KEEL manifest link needs a canonical KeelHold address.");
  if (!BYTES32.test(objectId)) throw new TypeError("A KEEL manifest link needs a bytes32 object ID.");
  return { chainId: input.chainId, store, objectId };
}

/**
 * The standard link to a manifest held in KeelHold: the ERC-4804/6860 URL for
 * `haulObject`, which any web3:// client resolves to the manifest's bytes.
 */
export function keelManifestURI(input: KeelManifestReference): string {
  const { chainId, store, objectId } = reference(input);
  return `web3://${store}:${chainId}/haulObject/${objectId}?mime.type=${encodeURIComponent(KEEL_MANIFEST_MEDIA_TYPE)}`;
}

/**
 * Read a KeelHold manifest link: the standard web3:// form, or the older
 * keel-onchain://<chainId>/<store>/<objectId> form already published. Returns
 * undefined for another scheme (an HTTP manifest, say) and throws on a
 * malformed KEEL link or a retired OCA one.
 */
export function parseKeelManifestURI(uri: string): KeelManifestReference | undefined {
  if (isRetiredKeelLocator(uri)) throw new KeelRetiredLocatorError(uri);
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return undefined;
  }
  if (parsed.protocol === "web3:") {
    const match = /^web3:\/\/(0x[0-9a-fA-F]{40}):([1-9][0-9]*)\/haulObject\/(0x[0-9a-fA-F]{64})(?:\?mime\.type=([^&#]+))?$/u.exec(uri);
    if (match === null) throw new TypeError("A KEEL manifest link must be web3://<store>:<chainId>/haulObject/<objectId>?mime.type=application%2Fjson.");
    if (match[4] !== undefined && decodeURIComponent(match[4]).toLowerCase() !== KEEL_MANIFEST_MEDIA_TYPE) {
      throw new TypeError("A KEEL manifest link must declare mime.type=application/json.");
    }
    return reference({ chainId: Number(match[2]), store: match[1] as Hex, objectId: match[3] as Hex });
  }
  if (parsed.protocol !== "keel-onchain:") return undefined;
  if (parsed.username.length > 0 || parsed.password.length > 0 || parsed.port.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new TypeError("Onchain manifest URI cannot contain credentials, a port, query, or fragment.");
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 2 || !ADDRESS.test(segments[0]!) || !BYTES32.test(segments[1]!)) {
    throw new TypeError("Onchain manifest URI must be keel-onchain://<chainId>/<lowercase-store>/<objectId>.");
  }
  return reference({ chainId: Number(parsed.hostname), store: segments[0] as Hex, objectId: segments[1] as Hex });
}
