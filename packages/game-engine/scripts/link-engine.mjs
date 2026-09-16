// node packages/game-engine/scripts/link-engine.mjs
//
// Carries the KEEL game engine (a separate repository) into the SDK: finds it
// (KEEL_GAME_ENGINE_ROOT, or ../keel-engine beside this repository), links each
// of its packages -- engine parts, standard packs, ai, systems -- into this
// package's node_modules. With --write-manifest, also records them as `link:`
// dependencies and writes one entry per part so projects
// import `@keel/game-engine/<part>`. It also links examples/game-engine to this
// package, so the examples reach the engine exactly as a creator's project does.

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describeEngine, findEngine } from "./engine-source.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, "..");
const sdkRoot = resolve(pkgDir, "..", "..");
// (A checkout -- KEEL_GAME_ENGINE_ROOT, or ../keel-engine -- else the pinned release `pnpm game:engine` fetched: scripts/engine-source.mjs.)
const found = findEngine();
if (!found.root) {
  console.error(describeEngine(found));
  process.exit(1);
}
const engineRoot = found.root;

const link = (target, at) => {
  mkdirSync(dirname(at), { recursive: true });
  if (existsSync(at) || (() => { try { return lstatSync(at).isSymbolicLink(); } catch { return false; } })()) rmSync(at, { recursive: true, force: true });
  symlinkSync(relative(dirname(at), target), at, "dir");
};

// Every engine package: its name, where it is, and the part name projects import it by.
const groups = ["packages", "packs", "ai", "systems"];
const parts = [];
for (const g of groups) {
  const base = join(engineRoot, g);
  if (!existsSync(base)) continue;
  for (const d of readdirSync(base).sort()) {
    const file = join(base, d, "package.json");
    if (!existsSync(file)) continue;
    const { name } = JSON.parse(readFileSync(file, "utf8"));
    if (!name?.startsWith("@keel-engine/")) continue;
    parts.push({ name, dir: join(base, d), part: name.slice("@keel-engine/".length) });
  }
}

const deps = {};
for (const p of parts) {
  link(p.dir, join(pkgDir, "node_modules", ...p.name.split("/")));
  deps[p.name] = `link:${relative(pkgDir, p.dir)}`;
}
const pkgFile = join(pkgDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
// Consumer setup only changes ignored node_modules. Regeneration is an explicit
// maintainer operation: never erase source entries or dirty the lockfile on install.
const regenerate = process.argv.includes("--write-manifest");
if (regenerate) {
  pkg.dependencies = deps;
  writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
}

// One entry per part: @keel/game-engine/<part> is @keel-engine/<part>.
const engineDir = join(pkgDir, "src", "engine");
if (regenerate) mkdirSync(engineDir, { recursive: true });
for (const p of regenerate ? parts : []) {
  writeFileSync(join(engineDir, `${p.part}.ts`), `// @keel/game-engine/${p.part}: the engine's ${p.name}, carried by the SDK (written by scripts/link-engine.mjs).\nexport * from "${p.name}";\n`);
  // (A package that exports its manifest -- "./module" -- gets @keel/game-engine/<part>/module too: tools read packs without running them.)
  const exportsOf = JSON.parse(readFileSync(join(p.dir, "package.json"), "utf8")).exports ?? {};
  if (exportsOf["./module"]) {
    mkdirSync(join(engineDir, p.part), { recursive: true });
    writeFileSync(join(engineDir, p.part, "module.ts"), `// @keel/game-engine/${p.part}/module: ${p.name}'s manifest (written by scripts/link-engine.mjs).\nexport * from "${p.name}/module";\n`);
  }
}

// The examples reach the engine through this package, as a creator's project would.
const examples = join(sdkRoot, "examples", "game-engine");
if (existsSync(examples)) link(pkgDir, join(examples, "node_modules", "@keel", "game-engine"));

// --project <dir> (repeatable): a project outside the SDK reaches the engine
// the same way -- its node_modules/@keel/game-engine is linked to this package.
const projects = [];
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a === "--project" && process.argv[i + 1]) projects.push(resolve(process.argv[++i]));
  else if (a.startsWith("--project=")) projects.push(resolve(a.slice("--project=".length)));
}
for (const dir of projects) {
  if (!existsSync(join(dir, "package.json"))) { console.error(`--project ${dir}: no package.json there`); process.exit(1); }
  link(pkgDir, join(dir, "node_modules", "@keel", "game-engine"));
}

console.log(`Linked ${parts.length} engine packages from ${engineRoot}:\n  ${parts.map((p) => p.part).join(" ")}${projects.length ? `\nand @keel/game-engine into ${projects.join(", ")}` : ""}`);
