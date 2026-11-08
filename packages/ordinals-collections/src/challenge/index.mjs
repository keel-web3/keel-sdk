import { createHash } from 'node:crypto';
const hash = b => createHash('sha256').update(b).digest();
const hash2 = b => hash(hash(b));
const raw = (v, n) => typeof v === 'string' && new RegExp(`^[0-9a-fA-F]{${n*2}}$`).test(v) ? Buffer.from(v, 'hex') : null;
const uint = n => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff;
export function verifyPosition(proof, entry, hostHashes) {
  try {
    const header = raw(proof.header,80), txid = raw(proof.mint,32);
    if (!header || !txid || proof.mint !== entry.txid || proof.height !== entry.height || proof.txIndex !== entry.txIndex || !uint(proof.total) || !uint(proof.txIndex) || proof.total < 1 || proof.txIndex >= proof.total || hash2(header).toString('hex') !== hostHashes[proof.height] || !Array.isArray(proof.branch)) return false;
    let h = txid, n = proof.total, i = proof.txIndex, depth = 0;
    while (n > 1) {
      const sibling = raw(proof.branch[depth++],32);
      if (!sibling || ((i ^ 1) >= n && !sibling.equals(h))) return false;
      h = hash2(i % 2 ? Buffer.concat([sibling,h]) : Buffer.concat([h,sibling]));
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
