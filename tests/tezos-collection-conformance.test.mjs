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
const CONTRACTS = resolve(ROOT, "../keel-contracts");
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
    const inventory = JSON.parse(execFileSync("python3", [resolve(CONTRACTS, "script/tezos/source-inventory.py")], { encoding: "utf8" }));
    const declarations = new Map(inventory.flatMap((item) => item.contracts.map((declaration) => [declaration.name, { ...declaration, source: item.source }])));
    const assertHierarchy = (className, visiting = new Set()) => {
      assert.equal(visiting.has(className), false, `Cyclic native inheritance at ${className}`);
      const declaration = declarations.get(className);
      assert.ok(declaration, `Missing native declaration ${className}`);
      for (const base of declaration.bases.filter((name) => name !== "sp.Contract")) assertHierarchy(base.split(".").at(-1), new Set(visiting).add(className));
    };
    assertHierarchy(contract);
    const inheritedMethod = (className, methodName, visiting = new Set()) => {
      assert.equal(visiting.has(className), false, `Cyclic native inheritance at ${className}`);
      const declaration = declarations.get(className);
      assert.ok(declaration, `Missing native declaration ${className}`);
      const bases = declaration.bases.filter((base) => base !== "sp.Contract").map((base) => base.split(".").at(-1));
      for (const base of bases) assert.ok(declarations.has(base), `Missing base ${className}.${base}`);
      const own = declaration.methods.find((method) => method.name === methodName);
      if (own) {
        assert.equal(own.kind, "entrypoint", `${className}.${methodName} has the wrong decorator`);
        assert.match(readFileSync(resolve(CONTRACTS, declaration.source), "utf8"), new RegExp(`def ${methodName}\\(`, "u"));
        return true;
      }
      return bases.some((base) => inheritedMethod(base, methodName, new Set(visiting).add(className)));
    };
    const entrypoints = KEEL_TEZOS_MODULES.find((item) => item.id === module).entrypoints[contract];
    for (const name of entrypoints) assert.ok(inheritedMethod(contract, name), `${contract}.${name} is absent from its exact source inheritance`);
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
