// WALLRUN's world, without a screen: the course, the body, the runner (an
// engine entity), the autopilot, the camera and input, the particles. It steps
// at a fixed rate and hands `frame()` -- what to draw -- to whoever draws it
// (game.js in the browser); in Node it runs headless, so the course can be
// tested seed by seed.
//
// It runs itself (the autopilot takes the course like the reference video:
// along the walls, across the water, grinding the rail, hopping the pads,
// through the tunnel) until someone plays -- then the camera is theirs (W is
// where it looks) -- and takes it back when they stop.

import { boxDistance, createCharacter } from "../../src/physics/character.js";
import { createParticles } from "../../src/particles/particles.js";
import { animator, entityOf } from "../../src/entity/index.js";
import { createCamera, subjectOf } from "../../src/camera/camera.js";
import { createInput } from "../../src/input/input.js";
import { levelOf } from "./level.js";
import { MATERIALS, RUNNER_MATERIALS, paletteOf } from "./palette.js";
import { streamOf } from "./seed.js";

export const STEP = 1 / 120;
// (The runner as the engine makes it: an anthro animal from the seed, in a jacket with a round pack -- the reference's look.)
export const runnerSpecOf = (seed) => entityOf(`${seed}|runner`, { kind: "anthro", size: 1.05, pins: { top: "jacket", pack: "round" } });
/** The dither screen a target size wants (the engine's rule: bigger pictures, finer screens). */
export const screenFor = (w, h) => (Math.min(w, h) <= 48 ? 2 : Math.min(w, h) <= 128 ? 4 : 8);
/** How far back the camera rides for a target size (with the narrower fov, the runner keeps its pixels at 32). */
const armFor = (w, h) => Math.min(1, Math.max(0.55, (Math.min(w, h) / 128) ** 0.45));
function fitArm(cam, w, h) {
  const k = armFor(w, h);
  cam.rigs.chase.opt.distance = 3 * k;
  cam.rigs.orbit.opt.distance = 3.4 * k;
}

export function createSim({ seed = "1", width = 128, height = 128, onLoad = null, onStep = null } = {}) {
  let level;
  let runner;
  let anim;
  let body;
  let cam;
  let time = 0;
  let acc = 0;
  let wp = 0;
  let aim = null; // (where the autopilot's jump means to land)
  let autopilot = true; // (false: nobody drives when the player stops)
  let driver = "autopilot";
  let S;
  let dustClock = 0;
  let look; // (the palette, materials and style the picture wants)
  const ps = createParticles(700);
  const input = createInput({ idle: 8 });

  function load(s) {
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
  const floorUnder = (p) => level.boxes.some((b) => { const { d, n } = boxDistance([p[0], p[1] - 0.3, p[2]], b); return d < 0 || (d < 0.75 && n[1] > 0.6); });

  // The autopilot: steer at the next point on the route; plan each jump to land where the route goes.
  // (A hop is aimed: take off when the landing is one jump away, then steer through the air to arrive
  // on it -- the middle of the next pad, or onto the rail. An edge still makes it jump, as a reflex.)
  const G = 24; // (the body's gravity; hold keeps the rise at it)
  const flightTime = (vy, y, ty) => (vy + Math.sqrt(Math.max(0, vy * vy + 2 * G * (y - ty)))) / G;
  function landingAfter(i) {
    const r = level.route;
    for (let k = i; k < r.length; k += 1) {
      if (r[k].act === "wall") return null;
      if (r[k].act === "rail") return [r[k].p[0], r[k].p[1] + 0.28, r[k].p[2]];
      if (r[k].act === "run" && r[k].p[2] > body.pos[2] + 1.5) return r[k].p;
    }
    return null;
  }
  function pilot() {
    const r = level.route;
    while (wp < r.length - 1 && (Math.hypot(r[wp].p[0] - body.pos[0], r[wp].p[2] - body.pos[2]) < 1.6 || body.pos[2] > r[wp].p[2] + 0.8)) wp += 1;
    const goal = r[wp];
    let dx = goal.p[0] - body.pos[0];
    let dz = goal.p[2] - body.pos[2];
    let dl = Math.hypot(dx, dz) || 1;
    let move = [dx / dl, dz / dl];
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
        const ahead = [body.pos[0] + (body.vel[0] / hv) * 1.1, body.pos[1], body.pos[2] + (body.vel[2] / hv) * 1.1];
        if (!floorUnder(ahead)) { jump = true; aim = landingAfter(wp); } // (an edge: off it)
      }
    }
    if (body.mode === "air" && aim) {
      // Steer to arrive: the velocity that reaches the landing just as the fall gets there.
      const t = Math.max(0.12, flightTime(body.vel[1], body.pos[1], aim[1]));
      const want = [(aim[0] - body.pos[0]) / t, (aim[2] - body.pos[2]) / t];
      const wl = Math.hypot(want[0], want[1]) / 9.5;
      move = wl > 1 ? [want[0] / (wl * 9.5), want[1] / (wl * 9.5)] : [want[0] / 9.5, want[1] / 9.5];
    }
    // On a wall: kick across when the route goes to the other one (the wall's normal points at it), or when the run is nearly spent.
    if (body.mode === "wall" && body.wall && ((goal.act === "wall" && (goal.p[0] - body.pos[0]) * body.wall[0] > 1) || goal.act !== "wall" || body.wallTime > 1.15)) jump = true;
    if (body.pos[2] > level.end - 3) { body.pos = [...level.spawn]; body.vel = [0, 0, 0]; wp = 0; aim = null; body.mode = "air"; }
    return { move, jump, hold: true };
  }
  // (Back from the player: pick the route up at the first point still ahead.)
  function resync() {
    const r = level.route;
    wp = r.findIndex((q) => q.p[2] > body.pos[2] + 0.5);
    if (wp < 0) wp = r.length - 1;
    aim = null;
  }

  function stepOnce() {
    const it = input.sample(STEP, cam.yaw); // (camera-relative: W is where the view looks)
    const now = it.player ? "player" : autopilot ? "autopilot" : "idle";
    if (now !== driver) {
      if (now === "autopilot") resync();
      cam.setMode(now === "player" ? "orbit" : "chase", { blend: 0.35 }); // (the player turns the camera; attract mode rides it)
      driver = now;
    }
    body.step(STEP, now === "player" ? it : now === "autopilot" ? pilot() : { move: [0, 0], jump: false, hold: false });
    anim.step(STEP, body);
    time += STEP;
    const hv = Math.hypot(body.vel[0], body.vel[2]);
    // What the body did, thrown into the air.
    for (const e of body.events) {
      if (e.type === "landed") { ps.emit("dust", e.at, { count: Math.min(10, 3 + Math.round(e.speed)), S, spread: 1.4 }); cam.thud(Math.min(1, e.speed / 12) * 0.05); }
      if (e.type === "jumped" || e.type === "wallJump") ps.emit("dust", e.at, { count: 5, S });
      if (e.type === "grinding" && S.chance(0.6)) ps.emit("spark", e.at, { count: 2, S, vel: e.tan.map((v) => -v * 2.5) });
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

  /** What's underfoot, for footsteps: "water" on or in it, "metal" on a rail or a metal floor, else "stone". */
  function surface() {
    if (body.mode === "skim" || body.mode === "sink" || body.pos[1] < level.waterY + 0.15) return "water";
    if (body.mode === "grind") return "metal";
    const under = level.boxes.find((b) => { const { d, n } = boxDistance([body.pos[0], body.pos[1] - 0.1, body.pos[2]], b); return d < 0.2 && n[1] > 0.6; });
    return under?.mat === 2 ? "metal" : "stone";
  }

  /** What to draw now: the world's solids, the runner, the particles and the view. */
  function frame() {
    return {
      boxes: level.boxes,
      capsules: cam.hidesSubject ? level.capsules : [...level.capsules, ...anim.capsules(RUNNER_MATERIALS)],
      particles: ps.list(),
      view: { ...cam.view(), time, sun: [0.35, 0.85, 0.25] },
    };
  }

  const api = {
    get seed() { return seed; }, get body() { return body; }, get runner() { return runner; }, get level() { return level; }, get cam() { return cam; }, get look() { return look; }, input,
    get width() { return width; }, get height() { return height; }, get time() { return time; }, get particles() { return ps; },
    get driver() { return driver; },
    /** Whether the autopilot drives when the player isn't (turning it on hands control back now). */
    set autopilot(v) { autopilot = v; if (v) input.arbiter.giveBack(); }, get autopilot() { return autopilot; },
    /** Hook the browser's keys, mouse (pass the canvas to lock it on a click), gamepad and touch. */
    attachInput(target = globalThis, opts = {}) { return input.attach(target, opts); },
    load,
    /** Another target size (the same game, fewer or more pixels). */
    setTarget(w, h) { width = w; height = h; look.style = { ...look.style, screen: screenFor(w, h) }; cam.setTarget(w, h); fitArm(cam, w, h); },
    /** Run the world on by `sec` (without drawing). */
    simulate(sec) { for (let i = 0; i < Math.round(sec / STEP); i += 1) stepOnce(); },
    /** Advance by real time (whole steps; the rest waits for the next call). */
    advance(dt) { acc += Math.min(dt, 0.1); while (acc >= STEP) { stepOnce(); acc -= STEP; } },
    step: stepOnce,
    frame,
    surface,
    // (Drive it by hand, for tests: the input system's own filter decides what counts.)
    key(k, down) { input.key(k, down); },
  };
  load(seed);
  return api;
}
