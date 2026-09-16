// Is NOCTURNES exactly as it was? Every fingerprint in golden.json, made again.
import { readFileSync } from "node:fs";
import { fingerprint } from "./fingerprint.mjs";
import { versionOf } from "./version.mjs";
const file = JSON.parse(readFileSync(new URL("./golden.json", import.meta.url), "utf8"));
const golden = file.entries;
// (NOCTURNES moves on its own -- its gauntlet bumps VERSION in its ledger. A new version is its change, not the engine's: recapture.)
const version = versionOf();
if (file.version && version !== file.version) console.log(`NOTE  NOCTURNES is ${version}, the golden is ${file.version}: if that version is meant, npm run guard:capture`);
const t0 = performance.now();
const now = await fingerprint({ quick: process.argv.includes("--quick") });
const moved = Object.keys(now).filter((k) => golden[k] !== now[k]);
const missing = process.argv.includes("--quick") ? [] : Object.keys(golden).filter((k) => !(k in now));
for (const k of moved) console.log(`CHANGED  ${k}: ${golden[k] ?? "(new)"} -> ${now[k]}`);
for (const k of missing) console.log(`MISSING  ${k}`);
console.log(`${Object.keys(now).length - moved.length}/${Object.keys(now).length} unchanged (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(moved.length || missing.length ? 1 : 0);
