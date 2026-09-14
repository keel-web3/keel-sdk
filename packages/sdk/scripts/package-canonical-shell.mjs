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
