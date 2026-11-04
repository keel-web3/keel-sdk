import { describe, expect, it } from "vitest";
import { transitionVault, withdrawalCapability, type PsbtVault } from "../src/psbt-vault.js";

const vault: PsbtVault = {
  id: "vault-1",
  ownerPublicKey: "02owner",
  coordinatorPublicKey: "03coordinator",
  fundingOutpoint: `${"11".repeat(32)}:0`,
  valueSats: 100_000n,
  purpose: "auction-bid",
  auctionId: "auction-1",
  refundAfterHeight: 900,
  state: "available",
};

describe("PSBT vault policy", () => {
  it("allows cancellation until reservation and locks a signed settlement", () => {
    expect(withdrawalCapability(vault, 800).cooperativeNow).toBe(true);
    const reserved = transitionVault(vault, { type: "reserve", reservationId: "r1" });
    expect(withdrawalCapability(reserved, 800).lockedForSettlement).toBe(true);
    expect(() => transitionVault(reserved, { type: "cancel" })).toThrow("Expected available");
    const signed = transitionVault(reserved, {
      type: "sign-consumption",
      reservationId: "r1",
      txid: "settlement",
    });
    expect(() => transitionVault(signed, { type: "refund", blockHeight: 901 }))
      .toThrow("must resolve on-chain");
  });

  it("retains a unilateral timeout refund path", () => {
    expect(() => transitionVault(vault, { type: "refund", blockHeight: 899 }))
      .toThrow("unlocks at height 900");
    expect(transitionVault(vault, { type: "refund", blockHeight: 900 }).state)
      .toBe("refunded");
  });
});
