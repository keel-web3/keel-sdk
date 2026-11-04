import { describe, it, expect, vi } from "vitest";
import { createSession } from "../src/accounts.js";
import { WalletSessionGuard, sessionIdentity, subscribeWalletEvents } from "../src/session.js";

const account = (purpose: "ordinals" | "payment", address: string) => ({ purpose, address, addressType: "p2tr" as const, publicKey: "key" });
const session = (address = "a") => createSession("xverse", "testnet4", [account("ordinals", address), account("payment", "b")]);

describe("wallet session guard", () => {
  it("clears auth, UTXOs and PSBT on events and cleans listeners", async () => {
    const listeners = new Map<string, () => void>();
    const provider = { on: (e: string, f: () => void) => listeners.set(e, f), removeListener: (e: string) => listeners.delete(e) };
    const state = { auth: true, utxos: true, psbt: true };
    const guard = new WalletSessionGuard({ getLiveSession: async () => session(), subscribe: [subscribeWalletEvents("xverse", provider)], clear: () => { state.auth = state.utxos = state.psbt = false; } });
    await guard.connect(); state.auth = state.utxos = state.psbt = true;
    listeners.get("accountChange")!();
    expect(state).toEqual({ auth: false, utxos: false, psbt: false });
    expect(guard.session).toBeNull(); guard.dispose(); expect(listeners.size).toBe(0);
  });
  it("blocks signing after a silent account switch and accepts a matching live identity", async () => {
    let live = session(); const sign = vi.fn(async () => "signed");
    const guard = new WalletSessionGuard({ getLiveSession: async () => live, clear: () => {} });
    await guard.connect(sessionIdentity(live)); expect(await guard.sign(sign)).toBe("signed");
    live = session("other"); await expect(guard.sign(sign)).rejects.toThrow(); expect(sign).toHaveBeenCalledTimes(1);
  });
  it("refuses an in-flight signature after invalidation", async () => {
    let finish!: (value: string) => void;
    const guard = new WalletSessionGuard({ getLiveSession: async () => session(), clear: () => {} });
    await guard.connect();
    let started!: () => void; const ready = new Promise<void>((resolve) => { started = resolve; });
    const pending = guard.sign(() => { started(); return new Promise<string>((resolve) => { finish = resolve; }); });
    await ready; guard.invalidate(); finish("signed"); await expect(pending).rejects.toThrow();
  });
  it("reconciles on focus and removes focus listener", async () => {
    let listener: (() => void) | undefined; let live = session(); const clear = vi.fn();
    const target = { addEventListener: (_: "focus", f: () => void) => { listener = f; }, removeEventListener: (_: "focus", f: () => void) => { if (listener === f) listener = undefined; } };
    const guard = new WalletSessionGuard({ getLiveSession: async () => live, focusTarget: target, clear });
    await guard.connect(); live = session("other"); listener!();
    await vi.waitFor(() => expect(guard.session).toBeNull()); expect(clear).toHaveBeenCalled(); guard.dispose(); expect(listener).toBeUndefined();
  });
});
