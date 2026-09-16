// The score: generative lo-fi as a plan (plain data), written by a seed from a
// MOOD. It is NOCTURNES' composer (src/music.js there) with the room taken
// out: whatever NOCTURNES read off a genome -- its theme's band, the palette's
// hue and harmony, what's out the window, how dark it is, the picture's loop
// length -- arrives here as a mood, so any project can have music of its own.
//
// Every piece is lo-fi (a dusty swung beat, jazzy keys, a warm bass, the
// record's crackle, tape wow, a scratch into the turnaround, a tape stop at
// the end of the loop), and every SEED is its own record: the seed picks the
// players from the band's (a Rhodes or a Wurlitzer or a felt piano, an
// upright or a sub, a brushed kit or a boom-bap), sets the tempo and groove,
// how the keys comp and the bass walks, and composes the chords and the tune.
//
//   const plan = scoreOf(mood, seed, { pins });
//
// A mood (all optional):
//   name     what the plan calls its band (NOCTURNES: the theme)
//   band     a band preset's name (BANDS) or a band object (see BANDS for the fields)
//   hue      0-360: the key round the circle of fifths (none: the seed picks)
//   mode     the mode the band leans to when it has none of its own
//   eclipse  a darker record (harmonic minor)
//   picture  seconds of a picture's own loop: the tempo locks so the music is whole loops of it (none: free tempo)
//   view     a label for what's outside; weather: its layers (WEATHER_KINDS); room: extra room layers (ROOM_KINDS)
//   dark     0-1, how open the record's top is (NOCTURNES' night: 0.3 void to 0.72)
//   space    extra reverb over the band's room
//   energy   carried on the plan (the player's default intensity)
//   pins     any choice fixed: band, keys, lead, bass, kit, mode, key, tempo
//
// NOCTURNES' own music is scoreOf(moodOfNocturnes(g)) (./nocturnes.js), equal
// to its scoreOf(g) byte for byte (tests/audio-equality.test.mjs).

// ---------------------------------------------------------------- harmony

export const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
};
export const MINORISH = new Set(["dorian", "phrygian", "aeolian", "harmonic"]);
// Where a chord likes to go next (scale degree -> [next, weight]).
const MOVES = {
  major: { 0: [[5, 3], [3, 3], [1, 2], [2, 1], [4, 1]], 1: [[4, 5], [6, 1], [3, 1]], 2: [[5, 3], [3, 2], [1, 1]], 3: [[4, 3], [1, 2], [0, 2], [2, 1]], 4: [[0, 5], [5, 2], [3, 1]], 5: [[1, 3], [3, 3], [4, 1], [2, 1]], 6: [[0, 3], [2, 1]] },
  minor: { 0: [[3, 3], [5, 3], [6, 2], [2, 1], [1, 1]], 1: [[4, 3], [6, 1]], 2: [[5, 2], [3, 2], [6, 1]], 3: [[6, 3], [0, 2], [4, 2], [1, 1]], 4: [[0, 4], [5, 2]], 5: [[2, 2], [6, 3], [3, 2], [1, 1]], 6: [[2, 3], [0, 3], [5, 1]] },
};

// ---------------------------------------------------------------- the bands

// Every band is a lo-fi band: [choice, weight] for the keys, the lead, the bass
// and the beat's feel, the tempo it may take (bpm, low to high), how swung, how
// big a room, how jazzy its chords, how often a chopped voice or a scratch, how
// bright its instruments and how worn its record; a mode of its own, or a lean
// to major. (NOCTURNES' themes' bands, word for word.)
export const BANDS = {
  "Late Shift": { keys: [["rhodes", 4], ["wurli", 2], ["piano", 1]], lead: [["rhodes", 2], ["vibes", 1], ["guitar", 1], ["kalimba", 1]], bass: [["sub", 2], ["electric", 2], ["upright", 1]], feel: [["dusty", 3], ["boombap", 2], ["rim", 1]], tempo: [68, 90], swing: [0.22, 0.36], room: 0.25, jazz: 0.35, vox: 0.3, scratch: 0.5, bright: 0.5, worn: 0.5 },
  "Retro Den": { keys: [["wurli", 2], ["organ", 2], ["rhodes", 1]], lead: [["chip", 3], ["kalimba", 1]], bass: [["synth", 3], ["electric", 1]], feel: [["chip", 2], ["boombap", 2]], tempo: [80, 93], swing: [0.08, 0.2], room: 0.2, jazz: 0.1, vox: 0.1, scratch: 0.6, bright: 0.6, worn: 0.6, mode: "dorian" },
  Candlelight: { keys: [["felt", 3], ["piano", 2], ["guitar", 1]], lead: [["celesta", 2], ["vibes", 1], ["musicbox", 1]], bass: [["upright", 3], ["sub", 1]], feel: [["brushed", 3], ["soft", 2]], tempo: [66, 80], swing: [0.2, 0.32], room: 0.42, jazz: 0.3, vox: 0.4, scratch: 0.15, bright: 0.35, worn: 0.5, lean: "major" },
  Bedside: { keys: [["felt", 3], ["piano", 1], ["rhodes", 1]], lead: [["musicbox", 3], ["kalimba", 2], ["celesta", 1]], bass: [["sub", 3], ["upright", 1]], feel: [["soft", 3], ["brushed", 1]], tempo: [64, 78], swing: [0.18, 0.28], room: 0.4, jazz: 0.2, vox: 0.25, scratch: 0.1, bright: 0.3, worn: 0.55, lean: "major" },
  "The Reading": { keys: [["rhodes", 2], ["piano", 1], ["felt", 1]], lead: [["celesta", 2], ["kalimba", 1], ["vibes", 1]], bass: [["sub", 3], ["upright", 1]], feel: [["dusty", 2], ["soft", 1]], tempo: [66, 82], swing: [0.18, 0.3], room: 0.48, jazz: 0.25, vox: 0.5, scratch: 0.25, bright: 0.4, worn: 0.6, mode: "dorian" },
  "Night Desk": { keys: [["rhodes", 3], ["piano", 2], ["wurli", 1]], lead: [["rhodes", 1], ["vibes", 1], ["guitar", 1]], bass: [["upright", 3], ["electric", 1]], feel: [["rim", 3], ["dusty", 1]], tempo: [68, 86], swing: [0.26, 0.38], room: 0.3, jazz: 0.45, vox: 0.2, scratch: 0.3, bright: 0.45, worn: 0.45 },
  "Game Night": { keys: [["rhodes", 2], ["wurli", 2], ["organ", 1]], lead: [["chip", 3], ["kalimba", 1]], bass: [["synth", 2], ["electric", 2]], feel: [["boombap", 3], ["chip", 1]], tempo: [80, 93], swing: [0.14, 0.26], room: 0.2, jazz: 0.15, vox: 0.2, scratch: 0.7, bright: 0.6, worn: 0.4, mode: "mixolydian" },
  Nightcap: { keys: [["vibes", 2], ["piano", 2], ["rhodes", 1]], lead: [["vibes", 2], ["guitar", 1], ["rhodes", 1]], bass: [["upright", 4]], feel: [["brushed", 3], ["rim", 1]], tempo: [66, 84], swing: [0.3, 0.4], room: 0.35, jazz: 0.6, vox: 0.2, scratch: 0.15, bright: 0.45, worn: 0.45, mode: "dorian" },
  Collector: { keys: [["felt", 2], ["rhodes", 1], ["wurli", 1]], lead: [["musicbox", 2], ["kalimba", 2]], bass: [["sub", 2], ["electric", 1]], feel: [["boombap", 2], ["dusty", 1]], tempo: [72, 90], swing: [0.18, 0.3], room: 0.3, jazz: 0.2, vox: 0.3, scratch: 0.5, bright: 0.55, worn: 0.5, lean: "major" },
  "Green Sill": { keys: [["felt", 2], ["guitar", 2], ["piano", 1]], lead: [["celesta", 1], ["kalimba", 2], ["musicbox", 1]], bass: [["sub", 2], ["upright", 1]], feel: [["soft", 2], ["brushed", 2]], tempo: [66, 82], swing: [0.18, 0.3], room: 0.38, jazz: 0.25, vox: 0.35, scratch: 0.15, bright: 0.4, worn: 0.5, lean: "major" },
  Mixtape: { keys: [["rhodes", 2], ["wurli", 1], ["piano", 1]], lead: [["rhodes", 1], ["guitar", 1], ["vibes", 1]], bass: [["electric", 2], ["sub", 1]], feel: [["boombap", 3], ["dusty", 1]], tempo: [74, 93], swing: [0.26, 0.36], room: 0.25, jazz: 0.3, vox: 0.35, scratch: 0.8, bright: 0.5, worn: 0.8 },
  "A Room": { keys: [["rhodes", 2], ["felt", 2], ["guitar", 1], ["piano", 1]], lead: [["celesta", 1], ["kalimba", 1], ["vibes", 1]], bass: [["sub", 2], ["upright", 1]], feel: [["dusty", 2], ["soft", 1], ["brushed", 1]], tempo: [66, 86], swing: [0.2, 0.32], room: 0.45, jazz: 0.3, vox: 0.35, scratch: 0.35, bright: 0.45, worn: 0.5 },
  Loose: { keys: [["rhodes", 2], ["felt", 1], ["piano", 1]], lead: [["rhodes", 1], ["celesta", 1], ["kalimba", 1]], bass: [["sub", 2], ["electric", 1]], feel: [["dusty", 2], ["boombap", 1]], tempo: [68, 88], swing: [0.2, 0.32], room: 0.3, jazz: 0.3, vox: 0.3, scratch: 0.4, bright: 0.45, worn: 0.5 },
};

/** What can be chosen (and pinned). */
export const CHOICES = {
  band: Object.keys(BANDS), kit: ["dusty", "boombap", "brushed", "soft", "rim", "chip"], keys: ["rhodes", "wurli", "piano", "felt", "vibes", "organ", "guitar"],
  lead: ["rhodes", "piano", "celesta", "kalimba", "musicbox", "vibes", "guitar", "chip"], bass: ["sub", "upright", "electric", "synth"], mode: Object.keys(MODES),
  key: ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"],
};
/** The layers under the record: outside, and in the room (the vinyl is always there). */
export const WEATHER_KINDS = ["rain", "waves", "traffic", "wind", "hush", "crickets", "car", "chimes", "shimmer"];
export const ROOM_KINDS = ["vinyl", "crackle", "fan", "hum"];

// ---------------------------------------------------------------- seeds

export function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** A seeded stream off a string (exact integer arithmetic: the same in every browser). */
export function streamOf(text) {
  let a = hash(String(text)) || 1;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const weighted = (l) => { let s = 0; for (const [, w] of l) s += w; let r = f() * s; for (const [v, w] of l) { if ((r -= w) < 0) return v; } return l[l.length - 1][0]; };
  return { f, between: (x, y) => x + (y - x) * f(), int: (x, y) => x + Math.floor(f() * (y - x + 1)), pick: (l) => l[Math.floor(f() * l.length)], chance: (p) => f() < p, weighted };
}

// ---------------------------------------------------------------- composing

/** A chord as semitones over the tonic: its root and its 3rd, 5th, 7th and 9th. */
export function diatonic(mode, d) {
  const sc = MODES[mode];
  const at = (k) => sc[(d + k) % 7] + 12 * Math.floor((d + k) / 7);
  return { root: at(0) % 12, tones: [at(2), at(4), at(6), at(8)], deg: d };
}
const dominantOf = (target) => { const r = (target.root + 7) % 12; return { root: r, tones: [r + 4, r + 7, r + 10, r + 14], deg: -1 }; };
const borrowedIv = (mode) => { const r = MODES[mode][3]; return { root: r, tones: [r + 3, r + 7, r + 10, r + 14], deg: -2 }; };

/** Eight bars of chords, walked from `from`, landing so the next section can begin. */
function progression(S, plan, from, len, cadence) {
  const moves = MOVES[plan.family === "major" ? "major" : "minor"];
  const degs = [from];
  for (let i = 1; i < len; i += 1) degs.push(S.weighted(moves[degs[i - 1]] ?? [[0, 1]]));
  // (The last bar leans home: V in major, VII or v in minor -- or a ii for the jazz.)
  degs[len - 1] = cadence ?? (plan.family === "major" ? S.pick([4, 4, 1]) : S.pick([6, 4, 3]));
  const chords = degs.map((d) => diatonic(plan.mode, d));
  // Jazz: a secondary dominant into a minor-ish chord, a borrowed iv in major.
  for (let i = 0; i < len - 1; i += 1) {
    if (S.chance(plan.jazz * 0.5) && [1, 2, 5].includes(degs[i + 1])) chords[i] = dominantOf(chords[i + 1]);
    else if (plan.family === "major" && degs[i] === 3 && S.chance(plan.jazz * 0.6)) chords[i] = borrowedIv(plan.mode);
  }
  return chords;
}

/** A motif: a rhythm over two bars (32 steps) and the steps it moves by. */
function motif(S) {
  const rhythms = [[0, 3, 6, 10, 16, 22], [0, 4, 7, 12, 18], [2, 6, 8, 14, 16, 20, 26], [0, 6, 10, 14, 20, 24], [0, 3, 8, 16, 19, 24], [4, 7, 12, 20, 23, 28]];
  const rhythm = S.pick(rhythms);
  const moves = rhythm.map(() => S.weighted([[1, 3], [-1, 3], [2, 2], [-2, 2], [0, 1], [3, 1], [-3, 1]]));
  return { rhythm, moves, lengths: rhythm.map((s, i) => Math.max(2, (rhythm[i + 1] ?? 32) - s)) };
}

/** A beat of its own: where this seed's kicks fall, how its hats run, its ghosts, its open hats, a shaker. */
function grooveOf(S, feel) {
  const g = { kick: [0], back: [4, 12], hat: [], ghost: [], open: [], shaker: [] };
  const kicks = {
    dusty: [[10, 0.7], [7, 0.5], [3, 0.2], [13, 0.2], [6, 0.15]], boombap: [[10, 0.6], [3, 0.5], [8, 0.4], [7, 0.35], [14, 0.2]],
    brushed: [[10, 0.5], [8, 0.35], [6, 0.15]], soft: [[8, 0.5], [10, 0.45], [3, 0.1]], rim: [[7, 0.6], [10, 0.6], [3, 0.25]], chip: [[8, 0.8], [11, 0.5], [3, 0.3]],
  }[feel] ?? [[10, 0.6], [7, 0.4]];
  for (const [s, p] of kicks) if (S.chance(p)) g.kick.push(s);
  if (g.kick.length === 1) g.kick.push(10);
  const style = S.weighted(feel === "chip" ? [["16", 3], ["8", 1]] : feel === "brushed" || feel === "soft" ? [["shaker", 3], ["4", 2], ["8", 1]] : [["8", 3], ["16skip", 2], ["swing16", 2], ["4", 1]]);
  g.hat = { 16: [...Array(16).keys()], 8: [0, 2, 4, 6, 8, 10, 12, 14], 4: [0, 4, 8, 12], "16skip": [0, 2, 3, 4, 6, 8, 10, 11, 12, 14], swing16: [0, 2, 4, 6, 7, 8, 10, 12, 14, 15], shaker: [] }[style];
  if (style === "shaker" || (feel !== "chip" && S.chance(0.25))) g.shaker = [0, 2, 4, 6, 8, 10, 12, 14];
  g.ghost = [3, 6, 7, 9, 11, 14, 15].filter(() => S.chance(0.25));
  if (S.chance(0.55)) g.open = [S.pick([6, 14, 10])];
  return g;
}

/** A pinned key: 0-11 (or "0"-"11"), or a note name ("C#"). */
function keyOf(k) {
  if (typeof k === "string" && Number.isNaN(+k)) { const i = CHOICES.key.indexOf(k.trim()); return i < 0 ? NaN : i; }
  return ((+k % 12) + 12) % 12;
}

/**
 * The music as a plan: its players and their instruments' make, key, mode,
 * tempo, groove, the loop's form and every bar's chord. The same mood and
 * seed make the same plan everywhere.
 */
export function scoreOf(mood = {}, seed = mood.seed, opts = {}) {
  const S = streamOf(`${seed}|music`);
  // (Anything can be picked by hand -- the pins -- and the seed decides the rest.)
  const o = { ...(mood.pins ?? {}), ...(opts.pins ?? {}) };
  const given = typeof mood.band === "string" ? BANDS[mood.band] : mood.band;
  const theme = o.band || mood.name || (typeof mood.band === "string" ? mood.band : "Loose");
  const band = { ...BANDS.Loose, ...(o.band ? BANDS[o.band] ?? {} : given ?? {}) };
  const keys = o.keys || S.weighted(band.keys);
  const lead = o.lead || S.weighted(band.lead);
  const bass = o.bass || S.weighted(band.bass);
  const kit = o.kit || S.weighted(band.feel);
  // The key from the hue, round the circle of fifths; the mode from the band, or the mood's.
  const hue = ((mood.hue ?? S.between(0, 360)) % 360 + 360) % 360;
  let tonic = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5][Math.round(hue / 30) % 12];
  let mode = band.mode ?? mood.mode ?? "aeolian";
  if (band.lean === "major" && MINORISH.has(mode)) mode = S.chance(0.6) ? "lydian" : "ionian";
  if (!band.mode && !band.lean && S.chance(0.3)) mode = S.pick(MINORISH.has(mode) ? ["dorian", "aeolian"] : ["ionian", "mixolydian", "lydian"]); // (a seed's own turn)
  if (mood.eclipse) mode = "harmonic"; // (a darker record)
  if (o.mode && MODES[o.mode]) mode = o.mode;
  if (o.key !== undefined && o.key !== "") tonic = keyOf(o.key);
  const family = MINORISH.has(mode) ? "minor" : "major";
  // The tempo. Locked to a picture: a bars to b loops of it, one that lands in
  // the band's range, the loop 32, 36 or 40 bars, whichever is whole loops of
  // it. Free: anywhere in the band's range.
  const picture = mood.picture;
  const [lo, hi] = band.tempo;
  let tempo;
  if (typeof picture === "number") {
    const options = [[5, 4], [4, 3], [3, 2], [8, 5], [5, 3], [2, 1], [9, 4], [5, 2], [8, 3], [3, 1]]
      .map(([a, b]) => ({ a, bpm: (240 * a) / b / picture, bars: [32, 36, 40].filter((n) => n % a === 0) }))
      .filter((r) => r.bars.length && r.bpm >= 62 && r.bpm <= 95);
    const mid = (lo + hi) / 2;
    const inRange = options.filter((r) => r.bpm >= lo && r.bpm <= hi);
    const nearest = (want) => options.reduce((best, r) => (Math.abs(r.bpm - want) < Math.abs(best.bpm - want) ? r : best));
    tempo = o.tempo ? nearest(+o.tempo) : inRange.length ? S.pick(inRange) : nearest(mid);
  } else {
    tempo = { bpm: o.tempo ? Math.max(40, Math.min(160, +o.tempo)) : S.between(lo, hi), bars: [32, 36, 40] };
  }
  const bars = S.pick(tempo.bars);
  const FORMS = {
    32: [[["A", 8], ["B", 8], ["A2", 8], ["C", 4], ["T", 4]], [["A", 8], ["A2", 8], ["B", 8], ["C", 4], ["T", 4]], [["A", 8], ["B", 8], ["C", 4], ["B", 8], ["T", 4]]],
    36: [[["A", 8], ["B", 8], ["A2", 8], ["C", 4], ["T", 8]], [["A", 8], ["A2", 8], ["B", 8], ["C", 4], ["T", 8]], [["A", 8], ["B", 8], ["C", 4], ["A2", 8], ["T", 8]]],
    40: [[["A", 8], ["B", 8], ["A2", 8], ["C", 8], ["T", 8]], [["A", 8], ["B", 8], ["C", 4], ["B", 8], ["A2", 8], ["T", 4]], [["A", 8], ["A2", 8], ["B", 8], ["C", 8], ["T", 8]]],
  };
  const form = S.pick(FORMS[bars]);
  const bpm = tempo.bpm;
  const barSec = (60 * 4) / bpm;
  const plan = {
    seed: String(seed), theme, view: mood.view ?? "Stars", eclipse: Boolean(mood.eclipse), mode, family, tonic,
    bpm: Math.round(bpm * 1000) / 1000, barSec, swing: S.between(...band.swing), jazz: band.jazz,
    keys, lead, bass, kit, vox: band.vox, scratch: band.scratch,
    form, loopBars: form.reduce((a, [, n]) => a + n, 0),
  };
  plan.loopSec = plan.loopBars * barSec;
  plan.picture = typeof picture === "number" ? picture : null; // (seconds of the picture's own loop: the music's is a whole number of them)
  // How they play: the keys' comping, the bass's line, the voicing, the groove.
  plan.comp = S.weighted({
    guitar: [["strum", 3], ["arp", 2], ["stabs", 1]], organ: [["sustain", 3], ["push", 1]], felt: [["arp", 3], ["sustain", 2], ["strum", 1]],
    piano: [["arp", 2], ["stabs", 2], ["sustain", 1], ["push", 1]], vibes: [["stabs", 2], ["arp", 2], ["sustain", 1]],
  }[keys] ?? [["stabs", 3], ["push", 2], ["sustain", 2], ["arp", 1]]);
  plan.bassStyle = S.weighted([["root", 2], ["rootfifth", 3], ["walk", bass === "upright" || band.jazz > 0.4 ? 4 : 1], ["sync", bass === "synth" || bass === "electric" ? 3 : 1]]);
  plan.groove = grooveOf(S, kit);
  // Their instruments' make: how bright, the Rhodes' bell, the kick's weight, the snare's snap, how worn.
  const clamp = (x) => Math.max(0, Math.min(1, x));
  plan.design = {
    seed: hash(`${seed}|design`), bright: clamp(band.bright + S.between(-0.2, 0.2)), bell: S.between(6.4, 8.3),
    kickHz: S.between(44, 62), kickDecay: S.between(0.24, 0.55), punch: S.f(),
    snareBody: S.between(160, 235), snareTone: S.between(1300, 3400), snareDecay: S.between(0.1, 0.24), hatTone: S.between(0.82, 1.35),
    bits: Math.max(8, Math.min(14, Math.round(13 - band.worn * 4 + S.between(-1, 1)))), hold: S.chance(0.25 + band.worn * 0.4) ? 2 : 1,
    top: Math.round(5200 + (1 - band.worn) * 4000 + S.between(-800, 800)),
    pump: S.between(0.3, 0.65), strum: S.between(0.004, 0.028), spread: S.pick(["close", "open", "drop2"]),
    back: kit === "rim" ? "rim" : kit === "brushed" ? S.pick(["snare", "rim"]) : S.weighted([["snare", 4], ["clap", 1], ["both", 2]]),
  };
  // The chords: A and B walked from the seed; A2 is A with a turn or two; C sits; T turns round home.
  const len = (name) => Math.max(...form.filter(([n]) => n === name).map(([, n]) => n), 0);
  const A = progression(S, plan, 0, 8);
  const B = progression(S, plan, family === "major" ? S.pick([3, 5]) : S.pick([3, 5, 2]), 8);
  const A2 = A.map((c, i) => (i % 4 === 3 && S.chance(0.5) ? progression(S, plan, c.deg < 0 ? 0 : c.deg, 2)[1] : c));
  const cAlt = diatonic(mode, family === "major" ? S.pick([3, 5]) : S.pick([5, 3]));
  const C = Array.from({ length: Math.max(4, len("C")) }, (_, i) => (i % 2 ? cAlt : diatonic(mode, 0)));
  const T = progression(S, plan, family === "major" ? 1 : 3, Math.max(4, len("T")));
  T[T.length - 1] = family === "major" ? diatonic(mode, 4) : diatonic(mode, 6); // (it leads back to the top)
  const byName = { A, B, A2, C, T };
  plan.bars = form.flatMap(([name, n]) => byName[name].slice(0, n).map((chord, k) => ({ sec: name, k, of: n, chord })));
  plan.motif = motif(S);
  // What's outside, and what's in the room: the record's own crackle is always there.
  plan.weather = [...(mood.weather ?? ["hush"])];
  plan.room = ["vinyl", ...(mood.room ?? []).filter((r) => r !== "vinyl")];
  const dark = mood.dark ?? 0.72;
  plan.mix = {
    cutoff: Math.round((2400 + 3600 * dark) * (0.85 + 0.3 * plan.design.bright)), tape: Math.min(0.5, 0.1 + 0.3 * band.worn + S.between(0, 0.06)),
    reverb: Math.min(0.6, band.room + (mood.space ?? 0)), wow: S.between(0.1, 0.35) * (0.6 + band.worn),
    level: -4,
  };
  if (mood.energy !== undefined) plan.energy = mood.energy; // (games: where intensity starts)
  return plan;
}

// ---------------------------------------------------------------- moods for games

const W = (pairs) => pairs.filter(([, w]) => w > 0.001).map(([v, w]) => [v, Math.round(w * 1000) / 1000]);
const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(+x) ? +x : 0.5));

/**
 * A mood from a few words about a game: energy (0 idle, 1 driving), darkness
 * (0 day, 1 deep night), weather (layers under the record, WEATHER_KINDS),
 * tempo (a bpm to pin, or [lo, hi]), hue (the palette's key hue: the music's
 * key). The seed then makes the record: scoreOf(moodFor(spec), seed).
 */
export function moodFor({ energy = 0.5, darkness = 0.6, weather = ["hush"], tempo, hue, name = "Game", room = [], space = 0, pins = {} } = {}) {
  const e = clamp01(energy);
  const k = clamp01(darkness);
  const lo = Math.round(64 + 18 * e);
  const hi = Math.min(96, Math.round(lo + 12 + 4 * e));
  const band = {
    // (Night keys: Rhodes, Wurli, piano; lighter: felt, guitar, vibes; driving: Wurli, organ.)
    keys: W([["rhodes", 2 + 2 * k], ["wurli", 0.5 + 1.5 * e], ["piano", 1 + k], ["felt", 2 * (1 - e) + (1 - k)], ["vibes", 0.5 + (1 - k)], ["organ", e > 0.5 ? 2 * (e - 0.5) : 0], ["guitar", 1.5 * (1 - k)]]),
    lead: W([["rhodes", 1 + k], ["celesta", 1.5 * (1 - e)], ["kalimba", 1.5], ["musicbox", 2 * (1 - e) * (1 - k)], ["vibes", 1 + 0.5 * k], ["guitar", 1], ["chip", e > 0.6 ? (e - 0.6) * 4 : 0]]),
    bass: W([["sub", 2 + k], ["upright", 1.5 * (1 - e) + 0.5], ["electric", 1 + 2 * e], ["synth", 1.5 * e]]),
    feel: W([["dusty", 1.5 + k], ["boombap", 3 * e + 0.3], ["brushed", 2.5 * (1 - e)], ["soft", 2 * (1 - e) * (1 - k) + 0.2], ["rim", 0.8 + 0.6 * k], ["chip", e > 0.7 ? (e - 0.7) * 3 : 0]]),
    tempo: Array.isArray(tempo) ? [+tempo[0], +tempo[1]] : [lo, hi],
    swing: [0.12 + 0.1 * (1 - e), 0.24 + 0.12 * (1 - e)],
    room: 0.22 + 0.25 * (1 - e), jazz: 0.15 + 0.35 * k * (1 - 0.5 * e), vox: 0.18 + 0.2 * (1 - e), scratch: 0.2 + 0.6 * e,
    bright: 0.35 + 0.3 * (1 - k), worn: 0.45 + 0.15 * k,
  };
  if (k < 0.3) band.lean = "major";
  const mode = k > 0.62 ? "aeolian" : k > 0.4 ? "dorian" : k > 0.2 ? "mixolydian" : "ionian"; // (the seed turns it a third of the time)
  const layers = (Array.isArray(weather) ? weather : [weather]).filter((w) => WEATHER_KINDS.includes(w));
  return {
    name, band, mode, hue, view: name, weather: layers.length ? layers : ["hush"], room: room.filter((r) => ROOM_KINDS.includes(r)),
    dark: 0.3 + 0.35 * (1 - k) + 0.15 * e, space, energy: e,
    pins: typeof tempo === "number" ? { tempo, ...pins } : pins,
  };
}
