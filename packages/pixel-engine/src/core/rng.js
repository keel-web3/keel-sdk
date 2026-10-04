// KEEL Pixel core -- copied from NOCTURNES src/rng.js (tests/core-equality.test.mjs
// proves every export identical to the original). Change NOCTURNES' copy and
// this one together, or not at all.
//
// Seed arithmetic, in the shape the contract will read it.
//
// A token seed is bytes32 == sixteen big-endian 16-bit words. A trait reads a
// FIXED SLOT, never "the next word", so adding a trait later cannot reshuffle
// tokens that already exist. Slots past 15 are expanded with FNV-1a over the
// seed bytes and the slot index -- 32-bit integer math with an obvious
// Solidity twin, and no hash library in the browser bundle.

const HEX_SEED = /^0x[0-9a-f]{64}$/u;

export function normalizeSeed(value) {
  const clean = String(value ?? "").toLowerCase().replace(/^0x/u, "");
  if (!/^[0-9a-f]+$/u.test(clean) || clean.length > 64) {
    throw new TypeError("Seed must be one to sixty-four hexadecimal digits.");
  }
  const seed = `0x${clean.padStart(64, "0")}`;
  if (!HEX_SEED.test(seed)) throw new TypeError("Seed must resolve to bytes32.");
  return seed;
}

/** Local gallery seeds. A live token is handed the contract's seed instead. */
export function seedFromToken(tokenId, collection = "nocturnes-v0") {
  const index = BigInt(tokenId);
  if (index < 0n) throw new RangeError("Token ID must not be negative.");
  let state = 0x811c9dc5;
  const feed = (text) => {
    for (let at = 0; at < text.length; at += 1) {
      state = Math.imul(state ^ text.charCodeAt(at), 0x01000193) >>> 0;
      state = (state ^ (state >>> 13)) >>> 0;
    }
    return state >>> 0;
  };
  feed(`${collection}:${index}`);
  let hex = "";
  for (let word = 0; word < 8; word += 1) hex += feed(`:${word}`).toString(16).padStart(8, "0");
  return `0x${hex}`;
}

function seedBytes(seed) {
  const clean = normalizeSeed(seed).slice(2);
  const bytes = new Uint8Array(32);
  for (let at = 0; at < 32; at += 1) bytes[at] = Number.parseInt(clean.slice(at * 2, at * 2 + 2), 16);
  return bytes;
}

function expand(bytes, slot) {
  let state = 0x811c9dc5;
  for (const byte of bytes) state = Math.imul(state ^ byte, 0x01000193) >>> 0;
  for (let shift = 0; shift < 32; shift += 8) {
    state = Math.imul(state ^ ((slot >>> shift) & 0xff), 0x01000193) >>> 0;
  }
  state = (state ^ (state >>> 15)) >>> 0;
  return state & 0xffff;
}

/**
 * A reader over one seed. `at(slot)` is stable forever; `sub(slot, n)` gives a
 * private sequence hanging off one slot, for generators (a logo, a lexicon
 * walk) that need many numbers without eating the slot budget.
 */
export function createRoll(seed) {
  const bytes = seedBytes(seed);
  const words = new Uint16Array(16);
  for (let at = 0; at < 16; at += 1) words[at] = (bytes[at * 2] << 8) | bytes[at * 2 + 1];

  const at = (slot) => (slot < 16 ? words[slot] : expand(bytes, slot));

  const api = {
    seed: normalizeSeed(seed),
    at,
    /** Uniform-enough over a 16-bit draw: every table here is far under 256 wide. */
    pick(slot, list) { return list[at(slot) % list.length]; },
    index(slot, length) { return at(slot) % length; },
    range(slot, low, high) { return low + (at(slot) % (high - low + 1)); },
    chance(slot, numerator, denominator = 100) { return at(slot) % denominator < numerator; },
    /** entries: [[value, weight], ...] -- the only shape the catalogue uses. */
    weighted(slot, entries) {
      let total = 0;
      for (const [, weight] of entries) total += weight;
      let ticket = at(slot) % total;
      for (const [value, weight] of entries) {
        if (ticket < weight) return value;
        ticket -= weight;
      }
      return entries[entries.length - 1][0];
    },
    /** A private stream off one slot: sub(slot).next() walks its own words. */
    sub(slot) {
      let cursor = 0;
      const base = 0x10000 + slot * 4096;
      const next = () => expand(bytes, base + cursor++);
      return {
        next,
        index: (length) => next() % length,
        pick: (list) => list[next() % list.length],
        range: (low, high) => low + (next() % (high - low + 1)),
        chance: (numerator, denominator = 100) => next() % denominator < numerator,
        weighted(entries) {
          let total = 0;
          for (const [, weight] of entries) total += weight;
          let ticket = next() % total;
          for (const [value, weight] of entries) {
            if (ticket < weight) return value;
            ticket -= weight;
          }
          return entries[entries.length - 1][0];
        },
      };
    },
  };
  return api;
}

// ---- from NOCTURNES genome.js ----

/**
 * A float/int stream over one seed slot (NOCTURNES genome.js `stream`): the
 * shape every generator draws from. `f()` is a 16-bit draw over 65536, so the
 * stream is exact on every machine.
 */
export function stream(roll, slot) {
  const sub = roll.sub(slot);
  const f = () => sub.next() / 65536;
  return {
    f,
    between: (a, b) => a + (b - a) * f(),
    int: (a, b) => a + Math.floor(f() * (b - a + 1)),
    pick: (list) => list[Math.floor(f() * list.length)],
    chance: (p) => f() < p,
    weighted(entries) {
      let total = 0;
      for (const [, w] of entries) total += w;
      let ticket = f() * total;
      for (const [value, w] of entries) {
        if (ticket < w) return value;
        ticket -= w;
      }
      return entries[entries.length - 1][0];
    },
  };
}

/** A child seed named by a label (NOCTURNES genome.js `deriveSeed`): one seed, many independent assets. */
export function deriveSeed(seed, label) {
  let h = 0x811c9dc5;
  const text = `${seed}:${label}`;
  let hex = "";
  for (let w = 0; w < 8; w += 1) {
    for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    h = Math.imul(h ^ w, 0x01000193) >>> 0;
    hex += (h >>> 0).toString(16).padStart(8, "0");
  }
  return `0x${hex}`;
}
