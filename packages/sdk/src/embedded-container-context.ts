/** Exact context emitted by the registered EVM binary-fragment presentation. */
const fields = ["protocol", "chainId", "collection", "tokenId", "derivedTokenSeed", "seedRegistry", "seedSetId", "seedSourceCollection", "seedSourceTokenId", "composerManager", "composerModuleId", "composerAddress", "composerRevision", "composerCodeHash", "containerTableHandle", "containerTableRevision", "containerTableObjectId", "containerTableDigest", "presentationDigest", "presentationDigestType"] as const;
export type KeelEmbeddedContainerContext = Readonly<Record<typeof fields[number], string>>;
export function validateKeelEmbeddedContainerContext(value: unknown, chainId: number): KeelEmbeddedContainerContext {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
      || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !(fields as readonly string[]).includes(key))
      || Object.values(Object.getOwnPropertyDescriptors(value)).some(field => field.get || field.set)) throw new TypeError("Invalid EVM Inline context fields.");
  const context = value as Record<string, unknown>;
  if (fields.some(key => typeof context[key] !== "string" || (context[key] as string).length > 160)) throw new TypeError("Invalid EVM Inline context values.");
  const result = context as Record<typeof fields[number], string>;
  const uint = (key: typeof fields[number], bits: number, nonzero: boolean) => {
    const text = result[key];
    if (!/^(?:0|[1-9][0-9]*)$/u.test(text) || text.length > 78) throw new TypeError(`Invalid EVM Inline ${key}.`);
    const number = BigInt(text);
    if (number >= 1n << BigInt(bits) || (nonzero && number === 0n)) throw new RangeError(`Invalid EVM Inline ${key}.`);
  };
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || result.protocol !== "keel-context@1" || result.chainId !== String(chainId)
      || result.presentationDigestType !== "keccak256:keel.evm-binary-fragment-presentation@1" || result.seedSourceTokenId !== result.tokenId) throw new TypeError("Wrong EVM Inline context protocol, chain, seed source or digest domain.");
  uint("chainId", 256, true); uint("tokenId", 256, false); uint("seedSourceTokenId", 256, false);
  uint("composerRevision", 64, true); uint("containerTableRevision", 64, true);
  for (const key of ["collection", "seedRegistry", "seedSourceCollection", "composerManager", "composerAddress"] as const) {
    if (!/^0x[0-9a-f]{40}$/iu.test(result[key]) || /^0x0{40}$/iu.test(result[key])) throw new TypeError(`Invalid EVM Inline ${key}.`);
  }
  for (const key of ["derivedTokenSeed", "seedSetId", "composerModuleId", "composerCodeHash", "containerTableHandle", "containerTableObjectId", "containerTableDigest", "presentationDigest"] as const) {
    if (!/^0x[0-9a-f]{64}$/u.test(result[key]) || (key !== "derivedTokenSeed" && /^0x0{64}$/u.test(result[key]))) throw new TypeError(`Invalid EVM Inline ${key}.`);
  }
  // The EVM validates the typed presentation commitment. The shell separately
  // replays the exact packtable SHA and all stored/decoded/member commitments.
  return Object.freeze({ ...result });
}
