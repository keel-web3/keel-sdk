#!/usr/bin/env node
// pnpm game:publish <game-id> --project <dir> [--rpc <url>] [--include-engine] [--seed <text>] [--json]
//
// Builds the game, publishes what the chain doesn't have yet -- by default to
// the running practice chain (pnpm game:sandbox) -- reads it back through the
// builder, checks it byte-for-byte against the local build, and prints the
// links to it. Only practice chains are accepted here: Sepolia and mainnet go
// through the editor's wallet, after review (see docs/GAME_ENGINE_ALPHA.md).
import { resolve } from "node:path";
import { publishGame } from "./flows.mjs";
import { PRACTICE_CHAIN_ID, clientsFor, deploymentAlive, readRecord } from "./local-chain.mjs";

const argv = process.argv.slice(2);
const option = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const gameId = argv.find((a, i) => !a.startsWith("--") && !["--project", "--rpc", "--seed"].includes(argv[i - 1] ?? ""));
if (!gameId) { console.error("usage: pnpm game:publish <game-id> --project <dir> [--rpc <url>] [--include-engine] [--seed <text>] [--json]"); process.exit(2); }
const project = resolve(option("--project") ?? process.cwd());
const deployment = readRecord("deployment");
const rpc = option("--rpc") ?? readRecord("sandbox")?.rpc ?? deployment?.rpc;
if (!rpc || !(await deploymentAlive(rpc, deployment))) {
  console.error("No practice chain is running. Start one with: pnpm game:sandbox");
  process.exit(1);
}
const { chainId } = await clientsFor(rpc);
if (chainId !== PRACTICE_CHAIN_ID) { console.error(`${rpc} is chain ${chainId}; this command only publishes to the practice chain (${PRACTICE_CHAIN_ID}).`); process.exit(1); }
const seed = option("--seed");
try {
  const { result } = await publishGame({ rpc, deployment, project, gameId, includeEngine: argv.includes("--include-engine"), context: seed ? { seed } : {}, log: (l) => { if (!argv.includes("--json")) console.log(`  ${l}`); } });
  if (argv.includes("--json")) { console.log(JSON.stringify(result, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2)); process.exit(0); }
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`
${gameId} is on the practice chain.
  root         ${result.root}
  stored now   ${kb(result.stored.bytes)} in ${result.stored.chunks} chunks (${result.transactions} transactions, ${result.gas.total} gas)
  reused       ${result.reused.length} shared objects (the shell and ${result.reused.filter((r) => r.moduleId).length} engine modules), ${kb(result.shared.bytes)} not stored again
  read back    ${kb(result.readBackBytes)}, matches the local build: ${result.readBackMatches ? "yes" : "NO"}
  open         ${result.links.viewer ?? "(start the viewer: pnpm game:sandbox)"}
  web3         ${result.links.web3}
`);
} catch (error) {
  console.error(`\nPublishing ${gameId} failed: ${error?.shortMessage ?? error?.message ?? error}`);
  process.exit(1);
}
