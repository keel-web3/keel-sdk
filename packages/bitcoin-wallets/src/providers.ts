import { address as bitcoinAddress } from "bitcoinjs-lib";
import { createSession } from "./accounts.js";
import { validateAccount } from "./keys.js";
import { bitcoinNetwork } from "./network.js";
import type { BtcAccount, BtcNet, BtcSession } from "./types.js";

type Kind = "rejected" | "unsupported" | "malformed" | "provider";
export class WalletProviderError extends Error {
  readonly code: string | number | undefined;
  readonly kind: Kind;
  readonly rejected: boolean;
  readonly unsupported: boolean;
  constructor(message: string, kind: Kind, cause?: unknown, code?: string | number) {
    super(message, { cause });
    this.name = "WalletProviderError";
    this.kind = kind; this.code = code;
    this.rejected = kind === "rejected"; this.unsupported = kind === "unsupported";
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WalletProviderError("Malformed wallet response", "malformed", value);
  return value as Record<string, unknown>;
}
export function normalizeWalletError(value: unknown): WalletProviderError {
  if (value instanceof WalletProviderError) return value;
  const obj = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const code = typeof obj.code === "number" || typeof obj.code === "string" ? obj.code : undefined;
  const rejected = code === -32000 || code === "-32000" || code === 4001 || code === -4001 || code === "4001" || code === "-4001" || code === "USER_REJECTION";
  const unsupported = code === -32601 || code === "-32601" || code === "UNSUPPORTED";
  return new WalletProviderError(typeof obj.message === "string" ? obj.message : "Wallet request failed", rejected ? "rejected" : unsupported ? "unsupported" : "provider", value, code);
}
export function unwrapWalletResponse(value: unknown): unknown {
  const response = record(value);
  if (response.status === "error" || response.error !== undefined) throw normalizeWalletError(response.error ?? response);
  if (response.status !== undefined && response.status !== "success") throw new WalletProviderError("Malformed wallet response", "malformed", value);
  if (!("result" in response)) throw new WalletProviderError("Malformed wallet response", "malformed", value);
  return response.result;
}
function malformed(cause: unknown): never { throw new WalletProviderError("Invalid wallet accounts", "malformed", cause); }
function session(wallet: string, net: BtcNet, accounts: BtcAccount[]): BtcSession {
  try { return createSession(wallet, net, accounts.map(a => validateAccount(a, net))); } catch (e) { return malformed(e); }
}
function requiredString(v: unknown): string {
  if (typeof v !== "string" || !v) return malformed(v);
  return v;
}
export interface LeatherProvider { request(method: string, params: { network: string }): Promise<unknown> }
export async function connectLeather(provider: LeatherProvider, net: BtcNet): Promise<BtcSession> {
  const networks: Partial<Record<BtcNet, string>> = { mainnet: "mainnet", testnet3: "testnet", signet: "signet" };
  const network = networks[net];
  if (!network || !provider || typeof provider.request !== "function") throw new WalletProviderError("Unsupported Leather network or provider", "unsupported");
  let response: unknown;
  try { response = await provider.request("getAddresses", { network }); } catch (e) { throw normalizeWalletError(e); }
  const result = record(unwrapWalletResponse(response));
  if (!Array.isArray(result.addresses)) return malformed(result);
  const entries = result.addresses.map(record);
  if (entries.some(e => e.type === "p2wsh" || e.status === "proposed")) throw new WalletProviderError("Leather vault accounts are unsupported", "unsupported");
  if (entries.some(e => e.type !== "p2tr" && e.type !== "p2wpkh")) return malformed(entries);
  const select = (type: string) => { const found = entries.filter(e => e.type === type); if (found.length !== 1) return malformed(found); return found[0]!; };
  const convert = (item: Record<string, unknown>, purpose: BtcAccount["purpose"], addressType: BtcAccount["addressType"]): BtcAccount => {
    const account: BtcAccount = { purpose, addressType, address: requiredString(item.address), publicKey: requiredString(item.publicKey) };
    if (item.fingerprint !== undefined || item.derivationPath !== undefined) account.bip32 = { fingerprint: requiredString(item.fingerprint), path: requiredString(item.derivationPath) };
    if (addressType === "p2tr" && item.tweakedPublicKey !== undefined) {
      const tweaked = requiredString(item.tweakedPublicKey).toLowerCase();
      try { const script = bitcoinAddress.toOutputScript(account.address, bitcoinNetwork(net)); if (!/^[0-9a-f]{64}$/.test(tweaked) || Buffer.from(script.slice(2)).toString("hex") !== tweaked) return malformed(item); } catch (e) { return malformed(e); }
    }
    return account;
  };
  return session("leather", net, [convert(select("p2tr"), "ordinals", "p2tr"), convert(select("p2wpkh"), "payment", "p2wpkh")]);
}
export interface MagicEdenTransport<P> {
  provider: P;
  getAddress(options: { payload: { purposes: ["ordinals", "payment"]; message: string; network: { type: "Mainnet" } }; onFinish(response: unknown): void; onCancel(): void; getProvider(): Promise<P> }): Promise<unknown> | void;
}
export async function connectMagicEden<P>(transport: MagicEdenTransport<P>, net: BtcNet): Promise<BtcSession> {
  if (net !== "mainnet" || !transport || !transport.provider || typeof transport.getAddress !== "function") throw new WalletProviderError("Unsupported Magic Eden network or provider", "unsupported");
  const response = await new Promise<unknown>((resolve, reject) => {
    try {
      Promise.resolve(transport.getAddress({ payload: { purposes: ["ordinals", "payment"], message: "Address for receiving Ordinals and payments", network: { type: "Mainnet" } }, getProvider: async () => transport.provider, onFinish: resolve, onCancel: () => reject(new WalletProviderError("Wallet request cancelled", "rejected")) })).catch(e => reject(normalizeWalletError(e)));
    } catch (e) { reject(normalizeWalletError(e)); }
  });
  const result = record(response);
  if (!Array.isArray(result.addresses) || result.addresses.length !== 2) return malformed(result);
  const accounts: BtcAccount[] = result.addresses.map((value: unknown) => {
    const item = record(value);
    if (item.purpose !== "ordinals" && item.purpose !== "payment") return malformed(item);
    return { purpose: item.purpose, addressType: item.purpose === "ordinals" ? "p2tr" : "p2wpkh", address: requiredString(item.address), publicKey: requiredString(item.publicKey) };
  });
  return session("magic-eden", net, accounts);
}
