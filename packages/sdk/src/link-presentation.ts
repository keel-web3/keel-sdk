import { KEEL_INLINE_PROTECTION_SHELL_ID } from "./shell-registry.js";
import { ZERO_ADDRESS, ZERO_BYTES32, type Address, type Hex } from "./types.js";
import { normalizedAddress, normalizedBytes32 } from "./validation.js";

export interface KeelLinkReadInput {
  readonly linkRegistry: Address;
  readonly linkId: Hex;
}

export interface KeelLinkPresentationInput extends KeelLinkReadInput {
  /** Omit for the canonical shell. Zero explicitly requests no viewer. */
  readonly shellId?: Hex;
}

function linkRead(input: KeelLinkReadInput) {
  const to = normalizedAddress(input.linkRegistry, ZERO_ADDRESS, "linkRegistry");
  const linkId = normalizedBytes32(input.linkId, ZERO_BYTES32, "linkId");
  if (to === ZERO_ADDRESS || linkId === ZERO_BYTES32) throw new TypeError("linkRegistry and linkId must be nonzero.");
  return { to, linkId };
}

/** The contract checks the stored locator scheme. Never replace a rejected
 * presentation read with an unchecked metadata getter or an HTTP fallback. */
export function buildKeelLinkPresentationCall(input: KeelLinkPresentationInput) {
  const { to, linkId } = linkRead(input);
  const shellId = normalizedBytes32(input.shellId ?? KEEL_INLINE_PROTECTION_SHELL_ID, ZERO_BYTES32, "shellId");
  return Object.freeze({
    schema: "keel.link-presentation-call@1" as const,
    to,
    functionName: "presentationURI" as const,
    functionSignature: "presentationURI(bytes32,bytes32)" as const,
    arguments: Object.freeze([linkId, shellId] as const),
  });
}

/** Request a raw immutable locator with no viewer. HTTPS/IPNS revert onchain;
 * the SDK does not accept a caller-supplied scheme as evidence of eligibility. */
export function buildKeelLinkURICall(input: KeelLinkReadInput) {
  const { to, linkId } = linkRead(input);
  return Object.freeze({
    schema: "keel.link-uri-call@1" as const,
    to,
    functionName: "linkURI" as const,
    functionSignature: "linkURI(bytes32)" as const,
    arguments: Object.freeze([linkId] as const),
  });
}
