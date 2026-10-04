// Which NOCTURNES this is: the last VERSION its gauntlet ledger names.
import { readFileSync } from "node:fs";
import { NOCTURNES } from "./fingerprint.mjs";
export function versionOf() {
  try {
    const all = [...readFileSync(`${NOCTURNES}/docs/GAUNTLET_LEDGER.md`, "utf8").matchAll(/VERSION (nocturnes-v\d+)/g)];
    return all.length ? all[all.length - 1][1] : "unknown";
  } catch { return "unknown"; }
}
