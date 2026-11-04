import * as bitcoin from 'bitcoinjs-lib';
import { accountInputMetadata } from './keys.js';
import { assertVaultTaprootSpendProof } from './psbt-review.js';
import type { BtcSession, SignRequest } from './types.js';

export type WalletId = 'xverse' | 'unisat' | 'okx' | 'leather' | 'magic-eden';
export type SigningProvider = {
  request?: (method: string, params: any) => Promise<any>;
  signPsbt?: (hex: string, options: any) => Promise<string>;
  signTransaction?: (options: { payload: any; onFinish: (result: any) => void; onCancel: () => void }) => void;
};
const equal = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
function base64(value: unknown): Buffer {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || !value) throw new Error('Invalid base64 PSBT');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error('Invalid base64 PSBT');
  bitcoin.Psbt.fromBuffer(bytes);
  return bytes;
}
function fromHex(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(value)) throw new Error('Invalid hex PSBT');
  const bytes = Buffer.from(value, 'hex');
  bitcoin.Psbt.fromBuffer(bytes);
  return bytes.toString('base64');
}
/** Transport only: callers must independently verify returned PSBT bytes and signatures. */
export async function signWithProvider(walletId: WalletId, provider: SigningProvider, session: BtcSession, request: SignRequest): Promise<string> {
  if (!['xverse', 'unisat', 'okx', 'leather', 'magic-eden'].includes(walletId) || session.walletId !== walletId) throw new Error('Unknown or mismatched wallet');
  if (!['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'].includes(session.network)) throw new Error('Unknown network');
  if (walletId === 'magic-eden' && session.network !== 'mainnet') throw new Error('Unsupported wallet network');
  if (walletId === 'leather' && !['mainnet', 'testnet3', 'signet'].includes(session.network)) throw new Error('Unsupported wallet network');
  if ((walletId === 'unisat' || walletId === 'okx') && (!session.sharedAddress || session.ordinals.address !== session.payment.address)) throw new Error('Wallet requires a shared account');
  const bytes = base64(request.psbtBase64);
  const psbt = bitcoin.Psbt.fromBuffer(bytes);
  if (!request.inputs.length) throw new Error('Missing signing inputs');
  const seen = new Set<number>();
  const groups: Record<string, number[]> = Object.create(null);
  const entries = request.inputs.map(item => {
    if (!Number.isSafeInteger(item.index) || item.index < 0 || item.index >= psbt.inputCount || seen.has(item.index)) throw new Error('Duplicate or out-of-range input');
    seen.add(item.index);
    if (item.account !== 'ordinals' && item.account !== 'payment') throw new Error('Unknown account role');
    const account = session[item.account];
    if (account.purpose !== item.account) throw new Error('Account role mismatch');
    const input = psbt.data.inputs[item.index]!;
    if (!input.witnessUtxo || input.sighashType !== item.sighash) throw new Error('Missing or mismatched PSBT metadata sighash');
    const tap = account.addressType === 'p2tr';
    if (!(tap ? [0, 1, 2, 3, 129, 130, 131] : [1, 2, 3, 129, 130, 131]).includes(item.sighash)) throw new Error('Unsupported sighash');
    if (!['unisat', 'okx'].includes(walletId) && !(tap ? [0, 1] : [1]).includes(item.sighash)) throw new Error('Unsupported wallet sighash');
    if (walletId === 'leather' && item.sighash !== 1) throw new Error('Unsupported wallet sighash');
    if (item.path !== 'key') {
      if (!tap || !['unisat', 'okx'].includes(walletId) || !/^[0-9a-fA-F]{64}$/.test(item.path.leafHash)) throw new Error('Unsupported script path');
      const network = session.network === 'mainnet' ? bitcoin.networks.bitcoin : session.network === 'regtest' ? bitcoin.networks.regtest : bitcoin.networks.testnet;
      if (!equal(bitcoin.address.toOutputScript(account.address, network), input.witnessUtxo.script)) throw new Error('Account script mismatch');
      const leafHash = assertVaultTaprootSpendProof(input);
      if (leafHash.toString('hex') !== item.path.leafHash.toLowerCase()) throw new Error('Leaf hash mismatch');
      const key = Buffer.from(account.publicKey, 'hex');
      const x = key.length === 33 ? key.subarray(1) : key;
      const ops = bitcoin.script.decompile(input.tapLeafScript![0]!.script);
      if (x.length !== 32 || !ops?.some(op => typeof op !== 'number' && equal(op, x))) throw new Error('Leaf signer mismatch');
    } else {
      const txin = psbt.txInputs[item.index]!;
      const metadata = accountInputMetadata(account, session.network, input.witnessUtxo, input.nonWitnessUtxo, { txid: Buffer.from(txin.hash).reverse().toString('hex'), index: txin.index });
      if (tap && (!input.tapInternalKey || !metadata.tapInternalKey || !equal(input.tapInternalKey, metadata.tapInternalKey))) throw new Error('Taproot internal key mismatch');
      if (metadata.redeemScript && (!input.redeemScript || !equal(input.redeemScript, metadata.redeemScript))) throw new Error('Redeem script mismatch');
    }
    (groups[account.address] ??= []).push(item.index);
    return { index: item.index, address: account.address, sighashTypes: [item.sighash], ...(tap ? { disableTweakSigner: item.path !== 'key', useTweakedSigner: item.path === 'key' } : {}) };
  });
  if (walletId === 'unisat' || walletId === 'okx') {
    if (!provider.signPsbt) throw new Error('Missing provider capability');
    return fromHex(await provider.signPsbt(bytes.toString('hex'), { autoFinalized: false, toSignInputs: entries }));
  }
  if (walletId === 'xverse') {
    if (!provider.request) throw new Error('Missing provider capability');
    const result = await provider.request('signPsbt', { psbt: request.psbtBase64, signInputs: groups, broadcast: false });
    const value = result?.result?.psbt;
    base64(value); return value;
  }
  if (walletId === 'leather') {
    if (!provider.request) throw new Error('Missing provider capability');
    const result = await provider.request('signPsbt', { hex: bytes.toString('hex'), signAtIndex: request.inputs.map(i => i.index), allowedSighash: [1], network: session.network, broadcast: false });
    return fromHex(result?.result?.hex);
  }
  if (!provider.signTransaction) throw new Error('Missing provider capability');
  const result = await new Promise<any>((resolve, reject) => provider.signTransaction!({ payload: { psbtBase64: request.psbtBase64, inputsToSign: Object.entries(groups).map(([address, signingIndexes]) => ({ address, signingIndexes })), broadcast: false }, onFinish: resolve, onCancel: () => reject(new Error('Wallet cancelled')) }));
  base64(result?.psbtBase64); return result.psbtBase64;
}
