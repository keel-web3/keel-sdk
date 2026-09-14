import { defineChain, sha256, encodeFunctionData, parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { encodeBitcoinProofValues, type BitcoinProofValues } from "@keel/protocol";
import { ABIS } from "./abis/keel-anchors.generated.js";

export const bitcoinProofAdapterAbi = parseAbi([
  "struct Values { bytes32 originHash; uint32 originHeight; uint32 originBits; uint32 originTimestamp; uint32 originEpochStart; bytes32 tipHash; uint32 tipHeight; uint32 tipBits; uint32 tipTimestamp; uint32 tipEpochStart; bytes32 anchorRoot; uint64 payloadLen; bytes32 blockHash; uint32 blockHeight; uint32 confirmations; bytes32 cumulativeWork; bytes32 sourceTxid; uint32 sourceInput; bytes32 headersRoot; uint32 maxTimestamp; uint8 claimKind; }",
  "function anchorRegistry() view returns (address)",
  "function proofController() view returns (address)",
  "function proofProfileId() view returns (bytes32)",
  "function configurationHash() view returns (bytes32)",
  "function configLocked() view returns (bool)",
  "function receipts(bytes32) view returns (uint32 blockHeight,uint64 acceptedAt,uint64 nonce,bytes32 blockHash,bytes32 evidenceHash,bytes32 acceptedTip,bytes32 acceptedRoot)",
  "function sourceStatus(bytes32,bytes32,bytes32[]) view returns (uint8)",
  "function submitZkAnchor(bytes32 anchorId,uint32 taskIndex,Values values,bytes proofData)",
  "function submitHeaderChain(Values values,bytes proofData)",
]);
const admissionAbi = parseAbi(["function isAdmitted(bytes32,address,uint8,uint32) view returns (bool)"]);
export const bitcoinSourceStatusLabels = ["Unknown — current branch evidence required", "Confirmed on best submitted branch", "Orphaned from best submitted branch", "Source tip is stale", "Insufficient confirmations"] as const;

async function requireNetwork(client: PublicClient, expectedChainId: number): Promise<number> {
  const chainId = await client.getChainId();
  if (chainId !== expectedChainId) throw new Error(`Wrong network: expected ${expectedChainId}, received ${chainId}`);
  return chainId;
}
export async function readBitcoinAttachment(options: {
  publicClient: PublicClient; expectedChainId: number; adapter: Address; anchorId: Hex;
  currentBlockHash?: Hex; sourcePath?: readonly Hex[];
}) {
  const {publicClient: reader,adapter,anchorId} = options;
  const chainId = await requireNetwork(reader,options.expectedChainId);
  const block = await reader.getBlock();
  const common = {address: adapter,abi: bitcoinProofAdapterAbi,blockNumber:block.number} as const;
  const [registry,controller,profileId,receipt,status] = await Promise.all([
    reader.readContract({...common,functionName:"anchorRegistry"}),
    reader.readContract({...common,functionName:"proofController"}),
    reader.readContract({...common,functionName:"proofProfileId"}),
    reader.readContract({...common,functionName:"receipts",args:[anchorId]}),
    reader.readContract({...common,functionName:"sourceStatus",args:[anchorId,options.currentBlockHash ?? `0x${"00".repeat(32)}`,options.sourcePath ?? []]}),
  ]);
  const immutable = controller.toLowerCase() === `0x${"00".repeat(20)}`;
  const [admitted,anchor] = await Promise.all([
    immutable ? reader.readContract({...common,functionName:"configLocked"}) : reader.readContract({address:controller,abi:admissionAbi,functionName:"isAdmitted",args:[profileId,adapter,3,4190024665],blockNumber:block.number}),
    reader.readContract({address:registry,abi:ABIS.KeelAttestedAnchorRegistry,functionName:"anchorState",args:[anchorId],blockNumber:block.number}),
  ]);
  return {chainId,blockNumber:block.number,blockTimestamp:block.timestamp,adapter,registry,controller,profileId,
    admissionMode:immutable ? "immutable" as const : "governed" as const,
    profileAdmitted:admitted,recordedAcceptance:receipt[1] !== 0n,
    receipt:{blockHeight:receipt[0],acceptedAt:receipt[1],nonce:receipt[2],blockHash:receipt[3],evidenceHash:receipt[4],acceptedTip:receipt[5],acceptedRoot:receipt[6]},
    sourceStatus:status,sourceStatusLabel:bitcoinSourceStatusLabels[status] ?? "Unknown status",anchor};
}

/** Simulate, sign on the selected destination, confirm, then read exact state. */
export async function submitBitcoinAttachment(options: {
  publicClient: PublicClient; walletClient: WalletClient; expectedChainId:number;
  account:Address; adapter:Address; anchorId:Hex; expectedProfileId:Hex;
  values:BitcoinProofValues; proof:Hex; sourcePath?:readonly Hex[];
}) {
  const {publicClient:reader,walletClient:wallet,adapter,anchorId,account} = options;
  await requireNetwork(reader,options.expectedChainId);
  if (await wallet.getChainId() !== options.expectedChainId) throw new Error("Wallet is on the wrong network");
  const profileId = await reader.readContract({address:adapter,abi:bitcoinProofAdapterAbi,functionName:"proofProfileId"});
  if (profileId.toLowerCase() !== options.expectedProfileId.toLowerCase()) throw new Error("Pinned proof profile mismatch");
  const args = [anchorId,0,options.values,options.proof] as const;
  await reader.simulateContract({address:adapter,abi:bitcoinProofAdapterAbi,functionName:"submitZkAnchor",args,account});
  const destination = defineChain({id: options.expectedChainId,name: "Selected destination",nativeCurrency:{name:"Native",symbol:"ETH",decimals:18},rpcUrls:{default:{http:[]}}});
  const hash = await wallet.sendTransaction({account,chain:destination,to:adapter,data:encodeFunctionData({abi:bitcoinProofAdapterAbi,functionName:"submitZkAnchor",args})});
  const transaction = await reader.waitForTransactionReceipt({hash});
  if (transaction.status !== "success") throw new Error("Proof submission reverted");
  const readback = await readBitcoinAttachment({publicClient:reader,expectedChainId:options.expectedChainId,adapter,anchorId,
    currentBlockHash:options.values.blockHash,...(options.sourcePath ? {sourcePath:options.sourcePath}: {})});
  if (!readback.recordedAcceptance || readback.receipt.evidenceHash === `0x${"00".repeat(32)}`) throw new Error("Confirmed transaction has no attachment receipt");
  if (readback.blockNumber < transaction.blockNumber || readback.profileId.toLowerCase() !== options.expectedProfileId.toLowerCase()
    || readback.receipt.evidenceHash.toLowerCase() !== sha256(encodeBitcoinProofValues(options.values)).toLowerCase()
    || readback.receipt.blockHash.toLowerCase() !== options.values.blockHash.toLowerCase()
    || readback.receipt.blockHeight !== options.values.blockHeight
    || readback.receipt.acceptedTip.toLowerCase() !== options.values.tipHash.toLowerCase()
    || readback.receipt.acceptedRoot.toLowerCase() !== options.values.headersRoot.toLowerCase()) {
    throw new Error("Attachment readback does not match the submitted evidence and pinned profile");
  }
  return {hash,transaction,readback};
}
