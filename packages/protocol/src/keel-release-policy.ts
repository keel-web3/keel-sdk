/** Canonical mint-release word shared by contract clients and collector presentations. */
export const KEEL_MAX_RELEASE_SUPPLY = (1n << 62n) - 1n;
const UINT64 = (1n << 64n) - 1n;
export type KeelReleaseMode = "fixed" | "adjustable" | "open";
export interface KeelReleasePolicy {
  readonly issued: bigint;
  readonly reserved: bigint;
  readonly limit: bigint;
  readonly ceiling: bigint;
  readonly mode: KeelReleaseMode;
  readonly locked: boolean;
  readonly canIncrease: boolean;
}
function integer(value: bigint | string | number): bigint {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0))
    throw new RangeError("Unsafe release integer.");
  if (typeof value === "string" && !/^(0|[1-9][0-9]*)$/u.test(value))
    throw new TypeError("Release integers use unsigned decimal text.");
  const result = BigInt(value);
  if (result < 0n) throw new RangeError("Negative release integer.");
  return result;
}
export function encodeKeelReleasePolicy(input: {
  readonly mode?: KeelReleaseMode;
  readonly limit?: bigint | string | number;
  readonly ceiling?: bigint | string | number;
}): bigint {
  const mode = input.mode ?? "fixed";
  if (!["fixed", "adjustable", "open"].includes(mode))
    throw new TypeError("Unknown release policy.");
  const limit = integer(
    input.limit ?? (mode === "open" ? KEEL_MAX_RELEASE_SUPPLY : 0n),
  );
  const ceiling = integer(
    input.ceiling ?? (mode === "fixed" ? limit : KEEL_MAX_RELEASE_SUPPLY),
  );
  if (
    limit === 0n ||
    limit > ceiling ||
    ceiling > KEEL_MAX_RELEASE_SUPPLY ||
    (mode === "fixed" && limit !== ceiling) ||
    (mode === "open" &&
      (limit !== KEEL_MAX_RELEASE_SUPPLY ||
        ceiling !== KEEL_MAX_RELEASE_SUPPLY))
  )
    throw new RangeError("Invalid release ceiling.");
  return (
    (limit << 128n) |
    (ceiling << 190n) |
    (BigInt(["fixed", "adjustable", "open"].indexOf(mode)) << 252n)
  );
}
export function decodeKeelReleasePolicy(
  value: bigint | string | number,
): KeelReleasePolicy {
  const word = integer(value);
  if (word >> 254n !== 0n)
    throw new RangeError("Reserved release bits must be zero.");
  const issued = word & UINT64;
  const reserved = (word >> 64n) & UINT64;
  const limit = (word >> 128n) & KEEL_MAX_RELEASE_SUPPLY;
  const ceiling = (word >> 190n) & KEEL_MAX_RELEASE_SUPPLY;
  const mode = (["fixed", "adjustable", "open"] as const)[Number(word >> 252n)];
  if (mode === undefined) throw new RangeError("Invalid release mode.");
  encodeKeelReleasePolicy({ mode, limit, ceiling });
  if (issued + reserved > limit)
    throw new RangeError("Release accounting exceeds its ceiling.");
  return Object.freeze({
    issued,
    reserved,
    limit,
    ceiling,
    mode,
    locked: mode === "fixed",
    canIncrease: mode !== "fixed" && limit < ceiling,
  });
}
/** The label describes the reported policy, never an audit or upgrade attestation. */
export function describeKeelReleasePolicy(
  value: bigint | string | number,
): readonly (readonly [string, string])[] {
  const p = decodeKeelReleasePolicy(value);
  return Object.freeze([
    ["Issued", p.issued.toString()],
    ["Reserved for sales", p.reserved.toString()],
    [
      "Supply policy",
      p.mode === "fixed"
        ? "Fixed maximum"
        : p.mode === "open"
          ? "Open issuance"
          : "Adjustable maximum",
    ],
    [
      "Current maximum",
      p.mode === "open"
        ? "Open · bounded by the token contract"
        : p.limit.toString(),
    ],
    [
      "Permanent maximum",
      p.ceiling === KEEL_MAX_RELEASE_SUPPLY
        ? "Implementation bound; token contract limit also applies"
        : p.ceiling.toString(),
    ],
    [
      "Can increase",
      p.canIncrease
        ? "Yes, by the collection authority"
        : "No under this policy",
    ],
    [
      "Policy lock",
      p.locked ? "Permanent in this router" : "Can be locked permanently",
    ],
  ] as const);
}
