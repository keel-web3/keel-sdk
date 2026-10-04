// A READ-ONLY audit of NOCTURNES' fronts: does what each object shows as its
// front (its screen, its face, its cone, its seat) sit where NOCTURNES
// thinks its front is (+z), and does a room arranged to face the person and
// the camera actually show those fronts to the camera?
//
//   node tools/front-audit.mjs [--seeds 3] [--genomes 240] [--pairs 40] [--out out/front-audit.md]
//
// NOCTURNES is imported from ../keel-nocturnes (or NOCTURNES=path) and never
// written to: this builds its objects and genomes in memory and measures them
// with scene/front.js. Its instances turn the other way from the engine
// (front(yaw) = [-sin, 0, cos]); its yaws come in through fromNocturnesYaw.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromNocturnesYaw, wrapAngle } from "../src/core/frame.js";
import { angleBetween, detectFront, frontEvidence } from "../src/scene/front.js";

const here = dirname(fileURLToPath(import.meta.url));
const NOCTURNES = resolve(process.env.NOCTURNES ?? resolve(here, "../../keel-nocturnes"));
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const SEEDS = Number(arg("seeds", 3));
const GENOMES = Number(arg("genomes", 240));
const PAIRS = Number(arg("pairs", 40));
const OUT = resolve(here, "..", arg("out", "out/front-audit.md"));

const N = (p) => import(`${NOCTURNES}/src/${p}`);
const { makeObject, makeGenome, genomeFromItems, mannerOf } = await N("genome.js");
const { seedFromToken } = await N("rng.js");
const { useOf } = await N("arrange.js");
const { viewOf } = await N("scene.js");
const { RELICS } = await N("relics.js");
const { DESK } = await N("desk.js");
const { DECOR } = await N("decor.js");
const { OCCULT } = await N("occult.js");
const { FLOOR } = await N("floor.js");
const { FAMILIES } = await N("forms.js");

const deg = (a) => Math.round((a * 180) / Math.PI);
const CONFIDENT = 0.35;
const t0 = performance.now();

// Evidence per object (its parts in its own frame; NOCTURNES authors fronts at +z).
function measure(o) {
  const E = frontEvidence(o.parts);
  const r = detectFront({ parts: o.parts, facing: o.facing }, { evidence: E });
  return { E, r };
}

// ---------------------------------------------------------------- 1. the catalogue

const CATS = [["Relic", RELICS], ["Desk", DESK], ["Decor", DECOR], ["Occult", OCCULT], ["Floor", FLOOR], ["Still Life", FAMILIES]];
const objects = [];
let failed = 0;
for (const [realm, list] of CATS) {
  list.forEach(([key], idx) => {
    for (let s = 0; s < SEEDS; s += 1) {
      let o = null;
      try { o = makeObject(seedFromToken(90000 + s * 7919 + idx * 131 + realm.length), "hero", null, { realm, key }); } catch { failed += 1; }
      if (!o || !o.parts?.length) continue;
      const { E, r } = measure(o);
      objects.push({
        realm, key, form: o.form, facing: o.facing, flat: Boolean(o.flat), settled: Boolean(o.settled), builtYaw: o.builtYaw ?? null,
        manner: mannerOf(o), use: useOf({ ...o, realm, key }),
        yaw: E.yaw, conf: E.confidence, symmetric: E.symmetric, symmetry: E.symmetry,
        agrees: r.agrees, off: angleBetween(0, E.yaw), layers: E.layers, why: r.why,
      });
    }
  });
}

const standing = objects.filter((o) => !o.flat);
const facingObjs = standing.filter((o) => o.facing);
const confident = (o) => o.conf >= CONFIDENT && !o.symmetric;
const disagree = facingObjs.filter((o) => confident(o) && o.off > Math.PI / 4);
const agreeN = facingObjs.filter((o) => confident(o) && o.off <= Math.PI / 4).length;
const weak = facingObjs.filter((o) => !confident(o));
const unflagged = standing.filter((o) => !o.facing && confident(o) && (o.layers.features || o.layers.useCase));

// How often geometry alone (no names) finds what the names say: the fallback's reliability.
const named = standing.filter((o) => confident(o) && (o.layers.features?.strength ?? 0) + (o.layers.useCase?.strength ?? 0) > 0.5);
const geoRight = named.filter((o) => o.layers.geometry.strength > 0.1 && angleBetween(o.layers.geometry.yaw, o.yaw) <= Math.PI / 4).length;
const geoSaid = named.filter((o) => o.layers.geometry.strength > 0.1).length;

// Per key, over its seeds.
const byKey = new Map();
for (const o of objects) {
  const k = `${o.realm}/${o.key}`;
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(o);
}

// ---------------------------------------------------------------- 2. arranged rooms

const cache = new WeakMap();
const measured = (o) => { if (!cache.has(o)) cache.set(o, measure(o)); return cache.get(o); };
const scene = { placements: 0, flat: 0, free: 0, facingIntent: 0, rows: [], wrongConv: [], perRoom: [] };
const bucket = () => ({ front: 0, side: 0, back: 0 });
const tally = (b, off) => { if (off <= Math.PI / 4) b.front += 1; else if (off <= Math.PI / 2) b.side += 1; else b.back += 1; };
const shown = { authored: bucket(), detected: bucket(), wrongConv: bucket() };
const INTENT = new Set(["display", "loose", "casual"]);
for (let i = 0; i < GENOMES; i += 1) {
  let g;
  try { g = makeGenome(seedFromToken(i)); } catch { failed += 1; continue; }
  const eye = viewOf(g, 160, 120).eye;
  for (const pl of g.placements) {
    const o = pl.obj;
    scene.placements += 1;
    if (o.flat) { scene.flat += 1; continue; }
    const manner = mannerOf(o);
    if (!INTENT.has(manner)) { scene.free += 1; continue; }
    const { E } = measured(o);
    if (E.confidence < CONFIDENT || E.symmetric) continue;
    scene.facingIntent += 1;
    const toEye = Math.atan2(eye[0] - pl.pos[0], eye[2] - pl.pos[2]);
    const authored = fromNocturnesYaw(pl.yaw); // (its +z, turned NOCTURNES' way)
    const detected = wrapAngle(E.yaw + fromNocturnesYaw(pl.yaw));
    const wrong = wrapAngle(E.yaw + pl.yaw); // (the same yaw read the engine's way, unconverted)
    const row = {
      genome: i, key: `${o.realm}/${o.key}`, form: o.form, manner, use: useOf(o), setting: g.setting,
      offAuthored: angleBetween(authored, toEye), offDetected: angleBetween(detected, toEye), offWrong: angleBetween(wrong, toEye),
      local: E.yaw, conf: E.confidence,
    };
    tally(shown.authored, row.offAuthored);
    tally(shown.detected, row.offDetected);
    tally(shown.wrongConv, row.offWrong);
    scene.rows.push(row);
  }
}

// ---------------------------------------------------------------- 3. seats turned to the set

// A floor room with a chair and a TV: the arranger turns the chair to the set
// (arrange.js faceAt "seat": yawTo(set) + builtYaw, since nocturnes-v31 -- it
// used to take the built turn away, and chairs sat 2 x builtYaw off). Measure
// where the chair's seat really points: a regression check on that fix.
const seats = [];
for (let i = 0; i < PAIRS; i += 1) {
  let g;
  try {
    g = genomeFromItems(seedFromToken(50000 + i), [
      { seed: seedFromToken(51000 + i), realm: "Floor", key: "tv" },
      { seed: seedFromToken(52000 + i), realm: "Floor", key: "chair" },
    ]);
  } catch { failed += 1; continue; }
  const chair = g.placements.find((p) => p.obj.realm === "Floor" && p.obj.key === "chair");
  const tv = g.placements.find((p) => p.obj.realm === "Floor" && p.obj.key === "tv");
  if (!chair || !tv) continue;
  const { E } = measured(chair.obj);
  const toTv = Math.atan2(tv.pos[0] - chair.pos[0], tv.pos[2] - chair.pos[2]);
  const seatWorld = wrapAngle(E.yaw + fromNocturnesYaw(chair.yaw));
  const b = chair.obj.builtYaw ?? 0;
  seats.push({
    genome: i, builtYaw: b, localSeat: E.yaw, conf: E.confidence,
    off: angleBetween(seatWorld, toTv),
    // (What the arranger means the chair to face: yaw - builtYaw, NOCTURNES' way.)
    meant: angleBetween(fromNocturnesYaw(chair.yaw - b), toTv),
  });
}

// ---------------------------------------------------------------- the report

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "-");
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const L = [];
L.push("# NOCTURNES front audit", "");
L.push(`Read-only: NOCTURNES at \`${NOCTURNES}\` was imported and measured in memory, never written. Fronts by \`src/scene/front.js\` (features, use cases, geometry). NOCTURNES yaws came in through \`fromNocturnesYaw\` (its instances turn the other way: front(yaw) = [-sin, 0, cos]).`, "");
L.push(`Generated ${new Date().toISOString().slice(0, 10)} with --seeds ${SEEDS} --genomes ${GENOMES} --pairs ${PAIRS} in ${((performance.now() - t0) / 1000).toFixed(1)} s. "Confident" = detection confidence >= ${CONFIDENT} and not symmetric.`, "");

L.push("## 1. Objects: is the authored front (+z) where the geometry says?", "");
L.push("| | count |", "| --- | ---: |");
L.push(`| objects built (${byKey.size} keys x ${SEEDS} seeds) | ${objects.length} |`);
L.push(`| lying flat (front turned up: left out below) | ${objects.length - standing.length} |`);
L.push(`| standing, authored \`facing: true\` | ${facingObjs.length} |`);
L.push(`| ... evidence confident and AGREES (+z within 45°) | ${agreeN} (${pct(agreeN, facingObjs.length)}) |`);
L.push(`| ... evidence confident and DISAGREES | ${disagree.length} (${pct(disagree.length, facingObjs.length)}) |`);
L.push(`| ... evidence too weak / symmetric to check | ${weak.length} (${pct(weak.length, facingObjs.length)}) |`);
L.push(`| standing, \`facing: false\`, but a named front found | ${unflagged.length} |`);
L.push(`| builds that threw | ${failed} |`, "");

const kinds = { threeQuarter: 0, profile: 0, reversed: 0 };
for (const o of disagree) { if (o.off < Math.PI / 3) kinds.threeQuarter += 1; else if (o.off <= (2 * Math.PI) / 3) kinds.profile += 1; else kinds.reversed += 1; }
L.push(`The disagreements by how far off: three-quarter (45-60°) ${kinds.threeQuarter}, profile (60-120°: modelled along x, shown side-on) ${kinds.profile}, reversed (> 120°) ${kinds.reversed}.`, "");
const worst = [...disagree].sort((a, b) => b.off * b.conf - a.off * a.conf);
L.push("### Worst offenders: authored facing, features not on +z", "");
if (!worst.length) L.push("None.", "");
else {
  L.push("| object | form | detected front (own frame) | off +z | confidence | evidence |", "| --- | --- | ---: | ---: | ---: | --- |");
  const seen = new Set();
  for (const o of worst) {
    const k = `${o.realm}/${o.key}`;
    if (seen.has(k) && seen.size > 25) continue;
    seen.add(k);
    const ev = [o.layers.features ? `features ${o.layers.features.words.join(",")} -> ${deg(o.layers.features.yaw)}°` : null, o.layers.useCase ? `use -> ${deg(o.layers.useCase.yaw)}°` : null, `geometry -> ${deg(o.layers.geometry.yaw)}° (${o.layers.geometry.strength.toFixed(2)})`].filter(Boolean).join("; ");
    L.push(`| ${k} | ${o.form} | ${deg(o.yaw)}° | ${deg(o.off)}° | ${o.conf.toFixed(2)} | ${ev} |`);
    if (seen.size >= 30) break;
  }
  L.push("");
}

L.push("### Per key (keys with any disagreement, or a built-in turn)", "");
L.push("| key | facing | seeds | agree | disagree | weak | mean off +z | builtYaw |", "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");
for (const [k, list] of [...byKey].sort()) {
  const st = list.filter((o) => !o.flat);
  const dis = st.filter((o) => o.facing && confident(o) && o.off > Math.PI / 4).length;
  const turned = list.some((o) => o.builtYaw && Math.abs(o.builtYaw) > 0.05);
  if (!dis && !turned) continue;
  const ag = st.filter((o) => o.facing && confident(o) && o.off <= Math.PI / 4).length;
  const wk = st.filter((o) => o.facing && !confident(o)).length;
  const offs = st.filter(confident).map((o) => deg(o.off));
  L.push(`| ${k} | ${list[0].facing} | ${list.length} | ${ag} | ${dis} | ${wk} | ${offs.length ? `${Math.round(mean(offs))}°` : "-"} | ${list.map((o) => (o.builtYaw === null ? "-" : o.builtYaw.toFixed(2))).join(", ")} |`);
}
L.push("");

L.push("### Has a front, authored as having none (`facing: false`)", "");
if (!unflagged.length) L.push("None.", "");
else {
  const ks = new Map();
  for (const o of unflagged) { const k = `${o.realm}/${o.key}`; if (!ks.has(k)) ks.set(k, o); }
  L.push("| object | form | detected front | confidence | named |", "| --- | --- | ---: | ---: | --- |");
  for (const [k, o] of ks) L.push(`| ${k} | ${o.form} | ${deg(o.yaw)}° | ${o.conf.toFixed(2)} | ${(o.layers.features?.words ?? []).join(", ") || (o.layers.useCase ? "use case" : "")} |`);
  L.push("");
}

L.push("### Geometry alone (no names), against the names", "");
L.push(`Where names give a confident front (${named.length} objects), the geometry layer has an opinion on ${geoSaid} and matches the names (within 45°) on ${geoRight} (${pct(geoRight, geoSaid)}). Unnamed things lean on this layer: its confidence is capped (x0.6) for that reason.`, "");

L.push("## 2. Arranged rooms: does the camera see the fronts?", "");
L.push(`${GENOMES} genomes (makeGenome(seedFromToken(i)), i < ${GENOMES}), the camera eye from scene.js viewOf. ${scene.placements} placements: ${scene.flat} lying flat, ${scene.free} set down "free" (no front meant), ${scene.facingIntent} meant to face the room (manner display / loose / casual) with a confident detected front.`, "");
L.push("| the front the camera sees, for things meant to face the room | front (<= 45°) | side (45-90°) | back (> 90°) |", "| --- | ---: | ---: | ---: |");
const row3 = (name, b) => { const n = b.front + b.side + b.back; L.push(`| ${name} | ${b.front} (${pct(b.front, n)}) | ${b.side} (${pct(b.side, n)}) | ${b.back} (${pct(b.back, n)}) |`); };
row3("NOCTURNES' own +z, turned its way (what its arranger meant)", shown.authored);
row3("the DETECTED front, turned its way (what the camera really sees)", shown.detected);
row3("the detected front with the NOCTURNES yaw read as an engine yaw (no fromNocturnesYaw)", shown.wrongConv);
L.push("");
const byManner = {};
for (const r of scene.rows) { (byManner[r.manner] ??= []).push(r); }
L.push("| manner | n | mean off camera: authored | detected | unconverted |", "| --- | ---: | ---: | ---: | ---: |");
for (const [m, rs] of Object.entries(byManner)) L.push(`| ${m} | ${rs.length} | ${Math.round(mean(rs.map((r) => deg(r.offAuthored))))}° | ${Math.round(mean(rs.map((r) => deg(r.offDetected))))}° | ${Math.round(mean(rs.map((r) => deg(r.offWrong))))}° |`);
L.push("");
const backs = scene.rows.filter((r) => r.offDetected > Math.PI / 2 && r.manner !== "casual").sort((a, b) => b.offDetected - a.offDetected);
L.push("### Meant to face the room (display / loose), showing the camera its back", "");
if (!backs.length) L.push("None.", "");
else {
  L.push("| genome | setting | object | form | manner | use | authored off camera | detected off camera | detected (own frame) |", "| ---: | --- | --- | --- | --- | --- | ---: | ---: | ---: |");
  for (const r of backs.slice(0, 25)) L.push(`| ${r.genome} | ${r.setting} | ${r.key} | ${r.form} | ${r.manner} | ${r.use} | ${deg(r.offAuthored)}° | ${deg(r.offDetected)}° | ${deg(r.local)}° |`);
  L.push("");
}

L.push("## 3. A chair turned to the TV (Floor rooms, arrange.js faceAt \"seat\")", "");
if (!seats.length) L.push("No floor rooms with both came out.", "");
else {
  const conf = seats.filter((s) => s.conf >= CONFIDENT);
  const big = conf.filter((s) => Math.abs(s.builtYaw) > 0.2);
  L.push(`${seats.length} rooms (genomeFromItems with a Floor TV and a Floor chair), ${conf.length} with a confident seat front. The chair is built turned by \`builtYaw\` (floor.js finish -> present(yaw), the engine/kit sense: its seat points [sin b, cos b] in its own frame), so placed at yaw y it faces y - builtYaw in the instance sense ([-sin, cos]); the arranger adds builtYaw to turn it to the set (fixed in nocturnes-v31).`, "");
  L.push("| | mean off the TV | worst | within 20° |", "| --- | ---: | ---: | ---: |");
  const line = (name, xs) => L.push(`| ${name} | ${Math.round(mean(xs.map(deg)))}° | ${Math.round(Math.max(...xs.map(deg)))}° | ${pct(xs.filter((x) => x <= (20 * Math.PI) / 180).length, xs.length)} |`);
  line("where the arranger means the seat to face", conf.map((s) => s.meant));
  line("where the detected seat really faces", conf.map((s) => s.off));
  if (mean(conf.map((s) => s.off)) > (15 * Math.PI) / 180) {
    L.push("", "**REGRESSION: chairs no longer face the set.** (Before nocturnes-v31 it read as below.)", "");
    L.push("**The built turn is counted the wrong way round.** present() turns the chair with the kit rotation (front -> [sin b, 0, cos b]); an instance yaw turns it NOCTURNES' way (front -> [-sin y, 0, cos y]). So a chair built turned by b, placed at yaw y, faces y - b in the instance sense -- not y + b as arrange.js assumes. faceAt(\"seat\") returns yawTo(set) - builtYaw, which turns the chair 2 x builtYaw off the set. The fix, in NOCTURNES' own terms: `yawTo(x, z, screen.x, screen.z) + builtYaw` (and the same sign for the no-screen branch), and read a seat's front as `seat.yaw - builtYaw` in the shoulder zone and the by-a-chair check (arrange.js lines ~297, 298, 351, 363). That would change NOCTURNES' pixels: it is NOCTURNES' call, behind its guard.");
  }
  if (big.length) {
    L.push("");
    L.push(`Chairs built turned more than 0.2 rad (${big.length}): mean off the TV ${Math.round(mean(big.map((s) => deg(s.off))))}° (the old sign error would give 2 x builtYaw = ${Math.round(mean(big.map((s) => deg(Math.abs(2 * s.builtYaw)))))}°).`);
    L.push("", "| room | builtYaw | seat (own frame) | detected off the TV | meant |", "| ---: | ---: | ---: | ---: | ---: |");
    for (const s of big.sort((a, b) => b.off - a.off).slice(0, 12)) L.push(`| ${s.genome} | ${s.builtYaw.toFixed(2)} | ${deg(s.localSeat)}° | ${deg(s.off)}° | ${deg(s.meant)}° |`);
  }
  L.push("");
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${L.join("\n")}\n`);
console.log(`${objects.length} objects, ${scene.rows.length} arranged fronts, ${seats.length} seat rooms -> ${OUT} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
console.log(`facing objects: ${agreeN} agree, ${disagree.length} disagree, ${weak.length} too weak; camera sees fronts: authored ${shown.authored.front}/${scene.rows.length}, detected ${shown.detected.front}/${scene.rows.length}`);
