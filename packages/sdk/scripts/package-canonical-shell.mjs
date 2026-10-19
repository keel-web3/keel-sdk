// Package the exact canonical implementation. No per-project shell is generated here.
import { copyFile, mkdir } from "node:fs/promises";
const output = new URL("../dist/assets/", import.meta.url);
await mkdir(output, { recursive: true });
await copyFile(new URL("../../viewer/src/keel-verification-chrome.js", import.meta.url), new URL("keel-verification-chrome.js", output));

// Package the existing KEEL chunk reader into the portable Hybrid mounting code.
const {build} = await import("esbuild");
const {writeFile} = await import("node:fs/promises");
const runtime = await build({entryPoints:[new URL("./managed-shell-runtime.mjs",import.meta.url).pathname],bundle:true,write:false,platform:"browser",format:"iife",target:"es2022",minify:true,legalComments:"none"});
await writeFile(new URL("../dist/managed-shell-runtime.js",import.meta.url), "export const KEEL_MANAGED_SHELL_RUNTIME = " + JSON.stringify(runtime.outputFiles[0].text) + ";\n");
await writeFile(new URL("../dist/managed-shell-runtime.d.ts",import.meta.url), "export declare const KEEL_MANAGED_SHELL_RUNTIME: string;\n");

// Reader identity is immutable across unrelated viewer edits. Authenticate the
// actual file before packaging; the SDK repeats this check on every load.
const {readFile} = await import("node:fs/promises");
const {createHash} = await import("node:crypto");
const reader = await readFile(new URL("../src/assets/keel-published-view-reader-v1.js", import.meta.url));
if (reader.byteLength !== 251050 || createHash("sha256").update(reader).digest("hex") !== "978e5fed29103cc72a2272f908421f14a587009d959aa40d3a1853af130bae1a") throw new Error("Immutable published-reader asset failed packaging integrity.");
await copyFile(new URL("../src/assets/keel-published-view-reader-v1.js", import.meta.url), new URL("keel-published-view-reader-v1.js", output));
await copyFile(new URL("../src/assets/keel-published-view-reader-v1.provenance.json", import.meta.url), new URL("keel-published-view-reader-v1.provenance.json", output));
