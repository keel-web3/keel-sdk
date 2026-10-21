import { classifyKeelAssetMotion } from "@keel/protocol";
import { KEEL_ASSET_DISPLAY_MODULE_ID, KEEL_ASSET_DISPLAY_MODULE_VERSION, keelAssetDisplayModuleRevision } from "./asset-display.js";

/** Byte-profile compatibility only. Registration and read-back remain separate. */
export const KEEL_NATIVE_RASTER_VIEWER_ADAPTER = Object.freeze({
  schema: "keel-media-viewer-adapter@1" as const,
  id: "native-raster" as const,
  moduleId: KEEL_ASSET_DISPLAY_MODULE_ID,
  version: KEEL_ASSET_DISPLAY_MODULE_VERSION,
  mediaTypes: Object.freeze(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"] as const),
  playback: "native-image-for-motion-or-inconclusive-container" as const,
  stillExport: "png-canvas-only-after-complete-container-inspection" as const,
  dependencies: Object.freeze([] as const),
});

/** Do not reuse an older draw-once implementation for animated or unknown media. */
export function qualifyKeelNativeRasterViewer(input: {
  readonly moduleId: string;
  readonly version: string;
  readonly digest: string;
  readonly byteLength: number;
  readonly mediaType: string;
  /** Exact retained source bytes, never a caller-declared still/animation label. */
  readonly source: Uint8Array;
}): Readonly<Omit<typeof KEEL_NATIVE_RASTER_VIEWER_ADAPTER, "version"> & { readonly version: string }> {
  const revision = keelAssetDisplayModuleRevision(input.version);
  if (revision === undefined || input.moduleId !== KEEL_NATIVE_RASTER_VIEWER_ADAPTER.moduleId
    || input.digest.toLowerCase() !== revision.digest
    || input.byteLength !== revision.byteLength) {
    throw new TypeError("Native raster playback requires the exact animation-capable KEEL asset-display byte profile; selected-chain registration must be verified separately.");
  }
  if (!(KEEL_NATIVE_RASTER_VIEWER_ADAPTER.mediaTypes as readonly string[]).includes(input.mediaType)) {
    throw new TypeError(`The native raster adapter does not support ${input.mediaType}. Artwork category does not establish media capability.`);
  }
  const motion = classifyKeelAssetMotion({ mediaType: input.mediaType, bytes: input.source });
  if ((input.mediaType === "image/webp" || input.mediaType === "image/avif")
    && input.version !== KEEL_NATIVE_RASTER_VIEWER_ADAPTER.version && motion !== "still") {
    throw new TypeError("Animated or unclassified WebP/AVIF requires the exact animation-capable KEEL asset-display revision; a draw-once module would change the work.");
  }
  return Object.freeze({ ...KEEL_NATIVE_RASTER_VIEWER_ADAPTER, version: input.version });
}
