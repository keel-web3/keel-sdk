// Seeded streams a world can SAVE. core/rng.js `stream(roll, slot)` keeps its
// cursor in a closure; these keep it in the open (`cursor`), so a snapshot
// can write it down and a restore can put it back. The numbers are exactly
// rng.js's: named(seed, "x").f() walks the same words as
// stream(createRoll(deriveSeed(seed, "x")), 0).f() (tests/world.test.mjs checks).
//
// One stream per name, each off its own derived seed, so two systems never
// share a stream and adding draws to one never moves another.

import { createRoll, deriveSeed } from "../core/rng.js";

const BASE = 0x10000; // (rng.js sub(0): its words start here)

/** A stream for `name` under a world seed: { f, between, int, pick, chance, weighted, cursor }. */
export function namedStream(seed, name, cursor = 0) {
  const roll = createRoll(deriveSeed(String(seed), name));
  const S = {
    name,
    cursor,
    f: () => roll.at(BASE + S.cursor++) / 65536,
    between: (a, b) => a + (b - a) * S.f(),
    int: (a, b) => a + Math.floor(S.f() * (b - a + 1)),
    pick: (list) => list[Math.floor(S.f() * list.length)],
    chance: (p) => S.f() < p,
    weighted(entries) {
      let total = 0;
      for (const [, w] of entries) total += w;
      let ticket = S.f() * total;
      for (const [value, w] of entries) {
        if (ticket < w) return value;
        ticket -= w;
      }
      return entries[entries.length - 1][0];
    },
  };
  return S;
}

/**
 * A world seed as bytes32 hex (what src/object's buildPiece and core/rng want):
 * hex seeds pass through, anything else ("1", "garden") is derived from its text.
 */
export function worldSeed(seed) {
  const t = String(seed);
  return /^0x[0-9a-f]{64}$/i.test(t) ? t.toLowerCase() : deriveSeed("keel-world", t);
}
