import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  KEEL_CHAIN_CAPABILITIES,
  KEEL_TEZOS_MODULES,
  resolveKeelChainCapability,
  summarizeKeelChainCapabilities,
} from "../packages/sdk/dist/index.js";
import { siblingRepositories } from "./sibling-repository.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// KEEL_CONTRACTS_DIR selects an isolated contracts checkout explicitly.
const CONTRACTS = process.env.KEEL_CONTRACTS_DIR ? resolve(process.env.KEEL_CONTRACTS_DIR) : resolve(ROOT, "../keel-contracts");
const sibling = siblingRepositories("keel-contracts");

test("every capability states both adapters, or the closest secure behaviour and why", () => {
  const ids = KEEL_CHAIN_CAPABILITIES.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "capability ids are unique");
  for (const entry of KEEL_CHAIN_CAPABILITIES) {
    assert.ok(entry.studioCall.length > 0, entry.id);
    if (entry.status === "evm-only" || entry.status === "tezos-only") {
      const present = entry.status === "evm-only" ? entry.evm : entry.tezos;
      assert.ok(present, `${entry.id} names the chain that has it`);
      assert.ok(entry.closest?.behaviour && entry.closest.reason, `${entry.id} explains the closest behaviour`);
    } else {
      assert.ok(entry.evm && entry.tezos, `${entry.id} names both adapters`);
      assert.equal(entry.closest, undefined, `${entry.id} needs no fallback`);
    }
    if (entry.status === "partial") assert.ok(entry.open, `${entry.id} names what keeps it partial`);
    // The owner's rule: no user-visible difference on a supported call unless it is an open owner decision.
    if (entry.status === "parity" || entry.status === "adapter-different") {
      assert.ok(entry.userVisibleDifference === false || entry.ownerDecision, `${entry.id} hides no difference`);
    }
  }
});

test("an unsupported call returns a typed refusal with the closest secure behaviour", () => {
  const editions = resolveKeelChainCapability("collection.editions", "tezos");
  assert.equal(editions.supported, false);
  assert.equal(editions.code, "KEEL_CHAIN_CAPABILITY_UNSUPPORTED");
  assert.match(editions.closest.behaviour, /distinct FA2 tokens/u);
  assert.equal(resolveKeelChainCapability("collection.editions", "ethereum").supported, true);

  const light = resolveKeelChainCapability("anchors.ethereum-on-tezos", "ethereum");
  assert.equal(light.supported, false);
  assert.equal(light.family, "ethereum");

  const rewrite = resolveKeelChainCapability("collection.token-metadata.creator-rewrite", "tezos");
  assert.equal(rewrite.supported, true);
  assert.deepEqual(rewrite.adapter.contracts, ["KeelCollectionFA2", "KeelIndex"]);
  assert.throws(() => resolveKeelChainCapability("collection.unknown", "tezos"), /Unknown KEEL chain capability/u);
  assert.throws(() => resolveKeelChainCapability("collection.create", "solana"), /Unknown chain family/u);

  const counts = summarizeKeelChainCapabilities();
  assert.equal(Object.values(counts).reduce((sum, value) => sum + value, 0), KEEL_CHAIN_CAPABILITIES.length);
});

test("native adapters name catalogued Tezos contracts", () => {
  const native = new Set(KEEL_TEZOS_MODULES.flatMap((module) => [...module.deployable, ...(module.shared ?? [])]));
  for (const entry of KEEL_CHAIN_CAPABILITIES) {
    for (const name of entry.tezos?.contracts ?? []) assert.ok(native.has(name), `${entry.id}: ${name}`);
  }
});

test("EVM adapters name contract sources and the review map lists every capability", { skip: sibling.skip }, () => {
  const declared = new Set();
  const walk = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) walk(path);
      else if (item.name.endsWith(".sol")) {
        for (const match of readFileSync(path, "utf8").matchAll(/^\s*(?:abstract\s+)?(?:contract|library)\s+(\w+)/gmu)) declared.add(match[1]);
      }
    }
  };
  walk(resolve(CONTRACTS, "src/modules"));
  for (const entry of KEEL_CHAIN_CAPABILITIES) {
    for (const name of entry.evm?.contracts ?? []) assert.ok(declared.has(name), `${entry.id}: ${name}`);
  }
  const map = resolve(CONTRACTS, "docs/reviews/tezos-behavior-parity-20261015/CAPABILITY_MAP.md");
  assert.ok(existsSync(map), "the contracts review publishes the capability map");
  const output = execFileSync("node", [resolve(ROOT, "scripts/render-chain-capability-map.mjs"), "--check", "--output", map], { encoding: "utf8" });
  assert.match(output, /verified/u);
});
