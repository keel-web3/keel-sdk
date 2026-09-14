# Sound in a KEEL piece

A KEEL piece can make sound, but the browser decides when. Audio starts only
from a real gesture inside the frame that plays it, and a KEEL artwork runs in a
sandboxed, network-denied, opaque-origin frame that no host has promised
autoplay to. Hand-rolled audio usually gets one of these wrong and fails
silently: the context stays `suspended`, the score "plays" into nothing, and the
piece looks broken on the one surface that matters.

The supported path is two shared browser modules that a piece `extends`, the
same way it extends Three.js or p5:

| Module | id@version | What it is | Size (raw / gzip -9) |
| --- | --- | --- | --- |
| Tone.js | `tone-native@15.1.22` (alias `tone`) | Tone.js 15.1.22 as ONE minified classic script defining `globalThis.Tone`. `standardized-audio-context` is replaced by a native shim. | 235,850 B / 51,958 B |
| keel-audio | `keel-audio@1.0.0` (alias `keelAudio`) | The KEEL audio runtime defining `globalThis.KEEL_AUDIO`: one context, gesture-only start, master gain, visibility pause, sound button, preferences. | 8,405 B / 3,538 B |

A piece that writes plain Web Audio extends keel-audio alone. A Tone piece
extends both, Tone first. Neither is creator bytes; each is published once per
chain and referenced.

| Surface | Entry point |
| --- | --- |
| SDK | `packages/sdk/src/audio-module.ts` — `KEEL_TONE_15`, `KEEL_AUDIO_RUNTIME`, `createKeelAudioModuleIndex`, `declareKeelToneBrowserModules`, `declareKeelAudioBrowserModule`, `buildKeelAudioInlineModuleFragments`, `loadKeelAudioModuleBytes` |
| Runtime source | `packages/sdk/resources/keel-audio.js` → `keel-audio-1.0.0.min.js` (`node scripts/build-keel-audio.mjs [--check]`) |
| Tone build | `examples/demos/vendor/tone-15.1.22.native.min.js` + `-LICENSE.txt` (`node scripts/build-tone-native.mjs [--check]`) |
| Catalog | `creative-runtime-catalog.ts` entries `tone` and `keel-audio` |
| Skill | `skills/keel-audio/SKILL.md` |
| Tests | `tests/sdk-audio-module.test.mjs`, `tests/sdk-keel-audio-runtime.test.mjs`, `tests/keel-audio-browser.test.mjs` (browser gate) |

**Publication status: not claimed.** Nothing here is deployed. The catalog
entries say `not-claimed`, and index entries only record where a carrier is
claimed to be. A carrier becomes usable when it is written, read back, and
hashed against the pinned digest (`verifyExternalBrowserModuleOnchain` or the
Studio gateway) — the same gate as every other shared module.

## Declaring the modules

```js
import { createKeelAudioModuleIndex, declareKeelToneBrowserModules } from "@keel/sdk";
import { defineModule, verifyExternalBrowserModuleOnchain } from "@keel/sdk/module";

const index = createKeelAudioModuleIndex({
  chainId: 11155111,
  store: "0x…",          // the KeelHold holding both carriers
  toneObjectId: "0x…",   // omit for a Web Audio-only piece
  audioObjectId: "0x…",
});
const audio = declareKeelToneBrowserModules(index);
await Promise.all([
  verifyExternalBrowserModuleOnchain(audio.tone, endpoint),
  verifyExternalBrowserModuleOnchain(audio.audio, endpoint),
]);

export default defineModule("Nocturne", {
  kind: "app",
  target: "@keel/eth/eip155:11155111/browser", // browser extends need the CAIP-2 chain
  extends: [...audio.extends],                  // Tone, then keel-audio
  npm: { tone: "15.1.22" },
});
```

`kind` is a label; nothing reads it. What makes Tone available is `extends`.
`defineModule` refuses a browser target that does not name its chain, a module
bound to another chain, and any module whose carrier bytes have not been read
and hashed.

For local documents and sandbox checks, `buildKeelAudioInlineModuleFragments`
turns the verified bytes into Inline-shell module fragments: gzip classic
scripts in the `runtime` phase with weights −200 (Tone) and −100 (keel-audio),
so they run before creator runtime modules (weight 0) and before a
`text/javascript` entry.

## Writing the score

```js
KEEL_AUDIO.configure({ id: "nocturnes-42" });  // per-piece preference key

KEEL_AUDIO.onStart(({ Tone }) => {
  const keys = new Tone.PolySynth(Tone.FMSynth).toDestination();
  new Tone.Loop((time) => keys.triggerAttackRelease(["D3", "F3", "A3", "C4"], "2n", time), "1m").start(0);
  Tone.getTransport().start();
});
KEEL_AUDIO.onStop(({ Tone }) => {
  Tone.getTransport().stop();
});

KEEL_AUDIO.mountButton();  // standard sound toggle, bottom-right
```

The API, all on `globalThis.KEEL_AUDIO` (frozen, non-configurable):

| Member | Meaning |
| --- | --- |
| `ctx` | The one shared `AudioContext`. With Tone loaded it is Tone's own context (adopted, so `Tone.Transport`/`Tone.Destination` stay live); otherwise keel-audio creates one lazily (`latencyHint: "playback"`) and calls `Tone.setContext` if Tone appears. |
| `destination` | Master `GainNode` → `ctx.destination`. Connect plain Web Audio graphs here. |
| `start()` / `stop()` / `toggle()` | The score's lifecycle. `start()` resolves `true` once playing; outside a gesture it waits for the next one (or starts at once on a context an autoplay-granting viewer already runs). |
| `onStart(fn)` / `onStop(fn)` / `onChange(fn)` | Handlers get `{ ctx, destination, Tone }` (`onChange` gets the state). Each returns an unsubscribe function. `onStart` runs once per listener start, never on a visibility resume. |
| `unlock()` | Resume the context on a gesture without starting the score; resolves when running. |
| `muted`, `volume` | Listener controls (0–1). Drive the master gain and are mirrored onto `Tone.getDestination()`. Remembered per piece. |
| `state` | `"off"`, `"waiting"` (wants sound, needs a gesture), `"playing"`, `"paused"` (hidden tab or OS interruption), `"unsupported"`. |
| `configure({ id, autoplay, volume, muted, latencyHint })` | Call first. `volume`/`muted` are defaults used only when nothing is remembered. |
| `mountButton(parent?, { corner })` | A 40 px round `<button>` with `aria-label`/`aria-pressed`, keyboard-focusable, inline styles only, no pulse under `prefers-reduced-motion`. `corner`: `top-left`, `top-right`, `bottom-left`, `bottom-right` (default) or `none` to place it yourself. Returns `{ element, remove() }`. |

Use `KEEL_AUDIO.volume`, not `Tone.Destination.volume`, for the listener's level:
keel-audio overwrites the Tone destination whenever mute or volume change.

## Gesture rules

These are properties of the runtime, not options.

- **No gesture, no sound.** keel-audio never starts audio outside a trusted
  `pointerdown`, `keydown`, `touchend` or `click` in the artwork's own frame.
  The one `resume()` without a fresh gesture is the return from a hidden tab of
  a context the listener already started (below).
  Events with `isTrusted === false` — anything dispatched by script, or relayed
  from the host over `postMessage` — are ignored. The host's clicks do not count
  either; the gesture must land inside the art frame.
- **The button decides for itself.** Gestures on the sound button only toggle;
  gestures anywhere else resume only when sound is wanted (`waiting`).
- **Once on, gestures may resume.** When the listener has turned sound on for
  this piece id, the preference arms the *next* gesture anywhere in the piece.
  It never starts audio by itself.
- **Hidden means paused.** On `visibilitychange` to hidden a running context is
  suspended; on return it is resumed only if the listener had started it and the
  document has had a real gesture (sticky activation). The score is not re-run.
- **Stop is quiet.** `stop()` runs `onStop`, fades the master, and suspends the
  context ~120 ms later.
- **iOS unlock.** A one-sample silent buffer is played inside the gesture that
  resumes the context.

### `audioAutoplay`

The runtime capability `audioAutoplay` (`RuntimeCapabilities.audioAutoplay`,
policy id `browser.audioautoplay`) is what a viewer grants when it lets a frame
play without a gesture; the reference sandbox maps it to `allow="autoplay"` on
the art iframe. The compact Inline shell grants no autoplay (its art frame has
no `allow` attribute). Default behaviour is therefore **gesture start**.

When a viewer does grant autoplay, the browser hands the piece a context that is
already `running`. keel-audio starts on it **only if the piece asks** —
`configure({ autoplay: true })` or an explicit `start()` — and never when the
listener's remembered preference is "off". Without the grant, `autoplay: true`
simply means "waiting" until the first gesture. keel-audio never resumes a
context to find out; it only reads the state the browser gave it. Declare the
capability in the manifest only when the piece is meant to open with sound.

## CSP and sandbox facts

The compact Inline shell's art frame:
`sandbox="allow-scripts allow-pointer-lock"`, no `allow`, CSP
`default-src 'none'; script-src 'unsafe-inline' data: blob:; media-src data: blob:; connect-src 'none'; …`.

- **No sample fetches.** `connect-src 'none'` blocks `fetch`/XHR, so
  `Tone.Sampler`/`Tone.Player` with URLs, `ToneAudioBuffer.fromUrl` and
  `Tone.loaded()` waiting on network never resolve. Synthesize, or ship samples
  as verified creator assets and decode them from bytes
  (`ctx.decodeAudioData(bytes.buffer)` → `new Tone.ToneAudioBuffer(audioBuffer)`).
  `media-src data: blob:` allows `<audio>` from `data:`/`blob:` URLs.
- **Workers and worklets.** The compact shell has no `worker-src`, so it falls
  back to `script-src … blob:` and Tone's blob-Worker clock runs (proved in
  `tests/keel-audio-browser.test.mjs`). Tone's AudioWorklet-based nodes —
  `BitCrusher`, `FeedbackCombFilter`, `LowpassCombFilter`, and through them
  `Freeverb`, `JCReverb` and `PluckSynth` — load their processors from `blob:`
  URLs and need a shell that allows blob scripts in a secure context; avoid them
  unless the shell in question is known to allow them. `Tone.Reverb`
  (convolution, rendered offline), filters, delays, `Chorus`, `Phaser`,
  `Distortion`, `AutoFilter`, `Tremolo` and the oscillator/FM/AM/noise synths
  use plain nodes. keel-audio itself uses no worklet.
- **The reference viewer blocks workers.** `packages/viewer/src/sandbox.ts`
  sends `worker-src 'none'` (and `child-src 'none'`). Chrome still constructs a
  blocked Worker and only fires `error`, so Tone's Transport — and every `Loop`,
  `Sequence`, `Part` and scheduled callback — would never tick. keel-audio
  probes once with its own blob Worker and, when it errors, switches Tone to its
  timer clock (`clockSource = "timeout"`); the browser test proves the score
  ticks under that exact policy. Other worker-based code (and any AudioWorklet)
  in a piece is still broken under that viewer. This is reported, not changed:
  the viewer policy is untouched.
- **Storage throws.** Without `allow-same-origin` the frame has an opaque
  origin and touching `localStorage`/`sessionStorage` throws `SecurityError`.
  keel-audio keeps preferences (`keel-audio:<id>` → `{ on, muted, volume }`) in
  memory and uses storage only when a host makes it available. Any storage in
  creator code needs the same `try`/`catch` with an in-memory fallback.

## Sizes and compression

KeelHold stores objects gzip/deflate/brotli-compressed; the compact Inline
shell decodes gzip and deflate before mounting (brotli needs a declared decoder
profile), so both modules ship gzip: about 52 KB for Tone and 3.5 KB for
keel-audio, roughly 55 KB of carriage for the pair — once per chain, shared by
every piece. The upstream `build/Tone.js` UMD (with `standardized-audio-context`)
is 345,500 B / 79,291 B gzip; the native shim is most of the difference. Creator code for a generative
score is typically a few KB.

## Rebuilding and proving the pins

```bash
node scripts/build-tone-native.mjs --check   # npm pack tone@15.1.22 + tslib@2.8.1 (SRI-checked), esbuild 0.28.2, byte-compare
node scripts/build-keel-audio.mjs --check    # re-minify keel-audio.js, byte-compare with the pinned artifact
node --test tests/sdk-audio-module.test.mjs tests/sdk-keel-audio-runtime.test.mjs
node --test tests/keel-audio-browser.test.mjs  # needs a Chrome headless shell
```

Changing either artifact changes its digest; update `KEEL_TONE_15` /
`KEEL_AUDIO_RUNTIME` and the catalog deliberately, bump the version, and treat
it as a new shared module — a published carrier never changes under a piece.
