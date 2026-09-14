// The codec inspector's inputs, shared by main, the renderer and the tests (no
// Node, no engine code): pasted text (KC1:, hex, base64 or base64url) as bytes,
// and the codec records a Game project's files hold -- the Sound tab's
// sound/sound.json (music and sfx documents), KC1: voxels embedded in exported
// pack files, a build's op list (packed by the worker with the builder's
// storeOps), and any file that is a codec document written out as text.

/** A codec document's first byte: 0xB1 names its schema by id, 0xB2 carries it. */
export const HEADER_ID = 0xb1;
export const HEADER_SELF = 0xb2;
export const SOUND_FILE = 'sound/sound.json';
export const SOUND_FORMAT = 'keel-game-sound@1';
export const BUILD_FORMAT = 'keel-game-build@1';
/** Largest document the inspector reads (bytes). */
export const MAX_CODEC_BYTES = 32 * 1024 * 1024;
const BUILD_FILE = /^builds\/([a-z0-9][a-z0-9-]{0,62})\.build\.json$/;
const KC1 = /KC1:[A-Za-z0-9_-]+/g;
const MAX_KC1_PER_FILE = 64;

const STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URLSAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = (() => { const t = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) { t[STD.charCodeAt(i)] = i; t[URLSAFE.charCodeAt(i)] = i; } return t; })();

/** base64 or base64url (padding optional) to bytes; throws on anything else. */
export function fromBase64Any(text) {
  const t = String(text).replace(/=+$/, '');
  if (t.length % 4 === 1) throw Error('This base64 text is cut short (its length is off by one character).');
  const out = new Uint8Array(Math.floor(t.length * 3 / 4));
  let o = 0, acc = 0, n = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    const v = c < 128 ? LOOKUP[c] : -1;
    if (v < 0) throw Error(`Not base64: "${t[i]}" at character ${i + 1}.`);
    acc = (acc << 6) | v; n += 6;
    if (n >= 8) { n -= 8; out[o++] = (acc >> n) & 255; }
  }
  return out.subarray(0, o);
}
function encode64(bytes, alphabet, pad) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    const k = Math.min(3, bytes.length - i) + 1;
    for (let j = 0; j < k; j++) out += alphabet[(n >> (18 - 6 * j)) & 63];
    if (pad) out += '='.repeat(4 - k);
  }
  return out;
}
export const toBase64 = (bytes) => encode64(bytes, STD, true);
export const toBase64Url = (bytes) => encode64(bytes, URLSAFE, false);
export const toHexText = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Is this a codec document (its header names or carries a schema)? */
export const isCodecDocument = (bytes) => !!bytes && ((bytes[0] === HEADER_ID && bytes.length >= 5) || (bytes[0] === HEADER_SELF && bytes.length >= 2));

/**
 * Pasted text as bytes: "KC1:" + base64url (the builder's voxel text), "0x" hex
 * or bare hex, base64 or base64url. Whitespace is ignored. Returns the bytes and
 * which form it read; throws a plain-language error otherwise.
 */
export function parseCodecText(text) {
  const t = String(text ?? '').replace(/\s+/g, '');
  if (!t) throw Error('Paste a codec document: KC1: text, hex (0x…) or base64.');
  let bytes, format;
  if (/^KC1:/i.test(t)) {
    const body = t.slice(4);
    if (!/^[A-Za-z0-9_-]+$/.test(body)) throw Error('KC1: text is base64url after the prefix (letters, digits, - and _).');
    bytes = fromBase64Any(body); format = 'kc1';
  } else if (/^0x/i.test(t)) {
    const body = t.slice(2);
    if (!/^(?:[0-9a-fA-F]{2})*$/.test(body)) throw Error('0x hex is an even number of hex digits.');
    bytes = fromHex(body); format = 'hex';
  } else if (/^(?:[0-9a-fA-F]{2})+$/.test(t)) {
    bytes = fromHex(t); format = 'hex';
  } else if (/^[A-Za-z0-9+/]+={0,2}$/.test(t)) {
    bytes = fromBase64Any(t); format = 'base64';
  } else if (/^[A-Za-z0-9_-]+$/.test(t)) {
    bytes = fromBase64Any(t); format = 'base64url';
  } else throw Error('That isn’t KC1: text, hex or base64 (the inspector reads those forms of a codec document).');
  if (!bytes.length) throw Error('That text holds no bytes.');
  if (bytes.length > MAX_CODEC_BYTES) throw Error(`That document is ${Math.round(bytes.length / 1048576)} MB; the inspector reads up to ${MAX_CODEC_BYTES / 1048576} MB.`);
  return { bytes, format };
}

/** A whole file's trimmed content as a codec document, or null. */
function wholeDocument(content) {
  const t = String(content ?? '').trim();
  if (!t || t.length > MAX_CODEC_BYTES * 2 + 2 || /^KC1:/i.test(t)) return null;
  try { const { bytes, format } = parseCodecText(t); return isCodecDocument(bytes) ? { bytes, format } : null; } catch { return null; }
}
function soundOf(content) {
  let value;
  try { value = JSON.parse(content); } catch { return null; }
  return value && typeof value === 'object' && value.format === SOUND_FORMAT ? value : null;
}
const fileOf = (project, file) => (project?.files ?? []).find((item) => item.name === file || item.id === file);
const kc1Matches = (content) => [...String(content ?? '').matchAll(KC1)].slice(0, MAX_KC1_PER_FILE).map((m) => m[0]);

/**
 * The codec records a project's files hold, for the inspector's list and the
 * assistant: [{ file, record, label, kind }]. `kind`: music (a recipe or a
 * song), sfx, ops (a build's op list), kc1 (voxels), document (a whole file).
 */
export function codecSourcesOf(project) {
  const out = [];
  for (const f of project?.files ?? []) {
    const content = typeof f.content === 'string' ? f.content : '';
    if (f.name === SOUND_FILE) {
      const sound = soundOf(content);
      if (!sound) continue;
      for (const m of Array.isArray(sound.music) ? sound.music : []) {
        if (m && typeof m.id === 'string' && typeof m.bytes === 'string') out.push({ file: f.name, record: `music:${m.id}`, label: `${m.title || m.id} · ${m.kind === 'song' ? 'song' : 'music recipe'}`, kind: 'music' });
      }
      if (typeof sound.sfx === 'string' && sound.sfx) out.push({ file: f.name, record: 'sfx', label: 'Sound effects · sfx settings', kind: 'sfx' });
      continue;
    }
    const build = BUILD_FILE.exec(f.name);
    if (build) {
      try { const value = JSON.parse(content); if (value?.format === BUILD_FORMAT && Array.isArray(value.ops)) out.push({ file: f.name, record: 'ops', label: `Build ${build[1]} · ${value.ops.length} ops, packed`, kind: 'ops' }); } catch { /* A broken build file holds no record. */ }
      continue;
    }
    const kc1 = kc1Matches(content);
    kc1.forEach((text, n) => { try { const bytes = fromBase64Any(text.slice(4)); if (isCodecDocument(bytes)) out.push({ file: f.name, record: `kc1:${n}`, label: `${f.name} · voxels${kc1.length > 1 ? ` #${n + 1}` : ''} (${bytes.length.toLocaleString()} B)`, kind: 'kc1' }); } catch { /* Not a KC1 document. */ } });
    if (kc1.length) continue;
    const whole = wholeDocument(content);
    if (whole) out.push({ file: f.name, record: 'document', label: `${f.name} · ${whole.bytes.length.toLocaleString()} B (${whole.format})`, kind: 'document' });
  }
  return out;
}

/**
 * One record's bytes: { bytes } for a document, { ops } for a build's op list
 * (the worker packs it with the builder's storeOps). Throws when the file or
 * record isn't there.
 */
export function recordBytes(project, file, record) {
  const f = fileOf(project, file);
  if (!f) throw Error(`This project has no saved file ${file}. Save the project first.`);
  const content = typeof f.content === 'string' ? f.content : '';
  const name = f.name;
  if (name === SOUND_FILE) {
    const sound = soundOf(content);
    if (!sound) throw Error(`${name} is not a ${SOUND_FORMAT} file.`);
    let text = null;
    if (record === 'sfx') text = typeof sound.sfx === 'string' ? sound.sfx : null;
    else if (String(record).startsWith('music:')) text = (sound.music ?? []).find((m) => m?.id === String(record).slice(6))?.bytes ?? null;
    if (!text) throw Error(`${name} has no ${record}.`);
    return { bytes: fromBase64Any(text), file: name, record };
  }
  if (record === 'ops') {
    let value;
    try { value = JSON.parse(content); } catch { throw Error(`${name} is not JSON.`); }
    if (value?.format !== BUILD_FORMAT || !Array.isArray(value.ops)) throw Error(`${name} is not a ${BUILD_FORMAT} build.`);
    return { ops: value.ops, file: name, record };
  }
  const kc1 = /^kc1:(\d+)$/.exec(String(record));
  if (kc1) {
    const text = kc1Matches(content)[Number(kc1[1])];
    if (!text) throw Error(`${name} has no KC1 record #${Number(kc1[1]) + 1}.`);
    return { bytes: fromBase64Any(text.slice(4)), file: name, record };
  }
  if (record === 'document' || record === undefined || record === '') {
    const whole = wholeDocument(content);
    if (!whole) throw Error(`${name} is not a codec document written out as text.`);
    return { bytes: whole.bytes, file: name, record: 'document' };
  }
  throw Error(`Unknown record ${record} in ${name}.`);
}
