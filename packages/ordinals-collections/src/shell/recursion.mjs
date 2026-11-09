import { b, hex, reverse, u32, parseTx, parseOrdEnvelopes, decodeCbor, authenticateCommit, cat, zero } from '../core.ts';

export class IncompleteEvidence extends Error {}
export function routeId(id) {
  const match = /^([a-f0-9]{64})i(0|[1-9][0-9]*)$/.exec(id);
  if (!match || Number(match[2]) > 0xffffffff) throw Error('invalid inscription ID');
  return hex(cat(reverse(match[1]), u32(Number(match[2]))));
}
export function inscriptionId(route) {
  if (!/^[a-f0-9]{72}$/.test(route)) throw Error('invalid route ID');
  return `${hex(reverse(b(route).subarray(0,32)))}i${b(route).readUInt32BE(32)}`;
}
export function selfFromLocation(location) {
  const match = /^\/(?:content|preview|inscription)\/([a-f0-9]{64}i[0-9]+)\/?$/.exec(location?.pathname ?? '');
  if (!match) throw Error('S1: self ID missing from location');
  return routeId(match[1]);
}
export const normalize = value => value instanceof Uint8Array ? hex(value) : Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k,normalize(v)])) : value;
const uint = n => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff;

// Each instance is a single load snapshot. Never use shared browser storage as evidence.
export class Recursion {
  constructor({fetcher = globalThis.fetch, maxBytes = 16_000_000, maxFetches = 100_000} = {}) {
    this.fetcher = fetcher; this.maxBytes = maxBytes; this.maxFetches = maxFetches;
    this.cache = new Map(); this.records = new Map(); this.stats = {fetches:0,bytes:0};
  }
  get(path) {
    if (!/^\/r\/(?:tx\/[a-f0-9]{64}|inscription\/[a-f0-9]{64}i[0-9]+|children\/[a-f0-9]{64}i[0-9]+\/inscriptions\/[0-9]+|blockheight|blockhash\/[0-9]+|blockinfo\/[0-9]+|block\/[0-9]+)$/.test(path)) throw Error('non-recursion request refused');
    if (!this.cache.has(path)) this.cache.set(path, this.request(path));
    return this.cache.get(path);
  }
  async request(path) {
    if (++this.stats.fetches > this.maxFetches) throw new IncompleteEvidence('recursion fetch budget exhausted');
    let response;
    try { response = await this.fetcher.call(globalThis, path, {redirect:'error', signal:AbortSignal.timeout(30_000)}); }
    catch { throw new IncompleteEvidence('recursion unavailable'); }
    if (!response.ok) throw new IncompleteEvidence(`recursion HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw new IncompleteEvidence('empty recursion response');
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const {done,value} = await reader.read(); if (done) break;
        size += value.length; this.stats.bytes += value.length;
        if (size > this.maxBytes) { await reader.cancel(); throw new IncompleteEvidence('recursion response budget exhausted'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const text = new TextDecoder('utf-8',{fatal:true}).decode(cat(...chunks));
    try { return JSON.parse(text); } catch { return text.trim(); }
  }
  async tx(internal) {
    const raw = await this.get(`/r/tx/${hex(reverse(internal))}`);
    if (typeof raw !== 'string' || !/^(?:[a-f0-9]{2})+$/.test(raw)) throw Error('S2: malformed transaction hex');
    const parsed = parseTx(raw);
    if (parsed.txid !== internal || parsed.end !== b(raw).length) throw Error('S2: reveal txid mismatch');
    return {raw,parsed};
  }
  record(route) {
    if (!this.records.has(route)) this.records.set(route,this.readRecord(route));
    return this.records.get(route);
  }
  async readRecord(route) {
    const id = inscriptionId(route), info = await this.get(`/r/inscription/${id}`);
    if (info.id !== undefined && info.id !== id) throw Error('inscription ID mismatch');
    if (!uint(info.height) || !Array.isArray(info.charms)) throw new IncompleteEvidence('confirmation or charms unavailable');
    const {raw,parsed:tx} = await this.tx(route.slice(0,64));
    let index = 0, selected;
    for (let vin = 0; vin < tx.inputs.length; vin++) {
      const witness = [...tx.inputs[vin].witness];
      if (witness.length >= 2 && witness.at(-1).startsWith('50')) witness.pop();
      if (witness.length < 2) continue;
      let envelopes; try { envelopes = parseOrdEnvelopes(witness.at(-2)); } catch { continue; }
      for (const envelope of envelopes) if (index++ === b(route).readUInt32BE(32)) selected = {envelope,vin};
    }
    if (!selected) throw Error('inscription envelope missing');
    const {envelope,vin} = selected, fields = new Map(); let i = 0;
    while (i < envelope.payload.length && envelope.payload[i].length) {
      const tag = hex(envelope.payload[i++]), value = envelope.payload[i++];
      if (!value || (fields.has(tag) && !['05','03'].includes(tag))) throw Error('malformed inscription fields');
      fields.set(tag,cat(fields.get(tag) ?? zero(0),value));
    }
    const body = cat(...envelope.payload.slice(i+1));
    const commit = await this.tx(tx.inputs[vin].txid);
    if (!authenticateCommit(raw,commit.raw,vin)) throw Error('commit-authentication');
    let metadata = null;
    if (fields.has('05')) metadata = decodeCbor(fields.get('05'));
    return {id:route,info,rawTx:raw,commitTx:commit.raw,tx,metadata,body,tag7:fields.get('07')?.toString('utf8'),height:info.height};
  }
  async hash(height) {
    const value = await this.get(`/r/blockhash/${height}`);
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw Error('invalid block hash');
    return hex(reverse(value));
  }
}

// Walk the authority's paged children, in server child order. The server's
// UTXO/sat walk is behind this endpoint; no spender or non-/r/ request is used.
export async function walk(authority, {client = new Recursion(), maxPages = 64, maxChildren = 64_000} = {}) {
  const records = [], ignored = [];
  for (let page = 0; page < maxPages; page++) {
    const result = await client.get(`/r/children/${inscriptionId(authority)}/inscriptions/${page}`);
    const children = result.children ?? result.inscriptions;
    if (!Array.isArray(children) || typeof result.more !== 'boolean') throw new IncompleteEvidence('malformed children page');
    for (const child of children) {
      if (records.length + ignored.length >= maxChildren) throw new IncompleteEvidence('children budget exhausted');
      const id = routeId(typeof child === 'string' ? child : child.id);
      try { records.push(await client.record(id)); }
      catch (error) { if (error instanceof IncompleteEvidence) throw error; ignored.push({id,reason:error.message}); }
    }
    if (!result.more) return {records,ignored};
  }
  throw new IncompleteEvidence('children page budget exhausted');
}
