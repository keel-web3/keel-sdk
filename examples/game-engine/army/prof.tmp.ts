import { populate, bakeCost } from "@keel/game-engine/bake";
import { armyCast } from "./src/designs.ts";
const { entities, attributes } = armyCast();
for (const variants of [3, 4, 6]) {
  const pop = populate({ seed: "x", count: 10000, entities, attributes, shapes: 1, wear: [1, 3], variants });
  console.log(variants, pop.stats.attributeShapes, JSON.stringify(bakeCost(pop)));
}
