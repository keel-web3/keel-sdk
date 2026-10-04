# `src/camera` and `src/input` reference

Cameras and the controls that turn them, for agents building games on the
engine. Plain ES modules, no dependencies, no DOM in the cores (tests and
replays drive them by hand; `input.attach` is the only part that touches a
browser). Try both in `tools/camera-demo.html` (`npm run serve`, then
http://localhost:4200/tools/camera-demo.html).

| Module | What |
| --- | --- |
| `src/camera/camera.js` | `createCamera`: a camera `{ eye, target, fov, yaw, pitch }` moved by rigs — `orbit`, `chase`, `first`, `frame`, `rail`, `fixed` — with blends between them, shake, a landing thud, an fov kick; `fovForTarget`, `frameView`, `sphereCast`, `armPath` |
| `src/input/input.js` | `createInput`: keyboard, mouse under Pointer Lock, gamepad, touch → per-step intents; `createArbiter` (who's driving) |

## The convention (src/core/frame.js — the only one)

- World: **+y up**. A thing's own frame: **+z FRONT, +x RIGHT, +y UP**.
- `frontOf(yaw) = [sin yaw, 0, cos yaw]`, `rightOf(yaw) = [cos yaw, 0, -sin yaw]`; yaw 0 faces +z.
- The renderer's basis is `cameraBasis(eye, target)`: right = up × forward, so a
  camera looking along +z has +x on the screen's right. Seen from behind, a
  subject's right hand is on the screen's right; seen from the front, on the left.
- **Look**: a positive look yaw turns the view to the screen's right (the old
  screen-right becomes the new forward); a positive look pitch looks up. Mouse
  right / up, right stick right / up, all come out positive (unless invert-Y).
- **Move**: `moveFromView(cam.yaw, forward, strafe)` (or `cam.move(f, s)`, or
  the input's own `move`) — **W is forward along the camera's yaw**, D is the
  screen's right. Never steer by the subject's facing.

`cam.yaw` / `cam.pitch` are always the yaw and pitch of what is on the screen
(`target − eye`), so movement follows the picture even mid-blend.

## Subjects and worlds

A **subject** is anything the camera watches: `{ pos, yaw, vel, height, radius, mode?, wall?, bounds? }`
(`pos` is its feet; `yaw` its front; `wall` a wall-run's normal; `bounds`
`[x0,y0,z0,x1,y1,z1]` or `{min,max}` for `frame`). From a character body:
`subjectOf(body, { height, radius })`.

A **world** is what the camera must not enter: `{ boxes, floorY?, distance?(p) }` —
the same boxes `{c, h, yaw}` the renderer draws and `physics/character.js`
collides with (`boxDistance`).

## Rigs

Every rig is `{ name, opt, enter(cam, subject, fresh), step(dt, subject, world, input, cam) → { eye, target, fov? } }`.
Pass options per rig: `createCamera({ orbit: { distance: 4 }, chase: {...}, rail: { keys } })`,
or later through `cam.rigs.orbit.opt`. Add your own with `createCamera({ rigs: { name: rig } })`.

| Mode | For | Driven by | Key options |
| --- | --- | --- | --- |
| `orbit` | the player's third person (the parkour reference: mouse turns the view, the runner sits a little below the crosshair) | `input.look` | `distance` 3.4, `above` 0.45, `pitch` −0.28, `minPitch` −1.2, `maxPitch` 0.55, `shoulder` 0, `follow`/`followY` (pivot lag), `recover` (arm spring), `radius` 0.2, `recenter` (s idle before drifting behind the run; 0 = never) |
| `chase` | attract mode / autopilot, cutscene follow | the subject's heading and speed | `distance` 3, `height` 1.5, `lookAhead` 1.4, `lead` 0.12 s, `turn` + `turnBySpeed`, `swing` 1.5 (out off a wall-run's wall), `unblock` 4 (turn this much faster while a wall hides the subject) |
| `first` | first person at the subject's eyes | `input.look` | `eyeHeight` 0.88 (of height), pitch limits ±1.45 |
| `frame` | showcase stills and turntables: the subject's FRONT toward the camera, its bounds fitted | `input.look[0]` spins it | `turn` 0.45 (three-quarter; 0 = square on), `elevation` 0.14, `spin` rad/s, `fill` (else `fillForTarget`), `pixels` (subject this many px tall), `rate` (0 = snap), `front` (a yaw or direction overriding `subject.yaw`), `collide` |
| `rail` | scripted flythroughs, attract loops | time | `keys: [{ at, eye, target?, fov? }]` (no target: looks at the subject), `loop`, `speed`, `period`; `rig.at(t, subject)` scrubs |
| `fixed` | a security camera | — | `eye`, `target?` (none: tracks the subject) |

**Collision** (orbit, chase, frame): the arm is sphere-cast (`sphereCast`,
radius 0.2) from a pivot over the subject's head — itself pulled down under a
low ceiling — out to where the eye wants to be. A wall pulls the eye in at
once; when it clears, the arm springs back out (critically damped, no
overshoot). Against a ceiling or floor the arm slides along it instead of
folding (`armPath`), so a camera in a tunnel stays behind the runner. Every
point the camera uses has the radius of room: **the eye is never inside a box**.
When the eye does end up in the subject's face, `cam.hidesSubject` is true
(also in first person) — don't draw the subject that frame.

**Frame fitting** (`frameView`) is solved, not searched: every corner of the
bounds lands inside `fill` of the picture at this fov and aspect, then the aim
is re-centred on what is seen (NOCTURNES' `seenFrame` idea: extents across the
view, nearer corners bigger), twice.

## The camera

```js
const cam = createCamera({ mode: "orbit", width: 128, height: 128, fovKick: 0.06 });
cam.setMode("chase", { blend: 0.3 }); // eye/target/fov blend (smoothstep) from the current view
cam.step(dt, subject, world, input);  // each FIXED step (not each frame)
cam.shake(0.3);                        // trauma 0..1: adds up, fades (shake.decay per s)
cam.thud(0.06);                        // a landing: the view nods ~0.06 rad and springs back
cam.setTarget(w, h);                   // new target size: fov = fovForTarget(w, h) unless `fov` was fixed
px.render({ ...cam.view(), time });    // what to draw: eye, target, fov (shake and nod applied)
```

- `fovForTarget(w, h) = 1.15 · clamp((min(w,h)/128)^0.3, 0.6, 1)` — fewer
  pixels, a tighter frame, so a subject keeps enough of them to read at 32×32.
  The orbit's pivot height scales with it, so the runner sits the same share
  below the middle at every size.
- Shake and thud only **turn** the view; they never move the eye, so it stays
  where the rig proved it has room.
- Deterministic: every rig is stepped by `dt`, eases with `1 − e^(−rate·dt)`,
  shakes with fixed sines of the camera's own step clock. No `Math.random`, no
  wall clock. The same steps give the same camera bit for bit (tested).

## Input

```js
const input = createInput({ sensitivity: 0.0025, invertY: false, idle: 6 });
const detach = input.attach(window, { canvas });  // click canvas = pointer lock; Esc releases
const it = input.sample(STEP, cam.yaw);            // once per fixed step
// it = { move:[x,z], axes:[strafe,fwd], look:[dyaw,dpitch], jump, hold, sprint, driver, player }
```

- **Keyboard** by `KeyboardEvent.code` (WASD by place, any layout) and arrows;
  Space jumps (`jump` is the pressed edge, latched so a tap between two steps
  still counts; `hold` while held — the body cuts short hops without it);
  Shift sprints. Tests call `input.key("w", true)` / `input.key(event, down)`.
- **Only game keys count.** Meta/Ctrl/Alt/CapsLock, or any key pressed with
  Meta, Ctrl or Alt held (Cmd+R, Ctrl+S) are ignored — they neither move nor
  take over from the autopilot. A modifier going down releases held keys
  (their key-ups may never arrive after Cmd+Tab); so does window blur. Shift
  alone takes nothing over. Typing in an `<input>` is ignored.
- **Mouse**: `movementX/Y` × `sensitivity` while pointer-locked; without a
  lock, drag on the canvas to look. Single events are clamped (`maxMouse`) —
  some browsers throw one huge delta as the lock starts.
- **Gamepad** (standard mapping, polled in `sample`): left stick moves, right
  stick looks at `lookSpeed` rad/s, A (button 0) jumps, L3/RB sprint; round
  dead zone. Tests call `input.pad({ axes, buttons })`.
- **Touch** (optional): left half of the canvas is a stick, right half drags
  to look, a quick tap there jumps.
- **Who's driving** (`createArbiter`): `"autopilot"` until real input (a game
  key, look, stick, tap), then `"player"` until `idle` seconds of nothing
  (`Infinity`: never give it back). `input.arbiter.takeOver()` / `giveBack()`.

### Pointer lock notes

- `requestPointerLock` must come from a user gesture: `attach` asks on the
  canvas `click`. Esc always releases (the browser's rule, not ours); the page
  gets `pointerlockchange` and `input.locked` goes false — show a "click to
  play" hint then.
- `attach` asks for `{ unadjustedMovement: true }` (raw mouse, no OS
  acceleration) and falls back to a plain lock, then to drag-to-look (inside
  some iframes and embedded panes the lock is refused outright).
- Right after Esc, Chrome may refuse a new lock for a moment; a click that fails
  just leaves drag-to-look working.

## Hooking it together: a fixed-step loop

```js
import { createCharacter } from "../src/physics/character.js";
import { createCamera, subjectOf } from "../src/camera/camera.js";
import { createInput } from "../src/input/input.js";

const STEP = 1 / 120;                                    // physics and camera share the step
const body = createCharacter({ boxes, rails, waterY, spawn });
const cam = createCamera({ mode: "chase", width: 128, height: 128 });
const input = createInput({ idle: 8 });
input.attach(window, { canvas });
const world = { boxes };
let acc = 0;
let last = performance.now();

function stepOnce() {
  const it = input.sample(STEP, cam.yaw);                // camera-relative: W is where the view looks
  body.step(STEP, it.player ? it : autopilot());         // (autopilot(): your own { move, jump, hold })
  for (const e of body.events) if (e.type === "landed") cam.thud(Math.min(1, e.speed / 12) * 0.06);
  cam.setMode(it.player ? "orbit" : "chase");            // the player turns the camera; attract mode rides it
  cam.step(STEP, subjectOf(body, { height: 1.15 }), world, it);
}
function frame(now) {
  requestAnimationFrame(frame);
  acc += Math.min((now - last) / 1000, 0.1); last = now; // (cap: a stalled tab doesn't fast-forward forever)
  while (acc >= STEP) { stepOnce(); acc -= STEP; }
  px.setWorld({ boxes, capsules: cam.hidesSubject ? [] : runnerCapsules(body) });
  px.render({ ...cam.view(), time: cam.time });          // drawing only reads the camera
}
requestAnimationFrame(frame);
```

Order matters a little: sample input with the camera's yaw from the step
before, step the body, then the camera (so it frames where the body now is).
Record `it` per step and you can replay a run exactly.
