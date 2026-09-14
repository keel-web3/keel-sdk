import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createTrackedContract } from '@keel/sdk/contract-controls';
import { WalletTransactions } from '../src/wallet-transactions.mjs';
import { walletZipEntries } from '../src/wallet-download.mjs';

const account = '0x2222222222222222222222222222222222222222';
const to = '0x1111111111111111111111111111111111111111';
const hash = '0x' + 'a'.repeat(64); const blockHash = '0x' + 'b'.repeat(64);
const contract = createTrackedContract({ chainId: 31337, address: to, name: 'Test controls', kind: 'custom', source: 'manual', abi: [{ type: 'function', name: 'setValue', stateMutability: 'nonpayable', inputs: [{ name: 'value', type: 'uint256' }], outputs: [] }] });
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); const sent = [];
  const client = { getChainId: async () => 31337, getBlockNumber: async () => 42n, getCode: async () => '0x6000', getStorageAt: async () => '0x' + '0'.repeat(64), call: async () => ({ data: '0x' }), estimateGas: async () => 30000n, getGasPrice: async () => 2n, getBlock: async () => ({ hash: blockHash }) };
  const wallets = { refresh: async () => ({ accounts: [account], chainId: 31337 }), request: async (...args) => { sent.push(args); return hash; } };
  const encryption = { encrypt: value => Buffer.from(value), decrypt: value => Buffer.from(value).toString() };
  const transactions = new WalletTransactions(db, wallets, encryption, () => client);
  const input = { contract, args: ['9007199254740993'], signature: 'setValue(uint256)', account, installationId: 'wallet-fixture', rpcUrl: 'http://127.0.0.1:8545' };
  return { db, client, wallets, transactions, encryption, input, sent };
}
test('review binds exact calldata, account and chain; duplicate submission cannot replay', async t => {
  const f = fixture(t); const review = await f.transactions.prepare(f.input);
  assert.equal(f.sent.length, 0); assert.equal(review.status, 'review'); assert.equal(review.estimatedFeeWei, '60000');
  const [a,b] = await Promise.allSettled([f.transactions.send(review.id),f.transactions.send(review.id)]);
  assert.equal(a.status, 'fulfilled'); assert.equal(b.status, 'rejected'); assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent[0][2], [{ from: account, to, data: review.data, value: '0x0', chainId: '0x7a69' }]);
  assert.equal(f.transactions.list()[0].hash, hash);
});
test('wrong account, network, changed code and expired review cannot reach the wallet', async t => {
  const f = fixture(t); f.wallets.refresh = async () => ({ accounts: [account], chainId: 1 });
  await assert.rejects(f.transactions.prepare(f.input), /select.*network/);
  f.wallets.refresh = async () => ({ accounts: [to], chainId: 31337 });
  await assert.rejects(f.transactions.prepare(f.input), /Connect this account/);
  f.wallets.refresh = async () => ({ accounts: [account], chainId: 31337 });
  const review = await f.transactions.prepare(f.input); f.client.getCode = async () => '0x6001';
  await assert.rejects(f.transactions.send(review.id), /changed since review/); assert.equal(f.sent.length, 0);
  const expired = await f.transactions.prepare(f.input); f.transactions.save({ ...expired, expiresAt: new Date(0).toISOString() });
  await assert.rejects(f.transactions.send(expired.id), /expired/); assert.equal(f.sent.length, 0);
});
test('rejection and uncertain outcomes are distinct and neither retries automatically', async t => {
  const f = fixture(t);
  f.wallets.request = async () => { throw Object.assign(Error('User rejected'), { code: 4001 }); };
  const a = await f.transactions.prepare(f.input); await assert.rejects(f.transactions.send(a.id), /rejected/);
  assert.equal(f.transactions.get(a.id).record.status, 'rejected');
  f.wallets.request = async () => { throw Error('Connection lost'); };
  const b = await f.transactions.prepare(f.input); await assert.rejects(f.transactions.send(b.id), /Connection lost/);
  assert.equal(f.transactions.get(b.id).record.status, 'unknown');
  await assert.rejects(f.transactions.send(b.id), /already been used/);
});
test('restart retains pending recovery; receipts verify actual calldata and canonical block', async t => {
  const f = fixture(t); const a = await f.transactions.prepare(f.input);
  f.transactions.save({ ...a, status: 'awaiting-wallet' });
  const restored = new WalletTransactions(f.db,f.wallets,f.encryption,() => f.client);
  assert.equal(restored.get(a.id).record.status, 'unknown');
  const b = await restored.prepare(f.input); await restored.send(b.id);
  f.client.getTransactionReceipt = async () => ({ status: 'success', blockNumber: 43n, blockHash, gasUsed: 29000n });
  f.client.getTransaction = async () => ({ from: account, to, input: b.data, value: 0n });
  assert.equal((await restored.receipt(b.id)).status, 'confirmed');
  f.client.getBlock = async () => ({ hash: '0x' + 'c'.repeat(64) });
  assert.equal((await restored.receipt(b.id)).status, 'submitted');
  f.client.getTransaction = async () => ({ from: account, to, input: '0x', value: 0n });
  assert.equal((await restored.receipt(b.id)).status, 'mismatch');
});

function zip(name, content = Buffer.from('hello')) {
  const nameBytes = Buffer.from(name), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt32LE(content.length,18); local.writeUInt32LE(content.length,22); local.writeUInt16LE(nameBytes.length,26);
  central.writeUInt32LE(0x02014b50); central.writeUInt32LE(content.length,20); central.writeUInt32LE(content.length,24); central.writeUInt16LE(nameBytes.length,28);
  const start = local.length + nameBytes.length + content.length;
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(central.length + nameBytes.length,12); end.writeUInt32LE(start,16);
  return Buffer.concat([local,nameBytes,content,central,nameBytes,end]);
}
test('wallet ZIP extraction rejects traversal, links, conflicting names, oversize and truncation', () => {
  assert.equal(walletZipEntries(zip('scripts/main.js'))[0].content.toString(), 'hello');
  for (const name of ['../outside','/outside','a/../outside','a\\outside']) assert.throws(() => walletZipEntries(zip(name)), /Unsafe/);
  const linked = zip('linked'); linked.writeUInt32LE(0xa0000000,30 + 6 + 5 + 38); assert.throws(() => walletZipEntries(linked), /Unsafe/);
  const mismatch = zip('test'); mismatch[30] = 120; assert.throws(() => walletZipEntries(mismatch), /identity/);
  const huge = zip('test'); huge.writeUInt32LE(110000000,30 + 4 + 5 + 24); assert.throws(() => walletZipEntries(huge), /limits/);
  assert.throws(() => walletZipEntries(zip('test').subarray(0,20)));
});
