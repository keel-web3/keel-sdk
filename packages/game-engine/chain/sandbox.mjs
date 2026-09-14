#!/usr/bin/env node
// pnpm game:sandbox -- the practice chain, in one command:
//
//   1. starts a local anvil node (chain 31337) whose state lives in
//      packages/game-engine/.sandbox, so what you publish survives a restart;
//   2. deploys KeelHold and KeelRawTokenURIBuilder -- the same bytes as on
//      Sepolia -- the first time (or whenever the state was reset);
//   3. publishes the engine release (the KEEL shell and every engine module)
//      once, so games only store their own modules and entry;
//   4. serves the practice viewer, which reads published games back from
//      the chain;
//   5. prints the RPC, the addresses and the line the editor needs, then runs
//      until Ctrl+C (which stops the node and saves its state).
//
// Options: --port <n> (8645)  --viewer-port <n> (8646)  --no-engine  --reset
//          --exit (set up, print, stop: for scripts and tests)
// Nothing here touches a key: anvil's unlocked accounts sign on the practice chain.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { deployKeelContracts } from "./contracts.mjs";
import { publishEngineRelease } from "./flows.mjs";
import { DEFAULT_PORT, DEFAULT_VIEWER_PORT, PRACTICE_CHAIN_ID, clientsFor, deploymentAlive, readRecord, sandboxDir, startAnvil, writeRecord } from "./local-chain.mjs";
import { startViewer } from "./viewer.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const port = Number(option("--port", process.env.KEEL_GAME_SANDBOX_PORT ?? DEFAULT_PORT));
const viewerPort = Number(option("--viewer-port", DEFAULT_VIEWER_PORT));
const dir = sandboxDir();
const log = (line) => console.log(`  ${line}`);

if (argv.includes("--reset")) { rmSync(dir, { recursive: true, force: true }); console.log(`Reset the practice chain (${dir}).`); }

// (Another node on the port -- a sandbox already running, or something else.)
const rpc = `http://127.0.0.1:${port}`;
const earlier = readRecord("deployment");
if (await deploymentAlive(rpc, earlier)) {
  console.log(`A practice chain is already running at ${rpc} (KeelHold ${earlier.KeelHold}). Stop it first, or use it as it is.`);
  process.exit(0);
}

console.log(`Starting the KEEL practice chain (state: ${dir})`);
const node = await startAnvil({ port, chainId: PRACTICE_CHAIN_ID, state: join(dir, "anvil-state.json") }).catch((error) => {
  console.error(`\n${error.message}\n${/Address already in use|os error 48/i.test(error.message) ? `Port ${port} is taken by another program: pass --port <n>.` : ""}`);
  process.exit(1);
});
let viewer;
const stop = async (code = 0) => {
  await viewer?.close();
  await node.stop();
  process.exit(code);
};
process.on("SIGINT", () => { console.log("\nStopping the practice chain (state saved)."); void stop(0); });
process.on("SIGTERM", () => void stop(0));

try {
  const { publicClient, walletClient, account, chainId } = await clientsFor(node.url);
  let deployment = readRecord("deployment");
  if (!(await deploymentAlive(node.url, deployment))) {
    console.log("Deploying KeelHold and KeelRawTokenURIBuilder (the same bytes as Sepolia)…");
    const deployed = await deployKeelContracts({ publicClient, walletClient, account });
    deployment = { schema: "keel-practice-deployment@1", chainId, rpc: node.url, account, KeelHold: deployed.KeelHold, KeelRawTokenURIBuilder: deployed.KeelRawTokenURIBuilder, deployedAt: new Date().toISOString() };
    writeRecord("deployment", deployment);
  }
  if (!argv.includes("--no-engine")) {
    console.log("Publishing the engine release (once per chain; skipped when already there)…");
    const release = await publishEngineRelease({ rpc: node.url, deployment, log });
    log(`${release.objects.length} shared objects on chain, ${release.gas.transactions} new transactions, ${release.gas.total} gas.`);
    if (release.release?.pin) log(`release record (EngineReleasePin): version ${release.release.pin.version}, object ${release.release.pin.objectId}, sha256 ${release.release.pin.digest}`);
  }
  viewer = await startViewer({ port: viewerPort, rpc: node.url, builder: deployment.KeelRawTokenURIBuilder, chainId }).catch((error) => {
    console.log(`  (The viewer could not listen on ${viewerPort}: ${error.message}. Pass --viewer-port <n>.)`);
    return undefined;
  });
  writeRecord("sandbox", { rpc: node.url, chainId, viewer: viewer?.url ?? null, pid: process.pid, startedAt: new Date().toISOString() });
  console.log(`
KEEL practice chain is running.
  RPC          ${node.url}   (chain ${chainId}, anvil's unlocked accounts sign; no real funds)
  KeelHold     ${deployment.KeelHold}
  Builder      ${deployment.KeelRawTokenURIBuilder}   (KeelRawTokenURIBuilder)
  Viewer       ${viewer?.url ?? "(not running)"}
  Records      ${dir}

Publish a game:     pnpm game:publish <game-id> --project <dir>
Editor:             pnpm desktop   (the editor finds this practice chain by itself)
Stop:               Ctrl+C (the chain's state is saved and comes back next time)
`);
  if (argv.includes("--exit")) await stop(0);
} catch (error) {
  console.error(`\nThe practice chain couldn't be set up: ${error?.shortMessage ?? error?.message ?? error}`);
  if (existsSync(join(dir, "deployment.json"))) console.error("If the saved state is stale, start over with --reset.");
  await stop(1);
}
