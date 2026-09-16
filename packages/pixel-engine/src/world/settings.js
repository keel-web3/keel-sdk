// A world's settings: the config layers of src/scene/config.js, laid out as
// SCOPES so anything can be set -- or LOCKED -- for the whole engine, a
// project, a scene, the things with a tag, one thing by id, or at runtime.
//
//   global key:     engine -> project -> scene -> seed -> runtime
//   a thing's key:  engine -> project -> scene -> seed -> seed:<id> -> tag:<t>... -> id:<id> -> runtime
//
// Resolution is config.js's, unchanged: walk least specific first; the first
// scope that LOCKS a key wins and everything after it is shadowed; otherwise
// the most specific scope that sets it wins. So a lock at the project beats a
// scene, a tag, an id and the runtime; a lock on "tag:bench" beats one bench's
// own setting and the runtime, for benches only.
//
// The two SEED scopes are where generation writes what the seed chose ("seed"
// for world-wide choices, "seed:<id>" for one thing's). They sit under every
// scope that names things, so a tag's or an id's setting beats a roll -- and a
// lock anywhere beats it too: the generator is handed the locked value
// (propose), and still draws its roll, so nothing after it moves.
//
// Everything stored is plain JSON (toJSON / load round-trip it), so a
// world's settings travel in URLs, snapshots and files.

import { isEntry, layers } from "../scene/config.js";

export const GLOBAL_SCOPES = ["engine", "project", "scene", "seed", "runtime"];
const THING_SCOPE = /^(tag|id|seed):(.+)$/;

/** Is `name` a scope a value can live in? */
export function isScope(name) {
  return GLOBAL_SCOPES.includes(name) || THING_SCOPE.test(name);
}

// (A thing is an id, or anything with { id, tags }.)
const idOf = (thing) => (thing == null ? null : typeof thing === "string" ? thing : thing.id ?? null);

/**
 * createSettings({ engine, project, scene, runtime, tagsOf }) -> settings
 *   engine/project/scene/runtime   flat maps of dotted keys ({ key: value | { value, lock, note } })
 *   scopes                         { "tag:bench": {...}, "id:bench-1": {...} }: thing scopes to start with
 *   tagsOf(id) -> [tag]            how to find a thing's tags when only its id is given
 */
export function createSettings({ engine = {}, project = {}, scene = {}, runtime = {}, scopes = {}, tagsOf = () => [] } = {}) {
  const store = new Map(); // scope name -> { key: raw }
  for (const [name, values] of [["engine", engine], ["project", project], ["scene", scene], ["runtime", runtime]]) store.set(name, { ...values });
  store.set("seed", {});
  for (const [name, values] of Object.entries(scopes)) {
    if (!THING_SCOPE.test(name)) throw new RangeError(`"${name}" is not a thing scope (tag:<tag>, id:<id>).`);
    store.set(name, { ...values });
  }
  const refusals = [];
  let version = 0;
  let lookupTags = tagsOf;
  const cache = new Map(); // chain signature -> config

  const tagsFor = (thing) => {
    if (thing == null) return [];
    if (typeof thing === "object" && Array.isArray(thing.tags)) return [...new Set(thing.tags)].sort();
    return [...new Set(lookupTags(idOf(thing)) ?? [])].sort();
  };

  // The scope names a key is resolved through, least specific first.
  function chainOf(thing) {
    const id = idOf(thing);
    if (id === null) return GLOBAL_SCOPES;
    return ["engine", "project", "scene", "seed", `seed:${id}`, ...tagsFor(thing).map((t) => `tag:${t}`), `id:${id}`, "runtime"];
  }
  // The chain a WRITE into `scope` is checked against: every scope up to it (and itself).
  function chainUpTo(scope, thing) {
    if (GLOBAL_SCOPES.includes(scope)) return GLOBAL_SCOPES.slice(0, GLOBAL_SCOPES.indexOf(scope) + 1);
    const [, kind, rest] = scope.match(THING_SCOPE);
    if (kind === "tag") return ["engine", "project", "scene", "seed", scope];
    const full = chainOf(thing ?? rest);
    return full.slice(0, full.indexOf(scope) + 1);
  }

  function configOf(chain) {
    const sig = chain.join("");
    let cfg = cache.get(sig);
    if (!cfg) {
      cfg = layers(chain.map((name) => ({ name, values: store.get(name) ?? {} })));
      cache.set(sig, cfg);
    }
    return cfg;
  }
  const touched = () => { version += 1; cache.clear(); };

  function write(scope, key, fn, thing) {
    if (!isScope(scope)) throw new RangeError(`No scope "${scope}" (scopes: ${GLOBAL_SCOPES.join(", ")}, tag:<tag>, id:<id>, seed:<id>).`);
    const chain = chainUpTo(scope, thing);
    const cfg = layers(chain.map((name) => ({ name, values: store.get(name) ?? {} })));
    const r = fn(cfg);
    if (r.ok === false) { refusals.push(r); return r; }
    const values = cfg.toJSON().layers.find((l) => l.name === scope).values;
    if (Object.keys(values).length) store.set(scope, values);
    else if (!GLOBAL_SCOPES.includes(scope)) store.delete(scope);
    else store.set(scope, {});
    touched();
    return r;
  }

  const s = {
    /** Goes up by one on every change (systems cache on it). */
    get version() { return version; },
    /** Every write a lock refused: [{ key, layer, lockedAt, value, lockedValue }]. */
    get refusals() { return refusals.slice(); },
    /** The scopes that hold anything, in no particular order. */
    scopes() { return [...store.keys()]; },
    /** Swap how ids are looked up for their tags (the world does this). */
    useTags(fn) { lookupTags = fn; cache.clear(); },

    /** The resolved value of `key` (for a thing: through its tags and id), or `fallback`. */
    get(key, thing = null, fallback = undefined) { return configOf(chainOf(thing)).get(key, fallback); },
    has(key, thing = null) { return configOf(chainOf(thing)).has(key); },
    locked(key, thing = null) { return configOf(chainOf(thing)).locked(key); },
    /** Every key under `prefix.` resolved for a thing, prefix stripped. */
    section(prefix, thing = null) { return configOf(chainOf(thing)).section(prefix); },
    /** The resolved map of every key, for a thing or the world. */
    resolved(thing = null) { return configOf(chainOf(thing)).resolved(); },

    /**
     * Why `key` resolves as it does, for a thing or the world:
     * { key, value, layer, locked, lockedAt, chain: [{ layer, value, locked, note?, shadowed }] }
     * -- `layer` names the scope that set the winning value ("project",
     * "tag:bench", "id:bench-1", "seed:cat-2" ...); `lockedAt` the one that locked it.
     */
    explain(key, thing = null) { return configOf(chainOf(thing)).explain(key); },

    /**
     * Write a value into a scope. { ok: true } or a refusal { ok: false, key,
     * layer, lockedAt, value, lockedValue } when a lock at or above that scope
     * holds (recorded in `refusals`). opts: { lock, note, force } as config.js set.
     * `thing` tells an id scope its tags, when the thing isn't registered yet.
     */
    set(scope, key, value, opts = {}, thing = null) { return write(scope, key, (cfg) => cfg.set(scope, key, value, opts), thing); },
    /** Lock `key` at a scope (with `value`, or the value it resolves to there). Refused under a higher lock. */
    lock(scope, key, value = undefined, opts = {}, thing = null) { return write(scope, key, (cfg) => cfg.lock(scope, key, value, opts), thing); },
    /** Remove a scope's own lock (its value stays). */
    unlock(scope, key) { return write(scope, key, (cfg) => cfg.unlock(scope, key)); },
    /** Remove a key from a scope (refused under a higher lock; the scope's own lock needs force). */
    unset(scope, key, opts = {}) { return write(scope, key, (cfg) => cfg.unset(scope, key, opts)); },

    /**
     * What a generator gets to use for `key` (on `thing`, or world-wide): its
     * `rolled` value is recorded in the seed scope ("seed" or "seed:<id>")
     * unless a lock shadows it, and the value the key then RESOLVES to comes
     * back -- a lock's, a tag's or id's explicit setting, or the roll itself.
     */
    propose(key, rolled, thing = null) {
      const id = idOf(thing);
      const scope = id === null ? "seed" : `seed:${id}`;
      const cfg = configOf(chainOf(thing));
      const ex = cfg.explain(key);
      // (Locked above the seed scope: the roll isn't written, so explain still names the lock.)
      const seedAt = chainOf(thing).indexOf(scope);
      const lockAt = ex.locked ? chainOf(thing).indexOf(ex.lockedAt) : -1;
      if (!(ex.locked && lockAt <= seedAt)) {
        const values = { ...(store.get(scope) ?? {}), [key]: rolled };
        store.set(scope, values);
        touched();
      }
      return s.get(key, thing);
    },

    /** Forget everything the seed chose (before generating again). */
    clearSeed() {
      for (const name of [...store.keys()]) if (name === "seed" || name.startsWith("seed:")) store.delete(name);
      store.set("seed", {});
      touched();
    },

    /** Plain data: { scopes: { name: { key: raw } } }, names and keys sorted. */
    toJSON() {
      const out = {};
      for (const name of [...store.keys()].sort()) {
        const v = store.get(name);
        out[name] = Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]));
      }
      return { scopes: out };
    },
    /** Replace everything with settings.toJSON() output. */
    load(json) {
      const data = typeof json === "string" ? JSON.parse(json) : json;
      store.clear();
      for (const name of GLOBAL_SCOPES) store.set(name, {});
      for (const [name, values] of Object.entries(data.scopes ?? {})) {
        if (!isScope(name)) throw new RangeError(`No scope "${name}".`);
        store.set(name, { ...values });
      }
      touched();
      return s;
    },
    /** The raw values one scope holds (a copy). */
    scope(name) { return { ...(store.get(name) ?? {}) }; },
  };
  return s;
}

/**
 * Parse locks written for a URL or a panel: "scope/key=value;scope/key=value".
 *   "scene/render.palette=dusk;tag:animal/species=cat;id:bench-1/material=oak"
 * Values are JSON when they parse ("4", "true", "[\"fog\"]"), else strings.
 * A "~" before the value sets without locking ("scene/render.palette=~dusk").
 */
export function parseLocks(text) {
  const out = [];
  for (const item of String(text ?? "").split(";").map((x) => x.trim()).filter(Boolean)) {
    const m = item.match(/^([^/]+)\/([^=]+)=(.*)$/);
    if (!m) throw new SyntaxError(`A lock is scope/key=value (got "${item}").`);
    let raw = m[3];
    const lock = !raw.startsWith("~");
    if (!lock) raw = raw.slice(1);
    let value;
    try { value = JSON.parse(raw); } catch { value = raw; }
    out.push({ scope: m[1], key: m[2], value, lock });
  }
  return out;
}

/** The inverse of parseLocks. */
export function formatLocks(list) {
  return list.map(({ scope, key, value, lock = true }) => `${scope}/${key}=${lock ? "" : "~"}${typeof value === "string" ? value : JSON.stringify(value)}`).join(";");
}

export { isEntry };
