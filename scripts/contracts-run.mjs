/**
 * Runs a command inside the sibling keel-contracts repository.
 *
 * The contracts moved out of `packages/contracts/` into their own repository, so
 * the `--root packages/contracts` these scripts used to pass no longer points at
 * anything. Resolving the tree through `contracts-root.mjs` keeps them working
 * from a linked git worktree too, where a relative `../keel-contracts` does not.
 *
 *   node scripts/contracts-run.mjs forge test --gas-report
 */
import { spawnSync } from "node:child_process";
import { CONTRACTS_ROOT, contractsPresent } from "../tools/keel/contracts-root.mjs";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/contracts-run.mjs <command> [args...]");
  process.exit(2);
}
if (!contractsPresent()) {
  console.error(`keel-contracts is not checked out at ${CONTRACTS_ROOT}.`);
  console.error("Clone it beside this repository, or set KEEL_CONTRACTS_DIR.");
  process.exit(1);
}

const result = spawnSync(command, args, { cwd: CONTRACTS_ROOT, stdio: "inherit" });
if (result.error) {
  console.error(`${command}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
