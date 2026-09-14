import { encodeAbiParameters, concatHex, parseAbi, zeroHash, getAddress, keccak256, toBytes, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { ABIS } from "./abis/keel-mint-access.generated.js";
import { unpackKeelMintDiscount } from "./mint-pricing.js";

export interface OneMintCouponSelection {
  readonly nft?: OneMintNftCouponProof;
  readonly couponId: Hex;
  readonly signature?: Hex;
  readonly nonce?: bigint;
  readonly revision?: bigint;
  readonly deadline?: bigint;
}
export interface OneMintCouponRedemption extends OneMintCouponSelection {
  readonly signature: Hex;
  readonly nonce: bigint;
  readonly revision: bigint;
  readonly deadline: bigint;
}
const U64 = (1n << 64n) - 1n;
function bounded(n: bigint, bits: number, label: string) {
  if (typeof n !== "bigint" || n < 0n || n >= 1n << BigInt(bits)) throw new RangeError(`Invalid ${label}.`);
  return n;
}
function bytes(value: Hex, length?: number) {
  if (!/^0x(?:[a-fA-F0-9]{2})*$/u.test(value) || (length !== undefined && value.length !== 2 + length * 2)) throw new TypeError("Invalid coupon bytes.");
  return value;
}
/** Codes are case-sensitive UTF-8; an explicit bytes32 ID is accepted unchanged. */
export function oneMintCouponId(code: string): Hex {
  if (!code || code.trim() !== code) throw new TypeError("Enter a coupon code without surrounding whitespace.");
  return /^0x[0-9a-fA-F]{64}$/u.test(code) ? code as Hex : keccak256(toBytes(code));
}
export function normalizeOneMintCoupon(c: OneMintCouponRedemption): OneMintCouponRedemption {
  return { ...(c.nft ? {nft:normalizeOneMintNftCouponProof(c.nft)} : {}), couponId: bytes(c.couponId,32), signature: bytes(c.signature), nonce: bounded(c.nonce,64,"nonce"),
    revision: bounded(c.revision,64,"revision"), deadline: bounded(c.deadline,64,"deadline") };
}
export function decodeOneMintCoupon(terms: bigint, limits: bigint, authority: bigint, walletWord = 0n) {
  for (const word of [terms,limits,authority,walletWord]) bounded(word,256,"coupon word");
  const revision = authority >> 160n & U64;
  const currentWallet = (walletWord >> 128n & U64) === revision ? walletWord : 0n;
  if (terms !== 0n) unpackKeelMintDiscount(terms);
  return { terms, revision, active: authority >> 240n === 1n || authority >> 240n === 3n, nftRequired: (authority >> 241n & 1n) === 1n, signer: getAddress(`0x${(authority & ((1n << 160n)-1n)).toString(16).padStart(40,"0")}`),
    stageIndex: Number(authority >> 224n & 65535n), used: limits & U64, maxTotal: limits >> 64n & U64,
    maxPerWallet: limits >> 128n & U64, expiry: limits >> 192n, walletUsed: currentWallet & U64,
    nonce: currentWallet >> 64n & U64 };
}

/** Exact EIP-712 payload. Creating this data neither signs nor submits anything. */
export function oneMintCouponTypedData(input: {
  readonly chainId: number; readonly controller: Address; readonly buyer: Address; readonly paymentAsset: Address;
  readonly dropId: Hex; readonly stageIndex: number; readonly quantity: number; readonly mintData: Hex;
  readonly terms: bigint; readonly redemption: OneMintCouponRedemption;
}) {
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1) throw new RangeError("Invalid chain ID.");
  for (const [n,bits] of [[input.stageIndex,16],[input.quantity,32]]) if (!Number.isSafeInteger(n) || n! < 0 || n! >= 2 ** bits!) throw new RangeError("Invalid stage or quantity.");
  if (input.quantity === 0) throw new RangeError("Quantity must be positive.");
  unpackKeelMintDiscount(input.terms);
  const c = normalizeOneMintCoupon(input.redemption);
  return { domain: { name: "Keel OneMint", version: "2", chainId: input.chainId, verifyingContract: getAddress(input.controller) },
    primaryType: "KeelMintCoupon" as const,
    types: { KeelMintCoupon: [
      {name:"dropId",type:"bytes32"},{name:"couponId",type:"bytes32"},{name:"buyer",type:"address"},
      {name:"paymentAsset",type:"address"},{name:"stageIndex",type:"uint16"},{name:"quantity",type:"uint32"},
      {name:"terms",type:"uint256"},{name:"revision",type:"uint64"},{name:"nonce",type:"uint64"},
      {name:"deadline",type:"uint64"},{name:"contextHash",type:"bytes32"},
    ] }, message: { dropId: bytes(input.dropId,32), couponId:c.couponId, buyer:getAddress(input.buyer),
      paymentAsset:getAddress(input.paymentAsset), stageIndex:input.stageIndex, quantity:input.quantity,
      terms:input.terms, revision:c.revision, nonce:c.nonce, deadline:c.deadline, contextHash:c.nft ? keccak256(encodeAbiParameters([{type:"bytes32"},{type:"bytes32"}],[keccak256(bytes(input.mintData)),oneMintNftCouponIdsDigest(c.nft.tokenIds)])) : keccak256(bytes(input.mintData)) } } as const;
}

/** Reads campaign and wallet usage at the checkout block; final execution still requires simulation. */
export async function quoteOneMintCouponTerms(client: PublicClient, input: {
  readonly controller: Address; readonly buyer: Address; readonly dropId: Hex; readonly stageIndex: number;
  readonly quantity: bigint; readonly coupon: OneMintCouponSelection; readonly blockNumber: bigint; readonly timestamp: bigint;
}) {
  const common = { address:input.controller, abi:ABIS.OneMintController, blockNumber:input.blockNumber } as const;
  const [record,word] = await Promise.all([
    client.readContract({...common,functionName:"coupons",args:[input.dropId,input.coupon.couponId]}),
    client.readContract({...common,functionName:"couponWalletWord",args:[input.dropId,input.coupon.couponId,input.buyer]}),
  ]);
  const c=decodeOneMintCoupon(...record,word);
  if (!c.active || c.stageIndex !== input.stageIndex || c.terms === 0n) throw new Error("Coupon is unavailable for this stage.");
  if (input.quantity <= 0n || c.used+input.quantity > c.maxTotal || c.walletUsed+input.quantity > c.maxPerWallet) throw new Error("Coupon quantity exceeds its remaining allowance.");
  if (!c.nftRequired && input.coupon.nft) throw new Error("This coupon does not accept source NFTs.");
  const eligibility=c.nftRequired ? await quoteNftEligibility(client,input,input.coupon,c.revision) : undefined;
  const nft=eligibility?.proof;
  const signed = c.signer !== zeroAddress;
  if (signed && (input.coupon.signature === undefined || input.coupon.nonce === undefined || input.coupon.revision === undefined || input.coupon.deadline === undefined)) throw new Error("This coupon requires a signed authorization from its issuer.");
  const defaultDeadline = c.expiry !== 0n && c.expiry < input.timestamp+900n ? c.expiry : input.timestamp+900n;
  const redemption=normalizeOneMintCoupon({...(nft?{nft}:{}),couponId:input.coupon.couponId,signature:input.coupon.signature ?? "0x",
    nonce:input.coupon.nonce ?? c.nonce,revision:input.coupon.revision ?? c.revision,deadline:input.coupon.deadline ?? defaultDeadline});
  if (redemption.nonce !== c.nonce || redemption.revision !== c.revision) throw new Error("Coupon authorization is stale. Request a fresh authorization.");
  if (redemption.deadline < input.timestamp || (c.expiry !== 0n && c.expiry < input.timestamp)) throw new Error("Coupon expired.");
  if (!signed && redemption.signature !== "0x") throw new Error("Public coupons do not accept a signature.");
  return { coupon:redemption, couponTerms:c.terms, campaign:c, ...(eligibility?{nftPolicy:eligibility.policy}:{}) };
}

export interface OneMintNftCouponProof {
  readonly tokenIds: readonly bigint[];
  readonly proofs: readonly (readonly Hex[])[];
}
export function normalizeOneMintNftCouponProof(proof: OneMintNftCouponProof): OneMintNftCouponProof {
  if (!proof.tokenIds.length || proof.tokenIds.length > 64) throw new RangeError("Select 1–64 source NFT IDs.");
  const tokenIds=proof.tokenIds.map(id=>bounded(id,256,"source token ID"));
  if(tokenIds.some((id,i)=>i>0 && id<=tokenIds[i-1]!)) throw new Error("Source NFT IDs must be distinct and ascending.");
  if(proof.proofs.length!==0 && proof.proofs.length!==tokenIds.length) throw new Error("Provide one Merkle proof per source NFT.");
  return {tokenIds,proofs:proof.proofs.map(p=>p.map(h=>bytes(h,32)))};
}
export function oneMintNftCouponLeaf(collection: Address, tokenId: bigint): Hex {
  return keccak256(keccak256(encodeAbiParameters([{type:"address"},{type:"uint256"}],[getAddress(collection),bounded(tokenId,256,"source token ID")])));
}
export function oneMintNftCouponIdsDigest(tokenIds: readonly bigint[]): Hex {
  return keccak256(encodeAbiParameters([{type:"uint256[]"}],[tokenIds]));
}
export function decodeOneMintNftCoupon(root:Hex,word:bigint,firstTokenId:bigint,lastTokenId:bigint) {
  bounded(word,256,"NFT coupon word");
  return {root:bytes(root,32),collection:getAddress(`0x${(word&((1n<<160n)-1n)).toString(16).padStart(40,"0")}`),
    maxClaims:word>>160n&0xffffffffn,issued:word>>192n&0xffffffffn,quantityPerToken:word>>224n&0xffffffn,
    singleUse:(word>>248n&1n)!==0n,firstTokenId,lastTokenId};
}
async function quoteNftEligibility(client:PublicClient,input:{controller:Address;buyer:Address;dropId:Hex;quantity:bigint;blockNumber:bigint},coupon:OneMintCouponSelection,revision:bigint) {
  if(!coupon.nft) throw new Error("Select the source NFTs for this coupon.");
  const proof=normalizeOneMintNftCouponProof(coupon.nft);
  const common={address:input.controller,abi:ABIS.OneMintController,blockNumber:input.blockNumber} as const;
  const policy=decodeOneMintNftCoupon(...await client.readContract({...common,functionName:"nftCouponPolicies",args:[input.dropId,coupon.couponId]}));
  const count=BigInt(proof.tokenIds.length);
  if(policy.issued+count>policy.maxClaims) throw new Error("NFT coupon claim cap reached.");
  if(input.quantity<count || input.quantity>count*policy.quantityPerToken) throw new Error("Quantity exceeds the source NFTs' allowance.");
  if(proof.proofs.length!==(policy.root===zeroHash?0:proof.tokenIds.length)) throw new Error("NFT coupon requires matching Merkle proofs.");
  const domain=keccak256(encodeAbiParameters([{type:"bytes32"},{type:"bytes32"},{type:"uint64"}],[input.dropId,coupon.couponId,revision]));
  const buckets=[...new Set(proof.tokenIds.map(id=>id>>8n))];
  const words=new Map<bigint,bigint>(policy.singleUse ? await Promise.all(buckets.map(async bucket=>[bucket,await client.readContract({...common,functionName:"nftCouponUsedWords",args:[domain,bucket]})] as const)):[]);
  await Promise.all(proof.tokenIds.map(async (id,i)=>{
    if(id<policy.firstTokenId || id>policy.lastTokenId) throw new Error("Source NFT is outside the eligible range.");
    if(policy.singleUse && (words.get(id>>8n)!&(1n<<(id&255n)))!==0n) throw new Error("Source NFT has already redeemed this coupon.");
    if(policy.root!==zeroHash) {
      let hash=oneMintNftCouponLeaf(policy.collection,id);
      for(const sibling of proof.proofs[i]!) hash=keccak256(concatHex(BigInt(hash)<BigInt(sibling)?[hash,sibling]:[sibling,hash]));
      if(hash.toLowerCase()!==policy.root.toLowerCase()) throw new Error("Source NFT Merkle proof is invalid.");
    }
    const owner=await client.readContract({address:policy.collection,abi:parseAbi(["function ownerOf(uint256 tokenId) view returns(address)"]),functionName:"ownerOf",args:[id],blockNumber:input.blockNumber});
    if(owner.toLowerCase()!==input.buyer.toLowerCase()) throw new Error("The connected wallet does not own this source NFT.");
  }));
  return {proof,policy};
}
