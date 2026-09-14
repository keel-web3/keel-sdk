// pnpm game:engine [--repo <git url>] [--commit <sha>] [--tag <tag>] [--pin] [--no-link]
//
// Gets the KEEL game engine for people without a checkout: clones the pinned
// public release (engine.lock.json: repository + exact commit) into
// packages/game-engine/.engine/<commit>, checks the commit, and links
// @keel/game-engine to it (scripts/link-engine.mjs) -- unless a local checkout
// is found first, which always wins for engine developers.
//
//   --repo/--commit/--tag   fetch another release (a tag is resolved to its commit; a branch is refused:
//                           a proof pinned to a moving ref expires without saying so)
//   --pin                   also write them to engine.lock.json (the maintainer's step when a release is cut)
//   --no-link               clone only
//
// Needs git. No npm install runs in the clone: the engine's packages reach
// each other through the clone's own node_modules links, made here, and reach
// the SDK (@keel/sdk, esbuild) through this repository's node_modules.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { CLONES, PACKAGE_DIR, describeEngine, engineLock, findEngine, isEngineRoot } from "./engine-source.mjs";

const argv = process.argv.slice(2);
const option = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const lock = engineLock();
const repository = option("--repo") ?? lock.repository;
let tag = option("--tag") ?? (option("--commit") ? null : lock.tag);
let commit = option("--commit") ?? (option("--tag") ? null : lock.commit);
const git = (args, cwd) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();

if (spawnSync("git", ["--version"]).status !== 0) { console.error("Getting the engine needs git (https://git-scm.com)."); process.exit(1); }
if (!commit && tag) {
  const line = git(["ls-remote", repository, `refs/tags/${tag}^{}`, `refs/tags/${tag}`]).split("\n").filter(Boolean);
  const peeled = line.find((l) => l.endsWith("^{}")) ?? line[0];
  if (!peeled) { console.error(`${repository} has no tag ${tag}.`); process.exit(1); }
  commit = peeled.split(/\s+/)[0];
}
if (!commit) {
  console.error(`No engine release is pinned yet (${join(PACKAGE_DIR, "engine.lock.json")}).\nEither point KEEL_GAME_ENGINE_ROOT at a keel-engine checkout, or fetch one: pnpm game:engine --repo ${repository} --tag <tag>`);
  process.exit(1);
}
if (!/^[0-9a-f]{40}$/.test(commit)) { console.error(`--commit must be a full 40-character commit (got ${commit}); a branch is refused.`); process.exit(1); }

const dir = join(CLONES, commit);
if (isEngineRoot(dir) && git(["rev-parse", "HEAD"], dir) === commit) {
  console.log(`The engine release ${tag ?? commit.slice(0, 12)} is already here: ${dir}`);
} else {
  const tmp = `${dir}.part`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  console.log(`Fetching the KEEL game engine ${tag ?? ""} (${commit.slice(0, 12)}) from ${repository}…`);
  git(["init", "-q"], tmp);
  git(["remote", "add", "origin", repository], tmp);
  try { git(["fetch", "-q", "--depth", "1", "origin", commit], tmp); }
  catch { git(["fetch", "-q", "origin"], tmp); } // (a server that won't serve a commit by id: fetch it all)
  git(["checkout", "-q", "--detach", commit], tmp);
  const head = git(["rev-parse", "HEAD"], tmp);
  if (head !== commit) { rmSync(tmp, { recursive: true, force: true }); console.error(`Fetched ${head}, not ${commit}.`); process.exit(1); }
  if (!isEngineRoot(tmp)) { rmSync(tmp, { recursive: true, force: true }); console.error(`${repository}@${commit} is not a KEEL game engine (no packages/keel).`); process.exit(1); }
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
}

// The clone's packages reach each other by name: node_modules/@keel-engine/<part> -> its own folders.
for (const group of ["packages", "packs", "ai", "systems"]) {
  const base = join(dir, group);
  if (!existsSync(base)) continue;
  for (const name of readdirSync(base)) {
    const file = join(base, name, "package.json");
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, "utf8")).name;
    if (!pkg?.startsWith("@keel-engine/")) continue;
    const at = join(dir, "node_modules", ...pkg.split("/"));
    mkdirSync(join(at, ".."), { recursive: true });
    rmSync(at, { recursive: true, force: true });
    symlinkSync(relative(join(at, ".."), join(base, name)), at, "dir");
  }
}
writeFileSync(join(dir, ".keel-engine-release.json"), `${JSON.stringify({ repository, tag, commit, fetchedAt: new Date().toISOString() }, null, 2)}\n`);

if (argv.includes("--pin")) {
  writeFileSync(join(PACKAGE_DIR, "engine.lock.json"), `${JSON.stringify({ ...lock, repository, tag, commit }, null, 2)}\n`);
  console.log(`Pinned ${repository}@${commit} in engine.lock.json.`);
}

const found = findEngine();
console.log(describeEngine(found));
if (found.root && found.root !== dir) console.log(`(A local checkout wins over the release; the release is kept in ${dir}.)`);
if (!argv.includes("--no-link") && found.root) {
  const linked = spawnSync(process.execPath, [join(PACKAGE_DIR, "scripts", "link-engine.mjs")], { stdio: "inherit" });
  process.exit(linked.status ?? 1);
}
