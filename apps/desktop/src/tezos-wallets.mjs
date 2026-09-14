import { randomUUID } from 'node:crypto';
import { TezosToolkit } from '@taquito/taquito';
import { validateAddress, validateOperation, ValidationResult, getPkhfromPk, verifySignature } from '@taquito/utils';
import { inspectNetwork } from '@keel/sdk/network-inspection';
import { parseKeelWalletRequest } from '@keel/sdk/wallet-request';
import { rpcUrl } from './contract-rpc.mjs';

export const TEZOS_MAINNET = Object.freeze({ id: 'tezos-mainnet', label: 'Tezos Mainnet', family: 'tezos', rpcUrl: 'https://rpc.tzbeta.net', network: 'NetXdQprcVkpaWU' });
export const TEZOS_SHADOWNET = Object.freeze({ id: 'tezos-shadownet', label: 'Tezos Shadow Net', family: 'tezos', rpcUrl: 'https://rpc.shadownet.teztnets.com', network: 'NetXsqzbfFenSTS' });
export function beaconNetwork(profile) {
  return { type: profile.network === TEZOS_MAINNET.network ? 'mainnet' : 'custom', name: profile.label, rpcUrl: rpcUrl(profile.rpcUrl) };
}
export function tezosAccount(account, profile) {
  if (!account || validateAddress(account.address) !== ValidationResult.VALID || !account.publicKey || getPkhfromPk(account.publicKey) !== account.address) throw Error('The wallet must share a Tezos account and its matching public key.');
  const expected = beaconNetwork(profile);
  if (account.network?.type !== expected.type || (expected.type === 'custom' && rpcUrl(account.network?.rpcUrl) !== expected.rpcUrl)) throw Error('The wallet shared a different network. Connect it to the selected project network.');
  if (!Array.isArray(account.scopes) || !account.scopes.includes('operation_request')) throw Error('The wallet has not granted permission to request operations.');
  return { address: account.address, publicKey: account.publicKey, accountIdentifier: account.accountIdentifier, scopes: account.scopes, wallet: account.wallet, network: profile.network, networkLabel: profile.label };
}
export function tezosMessage(address, network, nonce = randomUUID()) {
  const text = `Tezos Signed Message: wallet.keel.invalid ${new Date().toISOString()} KEEL connection check only. No transfers, approvals, login, or ongoing authority. Account: ${address}. Chain: ${network}. Nonce: ${nonce}`;
  const bytes = Buffer.from(text, 'utf8'); return { text, payload: '0501' + bytes.length.toString(16).padStart(8,'0') + bytes.toString('hex') };
}
const toolkitFor = (profile, account) => {
  const toolkit = new TezosToolkit(rpcUrl(profile.rpcUrl));
  // Estimation needs only public data. This provider cannot sign or expose keys.
  if (account) toolkit.setSignerProvider({ publicKey: async () => account.publicKey, publicKeyHash: async () => account.address, secretKey: async () => { throw Error('Keys stay in your wallet.'); }, sign: async () => { throw Error('Only the connected wallet can sign.'); } });
  return toolkit;
};
const canonical = value => JSON.stringify(value, (_key,v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(key => [key,v[key]])) : v);
const SECRET_FIELD = /(?:private|secret|mnemonic|seed|passphrase)/iu;
const MANAGED_FIELD = new Set(['source', 'fee', 'counter', 'gas_limit', 'storage_limit']);
const NAT = value => typeof value === 'string' && /^(0|[1-9]\d*)$/u.test(value);

function assertNoSecretFields(value, path = 'operation') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoSecretFields(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) throw Error(`Secret-bearing field is not accepted: ${path}.${key}`);
    assertNoSecretFields(child, `${path}.${key}`);
  }
}

/**
 * Validate the partial operation shape Beacon accepts. Wallet-managed fields
 * are deliberately excluded so stale counters, fees, or sources cannot be
 * smuggled into a review after the public estimate.
 */
export function normalizeTezosOperation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('A Tezos operation object is required.');
  assertNoSecretFields(input);
  let operation;
  try { operation = JSON.parse(JSON.stringify(input)); } catch { throw Error('The Tezos operation must be JSON data.'); }
  const keys = Object.keys(operation);
  if (keys.some(key => MANAGED_FIELD.has(key))) throw Error('Remove source, counter, fee, gas_limit, and storage_limit; the connected wallet fills those fields.');
  if (!['transaction', 'origination'].includes(operation.kind)) throw Error('Only staged Tezos transaction and origination operations are supported.');
  if (operation.kind === 'transaction') {
    if (keys.some(key => !new Set(['kind', 'amount', 'destination', 'parameters']).has(key))) throw Error('The transaction contains an unsupported field.');
    if (!NAT(operation.amount)) throw Error('A transaction amount in mutez is required.');
    if (validateAddress(operation.destination) !== ValidationResult.VALID) throw Error('The transaction destination checksum is invalid.');
    if (operation.parameters !== undefined && (!operation.parameters || typeof operation.parameters !== 'object' || Array.isArray(operation.parameters) || typeof operation.parameters.entrypoint !== 'string' || !('value' in operation.parameters))) throw Error('Transaction parameters must contain an entrypoint and Micheline value.');
  } else {
    if (keys.some(key => !new Set(['kind', 'balance', 'script', 'delegate']).has(key))) throw Error('The origination contains an unsupported field.');
    if (!NAT(operation.balance)) throw Error('An origination balance in mutez is required.');
    if (!operation.script || typeof operation.script !== 'object' || Array.isArray(operation.script) || !Array.isArray(operation.script.code) || !('storage' in operation.script)) throw Error('The origination must include Micheline code and storage.');
    if (operation.delegate !== undefined && validateAddress(operation.delegate) !== ValidationResult.VALID) throw Error('The origination delegate checksum is invalid.');
  }
  if (JSON.stringify(operation).length > 5_000_000) throw Error('The staged Tezos operation is larger than the wallet review limit.');
  return operation;
}

export function matchTezosReceipt(contents, record) {
  const expected = record.operation;
  const calls = contents.filter(c => c.kind === expected.kind);
  const allowed = contents.every(c => (c.kind === 'reveal' && c.source === record.address && c.public_key === record.publicKey) || c.kind === expected.kind);
  const call = calls[0];
  if (!allowed || calls.length !== 1 || call.source !== record.address) return false;
  if (expected.kind === 'transaction') return call.destination === expected.destination && call.amount === expected.amount && canonical(call.parameters ?? null) === canonical(expected.parameters ?? null);
  return call.balance === expected.balance && canonical(call.script ?? null) === canonical(expected.script ?? null) && (expected.delegate === undefined || call.delegate === expected.delegate);
}

export class TezosWallets {
  constructor(db, bridge, profiles, encryption, inspect = inspectNetwork, toolkits = toolkitFor) {
    this.db = db; this.bridge = bridge; this.profiles = profiles; this.encryption = encryption; this.inspect = inspect; this.toolkits = toolkits; this.pending = new Set(); this.connections = new Map();
    db.exec('CREATE TABLE IF NOT EXISTS tezos_wallet_sessions (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tezos_wallet_transactions (id TEXT PRIMARY KEY, body TEXT NOT NULL, endpoint BLOB NOT NULL)');
    for (const row of db.prepare("SELECT body FROM tezos_wallet_transactions WHERE json_extract(body,'$.status')='awaiting-wallet'").all()) this.save({ ...JSON.parse(row.body), status: 'unknown', message: 'KEEL closed during wallet approval. Check wallet activity before making another request.' });
  }
  profile(id) { const profile = id === TEZOS_MAINNET.id ? TEZOS_MAINNET : id === TEZOS_SHADOWNET.id ? TEZOS_SHADOWNET : this.profiles(id); if (profile.family !== 'tezos') throw Error('Choose a Tezos network.'); return profile; }
  sessions() { return this.db.prepare('SELECT id, profile_id AS profileId FROM tezos_wallet_sessions').all().map(row => ({ ...row, connection: this.connections.get(row.id), pending: this.pending.has(row.id) })); }
  async exclusive(id, action) { if (this.pending.has(id)) throw Error('Finish the open Tezos wallet request first.'); this.pending.add(id); try { return await action(); } finally { this.pending.delete(id); } }
  async connect(id, profileId) {
    return this.exclusive(id, async () => {
      const profile = this.profile(profileId); await this.inspect(profile);
      const account = tezosAccount(await this.bridge(id, 'connect', { network: beaconNetwork(profile) }, true), profile);
      this.db.prepare('INSERT INTO tezos_wallet_sessions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET profile_id=excluded.profile_id').run(id, profileId);
      this.connections.set(id, account); return account;
    });
  }
  async refresh(id) {
    const row = this.db.prepare('SELECT profile_id FROM tezos_wallet_sessions WHERE id=?').get(id); if (!row) return null;
    try { const raw = await this.bridge(id, 'account'); if (!raw) { this.connections.delete(id); return null; } const account = tezosAccount(raw, this.profile(row.profile_id)); this.connections.set(id, account); return account; }
    catch (error) { this.connections.delete(id); throw error; }
  }
  async disconnect(id) {
    return this.exclusive(id, async () => { await this.bridge(id, 'disconnect'); this.connections.delete(id); this.db.prepare('DELETE FROM tezos_wallet_sessions WHERE id=?').run(id); return { disconnected: true }; });
  }
  async checked(id, expected) {
    const account = await this.refresh(id); const row = this.db.prepare('SELECT profile_id FROM tezos_wallet_sessions WHERE id=?').get(id);
    if (!account || !row) throw Error('Connect your Tezos wallet first.');
    if (expected && (account.address !== expected.address || account.network !== expected.network || account.publicKey !== expected.publicKey)) throw Error('Your wallet account or network changed. Prepare a new review.');
    const profile = this.profile(row.profile_id); await this.inspect(profile); return { account, profile };
  }
  async balance(id) { const {account,profile} = await this.checked(id); return { ...account, balanceMutez: (await this.toolkits(profile).tz.getBalance(account.address)).toFixed(), checkedAt: new Date().toISOString() }; }
  async verify(id) {
    return this.exclusive(id, async () => {
      const {account} = await this.checked(id); if (!account.scopes.includes('sign')) throw Error('Reconnect and allow message signing in your wallet.');
      const message = tezosMessage(account.address, account.network);
      const response = await this.bridge(id, 'sign', { address: account.address, payload: message.payload }, true);
      if (!verifySignature(message.payload, account.publicKey, response.signature)) throw Error('The wallet signature did not match this account.');
      await this.checked(id, account); return { address: account.address, network: account.network, verified: true, checkedAt: new Date().toISOString() };
    });
  }
  list() { return this.db.prepare('SELECT body FROM tezos_wallet_transactions ORDER BY rowid DESC LIMIT 100').all().map(row => JSON.parse(row.body)); }
  get(id) { const row = this.db.prepare('SELECT body,endpoint FROM tezos_wallet_transactions WHERE id=?').get(id); if (!row) throw Error('Unknown Tezos review.'); return { record: JSON.parse(row.body), profile: JSON.parse(this.encryption.decrypt(row.endpoint)) }; }
  save(record) { this.db.prepare('UPDATE tezos_wallet_transactions SET body=? WHERE id=?').run(JSON.stringify(record),record.id); return record; }
  async estimate(profile, account, operation) {
    const toolkit = this.toolkits(profile,account);
    const estimate = operation.kind === 'origination'
      ? await toolkit.estimate.originate({ code: operation.script.code, storage: operation.script.storage, balance: operation.balance, mutez: true, ...(operation.delegate ? { delegate: operation.delegate } : {}) })
      : await toolkit.estimate.transfer({ to: operation.destination, amount: operation.amount, mutez: true, ...(operation.parameters ? { parameter: operation.parameters } : {}) });
    return { gas: String(estimate.gasLimit), storage: String(estimate.storageLimit), feeMutez: String(estimate.suggestedFeeMutez), storageBurnMutez: String(estimate.burnFeeMutez) };
  }
  async prepare(input) {
    const {account, profile} = await this.checked(input.walletId);
    const request = parseKeelWalletRequest({ protocol: 'keel-wallet-request@1', requestId: randomUUID(), label: input.label, family: 'tezos', network: account.network, destination: input.destination, amountMutez: input.amountMutez, ...(input.parameters ? { entrypoint: input.entrypoint || 'default', parameters: input.parameters } : {}) });
    if (validateAddress(request.destination) !== ValidationResult.VALID) throw Error('The destination address checksum is invalid.');
    const operation = { kind: 'transaction', amount: request.amountMutez, destination: request.destination, ...(request.parameters ? { parameters: { entrypoint: request.entrypoint, value: JSON.parse(request.parameters) } } : {}) };
    const estimate = await this.estimate(profile,account,operation);
    const record = { id: randomUUID(), walletId: input.walletId, label: request.label, ...account, operation, estimate, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+120000).toISOString(), status: 'review' };
    this.db.prepare('INSERT INTO tezos_wallet_transactions VALUES (?,?,?)').run(record.id,JSON.stringify(record),this.encryption.encrypt(JSON.stringify(profile))); return record;
  }
  async prepareOperation(input) {
    const {account, profile} = await this.checked(input.walletId);
    const operation = normalizeTezosOperation(input.operation);
    const estimate = await this.estimate(profile, account, operation);
    const record = { id: randomUUID(), walletId: input.walletId, label: input.label, ...account, operation, estimate, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+120000).toISOString(), status: 'review' };
    this.db.prepare('INSERT INTO tezos_wallet_transactions VALUES (?,?,?)').run(record.id,JSON.stringify(record),this.encryption.encrypt(JSON.stringify(profile))); return record;
  }
  cancel(id) { const {record} = this.get(id); return record.status === 'review' ? this.save({...record,status:'cancelled'}) : record; }
  async send(id) {
    const {record,profile} = this.get(id);
    if (record.status !== 'review') throw Error('This review has already been used. Check wallet activity.');
    if (Date.parse(record.expiresAt) <= Date.now()) { this.save({...record,status:'expired'}); throw Error('This fee quote expired. Prepare a fresh review.'); }
    this.save({...record,status:'awaiting-wallet'});
    let requested = false;
    try {
      return await this.exclusive(record.walletId, async () => {
        const {account} = await this.checked(record.walletId,record); await this.inspect(profile);
        await this.estimate(profile,account,record.operation);
        requested = true;
        const response = await this.bridge(record.walletId,'operation',{address:record.address,network:beaconNetwork(profile),operation:record.operation},true);
        if (validateOperation(response.transactionHash) !== ValidationResult.VALID) throw Error('Wallet returned no valid operation hash. Check its activity.');
        return this.save({...record,status:'submitted',hash:response.transactionHash,submittedAt:new Date().toISOString()});
      });
    } catch (error) { this.save({...record,status:error.code === 'ABORTED_ERROR' ? 'rejected' : requested ? 'unknown' : 'failed',message:String(error.message).slice(0,1000)}); throw error; }
  }
  async receipt(id) {
    const {record,profile} = this.get(id); if (!record.hash) return record;
    await this.inspect(profile); const toolkit = this.toolkits(profile); const head = await toolkit.rpc.getBlockHeader();
    // Scan a bounded recent window, or recheck the previously observed inclusion.
    const levels = record.receipt ? [record.receipt.level] : Array.from({length:Math.min(60,head.level+1)},(_,i)=>head.level-i);
    for (const level of levels) {
      const block = await toolkit.rpc.getBlock({block:String(level)}); const operation = block.operations.flat().find(item=>item.hash===record.hash);
      if (!operation) continue;
      if (!matchTezosReceipt(operation.contents,record)) return this.save({...record,status:'mismatch',message:'The onchain operation differs from this review.'});
      const applied = operation.contents.every(c=>c.metadata?.operation_result?.status === 'applied' && (c.metadata?.internal_operation_results ?? []).every(inner=>inner.result?.status === 'applied'));
      const canonicalBlock = await toolkit.rpc.getBlockHash({block:String(level)});
      if (canonicalBlock !== block.hash) break;
      return this.save({...record,status:applied ? 'included' : 'failed',receipt:{level,blockHash:block.hash,confirmations:head.level-level+1,checkedAt:new Date().toISOString()},message:applied ? 'Included on the selected chain. Confirmation count can change after a reorganization.' : 'The operation was included but did not apply.'});
    }
    return this.save({...record,status:'submitted',receipt:undefined,message:'Not found in the last 60 blocks. Check your wallet or explorer; do not resend automatically.'});
  }
}
