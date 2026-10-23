/**
 * Locked or adjustable KeelMintGate campaign limits.
 *
 * Every campaign is locked unless its creator chose the KeelCampaignControls plate as the
 * campaign's custom gate at creation. That choice and the list of adjustable fields live in the
 * gate's immutable customGateData, so a locked campaign can never become adjustable. The gate's
 * published maxSupply, maxPerWallet and time window stay the ceiling; adjustments only narrow or
 * restore within them. Use readKeelCampaignControls for the mode and readKeelEffectiveLimits for
 * the live terms a collector will actually meet.
 */
import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { AccessFlag, GateLogic, ZERO_ADDRESS, type CampaignConfig, type CampaignInput } from "./types.js";

export const keelCampaignLimitBits = {
  maxPerWallet: 1n << 0n,
  maxPerTransaction: 1n << 1n,
  maxSupply: 1n << 2n,
  startTime: 1n << 3n,
  endTime: 1n << 4n,
} as const;
export type KeelCampaignLimitField = keyof typeof keelCampaignLimitBits;
export const keelAdjustableLimitsMask = 31n;
/** ERC-165 id of IKeelCampaignControls (campaignControls ^ effectiveLimits ^ updateCampaignLimits). */
export const KEEL_CAMPAIGN_CONTROLS_INTERFACE_ID = "0xf8302e6b" as const;

/** Creation-time choice copy. Locked is the default and the recommendation. */
export const keelCampaignLimitModes = {
  locked: {
    id: "locked",
    label: "Locked: limits can never change (recommended)",
    badge: "Locked limits",
    detail: "Supply, wallet limit, price and schedule are fixed when the campaign is created. Nobody, including you, can change them later.",
    collectorDetail: "Supply, wallet limit, price and schedule were fixed at creation and can never change, not even by the creator.",
  },
  adjustable: {
    id: "adjustable",
    label: "Adjustable: you can change these limits later; collectors will see this",
    badge: "Adjustable limits",
    detail: "You may tighten the selected limits after launch, never past the published terms. Collectors see an Adjustable badge and every change is recorded onchain.",
    collectorDetail: "The creator chose at creation to keep control of the listed limits. They can only tighten or restore them within the published terms, and every change is recorded onchain. Price never changes.",
  },
} as const;
export type KeelCampaignLimitMode = keyof typeof keelCampaignLimitModes;

/** Each adjustable field, its bit, and the bound the contract enforces. Unit price is not adjustable. */
export const keelCampaignLimitControls = [
  { id: "maxPerWallet", label: "Per-wallet limit", bound: "Between 1 and the published per-wallet limit; it can be restored up to that limit." },
  { id: "maxPerTransaction", label: "Per-transaction limit", bound: "Between 1 and the published per-wallet limit." },
  { id: "maxSupply", label: "Supply", bound: "Only lowered, never below the number already minted, and never raised again." },
  { id: "startTime", label: "Start time", bound: "Only before the campaign opens, and never earlier than the published start." },
  { id: "endTime", label: "End time", bound: "Only before the campaign ends, and never later than the published end." },
].map(control => ({ ...control, mask: keelCampaignLimitBits[control.id as KeelCampaignLimitField] })) as readonly {
  readonly id: KeelCampaignLimitField; readonly label: string; readonly bound: string; readonly mask: bigint;
}[];

export const keelCampaignControlsAbi = parseAbi([
  "struct LimitUpdate { uint64 maxPerWallet; uint64 maxPerTransaction; uint64 maxSupply; uint64 startTime; uint64 endTime; }",
  "struct EffectiveLimits { bool adjustable; uint256 adjustableMask; uint256 overriddenMask; address authority; address innerGate; uint64 maxSupply; uint64 maxPerWallet; uint64 maxPerTransaction; uint64 startTime; uint64 endTime; uint128 unitPrice; uint64 minted; uint64 accountMinted; uint64 mintableNow; bool paused; bool closed; bool open; }",
  "function gate() view returns (address)",
  "function campaignControls(bytes32 campaignId) view returns (bool adjustable, uint256 adjustableMask, address authority)",
  "function effectiveLimits(bytes32 campaignId, address account) view returns (EffectiveLimits)",
  "function updateCampaignLimits(bytes32 campaignId, uint256 fields, LimitUpdate next)",
  "function encodeConfiguration(uint256 adjustableMask, address innerGate, bytes innerConfiguration) pure returns (bytes)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "event CampaignLimitUpdated(bytes32 indexed campaignId, uint256 indexed field, uint256 previousValue, uint256 newValue, address indexed authority)",
  "error ZeroAddress()", "error Unauthorized()", "error CampaignClosed()", "error CampaignLocked()",
  "error InvalidLimitFields(uint256 fields)", "error FieldNotAdjustable(uint256 field)",
  "error LimitOutOfBounds(uint256 field, uint256 value)", "error CampaignAlreadyStarted()", "error CampaignAlreadyEnded()",
]);

const CONFIGURATION = [{ type: "uint256" }, { type: "address" }, { type: "bytes" }] as const;

export function keelCampaignLimitMask(fields: readonly KeelCampaignLimitField[]): bigint {
  let mask = 0n;
  for (const field of fields) {
    const bit = keelCampaignLimitBits[field];
    if (bit === undefined) throw new RangeError(`Unsupported adjustable limit: ${String(field)}.`);
    mask |= bit;
  }
  return mask;
}

export function keelCampaignLimitFields(mask: bigint): KeelCampaignLimitField[] {
  if (mask < 0n || (mask & ~keelAdjustableLimitsMask) !== 0n) throw new RangeError("mask contains unsupported limit bits.");
  return keelCampaignLimitControls.filter(control => (mask & control.mask) !== 0n).map(control => control.id);
}

/** Exact customGateData for an adjustable campaign; byte-identical to the contract's encodeConfiguration. */
export function encodeKeelCampaignControlsConfiguration(input: {
  readonly fields: readonly KeelCampaignLimitField[];
  readonly innerGate?: Address;
  readonly innerConfiguration?: Hex;
}): Hex {
  return encodeAbiParameters(CONFIGURATION, [
    keelCampaignLimitMask(input.fields),
    input.innerGate ? getAddress(input.innerGate) : zeroAddress,
    input.innerConfiguration ?? "0x",
  ]);
}

export function decodeKeelCampaignControlsConfiguration(data: Hex) {
  const [adjustableMask, innerGate, innerConfiguration] = decodeAbiParameters(CONFIGURATION, data);
  return { adjustableMask, innerGate, innerConfiguration, fields: keelCampaignLimitFields(adjustableMask) };
}

/**
 * Opt a campaign input into adjustable limits. A project gate already in the single custom slot
 * moves inside the plate as its inner gate; it then sees the plate, not KeelMintGate, as caller.
 * Any logic is refused when another access check could bypass the plate's verdict.
 */
export function withAdjustableCampaignLimits(
  input: CampaignInput,
  options: { readonly controls: Address; readonly fields: readonly KeelCampaignLimitField[] },
): CampaignInput {
  if (options.fields.length === 0) throw new RangeError("Choose at least one adjustable limit, or keep the campaign locked.");
  const controls = getAddress(options.controls);
  if (controls === ZERO_ADDRESS) throw new TypeError("controls must be the deployed KeelCampaignControls address.");
  const otherChecks = (input.merkleRoot !== undefined && BigInt(input.merkleRoot) !== 0n)
    || (input.gateToken !== undefined && getAddress(input.gateToken) !== ZERO_ADDRESS);
  if (input.gateLogic === GateLogic.Any && otherChecks) {
    throw new TypeError("Adjustable limits need All gate logic when Merkle or token gates are also configured.");
  }
  const inner = input.customGate !== undefined && getAddress(input.customGate) !== ZERO_ADDRESS ? getAddress(input.customGate) : undefined;
  if (inner === controls) throw new TypeError("This campaign input already names the controls plate.");
  return {
    ...input,
    customGate: controls,
    customGateData: encodeKeelCampaignControlsConfiguration({
      fields: options.fields,
      ...(inner ? { innerGate: inner, innerConfiguration: input.customGateData ?? "0x" } : {}),
    }),
  };
}

export interface KeelCampaignControlsSummary {
  readonly mode: KeelCampaignLimitMode;
  readonly adjustableMask: bigint;
  readonly fields: readonly KeelCampaignLimitField[];
  readonly authority: Address | null;
  readonly label: string;
  readonly badge: string;
  readonly detail: string;
}

export function describeKeelCampaignControls(
  adjustable: boolean,
  adjustableMask: bigint,
  authority: Address | null = null,
): KeelCampaignControlsSummary {
  const mode: KeelCampaignLimitMode = adjustable && adjustableMask !== 0n ? "adjustable" : "locked";
  const fields = mode === "adjustable" ? keelCampaignLimitFields(adjustableMask) : [];
  const copy = keelCampaignLimitModes[mode];
  const names = fields.map(field => keelCampaignLimitControls.find(control => control.id === field)!.label.toLowerCase());
  return {
    mode,
    adjustableMask: mode === "adjustable" ? adjustableMask : 0n,
    fields,
    authority,
    label: copy.label,
    badge: copy.badge,
    detail: mode === "adjustable" ? `The creator can change: ${names.join(", ")}. ${copy.collectorDetail}` : copy.collectorDetail,
  };
}

/**
 * Offline mode from a campaign's own terms. Without a known plate address, a campaign naming any
 * custom gate cannot be proven locked or adjustable, so this returns null rather than guessing.
 */
export function keelCampaignControlsFromConfig(
  config: Pick<CampaignConfig, "customGate" | "customGateData" | "accessFlags" | "gateLogic">,
  controls?: Address,
): KeelCampaignControlsSummary | null {
  if ((config.accessFlags & AccessFlag.CustomGate) === 0 || getAddress(config.customGate) === ZERO_ADDRESS) {
    return describeKeelCampaignControls(false, 0n);
  }
  if (!controls) return null;
  if (getAddress(config.customGate) !== getAddress(controls)) return describeKeelCampaignControls(false, 0n);
  const binding = config.gateLogic === GateLogic.All || config.accessFlags === AccessFlag.CustomGate;
  try {
    const { adjustableMask } = decodeKeelCampaignControlsConfiguration(config.customGateData);
    return describeKeelCampaignControls(binding, adjustableMask);
  } catch {
    return describeKeelCampaignControls(false, 0n);
  }
}

type Reader = Pick<PublicClient, "readContract" | "getBlockNumber">;

/** The one cheap onchain question: locked or adjustable, which fields, and who may adjust. */
export async function readKeelCampaignControls(client: Reader, controls: Address, campaignId: Hex) {
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const [adjustable, adjustableMask, authority] = await client.readContract({
    address: getAddress(controls), abi: keelCampaignControlsAbi, functionName: "campaignControls", args: [campaignId], blockNumber,
  }) as readonly [boolean, bigint, Address];
  return { ...describeKeelCampaignControls(adjustable, adjustableMask, authority), blockNumber };
}

/** Live terms in one call. mintableNow excludes Merkle allowances and signed quotas. */
export async function readKeelEffectiveLimits(client: Reader, controls: Address, campaignId: Hex, account: Address = zeroAddress) {
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const limits = await client.readContract({
    address: getAddress(controls), abi: keelCampaignControlsAbi, functionName: "effectiveLimits", args: [campaignId, getAddress(account)], blockNumber,
  }) as {
    adjustable: boolean; adjustableMask: bigint; overriddenMask: bigint; authority: Address; innerGate: Address;
    maxSupply: bigint; maxPerWallet: bigint; maxPerTransaction: bigint; startTime: bigint; endTime: bigint; unitPrice: bigint;
    minted: bigint; accountMinted: bigint; mintableNow: bigint; paused: boolean; closed: boolean; open: boolean;
  };
  return {
    ...limits,
    controls: describeKeelCampaignControls(limits.adjustable, limits.adjustableMask, limits.authority),
    adjustedFields: keelCampaignLimitFields(limits.overriddenMask),
    blockNumber,
  };
}

export type KeelCampaignLimitChanges = Partial<Record<KeelCampaignLimitField, bigint | number>>;

/** Unsigned updateCampaignLimits call for the campaign authority's wallet. Bounds are enforced onchain. */
export function buildKeelCampaignLimitUpdate(controls: Address, campaignId: Hex, changes: KeelCampaignLimitChanges) {
  const fields = Object.keys(changes) as KeelCampaignLimitField[];
  const mask = keelCampaignLimitMask(fields);
  if (mask === 0n) throw new RangeError("Name at least one limit to change.");
  const value = (field: KeelCampaignLimitField) => {
    const raw = changes[field];
    if (raw === undefined) return 0n;
    const next = BigInt(raw);
    if (next < 0n || next >= 1n << 64n) throw new RangeError(`${field} must fit uint64.`);
    return next;
  };
  return {
    target: getAddress(controls),
    value: 0n,
    data: encodeFunctionData({
      abi: keelCampaignControlsAbi,
      functionName: "updateCampaignLimits",
      args: [campaignId, mask, {
        maxPerWallet: value("maxPerWallet"), maxPerTransaction: value("maxPerTransaction"), maxSupply: value("maxSupply"),
        startTime: value("startTime"), endTime: value("endTime"),
      }],
    }),
    fields,
    authorization: "campaign-authority" as const,
  };
}
