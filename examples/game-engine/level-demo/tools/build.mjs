// Bundles the demo for a quick page (tools/level.html) without the KEEL
// document step. Engine packages resolve by name through node_modules; where
// they aren't linked yet, KEEL_ENGINE (default: ../keel-engine beside keel-sdk)
// supplies their source.
//   node examples/level-demo/tools/build.mjs
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const engine = resolve(process.env.KEEL_ENGINE ?? resolve(here, "../../../../../keel-engine"));
const require = createRequire(resolve(here, "../package.json"));
const fallback = {
  name: "keel-engine-fallback",
  setup(b) {
    b.onResolve({ filter: /^@keel-engine\/[\w-]+$/ }, (a) => {
      try { require.resolve(a.path); return undefined; } catch { /* not linked */ }
      for (const dir of ["packages", "packs"]) { const file = resolve(engine, dir, a.path.slice("@keel/game-engine/".length), "src/index.ts"); if (existsSync(file)) return { path: file }; }
      return undefined;
    });
  },
};
await build({ entryPoints: [resolve(here, "../src/index.ts")], bundle: true, format: "esm", platform: "browser", target: "es2022", logLevel: "info", plugins: [fallback], outfile: resolve(here, "dist/level.js") });
