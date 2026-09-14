/*! keel-audio 1.0.0 | MIT | KEEL shared audio runtime: one AudioContext, gesture-only start, master gain, visibility pause, sound button. */
(() => {
  "use strict";
  const G = globalThis;
  if (G.KEEL_AUDIO) return;
  const doc = G.document;
  const noop = () => {};
  const GESTURES = ["pointerdown", "keydown", "touchend", "click"];
  const memory = new Map();
  const starts = new Set();
  const stops = new Set();
  const changes = new Set();
  const buttons = new Set();
  let ctx = null;
  let master = null;
  let pieceId = "default";
  let latencyHint = "playback";
  let desired = false; // the listener or the piece wants sound
  let active = false; // the score has been started (onStart ran, onStop has not)
  let muted = false;
  let volume = 0.8;
  let unlockWanted = false;
  let armed = false; // a real gesture, or a piece-requested start on an already-running context
  let inGesture = false;
  let activated = false; // a trusted gesture reached this document
  let resumeOnVisible = false;
  let stopTimer = 0;
  let waiters = [];

  const AudioContextClass = () => G.AudioContext || G.webkitAudioContext;
  const report = (error) => { try { G.console && G.console.error(error); } catch { /* console may be absent */ } };

  // Storage THROWS in an opaque-origin sandbox (no allow-same-origin), so every
  // access is guarded and memory is the source of truth for this document.
  function storage() {
    try {
      const store = G.localStorage;
      if (store && typeof store.getItem === "function") return store;
    } catch { /* SecurityError in opaque origins */ }
    return null;
  }
  function readPreference() {
    const key = `keel-audio:${pieceId}`;
    let raw = null;
    const store = storage();
    if (store) { try { raw = store.getItem(key); } catch { raw = null; } }
    if (raw === null || raw === undefined) raw = memory.has(key) ? memory.get(key) : null;
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
  function writePreference(fields) {
    const key = `keel-audio:${pieceId}`;
    const raw = JSON.stringify({ ...(readPreference() || {}), ...fields });
    memory.set(key, raw);
    const store = storage();
    if (store) { try { store.setItem(key, raw); } catch { /* quota or policy */ } }
  }

  function userActivation() {
    const nav = G.navigator;
    return nav && nav.userActivation ? nav.userActivation : null;
  }
  function gestureActive() {
    const activation = userActivation();
    return inGesture || Boolean(activation && activation.isActive);
  }
  function stickyActivation() {
    const activation = userActivation();
    return activated || Boolean(activation && activation.hasBeenActive);
  }

  function toneDestination() {
    const Tone = G.Tone;
    if (!Tone || !ctx || typeof Tone.getContext !== "function") return null;
    try {
      if (Tone.getContext().rawContext !== ctx) return null;
      return Tone.getDestination();
    } catch { return null; }
  }
  function applyGain(ramp) {
    const target = muted || !active ? 0 : volume;
    if (master) {
      const gain = master.gain;
      if (ramp && typeof gain.setTargetAtTime === "function") {
        try { gain.cancelScheduledValues(ctx.currentTime); gain.setTargetAtTime(target, ctx.currentTime, 0.02); } catch { gain.value = target; }
      } else gain.value = target;
    }
    const destination = toneDestination();
    if (destination) {
      try {
        destination.mute = muted;
        if (!muted) destination.volume.value = 20 * Math.log10(Math.max(volume, 0.0001));
      } catch { /* a disposed Tone destination */ }
    }
  }

  // Tone's clock runs in a blob Worker. A viewer whose CSP says
  // `worker-src 'none'` still constructs the Worker and only fires `error`, so
  // Tone's Transport would never tick. Probe once; fall back to Tone's timer clock.
  function keepToneClockAlive(toneContext) {
    const fallback = () => { try { toneContext.clockSource = "timeout"; } catch { /* older Tone */ } };
    try {
      if (toneContext.clockSource !== "worker") return;
      if (typeof G.Worker !== "function" || typeof G.Blob !== "function" || !G.URL) { fallback(); return; }
      const url = G.URL.createObjectURL(new G.Blob(["postMessage(1)"], { type: "text/javascript" }));
      const worker = new G.Worker(url);
      const finish = (alive) => {
        try { worker.terminate(); G.URL.revokeObjectURL(url); } catch { /* already gone */ }
        if (!alive) fallback();
      };
      worker.onmessage = () => finish(true);
      worker.onerror = () => finish(false);
    } catch { fallback(); }
  }

  function getContext() {
    if (ctx) return ctx;
    const Constructor = AudioContextClass();
    const Tone = G.Tone;
    // Tone builds its default context while loading; adopting it keeps ONE
    // context and keeps Tone's load-time constants (Transport, Destination) live.
    try {
      if (Tone && typeof Tone.getContext === "function") {
        const toneContext = Tone.getContext();
        const raw = toneContext.rawContext;
        if (Constructor && raw instanceof Constructor) { ctx = raw; keepToneClockAlive(toneContext); }
      }
    } catch { ctx = null; }
    if (!ctx) {
      if (!Constructor) return null;
      ctx = new Constructor({ latencyHint });
      if (Tone && typeof Tone.setContext === "function") {
        try { Tone.setContext(ctx); keepToneClockAlive(Tone.getContext()); } catch (error) { report(error); }
      }
    }
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    const onState = () => { if (ctx.state === "running") settle(); else notify(); };
    if (typeof ctx.addEventListener === "function") ctx.addEventListener("statechange", onState);
    else ctx.onstatechange = onState;
    applyGain(false);
    return ctx;
  }

  function running() { return Boolean(ctx) && ctx.state === "running"; }
  function stateName() {
    if (!AudioContextClass()) return "unsupported";
    if (!desired) return "off";
    if (!active) return "waiting";
    return running() ? "playing" : "paused";
  }
  function notify() {
    const state = stateName();
    for (const button of buttons) button.render(state);
    for (const listener of changes) { try { listener(state); } catch (error) { report(error); } }
  }
  function settle() {
    if (running()) {
      unlockWanted = false;
      if (desired && !active && armed) {
        active = true;
        clearTimeout(stopTimer);
        applyGain(true);
        const input = { ctx, destination: master, Tone: G.Tone };
        for (const handler of starts) { try { handler(input); } catch (error) { report(error); } }
      }
      if (desired) {
        const pending = waiters;
        waiters = [];
        for (const resolve of pending) resolve(true);
      }
    }
    notify();
  }

  // Silent one-sample buffer played inside the gesture: the iOS Safari unlock.
  function primeInGesture(context) {
    try {
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(1, 1, context.sampleRate || 44100);
      source.connect(context.destination);
      source.start(0);
    } catch { /* not required outside WebKit */ }
  }
  function resumeFromGesture() {
    const context = getContext();
    if (!context) return;
    armed = true;
    primeInGesture(context);
    if (context.state !== "running") {
      const result = context.resume();
      if (result && typeof result.then === "function") result.then(settle, noop);
    } else settle();
  }

  function onGesture(event) {
    if (!event || event.isTrusted !== true) return; // synthetic events never unlock audio
    activated = true;
    inGesture = true;
    setTimeout(() => { inGesture = false; }, 0);
    for (const button of buttons) if (button.contains(event.target)) return; // the button decides
    if ((desired && !(active && running())) || unlockWanted) resumeFromGesture();
  }
  if (typeof G.addEventListener === "function") {
    for (const type of GESTURES) G.addEventListener(type, onGesture, { capture: true, passive: true });
  }
  if (doc && typeof doc.addEventListener === "function") {
    doc.addEventListener("visibilitychange", () => {
      if (!ctx) return;
      if (doc.visibilityState === "hidden") {
        if (ctx.state === "running") {
          resumeOnVisible = true;
          const result = ctx.suspend();
          if (result && typeof result.then === "function") result.then(notify, noop);
        }
      } else if (resumeOnVisible) {
        resumeOnVisible = false;
        // Only a context the listener already started, in a document that has
        // had a real gesture, comes back on its own.
        if (desired && active && stickyActivation()) {
          const result = ctx.resume();
          if (result && typeof result.then === "function") result.then(settle, noop);
        }
      }
    });
  }

  function whenPlaying() {
    if (active && running()) return Promise.resolve(true);
    return new Promise((resolve) => { waiters.push(resolve); });
  }

  function start() {
    const byListener = gestureActive();
    desired = true;
    if (byListener) writePreference({ on: true });
    const context = getContext();
    if (!context) { notify(); return Promise.resolve(false); }
    const promise = whenPlaying();
    if (context.state === "running") { armed = true; settle(); }
    else if (byListener) resumeFromGesture();
    else notify(); // waits for the next real gesture; never resumes on its own
    return promise;
  }

  function stop() {
    if (gestureActive()) writePreference({ on: false });
    desired = false;
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve(false);
    if (active) {
      active = false;
      const input = { ctx, destination: master, Tone: G.Tone };
      for (const handler of stops) { try { handler(input); } catch (error) { report(error); } }
      applyGain(true);
    }
    clearTimeout(stopTimer);
    if (ctx && ctx.state === "running") {
      const context = ctx;
      stopTimer = setTimeout(() => {
        if (!desired && context.state === "running") {
          const result = context.suspend();
          if (result && typeof result.then === "function") result.then(notify, noop);
        }
      }, 120);
    }
    notify();
    return Promise.resolve(false);
  }

  function unlock() {
    const context = getContext();
    if (!context) return Promise.resolve(false);
    if (context.state === "running") return Promise.resolve(true);
    const promise = new Promise((resolve) => {
      const check = () => {
        if (context.state !== "running") return;
        if (typeof context.removeEventListener === "function") context.removeEventListener("statechange", check);
        resolve(true);
      };
      if (typeof context.addEventListener === "function") context.addEventListener("statechange", check);
    });
    if (gestureActive()) resumeFromGesture();
    else unlockWanted = true;
    return promise;
  }

  function subscribe(set, handler) {
    if (typeof handler !== "function") throw new TypeError("keel-audio handlers must be functions.");
    set.add(handler);
    return () => set.delete(handler);
  }

  const ICON_ON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const ICON_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  function mountButton(parent, options) {
    if (!doc || typeof doc.createElement !== "function") return null;
    const settings = options || {};
    const host = parent || doc.body;
    const corner = settings.corner || "bottom-right";
    const reduced = typeof G.matchMedia === "function" && G.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const element = doc.createElement("button");
    element.type = "button";
    element.setAttribute("data-keel-audio-button", "");
    const style = element.style;
    if (corner !== "none") {
      style.position = "fixed";
      style[corner.startsWith("top") ? "top" : "bottom"] = "12px";
      style[corner.endsWith("left") ? "left" : "right"] = "12px";
      style.zIndex = "2147483000";
    }
    style.width = "40px";
    style.height = "40px";
    style.padding = "0";
    style.display = "inline-flex";
    style.alignItems = "center";
    style.justifyContent = "center";
    style.borderRadius = "50%";
    style.border = "1px solid rgba(255,255,255,0.4)";
    style.background = "rgba(0,0,0,0.55)";
    style.color = "#fff";
    style.cursor = "pointer";
    style.opacity = "0.85";
    style.transition = reduced ? "none" : "opacity 160ms ease";
    let pulse = null;
    const record = {
      contains: (target) => Boolean(target) && (target === element || (typeof element.contains === "function" && element.contains(target))),
      render(state) {
        const on = state === "playing" || state === "paused";
        const label = state === "unsupported" ? "Sound is not supported here" : on ? "Turn sound off" : state === "waiting" ? "Start sound" : "Turn sound on";
        element.setAttribute("aria-label", label);
        element.setAttribute("aria-pressed", on ? "true" : "false");
        element.title = label;
        element.disabled = state === "unsupported";
        element.innerHTML = on ? ICON_ON : ICON_OFF;
        const wantPulse = state === "waiting" && !reduced && typeof element.animate === "function";
        if (wantPulse && !pulse) pulse = element.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 1100, iterations: Infinity, direction: "alternate" });
        if (!wantPulse && pulse) { pulse.cancel(); pulse = null; }
      },
    };
    element.addEventListener("click", (event) => {
      if (!event || event.isTrusted !== true) return;
      if (active && running()) stop(); else start();
    });
    buttons.add(record);
    record.render(stateName());
    host.appendChild(element);
    return {
      element,
      remove() {
        buttons.delete(record);
        if (pulse) pulse.cancel();
        if (element.parentNode) element.parentNode.removeChild(element);
      },
    };
  }

  function loadPreference(defaults) {
    const saved = readPreference() || {};
    if (typeof saved.muted === "boolean") muted = saved.muted;
    else if (typeof defaults.muted === "boolean") muted = defaults.muted;
    const savedVolume = Number(saved.volume);
    if (Number.isFinite(savedVolume)) volume = Math.min(1, Math.max(0, savedVolume));
    else if (Number.isFinite(Number(defaults.volume))) volume = Math.min(1, Math.max(0, Number(defaults.volume)));
    // "on" is only ever written by a real gesture. It arms the next gesture;
    // it never starts audio by itself.
    if (!active) desired = saved.on === true || (saved.on !== false && defaults.autoplay === true);
  }

  function configure(options) {
    const settings = options || {};
    if (settings.id !== undefined) {
      const text = String(settings.id);
      if (!/^[A-Za-z0-9._:-]{1,96}$/u.test(text)) throw new TypeError("keel-audio id must be 1-96 characters of A-Z a-z 0-9 . _ : -");
      pieceId = text;
    }
    if (!ctx && (settings.latencyHint === "interactive" || settings.latencyHint === "balanced" || settings.latencyHint === "playback")) latencyHint = settings.latencyHint;
    loadPreference(settings);
    applyGain(false);
    // A viewer that grants autoplay hands the page a context that is already
    // running. Only then, and only because the piece asked, does it start now.
    if (settings.autoplay === true && desired) {
      const context = getContext();
      if (context && context.state === "running") { armed = true; settle(); }
    }
    notify();
    return api;
  }

  const api = Object.freeze({
    protocol: "keel-audio@1",
    version: "1.0.0",
    get ctx() { return getContext(); },
    get destination() { getContext(); return master; },
    get state() { return stateName(); },
    get playing() { return active && running(); },
    get muted() { return muted; },
    set muted(value) { muted = Boolean(value); writePreference({ muted }); applyGain(true); notify(); },
    get volume() { return volume; },
    set volume(value) {
      const next = Number(value);
      if (!Number.isFinite(next)) throw new TypeError("keel-audio volume must be a number from 0 to 1.");
      volume = Math.min(1, Math.max(0, next));
      writePreference({ volume });
      applyGain(true);
      notify();
    },
    configure,
    unlock,
    start,
    stop,
    toggle: () => (active && running() ? stop() : start()),
    onStart: (handler) => subscribe(starts, handler),
    onStop: (handler) => subscribe(stops, handler),
    onChange: (handler) => subscribe(changes, handler),
    mountButton,
  });
  loadPreference({});
  // Tone made its (suspended) context while loading; adopt it now so the
  // clock probe settles long before the listener's first gesture.
  if (G.Tone) { try { getContext(); } catch (error) { report(error); } }
  Object.defineProperty(G, "KEEL_AUDIO", { value: api, enumerable: true, writable: false, configurable: false });
})();
