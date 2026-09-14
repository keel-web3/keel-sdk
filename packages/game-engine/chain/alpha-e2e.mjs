#!/usr/bin/env node
// pnpm game:e2e [--template blank|top-down|level|dungeon|character] [--shots <dir>] [--keep]
//
// The alpha tester's whole path, headless, in a throwaway folder:
//   1. a new game project from a template (with a Builder-made asset in its
//      pack when the template has one: a creature made with the builder's ops);
//   2. its KEEL document, built with the engine;
//   3. that document in the KEEL verification shell (headless Chrome): verified;
//   4. a practice chain (anvil) with KeelHold and the raw builder, the engine
//      release published once, then the game -- only its own parts;
//   5. the game read back from the chain, byte-for-byte equal to the build,
//      rendered from the chain in the shell and screenshotted.
// Exit 0 when every step passed. Nothing leaves this computer.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, "..", "..", "..");
const argv = process.argv.slice(2);
const option = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const template = option("--template", "character");
const shots = resolve(option("--shots", join(sdkRoot, "apps", "desktop", "artifacts")));
const work = mkdtempSync(join(tmpdir(), "keel-alpha-e2e-"));
process.env.KEEL_GAME_SANDBOX_DIR = join(work, "sandbox");
const steps = [];
const step = (name, detail) => { steps.push({ name, ...detail }); console.log(`✓ ${name}${detail?.note ? ` -- ${detail.note}` : ""}`); };

const { createGameProject, syncBuilderAssets } = await import("../scripts/new-game.mjs");
const { defaultEngine, engineBuilds } = await import("./build.mjs");
const { deployKeelContracts } = await import("./contracts.mjs");
const { clientsFor, startAnvil, writeRecord } = await import("./local-chain.mjs");
const { publishEngineRelease, publishGame } = await import("./flows.mjs");

function chromeBinary() {
  if (process.env.KEEL_CHROME_HEADLESS_SHELL) return process.env.KEEL_CHROME_HEADLESS_SHELL;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return null;
  const dir = readdirSync(cache).filter((n) => n.startsWith("chromium_headless_shell-")).sort().at(-1);
  const bin = dir && join(cache, dir, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
  return bin && existsSync(bin) ? bin : null;
}
const chrome = chromeBinary();
const runChrome = (args) => new Promise((done) => { const c = spawn(chrome, args, { stdio: ["ignore", "pipe", "pipe"] }); let out = ""; c.stdout.on("data", (d) => { out += d; }); c.stderr.on("data", () => {}); c.on("close", () => done(out)); });
async function inShell(bytes, png) {
  const server = createServer((_q, r) => { r.setHeader("content-type", "text/html; charset=utf-8"); r.end(bytes); });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const base = ["--headless", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1280,800", "--virtual-time-budget=6000"];
  try {
    const dom = await runChrome([...base, "--dump-dom", url]);
    if (png) await runChrome([...base, `--screenshot=${png}`, url]);
    return { verification: /data-verification="(\w+)"/.exec(dom)?.[1] ?? null, status: /id="keel-status"[^>]*>([^<]*)</.exec(dom)?.[1] ?? "" };
  } finally { server.close(); }
}

let node;
let failed = false;
try {
  // 1. A new game from a template, with a Builder asset when it has a pack.
  const engine = await defaultEngine();
  const builds = engineBuilds(engine);
  const gamesDir = join(work, "games");
  const made = createGameProject({ sdkRoot, gamesDir, template, name: "Alpha e2e" });
  step("new game from a template", { template, gameId: made.gameId, engine: engine.root, note: `${made.gameId} (engine: ${engine.source} ${engine.root})` });
  if (made.packId) {
    const builder = await import(pathToFileURL(join(engine.root, "packages", "builder", "src", "index.ts")).href);
    const run = builder.runOps([{ op: "generate", kind: "critter", seed: "7" }, { op: "target", as: "entity", id: "alpha-critter", title: "Alpha critter" }]);
    if (!run.ok) throw new Error(`The builder refused its ops: ${JSON.stringify(run.errors)}`);
    const built = builder.buildSession(run.session, { pack: "keel/builder" });
    const ids = syncBuilderAssets({ dir: made.dir, files: [{ name: "packs/alpha-critter.ts", content: built.code }] });
    step("a Builder-made asset in the game's pack", { assets: ids, note: `${built.kind} alpha-critter, ${built.code.length} bytes of TypeScript` });
  }

  // 2. The document.
  const { doc } = await builds.buildGame({ project: gamesDir, gameId: made.gameId });
  step("built the KEEL document", { modules: doc.modules.length, bytes: doc.html.byteLength, note: `${doc.modules.length} modules, ${(doc.html.byteLength / 1024).toFixed(1)} KB` });

  // 3. The verification shell.
  if (chrome) {
    const local = await inShell(doc.html, null);
    if (local.verification !== "verified") throw new Error(`The local document didn't verify: ${local.status}`);
    step("verified in the KEEL verification shell", { note: "headless Chrome" });
  } else step("verification shell skipped", { note: "no headless Chrome (set KEEL_CHROME_HEADLESS_SHELL)" });

  // 4. A practice chain, the engine release, the game.
  node = await startAnvil({ port: 0, state: join(work, "sandbox", "anvil-state.json") });
  const { publicClient, walletClient, account, chainId } = await clientsFor(node.url);
  const contracts = await deployKeelContracts({ publicClient, walletClient, account });
  const deployment = { chainId, KeelHold: contracts.KeelHold, KeelRawTokenURIBuilder: contracts.KeelRawTokenURIBuilder };
  writeRecord("deployment", { ...deployment, rpc: node.url, account });
  step("practice chain up", { rpc: node.url, ...deployment, note: `${node.url}, KeelHold ${contracts.KeelHold}` });
  const release = await publishEngineRelease({ rpc: node.url, deployment, builds });
  step("engine release published once", { objects: release.objects.length, gas: String(release.gas.total), note: `${release.objects.length} shared objects, ${release.gas.transactions} transactions` });
  const { result, html } = await publishGame({ rpc: node.url, deployment, project: gamesDir, gameId: made.gameId, builds, context: { seed: "7" } });
  step("game published (its own parts only)", { stored: result.stored, gas: String(result.gas.total), reused: result.reused.length, note: `${result.stored.bytes} bytes in ${result.stored.chunks} chunks, ${result.transactions} transactions; reused ${result.reused.length} shared objects` });

  // 5. Back from the chain.
  if (!result.readBackMatches) throw new Error("The game read back from the chain differs from the build.");
  step("read back from the chain, byte-for-byte", { bytes: result.readBackBytes });
  if (chrome) {
    mkdirSync(shots, { recursive: true });
    const png = join(shots, `alpha-e2e-${template}.png`);
    const fromChain = await inShell(html, png);
    if (fromChain.verification !== "verified") throw new Error(`The game from the chain didn't verify: ${fromChain.status}`);
    step("rendered from the chain in the shell", { screenshot: png, note: png });
  }
} catch (error) {
  failed = true;
  console.error(`✗ ${error?.shortMessage ?? error?.message ?? error}`);
} finally {
  await node?.stop();
  writeFileSync(join(work, "report.json"), `${JSON.stringify({ template, steps, failed }, null, 2)}\n`);
  if (!argv.includes("--keep")) rmSync(work, { recursive: true, force: true });
  else console.log(`(kept ${work})`);
}
console.log(failed ? "\nThe alpha path FAILED." : `\nThe alpha path passed: ${steps.length} steps.`);
process.exit(failed ? 1 : 0);
