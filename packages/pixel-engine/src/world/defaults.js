// The engine's scope: every setting the world runtime reads, with its default.
// Projects, scenes, tags, ids and the runtime write over these (or lock them);
// "auto" means "the target rules decide" (src/world/rules.js).
//
// Keys are dotted and grouped by what they configure:
//   render.*            FILTERS: the picture's style
//   system.<name>.*     SYSTEMS: on/off and their parameters
//   (bare keys)         PER THING: read through a thing's tags and id
//   species, pins.*     ITEMS: what generation must use (see docs/WORLD.md)

export const ENGINE_DEFAULTS = Object.freeze({
  // Filters.
  "render.palette": "default", //   a palette by name (createWorld({ palettes }))
  "render.dither.screen": "auto", // 0 (none), 2, 4, 8, or "auto" (target rules)
  "render.dither.strength": "auto", // 0..1
  "render.outline": "auto", //       0 / 1
  "render.rampLength": "auto", //    entries per ramp, "full", or "auto" (palette.js rampBudget)
  "render.pattern": "auto", //       checker strength (CPU renderers; the GPU shader has its own)
  "render.fx": [], //                frame passes by name, in order (world.fx(name, pass))
  "render.sun": [0.35, 0.85, 0.25],
  "render.waterY": 0,
  "render.fog": [25, 110], //        near, far

  // Systems. (system.<name>.enabled exists for every system; unset means on.)
  "system.physics.gravity": 24,
  "system.physics.waterY": 0,
  "system.camera.mode": "auto", //   "auto" (orbit when a player drives, chase otherwise), orbit, chase, first, frame, rail, fixed
  "system.camera.fov": "auto",
  "system.camera.arm": "auto", //    scale on the rigs' distances
  "system.camera.cycle": 4, //       seconds per subject in frame mode
  "system.camera.frameTag": null, // frame mode shows things with this tag (null: every entity)
  "system.particles.max": 600,
  "system.particles.size": "auto",

  // Per thing (read through its tags and id).
  show: true, //      drawn at all
  collide: true, //   its colliders count (objects) / its body collides (entities)
  static: false, //   an entity that never moves (no control, no physics; it still breathes)
  material: null, //  an object's main material, by name (null: the definition's own)
  // mat.<name>: a material name the parts' `name` stands for (mat.wood = "oak")
});
