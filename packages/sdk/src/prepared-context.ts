/** Current collection context ABI. No registration, source or composer authority
 * is inferred from a well-formed context. Every field is snapshotted. */
const HASH = /^0x[0-9a-f]{64}$/u;
function plain(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== keys.length || Reflect.ownKeys(value).some(key => typeof key !== "string" || !keys.includes(key))
      || Object.values(Object.getOwnPropertyDescriptors(value)).some(field => field.get || field.set || !field.enumerable)) throw new TypeError(`Invalid ${label}.`);
  return value as Record<string, unknown>;
}
export function validateKeelPreparedContext(value: unknown, chainId: number) {
  const context = plain(value, ["protocol", "chainId", "collection", "tokenId", "derivedTokenSeed", "manifestDigest"], "prepared context");
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || context.protocol !== "keel-context@1" || context.chainId !== String(chainId)
      || typeof context.collection !== "string" || !/^0x[0-9a-f]{40}$/u.test(context.collection) || /^0x0{40}$/u.test(context.collection)
      || typeof context.tokenId !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(context.tokenId) || context.tokenId.length > 78 || BigInt(context.tokenId) >= 1n << 256n
      || typeof context.derivedTokenSeed !== "string" || !HASH.test(context.derivedTokenSeed)
      || typeof context.manifestDigest !== "string" || !HASH.test(context.manifestDigest)) throw new TypeError("Invalid prepared context values.");
  return Object.freeze({ ...context });
}
