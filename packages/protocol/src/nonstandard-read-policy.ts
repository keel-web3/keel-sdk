import { canonicalJson } from "./canonical.js";

/** A compatibility target, not an ERC-721 limit or a provider capability. */
export const KEEL_STANDARD_TOKEN_URI_TARGET_BYTES = 2_000_000;
export const KEEL_STANDARD_TOKEN_URI_READ_GAS = 50_000_000n;

export interface KeelNonstandardReadIdentity {
  readonly chainId: number;
  readonly projectId: string;
  readonly revision: string;
  readonly defaultsRevision: string;
  readonly planDigest: string;
  readonly measurementDigest: string;
  readonly sourceDigest: string;
  readonly tokenUriDigest: string;
  readonly completeTokenUriBytes: number;
}
export interface KeelExplicitNonstandardReadPolicy {
  readonly schema: "keel-explicit-nonstandard-read@1";
  readonly identity: KeelNonstandardReadIdentity;
  readonly limits: {
    readonly maximumTokenUriBytes: number;
    /** Complete serialized JSON/hex ABI response, not only decoded URI bytes. */
    readonly maximumRpcResponseBytes: number;
    readonly maximumReadGas: string;
  };
  /** Exact display/review identity acknowledged by the caller. Not a signature. */
  readonly acknowledgementKey: string;
}
type PolicyInput = Pick<KeelExplicitNonstandardReadPolicy, "identity" | "limits">;
/** Unsigned preparation intent only. It cannot authorize simulation/signing of
 * an above-target result until its complete measured URI is acknowledged. */
export interface KeelTokenURIPreparationBudget {
  readonly schema: "keel-token-uri-preparation-budget@1";
  readonly chainId: number;
  readonly projectId: string;
  readonly revision: string;
  readonly defaultsRevision: string;
  readonly sourceDigest: string;
  readonly planDigest: string;
  readonly maximumTokenUriBytes: number;
  readonly maximumReadGas: string;
}
const exact = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError("Nonstandard read policy has invalid fields.");
  return value as Record<string, unknown>;
};
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const digest = (value: unknown): value is string => typeof value === "string" && /^(?:0x|sha256:)[0-9a-f]{64}$/u.test(value);

export function resolveKeelTokenURIPreparationBounds(budget?: KeelTokenURIPreparationBudget) {
  if (budget === undefined) return { maximumTokenUriBytes: KEEL_STANDARD_TOKEN_URI_TARGET_BYTES, maximumReadGas: KEEL_STANDARD_TOKEN_URI_READ_GAS };
  budget = structuredClone(budget);
  exact(budget, ["schema", "chainId", "projectId", "revision", "defaultsRevision", "sourceDigest", "planDigest", "maximumTokenUriBytes", "maximumReadGas"]);
  if (budget.schema !== "keel-token-uri-preparation-budget@1" || !count(budget.chainId) || !digest(budget.sourceDigest) || !digest(budget.planDigest)
    || !count(budget.maximumTokenUriBytes) || !Number.isSafeInteger(keelTokenURIRpcResponseBytes(budget.maximumTokenUriBytes))
    || typeof budget.maximumReadGas !== "string" || !/^[1-9][0-9]{0,77}$/u.test(budget.maximumReadGas) || BigInt(budget.maximumReadGas) >= 1n << 256n) throw new TypeError("Invalid unsigned tokenURI preparation budget.");
  for (const key of ["projectId", "revision", "defaultsRevision"] as const) if (typeof budget[key] !== "string" || !budget[key].length || budget[key].length > 256) throw new TypeError("Preparation budget requires its exact source/project/defaults revision.");
  return { maximumTokenUriBytes: budget.maximumTokenUriBytes, maximumReadGas: BigInt(budget.maximumReadGas), preparationReadBudget: Object.freeze({ ...budget }) };
}

/** Canonical ABI bytes plus JSON envelope headroom, using UTF-8 wire bytes. */
export function keelTokenURIRpcResponseBytes(uriBytes: number): number {
  if (!count(uriBytes)) throw new RangeError("Complete tokenURI byte bound must be a positive safe integer.");
  const size = 2 * (64 + Math.ceil(uriBytes / 32) * 32) + 4096;
  if (!Number.isSafeInteger(size)) throw new RangeError("TokenURI ABI/JSON byte bound exceeds safe memory accounting.");
  return size;
}

function fields(value: PolicyInput): PolicyInput {
  value = structuredClone(value);
  const identity = exact(value.identity, ["chainId", "projectId", "revision", "defaultsRevision", "planDigest", "measurementDigest", "sourceDigest", "tokenUriDigest", "completeTokenUriBytes"]);
  const limits = exact(value.limits, ["maximumTokenUriBytes", "maximumRpcResponseBytes", "maximumReadGas"]);
  if (!count(identity.chainId) || !count(identity.completeTokenUriBytes)
    || Number(identity.completeTokenUriBytes) <= KEEL_STANDARD_TOKEN_URI_TARGET_BYTES
      && !(typeof limits.maximumReadGas === "string" && /^[1-9][0-9]{0,77}$/u.test(limits.maximumReadGas) && BigInt(limits.maximumReadGas) >= KEEL_STANDARD_TOKEN_URI_READ_GAS)) throw new RangeError("Explicit nonstandard reads require an exact complete URI measurement, chain and above-target bytes or read-gas budget.");
  for (const key of ["projectId", "revision", "defaultsRevision"]) if (typeof identity[key] !== "string" || !(identity[key] as string).length || (identity[key] as string).length > 256) throw new TypeError("Nonstandard reads require the exact project, revision and defaults identity.");
  for (const key of ["planDigest", "measurementDigest", "sourceDigest", "tokenUriDigest"]) if (!digest(identity[key])) throw new TypeError("Nonstandard reads require exact lowercase SHA-256 commitments.");
  if (!count(limits.maximumTokenUriBytes) || Number(limits.maximumTokenUriBytes) < Number(identity.completeTokenUriBytes)
    || !count(limits.maximumRpcResponseBytes) || Number(limits.maximumRpcResponseBytes) < keelTokenURIRpcResponseBytes(Number(limits.maximumTokenUriBytes))) throw new RangeError("The actual reader/provider bounds must accommodate the complete URI and its ABI/JSON expansion.");
  if (typeof limits.maximumReadGas !== "string" || !/^[1-9][0-9]{0,77}$/u.test(limits.maximumReadGas) || BigInt(limits.maximumReadGas) >= 1n << 256n) throw new RangeError("Nonstandard reads require the actual positive read-gas bound.");
  return { identity: Object.freeze({ ...identity }) as unknown as KeelNonstandardReadIdentity,
    limits: Object.freeze({ ...limits }) as unknown as KeelExplicitNonstandardReadPolicy["limits"] };
}

/** Include this exact key in the warning acknowledgement; any changed bound,
 * source, plan, measurement, revision, defaults or chain requires a new key. */
export function keelNonstandardReadAcknowledgementKey(input: PolicyInput): string {
  return canonicalJson({ schema: "keel-explicit-nonstandard-read@1", ...fields(input) });
}
export function createKeelExplicitNonstandardReadPolicy(input: PolicyInput & { readonly acknowledgementKey: string }): KeelExplicitNonstandardReadPolicy {
  input = structuredClone(input);
  const normalized = fields(input);
  if (input.acknowledgementKey !== keelNonstandardReadAcknowledgementKey(normalized)) throw new TypeError("Nonstandard compatibility acknowledgement is missing or stale for the exact measured plan.");
  return Object.freeze({ schema: "keel-explicit-nonstandard-read@1", ...normalized, acknowledgementKey: input.acknowledgementKey });
}
export function resolveKeelTokenURIReadBounds(policy?: KeelExplicitNonstandardReadPolicy) {
  if (policy === undefined) return { maximumTokenUriBytes: KEEL_STANDARD_TOKEN_URI_TARGET_BYTES,
    maximumRpcResponseBytes: keelTokenURIRpcResponseBytes(KEEL_STANDARD_TOKEN_URI_TARGET_BYTES), maximumReadGas: KEEL_STANDARD_TOKEN_URI_READ_GAS };
  policy = structuredClone(policy);
  exact(policy, ["schema", "identity", "limits", "acknowledgementKey"]);
  if (policy.schema !== "keel-explicit-nonstandard-read@1") throw new TypeError("Unsupported nonstandard read policy.");
  const snapshot = createKeelExplicitNonstandardReadPolicy(policy);
  return { maximumTokenUriBytes: snapshot.limits.maximumTokenUriBytes, maximumRpcResponseBytes: snapshot.limits.maximumRpcResponseBytes,
    maximumReadGas: BigInt(snapshot.limits.maximumReadGas), nonstandardReadPolicy: snapshot };
}
/** Preparation may precede final URI measurement. Its budget is deliberately
 * insufficient at the full simulation and wallet boundaries. */
export function resolveKeelPreparationReadBounds(input: {
  readonly preparationReadBudget?: KeelTokenURIPreparationBudget;
  readonly nonstandardReadPolicy?: KeelExplicitNonstandardReadPolicy;
}): { maximumTokenUriBytes: number; maximumReadGas: bigint; maximumRpcResponseBytes?: number; nonstandardReadPolicy?: KeelExplicitNonstandardReadPolicy; preparationReadBudget?: KeelTokenURIPreparationBudget } {
  const budget = resolveKeelTokenURIPreparationBounds(input.preparationReadBudget);
  const read = input.nonstandardReadPolicy === undefined ? undefined : resolveKeelTokenURIReadBounds(input.nonstandardReadPolicy);
  if (budget.preparationReadBudget && read?.nonstandardReadPolicy) {
    for (const key of ["chainId", "projectId", "revision", "defaultsRevision", "sourceDigest", "planDigest"] as const) if (budget.preparationReadBudget[key] !== read.nonstandardReadPolicy.identity[key]) throw new TypeError("Nonstandard review changed the prepared project/source/defaults identity.");
    if (read.maximumTokenUriBytes > budget.maximumTokenUriBytes || read.maximumReadGas > budget.maximumReadGas) throw new RangeError("Nonstandard review exceeds its unsigned preparation budget.");
  }
  return { ...budget, ...(read ?? {}) };
}
/** Commitment check at complete-return boundaries. Policy grants no provider,
 * receipt, runtime, gas or simulation proof, and never bypasses decoder limits. */
export function assertKeelNonstandardTokenURIIdentity(policy: KeelExplicitNonstandardReadPolicy | undefined,
  actual: { readonly chainId?: number; readonly byteLength: number; readonly digest: string }): void {
  const bounds = resolveKeelTokenURIReadBounds(policy);
  if (actual.byteLength > bounds.maximumTokenUriBytes) throw new RangeError("Complete tokenURI exceeds the selected reader byte bound.");
  if (policy && ((actual.chainId !== undefined && policy.identity.chainId !== actual.chainId)
    || policy.identity.completeTokenUriBytes !== actual.byteLength || policy.identity.tokenUriDigest.replace(/^sha256:/u, "0x") !== actual.digest.replace(/^sha256:/u, "0x"))) throw new TypeError("Nonstandard read acknowledgement does not match the exact chain/complete URI commitment.");
}
