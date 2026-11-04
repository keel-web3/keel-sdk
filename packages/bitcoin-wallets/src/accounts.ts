import type { BtcAccount, BtcNet, BtcSession } from "./types.js";

function snapshot(account: BtcAccount): BtcAccount {
  if (typeof account !== "object" || account === null ||
      typeof account.address !== "string" || !account.address ||
      typeof account.publicKey !== "string" || !account.publicKey ||
      !["p2tr", "p2wpkh", "p2sh-p2wpkh", "p2pkh"].includes(account.addressType) ||
      (account.purpose !== "ordinals" && account.purpose !== "payment")) {
    throw new Error("Account must have an explicit supported purpose and typed fields");
  }
  const copy = { ...account, ...(account.bip32 ? { bip32: Object.freeze({ ...account.bip32 }) } : {}) };
  return Object.freeze(copy);
}

/** Assign explicit roles only. Key and address cryptographic validation belongs to keys.ts. */
export function createSession(walletId: string, network: BtcNet, accounts: readonly BtcAccount[]): BtcSession {
  if (!Array.isArray(accounts) || accounts.length !== 2) throw new Error("Exactly one account per role is required");
  const copies = accounts.map(snapshot);
  const ordinals = copies.filter((account) => account.purpose === "ordinals");
  const payment = copies.filter((account) => account.purpose === "payment");
  if (ordinals.length !== 1 || payment.length !== 1) throw new Error("Exactly one account per role is required");
  if (ordinals[0]!.addressType !== "p2tr") throw new Error("Ordinals account must be p2tr");
  return Object.freeze({ walletId, network, ordinals: ordinals[0]!, payment: payment[0]!, sharedAddress: ordinals[0]!.address === payment[0]!.address });
}

/** Explicit single-address support for UniSat and OKX; this does not validate keys. */
export function sharedAddressSession(walletId: string, network: BtcNet, account: Omit<BtcAccount, "purpose">): BtcSession {
  if (walletId !== "unisat" && walletId !== "okx") throw new Error("Shared address is supported only for UniSat and OKX");
  if (!account || account.addressType !== "p2tr") throw new Error("Shared ordinals address must be p2tr");
  return createSession(walletId, network, [{ ...account, purpose: "ordinals" }, { ...account, purpose: "payment" }]);
}
