// What NOCTURNES makes, fingerprinted: the engine's first project is also its
// guard. Nothing the engine does may change a pixel of it -- its genomes, its
// rendered loops (seeds and every showcase recipe), its click frames, its GIF
// bytes, its music plans. `npm run guard:capture` records them;
// `npm run guard` checks them and names exactly what moved.
//
// NOCTURNES is read from its own repo (../keel-nocturnes, or NOCTURNES=path).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const NOCTURNES = resolve(process.env.NOCTURNES ?? resolve(here, "../../keel-nocturnes"));

const fnv = (text) => { let h = 2166136261; for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0).toString(16).padStart(8, "0"); };
const fnvBytes = (arrs) => { let h = 2166136261; for (const a of arrs) for (let i = 0; i < a.length; i += 1) h = Math.imul(h ^ a[i], 16777619); return (h >>> 0).toString(16).padStart(8, "0"); };
// (Plain data only: functions and typed arrays are what the data makes, not what it is.)
const plain = (_, v) => (typeof v === "function" ? undefined : ArrayBuffer.isView(v) ? `bytes:${fnvBytes([v])}` : v);

export async function fingerprint({ quick = false } = {}) {
  const N = (p) => import(`${NOCTURNES}/src/${p}`);
  const { makeGenome } = await N("genome.js");
  const { seedFromToken } = await N("rng.js");
  const { createRenderer, renderGenome } = await N("render.js");
  const { genomeFromRecipe } = await N("recipe.js");
  const { encodeGif } = await N("gif.js");
  const { scoreOf } = await N("music.js");
  const { planNext, applyStates } = await N("states.js");
  const out = {};
  const W = 96;
  const H = 72;
  const loopHash = (g) => {
    g.viewSize = { width: W, height: H };
    const r = createRenderer(g, { width: W, height: H });
    const it = r.loop();
    let s = it.next();
    while (!s.done) s = it.next();
    return { r, hash: fnvBytes(s.value.frames.map((f) => f.pixels)) };
  };
  const tokens = quick ? [1, 7, 26] : [...Array(16).keys()].map((i) => i + 1).concat([26, 36, 69, 88, 101, 131, 173]);
  for (let t = 1; t <= (quick ? 10 : 80); t += 1) out[`genome #${t}`] = fnv(JSON.stringify(makeGenome(seedFromToken(t)), plain));
  for (const t of tokens) {
    const g = makeGenome(seedFromToken(t));
    const { r, hash } = loopHash(g);
    out[`loop #${t}`] = hash;
    // (The first permanent click it has: the landed frame, and the room it leaves.)
    const c = g.clicks.find((x) => x.perm && !x.camera);
    const plan = c && planNext(g, c.object, c);
    if (plan) {
      out[`click #${t} ${c.effect}`] = fnvBytes([r.frame(20, [{ ...c, ...(plan.play ?? {}), v: plan.v, u: 1 }], null)]);
      out[`room after #${t}`] = loopHash(applyStates(g, { [plan.key ?? c.object]: plan.state })).hash;
    }
  }
  if (!quick) {
    const scenes = JSON.parse(readFileSync(`${NOCTURNES}/showcase/scenes.json`, "utf8"));
    for (const sc of scenes) out[`showcase ${sc.slug}`] = loopHash(genomeFromRecipe(sc.recipe)).hash;
    for (const t of [1, 9, 24]) { const g = makeGenome(seedFromToken(t)); g.viewSize = { width: 64, height: 48 }; out[`gif #${t}`] = fnvBytes([encodeGif(renderGenome(g, { width: 64, height: 48 }))]); }
  }
  for (let t = 1; t <= (quick ? 10 : 80); t += 1) out[`music #${t}`] = fnv(JSON.stringify(scoreOf(makeGenome(seedFromToken(t))), plain));
  return out;
}
