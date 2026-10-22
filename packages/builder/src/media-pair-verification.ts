import type { Integrity } from "@keel/protocol";
import type { KeelMediaEditRecipe } from "./media-edit-recipe.js";
import type { KeelMediaInfo } from "./media-preparation.js";

export type ActualMediaLoop = { readonly kind: "still" } | { readonly kind: "container"; readonly repetitions: number }
  | { readonly kind: "canonical-player-defined" };
export interface ActualMediaAudio {
  readonly codec: "pcm_f64le"; readonly sampleRate: number; readonly channelLayout: string;
  readonly timeBase: string; readonly frameTimes: readonly number[]; readonly frameSamples: readonly number[];
  readonly frameBytes: readonly number[]; readonly frameHashes: readonly string[];
  readonly totalBytes: number; readonly totalSamples: number; readonly sequenceDigest: string;
}
export interface ActualMediaPairStream {
  readonly info: KeelMediaInfo; readonly frameHashes: readonly string[]; readonly loop: ActualMediaLoop;
  readonly startTimeMs: number; readonly audio?: ActualMediaAudio;
}
/** The verifier brands and freezes this result in memory. JSON with identical
 * fields has no verification authority. No bytes are regenerated or adopted. */
export interface ActualMediaPairProof {
  readonly schema: "keel-actual-media-pair@1";
  readonly sourceIntegrity: Integrity; readonly candidateIntegrity: Integrity;
  readonly recipe: KeelMediaEditRecipe; readonly recipeDigest: string;
  readonly eligibility: "equivalent-lossless" | "requires-canonical-player-proof" | "explicit-edit-only";
  readonly source?: ActualMediaPairStream; readonly candidate?: ActualMediaPairStream;
  readonly reason: string; readonly publicationReady: false; readonly adoptionAuthorized: false;
}
