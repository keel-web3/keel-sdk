/**
 * Per-transaction gas: EIP-7825 caps a transaction's gas limit at 2^24 (16,777,216) on Ethereum mainnet and its
 * testnets from Fusaka (Osaka) on. A wallet or RPC rejects a larger limit outright ("transaction gas limit too
 * high"), so every KEEL-prepared request carries an explicit limit at or under the cap, and a single operation
 * that cannot fit is refused at prepare time. Browser-safe: no I/O.
 */
export const KEEL_EIP7825_TX_GAS_CAP = 16_777_216;

/** Margin applied to an estimate to get the limit a wallet is given (7%). */
export const KEEL_TX_GAS_MARGIN_PERCENT = 107;

/** Packing target: the largest estimate whose margined limit still fits the cap (~15.68M). */
export const KEEL_CAST_TARGET_GAS = Math.floor((KEEL_EIP7825_TX_GAS_CAP * 100) / KEEL_TX_GAS_MARGIN_PERCENT);

/** KeelHold's per-call slug batch (the adapter's CHUNK_STORE_MAX_BATCH_SLUGS). */
export const KEEL_CAST_MAX_SLUGS = 3;

/**
 * The transaction gas cap KEEL applies on a chain. EIP-7825 is in force on Ethereum mainnet, Sepolia and Hoodi;
 * other EVM chains get the same cap as KEEL policy (a request that fits it fits everywhere), further bounded by the
 * selected block gas limit when it is known.
 */
export function keelTransactionGasCap(input: { readonly chainId?: number; readonly blockGasLimit?: bigint | number } = {}) {
  const block = input.blockGasLimit === undefined ? undefined : Number(input.blockGasLimit);
  const cap = block !== undefined && block > 0 && block < KEEL_EIP7825_TX_GAS_CAP ? block : KEEL_EIP7825_TX_GAS_CAP;
  const eip7825 = input.chainId === undefined || [1, 11155111, 560048].includes(input.chainId);
  return {
    gasCap: cap,
    source: cap < KEEL_EIP7825_TX_GAS_CAP ? "block-gas-limit" as const : eip7825 ? "eip-7825" as const : "keel-policy-eip-7825" as const,
    targetGas: Math.floor((cap * 100) / KEEL_TX_GAS_MARGIN_PERCENT),
  };
}

/**
 * Gas model fitted to KeelHold receipts on a Sepolia fork (REDLINE car run: 1-, 2- and 3-slug casts from 1 KB to
 * 69 KB; fit 46.7k + 24.4k/slug + 219/byte, max residual 0.2%). The constants are rounded UP so estimates run
 * about 1.5% high: 50k + 30k per slug + 222 gas per payload byte.
 */
export function keelCastGasEstimate(payloadByteLengths: readonly number[]): number {
  return 50_000 + 30_000 * payloadByteLengths.length + 222 * payloadByteLengths.reduce((total, length) => total + length, 0);
}

/** Measured 126k (1 slug) to 214k (10 slugs): 120k + 12k per slug id. */
export function keelWeldObjectGasEstimate(slugCount: number): number {
  return 120_000 + 12_000 * Math.max(1, slugCount);
}

/** Measured 201k for a 6-part root: 150k + 12k per part. */
export function keelWeldCompositeGasEstimate(partCount: number): number {
  return 150_000 + 12_000 * Math.max(1, partCount);
}

/** Estimate → wallet gas limit (estimate + 7%). `fits` is false when that limit exceeds the cap. */
export function keelGasLimit(estimatedGas: number, gasCap = KEEL_EIP7825_TX_GAS_CAP) {
  if (!Number.isSafeInteger(estimatedGas) || estimatedGas <= 0) throw new RangeError("estimatedGas must be a positive integer.");
  const gasLimit = Math.ceil((estimatedGas * KEEL_TX_GAS_MARGIN_PERCENT) / 100);
  return { estimatedGas, gasLimit: Math.min(gasLimit, gasCap), fits: gasLimit <= gasCap, gasCap };
}

/**
 * Pack slugs into as few castSlugs calls as possible: each call holds at most `maxSlugs` slugs and its estimate
 * stays at or under `targetGas`. First-fit decreasing; cast order is irrelevant to KeelHold (slugs are
 * content-addressed), welds only need every slug cast first. Throws when one slug alone cannot fit.
 */
export function packKeelCasts<T extends { readonly bytes: Uint8Array }>(chunks: readonly T[], options: { readonly maxSlugs?: number; readonly targetGas?: number } = {}): T[][] {
  const maxSlugs = options.maxSlugs ?? KEEL_CAST_MAX_SLUGS;
  const targetGas = options.targetGas ?? KEEL_CAST_TARGET_GAS;
  const bins: { items: T[]; bytes: number[] }[] = [];
  const ordered = chunks.map((chunk, index) => ({ chunk, index })).sort((left, right) => right.chunk.bytes.byteLength - left.chunk.bytes.byteLength || left.index - right.index);
  for (const { chunk } of ordered) {
    const size = chunk.bytes.byteLength;
    if (keelCastGasEstimate([size]) > targetGas) throw new RangeError(`A ${size}-byte slug needs ~${keelCastGasEstimate([size])} gas, above the ${targetGas} per-transaction target.`);
    const bin = bins.find((candidate) => candidate.items.length < maxSlugs && keelCastGasEstimate([...candidate.bytes, size]) <= targetGas);
    if (bin === undefined) bins.push({ items: [chunk], bytes: [size] });
    else {
      bin.items.push(chunk);
      bin.bytes.push(size);
    }
  }
  return bins.map((bin) => bin.items);
}

/** The fewest transactions a plan could possibly take under the cap: total estimated gas / cap, rounded up. */
export function keelMinimumTransactions(totalEstimatedGas: number, gasCap = KEEL_EIP7825_TX_GAS_CAP): number {
  return Math.max(1, Math.ceil(totalEstimatedGas / gasCap));
}
