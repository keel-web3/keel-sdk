// The band, on Tone: a plan (./score.js) played live on Tone's transport, or
// rendered offline as one loop that repeats with no seam. NOCTURNES' player
// (src/music.js there) with nothing of NOCTURNES left in it, and one thing
// added: INTENSITY, a live control that brings layers in and out (the drums
// and the tune come in, the top opens, the beat pushes a little faster) and
// never breaks the loop -- the bars keep their own seeds and their place.
//
//   const band = play(Tone, plan, out, { intensity: 0.5 });
//   band.setIntensity(0.9);        // running: everything in, a little faster
//   band.setIntensity(0.1);        // idle: keys and a filtered pulse
//   band.stop();
//   const loop = await render(Tone, plan);   // an AudioBuffer, one seamless loop
//
// Everything is lo-fi and all of it is made in code: the instruments are
// samples synthesised from the plan (./samples.js), the record scratches, the
// tape stops at the end of the loop, the vinyl crackles and rumbles, the tape
// wows, the keys pump under the kick. Nothing is fetched and no AudioWorklet
// is used (some viewers refuse their blob URLs).

import { makeSamples } from "./samples.js";
import { MODES, streamOf } from "./score.js";

export const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

/** Keys voiced near the last chord (E3 to G5), the root left to the bass, spread the way this seed plays. */
export function voice(plan, chord, prev) {
  const target = prev ? prev.reduce((a, b) => a + b, 0) / prev.length : 63;
  let out = chord.tones.map((t) => {
    let m = 48 + plan.tonic + t;
    while (m < target - 6) m += 12;
    while (m > target + 6) m -= 12;
    return Math.min(79, Math.max(52, m));
  });
  out = [...new Set(out)].sort((a, b) => a - b);
  // (Open: the second voice an octave down; drop 2: the second from the top down.)
  if (plan.design?.spread === "open" && out.length > 2 && out[1] - 12 >= 45) out[1] -= 12;
  if (plan.design?.spread === "drop2" && out.length > 2 && out[out.length - 2] - 12 >= 45) out[out.length - 2] -= 12;
  return out.sort((a, b) => a - b);
}

/** How each layer sits at an intensity (0 idle, 0.5 as composed, 1 driving). Pure numbers: tests read them. */
export function intensityMix(x, { tempo = 0.04 } = {}) {
  const i = Math.max(0, Math.min(1, Number.isFinite(+x) ? +x : 0.5));
  const s = (a, b) => { const t = Math.max(0, Math.min(1, (i - a) / (b - a))); return t * t * (3 - 2 * t); };
  return {
    intensity: i,
    keys: 1,
    drums: 0.3 + 0.7 * s(0.12, 0.5), // (a soft pulse when idle)
    bass: 0.55 + 0.45 * s(0.08, 0.45),
    lead: s(0.2, 0.5), // (the tune comes in toward the middle)
    focus: 650 * 2 ** (5 * s(0, 0.5)), // (the idle record is heard through a wall; open by the middle)
    lift: s(0.6, 1), // (above the middle: a busier kit on top)
    rate: 1 + tempo * (i - 0.5) * 2, // (the tempo, pushed or laid back by a few percent)
  };
}

/** A few of one voice, taken in turn (a single-voice synth can't start a note before its last is done). */
function pool(Tone, make, n, tail) {
  const list = Array.from({ length: n }, () => ({ v: make(), free: 0 }));
  return (t, dur, fire) => {
    const d = typeof dur === "number" ? dur : Tone.Time(dur).toSeconds();
    const one = list.find((x) => x.free <= t);
    if (!one) return;
    one.free = t + d + tail;
    fire(one.v, t, d);
  };
}

const DRUM_NOTE = { kick: 24, snare: 26, clap: 27, rim: 28, hat: 30, shaker: 32, open: 34 };

/** The players, off this piece's own samples: keys, lead, bass and drums, each through its own chain into `outs`. */
function makePlayers(Tone, plan, outs, cyc) {
  const s = makeSamples(plan, Tone.getContext().sampleRate);
  const keys = new Tone.Sampler({ urls: s.keys, release: plan.keys === "organ" ? 0.25 : 1.1 });
  keys.volume.value = { organ: -15, vibes: -9, guitar: -8, felt: -8 }[plan.keys] ?? -10;
  if (["rhodes", "wurli", "vibes"].includes(plan.keys)) keys.connect(new Tone.Tremolo({ frequency: cyc(plan.keys === "vibes" ? 5 : 3.1), depth: 0.3, spread: 100 }).start(0).connect(outs.keys));
  else keys.connect(outs.keys);
  const echo = new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.28, wet: 0.24 }).connect(outs.lead);
  let lead;
  if (plan.lead === "chip") {
    const voices = pool(Tone, () => { const v = new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.002, decay: 0.25, sustain: 0.15, release: 0.2 } }).connect(echo); v.volume.value = -26; return v; }, 3, 0.3);
    lead = (t, m, dur, vel) => voices(t, dur, (v, tt, d) => v.triggerAttackRelease(midiHz(m), d, tt, vel));
  } else {
    const l = new Tone.Sampler({ urls: s.lead, release: 0.9 });
    l.volume.value = -11;
    l.connect(echo);
    lead = (t, m, dur, vel) => l.triggerAttackRelease(midiHz(m), dur, t, vel);
  }
  const bass = new Tone.Sampler({ urls: s.bass, release: 0.2 });
  bass.volume.value = -5;
  bass.connect(outs.bass);
  const urls = Object.fromEntries(Object.entries(DRUM_NOTE).map(([k, n]) => [n, s.drums[k]]));
  const drums = new Tone.Sampler({ urls, release: 0.6 });
  drums.volume.value = -3;
  drums.connect(outs.drums);
  return {
    keys: (t, notes, dur, vel) => keys.triggerAttackRelease(notes.map(midiHz), dur, t, vel),
    lead,
    bass: (t, m, dur, vel) => bass.triggerAttackRelease(midiHz(m), dur, t, vel),
    hit: (name, t, vel) => drums.triggerAttack(midiHz(DRUM_NOTE[name]), t, vel),
  };
}

/** A chopped voice: a saw through two formants ("ah", "oh"), short and bent, like a sampled vocal cut up. */
function makeVox(Tone, out) {
  const bus = new Tone.Gain(0.5).connect(out);
  const f1 = new Tone.Filter({ frequency: 700, type: "bandpass", Q: 5 }).connect(bus);
  const f2 = new Tone.Filter({ frequency: 1150, type: "bandpass", Q: 6 }).connect(bus);
  const voices = pool(Tone, () => {
    const s = new Tone.MonoSynth({ oscillator: { type: "sawtooth" }, portamento: 0.03, envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.12 }, filterEnvelope: { baseFrequency: 2400, octaves: 0 } });
    s.volume.value = -14;
    s.fan(f1, f2);
    return s;
  }, 2, 0.2);
  return (t, m, dur, vowel = 0) => voices(t, dur, (v, tt, d) => {
    f1.frequency.setValueAtTime(vowel ? 500 : 720, tt);
    f2.frequency.setValueAtTime(vowel ? 880 : 1180, tt);
    v.triggerAttackRelease(midiHz(m), d, tt, 0.7);
  });
}

// ---------------------------------------------------------------- the record's own sounds

/**
 * The turntable: a scratch (the record pulled back and pushed forward under
 * the needle: noise and the chord's pitch sweeping together, gated).
 */
function makeDeck(Tone, out) {
  const noise = new Tone.Noise("pink");
  const bp = new Tone.Filter({ frequency: 1200, type: "bandpass", Q: 2.2 });
  const gateN = new Tone.Gain(0);
  noise.chain(bp, gateN, out);
  const osc = new Tone.Oscillator(220, "sawtooth");
  const lp = new Tone.Filter({ frequency: 1800, type: "lowpass" });
  const gateO = new Tone.Gain(0);
  osc.chain(lp, gateO, out);
  const start = (t) => { noise.start(t); osc.start(t); };
  // A stroke: forward (up) or back (down), the level cut in and out by the fader.
  const stroke = (t, d, up, hz, level) => {
    const [a, b] = up ? [0.45, 1.6] : [1.6, 0.45];
    bp.frequency.setValueAtTime(900 * a, t);
    bp.frequency.exponentialRampToValueAtTime(900 * b, t + d);
    osc.frequency.setValueAtTime(hz * a, t);
    osc.frequency.exponentialRampToValueAtTime(hz * b, t + d);
    for (const [gate, l] of [[gateN, level], [gateO, level * 0.35]]) {
      gate.gain.setValueAtTime(0, t);
      gate.gain.linearRampToValueAtTime(l, t + d * 0.15);
      gate.gain.setValueAtTime(l, t + d * 0.8);
      gate.gain.linearRampToValueAtTime(0, t + d);
    }
  };
  return {
    start,
    /** A baby scratch, a transformer (the fader chopping it) or a chirp, over a beat. */
    scratch: (t, hz, R, beatSec) => {
      const kind = R.pick(["baby", "baby", "transformer", "chirp"]);
      const n = kind === "transformer" ? 8 : 4;
      const d = beatSec / (n / 2);
      for (let i = 0; i < n; i += 1) stroke(t + i * d, d * (kind === "chirp" ? 0.55 : 0.92), i % 2 === 0, hz, kind === "transformer" && i % 2 ? 0.05 : 0.22);
    },
  };
}

// ---------------------------------------------------------------- the weather

function makeWeather(Tone, plan, out, cyc) {
  const layers = [];
  const db = (x) => 10 ** (x / 20);
  const bed = (type, lo, hi, level) => {
    const n = new Tone.Noise(type);
    const f = new Tone.Filter({ frequency: hi, type: "lowpass" });
    const h = new Tone.Filter({ frequency: lo, type: "highpass" });
    const v = new Tone.Gain(db(level));
    n.chain(h, f, v, out);
    layers.push(n);
    return { n, f, v };
  };
  // (A swell a whole number of times round the loop, so the loop has no seam.)
  const swell = (param, rate, lo, hi, lin = false) => new Tone.LFO({ frequency: cyc(rate), min: lin ? lo : db(lo), max: lin ? hi : db(hi) }).start(0).connect(param);
  for (const w of [...plan.weather, ...plan.room]) {
    if (w === "rain") { const r = bed("pink", 400, 3200, -30); swell(r.v.gain, 0.07, -33, -27); }
    else if (w === "waves") { const s = bed("pink", 120, 900, -30); swell(s.f.frequency, 0.11, 300, 1300, true); swell(s.v.gain, 0.11, -40, -27); }
    else if (w === "traffic") { const s = bed("brown", 30, 380, -32); swell(s.v.gain, 0.03, -36, -29); }
    else if (w === "wind") { const s = bed("pink", 200, 700, -38); swell(s.f.frequency, 0.05, 250, 900, true); }
    else if (w === "hush") bed("pink", 900, 6000, -46);
    else if (w === "vinyl") { bed("brown", 500, 2600, -40); const rum = new Tone.Oscillator(cyc(31), "sine"); rum.chain(new Tone.Gain(db(-38)), out); layers.push(rum); } // (the platter's rumble)
    else if (w === "fan") { const s = bed("pink", 180, 1100, -36); swell(s.v.gain, 7.5, -38, -34); }
    else if (w === "hum") { const o = new Tone.Oscillator(cyc(60), "sine"); o.chain(new Tone.Gain(db(-44)), out); layers.push(o); }
    else if (w === "crackle") bed("brown", 1500, 5000, -44);
    else if (w === "shimmer") {
      for (const [k, rate] of [[24, 0.05], [31, 0.071], [36, 0.093]]) {
        const o = new Tone.Oscillator(cyc(midiHz(48 + plan.tonic + k)), "sine"); // (a tone held round the loop comes back in phase)
        const v = new Tone.Gain(0);
        o.chain(v, out);
        swell(v.gain, rate, -62, -40);
        layers.push(o);
      }
    }
  }
  const tickOut = new Tone.Filter({ frequency: 3000, type: "bandpass", Q: 1 });
  tickOut.chain(new Tone.Gain(db(-24)), out);
  const tick = pool(Tone, () => new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.01, sustain: 0 } }).connect(tickOut), 4, 0.05);
  const chirpOut = new Tone.Gain(db(-38)).connect(out);
  const chirp = pool(Tone, () => new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.004, decay: 0.03, sustain: 0, release: 0.02 } }).connect(chirpOut), 6, 0.05);
  const chimeOut = new Tone.Gain(db(-34)).connect(out);
  const chime = pool(Tone, () => new Tone.FMSynth({ harmonicity: 3.1, modulationIndex: 5, envelope: { attack: 0.001, decay: 2.5, sustain: 0, release: 2 } }).connect(chimeOut), 2, 2.5);
  const carN = new Tone.Noise("pink");
  const carF = new Tone.Filter({ frequency: 400, type: "lowpass" });
  const carV = new Tone.Gain(0);
  carN.chain(carF, carV, out);
  layers.push(carN);
  const kinds = [...plan.weather, ...plan.room];
  const events = (t0, t1, R) => {
    for (let t = t0; t < t1; t += 0.05) {
      if (kinds.includes("rain") && R.chance(0.08)) chirp(t, 0.02, (s, tt, d) => s.triggerAttackRelease(R.between(2200, 4200), d, tt, 0.3));
      if (R.chance(kinds.includes("crackle") ? 0.07 : 0.035)) tick(t, 0.01, (s, tt, d) => s.triggerAttackRelease(d, tt, R.between(0.2, 0.9))); // (the record's pops)
      if (kinds.includes("crickets") && R.chance(0.025)) { const f = R.between(4300, 4800); for (let k = 0; k < 3; k += 1) chirp(t + k * 0.06, 0.025, (s, tt, d) => s.triggerAttackRelease(f, d, tt, 0.5)); }
      if (kinds.includes("chimes") && R.chance(0.004)) chime(t, 2, (s, tt, d) => s.triggerAttackRelease(midiHz(84 + plan.tonic + R.pick([0, 7, 12])), d, tt, 0.4));
      if ((kinds.includes("car") || kinds.includes("traffic")) && R.chance(0.003)) {
        const d = R.between(2.5, 4);
        carV.gain.setValueAtTime(0, t);
        carV.gain.linearRampToValueAtTime(db(-30), t + d * 0.5);
        carV.gain.linearRampToValueAtTime(0, t + d);
        carF.frequency.setValueAtTime(900, t);
        carF.frequency.exponentialRampToValueAtTime(260, t + d);
      }
    }
  };
  return { start: (t) => layers.forEach((l) => l.start(t)), events };
}

// ---------------------------------------------------------------- playing it

/**
 * The band set up on Tone's transport, into `out` (Tone's destination if
 * none), playing the loop from bar `from`. `intensity` (0-1) starts where the
 * plan's energy says, or 0.5 (as composed); `tempo` is how far intensity may
 * push the tempo (a fraction each way; 0 holds it).
 * Returns { ready, stop, react, setIntensity, intensity }.
 */
export function play(Tone0, plan, out = null, { start = true, from = 0, intensity = plan.energy ?? 0.5, tempo = 0.04 } = {}) {
  // (Everything made here is kept, so stopping takes all of it away.)
  const made = [];
  const Tone = new Proxy(Tone0, {
    get(t, k) {
      const v = t[k];
      if (typeof v !== "function" || !/^[A-Z]/.test(k) || !v.prototype?.dispose) return v;
      return new Proxy(v, { construct(C, args) { const o = new C(...args); made.push(o); return o; } });
    },
  });
  const T = Tone.getTransport();
  let mix = intensityMix(intensity, { tempo });
  T.bpm.value = plan.bpm * mix.rate;
  T.swing = plan.swing;
  T.swingSubdivision = "16n";
  const d = plan.design;
  // A rate made a whole number of cycles round the loop.
  const cyc = (hz) => Math.max(1, Math.round(hz * plan.loopSec)) / plan.loopSec;

  // The record: the top rolled off (and swept round the loop), the tape (its
  // reel, stopped at the end; its saturation), the room, a leveller, a ceiling.
  const master = new Tone.Volume(plan.mix.level);
  const comp = new Tone.Compressor({ threshold: -32, ratio: 8, knee: 12, attack: 0.05, release: 0.4 });
  const tone = new Tone.Filter({ frequency: plan.mix.cutoff, type: "lowpass", rolloff: -12 });
  new Tone.LFO({ frequency: 1 / plan.loopSec, min: plan.mix.cutoff * 0.72, max: plan.mix.cutoff * 1.2, phase: 90 }).start(0).connect(tone.frequency);
  const warm = new Tone.Filter({ frequency: 90, type: "highshelf", gain: 0 }); // (placeholder stage kept flat: the samples carry their own colour)
  const reel = new Tone.Delay({ delayTime: 0.002, maxDelay: 2 });
  const reelLevel = new Tone.Gain(1);
  const tape = new Tone.Distortion({ distortion: 0.22, wet: plan.mix.tape, oversample: "none" });
  const room = new Tone.Reverb({ decay: 2 + plan.mix.reverb * 4, preDelay: 0.02, wet: plan.mix.reverb });
  const limit = new Tone.Limiter(-3);
  const ceiling = new Tone.WaveShaper((x) => (Math.tanh(x * 1.2) / Math.tanh(1.2)) * 0.97, 1024);
  tone.chain(warm, reel, reelLevel, tape, room, comp, master, limit, ceiling);
  ceiling.connect(out ?? Tone.getDestination());
  // (Intensity: the band heard through a wall when idle, the wall gone by the middle.)
  const focus = new Tone.Filter({ frequency: Math.min(20000, mix.focus), type: "lowpass", rolloff: -12, Q: 0.5 });
  focus.connect(tone);
  // The buses: keys pump under the kick and wow with the tape (the lead wows too); the drums glued and dusted.
  const wow = new Tone.Vibrato({ frequency: cyc(plan.mix.wow + 0.25), depth: 0.04 + plan.mix.wow * 0.08 });
  wow.connect(focus);
  const level = (x, to) => new Tone.Gain(x).connect(to);
  const layer = { keys: level(mix.keys, wow), lead: level(mix.lead, wow), bass: level(mix.bass, focus), drums: level(mix.drums, focus) };
  const duck = new Tone.Gain(1);
  duck.connect(layer.keys);
  const drumBus = new Tone.Compressor({ threshold: -18, ratio: 4, attack: 0.005, release: 0.12 });
  drumBus.chain(new Tone.Filter({ frequency: Math.min(9000, d.top * 1.1), type: "lowpass" }), layer.drums);
  const band = makePlayers(Tone, plan, { keys: duck, lead: layer.lead, bass: layer.bass, drums: drumBus }, cyc);
  const vox = makeVox(Tone, duck);
  const deck = makeDeck(Tone, comp);
  const weather = makeWeather(Tone, plan, comp, cyc);
  const pad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "fatsawtooth", count: 3, spread: 16 }, envelope: { attack: 1.2, decay: 1, sustain: 0.7, release: 2.5 } });
  pad.volume.value = -28;
  pad.chain(new Tone.Filter({ frequency: 800, type: "lowpass", rolloff: -24 }), duck);
  // (A swell of noise up into a downbeat, like a cymbal played backwards.)
  const riser = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: (60 / plan.bpm) * 3.8, decay: 0.01, sustain: 1, release: 0.05 } });
  riser.chain(new Tone.Filter({ frequency: 5000, type: "highpass" }), new Tone.Gain(0.05), comp);

  const sc = MODES[plan.mode];
  const L = plan.loopBars;

  // The lead's line for a bar: the motif, developed through the section.
  function melody(bar) {
    const m = plan.motif;
    const home = 69 + plan.tonic - (plan.tonic > 5 ? 12 : 0);
    // (A phrase starts on its first bar's chord tone nearest home: no memory of earlier bars, so the loop can start anywhere.)
    const startOn = (chord) => { const cand = chord.tones.map((x) => home - 5 + ((x - (home - 5 - plan.tonic)) % 12 + 12) % 12); return cand.reduce((a, b) => (Math.abs(b - home) < Math.abs(a - home) ? b : a)); };
    const half = bar.k % 2;
    const phraseFirst = plan.bars[(bar.index - half + L) % L];
    let moves = m.moves;
    let shift = 0;
    const part = Math.floor(bar.k / 2);
    if (bar.sec === "B") { if (part === 2) moves = moves.map((x) => -x); if (part === 3) shift = 2; }
    let p = startOn(phraseFirst.chord);
    const notes = [];
    m.rhythm.forEach((s, i) => {
      p += moves[i];
      const step = s + shift;
      if (Math.floor(step / 16) !== half) return;
      const want = step % 4 === 0 ? bar.chord.tones.map((x) => (x + plan.tonic) % 12) : sc.map((x) => (x + plan.tonic) % 12);
      let q = p;
      for (let k = 0; k < 7 && !want.includes(((q % 12) + 12) % 12); k += 1) q += k % 2 ? -k : k;
      notes.push([step % 16, Math.max(60, Math.min(88, q)), Math.min(m.lengths[i], 8)]);
    });
    if (bar.sec === "B" && bar.k === bar.of - 1 && notes.length) notes[notes.length - 1][2] = 12;
    return notes;
  }

  const bar = (time, n) => {
    // (The step's length from the transport now: intensity may have moved the tempo.)
    const sixteenth = Tone.Time("16n").toSeconds();
    const beat = sixteenth * 4;
    const index = ((n % L) + L) % L;
    const b = { ...plan.bars[index], index };
    const R = streamOf(`${plan.seed}|bar|${index}`);
    const next = plan.bars[(index + 1) % L];
    const prevChord = plan.bars[(index - 1 + L) % L].chord;
    const notes = voice(plan, b.chord, voice(plan, prevChord, null));
    const root = 36 + ((plan.tonic + b.chord.root) % 12);
    const toNext = 36 + ((plan.tonic + next.chord.root) % 12);
    const at = (step) => Math.max(time, time + step * sixteenth + R.between(-0.006, 0.012)); // (a hand's looseness, never before the bar)
    const sec = b.sec;
    const last = b.k === b.of - 1;
    const gr = plan.groove;

    // ---- keys: this seed's way of comping, busier in B, held in the break
    const chordAt = (t, dur, vel) => {
      // (A strum: each note a moment after the one below it; a hand's weight on each.)
      notes.forEach((m, i) => band.keys(t + i * d.strum, [m], dur, vel * R.between(0.85, 1.05)));
    };
    if (sec === "C") chordAt(at(0), "1m", 0.5);
    else if (plan.comp === "arp") {
      const up = [...notes, notes[0] + 12, notes[1] + 12];
      const steps = sec === "B" ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 3, 6, 8, 11, 14];
      const path = R.pick([[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 1, 3, 2, 4, 3, 1], [4, 3, 2, 1, 0, 1, 2, 3]]);
      steps.forEach((s, k) => band.keys(at(s), [up[path[k % path.length] % up.length]], "8n", R.between(0.35, 0.55)));
      if (R.chance(0.5)) band.keys(at(0), [notes[0]], "2n", 0.35);
    } else {
      const hits = {
        sustain: sec === "B" ? [[0, "2n", 0.6], [8, "2n", 0.45]] : [[0, "1m", 0.6]],
        push: [[0, "8n", 0.6], [7, "4n", 0.5], [14, "8n", 0.42]],
        strum: [[0, "4n.", 0.62], [6, "8n", 0.38], [8, "4n", 0.55], [14, "8n", 0.35]],
        stabs: sec === "B" ? R.pick([[[0, "4n.", 0.62], [6, "8n", 0.4], [10, "4n", 0.5]], [[0, "8n", 0.6], [3, "8n", 0.4], [8, "4n.", 0.55]]]) : R.pick([[[0, "2n", 0.6], [10, "4n", 0.45]], [[0, "4n.", 0.6], [11, "8n", 0.4]]]),
      }[plan.comp] ?? [[0, "2n", 0.6]];
      for (const [s, dur, v] of hits) if (s === 0 || R.chance(0.85)) chordAt(at(s), dur, v);
    }
    if (sec === "C" || (sec === "A2" && R.chance(0.3))) pad.triggerAttackRelease(notes.map(midiHz), "1m", time, 0.5);

    // ---- bass: this seed's line; in the break only the one
    if (sec === "C") { if (b.k === 0) band.bass(at(0), root, "1m", 0.7); }
    else {
      const third = root + (b.chord.tones[0] - b.chord.root + 24) % 12;
      const fifth = root + 7;
      const line = {
        root: [[0, root, "2n"], [10, root, "8n"]],
        rootfifth: [[0, root, "4n."], [8, fifth, "4n"], [14, toNext + R.pick([-1, 1]), "16n"]],
        walk: [[0, root, "4n"], [4, R.pick([third, fifth]), "4n"], [8, R.pick([fifth, root + 9, root + 12]), "4n"], [12, toNext + R.pick([-1, 1, -2]), "4n"]],
        sync: [[0, root, "8n."], [3, root, "16n"], [7, root + 12, "8n"], [10, root, "8n"], [14, fifth, "16n"]],
      }[plan.bassStyle];
      for (const [s, m, dur] of line) if (s === 0 || R.chance(sec === "A" ? 0.75 : 0.9)) band.bass(at(s), m, dur, s === 0 ? 0.9 : 0.7);
    }

    // ---- drums: this seed's groove; ghosts and open hats as it goes on; a kick and a shaker in the break; a fill into each section
    if (sec === "C") {
      if (b.k % 2 === 0) band.hit("kick", at(0), 0.55);
      for (const s of [0, 4, 8, 12]) band.hit(gr.shaker.length ? "shaker" : "hat", at(s), 0.25);
    } else {
      const kicks = [...gr.kick];
      if (sec !== "A" && R.chance(0.35)) kicks.push(R.pick([3, 11, 13, 15]));
      for (const s of kicks) {
        band.hit("kick", at(s), R.between(0.78, 0.98));
        duck.gain.setValueAtTime(1 - d.pump, at(s));
        duck.gain.linearRampToValueAtTime(1, at(s) + beat * 0.65);
      }
      for (const s of gr.back) {
        const v = R.between(0.66, 0.86);
        if (d.back === "rim") band.hit("rim", at(s), v);
        else if (d.back === "clap") band.hit("clap", at(s), v);
        else { band.hit("snare", at(s), v); if (d.back === "both") band.hit("clap", at(s) + 0.008, v * 0.6); }
      }
      for (const s of gr.hat) band.hit(gr.open.includes(s) && R.chance(sec === "B" ? 0.7 : 0.35) ? "open" : "hat", at(s), (s % 4 === 0 ? 0.62 : 0.4) * R.between(0.8, 1.1));
      for (const s of gr.shaker) band.hit("shaker", at(s), (s % 4 === 2 ? 0.45 : 0.3) * R.between(0.8, 1.1));
      if (sec !== "A") for (const s of gr.ghost) if (R.chance(0.6)) band.hit(d.back === "rim" ? "rim" : "snare", at(s), 0.16);
      if (last && sec !== "T") for (const s of [12, 13, 14, 15]) if (s > 12 || R.chance(0.5)) band.hit("snare", at(s), R.between(0.3, 0.55));
      // (Driving: a busier kit on top, from a stream of its own, so the bar's own stays as written.)
      if (mix.lift > 0) {
        const U = streamOf(`${plan.seed}|bar|${index}|lift`);
        for (const s of [1, 3, 5, 7, 9, 11, 13, 15]) if (!gr.hat.includes(s) && U.chance(mix.lift * 0.8)) band.hit("hat", at(s), 0.22 * U.between(0.8, 1.1));
        if (U.chance(mix.lift * 0.5)) band.hit("kick", at(U.pick([6, 14, 15])), 0.6);
        if (!gr.shaker.length && U.chance(mix.lift * 0.6)) for (const s of [2, 6, 10, 14]) band.hit("shaker", at(s), 0.2);
      }
    }

    // ---- the tune in B; its answers in A2; chopped voice in T and here and there
    if (sec === "B") for (const [s, m, len] of melody(b)) band.lead(at(s), m, len * sixteenth, R.between(0.5, 0.75));
    if (sec === "A2" && b.k % 2 === 1) for (const [s, m] of melody(b).slice(-2)) band.lead(at(s), m + (R.chance(0.5) ? 12 : 0), "8n", 0.45);
    if ((sec === "T" || (sec === "A2" && R.chance(plan.vox))) && R.chance(0.3 + plan.vox)) {
      const tones = notes.slice(-3);
      for (const s of R.pick([[0, 3, 6], [2, 6, 10, 11], [0, 6, 8, 14]])) vox(at(s), R.pick(tones) + 12, sixteenth * R.pick([1.5, 2, 3]), R.int(0, 1));
    }
    // ---- the record: scratched into a new section (and into T), stopped at the end of the loop
    if (last && sec !== "C" && R.chance(plan.scratch)) deck.scratch(at(12), midiHz(root + 24), R, beat);
    if (sec === "T" && b.k === 0 && R.chance(plan.scratch)) deck.scratch(at(0), midiHz(root + 24), R, beat);
    if (index === L - 1) {
      // A tape stop on the last beat: the reel's delay lengthens as t²/2, the pitch falls to nothing; the top comes round.
      const t0 = time + 12 * sixteenth;
      const curve = new Float32Array(32).map((_, i) => 0.002 + ((i / 31) * beat) ** 2 / (2 * beat));
      reel.delayTime.setValueCurveAtTime(curve, t0, beat * 0.98);
      reelLevel.gain.setValueAtTime(1, t0 + beat * 0.6);
      reelLevel.gain.linearRampToValueAtTime(0, t0 + beat * 0.97);
      reel.delayTime.setValueAtTime(0.002, t0 + beat);
      reelLevel.gain.setValueAtTime(1, t0 + beat);
    }
    if (sec === "C" && last) riser.triggerAttackRelease(beat * 3.9, time);
    weather.events(time, time + 16 * sixteenth, R);
  };

  let n = from;
  const loop = new Tone.Loop((time) => { bar(time, n); n += 1; }, "1m");
  deck.start(0);
  weather.start(0);
  loop.start(0);
  if (start) { T.stop(); T.position = 0; T.start("+0.05"); } // (from the top, whatever played before)

  return {
    ready: room.ready, // (the reverb's room is worked out before it sounds)
    // Out over a moment, then everything it made is gone. The transport is the
    // page's own: only a band not followed by another stops it.
    stop: (fade = 0.4, { transport = true } = {}) => {
      loop.dispose();
      master.volume.rampTo(-80, fade);
      if (transport) T.stop(); // (at once -- a stop left pending in a context that's then suspended would fire after the next start)
      setTimeout(() => { for (const o of made) { try { o.dispose(); } catch {} } }, fade * 1000 + 80);
    },
    // What happens around it changes the record: a light out, a little quieter.
    react: (what) => {
      const now = Tone.now();
      if (what === "dim") master.volume.rampTo(plan.mix.level - 4, 1.2, now);
      if (what === "bright") master.volume.rampTo(plan.mix.level, 1.2, now);
    },
    /** Layers in and out over `ramp` seconds (0 idle, 0.5 as composed, 1 driving); the loop runs on. */
    setIntensity(x, ramp = 1.2) {
      const next = intensityMix(x, { tempo });
      if (Math.abs(next.intensity - mix.intensity) < 0.01) return; // (called every step: only a real change moves anything)
      mix = next;
      for (const k of ["keys", "lead", "bass", "drums"]) layer[k].gain.rampTo(mix[k], ramp);
      focus.frequency.exponentialRampTo(Math.min(20000, mix.focus), ramp);
      if (tempo) T.bpm.rampTo(plan.bpm * mix.rate, ramp * 2);
    },
    get intensity() { return mix.intensity; },
  };
}

/**
 * One loop of the music, offline, as an AudioBuffer that repeats with no seam:
 * it is played from a few bars before the top (their tails ring into it, as
 * they do going round) and those bars are cut away. (Intensity holds still
 * for a render: tempo 0.) `overrun` seconds more are kept past the loop's end:
 * what the band plays going round, to hold against the loop's own start.
 */
export async function render(Tone, plan, { preroll = 4, intensity, rate = 44100, overrun = 0 } = {}) {
  const pre = preroll * plan.barSec;
  const buf = await Tone.Offline(async () => {
    const band = play(Tone, plan, null, { start: false, from: plan.loopBars - preroll, intensity: intensity ?? plan.energy ?? 0.5, tempo: 0 });
    await band.ready;
    Tone.getTransport().start(0);
  }, pre + plan.loopSec + overrun, 2, rate);
  const raw = buf.get?.() ?? buf;
  const skip = Math.round(pre * raw.sampleRate);
  const len = Math.round((plan.loopSec + overrun) * raw.sampleRate);
  const out = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: raw.sampleRate });
  for (let c = 0; c < 2; c += 1) out.copyToChannel(raw.getChannelData(c).subarray(skip, skip + len), c);
  return out;
}
