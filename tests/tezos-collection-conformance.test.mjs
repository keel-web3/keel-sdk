import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  KEEL_TEZOS_COLLECTION_ROUTE_CONTRACTS,
  KEEL_TEZOS_MODULES,
  buildKeelTezosCollectionFA2Storage,
  buildKeelTezosCreatorProfileStorage,
  buildKeelTezosHoldOnchFSStorage,
  buildKeelTezosIndexStorage,
  buildKeelTezosMintGateStorage,
  buildKeelTezosOneMintStorage,
  buildKeelTezosPresentationStateStorage,
} from "../packages/sdk/dist/index.js";
import { siblingRepositories } from "./sibling-repository.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// KEEL_CONTRACTS_DIR selects an isolated contracts checkout explicitly.
const CONTRACTS = process.env.KEEL_CONTRACTS_DIR ? resolve(process.env.KEEL_CONTRACTS_DIR) : resolve(ROOT, "../keel-contracts");
const TARGETS = resolve(CONTRACTS, "out/tezos-collection-route/targets");
const sibling = siblingRepositories("keel-contracts");
const ADMIN = "tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx";
const DEPENDENCY = "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton";

test("the generated Tezos catalogue is current with the contract sources", { skip: sibling.skip }, () => {
  const output = execFileSync("node", [resolve(CONTRACTS, "script/tezos/generate-sdk-catalog.mjs"), "--check", "--output", resolve(ROOT, "packages/sdk/src/tezos-modules.generated.ts")], { encoding: "utf8" });
  assert.match(output, /verified/u);
  for (const { contract, source, module } of Object.values(KEEL_TEZOS_COLLECTION_ROUTE_CONTRACTS)) {
    const text = readFileSync(resolve(CONTRACTS, "src/modules", module, "tezos", source), "utf8");
    assert.match(text, new RegExp(`class ${contract}\\(`, "u"));
    // Inherited entrypoints (for example the shared KeelNFTLedger) live in another source of the same module.
    const entry = KEEL_TEZOS_MODULES.find((item) => item.id === module);
    const sources = entry.contracts.map((file) => readFileSync(resolve(CONTRACTS, entry.sources, file), "utf8")).join("\n");
    for (const name of entry.entrypoints[contract]) assert.match(sources, new RegExp(`def ${name}\\(`, "u"), `${contract}.${name}`);
  }
});

test("SDK origination storage equals the SmartPy-compiled initial storage", {
  skip: sibling.skip || (existsSync(TARGETS) ? false : "Run keel-contracts script/tezos/compile-collection-route.sh to produce the compiled route targets."),
}, () => {
  const compiled = (name) => JSON.parse(readFileSync(resolve(TARGETS, `collection_route_${name}`, "step_001_cont_0_storage.json"), "utf8"));
  const cases = {
    hold: buildKeelTezosHoldOnchFSStorage({ administrator: ADMIN }),
    index: buildKeelTezosIndexStorage({ administrator: ADMIN }),
    collection: buildKeelTezosCollectionFA2Storage({ administrator: ADMIN, keelIndex: DEPENDENCY, maxSupply: 100 }),
    presentation: buildKeelTezosPresentationStateStorage(),
    creator_profile: buildKeelTezosCreatorProfileStorage({ manager: DEPENDENCY }),
    one_mint: buildKeelTezosOneMintStorage({ creatorProfileRegistry: DEPENDENCY }),
    mint_gate: buildKeelTezosMintGateStorage({ administrator: ADMIN, creatorProfileRegistry: DEPENDENCY }),
  };
  for (const [name, storage] of Object.entries(cases)) assert.deepEqual(storage, compiled(name), name);
});
