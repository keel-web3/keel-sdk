import { KEEL_SMART_INLINE_ASSET_MAX_BYTES, planKeelSmartAssetPresentation, resolveKeelTokenURIReadBounds, assertKeelNonstandardTokenURIIdentity, sha256Hex, hashKeelSmartAssetPresentationPlan, measureKeelSmartAssetPresentation, type KeelExplicitNonstandardReadPolicy, type KeelSmartAssetPresentationPlan } from "@keel/protocol";
/** Browser-safe intent planning. This is not a storage receipt or payment approval. */
export type KeelMediaSlotDelivery = "onchain" | "ipfs" | "hosted";
/** @deprecated Use the smart asset boundaries, which distinguish direct from split-read delivery. */
export const KEEL_STANDALONE_VIEWER_MAX_BYTES = KEEL_SMART_INLINE_ASSET_MAX_BYTES;
export const KEEL_INLINE_IMAGE_DEFAULT_MAX_BYTES = KEEL_SMART_INLINE_ASSET_MAX_BYTES;
/** Unknown sizes keep verification enabled until actual source bytes are known. */
export function defaultKeelImageViewer(mediaType: string, byteLength?: number): "none" | "keel-verification-shell" {
  if (byteLength !== undefined && (!Number.isSafeInteger(byteLength) || byteLength < 0)) throw new TypeError("Media byte length must be a nonnegative integer.");
  const mime=mediaType.split(";",1)[0]!.trim().toLowerCase();
  return planKeelSmartAssetPresentation({source:{resourceId:"source",mediaType:mime,...(byteLength===undefined?{}:{byteLength})},
    execution:mime === "image/svg+xml" ? "unknown" : /^(?:text\/(?:html|javascript|ecmascript)|application\/(?:javascript|ecmascript|wasm|xhtml\+xml))$/u.test(mime) ? "script" : "static"}).viewer;
}
export function defaultKeelImageDelivery(byteLength?: number): KeelMediaSlotDelivery {
  if (byteLength !== undefined && (!Number.isSafeInteger(byteLength) || byteLength < 0)) throw new TypeError("Image byte length must be a nonnegative integer.");
  return "onchain"; // Hosted previews require the explicit external-preview choice, never a size heuristic.
}
export interface KeelMediaSlotSelection {
  readonly resourceId: string;
  readonly presentation: "direct" | "keel-shell";
  readonly delivery: KeelMediaSlotDelivery;
}
export interface KeelMediaSlotChoices {
  readonly image?: KeelMediaSlotSelection | null;
  readonly animation_url?: KeelMediaSlotSelection | null;
}
export interface KeelMediaSlotDefault {
  readonly mediaType?: string;
  readonly collectionType?: string;
  readonly imageDelivery?: KeelMediaSlotDelivery;
  readonly animationDelivery?: KeelMediaSlotDelivery;
}
export interface KeelMediaSlotPlan extends KeelMediaSlotChoices {
  readonly schema: "keel-media-slot-plan@1";
  readonly viewer: "none" | "keel-verification-shell";
  readonly fullReadRequired: true;
  readonly duplicateSourceInBothSlots: boolean;
  readonly planKey: string;
}
function delivery(value: unknown): KeelMediaSlotDelivery {
  if (value !== "onchain" && value !== "ipfs" && value !== "hosted") throw new TypeError("Choose onchain, IPFS or hosted slot delivery.");
  return value;
}
function resource(value: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 1024 || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError("A bounded media resource ID is required.");
  return value;
}
function selection(value: KeelMediaSlotSelection | null): KeelMediaSlotSelection | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Object.keys(value).some(key => !["resourceId","presentation","delivery"].includes(key)) || !["direct","keel-shell"].includes(value.presentation)) throw new TypeError("Invalid metadata slot choice.");
  return {resourceId:resource(value.resourceId),presentation:value.presentation,delivery:delivery(value.delivery)};
}
/** Static media above the decimal 500KB boundary through 2MB use direct display; smaller or unknown
 * images use the verifier. A thumbnail is always a distinct resource.
 * Only an explicitly selected candidate switches the source to that candidate. */
export function planKeelMediaSlots(input: {
  readonly sourceResourceId: string;
  readonly mediaType: string;
  readonly sourceByteLength?: number;
  readonly collectionType?: string;
  readonly selectedCandidateResourceId?: string;
  readonly thumbnailResourceId?: string;
  readonly thumbnailByteLength?: number;
  readonly defaults?: readonly KeelMediaSlotDefault[];
  readonly explicit?: KeelMediaSlotChoices;
}): KeelMediaSlotPlan {
  const source=resource(input.sourceResourceId), mime=input.mediaType.split(";",1)[0]!.trim().toLowerCase();
  const defaultViewer = defaultKeelImageViewer(mime, input.sourceByteLength);
  if (input.thumbnailByteLength !== undefined && (!Number.isSafeInteger(input.thumbnailByteLength) || input.thumbnailByteLength < 0)) throw new TypeError("Thumbnail byte length must be a nonnegative integer.");
  const imageBytes = input.thumbnailResourceId === undefined ? input.sourceByteLength : input.thumbnailByteLength;
  let imageDelivery:KeelMediaSlotDelivery=defaultKeelImageDelivery(imageBytes), animationDelivery:KeelMediaSlotDelivery="onchain";
  // Global < collection < exact asset type < exact asset+collection. Explicit choices win below.
  const applicable=(input.defaults ?? []).filter(value=>(value.mediaType === undefined || value.mediaType === mime) && (value.collectionType === undefined || value.collectionType === input.collectionType));
  applicable.sort((a,b)=>(Number(a.mediaType!==undefined)*2+Number(a.collectionType!==undefined))-(Number(b.mediaType!==undefined)*2+Number(b.collectionType!==undefined)));
  for(const value of applicable) {if(value.imageDelivery!==undefined)imageDelivery=delivery(value.imageDelivery);if(value.animationDelivery!==undefined)animationDelivery=delivery(value.animationDelivery);}
  const encoded=input.selectedCandidateResourceId===undefined ? undefined : resource(input.selectedCandidateResourceId);
  const directImage=defaultViewer === "none" && mime.startsWith("image/") && encoded===undefined;
  const thumbnail=input.thumbnailResourceId===undefined ? undefined : resource(input.thumbnailResourceId);
  if(thumbnail!==undefined && (thumbnail===source || thumbnail===encoded)) throw new TypeError("A thumbnail must be a separately selected resource; full media is not copied into both slots automatically.");
  let image:KeelMediaSlotSelection|null=directImage ? {resourceId:source,presentation:"direct",delivery:imageDelivery} : thumbnail ? {resourceId:thumbnail,presentation:"direct",delivery:imageDelivery} : null;
  let animation_url:KeelMediaSlotSelection|null=directImage ? null : {resourceId:encoded ?? source,presentation:"keel-shell",delivery:animationDelivery};
  if(input.explicit?.image!==undefined)image=selection(input.explicit.image);
  if(input.explicit?.animation_url!==undefined)animation_url=selection(input.explicit.animation_url);
  if(image===null && animation_url===null) throw new TypeError("At least one metadata slot must present the media.");
  if(image?.presentation==="keel-shell") throw new TypeError("The image slot needs direct image media; HTML shells belong in animation_url.");
  const viewer=animation_url?.presentation === "keel-shell" ? "keel-verification-shell" : "none";
  const duplicateSourceInBothSlots=Boolean(image && animation_url && image.resourceId===animation_url.resourceId);
  const planKey=JSON.stringify({image,animation_url,viewer});
  return {schema:"keel-media-slot-plan@1",image,animation_url,viewer,fullReadRequired:true,duplicateSourceInBothSlots,planKey};
}
/** Gate complete metadata, never media-payload savings alone. Evidence must be
 * attached to this exact plan after the selected chain's actual read check. */
export function assertKeelMediaSlotReadFit(plan:KeelMediaSlotPlan, evidence:{readonly planKey:string;readonly completeTokenUriBytes:number;readonly maxTokenUriBytes:number;readonly selectedChainReadPassed:boolean}):void {
  if(evidence.planKey!==plan.planKey || !Number.isSafeInteger(evidence.completeTokenUriBytes) || evidence.completeTokenUriBytes<1 || !Number.isSafeInteger(evidence.maxTokenUriBytes) || evidence.maxTokenUriBytes<1 || evidence.completeTokenUriBytes>Math.min(evidence.maxTokenUriBytes,2_000_000) || evidence.selectedChainReadPassed!==true) throw new Error("The exact complete metadata slots need a successful selected-chain read within the standard 2 MB tokenURI limit before funding. Larger embedded media requires a separately supported nonstandard route and explicit marketplace compatibility review.");
}

/** Explicit larger-return companion to the unchanged synchronous standard gate.
 * Matrix plan, actual full return and exact policy remain separate from this
 * legacy slot key. No provider capability or simulation proof is invented. */
export async function assertKeelNonstandardMediaSlotReadFit(plan: KeelMediaSlotPlan, evidence: {
  readonly planKey: string;
  readonly publicationPlan: KeelSmartAssetPresentationPlan;
  readonly tokenURI: string;
  readonly selectedChainReadPassed: boolean;
  readonly nonstandardReadPolicy: KeelExplicitNonstandardReadPolicy;
}): Promise<void> {
  const slots = structuredClone(plan), snapshot = structuredClone(evidence);
  if (snapshot.planKey !== slots.planKey || snapshot.selectedChainReadPassed !== true
    || typeof snapshot.tokenURI !== "string") throw new TypeError("The exact complete metadata slots require their selected-chain read and publication review identity.");
  const policy = resolveKeelTokenURIReadBounds(snapshot.nonstandardReadPolicy).nonstandardReadPolicy;
  if (!policy) throw new TypeError("An exact nonstandard read policy is required.");
  const publication = snapshot.publicationPlan;
  const expected = (slot: "image" | "animation") => {
    const selected = publication[slot];
    if (!selected || selected.delivery === "omitted") return null;
    const shell = selected.delivery.endsWith("shell");
    const delivery: KeelMediaSlotDelivery = selected.delivery === "ipfs-shell" || selected.delivery === "external" && selected.uri?.startsWith("ipfs:") ? "ipfs"
      : selected.delivery === "hosted-shell" || selected.delivery === "external" ? "hosted" : "onchain";
    return { resourceId: selected.resourceId, presentation: shell ? "keel-shell" : "direct", delivery };
  };
  for (const [legacy, smart] of [[slots.image, expected("image")], [slots.animation_url, expected("animation")]] as const) {
    if ((legacy ?? null) === null ? smart !== null : !smart || legacy!.resourceId !== smart.resourceId || legacy!.presentation !== smart.presentation || legacy!.delivery !== smart.delivery) throw new TypeError("The legacy slots contradict the selected publication matrix.");
  }
  const context = publication.contextIdentity;
  if (!context || publication.source.digest !== policy.identity.sourceDigest || publication.capabilities?.identity?.chainId !== policy.identity.chainId
    || ["projectId", "revision", "defaultsRevision"].some(key => context[key as keyof typeof context] !== policy.identity[key as keyof typeof context])) throw new TypeError("The nonstandard slot review has a stale source, chain or revision.");
  if (await hashKeelSmartAssetPresentationPlan(publication) !== policy.identity.planDigest.replace(/^sha256:/u, "0x")) throw new TypeError("The nonstandard read policy belongs to a different selected publication plan.");
  const measured = await measureKeelSmartAssetPresentation(publication, () => snapshot.tokenURI);
  if (measured.hardBlockers.length || await sha256Hex(new TextEncoder().encode(measured.measurementKey)) !== policy.identity.measurementDigest.replace(/^sha256:/u, "0x")) throw new TypeError("The nonstandard slot review has a stale or invalid complete measurement.");
  assertKeelNonstandardTokenURIIdentity(policy, { chainId: policy.identity.chainId, byteLength: measured.completeTokenUriBytes, digest: measured.tokenUriDigest });
}

export { planKeelInitialMediaBudget, KEEL_STANDARD_INITIAL_METADATA_BYTES, type KeelInitialMetadataSlots, type KeelInitialMediaBudgetInput } from "./initial-media-budget.js";
