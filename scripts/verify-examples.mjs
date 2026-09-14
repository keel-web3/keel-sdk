import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { manifestIntegrity, parseArtifactManifest } from "../packages/protocol/dist/index.js";
import { root } from "./run.mjs";

// The sidecar attests the manifest, so the manifest is the authority: when one
// drifts it is regenerated, never hand-edited. `--write` is that regeneration —
// without it this only verifies, which is how it runs in `pnpm verify`.
const write = process.argv.includes("--write");

const examples = [
  ["examples/basic-manifest/manifest.json", "examples/basic-manifest/manifest.integrity.json"],
  ["examples/image-wrapper/release/manifest.json", "examples/image-wrapper/release/manifest.integrity.json"],
];

for (const [manifestName, sidecarName] of examples) {
  const raw = JSON.parse(await readFile(path.join(root, manifestName), "utf8"));
  const manifest = parseArtifactManifest(raw);
  const sidecar = JSON.parse(await readFile(path.join(root, sidecarName), "utf8"));
  const integrity = await manifestIntegrity(manifest);
  if (sidecar.schema !== "oca-manifest-integrity@2") throw new Error(`${sidecarName}: wrong sidecar schema.`);
  if (sidecar.canonicalization !== "RFC8785") throw new Error(`${sidecarName}: wrong canonicalization.`);
  const stale = sidecar.integrity?.algorithm !== integrity.algorithm
    || sidecar.integrity?.digest !== integrity.digest
    || sidecar.integrity?.byteLength !== integrity.byteLength;
  if (stale && write) {
    await writeFile(path.join(root, sidecarName), `${JSON.stringify({ ...sidecar, integrity }, null, 2)}\n`);
    console.log(`Rewrote ${sidecarName}: ${integrity.digest} (${integrity.byteLength} canonical bytes)`);
    continue;
  }
  if (sidecar.integrity?.algorithm !== integrity.algorithm) throw new Error(`${sidecarName}: wrong algorithm.`);
  if (sidecar.integrity?.digest !== integrity.digest) throw new Error(`${sidecarName}: digest mismatch. Re-run with --write to regenerate it from the manifest.`);
  if (sidecar.integrity?.byteLength !== integrity.byteLength) throw new Error(`${sidecarName}: canonical length mismatch. Re-run with --write to regenerate it from the manifest.`);
  console.log(`Verified example ${manifestName}: ${integrity.digest}`);
}

const metadata = JSON.parse(await readFile(path.join(root, "examples/basic-manifest/metadata.example.json"), "utf8"));
if (metadata.oca_schema !== "oca-manifest@2") throw new Error("metadata.example.json uses the wrong Keel schema.");
console.log("Example manifests and sidecars verified.");
