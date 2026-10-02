// Checks a proof's reveal file with the protocol's shared verifier, so the
// editor and Studio accept exactly the same files. Runs anywhere (renderer or
// tests); nothing is sent or stored.
import { KEEL_MERKLE_REVEAL_PROTOCOL, KEEL_PROOF_REVEAL_PROTOCOL, normalizeKeelReveal, verifyKeelReveal } from '@keel/protocol';

const MAX_REVEAL_TEXT = 64 * 1024 * 1024;
const HEX64 = /^[0-9a-f]{64}$/iu;

/**
 * Reveal files written by the editor before the shared format carried an
 * extra `verify` hint and file hashes without the 0x prefix. Those are
 * otherwise identical (same commitments and proofs), so they are upgraded
 * in memory before the shared normalizer sees them.
 */
function upgradeEditorDraft(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || typeof value.verify !== 'string') return { value, upgraded: false };
  if (value.protocol !== KEEL_PROOF_REVEAL_PROTOCOL && value.protocol !== KEEL_MERKLE_REVEAL_PROTOCOL) return { value, upgraded: false };
  const prefixed = (hash) => typeof hash === 'string' && HEX64.test(hash) ? `0x${hash.toLowerCase()}` : hash;
  const { verify: _hint, ...rest } = value;
  if (rest.protocol === KEEL_PROOF_REVEAL_PROTOCOL && rest.content?.kind === 'file') rest.content = { ...rest.content, sha256: prefixed(rest.content.sha256) };
  if (rest.protocol === KEEL_MERKLE_REVEAL_PROTOCOL && Array.isArray(rest.items)) rest.items = rest.items.map((item) => item && typeof item === 'object' ? { ...item, sha256: prefixed(item.sha256) } : item);
  return { value: rest, upgraded: true };
}

/** A published digest or root typed by a person: with or without 0x, any case. */
export function normalizePublished(value) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  const hex = text.replace(/^0x/iu, '');
  if (!HEX64.test(hex)) throw new TypeError('The published value is 32 bytes: 0x followed by 64 hex characters.');
  return `0x${hex.toLowerCase()}`;
}

/**
 * Reads a reveal file's JSON text into the shared format, describing what it proves.
 * @param {string} text
 * @returns {{ reveal: import('@keel/protocol').KeelReveal, upgraded: boolean, createdAt: string, kind: 'proof' | 'merkle', published: string, needsFile: boolean, salted?: boolean, fileName?: string, byteLength?: number, textLength?: number, count?: number, files?: string[] }}
 */
export function readRevealFile(text) {
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('Choose a reveal file first.');
  if (text.length > MAX_REVEAL_TEXT) throw new RangeError('That reveal file is too large.');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new TypeError('That file isn’t a reveal file (it isn’t JSON).'); }
  const { value, upgraded } = upgradeEditorDraft(parsed);
  const reveal = normalizeKeelReveal(value);
  const summary = reveal.protocol === KEEL_PROOF_REVEAL_PROTOCOL
    ? { kind: 'proof', published: reveal.commitment.digest, salted: reveal.commitment.salt !== undefined, needsFile: reveal.content.kind === 'file', ...(reveal.content.kind === 'file' ? { fileName: reveal.content.name, byteLength: reveal.content.byteLength } : { textLength: reveal.content.text.length }) }
    : { kind: 'merkle', published: reveal.root, count: reveal.count, needsFile: true, files: reveal.items.map((item) => item.name) };
  return { reveal, upgraded, createdAt: reveal.createdAt, ...summary };
}

/**
 * Checks a reveal file, optionally against a file's bytes and the value that
 * was published. The reason, when present, is plain language from the
 * shared verifier.
 * @param {{ revealText: string, file?: Uint8Array, published?: string }} input
 */
export async function checkRevealFile({ revealText, file, published }) {
  const read = readRevealFile(revealText);
  const expected = normalizePublished(published);
  const result = await verifyKeelReveal(read.reveal, { ...(file ? { file } : {}), ...(expected ? { published: expected } : {}) });
  return { ...result, kind: read.kind, published: read.published, upgraded: read.upgraded, ...(read.kind === 'proof' && read.reveal.content.kind === 'text' ? { text: read.reveal.content.text } : {}) };
}
