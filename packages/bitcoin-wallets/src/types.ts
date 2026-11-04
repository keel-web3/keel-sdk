export type BtcNet = "mainnet" | "testnet3" | "testnet4" | "signet" | "regtest";
export type AddrType = "p2tr" | "p2wpkh" | "p2sh-p2wpkh" | "p2pkh";
export interface BtcAccount {
  address: string; addressType: AddrType; purpose: "ordinals" | "payment";
  publicKey: string;
  internalKeyXOnly?: string;
  redeemScript?: string;
  bip32?: { fingerprint: string; path: string };
}
export interface BtcSession {
  walletId: string; network: BtcNet;
  ordinals: BtcAccount; payment: BtcAccount;
  sharedAddress: boolean;
}
export interface SignRequest {
  psbtBase64: string;
  inputs: { index: number; account: "ordinals" | "payment"; sighash: number; path: "key" | { leafHash: string } }[];
}
