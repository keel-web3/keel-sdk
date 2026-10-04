// Record NOCTURNES as it is now (run only when NOCTURNES itself is meant to change).
import { writeFileSync } from "node:fs";
import { fingerprint, NOCTURNES } from "./fingerprint.mjs";
import { versionOf } from "./version.mjs";
const t0 = performance.now();
const fp = await fingerprint();
writeFileSync(new URL("./golden.json", import.meta.url), `${JSON.stringify({ nocturnes: NOCTURNES, version: versionOf(), captured: new Date().toISOString(), entries: fp }, null, 1)}\n`);
console.log(`captured ${Object.keys(fp).length} fingerprints of ${NOCTURNES} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
