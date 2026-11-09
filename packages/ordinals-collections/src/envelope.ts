export { envelope, parseOrdEnvelopes, ordIdValue, ordIdFromValue } from "./core.ts";

// Preserve the existing Node-facing decoder's Buffer byte-string API. The
// browser shell uses the same decoder directly from core.ts (Uint8Array).
import { decodeCbor as decode, cbor as encode } from "./core.ts";
export function decodeCbor(bytes) {
  const native = value => value instanceof Uint8Array ? Buffer.from(value)
    : Array.isArray(value) ? value.map(native)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,item]) => [key,native(item)]))
    : value;
  return native(decode(bytes));
}

export const cbor = value => Buffer.from(encode(value));
