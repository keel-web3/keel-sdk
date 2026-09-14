// Where the references live, for the equality tests: the JavaScript proof of
// concept (KEEL_POC=path, default ../keel-pixel-engine beside this repo) and
// NOCTURNES (NOCTURNES=path, default ../keel-nocturnes). Both are only read.
// A test whose reference isn't on this machine is skipped, not failed.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const POC = resolve(process.env["KEEL_POC"] ?? resolve(here, "../../../../keel-pixel-engine"));
export const NOCTURNES = resolve(process.env["NOCTURNES"] ?? resolve(here, "../../../../keel-nocturnes"));
export const hasPoc = existsSync(`${POC}/src/core/rng.js`);
export const hasNocturnes = existsSync(`${NOCTURNES}/src/rng.js`);

/** A module of the proof of concept ("src/core/rng.js"), typed as its TypeScript port. */
export const poc = async <T>(path: string): Promise<T> => (await import(pathToFileURL(`${POC}/${path}`).href)) as T;
/** A NOCTURNES module ("rng.js"). */
export const noct = async <T>(path: string): Promise<T> => (await import(pathToFileURL(`${NOCTURNES}/src/${path}`).href)) as T;
export const noctUrl = (path: string): string => pathToFileURL(`${NOCTURNES}/src/${path}`).href;

/** A local generator for test inputs (not under test): mulberry32. */
export function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Counted comparisons: deep-equal, and bit-exact numbers (Object.is: -0 is not 0, NaN is NaN). */
export function counter() {
  const counts: Record<string, number> = {};
  const count = (k: string, n = 1): void => { counts[k] = (counts[k] ?? 0) + n; };
  return {
    counts,
    same(k: string, a: unknown, b: unknown, msg?: string): void { assert.deepEqual(a, b, msg); count(k); },
    exact(k: string, a: unknown, b: unknown, msg = ""): void { if (!Object.is(a, b)) assert.fail(`${msg}: ${String(a)} !== ${String(b)}`); count(k); },
    summary(title: string): string { return `${title}:\n${Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`; },
  };
}
