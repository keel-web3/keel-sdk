import { describe, it, expect } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { validateAccount, accountInputMetadata } from '../src/keys.js';
import type { BtcAccount } from '../src/types.js';
bitcoin.initEccLib(ecc);
const priv = new Uint8Array(32).fill(1);
const pub = ecc.pointFromScalar(priv, true)!;
const n = bitcoin.networks.testnet;
const hx = (x: Uint8Array) => Buffer.from(x).toString('hex');
function account(type: BtcAccount['addressType']): BtcAccount {
  const inner = bitcoin.payments.p2wpkh({ pubkey: pub, network: n });
  const p = type === 'p2tr' ? bitcoin.payments.p2tr({ internalPubkey: pub.slice(1), network: n }) : type === 'p2wpkh' ? inner : type === 'p2pkh' ? bitcoin.payments.p2pkh({ pubkey: pub, network: n }) : bitcoin.payments.p2sh({ redeem: inner, network: n });
  return { address: p.address!, addressType: type, publicKey: hx(pub), purpose: 'payment' };
}
describe('account key and prevout binding', () => {
  it('accepts equivalent x-only and compressed taproot keys', () => {
    const a = account('p2tr');
    expect(validateAccount(a, 'testnet3').internalKeyXOnly).toBe(hx(pub.slice(1)));
    expect(validateAccount({ ...a, publicKey: hx(pub.slice(1)) }, 'testnet3').address).toBe(a.address);
    const script = bitcoin.address.toOutputScript(a.address, n);
    expect(hx(accountInputMetadata(a, 'testnet3', { script, value: 100n }).tapInternalKey!)).toBe(hx(pub.slice(1)));
  });
  it('builds segwit and wrapped metadata and legacy metadata', () => {
    for (const type of ['p2wpkh', 'p2sh-p2wpkh', 'p2pkh'] as const) {
      const a = account(type); const script = bitcoin.address.toOutputScript(a.address, n);
      const tx = new bitcoin.Transaction(); tx.addInput(new Uint8Array(32), 0); tx.addOutput(script, 100n);
      const m = accountInputMetadata({ ...a, bip32: { fingerprint: '12345678', path: "m/84'/1'/0'/0/0" } }, 'testnet3', { script, value: 100n }, tx.toBuffer());
      expect(m.bip32Derivation).toHaveLength(1);
      if (type === 'p2sh-p2wpkh') expect(m.redeemScript).toBeDefined();
      if (type === 'p2pkh') expect(m.witnessUtxo).toBeUndefined();
    }
  });
  it('rejects mismatches, output keys, malformed keys, scripts, derivations and networks', () => {
    const a = account('p2tr'); const output = bitcoin.address.toOutputScript(a.address, n).slice(2);
    for (const bad of [{ ...a, publicKey: hx(output) }, { ...a, publicKey: 'ff'.repeat(32) }, { ...a, address: account('p2wpkh').address }, { ...a, bip32: { fingerprint: '0000', path: 'm/0' } }, { ...a, bip32: { fingerprint: '12345678', path: 'm/2147483648' } }]) expect(() => validateAccount(bad, 'testnet3')).toThrow();
    expect(() => validateAccount(a, 'mainnet')).toThrow();
    expect(() => validateAccount({ ...account('p2sh-p2wpkh'), redeemScript: '0014' + '00'.repeat(20) }, 'testnet3')).toThrow();
    expect(() => accountInputMetadata(account('p2pkh'), 'testnet3', { script: bitcoin.address.toOutputScript(account('p2pkh').address, n), value: 1n })).toThrow();
  });
});
