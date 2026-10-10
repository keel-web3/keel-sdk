import { readFileSync, statSync } from "node:fs";
import { measureKeelPublicationSimulationRequest } from "../packages/sdk/dist/owned-simulation-transport.js";

// Offline only. Input contains the exact captured requests for one or all SDK
// phases; output contains capacity metrics only, never calls or project bytes.
try {
  if (process.argv.length !== 3 || statSync(process.argv[2]).size > 64 * 1024 * 1024) throw new Error();
  const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const requests = Array.isArray(input) ? input : [input];
  if (!requests.length || requests.length > 3) throw new Error();
  const measured = requests.map(measureKeelPublicationSimulationRequest);
  console.log(JSON.stringify({ schema: "keel-owned-simulation-sizing@1", basis: "exact-request-envelope-sums", phaseCount: measured.length,
    phases: measured, requiredRpcGasCap: measured.reduce((max, value) => value.conservativeGasBudget > max ? value.conservativeGasBudget : max, 0n),
    requiredHttpBodyMiB: Math.ceil(Math.max(...measured.map(value => value.requestBytes)) / 1_048_576),
    executionMeasured: false, networkRequests: 0, signing: "not-performed", submission: "not-performed",
  }, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
} catch {
  console.error("Supply a local JSON file containing one to three exact, pinned eth_simulateV1 requests. No request content was printed or transmitted.");
  process.exitCode = 1;
}
