// Bundles the demo for a quick page (tools/worlds.html) and copies both to the
// engine's dev server (keel-engine/out/worlds/), which serves them on :4300.
//   node examples/game-engine/worlds/tools/build.mjs
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const engine = resolve(process.env.KEEL_ENGINE ?? resolve(here, "../../../../../keel-engine"));
await build({ entryPoints: [resolve(here, "../src/index.ts")], bundle: true, format: "esm", platform: "browser", target: "es2022", logLevel: "info", outfile: resolve(here, "dist/worlds.js") });
if (existsSync(engine)) {
  const out = resolve(engine, "out/worlds");
  mkdirSync(out, { recursive: true });
  copyFileSync(resolve(here, "dist/worlds.js"), resolve(out, "worlds.js"));
  copyFileSync(resolve(here, "worlds.html"), resolve(out, "worlds.html"));
  console.log(`copied to ${out} (http://localhost:4300/out/worlds/worlds.html)`);
}
