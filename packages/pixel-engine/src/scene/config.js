// Layered settings with locks.
//
// Settings resolve through an ordered list of LAYERS, least specific first:
//
//   engine -> project -> scene -> entity -> part
//
// Each layer is a flat map of dotted keys ("dither.screen", "palette.scheme",
// "particles.enabled"). A value is either plain JSON, or an ENTRY
// { value, lock?, note? }. Resolution of a key:
//
//   1. walk the layers from least to most specific;
//   2. the first layer that LOCKS the key wins, and nothing below it counts;
//   3. otherwise the most specific layer that sets the key wins.
//
// A lock is a promise to everything more specific: lower layers cannot
// override it (their values are kept but shadowed; `set` on them is refused)
// and neither can generators (`propose` returns the locked value, not theirs).
// Everything is plain data, so a config round-trips through JSON and resolves
// the same everywhere.

export const DEFAULT_LAYER_NAMES = ["engine", "project", "scene", "entity", "part"];

const ENTRY_KEYS = new Set(["value", "lock", "note"]);

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** Is `v` an entry ({ value, lock?, note? }) rather than a plain value? */
export function isEntry(v) {
  return isPlain(v) && Object.hasOwn(v, "value") && Object.keys(v).every((k) => ENTRY_KEYS.has(k));
}

const entryOf = (raw) => (isEntry(raw) ? { value: raw.value, lock: Boolean(raw.lock), note: raw.note } : { value: raw, lock: false, note: undefined });

function checkJson(key, value) {
  const bad = (v) => v === undefined || typeof v === "function" || typeof v === "symbol" || typeof v === "bigint" || (typeof v === "number" && !Number.isFinite(v));
  const walk = (v) => {
    if (bad(v)) throw new TypeError(`Config ${key}: values must be JSON (got ${typeof v}).`);
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
}

/** Thrown by set(..., { strict: true }) when a lock refuses the write. */
export class ConfigLockError extends Error {
  constructor(refusal) {
    super(`${refusal.key} is locked at "${refusal.lockedAt}"; "${refusal.layer}" cannot override it.`);
    this.name = "ConfigLockError";
    this.refusal = refusal;
  }
}

function normaliseLayers(list) {
  const out = list.map((l, i) => {
    const named = isPlain(l) && typeof l.name === "string" && isPlain(l.values) && Object.keys(l).every((k) => k === "name" || k === "values");
    const name = named ? l.name : DEFAULT_LAYER_NAMES[i] ?? `layer${i}`;
    const values = named ? l.values : l ?? {};
    if (!isPlain(values)) throw new TypeError(`Layer ${name}: values must be a plain object.`);
    for (const [k, v] of Object.entries(values)) checkJson(k, isEntry(v) ? v.value : v);
    return { name, values: { ...values } };
  });
  const seen = new Set();
  for (const l of out) {
    if (seen.has(l.name)) throw new Error(`Two layers are named ${l.name}.`);
    seen.add(l.name);
  }
  return out;
}

/**
 * layers(list) -> config. `list` is least specific first; each item is
 * { name, values } or a bare values object (named engine, project, scene,
 * entity, part by position).
 */
export function layers(list = []) {
  return makeConfig(normaliseLayers(list), []);
}

/** Rebuild a config from config.toJSON(). */
export function fromJSON(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  return makeConfig(normaliseLayers(data.layers ?? []), []);
}

function makeConfig(list, refusals) {
  const indexOf = (name) => {
    const i = list.findIndex((l) => l.name === name);
    if (i < 0) throw new RangeError(`No layer named ${name}.`);
    return i;
  };

  /** Where `key` is locked at or above layer index `upto` (least specific first), or -1. */
  const lockAbove = (key, upto) => {
    for (let i = 0; i <= upto && i < list.length; i += 1) {
      const raw = list[i].values[key];
      if (raw !== undefined && entryOf(raw).lock) return i;
    }
    return -1;
  };

  function resolve(key) {
    let winner = -1;
    for (let i = 0; i < list.length; i += 1) {
      const raw = list[i].values[key];
      if (raw === undefined) continue;
      winner = i;
      if (entryOf(raw).lock) return { at: i, locked: true };
    }
    return { at: winner, locked: false };
  }

  const cfg = {
    /** Layer names, least specific first. */
    get names() { return list.map((l) => l.name); },
    /** Every refused write so far: [{ key, layer, lockedAt, value, lockedValue }]. */
    get refusals() { return refusals.slice(); },

    /** The resolved value of `key`, or `fallback` when no layer sets it. */
    get(key, fallback = undefined) {
      const r = resolve(key);
      return r.at < 0 ? fallback : entryOf(list[r.at].values[key]).value;
    },

    has(key) { return resolve(key).at >= 0; },

    /** Is `key` locked by any layer? */
    locked(key) { return resolve(key).locked; },

    /**
     * What a GENERATOR gets to use: its own `proposed` value, unless a layer
     * locks the key -- then the locked value. (Generators sit below every
     * layer: they override unlocked settings, never locked ones.)
     */
    propose(key, proposed) {
      const r = resolve(key);
      return r.locked ? entryOf(list[r.at].values[key]).value : proposed;
    },

    /**
     * Why `key` resolves as it does: { key, value, layer, locked, lockedAt,
     * chain: [{ layer, value, locked, shadowed }] } -- `chain` lists every
     * layer that sets it, least specific first; `shadowed` marks the ones a
     * lock above them overrides. `layer` is null when nothing sets it.
     */
    explain(key) {
      const r = resolve(key);
      const chain = [];
      list.forEach((l, i) => {
        const raw = l.values[key];
        if (raw === undefined) return;
        const e = entryOf(raw);
        chain.push({ layer: l.name, value: e.value, locked: e.lock, ...(e.note ? { note: e.note } : {}), shadowed: r.locked && i > r.at });
      });
      return {
        key,
        value: r.at < 0 ? undefined : entryOf(list[r.at].values[key]).value,
        layer: r.at < 0 ? null : list[r.at].name,
        locked: r.locked,
        lockedAt: r.locked ? list[r.at].name : null,
        chain,
      };
    },

    /**
     * Write `key` at a layer. Returns { ok: true } or a refusal
     * { ok: false, key, layer, lockedAt, value, lockedValue } when a lock at
     * that layer or above forbids it (also recorded in `refusals`).
     *   opts.lock    lock the key at this layer too
     *   opts.note    a note kept on the entry
     *   opts.force   the lock is at THIS layer: its owner may replace the value
     *   opts.strict  throw ConfigLockError instead of returning the refusal
     */
    set(layerName, key, value, opts = {}) {
      checkJson(key, value);
      const at = indexOf(layerName);
      const lockAt = lockAbove(key, at);
      if (lockAt >= 0 && !(lockAt === at && opts.force)) {
        const refusal = { ok: false, key, layer: layerName, lockedAt: list[lockAt].name, value, lockedValue: entryOf(list[lockAt].values[key]).value };
        refusals.push(refusal);
        if (opts.strict) throw new ConfigLockError(refusal);
        return refusal;
      }
      const keepLock = lockAt === at; // (forced by its owner: stays locked)
      const lock = Boolean(opts.lock) || keepLock;
      list[at].values[key] = lock || opts.note ? { value, ...(lock ? { lock: true } : {}), ...(opts.note ? { note: opts.note } : {}) } : value;
      return { ok: true, key, layer: layerName };
    },

    /** Lock `key` at a layer, with `value` or (omitted) the value it resolves to there. Refused like set. */
    lock(layerName, key, value = undefined, opts = {}) {
      const at = indexOf(layerName);
      let v = value;
      if (v === undefined) {
        const sub = makeConfig(list.slice(0, at + 1), []);
        v = sub.get(key);
        if (v === undefined) throw new RangeError(`Nothing to lock: ${key} is unset at ${layerName}.`);
      }
      const lockAt = lockAbove(key, at - 1);
      if (lockAt >= 0) return cfg.set(layerName, key, v, { ...opts, lock: true });
      return cfg.set(layerName, key, v, { ...opts, lock: true, force: true });
    },

    /** Remove this layer's lock on `key` (its value stays). Locks above still hold. */
    unlock(layerName, key) {
      const l = list[indexOf(layerName)];
      const raw = l.values[key];
      if (raw === undefined || !entryOf(raw).lock) return { ok: true, key, layer: layerName, changed: false };
      const e = entryOf(raw);
      l.values[key] = e.note ? { value: e.value, note: e.note } : e.value;
      return { ok: true, key, layer: layerName, changed: true };
    },

    /** Remove `key` from a layer. Refused like set when a lock above holds (its own lock: only with force). */
    unset(layerName, key, opts = {}) {
      const at = indexOf(layerName);
      const lockAt = lockAbove(key, at);
      if (lockAt >= 0 && !(lockAt === at && opts.force)) {
        const refusal = { ok: false, key, layer: layerName, lockedAt: list[lockAt].name, value: undefined, lockedValue: entryOf(list[lockAt].values[key]).value };
        refusals.push(refusal);
        if (opts.strict) throw new ConfigLockError(refusal);
        return refusal;
      }
      delete list[at].values[key];
      return { ok: true, key, layer: layerName };
    },

    /** Every key any layer sets, sorted. */
    keys() {
      const all = new Set();
      for (const l of list) for (const k of Object.keys(l.values)) all.add(k);
      return [...all].sort();
    },

    /** Every key resolved: { key: value }, keys sorted. */
    resolved() {
      const out = {};
      for (const k of cfg.keys()) out[k] = cfg.get(k);
      return out;
    },

    /** The keys under `prefix.` resolved, prefix stripped: section("dither") -> { screen, steps }. */
    section(prefix) {
      const out = {};
      const p = `${prefix}.`;
      for (const k of cfg.keys()) if (k.startsWith(p)) out[k.slice(p.length)] = cfg.get(k);
      return out;
    },

    /**
     * A config with one more, more specific layer (an entity's or a part's
     * own settings). The parent's layers are shared, not copied: a later
     * write to them shows through.
     */
    extend(layer) {
      const [l] = normaliseLayers([layer]);
      const named = isPlain(layer) && typeof layer.name === "string" ? l : { ...l, name: DEFAULT_LAYER_NAMES[list.length] ?? `layer${list.length}` };
      if (list.some((x) => x.name === named.name)) throw new Error(`Two layers are named ${named.name}.`);
      return makeConfig([...list, named], refusals);
    },

    /** Plain data: { layers: [{ name, values }] } (keys sorted, so equal configs serialise equal). */
    toJSON() {
      return {
        layers: list.map((l) => ({ name: l.name, values: Object.fromEntries(Object.keys(l.values).sort().map((k) => [k, l.values[k]])) })),
      };
    },
  };
  return cfg;
}
