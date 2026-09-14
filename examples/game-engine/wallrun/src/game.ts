// WALLRUN in the browser: the headless world (sim.ts) drawn by the engine's
// pixel renderer, with its sound -- a generative lo-fi record from the seed
// (faster and fuller while running, filtered when standing) and footsteps,
// scrapes, grinds and splashes off the body's events. Everything that happens
// is in the sim; this paints it and plays it. (Sound needs Tone -- and plays
// through keel-audio when the page has it -- and starts on the listener's
// click. Without Tone on the page the game is silent.)

import { createPixelRenderer } from "@keel/game-engine/render";
import type { PixelRenderer } from "@keel/game-engine/render";
import { bodySfx, createSound, moodFor, pageTone, scoreOf } from "@keel/game-engine/audio";
import type { BodySfx, GameMood, Sound } from "@keel/game-engine/audio";
import type { AttachOptions, EventTargetLike } from "@keel/game-engine/input";
import { createSim } from "./sim.ts";
import type { Sim } from "./sim.ts";

export { screenFor } from "./sim.ts";

// The record's mood: night over dark water, wind and waves, running.
const moodOf = (hue: number): GameMood => moodFor({ name: "Night Water", energy: 0.65, darkness: 0.7, weather: ["waves", "wind"], hue });

export interface GameOptions {
  seed?: string;
  width?: number;
  height?: number;
  /** Play sound (when the page has Tone). */
  sound?: boolean;
  /** Where the speaker button goes (default: the page's body). */
  host?: HTMLElement;
}
/** The sim's own api, with drawing, sound and the screen's size added. */
export interface Game extends Sim {
  readonly px: PixelRenderer;
  readonly sound: Sound | null;
  /** One frame: advance by real time, then draw. */
  tick(dt: number): void;
  draw(): void;
}

export function createGame(canvas: HTMLCanvasElement, { seed = "1", width = 128, height = 128, sound: withSound = true, host }: GameOptions = {}): Game {
  const px = createPixelRenderer(canvas, { width, height });
  const sound = withSound && pageTone() ? createSound(host ?? document.body, { id: "wallrun", sfx: { seed: String(seed), style: "lofi" } }) : null;
  let feet: BodySfx | null = null;
  // (A new seed brings its own palette and its own record.)
  const paint = (sim: Sim): void => {
    const L = sim.look;
    px.setPalette(L.colours, L.ramps); px.setMaterials(L.materials); px.setStyle(L.style);
    sound?.setPlan(scoreOf(moodOf(L.hue), sim.seed));
  };
  // (Every step: the body's sounds, and the record's intensity following the run.)
  const listen = (sim: Sim, dt: number): void => {
    if (!sound) return;
    if (sound.on && !feet) feet = bodySfx(sound.sfx, { surfaceOf: () => sim.surface() });
    if (!sound.on && feet) { feet.stop(); feet = null; }
    feet?.update(sim.body, dt);
    const speed = Math.hypot(sim.body.vel[0], sim.body.vel[2]);
    sound.setIntensity(Math.min(1, 0.15 + speed / 11), 1.5);
  };
  const sim = createSim({ seed, width, height, onLoad: paint, onStep: listen });

  function draw(): void {
    const f = sim.frame();
    px.setWorld({ boxes: f.boxes, capsules: f.capsules });
    px.render({ ...f.view, particles: f.particles });
  }

  // (Built on the sim itself, so its getters -- body, driver, autopilot -- stay live.)
  const game = Object.create(sim) as Game;
  return Object.assign(game, {
    px,
    sound,
    attachInput(target: EventTargetLike = globalThis as EventTargetLike, opts: AttachOptions = {}) { return sim.attachInput(target, { canvas, ...opts }); },
    setTarget(w: number, h: number) { px.setTarget(w, h); sim.setTarget(w, h); px.setStyle(sim.look.style); },
    tick(dt: number) { sim.advance(dt); draw(); },
    draw,
  });
}
