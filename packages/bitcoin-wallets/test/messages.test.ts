import { it, expect } from "vitest";
import { ECPairFactory } from "ecpair";
import * as ecc from "tiny-secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import { Signer } from "bip322-js";
import { signBip322Message, verifyBip322Message } from "../src/messages.js";
bitcoin.initEccLib(ecc);
it("verifies a real provider signature and rejects Phantom before calling it", async () => {
  const key = ECPairFactory(ecc).makeRandom(); const address = bitcoin.payments.p2wpkh({ pubkey: key.publicKey }).address!;
  const signature = Signer.sign(key.toWIF(), address, "test");
  expect(await signBip322Message({ transport: { wallet: "unisat", signMessage: async () => signature }, network: "mainnet", walletNetwork: "mainnet", address, message: "test" })).toBe(signature);
  let called = false;
  await expect(signBip322Message({ transport: { wallet: "phantom", signMessage: async () => { called = true; return signature; } } as never, network: "mainnet", walletNetwork: "mainnet", address, message: "test" })).rejects.toThrow();
  expect(called).toBe(false); expect(verifyBip322Message(address, "wrong", signature)).toBe(false);
});
