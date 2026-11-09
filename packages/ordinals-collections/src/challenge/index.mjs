import { sha as hash } from '../core.ts';
import { Bytes } from '../bytes.mjs';
import { parseTx, merkle } from '../core.ts';
const hash2 = b => hash(hash(b));
const raw = (v, n) => typeof v === 'string' && new RegExp(`^[0-9a-fA-F]{${n*2}}$`).test(v) ? Bytes.from(v, 'hex') : null;
const uint = n => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff;
// A Bitcoin header does not commit to the transaction count separately. Require
// the complete block so that count and every leaf are bound to its Merkle root.
// Consensus admission and the selected best-chain header are caller boundaries.
export function verifyPosition(proof, entry, hostHashes) {
  try {
    const header = raw(proof.header,80), txid = raw(proof.mint,32);
    if (!header || !txid || proof.mint !== entry.txid || proof.height !== entry.height || proof.txIndex !== entry.txIndex || !uint(proof.total) || !uint(proof.txIndex) || proof.total < 1 || proof.txIndex >= proof.total || hash2(header).toString('hex') !== hostHashes[proof.height] || !Array.isArray(proof.branch)) return false;
    if (typeof proof.rawBlock !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(proof.rawBlock) || proof.rawBlock.length > 8_000_000) return false;
    const block = Bytes.from(proof.rawBlock, 'hex');
    if (block.length < 81 || !block.subarray(0,80).equals(header)) return false;
    let pos = 80, total = block[pos++];
    if (total === 253) {
      if (pos + 2 > block.length) return false;
      total = block.readUInt16LE(pos); pos += 2;
      if (total < 253) return false;
    } else if (total === 254) {
      if (pos + 4 > block.length) return false;
      total = block.readUInt32LE(pos); pos += 4;
      if (total <= 65535) return false;
    } else if (total === 255) return false;
    if (total !== proof.total || total > 100000 || total > block.length - pos) return false;
    const ids = [];
    for (let j = 0; j < total; j++) {
      const tx = parseTx(block, pos);
      if (j === proof.txIndex && tx.strippedHex.length === 128) return false;
      ids.push(tx.txid); pos = tx.end;
    }
    if (pos !== block.length || ids[proof.txIndex] !== proof.mint || !merkle(ids, true).equals(header.subarray(36,68))) return false;
    let h = txid, n = total, i = proof.txIndex, depth = 0;
    while (n > 1) {
      const sibling = raw(proof.branch[depth++],32), missing = (i ^ 1) >= n;
      if (!sibling || (missing ? !sibling.equals(h) : sibling.equals(h))) return false;
      h = hash2(i % 2 ? Bytes.concat([sibling,h]) : Bytes.concat([h,sibling]));
      i = Math.floor(i/2); n = Math.ceil(n/2);
    }
    return depth === proof.branch.length && h.equals(header.subarray(36,68));
  } catch { return false; }
}
// resolveEntry must independently return {entry, validity: 'valid'|'invalid'|'unknown'}.
export function validateChallenge(c, cache, resolveEntry, hostHashes) {
  if (!c || c.r !== cache.r || c.index !== cache.id) return false;
  const found = cache.entries.find(x => x.txid === c.mint), result = resolveEntry(c.mint), target = result?.entry;
  if (!target || target.txid !== c.mint) return false;
  if (c.kind === 'omitted') return result.validity === 'valid' && !found && target.height <= cache.h && verifyPosition(c,target,hostHashes);
  if (c.kind === 'invalid') return !!found && (result.validity === 'invalid' || (result.validity === 'valid' && verifyPosition(c,target,hostHashes) && (found.height !== target.height || found.txIndex !== target.txIndex)));
  if (c.kind === 'order') {
    const other = resolveEntry(c.other?.mint)?.entry, a = cache.entries.findIndex(x => x.txid === c.mint), b = cache.entries.findIndex(x => x.txid === c.other?.mint);
    return !!other && a >= 0 && b > a && verifyPosition(c,target,hostHashes) && verifyPosition(c.other,other,hostHashes) && (target.height > other.height || (target.height === other.height && target.txIndex > other.txIndex));
  }
  return false;
}
export function applyChallenge(entries, challenge, resolveEntry) {
  let rows = entries.slice();
  if (challenge.kind === 'omitted' && !rows.some(x => x.txid === challenge.mint)) {
    const result = resolveEntry(challenge.mint);
    if (!result?.entry || result.validity !== 'valid') throw Error('missing validated entry');
    rows.push(result.entry);
  } else if (challenge.kind === 'invalid') rows = rows.filter(x => x.txid !== challenge.mint);
  return rows.sort((a,b) => a.height-b.height || a.txIndex-b.txIndex);
}
