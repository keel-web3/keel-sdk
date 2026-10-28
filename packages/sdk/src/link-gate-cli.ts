#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { formatKeelLinkGateReport, loadKeelLinkGateInfrastructure, scanKeelLinkGate, type KeelLinkGateInput, type KeelLinkGateResource } from "./link-gate.js";

/**
 * keel-link-gate [--route NAME] [--chain-id N] [--json] [--text STRING] [--hex 0x..] FILE...
 *
 * Exit 0: clear. Exit 1: locators found (the push would be refused). Exit 2: usage or read error.
 */
const usage = "Usage: keel-link-gate [--route NAME] [--chain-id N] [--json] [--text STRING] [--hex 0x..] FILE...";

async function main(argv: readonly string[]): Promise<number> {
  const resources: KeelLinkGateResource[] = [];
  let route = "keel-link-gate-cli", chainId: number | undefined, json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new TypeError(`${arg} needs a value.`);
      return next;
    };
    if (arg === "--help" || arg === "-h") { console.log(usage); return 0; }
    else if (arg === "--json") json = true;
    else if (arg === "--route") route = value();
    else if (arg === "--chain-id") {
      chainId = Number(value());
      if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new TypeError("--chain-id must be a positive integer.");
    } else if (arg === "--text") resources.push({ id: "text", bytes: new TextEncoder().encode(value()) });
    else if (arg === "--hex") {
      const hex = value().replace(/^0x/iu, "");
      if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/iu.test(hex)) throw new TypeError("--hex must be even-length hexadecimal.");
      resources.push({ id: "hex", bytes: Uint8Array.from(Buffer.from(hex, "hex")) });
    } else if (arg.startsWith("--")) throw new TypeError(`Unknown option ${arg}.`);
    else resources.push({ id: arg, bytes: new Uint8Array(await readFile(arg)) });
  }
  if (resources.length === 0) throw new TypeError("Supply at least one file, --text or --hex.");
  const input: KeelLinkGateInput = { route, resources, workspaceRoot: process.cwd(), ...(chainId === undefined ? {} : { chainId }) };
  let report = scanKeelLinkGate(input);
  if (report.status === "blocked") { await loadKeelLinkGateInfrastructure(); report = scanKeelLinkGate(input); }
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(formatKeelLinkGateReport(report));
    if (report.status === "clear" && report.suggestions.length > 0) {
      console.log("Embedded libraries with registered KEEL modules:");
      for (const suggestion of report.suggestions.slice(0, 8)) console.log(`- ${suggestion.resource}: ${suggestion.module.moduleId}@${suggestion.module.version} ${suggestion.module.digest} (${suggestion.match.kind} ${suggestion.match.evidence}; ${suggestion.availability.status})`);
    }
  }
  return report.status === "clear" ? 0 : 1;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage);
  process.exitCode = 2;
});
