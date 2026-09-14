import { decodeEventLog, parseAbi, type Address, type Hex } from 'viem';

/** Marketplace events must be read at the NFT collection address, including clones. */
export const keelMetadataNotificationAbi = parseAbi([
  'event MetadataUpdate(uint256 tokenId)',
  'event BatchMetadataUpdate(uint256 fromTokenId,uint256 toTokenId)',
  'event URI(string value,uint256 indexed id)',
]);

export type KeelMetadataNotification = {
  collection: Address;
  firstTokenId: bigint;
  lastTokenId: bigint;
  standard: 'erc721' | 'erc1155';
  uri?: string;
  removed: boolean;
};

/** Keeps large ranges compact; consumers can invalidate caches without expanding token IDs.
 * Removed logs undo the notification during a reorg, rather than creating a second update.
 * The caller must filter logs by the collections and chain it actually tracks.
 */
export function decodeKeelMetadataNotification(log: {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  removed?: boolean;
}): KeelMetadataNotification | undefined {
  try {
    const event = decodeEventLog({
      abi: keelMetadataNotificationAbi,
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data,
      strict: true,
    });
    const common = { collection: log.address, removed: log.removed ?? false };
    if (event.eventName === 'URI') {
      if (log.topics.length !== 2) return undefined;
      return { ...common, firstTokenId: event.args.id, lastTokenId: event.args.id, standard: 'erc1155', uri: event.args.value };
    }
    // Reject the historical indexed shape even when a permissive decoder accepts extra topics.
    if (log.topics.length !== 1) return undefined;
    if (event.eventName === 'MetadataUpdate') {
      if (log.data.length !== 66) return undefined;
      return { ...common, firstTokenId: event.args.tokenId, lastTokenId: event.args.tokenId, standard: 'erc721' };
    }
    if (log.data.length !== 130 || event.args.fromTokenId > event.args.toTokenId) return undefined;
    return { ...common, firstTokenId: event.args.fromTokenId, lastTokenId: event.args.toTokenId, standard: 'erc721' };
  } catch {
    return undefined;
  }
}
