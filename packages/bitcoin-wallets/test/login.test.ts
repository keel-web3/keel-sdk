import { describe, it, expect } from "vitest";
import { ECPairFactory } from "ecpair";
import * as ecc from "tiny-secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import { Signer } from "bip322-js";
import { Bip322LoginManager } from "../src/login.js";
bitcoin.initEccLib(ecc);
const keys = ECPairFactory(ecc);
function account(taproot = false) { const key = keys.makeRandom(); return { key, address: taproot ? bitcoin.payments.p2tr({ internalPubkey: key.publicKey.slice(1) }).address! : bitcoin.payments.p2wpkh({ pubkey: key.publicKey }).address! }; }
const context = { domain: "example.com", uri: "https://example.com/login", network: "mainnet" as const };
function setup(shared = false) { const a = account(true), b = shared ? a : account(); const manager = new Bip322LoginManager(context); const challenge = manager.issue({ ordinals: a.address, payment: b.address }); const proofs = { ordinals: Signer.sign(a.key.toWIF(), a.address, challenge.message), payment: Signer.sign(b.key.toWIF(), b.address, challenge.message) }; return { manager, challenge, proofs, a, b }; }
describe("dual address login", () => {
  it("verifies real separate and shared role signatures", () => { for (const shared of [false, true]) { const x = setup(shared); expect(x.manager.verify(x.challenge, shared ? { ordinals: x.proofs.ordinals } : x.proofs)).toEqual({ ordinals: x.a.address, payment: x.b.address }); } });
  it("consumes a nonce even for concurrent attempts", async () => { const x = setup(); const results = await Promise.allSettled([Promise.resolve().then(() => x.manager.verify(x.challenge, x.proofs)), Promise.resolve().then(() => x.manager.verify(x.challenge, x.proofs))]); expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); });
  it.each(["domain", "uri", "network"] as const)("rejects changed %s", field => { const x = setup(); expect(() => x.manager.verify({ ...x.challenge, [field]: "wrong" }, x.proofs)).toThrow(); });
  it.each(["ordinals", "payment"] as const)("rejects missing %s proof", role => { const x = setup(); expect(() => x.manager.verify(x.challenge, { ...x.proofs, [role]: undefined })).toThrow(); });
  it("rejects forged proof", () => { const x = setup(); expect(() => x.manager.verify(x.challenge, { ...x.proofs, payment: x.proofs.ordinals })).toThrow(); });
  it("rejects expiry", () => { let now = 1000; const m = new Bip322LoginManager(context, 1, 100, () => now); const a = account(true); const c = m.issue({ ordinals: a.address, payment: a.address }); const signature = Signer.sign(a.key.toWIF(), a.address, c.message); now += 100; expect(() => m.verify(c, { ordinals: signature })).toThrow(); });
  it("rejects non-Taproot ordinals and bounds nonce storage", () => {
    const a = account(); const m = new Bip322LoginManager(context, 1);
    expect(() => m.issue({ ordinals: a.address, payment: a.address })).toThrow(/Taproot/);
    const taproot = account(true); const c = m.issue({ ordinals: taproot.address, payment: a.address });
    expect(Buffer.from(c.nonce, "hex").length).toBeGreaterThanOrEqual(16);
    expect(() => m.issue({ ordinals: taproot.address, payment: a.address })).toThrow(/full/);
  });
});
