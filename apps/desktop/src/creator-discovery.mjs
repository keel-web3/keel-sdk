import { createPublicClient, http, getAddress, keccak256 } from 'viem';
import { moduleAbi } from '@keel/sdk/infrastructure';
import { createTrackedContract } from '@keel/sdk/contract-controls';
import { rpcUrl } from './contract-rpc.mjs';

/** Bounded, read-only discovery from one explicitly selected creator factory. */
export async function discoverCreatorContracts(input, clientOverride) {
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1) throw new Error('Select an exact chain.');
  const factory = getAddress(input.factoryAddress), creator = getAddress(input.creator);
  const client = clientOverride ?? createPublicClient({ transport: http(rpcUrl(input.rpcUrl), { timeout: 15_000, retryCount: 0 }) });
  if (await client.getChainId() !== input.chainId) throw new Error('RPC chain does not match the selected factory.');
  const blockNumber = await client.getBlockNumber();
  const factoryCode = await client.getCode({ address: factory, blockNumber });
  if (!factoryCode || factoryCode === '0x') throw new Error('The selected factory has no code on this chain.');
  const abi = await moduleAbi('keel-die', 'KeelCreatorFactory');
  const read = (functionName, args = []) => client.readContract({ address: factory, abi, functionName, args, blockNumber });
  const count = await read('creatorCollectionCount', [creator]);
  if (typeof count !== 'bigint' || count < 0n || count > 100n) throw new Error('This discovery view supports at most 100 collections per creator/factory. Use a paginated indexer for larger accounts.');
  const ids = await read('creatorCollectionIds', [creator]);
  if (!Array.isArray(ids) || ids.length !== Number(count) || new Set(ids.map(String)).size !== ids.length) throw new Error('Factory collection count and IDs disagree at the selected block.');
  const renderer = getAddress(await read('metadataRenderer'));
  const records = [];
  for (const id of ids) {
    if (typeof id !== 'bigint' || id <= 0n) throw new Error('Invalid factory collection ID.');
    const record = await read('collection', [id]);
    if (!record || getAddress(record.creator) !== creator || typeof record.name !== 'string' || ![0, 1].includes(Number(record.standard)) || ![0, 1, 2].includes(Number(record.deployment))) throw new Error('Factory returned an invalid or unrelated creator record.');
    const address = getAddress(record.tokenContract);
    let contractName;
    if (Number(record.deployment) === 2) contractName = undefined;
    else if (Number(record.deployment) === 1) contractName = 'KeelShared1155';
    else if (Number(record.standard) === 1) contractName = 'KeelCreator1155';
    else {
      const implementationKind = Number(await read('erc721ImplementationKind', [id]));
      if (![0, 1].includes(implementationKind)) throw new Error('Unknown ERC-721 implementation kind.');
      contractName = implementationKind === 0 ? 'KeelCreator721A' : 'KeelCreator721';
    }
    records.push({ collectionId: id.toString(), sharedCollectionId: String(record.sharedCollectionId), name: record.name, open: record.open, deployment: ['dedicated', 'shared', 'external'][Number(record.deployment)], contract: createTrackedContract({ chainId: input.chainId, address, name: record.name || `Collection ${id}`, kind: 'collection', source: 'factory-readback', abi: contractName ? await moduleAbi('keel-die', contractName) : [], notes: `Creator ${creator}; factory ${factory}; collection ${id}; shared collection ${record.sharedCollectionId}; read at block ${blockNumber}. Factory membership is not current token ownership or role authority.` }) });
  }
  return { creator, factory, chainId: input.chainId, blockNumber: blockNumber.toString(), factoryCodeHash: keccak256(factoryCode), factoryIdentity: 'code-observed-not-authenticated', authority: 'unverified', records, infrastructure: [
    createTrackedContract({ chainId: input.chainId, address: factory, name: 'Creator factory', kind: 'default', source: 'factory-readback', abi, notes: `Selected factory read at block ${blockNumber}; not user-owned by implication.` }),
    createTrackedContract({ chainId: input.chainId, address: renderer, name: 'Collection renderer', kind: 'default', source: 'factory-readback', abi: await moduleAbi('keel-die', 'KeelArtifactTokenRenderer'), notes: `Factory metadataRenderer read at block ${blockNumber}; code and authority still require inspection.` }),
  ] };
}
