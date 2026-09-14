// Where the reference lives, for the equality tests: the JavaScript proof of
// concept (KEEL_POC=path, default ../keel-pixel-engine beside this repo). It
// is only read. A test whose reference isn't on this machine is skipped, not failed.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const POC = resolve(process.env["KEEL_POC"] ?? resolve(here, "../../../../keel-pixel-engine"));
export const hasPoc = existsSync(`${POC}/projects/wallrun/sim.js`);

/** A module of the proof of concept ("projects/wallrun/sim.js"), typed as its TypeScript port. */
export const poc = async <T>(path: string): Promise<T> => (await import(pathToFileURL(`${POC}/${path}`).href)) as T;

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
