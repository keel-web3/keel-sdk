// The Sound tab's audition frame: Tone and keel-audio are page scripts (loaded
// before this), the engine's audio plays what the editor posts -- a plan (the
// music), its intensity live, a sound effect with the project's sfx settings --
// and renders one seamless loop to WAV for the editor's export. It runs
// sandboxed (a keel-preview frame: scripts only, no network, no storage) and
// knows nothing of the project: it answers only the editor window holding it.
// Bundled by the sound worker with the engine checkout's own source.
import { createSfx, encodeWav, measureLoop, pageTone, play, render } from '@keel-engine/audio';

const meter = document.getElementById('meter');
const stateEl = document.getElementById('state');
const label = document.getElementById('label');
const send = (message, transfer) => parent.postMessage(message, '*', transfer);
const Tone = pageTone();

const state = { context: 'none', playing: false, plan: null, intensity: 0.5, started: 0, plays: 0, sfxPlayed: 0, renders: 0, lastSfx: null, error: null, band: null, sfx: null, sfxKey: '', loops: new Map() };
globalThis.soundPreview = state;
const report = () => ({ context: Tone?.getContext?.().rawContext?.state ?? 'none', playing: state.playing, intensity: state.intensity, plan: state.plan ? { seed: state.plan.seed, bpm: state.plan.bpm, mode: state.plan.mode, keys: state.plan.keys } : null, plays: state.plays, sfxPlayed: state.sfxPlayed, lastSfx: state.lastSfx, renders: state.renders, error: state.error, keelAudio: !!globalThis.KEEL_AUDIO });
const update = () => { const r = report(); state.context = r.context; stateEl.textContent = `${r.context} · ${state.playing ? `playing · intensity ${state.intensity.toFixed(2)}` : 'stopped'}${state.sfxPlayed ? ` · ${state.sfxPlayed} sfx` : ''}`; send({ type: 'state', state: r }); };

async function start() {
  if (!Tone) throw new Error('Tone is not on this page.');
  await Tone.start();
  // (A hidden or unfocused window may keep the context suspended; resume, and report what it is.)
  const raw = Tone.getContext().rawContext;
  if (raw.state !== 'running') { try { await raw.resume(); } catch { /* It reports its state. */ } }
}

async function playPlan(plan, intensity) {
  await start();
  stop(0.05);
  state.plan = plan; state.intensity = intensity;
  state.band = play(Tone, plan, null, { intensity });
  state.playing = true; state.plays += 1; state.started = performance.now();
  label.textContent = `${plan.theme} · ${plan.bpm.toFixed(0)} bpm · ${plan.mode} · ${plan.keys}/${plan.lead}/${plan.bass}/${plan.kit} · ${plan.loopBars} bars`;
  await state.band.ready;
}
function stop(fade = 0.3) {
  if (state.band) { try { state.band.stop(fade); } catch { /* Already gone. */ } }
  state.band = null; state.playing = false;
}

async function sfxFor(settings) {
  await start();
  const key = JSON.stringify(settings);
  if (state.sfx && state.sfxKey === key) return state.sfx;
  for (const loop of state.loops.values()) loop.stop(0.05);
  state.loops.clear();
  state.sfx?.dispose?.();
  state.sfx = createSfx(Tone, { settings });
  state.sfxKey = key;
  return state.sfx;
}

async function renderLoop(plan, rate, intensity) {
  const buffer = await render(Tone, plan, { rate, intensity });
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const wav = encodeWav(channels, buffer.sampleRate);
  state.renders += 1;
  return { wav, seconds: buffer.duration, measure: measureLoop(channels, buffer.sampleRate) };
}

// A level meter off the destination: something to watch while it plays.
let analyser = null;
function draw() {
  const g = meter.getContext('2d');
  const w = meter.width = meter.clientWidth, h = meter.height = meter.clientHeight;
  g.fillStyle = '#0d0d15'; g.fillRect(0, 0, w, h);
  if (state.playing && Tone) {
    try {
      if (!analyser) { const raw = Tone.getContext().rawContext; analyser = raw.createAnalyser(); analyser.fftSize = 256; Tone.getDestination().connect(analyser); }
    } catch { analyser = null; }
    const bins = new Uint8Array(analyser?.frequencyBinCount ?? 64);
    analyser?.getByteFrequencyData(bins);
    const n = 48, bw = w / n;
    for (let i = 0; i < n; i += 1) { const v = (bins[Math.floor(i * bins.length / n)] ?? 0) / 255; g.fillStyle = `hsl(${250 - v * 120},70%,${35 + v * 30}%)`; g.fillRect(i * bw + 1, h - v * (h - 30) - 18, bw - 2, v * (h - 30)); }
  }
  // (A timer, not requestAnimationFrame: a hidden pane stops rAF.)
  setTimeout(draw, 80);
}
draw();

addEventListener('message', async (event) => {
  if (event.source !== parent) return;
  const m = event.data;
  if (!m || typeof m !== 'object') return;
  try {
    if (m.type === 'play' && m.plan) { await playPlan(m.plan, Number(m.intensity ?? m.plan.energy ?? 0.5)); send({ type: 'played', id: m.id, state: report() }); }
    else if (m.type === 'intensity') { state.intensity = Math.max(0, Math.min(1, Number(m.value))); state.band?.setIntensity(state.intensity, Number(m.ramp ?? 0.6)); send({ type: 'ok', id: m.id, state: report() }); }
    else if (m.type === 'stop') { stop(); send({ type: 'ok', id: m.id, state: report() }); }
    else if (m.type === 'sfx') {
      const sfx = await sfxFor(m.settings);
      const name = String(m.name);
      if (m.loop) {
        const held = state.loops.get(name);
        if (held) { held.stop(0.15); state.loops.delete(name); }
        else { state.loops.set(name, sfx.loop(name, m.params ?? {})); setTimeout(() => { const l = state.loops.get(name); if (l) { l.stop(0.3); state.loops.delete(name); } }, Number(m.hold ?? 2500)); }
      } else if (!sfx.play(name, m.params ?? {})) throw new Error(`No sound ${name} in this palette.`);
      state.sfxPlayed += 1; state.lastSfx = name;
      send({ type: 'ok', id: m.id, state: report() });
    } else if (m.type === 'render' && m.plan) {
      const { wav, seconds, measure } = await renderLoop(m.plan, Number(m.rate ?? 44100), m.intensity);
      send({ type: 'rendered', id: m.id, wav, seconds, measure, state: report() }, [wav.buffer]);
    }
    state.error = null;
  } catch (error) {
    state.error = String(error?.message ?? error);
    send({ type: 'error', id: m.id, message: state.error, state: report() });
  }
  update();
});
setInterval(update, 1000);
send({ type: 'ready', tone: !!Tone, keelAudio: !!globalThis.KEEL_AUDIO });
