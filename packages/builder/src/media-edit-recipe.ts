/** Serializable, reversible edit instructions. No storage or publication authority. */
export interface KeelMediaEditRecipe {
  readonly schema: "keel-media-edit@1";
  readonly mode: "original" | "lossless" | "lossy";
  readonly format: "original" | "webp" | "avif" | "mp4" | "mov" | "webm";
  readonly quality: number;
  readonly noSound: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly crop?: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  readonly rotate?: 0 | 90 | 180 | 270;
  /** Ordered duplicate-original image layers. Other files are never implicitly read. */
  readonly layers?: readonly {readonly left:number;readonly top:number;readonly width:number;readonly height:number;readonly opacity:number;readonly rotate:0|90|180|270}[];
}
export const ORIGINAL_MEDIA_EDIT_RECIPE: KeelMediaEditRecipe = Object.freeze({ schema: "keel-media-edit@1", mode: "original", format: "original", quality: 82, noSound: false });
export function parseKeelMediaEditRecipe(value: unknown): KeelMediaEditRecipe {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("A media edit recipe is required.");
  const input = value as Record<string, unknown>;
  const allowed = new Set(["schema", "mode", "format", "quality", "noSound", "width", "height", "crop", "rotate", "layers"]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new TypeError("The media recipe contains an unsupported operation.");
  if (input.schema !== "keel-media-edit@1" || !["original", "lossless", "lossy"].includes(String(input.mode)) || !["original", "webp", "avif", "mp4", "mov", "webm"].includes(String(input.format))) throw new TypeError("Unsupported media recipe version, mode or format.");
  if (!Number.isSafeInteger(input.quality) || Number(input.quality) < 1 || Number(input.quality) > 100 || typeof input.noSound !== "boolean") throw new TypeError("Quality must be 1–100 and noSound must be explicit.");
  for (const key of ["width", "height"] as const) if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || Number(input[key]) < 1 || Number(input[key]) > 8192)) throw new RangeError("Output dimensions must be 1–8192 pixels.");
  if (input.rotate !== undefined && ![0,90,180,270].includes(input.rotate as number)) throw new TypeError("Rotation must be 0, 90, 180 or 270 degrees.");
  if (input.crop !== undefined) {
    if (input.crop === null || typeof input.crop !== "object" || Array.isArray(input.crop)) throw new TypeError("Invalid crop.");
    const crop = input.crop as Record<string, unknown>;
    if (Object.keys(crop).length !== 4 || Object.keys(crop).some(key => !["left","top","width","height"].includes(key))) throw new TypeError("Crop requires left, top, width and height.");
    for (const key of ["left", "top", "width", "height"]) if (!Number.isSafeInteger(crop[key]) || Number(crop[key]) < (key === "left" || key === "top" ? 0 : 1) || Number(crop[key]) > 8192) throw new RangeError("Invalid crop bounds.");
  }
  if (input.layers !== undefined) {
    if (!Array.isArray(input.layers) || input.layers.length > 8) throw new RangeError("At most eight duplicate-original layers are supported.");
    for (const layer of input.layers) {
      if (!layer || typeof layer !== "object" || Object.keys(layer).length !== 6 || Object.keys(layer).some(key=>!["left","top","width","height","opacity","rotate"].includes(key))) throw new TypeError("A layer needs left, top, width, height, opacity and rotate.");
      for(const key of ["left","top","width","height"]) if(!Number.isSafeInteger(layer[key]) || layer[key]<(key === "left"||key === "top"?0:1)||layer[key]>8192) throw new RangeError("Invalid layer bounds.");
      if(typeof layer.opacity!=="number" || !Number.isFinite(layer.opacity)||layer.opacity<0||layer.opacity>1 || ![0,90,180,270].includes(layer.rotate)) throw new TypeError("Layer opacity must be 0–1 and rotation a quarter turn.");
    }
  }
  if (input.mode === "original" && (input.format !== "original" || input.noSound || (Array.isArray(input.layers) && input.layers.length > 0) || input.crop !== undefined || input.width !== undefined || input.height !== undefined || Number(input.rotate ?? 0) !== 0)) throw new TypeError("Original mode preserves exact bytes; choose an explicit edit mode before changing media.");
  if (input.mode !== "original" && input.format === "original") throw new TypeError("Choose an output format for edited media.");
  return JSON.parse(JSON.stringify(input)) as KeelMediaEditRecipe;
}
export const parseMediaEditRecipe = parseKeelMediaEditRecipe;
