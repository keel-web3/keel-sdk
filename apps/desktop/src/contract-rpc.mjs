import { createPublicClient, http, decodeFunctionResult, keccak256, getAddress, toFunctionSignature, toBytes, toHex } from 'viem';
import { createTrackedContract, prepareContractControl } from '@keel/sdk/contract-controls';
import { inspectKeelContract, isKeelTransportFailure } from '@keel/sdk/contract-registry';
import { describeKeelTransferRules, readKeelTransferRules } from '@keel/sdk/transfer-rules';

const eip1967 = (name) => toHex(BigInt(keccak256(toBytes(`eip1967.proxy.${name}`))) - 1n, { size: 32 });
export const IMPLEMENTATION_SLOT = eip1967('implementation');
export const ADMIN_SLOT = eip1967('admin');
export const BEACON_SLOT = eip1967('beacon');
export function rpcUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || !((url.protocol === 'https:') || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Use HTTPS RPC, or HTTP on localhost.');
  return url.href;
}
import { NETWORK_UNAVAILABLE } from './network-errors.mjs';
export { NETWORK_UNAVAILABLE };

/**
 * An HTTP failure, timeout or rate limit is not an answer from the contract.
 * Turn it into one plain message (never the RPC URL, which can carry an API
 * key) so nothing treats an outage as "not supported" or remembers it.
 */
export function networkError(error) {
  if (!isKeelTransportFailure(error)) return error;
  return Object.assign(new Error(`${NETWORK_UNAVAILABLE} The RPC didn’t answer, timed out or is limiting requests. Nothing was read or changed; try again in a moment.`), { code: 'network-unavailable' });
}
const guarded = (read) => async (...args) => { try { return await read(...args); } catch (error) { throw networkError(error); } };

const slotAddress = (value) => value && !/^0x0*$/.test(value) ? getAddress(`0x${value.slice(-40)}`) : null;

async function inspectContractUnguarded(contractValue, endpoint, clientOverride) {
  const contract = createTrackedContract(contractValue);
  const client = clientOverride ?? createPublicClient({ transport: http(rpcUrl(endpoint), { timeout: 15_000, retryCount: 0 }) });
  if (await client.getChainId() !== contract.chainId) throw new Error('RPC chain does not match the tracked contract.');
  const blockNumber = await client.getBlockNumber();
  const code = await client.getCode({ address: contract.address, blockNumber });
  if (!code || code === '0x') throw new Error('No contract code exists at this address on the selected chain.');
  const [implementation, admin, beacon] = await Promise.all([IMPLEMENTATION_SLOT, ADMIN_SLOT, BEACON_SLOT].map(async (slot) => slotAddress(await client.getStorageAt({ address: contract.address, slot, blockNumber }))));
  const clone = /^0x363d3d373d3d3d363d73([a-fA-F0-9]{40})5af43d82803e903d91602b57fd5bf3$/u.exec(code);
  let observedImplementation = implementation ?? (clone ? getAddress(`0x${clone[1]}`) : null);
  if (beacon && implementation) throw new Error('Both implementation and beacon slots are set; review this custom proxy explicitly.');
  if (beacon) observedImplementation = await client.readContract({ address: beacon, abi: [{ type: 'function', name: 'implementation', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }], functionName: 'implementation', blockNumber });
  const importedImplementation = contract.proxy?.implementation;
  const mismatch = !!importedImplementation && (!observedImplementation || importedImplementation.toLowerCase() !== observedImplementation.toLowerCase());
  const implementationCode = observedImplementation ? await client.getCode({ address: observedImplementation, blockNumber }) : null;
  return { chainId: contract.chainId, address: contract.address, blockNumber: blockNumber.toString(), codeHash: keccak256(code), implementation: observedImplementation, implementationCodeHash: implementationCode && implementationCode !== '0x' ? keccak256(implementationCode) : null, admin, beacon, kind: beacon ? 'beacon' : implementation ? 'eip1967' : clone ? 'minimal' : 'not-detected', importedImplementationMismatch: mismatch, authority: 'unverified', abiMatchesCode: 'not-established', checkedAt: new Date().toISOString() };
}

/**
 * The inspector's "what is this" read: the safety evidence above (chain,
 * code, implementation mismatch) plus the shared SDK's facts at the same
 * block — proxy shape (EIP-1967, beacon or minimal clone), ERC-165 standard,
 * name, symbol and the owner the contract reports. All of it is evidence; a
 * reported owner is not proof of control.
 */
async function inspectContractFactsUnguarded(contractValue, endpoint, clientOverride) {
  const contract = createTrackedContract(contractValue);
  const client = clientOverride ?? createPublicClient({ transport: http(rpcUrl(endpoint), { timeout: 15_000, retryCount: 0 }) });
  let evidence;
  try {
    evidence = await inspectContract(contract, endpoint, client);
  } catch (error) {
    // A contract with both proxy slots set stays refused for reads and simulations,
    // but the creator still sees what it is, with the conflict called out.
    if (!(error instanceof Error) || !/Both implementation and beacon slots/u.test(error.message)) throw error;
    const blockNumber = await client.getBlockNumber();
    const facts = await inspectKeelContract(client, { chainId: contract.chainId, address: contract.address, blockNumber });
    return { chainId: contract.chainId, address: contract.address, blockNumber: blockNumber.toString(), kind: 'conflict', refused: error.message, importedImplementationMismatch: false, authority: 'unverified', abiMatchesCode: 'not-established', checkedAt: new Date().toISOString(), facts };
  }
  const facts = await inspectKeelContract(client, { chainId: contract.chainId, address: contract.address, blockNumber: BigInt(evidence.blockNumber) });
  return { ...evidence, facts };
}

/**
 * Trading rules (ERC721-C validator policy and lists, operator filter
 * registry) through the shared SDK reader, with every read pinned to one
 * block on a chain-checked client. Read-only: changes go through the
 * unsigned review and wallet approval flow.
 */
async function readTransferRulesUnguarded(contractValue, endpoint, clientOverride) {
  const contract = createTrackedContract(contractValue);
  const client = clientOverride ?? createPublicClient({ transport: http(rpcUrl(endpoint), { timeout: 15_000, retryCount: 0 }) });
  if (await client.getChainId() !== contract.chainId) throw new Error('RPC chain does not match the tracked contract.');
  const blockNumber = await client.getBlockNumber();
  const code = await client.getCode({ address: contract.address, blockNumber });
  if (!code || code === '0x') throw new Error('No contract code exists at this address on the selected chain.');
  const pinned = { readContract: (input) => client.readContract({ ...input, blockNumber }) };
  const rules = await readKeelTransferRules(pinned, { collection: contract.address });
  return { ...rules, chainId: contract.chainId, blockNumber: blockNumber.toString(), summary: describeKeelTransferRules(rules), authority: 'unverified' };
}

async function readControlUnguarded(input) {
  const review = prepareContractControl(input);
  if (review.mode !== 'read') throw new Error('Write methods only produce unsigned reviews in this editor.');
  const client = createPublicClient({ transport: http(rpcUrl(input.rpcUrl), { timeout: 15_000, retryCount: 0 }) });
  const evidence = await inspectContract(input.contract, input.rpcUrl, client);
  if (evidence.importedImplementationMismatch) throw new Error('Proxy implementation changed. Review and update the ABI binding first.');
  const response = await client.call({ to: review.to, data: review.data, blockNumber: BigInt(evidence.blockNumber) });
  const abi = input.contract.abi.filter((entry) => entry.type === 'function' && toFunctionSignature(entry) === input.signature);
  return { evidence, result: JSON.parse(JSON.stringify(decodeFunctionResult({ abi, functionName: abi[0].name, data: response.data ?? '0x' }), (_key, value) => typeof value === 'bigint' ? value.toString() : value)) };
}

async function simulateControlUnguarded(input, clientOverride) {
  const review = prepareContractControl(input); const account = getAddress(input.account);
  if (review.mode !== 'write') throw new Error('Use Read for view functions.');
  const client = clientOverride ?? createPublicClient({ transport: http(rpcUrl(input.rpcUrl), { timeout: 15_000, retryCount: 0 }) });
  const evidence = await inspectContract(input.contract, input.rpcUrl, client);
  if (evidence.importedImplementationMismatch || (evidence.implementation && !evidence.implementationCodeHash)) throw new Error('Proxy code or implementation changed. Resolve the ABI binding before simulation.');
  const result = await client.call({ account, to: review.to, data: review.data, value: BigInt(review.valueWei), blockNumber: BigInt(evidence.blockNumber) });
  return { ...review, simulation: 'succeeded-at-observed-block', account, evidence, returnData: result.data ?? '0x', authority: 'unverified', note: 'Successful simulation is not a signature, receipt, ownership proof or guarantee of future execution.' };
}
export const inspectContract = guarded(inspectContractUnguarded);
export const inspectContractFacts = guarded(inspectContractFactsUnguarded);
export const readTransferRules = guarded(readTransferRulesUnguarded);
export const readControl = guarded(readControlUnguarded);
export const simulateControl = guarded(simulateControlUnguarded);
