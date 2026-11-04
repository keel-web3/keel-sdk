import { describe, it, expect } from "vitest";
import { createSession, sharedAddressSession } from "../src/accounts.js";
import type { BtcAccount } from "../src/types.js";

const ordinal: BtcAccount = { address: "ord", addressType: "p2tr", publicKey: "key", purpose: "ordinals", bip32: { fingerprint: "1234", path: "m/1" } };
const payment: BtcAccount = { address: "pay", addressType: "p2wpkh", publicKey: "key2", purpose: "payment" };

describe("explicit account roles", () => {
  it("preserves shuffled roles and snapshots caller data", () => {
    const input = { ...ordinal, bip32: { ...ordinal.bip32! } };
    const session = createSession("xverse", "testnet4", [payment, input]);
    input.address = "changed"; input.bip32.path = "changed";
    expect(session.ordinals.address).toBe("ord");
    expect(session.ordinals.bip32!.path).toBe("m/1");
    expect(session.payment.address).toBe("pay");
    expect(Object.isFrozen(session.ordinals.bip32)).toBe(true);
  });
  it("maps a shared taproot address into separate immutable roles", () => {
    const { purpose: _, ...account } = ordinal;
    const session = sharedAddressSession("unisat", "mainnet", account);
    expect(session.sharedAddress).toBe(true);
    expect(session.ordinals).not.toBe(session.payment);
    expect(session.payment.purpose).toBe("payment");
    expect(Object.isFrozen(session)).toBe(true);
  });
  it("rejects bare strings, unknown, duplicate and missing roles", () => {
    for (const accounts of [["a", "b"], [{ ...ordinal, purpose: "other" }, payment], [ordinal, ordinal], [ordinal]]) {
      expect(() => createSession("xverse", "mainnet", accounts as BtcAccount[])).toThrow();
    }
  });
  it("rejects non-taproot ordinals and unsupported shared wallets", () => {
    expect(() => createSession("xverse", "mainnet", [{ ...ordinal, addressType: "p2wpkh" }, payment])).toThrow(/p2tr/);
    expect(() => sharedAddressSession("okx", "mainnet", payment)).toThrow(/p2tr/);
    expect(() => sharedAddressSession("xverse", "mainnet", ordinal)).toThrow(/UniSat/);
  });
});
