#!/usr/bin/env node
// keel-game <command> -- the engine's build, run in a project (the current directory, or --project <dir>):
//   keel-game modules               what the project can build with: the engine's modules and its own
//   keel-game module <id>           one module as a KEEL browser module
//   keel-game document <game-id>    a game as the KEEL document the chain assembles (-> out/documents/<game>)
import { runCli } from "@keel-engine/keel";

const argv = process.argv.slice(2);
await runCli(argv.includes("--project") ? argv : [...argv, "--project", process.cwd()]);
