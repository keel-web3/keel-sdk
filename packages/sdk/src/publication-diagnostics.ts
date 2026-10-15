/** Private callback only. Payloads can contain complete unpublished calldata.
 * Never log, publish, or forward them to another provider. */
export interface KeelPublicationDiagnosticEvent extends Readonly<Record<string, unknown>> {
  readonly kind: string;
  readonly stage: string;
}
export type KeelPublicationDiagnosticObserver = (event: KeelPublicationDiagnosticEvent) => void | Promise<void>;
function snapshot(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) { const result: unknown[] = []; seen.set(value, result); for (const item of value) result.push(snapshot(item, seen)); return result; }
  const result: Record<string, unknown> = {}; seen.set(value, result);
  const keys = value instanceof Error ? [...new Set(["name", "message", "stack", "cause", ...Object.getOwnPropertyNames(value)])] : Object.keys(value);
  for (const key of keys) { try { result[key] = snapshot(Reflect.get(value, key), seen); } catch { result[key] = "[unavailable property]"; } }
  return result;
}
/** A diagnostic consumer cannot alter simulation acceptance or replace the
 * original provider failure. Persistent consumers must flush before approval. */
export async function emitKeelPublicationDiagnostic(observer: KeelPublicationDiagnosticObserver | undefined, event: KeelPublicationDiagnosticEvent) {
  try { await observer?.(snapshot(event) as KeelPublicationDiagnosticEvent); } catch { /* Proof remains owned by validation. */ }
}
