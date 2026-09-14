import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { KEEL_AUDIO_RUNTIME } from "../packages/sdk/dist/audio-module.js";

// The shipped, pinned bytes are what run here, not the readable source.
const RUNTIME = readFileSync(KEEL_AUDIO_RUNTIME.localPath, "utf8");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

class FakeParam {
  constructor(value) { this.value = value; }
  cancelScheduledValues() {}
  setTargetAtTime(value) { this.value = value; }
}

function makeEventTarget(target) {
  const listeners = new Map();
  target.addEventListener = (type, listener) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(listener);
  };
  target.removeEventListener = (type, listener) => {
    listeners.set(type, (listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  };
  target.dispatch = (type, fields = {}) => {
    const event = { type, isTrusted: true, target: null, stopPropagation() {}, ...fields };
    for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    return event;
  };
  return target;
}

class FakeElement {
  constructor(tag) {
    makeEventTarget(this);
    this.tagName = tag.toUpperCase();
    this.style = {};
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.innerHTML = "";
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter((candidate) => candidate !== child); child.parentNode = null; }
  contains(candidate) { return candidate === this || this.children.some((child) => child.contains?.(candidate)); }
}

/**
 * A browser-shaped global with a fake AudioContext that obeys the autoplay
 * rule: resume() only succeeds while a trusted gesture is being dispatched
 * (or when `autoplay` grants it up front). Storage throws like an opaque origin.
 */
function environment({ autoplay = false, storage = "throws", tone = false, reducedMotion = false, worker = "absent" } = {}) {
  const contexts = [];
  let gestureDepth = 0;
  class FakeAudioContext {
    constructor(options) {
      makeEventTarget(this);
      this.options = options;
      this.state = autoplay ? "running" : "suspended";
      this.currentTime = 0;
      this.sampleRate = 48_000;
      this.destination = { kind: "destination" };
      this.resumeCalls = 0;
      this.resumeOutsideGesture = 0;
      this.suspendCalls = 0;
      this.primed = 0;
      contexts.push(this);
    }
    setState(state) { this.state = state; this.dispatch("statechange"); }
    createGain() { return { gain: new FakeParam(1), connections: [], connect(node) { this.connections.push(node); } }; }
    createBuffer() { return {}; }
    createBufferSource() { const context = this; return { connect() {}, start() { context.primed++; } }; }
    resume() {
      this.resumeCalls++;
      const allowed = gestureDepth > 0 || autoplay;
      if (!allowed) this.resumeOutsideGesture++;
      return Promise.resolve().then(() => { if (allowed) this.setState("running"); });
    }
    suspend() { this.suspendCalls++; return Promise.resolve().then(() => this.setState("suspended")); }
  }
  const documentNode = makeEventTarget({
    visibilityState: "visible",
    body: new FakeElement("body"),
    createElement: (tag) => new FakeElement(tag),
  });
  const errors = [];
  const sandbox = makeEventTarget({
    document: documentNode,
    AudioContext: FakeAudioContext,
    setTimeout,
    clearTimeout,
    console: { log() {}, warn() {}, error: (error) => errors.push(error) },
    matchMedia: (query) => ({ matches: reducedMotion && query.includes("reduce") }),
  });
  const saved = new Map();
  if (storage === "throws") {
    Object.defineProperty(sandbox, "localStorage", { get() { throw Object.assign(new Error("The document is sandboxed and lacks the 'allow-same-origin' flag."), { name: "SecurityError" }); } });
  } else if (storage === "memory") {
    sandbox.localStorage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)) };
  }
  if (worker !== "absent") {
    sandbox.Blob = class { constructor(parts) { this.parts = parts; } };
    sandbox.URL = { createObjectURL: () => "blob:probe", revokeObjectURL() {} };
    sandbox.Worker = class {
      constructor() { setTimeout(() => (worker === "works" ? this.onmessage?.({ data: 1 }) : this.onerror?.({})), 0); }
      terminate() {}
    };
  }
  let toneDestination;
  let toneContext;
  if (tone) {
    const raw = new FakeAudioContext({ latencyHint: "interactive" });
    toneDestination = { mute: false, volume: { value: 0 } };
    toneContext = { rawContext: raw, clockSource: "worker" };
    sandbox.Tone = {
      setContextCalls: 0,
      getContext: () => toneContext,
      getDestination: () => toneDestination,
      setContext() { this.setContextCalls++; },
    };
  }
  vm.createContext(sandbox);
  vm.runInContext(RUNTIME, sandbox, { filename: KEEL_AUDIO_RUNTIME.localPath });
  /** Dispatches a real (trusted) gesture: the capture listener, then the target's own handlers. */
  const gesture = (type = "pointerdown", target = documentNode.body, during = undefined) => {
    gestureDepth++;
    try {
      sandbox.dispatch(type, { target });
      if (type === "click" && target.dispatch) target.dispatch("click", { target });
      during?.();
    } finally { gestureDepth--; }
  };
  const synthetic = (type = "click", target = documentNode.body) => {
    sandbox.dispatch(type, { target, isTrusted: false });
    if (target.dispatch) target.dispatch(type, { target, isTrusted: false });
  };
  return { sandbox, audio: sandbox.KEEL_AUDIO, contexts, gesture, synthetic, documentNode, saved, errors, toneDestination: () => toneDestination, toneContext: () => toneContext };
}

test("keel-audio never resumes audio without a real gesture, then starts the score once on one", async () => {
  const env = environment();
  const { audio } = env;
  let starts = 0;
  audio.onStart(({ ctx, destination }) => {
    starts++;
    assert.equal(ctx, env.contexts[0]);
    assert.equal(destination, audio.destination);
  });
  audio.configure({ id: "nocturne-7" });
  assert.equal(audio.state, "off");
  const pending = audio.start(); // programmatic: outside any gesture
  await flush();
  assert.equal(audio.state, "waiting");
  assert.equal(env.contexts[0].resumeCalls, 0, "no resume attempt outside a gesture");
  assert.equal(starts, 0);

  env.synthetic("click"); // synthetic events (e.g. postMessage-driven) never count
  env.synthetic("pointerdown");
  await flush();
  assert.equal(env.contexts[0].resumeCalls, 0);

  env.gesture("pointerdown");
  assert.equal(await pending, true);
  assert.equal(audio.state, "playing");
  assert.equal(audio.playing, true);
  assert.equal(starts, 1);
  assert.equal(env.contexts[0].resumeOutsideGesture, 0);
  assert.equal(env.contexts[0].primed, 1, "the iOS silent-buffer unlock ran inside the gesture");
  env.gesture("keydown");
  await flush();
  assert.equal(starts, 1, "later gestures never restart the score");
  assert.equal(env.contexts.length, 1, "one shared AudioContext");
  assert.equal(env.contexts[0].options.latencyHint, "playback");
});

test("the sound button toggles through trusted clicks only and exposes an accessible state", async () => {
  const env = environment({ reducedMotion: true });
  const { audio } = env;
  let stops = 0;
  audio.onStop(() => { stops++; });
  const mounted = audio.mountButton(undefined, { corner: "top-left" });
  const button = mounted.element;
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.type, "button");
  assert.equal(button.getAttribute("aria-label"), "Turn sound on");
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(button.style.position, "fixed");
  assert.equal(button.style.top, "12px");
  assert.equal(button.style.left, "12px");
  assert.equal(button.style.transition, "none", "prefers-reduced-motion disables transitions");
  assert.equal(env.documentNode.body.children[0], button);

  env.synthetic("click", button);
  await flush();
  assert.equal(audio.state, "off", "a synthetic click on the button does nothing");

  env.gesture("click", button);
  await flush();
  assert.equal(audio.state, "playing");
  assert.equal(button.getAttribute("aria-label"), "Turn sound off");
  assert.equal(button.getAttribute("aria-pressed"), "true");

  env.gesture("click", button);
  await flush();
  assert.equal(audio.state, "off");
  assert.equal(stops, 1);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(env.contexts[0].state, "suspended", "stop suspends the context after the fade");

  mounted.remove();
  assert.equal(env.documentNode.body.children.length, 0);
});

test("mute and volume drive the master gain and are remembered in memory when storage throws", async () => {
  const env = environment({ storage: "throws" });
  const { audio } = env;
  audio.configure({ id: "piece-a", volume: 0.5 });
  const master = audio.destination;
  assert.equal(master.connections[0], env.contexts[0].destination);
  assert.equal(master.gain.value, 0, "silent until started");
  env.gesture("click", env.documentNode.body, () => audio.start()); // the piece's own click handler
  await flush();
  assert.equal(audio.state, "playing");
  assert.equal(master.gain.value, 0.5);
  audio.muted = true;
  assert.equal(audio.muted, true);
  assert.equal(master.gain.value, 0);
  audio.muted = false;
  audio.volume = 2;
  assert.equal(audio.volume, 1, "volume clamps to 0..1");
  assert.equal(master.gain.value, 1);
  assert.throws(() => { audio.volume = "loud"; }, /volume/u);
  audio.volume = 0.25;
  audio.muted = true;

  // Another piece id starts from its own defaults; returning restores the remembered values.
  audio.configure({ id: "piece-b" });
  assert.equal(audio.volume, 0.25, "an id with no record keeps the current values");
  audio.volume = 0.9;
  audio.configure({ id: "piece-a" });
  assert.equal(audio.volume, 0.25);
  assert.equal(audio.muted, true);
  assert.deepEqual(env.errors, []);
});

test("a remembered 'on' arms the next gesture anywhere but never starts audio by itself", async () => {
  const first = environment({ storage: "memory" });
  first.audio.configure({ id: "remember" });
  first.gesture("click", first.audio.mountButton().element);
  await flush();
  assert.equal(first.audio.state, "playing");
  assert.equal(JSON.parse(first.saved.get("keel-audio:remember")).on, true);

  const second = environment({ storage: "memory" });
  for (const [key, value] of first.saved) second.saved.set(key, value);
  second.audio.configure({ id: "remember" });
  await flush();
  assert.equal(second.audio.state, "waiting");
  assert.equal(second.contexts.length === 0 || second.contexts[0].resumeCalls === 0, true);
  second.gesture("touchend");
  await flush();
  assert.equal(second.audio.state, "playing");

  const third = environment({ storage: "memory" });
  third.saved.set("keel-audio:remember", JSON.stringify({ on: false }));
  third.audio.configure({ id: "remember", autoplay: true });
  third.gesture("pointerdown");
  await flush();
  assert.equal(third.audio.state, "off", "a listener's 'off' outranks the piece's autoplay request");
});

test("hidden documents suspend a playing context and visible ones resume it without re-running the score", async () => {
  const env = environment();
  const { audio } = env;
  let starts = 0;
  let stops = 0;
  audio.onStart(() => { starts++; });
  audio.onStop(() => { stops++; });
  env.gesture("click", audio.mountButton().element);
  await flush();
  assert.equal(audio.state, "playing");
  const ctx = env.contexts[0];

  env.documentNode.visibilityState = "hidden";
  env.documentNode.dispatch("visibilitychange");
  await flush();
  assert.equal(ctx.state, "suspended");
  assert.equal(audio.state, "paused");

  env.documentNode.visibilityState = "visible";
  env.documentNode.dispatch("visibilitychange");
  await flush();
  // The fake only allows resume inside gestures, so this proves keel-audio
  // attempted it (sticky activation) and that the score was not restarted.
  assert.equal(ctx.resumeCalls, 2);
  assert.equal(starts, 1);
  assert.equal(stops, 0);

  // A context that was never started is not resumed on visibility.
  const idle = environment();
  idle.audio.ctx;
  idle.documentNode.visibilityState = "hidden";
  idle.documentNode.dispatch("visibilitychange");
  idle.documentNode.visibilityState = "visible";
  idle.documentNode.dispatch("visibilitychange");
  await flush();
  assert.equal(idle.contexts[0].resumeCalls, 0);
  assert.equal(idle.contexts[0].suspendCalls, 0);
});

test("autoplay-granting viewers start only when the piece asks", async () => {
  const quiet = environment({ autoplay: true });
  quiet.audio.configure({ id: "no-ask" });
  quiet.audio.ctx;
  quiet.contexts[0].setState("running");
  await flush();
  assert.equal(quiet.audio.state, "off");

  const asks = environment({ autoplay: true });
  let starts = 0;
  asks.audio.onStart(() => { starts++; });
  asks.audio.configure({ id: "asks", autoplay: true });
  await flush();
  assert.equal(asks.audio.state, "playing");
  assert.equal(starts, 1);
  assert.equal(asks.contexts[0].resumeCalls, 0, "a running context needs no resume at all");

  const denied = environment({ autoplay: false });
  denied.audio.configure({ id: "asks", autoplay: true });
  await flush();
  assert.equal(denied.audio.state, "waiting", "without the grant it waits for a gesture");
  assert.equal(denied.contexts[0].resumeCalls, 0);
});

test("with Tone loaded, keel-audio adopts Tone's context and mirrors mute/volume onto Tone.Destination", async () => {
  const env = environment({ tone: true });
  const { audio, sandbox } = env;
  assert.equal(audio.ctx, env.contexts[0], "Tone's load-time context is the shared one");
  assert.equal(env.contexts.length, 1);
  assert.equal(sandbox.Tone.setContextCalls, 0);
  assert.equal(env.toneContext().clockSource, "timeout", "no Worker at all: Tone's timer clock");
  audio.volume = 0.5;
  assert.ok(Math.abs(env.toneDestination().volume.value - 20 * Math.log10(0.5)) < 1e-9);
  audio.muted = true;
  assert.equal(env.toneDestination().mute, true);
  env.gesture("click", audio.mountButton().element);
  await flush();
  assert.equal(audio.state, "playing");
});

test("Tone's worker clock is kept only when a probe worker actually runs (viewer CSP worker-src 'none')", async () => {
  const blocked = environment({ tone: true, worker: "errors" });
  assert.equal(blocked.toneContext().clockSource, "worker", "adopted at load, probe pending");
  await flush();
  await flush();
  assert.equal(blocked.toneContext().clockSource, "timeout");

  const allowed = environment({ tone: true, worker: "works" });
  await flush();
  await flush();
  assert.equal(allowed.toneContext().clockSource, "worker");
});

test("unlock() resumes on a gesture without starting the score, and the API object is frozen", async () => {
  const env = environment();
  const { audio, sandbox } = env;
  let starts = 0;
  audio.onStart(() => { starts++; });
  const unlocked = audio.unlock();
  await flush();
  assert.equal(env.contexts[0].resumeCalls, 0);
  env.gesture("pointerdown");
  assert.equal(await unlocked, true);
  assert.equal(env.contexts[0].state, "running");
  assert.equal(starts, 0);
  assert.equal(audio.state, "off");

  assert.equal(Object.isFrozen(audio), true);
  assert.throws(() => { "use strict"; sandbox.KEEL_AUDIO = null; });
  assert.equal(Object.getOwnPropertyDescriptor(sandbox, "KEEL_AUDIO").configurable, false);
  assert.throws(() => audio.configure({ id: "bad id with spaces" }), /id/u);
  assert.throws(() => audio.onStart("not a function"), /functions/u);
  assert.equal(audio.protocol, "keel-audio@1");
});
