// Asset catalogues: realms of seeded builders, the NOCTURNES way.
//
// A REALM is a weighted list of builders ({ key, weight, role, build }).
// `realm.pick(S, role)` draws one from the stream S -- exactly the shape of
// NOCTURNES' kit.js pickBuilder: the weighted draw ALWAYS happens (so a
// builder chosen by key leaves every later roll where it would be), roles
// filter the pool, and whatever the builder makes is stamped with its key.
// `makeAsset(seed, { realm, key })` mirrors NOCTURNES' makeObject: fixed seed
// slots for the realm draw and the build stream, so adding a realm or a
// builder never reshuffles the draws an existing seed already makes.

import { createRoll, stream } from "../core/rng.js";

/** Seed slots makeAsset reads (NOCTURNES' OSLOT.REALM and OSLOT.BUILD). */
export const ASSET_SLOTS = { REALM: 0, BUILD: 1 };

/**
 * Does an entry's role serve the role asked for? "any" (or null) asks for
 * everything; an entry with role "both" or "any" serves every ask; an array
 * serves each role it lists. (NOCTURNES: "hero" takes hero|both, "small"
 * takes small|both.)
 */
export function roleMatches(entryRole, wanted) {
  if (wanted === null || wanted === undefined || wanted === "any") return true;
  if (entryRole === "both" || entryRole === "any" || entryRole === undefined) return true;
  return Array.isArray(entryRole) ? entryRole.includes(wanted) : entryRole === wanted;
}

function makeRealm(name, weight) {
  const entries = [];
  const realm = {
    name,
    weight,
    /**
     * Add a builder: { key, weight = 1, role = "both", build(S, ctx, info), keyOnly }.
     * `keyOnly` builders are never drawn at random, only asked for by key
     * (NOCTURNES' peripherals: a keyboard is plugged into something).
     */
    add({ key, weight: w = 1, role = "both", build, keyOnly = false, ...meta }) {
      if (typeof key !== "string" || !key) throw new TypeError("A builder needs a string key.");
      if (typeof build !== "function") throw new TypeError(`Builder ${key} needs build(S, ctx).`);
      if (!(w > 0)) throw new RangeError(`Builder ${key} needs a positive weight.`);
      if (entries.some((e) => e.key === key)) throw new Error(`${name} already has ${key}.`);
      entries.push({ key, weight: w, role, build, keyOnly, meta });
      return realm;
    },
    /** The builders, in the order added. */
    entries: () => entries.slice(),
    keys: () => entries.map((e) => e.key),
    get: (key) => entries.find((e) => e.key === key) ?? null,
    /** The pool a role draws from (in order added). */
    pool: (role = "any") => entries.filter((e) => !e.keyOnly && roleMatches(e.role, role)),
    /**
     * Draw a builder from stream S for `role`; returns (S, ctx, info) => asset
     * with asset.key stamped. `opts.key` forces a builder by key -- the draw
     * still happens first, so the stream advances the same either way.
     */
    pick(S, role = "any", opts = {}) {
      const pool = realm.pool(role);
      let chosen = null;
      if (pool.length) chosen = S.weighted(pool.map((e) => [e, e.weight]));
      if (opts.key) chosen = realm.get(opts.key) ?? chosen;
      if (!chosen) throw new RangeError(`${name} has nothing for role ${role}.`);
      const { key, build } = chosen;
      const fn = (...a) => {
        const obj = build(...a);
        if (obj && typeof obj === "object" && obj.key === undefined) obj.key = key;
        return obj;
      };
      fn.key = key;
      return fn;
    },
  };
  return realm;
}

/** A registry: a set of realms (catalogues). Independent registries never share state. */
export function createRegistry() {
  const realms = [];
  const registry = {
    /** Define (or fetch, when it exists) a realm. `weight` is its share when makeAsset draws a realm. */
    defineRealm(name, { weight = 1 } = {}) {
      const have = realms.find((r) => r.name === name);
      if (have) return have;
      if (!(weight > 0)) throw new RangeError(`Realm ${name} needs a positive weight.`);
      const r = makeRealm(name, weight);
      realms.push(r);
      return r;
    },
    realm: (name) => realms.find((r) => r.name === name) ?? null,
    realms: () => realms.slice(),
    /** Draw a realm from stream S by weight (in the order defined). */
    pickRealm(S) {
      if (!realms.length) throw new RangeError("The registry has no realms.");
      return S.weighted(realms.map((r) => [r, r.weight]));
    },
    /**
     * makeAsset(seed, opts) -> the built asset (or null if its builder made none).
     *   realm   realm name (drawn from the seed's REALM slot when absent;
     *           the draw happens either way, as in NOCTURNES)
     *   key     builder key (forced; the builder draw still happens)
     *   role    "any" | "hero" | "small" | your own
     *   ctx     passed to build(S, ctx, info)
     *   state   passed in info (the state it is built in: a turned cube, an open lid)
     * The asset is stamped with key, realm and seed. info = { seed, role, state, realm, roll }.
     */
    makeAsset(seed, { realm: realmName = null, key = null, role = "any", ctx = {}, state = null } = {}) {
      const roll = createRoll(seed);
      const rr = stream(roll, ASSET_SLOTS.REALM);
      let realm = registry.pickRealm(rr);
      if (realmName) {
        realm = registry.realm(realmName);
        if (!realm) throw new RangeError(`No realm named ${realmName}.`);
      }
      const S = stream(roll, ASSET_SLOTS.BUILD);
      const build = realm.pick(S, role, { key });
      const obj = build(S, ctx, { seed: roll.seed, role, state, realm: realm.name, roll });
      if (!obj || typeof obj !== "object") return obj ?? null;
      obj.realm = realm.name;
      if (obj.seed === undefined) obj.seed = roll.seed;
      return obj;
    },
  };
  return registry;
}

// A default registry for projects that want one global catalogue.
const DEFAULT = createRegistry();
export const defineRealm = (name, opts) => DEFAULT.defineRealm(name, opts);
export const makeAsset = (seed, opts) => DEFAULT.makeAsset(seed, opts);
export const defaultRegistry = DEFAULT;
