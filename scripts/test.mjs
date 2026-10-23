import { run } from "./run.mjs";
import { DEFAULT_TEST_FILES, validateTestSuiteClassification } from "./test-suites.mjs";

const classificationIssues = validateTestSuiteClassification();
if (classificationIssues.length > 0) throw new Error(classificationIssues.join("\n"));

run("node", ["scripts/build.mjs"]);
const concurrency = Number(process.env.KEEL_TEST_CONCURRENCY ?? "2");
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) throw new Error("KEEL_TEST_CONCURRENCY must be an integer from 1 through 64.");
run("node", ["--test", `--test-concurrency=${concurrency}`, ...DEFAULT_TEST_FILES]);
