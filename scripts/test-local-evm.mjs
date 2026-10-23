import { run } from "./run.mjs";
import { LOCAL_EVM_TEST_FILES, validateTestSuiteClassification } from "./test-suites.mjs";

const issues = validateTestSuiteClassification();
if (issues.length) throw new Error(issues.join("\n"));
// Requires an already cached exact Geth Docker image, installed Chromium and
// exact local contracts. The tests never install tools or use public RPC.
run("node", ["scripts/build.mjs"]);
run("node", ["--test", "--test-concurrency=1", ...LOCAL_EVM_TEST_FILES]);
