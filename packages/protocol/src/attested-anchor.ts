// Shared cross-chain anchor constants. Proof generation and submission do not
// require a service report, workflow identity, or oracle response format.

export const ATTESTED_ANCHOR_FAMILY_ETHEREUM = 1;
export const ATTESTED_ANCHOR_FAMILY_TEZOS = 2;
export const ATTESTED_ANCHOR_FAMILY_BITCOIN = 3;

export const ATTESTED_ANCHOR_TRUST_CLASS_NATIVE = 1;
export const ATTESTED_ANCHOR_TRUST_CLASS_OPTIMISTIC = 2;
export const ATTESTED_ANCHOR_TRUST_CLASS_ATTESTED = 3;
export const ATTESTED_ANCHOR_TRUST_CLASS_CLIENT = 4;

export const ATTESTED_ANCHOR_STATUS = {
  none: 0,
  pending: 1,
  verified: 2,
  rejected: 3,
  cancelled: 4,
} as const;

export const ATTESTED_ANCHOR_DIGEST_KIND_DECODED_SHA256 = 0;
export const ATTESTED_ANCHOR_DIGEST_KIND_CHUNK_KECCAK256 = 1;

/** u32be interpretations of canonical network identifiers per family. */
export const ATTESTED_ANCHOR_NETWORKS = {
  tezosMainnet: 2047256432, // NetXdQprcVkpaWU -> 0x7a06a770
  tezosGhostnet: 2937611481, // NetXnHfVqm9iesp -> 0xaf1864d9
  bitcoinMainnet: 4190024665, // f9beb4d9
  bitcoinTestnet: 185665799, // 0b110907
  bitcoinSignet: 167890752, // 0a03cf40
} as const;
