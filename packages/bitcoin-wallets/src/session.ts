import { createSession } from "./accounts.js";
import type { BtcNet, BtcSession } from "./types.js";

export interface SessionIdentity {
  readonly walletId: string;
  readonly network: BtcNet;
  readonly ordinalsAddress: string;
  readonly paymentAddress: string;
}

export type Subscribe = (invalidate: () => void) => () => void;
export interface FocusTarget {
  addEventListener(type: "focus", listener: () => void): void;
  removeEventListener(type: "focus", listener: () => void): void;
}

export function sessionIdentity(session: BtcSession): SessionIdentity {
  if (!session || typeof session.walletId !== "string" || !session.walletId ||
      !["mainnet", "testnet3", "testnet4", "signet", "regtest"].includes(session.network) ||
      !session.ordinals?.address || !session.payment?.address) throw new Error("Invalid wallet identity");
  return Object.freeze({ walletId: session.walletId, network: session.network,
    ordinalsAddress: session.ordinals.address, paymentAddress: session.payment.address });
}
function same(a: SessionIdentity, b: SessionIdentity): boolean {
  return a.walletId === b.walletId && a.network === b.network &&
    a.ordinalsAddress === b.ordinalsAddress && a.paymentAddress === b.paymentAddress;
}
function snapshot(session: BtcSession): BtcSession {
  sessionIdentity(session);
  return createSession(session.walletId, session.network, [session.ordinals, session.payment]);
}

/** Xverse emits accountChange, networkChange and accountDisconnected; UniSat emits
 * accountsChanged, networkChanged and chainChanged. Other wallets use live reconciliation. */
export function subscribeWalletEvents(walletId: string, provider: {
  on(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
}): Subscribe {
  const events = walletId === "xverse" ? ["accountChange", "networkChange", "accountDisconnected"] :
    walletId === "unisat" ? ["accountsChanged", "networkChanged", "chainChanged"] : [];
  return (invalidate) => {
    for (const event of events) provider.on(event, invalidate);
    return () => { for (const event of events) provider.removeListener(event, invalidate); };
  };
}

export class WalletSessionGuard {
  private current: BtcSession | null = null;
  private generation = 0;
  private disposed = false;
  private readonly unsubscribe: (() => void)[];
  private readonly focus = () => { void this.reconcile().catch(() => {}); };
  constructor(private readonly options: {
    getLiveSession: () => Promise<BtcSession>;
    subscribe?: readonly Subscribe[];
    focusTarget?: FocusTarget;
    clear: () => void;
  }) {
    this.unsubscribe = (options.subscribe ?? []).map((subscribe) => subscribe(() => this.invalidate()));
    options.focusTarget?.addEventListener("focus", this.focus);
  }
  get session(): BtcSession | null { return this.current; }
  invalidate(): void {
    this.generation++;
    this.current = null;
    this.options.clear();
  }
  async connect(expected?: SessionIdentity): Promise<BtcSession> {
    if (this.disposed) throw new Error("Session guard disposed");
    const generation = ++this.generation;
    this.current = null;
    this.options.clear();
    try {
      const live = snapshot(await this.options.getLiveSession());
      if (this.disposed || generation !== this.generation) throw new Error("Wallet session changed");
      if (expected && !same(expected, sessionIdentity(live))) throw new Error("Wallet identity mismatch");
      this.current = live;
      return live;
    } catch (error) {
      if (generation === this.generation) this.invalidate();
      throw error;
    }
  }
  async reconcile(): Promise<BtcSession> {
    const current = this.current;
    const generation = this.generation;
    if (this.disposed || !current) throw new Error("Wallet session unavailable");
    try {
      const live = snapshot(await this.options.getLiveSession());
      if (this.disposed || generation !== this.generation || !same(sessionIdentity(current), sessionIdentity(live))) {
        throw new Error("Wallet session changed");
      }
      return current;
    } catch (error) {
      if (generation === this.generation) this.invalidate();
      throw error;
    }
  }
  async sign<T>(sign: (session: BtcSession) => Promise<T>): Promise<T> {
    const session = await this.reconcile();
    const generation = this.generation;
    if (this.disposed || this.current !== session) throw new Error("Wallet session changed");
    const result = await sign(session);
    if (generation !== this.generation || this.disposed) throw new Error("Wallet session changed");
    await this.reconcile();
    if (generation !== this.generation) throw new Error("Wallet session changed");
    return result;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidate();
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.options.focusTarget?.removeEventListener("focus", this.focus);
  }
}
