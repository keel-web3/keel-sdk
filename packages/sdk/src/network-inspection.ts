import { KEEL_DEPLOYMENTS } from './modules.js';
import { KEEL_INLINE_SAFE_RPC_GAS, keelInlineReadGasLimit } from './presentation.js';
export interface KeelNetworkInspectionTarget {
  readonly rpcUrl: string;
  readonly family: "ethereum" | "tezos";
  readonly chainId?: number;
  readonly network?: string;
  readonly holdAddress?: string;
  readonly builderAddress?: string;
}
export interface KeelNetworkCall extends KeelNetworkInspectionTarget {
  readonly to: string;
  readonly data: string;
  readonly value?: string;
  readonly from?: string;
  readonly purpose: "publication" | "presentation-read";
}
type RpcBody = { jsonrpc: string; id: number; method: string; params: readonly unknown[] };
function rpcUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.hash || !(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("Use HTTPS RPC, or HTTP on localhost, without a URL username or password.");
  return url.href;
}

async function json(endpoint: string, body: RpcBody | null, fetcher: typeof fetch): Promise<any> {
  const response = await fetcher(endpoint, { method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}), redirect: 'error', signal: AbortSignal.timeout(12_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Network read returned HTTP ${response.status}.`); }
  if (!response.body) throw new Error('Network read returned no body.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try { for (;;) { const result = await reader.read(); if (result.done) break; total += result.value.byteLength; if (total > 512 * 1024) throw new Error('Network response exceeds the inspection limit.'); chunks.push(result.value); } }
  finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (body && (value.jsonrpc !== '2.0' || value.id !== body.id || value.error || !Object.hasOwn(value, 'result'))) throw new Error(`${body.method} is unavailable or returned an invalid response.`);
  return body ? value.result : value;
}
const quantity = (value: unknown, label: string) => { if (typeof value !== 'string' || !/^0x[0-9a-f]{1,64}$/i.test(value)) throw new Error(`Network returned an invalid ${label}.`); return BigInt(value); };
const integer = (value: unknown, label: string) => { if (typeof value !== 'string' || !/^\d{1,30}$/.test(value)) throw new Error(`Network returned an invalid ${label}.`); return value; };

/** Fresh read-only network facts. An unknown network is valid; its KEEL deployments need explicit setup. */
export async function inspectNetwork(input: KeelNetworkInspectionTarget, fetcher: typeof fetch = fetch) {
  if (!input || !['ethereum', 'tezos'].includes(input.family) || typeof input.rpcUrl !== 'string' || input.rpcUrl.length > 2048) throw new TypeError('Choose an EVM or Tezos family and an exact RPC URL.');
  if (input.chainId !== undefined && (!Number.isSafeInteger(input.chainId) || input.chainId <= 0 || input.family !== 'ethereum')) throw new TypeError('An EVM target requires a positive safe chain ID.');
  if (input.network !== undefined && (typeof input.network !== 'string' || input.network.length > 64 || input.family !== 'tezos')) throw new TypeError('A network identity belongs to a Tezos target.');
  for (const address of [input.holdAddress, input.builderAddress]) if (address !== undefined && (input.family !== 'ethereum' || !/^0x[0-9a-f]{40}$/i.test(address))) throw new TypeError('KEEL EVM deployments require exact contract addresses.');
  const endpoint = rpcUrl(input.rpcUrl);
  if (input.family === 'tezos') {
    const get = (route: string) => { const url = new URL(endpoint); url.pathname = `${url.pathname.replace(/\/$/, '')}${route}`; return json(url.href, null, fetcher); };
    const [network, header, constants] = await Promise.all([get('/chains/main/chain_id'), get('/chains/main/blocks/head/header'), get('/chains/main/blocks/head/context/constants')]);
    if (typeof network !== 'string' || !/^Net[1-9A-HJ-NP-Za-km-z]{12}$/.test(network)) throw new Error('RPC did not return a Tezos network identity.');
    if (input.network && input.network !== network) throw new Error('RPC network changed. The saved target has not been replaced.');
    if (!Number.isSafeInteger(header.level) || header.level < 0) throw new Error('Invalid Tezos head level.');
    return { family: 'tezos' as const, network, block: String(header.level), checkedAt: new Date().toISOString(), blockTimestamp: header.timestamp, operationGasLimit: integer(constants.hard_gas_limit_per_operation, 'operation gas limit'), blockGasLimit: integer(constants.hard_gas_limit_per_block, 'block gas limit'), storageCostMutezPerByte: integer(constants.cost_per_byte, 'storage byte cost'), fees: { status: 'requires-operation-simulation', note: 'Tezos execution gas, storage burn and baker fees are separate; an EVM gas-price formula does not apply.' }, deployments: [], setup: 'Supply and verify KEEL originated contracts for this exact Tezos network.', publicationReady: false };
  }
  if (input.family !== 'ethereum') throw new Error('Choose EVM or Tezos for this RPC.');
  let id = 0;
  const call = (method: string, params: readonly unknown[] = []) => json(endpoint, { jsonrpc: '2.0', id: ++id, method, params }, fetcher);
  const [chain, block, gasResult, priorityResult] = await Promise.all([call('eth_chainId'), call('eth_getBlockByNumber', ['latest', false]), call('eth_gasPrice').then((value) => ({ value }), () => ({ value: undefined })), call('eth_maxPriorityFeePerGas').then((value) => ({ value }), () => ({ value: undefined }))]);
  const chainId = Number(quantity(chain, 'chain ID'));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('RPC chain ID is not supported safely.');
  if (input.chainId && input.chainId !== chainId) throw new Error('RPC chain changed. The saved target has not been replaced.');
  if (!block || typeof block !== 'object') throw new Error('The latest network block is unavailable.');
  const blockGasLimit = quantity(block.gasLimit, 'block gas limit');
  const blockNumber = quantity(block.number, 'block number');
  const timestamp = Number(quantity(block.timestamp, 'block timestamp'));
  const gasPrice = gasResult.value === undefined ? null : quantity(gasResult.value, 'gas price');
  const baseFee = block.baseFeePerGas === undefined ? null : quantity(block.baseFeePerGas, 'base fee');
  const priorityFee = priorityResult.value === undefined ? null : quantity(priorityResult.value, 'priority fee');
  const deployments = await Promise.all(['KeelHold', 'KeelHarnessBuilder', 'KeelRawTokenURIBuilder'].map(async (contract) => {
    const custom = contract === 'KeelHold' ? input.holdAddress : contract === 'KeelRawTokenURIBuilder' ? input.builderAddress : undefined;
    const candidates = custom ? [{ address: custom }] : KEEL_DEPLOYMENTS.filter((record) => record.chainId === chainId && record.contract === contract);
    const addresses = [...new Set(candidates.map((record) => record.address.toLowerCase()))];
    if (addresses.length !== 1) return { contract, status: addresses.length ? 'choose-an-instance' : 'needs-setup', candidates: addresses };
    try { const code = await call('eth_getCode', [addresses[0], block.number]); if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(code)) throw new Error(); return { contract, address: addresses[0], status: code === '0x' ? 'no-code' : 'code-present-identity-unverified' }; }
    catch { return { contract, address: addresses[0], status: 'read-unavailable' }; }
  }));
  return { family: 'ethereum' as const, chainId, block: blockNumber.toString(), checkedAt: new Date().toISOString(), blockTimestamp: new Date(timestamp * 1000).toISOString(), blockGasLimit: blockGasLimit.toString(), inlineReadGasLimit: keelInlineReadGasLimit(blockGasLimit).toString(), maximumInlineReadGas: KEEL_INLINE_SAFE_RPC_GAS.toString(), fees: { status: gasPrice === null ? 'unavailable' : 'live-rpc-quote', gasPriceWei: gasPrice?.toString() ?? null, baseFeeWei: baseFee?.toString() ?? null, priorityFeeWei: priorityFee?.toString() ?? null, note: 'Use exact prepared calls for estimation. Rollup L1 data fees and chain-specific charges may be additional.' }, deployments, publicationReady: false, setup: 'Resolve deployed KEEL instances, verify their code and active shell/module registry, or prepare deployment of missing modules. Never reuse another chain\'s addresses.' };
}

export async function estimateNetworkCall(input: KeelNetworkCall, fetcher: typeof fetch = fetch) {
  if (!['publication', 'presentation-read'].includes(input.purpose)) throw new TypeError('Separate publication and presentation-read estimates.');
  const snapshot = await inspectNetwork(input, fetcher);
  if (snapshot.family !== 'ethereum') throw new Error('Tezos costs require an operation simulation with exact manager contents.');
  const call = { to: input.to, data: input.data, value: input.value ?? '0x0', ...(input.from ? { from: input.from } : {}) };
  if (!/^0x[0-9a-f]{40}$/i.test(call.to) || !/^0x(?:[0-9a-f]{2})*$/i.test(call.data) || call.from && !/^0x[0-9a-f]{40}$/i.test(call.from) || !/^0x[0-9a-f]+$/i.test(call.value)) throw new Error('Estimate requires an exact target, calldata and value.');
  const gas = quantity(await json(rpcUrl(input.rpcUrl), { jsonrpc: '2.0', id: 1, method: 'eth_estimateGas', params: [call, `0x${BigInt(snapshot.block).toString(16)}`] }, fetcher), 'gas estimate');
  return { ...snapshot, gas: gas.toString(), executionCostWei: snapshot.fees.gasPriceWei === null ? null : (gas * BigInt(snapshot.fees.gasPriceWei)).toString(), purpose: input.purpose, execution: 'not-submitted', exactCall: call, note: input.purpose === 'presentation-read' ? 'Read calls do not spend wallet gas. Compare this execution estimate with the RPC read boundary; this is not an upload fee.' : 'Execution fee estimate for this exact unsigned transaction. It excludes other transactions, native transfer value and any additional L1 data fee.' };
}
