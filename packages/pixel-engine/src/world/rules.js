// Target-size rules, in one place: what a picture of W x H pixels wants from
// every system so the same world reads at 32 x 32 and at 256 x 256. Fewer
// pixels -> a coarser dither screen, shorter ramps, a tighter frame, the
// camera closer, specks bigger in the world (so they are still a pixel).
//
//   rule          32      64      128     256     (from)
//   screen        2       4       4       8       WALLRUN: 2 at <= 48 px, 4 at <= 128, 8 above
//   screenId      bayer2  bayer4  bayer4  bayer8  core/dither.js screenForTarget (for CPU renderers)
//   steps         3       5       5       7       core/dither.js TARGET_STEPS
//   band          tiny    small   small   large   core/dither.js bandOf
//   dither        0.9     0.9     0.9     0.9     how far the screen reaches between entries
//   pattern       ~0.35   ~0.6    1       1       checker strength (the GPU shader's own curve, for others)
//   fov           0.75    0.94    1.15    1.15    camera/camera.js fovForTarget: 1.15 * clamp((min/128)^0.3, 0.6, 1)
//   arm           0.55    0.73    1       1       WALLRUN: camera distance * clamp((min/128)^0.45, 0.55, 1)
//   particleSize  1.62    1.27    1       1       world size of a speck: clamp((min/128)^-0.35, 1, 1.8)
//   outline       1       1       1       1
//   rampLength    5       8       14      Inf     core/palette.js rampBudget(min)
//
// Every rule can be overridden or LOCKED through the world's settings (a
// value other than "auto" wins -- see RULE_KEYS), or replaced wholesale by
// createWorld({ rules: myRules }).

import { bandOf, screenForTarget } from "../core/dither.js";
import { rampBudget } from "../core/palette.js";
import { fovForTarget } from "../camera/camera.js";

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** The rules for a W x H target (pure: the same numbers everywhere). */
export function targetRules(width, height = width) {
  const min = Math.min(width, height);
  const screen = min <= 48 ? 2 : min <= 128 ? 4 : 8;
  const scr = screenForTarget(width, height, "ordered");
  return {
    width, height, min,
    band: bandOf(width, height),
    screen,
    screenId: scr.id,
    steps: scr.steps,
    dither: 0.9,
    pattern: 0.35 + 0.65 * smooth(28, 96, min),
    fov: fovForTarget(width, height),
    arm: clamp((min / 128) ** 0.45, 0.55, 1),
    particleSize: clamp((min / 128) ** -0.35, 1, 1.8),
    outline: 1,
    rampLength: rampBudget(min),
  };
}

/**
 * Which setting overrides which rule. A setting of "auto" (the engine's
 * default) leaves the rule's own number; anything else replaces it.
 */
export const RULE_KEYS = {
  screen: "render.dither.screen",
  dither: "render.dither.strength",
  outline: "render.outline",
  rampLength: "render.rampLength",
  fov: "system.camera.fov",
  arm: "system.camera.arm",
  particleSize: "system.particles.size",
  pattern: "render.pattern",
};

/** The rules with the settings' overrides applied: { ...rules, from: { rule: "auto" | key } }. */
export function resolveRules(rules, get) {
  const out = { ...rules, from: {} };
  for (const [rule, key] of Object.entries(RULE_KEYS)) {
    const v = get(key);
    if (v === undefined || v === "auto" || v === null) { out.from[rule] = "auto"; continue; }
    out[rule] = rule === "rampLength" && v === "full" ? Infinity : v;
    out.from[rule] = key;
  }
  return out;
}
