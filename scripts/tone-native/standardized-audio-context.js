// Native stand-in for `standardized-audio-context`, bundled into the KEEL
// Tone.js build instead of the real package (~55 KB gzip of polyfills for
// browsers KEEL does not target). Tone asks it for constructors, type checks
// and `isSupported`; every browser that can mount a KEEL piece has these on
// its own Web Audio implementation.
//
// Everything is resolved lazily, on use, never at script load: the bundle is
// evaluated once, but a context may be constructed much later, and a test or
// host may install or replace the globals in between.
const G = globalThis;

function native(name) {
  const value = G[name];
  if (typeof value === "function") return value;
  if (name === "AudioContext" && typeof G.webkitAudioContext === "function") return G.webkitAudioContext;
  return undefined;
}

function lazyConstructor(name) {
  // Invoked with `new`; returning an object from a constructor makes that
  // object the result, so callers receive the page's real native instance.
  function NativeConstructor(...args) {
    const Constructor = native(name);
    if (Constructor === undefined) throw new TypeError(`${name} is not supported in this environment.`);
    return new Constructor(...args);
  }
  Object.defineProperty(NativeConstructor, "name", { value: name });
  Object.defineProperty(NativeConstructor, Symbol.hasInstance, {
    value(candidate) {
      const Constructor = native(name);
      return Constructor !== undefined && candidate instanceof Constructor;
    },
  });
  return NativeConstructor;
}

function isInstance(name) {
  return (candidate) => {
    const Constructor = native(name);
    return Constructor !== undefined && candidate instanceof Constructor;
  };
}

export const AudioContext = lazyConstructor("AudioContext");
export const OfflineAudioContext = lazyConstructor("OfflineAudioContext");
export const AudioWorkletNode = lazyConstructor("AudioWorkletNode");
export const AudioBuffer = lazyConstructor("AudioBuffer");
export const isAnyAudioContext = isInstance("AudioContext");
export const isAnyOfflineAudioContext = isInstance("OfflineAudioContext");
export const isAnyAudioNode = isInstance("AudioNode");
export const isAnyAudioParam = isInstance("AudioParam");
export const isSupported = () => Promise.resolve(native("AudioContext") !== undefined && native("OfflineAudioContext") !== undefined);
