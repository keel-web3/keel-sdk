/** Typed context emitted by the registered EVM fragment presentations. */
const fields = ["protocol", "chainId", "collection", "tokenId", "derivedTokenSeed", "seedRegistry", "seedSetId", "seedSourceCollection", "seedSourceTokenId", "composerManager", "composerModuleId", "composerAddress", "composerRevision", "composerCodeHash", "containerTableHandle", "containerTableRevision", "containerTableObjectId", "containerTableDigest", "presentationDigest", "presentationDigestType"] as const;
const minedFields = ["protocol", "chainId", "collection", "tokenId", "derivedTokenSeed", "seedSource", "seedProfileId", "composerManager", "composerModuleId", "composerAddress", "composerRevision", "composerCodeHash", "containerTableHandle", "containerTableRevision", "containerTableObjectId", "containerTableDigest", "presentationDigest", "presentationDigestType"] as const;
const creatorFields = ["protocol", "chainId", "collection", "tokenId", "composerAddress", "composerCodeHash", "composerRevision", "containerTableObjectId", "containerTableDigest", "presentationDigest", "presentationDigestType"] as const;
export type KeelCreatorPreparedContext = Readonly<Record<typeof creatorFields[number], string>>;
export type KeelEmbeddedContainerContext = Readonly<Record<typeof fields[number], string>>;
export type KeelEmbeddedMinedContainerContext = Readonly<Record<typeof minedFields[number], string>>;
export type KeelEmbeddedPresentationContext = KeelEmbeddedContainerContext | KeelEmbeddedMinedContainerContext | KeelCreatorPreparedContext;
export function validateKeelEmbeddedContainerContext(value: unknown, chainId: number): KeelEmbeddedPresentationContext {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
      || Object.values(Object.getOwnPropertyDescriptors(value)).some(field => field.get || field.set)) throw new TypeError("Invalid EVM Inline context fields.");
  const context = value as Record<string, unknown>;
  const creator = context.protocol === "keel-context@3";
  const mined = context.protocol === "keel-context@2";
  const selected = creator ? creatorFields : mined ? minedFields : fields;
  if (Object.keys(context).length !== selected.length || Object.keys(context).some(key => !(selected as readonly string[]).includes(key))
      || selected.some(key => typeof context[key] !== "string" || (context[key] as string).length > 160)) throw new TypeError("Invalid EVM Inline context values.");
  const result = context as Record<string, string>;
  const uint = (key: string, bits: number, nonzero: boolean) => {
    const text = result[key]!;
    if (!/^(?:0|[1-9][0-9]*)$/u.test(text) || text.length > 78) throw new TypeError(`Invalid EVM Inline ${key}.`);
    const number = BigInt(text);
    if (number >= 1n << BigInt(bits) || (nonzero && number === 0n)) throw new RangeError(`Invalid EVM Inline ${key}.`);
  };
  const domains = creator ? ["keccak256:keel.creator-prepared-copy-presentation@1"] : mined ? ["keccak256:keel.evm-mined-prepared-fragment-presentation@1"] : ["keccak256:keel.evm-binary-fragment-presentation@1", "keccak256:keel.evm-prepared-fragment-presentation@1"];
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || result.protocol !== (creator ? "keel-context@3" : mined ? "keel-context@2" : "keel-context@1") || result.chainId !== String(chainId)
      || !domains.includes(result.presentationDigestType!) || (!creator && (mined ? result.seedSource !== result.collection : result.seedSourceTokenId !== result.tokenId))) throw new TypeError("Wrong EVM Inline context protocol, chain, seed source or digest domain.");
  uint("chainId", 256, true); uint("tokenId", 256, false);
  if (!creator && !mined) uint("seedSourceTokenId", 256, false);
  uint("composerRevision", 64, true); if (!creator) uint("containerTableRevision", 64, true);
  const addresses = creator ? ["collection", "composerAddress"] : ["collection", "composerManager", "composerAddress", ...(mined ? ["seedSource"] : ["seedRegistry", "seedSourceCollection"])];
  for (const key of addresses) {
    if (!/^0x[0-9a-f]{40}$/iu.test(result[key]!) || /^0x0{40}$/iu.test(result[key]!)) throw new TypeError(`Invalid EVM Inline ${key}.`);
  }
  const hashes = creator ? ["composerCodeHash", "containerTableObjectId", "containerTableDigest", "presentationDigest"] : ["derivedTokenSeed", "composerModuleId", "composerCodeHash", "containerTableHandle", "containerTableObjectId", "containerTableDigest", "presentationDigest", mined ? "seedProfileId" : "seedSetId"];
  for (const key of hashes) {
    if (!/^0x[0-9a-f]{64}$/u.test(result[key]!) || (key !== "derivedTokenSeed" && /^0x0{64}$/u.test(result[key]!))) throw new TypeError(`Invalid EVM Inline ${key}.`);
  }
  // The EVM binds the typed commitment. The shell separately replays packtable and all byte commitments.
  return Object.freeze({ ...result }) as KeelEmbeddedPresentationContext;
}

/** Each context version has a distinct column count; absent provenance is never silently invented. */
export function unpackKeelEmbeddedContainerContext(values: unknown, chainId: number): KeelEmbeddedPresentationContext {
  if (!Array.isArray(values) || values.some(v => typeof v !== "string")) throw new TypeError("Invalid compact EVM context");
  const mined = values.length === minedFields.length - 3;
  const selected = mined ? minedFields : fields;
  if (values.length !== selected.length - 3) throw new TypeError("Invalid compact EVM context");
  let at = 0;
  const context = Object.fromEntries(selected.map(key => [key, key === "protocol" ? (mined ? "keel-context@2" : "keel-context@1") : key === "chainId" ? String(chainId) : key === "presentationDigestType" ? (mined ? "keccak256:keel.evm-mined-prepared-fragment-presentation@1" : "keccak256:keel.evm-prepared-fragment-presentation@1") : values[at++]]));
  return validateKeelEmbeddedContainerContext(context, chainId);
}
