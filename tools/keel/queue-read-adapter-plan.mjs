import { readFile, writeFile } from "node:fs/promises";
import { planQueueReadAdapter } from "./lib/queue-read-adapter-plan-core.mjs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("Usage: node tools/keel/queue-read-adapter-plan.mjs input.json output.json");
}

const input = JSON.parse(await readFile(inputPath, "utf8"));
const plan = planQueueReadAdapter(input);
const json = JSON.stringify(plan, (_, value) => (typeof value === "bigint" ? value.toString() : value), 2);
await writeFile(outputPath, `${json}\n`);
console.log(`Prepared ${plan.reads.length} unique reads, ${plan.gates.length} gates and ${plan.bounds.length} bounds.`);
