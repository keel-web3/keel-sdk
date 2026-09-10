import { encodeAbiParameters, encodeFunctionData, getAddress, hashTypedData, keccak256, parseAbi, stringToHex, toFunctionSelector, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { keelSystemPauseAbi, keelPauseBits } from "./admin-pauses.js";
import { keelAccessGroupsAbi, keelFeeTreasuryAbi } from "./abi.js";

const groupsAbi = parseAbi(keelAccessGroupsAbi), treasuryAbi = parseAbi(keelFeeTreasuryAbi);
const contextAbi = parseAbi(["function governanceEpoch() view returns (uint64)", "function paused() view returns (bool)"]);
export const keelDefaultGroups = {
  treasury: keccak256(stringToHex("keel.group.treasury")),
  operations: keccak256(stringToHex("keel.group.operations")),
  moderation: keccak256(stringToHex("keel.group.moderation")),
} as const;
const payoutSelector = toFunctionSelector("payout(bytes32,address,uint256,address,uint64,uint64,(address,bytes)[])");
export const keelGroupActionTypes = { GroupAction: [
  { name: "groupId", type: "bytes32" }, { name: "target", type: "address" }, { name: "selector", type: "bytes4" },
  { name: "actionHash", type: "bytes32" }, { name: "nonce", type: "uint256" }, { name: "revision", type: "uint64" },
  { name: "epoch", type: "uint64" }, { name: "deadline", type: "uint64" },
] } as const;
const sortAddresses = (addresses: readonly Address[]) => addresses.map(address => getAddress(address)).sort((a,b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) === BigInt(b) ? 0 : 1);

/** Unsigned manager-governance action. The contract permanently prevents a
 * quorum group from returning to bootstrap, even if a caller bypasses this SDK.
 * Pass the current memberPolicy.maximum for a local admission check. This builder
 * only encodes an action; governance rechecks the live policy at execution. */
export function buildKeelGroupConfiguration(groups: Address, groupId: Hex, members: readonly Address[], expectedRevision: bigint, enabled = true, maximum?: number) {
  const sorted = sortAddresses(members);
  if (!groupId || BigInt(groupId) === 0n || sorted.length === 0 || sorted.length === 2 || sorted.length > 0xffffffff)
    throw new RangeError("A group needs one bootstrap wallet or at least three quorum members.");
  if (maximum !== undefined) {
    validateMemberMaximum(maximum);
    if (sorted.length > maximum) throw new RangeError("Roster exceeds the current member policy.");
  }
  if (sorted.some((member,i) => member === zeroAddress || member === sorted[i-1])) throw new RangeError("Group members must be nonzero and unique.");
  return { target: getAddress(groups), value: 0n, data: encodeFunctionData({ abi: groupsAbi, functionName: "configureGroup", args: [groupId, sorted, enabled, expectedRevision] }) };
}

/** Revision-checked governance action; lowering admission does not alter existing quorum. */
export function buildKeelGroupMemberPolicy(groups: Address, maximum: number, expectedRevision: bigint) {
  validateMemberMaximum(maximum);
  return { target: getAddress(groups), value: 0n, data: encodeFunctionData({ abi: groupsAbi, functionName: "configureMemberPolicy", args: [maximum, expectedRevision] }) };
}

function validateMemberMaximum(maximum: number) {
  if (!Number.isInteger(maximum) || maximum < 3 || maximum > 0xffffffff)
    throw new RangeError("Member maximum must be a uint32 of at least three.");
}

/** Decode GroupConfigured without losing revision precision or hiding unknown flags. */
export function decodeKeelGroupMetadata(metadata: Hex) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(metadata)) throw new RangeError("Group metadata must be bytes32.");
  const word = BigInt(metadata);
  if (word >> 66n) throw new RangeError("Unknown group metadata bits.");
  return { revision: word & ((1n << 64n) - 1n), quorumActive: Boolean(word & (1n << 64n)), enabled: Boolean(word & (1n << 65n)) };
}

export function buildKeelGroupCapability(groups: Address, groupId: Hex, target: Address, selector: Hex, enabled = true) {
  return { target: getAddress(groups), value: 0n, data: encodeFunctionData({ abi: groupsAbi, functionName: "configureCapability", args: [groupId, getAddress(target), selector, enabled] }) };
}

export function buildKeelPayoutWalletChange(treasury: Address, wallet: Address, expectedRevision: bigint) {
  if (getAddress(wallet) === zeroAddress || getAddress(wallet) === getAddress(treasury)) throw new RangeError("Invalid payout wallet.");
  return { target: getAddress(treasury), value: 0n, data: encodeFunctionData({ abi: treasuryAbi, functionName: "configurePayoutWallet", args: [getAddress(wallet), expectedRevision] }) };
}

export function buildKeelCustomPayoutLimit(treasury: Address, asset: Address, maximum: bigint) {
  if (maximum < 0n) throw new RangeError("The limit cannot be negative.");
  return { target: getAddress(treasury), value: 0n, data: encodeFunctionData({ abi: treasuryAbi, functionName: "configureCustomPayoutLimit", args: [getAddress(asset), maximum] }) };
}

/** Read a consistent chain snapshot and prepare the exact typed authorization.
 * This never signs or submits. Zero/omitted recipient selects the default wallet. */
export async function prepareKeelTreasuryPayout(input: {
  client: Pick<PublicClient, "getBlock" | "getChainId" | "readContract">;
  treasury: Address; groupId?: Hex; asset?: Address; amount: bigint; recipient?: Address; deadline?: bigint;
}) {
  if (input.amount <= 0n || input.amount >= 1n << 256n) throw new RangeError("Payout amount must be a positive uint256.");
  const treasury = getAddress(input.treasury), asset = getAddress(input.asset ?? zeroAddress), recipient = getAddress(input.recipient ?? zeroAddress);
  const groupId = input.groupId ?? keelDefaultGroups.treasury;
  const [block,chainId] = await Promise.all([input.client.getBlock({ blockTag: "latest" }), input.client.getChainId()]);
  if (block.number === null) throw new Error("A confirmed block is required.");
  const blockNumber = block.number;
  const read = <T>(functionName: string, args?: readonly unknown[]) => input.client.readContract({ address: treasury, abi: treasuryAbi, functionName, args, blockNumber } as never) as Promise<T>;
  const [groups,payoutWallet,unlockAt,revision,nextCustom,maximum] = await Promise.all([
    read<Address>("accessGroups"), read<Address>("payoutWallet"), read<bigint>("withdrawalsUnlockAt"), read<bigint>("payoutRevision"),
    read<bigint>("nextCustomPayoutAt"), read<bigint>("customPayoutLimit",[asset]),
  ]);
  if (getAddress(groups) === zeroAddress || getAddress(payoutWallet) === zeroAddress) throw new Error("Treasury payout configuration is incomplete.");
  if (block.timestamp < unlockAt) throw new Error(`Withdrawals are locked until ${unlockAt}.`);
  const destination = recipient === zeroAddress ? getAddress(payoutWallet) : recipient;
  if (destination === treasury) throw new Error("The treasury cannot pay itself.");
  const custom = destination !== getAddress(payoutWallet);
  if (custom && input.amount > maximum) throw new RangeError("Custom payout exceeds the configured asset limit.");
  if (custom && block.timestamp < nextCustom) throw new Error(`Custom payouts are locked until ${nextCustom}.`);
  const context = await groupContext(input.client, groups, groupId, treasury, payoutSelector, blockNumber);
  const {members,threshold,quorumActive} = context;
  await input.client.readContract({address:context.manager,abi:keelSystemPauseAbi,functionName:"requireSystemsActive",args:[keelPauseBits.treasury],blockNumber});
  const deadline = approvalDeadline(block.timestamp, input.deadline);
  const actionHash = keccak256(encodeAbiParameters([{type:"address"},{type:"uint256"},{type:"address"},{type:"uint64"}], [asset,input.amount,recipient,revision]));
  const typedData = groupTypedData(chainId, groups, context, groupId, treasury, payoutSelector, actionHash, deadline);
  return { treasury, groupId, asset, amount: input.amount, recipient, destination, revision, deadline, members, threshold, quorumActive, custom, blockNumber, typedData, digest: hashTypedData(typedData) };
}

export function buildKeelGroupPayout(plan: Awaited<ReturnType<typeof prepareKeelTreasuryPayout>>, signatures: readonly {signer: Address; signature: Hex}[]) {
  const sorted = groupSignatures(plan.members,plan.threshold,signatures);
  return { target: plan.treasury, value: 0n, data: encodeFunctionData({ abi: treasuryAbi, functionName: "payout", args: [plan.groupId,plan.asset,plan.amount,plan.recipient,plan.revision,plan.deadline,sorted] }) };
}

function groupSignatures(members_: readonly Address[], threshold: bigint, signatures: readonly {signer: Address; signature: Hex}[]) {
  const sorted = signatures.map(item=>({...item,signer:getAddress(item.signer)})).sort((a,b)=>BigInt(a.signer)<BigInt(b.signer)?-1:1);
  const members = new Set(members_.map(member=>getAddress(member)));
  if (BigInt(sorted.length) < threshold || sorted.some((item,i)=>!members.has(item.signer) || item.signer === sorted[i-1]?.signer))
    throw new Error("Provide the required number of unique group-member signatures.");
  return sorted;
}

/** Prepare group approvals for an existing manager role action. Both the
 * manager's policy and this group's exact capability must permit the action. */
export async function prepareKeelGroupExecution(input: {
  client: Pick<PublicClient, "getBlock" | "getChainId" | "readContract">;
  groups: Address; groupId: Hex; action: {target: Address; value: bigint; data: Hex}; deadline?: bigint;
}) {
  const groups=getAddress(input.groups), target=getAddress(input.action.target);
  const action={...input.action,target};
  if (!/^0x[0-9a-fA-F]{8}(?:[0-9a-fA-F]{2})*$/.test(action.data) || action.value<0n || action.value >= 1n<<256n)
    throw new RangeError("Invalid manager action.");
  const selector=action.data.slice(0,10) as Hex;
  const [block,chainId]=await Promise.all([input.client.getBlock({blockTag:"latest"}),input.client.getChainId()]);
  if(block.number===null) throw new Error("A confirmed block is required.");
  const blockNumber=block.number;
  const context=await groupContext(input.client,groups,input.groupId,target,selector,blockNumber);
  const {members,threshold,quorumActive,manager}=context;
  const policyAbi=parseAbi(["function executionPolicy(address target,bytes4 selector) view returns ((uint96 maxValue,uint8 minimumTier,bool enabled))","function accountTier(address account) view returns (uint8)"]);
  const [policy,tier]=await Promise.all([
    input.client.readContract({address:manager,abi:policyAbi,functionName:"executionPolicy",args:[target,selector],blockNumber}),
    input.client.readContract({address:manager,abi:policyAbi,functionName:"accountTier",args:[groups],blockNumber}),
  ]);
  if(!policy.enabled || (tier!==2 && tier!==3) || tier<policy.minimumTier || action.value>policy.maxValue)
    throw new Error("The manager does not permit this group execution.");
  const deadline=approvalDeadline(block.timestamp,input.deadline);
  const actionHash=keccak256(encodeAbiParameters([{type:"uint256"},{type:"bytes32"}],[action.value,keccak256(action.data)]));
  const typedData=groupTypedData(chainId,groups,context,input.groupId,target,selector,actionHash,deadline);
  return {groups,groupId:input.groupId,action,deadline,members,threshold,quorumActive,blockNumber,typedData,digest:hashTypedData(typedData)};
}

export function buildKeelGroupExecution(plan: Awaited<ReturnType<typeof prepareKeelGroupExecution>>, signatures: readonly {signer:Address;signature:Hex}[]) {
  return {target:plan.groups,value:plan.action.value,data:encodeFunctionData({abi:groupsAbi,functionName:"execute",args:[plan.groupId,plan.action,plan.deadline,groupSignatures(plan.members,plan.threshold,signatures)]})};
}

function approvalDeadline(now: bigint, supplied?: bigint) {
  const deadline=supplied??now+3600n;
  if(deadline<=now || deadline>=(1n<<64n)) throw new RangeError("Approval deadline must be a future uint64 timestamp.");
  return deadline;
}

async function groupContext(client: Pick<PublicClient,"readContract">,groups: Address,groupId: Hex,target: Address,selector: Hex,blockNumber: bigint) {
  const [group,capability,manager]=await Promise.all([
    client.readContract({address:groups,abi:groupsAbi,functionName:"group",args:[groupId],blockNumber}),
    client.readContract({address:groups,abi:groupsAbi,functionName:"hasCapability",args:[groupId,target,selector],blockNumber}),
    client.readContract({address:groups,abi:groupsAbi,functionName:"manager",blockNumber}),
  ]);
  const [members,threshold,nonce,revision,quorumActive,enabled]=group;
  if(!enabled || !capability) throw new Error("This group cannot approve the selected action.");
  const [epoch,paused]=await Promise.all([
    client.readContract({address:manager,abi:contextAbi,functionName:"governanceEpoch",blockNumber}),
    client.readContract({address:manager,abi:contextAbi,functionName:"paused",blockNumber}),
  ]);
  if(paused) throw new Error("Group actions are paused by the manager.");
  return {members,threshold,nonce,revision,quorumActive,manager,epoch};
}

function groupTypedData(chainId: number, groups: Address, context: Awaited<ReturnType<typeof groupContext>>, groupId: Hex, target: Address, selector: Hex, actionHash: Hex, deadline: bigint) {
  return {domain:{name:"KEEL Access Groups",version:"1",chainId,verifyingContract:getAddress(groups)},types:keelGroupActionTypes,primaryType:"GroupAction" as const,
    message:{groupId,target,selector,actionHash,nonce:context.nonce,revision:context.revision,epoch:context.epoch,deadline}};
}
