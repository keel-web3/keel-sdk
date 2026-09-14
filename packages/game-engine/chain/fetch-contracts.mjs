// node packages/game-engine/chain/fetch-contracts.mjs [--rpc <sepolia rpc>]
//
// Maintainer step (read-only): writes chain/keel-contracts.json, the two KEEL
// contracts a game needs -- KeelHold (storage) and KeelRawTokenURIBuilder (the
// document read) -- exactly as deployed on Sepolia. Each creation code comes
// from its Sepolia deployment transaction; each is then deployed on a
// throwaway local anvil and its runtime code compared with Sepolia's (the
// builder's one immutable, the KeelHold address, masked). So the practice
// chain runs byte-identical contracts, and testers need no keel-contracts
// checkout and no network. Nothing is signed or sent to Sepolia.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, keccak256, parseAbi } from "viem";
import { keelHoldAbi } from "@keel/sdk/abi";
import { RAW_BUILDER_ABI, SEPOLIA_KEEL } from "./contracts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const rpc = args[args.indexOf("--rpc") + 1] && args.includes("--rpc") ? args[args.indexOf("--rpc") + 1] : "https://ethereum-sepolia-rpc.publicnode.com";
const sepolia = createPublicClient({ transport: http(rpc, { timeout: 30_000 }) });
if (await sepolia.getChainId() !== SEPOLIA_KEEL.chainId) throw new Error(`${rpc} is not Sepolia.`);

const creation = async (hash, argsHexBytes) => {
  const tx = await sepolia.getTransaction({ hash });
  if (tx.to !== null) throw new Error(`${hash} is not a contract creation.`);
  return argsHexBytes ? `0x${tx.input.slice(2, tx.input.length - argsHexBytes * 2)}` : tx.input;
};
const hold = { name: "KeelHold", address: SEPOLIA_KEEL.KeelHold, tx: SEPOLIA_KEEL.deployments.KeelHold, bytecode: await creation(SEPOLIA_KEEL.deployments.KeelHold) };
// (The builder's constructor takes the KeelHold address: 32 ABI-encoded bytes at the end of its creation input.)
const builder = { name: "KeelRawTokenURIBuilder", address: SEPOLIA_KEEL.KeelRawTokenURIBuilder, tx: SEPOLIA_KEEL.deployments.KeelRawTokenURIBuilder, bytecode: await creation(SEPOLIA_KEEL.deployments.KeelRawTokenURIBuilder, 32) };

// Deploy both on a throwaway anvil and compare runtime code with Sepolia's.
const anvil = spawn("anvil", ["--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
try {
  const url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error("anvil did not start")), 20_000);
    anvil.once("error", reject);
    anvil.stdout.on("data", (b) => { out += b; const m = /Listening on (\S+)/.exec(out); if (m) { clearTimeout(timer); resolve(`http://${m[1]}`); } });
  });
  const local = createPublicClient({ transport: http(url) });
  const wallet = createWalletClient({ transport: http(url) });
  const [account] = await wallet.getAddresses();
  const deploy = async (abi, bytecode, deployArgs = []) => (await local.waitForTransactionReceipt({ hash: await wallet.deployContract({ account, chain: null, abi, bytecode, args: deployArgs }) })).contractAddress;
  const localHold = await deploy(parseAbi(keelHoldAbi), hold.bytecode);
  const localBuilder = await deploy(parseAbi(RAW_BUILDER_ABI), builder.bytecode, [localHold]);
  const same = async (localAddress, remoteAddress, mask = []) => {
    let a = (await local.getCode({ address: localAddress })).toLowerCase();
    let b = (await sepolia.getCode({ address: remoteAddress })).toLowerCase();
    for (const [from, to] of mask) { a = a.replaceAll(from.slice(2).toLowerCase(), "_".repeat(40)); b = b.replaceAll(to.slice(2).toLowerCase(), "_".repeat(40)); }
    return a === b;
  };
  if (!(await same(localHold, hold.address))) throw new Error("The local KeelHold's runtime code differs from Sepolia's.");
  if (!(await same(localBuilder, builder.address, [[localHold, hold.address]]))) throw new Error("The local KeelRawTokenURIBuilder's runtime code differs from Sepolia's.");
  hold.runtimeCodeHash = keccak256(await sepolia.getCode({ address: hold.address }));
  builder.runtimeCodeHash = keccak256(await sepolia.getCode({ address: builder.address }));
} finally {
  anvil.kill();
}

const out = join(here, "keel-contracts.json");
writeFileSync(out, `${JSON.stringify({
  schema: "keel-game-engine-contracts@1",
  about: "KeelHold and KeelRawTokenURIBuilder creation code, taken from their Sepolia deployment transactions and checked runtime-identical to Sepolia (chain/fetch-contracts.mjs).",
  source: { chainId: SEPOLIA_KEEL.chainId, rpc, checkedAt: new Date().toISOString() },
  contracts: Object.fromEntries([hold, builder].map((c) => [c.name, { sepolia: c.address, deploymentTransaction: c.tx, runtimeCodeHash: c.runtimeCodeHash, bytecode: c.bytecode }])),
}, null, 2)}\n`);
console.log(`Wrote ${out}: KeelHold ${(hold.bytecode.length - 2) / 2} bytes, KeelRawTokenURIBuilder ${(builder.bytecode.length - 2) / 2} bytes, both runtime-identical to Sepolia.`);
