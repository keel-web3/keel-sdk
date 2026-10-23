/** Shared publication orchestration. Adapters own authenticated canonical reads,
 * locked/CAS writes and transaction validation; this runner never signs or sends.
 * Every effect is followed by a durable read, including a lost effect response. */
export const KEEL_PUBLICATION_ACTION_STEPS = ["reconcile", "repair-journal", "resume-storage", "renew-review", "confirm-publication", "prepare-transaction"] as const;
export type KeelPublicationActionStep = typeof KEEL_PUBLICATION_ACTION_STEPS[number];
export type KeelPublicationPrerequisite = "authentication" | "owner-wallet" | "selected-chain" | "wallet-capability" | "changed-output" | "chain-capacity" | "canonical-history" | "configuration" | "integrity";

export interface KeelPublicationActionIdentity {
  /** Creator + original project/release + selected chain + intended output.
   * Journal versions may advance; this identity must not silently change. */
  readonly identity: string;
  readonly actionId: string;
}
export type KeelPublicationActionState<T> = KeelPublicationActionIdentity & (
  | { readonly status: "advance"; readonly step: KeelPublicationActionStep; readonly checkpoint: string }
  | { readonly status: "wallet-approval-required"; readonly value: T }
  | { readonly status: "complete"; readonly value: T }
  | { readonly status: "pending"; readonly value: T; readonly retryAfterMs: number }
  | { readonly status: "prerequisite-required"; readonly value: T; readonly prerequisite: KeelPublicationPrerequisite }
);
export type KeelPublicationActionResult<T> = Exclude<KeelPublicationActionState<T>, { readonly status: "advance" }>;
export interface KeelPublicationActionAdapter<T> {
  readonly identity: KeelPublicationActionIdentity;
  /** Includes canonical receipt/replacement checks and current saved identity.
   * A missing hash never proves rejection, a refund, or unused funding. */
  readonly inspect: () => Promise<KeelPublicationActionState<T>>;
  /** Use actionId + step + checkpoint as the durable idempotency boundary.
   * Repairs preserve the original records and adopt only verified identities. */
  readonly advance: (step: KeelPublicationActionStep, checkpoint: string, actionId: string) => Promise<void>;
  readonly pending: (reason: "progress-pending" | "response-uncertain" | "bounded-work") => Promise<T>;
  /** Validate the real unsigned operation, exact owner/network/program/fees
   * and fresh proof before exposing a wallet request or approval handoff. */
  readonly validateApproval: (value: T) => void | Promise<void>;
  readonly recoverable: (error: unknown) => boolean;
  readonly signal?: AbortSignal;
  readonly maximumSteps?: number;
}

/** One action advances all recoverable classes rather than returning a manual
 * recovery instruction. Pending chain/security prerequisites remain explicit;
 * this runner cannot manufacture a transaction to hide a failed prerequisite. */
export async function advanceKeelPublicationAction<T>(adapter: KeelPublicationActionAdapter<T>): Promise<KeelPublicationActionResult<T>> {
  const maximum = adapter.maximumSteps ?? 16;
  if (!adapter.identity.identity || !adapter.identity.actionId || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 64) throw new TypeError("Invalid publication action identity or work bound.");
  const assertIdentity = (state: KeelPublicationActionState<T>) => {
    if (!state || state.identity !== adapter.identity.identity || state.actionId !== adapter.identity.actionId) throw new Error("The saved publication identity changed during the action. Its original activity is preserved.");
    if (!["advance", "wallet-approval-required", "complete", "pending", "prerequisite-required"].includes(state.status)) throw new TypeError("Invalid publication action state.");
    if (state.status === "advance" && (!KEEL_PUBLICATION_ACTION_STEPS.includes(state.step) || !state.checkpoint)) throw new TypeError("Invalid publication action checkpoint.");
    if (state.status === "pending" && (!Number.isSafeInteger(state.retryAfterMs) || state.retryAfterMs < 100 || state.retryAfterMs > 60_000)) throw new TypeError("Invalid publication continuation delay.");
  };
  const pending = async (reason: "progress-pending" | "response-uncertain" | "bounded-work"): Promise<KeelPublicationActionResult<T>> => ({ ...adapter.identity, status: "pending", value: await adapter.pending(reason), retryAfterMs: 1_500 });
  const attempted = new Set<string>();
  let uncertain: unknown;
  for (let index = 0; index < maximum; index++) {
    adapter.signal?.throwIfAborted();
    let state: KeelPublicationActionState<T>;
    try { state = await adapter.inspect(); }
    catch (error) {
      adapter.signal?.throwIfAborted();
      if (!adapter.recoverable(error)) throw error;
      // A failed read authorizes no mutation or wallet request. Reconcile again
      // within this same action once, then retain a resumable pending result.
      if (uncertain !== undefined) return pending("response-uncertain");
      uncertain = error; continue;
    }
    adapter.signal?.throwIfAborted(); assertIdentity(state);
    if (state.status !== "advance") {
      if (state.status === "wallet-approval-required") await adapter.validateApproval(state.value);
      adapter.signal?.throwIfAborted();
      return state;
    }
    const key = `${state.step}:${state.checkpoint}`;
    // Repeat requests/reloads may resume this checkpoint through a durable
    // adapter, but one invocation never repeats an uncertain effect blindly.
    if (attempted.has(key)) return pending(uncertain === undefined ? "progress-pending" : "response-uncertain");
    attempted.add(key);
    try { await adapter.advance(state.step, state.checkpoint, state.actionId); uncertain = undefined; }
    catch (error) {
      adapter.signal?.throwIfAborted();
      if (!adapter.recoverable(error)) throw error;
      uncertain = error;
    }
  }
  return pending("bounded-work");
}

/** Coalesce duplicate clicks/agent requests in one client. Server adapters also
 * enforce their existing cross-process locks and durable idempotency checks. */
export function createKeelPublicationActionFlight<T>() {
  const active = new Map<string, Promise<T>>();
  return (key: string, operation: () => Promise<T>): Promise<T> => {
    const current = active.get(key);
    if (current) return current;
    const result = Promise.resolve().then(operation);
    active.set(key, result);
    void result.finally(() => { if (active.get(key) === result) active.delete(key); }).catch(() => undefined);
    return result;
  };
}
