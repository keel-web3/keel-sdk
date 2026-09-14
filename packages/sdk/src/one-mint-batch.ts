import { type decodeOneMintNftCoupon, oneMintNftCouponIdsDigest, normalizeOneMintCoupon, quoteOneMintCouponTerms, type OneMintCouponSelection, type OneMintCouponRedemption } from "./one-mint-coupons.js";
import { calculateKeelMintPrice } from "./mint-pricing.js";
import { decodeEventLog, parseAbi, encodeFunctionData, getAddress, zeroAddress, zeroHash, type Address, type Hex, type PublicClient } from "viem";
import { ABIS } from "./abis/keel-mint-access.generated.js";

const batchTransferAbi = parseAbi(["event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values)", "event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)"]);

type Integer = bigint | number | string;
export interface OneMintBatchSelection {
  readonly coupon?: OneMintCouponSelection;
  readonly dropId: Hex;
  readonly stageIndex: number;
  readonly quantity: Integer;
  readonly mintData: Hex;
  readonly allowance?: number;
  readonly merkleProof?: readonly Hex[];
  readonly entitlementIds?: readonly bigint[];
  readonly signed?: {
    readonly account: Address;
    readonly quantity: number;
    readonly nonce: bigint;
    readonly deadline: bigint;
    readonly contextHash: Hex;
    readonly signature: Hex;
  };
}
export interface OneMintBatchRow extends OneMintBatchSelection {
  readonly coupon?: OneMintCouponRedemption;
  readonly couponTerms?: bigint;
  readonly nftCouponPolicy?: ReturnType<typeof decodeOneMintNftCoupon>;
  readonly platformFeeBps?: number;
  readonly feeTreasury?: Address;
  readonly target: Address;
  readonly tokenId: bigint;
  readonly paymentAsset: Address;
  readonly unitPrice: bigint;
  readonly stageKind: number;
  readonly reserved: boolean;
}
function uint(value: Integer, bits: number, label: string, minimum = 0n): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer.`);
  if (typeof value === "string" && !/^\d+$/u.test(value)) throw new TypeError(`${label} must be a decimal integer.`);
  const n = BigInt(value);
  if (n < minimum || n >= 1n << BigInt(bits)) throw new RangeError(`${label} exceeds uint${bits}.`);
  return n;
}
function hex(value: string, label: string, bytes?: number): Hex {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/u.test(value) || (bytes !== undefined && value.length !== 2 + 2 * bytes)) throw new TypeError(`${label} has invalid bytes.`);
  return value as Hex;
}
function address(value: Address, nonzero = false): Address {
  const a = getAddress(value);
  if (nonzero && a === zeroAddress) throw new RangeError("Address cannot be zero.");
  return a;
}

/** Builds a review-only checkout from supplied state. Use quoteOneMintBatch for pinned live reads, then simulate before signing. */
export function buildOneMintBatchCheckout(input: {
  readonly controller: Address;
  readonly buyer: Address;
  readonly chainId: number;
  readonly rows: readonly OneMintBatchRow[];
}) {
  const controller = address(input.controller, true), buyer = address(input.buyer, true);
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1) throw new RangeError("Invalid chain ID.");
  if (!input.rows.length) throw new RangeError("Select at least one drop.");
  const rows = input.rows.map(row => ({ ...row, target: address(row.target, true), paymentAsset: address(row.paymentAsset), tokenId: uint(row.tokenId, 256, "tokenId"), quantity: uint(row.quantity, 32, "quantity", 1n), unitPrice: uint(row.unitPrice, 96, "unitPrice") }))
    .sort((a, b) => a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0);
  const first = rows[0]!;
  if ((first.platformFeeBps ?? 0) > 0 && address(first.feeTreasury ?? zeroAddress) === zeroAddress) throw new RangeError("Fee policy requires its treasury.");
  const dropIds = new Set<string>();
  let total = 0n, gross = 0n, discount = 0n, platformFee = 0n;
  const redemptions: OneMintCouponRedemption[] = [];
  const prices: ReturnType<typeof calculateKeelMintPrice>[] = [];
  const purchases = rows.map((row, i) => {
    if (row.target !== first.target || row.paymentAsset !== first.paymentAsset || row.reserved !== first.reserved) throw new RangeError("Batch drops must share collection, currency and reservation mode.");
    if (i && row.tokenId === rows[i - 1]!.tokenId) throw new RangeError("Use one selection per item ID.");
    const dropId = hex(row.dropId, "dropId", 32);
    if (dropId === zeroHash || dropIds.has(dropId.toLowerCase())) throw new RangeError("Drop IDs must be nonzero and unique.");
    dropIds.add(dropId.toLowerCase());
    if (![1, 2, 6, 8, 12].includes(row.stageKind)) throw new RangeError("This stage does not support collector checkout.");
    const stageIndex = Number(uint(row.stageIndex, 16, "stageIndex"));
    const signed = row.stageKind === 1 || row.stageKind === 8;
    if (signed && !row.signed) throw new TypeError("This stage requires its existing signed authorization.");
    if (signed && (address(row.signed!.account) !== buyer || BigInt(row.signed!.quantity) !== row.quantity)) throw new RangeError("Signed buyer and quantity must match the selection.");
    const allowance = Number(uint(row.allowance ?? 0, 32, "allowance"));
    if (row.stageKind === 12 && BigInt(allowance) < row.quantity) throw new RangeError("Merkle allowance is below quantity.");
    const entitlementIds = (row.entitlementIds ?? []).map(id => uint(id, 256, "entitlementId"));
    if (row.stageKind === 8 && (entitlementIds.length !== Number(row.quantity) || entitlementIds.length > 64 || new Set(entitlementIds).size !== entitlementIds.length)) throw new RangeError("Claim IDs must be distinct and match the quantity, up to 64.");
    if ((row.platformFeeBps ?? 0) !== (first.platformFeeBps ?? 0) || (row.feeTreasury ?? zeroAddress).toLowerCase() !== (first.feeTreasury ?? zeroAddress).toLowerCase()) throw new RangeError("Batch rows must share the platform fee policy.");
    if (row.coupon && (!row.couponTerms || row.coupon.couponId === zeroHash)) throw new Error("Coupon terms must come from the quoted campaign.");
    if (!row.coupon && row.couponTerms) throw new Error("Discount terms require a coupon redemption.");
    redemptions.push(row.coupon ? normalizeOneMintCoupon(row.coupon) : {couponId:zeroHash, signature:"0x", nonce:0n, revision:0n, deadline:0n});
    const price = calculateKeelMintPrice({unitPrice:row.unitPrice,quantity:row.quantity,terms:row.couponTerms ?? 0n,platformFeeBps:row.platformFeeBps ?? 0});
    prices.push(price); total += price.paid; gross += price.gross; discount += price.discount; platformFee += price.platformFee;
    uint(total, 256, "total");
    return {
      mintData: hex(row.mintData, "mintData"), signature: signed ? hex(row.signed!.signature, "signature") : "0x" as Hex,
      allowance, merkleProof: (row.merkleProof ?? []).map(p => hex(p, "proof", 32)), entitlementIds,
      authorization: { dropId, stageIndex, account: buyer, quantity: Number(row.quantity),
        nonce: signed ? uint(row.signed!.nonce, 256, "nonce") : 0n,
        deadline: signed ? uint(row.signed!.deadline, 64, "deadline") : 0n,
        contextHash: signed ? hex(row.signed!.contextHash, "contextHash", 32) : zeroHash },
    };
  });
  const value = first.paymentAsset === zeroAddress ? total : 0n;
  const usesCoupons = rows.some(row => row.coupon !== undefined);
  const nftProofs = redemptions.map(c=>c.nft ?? {tokenIds:[],proofs:[]});
  const usesNftCoupons = redemptions.some(c=>c.nft!==undefined);
  const data = usesNftCoupons
    ? encodeFunctionData({abi:ABIS.OneMintController,functionName:"batchMintWithNftCoupons",args:[first.paymentAsset,total,purchases,redemptions,nftProofs]})
    : usesCoupons
    ? encodeFunctionData({abi:ABIS.OneMintController,functionName:"batchMintWithCoupons",args:[first.paymentAsset,total,purchases,redemptions]})
    : encodeFunctionData({abi:ABIS.OneMintController,functionName:"batchMint",args:[first.paymentAsset,total,purchases]});
  return { status: "review-only" as const, chainId: input.chainId, buyer, controller, target: first.target, paymentAsset: first.paymentAsset,
    total, gross, discount, platformFee, creatorProceeds:total-platformFee, feeTreasury:first.feeTreasury ?? zeroAddress, prices, usesCoupons, usesNftCoupons, nftProofs, redemptions, value, purchases, rows, call: { to: controller, data, value },
    approval: first.paymentAsset !== zeroAddress && total !== 0n ? { token: first.paymentAsset, spender: controller, amount: total } : null,
  };
}

/** All prices and allocation checks use one block. Signature, queue and target-hook acceptance still require transaction simulation. */
export async function quoteOneMintBatch(client: PublicClient, input: {
  readonly chainId: number; readonly controller: Address; readonly buyer: Address;
  readonly selections: readonly OneMintBatchSelection[];
}) {
  if (await client.getChainId() !== input.chainId) throw new Error("RPC chain does not match checkout.");
  if (!input.selections.length) throw new RangeError("Select at least one drop.");
  const block = await client.getBlock();
  const feeRead = {address:input.controller,abi:ABIS.OneMintController,blockNumber:block.number} as const;
  const [platformFeeBps,feeTreasury] = await Promise.all([
    client.readContract({...feeRead,functionName:"platformFeeBps"}), client.readContract({...feeRead,functionName:"feeTreasury"}),
  ]);
  const rows = await Promise.all(input.selections.map(async selection => {
    const args = { address: input.controller, abi: ABIS.OneMintController, blockNumber: block.number } as const;
    const [drop, stage, minted] = await Promise.all([
      client.readContract({ ...args, functionName: "getDrop", args: [selection.dropId] }),
      client.readContract({ ...args, functionName: "getStage", args: [selection.dropId, selection.stageIndex] }),
      client.readContract({ ...args, functionName: "mintedBy", args: [selection.dropId, input.buyer] }),
    ]);
    const quantity = uint(selection.quantity, 32, "quantity", 1n);
    if (!drop.exists || drop.closed || drop.paused || !drop.itemized || block.timestamp < stage.startTime || block.timestamp >= stage.endTime) throw new Error("A selected drop is unavailable.");
    if (quantity > BigInt(stage.maxPerTransaction || drop.defaultMaxPerTransaction) || minted + quantity > BigInt(stage.maxPerWallet || drop.defaultMaxPerWallet)) throw new Error("A selected quantity exceeds its transaction or wallet limit.");
    if (drop.supply !== (1n << 64n) - 1n && drop.minted + quantity > drop.supply) throw new Error("A selected drop has insufficient supply.");
    const coupon = selection.coupon ? await quoteOneMintCouponTerms(client,{...input,dropId:selection.dropId,stageIndex:selection.stageIndex,quantity,coupon:selection.coupon,blockNumber:block.number,timestamp:block.timestamp}) : undefined;
    const {coupon: _requestedCoupon, ...selectionFields} = selection;
    return { ...selectionFields, ...(coupon ? {coupon:coupon.coupon,couponTerms:coupon.couponTerms,...(coupon.nftPolicy?{nftCouponPolicy:coupon.nftPolicy}:{})} : {}), platformFeeBps,feeTreasury, target: drop.target, tokenId: drop.targetTokenId, paymentAsset: stage.paymentAsset,
      unitPrice: stage.unitPrice, stageKind: stage.kind, reserved: drop.capacityReserved };
  }));
  return { ...buildOneMintBatchCheckout({ ...input, rows }), blockNumber: block.number, blockHash: block.hash };
}

/** Correlates each purchased drop and the single collection batch; unrelated logs cannot establish success. */
export function verifyOneMintBatchReceipt(
  plan: ReturnType<typeof buildOneMintBatchCheckout>,
  logs: readonly { readonly address: string; readonly data: Hex; readonly topics: readonly Hex[] }[],
) {
  const expected = new Map(plan.rows.map((row,i) => [row.dropId.toLowerCase(), {...row, expectedPaid:plan.prices[i]!.paid}]));
  const nftRows = new Map(plan.rows.filter(row=>row.coupon?.nft).map(row=>[row.dropId.toLowerCase(),row]));
  const couponRows = new Map(plan.rows.filter(row=>row.coupon).map(row=>[row.dropId.toLowerCase(),row]));
  let feeSeen = false;
  let collectionBatch = false;
  for (const log of logs) {
    if (log.address.toLowerCase() === plan.controller.toLowerCase()) {
      let event;
      try { event = decodeEventLog({ abi: ABIS.OneMintController, data: log.data, topics: log.topics as [Hex, ...Hex[]] }); } catch { continue; }
      if (event.eventName === "MintPlatformFeePaid") {
        const a=event.args;
        if (feeSeen || plan.platformFee === 0n || a.amount !== plan.platformFee || a.asset.toLowerCase() !== plan.paymentAsset.toLowerCase() || a.treasury.toLowerCase() !== plan.feeTreasury.toLowerCase()) throw new Error("Platform fee receipt does not match checkout.");
        feeSeen=true; continue;
      }
      if (event.eventName === "NftCouponRedeemed") {
        const a=event.args,row=nftRows.get(a.dropId.toLowerCase());
        if(!row?.coupon?.nft || a.couponId.toLowerCase()!==row.coupon.couponId.toLowerCase() || a.buyer.toLowerCase()!==plan.buyer.toLowerCase() || a.revision!==row.coupon.revision || a.claims!==row.coupon.nft.tokenIds.length || a.tokenIdsDigest.toLowerCase()!==oneMintNftCouponIdsDigest(row.coupon.nft.tokenIds).toLowerCase()) throw new Error("NFT coupon receipt does not match checkout.");
        nftRows.delete(a.dropId.toLowerCase());continue;
      }
      if (event.eventName === "CouponRedeemed") {
        const a=event.args,row=couponRows.get(a.dropId.toLowerCase());
        const index=plan.rows.findIndex(r=>r.dropId.toLowerCase()===a.dropId.toLowerCase());
        if (!row?.coupon || a.couponId.toLowerCase()!==row.coupon.couponId.toLowerCase() || a.buyer.toLowerCase()!==plan.buyer.toLowerCase() || BigInt(a.quantity)!==row.quantity || a.nonce!==row.coupon.nonce || a.revision!==row.coupon.revision || a.discount!==plan.prices[index]!.discount) throw new Error("Coupon receipt does not match checkout.");
        couponRows.delete(a.dropId.toLowerCase());continue;
      }
      if (event.eventName !== "DropMinted") continue;
      const args = event.args;
      const row = expected.get(args.dropId.toLowerCase());
      if (!row || args.account.toLowerCase() !== plan.buyer.toLowerCase() || args.stageIndex !== row.stageIndex || BigInt(args.quantity) !== row.quantity || args.paid !== row.expectedPaid || args.kind !== row.stageKind) throw new Error("Mint receipt does not match the checkout.");
      expected.delete(args.dropId.toLowerCase());
    } else if (log.address.toLowerCase() === plan.target.toLowerCase()) {
      let event;
      try { event = decodeEventLog({ abi: batchTransferAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] }); } catch { continue; }
      if (event.eventName === "TransferSingle") {
        const a=event.args;
        if (a.from !== zeroAddress || a.to.toLowerCase() !== plan.buyer.toLowerCase()) continue;
        if (collectionBatch || plan.rows.length !== 1 || a.id !== plan.rows[0]!.tokenId || a.value !== plan.rows[0]!.quantity) throw new Error("Collection receipt does not match the checkout.");
        collectionBatch=true;continue;
      }
      const a = event.args;
      if (a.from !== zeroAddress || a.to.toLowerCase() !== plan.buyer.toLowerCase()) continue;
      if (collectionBatch || a.ids.length !== plan.rows.length || a.values.length !== plan.rows.length || plan.rows.some((r, i) => a.ids[i] !== r.tokenId || a.values[i] !== r.quantity)) throw new Error("Collection receipt does not match the checkout.");
      collectionBatch = true;
    }
  }
  if (nftRows.size || couponRows.size || (plan.platformFee !== 0n && !feeSeen) || expected.size || !collectionBatch) throw new Error("Checkout receipt is missing correlated mint events.");
  return { tokenIds: plan.rows.map(row => row.tokenId), quantities: plan.rows.map(row => row.quantity), drops: plan.rows.map(row => row.dropId) };
}

/** Prepares a single coupon purchase, including ERC721 targets. No transaction is signed. */
export function buildOneMintCouponMint(input: {
  readonly controller: Address; readonly buyer: Address; readonly chainId: number; readonly row: OneMintBatchRow;
}) {
  if (!input.row.coupon) throw new Error("Select a coupon for this entrypoint.");
  const checkout = buildOneMintBatchCheckout({...input,rows:[input.row]});
  const data = checkout.usesNftCoupons
    ? encodeFunctionData({abi:ABIS.OneMintController,functionName:"mintWithNftCoupon",args:[checkout.purchases[0]!,checkout.redemptions[0]!,checkout.nftProofs[0]!,checkout.total]})
    : encodeFunctionData({abi:ABIS.OneMintController,functionName:"mintWithCoupon",args:[checkout.purchases[0]!,checkout.redemptions[0]!,checkout.total]});
  return {...checkout,call:{...checkout.call,data}};
}
