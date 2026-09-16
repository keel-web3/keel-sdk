// Input (src/input/input.js): devices in, per-step intents out; who's driving.
import { test } from "node:test";
import assert from "node:assert/strict";
import { frontOf, rightOf } from "../src/core/frame.js";
import { codeOf, createArbiter, createInput } from "../src/input/input.js";

const STEP = 1 / 120;
const YAWS = Array.from({ length: 16 }, (_, i) => -Math.PI + (i + 0.5) * (Math.PI / 8));
const near2 = (m, v) => Math.abs(m[0] - v[0]) < 1e-12 && Math.abs(m[1] - v[2]) < 1e-12;
const ev = (props) => ({ key: "", code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...props });

test("codeOf: names, codes and events all come to the game's codes; other keys to null", () => {
  assert.equal(codeOf("w"), "KeyW");
  assert.equal(codeOf("W"), "KeyW");
  assert.equal(codeOf(" "), "Space");
  assert.equal(codeOf("ArrowUp"), "ArrowUp");
  assert.equal(codeOf("Shift"), "ShiftLeft");
  assert.equal(codeOf(ev({ code: "KeyW", key: "z" })), "KeyW", "the key's place wins (WASD on any layout)");
  assert.equal(codeOf("Meta"), null);
  assert.equal(codeOf("q"), null);
});

test("keys: W is the view's forward and D its right, at 16 view yaws; diagonals are no faster", () => {
  for (const y of YAWS) {
    const input = createInput();
    input.key("w", true);
    assert.ok(near2(input.sample(STEP, y).move, frontOf(y)));
    input.key("w", false);
    input.key("ArrowRight", true);
    assert.ok(near2(input.sample(STEP, y).move, rightOf(y)));
    input.key("ArrowUp", true);
    const m = input.sample(STEP, y).move;
    assert.ok(Math.abs(Math.hypot(m[0], m[1]) - 1) < 1e-12);
  }
});

test("jump: an edge once, hold while held; a tap between two steps still jumps", () => {
  const input = createInput();
  input.key(" ", true);
  let it = input.sample(STEP, 0);
  assert.ok(it.jump && it.hold);
  it = input.sample(STEP, 0);
  assert.ok(!it.jump && it.hold, "held: no second jump");
  input.key(ev({ code: "Space", key: " ", repeat: true }), true); // (key repeat is not a new press)
  assert.ok(!input.sample(STEP, 0).jump);
  input.key(" ", false);
  it = input.sample(STEP, 0);
  assert.ok(!it.jump && !it.hold);
  input.key(" ", true);
  input.key(" ", false);
  it = input.sample(STEP, 0);
  assert.ok(it.jump && it.hold, "a quick tap");
  assert.ok(!input.sample(STEP, 0).jump);
});

test("mouse: right is a positive yaw, up a positive pitch, scaled by sensitivity, taken once", () => {
  const input = createInput({ sensitivity: 0.003 });
  input.look(10, 0);
  input.look(20, -30);
  const it = input.sample(STEP, 0);
  assert.ok(Math.abs(it.look[0] - 0.09) < 1e-12 && Math.abs(it.look[1] - 0.09) < 1e-12);
  assert.deepEqual(input.sample(STEP, 0).look, [0, 0], "drained by the step that took it");
  input.look(10000, 0);
  assert.ok(input.sample(STEP, 0).look[0] <= 240 * 0.003 + 1e-12, "one wild jump is clamped");
});

test("gamepad: left stick runs (up is forward), right stick looks, A jumps on its edge, dead zone holds still", () => {
  const input = createInput({ lookSpeed: 2, deadzone: 0.2 });
  input.pad({ axes: [0, -1, 1, 0], buttons: [{ pressed: true }] });
  let it = input.sample(STEP, 0.7);
  assert.ok(near2(it.move, frontOf(0.7)));
  assert.ok(Math.abs(it.look[0] - 2 * STEP) < 1e-12 && it.jump && it.hold);
  it = input.sample(STEP, 0.7);
  assert.ok(!it.jump && it.hold);
  input.pad({ axes: [0.1, 0.12, -0.15, 0.05], buttons: [0] });
  it = input.sample(STEP, 0);
  assert.deepEqual(it.move, [0, 0]);
  assert.deepEqual(it.look, [0, 0]);
  assert.ok(!it.hold);
});

test("touch: the stick runs, a drag looks, a tap jumps", () => {
  const input = createInput({ touchSensitivity: 0.01 });
  input.stick(0, 1);
  input.touchLook(5, 0);
  input.tap();
  const it = input.sample(STEP, 0);
  assert.ok(near2(it.move, frontOf(0)) && Math.abs(it.look[0] - 0.05) < 1e-12 && it.jump);
});

test("arbiter: modifiers and shortcuts never take the controls from the autopilot", () => {
  const input = createInput({ idle: 3 });
  const stray = [
    "Meta", "Control", "Alt", "CapsLock", ev({ key: "Meta", code: "MetaLeft" }), ev({ key: "Control", code: "ControlRight" }),
    ev({ key: "w", code: "KeyW", metaKey: true }), ev({ key: "s", code: "KeyS", ctrlKey: true }), ev({ key: "d", code: "KeyD", altKey: true }),
    ev({ key: " ", code: "Space", metaKey: true }), "q", "Tab", "Escape", "F5",
    "Shift", // (sprint alone moves nothing)
  ];
  for (const k of stray) {
    input.key(k, true);
    const it = input.sample(STEP, 0);
    assert.equal(it.driver, "autopilot", `${JSON.stringify(k)} took over`);
    assert.deepEqual(it.move, [0, 0]);
    assert.ok(!it.jump);
    input.key(k, false);
  }
  input.key(ev({ key: "w", code: "KeyW", shiftKey: true }), true); // (shift + W is a sprint, a real move)
  assert.equal(input.sample(STEP, 0).driver, "player");
});

test("arbiter: the player takes over on real input and gives it back after the idle time", () => {
  const input = createInput({ idle: 2 });
  assert.equal(input.sample(STEP, 0).driver, "autopilot");
  input.look(3, 0);
  assert.equal(input.sample(STEP, 0).driver, "player");
  for (let i = 0; i < 239; i += 1) assert.equal(input.sample(STEP, 0).driver, "player");
  assert.equal(input.sample(STEP, 0).driver, "autopilot", "2 s idle");
  input.key("d", true);
  for (let i = 0; i < 600; i += 1) assert.ok(input.sample(STEP, 0).player, "a held key is still playing");
  const keeps = createArbiter({ idle: Infinity });
  keeps.update(STEP, true);
  for (let i = 0; i < 1000; i += 1) keeps.update(STEP, false);
  assert.equal(keeps.driver, "player");
});

test("a modifier going down lets go of held keys (their key-ups may never come), and so does blur", () => {
  const input = createInput();
  input.key("w", true);
  input.key("Meta", true);
  assert.deepEqual(input.sample(STEP, 0).axes, [0, 0]);
  input.key("a", true);
  input.blur();
  assert.deepEqual(input.sample(STEP, 0).axes, [0, 0]);
});

test("attach: keys, pointer lock and mouse through a DOM-shaped target; detach lets go", () => {
  const win = new EventTarget();
  const doc = new EventTarget();
  doc.pointerLockElement = null;
  doc.exitPointerLock = () => { doc.pointerLockElement = null; };
  const canvas = new EventTarget();
  let asked = 0;
  canvas.requestPointerLock = () => { asked += 1; return Promise.resolve(); };
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
  const pads = [null, { connected: true, axes: [0, 0, 0, 0], buttons: [1] }];
  const input = createInput({ sensitivity: 0.01 });
  const detach = input.attach(win, { canvas, document: doc, navigator: { getGamepads: () => pads } });
  const fire = (target, type, props) => { const e = Object.assign(new Event(type, { cancelable: true }), props); target.dispatchEvent(e); return e; };
  const down = fire(win, "keydown", { code: "Space", key: " " });
  assert.ok(down.defaultPrevented, "space doesn't scroll the page");
  assert.ok(!fire(win, "keydown", { code: "KeyR", key: "r", metaKey: true }).defaultPrevented, "Cmd+R still reloads");
  let it = input.sample(STEP, 0);
  assert.ok(it.jump, "the key and the pad's A");
  fire(canvas, "click", {});
  assert.equal(asked, 1);
  doc.pointerLockElement = canvas;
  fire(doc, "pointerlockchange", {});
  assert.ok(input.locked);
  fire(doc, "mousemove", { movementX: 7, movementY: 0 });
  it = input.sample(STEP, 0);
  assert.ok(Math.abs(it.look[0] - 0.07) < 1e-12);
  detach();
  assert.ok(!input.locked && doc.pointerLockElement === null);
  fire(win, "keydown", { code: "KeyW", key: "w" });
  fire(doc, "mousemove", { movementX: 7, movementY: 0 });
  it = input.sample(STEP, 0);
  assert.deepEqual(it.axes, [0, 0]);
  assert.deepEqual(it.look, [0, 0]);
});
