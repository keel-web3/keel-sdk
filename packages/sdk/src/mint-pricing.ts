/** One purchase's pricing terms. Fixed values use the payment currency's base units. */
export type KeelMintDiscountKind = "none" | "percentage" | "fixedPerToken" | "fixedTotal";
export interface KeelMintDiscount {
  readonly kind: KeelMintDiscountKind;
  readonly value?: bigint;
  readonly buyQuantity?: number;
  readonly discountQuantity?: number;
}
const U256_MAX = (1n << 256n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const U32_MAX = (1n << 32n) - 1n;
const kinds = ["none", "percentage", "fixedPerToken", "fixedTotal"] as const;
function uint(value: bigint, maximum: bigint, name: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > maximum) throw new RangeError(`${name} is outside its unsigned integer range.`);
  return value;
}
function count(value: number, name: string): bigint {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
  return uint(BigInt(value), U32_MAX, name);
}
function validate(kind: number, value: bigint, buy: bigint, discounted: bigint): void {
  if (kind < 0 || kind > 3 || (kind === 0 ? value !== 0n || buy !== 0n || discounted !== 0n : value === 0n || (kind === 1 && value > 10000n) || ((buy === 0n) !== (discounted === 0n)))) {
    throw new RangeError("Invalid coupon terms.");
  }
}
/** Packs arithmetic terms only. Possessing a terms word does not authorize a discount. */
export function packKeelMintDiscount(input: KeelMintDiscount): bigint {
  const kind = kinds.indexOf(input.kind), value = uint(input.value ?? 0n, U128_MAX, "Discount value");
  const buy = count(input.buyQuantity ?? 0, "Buy quantity"), discounted = count(input.discountQuantity ?? 0, "Discount quantity");
  validate(kind, value, buy, discounted);
  return BigInt(kind) | (value << 8n) | (buy << 136n) | (discounted << 168n);
}
export function unpackKeelMintDiscount(word: bigint): Required<KeelMintDiscount> {
  uint(word, U256_MAX, "Coupon word");
  if (word >> 200n) throw new RangeError("Coupon reserved bits must be zero.");
  const kind = Number(word & 255n), value = (word >> 8n) & U128_MAX;
  const buy = (word >> 136n) & U32_MAX, discounted = (word >> 168n) & U32_MAX;
  validate(kind, value, buy, discounted);
  return { kind: kinds[kind]!, value, buyQuantity: Number(buy), discountQuantity: Number(discounted) };
}
/** Mirrors Solidity's checked full-width multiplication. */
export function keelMintSubtotal(unitPrice: bigint, quantity: bigint): bigint {
  uint(unitPrice, U256_MAX, "Unit price"); uint(quantity, U256_MAX, "Quantity");
  return uint(unitPrice * quantity, U256_MAX, "Subtotal");
}
/**
 * Pure arithmetic for one line, without coupon authorization or availability reads.
 * Selected quantity includes discounted units. Buy/discount cycles restart per
 * purchase. Fixed-total discounts apply once to the line. Percentages and platform
 * fees round down per line; sum those results for a batch. A 10000-bps percentage
 * makes eligible units free. Fee settings must come from the platform's policy.
 */
export function calculateKeelMintPrice(input: {
  readonly unitPrice: bigint;
  readonly quantity: bigint;
  readonly terms?: bigint;
  readonly platformFeeBps?: number;
}) {
  const bps = count(input.platformFeeBps ?? 0, "Platform fee");
  if (bps > 10000n) throw new RangeError("Platform fee exceeds 10000 basis points.");
  const gross = keelMintSubtotal(input.unitPrice, input.quantity);
  const terms = unpackKeelMintDiscount(input.terms ?? 0n);
  let eligibleQuantity = 0n, discount = 0n;
  if (terms.kind !== "none") {
    const buy = BigInt(terms.buyQuantity), discounted = BigInt(terms.discountQuantity);
    const cycle = buy + discounted;
    const remainder = cycle === 0n ? 0n : input.quantity % cycle;
    eligibleQuantity = cycle === 0n ? input.quantity : input.quantity / cycle * discounted + (remainder > buy ? remainder - buy : 0n);
    const eligible = input.unitPrice * eligibleQuantity;
    if (terms.kind === "percentage") discount = eligible * terms.value / 10000n;
    else if (terms.kind === "fixedPerToken") discount = (terms.value < input.unitPrice ? terms.value : input.unitPrice) * eligibleQuantity;
    else discount = terms.value < eligible ? terms.value : eligible;
  }
  const paid = gross - discount, platformFee = paid * bps / 10000n;
  return { gross, paid, discount, platformFee, creatorProceeds: paid - platformFee, eligibleQuantity } as const;
}
