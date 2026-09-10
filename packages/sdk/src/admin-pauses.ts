import { encodeFunctionData, getAddress, parseAbi, type Address, type PublicClient } from "viem";

export const keelPauseBits = {
  chunking: 1n << 0n, viewers: 1n << 1n, mint721: 1n << 2n, mint1155: 1n << 3n,
  mintAdmin: 1n << 4n, mintCampaign: 1n << 5n, mintOne: 1n << 6n,
  mintAuction: 1n << 7n, mintCrossChain: 1n << 8n, mintIP: 1n << 9n,
  publication: 1n << 10n, market: 1n << 11n, staking: 1n << 12n,
  collections: 1n << 13n, treasury: 1n << 14n,
} as const;
export const keelPausePresets = { allMints: 1020n, all: 32767n } as const;
export const keelPauseControls = [
  {id:"chunking",label:"Chunk uploads",detail:"New intents and uploads; existing bytes remain readable."},
  {id:"viewers",label:"Viewer changes",detail:"Registration and presentation changes; existing viewers keep rendering."},
  {id:"mint721",label:"ERC-721 mints",detail:"Managed ERC-721 issuance."},
  {id:"mint1155",label:"ERC-1155 mints",detail:"Managed editions and items."},
  {id:"mintAdmin",label:"Admin mints",detail:"Direct and controller-assisted admin issuance."},
  {id:"mintCampaign",label:"Campaign mints",detail:"MintGate campaigns."},
  {id:"mintOne",label:"OneMint drops",detail:"Public, allowlist, claim, and admin drop paths."},
  {id:"mintAuction",label:"Auction mints",detail:"Unique and edition auction issuance."},
  {id:"mintCrossChain",label:"Cross-chain mints",detail:"Destination issuance; failed work remains retryable."},
  {id:"mintIP",label:"Licensed mints",detail:"Licensed remints and backpack mints."},
  {id:"publication",label:"Object publication",detail:"New publication intents, welding, sealing, and artifact revisions."},
  {id:"market",label:"Trading",detail:"New listings, bids, and trades; cancellation and withdrawals stay available."},
  {id:"staking",label:"New stakes",detail:"New custody intake; unstaking stays available."},
  {id:"collections",label:"New collections",detail:"Creator-factory collection creation."},
  {id:"treasury",label:"Treasury payouts",detail:"Both scoped group payouts and governance claims."},
].map(control=>({...control,mask:keelPauseBits[control.id as keyof typeof keelPauseBits]}));
export const keelSystemPauseAbi = parseAbi([
  "function systemPauseState() view returns (uint192 flags,uint64 revision)",
  "function pauseSystems(uint192 mask)",
  "function resumeSystems(uint192 mask,uint64 expectedRevision)",
  "function requireSystemsActive(uint192 mask) view",
  "event SystemsPaused(uint192 flags,uint64 revision,address indexed operator)",
  "error SystemsUnavailable(uint192 flags)","error InvalidPauseMask()","error StalePauseRevision()",
]);
function validateMask(mask: bigint) {
  if(mask<=0n || (mask & ~keelPausePresets.all)!==0n) throw new RangeError("Choose one or more supported pause controls.");
}
/** A direct admin action. It only sets selected bits and cannot resume anything. */
export function buildKeelPauseAction(manager: Address,mask: bigint) {
  validateMask(mask);
  return {target:getAddress(manager),value:0n,data:encodeFunctionData({abi:keelSystemPauseAbi,functionName:"pauseSystems",args:[mask]}),authorization:"admin" as const};
}
/** Submit this action through executeGovernance with the current root quorum. */
export function buildKeelResumeAction(manager: Address,mask: bigint,expectedRevision: bigint) {
  validateMask(mask);
  return {target:getAddress(manager),value:0n,data:encodeFunctionData({abi:keelSystemPauseAbi,functionName:"resumeSystems",args:[mask,expectedRevision]}),authorization:"governance" as const};
}
export async function readKeelPauseState(client: Pick<PublicClient,"readContract"|"getBlockNumber">,manager: Address) {
  const blockNumber=await client.getBlockNumber({cacheTime:0});
  const [flags,revision]=await client.readContract({address:getAddress(manager),abi:keelSystemPauseAbi,functionName:"systemPauseState",blockNumber});
  return {flags,revision,blockNumber,controls:keelPauseControls.map(control=>({...control,paused:(flags&control.mask)!==0n})),allMintsPaused:(flags&keelPausePresets.allMints)===keelPausePresets.allMints};
}

/** Module controls use the same AccessControl roles as other KEEL customer permissions. */
export const keelLocalPauseAbi = parseAbi([
  "function localPauseState() view returns (uint192 flags,uint64 revision)",
  "function pauseLocalSystems(uint192 mask)",
  "function resumeLocalSystems(uint192 mask,uint64 expectedRevision)",
  "function PAUSE_ROLE() view returns (bytes32)",
  "function RESUME_ROLE() view returns (bytes32)",
  "event LocalSystemsPaused(uint192 flags,uint64 revision,address indexed operator)",
  "error LocalSystemsUnavailable(uint192 flags)",
  "error InvalidLocalPauseMask()", "error StaleLocalPauseRevision()",
]);
export const keelMinterPauseMask = keelPausePresets.allMints | keelPauseBits.collections;
function validateMinterMask(mask: bigint) {
  validateMask(mask);
  if ((mask & ~keelMinterPauseMask)!==0n) throw new RangeError("Choose mint or collection controls for this minter.");
}
export function buildKeelMinterPauseAction(minter: Address, mask: bigint) {
  validateMinterMask(mask);
  return {target:getAddress(minter),value:0n,data:encodeFunctionData({abi:keelLocalPauseAbi,functionName:"pauseLocalSystems",args:[mask]}),authorization:"module-pause-role" as const};
}
export function buildKeelMinterResumeAction(minter: Address, mask: bigint, expectedRevision: bigint) {
  validateMinterMask(mask);
  return {target:getAddress(minter),value:0n,data:encodeFunctionData({abi:keelLocalPauseAbi,functionName:"resumeLocalSystems",args:[mask,expectedRevision]}),authorization:"module-resume-role" as const};
}
/** One block for both layers; clearing either layer never clears the other. */
export async function readKeelMinterPauseState(client: Pick<PublicClient,"readContract"|"getBlockNumber">,manager: Address,minter: Address) {
  const blockNumber=await client.getBlockNumber({cacheTime:0});
  const [[platformFlags,platformRevision],[localFlags,localRevision]]=await Promise.all([
    client.readContract({address:getAddress(manager),abi:keelSystemPauseAbi,functionName:"systemPauseState",blockNumber}),
    client.readContract({address:getAddress(minter),abi:keelLocalPauseAbi,functionName:"localPauseState",blockNumber}),
  ]);
  return {platformFlags,platformRevision,localFlags,localRevision,effectiveFlags:platformFlags|localFlags,blockNumber};
}
