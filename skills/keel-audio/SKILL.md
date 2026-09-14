---
name: keel-audio
description: Add generative sound to a KEEL artwork. Use whenever a piece should play audio - a Tone.js score, synthesized ambience, UI sound, lo-fi loops like NOCTURNES - so it extends the shared Tone.js 15.1.22 and keel-audio modules, starts only from a real gesture inside the art frame, survives the sandbox (no network, no storage, maybe no workers), and ships no sample fetches. Covers declaring the modules, writing the score against KEEL_AUDIO, the autoplay capability, and testing it in the Inline shell.
---

# KEEL audio

A sounding piece has to answer one question before it plays anything: is the
browser going to let it. In a KEEL frame the answer starts as no. The frame is
sandboxed, opaque-origin and network-denied, and no host has promised it
autoplay. Hand-rolled, the failure is silent — the context stays `suspended`
and the score plays into nothing. This skill is the supported path.

The route is two shared browser modules a piece `extends`, exactly like
Three.js or p5, plus the SDK helpers that declare them:

- `tone-native@15.1.22` (alias `tone`) — Tone.js as one classic script,
  `globalThis.Tone`, ~52 KB gzip. Its `standardized-audio-context` dependency is
  replaced by a native shim.
- `keel-audio@1.0.0` (alias `keelAudio`) — `globalThis.KEEL_AUDIO`, ~3.5 KB gzip.
  One AudioContext, gesture-only start, master gain, visibility pause, a
  standard sound button, per-piece preferences.

Do not bundle Tone into creator bytes, load it from a CDN, or write your own
unlock logic. Extend the modules.

## When to reach for it

Any piece that makes sound: a generative score, ambience, sonified data, a
click or chime in an interactive work. Web Audio–only pieces extend keel-audio
alone; Tone pieces extend both, Tone first.

Do not reach for it to play a pre-recorded track with no interaction logic — a
direct `<audio>` element from a `data:`/`blob:` source is simpler — though the
same gesture rule applies.

## The three-step shape

**1. Declare.** Build the index from the claimed carriers, declare, verify the
bytes on-chain, then `defineModule`:

```js
const index = createKeelAudioModuleIndex({ chainId, store, toneObjectId, audioObjectId });
const audio = declareKeelToneBrowserModules(index);
await Promise.all([verifyExternalBrowserModuleOnchain(audio.tone, rpc), verifyExternalBrowserModuleOnchain(audio.audio, rpc)]);
defineModule("Piece", { kind: "app", target: `@keel/eth/eip155:${chainId}/browser`, extends: [...audio.extends], npm: { tone: "15.1.22" } });
```

The target must name its CAIP-2 chain, and an unverified descriptor is refused.
Nothing is deployed yet — the catalog says `not-claimed` — so for local work use
`loadKeelAudioModuleBytes` + `buildKeelAudioInlineModuleFragments` and compose
an Inline local document. Never deploy or send a transaction to "make it
available" without the owner asking.

**2. Write the score against `KEEL_AUDIO`.**

```js
KEEL_AUDIO.configure({ id: "nocturnes-42" });
KEEL_AUDIO.onStart(({ Tone }) => { /* build the graph, schedule, Tone.getTransport().start() */ });
KEEL_AUDIO.onStop(({ Tone }) => { Tone.getTransport().stop(); });
KEEL_AUDIO.mountButton();
```

`onStart` runs once per listener start, never on a tab-visibility resume, so
schedule there. Connect plain Web Audio to `KEEL_AUDIO.destination`; Tone nodes
use `.toDestination()`. Use `KEEL_AUDIO.volume`/`muted` for the listener's
level, not `Tone.Destination.volume`. Prefer `Tone.getTransport()`/
`getDestination()` over the deprecated constants.

**3. Prove it in the shell.** Compose the local document with the audio
fragments and a `text/javascript` entry, open it in a real browser, and click
**inside the art frame**. `tests/keel-audio-browser.test.mjs` is the pattern: it
checks the context is `suspended` before the click, that a script-dispatched
click does nothing, that a real click makes it `running`, and that the Transport
ticks.

## Traps

These are properties of the platform, not preferences.

- **Only a trusted gesture in the art frame starts sound.** Host clicks,
  `postMessage` relays and `element.click()` do not count. Never call
  `ctx.resume()` yourself on load or on a timer; call `KEEL_AUDIO.start()` from
  your own click handler, or let the button do it.
- **Autoplay is opt-in twice.** Only a viewer that grants `audioAutoplay`
  (`allow="autoplay"`) hands you a running context, and keel-audio starts on it
  only with `configure({ autoplay: true })` or `start()`. The compact Inline
  shell grants none. A listener's remembered "off" beats the piece's request.
- **No network.** `connect-src 'none'`: no sample URLs, no `Tone.Sampler` with
  `urls`, no `Tone.loaded()` waiting on fetches. Synthesize, or ship samples as
  verified creator assets and decode from bytes.
- **No storage.** `localStorage` throws `SecurityError` in the opaque origin.
  keel-audio already falls back to memory; any storage you add needs `try`/`catch`
  and an in-memory fallback.
- **Workers depend on the host.** The compact shell allows Tone's blob-Worker
  clock; the reference viewer sends `worker-src 'none'`, where a blocked Worker
  only fires `error` and Tone's Transport would never tick. keel-audio probes and
  moves Tone to its timer clock automatically — do not undo it by setting
  `clockSource` back to `"worker"`. Avoid AudioWorklet-based Tone nodes
  (`BitCrusher`, `FeedbackCombFilter`, `LowpassCombFilter`, `Freeverb`,
  `JCReverb`, `PluckSynth`) unless the target shell is known to allow them; use
  `Tone.Reverb`, filters, delays, chorus and the oscillator synths instead.
- **One context.** keel-audio adopts Tone's context. Do not create another
  `AudioContext` or call `Tone.setContext` with a new one; the deprecated
  `Tone.Transport`/`Tone.Destination` constants would stay on the old context.
- **Seed the music, not the clock.** A generative score that should be stable
  per token draws its choices from the token seed, not from `Math.random()` or
  wall-clock time.

## Proof boundary

`node --test tests/sdk-audio-module.test.mjs tests/sdk-keel-audio-runtime.test.mjs`
proves the pins, declarations, load order and runtime behaviour against fakes;
`tests/keel-audio-browser.test.mjs` proves the modules load under both the
compact shell CSP and the viewer CSP and that a real click starts a ticking
score. None of that proves a carrier exists on any chain — that needs a write,
a read-back and a hash match, as [Testing and readiness](../../docs/TESTING.md)
requires. The full reference is [Sound in a KEEL piece](../../docs/KEEL_AUDIO.md).
