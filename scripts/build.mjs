import "./workspace-links.mjs";
import { run, tsc } from "./run.mjs";

run("node", ["scripts/build-keel-market-wallet.mjs"]);

tsc("packages/protocol/tsconfig.json");
tsc("packages/viewer/tsconfig.json");
tsc("packages/sdk/tsconfig.json");
run("node", ["packages/sdk/scripts/package-canonical-shell.mjs"]);
run("node", ["packages/sdk/scripts/package-layered-runtime.mjs"]);
tsc("packages/builder/tsconfig.json");
tsc("packages/ethereum-adapter/tsconfig.json");
tsc("packages/mcp/tsconfig.json");
run("node", ["packages/mcp/scripts/package-skills.mjs"]);
tsc("packages/sprite-codex/tsconfig.json");
tsc("packages/studio-core/tsconfig.json");
tsc("packages/sandbox-sdk/tsconfig.json");
console.log(
);
