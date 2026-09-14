import { randomUUID } from 'node:crypto';
import { createPublicClient, getAddress, http, toHex } from 'viem';
import { prepareContractControl } from '@keel/sdk/contract-controls';
import { inspectContract, rpcUrl, simulateControl } from './contract-rpc.mjs';

const clientFor = url => createPublicClient({ transport: http(rpcUrl(url), { timeout: 15000, retryCount: 0 }) });
const identity = evidence => JSON.stringify([evidence.codeHash, evidence.implementation, evidence.implementationCodeHash, evidence.beacon, evidence.admin]);

// A review is a one-use server-side snapshot, not calldata supplied by a second
// renderer click. Only the wallet can sign. Unknown outcomes are never retried.
export class WalletTransactions {
  constructor(db, wallets, encryption, clients = clientFor) {
    this.db = db; this.wallets = wallets; this.encryption = encryption; this.clients = clients;
    db.exec('CREATE TABLE IF NOT EXISTS wallet_transactions (id TEXT PRIMARY KEY, body TEXT NOT NULL, endpoint BLOB NOT NULL)');
    for (const row of db.prepare("SELECT body FROM wallet_transactions WHERE json_extract(body,'$.status')='awaiting-wallet'").all()) this.save({ ...JSON.parse(row.body), status: 'unknown', message: 'KEEL closed while your wallet was approving. Check the wallet activity before preparing another transaction.' });
  }
  list() { return this.db.prepare('SELECT body FROM wallet_transactions ORDER BY rowid DESC LIMIT 100').all().map(row => JSON.parse(row.body)); }
  get(id) { const row = this.db.prepare('SELECT body,endpoint FROM wallet_transactions WHERE id=?').get(id); if (!row) throw Error('This wallet review is no longer available.'); return { record: JSON.parse(row.body), endpoint: this.encryption.decrypt(row.endpoint) }; }
  save(record) { this.db.prepare('UPDATE wallet_transactions SET body=? WHERE id=?').run(JSON.stringify(record), record.id); return record; }
  async prepare(input) {
    const call = prepareContractControl(input);
    if (call.mode !== 'write') throw Error('Use Read for this contract method.');
    const connection = await this.wallets.refresh(input.installationId);
    const account = getAddress(input.account);
    if (!connection || connection.chainId !== call.chainId || !connection.accounts.some(value => value.toLowerCase() === account.toLowerCase())) throw Error('Connect this account and select the contract’s network in your wallet first.');
    const endpoint = rpcUrl(input.rpcUrl); const client = this.clients(endpoint);
    const simulation = await simulateControl(input, client);
    const gas = await client.estimateGas({ account, to: call.to, data: call.data, value: BigInt(call.valueWei) });
    const gasPrice = await client.getGasPrice();
    const record = { id: randomUUID(), installationId: input.installationId, account, chainId: call.chainId, to: call.to, data: call.data, valueWei: call.valueWei, signature: call.signature, contract: input.contract, evidence: simulation.evidence, gas: gas.toString(), estimatedFeeWei: (gas * gasPrice).toString(), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120000).toISOString(), status: 'review' };
    this.db.prepare('INSERT INTO wallet_transactions VALUES (?,?,?)').run(record.id, JSON.stringify(record), this.encryption.encrypt(endpoint));
    return record;
  }
  cancel(id) { const {record} = this.get(id); if (record.status === 'review') return this.save({ ...record, status: 'cancelled' }); return record; }
  async send(id) {
    const { record, endpoint } = this.get(id);
    if (record.status !== 'review') throw Error('This review has already been used. Check wallet activity.');
    if (Date.parse(record.expiresAt) <= Date.now()) { this.save({ ...record, status: 'expired' }); throw Error('This fee quote has expired. Prepare a fresh review.'); }
    // Reserve before any await, preventing concurrent signing and replay.
    this.save({ ...record, status: 'awaiting-wallet' });
    let requested = false;
    try {
      const client = this.clients(endpoint);
      const evidence = await inspectContract(record.contract, endpoint, client);
      if (identity(evidence) !== identity(record.evidence)) throw Error('Contract or proxy changed since review. Inspect it and prepare again.');
      await client.call({ account: record.account, to: record.to, data: record.data, value: BigInt(record.valueWei) });
      requested = true;
      const hash = await this.wallets.request(record.installationId, 'eth_sendTransaction', [{ from: record.account, to: record.to, data: record.data, value: toHex(BigInt(record.valueWei)), chainId: toHex(record.chainId) }], record);
      if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw Error('Wallet returned no transaction hash. Check its activity before retrying.');
      return this.save({ ...record, status: 'submitted', hash, submittedAt: new Date().toISOString() });
    } catch (error) {
      const status = error.code === 4001 ? 'rejected' : requested ? 'unknown' : 'failed';
      this.save({ ...record, status, message: String(error.message).slice(0,1000) });
      throw error;
    }
  }
  async receipt(id) {
    const { record, endpoint } = this.get(id);
    if (!record.hash) return record;
    const client = this.clients(endpoint);
    if (await client.getChainId() !== record.chainId) throw Error('RPC network changed. Receipt was not verified.');
    let receipt;
    try { receipt = await client.getTransactionReceipt({ hash: record.hash }); }
    catch (error) { if (error.name === 'TransactionReceiptNotFoundError') return this.save({ ...record, status: 'submitted', receipt: undefined }); throw error; }
    const transaction = await client.getTransaction({ hash: record.hash });
    const matches = transaction.from.toLowerCase() === record.account.toLowerCase() && transaction.to?.toLowerCase() === record.to.toLowerCase() && transaction.input.toLowerCase() === record.data.toLowerCase() && transaction.value === BigInt(record.valueWei);
    if (!matches) return this.save({ ...record, status: 'mismatch', message: 'The wallet transaction differs from this review. Inspect the wallet activity.' });
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash) return this.save({ ...record, status: 'submitted', receipt: undefined });
    return this.save({ ...record, status: receipt.status === 'success' ? 'confirmed' : 'reverted', receipt: { blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash, gasUsed: receipt.gasUsed.toString(), checkedAt: new Date().toISOString() } });
  }
}
