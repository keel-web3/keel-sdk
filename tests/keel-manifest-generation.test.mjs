/**
 * `keel sync` derives each unit's `deployable` list from forge artifacts. When the
 * artifacts are not on disk there is nothing to derive from, and the generator
 * once recorded that absence as `deployable: []` — silently erasing the real list
 * for the external apps, whose sources live in their own repositories and so are
 * never built into keel-contracts/out locally. The loss surfaced only downstream,
 * as a deployment record naming a contract the manifest no longer called
 * deployable. These tests pin the distinction the fix rests on: a missing artifact
 * directory is *unknown*, never *nothing*.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { MODULES } from "../tools/keel/module-map.mjs";
import { artifactNames, deployableSources, resolveDeployable } from "../tools/keel/generate-manifests.mjs";

const REPO = resolve(import.meta.dirname, "..");
const GENERATOR = "tools/keel/generate-manifests.mjs";
const EXTERNAL = MODULES.filter((m) => m.external);
const LOCAL = MODULES.filter((m) => !m.external);

const unitDir = (root, unit) => join(root, unit.kind === "app" ? "apps" : "modules", unit.id);
const readManifest = (root, unit) =>
  JSON.parse(readFileSync(join(unitDir(root, unit), "keel.module.json"), "utf8"));

/** what an external unit's committed manifest claims, absent any local artifacts */
const committedDeployable = (unit) => deployableSources(unit.contracts).map((c) => basename(c, ".sol")).sort();

function seedArtifacts(root, unit, { bytecode = true } = {}) {
  for (const file of deployableSources(unit.contracts)) {
    const dir = join(root, "out", basename(file));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${basename(file, ".sol")}.json`),
      JSON.stringify({ abi: [], bytecode: { object: bytecode ? "0x60806040" : "0x" } }));
  }
}

function seedManifest(root, unit, deployable) {
  mkdirSync(unitDir(root, unit), { recursive: true });
  writeFileSync(join(unitDir(root, unit), "keel.module.json"),
    `${JSON.stringify({ schema: "keel.module@1", id: unit.id, kind: unit.kind, visibility: "private", deployable }, null, 2)}\n`);
}

/**
 * A contracts tree shaped like the real one: every local unit is built, and every
 * external unit has a committed manifest but no artifacts at all.
 */
function buildTree(t) {
  const root = mkdtempSync(join(tmpdir(), "keel-manifests-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "9.9.9" }));
  for (const unit of LOCAL) seedArtifacts(root, unit);
  for (const unit of EXTERNAL) seedManifest(root, unit, committedDeployable(unit));
  return root;
}

function generate(root) {
  try {
    return { status: 0, stdout: execFileSync("node", [GENERATOR], { cwd: REPO, encoding: "utf8", env: { ...process.env, KEEL_CONTRACTS_DIR: root } }), stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

test("a missing artifact directory reads as unknown, not as an empty list", (t) => {
  const root = mkdtempSync(join(tmpdir(), "keel-artifacts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const out = join(root, "out");

  assert.equal(artifactNames(out, "Absent.sol"), null, "an absent directory is unknown");

  // present but carrying no creation bytecode — an interface or abstract base —
  // is the genuinely-not-deployable case, and must stay distinct from unknown.
  mkdirSync(join(out, "Abstract.sol"), { recursive: true });
  writeFileSync(join(out, "Abstract.sol", "Abstract.json"), JSON.stringify({ bytecode: { object: "0x" } }));
  assert.deepEqual(artifactNames(out, "Abstract.sol"), []);

  mkdirSync(join(out, "Real.sol"), { recursive: true });
  writeFileSync(join(out, "Real.sol", "Real.json"), JSON.stringify({ bytecode: { object: "0x6080" } }));
  writeFileSync(join(out, "Real.sol", "Helper.json"), JSON.stringify({ bytecode: { object: "0x6080" } }));
  assert.deepEqual(artifactNames(out, "Real.sol"), ["Helper", "Real"]);
});

test("resolveDeployable keeps the prior list rather than deriving from a partial build", (t) => {
  const root = mkdtempSync(join(tmpdir(), "keel-resolve-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const out = join(root, "out");
  mkdirSync(join(out, "Built.sol"), { recursive: true });
  writeFileSync(join(out, "Built.sol", "Built.json"), JSON.stringify({ bytecode: { object: "0x6080" } }));

  const prior = ["Built", "Unbuilt"];
  // Only one of the two files is built. Deriving here would write ["Built"] — a
  // truncation that loses Unbuilt just as surely as writing [] would.
  const partial = resolveDeployable({ contracts: ["Built.sol", "Unbuilt.sol"], outDir: out, prior });
  assert.equal(partial.derived, false);
  assert.deepEqual(partial.missing, ["Unbuilt.sol"]);
  assert.deepEqual(partial.deployable, prior, "a partial build must not truncate the list");

  const none = resolveDeployable({ contracts: ["Unbuilt.sol"], outDir: out, prior: null });
  assert.equal(none.deployable, null, "unknown with nothing to preserve stays null, never []");

  const full = resolveDeployable({ contracts: ["Built.sol"], outDir: out, prior });
  assert.equal(full.derived, true);
  assert.deepEqual(full.deployable, ["Built"], "a complete build derives fresh");

  // interfaces and libraries never carry bytecode, so their absence is not a gap
  const ignored = resolveDeployable({ contracts: ["Built.sol", "interfaces/IThing.sol", "libraries/Lib.sol"], outDir: out, prior });
  assert.deepEqual(ignored.missing, []);
  assert.deepEqual(ignored.deployable, ["Built"]);
});

test("regression: syncing an unbuilt external app does not empty its deployable list", (t) => {
  const root = buildTree(t);
  const before = Object.fromEntries(EXTERNAL.map((u) => [u.id, readManifest(root, u).deployable]));

  const run = generate(root);
  assert.equal(run.status, 0, `generator refused unexpectedly:\n${run.stderr}`);

  for (const unit of EXTERNAL) {
    const after = readManifest(root, unit).deployable;
    assert.ok(after.length > 0, `${unit.id} was emptied by a sync with no artifacts present`);
    assert.deepEqual(after, before[unit.id], `${unit.id} lost its deployable list`);
  }
  assert.match(run.stdout, /kept \d+ deployable from the existing manifest/u,
    "preserving a list must be reported, not silent");

  // The incident's downstream symptom: a deployment record naming a contract the
  // manifest no longer called deployable.
  const vault = EXTERNAL.find((u) => u.id === "vault-runner");
  if (vault) {
    const deployable = readManifest(root, vault).deployable;
    for (const contract of ["VaultCharacter721", "VaultArcadeRegistry"]) {
      assert.ok(deployable.includes(contract), `vault-runner no longer records ${contract} as deployable`);
    }
  }
});

test("a local unit with no artifacts is refused, and nothing on disk is touched", (t) => {
  const root = buildTree(t);
  const victim = LOCAL.find((u) => deployableSources(u.contracts).length > 0);
  assert.ok(victim, "expected at least one local unit with deployable sources");
  for (const file of deployableSources(victim.contracts)) {
    rmSync(join(root, "out", basename(file)), { recursive: true, force: true });
  }
  const externalBefore = Object.fromEntries(EXTERNAL.map((u) => [u.id, readManifest(root, u).deployable]));

  const run = generate(root);
  assert.equal(run.status, 1, "an unbuilt local unit must fail the sync");
  assert.match(run.stderr, /refusing to write manifests/u);
  assert.match(run.stderr, new RegExp(`${victim.id}: no artifacts`, "u"));
  assert.match(run.stderr, /forge build/u, "the message must say how to fix it");

  // Refusal is atomic: units resolved before the failure are not half-written.
  for (const unit of EXTERNAL) {
    assert.deepEqual(readManifest(root, unit).deployable, externalBefore[unit.id],
      `${unit.id} was rewritten despite the refusal`);
  }
});

test("an external unit with neither artifacts nor a manifest is refused, not written as empty", (t) => {
  const root = buildTree(t);
  const orphan = EXTERNAL[0];
  assert.ok(orphan, "expected at least one external unit");
  rmSync(unitDir(root, orphan), { recursive: true, force: true });

  const run = generate(root);
  assert.equal(run.status, 1, "there is no source of truth for this unit, so it must not be guessed");
  assert.match(run.stderr, new RegExp(`${orphan.id}: external unit with no artifacts`, "u"));
});

test("a built tree still derives deployable from bytecode, and abstract bases stay out", (t) => {
  const root = buildTree(t);
  const unit = LOCAL.find((u) => deployableSources(u.contracts).length > 1);
  assert.ok(unit, "expected a local unit with more than one deployable source");
  const [abstractFile, ...rest] = deployableSources(unit.contracts);
  // rebuild this one file as bytecode-less: present, but genuinely not deployable
  seedArtifacts(root, { ...unit, contracts: [abstractFile] }, { bytecode: false });

  const run = generate(root);
  assert.equal(run.status, 0, `generator refused unexpectedly:\n${run.stderr}`);

  const deployable = readManifest(root, unit).deployable;
  assert.ok(!deployable.includes(basename(abstractFile, ".sol")),
    "a present-but-bytecode-less contract is not deployable");
  assert.deepEqual(deployable, rest.map((c) => basename(c, ".sol")).sort());
});
