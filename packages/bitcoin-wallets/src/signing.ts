import * as bitcoin from 'bitcoinjs-lib';
import { accountInputMetadata, validateAccount } from './keys.js';
import { assertVaultTaprootSpendProof, vaultTaprootRequiredPublicKeys } from './psbt-review.js';
import { normalizeWalletError, unwrapWalletResponse, WalletProviderError } from './providers.js';
import type { BtcNet, BtcSession, SignRequest } from './types.js';

export type WalletId = 'xverse' | 'unisat' | 'okx' | 'leather' | 'magic-eden';
export interface XverseSignParams {
  psbt: string;
  signInputs: Record<string, number[]>;
  broadcast: false;
}
export interface LeatherSignParams {
  hex: string;
  signAtIndex: number[];
  allowedSighash: number[];
  network: 'mainnet' | 'testnet' | 'signet';
  broadcast: false;
}
export interface InjectedSignInput {
  index: number;
  address?: string;
  publicKey?: string;
  sighashTypes: number[];
  disableTweakSigner?: boolean;
  useTweakedSigner?: boolean;
}
export interface InjectedSignOptions {
  autoFinalized: false;
  toSignInputs: InjectedSignInput[];
}
export interface LegacySignOptions {
  payload: {
    network: { type: 'Mainnet' };
    message: string;
    psbtBase64: string;
    inputsToSign: { address: string; signingIndexes: number[] }[];
    broadcast: false;
  };
  onFinish: (result: unknown) => void;
  onCancel: () => void;
}
export interface XverseSigningProvider { request?: (method: 'signPsbt', params: XverseSignParams) => Promise<unknown> }
export interface LeatherSigningProvider { request?: (method: 'signPsbt', params: LeatherSignParams) => Promise<unknown> }
export interface InjectedSigningProvider { signPsbt?: (hex: string, options: InjectedSignOptions) => Promise<unknown> }
/** Inject the legacy sats-connect signTransaction function, bound to the selected Magic Eden provider. */
export interface MagicEdenSigningProvider { signTransaction?: (options: LegacySignOptions) => void | Promise<void> }
export type SigningProvider = XverseSigningProvider | LeatherSigningProvider | InjectedSigningProvider | MagicEdenSigningProvider;

const equal = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
function checkPsbt(bytes: Buffer): void {
  const psbt = bitcoin.Psbt.fromBuffer(bytes);
  // bip174 parses the expected maps but otherwise ignores trailing bytes.
  if (psbt.toBuffer().length !== bytes.length) throw new Error('Invalid PSBT length');
}
function base64(value: unknown): Buffer {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || !value) throw new Error('Invalid base64 PSBT');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error('Invalid base64 PSBT');
  checkPsbt(bytes);
  return bytes;
}
function fromHex(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(value)) throw new Error('Invalid hex PSBT');
  const bytes = Buffer.from(value, 'hex');
  checkPsbt(bytes);
  return bytes.toString('base64');
}
function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined;
}
function supportedNetwork(wallet: WalletId, network: BtcNet): void {
  const supported: Record<WalletId, readonly BtcNet[]> = {
    xverse: ['mainnet', 'testnet3', 'signet', 'regtest'],
    unisat: ['mainnet', 'testnet3'],
    okx: ['mainnet', 'testnet3', 'signet'],
    leather: ['mainnet', 'testnet3', 'signet'],
    'magic-eden': ['mainnet'],
  };
  if (!supported[wallet].includes(network)) throw new Error('Unsupported wallet network');
}
function checkScriptPath(input: bitcoin.Psbt['data']['inputs'][number], outpoint: bitcoin.Psbt['txInputs'][number], account: BtcSession['ordinals'], network: BtcNet, reviewedHash: string): void {
  // A vault output is not the signer's address. Bind the wallet key to its own
  // address, then to a supported signature opcode in the committed vault leaf.
  const signer = validateAccount(account, network).internalKeyXOnly!;
  if (input.nonWitnessUtxo) {
    const previous = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo);
    const output = previous.outs[outpoint.index];
    if (previous.getId() !== Buffer.from(outpoint.hash).reverse().toString('hex') || !output || !input.witnessUtxo || output.value !== input.witnessUtxo.value || !equal(output.script, input.witnessUtxo.script)) throw new Error('Previous transaction output mismatch');
  }
  const leafHash = assertVaultTaprootSpendProof(input);
  const leaf = input.tapLeafScript![0]!;
  if (leaf.leafVersion !== 0xc0) throw new Error('Unsupported leaf version');
  if (leafHash.toString('hex') !== reviewedHash.toLowerCase()) throw new Error('Leaf hash mismatch');
  if (!vaultTaprootRequiredPublicKeys(leaf.script).includes(signer)) throw new Error('Leaf signer mismatch');
  const control = Buffer.from(leaf.controlBlock);
  if (input.tapInternalKey && !equal(input.tapInternalKey, control.subarray(1, 33))) throw new Error('Taproot internal key mismatch');
  if (input.tapMerkleRoot) {
    let root = leafHash;
    for (let offset = 33; offset < control.length; offset += 32) {
      const sibling = control.subarray(offset, offset + 32);
      root = Buffer.from(bitcoin.crypto.taggedHash('TapBranch', Buffer.compare(root, sibling) < 0 ? Buffer.concat([root, sibling]) : Buffer.concat([sibling, root])));
    }
    if (!equal(root, input.tapMerkleRoot)) throw new Error('Taproot merkle root mismatch');
  }
}

/**
 * Transport only. The caller must bind the selected provider to the live session/network
 * and independently compare the returned PSBT and verify signatures before use.
 */
export async function signWithProvider(walletId: WalletId, provider: SigningProvider, session: BtcSession, request: SignRequest): Promise<string> {
  if (!['xverse', 'unisat', 'okx', 'leather', 'magic-eden'].includes(walletId) || session.walletId !== walletId) throw new Error('Unknown or mismatched wallet');
  if (!['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'].includes(session.network)) throw new Error('Unknown network');
  supportedNetwork(walletId, session.network);
  if (session.sharedAddress !== (session.ordinals.address === session.payment.address)) throw new Error('Shared account mismatch');
  if ((walletId === 'unisat' || walletId === 'okx') && !session.sharedAddress) throw new Error('Wallet requires a shared account');
  const bytes = base64(request.psbtBase64);
  const psbt = bitcoin.Psbt.fromBuffer(bytes);
  if (!Array.isArray(request.inputs) || !request.inputs.length) throw new Error('Missing signing inputs');
  const seen = new Set<number>();
  const groups: Record<string, number[]> = Object.create(null);
  const entries: InjectedSignInput[] = request.inputs.map(item => {
    if (!Number.isSafeInteger(item.index) || item.index < 0 || item.index >= psbt.inputCount || seen.has(item.index)) throw new Error('Duplicate or out-of-range input');
    seen.add(item.index);
    if (item.account !== 'ordinals' && item.account !== 'payment') throw new Error('Unknown account role');
    const account = session[item.account];
    if (account.purpose !== item.account) throw new Error('Account role mismatch');
    const input = psbt.data.inputs[item.index]!;
    if (!input.witnessUtxo || input.sighashType !== item.sighash) throw new Error('Missing or mismatched PSBT metadata sighash');
    const tap = account.addressType === 'p2tr';
    if (!(tap ? [0, 1, 2, 3, 129, 130, 131] : [1, 2, 3, 129, 130, 131]).includes(item.sighash)) throw new Error('Unsupported sighash');
    if (walletId === 'xverse' && !(tap ? [0, 1] : [1]).includes(item.sighash)) throw new Error('Unsupported wallet sighash');
    if (walletId === 'magic-eden' && item.sighash !== (tap ? 0 : 1)) throw new Error('Unsupported wallet sighash');
    if (walletId === 'leather' && item.sighash !== 1) throw new Error('Unsupported wallet sighash');
    if (item.path !== 'key') {
      if (!tap || !['unisat', 'okx'].includes(walletId) || !item.path || typeof item.path.leafHash !== 'string' || !/^[0-9a-fA-F]{64}$/.test(item.path.leafHash)) throw new Error('Unsupported script path');
      checkScriptPath(input, psbt.txInputs[item.index]!, account, session.network, item.path.leafHash);
    } else {
      const txin = psbt.txInputs[item.index]!;
      const metadata = accountInputMetadata(account, session.network, input.witnessUtxo, input.nonWitnessUtxo, { txid: Buffer.from(txin.hash).reverse().toString('hex'), index: txin.index });
      if (tap && (!input.tapInternalKey || !metadata.tapInternalKey || !equal(input.tapInternalKey, metadata.tapInternalKey))) throw new Error('Taproot internal key mismatch');
      if (metadata.redeemScript && (!input.redeemScript || !equal(input.redeemScript, metadata.redeemScript))) throw new Error('Redeem script mismatch');
    }
    (groups[account.address] ??= []).push(item.index);
    return {
      index: item.index,
      ...(item.path === 'key' && !(walletId === 'okx' && tap) ? { address: account.address } : { publicKey: account.publicKey }),
      sighashTypes: [item.sighash],
      ...(tap ? { disableTweakSigner: item.path !== 'key', useTweakedSigner: item.path === 'key' } : {}),
    };
  });
  if (walletId === 'unisat' || walletId === 'okx') {
    const sign = (provider as InjectedSigningProvider).signPsbt;
    if (typeof sign !== 'function') throw new Error('Missing provider capability');
    return fromHex(await sign.call(provider, bytes.toString('hex'), { autoFinalized: false, toSignInputs: entries }));
  }
  if (walletId === 'xverse') {
    const send = (provider as XverseSigningProvider).request;
    if (typeof send !== 'function') throw new Error('Missing provider capability');
    const result = await send.call(provider, 'signPsbt', { psbt: request.psbtBase64, signInputs: groups, broadcast: false });
    const value = field(unwrapWalletResponse(result), 'psbt');
    base64(value);
    return value as string;
  }
  if (walletId === 'leather') {
    const send = (provider as LeatherSigningProvider).request;
    if (typeof send !== 'function') throw new Error('Missing provider capability');
    const network = session.network === 'testnet3' ? 'testnet' : session.network as 'mainnet' | 'signet';
    const result = await send.call(provider, 'signPsbt', { hex: bytes.toString('hex'), signAtIndex: request.inputs.map(i => i.index), allowedSighash: [1], network, broadcast: false });
    return fromHex(field(unwrapWalletResponse(result), 'hex'));
  }
  const sign = (provider as MagicEdenSigningProvider).signTransaction;
  if (typeof sign !== 'function') throw new Error('Missing provider capability');
  const result = await new Promise<unknown>((resolve, reject) => {
    Promise.resolve(sign.call(provider, { payload: { network: { type: 'Mainnet' }, message: 'Sign the reviewed transaction.', psbtBase64: request.psbtBase64, inputsToSign: Object.entries(groups).map(([address, signingIndexes]) => ({ address, signingIndexes })), broadcast: false }, onFinish: resolve, onCancel: () => reject(new WalletProviderError('Wallet cancelled', 'rejected')) })).catch(error => reject(normalizeWalletError(error)));
  });
  const value = field(result, 'psbtBase64');
  base64(value);
  return value as string;
}
