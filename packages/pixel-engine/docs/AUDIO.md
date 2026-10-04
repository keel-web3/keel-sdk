# `src/audio` reference

Music and sound effects for agents building projects and games on the engine.
Everything is made in code from a seed: the music is generative lo-fi (the
NOCTURNES composer, generalised), the instruments are synthesised samples, and
the sound effects are a seeded sound palette. Nothing is fetched. Plain ES
modules; only `player.js`, `sound.js` and `createSfx` touch Web Audio — the
rest (plans, samples, sfx synthesis, params, body mapping) runs in Node and is
tested there.

| Module | What |
| --- | --- |
| `src/audio/score.js` | `scoreOf(mood, seed, { pins })` → a plan (plain data); `moodFor({ energy, darkness, weather, tempo, hue })`; `BANDS`, `CHOICES`, `MODES`, `WEATHER_KINDS`, `ROOM_KINDS`, `streamOf`, `hash` |
| `src/audio/player.js` | `play(Tone, plan, out, { intensity, tempo })` → `{ ready, stop, react, setIntensity, intensity }`; `render(Tone, plan, { preroll, intensity, overrun })` → one seamless loop (AudioBuffer); `intensityMix(x)` |
| `src/audio/samples.js` | `makeSampleData(plan, rate)` → Float32Arrays (keys, lead, bass, drums); `makeSamples(plan, rate)` → AudioBuffers |
| `src/audio/sfx.js` | `createSfx(Tone \| ctx, { seed, style })` → `play(name, params)`, `loop(name, params)`; `bodySfx(sfx, { surfaceOf })` for physics bodies; `sfxStyle`, `sfxSamples`, `paramsFor` |
| `src/audio/sound.js` | `createSound(host, { id, sfx })` — the speaker button, the KEEL_AUDIO path, `setPlan`, `setIntensity`, `sfx`, `renderLoop` |
| `src/audio/nocturnes.js` | `moodOfNocturnes(genome)` — NOCTURNES' room as a mood (its plans, byte for byte) |
| `src/audio/wav.js` | `encodeWav(channels, rate)`, `measureLoop(channels, rate)` (level, peak, seam) |
| `src/audio/index.js` | all of the above |

Try everything in `tools/audio-lab.html` (`npm run serve`, then
http://localhost:4200/tools/audio-lab.html): a seed and a mood, the loop and
its intensity, every sound effect, and renders to `out/*.wav`.

## Music and sound effects in a game, in about 20 lines

```html
<script src="../../vendor/tone-15.1.22-native.js"></script>
<!-- on a KEEL page, keel-audio comes from the piece's extends; locally: -->
<script src="../../vendor/keel-audio-1.0.0.min.js"></script>
```

```js
import { createSound, moodFor, scoreOf, bodySfx } from "../../src/audio/index.js";

// The record: this game's mood, this seed's band. (Pass the palette's key hue to put the music in the picture's key.)
const mood = moodFor({ name: "Night Water", energy: 0.65, darkness: 0.7, weather: ["waves", "wind"], hue: palette.hue });
const sound = createSound(hostElement, { id: "wallrun", sfx: { seed, style: "lofi" } });
sound.setPlan(scoreOf(mood, seed));

let feet = null;
function stepOnce() {
  body.step(STEP, input);
  // Sound effects come alive once the listener turns sound on (browsers need the click).
  if (sound.on && !feet) feet = bodySfx(sound.sfx, { surfaceOf: (b) => surfaceUnder(b) }); // "stone" | "metal" | "water"
  if (!sound.on && feet) { feet.stop(); feet = null; }
  feet?.update(body, STEP);
  // Faster and fuller while running; filtered and sparse while standing.
  const speed = Math.hypot(body.vel[0], body.vel[2]);
  sound.setIntensity(Math.min(1, 0.15 + speed / 11), 1.5);
}
// UI: sound.sfx.play("select"), sound.sfx.play("confirm") ...
```

`setIntensity` ramps (1.5 s here) and ignores changes under 0.01, so calling
it every step is fine. For a menu, call `sound.setIntensity(0.15)`.

## The score

`scoreOf(mood, seed, { pins })` returns a plan — plain JSON: the band's
players (`keys`, `lead`, `bass`, `kit`), `tonic`, `mode`, `bpm`, `swing`,
`form` (sections A, B, A2, C, T), `loopBars` (32, 36 or 40) and `loopSec`, the
`groove`, the instruments' `design` (brightness, bell, kick, snare, bits,
wear), every bar's chord, the `motif`, the `weather` and `room` layers, and the
`mix` (cutoff, tape, reverb, wow). The same mood and seed make the same plan
on every machine (exact integer streams). Every bar is played from its own
seed (`${seed}|bar|${index}`), so the loop starts anywhere and goes round
without a seam.

**Every piece is lo-fi.** Whatever the mood: a swung beat off synthesised drum
samples, keys that pump under the kick (the sidechain), tape wow and
saturation, a record scratch into sections, a tape stop on the loop's last
beat, vinyl crackle and platter rumble always under it, the samples worn to
the plan's bits and top. The mood only chooses which lo-fi.

**Every seed is its own record.** Tokens 1..200 of NOCTURNES make 122
instrument combinations and 200/200 distinct plans; a game mood over 200
seeds makes 135-165 combinations, 200/200 distinct, 23-33 keys-and-modes and
13-16 tempi (tests/audio.test.mjs prints these). Don't write one song per
scene: give the scene a mood and let the seed write the song.

### Moods

```js
moodFor({ energy: 0.65, darkness: 0.7, weather: ["waves", "wind"], tempo: 84 | [lo, hi], hue: 185, name: "Night Water", room: ["fan"], space: 0.05, pins })
```

- `energy` 0 (idle, menus) … 1 (driving): tempo range (64-76 bpm at 0, 82-96 at 1), boom-bap
  and Wurli/organ/chip as it rises, brushed/soft kits and felt/celesta/music box as it falls,
  more scratch, less room. It is also the plan's `energy` — the player's starting intensity.
- `darkness` 0 (day: major, brighter instruments, open top) … 1 (deep night: minor, jazzier
  chords, Rhodes and piano, a darker cutoff).
- `weather`: layers under the record — `rain`, `waves`, `traffic`, `wind`, `hush`, `crickets`,
  `car`, `chimes`, `shimmer` (unknown names are dropped). `room` adds `crackle`, `fan`, `hum`.
- `tempo`: a number pins the bpm; `[lo, hi]` is the range the seed picks in.
- `hue` (0-360): the key, round the circle of fifths, as NOCTURNES reads its palette. Omit it
  and the seed picks the key — or pass the project's palette hue so each seed's picture and
  music share a key (a fixed hue means one key for every seed: pass the seed's).

A mood can also be written by hand: `{ band: "Nightcap" }` plays NOCTURNES'
Nightcap band (any of `BANDS`), or `{ band: { keys: [["rhodes", 3], ["felt", 1]], … } }`
a band of your own (fields as in `BANDS`: `keys`, `lead`, `bass`, `feel` as
`[choice, weight]` lists; `tempo` [lo, hi]; `swing` [lo, hi]; `room`, `jazz`,
`vox`, `scratch`, `bright`, `worn` 0-1; optional `mode` or `lean: "major"`).
`picture` (seconds) locks the tempo so the loop is a whole number of an
animation's loops (NOCTURNES' GIFs); `view`, `dark`, `eclipse`, `space` are
the rest of what NOCTURNES reads.

### Locks and pins

Any choice can be fixed; the seed decides the rest (as in NOCTURNES' studio, a
pin skips its own draw, so the seed's later choices may come out differently
than without it -- still the same every time for that seed and those pins):

```js
scoreOf(mood, seed, { pins: { band: "Retro Den", keys: "wurli", lead: "chip", bass: "synth", kit: "boombap", mode: "dorian", key: "F#" /* or 6 */, tempo: 88 } })
```

Pins can also live on the mood (`mood.pins`); `opts.pins` wins. The choices
are `CHOICES` (`keys`: rhodes wurli piano felt vibes organ guitar; `lead`:
rhodes piano celesta kalimba musicbox vibes guitar chip; `bass`: sub upright
electric synth; `kit`: dusty boombap brushed soft rim chip; `mode`: ionian
dorian phrygian lydian mixolydian aeolian harmonic). In the engine's config
layers, a project locks its music by locking these pins.

### Intensity

`band.setIntensity(x, ramp)` (or `sound.setIntensity`) moves layers live
without touching the loop — bars keep their seeds and their place:

| x | what you hear |
| --- | --- |
| 0 | keys through a wall (650 Hz lowpass), a soft pulse of drums (30%), no tune, tempo −4% |
| 0.5 | the plan as composed (all layers at 1, open, the plan's tempo) |
| 1 | everything in, a busier kit on top (extra hats, kicks and shaker from a separate stream), tempo +4% |

`intensityMix(x)` gives the numbers (tests read them); `play(..., { tempo: 0 })`
holds the tempo still (renders always do).

### Playing and rendering

```js
const band = play(Tone, plan, out /* default Tone's destination */, { intensity: 0.5 });
await band.ready;            // (the reverb's room)
band.react("dim");           // a little quieter; "bright" back
band.stop(0.4);
const loop = await render(Tone, plan);   // one loop, played from 4 bars before the top so tails ring in: repeats with no seam
```

## Sound effects

```js
const sfx = createSfx(Tone /* or an AudioContext / OfflineAudioContext */, { seed, style: "lofi" });
sfx.play("step", { surface: "metal", speed: 8, pan: -0.3 });
sfx.play("land", { speed: 11 });            // louder and lower the harder; "land_hard" over 9 m/s
const g = sfx.loop("grind", { speed: 9 });  // loops fade in from anywhere in them
g.set({ speed: 13 }); g.stop(0.15);
```

The seed picks the project's **sound palette** (`sfxStyle(seed, style)`): the
shoes (sneaker, boot, soft), pitch, brightness, weight, how worn (bits, hold,
top), the rails' metal (a bar's inharmonic partials), the water, the wind, the
UI's key. Styles: `lofi` (default: worn, warm, a short slap), `clean`, `chip`
(6-bit, square UI), `soft`. Pin any field: `style: { name: "chip", shoe: "boot" }`.

| Name | Params | What |
| --- | --- | --- |
| `step` | `surface` stone/metal/water, `speed` | heel and toe (stone), a ring (metal), a splash with bubbles (water); 4 variants each, in turn |
| `jump` | | the push and a whoosh going up |
| `land` | `speed` (m/s) | a falling thump and the crunch underfoot |
| `wallStart`, `wallJump` | | a grab; a kick and the air |
| `railStart`, `railEnd` | | a clang on the rail; a smaller ring letting go |
| `splash`, `skimStart` | | in you go (plop, bubbles); a skim's touch-down |
| `respawn` | | a rise in the palette's key |
| `blip`, `hover`, `select`, `back`, `confirm`, `error` | | the UI, in key |
| loop `grind` | `speed` 4-14 | the rail singing and rattling: pitch, level and brightness by speed |
| loop `wallrun` | `speed` | two scuffs a loop and the rub between; cadence by speed |
| loop `skim` | `speed` 6.5-12 | a hiss and a slap each stride |
| loop `wind` | `speed` 0-20 | silent under 2 m/s, gusting up with speed |

Every sound also takes `gain` (0-2), `pan` (-1..1), `rate`, `when` (context time).
`paramsFor(name, params)` shows how a sound will be played.

### A physics body's sounds

`bodySfx(sfx, { surfaceOf, wind, gain })` → `{ update(body, dt), stop(), held }`.
Call `update` after each `body.step` (src/physics/character.js). It plays:
`landed {speed}` → land, `jumped` → jump, `wallStart`, `wallJump`, `railStart`,
`railEnd`, `skimStart`, `splashIn` → splash, `respawn`; footsteps from the run
(a stride of 0.7 m + 0.24 × speed: ~3 steps a second at a full run, on
`surfaceOf(body)`); and holds the `grind`, `wallrun` and `skim` loops while the
body's mode is `grind`, `wall`, `skim` (speeds follow the body), and the `wind`
by its speed. `stop()` lets every loop go.

## KEEL audio

On a KEEL page, `globalThis.KEEL_AUDIO` (keel-audio 1.0.0, in `vendor/`) owns
the one AudioContext, the gesture-only start, the listener's volume and mute
(remembered per piece), visibility pauses and the sound button. `createSound`
uses it when it's there — `configure({ id })`, `onStart`/`onStop`,
`mountButton(host, { corner })`, `start()`, `stop()`, `volume` — and makes its
own button on Tone otherwise (the studio, local tools). The music plays into
Tone's destination and the sound effects into it too (`Tone.connect`), so
KEEL's volume and mute cover both. `sound.sfx` is a silent stand-in until the
listener turns sound on. Load order on a page: Tone, then keel-audio, then the
project.

No AudioWorklet is used (some viewers refuse their blob URLs) and nothing is
fetched: samples, sfx and reverb impulses are all computed on the page.

## Budget

| What | Bytes | gzip -9 |
| --- | --- | --- |
| `vendor/tone-15.1.22-native.js` (Tone 15.1.22, the native-context build) | 234,102 | 50,857 |
| `vendor/keel-audio-1.0.0.min.js` | 8,405 | 3,558 |
| `src/audio/*.js` (all of it) | ~107,000 | ~35,500 together |
| of which a game needs score + player + samples + sfx + sound | ~95,500 | ~33,700 |

`nocturnes.js` (2.8 KB gz) and `wav.js` (1.3 KB gz) are only for NOCTURNES and
tools. Tone is the one big dependency; a KEEL piece gets it (and keel-audio)
from its `extends`, so a project's own code carries only `src/audio`. At the
start of play the samples cost ~50-150 ms to synthesise (keys, lead, bass at 7
roots each, 7 drums; sfx ~50 ms), and the reverb's impulse is rendered once.

## Tests

- `tests/audio-equality.test.mjs` — the engine against NOCTURNES' own modules:
  plans for tokens 1..300, 120 rooms without a theme, 60 with no hue / an
  eclipse, 120 with random studio pins (all JSON-identical); themeForItems on
  2000 item sets; every sample array of 10 plans bit-identical.
- `tests/audio.test.mjs` — determinism, whole plans (finite, 32-40 bars,
  lo-fi tempi), diversity (printed), moods move the band the way they say, pins,
  intensity numbers, instruments that sound and never clip, WAV and seam measures.
- `tests/audio-sfx.test.mjs` — the palette, every sound finite and heard, loops
  seamless, params in range for any input, a real physics body's events mapped.
- `npm run guard` — NOCTURNES' own music plans (`music #1..80`) unchanged.
