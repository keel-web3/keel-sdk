import { describe, expect, it, vi } from "vitest";
import { connectXverse, reconcileXverse } from "../src/xverse.js";

const accounts = [
  { address: "tb1p-example", publicKey: "key1", purpose: "ordinals", addressType: "p2tr", extra: 1 },
  { address: "tb1q-example", publicKey: "key2", purpose: "payment", addressType: "p2wpkh" },
];
function transport(items: unknown = accounts, name: unknown = "Signet") {
  return { request: vi.fn(async (method: string) => method === "wallet_getNetwork"
    ? { status: "success", result: { bitcoin: { name } } }
    : { status: "success", result: { addresses: items, walletType: "ledger" } }) };
}
describe("Xverse modern connection", () => {
  it("requests both roles and preserves provider metadata", async () => {
    const wallet = transport();
    expect(await connectXverse(wallet, "signet")).toEqual({ accounts, network: "signet", walletType: "ledger" });
    expect(wallet.request.mock.calls).toEqual([
      ["wallet_connect", { addresses: ["ordinals", "payment"], network: "Signet", message: "Connect your Ordinals and payment addresses to KEEL." }],
      ["wallet_getNetwork", null],
    ]);
  });
  it("reconciles with wallet_getAccount", async () => {
    const wallet = transport();
    await reconcileXverse(wallet, "signet");
    expect(wallet.request.mock.calls[0]).toEqual(["wallet_getAccount", { addresses: ["ordinals", "payment"] }]);
  });
  it("rejects legacy-only providers", async () => {
    await expect(connectXverse({ request: async () => ({ status: "error" }) }, "mainnet")).rejects.toThrow();
  });
  it.each([[accounts.slice(0, 1)], [[accounts[0], accounts[0]]], [[accounts[0], { ...accounts[1], purpose: "unknown" }]]])("rejects missing or invalid roles", async (items) => {
    await expect(connectXverse(transport(items), "signet")).rejects.toThrow();
  });
  it.each(["Mainnet", "Testnet", "unknown", null])("rejects wrong or ambiguous network %s despite tb1 addresses", async (name) => {
    await expect(connectXverse(transport(accounts, name), "signet")).rejects.toThrow();
  });
  it.each(["testnet3", "testnet4"] as const)("refuses ambiguous %s before calling wallet", async (net) => {
    const wallet = transport();
    await expect(connectXverse(wallet, net)).rejects.toThrow();
    expect(wallet.request).not.toHaveBeenCalled();
  });
});
