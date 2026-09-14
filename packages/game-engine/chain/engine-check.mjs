#!/usr/bin/env node
// pnpm game:engine-check [--rpc <url>] [--no-local] [--json]
//
// The engine release pinned on the practice chain (its record from pnpm
// game:sandbox), checked the way the editor's engine picker checks it: the
// record's sha256 against the pin, every module's object against the
// catalog's digest, this engine's own verified build against the release,
// and where each module's readable source is on GitHub. Read-only.
import { defaultEngine, engineBuilds } from "./build.mjs";
import { checkEngineRelease } from "./engine-release.mjs";
import { clientsFor, readRecord } from "./local-chain.mjs";

const argv = process.argv.slice(2);
const option = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const record = readRecord("engine-release");
const pin = record?.release?.pin;
if (!pin) { console.error("No engine release record is pinned on the practice chain yet: run pnpm game:sandbox."); process.exit(1); }
const rpc = option("--rpc") ?? readRecord("sandbox")?.rpc ?? readRecord("deployment")?.rpc;
const { publicClient } = await clientsFor(rpc, { account: "0x0000000000000000000000000000000000000001" });
const engine = await defaultEngine();
const builds = engineBuilds(engine);
const check = await checkEngineRelease({ keel: engine.keel, root: engine.root, workspace: await builds.workspaceOf([]), pin, publicClient, local: !argv.includes("--no-local") });
if (argv.includes("--json")) { console.log(JSON.stringify(check, null, 2)); process.exit(0); }
console.log(`Engine release ${check.version} (${check.revision ?? "no commit pinned"}) on chain ${pin.chainId}: record ${pin.objectId}`);
for (const m of check.modules) console.log(`  ${m.id}@${m.version}  on chain: ${m.onchain}  this engine: ${m.local}${m.notes.length ? `  (${m.notes.join("; ")})` : ""}`);
const bad = check.modules.filter((m) => m.onchain !== "verified");
console.log(bad.length ? `\n${bad.length} module(s) not verified on chain.` : `\nEvery module verified on chain; ${check.modules.filter((m) => m.local === "match").length}/${check.modules.length} match this engine's build.`);
process.exit(bad.length ? 1 : 0);
