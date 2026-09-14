#!/usr/bin/env node
// pnpm game:sepolia-dry-run [--game <game-id>=<project dir>]... [--rpc <sepolia rpc>] [--out <report.json>]
//
// What publishing games to Sepolia would cost, measured -- without sending
// anything to Sepolia and without a key. It forks Sepolia into a local anvil
// (read-only calls to the Sepolia RPC fetch the state the fork touches) and
// runs the real publishes there, against the real KeelHold and
// KeelRawTokenURIBuilder, from anvil's own unlocked account:
//
//   1. each game WITHOUT shared engine modules (the game stores the shell and
//      every engine module it needs itself), reverted after each;
//   2. the engine release, once (the shell and every engine module);
//   3. each game WITH the engine release on chain (only its own modules).
//
// Every game is read back through the builder and checked byte-for-byte. Gas
// is what the fork's receipts used; ETH is that gas at Sepolia's current gas
// price (read from Sepolia), and a first-transaction eth_estimateGas on
// Sepolia itself cross-checks the fork.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, formatEther, http } from "viem";
import { SEPOLIA_KEEL } from "./contracts.mjs";
import { publishEngineRelease, publishGame } from "./flows.mjs";
import { startAnvil } from "./local-chain.mjs";
import { missingOnChain, planGame, transactionsFor } from "./publication.mjs";
import { defaultEngine, engineBuilds } from "./build.mjs";

const argv = process.argv.slice(2);
const all = (name) => argv.flatMap((a, i) => (argv[i - 1] === name ? [a] : []));
const option = (name) => all(name)[0];
const rpc = option("--rpc") ?? "https://ethereum-sepolia-rpc.publicnode.com";
const games = all("--game").map((g) => { const at = g.indexOf("="); return { gameId: g.slice(0, at), project: resolve(g.slice(at + 1)) }; });
if (!games.length) { console.error("usage: pnpm game:sepolia-dry-run --game <game-id>=<project dir> [--game ...] [--rpc <sepolia rpc>] [--out <report.json>]"); process.exit(2); }

const sepolia = createPublicClient({ transport: http(rpc, { timeout: 60_000 }) });
if (await sepolia.getChainId() !== SEPOLIA_KEEL.chainId) throw new Error(`${rpc} is not Sepolia.`);
const [gasPrice, block] = await Promise.all([sepolia.getGasPrice(), sepolia.getBlock()]);
const deployment = { chainId: SEPOLIA_KEEL.chainId, KeelHold: SEPOLIA_KEEL.KeelHold, KeelRawTokenURIBuilder: SEPOLIA_KEEL.KeelRawTokenURIBuilder };
const builds = engineBuilds(await defaultEngine());
const eth = (gas) => formatEther(BigInt(gas) * gasPrice);
const log = (line) => console.log(`  ${line}`);

console.log(`Forking Sepolia at block ${block.number} (gas price ${Number(gasPrice) / 1e9} gwei) into a local anvil. Nothing is sent to Sepolia.`);
const node = await startAnvil({ port: 0, chainId: SEPOLIA_KEEL.chainId, fork: rpc });
const call = async (method, params = []) => (await (await fetch(node.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
const report = { schema: "keel-game-sepolia-dry-run@1", checkedAt: new Date().toISOString(), sepolia: { rpc, block: String(block.number), gasPriceWei: String(gasPrice), baseFeeWei: String(block.baseFeePerGas ?? 0n) }, contracts: deployment, engine: { root: builds.root }, games: [], release: null, crossCheck: null };
try {
  // (A cross-check: Sepolia's own estimate for the first write of the first game, against the fork's.)
  const { publicClient: fork } = await (await import("./local-chain.mjs")).clientsFor(node.url);
  const first = games[0];
  const built = await builds.buildGame({ project: first.project, gameId: first.gameId });
  const plan = await planGame({ doc: built.doc, engineModuleIds: built.engineModuleIds, hold: deployment.KeelHold, gameId: first.gameId });
  const txs = transactionsFor({ plan, missing: await missingOnChain({ publicClient: fork, plan }), shares: ["game"] });
  const probe = txs.find((t) => t.kind === "cast");
  if (probe) {
    const from = "0x000000000000000000000000000000000000dEaD";
    const [onSepolia, onFork] = await Promise.all([sepolia.estimateGas({ account: from, to: probe.to, data: probe.data }), fork.estimateGas({ account: from, to: probe.to, data: probe.data })]);
    report.crossCheck = { transaction: probe.label, bytes: probe.bytes, sepoliaEstimate: String(onSepolia), forkEstimate: String(onFork) };
    log(`cross-check ${probe.label}: Sepolia eth_estimateGas ${onSepolia}, fork ${onFork}`);
  }

  // 1. Without shared engine modules: each game alone, then back to Sepolia's state.
  const without = new Map();
  for (const g of games) {
    const snap = await call("evm_snapshot");
    console.log(`${g.gameId} without shared engine modules…`);
    const { result } = await publishGame({ rpc: node.url, deployment, project: g.project, gameId: g.gameId, builds, includeEngine: true, record: false });
    without.set(g.gameId, result);
    await call("evm_revert", [snap]);
  }
  // 2. The engine release, once.
  console.log("The engine release (shell + every engine module), once…");
  const release = await publishEngineRelease({ rpc: node.url, deployment, builds, record: false, log: () => {} });
  report.release = { objects: release.objects.length, bytes: release.totals.bytes, chunks: release.totals.chunks, transactions: release.gas.transactions, gas: String(release.gas.total), eth: eth(release.gas.total), failed: release.failed };
  log(`${release.objects.length} objects, ${release.totals.bytes} bytes, ${release.totals.chunks} chunks, ${release.gas.transactions} tx, ${release.gas.total} gas = ${eth(release.gas.total)} ETH`);
  // 3. With it: each game stores only its own parts.
  for (const g of games) {
    console.log(`${g.gameId} with the engine release on chain…`);
    const { result } = await publishGame({ rpc: node.url, deployment, project: g.project, gameId: g.gameId, builds, record: false });
    const alone = without.get(g.gameId);
    const row = {
      gameId: g.gameId, documentBytes: result.documentBytes, readBackMatches: result.readBackMatches && alone.readBackMatches,
      withSharedEngine: { bytes: result.stored.bytes, chunks: result.stored.chunks, transactions: result.transactions, gas: String(result.gas.total), eth: eth(result.gas.total), reusedObjects: result.reused.length },
      withoutSharedEngine: { bytes: alone.stored.bytes + alone.shared.bytes, chunks: alone.stored.chunks + alone.shared.chunks, transactions: alone.transactions, gas: String(alone.gas.total), eth: eth(alone.gas.total) },
    };
    report.games.push(row);
    log(`with shared: ${row.withSharedEngine.bytes} B, ${row.withSharedEngine.transactions} tx, ${row.withSharedEngine.gas} gas = ${row.withSharedEngine.eth} ETH · without: ${row.withoutSharedEngine.bytes} B, ${row.withoutSharedEngine.transactions} tx, ${row.withoutSharedEngine.gas} gas = ${row.withoutSharedEngine.eth} ETH`);
  }
} finally {
  await node.stop();
}
const out = option("--out");
if (out) writeFileSync(resolve(out), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nDone. Nothing was sent to Sepolia.${out ? ` Report: ${resolve(out)}` : ""}`);
