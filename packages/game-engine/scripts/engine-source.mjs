// Where @keel/game-engine (and the KEEL editor) find the KEEL game engine, in order:
//
//   1. KEEL_GAME_ENGINE_ROOT      a checkout you point at (engine developers). If it
//                                 holds no engine, that's reported and the search goes on.
//   2. ../keel-engine             a checkout beside this repository (the usual layout).
//   3. the pinned release         engine.lock.json's commit of the public repository,
//                                 cloned by `pnpm game:engine` into packages/game-engine/.engine/<commit>.
//
// (The engine's modules are also published on chain, where the editor can load
// and verify them by id@version; this finds the engine's SOURCE, which builds
// games and is checked against those published digests. When the engine ships
// as npm packages, an installed package becomes one more source here.)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_DIR = resolve(here, "..");
export const SDK_ROOT = resolve(PACKAGE_DIR, "..", "..");
export const ENV = "KEEL_GAME_ENGINE_ROOT";
export const CLONES = join(PACKAGE_DIR, ".engine");

/** An engine root holds its build (packages/keel) and its registry (packages/runtime). */
export const isEngineRoot = (dir) => !!dir && existsSync(join(dir, "packages", "keel", "src", "index.ts")) && existsSync(join(dir, "packages", "runtime", "package.json"));

/** The pinned public release (engine.lock.json). */
export function engineLock() {
  return JSON.parse(readFileSync(join(PACKAGE_DIR, "engine.lock.json"), "utf8"));
}

/** Where the pinned release is (or would be) cloned. */
export function cloneDir(lock = engineLock()) {
  return lock.commit ? join(CLONES, lock.commit) : null;
}

/**
 * The engine to use: { root, source: "env" | "checkout" | "release" | null, searched, notes, lock }.
 * `root` is null when there is none; `notes` says why, and what to do.
 */
export function findEngine({ env = process.env, sibling = join(SDK_ROOT, "..", "keel-engine") } = {}) {
  const lock = engineLock();
  const searched = [];
  const notes = [];
  const fromEnv = env[ENV];
  if (fromEnv) {
    const dir = resolve(fromEnv);
    searched.push(dir);
    if (isEngineRoot(dir)) return { root: dir, source: "env", searched, notes, lock };
    notes.push(`${ENV}=${dir} holds no KEEL game engine (no packages/keel there); looking for the pinned release instead.`);
  } else {
    const dir = resolve(sibling);
    searched.push(dir);
    if (isEngineRoot(dir)) return { root: dir, source: "checkout", searched, notes, lock };
  }
  const clone = cloneDir(lock);
  if (clone) {
    searched.push(clone);
    if (isEngineRoot(clone)) return { root: clone, source: "release", searched, notes, lock };
    notes.push(`The pinned engine release (${lock.tag ?? lock.commit.slice(0, 12)}) isn't downloaded yet: run pnpm game:engine.`);
  } else {
    notes.push(`No engine release is pinned yet (packages/game-engine/engine.lock.json). Until one is, point ${ENV} at a keel-engine checkout (${lock.repository}).`);
  }
  return { root: null, source: null, searched, notes, lock };
}

/** One line for people: which engine, from where. */
export function describeEngine(found) {
  if (!found.root) return `No KEEL game engine found. ${found.notes.join(" ")}`;
  const what = found.source === "release" ? `the pinned release ${found.lock.tag ?? ""} (${found.lock.commit})`.replace("  ", " ") : found.source === "env" ? `the checkout in ${ENV}` : "the checkout beside this repository";
  return `KEEL game engine: ${what} at ${found.root}`;
}
