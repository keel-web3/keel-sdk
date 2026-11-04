import { describe, expect, it } from "vitest";
import { address, networks } from "bitcoinjs-lib";
import { assertAddressNetwork, assertWalletNetwork, bitcoinNetwork, normalizeWalletNetwork, selectOkxProvider } from "../src/network.js";
import type { BtcNet } from "../src/types.js";

const nets: BtcNet[] = ["mainnet", "testnet3", "testnet4", "signet", "regtest"];
describe("Bitcoin network selection", () => {
  it("checks every explicit network and rejects ambiguous responses", () => {
    for (const net of nets) { expect(normalizeWalletNetwork(net)).toBe(net); expect(() => assertWalletNetwork(net, net)).not.toThrow(); expect(bitcoinNetwork(net)).toBeDefined(); }
    for (const value of ["testnet", "tb1", undefined, {}, "MAINNET"]) expect(normalizeWalletNetwork(value)).toBe("unknown");
    expect(() => assertWalletNetwork("signet", "testnet3")).toThrow();
    expect(() => assertWalletNetwork("testnet4", "signet")).toThrow();
  });
  it("selects only the requested OKX provider", () => {
    const root = { okxwallet: { bitcoin: {}, bitcoinTestnet: {}, bitcoinSignet: {} } };
    expect(selectOkxProvider(root, "mainnet")).toBe(root.okxwallet.bitcoin);
    expect(selectOkxProvider(root, "testnet3")).toBe(root.okxwallet.bitcoinTestnet);
    expect(selectOkxProvider(root, "signet")).toBe(root.okxwallet.bitcoinSignet);
    for (const net of ["testnet4", "regtest"] as const) expect(() => selectOkxProvider(root, net)).toThrow();
    expect(() => selectOkxProvider({ okxwallet: { bitcoin: {} } }, "signet")).toThrow();
  });
  it("decodes checksummed addresses and rejects cross-network or malformed addresses", () => {
    const hash = new Uint8Array(20).fill(1);
    const main = address.toBech32(hash, 0, networks.bitcoin.bech32);
    const test = address.toBech32(hash, 0, networks.testnet.bech32);
    const legacy = address.toBase58Check(hash, networks.bitcoin.pubKeyHash);
    const testLegacy = address.toBase58Check(hash, networks.testnet.pubKeyHash);
    for (const net of nets) {
      const hrp = bitcoinNetwork(net).bech32;
      expect(() => assertAddressNetwork(address.toBech32(hash, 0, hrp), net)).not.toThrow();
    }
    expect(() => assertAddressNetwork(main, "signet")).toThrow();
    expect(() => assertAddressNetwork(test, "mainnet")).toThrow();
    expect(() => assertAddressNetwork(legacy, "testnet3")).toThrow();
    expect(() => assertAddressNetwork(testLegacy, "mainnet")).toThrow();
    for (const bad of [main.slice(0, -1), legacy.slice(0, -1), "not-an-address"]) expect(() => assertAddressNetwork(bad, "mainnet")).toThrow();
  });
  it("rejects matching tb1 address when the reported wallet network differs", () => {
    const test = address.toBech32(new Uint8Array(20).fill(1), 0, "tb");
    assertAddressNetwork(test, "signet");
    expect(() => assertWalletNetwork("signet", "testnet3")).toThrow();
    expect(() => assertWalletNetwork("testnet4", "testnet3")).toThrow();
  });
});
