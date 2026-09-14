// GARDEN as a KEEL example: the seeded plaza on the world runtime (gardenWorld,
// headless in Node) and its page (main: the picture and the locks panel).
// (Nothing here touches the page until main() runs: Node imports it for tests.)

export { FX, PROJECT, TAGS, gardenGenerator, gardenWorld, stroll, wander } from "./garden.ts";
export type { GardenOptions } from "./garden.ts";
export { HERO_MATERIALS, MATERIALS, PALETTES, animalMaterials } from "./palette.ts";
export { main } from "./page.ts";
