// WALLRUN's world, without a screen: the course, the body, the runner (an
// engine entity), the autopilot, the camera and input, the particles. It steps
// at a fixed rate and hands `frame()` -- what to draw -- to whoever draws it
// (game.ts in the browser); in Node it runs headless, so the course can be
// tested seed by seed.
//
// It runs itself (the autopilot takes the course like the reference video:
// along the walls, across the water, grinding the rail, hopping the pads,
// through the tunnel) until someone plays -- then the camera is theirs (W is
// where it looks) -- and takes it back when they stop.

import type { Stream, Vec3 } from "@keel/game-engine/core";
import { boxDistance, createCharacter } from "@keel/game-engine/physics";
import type { BodyInput, Character } from "@keel/game-engine/physics";
import { createParticles } from "@keel/game-engine/particles";
import type { ParticleView, Particles } from "@keel/game-engine/particles";
import { animator, entityOf } from "@keel/game-engine/entity";
import type { Animator, AnimatorBody, Capsule, EntitySpec } from "@keel/game-engine/entity";
import { createCamera, subjectOf } from "@keel/game-engine/camera";
import type { Camera, View } from "@keel/game-engine/camera";
import { createInput } from "@keel/game-engine/input";
import type { AttachOptions, EventTargetLike, Input } from "@keel/game-engine/input";
import type { Material } from "@keel/game-engine/render";
import type { RendererBox, RendererCapsule } from "@keel/game-engine/object";
import { levelOf } from "./level.ts";
import type { Level } from "./level.ts";
import { MATERIALS, RUNNER_MATERIALS, paletteOf } from "./palette.ts";
import type { Rgb } from "./palette.ts";
import { streamOf } from "./seed.ts";

export const STEP = 1 / 120;
// (The runner as the engine makes it: an anthro animal from the seed, in a jacket with a round pack -- the reference's look.)
export const runnerSpecOf = (seed: string): EntitySpec => entityOf(`${seed}|runner`, { kind: "anthro", size: 1.05, pins: { top: "jacket", pack: "round" } });
/** The dither screen a target size wants (the engine's rule: bigger pictures, finer screens). */
export const screenFor = (w: number, h: number): 2 | 4 | 8 => (Math.min(w, h) <= 48 ? 2 : Math.min(w, h) <= 128 ? 4 : 8);
/** How far back the camera rides for a target size (with the narrower fov, the runner keeps its pixels at 32). */
const armFor = (w: number, h: number): number => Math.min(1, Math.max(0.55, (Math.min(w, h) / 128) ** 0.45));
function fitArm(cam: Camera, w: number, h: number): void {
  const k = armFor(w, h);
  cam.rigs.chase.opt.distance = 3 * k;
  cam.rigs.orbit.opt.distance = 3.4 * k;
}

/** What the picture wants: the palette, the materials, the style, and the hue the music takes its key from. */
export interface Look {
  colours: Rgb[];
  ramps: Record<string, [number, number]>;
  materials: Material[];
  style: { screen: 2 | 4 | 8; dither: number; outline: number };
  hue: number;
}
/** Who is driving: the player, the autopilot, or nobody (the autopilot off). */
export type Driver = "player" | "autopilot" | "idle";
/** What to draw now. */
export interface Frame {
  boxes: RendererBox[];
  capsules: Array<RendererCapsule | Capsule>;
  particles: ParticleView[];
  view: View & { time: number; sun: Vec3 };
}
export interface SimOptions {
  seed?: string;
  width?: number;
  height?: number;
  onLoad?: ((sim: Sim) => void) | null;
  onStep?: ((sim: Sim, dt: number) => void) | null;
}
export interface Sim {
  readonly seed: string;
  readonly body: Character;
  readonly runner: EntitySpec;
  readonly level: Level;
  readonly cam: Camera;
  readonly look: Look;
  readonly input: Input;
  readonly width: number;
  readonly height: number;
  readonly time: number;
  readonly particles: Particles;
  readonly driver: Driver;
  /** Whether the autopilot drives when the player isn't (turning it on hands control back now). */
  autopilot: boolean;
  /** Hook the browser's keys, mouse (pass the canvas to lock it on a click), gamepad and touch. */
  attachInput(target?: EventTargetLike, opts?: AttachOptions): () => void;
  load(seed: string | number): void;
  /** Another target size (the same game, fewer or more pixels). */
  setTarget(w: number, h: number): void;
  /** Run the world on by `sec` (without drawing). */
  simulate(sec: number): void;
  /** Advance by real time (whole steps; the rest waits for the next call). */
  advance(dt: number): void;
  step(): void;
  frame(): Frame;
  /** What's underfoot, for footsteps: "water" on or in it, "metal" on a rail or a metal floor, else "stone". */
  surface(): "water" | "metal" | "stone";
  // (Drive it by hand, for tests: the input system's own filter decides what counts.)
  key(k: string, down: boolean): void;
}

type RouteGoal = Level["route"][number];

export function createSim({ seed: seed0 = "1", width: w0 = 128, height: h0 = 128, onLoad = null, onStep = null }: SimOptions = {}): Sim {
  let seed = seed0;
  let width = w0;
  let height = h0;
  // (Everything below is set by load(), which runs before anything reads it.)
  let level!: Level;
  let runner!: EntitySpec;
  let anim!: Animator;
  let body!: Character;
  let cam!: Camera;
  let time = 0;
  let acc = 0;
  let wp = 0;
  let aim: Vec3 | null = null; // (where the autopilot's jump means to land)
  let autopilot = true; // (false: nobody drives when the player stops)
  let driver: Driver = "autopilot";
  let S!: Stream;
  let dustClock = 0;
  let look!: Look; // (the palette, materials and style the picture wants)
  const ps = createParticles(700);
  const input = createInput({ idle: 8 });

  function load(s: string | number): void {
    seed = String(s);
    level = levelOf(seed);
    runner = runnerSpecOf(seed);
    anim = animator(runner);
    const pal = paletteOf(seed, runner.colours);
    // (hue: the runner's jacket -- what the music takes its key from, so each seed has its own.)
    look = { colours: pal.colours, ramps: pal.ramps, materials: MATERIALS, style: { screen: screenFor(width, height), dither: 0.9, outline: 1 }, hue: runner.colours.cloth[2] };
    body = createCharacter({ boxes: level.boxes, rails: level.rails, waterY: level.waterY, spawn: level.spawn });
    S = streamOf(`${seed}|play`);
    cam = createCamera({ mode: "chase", width, height });
    fitArm(cam, width, height);
    wp = 0; time = 0; aim = null; driver = "autopilot";
    onLoad?.(api);
  }
  // Is there something to stand on under this point (within a metre down)?
  // (Inside a solid counts, whatever face is nearest: near a pad's end the nearest face is its end, not its top.)
  const floorUnder = (p: Vec3): boolean => level.boxes.some((b) => { const { d, n } = boxDistance([p[0], p[1] - 0.3, p[2]], b); return d < 0 || (d < 0.75 && n[1] > 0.6); });

  // The autopilot: steer at the next point on the route; plan each jump to land where the route goes.
  // (A hop is aimed: take off when the landing is one jump away, then steer through the air to arrive
  // on it -- the middle of the next pad, or onto the rail. An edge still makes it jump, as a reflex.)
  const G = 24; // (the body's gravity; hold keeps the rise at it)
  const flightTime = (vy: number, y: number, ty: number): number => (vy + Math.sqrt(Math.max(0, vy * vy + 2 * G * (y - ty)))) / G;
  function landingAfter(i: number): Vec3 | null {
    const r = level.route;
    for (let k = i; k < r.length; k += 1) {
      const q = r[k]!;
      if (q.act === "wall") return null;
      if (q.act === "rail") return [q.p[0], q.p[1] + 0.28, q.p[2]];
      if (q.act === "run" && q.p[2] > body.pos[2] + 1.5) return q.p;
    }
    return null;
  }
  function pilot(): BodyInput {
    const r = level.route;
    const at = (i: number): RouteGoal => r[i]!;
    while (wp < r.length - 1 && (Math.hypot(at(wp).p[0] - body.pos[0], at(wp).p[2] - body.pos[2]) < 1.6 || body.pos[2] > at(wp).p[2] + 0.8)) wp += 1;
    const goal = at(wp);
    const dx = goal.p[0] - body.pos[0];
    const dz = goal.p[2] - body.pos[2];
    const dl = Math.hypot(dx, dz) || 1;
    let move: [number, number] = [dx / dl, dz / dl];
    let jump = false;
    const hv = Math.hypot(body.vel[0], body.vel[2]);
    if (body.mode !== "air") aim = null;
    if (body.mode === "ground") {
      const next = goal.act === "jump" || goal.act === "rail" ? landingAfter(wp) : null;
      if (next && hv > 3) {
        const reach = hv * flightTime(8.6, body.pos[1], next[1]);
        if (Math.hypot(next[0] - body.pos[0], next[2] - body.pos[2]) <= reach + 0.2) { jump = true; aim = next; }
      }
      if (!jump && hv > 3) {
        const ahead: Vec3 = [body.pos[0] + (body.vel[0] / hv) * 1.1, body.pos[1], body.pos[2] + (body.vel[2] / hv) * 1.1];
        if (!floorUnder(ahead)) { jump = true; aim = landingAfter(wp); } // (an edge: off it)
      }
    }
    if (body.mode === "air" && aim) {
      // Steer to arrive: the velocity that reaches the landing just as the fall gets there.
      const t = Math.max(0.12, flightTime(body.vel[1], body.pos[1], aim[1]));
      const want = [(aim[0] - body.pos[0]) / t, (aim[2] - body.pos[2]) / t] as const;
      const wl = Math.hypot(want[0], want[1]) / 9.5;
      move = wl > 1 ? [want[0] / (wl * 9.5), want[1] / (wl * 9.5)] : [want[0] / 9.5, want[1] / 9.5];
    }
    // On a wall: kick across when the route goes to the other one (the wall's normal points at it), or when the run is nearly spent.
    if (body.mode === "wall" && body.wall && ((goal.act === "wall" && (goal.p[0] - body.pos[0]) * body.wall[0] > 1) || goal.act !== "wall" || body.wallTime > 1.15)) jump = true;
    if (body.pos[2] > level.end - 3) { body.pos = [...level.spawn]; body.vel = [0, 0, 0]; wp = 0; aim = null; body.mode = "air"; }
    return { move, jump, hold: true };
  }
  // (Back from the player: pick the route up at the first point still ahead.)
  function resync(): void {
    const r = level.route;
    wp = r.findIndex((q) => q.p[2] > body.pos[2] + 0.5);
    if (wp < 0) wp = r.length - 1;
    aim = null;
  }

  function stepOnce(): void {
    const it = input.sample(STEP, cam.yaw); // (camera-relative: W is where the view looks)
    const now: Driver = it.player ? "player" : autopilot ? "autopilot" : "idle";
    if (now !== driver) {
      if (now === "autopilot") resync();
      cam.setMode(now === "player" ? "orbit" : "chase", { blend: 0.35 }); // (the player turns the camera; attract mode rides it)
      driver = now;
    }
    body.step(STEP, now === "player" ? it : now === "autopilot" ? pilot() : { move: [0, 0], jump: false, hold: false });
    // (The body itself, not a copy: the animator reads its feet when it draws. Its wall is null off a wall, which the animator takes as none.)
    anim.step(STEP, body as Omit<Character, "wall"> as AnimatorBody);
    time += STEP;
    const hv = Math.hypot(body.vel[0], body.vel[2]);
    // What the body did, thrown into the air.
    for (const e of body.events) {
      if (e.type === "landed") { ps.emit("dust", e.at, { count: Math.min(10, 3 + Math.round(e.speed)), S, spread: 1.4 }); cam.thud(Math.min(1, e.speed / 12) * 0.05); }
      if (e.type === "jumped" || e.type === "wallJump") ps.emit("dust", e.at, { count: 5, S });
      if (e.type === "grinding" && S.chance(0.6)) ps.emit("spark", e.at, { count: 2, S, vel: [-e.tan[0] * 2.5, -e.tan[1] * 2.5, -e.tan[2] * 2.5] });
      if (e.type === "skimming" && S.chance(0.35)) ps.emit("splash", e.at, { count: 3, S, vel: [-body.vel[0] * 0.2, 0, -body.vel[2] * 0.2] });
      if (e.type === "splashIn" || e.type === "skimStart") ps.emit("splash", e.at, { count: 14, S, spread: 1.5 });
      if (e.type === "wallRunning" && S.chance(0.3)) ps.emit("dust", [e.at[0] - e.n[0] * 0.25, e.at[1] + 0.2, e.at[2] - e.n[2] * 0.25], { count: 1, S, spread: 0.5 });
    }
    dustClock += STEP * hv;
    if (body.mode === "ground" && dustClock > 2.2) { dustClock = 0; ps.emit("dust", body.pos, { count: 2, S, spread: 0.6 }); }
    if (S.chance(0.08)) ps.emit("mote", [body.pos[0] + S.between(-8, 8), S.between(0.5, 5), body.pos[2] + S.between(-4, 14)], { count: 1, S });
    ps.step(STEP);
    cam.step(STEP, subjectOf(body, { height: 1.15 }), { boxes: level.boxes }, it);
    onStep?.(api, STEP);
  }

  function surface(): "water" | "metal" | "stone" {
    if (body.mode === "skim" || body.mode === "sink" || body.pos[1] < level.waterY + 0.15) return "water";
    if (body.mode === "grind") return "metal";
    const under = level.boxes.find((b) => { const { d, n } = boxDistance([body.pos[0], body.pos[1] - 0.1, body.pos[2]], b); return d < 0.2 && n[1] > 0.6; });
    return under?.mat === 2 ? "metal" : "stone";
  }

  /** What to draw now: the world's solids, the runner, the particles and the view. */
  function frame(): Frame {
    return {
      boxes: level.boxes,
      capsules: cam.hidesSubject ? level.capsules : [...level.capsules, ...anim.capsules(RUNNER_MATERIALS)],
      particles: ps.list(),
      view: { ...cam.view(), time, sun: [0.35, 0.85, 0.25] },
    };
  }

  const api: Sim = {
    get seed() { return seed; }, get body() { return body; }, get runner() { return runner; }, get level() { return level; }, get cam() { return cam; }, get look() { return look; }, input,
    get width() { return width; }, get height() { return height; }, get time() { return time; }, get particles() { return ps; },
    get driver() { return driver; },
    set autopilot(v) { autopilot = v; if (v) input.arbiter.giveBack(); }, get autopilot() { return autopilot; },
    attachInput(target = globalThis as EventTargetLike, opts = {}) { return input.attach(target, opts); },
    load,
    setTarget(w, h) { width = w; height = h; look.style = { ...look.style, screen: screenFor(w, h) }; cam.setTarget(w, h); fitArm(cam, w, h); },
    simulate(sec) { for (let i = 0; i < Math.round(sec / STEP); i += 1) stepOnce(); },
    advance(dt) { acc += Math.min(dt, 0.1); while (acc >= STEP) { stepOnce(); acc -= STEP; } },
    step: stepOnce,
    frame,
    surface,
    key(k, down) { input.key(k, down); },
  };
  load(seed);
  return api;
}
