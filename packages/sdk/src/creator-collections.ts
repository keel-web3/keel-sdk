import {
  ZERO_ADDRESS,
  ZERO_BYTES32,
  type Address,
  type Hex,
} from "./types.js";
import { KEEL_DEPLOYMENTS } from "./modules.generated.js";
import { normalizedAddress, normalizedBytes32, uint, UINT128_MAX } from "./validation.js";

const UINT96_MAX = (1n << 96n) - 1n;
const MAX_NAME_BYTES = 128;
const MAX_SYMBOL_BYTES = 32;
const ITEM_BITS = 128n;

export enum KeelCreatorTokenStandard {
  ERC721 = 0,
  ERC1155 = 1,
}

export enum KeelCreatorDeploymentKind {
  Dedicated = 0,
  Shared = 1,
  External = 2,
}

export interface KeelCreatorSeedProfileInput {
  readonly chainlinkVrf?: boolean;
  readonly mode?: "derived" | "shared";
  readonly storageOnTransfer?: "full-seed" | "reference";
  readonly futureBlockReveal?: boolean;
  readonly futureBlockDelay?: bigint | number;
  readonly sealedTransfers?: "locked" | "allowed";
  readonly source?: Address;
  readonly sourceGas?: bigint | number;
}

/** Defaults to distinct seeds, two future hashes, locked sealed tokens, and full seed storage on transfer. */
export function buildKeelCreatorSeedProfile(input: KeelCreatorSeedProfileInput = {}) {
  const mode = input.mode ?? "derived";
  const storage = input.storageOnTransfer ?? "full-seed";
  const transfers = input.sealedTransfers ?? "locked";
  if (!["derived", "shared"].includes(mode) || !["full-seed", "reference"].includes(storage) || !["locked", "allowed"].includes(transfers)) throw new TypeError("Invalid seed mode or transfer policy.");
  if (input.futureBlockReveal !== undefined && typeof input.futureBlockReveal !== "boolean") throw new TypeError("futureBlockReveal must be boolean.");
  if (input.chainlinkVrf !== undefined && typeof input.chainlinkVrf !== "boolean") throw new TypeError("chainlinkVrf must be boolean.");
  const useVrf = input.chainlinkVrf ?? false;
  const future = input.futureBlockReveal ?? !useVrf;
  if (useVrf && future) throw new RangeError("Choose Chainlink VRF or future block hashes.");
  const delay = uint(input.futureBlockDelay, future ? 1n : 0n, "futureBlockDelay", (1n << 32n) - 1n);
  if ((future && delay === 0n) || (!future && delay !== 0n)) throw new RangeError("Future reveal and delay must agree.");
  const source = normalizedAddress(input.source, ZERO_ADDRESS, "source");
  const sourceGas = uint(input.sourceGas, source === ZERO_ADDRESS || useVrf ? 0n : 100_000n, "sourceGas", (1n << 32n) - 1n);
  if (useVrf && (source === ZERO_ADDRESS || sourceGas !== 0n)) throw new RangeError("Chainlink VRF needs an adapter address and no static-call gas budget.");
  if (!useVrf && (source === ZERO_ADDRESS) !== (sourceGas === 0n)) throw new RangeError("Source and its gas budget must both be enabled or disabled.");
  return Object.freeze({ useVrf, lockUntilReveal: transfers === "locked", futureBlockDelay: delay.toString(), sourceGas: sourceGas.toString(), source,
    transferStorage: storage === "full-seed" ? 1 : 0, mode: mode === "derived" ? 1 : 0 });
}

/** Queue/reward randomness uses the same delayed-block defaults as creator seeds. */
export function buildKeelMintRewardSeedProfile(input: {
  readonly provider?: Address;
  readonly archive?: Address;
  readonly futureBlockDelay?: bigint | number;
}) {
  const provider = normalizedAddress(input.provider, ZERO_ADDRESS, "provider");
  const archive = normalizedAddress(input.archive, ZERO_ADDRESS, "archive");
  const shared = provider !== ZERO_ADDRESS;
  if (shared ? archive !== ZERO_ADDRESS : archive === ZERO_ADDRESS) throw new RangeError("Choose a seed provider or a block archive.");
  const profile = buildKeelCreatorSeedProfile({
    chainlinkVrf: shared, source: provider, futureBlockReveal: !shared,
    ...(input.futureBlockDelay === undefined ? {} : { futureBlockDelay: input.futureBlockDelay }),
  });
  return Object.freeze({ provider, archive, futureBlockDelay: profile.futureBlockDelay });
}

/** Decode a batch draw without losing the uint64 block number or its finalized bit. */
export function decodeKeelSeedDraw(draw: bigint) {
  if (typeof draw !== "bigint" || draw < 0n || draw >= (1n << 66n)) throw new RangeError("Invalid seed draw.");
  const target = draw & ((1n << 64n) - 1n);
  const vrf = (draw & (1n << 65n)) !== 0n;
  if ((vrf && target !== 0n) || (!vrf && target === 0n && draw !== 0n)) throw new RangeError("Invalid draw state.");
  return Object.freeze({ vrf, future: target !== 0n, firstBlock: target, secondBlock: target === 0n ? 0n : target + 1n,
    revealed: draw === 0n || (draw & (1n << 64n)) !== 0n });
}

export interface KeelCreator721ConfigInput {
  readonly name: string;
  readonly symbol: string;
  readonly maxSupply: bigint | number;
  readonly royaltyReceiver?: Address;
  readonly royaltyBps?: bigint | number;
  readonly metadataDigest: Hex;
}

export interface KeelCreator1155ConfigInput {
  readonly name: string;
  readonly symbol: string;
  readonly royaltyReceiver?: Address;
  readonly royaltyBps?: bigint | number;
  readonly metadataDigest: Hex;
}

export interface NormalizedKeelCreator721Config {
  readonly name: string;
  readonly symbol: string;
  readonly maxSupply: bigint;
  readonly royaltyReceiver: Address;
  readonly royaltyBps: bigint;
  readonly metadataDigest: Hex;
}

export type NormalizedKeelCreator1155Config = Omit<NormalizedKeelCreator721Config, "maxSupply">;

export type KeelCreatorCollectionOperation =
  | {
      readonly kind: "dedicated-erc721";
      readonly implementation?: "erc721a" | "erc721";
      readonly seedProfile?: KeelCreatorSeedProfileInput;
      readonly config: KeelCreator721ConfigInput;
    }
  | { readonly kind: "dedicated-erc1155"; readonly config: KeelCreator1155ConfigInput }
  | { readonly kind: "shared-erc1155"; readonly name: string; readonly metadataDigest: Hex }
  | { readonly kind: "external"; readonly tokenContract: Address; readonly name: string; readonly metadataDigest: Hex };

export interface KeelCreatorCollectionCallInput {
  readonly chainId: number;
  readonly creator: Address;
  readonly factoryAddress: Address;
  readonly operation: KeelCreatorCollectionOperation;
}

export interface KeelCreatorCollectionReviewInput {
  readonly chainId: number;
  readonly creator: Address;
  readonly instance?: string;
  readonly operation: KeelCreatorCollectionOperation;
}

export interface KeelCreatorDeploymentPair {
  readonly chainId: number;
  readonly instance: string;
  readonly factoryAddress: Address;
  readonly rendererAddress: Address;
}

export interface KeelCreatorDeploymentRecord {
  readonly module: string;
  readonly chainId: number;
  readonly instance: string;
  readonly contract: string;
  readonly address: Address;
}

function checkedText(value: string, maximum: number, label: string): string {
  const length = new TextEncoder().encode(value).length;
  if (length === 0 || length > maximum) {
    throw new RangeError(`${label} must contain between 1 and ${maximum} UTF-8 bytes.`);
  }
  return value;
}

function normalizedCommon(input: KeelCreator1155ConfigInput): NormalizedKeelCreator1155Config {
  const name = checkedText(input.name, MAX_NAME_BYTES, "name");
  const symbol = checkedText(input.symbol, MAX_SYMBOL_BYTES, "symbol");
  const royaltyReceiver = normalizedAddress(input.royaltyReceiver, ZERO_ADDRESS, "royaltyReceiver");
  const royaltyBps = uint(input.royaltyBps, 0n, "royaltyBps", UINT96_MAX);
  const metadataDigest = normalizedBytes32(input.metadataDigest, ZERO_BYTES32, "metadataDigest");
  if (royaltyBps > 10_000n) throw new RangeError("royaltyBps cannot exceed 10000.");
  if (royaltyBps !== 0n && royaltyReceiver === ZERO_ADDRESS) {
    throw new TypeError("royaltyReceiver is required when royaltyBps is non-zero.");
  }
  if (metadataDigest === ZERO_BYTES32) throw new TypeError("metadataDigest cannot be zero.");
  return Object.freeze({ name, symbol, royaltyReceiver, royaltyBps, metadataDigest });
}

export function buildKeelCreator721Config(
  input: KeelCreator721ConfigInput,
): NormalizedKeelCreator721Config {
  const common = normalizedCommon(input);
  const maxSupply = uint(input.maxSupply, 0n, "maxSupply");
  if (maxSupply === 0n) throw new RangeError("maxSupply must be greater than zero.");
  return Object.freeze({ ...common, maxSupply });
}

export function buildKeelCreator1155Config(
  input: KeelCreator1155ConfigInput,
): NormalizedKeelCreator1155Config {
  return normalizedCommon(input);
}

function canonical721(config: NormalizedKeelCreator721Config): Readonly<Record<string, string>> {
  return Object.freeze({
    name: config.name,
    symbol: config.symbol,
    maxSupply: config.maxSupply.toString(),
    royaltyReceiver: config.royaltyReceiver,
    royaltyBps: config.royaltyBps.toString(),
    metadataDigest: config.metadataDigest,
  });
}

function canonical1155(config: NormalizedKeelCreator1155Config): Readonly<Record<string, string>> {
  return Object.freeze({
    name: config.name,
    symbol: config.symbol,
    royaltyReceiver: config.royaltyReceiver,
    royaltyBps: config.royaltyBps.toString(),
    metadataDigest: config.metadataDigest,
  });
}

/**
 * Builds the exact, JSON-safe KeelCreatorFactory call for review. This does not
 * encode calldata, inspect a chain, request a signature, or submit anything.
 */
export function buildKeelCreatorCollectionCall(input: KeelCreatorCollectionCallInput) {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new RangeError("chainId must be a positive safe integer.");
  const creator = normalizedAddress(input.creator, ZERO_ADDRESS, "creator");
  const factoryAddress = normalizedAddress(input.factoryAddress, ZERO_ADDRESS, "factoryAddress");
  if (creator === ZERO_ADDRESS) throw new TypeError("creator cannot be zero.");
  if (factoryAddress === ZERO_ADDRESS) throw new TypeError("factoryAddress cannot be zero.");

  let functionName: "createSeededERC721" | "createERC721" | "createStandardERC721" | "createERC1155" | "createSharedERC1155" | "registerExternalCollection";
  let args: readonly unknown[];
  switch (input.operation.kind) {
    case "dedicated-erc721":
      if (input.operation.seedProfile !== undefined) {
        if (input.operation.implementation === "erc721") throw new TypeError("Batch seed profiles require ERC721A.");
        functionName = "createSeededERC721";
        args = [canonical721(buildKeelCreator721Config(input.operation.config)), buildKeelCreatorSeedProfile(input.operation.seedProfile)];
        break;
      }
      functionName = input.operation.implementation === "erc721" ? "createStandardERC721" : "createERC721";
      args = [canonical721(buildKeelCreator721Config(input.operation.config))];
      break;
    case "dedicated-erc1155":
      functionName = "createERC1155";
      args = [canonical1155(buildKeelCreator1155Config(input.operation.config))];
      break;
    case "shared-erc1155": {
      const name = checkedText(input.operation.name, MAX_NAME_BYTES, "name");
      const metadataDigest = normalizedBytes32(input.operation.metadataDigest, ZERO_BYTES32, "metadataDigest");
      if (metadataDigest === ZERO_BYTES32) throw new TypeError("metadataDigest cannot be zero.");
      functionName = "createSharedERC1155";
      args = [name, metadataDigest];
      break;
    }
    case "external": {
      const tokenContract = normalizedAddress(input.operation.tokenContract, ZERO_ADDRESS, "tokenContract");
      const name = checkedText(input.operation.name, MAX_NAME_BYTES, "name");
      const metadataDigest = normalizedBytes32(input.operation.metadataDigest, ZERO_BYTES32, "metadataDigest");
      if (tokenContract === ZERO_ADDRESS) throw new TypeError("tokenContract cannot be zero.");
      if (metadataDigest === ZERO_BYTES32) throw new TypeError("metadataDigest cannot be zero.");
      functionName = "registerExternalCollection";
      args = [tokenContract, name, metadataDigest];
      break;
    }
  }

  return Object.freeze({
    schema: "keel.creator-collection-call@1" as const,
    status: "review-only" as const,
    chainId: input.chainId,
    from: creator,
    to: factoryAddress,
    valueWei: "0" as const,
    functionName,
    arguments: args,
    encoding: "KeelCreatorFactory ABI arguments; integer values are canonical decimal strings" as const,
    walletApproval: "required" as const,
    signing: "not-performed" as const,
    submission: "not-performed" as const,
    consequence: functionName === "createSeededERC721"
      ? "Creates a seeded ERC721A clone using the reviewed immutable reveal and transfer policy. Requires a v3 creator factory; no tokens are minted."
      : input.operation.kind === "external"
      ? "Registers an existing creator-controlled collection in the KEEL directory; it does not transfer ownership or imply mint compatibility."
      : "Creates one creator collection record and its selected compact dedicated clone or shared ERC-1155 namespace; it does not mint a token or create a sale.",
  });
}

/** Resolve only an unambiguous factory + concrete renderer pair. */
export function resolveKeelCreatorDeploymentRecords(
  records: readonly KeelCreatorDeploymentRecord[],
  chainId: number,
  instance?: string,
): { readonly status: "configured"; readonly deployment: KeelCreatorDeploymentPair } | { readonly status: "missing" | "ambiguous"; readonly issue: string } {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new RangeError("chainId must be a positive safe integer.");
  const candidates = new Map<string, { factoryAddresses: Set<Address>; rendererAddresses: Set<Address> }>();
  for (const deployment of records) {
    if (deployment.module !== "keel-die" || deployment.chainId !== chainId) continue;
    if (instance !== undefined && deployment.instance !== instance) continue;
    const entry = candidates.get(deployment.instance) ?? { factoryAddresses: new Set<Address>(), rendererAddresses: new Set<Address>() };
    if (deployment.contract === "KeelCreatorFactory") entry.factoryAddresses.add(normalizedAddress(deployment.address, ZERO_ADDRESS, "factoryAddress"));
    if (deployment.contract === "KeelArtifactTokenRenderer") entry.rendererAddresses.add(normalizedAddress(deployment.address, ZERO_ADDRESS, "rendererAddress"));
    candidates.set(deployment.instance, entry);
  }
  const conflicted = [...candidates.entries()].filter(([, entry]) => entry.factoryAddresses.size > 1 || entry.rendererAddresses.size > 1);
  if (conflicted.length > 0) return { status: "ambiguous", issue: `Chain ${chainId.toString()} has conflicting creator deployment records${instance === undefined ? "" : ` for instance ${instance}`}; no wallet action was prepared.` };
  const complete = [...candidates.entries()].filter(([, entry]) => entry.factoryAddresses.size === 1 && entry.rendererAddresses.size === 1);
  if (complete.length === 0) return { status: "missing", issue: `Chain ${chainId.toString()} has no recorded KeelCreatorFactory and KeelArtifactTokenRenderer pair${instance === undefined ? "" : ` for instance ${instance}`}.` };
  if (complete.length > 1) return { status: "ambiguous", issue: `Chain ${chainId.toString()} has multiple creator deployment pairs; select an exact instance before preparing a wallet action.` };
  const [resolvedInstance, deployment] = complete[0]!;
  const factoryAddress = [...deployment.factoryAddresses][0]!;
  const rendererAddress = [...deployment.rendererAddresses][0]!;
  return {
    status: "configured",
    deployment: Object.freeze({ chainId, instance: resolvedInstance, factoryAddress, rendererAddress }),
  };
}

/** Resolve from the durable generated SDK deployment registry. */
export function configuredKeelCreatorDeployment(
  chainId: number,
  instance?: string,
): ReturnType<typeof resolveKeelCreatorDeploymentRecords> {
  return resolveKeelCreatorDeploymentRecords(KEEL_DEPLOYMENTS, chainId, instance);
}

/**
 * Prepares from the durable SDK deployment registry. Missing or ambiguous
 * deployments stop safely before any wallet request is produced.
 */
export function prepareKeelCreatorCollectionReview(input: KeelCreatorCollectionReviewInput) {
  const configured = configuredKeelCreatorDeployment(input.chainId, input.instance);
  if (configured.status !== "configured") {
    return Object.freeze({
      schema: "keel.creator-collection-review@1" as const,
      status: "blocked" as const,
      code: configured.status === "missing" ? "creator-deployment-missing" as const : "creator-deployment-ambiguous" as const,
      chainId: input.chainId,
      issue: configured.issue,
      walletApproval: "not-requested" as const,
      signing: "not-performed" as const,
      submission: "not-performed" as const,
    });
  }
  return Object.freeze({
    schema: "keel.creator-collection-review@1" as const,
    status: "review-only" as const,
    deployment: configured.deployment,
    rendererReadbackRequired: true as const,
    caveat: "Before a wallet request is emitted, re-read KeelCreatorFactory.metadataRenderer and require an exact match with this recorded renderer address.",
    call: buildKeelCreatorCollectionCall({
      chainId: input.chainId,
      creator: input.creator,
      factoryAddress: configured.deployment.factoryAddress,
      operation: input.operation,
    }),
  });
}

/** Shared ERC-1155 ids reserve the high 128 bits for KEEL's logical collection. */
export function keelSharedTokenId(
  collectionId: bigint | number,
  itemIndex: bigint | number,
): bigint {
  const group = uint(collectionId, 0n, "collectionId", UINT128_MAX);
  const item = uint(itemIndex, 0n, "itemIndex", UINT128_MAX);
  if (group === 0n || item === 0n) throw new RangeError("collectionId and itemIndex must be positive.");
  return (group << ITEM_BITS) | item;
}

export function keelSharedCollectionIdOf(tokenId: bigint | number): bigint {
  return uint(tokenId, 0n, "tokenId") >> ITEM_BITS;
}

export function keelSharedItemIndexOf(tokenId: bigint | number): bigint {
  return uint(tokenId, 0n, "tokenId") & UINT128_MAX;
}
