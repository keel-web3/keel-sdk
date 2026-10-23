import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
const base = fileURLToPath(new URL('../packages', import.meta.url));
const { encodeKeelAtomicWalletBatch, assertKeelFailedReleaseTransaction } = await import(base + '/sdk/dist/release-wallet-batch.js');
const { encodeKeelReleasePolicy, decodeKeelReleasePolicy, KEEL_MAX_RELEASE_SUPPLY } = await import(base + '/protocol/dist/index.js');
const { parseKeelMediaEditRecipe, ORIGINAL_MEDIA_EDIT_RECIPE } = await import(base + '/builder/dist/media-edit-recipe.js');
const { resolveKeelTransactionGasPolicy, KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP } = await import(base + '/sdk/dist/managed-publication.js');
const creator = '0x1111111111111111111111111111111111111111', target = '0x2222222222222222222222222222222222222222';
for (let n = 1; n <= 8; n++)
    test(`atomic recovery boundary ${n} calls retains exact bytes and rejects every single-call mutation`, () => {
        const calls = Array.from({ length: n }, (_, i) => ({ to: target, data: '0x' + (i + 1).toString(16).padStart(2, '0'), value: '0x0' }));
        const input = { chainId: 11155111, creator, calls, transaction: { chainId: 11155111, from: creator, to: creator, input: encodeKeelAtomicWalletBatch(calls), value: 0n }, receipt: { status: 'reverted', logs: [] } };
        assert.doesNotThrow(() => assertKeelFailedReleaseTransaction(input));
        for (let i = 0; i < n; i++) {
            const altered = calls.map((c, j) => i === j ? { ...c, data: c.data + '00' } : c);
            assert.throws(() => assertKeelFailedReleaseTransaction({ ...input, calls: altered }));
        }
        for (const status of ['success', 'pending', 'unknown', 'cancelled', 'rejected', '0x0', undefined])
            assert.throws(() => assertKeelFailedReleaseTransaction({ ...input, receipt: { status, logs: [] } }));
    });
test('atomic wallet call-count and malformed calldata/value boundaries fail closed', () => {
    for (const n of [0, 9])
        assert.throws(() => encodeKeelAtomicWalletBatch(Array.from({ length: n }, () => ({ to: target, data: '0x', value: '0x0' }))));
    for (const patch of [{ data: '0x1' }, { data: '0xgg' }, { value: '-1' }, { value: '0x' }, { to: '0x0' }])
        assert.throws(() => encodeKeelAtomicWalletBatch([{ to: target, data: '0x', value: '0x0', ...patch }]));
});
test('release policy deterministic property: fixed supply exact for 128 generated uint64-range values', () => {
    let seed = 0x12345678n;
    for (let i = 0; i < 128; i++) {
        seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
        const limit = seed % KEEL_MAX_RELEASE_SUPPLY + 1n;
        const decoded = decodeKeelReleasePolicy(encodeKeelReleasePolicy({ mode: 'fixed', limit }));
        assert.equal(decoded.limit, limit);
        assert.equal(decoded.mode, 'fixed');
    }
    for (const limit of [-1n, 0n, KEEL_MAX_RELEASE_SUPPLY + 1n])
        assert.throws(() => encodeKeelReleasePolicy({ mode: 'fixed', limit }));
});
for (const format of ['webp', 'avif', 'mp4', 'mov', 'webm'])
    test(`media recipe ${format}: quality/dimension/layer exact boundaries`, () => {
        const r = { ...ORIGINAL_MEDIA_EDIT_RECIPE, mode: 'lossless', format };
        for (const quality of [1, 100])
            for (const width of [1, 8192])
                assert.doesNotThrow(() => parseKeelMediaEditRecipe({ ...r, quality, width }));
        for (const quality of [0, 101, 1.1, NaN, Infinity])
            assert.throws(() => parseKeelMediaEditRecipe({ ...r, quality }));
        for (const width of [0, 8193, 0.5, NaN])
            assert.throws(() => parseKeelMediaEditRecipe({ ...r, width }));
        const layer = { left: 0, top: 0, width: 1, height: 1, opacity: 0, rotate: 0 };
        assert.doesNotThrow(() => parseKeelMediaEditRecipe({ ...r, layers: Array(8).fill(layer) }));
        assert.throws(() => parseKeelMediaEditRecipe({ ...r, layers: Array(9).fill(layer) }));
    });
test('original mode rejects every byte-changing edit independently', () => {
    for (const patch of [{ format: 'webp' }, { noSound: true }, { width: 1 }, { height: 1 }, { rotate: 90 }, { crop: { left: 0, top: 0, width: 1, height: 1 } }, { layers: [{ left: 0, top: 0, width: 1, height: 1, opacity: 1, rotate: 0 }] }])
        assert.throws(() => parseKeelMediaEditRecipe({ ...ORIGINAL_MEDIA_EDIT_RECIPE, ...patch }));
});
test('Amsterdam boundary property never relaxes regular execution above 2^24', () => {
    for (const blockGasLimit of [1n, 10000000n, 16777215n, 16777216n, 16777217n, 200000000n, 4294967296n]) {
        const p = resolveKeelTransactionGasPolicy({ chainId: 11155111, blockTimestamp: KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP, blockGasLimit });
        assert.ok(p.maximumExecutionGas <= 16777216n);
        assert.ok(p.maximumTotalGas <= blockGasLimit);
        assert.ok(p.maximumTotalGas <= 4294967295n);
    }
});
