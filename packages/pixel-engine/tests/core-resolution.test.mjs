// The engine's new resolution-aware helpers: screenForTarget and rampForTarget.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SCREENS, SCREEN_IDS, SCREEN_KIND, SCREEN_MIN_BAND, TARGET_SCREENS, bandOf, screenForTarget, screenIndex } from "../src/core/dither.js";
import { buildPalette, makePalette, rampBudget, rampForTarget, rampIndicesForTarget } from "../src/core/palette.js";
import { createRoll, seedFromToken, stream } from "../src/core/rng.js";

test("bandOf: by the short side", () => {
  assert.equal(bandOf(32, 32), "tiny");
  assert.equal(bandOf(48, 300), "tiny");
  assert.equal(bandOf(49, 49), "small");
  assert.equal(bandOf(128, 256), "small");
  assert.equal(bandOf(129, 129), "large");
  assert.equal(bandOf(256), "large");
});

test("screenForTarget: family tables, ids kept only where they read", () => {
  assert.deepEqual(screenForTarget(32, 32), { id: "bayer2", steps: 3, bias: 0, family: "ordered", band: "tiny" });
  assert.equal(screenForTarget(128, 128).id, "bayer4");
  assert.equal(screenForTarget(256, 256).id, "bayer8");
  assert.equal(screenForTarget(32, 32, "pattern").id, "checker");
  assert.equal(screenForTarget(64, 64, "dot").id, "halftone");
  assert.equal(screenForTarget(32, 32, "bayer8").id, "bayer2"); // (too coarse for 32: its family stands in)
  assert.equal(screenForTarget(256, 256, "checker").id, "checker"); // (a fine screen reads everywhere)
  assert.equal(screenForTarget(96, 64, "hatch").id, "lines");
  assert.throws(() => screenForTarget(64, 64, "plaid"), RangeError);
  // Every answer is a real screen, reads at its band, and works with screenIndex.
  for (const size of [16, 32, 48, 64, 100, 128, 200, 256, 512]) {
    for (const pref of [...Object.keys(TARGET_SCREENS), ...SCREEN_IDS]) {
      const s = screenForTarget(size, size, pref);
      assert.ok(SCREENS[s.id]);
      assert.ok(["tiny", "small", "large"].indexOf(SCREEN_MIN_BAND[s.id]) <= ["tiny", "small", "large"].indexOf(s.band));
      if (SCREENS[pref]) assert.equal(s.family, SCREEN_KIND[pref][0]);
      const i = screenIndex(0.5, 3, 5, s, 12);
      assert.ok(i >= 0 && i < 12);
      assert.deepEqual(screenForTarget(size, size, pref), s); // (deterministic)
    }
  }
});

test("rampForTarget: shorter ramps for tiny targets, ends kept", () => {
  assert.equal(rampBudget(24), 4);
  assert.equal(rampBudget(32), 5);
  assert.equal(rampBudget(128), 14);
  assert.equal(rampBudget(129), Infinity);
  assert.equal(rampForTarget(22, 32), 5);
  assert.equal(rampForTarget(22, 256), 22);
  assert.equal(rampForTarget(3, 16), 3);
  assert.deepEqual(rampIndicesForTarget(22, 32), [0, 5, 11, 16, 21]);
  assert.deepEqual(rampIndicesForTarget(9, 256), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(rampForTarget({ len: 22, hues: [200] }, 64), { len: 8, hues: [200] });
  assert.throws(() => rampForTarget("x", 32), TypeError);
  for (let t = 1; t <= 30; t += 1) {
    const pal = buildPalette(makePalette(stream(createRoll(seedFromToken(t)), 0)));
    const { base, len } = pal.ramps.key;
    const key = pal.colours.slice(base, base + len);
    for (const side of [16, 24, 32, 48, 64, 96, 128, 256]) {
      const short = rampForTarget(key, side);
      assert.equal(short.length, Math.min(len, rampBudget(side)));
      assert.deepEqual(short[0], key[0]);
      assert.deepEqual(short[short.length - 1], key[len - 1]);
      const idx = rampIndicesForTarget(len, side);
      for (let i = 1; i < idx.length; i += 1) assert.ok(idx[i] > idx[i - 1]);
    }
  }
});
