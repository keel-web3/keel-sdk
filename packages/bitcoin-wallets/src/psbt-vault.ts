export type VaultPurpose = "auction-bid" | "patron-capacity";
export type VaultState =
  | "available"
  | "reserved"
  | "consumption-signed"
  | "consumed"
  | "cancelled"
  | "refunded"
  | "conflicted";

export interface PsbtVault {
  readonly id: string;
  readonly ownerPublicKey: string;
  readonly coordinatorPublicKey: string;
  readonly fundingOutpoint: string;
  readonly valueSats: bigint;
  readonly purpose: VaultPurpose;
  readonly auctionId: string;
  readonly refundAfterHeight: number;
  readonly state: VaultState;
  readonly reservationId?: string;
  readonly consumptionTxid?: string;
}

export type VaultAction =
  | { readonly type: "reserve"; readonly reservationId: string }
  | { readonly type: "release"; readonly reservationId: string }
  | { readonly type: "sign-consumption"; readonly reservationId: string; readonly txid: string }
  | { readonly type: "confirm-consumption"; readonly txid: string }
  | { readonly type: "cancel" }
  | { readonly type: "refund"; readonly blockHeight: number }
  | { readonly type: "mark-conflict" };

/**
 * Pure reference state machine for a P2TR auction vault.
 *
 * Intended script paths:
 * 1. owner + coordinator cooperative spend for settlement or early cancel;
 * 2. owner-only CLTV refund after `refundAfterHeight`.
 *
 * PSBT is only the transport. The Taproot output is what actually locks funds.
 */
export function transitionVault(vault: PsbtVault, action: VaultAction): PsbtVault {
  if (isTerminal(vault.state)) throw new Error(`Vault is already ${vault.state}.`);
  if (action.type === "reserve") {
    requireState(vault, "available");
    return { ...vault, state: "reserved", reservationId: action.reservationId };
  }
  if (action.type === "release") {
    requireState(vault, "reserved");
    requireReservation(vault, action.reservationId);
    return withoutReservation({ ...vault, state: "available" });
  }
  if (action.type === "sign-consumption") {
    requireState(vault, "reserved");
    requireReservation(vault, action.reservationId);
    return { ...vault, state: "consumption-signed", consumptionTxid: action.txid };
  }
  if (action.type === "confirm-consumption") {
    requireState(vault, "consumption-signed");
    if (vault.consumptionTxid !== action.txid) throw new Error("Settlement txid changed.");
    return { ...vault, state: "consumed" };
  }
  if (action.type === "cancel") {
    requireState(vault, "available");
    return { ...vault, state: "cancelled" };
  }
  if (action.type === "refund") {
    if (vault.state === "consumption-signed") {
      throw new Error("A signed settlement must resolve on-chain before refunding.");
    }
    if (action.blockHeight < vault.refundAfterHeight) {
      throw new Error(`Unilateral refund unlocks at height ${vault.refundAfterHeight}.`);
    }
    return { ...vault, state: "refunded" };
  }
  return { ...vault, state: "conflicted" };
}

export function withdrawalCapability(vault: PsbtVault, blockHeight: number) {
  return {
    cooperativeNow: vault.state === "available",
    unilateralNow:
      (vault.state === "available" || vault.state === "reserved")
      && blockHeight >= vault.refundAfterHeight,
    lockedForSettlement:
      vault.state === "reserved" || vault.state === "consumption-signed",
    explanation: vault.state === "available"
      ? "Sign a cancellation now; the owner can also refund alone after the timeout."
      : vault.state === "reserved"
        ? "Funds are reserved for settlement; only the timeout path remains unilateral."
        : vault.state === "consumption-signed"
          ? "Settlement is signed and must confirm or conflict before another spend."
          : `Funds are ${vault.state}.`,
  };
}

function isTerminal(state: VaultState): boolean {
  return ["consumed", "cancelled", "refunded", "conflicted"].includes(state);
}

function requireState(vault: PsbtVault, expected: VaultState): void {
  if (vault.state !== expected) throw new Error(`Expected ${expected}; received ${vault.state}.`);
}

function requireReservation(vault: PsbtVault, reservationId: string): void {
  if (vault.reservationId !== reservationId) throw new Error("Reservation token mismatch.");
}

function withoutReservation(vault: PsbtVault): PsbtVault {
  const { reservationId: _reservationId, ...rest } = vault;
  return rest;
}
