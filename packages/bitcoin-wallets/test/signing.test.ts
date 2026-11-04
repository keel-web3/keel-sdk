import { expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { signWithProvider } from '../src/signing.js';
import type { BtcSession, SignRequest } from '../src/types.js';
bitcoin.initEccLib(ecc);
const pub = ecc.pointFromScalar(new Uint8Array(32).fill(1), true)!;
const network = bitcoin.networks.testnet;
const tr = bitcoin.payments.p2tr({ internalPubkey: pub.slice(1), network });
const w = bitcoin.payments.p2wpkh({ pubkey: pub, network });
const key = Buffer.from(pub).toString('hex');
function fixture(walletId: string) {
  const session: BtcSession = { walletId, network: 'testnet3', sharedAddress: false, ordinals: { address: tr.address!, addressType: 'p2tr', publicKey: key, purpose: 'ordinals' }, payment: { address: w.address!, addressType: 'p2wpkh', publicKey: key, purpose: 'payment' } };
  const p = new bitcoin.Psbt({ network });
  p.addInput({ hash: '01'.repeat(32), index: 0, witnessUtxo: { script: tr.output!, value: 1000n }, tapInternalKey: pub.slice(1), sighashType: 1 });
  p.addInput({ hash: '02'.repeat(32), index: 0, witnessUtxo: { script: w.output!, value: 1000n }, sighashType: 1 });
  p.addOutput({ script: w.output!, value: 1500n });
  const request: SignRequest = { psbtBase64: p.toBase64(), inputs: [{ index: 0, account: 'ordinals', sighash: 1, path: 'key' }, { index: 1, account: 'payment', sighash: 1, path: 'key' }] };
  return { session, request };
}
it('groups mixed roles in one Xverse prompt without broadcast', async () => {
  const { session, request } = fixture('xverse');
  const call = vi.fn().mockResolvedValue({ result: { psbt: request.psbtBase64 } });
  expect(await signWithProvider('xverse', { request: call }, session, request)).toBe(request.psbtBase64);
  expect(call).toHaveBeenCalledOnce();
  expect(call).toHaveBeenCalledWith('signPsbt', { psbt: request.psbtBase64, broadcast: false, signInputs: { [session.ordinals.address]: [0], [session.payment.address]: [1] } });
});
it('scopes UniSat inputs and disables finalization', async () => {
  const { session, request } = fixture('unisat');
  session.sharedAddress = true;
  session.payment = { ...session.ordinals, purpose: 'payment' };
  request.inputs = [request.inputs[0]!];
  const call = vi.fn().mockResolvedValue(Buffer.from(request.psbtBase64, 'base64').toString('hex'));
  await signWithProvider('unisat', { signPsbt: call }, session, request);
  expect(call.mock.calls[0]![1]).toEqual({ autoFinalized: false, toSignInputs: [{ index: 0, address: session.ordinals.address, sighashTypes: [1], disableTweakSigner: false, useTweakedSigner: true }] });
});
it('rejects missing duplicate out-of-range and mismatched metadata before provider', async () => {
  const { session, request } = fixture('xverse'); const call = vi.fn();
  for (const inputs of [[], [request.inputs[0]!, request.inputs[0]!], [{ ...request.inputs[0]!, index: 3 }], [{ ...request.inputs[0]!, sighash: 2 }], [{ ...request.inputs[0]!, path: { leafHash: '00'.repeat(32) } }]]) {
    await expect(signWithProvider('xverse', { request: call }, session, { ...request, inputs })).rejects.toThrow();
  }
  expect(call).not.toHaveBeenCalled();
});
