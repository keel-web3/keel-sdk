// Music and sound effects on a page: a small speaker in a corner, off until
// the listener turns it on (a browser only lets a page sound after a click in
// it), then the project's own record, following it as it changes, and its
// sound effects. If they had it on last time, their first click on the page
// brings it back. (NOCTURNES' roomSound, for any project.)
//
// On a KEEL page the KEEL audio module (globalThis.KEEL_AUDIO) owns the
// button, the context and the rules -- configure, onStart, onStop,
// mountButton, start, stop, volume; anywhere else Tone (globalThis.Tone) runs
// on its own and this makes the button.
//
//   const sound = createSound(host, { id: "wallrun", sfx: { seed, style: "lofi" } });
//   sound.setPlan(scoreOf(moodFor({ energy: 0.6, weather: ["waves", "wind"] }), seed));
//   sound.setIntensity(running ? 0.9 : 0.2);
//   sound.sfx.play("jump");               // (silent until the listener turns sound on)

import { play, render } from "./player.js";
import { createSfx } from "./sfx.js";
import { hash } from "./score.js";

const SPEAKER = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path data-wave fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/><path data-mute fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>';

// (What sound effects do while there's no sound: nothing.)
const QUIET = { play: () => null, loop: () => ({ set() {}, stop() {}, playing: false }), stopAll() {}, style: null };

export function createSound(host, { id = "keel", key = `${id}:sound`, corner = "top-right", button: withButton = true, sfx: sfxOpts = null, intensity = null } = {}) {
  const K = globalThis.KEEL_AUDIO ?? null;
  const Tone = () => globalThis.Tone ?? null;
  let plan = null;
  let playing = null; // (what the band is playing: its plan's hash)
  let band = null;
  let on = false;
  let wanted = false;
  let level = intensity;
  let fx = null;
  const watchers = [];
  try { wanted = localStorage.getItem(key) === "on"; } catch {}
  const planKey = (p) => (p ? hash(JSON.stringify(p)) : null);
  const notify = () => { for (const w of watchers) { try { w(api); } catch {} } };

  async function begin() {
    if (!Tone()) return;
    if (!K) await Tone().start(); // (inside the listener's click: that's what lets it sound)
    if (sfxOpts && !fx) fx = createSfx(Tone(), sfxOpts);
    if (plan) {
      band?.stop(0.25, { transport: false }); // (the next one takes the transport on)
      band = play(Tone(), plan, null, level === null ? {} : { intensity: level }); // (into Tone's destination: keel-audio sets its level and mute)
      playing = planKey(plan);
    }
    notify();
  }
  function end() { band?.stop(); band = null; playing = null; fx?.stopAll(); notify(); }
  function remember(v) { try { localStorage.setItem(key, v ? "on" : "off"); } catch {} }

  let button = null;
  function label() {
    if (!button) return;
    button.setAttribute("aria-pressed", String(on));
    button.setAttribute("aria-label", on ? "Turn the sound off" : "Turn the sound on");
    button.title = on ? "sound off" : "sound on";
    button.querySelector("[data-wave]").style.display = on ? "" : "none";
    button.querySelector("[data-mute]").style.display = on ? "none" : "";
  }
  async function set(v) {
    on = v;
    remember(on);
    label();
    if (on) await begin(); else end();
  }
  if (K) {
    // (KEEL's module draws the button, remembers the choice per piece and
    // answers the gesture; it tells us when the listener starts and stops.)
    K.configure({ id: String(id).replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 96) || "keel" });
    K.onStart(() => { on = true; begin(); });
    K.onStop(() => { on = false; end(); });
    if (withButton) K.mountButton(host, { corner });
  } else {
    if (withButton && host) {
      button = document.createElement("button");
      button.type = "button";
      button.innerHTML = SPEAKER;
      const [v, h] = corner.split("-");
      button.style.cssText = `position:absolute;${v}:10px;${h}:10px;z-index:3;width:30px;height:30px;padding:0;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(8,8,14,.55);color:#cfd3e6;cursor:pointer;opacity:.7`;
      button.onclick = (e) => { e.stopPropagation(); set(!on); }; // (it isn't a click on the game)
      button.onmouseenter = () => { button.style.opacity = "1"; };
      button.onmouseleave = () => { button.style.opacity = ".7"; };
      label();
      host.append(button);
    }
    // On last time: the first click anywhere on the page brings it back.
    if (wanted) {
      const again = () => { removeEventListener("pointerdown", again, true); if (!on) set(true); };
      addEventListener("pointerdown", again, true);
    }
    // Hidden, it rests; back, it plays on.
    document.addEventListener("visibilitychange", () => {
      const ctx = Tone()?.getContext?.().rawContext;
      if (!ctx || !on) return;
      if (document.hidden) ctx.suspend?.(); else ctx.resume?.();
    });
  }

  const api = {
    /** The music now: a new plan gets its own record; the same keeps playing. */
    setPlan(p) {
      plan = p ?? null;
      if (on && plan && planKey(plan) !== playing) begin();
      else if (on && !plan) { band?.stop(); band = null; playing = null; notify(); }
      else notify();
    },
    /** 0 idle .. 0.5 as composed .. 1 driving (layers in and out; the loop runs on). */
    setIntensity(x, ramp) { level = x; band?.setIntensity(x, ramp); },
    get intensity() { return band?.intensity ?? level; },
    /** Something happened: "dim" (a little quieter), "bright" (back). */
    react(what) { band?.react(what); },
    /** The sound effects (quiet while sound is off). */
    get sfx() { return on && fx ? fx : QUIET; },
    get on() { return on; },
    get plan() { return plan; },
    start: () => (K ? K.start() : set(true)),
    stop: () => (K ? K.stop() : set(false)),
    toggle: () => (on ? api.stop() : api.start()),
    /** The listener's level, 0-1. */
    get volume() { return K ? K.volume : 10 ** ((Tone()?.getDestination().volume.value ?? 0) / 20); },
    set volume(v) { if (K) K.volume = v; else if (Tone()) Tone().getDestination().volume.value = 20 * Math.log10(Math.max(1e-4, v)); },
    /** Where the band is: the bar in the loop and its section. */
    position() {
      if (!band || !plan || !Tone()) return null;
      const T = Tone().getTransport();
      const bar = Math.floor(T.ticks / (T.PPQ * 4)) % plan.loopBars;
      return { bar, of: plan.loopBars, sec: plan.bars[bar]?.sec, seconds: T.seconds % plan.loopSec };
    },
    /** One seamless loop of the current music, rendered offline (an AudioBuffer). */
    renderLoop: (opts) => (plan && Tone() ? render(Tone(), plan, opts) : Promise.resolve(null)),
    onChange(fn) { watchers.push(fn); return () => watchers.splice(watchers.indexOf(fn), 1); },
  };
  return api;
}
