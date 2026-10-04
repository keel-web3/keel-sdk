/** Inline means the tokenURI response itself contains the complete work. */
export function assertKeelInlineDeliveryProfile(profile: unknown = "embedded-assembled"): asserts profile is "embedded-assembled" {
  if (profile !== "embedded-assembled") throw new TypeError("Inline requires EVM-assembled embedded bytes. onchain-recursive is hybrid browser RPC delivery and cannot be prepared as Inline.");
}
