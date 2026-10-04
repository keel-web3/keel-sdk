// Input: devices in, intents out. Keyboard (WASD or arrows, space to jump --
// hold it to go higher -- shift to sprint), the mouse under Pointer Lock (click
// the canvas to lock it, Esc to let go), a gamepad (left stick runs, right
// stick looks, A jumps) and touch (left half a stick, right half a drag to
// look, a tap to jump) all come down to the same intents, taken once per
// fixed simulation step:
//
//   { move: [x, z],        world direction on the ground, camera-relative (moveFromView)
//     axes: [strafe, fwd], the same before it was turned by the view
//     look: [dyaw, dpitch],radians this step: + yaw turns to the screen's right, + pitch looks up
//     jump,                pressed since the last step (an edge: a tap between steps still counts)
//     hold,                jump is held (the character cuts short hops without it)
//     sprint,
//     driver, player }     who is driving: "player" or "autopilot"
//
//   const input = createInput({ sensitivity: 0.0025, idle: 6 });
//   const detach = input.attach(window, { canvas });  // the browser; tests drive key()/look()/pad() instead
//   const it = input.sample(STEP, cam.yaw);            // each fixed step
//   body.step(STEP, it.player ? it : pilot());
//
// Only the game's own keys count. A modifier, or a key pressed with Meta,
// Ctrl or Alt held (a shortcut), never moves anything and never takes the
// controls from the autopilot.

import { moveFromView } from "../core/frame.js";

/** The game's keys by KeyboardEvent.code (the key's place, so WASD is WASD on any layout) and what each does. */
export const GAME_KEYS = Object.freeze({
  KeyW: "forward", ArrowUp: "forward", KeyS: "back", ArrowDown: "back",
  KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
  Space: "jump", ShiftLeft: "sprint", ShiftRight: "sprint",
});
// (Plain key names -- "w", " ", "ArrowUp", "Shift" -- come in through here.)
const BY_NAME = {
  w: "KeyW", a: "KeyA", s: "KeyS", d: "KeyD", " ": "Space", space: "Space", spacebar: "Space", shift: "ShiftLeft",
  arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
};
const MODIFIERS = new Set(["meta", "os", "control", "alt", "altgraph", "contextmenu", "fn", "hyper", "super", "capslock"]);
const isModifier = (name) => MODIFIERS.has(String(name ?? "").toLowerCase().replace(/(left|right)$/, ""));

/** A key (a name, a code, or a KeyboardEvent) as a code in GAME_KEYS, or null. */
export function codeOf(k) {
  if (k && typeof k === "object") return (k.code && GAME_KEYS[k.code] ? k.code : null) ?? codeOf(k.key ?? "");
  const s = String(k);
  if (GAME_KEYS[s]) return s;
  return BY_NAME[s.toLowerCase()] ?? null;
}

// A stick's two axes with a round dead zone, rescaled so it starts from 0 at the edge of it.
function deadzone(x, y, dz) {
  const l = Math.hypot(x, y);
  if (l <= dz) return [0, 0];
  const k = Math.min(1, (l - dz) / (1 - dz)) / l;
  return [x * k, y * k];
}
const pressed = (b) => (typeof b === "number" ? b > 0.5 : Boolean(b?.pressed));

/**
 * Who's driving: the autopilot until the player does something real, then the
 * player until `idle` seconds pass with nothing (Infinity: the player keeps it).
 */
export function createArbiter({ idle = 6, start = "autopilot" } = {}) {
  const a = {
    driver: start, idleFor: 0, idle,
    /** One step: `real` is whether the player did anything real in it. */
    update(dt, real) {
      if (real) { a.driver = "player"; a.idleFor = 0; }
      else {
        a.idleFor += dt;
        if (a.driver === "player" && a.idleFor >= a.idle - 1e-9) a.driver = "autopilot"; // (steps summed in floats: 240 of 1/120 is 2 s)
      }
      return a.driver;
    },
    takeOver() { a.driver = "player"; a.idleFor = 0; },
    giveBack() { a.driver = "autopilot"; },
  };
  return a;
}

/**
 * The input core (no DOM in it: tests and replays drive it by hand).
 *   sensitivity  radians of look per pixel of mouse
 *   invertY      mouse/stick up looks down
 *   lookSpeed    radians a second at full right stick
 *   deadzone     of the sticks
 *   idle         seconds without input before the autopilot takes back over
 *   touchSensitivity, touchRadius (px of drag for a full touch stick)
 */
export function createInput(o = {}) {
  const opt = { sensitivity: 0.0025, invertY: false, lookSpeed: 2.8, deadzone: 0.18, idle: 6, start: "autopilot", touchSensitivity: 0.006, touchRadius: 48, maxMouse: 240, ...o };
  const arbiter = createArbiter({ idle: opt.idle, start: opt.start });
  const held = new Set();
  let mouse = [0, 0];
  let touchLook = [0, 0];
  let stick = [0, 0];
  let pad = null;
  let padJumpWas = false;
  let jumpLatch = false;
  let real = false;
  const doing = (action) => { for (const c of held) if (GAME_KEYS[c] === action) return true; return false; };

  const input = {
    opt, arbiter, locked: false, pollPads: null,
    get driver() { return arbiter.driver; },
    get player() { return arbiter.driver === "player"; },
    /** A key down or up: a name ("w", " ", "ArrowUp"), a code ("KeyW") or a KeyboardEvent. True if it was the game's. */
    key(k, down) {
      const ev = k && typeof k === "object" ? k : null;
      // A modifier going down: the keys held now may never see their key-up (Cmd+Tab), so let go of them all.
      if (isModifier(ev ? ev.key ?? ev.code : k) || isModifier(ev?.code)) { if (down) input.blur(); return false; }
      const code = codeOf(k);
      if (!code) return false;
      if (!down) { held.delete(code); return true; }
      if (ev && (ev.metaKey || ev.ctrlKey || ev.altKey)) return false; // (a shortcut, not a move)
      if (!held.has(code)) {
        held.add(code);
        if (GAME_KEYS[code] === "jump") jumpLatch = true;
        if (GAME_KEYS[code] !== "sprint") real = true; // (shift alone takes nothing over)
      }
      return true;
    },
    /** Mouse movement in pixels (movementX, movementY): right and down are positive. */
    look(dx, dy) {
      const c = (v) => Math.max(-opt.maxMouse, Math.min(opt.maxMouse, v || 0)); // (some browsers throw one huge jump when the lock starts)
      mouse = [mouse[0] + c(dx), mouse[1] + c(dy)];
      if (dx || dy) real = true;
    },
    /** A touch drag to look, in pixels. */
    touchLook(dx, dy) { touchLook = [touchLook[0] + dx, touchLook[1] + dy]; if (dx || dy) real = true; },
    /** The touch stick: x right, y forward, each -1..1. */
    stick(x, y) { stick = [x, y]; if (x || y) real = true; },
    /** A tap that jumps. */
    tap() { jumpLatch = true; real = true; },
    /** A gamepad's state: { axes: [lx, ly, rx, ry], buttons: [a, ...] } (buttons numbers or { pressed }), or null. */
    pad(p) { pad = p ?? null; },
    /** Let go of everything (the window lost focus). */
    blur() { held.clear(); stick = [0, 0]; mouse = [0, 0]; touchLook = [0, 0]; },
    /** The intents for one fixed step, relative to the view's yaw. */
    sample(dt, viewYaw = 0) {
      if (input.pollPads) pad = input.pollPads() ?? null;
      let fwd = (doing("forward") ? 1 : 0) - (doing("back") ? 1 : 0);
      let strafe = (doing("right") ? 1 : 0) - (doing("left") ? 1 : 0);
      const inv = opt.invertY ? -1 : 1;
      let lookYaw = mouse[0] * opt.sensitivity + touchLook[0] * opt.touchSensitivity;
      let lookPitch = -(mouse[1] * opt.sensitivity + touchLook[1] * opt.touchSensitivity) * inv;
      mouse = [0, 0]; touchLook = [0, 0];
      let padJump = false;
      let padSprint = false;
      if (pad) {
        const ax = pad.axes ?? [];
        const [lx, ly] = deadzone(ax[0] ?? 0, ax[1] ?? 0, opt.deadzone);
        const [rx, ry] = deadzone(ax[2] ?? 0, ax[3] ?? 0, opt.deadzone);
        strafe += lx; fwd -= ly; // (a stick's up is -y)
        lookYaw += rx * opt.lookSpeed * dt;
        lookPitch -= ry * opt.lookSpeed * dt * inv;
        const b = pad.buttons ?? [];
        padJump = pressed(b[0]);
        padSprint = pressed(b[10]) || pressed(b[5]);
        if (padJump && !padJumpWas) jumpLatch = true;
        if (lx || ly || rx || ry || padJump) real = true;
      }
      padJumpWas = padJump;
      strafe += stick[0]; fwd += stick[1];
      const l = Math.hypot(strafe, fwd);
      if (l > 1) { strafe /= l; fwd /= l; }
      const jump = jumpLatch;
      jumpLatch = false;
      const hold = doing("jump") || padJump || jump;
      const moving = Math.abs(fwd) + Math.abs(strafe) > 0;
      const driver = arbiter.update(dt, real || moving || hold);
      real = false;
      return {
        move: moveFromView(viewYaw, fwd, strafe), axes: [strafe || 0, fwd || 0], look: [lookYaw || 0, lookPitch || 0], // (|| 0: no -0s)
        jump, hold, sprint: doing("sprint") || padSprint, driver, player: driver === "player",
      };
    },
    /**
     * Listen in a browser: keys on `target` (window), the mouse and touch on
     * `canvas` (click to lock the pointer; without the lock, drag to look),
     * gamepads through navigator.getGamepads. Returns detach().
     */
    attach(target = globalThis, { canvas = null, lock = true, touch = true, document: doc = globalThis.document, navigator: nav = globalThis.navigator } = {}) {
      const offs = [];
      const on = (el, type, fn, how) => { if (!el?.addEventListener) return; el.addEventListener(type, fn, how); offs.push(() => el.removeEventListener(type, fn, how)); };
      // (Typing in a field is not playing.)
      const editable = (e) => { const t = e.target; return Boolean(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ""))); };
      on(target, "keydown", (e) => { if (!editable(e) && input.key(e, true)) e.preventDefault(); });
      on(target, "keyup", (e) => { if (input.key(e, false) && !editable(e)) e.preventDefault(); });
      on(target, "blur", () => input.blur());
      on(doc, "visibilitychange", () => { if (doc.hidden) input.blur(); });
      if (nav?.getGamepads) input.pollPads = () => { for (const p of nav.getGamepads() ?? []) if (p?.connected) return p; return null; };
      if (canvas) {
        let drag = false;
        // (Raw mouse, no acceleration, where it's offered; else a plain lock; else none -- drag to look.)
        const ask = (how) => { try { const r = how ? canvas.requestPointerLock?.(how) : canvas.requestPointerLock?.(); return r?.then ? r : Promise.resolve(); } catch (e) { return Promise.reject(e); } };
        const requestLock = () => { ask({ unadjustedMovement: true }).catch(() => ask().catch(() => {})); };
        on(canvas, "click", () => { if (lock && doc?.pointerLockElement !== canvas) requestLock(); });
        on(doc, "pointerlockchange", () => { input.locked = doc.pointerLockElement === canvas; if (!input.locked) drag = false; });
        on(canvas, "mousedown", (e) => { if (e.button === 0 && !input.locked) drag = true; });
        on(globalThis, "mouseup", () => { drag = false; });
        on(doc, "mousemove", (e) => { if (input.locked || drag) input.look(e.movementX, e.movementY); });
        if (touch) {
          let moveId = null;
          let moveAt = null;
          let lookId = null;
          let lookAt = null;
          const opts = { passive: false };
          on(canvas, "touchstart", (e) => {
            const r = canvas.getBoundingClientRect();
            for (const t of e.changedTouches) {
              if (t.clientX < r.left + r.width / 2 && moveId === null) { moveId = t.identifier; moveAt = [t.clientX, t.clientY]; }
              else if (lookId === null) { lookId = t.identifier; lookAt = { x: t.clientX, y: t.clientY, far: 0, t: e.timeStamp }; }
            }
            e.preventDefault();
          }, opts);
          on(canvas, "touchmove", (e) => {
            for (const t of e.changedTouches) {
              if (t.identifier === moveId) {
                let sx = (t.clientX - moveAt[0]) / opt.touchRadius;
                let sy = -(t.clientY - moveAt[1]) / opt.touchRadius;
                const l = Math.hypot(sx, sy);
                if (l > 1) { sx /= l; sy /= l; }
                input.stick(sx, sy);
              } else if (t.identifier === lookId) {
                const dx = t.clientX - lookAt.x;
                const dy = t.clientY - lookAt.y;
                lookAt.far += Math.abs(dx) + Math.abs(dy); lookAt.x = t.clientX; lookAt.y = t.clientY;
                input.touchLook(dx, dy);
              }
            }
            e.preventDefault();
          }, opts);
          const end = (e) => {
            for (const t of e.changedTouches) {
              if (t.identifier === moveId) { moveId = null; input.stick(0, 0); }
              else if (t.identifier === lookId) { if (lookAt.far < 12 && e.timeStamp - lookAt.t < 250) input.tap(); lookId = null; }
            }
          };
          on(canvas, "touchend", end);
          on(canvas, "touchcancel", end);
        }
      }
      return () => {
        for (const off of offs) off();
        input.pollPads = null;
        if (canvas && doc?.pointerLockElement === canvas) doc.exitPointerLock?.();
        input.locked = false;
        input.blur();
      };
    },
  };
  return input;
}
