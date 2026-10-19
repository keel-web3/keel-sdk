import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { compileCanonicalSolidityArtifacts } from "../scripts/solidity-compiler.mjs";

test("canonical target build discovers modular sources and resolves the checkout's pinned remappings", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "keel-canonical-compiler-"));
  try {
    const contractsRoot = path.join(directory, "keel-contracts");
    const modules = path.join(contractsRoot, "src/modules/example");
    await mkdir(modules, { recursive: true });
    await writeFile(path.join(contractsRoot, "remappings.txt"), "@keel/=src/modules/\n");
    await writeFile(path.join(modules, "Value.sol"), "pragma solidity ^0.8.36; library Value { function read() internal pure returns(uint) { return 42; } }\n");
    await writeFile(path.join(modules, "Example.sol"), 'pragma solidity ^0.8.36; import {Value} from "@keel/example/Value.sol"; contract Example { function read() external pure returns(uint) { return Value.read(); } }\n');
    // An unrelated invalid source must not enter a selected target build.
    await writeFile(path.join(modules, "Unrelated.sol"), "not Solidity\n");
    const compiled = await compileCanonicalSolidityArtifacts(directory, { contractsRoot, contractNames: ["Example"] });
    assert.match(compiled.compilerVersion, /^0\.8\.36\+/u);
    assert.deepEqual([...compiled.artifacts.keys()], ["Example"]);
    const artifact = compiled.artifacts.get("Example");
    assert.equal(artifact.sourceName, "src/modules/example/Example.sol");
    assert.ok(artifact.runtimeBytes > 0 && artifact.runtimeBytes <= 24_576);
    assert.ok(artifact.methodIdentifiers["read()"]);
    const metadata = JSON.parse(artifact.metadata);
    assert.deepEqual(metadata.settings.remappings, [":@keel/=src/modules/"]);
    assert.equal(metadata.settings.optimizer.runs, 50);
    assert.equal(metadata.settings.viaIR, true);
    assert.equal(metadata.settings.evmVersion, "prague");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
