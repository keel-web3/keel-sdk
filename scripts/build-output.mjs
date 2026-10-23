import { rm } from "node:fs/promises";
import path from "node:path";

// Only compiler/package outputs owned by build.mjs. Never remove contracts,
// verification evidence, user assets, or dependency directories here.
export const buildPackages = [
  "protocol", "viewer", "sdk", "builder", "ethereum-adapter", "mcp",
  "sprite-codex", "studio-core", "sandbox-sdk",
];

export async function cleanBuildOutputs(root) {
  for (const name of buildPackages) {
    // rm unlinks a dist symlink without traversing its target.
    await rm(path.join(root, "packages", name, "dist"), { recursive: true, force: true });
  }
}
