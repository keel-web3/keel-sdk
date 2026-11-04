import { describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { signWithProvider, type LegacySignOptions, type WalletId } from '../src/signing.js';
import type { BtcSession, SignRequest } from '../src/types.js';
import { createTaprootAuctionVault, ECPair } from './taproot-auction-vault.js';

bitcoin.initEccLib(ecc);
const pub = ecc.pointFromScalar(new Uint8Array(32).fill(1), true)!;
const otherPub = ecc.pointFromScalar(new Uint8Array(32).fill(2), true)!;
const key = Buffer.from(pub).toString('hex');

type Input = SignRequest['inputs'][number];
function fixture(walletId: WalletId, mainnet = false) {
  const network = mainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const tr = bitcoin.payments.p2tr({ internalPubkey: pub.slice(1), network });
  const w = bitcoin.payments.p2wpkh({ pubkey: pub, network });
  const session: BtcSession = {
    walletId, network: mainnet ? 'mainnet' : 'testnet3', sharedAddress: false,
    ordinals: { address: tr.address!, addressType: 'p2tr', publicKey: key, purpose: 'ordinals' },
    payment: { address: w.address!, addressType: 'p2wpkh', publicKey: key, purpose: 'payment' },
  };
  const psbt = new bitcoin.Psbt({ network });
  psbt.addInput({ hash: '01'.repeat(32), index: 0, witnessUtxo: { script: tr.output!, value: 1000n }, tapInternalKey: pub.slice(1), sighashType: 1 });
  psbt.addInput({ hash: '02'.repeat(32), index: 0, witnessUtxo: { script: w.output!, value: 1000n }, sighashType: 1 });
  psbt.addOutput({ script: w.output!, value: 1500n });
  const inputs: Input[] = [{ index: 0, account: 'ordinals', sighash: 1, path: 'key' }, { index: 1, account: 'payment', sighash: 1, path: 'key' }];
  return { session, psbt, inputs };
}
function request(psbt: bitcoin.Psbt, inputs: Input[]): SignRequest {
  return { psbtBase64: psbt.toBase64(), inputs };
}
function shared(session: BtcSession) {
  session.sharedAddress = true;
  session.payment = { ...session.ordinals, purpose: 'payment' };
}
function explicitSighash(psbt: bitcoin.Psbt, index: number, value: number) {
  // bip174's update method rejects zero; the explicit zero field serializes correctly.
  psbt.data.inputs[index]!.sighashType = value;
}
function leafHash(script: Uint8Array, version = 0xc0) {
  if (script.length >= 253) throw new Error('Fixture script too large');
  return Buffer.from(bitcoin.crypto.taggedHash('TapLeaf', Buffer.concat([Buffer.from([version, script.length]), Buffer.from(script)]))).toString('hex');
}
function vaultFixture(walletId: 'unisat' | 'okx', includePrevious = true) {
  const { session, psbt } = fixture(walletId);
  shared(session);
  const vault = createTaprootAuctionVault({ ownerPublicKey: pub, coordinatorPublicKey: otherPub, refundAfterHeight: 500, network: bitcoin.networks.testnet });
  const script = Buffer.from(vault.cooperativeScriptHex, 'hex');
  const controlBlock = Buffer.from(vault.cooperativeControlBlockHex, 'hex');
  const previous = new bitcoin.Transaction();
  previous.addInput(Buffer.alloc(32, 3), 0);
  previous.addOutput(Buffer.from(vault.outputScriptHex, 'hex'), 3000n);
  psbt.addInput({
    hash: previous.getId(), index: 0, ...(includePrevious ? { nonWitnessUtxo: previous.toBuffer() } : {}),
    witnessUtxo: { script: Buffer.from(vault.outputScriptHex, 'hex'), value: 3000n },
    tapLeafScript: [{ script, controlBlock, leafVersion: 0xc0 }], sighashType: 131,
  });
  const sibling = controlBlock.subarray(33, 65);
  const hash = Buffer.from(leafHash(script), 'hex');
  const root = bitcoin.crypto.taggedHash('TapBranch', Buffer.compare(hash, sibling) < 0 ? Buffer.concat([hash, sibling]) : Buffer.concat([sibling, hash]));
  psbt.data.inputs[2]!.tapInternalKey = controlBlock.subarray(1, 33);
  psbt.data.inputs[2]!.tapMerkleRoot = root;
  // SIGHASH_SINGLE at input 2 needs an output at the same index.
  psbt.addOutput({ script: psbt.data.inputs[1]!.witnessUtxo!.script, value: 400n });
  psbt.addOutput({ script: psbt.data.inputs[1]!.witnessUtxo!.script, value: 500n });
  const inputs: Input[] = [
    { index: 0, account: 'ordinals', sighash: 1, path: 'key' },
    { index: 2, account: 'payment', sighash: 131, path: { leafHash: leafHash(script) } },
  ];
  return { session, psbt, inputs, vault };
}

it('groups mixed roles in one Xverse prompt without broadcast', async () => {
  const { session, psbt, inputs } = fixture('xverse');
  const req = request(psbt, inputs);
  const call = vi.fn().mockResolvedValue({ status: 'success', result: { psbt: req.psbtBase64 } });
  expect(await signWithProvider('xverse', { request: call }, session, req)).toBe(req.psbtBase64);
  expect(call).toHaveBeenCalledOnce();
  expect(call).toHaveBeenCalledWith('signPsbt', { psbt: req.psbtBase64, broadcast: false, signInputs: { [session.ordinals.address]: [0], [session.payment.address]: [1] } });
});

it.each(['unisat', 'okx'] as const)('%s scopes key and real vault leaf inputs with exact sighash and tweak controls', async wallet => {
  const { session, psbt, inputs, vault } = vaultFixture(wallet);
  expect(session.ordinals.address).not.toBe(vault.address);
  const req = request(psbt, inputs);
  const hex = psbt.toHex();
  const signed = psbt.clone();
  const signer = ECPair.fromPrivateKey(new Uint8Array(32).fill(1));
  signed.signTaprootInput(2, signer, Buffer.from(leafHash(Buffer.from(vault.cooperativeScriptHex, 'hex')), 'hex'), [131]);
  const call = vi.fn().mockResolvedValue(signed.toHex());
  const result = await signWithProvider(wallet, { signPsbt: call }, session, req);
  expect(result).toBe(signed.toBase64());
  const sig = bitcoin.Psbt.fromBase64(result).data.inputs[2]!.tapScriptSig![0]!;
  expect(Buffer.from(sig.pubkey).toString('hex')).toBe(Buffer.from(pub.slice(1)).toString('hex'));
  expect(Buffer.from(sig.leafHash).toString('hex')).toBe(leafHash(Buffer.from(vault.cooperativeScriptHex, 'hex')));
  expect(sig.signature[64]).toBe(131);
  expect(call).toHaveBeenCalledOnce();
  expect(call).toHaveBeenCalledWith(hex, { autoFinalized: false, toSignInputs: [
    { index: 0, address: session.ordinals.address, sighashTypes: [1], disableTweakSigner: false, useTweakedSigner: true },
    { index: 2, publicKey: key, sighashTypes: [131], disableTweakSigner: true, useTweakedSigner: false },
  ] });
});

it('scopes a committed refund leaf to its actual signer', async () => {
  const { session, psbt, inputs, vault } = vaultFixture('unisat');
  const script = Buffer.from(vault.refundScriptHex, 'hex');
  const controlBlock = Buffer.from(vault.refundControlBlockHex, 'hex');
  psbt.data.inputs[2]!.tapLeafScript = [{ script, controlBlock, leafVersion: 0xc0 }];
  inputs[1]!.path = { leafHash: leafHash(script) };
  const signed = psbt.clone();
  signed.signTaprootInput(2, ECPair.fromPrivateKey(new Uint8Array(32).fill(1)), Buffer.from(leafHash(script), 'hex'), [131]);
  const call = vi.fn().mockResolvedValue(signed.toHex());
  expect(await signWithProvider('unisat', { signPsbt: call }, session, request(psbt, [inputs[1]!]))).toBe(signed.toBase64());
  expect(call.mock.calls[0]![1].toSignInputs[0]).toEqual({ index: 2, publicKey: key, sighashTypes: [131], disableTweakSigner: true, useTweakedSigner: false });
});

it.each(['unisat', 'okx'] as const)('%s scopes non-Taproot signing without tweak flags', async wallet => {
  const { session, psbt } = fixture(wallet);
  session.ordinals = { ...session.payment, purpose: 'ordinals' };
  shared(session);
  const call = vi.fn().mockResolvedValue(psbt.toHex());
  await signWithProvider(wallet, { signPsbt: call }, session, request(psbt, [{ index: 1, account: 'payment', sighash: 1, path: 'key' }]));
  expect(call).toHaveBeenCalledWith(psbt.toHex(), { autoFinalized: false, toSignInputs: [{ index: 1, address: session.payment.address, sighashTypes: [1] }] });
});

it.each([['mainnet', 'mainnet'], ['testnet3', 'testnet'], ['signet', 'signet']] as const)('Leather maps %s to %s and scopes the indices', async (selected, expected) => {
  const { session, psbt, inputs } = fixture('leather', selected === 'mainnet');
  session.network = selected;
  const req = request(psbt, inputs);
  const call = vi.fn().mockResolvedValue({ result: { hex: psbt.toHex() } });
  expect(await signWithProvider('leather', { request: call }, session, req)).toBe(req.psbtBase64);
  expect(call).toHaveBeenCalledOnce();
  expect(call).toHaveBeenCalledWith('signPsbt', { hex: psbt.toHex(), signAtIndex: [0, 1], allowedSighash: [1], network: expected, broadcast: false });
});

it('Magic Eden uses the legacy mainnet payload and groups both roles without broadcast', async () => {
  const { session, psbt, inputs } = fixture('magic-eden', true);
  explicitSighash(psbt, 0, 0);
  inputs[0]!.sighash = 0;
  const req = request(psbt, inputs);
  const call = vi.fn((options: LegacySignOptions) => options.onFinish({ psbtBase64: req.psbtBase64 }));
  expect(await signWithProvider('magic-eden', { signTransaction: call }, session, req)).toBe(req.psbtBase64);
  expect(call).toHaveBeenCalledOnce();
  expect(call.mock.calls[0]![0].payload).toEqual({
    network: { type: 'Mainnet' }, message: 'Sign the reviewed transaction.', psbtBase64: req.psbtBase64, broadcast: false,
    inputsToSign: [{ address: session.ordinals.address, signingIndexes: [0] }, { address: session.payment.address, signingIndexes: [1] }],
  });
});

it('transports a real mixed-role signed PSBT from the mock Xverse provider', async () => {
  const { session, psbt, inputs } = fixture('xverse');
  const req = request(psbt, inputs);
  const originalPrivate = new Uint8Array(32).fill(1);
  const internalPrivate = pub[0] === 3 ? ecc.privateNegate(originalPrivate) : originalPrivate;
  const tweak = bitcoin.crypto.taggedHash('TapTweak', pub.slice(1));
  const tweakedPrivate = ecc.privateAdd(internalPrivate, tweak)!;
  const signed = psbt.clone();
  signed.signInput(0, ECPair.fromPrivateKey(tweakedPrivate), [1]);
  signed.signInput(1, ECPair.fromPrivateKey(originalPrivate), [1]);
  const call = vi.fn().mockResolvedValue({ status: 'success', result: { psbt: signed.toBase64() } });
  const returned = bitcoin.Psbt.fromBase64(await signWithProvider('xverse', { request: call }, session, req));
  expect(returned.data.inputs[0]!.tapKeySig).toHaveLength(65);
  expect(returned.data.inputs[1]!.partialSig).toHaveLength(1);
  expect(call).toHaveBeenCalledOnce();
});

it('accepts an explicitly encoded Taproot DEFAULT sighash', async () => {
  const { session, psbt, inputs } = fixture('xverse');
  explicitSighash(psbt, 0, 0);
  inputs[0]!.sighash = 0;
  const req = request(psbt, inputs);
  expect(bitcoin.Psbt.fromBase64(req.psbtBase64).data.inputs[0]!.sighashType).toBe(0);
  const call = vi.fn().mockResolvedValue({ status: 'success', result: { psbt: req.psbtBase64 } });
  await expect(signWithProvider('xverse', { request: call }, session, req)).resolves.toBe(req.psbtBase64);
});

describe('pre-call refusal', () => {
  it('rejects missing, duplicated, out-of-range or invalid inputs', async () => {
    const { session, psbt, inputs } = fixture('xverse');
    const call = vi.fn();
    for (const list of [[], [inputs[0]!, inputs[0]!], [{ ...inputs[0]!, index: -1 }], [{ ...inputs[0]!, index: 2 }], [{ ...inputs[0]!, index: 0.5 }]]) {
      await expect(signWithProvider('xverse', { request: call }, session, request(psbt, list))).rejects.toThrow();
    }
    expect(call).not.toHaveBeenCalled();
  });
  it('rejects absent or mismatched witness, explicit sighash and account role', async () => {
    const { session, psbt, inputs } = fixture('xverse');
    const call = vi.fn();
    await expect(signWithProvider('xverse', { request: call }, session, request(psbt, [{ ...inputs[0]!, sighash: 2 }]))).rejects.toThrow('metadata sighash');
    const missingSighash = psbt.clone(); delete missingSighash.data.inputs[0]!.sighashType;
    await expect(signWithProvider('xverse', { request: call }, session, request(missingSighash, [inputs[0]!]))).rejects.toThrow('metadata sighash');
    const missingUtxo = psbt.clone(); delete missingUtxo.data.inputs[0]!.witnessUtxo;
    await expect(signWithProvider('xverse', { request: call }, session, request(missingUtxo, [inputs[0]!]))).rejects.toThrow('metadata sighash');
    await expect(signWithProvider('xverse', { request: call }, session, request(psbt, [{ ...inputs[0]!, account: 'payment' }]))).rejects.toThrow('Prevout mismatch');
    session.ordinals.purpose = 'payment';
    await expect(signWithProvider('xverse', { request: call }, session, request(psbt, [inputs[0]!]))).rejects.toThrow('Account role mismatch');
    expect(call).not.toHaveBeenCalled();
  });
  it('rejects a mismatched key-path output script, internal key and account key', async () => {
    const { session, psbt, inputs } = fixture('xverse');
    const call = vi.fn();
    const wrongScript = psbt.clone(); wrongScript.data.inputs[0]!.witnessUtxo!.script = wrongScript.data.inputs[1]!.witnessUtxo!.script;
    await expect(signWithProvider('xverse', { request: call }, session, request(wrongScript, [inputs[0]!]))).rejects.toThrow('Prevout mismatch');
    const wrongKey = psbt.clone(); wrongKey.data.inputs[0]!.tapInternalKey = otherPub.slice(1);
    await expect(signWithProvider('xverse', { request: call }, session, request(wrongKey, [inputs[0]!]))).rejects.toThrow('Taproot internal key mismatch');
    session.ordinals.publicKey = Buffer.from(otherPub).toString('hex');
    await expect(signWithProvider('xverse', { request: call }, session, request(psbt, [inputs[0]!]))).rejects.toThrow('Address/key or network mismatch');
    expect(call).not.toHaveBeenCalled();
  });
  it.each(['xverse', 'leather', 'magic-eden'] as const)('%s rejects script path before calling the wallet', async wallet => {
    const { session, psbt, inputs } = fixture(wallet, wallet === 'magic-eden');
    if (wallet === 'magic-eden') { explicitSighash(psbt, 0, 0); inputs[0]!.sighash = 0; }
    inputs[0]!.path = { leafHash: '00'.repeat(32) };
    const call = vi.fn();
    await expect(signWithProvider(wallet, { request: call, signTransaction: call }, session, request(psbt, [inputs[0]!]))).rejects.toThrow('Unsupported script path');
    expect(call).not.toHaveBeenCalled();
  });
  it.each([
    ['xverse', 2], ['leather', 0], ['leather', 2], ['magic-eden', 1], ['magic-eden', 2],
    ['unisat', 4], ['okx', 4],
  ] as const)('%s rejects unsupported sighash %i before calling the wallet', async (wallet, hash) => {
    const { session, psbt, inputs } = fixture(wallet, wallet === 'magic-eden');
    if (wallet === 'unisat' || wallet === 'okx') shared(session);
    explicitSighash(psbt, 0, hash);
    inputs[0]!.sighash = hash;
    const call = vi.fn();
    await expect(signWithProvider(wallet, { request: call, signPsbt: call, signTransaction: call }, session, request(psbt, [inputs[0]!]))).rejects.toThrow('Unsupported');
    expect(call).not.toHaveBeenCalled();
  });
  it.each(['unisat', 'okx'] as const)('%s rejects a mismatched reviewed leaf hash, leaf, control block, signer or metadata', async wallet => {
    const { session, psbt, inputs } = vaultFixture(wallet);
    const call = vi.fn();
    const reject = async (candidate: bitcoin.Psbt, list = inputs, selected = session, message?: string) => {
      const result = expect(signWithProvider(wallet, { signPsbt: call }, selected, request(candidate, list))).rejects;
      if (message) await result.toThrow(message); else await result.toThrow();
    };
    await reject(psbt, [inputs[0]!, { ...inputs[1]!, path: { leafHash: '00'.repeat(32) } }], session, 'Leaf hash mismatch');
    const wrongLeaf = psbt.clone(); wrongLeaf.data.inputs[2]!.tapLeafScript![0]!.script = Buffer.from(wrongLeaf.data.inputs[2]!.tapLeafScript![0]!.script).fill(4, 1, 33);
    await reject(wrongLeaf, inputs, session, 'control block do not commit');
    const wrongControl = psbt.clone(); const control = Buffer.from(wrongControl.data.inputs[2]!.tapLeafScript![0]!.controlBlock); control[control.length - 1] ^= 1; wrongControl.data.inputs[2]!.tapLeafScript![0]!.controlBlock = control;
    await reject(wrongControl, inputs, session, 'control block do not commit');
    const wrongOutput = psbt.clone(); wrongOutput.data.inputs[2]!.witnessUtxo!.script = wrongOutput.data.inputs[0]!.witnessUtxo!.script;
    delete wrongOutput.data.inputs[2]!.nonWitnessUtxo;
    await reject(wrongOutput, inputs, session, 'control block do not commit');
    const wrongPrevious = psbt.clone();
    const previous = bitcoin.Transaction.fromBuffer(wrongPrevious.data.inputs[2]!.nonWitnessUtxo!);
    previous.outs[0]!.value -= 1n;
    wrongPrevious.data.inputs[2]!.nonWitnessUtxo = previous.toBuffer();
    await reject(wrongPrevious, [inputs[1]!], session, 'Previous transaction output mismatch');
    const otherAddress = bitcoin.payments.p2tr({ internalPubkey: otherPub.slice(1), network: bitcoin.networks.testnet }).address!;
    const wrongSigner = { ...session, ordinals: { ...session.ordinals, address: otherAddress, publicKey: Buffer.from(otherPub).toString('hex') }, payment: { ...session.payment, address: otherAddress, publicKey: Buffer.from(otherPub).toString('hex') } };
    // The second vault key is otherPub; use a third valid key for an absent signer.
    const thirdPub = ecc.pointFromScalar(new Uint8Array(32).fill(3), true)!;
    const thirdAddress = bitcoin.payments.p2tr({ internalPubkey: thirdPub.slice(1), network: bitcoin.networks.testnet }).address!;
    wrongSigner.ordinals = { ...wrongSigner.ordinals, address: thirdAddress, publicKey: Buffer.from(thirdPub).toString('hex') };
    wrongSigner.payment = { ...wrongSigner.payment, address: thirdAddress, publicKey: Buffer.from(thirdPub).toString('hex') };
    await reject(psbt, [inputs[1]!], wrongSigner, 'Leaf signer mismatch');
    const mismatchedAccount = { ...session, payment: { ...session.payment, publicKey: Buffer.from(otherPub).toString('hex') } };
    await reject(psbt, [inputs[1]!], mismatchedAccount, 'Address/key or network mismatch');
    const wrongInternal = psbt.clone(); wrongInternal.data.inputs[2]!.tapInternalKey = otherPub.slice(1);
    await reject(wrongInternal, [inputs[1]!], session, 'Taproot internal key mismatch');
    const wrongRoot = psbt.clone(); wrongRoot.data.inputs[2]!.tapMerkleRoot = new Uint8Array(32).fill(9);
    await reject(wrongRoot, [inputs[1]!], session, 'Taproot merkle root mismatch');
    expect(call).not.toHaveBeenCalled();
  });
  it('rejects unknown wallet, network, account role, shared-address claim and missing provider capability', async () => {
    const { session, psbt, inputs } = fixture('xverse');
    const call = vi.fn();
    await expect(signWithProvider('xverse', { request: call }, { ...session, network: 'unknown' as BtcSession['network'] }, request(psbt, inputs))).rejects.toThrow('Unknown network');
    await expect(signWithProvider('xverse', { request: call }, { ...session, walletId: 'okx' }, request(psbt, inputs))).rejects.toThrow('mismatched wallet');
    await expect(signWithProvider('xverse', { request: call }, { ...session, sharedAddress: true }, request(psbt, inputs))).rejects.toThrow('Shared account mismatch');
    await expect(signWithProvider('xverse', { request: call }, session, request(psbt, [{ ...inputs[0]!, account: 'unknown' as Input['account'] }]))).rejects.toThrow('Unknown account role');
    await expect(signWithProvider('xverse', {}, session, request(psbt, inputs))).rejects.toThrow('Missing provider capability');
    expect(call).not.toHaveBeenCalled();
  });
  it.each(['unisat', 'okx'] as const)('%s rejects absent, multiple, or unsupported script paths before signing', async wallet => {
    const { session, psbt, inputs } = vaultFixture(wallet);
    const call = vi.fn();
    const missing = psbt.clone(); delete missing.data.inputs[2]!.tapLeafScript;
    await expect(signWithProvider(wallet, { signPsbt: call }, session, request(missing, [inputs[1]!]))).rejects.toThrow('one exact Taproot script path');
    const multiple = psbt.clone();
    const extra = { ...multiple.data.inputs[2]!.tapLeafScript![0]!, controlBlock: Buffer.from(multiple.data.inputs[2]!.tapLeafScript![0]!.controlBlock) };
    extra.controlBlock[extra.controlBlock.length - 1] ^= 1;
    multiple.data.inputs[2]!.tapLeafScript!.push(extra);
    await expect(signWithProvider(wallet, { signPsbt: call }, session, request(multiple, [inputs[1]!]))).rejects.toThrow('one exact Taproot script path');
    await expect(signWithProvider(wallet, { signPsbt: call }, session, request(psbt, [{ ...inputs[1]!, path: { leafHash: 'xyz' } }]))).rejects.toThrow('Unsupported script path');
    const nonTap = fixture(wallet); nonTap.session.ordinals = { ...nonTap.session.payment, purpose: 'ordinals' }; shared(nonTap.session);
    await expect(signWithProvider(wallet, { signPsbt: call }, nonTap.session, request(nonTap.psbt, [{ index: 1, account: 'ordinals', sighash: 1, path: { leafHash: '00'.repeat(32) } }]))).rejects.toThrow('Unsupported script path');
    expect(call).not.toHaveBeenCalled();
  });
  it('rejects a valid commitment to an unverified future leaf version', async () => {
    const { session, psbt, inputs, vault } = vaultFixture('unisat', false);
    const script = Buffer.from(vault.cooperativeScriptHex, 'hex');
    const payment = bitcoin.payments.p2tr({
      internalPubkey: otherPub.slice(1), scriptTree: { output: script, version: 0xc2 },
      redeem: { output: script, redeemVersion: 0xc2 }, network: bitcoin.networks.testnet,
    });
    psbt.data.inputs[2]!.witnessUtxo!.script = payment.output!;
    psbt.data.inputs[2]!.tapLeafScript = [{ script, controlBlock: payment.witness!.at(-1)!, leafVersion: 0xc2 }];
    delete psbt.data.inputs[2]!.tapInternalKey;
    delete psbt.data.inputs[2]!.tapMerkleRoot;
    inputs[1]!.path = { leafHash: leafHash(script, 0xc2) };
    const call = vi.fn();
    await expect(signWithProvider('unisat', { signPsbt: call }, session, request(psbt, [inputs[1]!]))).rejects.toThrow('Unsupported leaf version');
    expect(call).not.toHaveBeenCalled();
  });
  it.each(['unisat', 'okx'] as const)('%s does not treat a dropped public-key push as a signing key', async wallet => {
    const { session, psbt, inputs } = vaultFixture(wallet, false);
    const script = bitcoin.script.compile([pub.slice(1), bitcoin.opcodes.OP_DROP, bitcoin.opcodes.OP_TRUE]);
    const internalPubkey = otherPub.slice(1);
    const payment = bitcoin.payments.p2tr({ internalPubkey, scriptTree: { output: script }, redeem: { output: script, redeemVersion: 0xc0 }, network: bitcoin.networks.testnet });
    psbt.data.inputs[2]!.witnessUtxo!.script = payment.output!;
    psbt.data.inputs[2]!.tapLeafScript = [{ script, controlBlock: payment.witness!.at(-1)!, leafVersion: 0xc0 }];
    inputs[1]!.path = { leafHash: leafHash(script) };
    const call = vi.fn();
    await expect(signWithProvider(wallet, { signPsbt: call }, session, request(psbt, [inputs[1]!]))).rejects.toThrow('leaf script is unsupported');
    expect(call).not.toHaveBeenCalled();
  });
  it.each([
    ['xverse', 'testnet4'], ['unisat', 'signet'], ['unisat', 'testnet4'], ['unisat', 'regtest'],
    ['okx', 'testnet4'], ['okx', 'regtest'], ['leather', 'testnet4'], ['leather', 'regtest'], ['magic-eden', 'testnet3'],
  ] as const)('%s rejects unverified network %s before calling the wallet', async (wallet, network) => {
    const { session, psbt, inputs } = fixture(wallet);
    session.network = network;
    if (wallet === 'unisat' || wallet === 'okx') shared(session);
    const call = vi.fn();
    await expect(signWithProvider(wallet, { request: call, signPsbt: call, signTransaction: call }, session, request(psbt, inputs))).rejects.toThrow('Unsupported wallet network');
    expect(call).not.toHaveBeenCalled();
  });
});

describe('provider responses', () => {
  it.each(['unisat', 'okx'] as const)('%s rejects malformed returned hex PSBTs', async wallet => {
    const { session, psbt, inputs } = fixture(wallet); shared(session);
    for (const value of ['', '0', '0g', '00', '70736274ff00', null, {}]) {
      await expect(signWithProvider(wallet, { signPsbt: vi.fn().mockResolvedValue(value) }, session, request(psbt, [inputs[0]!]))).rejects.toThrow();
    }
  });
  it.each(['', 'A===', 'YQ', 'YQ==', '!!!!'])('%s is not a valid returned base64 PSBT', async value => {
    const { session, psbt, inputs } = fixture('xverse');
    await expect(signWithProvider('xverse', { request: vi.fn().mockResolvedValue({ status: 'success', result: { psbt: value } }) }, session, request(psbt, inputs))).rejects.toThrow();
  });
  it('rejects a parseable PSBT with trailing bytes in requests and wallet results', async () => {
    const xverse = fixture('xverse');
    const appended = Buffer.concat([xverse.psbt.toBuffer(), Buffer.from([0])]);
    const call = vi.fn().mockResolvedValue({ status: 'success', result: { psbt: appended.toString('base64') } });
    await expect(signWithProvider('xverse', { request: call }, xverse.session, { psbtBase64: appended.toString('base64'), inputs: xverse.inputs })).rejects.toThrow('Invalid PSBT length');
    expect(call).not.toHaveBeenCalled();
    await expect(signWithProvider('xverse', { request: call }, xverse.session, request(xverse.psbt, xverse.inputs))).rejects.toThrow('Invalid PSBT length');
    const unisat = fixture('unisat'); shared(unisat.session);
    const extraHex = Buffer.concat([unisat.psbt.toBuffer(), Buffer.from([1])]).toString('hex');
    await expect(signWithProvider('unisat', { signPsbt: vi.fn().mockResolvedValue(extraHex) }, unisat.session, request(unisat.psbt, [unisat.inputs[0]!]))).rejects.toThrow('Invalid PSBT length');
  });
  it('rejects Xverse error results even if they contain a PSBT', async () => {
    const { session, psbt, inputs } = fixture('xverse');
    await expect(signWithProvider('xverse', { request: vi.fn().mockResolvedValue({ status: 'error', result: { psbt: psbt.toBase64() } }) }, session, request(psbt, inputs))).rejects.toThrow('Xverse signing failed');
  });
  it('rejects malformed Leather and Magic Eden results', async () => {
    const leather = fixture('leather');
    await expect(signWithProvider('leather', { request: vi.fn().mockResolvedValue({ result: { hex: '00zz' } }) }, leather.session, request(leather.psbt, leather.inputs))).rejects.toThrow();
    const magic = fixture('magic-eden', true);
    explicitSighash(magic.psbt, 0, 0); magic.inputs[0]!.sighash = 0;
    await expect(signWithProvider('magic-eden', { signTransaction: ({ onFinish }) => onFinish({ psbtBase64: 'bad!' }) }, magic.session, request(magic.psbt, magic.inputs))).rejects.toThrow();
  });
  it('propagates legacy cancellation and asynchronous provider failure', async () => {
    const { session, psbt, inputs } = fixture('magic-eden', true);
    explicitSighash(psbt, 0, 0); inputs[0]!.sighash = 0;
    const req = request(psbt, inputs);
    await expect(signWithProvider('magic-eden', { signTransaction: ({ onCancel }) => onCancel() }, session, req)).rejects.toThrow('Wallet cancelled');
    await expect(signWithProvider('magic-eden', { signTransaction: async () => { throw new Error('provider failed'); } }, session, req)).rejects.toThrow('provider failed');
  });
});
