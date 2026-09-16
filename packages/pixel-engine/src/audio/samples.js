// The band's instruments, made as samples in code (NOCTURNES' src/samples.js,
// with the samples handed out as plain Float32Arrays so Node can test them).
// Lo-fi is played off samples -- a piano, a Rhodes, a break -- worn by the
// record they came from; here each is worked out once when the music starts
// (partials rung and decayed, a string plucked, a drum skin struck), then worn
// the same way (fewer bits, a lower rate, the top rolled off, a little dust)
// and played back pitched, the way a sampler plays. Every piece's are its
// own: the seed sets each instrument's make (plan.design: how bright, how much
// bell, how hard the kick, how tight the snare, how worn). Nothing is fetched.
//
//   makeSampleData(plan, rate) -> { keys: {midi: Float32Array}, lead, bass, drums: {kick, ...} }
//   makeSamples(plan, rate)    -> the same as AudioBuffers (a page, for Tone.Sampler)

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- helpers

/** Partials summed by rotation (a sine per partial without calling sin per sample). */
function partials(out, rate, list, vel = 1) {
  const n = out.length;
  for (const [f, a, tau, phase = 0, attack = 0.002] of list) {
    if (f >= rate / 2.2 || a <= 0) continue;
    const w = (TAU * f) / rate;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    let c = Math.cos(phase);
    let s = Math.sin(phase);
    const k = Math.exp(-1 / (tau * rate));
    const at = Math.max(1, Math.round(attack * rate));
    let env = a * vel;
    for (let i = 0; i < n; i += 1) {
      const rise = i < at ? i / at : 1;
      out[i] += s * env * rise;
      const c2 = c * cw - s * sw;
      s = s * cw + c * sw;
      c = c2;
      env *= k;
      if (env < 1e-5) break;
    }
  }
  return out;
}
/** A seeded noise (exact integer steps). */
function noiseOf(seed) {
  let a = seed >>> 0 || 1;
  return () => { a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 2147483648 - 1; };
}
function onePole(x, hz, rate, high = false) {
  const k = Math.exp((-TAU * hz) / rate);
  let y = 0;
  for (let i = 0; i < x.length; i += 1) { y = (1 - k) * x[i] + k * y; x[i] = high ? x[i] - y : y; }
  return x;
}
function bandpass(x, f0, q, rate) {
  const w = (TAU * f0) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const b0 = alpha; const a0 = 1 + alpha; const a1 = -2 * Math.cos(w); const a2 = 1 - alpha;
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const y = (b0 * x[i] - b0 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}
const drive = (x, k) => { const n = Math.tanh(k); for (let i = 0; i < x.length; i += 1) x[i] = Math.tanh(x[i] * k) / n; return x; };
const normalize = (x, peak = 0.9) => { let m = 1e-9; for (const v of x) m = Math.max(m, Math.abs(v)); const g = peak / m; for (let i = 0; i < x.length; i += 1) x[i] *= g; return x; };
/** Worn like a sample off a record: fewer bits, held samples (a lower rate), the top off, dust. */
function wear(x, rate, { bits = 12, hold = 2, top = 9000, dust = 0 }, rnd) {
  const q = 2 ** (bits - 1);
  let held = 0;
  for (let i = 0; i < x.length; i += 1) {
    if (i % hold === 0) held = Math.round(x[i] * q) / q;
    x[i] = held;
    if (dust && rnd() > 1 - dust) x[i] += rnd() * 0.02;
  }
  return onePole(x, top, rate);
}
const buf = (rate, sec) => new Float32Array(Math.round(rate * sec));

// ---------------------------------------------------------------- keys

// Each instrument: one note of it at f (Hz), velocity v, made `d` (the seed's make).
const KEYS = {
  // A Rhodes: the tine's fundamental and its octave ringing long, a bell-like clang at the strike.
  rhodes: (f, v, d, rate) => partials(buf(rate, 3.2), rate, [
    [f, 1, 2.6], [f * 2, 0.22 + 0.2 * d.bright, 1.3], [f * 3, 0.06, 0.7],
    [f * d.bell, 0.3 * v * (0.5 + d.bright), 0.05 + 0.03 * d.bright, 0, 0.001], [f * (d.bell * 1.52), 0.12 * v, 0.03, 0, 0.001],
  ], v),
  // A Wurlitzer: reedier, odd partials, quicker.
  wurli: (f, v, d, rate) => partials(buf(rate, 2.4), rate, [[f, 1, 1.6], [f * 2, 0.15, 1], [f * 3, 0.32 * (0.6 + d.bright), 0.6], [f * 5, 0.12 * (0.5 + d.bright), 0.3], [f * 7, 0.05, 0.15]], v),
  // A piano: two strings a hair apart, many slightly stretched partials, the higher ones dying first.
  piano: (f, v, d, rate) => {
    const list = [];
    const B = 0.00012 * (1 + f / 400);
    for (let n = 1; n <= 9; n += 1) {
      const fn = n * f * Math.sqrt(1 + B * n * n);
      const a = (1 / n ** 1.15) * Math.exp(-(n - 1) * (0.55 - 0.35 * d.bright));
      const tau = 3.2 / (1 + 0.35 * n) * (1 - f / 3000);
      list.push([fn, a * 0.6, tau], [fn * 1.0007, a * 0.4, tau * 0.9, 1.3]);
    }
    return partials(buf(rate, 3.2), rate, list, v);
  },
  // A felt piano: the hammers muffled -- the top gone, a soft thump.
  felt: (f, v, d, rate) => onePole(KEYS.piano(f, v * 0.9, { ...d, bright: d.bright * 0.3 }, rate), 1600 + 1400 * d.bright, rate),
  // A vibraphone: a pure bar, its fourth-octave partial, long.
  vibes: (f, v, d, rate) => partials(buf(rate, 3.4), rate, [[f, 1, 3], [f * 4, 0.18 + 0.12 * d.bright, 0.6], [f * 10, 0.05, 0.15, 0, 0.001]], v),
  // An organ: drawbars, held.
  organ: (f, v, d, rate) => partials(buf(rate, 2.2), rate, [[f, 0.8, 30, 0, 0.02], [f * 2, 0.45, 30, 0, 0.02], [f * 3, 0.25 * (0.5 + d.bright), 30, 0, 0.02], [f * 4, 0.12, 30, 0, 0.02], [f / 2, 0.3, 30, 0, 0.02]], v),
  // A guitar: a plucked string (Karplus-Strong), nylon-soft or steel-bright.
  guitar: (f, v, d, rate) => pluck(f, v, 2.6, 0.35 + 0.5 * d.bright, 0.996, rate, d.seed),
  // A kalimba: a tine and its high, quick overtone.
  kalimba: (f, v, d, rate) => partials(buf(rate, 1.8), rate, [[f, 1, 0.9], [f * 5.4, 0.25 + 0.2 * d.bright, 0.08, 0, 0.001], [f * 2.02, 0.08, 0.4]], v),
  // A music box: a comb's tooth -- bright and short.
  musicbox: (f, v, d, rate) => partials(buf(rate, 1.6), rate, [[f, 1, 0.7], [f * 2.0, 0.35, 0.35], [f * 4.2, 0.2 * (0.6 + d.bright), 0.12, 0, 0.001], [f * 7.9, 0.08, 0.05, 0, 0.001]], v),
  // A celesta: a struck steel plate in a box.
  celesta: (f, v, d, rate) => partials(buf(rate, 2), rate, [[f, 1, 1.1], [f * 3.9, 0.22 * (0.6 + d.bright), 0.2, 0, 0.001], [f * 2, 0.1, 0.6]], v),
};

function pluck(f, v, sec, bright, decay, rate, seed) {
  const out = buf(rate, sec);
  const n = Math.max(2, Math.round(rate / f));
  const rnd = noiseOf(seed ^ Math.round(f * 97));
  const line = new Float32Array(n);
  for (let i = 0; i < n; i += 1) line[i] = rnd() * v;
  onePole(line, 1500 + 7000 * bright, rate);
  let p = 0;
  for (let i = 0; i < out.length; i += 1) {
    const a = line[p];
    const b = line[(p + 1) % n];
    line[p] = (a + b) * 0.5 * decay;
    out[i] = a;
    p = (p + 1) % n;
  }
  return out;
}

// ---------------------------------------------------------------- bass

const BASS = {
  // An upright: a thick plucked string, low and round.
  upright: (f, v, d, rate) => onePole(pluck(f, v, 2.2, 0.15, 0.9985, rate, d.seed), 900, rate),
  // A sub: a round sine with a little second harmonic, a soft start.
  sub: (f, v, d, rate) => partials(buf(rate, 1.8), rate, [[f, 1, 1.4, 0, 0.012], [f * 2, 0.18, 0.5, 0, 0.012]], v),
  // A fingered electric: plucked, then the top taken down.
  electric: (f, v, d, rate) => onePole(pluck(f, v, 1.8, 0.3, 0.998, rate, d.seed), 1400, rate),
  // A synth bass: a filtered saw.
  synth: (f, v, d, rate) => { const list = []; for (let n = 1; n <= 10; n += 1) list.push([f * n, 0.6 / n, 1.2 / (1 + 0.25 * n), 0, 0.004]); return onePole(partials(buf(rate, 1.6), rate, list, v), 700, rate); },
};

// ---------------------------------------------------------------- drums

const DRUMS = {
  // A kick: a skin whose note drops as it's struck, a click on top, driven.
  kick: (d, rate) => {
    const x = buf(rate, 0.6);
    const rnd = noiseOf(d.seed ^ 11);
    let ph = 0;
    for (let i = 0; i < x.length; i += 1) {
      const t = i / rate;
      const f = d.kickHz + d.kickHz * 2.6 * Math.exp(-t / 0.035);
      ph += (TAU * f) / rate;
      x[i] = Math.sin(ph) * Math.exp(-t / d.kickDecay) + (t < 0.004 ? rnd() * 0.4 * (1 - t / 0.004) : 0);
    }
    return drive(x, 1.4 + d.punch * 2);
  },
  // A snare: its shell's two notes and the wires' hiss, banded.
  snare: (d, rate) => {
    const x = partials(buf(rate, 0.45), rate, [[d.snareBody, 0.7, 0.06], [d.snareBody * 1.72, 0.4, 0.04]]);
    const rnd = noiseOf(d.seed ^ 23);
    const wires = buf(rate, 0.45);
    for (let i = 0; i < wires.length; i += 1) wires[i] = rnd() * Math.exp(-i / rate / d.snareDecay);
    bandpass(wires, d.snareTone, 0.8, rate);
    for (let i = 0; i < x.length; i += 1) x[i] += wires[i] * 2.2;
    return drive(normalize(x), 1.3);
  },
  // A clap: three quick hands, then the room.
  clap: (d, rate) => {
    const x = buf(rate, 0.4);
    const rnd = noiseOf(d.seed ^ 31);
    for (let i = 0; i < x.length; i += 1) {
      const t = i / rate;
      const burst = [0, 0.011, 0.023].reduce((a, s) => a + (t >= s ? Math.exp(-(t - s) / 0.006) : 0), 0);
      x[i] = rnd() * (burst * 0.6 + Math.exp(-t / 0.12) * 0.5);
    }
    return bandpass(x, 1400, 0.9, rate);
  },
  // A rim: a hard click with a woody ring.
  rim: (d, rate) => partials(buf(rate, 0.12), rate, [[1720, 1, 0.012, 0, 0.0005], [460, 0.5, 0.02, 0, 0.0005]]),
  // Hats: six square-ish metals at the old machine's odd ratios, high-passed -- closed and open.
  hat: (d, rate, open = false) => {
    const x = buf(rate, open ? 0.5 : 0.09);
    const fs = [205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => f * d.hatTone);
    const rnd = noiseOf(d.seed ^ (open ? 41 : 43));
    const phases = fs.map(() => 0);
    for (let i = 0; i < x.length; i += 1) {
      let s = 0;
      for (let k = 0; k < fs.length; k += 1) { phases[k] += fs[k] / rate; s += phases[k] % 1 < 0.5 ? 1 : -1; }
      x[i] = (s / 6 + rnd() * 0.5) * Math.exp(-i / rate / (open ? 0.22 : 0.028));
    }
    onePole(x, 6500, rate, true);
    return bandpass(x, 9500, 0.7, rate);
  },
  // A shaker: sand in a tin, a soft push then gone.
  shaker: (d, rate) => {
    const x = buf(rate, 0.12);
    const rnd = noiseOf(d.seed ^ 53);
    for (let i = 0; i < x.length; i += 1) { const t = i / rate; x[i] = rnd() * Math.min(1, t / 0.012) * Math.exp(-t / 0.04); }
    return bandpass(x, 6200, 1.2, rate);
  },
};

// ---------------------------------------------------------------- the kit

const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

/**
 * A piece's samples as Float32Arrays: keys and lead (a root every six
 * semitones, played pitched between), bass, and the drums, all worn to the
 * piece's make. (The same numbers, in the same order, as NOCTURNES'.)
 */
export function makeSampleData(plan, rate = 44100) {
  const d = plan.design;
  const rnd = noiseOf(d.seed);
  const worn = (x, extra = {}) => wear(x, rate, { bits: d.bits, hold: d.hold, top: d.top, dust: 0.0004, ...extra }, rnd);
  const instrument = (make, lo, hi, step, vel) => {
    const map = {};
    for (let m = lo; m <= hi; m += step) map[m] = normalize(worn(make(midiHz(m), vel, d, rate)), 0.8);
    return map;
  };
  return {
    keys: instrument(KEYS[plan.keys] ?? KEYS.rhodes, 45, 84, 6, 0.8),
    lead: instrument(KEYS[plan.lead] ?? KEYS.celesta, 57, 93, 6, 0.8),
    bass: instrument(BASS[plan.bass] ?? BASS.sub, 28, 52, 6, 0.9),
    drums: Object.fromEntries([
      ["kick", DRUMS.kick(d, rate)], ["snare", DRUMS.snare(d, rate)], ["clap", DRUMS.clap(d, rate)], ["rim", DRUMS.rim(d, rate)],
      ["hat", DRUMS.hat(d, rate)], ["open", DRUMS.hat(d, rate, true)], ["shaker", DRUMS.shaker(d, rate)],
    ].map(([k, x]) => [k, normalize(worn(x, { top: d.top * 0.8 }), 0.9)])),
  };
}

/** A mono AudioBuffer of one Float32Array (a page's AudioBuffer, or `ctx`'s). */
export function toAudioBuffer(x, rate, ctx = null) {
  const b = ctx ? ctx.createBuffer(1, x.length, rate) : new AudioBuffer({ length: x.length, numberOfChannels: 1, sampleRate: rate });
  b.copyToChannel(x, 0);
  return b;
}

/** A piece's samples as AudioBuffers, ready for Tone.Sampler ({ midi: buffer } maps and the drums by name). */
export function makeSamples(plan, rate = 44100) {
  const data = makeSampleData(plan, rate);
  const map = (o) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, toAudioBuffer(x, rate)]));
  return { keys: map(data.keys), lead: map(data.lead), bass: map(data.bass), drums: map(data.drums) };
}

// (The synthesis parts, for sound effects and tests.)
export { partials, noiseOf, onePole, bandpass, drive, normalize, wear, pluck, KEYS, BASS, DRUMS, midiHz };
