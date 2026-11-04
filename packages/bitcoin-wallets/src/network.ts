import { address, networks, type Network } from "bitcoinjs-lib";
import type { BtcNet } from "./types.js";

export function bitcoinNetwork(net: BtcNet): Network {
  switch (net) {
    case "mainnet": return networks.bitcoin;
    case "testnet3": case "testnet4": case "signet": return networks.testnet;
    case "regtest": return networks.regtest;
    default: throw new Error("Unknown Bitcoin network");
  }
}

export function normalizeWalletNetwork(value: unknown): BtcNet | "unknown" {
  switch (value) {
    case "mainnet": case "testnet3": case "testnet4": case "signet": case "regtest": return value;
    default: return "unknown";
  }
}

export function assertWalletNetwork(expected: BtcNet, actual: unknown): void {
  bitcoinNetwork(expected);
  if (normalizeWalletNetwork(actual) !== expected) throw new Error("Wallet network mismatch or unknown");
}

// Testnet3, testnet4 and signet share address encodings; also check the wallet network.
export function assertAddressNetwork(value: string, net: BtcNet): void {
  address.toOutputScript(value, bitcoinNetwork(net));
}

export function selectOkxProvider<T>(root: { okxwallet?: { bitcoin?: T; bitcoinTestnet?: T; bitcoinSignet?: T } }, net: BtcNet): T {
  let provider: T | undefined;
  switch (net) {
    case "mainnet": provider = root.okxwallet?.bitcoin; break;
    case "testnet3": provider = root.okxwallet?.bitcoinTestnet; break;
    case "signet": provider = root.okxwallet?.bitcoinSignet; break;
    default: throw new Error("Unsupported OKX network");
  }
  if (provider == null) throw new Error("OKX provider unavailable");
  return provider;
}
