import nodeTest from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { toFunctionSignature } from "viem";

import { KEEL_FIELD_REGISTRY_EVM_ABI, assertKeelTezosEntrypoint } from "../packages/sdk/dist/index.js";
import { siblingTest } from "./sibling-repository.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// KEEL_CONTRACTS_DIR selects an isolated contracts checkout explicitly.
const CONTRACTS = process.env.KEEL_CONTRACTS_DIR ? resolve(process.env.KEEL_CONTRACTS_DIR) : resolve(ROOT, "../keel-contracts");
const test = siblingTest(nodeTest, "keel-contracts");

test("the SDK's field vectors are the contracts' shared vectors", () => {
  const source = readFileSync(resolve(CONTRACTS, "test/fixtures/parity/field-permissions.json"), "utf8");
  const copy = readFileSync(resolve(ROOT, "tests/fixtures/field-permissions-v1.json"), "utf8");
  assert.equal(copy, source, "copy keel-contracts test/fixtures/parity/field-permissions.json to tests/fixtures/field-permissions-v1.json");
});

test("every prepared EVM function exists in the compiled KeelFieldRegistry ABI", () => {
  const abi = JSON.parse(readFileSync(resolve(CONTRACTS, "modules/keel-fields/abi/KeelFieldRegistry.json"), "utf8"));
  const compiled = new Set(abi.filter((item) => item.type === "function").map((item) => toFunctionSignature(item)));
  for (const item of KEEL_FIELD_REGISTRY_EVM_ABI) assert.ok(compiled.has(toFunctionSignature(item)), toFunctionSignature(item));
});

test("every prepared Tezos entrypoint exists on the SmartPy KeelFieldRegistry", () => {
  const source = readFileSync(resolve(CONTRACTS, "src/modules/keel-fields/tezos/keel_field_registry.py"), "utf8");
  for (const name of ["claim_space", "transfer_space_admin", "set_schema", "set_validators", "set_rule", "disable_rule",
    "set_accounts", "set_pointer", "clear_pointer", "freeze_schema", "freeze_fields", "freeze_token_fields", "set_paused",
    "set_metadata_patch", "cancel_grant_nonces", "edit"]) {
    assertKeelTezosEntrypoint("KeelFieldRegistry", name);
    assert.match(source, new RegExp(`def ${name}\\(self`, "u"), name);
  }
});
