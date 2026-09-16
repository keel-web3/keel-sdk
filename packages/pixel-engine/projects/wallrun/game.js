// WALLRUN in the browser: the headless world (sim.js) drawn by the engine's
// pixel renderer, with its sound -- a generative lo-fi record from the seed
// (faster and fuller while running, filtered when standing) and footsteps,
// scrapes, grinds and splashes off the body's events. Everything that happens
// is in the sim; this paints it and plays it. (Sound needs Tone -- and plays
// through keel-audio when the page has it -- and starts on the listener's click.)

import { createPixelRenderer } from "../../src/gpu/pixel-renderer.js";
import { bodySfx, createSound, moodFor, scoreOf } from "../../src/audio/index.js";
import { createSim } from "./sim.js";

export { screenFor } from "./sim.js";

// The record's mood: night over dark water, wind and waves, running.
const moodOf = (hue) => moodFor({ name: "Night Water", energy: 0.65, darkness: 0.7, weather: ["waves", "wind"], hue });

export function createGame(canvas, { seed = "1", width = 128, height = 128, sound: withSound = true, host = document.body } = {}) {
  const px = createPixelRenderer(canvas, { width, height });
  const sound = withSound ? createSound(host, { id: "wallrun", sfx: { seed: String(seed), style: "lofi" } }) : null;
  let feet = null;
  // (A new seed brings its own palette and its own record.)
  const paint = (sim) => {
    const L = sim.look;
    px.setPalette(L.colours, L.ramps); px.setMaterials(L.materials); px.setStyle(L.style);
    sound?.setPlan(scoreOf(moodOf(L.hue), sim.seed));
  };
  // (Every step: the body's sounds, and the record's intensity following the run.)
  const listen = (sim, dt) => {
    if (!sound) return;
    if (sound.on && !feet) feet = bodySfx(sound.sfx, { surfaceOf: () => sim.surface() });
    if (!sound.on && feet) { feet.stop(); feet = null; }
    feet?.update(sim.body, dt);
    const speed = Math.hypot(sim.body.vel[0], sim.body.vel[2]);
    sound.setIntensity(Math.min(1, 0.15 + speed / 11), 1.5);
  };
  const sim = createSim({ seed, width, height, onLoad: paint, onStep: listen });

  function draw() {
    const f = sim.frame();
    px.setWorld({ boxes: f.boxes, capsules: f.capsules });
    px.render({ ...f.view, particles: f.particles });
  }

  // The sim's own api, with drawing, sound and the screen's size added.
  return Object.assign(Object.create(sim), {
    px,
    sound,
    attachInput(target = globalThis, opts = {}) { return sim.attachInput(target, { canvas, ...opts }); },
    setTarget(w, h) { px.setTarget(w, h); sim.setTarget(w, h); px.setStyle(sim.look.style); },
    tick(dt) { sim.advance(dt); draw(); },
    draw,
  });
}
