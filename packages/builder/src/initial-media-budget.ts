/** Initial metadata allocation is intent planning, never a publication proof. */
export const KEEL_STANDARD_INITIAL_METADATA_BYTES = 2_000_000;
export interface KeelInitialMetadataSlots {
  readonly image: string | null;
  readonly animation: string | null;
}
export interface KeelInitialMediaBudgetInput extends KeelInitialMetadataSlots {
  readonly animationKind: "script" | "embedded-media" | "external";
  readonly animationSelection?: "auto" | "inline" | "hybrid";
  /** An existing registered script reconstruction shell; never invent a binary fallback. */
  readonly hybridAnimation?: string;
  /** Must render the complete actual metadata URI, including its encoding layers. */
  readonly renderTokenURI: (slots: KeelInitialMetadataSlots) => string | Promise<string>;
}
export async function planKeelInitialMediaBudget(input: KeelInitialMediaBudgetInput) {
  const { image, animation, animationKind, hybridAnimation, renderTokenURI } = input;
  const selection = input.animationSelection ?? "auto";
  if (!["auto", "inline", "hybrid"].includes(selection) || !["script", "embedded-media", "external"].includes(animationKind)
    || image !== null && typeof image !== "string" || animation !== null && typeof animation !== "string"
    || hybridAnimation !== undefined && typeof hybridAnimation !== "string" || typeof renderTokenURI !== "function") throw new TypeError("Exact metadata slots and a complete URI renderer are required.");
  const measure = async (slots: KeelInitialMetadataSlots) => {
    const tokenURI = await renderTokenURI(Object.freeze(slots));
    if (typeof tokenURI !== "string" || !/^data:application\/json(?:[;,])/iu.test(tokenURI)) throw new TypeError("The initial budget needs the complete JSON metadata data URI, not a payload estimate or external address.");
    return { tokenURI, completeTokenUriBytes: new TextEncoder().encode(tokenURI).byteLength };
  };
  // Allocate the selected image first. Never drop or externalize it implicitly.
  const imageOnly = await measure({ image, animation: null });
  const inline = animation === null ? imageOnly : await measure({ image, animation });
  const base = { schema: "keel-initial-media-budget@1" as const, maximumStandardBytes: KEEL_STANDARD_INITIAL_METADATA_BYTES,
    imageOnlyTokenUriBytes: imageOnly.completeTokenUriBytes, remainingInitialResponseBytes: Math.max(0, KEEL_STANDARD_INITIAL_METADATA_BYTES - imageOnly.completeTokenUriBytes),
    publicationReady: false as const, requiresSelectedChainRead: true as const };
  const result = (chosen: typeof inline, chosenAnimation: string | null, decision: "inline" | "hybrid" | "image-over-budget" | "nonstandard-review-required") => ({ ...base, ...chosen,
    image, animation: chosenAnimation, decision, standardCompatible: chosen.completeTokenUriBytes <= KEEL_STANDARD_INITIAL_METADATA_BYTES,
    marketplaceWarning: chosen.completeTokenUriBytes <= KEEL_STANDARD_INITIAL_METADATA_BYTES ? undefined
      : "This complete tokenURI exceeds the standard 2 MB budget. Marketplaces and wallets may fail to display it. A separately supported nonstandard route, explicit compatibility acknowledgement and an exact selected-chain read are required before funding." });
  if (imageOnly.completeTokenUriBytes > KEEL_STANDARD_INITIAL_METADATA_BYTES) return result(inline, animation, "image-over-budget");
  if (selection !== "hybrid" && inline.completeTokenUriBytes <= KEEL_STANDARD_INITIAL_METADATA_BYTES) return result(inline, animation, "inline");
  // Explicit Inline is retained even when it needs nonstandard review. Binary
  // image/video/GIF slots cannot acquire a script hybrid route from a size hint.
  if (selection !== "inline" && animationKind === "script" && hybridAnimation !== undefined) {
    const hybrid = await measure({ image, animation: hybridAnimation });
    return result(hybrid, hybridAnimation, hybrid.completeTokenUriBytes <= KEEL_STANDARD_INITIAL_METADATA_BYTES ? "hybrid" : "nonstandard-review-required");
  }
  if (selection === "hybrid") throw new TypeError("This animation needs its supported registered script hybrid shell; embedded binary media cannot silently use that route.");
  return result(inline, animation, "nonstandard-review-required");
}
