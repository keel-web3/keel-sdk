// The practice chain on disk: where the sandbox keeps its state and records,
// how to start an anvil node, and viem clients for a chain. Records are plain
// JSON beside the anvil state, so the editor, the publish command and the
// viewer all agree on what is deployed and published.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
export const PRACTICE_CHAIN_ID = 31337;
export const DEFAULT_PORT = 8645;
export const DEFAULT_VIEWER_PORT = 8646;

/** The sandbox's folder: KEEL_GAME_SANDBOX_DIR, or packages/game-engine/.sandbox. */
export function sandboxDir() {
  return resolve(process.env.KEEL_GAME_SANDBOX_DIR ?? join(here, "..", ".sandbox"));
}

export function readRecord(name, dir = sandboxDir()) {
  const file = join(dir, `${name}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

export function writeRecord(name, value, dir = sandboxDir()) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(value, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2)}\n`);
}

/** Start anvil and wait until it listens. `state`: a file anvil loads and dumps (the chain survives restarts). */
export async function startAnvil({ port = DEFAULT_PORT, chainId = PRACTICE_CHAIN_ID, state, fork, host = "127.0.0.1" } = {}) {
  const args = ["--host", host, "--port", String(port), "--chain-id", String(chainId), "--gas-limit", "60000000", "--code-size-limit", "49152"];
  if (state) args.push("--state", state, "--state-interval", "30");
  if (fork) args.push("--fork-url", fork);
  const child = spawn(process.env.KEEL_ANVIL ?? "anvil", args, { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  const url = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error(`anvil did not start within 60 s:\n${log.slice(-800)}`)), 60_000);
    child.once("error", (error) => { clearTimeout(timer); reject(new Error(`Could not run anvil (${error.message}). Install Foundry: https://getfoundry.sh (then run foundryup).`)); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`anvil exited (${code}):\n${log.slice(-800)}`)); });
    const read = (b) => { log = (log + b).slice(-8000); const m = /Listening on (\S+)/.exec(log); if (m) { clearTimeout(timer); resolveUrl(`http://${m[1]}`); } };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
  });
  child.removeAllListeners("exit");
  return { url, child, stop: () => new Promise((done) => { if (child.exitCode !== null) return done(); child.once("exit", () => done()); child.kill("SIGINT"); setTimeout(() => child.kill("SIGKILL"), 5_000).unref(); }) };
}

/** viem clients for an RPC; `account` defaults to the node's first unlocked account (anvil's). */
export async function clientsFor(rpc, { account } = {}) {
  const transport = http(rpc, { timeout: 120_000 });
  const publicClient = createPublicClient({ transport, pollingInterval: 250 });
  const walletClient = createWalletClient({ transport });
  const from = account ?? (await walletClient.getAddresses())[0];
  return { publicClient, walletClient, account: from, chainId: await publicClient.getChainId() };
}

/** Is there a node at this RPC, and does it still hold the recorded contracts? */
export async function deploymentAlive(rpc, deployment) {
  try {
    const { publicClient, chainId } = await clientsFor(rpc, { account: "0x0000000000000000000000000000000000000001" });
    if (!deployment || chainId !== deployment.chainId) return false;
    const code = await publicClient.getCode({ address: deployment.KeelHold });
    return !!code && code !== "0x";
  } catch { return false; }
}
