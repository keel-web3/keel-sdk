/** Browser-safe intent planning. This is not a storage receipt or payment approval. */
export type KeelMediaSlotDelivery = "onchain" | "ipfs" | "hosted";
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
/** Original JPEG/PNG/GIF/etc. occupies image only. WebP/AVIF and other media
 * use animation_url + KEEL shell. A thumbnail is always a distinct resource.
 * Only an explicitly selected candidate switches the source to that candidate. */
export function planKeelMediaSlots(input: {
  readonly sourceResourceId: string;
  readonly mediaType: string;
  readonly collectionType?: string;
  readonly selectedCandidateResourceId?: string;
  readonly thumbnailResourceId?: string;
  readonly defaults?: readonly KeelMediaSlotDefault[];
  readonly explicit?: KeelMediaSlotChoices;
}): KeelMediaSlotPlan {
  const source=resource(input.sourceResourceId), mime=input.mediaType.split(";",1)[0]!.trim().toLowerCase();
  let imageDelivery:KeelMediaSlotDelivery="onchain", animationDelivery:KeelMediaSlotDelivery="onchain";
  // Global < collection < exact asset type < exact asset+collection. Explicit choices win below.
  const applicable=(input.defaults ?? []).filter(value=>(value.mediaType === undefined || value.mediaType === mime) && (value.collectionType === undefined || value.collectionType === input.collectionType));
  applicable.sort((a,b)=>(Number(a.mediaType!==undefined)*2+Number(a.collectionType!==undefined))-(Number(b.mediaType!==undefined)*2+Number(b.collectionType!==undefined)));
  for(const value of applicable) {if(value.imageDelivery!==undefined)imageDelivery=delivery(value.imageDelivery);if(value.animationDelivery!==undefined)animationDelivery=delivery(value.animationDelivery);}
  const encoded=input.selectedCandidateResourceId===undefined ? undefined : resource(input.selectedCandidateResourceId);
  const directImage=mime.startsWith("image/") && mime!=="image/webp" && mime!=="image/avif" && encoded===undefined;
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
  if(evidence.planKey!==plan.planKey || !Number.isSafeInteger(evidence.completeTokenUriBytes) || evidence.completeTokenUriBytes<1 || !Number.isSafeInteger(evidence.maxTokenUriBytes) || evidence.maxTokenUriBytes<1 || evidence.completeTokenUriBytes>evidence.maxTokenUriBytes || evidence.selectedChainReadPassed!==true) throw new Error("The exact complete metadata slots need a successful selected-chain read within the tokenURI limit before funding.");
}
