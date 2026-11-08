/** Studio's string-valued form state; cap maps to KOC1 end.max. */
export interface Koc1StudioDraft {
  mode: 'first' | 'time' | 'supply' | 'open';
  open: string; close: string; cap: string; price: string;
  challengeWindow: string; collectAfter: string; refundAfter: string; notice: string;
  earlyRefund: boolean; pausable: boolean; blind: boolean; cycle: boolean;
  treasuryKey: string; writerKeys: [string, string, string]; writers: [string, string, string];
  metadataRoot: string; metadataCount: string; artName?: string;
}
export interface Koc1DraftPrepareRequest {
  mode: 'draft'; draft: Koc1StudioDraft;
  /** Satoshis per virtual byte; omitted means 2 sat/vB. */
  feeRate?: number;
}
export type Koc1DraftErrorField = keyof Koc1StudioDraft | 'writer0' | 'writer1' | 'writer2' | 'key0' | 'key1' | 'key2' | 'feeRate' | 'form';
export type Koc1DraftErrors = Partial<Record<Koc1DraftErrorField, string>>;
export interface Koc1VsizeEstimate { strippedBytes: number; totalBytes: number; weight: number; vsize: number }
export interface Koc1DraftLeafSize extends Koc1VsizeEstimate {
  scriptBytes: number; scriptVbytes: number; controlBytes: number; witnessBytes: number;
}
export interface Koc1DraftEscrow {
  /** Public NUMS point used only to illustrate the not-yet-known buyer key. */
  assumedBuyerKey: string;
  scripts: Record<string, string>; leaves: Record<string, string>;
  root: string; outputKey: string; scriptPubKey: string; address: string;
  controlBlocks: Record<string, string>; sizes: Record<string, Koc1DraftLeafSize>;
}
export interface Koc1DraftCostEstimate {
  estimated: true; feeRateSatPerVbyte: number;
  commit: Koc1VsizeEstimate; reveal: Koc1VsizeEstimate;
  commitFeeSats: number; revealFeeSats: number; totalFeeSats: number;
  postageSats: number; totalSats: number;
}
export interface Koc1DraftMintEstimate extends Koc1DraftCostEstimate {
  priceSats: number; escrowOutputSats: number; escrowDustTopUpSats: number;
  escrowOutputVbytes: number;
  /** Already included in revealFeeSats; never add it a second time. */
  escrowOutputFeeSats: number;
  /** Reveal fee + postage + escrow payment; commit fee is excluded here. */
  revealSpendSats: number;
}
export interface Koc1DraftPrepareResponse {
  mode: 'draft'; valid: boolean; errors: Koc1DraftErrors;
  specValid: false; publicationReady: false; signed: false; broadcast: false; chainReads: false;
  recipeEncoding: 'cbor'; recipeCompleteness: 'unbound-draft';
  /** Exact bytes of this unbound draft; not a publishable recipe with resolved references. */
  recipeBytes: string | null; recipeByteLength: number | null;
  escrow: Koc1DraftEscrow | null;
  inscriptionCost: Koc1DraftCostEstimate | null; mintCost: Koc1DraftMintEstimate | null;
  feeRateSatPerVbyte: number; feeRateDefaulted: boolean;
  deferredChecks: string[]; assumptions: string[];
}
