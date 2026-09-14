import { encodeFunctionData, type Address, type Hex } from "viem";
import { ABIS } from "./abis/keel-mint-access.generated.js";
import { normalizedAddress } from "./validation.js";

type Integer = bigint | number | string;

export interface KeelERC1155BatchMintItem {
  readonly target: string;
  readonly tokenId: Integer;
  readonly routeId: Integer;
  readonly quantity: Integer;
  readonly allocationId: string;
  readonly data?: string;
}

function integer(value: Integer, bits: number, field: string, minimum = 1n): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new RangeError(`${field} must be a safe integer.`);
  if (typeof value === "string" && !/^[0-9]+$/u.test(value)) throw new TypeError(`${field} must be a decimal integer.`);
  const parsed = BigInt(value);
  if (parsed < minimum || parsed >= (1n << BigInt(bits))) throw new RangeError(`${field} must fit uint${bits} and be at least ${minimum}.`);
  return parsed;
}

function nonzeroAddress(value: string, field: string): Address {
  const result = normalizedAddress(value as Address, "0x0000000000000000000000000000000000000000", field) as Address;
  if (/^0x0{40}$/u.test(result)) throw new RangeError(`${field} cannot be zero.`);
  return result;
}

/** Prepares a call for an approved controller contract. Does not quote a sale, sign or submit a mint. */
export function buildKeelERC1155BatchMintCall(input: {
  readonly routeRegistryAddress: string;
  readonly recipient: string;
  readonly mode: "reserved" | "immediate";
  readonly items: readonly KeelERC1155BatchMintItem[];
}) {
  if (input.mode !== "reserved" && input.mode !== "immediate") throw new TypeError("Unknown batch mint mode.");
  if (input.items.length === 0) throw new RangeError("A mint batch needs at least one item.");
  const to = nonzeroAddress(input.routeRegistryAddress, "routeRegistryAddress");
  const recipient = nonzeroAddress(input.recipient, "recipient");
  const items = input.items.map(item => {
    const target = nonzeroAddress(item.target, "target");
    const allocationId = item.allocationId.toLowerCase();
    if (!/^0x[0-9a-f]{64}$/u.test(allocationId) || /^0x0{64}$/u.test(allocationId)) throw new TypeError("allocationId must be a nonzero bytes32.");
    const data = item.data ?? "0x";
    if (!/^0x(?:[0-9a-fA-F]{2})*$/u.test(data)) throw new TypeError("data must contain whole hexadecimal bytes.");
    return {
      target,
      tokenId: integer(item.tokenId, 256, "tokenId", 0n),
      routeId: integer(item.routeId, 256, "routeId"),
      quantity: integer(item.quantity, 256, "quantity"),
      allocationId: allocationId as Hex,
      data: data as Hex,
    };
  }).sort((a, b) => a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0);
  const target = items[0]!.target;
  const routeIds = new Set<bigint>();
  for (let i = 0; i < items.length; ++i) {
    const item = items[i]!;
    if (item.target !== target) throw new RangeError("One native batch must use one ERC1155 contract.");
    if (i !== 0 && item.tokenId === items[i - 1]!.tokenId) throw new RangeError("Duplicate token IDs must use a single-item mint.");
    if (routeIds.has(item.routeId)) throw new RangeError("A route cannot appear twice in a batch.");
    routeIds.add(item.routeId);
  }
  const functionName = input.mode === "reserved" ? "mintReservedBatch" : "mintUnreservedBatch";
  const data = encodeFunctionData({
    abi: ABIS.KeelMintRouteRegistry,
    functionName,
    args: [recipient, items.map(({ data, routeId, quantity, allocationId }) => ({ data, routeId, quantity, allocationId }))],
  });
  return Object.freeze({
    schema: "keel.erc1155-batch-mint@1" as const,
    status: "review-only" as const,
    execution: "approved-controller-only" as const,
    mode: input.mode,
    target,
    recipient,
    items: Object.freeze(items.map(item => Object.freeze({ ...item, tokenId: item.tokenId.toString(), routeId: item.routeId.toString(), quantity: item.quantity.toString() }))),
    call: Object.freeze({ to, data, value: "0x0" as Hex }),
  });
}
