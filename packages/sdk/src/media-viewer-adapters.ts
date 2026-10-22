import { inspectKeelNativeMedia } from "./native-media-inspection.js";
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
    && !["1.3.0", "1.4.0", "1.5.0"].includes(input.version) && motion !== "still") {
    throw new TypeError("Animated or unclassified WebP/AVIF requires the exact animation-capable KEEL asset-display revision; a draw-once module would change the work.");
  }
  return Object.freeze({ ...KEEL_NATIVE_RASTER_VIEWER_ADAPTER, version: input.version });
}


/** Native SVG/audio use the exact new renderer; a container result alone never
 * establishes browser decode or selected-chain registration. */
export function qualifyKeelNativeMediaViewer(input: Parameters<typeof qualifyKeelNativeRasterViewer>[0]) {
  const revision = keelAssetDisplayModuleRevision(input.version);
  if (input.version !== "1.5.0" || !revision || input.moduleId !== KEEL_ASSET_DISPLAY_MODULE_ID || input.digest.toLowerCase() !== revision.digest || input.byteLength !== revision.byteLength) {
    throw new TypeError("Native SVG/audio require the exact current asset-display 1.5 byte profile; registration/read-back and browser decode remain mandatory.");
  }
  const inspection = inspectKeelNativeMedia({mediaType: input.mediaType, source: input.source});
  return Object.freeze({schema: "keel-media-viewer-adapter@1" as const, id: inspection.kind === "svg" ? "native-svg" as const : "native-audio" as const,
    moduleId: input.moduleId, version: input.version, inspection, playback: inspection.kind === "svg" ? "native-svg-image" as const : "gesture-start-native-audio-controls" as const,
    dependencies: Object.freeze([]), registration: "required" as const, browserDecode: "required" as const});
}
