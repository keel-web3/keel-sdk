import { Buffer } from "buffer";
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import type { BtcAccount, BtcNet } from './types.js';

bitcoin.initEccLib(ecc);
const hex = (s: string, length?: number): Uint8Array => {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(s) || (length !== undefined && s.length !== length * 2)) throw new Error('Invalid hex');
  return Buffer.from(s, 'hex');
};
const equal = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
function network(net: BtcNet): bitcoin.Network {
  switch (net) {
    case 'mainnet': return bitcoin.networks.bitcoin;
    case 'testnet3': case 'testnet4': case 'signet': return bitcoin.networks.testnet;
    case 'regtest': return bitcoin.networks.regtest;
    default: throw new Error('Unknown network');
  }
}
function checked(account: BtcAccount, net: BtcNet) {
  const n = network(net);
  const key = hex(account.publicKey);
  let payment: bitcoin.Payment;
  let internal: Uint8Array | undefined;
  let redeem: Uint8Array | undefined;
  if (account.addressType === 'p2tr') {
    if (key.length === 32 && ecc.isXOnlyPoint(key)) internal = key;
    else if (key.length === 33 && (key[0] === 2 || key[0] === 3) && ecc.isPoint(key)) internal = key.slice(1);
    else throw new Error('Invalid taproot internal key');
    if (account.internalKeyXOnly && !equal(internal, hex(account.internalKeyXOnly, 32))) throw new Error('Internal key mismatch');
    payment = bitcoin.payments.p2tr({ internalPubkey: internal, network: n });
  } else {
    if (key.length !== 33 || (key[0] !== 2 && key[0] !== 3) || !ecc.isPoint(key)) throw new Error('Invalid compressed key');
    if (account.internalKeyXOnly) throw new Error('Unexpected internal key');
    if (account.addressType === 'p2wpkh') payment = bitcoin.payments.p2wpkh({ pubkey: key, network: n });
    else if (account.addressType === 'p2pkh') payment = bitcoin.payments.p2pkh({ pubkey: key, network: n });
    else if (account.addressType === 'p2sh-p2wpkh') {
      const inner = bitcoin.payments.p2wpkh({ pubkey: key, network: n });
      redeem = inner.output!;
      payment = bitcoin.payments.p2sh({ redeem: inner, network: n });
    } else throw new Error('Unknown address type');
  }
  if (account.redeemScript && (!redeem || !equal(redeem, hex(account.redeemScript)))) throw new Error('Redeem script mismatch');
  if (payment.address !== account.address) throw new Error('Address/key or network mismatch');
  if (account.bip32) {
    if (hex(account.bip32.fingerprint, 4).every(b => b === 0)) throw new Error('Invalid fingerprint');
    if (!/^m(?:\/(?:0|[1-9][0-9]*)'?)*$/.test(account.bip32.path)) throw new Error('Invalid derivation path');
    for (const part of account.bip32.path.split('/').slice(1)) if (Number(part.replace("'", '')) >= 0x80000000) throw new Error('Invalid derivation index');
  }
  return { key, internal, redeem, output: payment.output! };
}
export function validateAccount(account: BtcAccount, net: BtcNet): BtcAccount {
  const c = checked(account, net);
  return { ...account, ...(account.bip32 ? { bip32: { ...account.bip32 } } : {}), ...(c.internal ? { internalKeyXOnly: Buffer.from(c.internal).toString('hex') } : {}), ...(c.redeem ? { redeemScript: Buffer.from(c.redeem).toString('hex') } : {}) };
}
export function accountInputMetadata(account: BtcAccount, net: BtcNet, witnessUtxo: { script: Uint8Array; value: bigint }, nonWitnessUtxo?: Uint8Array, outpoint?: { txid: string; index: number }) {
  const c = checked(account, net);
  if (!equal(c.output, witnessUtxo.script) || witnessUtxo.value < 0n) throw new Error('Prevout mismatch');
  if (account.addressType === 'p2pkh' && !nonWitnessUtxo) throw new Error('Legacy input requires nonWitnessUtxo');
  if (nonWitnessUtxo) {
    const tx = bitcoin.Transaction.fromBuffer(nonWitnessUtxo);
    if (!outpoint || !/^[0-9a-f]{64}$/.test(outpoint.txid) || !Number.isSafeInteger(outpoint.index) || outpoint.index < 0 || tx.getId() !== outpoint.txid) throw new Error('Previous transaction outpoint mismatch');
    const previous = tx.outs[outpoint.index];
    if (!previous || previous.value !== witnessUtxo.value || !equal(previous.script, witnessUtxo.script)) throw new Error('Previous transaction output mismatch');
  }
  const derivation = account.bip32 && { masterFingerprint: hex(account.bip32.fingerprint, 4), path: account.bip32.path, pubkey: c.internal ?? c.key };
  return {
    ...(account.addressType !== 'p2pkh' ? { witnessUtxo: { value: witnessUtxo.value, script: Uint8Array.from(witnessUtxo.script) } } : {}),
    ...(nonWitnessUtxo ? { nonWitnessUtxo: Uint8Array.from(nonWitnessUtxo) } : {}),
    ...(c.internal ? { tapInternalKey: c.internal } : {}),
    ...(c.redeem ? { redeemScript: c.redeem } : {}),
    ...(derivation ? (c.internal ? { tapBip32Derivation: [{ ...derivation, leafHashes: [] as Uint8Array[] }] } : { bip32Derivation: [derivation] }) : {})
  };
}
