import { z } from "zod";

export const vaultPsbtOutputPurposeSchema = z.enum([
  "seller-payment",
  "owner-change",
  "marketplace-fee",
  "stamp-purchase",
  "other",
]);

export type VaultPsbtOutputPurpose = z.infer<typeof vaultPsbtOutputPurposeSchema>;

export interface TrustedVaultSettlementPlan {
  readonly outputs: readonly {
    readonly destinationAddress: string;
    readonly purpose: VaultPsbtOutputPurpose;
    readonly valueSats: bigint | string;
  }[];
}

export interface VaultPsbtIndexedEvidence {
  readonly cardinalInputs: readonly {
    readonly inscriptionIds: readonly string[];
    readonly outpoint: string;
    readonly valueSats: bigint | string;
    readonly verifiedAtBlockHeight: number;
  }[];
  readonly inscription: {
    readonly address: string | null;
    readonly id: string;
    readonly inscriptionHeight: number;
    readonly satpoint: string;
    readonly verifiedAtBlockHeight: number;
  };
}

const satsSchema = z.string().regex(/^\d+$/);
const nullableInscriptionIdSchema = z.string().regex(/^[0-9a-f]{64}i(?:0|[1-9]\d*)$/).nullable();

export const vaultPsbtReviewSchema = z.object({
  version: z.literal(1),
  network: z.enum(["regtest", "testnet"]),
  action: z.enum(["winner-settlement", "cooperative-cancel", "timeout-refund"]),
  role: z.enum(["bidder", "patron"]),
  asset: z.object({
    inscriptionId: z.string().regex(/^[0-9a-f]{64}i(?:0|[1-9]\d*)$/),
    label: z.string().min(1).max(160),
    movement: z.string().min(1).max(320),
    indexedReceipt: z.object({
      address: z.string().nullable(),
      inscriptionHeight: z.number().int().nonnegative(),
      satpoint: z.string().regex(/^[0-9a-f]{64}:\d+:\d+$/),
      verifiedAtBlockHeight: z.number().int().nonnegative(),
    }).strict(),
  }).strict(),
  inputs: z.array(z.object({
    index: z.number().int().nonnegative(),
    outpoint: z.string().regex(/^[0-9a-f]{64}:\d+$/),
    valueSats: satsSchema,
    previousOutputScriptHex: z.string().regex(/^[0-9a-f]+$/),
    previousOutputAddress: z.string().nullable(),
    sequence: z.number().int().nonnegative(),
    rbfEnabled: z.boolean(),
    sighash: z.object({
      code: z.literal(0),
      label: z.literal("SIGHASH_DEFAULT"),
      commitsTo: z.literal("all-inputs-and-outputs"),
    }).strict(),
    inscription: z.object({
      included: z.boolean(),
      inscriptionId: nullableInscriptionIdSchema,
      satpoint: z.string().nullable(),
      explanation: z.string().min(1).max(320),
      cardinalOnlyVerified: z.literal(true),
      verifiedAtBlockHeight: z.number().int().nonnegative(),
    }).strict(),
  }).strict()).min(1),
  outputs: z.array(z.object({
    index: z.number().int().nonnegative(),
    purpose: vaultPsbtOutputPurposeSchema,
    valueSats: satsSchema,
    scriptHex: z.string().regex(/^[0-9a-f]+$/),
    scriptType: z.string().min(1),
    destinationAddress: z.string().nullable(),
  }).strict()).min(1),
  amounts: z.object({
    buyerPaymentSats: satsSchema,
    sellerPaymentSats: satsSchema,
    marketplaceFeeSats: satsSchema,
    stampPaymentSats: satsSchema,
    changeSats: satsSchema,
    otherOutputSats: satsSchema,
    networkFeeSats: satsSchema,
    inputTotalSats: satsSchema,
    outputTotalSats: satsSchema,
  }).strict(),
  locktime: z.number().int().nonnegative(),
  estimatedVirtualBytes: z.number().int().positive(),
  feeRate: z.object({
    numeratorSats: satsSchema,
    denominatorVirtualBytes: z.number().int().positive(),
    displaySatsPerVbyte: z.string().regex(/^\d+\.\d{3}$/),
  }).strict(),
  exactArithmetic: z.string().min(1).max(240),
  walletReturn: z.object({
    leavesForWallet: z.boolean(),
    returnRequired: z.boolean(),
    instruction: z.string().min(1).max(320),
  }).strict(),
}).strict();

export type VaultPsbtReview = z.infer<typeof vaultPsbtReviewSchema>;
