import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDungeon, createWorldStream, encodeRecipe, generateDungeon, hashLayers, runPipeline, scatterIn } from "@keel/game-engine/worldgen";
import { createCatalogue } from "../src/plants.ts";
import { dungeonRecipe, mixedRecipe, overworldRecipe } from "../src/recipes.ts";

test("the demo's recipes: small, deterministic, each world builds", () => {
  for (const r of [overworldRecipe("t"), dungeonRecipe("t", "wfc"), mixedRecipe("t")]) assert.ok(encodeRecipe(r).length < 500);
  const a = runPipeline(mixedRecipe("t")), b = runPipeline(mixedRecipe("t"));
  assert.equal(hashLayers(a, 0, 0, a.w, a.d), hashLayers(b, 0, 0, b.w, b.d));
  assert.ok(a.regions.some((r) => r.id === "town") && a.regions.some((r) => r.id === "crypt"));
  const s = createWorldStream(overworldRecipe("t"));
  const c = s.chunk(3, -2);
  assert.equal(c.layers.w, 36);
  const plants = scatterIn(s.block(96 - 4, -64 - 4, 40, 40), [192, -128, 256, -64], { seed: "t", table: s.table, types: s.types });
  assert.ok(Array.isArray(plants));
});

test("every dungeon generator the demo toggles makes a fair floor", () => {
  for (const algorithm of ["rooms", "bsp", "cave", "drunkard", "wfc"] as const) {
    const d = generateDungeon(`demo-${algorithm}`, 84, 60, { algorithm, rooms: 12 });
    assert.ok(checkDungeon(d).pass, algorithm);
  }
});

test("the sprite catalogue builds the packs' plants and buildings as shapes (sorted by height)", () => {
  const cat = createCatalogue();
  const oak = cat.species("packs/foliage", "oak");
  assert.ok(oak && oak.shapes.length >= 2);
  for (let n = 1; n < oak.shapes.length; n += 1) assert.ok(oak.shapes[n]!.height >= oak.shapes[n - 1]!.height);
  assert.ok(cat.species("packs/buildings", "cottage"));
  assert.equal(cat.species("packs/foliage", "no-such-plant"), null);
  const looks = cat.looks("autumn");
  const a = looks.lookOf(oak, "forest", 0), b = looks.lookOf(oak, "forest", 0), c = looks.lookOf(oak, "desert", 0);
  assert.equal(a, b);
  assert.notEqual(a, c);
});
