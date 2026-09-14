// Writes src/record.ts: the army's population for seed 1 at 20,000 units as a
// hybrid record (bake's recordOf -> the bit codec's HYBRID_POPULATION), as
// base64url. Every smaller army is its first units (recordPrefix), so the
// page reads its population from it. Run again when a pack changes (the test
// "the stored record is current" says so):
//   node examples/game-engine/army/tools/record.ts
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toBase64 } from "@keel/game-engine/codec";
import { populate, recordBytes, recordOf } from "@keel/game-engine/bake";
import { armyOptions } from "../src/designs.ts";

const SEED = "1", COUNT = 20000;
const t0 = performance.now();
const rec = recordOf(populate(armyOptions(SEED, COUNT)));
const bytes = recordBytes(rec);
const text = toBase64(bytes);
const lines = text.match(/.{1,120}/g) ?? [];
const out = resolve(dirname(fileURLToPath(import.meta.url)), "../src/record.ts");
writeFileSync(out, [
  "// The army's population for seed 1, 20,000 units, as a hybrid record: the recipe (examples/army and its packs at",
  `// their exact versions, the seed, the count), ${rec.exceptions.length} units' look re-rolls and the voxel hero's body -- ${bytes.length} bytes`,
  `// (${gzipSync(bytes, { level: 9 }).length} gzip'd). Written by tools/record.ts; read by designs.ts (storedRecord).`,
  "",
  `export const ARMY_RECORD = { seed: ${JSON.stringify(SEED)}, count: ${COUNT}, bytes:`,
  `  ${lines.map((l) => JSON.stringify(l)).join(" +\n  ")},`,
  "} as const;",
  "",
].join("\n"));
console.log(`${out}: ${bytes.length} bytes, ${rec.exceptions.length} units with re-rolls, ${rec.parts.length} part(s), ${(performance.now() - t0).toFixed(0)} ms`);
