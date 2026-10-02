import { createPublicClient, http, getAddress, keccak256 } from 'viem';
import { moduleAbi } from '@keel/sdk/infrastructure';
import { createTrackedContract } from '@keel/sdk/contract-controls';
import { discoverKeelCreatorFactoryCollections, entriesFromFactoryRecords, keelCreatorFactoryRegistryAbi, readKeelFactoryTemplates } from '@keel/sdk/contract-registry';
import { networkError, rpcUrl } from './contract-rpc.mjs';
import { parseWorkspaceContract, registryFieldsFromEntry } from './contract-registry.mjs';

const MAX_COLLECTIONS = 100;

/** Which recorded keel-die ABI fits a factory record's token contract. */
function tokenAbiName(record) {
  if (record.deployment === 'external') return undefined;
  if (record.deployment === 'shared') return 'KeelShared1155';
  if (record.standard === 'erc1155') return 'KeelCreator1155';
  return { erc721a: 'KeelCreator721A', erc721: 'KeelCreator721', 'seeded-erc721a': 'KeelCreatorSeeded721A' }[record.implementation];
}

/**
 * Bounded, read-only discovery from one explicitly selected creator factory.
 * Every read is pinned to one block. The SDK's strict mode refuses a factory
 * without code, a count that disagrees with the ids, duplicate ids and more
 * collections than the limit. Collections that share one token contract (the
 * shared ERC-1155) become logical collections inside a single tracked
 * contract, each with its exact token range, and clones name the template
 * they copy.
 */
export async function discoverCreatorContracts(input, clientOverride) {
  try { return await discover(input, clientOverride); } catch (error) { throw networkError(error); }
}

async function discover(input, clientOverride) {
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1) throw new Error('Select an exact chain.');
  const factory = getAddress(input.factoryAddress), creator = getAddress(input.creator);
  const client = clientOverride ?? createPublicClient({ transport: http(rpcUrl(input.rpcUrl), { timeout: 15_000, retryCount: 0 }) });
  if (await client.getChainId() !== input.chainId) throw new Error('RPC chain does not match the selected factory.');
  const blockNumber = await client.getBlockNumber();
  const factoryCode = await client.getCode({ address: factory, blockNumber });
  if (!factoryCode || factoryCode === '0x') throw new Error('The selected factory has no code on this chain.');
  const read = (functionName, args = []) => client.readContract({ address: factory, abi: keelCreatorFactoryRegistryAbi, functionName, args, blockNumber });
  // Check the count before asking for the id list, so a huge account is refused without fetching it.
  const count = await read('creatorCollectionCount', [creator]);
  if (typeof count !== 'bigint' || count < 0n || count > BigInt(MAX_COLLECTIONS)) throw new Error(`This discovery view supports at most ${MAX_COLLECTIONS} collections per creator/factory. Use a paginated indexer for larger accounts.`);
  const renderer = getAddress(await read('metadataRenderer'));
  let found;
  try {
    found = await discoverKeelCreatorFactoryCollections(client, { factory, creator, abi: keelCreatorFactoryRegistryAbi, blockNumber, limit: MAX_COLLECTIONS, strict: true });
  } catch (error) {
    // The SDK names the exact record it refused; keep the editor's wording in front of it.
    if (error instanceof Error && /^Factory collection \d+ /u.test(error.message)) throw new Error(`Factory returned an invalid or unrelated creator record. ${error.message}`);
    throw error;
  }
  const templates = await readKeelFactoryTemplates(client, factory, blockNumber);
  const abi = await moduleAbi('keel-die', 'KeelCreatorFactory');

  const contracts = new Map();
  for (const entry of entriesFromFactoryRecords(input.chainId, found.records, templates)) {
    const records = found.records.filter((record) => record.tokenContract === entry.address);
    const abiName = tokenAbiName(records[0]);
    const ids = records.map((record) => record.collectionId).join(', ');
    const tracked = createTrackedContract({
      chainId: input.chainId, address: entry.address, kind: 'collection', source: 'factory-readback',
      name: (entry.name || `Collection ${records[0].collectionId}`).slice(0, 160),
      abi: abiName ? await moduleAbi('keel-die', abiName) : [],
      notes: `Creator ${creator}; factory ${factory}; factory collection${records.length === 1 ? '' : 's'} ${ids}; read at block ${blockNumber}. Factory membership is not current token ownership or role authority.`,
    });
    const fields = registryFieldsFromEntry(entry);
    contracts.set(entry.key, parseWorkspaceContract({ ...tracked, ...fields, registry: { ...fields.registry, observedBlock: blockNumber.toString() } }));
  }
  const infrastructure = (name, address, abi, notes) => parseWorkspaceContract({ ...createTrackedContract({ chainId: input.chainId, address, name, kind: 'default', source: 'factory-readback', abi, notes }), registry: { family: 'infrastructure', deployment: 'standalone', sources: ['factory'], observedBlock: blockNumber.toString() } });
  return {
    creator, factory, chainId: input.chainId, blockNumber: blockNumber.toString(), factoryCodeHash: keccak256(factoryCode), factoryIdentity: 'code-observed-not-authenticated', authority: 'unverified',
    records: found.records.map((record) => ({
      collectionId: record.collectionId, sharedCollectionId: record.sharedCollectionId, name: record.name, open: record.open,
      deployment: record.deployment, standard: record.standard, ...(record.implementation ? { implementation: record.implementation } : {}),
      contract: contracts.get(`${input.chainId}:${record.tokenContract.toLowerCase()}`),
    })),
    infrastructure: [
      infrastructure('Creator factory', factory, abi, `Selected factory read at block ${blockNumber}; not user-owned by implication.`),
      infrastructure('Collection renderer', renderer, await moduleAbi('keel-die', 'KeelArtifactTokenRenderer'), `Factory metadataRenderer read at block ${blockNumber}; code and authority still require inspection.`),
    ],
  };
}
