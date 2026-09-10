import { decodeFunctionData, concatHex, encodeAbiParameters, encodeFunctionData, getAddress, hexToBytes, keccak256, parseAbi, sha256, stringToHex, toHex, type Address, type Hex, type PublicClient } from "viem";
import { keelPauseBits } from "./admin-pauses.js";
import { keelHoldAbi } from "./abi.js";
import { createKeelNativeObjectPlan } from "./native-publication.js";

const abi = parseAbi(keelHoldAbi);
const treasuryAbi = parseAbi(["function claim(address recipient,address[] tokens)"]);
export interface KeelHoldLimits {
  maxSlugBytes: number; maxBatchSlugs: number; maxChildrenPerObject: number; maxReadDepth: number; revision: bigint;
}
export interface KeelPlatformTransaction { target: Address; value: bigint; data: Hex; signer: Address; }

/** Deployment defaults are cents converted once at an explicitly supplied rate.
 * Rates are micro-USD per native coin. These defaults do not install an oracle. */
export function createKeelFeeDefaults(nativeUsdMicros: bigint) {
  if (nativeUsdMicros <= 0n) throw new RangeError("A positive native-currency USD rate is required.");
  const convert = (cents: bigint) => {
    const numerator = cents * 10_000n * 10n ** 18n;
    const wei = (numerator + nativeUsdMicros - 1n) / nativeUsdMicros;
    if (wei > (1n << 64n) - 1n) throw new RangeError("Fee exceeds the contract's uint64 range.");
    return wei;
  };
  return {
    sealFees: { perChunkWei: convert(4n), baseSealWei: convert(10n), stepSealWei: convert(10n), chunksPerStep: 10, revision: 1 },
    harnessFeeWei: convert(25n),
  };
}

/** One unsigned governance action claims every listed payment asset. Native
 * currency is included automatically; creator balances are outside this call. */
export function buildKeelTreasuryClaim(treasury: Address, recipient: Address, assets: readonly Address[] = []) {
  const tokens = [...new Set(assets.map(asset => getAddress(asset).toLowerCase() as Address))]
    .filter(asset => BigInt(asset) !== 0n).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
  return { target: getAddress(treasury), value: 0n, data: encodeFunctionData({ abi: treasuryAbi, functionName: "claim", args: [getAddress(recipient), tokens] }) };
}

/** Builds the paid native-storage path from one selected-chain snapshot.
 * The intent includes the final root and total ordered slug count, including
 * reused slugs. Only missing unique payloads need upload transactions. */
export async function prepareKeelWeld(input: {
  client: Pick<PublicClient, "readContract" | "getBlockNumber">;
  hold: Address; payer: Address; executor?: Address; bytes: Uint8Array; mediaType: string; objectName: string;
  renderer?: Address;
}) {
  const source = input.bytes.slice(), hold = getAddress(input.hold), payer = getAddress(input.payer);
  const executor = getAddress(input.executor ?? payer), blockNumber = await input.client.getBlockNumber({ cacheTime: 0 });
  const [maxSlugBytes, maxBatchSlugs, maxChildrenPerObject, maxReadDepth, revision] =
    await input.client.readContract({ address: hold, abi, functionName: "limits", blockNumber });
  const limits: KeelHoldLimits = { maxSlugBytes, maxBatchSlugs, maxChildrenPerObject, maxReadDepth, revision };
  for (const value of [limits.maxSlugBytes, limits.maxBatchSlugs, limits.maxChildrenPerObject, limits.maxReadDepth])
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("Invalid Hold limits.");
  const plan = await createKeelNativeObjectPlan(source, {
    objectName: input.objectName, mediaType: input.mediaType, keccak256,
    maxChunkBytes: limits.maxSlugBytes, maxBatchSlugs: limits.maxBatchSlugs,
    readSlug: async slugId => {
      const pointer = await input.client.readContract({ address: hold, abi, functionName: "slugPointer", args: [slugId], blockNumber });
      if (BigInt(pointer) === 0n) return null;
      return hexToBytes(await input.client.readContract({ address: hold, abi, functionName: "getSlug", args: [slugId], blockNumber }));
    },
  });
  const slugCount = plan.slugIds.length;
  if (slugCount > 0xffff_ffff) throw new RangeError("Publication exceeds the intent's slug-count range.");
  type Node = { id: Hex; start: number; end: number };
  const candidates: { id: Hex; operation: KeelPlatformTransaction }[] = [];
  let level: Node[] = [];
  const fanout = limits.maxChildrenPerObject;
  for (let i = 0; i < slugCount; i += fanout) {
    const ids = plan.slugIds.slice(i, i + fanout), start = i * limits.maxSlugBytes;
    const end = Math.min(source.length, (i + ids.length) * limits.maxSlugBytes), length = BigInt(end - start);
    const digest = sha256(source.subarray(start, end));
    const id = keccak256(encodeAbiParameters(
      [{ type: "bytes1" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }, { type: "uint64" }, { type: "uint8" }, { type: "bytes32" }],
      ["0x00", keccak256(concatHex(ids)), digest, length, length, 0, keccak256(stringToHex(input.mediaType))],
    ));
    candidates.push({ id, operation: { target: hold, signer: executor, value: 0n, data: encodeFunctionData({ abi, functionName: "weldObject", args: [ids, digest, length, 0, input.mediaType] }) } });
    level.push({ id, start, end });
  }
  if (level.length > 1 && fanout < 2) throw new RangeError("This Hold's fanout cannot represent the requested object.");
  let depth = 0;
  while (level.length > 1) {
    if (++depth > limits.maxReadDepth) throw new RangeError("Object exceeds the selected Hold's read depth.");
    const next: Node[] = [];
    for (let i = 0; i < level.length; i += fanout) {
      const parts = level.slice(i, i + fanout), start = parts[0]!.start, end = parts.at(-1)!.end;
      const ids = parts.map(part => part.id), length = BigInt(end - start), digest = sha256(source.subarray(start, end));
      const id = keccak256(encodeAbiParameters(
        [{ type: "bytes1" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }, { type: "uint64" }, { type: "bytes32" }],
        ["0x01", keccak256(concatHex(ids)), digest, length, length, keccak256(stringToHex(input.mediaType))],
      ));
      candidates.push({ id, operation: { target: hold, signer: executor, value: 0n, data: encodeFunctionData({ abi, functionName: "weldComposite", args: [ids, digest, length, input.mediaType] }) } });
      next.push({ id, start, end });
    }
    level = next;
  }
  const objectId = level[0]!.id;
  const intentId = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }, { type: "address" }], [payer, objectId, executor]));
  const intent = await input.client.readContract({ address: hold, abi, functionName: "weldIntent", args: [intentId], blockNumber });
  const sealed = await input.client.readContract({ address: hold, abi, functionName: "isSealed", args: [objectId], blockNumber });
  const transactions: KeelPlatformTransaction[] = [];
  let publicationFee = 0n;
  if (!sealed || (BigInt(intent.executor) !== 0n && !intent.complete)) {
    if (BigInt(intent.executor) === 0n) {
      const [fee, revision] = await input.client.readContract({ address: hold, abi, functionName: "quoteWeld", args: [slugCount, payer], blockNumber });
      publicationFee = fee;
      transactions.push({ target: hold, signer: payer, value: fee, data: encodeFunctionData({ abi, functionName: "initWeld", args: [objectId, slugCount, executor, revision] }) });
    } else if (intent.complete || intent.slugCount !== slugCount || intent.objectId.toLowerCase() !== objectId.toLowerCase() || getAddress(intent.executor) !== executor) {
      throw new Error("Stored intent differs from this publication plan.");
    }
    if (BigInt(intent.executor) !== 0n && plan.chunks.length > intent.remainingSlugs)
      throw new Error("Stored intent has insufficient remaining upload allowance.");
    for (const batch of plan.carrierBatches) transactions.push({ target: hold, signer: executor, value: 0n,
      data: encodeFunctionData({ abi, functionName: "castSlugsFor", args: [intentId, batch.map(bytes => toHex(bytes))] }) });
    // Bound RPC concurrency and preserve dependency order.
    for (let start = 0; start < candidates.length; start += 8) {
      const page = candidates.slice(start, start + 8);
      const exists = await Promise.all(page.map(({ id }) => input.client.readContract({ address: hold, abi, functionName: "objectExists", args: [id], blockNumber })));
      for (let i = 0; i < page.length; ++i) if (!exists[i]) transactions.push(page[i]!.operation);
    }
    transactions.push({ target: hold, signer: executor, value: 0n, data: encodeFunctionData({ abi, functionName: "sealObject", args: [intentId] }) });
  }
  let harnessFee = 0n;
  if (input.renderer) {
    const renderer = getAddress(input.renderer);
    const registered = await input.client.readContract({ address: hold, abi, functionName: "harnessRegistered", args: [objectId, renderer], blockNumber });
    if (!registered) {
      const fees = await input.client.readContract({ address: hold, abi, functionName: "harnessFees", blockNumber });
      const exempt = await input.client.readContract({ address: hold, abi, functionName: "feeExempt", args: [payer], blockNumber });
      harnessFee = exempt ? 0n : fees.registrationWei;
      transactions.push({ target: hold, signer: payer, value: harnessFee, data: encodeFunctionData({ abi, functionName: "registerHarness", args: [objectId, renderer, fees.revision] }) });
    }
  }
  const operationMasks: Record<string,bigint> = {
    initWeld: keelPauseBits.chunking | keelPauseBits.publication,
    castSlugsFor: keelPauseBits.chunking, weldObject: keelPauseBits.publication,
    weldComposite: keelPauseBits.publication, sealObject: keelPauseBits.publication,
    registerHarness: keelPauseBits.viewers,
  };
  const requiredMask = transactions.reduce((mask,transaction) => mask | (operationMasks[decodeFunctionData({abi,data:transaction.data}).functionName] ?? 0n),0n);
  if (requiredMask !== 0n) await input.client.readContract({address:hold,abi,functionName:"requireSystemsActive",args:[requiredMask],blockNumber});
  return { objectId, intentId, slugCount, limits, blockNumber, transactions, publicationFee, harnessFee,
    platformFee: publicationFee + harnessFee, storedBytes: plan.storedBytes, reusedBytes: plan.reusedBytes };
}
