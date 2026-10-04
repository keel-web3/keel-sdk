# `src/scene` reference

Entities, bounds, layered config with locks, and asset catalogues. Plain ES
modules, no dependencies. Units are world units (NOCTURNES: 1 unit = 10 cm
on a desk); y is up.

| Module | What |
| --- | --- |
| `kit.js` | shapes with bounds, booleans, rotations, parts (copied from NOCTURNES `kit.js` / `parts.js`, proven identical by `tests/scene-kit.test.mjs`; `part`/`mk`/`lathePart` are the engine's own) |
| `entity.js` | `createEntity`, transforms, world-space SDFs |
| `bounds.js` | AABB, bounding sphere, overlap, SDF distance, rays, contact |
| `config.js` | `layers([...])`: settings resolved engine -> project -> scene -> entity -> part, with locks |
| `registry.js` | realms of seeded builders; `makeAsset(seed, { realm, key })` |

## Concepts

**Shape** — `{ f(x, y, z, t, V) -> distance, b: [x0, y0, z0, x1, y1, z1] }`.
Booleans keep bounds, so a model always knows its box.

**Part** — a shape with a material: `{ id, name, mat, m, sdf, bounds, ... }`,
in the entity's LOCAL frame. `m` is the material's knob table (whatever your
project defines); any extra field (`accent`, `dynamic`, `light`, ...) rides along.

**Entity** — `{ id, transform: { pos, yaw, pitch, roll, scale }, parts, tags, components }`.
`world = pos + R(yaw, pitch, roll) * (scale * local)`, R = `rotation(yaw, pitch, roll)`
(yaw about y, pitch about x, roll about z). Scale is uniform, so world
distance = local distance x scale and SDFs stay SDFs.

**Layers and locks** — see `config.js`: a setting resolves to the most
specific layer that sets it, unless a less specific layer LOCKS it; a lock
beats every layer below it and every generator.

**Realm** — a weighted catalogue of builders `{ key, weight, role, build(S, ctx, info) }`.
Picks draw from a seeded stream exactly as NOCTURNES' `pickBuilder` does, so
a builder chosen by key leaves every later draw where it would have been.

---

## kit.js

| Export | Signature | Returns |
| --- | --- | --- |
| `box` | `(c, h, r = 0.01)` | shape; centre `c`, half-extents `h`, rounding `r` |
| `cyl` | `(c, r, h, axis = "y", round = 0)` | shape; half-length `h` along `axis` |
| `sphere` | `(c, r)` | shape |
| `ellipsoid` | `(c, [rx, ry, rz])` | shape |
| `capsule` | `(a, b, r)` | shape between points a and b |
| `torus` | `(c, R, r, axis = "y")` | shape; ring normal to `axis` |
| `U` | `(...shapes)` | union |
| `cut` | `(a, ...holes)` | subtraction (bounds of `a`) |
| `inter` | `(a, b)` | intersection (bounds of `a`) |
| `turned` | `(shape, m, pivot = [0,0,0])` | shape rotated by matrix `m` about `pivot` |
| `rotateBounds` | `(b, m, pivot = [0,0,0])` | AABB of a rotated box |
| `rotation` | `(yaw = 0, pitch = 0, roll = 0)` | 3x3 row-major matrix (local -> world), `Ry * Rx * Rz` |
| `mat3mul` | `(a, b)` | `a * b` |
| `placed` | `(sdf, pos, m)` | sdf placed at `pos` with rotation `m` |
| `rotatedSdf` | `(f, R)` | shape seen through rotation R |
| `rotateOnto` | `(a, b)` | rotation taking unit vector a onto b |
| `ball` | `(x, y, z, r)` | AABB of a sphere |
| `unionBounds` | `([b, ...])` | union AABB |
| `angleOf` | `(x, z)` | turns around y (`atan2(z, x) / TAU`) |
| `lowest` | `(parts)` | the parts' true lowest y (marched, then refined) |
| `part` | `(spec, materials = null)` | a part; `spec` needs `sdf` and `bounds`; `m` looked up in `materials[spec.mat]` |
| `mk` | `(shape, spec = {}, materials = null)` | a part from a shape |
| `lathePart` | `(spec, materials = null)` | a surface-of-revolution part from `spec.points` `[[r, y], ...]` (`round`, `y` offset) |

```js
import { U, box, cut, cyl, mk, sphere } from "./src/scene/kit.js";
const mug = cut(cyl([0, 0.4, 0], 0.3, 0.4), cyl([0, 0.5, 0], 0.25, 0.4));
const handle = box([0.36, 0.4, 0], [0.06, 0.18, 0.03]);
const parts = [mk(U(mug, handle), { name: "mug", mat: "ceramic" })];
```

## entity.js

| Export | Signature | Returns |
| --- | --- | --- |
| `createEntity` | `({ id, transform, parts, tags, components })` | entity (validates parts have `sdf` and 6-number `bounds`; tags sorted, unique) |
| `makeTransform` | `(t)` | `{ pos, yaw, pitch, roll, scale }` with defaults |
| `rotationOf` | `(transform)` | its 3x3 matrix |
| `withTransform` | `(entity, patch)` | a copy, transform fields merged |
| `withComponent` | `(entity, name, data)` | a copy with a component set (`undefined` removes) |
| `hasTag` / `byTag` | `(entity, tag)` / `(entities, ...tags)` | boolean / filtered list |
| `toWorld` / `toLocal` | `(entity, [x,y,z])` | point through the transform / back |
| `dirToWorld` / `dirToLocal` | `(entity, d)` | direction (rotation only) |
| `worldSdf` | `(entity, part)` | `(x, y, z, t = 0, V) -> world distance` for one part |
| `entitySdf` | `(entity)` | the union of all parts, world space |

```js
import { createEntity, toWorld } from "./src/scene/entity.js";
const cup = createEntity({ id: "cup-1", transform: { pos: [2, 0, -1], yaw: 0.6, scale: 1.5 }, parts, tags: ["prop"] });
toWorld(cup, [0, 0.8, 0]);   // the rim's centre in the world
```

## bounds.js

| Export | Signature | Returns |
| --- | --- | --- |
| `localAabbOf` | `(entity)` | union of part bounds, local |
| `transformAabb` | `(box, transform)` | a local box in world space (corners rotated, reboxed) |
| `partAabbOf` | `(entity, part)` | one part's world AABB |
| `aabbOf` | `(entity)` | world AABB (each part transformed, then unioned: tight under rotation) |
| `sphereOf` | `(entity)` | `{ center, radius }` around the world AABB |
| `overlaps` | `(a, b, margin = 0)` | AABBs (or entities) overlap or come within `margin`; touching counts |
| `containsPoint` | `(a, p)` | point in AABB (or entity's AABB) |
| `mergeAabb` | `(a, b)` | union box |
| `distance` | `(entity, point, t = 0)` | signed world distance via the parts' SDFs |
| `nearestPart` | `(entity, point, t = 0)` | `{ part, distance }` |
| `normalAt` | `(entity, point, t = 0, h = 0.0012)` | unit normal by central differences |
| `rayAabb` | `(o, d, box)` | `[tNear, tFar]` (t >= 0) or `null` (NOCTURNES' `rayBox` with array args) |
| `raycast` | `(entity, o, d, { far, t, eps, steps })` | `{ t, point }` first hit (AABB, then sphere-traced), or `null`; `d` unit |
| `touching` | `(a, b, { margin = 0, n = 8, t = 0 })` | surfaces within `margin`: AABB broad phase, then an `n`^3 sample grid (resolution: half a cell) |

AABBs and spheres are for culling and the broad phase; `distance`, `raycast`
and `touching` ask the SDFs for what is really there.

```js
import { aabbOf, overlaps, raycast, distance } from "./src/scene/bounds.js";
if (overlaps(player, cup, 0.05)) { /* narrow phase */ }
const hit = raycast(cup, [2, 5, -1], [0, -1, 0]);        // { t, point } on top of it
distance(cup, [2, 1, -1]);                                // < 0 inside
```

## config.js

| Export | Signature | Returns |
| --- | --- | --- |
| `layers` | `([layer, ...])` | a config; least specific first; each layer `{ name, values }` or a bare values object (named engine, project, scene, entity, part by position) |
| `fromJSON` | `(json)` | a config from `config.toJSON()` (object or string) |
| `isEntry` | `(v)` | is `v` an entry `{ value, lock?, note? }` (no other keys) |
| `ConfigLockError` | | thrown by strict writes; `.refusal` holds the report |
| `DEFAULT_LAYER_NAMES` | | `["engine", "project", "scene", "entity", "part"]` |

Values are flat maps of dotted keys. A value is plain JSON or an entry:
`{ "dither.screen": { value: "bayer4", lock: true, note: "house style" } }`.

**Resolution of a key:** walk the layers least specific first; the first layer
that locks the key wins (layers below it are *shadowed*); otherwise the most
specific layer that sets it wins.

Config methods:

| Method | Returns |
| --- | --- |
| `get(key, fallback)` | resolved value, or `fallback` |
| `has(key)` / `locked(key)` | booleans |
| `propose(key, proposed)` | what a generator may use: the locked value if locked, else `proposed` (generators sit below every layer) |
| `explain(key)` | `{ key, value, layer, locked, lockedAt, chain: [{ layer, value, locked, note?, shadowed }] }` |
| `set(layer, key, value, { lock, note, force, strict })` | `{ ok: true }`, or a refusal `{ ok: false, key, layer, lockedAt, value, lockedValue }` when a lock at that layer or above holds (`force` lets the lock's own layer change its value, staying locked; `strict` throws) |
| `lock(layer, key, value?)` | lock at that layer (value omitted: the value resolved there); refused under a higher lock |
| `unlock(layer, key)` | remove that layer's lock (value kept) |
| `unset(layer, key, opts)` | remove the key from a layer (refused like `set`) |
| `keys()` / `resolved()` / `section(prefix)` | sorted keys / all resolved / `{ sub: value }` under `prefix.` |
| `extend(layer)` | a config with one more, more specific layer (parent layers shared) |
| `refusals` / `names` | refused writes so far / layer names |
| `toJSON()` | `{ layers: [{ name, values }] }`, keys sorted |

```js
import { layers } from "./src/scene/config.js";
const cfg = layers([
  { name: "engine", values: { "dither.screen": "bayer4", "palette.scheme": "Nocturne" } },
  { name: "project", values: { "palette.scheme": { value: "Monochrome", lock: true } } },
  { name: "scene", values: { "dither.screen": "halftone" } },
  { name: "entity", values: {} },
  { name: "part", values: { "dither.screen": "bayer2" } },
]);
cfg.get("dither.screen");                         // "bayer2"   (most specific)
cfg.get("palette.scheme");                        // "Monochrome" (locked at project)
cfg.set("scene", "palette.scheme", "Prism");      // { ok: false, lockedAt: "project", ... }
cfg.propose("palette.scheme", rolled);            // "Monochrome", whatever the seed rolled
cfg.explain("dither.screen").layer;               // "part"
const glass = cfg.extend({ name: "glass", values: { "dither.screen": "ign" } });
```

Lock typical things: a project's palette scheme, one object's dither screen,
a particle system off (`{ "particles.enabled": { value: false, lock: true } }`).
Generators should route every rolled choice through `propose`, and draw the
roll either way so the seed's other draws do not move.

## registry.js

| Export | Signature | Returns |
| --- | --- | --- |
| `createRegistry` | `()` | `{ defineRealm, realm, realms, pickRealm, makeAsset }` (independent state) |
| `defineRealm` | `(name, { weight = 1 })` | a realm in the default registry (returns the existing one if defined) |
| `makeAsset` | `(seed, { realm, key, role, ctx, state })` | the default registry's `makeAsset` |
| `defaultRegistry` | | the default registry |
| `roleMatches` | `(entryRole, wanted)` | role filter ("any"/null asks all; "both"/"any" serve all; arrays list roles) |
| `ASSET_SLOTS` | | `{ REALM: 0, BUILD: 1 }` seed slots makeAsset reads |

Realm methods: `add({ key, weight = 1, role = "both", build, keyOnly = false })`
(chainable; `keyOnly` builders are only built by key, never drawn),
`pick(S, role = "any", { key })` -> `(S, ctx, info) => asset` with `asset.key`
stamped (the weighted draw always happens first), `pool(role)`, `entries()`,
`keys()`, `get(key)`.

`makeAsset(seed, opts)`: draws a realm from slot REALM (always; `opts.realm`
then overrides), draws the builder from the BUILD stream (`opts.key` forces
one after the draw), calls `build(S, ctx, { seed, role, state, realm, roll })`
and stamps `key`, `realm` and `seed` on the result.

```js
import { createRegistry } from "./src/scene/registry.js";
const reg = createRegistry();
reg.defineRealm("Relic", { weight: 3 })
  .add({ key: "lamp", weight: 3, role: "hero", build: (S) => ({ parts: makeLamp(S) }) })
  .add({ key: "coin", weight: 2, role: "small", build: (S) => ({ parts: makeCoin(S) }) });
const a = reg.makeAsset(seed);                               // { key: "lamp", realm: "Relic", seed, parts }
const b = reg.makeAsset(seed, { realm: "Relic", key: "coin" });
```
