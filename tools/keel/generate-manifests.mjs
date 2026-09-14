/**
 * Writes ../keel-contracts/{modules,apps}/<id>/keel.module.json from the module map.
 *
 * `deployable` is derived from compiled artifacts rather than declared by hand: a
 * contract is deployable when forge emitted non-empty creation bytecode for it,
 * which excludes interfaces, libraries, and abstract bases automatically.
 *
 * Deriving from artifacts means an unbuilt tree has nothing to derive *from*, and
 * "I cannot see any bytecode" must never be recorded as "nothing here deploys" —
 * that silently erases a real list. So a missing artifact directory is `null`
 * (unknown), distinct from a present-but-bytecode-less one (`[]`, genuinely not
 * deployable), and a unit whose artifacts are unknown is never rederived:
 *
 *   external unit  its sources live in another repository, so absent artifacts are
 *                  the normal local state — keep the committed list, as visibility
 *                  is already kept across regeneration.
 *   local unit     its sources are right here, so absent artifacts mean an unbuilt
 *                  tree — refuse to write anything and ask for a `forge build`.
 *
 * Nothing is written until every unit resolves, so a refusal leaves the manifests
 * exactly as they were rather than half-rewritten.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { MODULES, TIER_OF } from "./module-map.mjs";
import { CONTRACTS_ROOT } from "./contracts-root.mjs";

const metaDir = (id) => join(CONTRACTS_ROOT, TIER_OF.get(id));

/**
 * Source files that could carry creation bytecode. Interfaces are never deployed,
 * and every library here is internal-only and inlined by the compiler — forge
 * still emits a stub for them, so they are filtered by path rather than by
 * bytecode. Excluding them here also means their absence from `out/` is not
 * mistaken for an unbuilt tree.
 */
export const deployableSources = (contracts) =>
  contracts.filter((c) => !c.startsWith("interfaces/") && !c.startsWith("libraries/"));

/**
 * Contract names with creation bytecode in `<out>/<SolFile>/`, or `null` when
 * that directory does not exist — unknown, which is not the same as none.
 */
export function artifactNames(outDir, solFile) {
  const dir = join(outDir, basename(solFile));
  if (!existsSync(dir)) return null;
  const names = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const a = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const code = a?.bytecode?.object ?? "";
      if (code.replace(/^0x/, "").length > 0) names.push(f.replace(/\.json$/, ""));
    } catch { /* artifact unreadable; treat as non-deployable */ }
  }
  return names.sort();
}

/**
 * The `deployable` list for one unit, plus the source files whose artifacts are
 * missing. Any missing artifact makes the whole derivation untrustworthy — a
 * partial build would otherwise write a truncated list, which is the same data
 * loss as an empty one — so the caller's `prior` list is kept intact instead.
 */
export function resolveDeployable({ contracts, outDir, prior = null }) {
  const missing = [];
  const found = [];
  for (const file of deployableSources(contracts)) {
    const names = artifactNames(outDir, file);
    if (names === null) missing.push(file);
    else found.push(...names);
  }
  if (missing.length) return { deployable: prior, missing, derived: false };
  return { deployable: [...new Set(found)].sort(), missing, derived: true };
}

function existingManifest(id) {
  const p = join(metaDir(id), id, "keel.module.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function main() {
  const OUT = join(CONTRACTS_ROOT, "out");
  const VERSION = JSON.parse(readFileSync(join(CONTRACTS_ROOT, "package.json"), "utf8")).version;

  // Resolve every unit before writing any of them, so a refusal is a no-op.
  const planned = [];
  const unbuilt = [];   // local units that need a build
  const orphaned = [];  // artifacts unknown and no committed list to fall back on
  const preserved = []; // external units keeping their committed list

  for (const m of MODULES) {
    const existing = existingManifest(m.id);
    const { deployable, missing, derived } = resolveDeployable({
      contracts: m.contracts,
      outDir: OUT,
      prior: existing?.deployable ?? null,
    });

    if (!derived) {
      if (!m.external) unbuilt.push({ id: m.id, missing });
      else if (deployable === null) orphaned.push({ id: m.id, missing });
      else preserved.push({ id: m.id, kept: deployable.length });
    }

    planned.push({
      m,
      // recorded by `keel repos --sync`; drives install instructions, nothing else
      visibility: existing?.visibility ?? null,
      deployable: deployable ?? [],
    });
  }

  if (unbuilt.length || orphaned.length) {
    console.error("keel: refusing to write manifests — `deployable` cannot be derived.\n");
    for (const { id, missing } of unbuilt) {
      console.error(`  ${id}: no artifacts for ${missing.length} source file${missing.length === 1 ? "" : "s"} (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", …" : ""})`);
    }
    if (unbuilt.length) console.error("\n  These units build from this tree — run `forge build` in keel-contracts, then retry.");
    for (const { id } of orphaned) {
      console.error(`  ${id}: external unit with no artifacts and no existing manifest to preserve.`);
    }
    if (orphaned.length) console.error("\n  Nothing on disk records what these deploy. Restore the manifest, or build the unit's own repository into keel-contracts/out.");
    console.error("\nNo manifest was modified.");
    process.exit(1);
  }

  let written = 0;
  for (const { m, visibility, deployable } of planned) {
    const dir = join(metaDir(m.id), m.id);
    mkdirSync(join(dir, "deployments"), { recursive: true });
    const manifest = {
      schema: "keel.module@1",
      id: m.id,
      kind: m.kind,
      title: m.title,
      group: m.group,
      summary: m.summary,
      version: VERSION,
      repo: m.kind === "app" ? null : `keel-web3/${m.id}`,
      visibility,
      deps: m.deps,
      devDeps: m.devDeps ?? [],
      sources: `src/${TIER_OF.get(m.id)}/${m.id}`,
      tests: `test/${TIER_OF.get(m.id)}/${m.id}`,
      contracts: m.contracts,
      deployable,
      verify: {
        build: "forge build",
        test: `forge test --match-path 'test/${TIER_OF.get(m.id)}/${m.id}/*'`,
        static: "node scripts/solidity-static-check.mjs",
        sizeLimitBytes: 24576,
      },
    };
    writeFileSync(join(dir, "keel.module.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    written++;
  }

  console.log(`wrote ${written} manifests under keel-contracts/{modules,apps}/`);
  console.log(planned.map(({ m, deployable }) =>
    `  ${(m.kind === "app" ? "app " : "    ")}${m.id.padEnd(32)} ${String(m.contracts.length).padStart(3)} files, ${String(deployable.length).padStart(2)} deployable`).join("\n"));
  for (const { id, kept } of preserved) {
    console.log(`  note  ${id}: artifacts absent (external unit) — kept ${kept} deployable from the existing manifest`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
