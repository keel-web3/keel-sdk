import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { contractsRoot, root } from "./run.mjs";
import { compileCanonicalSolidityArtifacts } from "./solidity-compiler.mjs";

const contractNames = process.argv.slice(2);
if (contractNames.length === 0 || contractNames.some((name) => !/^[A-Za-z][A-Za-z0-9_]*$/u.test(name))) {
  throw new TypeError("Pass one or more Solidity contract names to compile.");
}
const compiled = await compileCanonicalSolidityArtifacts(root, { contractNames });
const artifactsRoot = path.resolve(process.env.KEEL_CONTRACTS_ARTIFACTS_DIR || path.join(contractsRoot, "artifacts"));
await mkdir(artifactsRoot, { recursive: true });
for (const [contractName, artifact] of compiled.artifacts) {
  await writeFile(path.join(artifactsRoot, `${contractName}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
}
for (const item of compiled.summary) {
  process.stdout.write(`${item.contractName}: ${item.creationBytes} creation / ${item.runtimeBytes} runtime bytes\n`);
}
