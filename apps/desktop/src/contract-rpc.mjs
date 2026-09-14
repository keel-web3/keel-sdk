import { createPublicClient, http, decodeFunctionResult, keccak256, getAddress, toFunctionSignature, toBytes, toHex } from 'viem';
import { createTrackedContract, prepareContractControl } from '@keel/sdk/contract-controls';

const eip1967 = (name) => toHex(BigInt(keccak256(toBytes(`eip1967.proxy.${name}`))) - 1n, { size: 32 });
export const IMPLEMENTATION_SLOT = eip1967('implementation');
export const ADMIN_SLOT = eip1967('admin');
export const BEACON_SLOT = eip1967('beacon');
export function rpcUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || !((url.protocol === 'https:') || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Use HTTPS RPC, or HTTP on localhost.');
  return url.href;
}
const slotAddress = (value) => value && !/^0x0*$/.test(value) ? getAddress(`0x${value.slice(-40)}`) : null;

export async function inspectContract(contractValue, endpoint, clientOverride) {
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

export async function readControl(input) {
  const review = prepareContractControl(input);
  if (review.mode !== 'read') throw new Error('Write methods only produce unsigned reviews in this editor.');
  const client = createPublicClient({ transport: http(rpcUrl(input.rpcUrl), { timeout: 15_000, retryCount: 0 }) });
  const evidence = await inspectContract(input.contract, input.rpcUrl, client);
  if (evidence.importedImplementationMismatch) throw new Error('Proxy implementation changed. Review and update the ABI binding first.');
  const response = await client.call({ to: review.to, data: review.data, blockNumber: BigInt(evidence.blockNumber) });
  const abi = input.contract.abi.filter((entry) => entry.type === 'function' && toFunctionSignature(entry) === input.signature);
  return { evidence, result: JSON.parse(JSON.stringify(decodeFunctionResult({ abi, functionName: abi[0].name, data: response.data ?? '0x' }), (_key, value) => typeof value === 'bigint' ? value.toString() : value)) };
}

export async function simulateControl(input, clientOverride) {
  const review = prepareContractControl(input); const account = getAddress(input.account);
  if (review.mode !== 'write') throw new Error('Use Read for view functions.');
  const client = clientOverride ?? createPublicClient({ transport: http(rpcUrl(input.rpcUrl), { timeout: 15_000, retryCount: 0 }) });
  const evidence = await inspectContract(input.contract, input.rpcUrl, client);
  if (evidence.importedImplementationMismatch || (evidence.implementation && !evidence.implementationCodeHash)) throw new Error('Proxy code or implementation changed. Resolve the ABI binding before simulation.');
  const result = await client.call({ account, to: review.to, data: review.data, value: BigInt(review.valueWei), blockNumber: BigInt(evidence.blockNumber) });
  return { ...review, simulation: 'succeeded-at-observed-block', account, evidence, returnData: result.data ?? '0x', authority: 'unverified', note: 'Successful simulation is not a signature, receipt, ownership proof or guarantee of future execution.' };
}
