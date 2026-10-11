import { pathToFileURL } from "node:url";
import { createKeelRpcPool, resolveKeelRpcConfiguration } from "../packages/sdk/dist/rpc.js";
import { createKeelPublicSepoliaSimulationPool } from "../packages/sdk/dist/public-simulation-pool.js";
import { keelSimulationTransportFailure, keelSimulationTransportDiagnostic } from "../packages/sdk/dist/publication-preflight.js";
import { resolveKeelTransactionGasPolicy } from "../packages/sdk/dist/transaction-gas-policy.js";

export const APPROVED_PUBLICNODE_SEPOLIA_URL = "https://ethereum-sepolia-rpc.publicnode.com";

const zero = `0x${"0".repeat(40)}`, hex = n => `0x${BigInt(n).toString(16)}`;
/** Explicit operator diagnostic only. No retries, project bytes, or private recipient approval.
 * Use the production selector's complete public qualification so report success
 * cannot bypass its fresh-head, linked-header, strict-nonce or execution checks. */
export async function probePublicSimulationCandidates({ rpcUrls = resolveKeelRpcConfiguration({ chainId: 11155111 }).rpcUrls, fetchImpl = fetch, minIntervalMs = 250 } = {}) {
  const report = { schema: "keel-public-simulation-pool-probe@2", checkedAt: new Date().toISOString(), chainId: 11155111,
    privateProjectDataSent: false, signing: "not-performed", submission: "not-performed", publicationVerified: false, candidates: [] };
  for (const url of rpcUrls) {
    const item = { endpoint: url, publicProbes: [], largeRequestBodyCapacity: "not-tested", privateExecutionCapacity: "not-tested" };
    const observe = async (endpoint, init) => {
      const body = JSON.parse(init.body);
      const calls = body.method === "eth_simulateV1" ? body.params[0].blockStateCalls.flatMap(block => block.calls) : undefined;
      if (calls && !calls.every(call => call.from === zero && call.to === zero && call.data === "0x" && call.value === "0x0"))
        throw new Error("Non-public probe refused.");
      const probe = calls ? { blockCount: calls.length, validation: body.params[0].validation,
        requestedGas: calls.map(call => BigInt(call.gas).toString()), requestBytes: Buffer.byteLength(init.body) } : undefined;
      if (probe) item.publicProbes.push(probe);
      const response = await fetchImpl(endpoint, init);
      item.lastResponse = { method: body.method, httpStatus: response.status };
      if (probe) probe.httpStatus = response.status;
      let copy;
      try { copy = await response.clone().json(); } catch { /* HTTP/access failures need not contain JSON. */ }
      if (Number.isInteger(copy?.error?.code)) {
        item.lastResponse.rpcCode = copy.error.code;
        if (probe) probe.rpcCode = copy.error.code;
      }
      if (probe && Array.isArray(copy?.result)) {
        probe.returnedGas = copy.result.flatMap(block => block.transactions ?? []).map(tx => typeof tx.gas === "string" ? BigInt(tx.gas).toString() : "missing");
        probe.gasUsed = copy.result.flatMap(block => block.calls ?? []).map(call => typeof call.gasUsed === "string" ? BigInt(call.gasUsed).toString() : "missing");
        probe.maxUsedGas = copy.result.flatMap(block => block.calls ?? []).map(call => typeof call.maxUsedGas === "string" ? BigInt(call.maxUsedGas).toString() : "missing");
      }
      return response;
    };
    const readPool = createKeelRpcPool({ rpcUrls: [url], chainId: 11155111, timeoutMs: 10_000, minIntervalMs, fetchImpl: observe });
    const pinned = readPool.pin(0);
    let transport;
    try {
      const block = await pinned.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
      item.block = { number: block.number, hash: block.hash, timestamp: block.timestamp, gasLimit: block.gasLimit };
      const policy = resolveKeelTransactionGasPolicy({ chainId: 11155111, blockTimestamp: BigInt(block.timestamp), blockGasLimit: BigInt(block.gasLimit) });
      item.requiredEnvelope = policy.maximumTotalGas.toString();
      item.requestedEnvelopeSum = (40n * policy.maximumTotalGas).toString();
      transport = createKeelPublicSepoliaSimulationPool({ rpcUrls: [url], approvedProjectRpcUrls: [],
        readTransport: pinned, block: { number: BigInt(block.number), hash: block.hash }, fetchImpl: observe, minIntervalMs });
      // The production selector builds and verifies both full public sequences,
      // then refuses the unapproved final request. No final request is needed.
      await transport.request({ method: "eth_simulateV1", params: [{ validation: true, traceTransfers: false, returnFullTransactions: true,
        blockStateCalls: Array.from({ length: 40 }, () => ({ calls: [{ from: zero, to: zero, value: "0x0", data: "0x", gas: hex(policy.maximumTotalGas) }] })) }, block.number] });
      throw new Error("Public-only qualification unexpectedly allowed an unapproved final request.");
    } catch (error) {
      if (error?.kind === "configuration-invalid" && error.diagnostic?.recipientApprovalRequired === 1) {
        item.publicQualification = "passed";
        item.publicSequence = "40-empty-calls-passed-not-private-execution-capacity";
        const strict = item.publicProbes.findLast(probe => probe.blockCount === 40 && probe.validation === true);
        if (!strict) throw new Error("Qualification omitted the complete strict public sequence.");
        item.observedPublicGasUsedSum = strict.gasUsed.reduce((sum, value) => sum + BigInt(value), 0n).toString();
        item.observedPublicMaxUsedGasSum = strict.maxUsedGas.reduce((sum, value) => sum + BigInt(value), 0n).toString();
        item.largestAcceptedPublicRequestBytes = Math.max(...item.publicProbes.filter(probe => probe.returnedGas).map(probe => probe.requestBytes));
      } else {
        const failure = keelSimulationTransportFailure(error);
        item.failure = { kind: failure.kind, diagnostic: keelSimulationTransportDiagnostic(failure) };
      }
    } finally { await transport?.close(); }
    report.candidates.push(item);
  }
  return report;
}
/** Choose the recipient before any network request. Do not accept arbitrary URLs. */
export function publicProbeOptions(args) {
  const allowed = new Set(["--public-only", "--approved-publicnode-only", "--require-qualified"]);
  if (new Set(args).size !== args.length || args.some(arg => !allowed.has(arg)) || !args.includes("--public-only")) {
    throw new Error("Use --public-only [--approved-publicnode-only] [--require-qualified]; only public empty calls are sent.");
  }
  return {
    ...(args.includes("--approved-publicnode-only") ? { rpcUrls: [APPROVED_PUBLICNODE_SEPOLIA_URL] } : {}),
    requireQualified: args.includes("--require-qualified"),
  };
}

export function publicProbeExitCode(report, requireQualified) {
  if (!requireQualified) return 0; // An explicit observational diagnostic, not a gate.
  return report.candidates.length > 0 && report.candidates.every(candidate =>
    candidate.publicQualification === "passed" && !candidate.failure) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { requireQualified, ...options } = publicProbeOptions(process.argv.slice(2));
  const report = await probePublicSimulationCandidates(options);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = publicProbeExitCode(report, requireQualified);
}
