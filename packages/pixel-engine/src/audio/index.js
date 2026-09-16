// The engine's audio: generative lo-fi (score -> plan, player -> Tone), the
// instruments it plays (samples), sound effects (sfx), the page's speaker and
// KEEL audio glue (sound), NOCTURNES' room as a mood (nocturnes), loops as WAV.
export { BANDS, CHOICES, MODES, ROOM_KINDS, WEATHER_KINDS, moodFor, scoreOf, streamOf, hash } from "./score.js";
export { intensityMix, play, render, voice } from "./player.js";
export { makeSampleData, makeSamples } from "./samples.js";
export { LOOP_NAMES, SFX_NAMES, STYLE_NAMES, SURFACES, bodySfx, createSfx, paramsFor, sfxSamples, sfxStyle } from "./sfx.js";
export { createSound } from "./sound.js";
export { moodOfNocturnes } from "./nocturnes.js";
export { encodeWav, measureLoop } from "./wav.js";
