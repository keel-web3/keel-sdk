/**
 * Where this repository's sibling repositories live.
 *
 * keel-contracts (and vault-of-the-fallen) sit beside this repository rather
 * than inside it, so their paths have to be derived rather than declared — and
 * the obvious derivation, `<repo>/..`, is wrong in a git worktree. A linked
 * worktree checks out under `.claude/worktrees/<name>/`, where the siblings
 * resolve to directories that do not exist; that is why the test suite could not
 * run from one. Deriving the *main* worktree's parent instead fixes it without
 * anyone having to pass a path, because a worktree's shared git directory
 * always lives in the main checkout.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dirname, "../..");

/** the main worktree's root — the parent of the shared git directory */
function mainWorktree(from) {
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: from, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return common ? dirname(resolve(from, common)) : null;
  } catch { return null; }
}

/** the directory holding this repository and its siblings */
export const SIBLING_ROOT = resolve(mainWorktree(REPO_ROOT) ?? REPO_ROOT, "..");

/** a path inside a sibling repository, e.g. sibling("vault-of-the-fallen", "contracts") */
export const sibling = (...parts) => join(SIBLING_ROOT, ...parts);

/** `KEEL_CONTRACTS_DIR` overrides, so a run can be pointed at a scratch tree */
export const CONTRACTS_ROOT = process.env.KEEL_CONTRACTS_DIR
  ? resolve(process.env.KEEL_CONTRACTS_DIR)
  : sibling("keel-contracts");

/** true when the contracts tree is actually on disk; callers report their own errors */
export const contractsPresent = () => existsSync(CONTRACTS_ROOT);
