import { createKeelRpcPool, resolveKeelRpcConfiguration, KeelRpcResponseError } from "../packages/sdk/dist/rpc.js";
import { createPinnedKeelSepoliaSimulationTransport } from "../packages/sdk/dist/simulation-connection.js";
import { keelSimulationTransportFailure, keelSimulationTransportDiagnostic } from "../packages/sdk/dist/publication-preflight.js";
import { resolveKeelTransactionGasPolicy } from "../packages/sdk/dist/transaction-gas-policy.js";

if (process.argv.slice(2).join(" ") !== "--public-only") throw new Error("Use --public-only: this command probes only the maintained indexed endpoints with public empty calls.");
const urls = resolveKeelRpcConfiguration({ chainId: 11155111 }).rpcUrls;
const zero = `0x${"0".repeat(40)}`, hex = n => `0x${BigInt(n).toString(16)}`;
const report = { schema: "keel-public-simulation-pool-probe@1", checkedAt: new Date().toISOString(), chainId: 11155111,
  privateProjectDataSent: false, signing: "not-performed", submission: "not-performed", publicationVerified: false, candidates: [] };
for (const url of urls) {
  const probes = [];
  const fetchImpl = async (endpoint, init) => {
    const body = JSON.parse(init.body);
    if (body.method === "eth_simulateV1") {
      const calls = body.params[0].blockStateCalls.flatMap(block => block.calls);
      if (!calls.every(call => call.from === zero && call.to === zero && call.data === "0x" && call.value === "0x0")) throw new Error("Non-public probe refused.");
      probes.push({ blockCount: calls.length, validation: body.params[0].validation, requestedGas: calls.map(call => BigInt(call.gas).toString()) });
    }
    const response = await fetch(endpoint, init);
    if (body.method === "eth_simulateV1" && response.ok) {
      const copy = await response.clone().json();
      if (Array.isArray(copy.result)) probes.at(-1).returnedGas = copy.result.flatMap(block => block.transactions ?? []).map(tx => typeof tx.gas === "string" ? BigInt(tx.gas).toString() : "missing");
      if (copy.error && Number.isInteger(copy.error.code)) probes.at(-1).rpcCode = copy.error.code;
    }
    return response;
  };
  const pool = createKeelRpcPool({ rpcUrls: [url], chainId: 11155111, timeoutMs: 10_000, simulationTimeoutMs: 30_000, fetchImpl });
  const pinned = pool.pin(0);
  const transport = createPinnedKeelSepoliaSimulationTransport(async () => ({ protocol: "https", close() {}, async requestAsync({ body }) {
    try { return { result: await pinned.request(body) }; } catch (error) { if (error instanceof KeelRpcResponseError) return { error }; throw error; }
  } }), { maximumConnectionAttempts: 1 });
  const item = { endpoint: url, publicProbes: probes };
  try {
    const block = await pinned.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
    const policy = resolveKeelTransactionGasPolicy({ chainId: 11155111, blockTimestamp: BigInt(block.timestamp), blockGasLimit: BigInt(block.gasLimit) });
    item.block = { number: block.number, hash: block.hash, timestamp: block.timestamp, gasLimit: block.gasLimit };
    item.requiredEnvelope = policy.maximumTotalGas.toString();
    await transport.qualify(policy.maximumTotalGas);
    item.publicQualification = "passed";
    const nonce = BigInt(await pinned.request({ method: "eth_getTransactionCount", params: [zero, block.number] }));
    await transport.request({ method: "eth_simulateV1", params: [{ validation: true, traceTransfers: false, returnFullTransactions: true,
      blockStateCalls: Array.from({ length: 40 }, (_, i) => ({ calls: [{ from: zero, to: zero, value: "0x0", data: "0x", gas: hex(policy.maximumTotalGas), nonce: hex(nonce + BigInt(i)), gasPrice: hex(BigInt(block.baseFeePerGas) * 2n + 1n) }] })) }, block.number] });
    item.publicSequence = "40-empty-calls-passed-not-private-execution-capacity";
  } catch (error) {
    const failure = keelSimulationTransportFailure(error);
    item.failure = { kind: failure.kind, diagnostic: keelSimulationTransportDiagnostic(failure) };
  } finally { await transport.close(); }
  report.candidates.push(item);
}
console.log(JSON.stringify(report, null, 2));
