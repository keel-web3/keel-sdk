// Public constants only. No project input, credentials, signing or submission.
// Reports environment/provider failure without making an offline CI gate pass
// stand in for live capacity. The artifact retains the observed outcome.
import { createPublicClient, http } from 'viem';
import { createPinnedKeelSepoliaSimulationTransport } from '../packages/sdk/dist/simulation-connection.js';
import { keelSimulationTransportDiagnostic } from '../packages/sdk/dist/publication-preflight.js';

const url = 'https://ethereum-sepolia-rpc.publicnode.com';
const observer = createPublicClient({ transport: http(url, { retryCount: 0, timeout: 15000, fetchOptions: { redirect: 'error' } }) });
const attempts = [];
const transport = createPinnedKeelSepoliaSimulationTransport(async () => {
  const abort = new AbortController();
  const client = createPublicClient({ transport: http(url, { raw: true, retryCount: 0, timeout: 15000, batch: false, fetchOptions: { redirect: 'error', signal: abort.signal } }) });
  return { protocol: 'https', close() { abort.abort(); }, requestAsync: ({ body }) => client.request(body, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) }) };
}, { onAttempt: diagnostic => attempts.push(diagnostic) });
const report = { schema: 'keel-public-http-capacity-probe@1', capturedAt: new Date().toISOString(), requestedGasLimit: '200000000', endpoint: url,
  publicEmptyCallsOnly: true, projectCalldataSent: false, signing: 'not-performed', submission: 'not-performed' };
try {
  const block = await observer.request({ method: 'eth_getBlockByNumber', params: ['latest', false] });
  if (!block || !/^0x[0-9a-f]+$/iu.test(block.number) || !/^0x[0-9a-f]+$/iu.test(block.baseFeePerGas)) throw new Error('Incomplete public snapshot');
  const sender = '0x0000000000000000000000000000000000000000';
  const nonce = await observer.request({ method: 'eth_getTransactionCount', params: [sender, block.number] });
  const result = await transport.request({ method: 'eth_simulateV1', params: [{ blockStateCalls: [{ calls: [{ from: sender, to: sender, data: '0x', value: '0x0', gas: '0xbebc200', nonce, gasPrice: `0x${(BigInt(block.baseFeePerGas) * 2n + 1n).toString(16)}` }] }], validation: true, traceTransfers: false, returnFullTransactions: true }, block.number] });
  if (result?.[0]?.calls?.[0]?.status !== '0x1' || result[0].calls[0].returnData !== '0x') throw new Error('Public empty call failed');
  Object.assign(report, { success: true, qualifiedProbeGas: transport.qualifiedProbeGas.toString(), returnedGasLimit: BigInt(result[0].transactions[0].gas).toString(), blockNumber: block.number });
} catch (error) {
  Object.assign(report, { success: false, kind: error.kind ?? 'environment-or-transport', diagnostic: keelSimulationTransportDiagnostic(error) });
} finally {
  await transport.close();
  console.log(JSON.stringify({ ...report, attempts }));
}
