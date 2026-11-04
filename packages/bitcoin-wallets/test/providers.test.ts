import { describe, it, expect, vi } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { connectLeather, connectMagicEden, unwrapWalletResponse, WalletProviderError, type MagicEdenTransport } from "../src/providers.js";
bitcoin.initEccLib(ecc);
const key = Buffer.from(ecc.pointFromScalar(Buffer.from('01'.padStart(64, '0'), 'hex'), true)!);
const publicKey = key.toString('hex');
const tap = bitcoin.payments.p2tr({ internalPubkey: key.subarray(1) });
const segwit = bitcoin.payments.p2wpkh({ pubkey: key });
const leather = [{ type: 'p2wpkh', address: segwit.address, publicKey, fingerprint: '12345678', derivationPath: "m/84'/0'/0'" }, { type: 'p2tr', address: tap.address, publicKey, tweakedPublicKey: Buffer.from(tap.output!.slice(2)).toString('hex') }];
const me = [{ purpose: 'payment', address: segwit.address, publicKey }, { purpose: 'ordinals', address: tap.address, publicKey }];
const request = (addresses: unknown[]) => vi.fn(async () => ({ result: { addresses } }));
function transport(fn: MagicEdenTransport<object>['getAddress']): MagicEdenTransport<object> { return { provider: {}, getAddress: fn }; }
describe('wallet providers', () => {
  it('preserves RPC rejection, provider and unsupported codes and causes', () => {
    for (const [code, kind] of [[-32000, 'rejected'], ['USER_REJECTION', 'rejected'], [-32601, 'unsupported'], ['OTHER', 'provider']] as const) {
      const cause = { code, message: 'failure' };
      try { unwrapWalletResponse({ status: 'error', error: cause }); throw Error('expected error'); } catch (e) { expect(e).toBeInstanceOf(WalletProviderError); expect(e).toMatchObject({ code, kind, cause }); }
    }
    expect(() => unwrapWalletResponse({})).toThrowError(expect.objectContaining({ kind: 'malformed' }));
  });
  it('connects reordered Leather accounts and validates keys and paths', async () => {
    const call = request(leather); const result = await connectLeather({ request: call }, 'mainnet');
    expect(call).toHaveBeenCalledWith('getAddresses', { network: 'mainnet' });
    expect(result.ordinals.address).toBe(tap.address); expect(result.payment.bip32?.fingerprint).toBe('12345678');
  });
  it('rejects unsupported network, vault, incomplete roles and bad tweaked keys', async () => {
    const call = request(leather);
    await expect(connectLeather({ request: call }, 'testnet4')).rejects.toMatchObject({ kind: 'unsupported' }); expect(call).not.toHaveBeenCalled();
    await expect(connectLeather({ request: request([...leather, { type: 'p2wsh' }]) }, 'mainnet')).rejects.toMatchObject({ kind: 'unsupported' });
    await expect(connectLeather({ request: request([leather[0]]) }, 'mainnet')).rejects.toMatchObject({ kind: 'malformed' });
    await expect(connectLeather({ request: request([leather[0], { ...leather[1], tweakedPublicKey: '00'.repeat(32) }]) }, 'mainnet')).rejects.toMatchObject({ kind: 'malformed' });
  });
  it('connects Magic Eden using explicit legacy callback transport', async () => {
    const getAddress = vi.fn(async (opts: Parameters<MagicEdenTransport<object>['getAddress']>[0]) => { expect(await opts.getProvider()).toBe(provider); expect(opts.payload.network.type).toBe('Mainnet'); opts.onFinish({ addresses: me }); });
    const provider = {}; const result = await connectMagicEden({ provider, getAddress }, 'mainnet');
    expect(result.payment.address).toBe(segwit.address); expect(result.ordinals.address).toBe(tap.address);
  });
  it('distinguishes Magic Eden cancel, provider errors, incomplete roles and network', async () => {
    await expect(connectMagicEden(transport(o => o.onCancel()), 'mainnet')).rejects.toMatchObject({ kind: 'rejected' });
    const cause = { code: 123, message: 'bad' };
    await expect(connectMagicEden(transport(async () => { throw cause; }), 'mainnet')).rejects.toMatchObject({ kind: 'provider', code: 123, cause });
    await expect(connectMagicEden(transport(o => o.onFinish({ addresses: [me[0]] })), 'mainnet')).rejects.toMatchObject({ kind: 'malformed' });
    const call = vi.fn(); await expect(connectMagicEden(transport(call), 'signet')).rejects.toMatchObject({ kind: 'unsupported' }); expect(call).not.toHaveBeenCalled();
  });
});
