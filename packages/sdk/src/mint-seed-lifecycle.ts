import { decodeFunctionResult, encodeFunctionData, getAddress, numberToHex, type Abi, type Address, type Hex } from "viem";
import { moduleAbi } from "./abis.js";
import { decodeKeelSeedDraw } from "./creator-collections.js";

const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_BATCH_ID = (1n << 32n) - 3n;
const ZERO = "0x0000000000000000000000000000000000000000";

type ExactUint = bigint | string;
function integer(value: ExactUint, label: string, maximum = MAX_UINT256): bigint {
  if (typeof value !== "bigint" && (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value))) {
    throw new TypeError(`${label} must be bigint or canonical unsigned decimal text.`);
  }
  const result = BigInt(value);
  if (result < 0n || result > maximum) throw new RangeError(`${label} is out of range.`);
  return result;
}
function address(value: Address): Address {
  const result = getAddress(value);
  if (result === ZERO) throw new RangeError("A nonzero contract or wallet address is required.");
  return result;
}
function chain(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("Invalid chain ID.");
  return value;
}
const abiFor = async (name: string) => await moduleAbi("keel-die", name) as Abi;

export type KeelSeedAction =
  | { readonly kind: "buy-credits"; readonly adapter: Address; readonly quantity: ExactUint; readonly priceWei: ExactUint }
  | { readonly kind: "request"; readonly adapter: Address; readonly collection: Address; readonly batchId: ExactUint }
  | { readonly kind: "reveal"; readonly collection: Address; readonly batchId: ExactUint }
  | { readonly kind: "deliver"; readonly adapter: Address; readonly requestId: ExactUint };

/** Produces one reviewable call. Prices and eligibility must be refreshed before wallet submission. */
export async function buildKeelSeedAction(input: { readonly chainId: number; readonly from: Address; readonly action: KeelSeedAction }) {
  const chainId = chain(input.chainId), from = address(input.from), action = input.action;
  let to: Address, functionName: string, args: readonly unknown[], value = 0n, consequence: string;
  switch (action.kind) {
    case "buy-credits": {
      to = address(action.adapter);
      const quantity = integer(action.quantity, "quantity"), price = integer(action.priceWei, "priceWei");
      if (quantity === 0n || price === 0n || quantity > MAX_UINT256 / price) throw new RangeError("Invalid credit payment.");
      value = quantity * price;
      functionName = "buyClaims"; args = [quantity, price];
      consequence = "Buy personal request credits; payment goes to the program treasury. This does not fund its Chainlink subscription.";
      break;
    }
    case "request":
      to = address(action.adapter); functionName = "request";
      args = [address(action.collection), integer(action.batchId, "batchId", MAX_BATCH_ID)];
      consequence = "Request randomness for this existing batch; a prepaid program consumes one of the sending wallet's credits.";
      break;
    case "reveal":
      to = address(action.collection); functionName = "revealSeedBatch";
      args = [integer(action.batchId, "batchId", MAX_BATCH_ID)];
      consequence = "Finalize this batch using its original committed randomness.";
      break;
    case "deliver": {
      to = address(action.adapter); functionName = "deliver";
      const requestId = integer(action.requestId, "requestId", MAX_UINT256 - 1n);
      if (requestId === 0n) throw new RangeError("A request ID is required.");
      args = [requestId]; consequence = "Deliver the stored random result without buying another request.";
      break;
    }
    default: throw new TypeError("Unknown seed action.");
  }
  const abi = await abiFor(action.kind === "reveal" ? "KeelCreatorSeeded721A" : "KeelSeedVrfAdapter");
  const call = Object.freeze({ to, data: encodeFunctionData({ abi, functionName, args }), value: numberToHex(value) });
  return Object.freeze({ schema: "keel.seed-action@1" as const, status: "review-only" as const,
    chainId, from, action: action.kind, call, consequence, signing: "not-performed" as const, submission: "not-performed" as const });
}

export interface KeelSeedSnapshot {
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
}
export interface KeelSeedReadCall extends KeelSeedSnapshot {
  readonly to: Address;
  readonly data: Hex;
}
export type KeelSeedPhase = "revealed" | "waiting-blocks" | "history-required" | "unrequested" | "waiting-vrf" | "ready-to-reveal";
export interface KeelSeedStatus {
  readonly snapshot: KeelSeedSnapshot;
  readonly collection: Address;
  readonly tokenId: string;
  readonly batchId: string;
  readonly phase: KeelSeedPhase;
  readonly entropy: "immediate" | "future-blocks" | "vrf";
  readonly pendingTransfers: "locked" | "allowed";
  readonly seed?: Hex;
  readonly revealAfterBlock?: string;
  readonly adapter?: Address;
  readonly requestId?: string;
  readonly funding?: "personal-credits" | "creator-subscription";
  readonly requestEligibility?: "eligible" | "needs-credits" | "not-authorized" | "collection-disabled";
  readonly credits?: string;
  readonly creditPriceWei?: string;
}

/**
 * Reads one coherent chain snapshot. The transport must use the supplied chain and
 * blockHash (EIP-1898 requireCanonical); blockNumber must belong to that same hash.
 * Reverts and transport failures propagate instead of masquerading as pending state.
 */
export async function readKeelSeedStatus(
  input: { readonly collection: Address; readonly tokenId: ExactUint; readonly account: Address; readonly snapshot: KeelSeedSnapshot },
  call: (request: KeelSeedReadCall) => Promise<Hex>,
): Promise<KeelSeedStatus> {
  const collection = address(input.collection), account = address(input.account);
  const tokenId = integer(input.tokenId, "tokenId");
  const snapshot = Object.freeze({ ...input.snapshot, chainId: chain(input.snapshot.chainId) });
  if (typeof snapshot.blockNumber !== "bigint") throw new TypeError("blockNumber must be bigint.");
  integer(snapshot.blockNumber, "blockNumber");
  if (!/^0x[0-9a-f]{64}$/i.test(snapshot.blockHash) || /^0x0{64}$/.test(snapshot.blockHash)) throw new TypeError("Invalid block hash.");
  const tokenAbi = await abiFor("KeelCreatorSeeded721A");
  const read = async (abi: Abi, to: Address, functionName: string, args: readonly unknown[] = []) => decodeFunctionResult({ abi, functionName,
    data: await call({ ...snapshot, to, data: encodeFunctionData({ abi, functionName, args }) }) });
  const [rawBatch, rawProfile] = await Promise.all([
    read(tokenAbi, collection, "seedBatchId", [tokenId]), read(tokenAbi, collection, "seedProfile"),
  ]);
  const batchId = integer(rawBatch as bigint, "batchId", MAX_BATCH_ID);
  const [useVrf, lock, delay, , source] = rawProfile as readonly [boolean, boolean, number, number, Address, number, number];
  const draw = decodeKeelSeedDraw(await read(tokenAbi, collection, "seedDraws", [batchId]) as bigint);
  if (useVrf !== draw.vrf || (!useVrf && (delay !== 0) !== draw.future)) throw new Error("Inconsistent seed policy and draw.");
  const base = { snapshot, collection, tokenId: tokenId.toString(), batchId: batchId.toString(),
    entropy: useVrf ? "vrf" as const : draw.future ? "future-blocks" as const : "immediate" as const,
    pendingTransfers: lock ? "locked" as const : "allowed" as const };
  if (draw.revealed) return Object.freeze({ ...base, phase: "revealed", seed: await read(tokenAbi, collection, "tokenSeed", [tokenId]) as Hex });
  if (!useVrf) {
    const future = { ...base, revealAfterBlock: draw.secondBlock.toString() };
    if (snapshot.blockNumber <= draw.secondBlock) return Object.freeze({ ...future, phase: "waiting-blocks" });
    const archive = address(await read(tokenAbi, collection, "blockArchive") as Address);
    const archiveAbi = await abiFor("KeelSeedBlockArchive");
    const hashes = await Promise.all([draw.firstBlock, draw.secondBlock].map(n => read(archiveAbi, archive, "hashOf", [n])));
    return Object.freeze({ ...future, phase: hashes.some(h => h === `0x${"00".repeat(32)}`) ? "history-required" : "ready-to-reveal" });
  }
  const adapter = address(source), vrfAbi = await abiFor("KeelSeedVrfAdapter");
  const requestId = await read(vrfAbi, adapter, "requests", [collection, batchId]) as bigint;
  if (requestId === MAX_UINT256) throw new Error("Incomplete VRF request state.");
  const vrf = { ...base, adapter, requestId: requestId.toString() };
  if (requestId !== 0n) {
    const [boundCollection, boundBatch, ready, delivered] = await read(vrfAbi, adapter, "deliveries", [requestId]) as readonly [Address, number, boolean, boolean, Hex];
    if (getAddress(boundCollection) !== collection || BigInt(boundBatch) !== batchId || delivered) throw new Error("Inconsistent VRF delivery binding.");
    return Object.freeze({ ...vrf, phase: ready ? "ready-to-reveal" : "waiting-vrf" });
  }
  const [prepaid, enabled] = await Promise.all([read(vrfAbi, adapter, "prepaid"), read(vrfAbi, adapter, "access", [collection])]);
  if (prepaid) {
    const [credits, price] = await Promise.all([read(vrfAbi, adapter, "claims", [account]), read(vrfAbi, adapter, "claimPriceWei")]);
    return Object.freeze({ ...vrf, phase: "unrequested", funding: "personal-credits", credits: String(credits), creditPriceWei: String(price),
      requestEligibility: ((enabled as bigint) & 1n) === 0n ? "collection-disabled" : credits === 0n ? "needs-credits" : "eligible" });
  }
  const [owner, flags] = await Promise.all([read(vrfAbi, adapter, "owner"), read(vrfAbi, adapter, "access", [account])]);
  return Object.freeze({ ...vrf, phase: "unrequested", funding: "creator-subscription",
    requestEligibility: ((enabled as bigint) & 1n) === 0n ? "collection-disabled" : getAddress(owner as Address) === account || ((flags as bigint) & 2n) !== 0n ? "eligible" : "not-authorized" });
}
