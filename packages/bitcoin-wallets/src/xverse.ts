import type { BtcNet } from "./types.js";
import { normalizeWalletError, unwrapWalletResponse } from "./providers.js";

export interface XverseTransport {
  request(method: string, params: unknown): Promise<unknown>;
}
export interface XverseAccount {
  address: string;
  publicKey: string;
  purpose: "ordinals" | "payment";
  addressType: "p2tr" | "p2wpkh" | "p2sh";
  [key: string]: unknown;
}
export interface XverseConnection {
  accounts: XverseAccount[];
  network: BtcNet;
  walletType: "software" | "ledger";
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid Xverse response");
  return value as Record<string, unknown>;
}
function result(value: unknown): Record<string, unknown> {
  const response = object(value);
  const unwrapped = unwrapWalletResponse(response);
  if (response.status !== "success") throw new Error("Xverse request failed or unsupported");
  return object(unwrapped);
}
async function request(transport: XverseTransport, method: string, params: unknown): Promise<unknown> {
  try { return await transport.request(method, params); }
  catch (error) { throw normalizeWalletError(error); }
}
function networkName(net: BtcNet): string {
  switch (net) {
    case "mainnet": return "Mainnet";
    case "signet": return "Signet";
    case "regtest": return "Regtest";
    default: throw new Error("Unsupported or ambiguous Xverse network");
  }
}
async function readConnection(transport: XverseTransport, net: BtcNet, method: "wallet_connect" | "wallet_getAccount"): Promise<XverseConnection> {
  const expected = networkName(net);
  if (!transport || typeof transport.request !== "function") throw new Error("Xverse request transport required");
  const addresses = ["ordinals", "payment"];
  const account = result(await request(transport, method, method === "wallet_connect"
    ? { addresses, network: expected, message: "Connect your Ordinals and payment addresses to KEEL." }
    : { addresses }));
  const networks = result(await request(transport, "wallet_getNetwork", null));
  if (object(networks.bitcoin).name !== expected) throw new Error("Xverse network mismatch or unknown");
  if (account.network !== undefined && object(object(account.network).bitcoin).name !== expected) throw new Error("Xverse network mismatch or unknown");
  if (account.walletType !== "software" && account.walletType !== "ledger") throw new Error("Unknown Xverse wallet type");
  if (!Array.isArray(account.addresses) || account.addresses.length !== 2) throw new Error("Xverse requires both account roles");
  const accounts = account.addresses.map((value: unknown) => {
    const item = object(value);
    if ((item.purpose !== "ordinals" && item.purpose !== "payment") ||
        typeof item.address !== "string" || !item.address || typeof item.publicKey !== "string" || !item.publicKey ||
        (item.purpose === "ordinals" ? item.addressType !== "p2tr" : item.addressType !== "p2sh" && item.addressType !== "p2wpkh")) {
      throw new Error("Invalid Xverse account");
    }
    return { ...item } as XverseAccount;
  });
  if (new Set(accounts.map((item) => item.purpose)).size !== 2) throw new Error("Xverse requires both account roles");
  return { accounts, network: net, walletType: account.walletType };
}
export function connectXverse(transport: XverseTransport, net: BtcNet): Promise<XverseConnection> {
  return readConnection(transport, net, "wallet_connect");
}
export function reconcileXverse(transport: XverseTransport, net: BtcNet): Promise<XverseConnection> {
  return readConnection(transport, net, "wallet_getAccount");
}
