import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { canonicalJson, createIntegrity, type Integrity } from "@keel/protocol";
import type { ActualMediaAudio, ActualMediaLoop, ActualMediaPairProof, ActualMediaPairStream } from "./media-pair-verification.js";
export type { ActualMediaPairProof } from "./media-pair-verification.js";
import { resolveBundledFfmpeg } from "./media-optimization.js";
import { parseKeelMediaEditRecipe, type KeelMediaEditRecipe } from "./media-edit-recipe.js";
import { assignTemporalWebPDelays } from "./temporal-webp.js";
import { actualAvifContainer, assertActualImageSequence, assertNativeImageSequence, assertActualCandidateContainer } from "./actual-media-container.js";
import { assertMoviePresentationSemantics, type MovieAudioTimeline } from "./movie-presentation-semantics.js";
export * from "./media-edit-recipe.js";

const MAX_BYTES = 256 * 1024 * 1024;
const MAX_PIXELS = 64 * 1024 * 1024;
const MAX_FRAMES = 1800;
const MAX_MOVIE_PIXELS = 2_000_000_000;
const exec = promisify(execFile);
const formats = { webp: ["image/webp", ".webp"], avif: ["image/avif", ".avif"], mp4: ["video/mp4", ".mp4"], mov: ["video/quicktime", ".mov"], webm: ["video/webm", ".webm"] } as const;
export interface KeelMediaInfo {
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  readonly frameCount: number;
  readonly animated: boolean;
  readonly hasAudio: boolean;
  readonly frameTimesMs: readonly number[];
  readonly frameDurationsMs: readonly number[];
}
export interface KeelMediaCandidate {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly extension: string;
  readonly recipe: KeelMediaEditRecipe;
  readonly sourceIntegrity: Integrity;
  readonly outputIntegrity: Integrity;
  readonly sourceInfo: KeelMediaInfo | null;
  readonly candidateInfo: KeelMediaInfo | null;
  readonly measurements: { readonly beforeBytes: number; readonly afterBytes: number; readonly savedBytes: number };
  readonly verification: { readonly sourcePreserved: true; readonly completeDecode: boolean; readonly framesAndTimingPreserved: boolean; readonly losslessPixelsVerified: boolean; readonly browserDecode: "requires-runtime-check" };
  readonly warnings: readonly string[];
}
function animatedAvif(bytes:Uint8Array) { return actualAvifContainer(bytes)?.sequence === true; }
interface Decoded { info: KeelMediaInfo; hashes: readonly string[]; rgba?:Uint8Array; videoMap?:string; imageMetadata?: ImageMetadata; startTimeMs?: number; extraStreams?: boolean; srgbFull?:boolean; audio?:ActualMediaAudio; audioTimeline?:MovieAudioTimeline; nativePreviewFilter?:string;nativeWarnings?:readonly string[]; }
function hash(bytes: Uint8Array) { const h = createHash("sha256"); h.update(bytes); return h.digest("hex"); }
function bounded(bytes: Uint8Array) { if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) throw new RangeError(`Media must contain 1–${MAX_BYTES} bytes.`); }
function geometry(recipe: KeelMediaEditRecipe) { return recipe.crop !== undefined || recipe.width !== undefined || recipe.height !== undefined || (recipe.rotate ?? 0) !== 0 || (recipe.layers?.length ?? 0) > 0; }
function sameTimeline(a: KeelMediaInfo, b: KeelMediaInfo) {
  return a.frameCount === b.frameCount && a.frameTimesMs.every((n,i) => Math.abs(n - b.frameTimesMs[i]!) < 0.51) && a.frameDurationsMs.every((n,i) => Math.abs(n - b.frameDurationsMs[i]!) < 0.51);
}
interface ImageMetadata { width?:number; height?:number; pages?:number; pageHeight?:number; delay?:number[]; loop?:number; orientation?:number; depth?:string; space?:string; format?:string; icc?:Uint8Array; exif?:Uint8Array; xmp?:Uint8Array; iptc?:Uint8Array; }
interface SharpImage {
  metadata():Promise<ImageMetadata>; ensureAlpha():SharpImage; raw():SharpImage;
  toBuffer():Promise<Uint8Array>; toBuffer(options:{resolveWithObject:true}):Promise<{data:Uint8Array;info:{channels:number}}>;
  keepMetadata():SharpImage; extract(options:unknown):SharpImage; rotate(angle:number):SharpImage;
  composite(options:unknown):SharpImage; resize(options:unknown):SharpImage; webp(options:unknown):SharpImage; avif(options:unknown):SharpImage; png():SharpImage;
  timeout(options:{seconds:number}):SharpImage;
}
type SharpFactory = (bytes:Uint8Array,options?:Record<string,unknown>)=>SharpImage;
async function sharpFactory():Promise<SharpFactory> { return (await import("sharp")).default as unknown as SharpFactory; }
async function decodeImage(bytes: Uint8Array,purpose:"fidelity"|"native-inspection"="fidelity"): Promise<Decoded> {
  const sharp = await sharpFactory();
  const image = sharp(bytes, { animated: true, failOn: "warning", limitInputPixels: MAX_PIXELS });
  const meta = await image.metadata();
  if (meta.format === "svg") throw new Error("Vector documents are retained as originals; this raster media editor does not resolve external SVG resources.");
  const count = meta.pages ?? 1, width = meta.width!, height = meta.pageHeight ?? meta.height!;
  if (!width || !height || count > MAX_FRAMES || width * height * count > MAX_PIXELS) throw new RangeError("Media exceeds the bounded frame decode budget.");
  const raw = await image.ensureAlpha().raw().timeout({seconds:60}).toBuffer({ resolveWithObject: true });
  const size = width * height * raw.info.channels;
  if (raw.data.byteLength !== size * count) throw new Error("The image decoder did not return every complete frame.");
  const delays = count > 1 ? meta.delay : [0];
  if (!delays || delays.length !== count || delays.some(n => !Number.isFinite(n) || n < 0)) throw new Error("The image decoder did not expose complete animation timing.");
  const times: number[] = []; let duration = 0;
  for (const delay of delays) { times.push(duration); duration += delay; }
  const checkSequence=purpose==="native-inspection"?assertNativeImageSequence:assertActualImageSequence;
  checkSequence(bytes,meta,{frameTimesMs:times,frameDurationsMs:delays});
  return { info: { width, height, durationMs: duration, frameCount: count, animated: count > 1, hasAudio: false, frameTimesMs: times, frameDurationsMs: delays }, imageMetadata: meta, rgba:raw.data, hashes: Array.from({length:count}, (_,i) => hash(raw.data.subarray(i*size,(i+1)*size))) };
}
function checkGeometry(recipe: KeelMediaEditRecipe, info: KeelMediaInfo) {
  if (recipe.crop && (recipe.crop.left + recipe.crop.width > info.width || recipe.crop.top + recipe.crop.height > info.height)) throw new RangeError("The crop extends beyond the source image.");
}
async function imageCandidate(bytes: Uint8Array, recipe: KeelMediaEditRecipe): Promise<{bytes:Uint8Array; source:Decoded; candidate:Decoded}> {
  const sharp = await sharpFactory();
  const source = await decodeImage(bytes);
  checkGeometry(recipe, source.info);
  const meta = await sharp(bytes, { animated:true, limitInputPixels:MAX_PIXELS }).metadata();
  if (meta.orientation && meta.orientation !== 1) throw new Error("This image has an orientation transform. Keep original or normalize its orientation explicitly before this encoder.");
  if ((meta.depth && meta.depth !== "uchar") || (meta.space && !["srgb","b-w"].includes(meta.space))) throw new Error("This image has high-depth or non-sRGB color semantics. Keep original; this encoder cannot yet verify those edits.");
  if (source.info.animated && (recipe.format === "avif" || geometry(recipe))) throw new Error("This image adapter cannot verify animated AVIF or animated geometry edits. Keep original or use a capability-verified movie encoder.");
  let image = sharp(bytes, { animated:true, failOn:"warning", limitInputPixels:MAX_PIXELS }).keepMetadata();
  if (recipe.crop) image = image.extract(recipe.crop);
  if (recipe.rotate) image = image.rotate(recipe.rotate);
  if (recipe.width || recipe.height) image = image.resize({ ...(recipe.width ? {width:recipe.width}:{}), ...(recipe.height ? {height:recipe.height}:{}), fit:"fill" });
  // Materialize geometry before compositing: layer coordinates refer to the output canvas.
  // Layers are ordered copies of the unchanged source, with explicit alpha and quarter-turns.
  if (recipe.layers?.length) {
    const base = await image.png().timeout({seconds:60}).toBuffer();
    const canvas = await sharp(base).metadata();
    const overlays: {input:Uint8Array;left:number;top:number}[] = [];
    for (const layer of recipe.layers) {
      const rotated = layer.rotate === 90 || layer.rotate === 270;
      const width = rotated ? layer.height : layer.width, height = rotated ? layer.width : layer.height;
      if (layer.left + width > canvas.width! || layer.top + height > canvas.height!) throw new RangeError("A layer extends beyond the edited output canvas; clipping is never implicit.");
      const pixels = await sharp(bytes,{limitInputPixels:MAX_PIXELS}).resize({width:layer.width,height:layer.height,fit:"fill"}).rotate(layer.rotate).ensureAlpha().raw().timeout({seconds:60}).toBuffer();
      const rgba = new Uint8Array(pixels);
      for (let offset=3; offset<rgba.length; offset+=4) rgba[offset] = Math.round(rgba[offset]! * layer.opacity);
      const input = await sharp(rgba,{raw:{width,height,channels:4}}).png().toBuffer();
      overlays.push({input,left:layer.left,top:layer.top});
    }
    image = sharp(base,{limitInputPixels:MAX_PIXELS}).keepMetadata().composite(overlays);
  }
  let editedReference: Decoded | undefined;
  if (geometry(recipe)) {
    const edited = await image.png().timeout({seconds:60}).toBuffer();
    editedReference = await decodeImage(edited);
    image = sharp(edited,{limitInputPixels:MAX_PIXELS}).keepMetadata();
  }
  if (recipe.format === "webp") image = image.webp({lossless:recipe.mode === "lossless", quality:recipe.quality, effort:6, ...(source.info.animated ? {delay:[...source.info.frameDurationsMs],loop:meta.loop ?? 0}: {})});
  else if (recipe.format === "avif") image = image.avif({lossless:recipe.mode === "lossless", quality:recipe.quality, effort:6, chromaSubsampling:"4:4:4"});
  else throw new Error("This format needs the verified movie encoder.");
  const output = new Uint8Array(await image.timeout({seconds:60}).toBuffer()); bounded(output);
  const candidate = await decodeImage(output);
  const outputMeta = await sharp(output,{animated:true,limitInputPixels:MAX_PIXELS}).metadata();
  if (meta.icc && (!outputMeta.icc || hash(meta.icc) !== hash(outputMeta.icc))) throw new Error("The candidate did not retain the source color profile; original retained.");
  if (source.info.animated && (meta.loop ?? 0) !== (outputMeta.loop ?? 0)) throw new Error("The candidate changed animation looping; original retained.");
  if (!sameTimeline(source.info,candidate.info)) throw new Error("The candidate changed frame count or timing; the original remains unchanged.");
  if (recipe.mode === "lossless" && editedReference && editedReference.hashes.some((value,index)=>candidate.hashes[index] !== value)) throw new Error("The candidate did not losslessly encode the edited composition; original retained.");
  if (recipe.mode === "lossless" && !geometry(recipe) && source.hashes.some((v,i) => candidate.hashes[i] !== v)) throw new Error("The candidate is not pixel-lossless after full decoding; the original remains unchanged.");
  return {bytes:output, source, candidate};
}
async function ffmpegRun(binary: string, cwd: string, args: string[], signal?:AbortSignal) {
  return exec(binary, ["-hide_banner","-nostdin","-max_alloc",String(MAX_BYTES),...args], {cwd, timeout:120_000, maxBuffer:16*1024*1024, ...(signal ? {signal}: {})}) as Promise<{stdout:string;stderr:string}>;
}
async function decodeMovie(binary: string, cwd: string, input: string, signal?:AbortSignal, exactOrigin = false,purpose:"fidelity"|"native-inspection"="fidelity"): Promise<Decoded> {
  signal?.throwIfAborted();
  const containerBytes = new Uint8Array(await readFile(path.join(cwd,input)));
  const avifSequence = animatedAvif(containerBytes);
  // The pinned platform builds expose AVIF sequences either as the sole video
  // stream or after a primary-image stream. Probe the actual container first.
  const origin = exactOrigin ? ["-copyts"] : [];
  const probe = await ffmpegRun(binary,cwd,["-protocol_whitelist","file,pipe","-threads","2",...origin,"-i",input,"-t","0","-map","0:v:0","-an","-f","null","-"],signal);
  const videoStreams=probe.stderr.split("Output #")[0]!.split("\n").filter(line=>/^\s*Stream #.*Video:/u.test(line));
  if (!videoStreams.length || videoStreams.length > (avifSequence ? 2 : 1)) throw new Error("Multiple video streams need an explicit stream-selection recipe; none are silently discarded.");
  const videoIndex = avifSequence && videoStreams.length === 2 ? 1 : 0;
  const videoMap = `0:v:${videoIndex}`;
  const selectedStream = videoStreams[videoIndex]!;
  const dims = /Video:[^\n]*?\b(\d{1,5})x(\d{1,5})\b/u.exec(selectedStream);
  if (!dims || Number(dims[1])*Number(dims[2]) > MAX_PIXELS || Math.max(Number(dims[1]),Number(dims[2])) > 8192) throw new Error("Movie dimensions are unavailable or exceed the decode budget.");
  const presentation = assertMoviePresentationSemantics(containerBytes,probe.stderr.split("Output #")[0]!,selectedStream,Number(dims[1]),Number(dims[2]),purpose);
  const nativeDisplay=presentation.nativeDisplay;
  // Native SAR previews may expand beyond the coded raster. Bind the same
  // existing frame/pixel budgets to the complete parsed sample count before
  // launching a scaled decode, rather than rejecting after processing it.
  if(nativeDisplay&&(presentation.videoTimeline.samples>BigInt(MAX_FRAMES)
    ||presentation.videoTimeline.samples*BigInt(nativeDisplay.width)*BigInt(nativeDisplay.height)>BigInt(MAX_MOVIE_PIXELS)))
    throw new RangeError("Movie exceeds the bounded native display frame decode budget.");
  const nativePreviewFilter=nativeDisplay&&(nativeDisplay.width!==nativeDisplay.codedWidth||nativeDisplay.height!==nativeDisplay.codedHeight)
    ?`scale=${nativeDisplay.width}:${nativeDisplay.height}:flags=bilinear,setsar=1`:undefined;
  const nativeVideoFilter=nativePreviewFilter?["-vf",nativePreviewFilter]:[];
  const duration=/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/u.exec(probe.stderr), rate=/,\s*([\d.]+) fps/u.exec(selectedStream);
  if (duration && rate) {
    const expectedFrames=(Number(duration[1])*3600+Number(duration[2])*60+Number(duration[3]))*Number(rate[1]);
    if (expectedFrames>MAX_FRAMES+1 || expectedFrames*Number(dims[1])*Number(dims[2])>MAX_MOVIE_PIXELS) throw new RangeError("Movie exceeds the bounded duration/frame decode budget.");
  }
  // Local, immutable single-file input only. No network, concat files or external dependency protocols.
  const {stdout,stderr} = await ffmpegRun(binary,cwd,["-protocol_whitelist","file,pipe","-threads","2",...origin,"-i",input,"-map",videoMap,"-an",...nativeVideoFilter,"-vsync","0","-pix_fmt","rgba","-threads","2","-frames:v",String(MAX_FRAMES+1),"-enc_time_base","-1","-f","framehash","-hash","sha256","pipe:1"],signal);
  const dimensions = /^#dimensions 0:\s*(\d+)x(\d+)/mu.exec(stdout), timebase = /^#tb 0:\s*(\d+)\/(\d+)/mu.exec(stdout);
  if (!dimensions || !timebase) throw new Error("The movie decoder did not expose complete frame dimensions or timing.");
  const width = Number(dimensions[1]), height = Number(dimensions[2]);
  if(nativeDisplay&&(width!==nativeDisplay.width||height!==nativeDisplay.height))throw new Error("The actual native preview raster differs from its qualified display geometry; original bytes are retained.");
  const tb = Number(timebase[1])/Number(timebase[2])*1000;
  const frames = stdout.split("\n").filter(line => /^0,/.test(line)).map(line => line.split(",").map(s=>s.trim()));
  if (!frames.length || frames.length > MAX_FRAMES || width*height*frames.length > MAX_MOVIE_PIXELS) throw new RangeError("Movie exceeds the bounded full-frame verification budget.");
  if(BigInt(frames.length)!==presentation.videoTimeline.samples) throw new Error("The complete movie sample count does not match every actual decoded frame; native media is retained.");
  let timingFrames = frames, timingBase = tb;
  {
    // The rawvideo encoder used for decoded hashes can replace video packet
    // durations with its guessed frame rate. Read the exact muxed sequence
    // timeline separately and require a one-to-one match to decoded frames.
    const packets = await ffmpegRun(binary,cwd,["-protocol_whitelist","file,pipe","-threads","2",...origin,"-i",input,"-map",videoMap,"-c:v","copy","-an","-frames:v",String(MAX_FRAMES+1),"-f","framehash","-hash","sha256","pipe:1"],signal);
    const packetBase = /^#tb 0:\s*(\d+)\/(\d+)/mu.exec(packets.stdout);
    timingFrames = packets.stdout.split("\n").filter(line => /^0,/.test(line)).map(line => line.split(",").map(s=>s.trim())).sort((left,right) => Number(left[2])-Number(right[2]));
    if (!packetBase || timingFrames.length !== frames.length) throw new Error("The movie packet timeline does not match every decoded frame.");
    const first=timingFrames[0]!,last=timingFrames.at(-1)!,clock=presentation.videoTimeline;
    if(BigInt(first[2]!)!==0n || (BigInt(last[2]!)+BigInt(last[3]!))*BigInt(packetBase[1]!)*clock.scale!==clock.duration*BigInt(packetBase[2]!)) throw new Error("The complete movie media duration does not match the actual packet timeline; native media is retained.");
    timingBase = Number(packetBase[1])/Number(packetBase[2])*1000;
    const firstPacket = Number(timingFrames[0]![2]), firstDecoded = Number(frames[0]![2]);
    if (timingFrames.some((frame,index) => exactOrigin
      ? BigInt(frame[2]!) * BigInt(packetBase[1]!) * BigInt(timebase[2]!) !== BigInt(frames[index]![2]!) * BigInt(timebase[1]!) * BigInt(packetBase[2]!)
      : Math.abs((Number(frame[2])-firstPacket)*timingBase - (Number(frames[index]![2])-firstDecoded)*tb) >= 0.51)) throw new Error("The movie packet timestamps do not match decoded frames.");
  }
  const first = Number(timingFrames[0]![2]), times = timingFrames.map(f => (Number(f[2])-first)*timingBase), delays = timingFrames.map(f => Number(f[3])*timingBase);
  if (times.some(n=>!Number.isFinite(n)) || delays.some(n=>!Number.isFinite(n)||n<=0)) throw new Error("Movie frame timing is incomplete.");
  // RGBA8 hashes must never be misrepresented as verification of HDR or high-depth source samples.
  if (/Video:[^\n]*(?:yuv\w*p(?:9|10|12|14|16)|gbrp(?:9|10|12|14|16)|rgba64|rgb48|bt2020|smpte2084|arib-std-b67)/iu.test(stderr)) throw new Error("High-depth/HDR movie edits need a color-preserving adapter. Original bytes remain supported.");
  const hasAudio=/Stream #.*Audio:/u.test(stderr),audioTimeline=presentation.audioTimeline;
  if(hasAudio!==!!audioTimeline)throw new Error("The actual audio tracks do not match the qualified container timeline; native media is retained.");
  const audio=hasAudio?await decodePairAudio(binary,cwd,input,audioTimeline!,signal):undefined;
  return {info:{width,height,durationMs:times.at(-1)!+delays.at(-1)!,frameCount:frames.length,animated:frames.length>1,hasAudio,frameTimesMs:times,frameDurationsMs:delays},hashes:frames.map(f=>f[5]!),videoMap,startTimeMs:first*timingBase,extraStreams:/Stream #.*(?:Subtitle|Data|Attachment):/u.test(probe.stderr),srgbFull:presentation.srgbFull,...(audio?{audio,audioTimeline}:{} ),
    ...(nativePreviewFilter?{nativePreviewFilter}:{}),
    ...(nativeDisplay?{nativeWarnings:[
      ...(nativePreviewFilter?[`Native display preview rasterizes coded ${nativeDisplay.codedWidth}x${nativeDisplay.codedHeight} at SAR ${nativeDisplay.sampleAspectRatio.numerator}:${nativeDisplay.sampleAspectRatio.denominator} to ${nativeDisplay.width}x${nativeDisplay.height}. This is preview-only; original encoded bytes are unchanged and no lossless conversion or pair proof is granted.`]:[]),
      ...(presentation.nativeCreatorTitle?["Native inspection retains the creator title in the exact original container; the frame preview is not permission to remove that metadata from a converted carrier."]:[])]}:{} )};
}
function sameAudioPresentation(a:MovieAudioTimeline|undefined,b:MovieAudioTimeline|undefined) {
  return !a&&!b || !!a&&!!b&&(a.duration-a.priming)*b.scale===(b.duration-b.priming)*a.scale;
}
function assertSingleFileMedia(bytes:Uint8Array) {
  const ascii = new TextDecoder("latin1").decode(bytes.subarray(0,32));
  const iso = ["ftyp","moov","mdat","wide","free","skip"].includes(ascii.slice(4,8));
  const riff = ascii.startsWith("RIFF") && ["AVI ","WEBP"].includes(ascii.slice(8,12));
  const ebml = bytes[0]===0x1a && bytes[1]===0x45 && bytes[2]===0xdf && bytes[3]===0xa3;
  const mpeg = bytes[0]===0 && bytes[1]===0 && bytes[2]===1;
  const image = ascii.startsWith("GIF8") || (bytes[0]===0x89 && ascii.slice(1,4)==="PNG") || (bytes[0]===0xff && bytes[1]===0xd8);
  if (!iso && !riff && !ebml && !mpeg && !image) throw new Error("This input is not a verified self-contained media container. Playlists and external-file references are not accepted for server decoding; original bytes remain retainable.");
}
async function movieCandidate(bytes: Uint8Array, recipe: KeelMediaEditRecipe, signal?:AbortSignal): Promise<{bytes:Uint8Array;source:Decoded;candidate:Decoded}> {
  assertSingleFileMedia(bytes);
  const runtime = await resolveBundledFfmpeg();
  if (!runtime.available || !runtime.binary) throw new Error(`${runtime.reason ?? "Verified movie encoder is unavailable."} Original bytes can still be retained, stored and exported.`);
  let decodedImage:Decoded|undefined;
  if (!animatedAvif(bytes)) {
    try { await (await sharpFactory())(bytes,{animated:true,limitInputPixels:MAX_PIXELS}).metadata(); decodedImage=await decodeImage(bytes); }
    catch(error) { if(error instanceof RangeError) throw error; }
  }
  const dir = await mkdtemp(path.join(tmpdir(),"keel-media-"));
  try {
    await writeFile(path.join(dir,"source"),bytes,{flag:"wx"});
    const source = decodedImage ?? await decodeMovie(runtime.binary,dir,"source",signal); checkGeometry(recipe,source.info);
    if(decodedImage) {
      const meta=decodedImage.imageMetadata!;
      if(meta.orientation && meta.orientation!==1 || meta.depth && meta.depth!=="uchar" || meta.space && !["srgb","b-w"].includes(meta.space) || [meta.icc,meta.exif,meta.xmp,meta.iptc].some(value=>value!==undefined)) throw new Error("Movie export cannot preserve these image color, orientation or creator metadata semantics; native media is retained.");
    }
    const imageDelay=source.info.frameDurationsMs[0] ?? 0;
    if (decodedImage && (!source.info.animated || imageDelay<=0 || source.info.frameDurationsMs.some(n=>!Number.isSafeInteger(n)||n<=0))) throw new Error("Image-to-movie export requires a complete animation with positive millisecond frame delays.");
    const variableImageTiming=decodedImage && source.info.frameDurationsMs.some(n=>n!==imageDelay);
    if(variableImageTiming && decodedImage) {
      const frameBytes=source.info.width*source.info.height*4, manifest=["ffconcat version 1.0"];
      for(let i=0;i<source.info.frameCount;i++) {
        signal?.throwIfAborted();
        const frame=await (await sharpFactory())(decodedImage.rgba!.subarray(i*frameBytes,(i+1)*frameBytes),{raw:{width:source.info.width,height:source.info.height,channels:4}}).png().timeout({seconds:60}).toBuffer();
        await writeFile(path.join(dir,`frame-${i}.png`),frame,{flag:"wx"});
        manifest.push(`file frame-${i}.png`,"option framerate 1000",`duration ${source.info.frameDurationsMs[i]!/1000}`);
      }
      await writeFile(path.join(dir,"timeline.ffconcat"),manifest.join("\n")+"\n",{flag:"wx"});
      await ffmpegRun(runtime.binary,dir,["-loglevel","error","-protocol_whitelist","file,pipe","-f","concat","-safe","0","-i","timeline.ffconcat","-vsync","0","-enc_time_base","-1","-plays","1","-final_delay",`${source.info.frameDurationsMs.at(-1)!}/1000`,"-threads","2","-n","timeline.apng"],signal);
    }
    if (decodedImage) await writeFile(path.join(dir,"source.rgba"),decodedImage.rgba!,{flag:"wx"});
    if (["webp","avif"].includes(recipe.format) && source.info.hasAudio && !recipe.noSound) throw new Error("Image output cannot retain audio. Enable No sound explicitly or keep a movie/original output.");
    if (["webp","avif"].includes(recipe.format) && !decodedImage && !source.srgbFull) throw new Error("The source movie has unspecified color semantics; this image conversion cannot claim lossless preservation. Native media is retained.");
    if (geometry(recipe)) throw new Error("Movie geometry editing is not yet verified by this adapter; preserve original geometry or use an explicit image edit.");
    const args = ["-loglevel","error","-protocol_whitelist","file,pipe","-threads","2",...(variableImageTiming ? ["-i","timeline.apng"] : decodedImage ? ["-f","rawvideo","-pixel_format","rgba","-video_size",`${source.info.width}x${source.info.height}`,"-framerate",`1000/${imageDelay}`,"-i","source.rgba"] : ["-i","source"]),"-map",source.videoMap ?? "0:v:0","-vsync","0","-enc_time_base","-1"];
    // Raw RGBA input otherwise loses its established Sharp sRGB semantics.
    // Forward only an actually qualified profile; unspecified movies never
    // acquire invented sRGB authority just to make an AVIF candidate pass.
    if(decodedImage || source.srgbFull) args.push("-color_primaries","bt709","-color_trc","iec61966-2-1","-colorspace","rgb","-color_range","pc");
    if (recipe.noSound || ["webp","avif"].includes(recipe.format)) args.push("-an"); else args.push("-map","0:a?","-c:a","copy");
    const crf = String(Math.round((100-recipe.quality)*0.51));
    if (recipe.format === "webp") args.push("-c:v","libwebp_anim","-lossless",recipe.mode === "lossless" ? "1":"0","-quality",String(recipe.quality),"-loop","0");
    else if (recipe.format === "avif") args.push("-c:v","libaom-av1","-crf",recipe.mode === "lossless" ? "0":crf,"-cpu-used","6","-pix_fmt",recipe.mode === "lossless" ? "gbrp":"yuv444p","-threads","2");
    else if (recipe.format === "webm") args.push("-c:v","libvpx-vp9","-lossless",recipe.mode === "lossless" ? "1":"0","-crf",recipe.mode === "lossless" ? "0":crf,"-b:v","0","-threads","2");
    else args.push("-c:v",recipe.mode === "lossless" ? "libx264rgb":"libx264","-crf",recipe.mode === "lossless" ? "0":crf,"-preset","medium","-threads","2");
    const outputName = `candidate.${recipe.format}`; args.push("-n",outputName);
    await ffmpegRun(runtime.binary,dir,args,signal);
    const info = await stat(path.join(dir,outputName)); if (info.size>MAX_BYTES) throw new RangeError("Candidate exceeds the output byte budget.");
    let output = new Uint8Array(await readFile(path.join(dir,outputName))); bounded(output);
    if (recipe.format === "webp") output = assignTemporalWebPDelays(output, source.info);
    let candidate = recipe.format === "webp" ? await decodeImage(output) : await decodeMovie(runtime.binary,dir,outputName,signal);
    if (recipe.format !== "webp" && !sameTimeline(source.info,candidate.info)) {
      // Some encoders infer the last duration from the preceding timestamp.
      // Remux the encoded packets without changing their media bytes, assigning
      // the exact verified source delay at each presentation timestamp.
      const durations = source.info.frameDurationsMs.map((duration,index) => `eq(PTS,round(${source.info.frameTimesMs[index]!}/1000/TB))*${duration}/1000/TB`).join("+");
      const corrected = `timed.${recipe.format}`;
      await ffmpegRun(runtime.binary,dir,["-loglevel","error","-protocol_whitelist","file,pipe","-threads","2","-i",outputName,"-map",candidate.videoMap!,"-map","0:a?","-c","copy","-bsf:v",`setts=duration='${durations}'`,"-n",corrected],signal);
      if ((await stat(path.join(dir,corrected))).size>MAX_BYTES) throw new RangeError("Candidate exceeds the output byte budget.");
      output = new Uint8Array(await readFile(path.join(dir,corrected))); bounded(output);
      candidate = await decodeMovie(runtime.binary,dir,corrected,signal);
    }
    if (!sameTimeline(source.info,candidate.info) || source.info.width !== candidate.info.width || source.info.height !== candidate.info.height) throw new Error(`Movie ${recipe.format} candidate changed frames, timing or dimensions; original retained.`);
    if (!recipe.noSound && source.info.hasAudio !== candidate.info.hasAudio) throw new Error("Movie candidate changed audio presence; original retained.");
    if(recipe.mode==="lossless" && !recipe.noSound && (!sameAudioPresentation(source.audioTimeline,candidate.audioTimeline) || canonicalJson(source.audio??null)!==canonicalJson(candidate.audio??null))) throw new Error("Movie candidate changed exact audio presentation duration or complete PCM; original retained.");
    if (recipe.mode === "lossless" && source.hashes.some((v,i)=>candidate.hashes[i]!==v)) throw new Error("Movie candidate failed full decoded pixel-losslessness verification; original retained.");
    return {bytes:output,source,candidate};
  } finally { await rm(dir,{recursive:true,force:true}); }
}
/** Optional candidate only. Never replaces the source, chooses a storage mode or publishes. */
export async function prepareMediaCandidate(input: { readonly bytes:Uint8Array; readonly mediaType?:string; readonly recipe:unknown; readonly signal?:AbortSignal }): Promise<KeelMediaCandidate> {
  input.signal?.throwIfAborted(); bounded(input.bytes); const sourceBytes = new Uint8Array(input.bytes), recipe = parseKeelMediaEditRecipe(input.recipe), sourceIntegrity = await createIntegrity(sourceBytes);
  if (recipe.mode === "original") return { bytes:sourceBytes, mediaType:input.mediaType ?? "application/octet-stream", extension:"",recipe,sourceIntegrity,outputIntegrity:sourceIntegrity,sourceInfo:null,candidateInfo:null,measurements:{beforeBytes:sourceBytes.length,afterBytes:sourceBytes.length,savedBytes:0},verification:{sourcePreserved:true,completeDecode:false,framesAndTimingPreserved:true,losslessPixelsVerified:false,browserDecode:"requires-runtime-check"},warnings:["Original bytes are preserved exactly. Storage eligibility does not imply a browser can decode this media."] };
  let result: {bytes:Uint8Array;source:Decoded;candidate:Decoded};
  let imageDecodable = false; let imageAnimated = false;
  try { const meta=await (await sharpFactory())(sourceBytes,{animated:true,limitInputPixels:MAX_PIXELS}).metadata(); imageDecodable = true; imageAnimated=(meta.pages ?? 1)>1; } catch { /* Actual decoder probe, never an extension gate. */ }
  if (imageDecodable && !animatedAvif(sourceBytes) && !(imageAnimated && recipe.format === "avif") && ["webp","avif"].includes(recipe.format)) result = await imageCandidate(sourceBytes,recipe);
  else result = await movieCandidate(sourceBytes,recipe,input.signal);
  input.signal?.throwIfAborted();
  const outputFormat = formats[recipe.format as keyof typeof formats];
  return {bytes:result.bytes,mediaType:outputFormat[0],extension:outputFormat[1],recipe,sourceIntegrity,outputIntegrity:await createIntegrity(result.bytes),sourceInfo:result.source.info,candidateInfo:result.candidate.info,measurements:{beforeBytes:sourceBytes.length,afterBytes:result.bytes.length,savedBytes:sourceBytes.length-result.bytes.length},verification:{sourcePreserved:true,completeDecode:true,framesAndTimingPreserved:true,losslessPixelsVerified:recipe.mode === "lossless" && !geometry(recipe),browserDecode:"requires-runtime-check"},warnings:[...(recipe.mode === "lossy" ? ["This candidate uses explicitly selected lossy encoding."]:[]),...(geometry(recipe) ? ["Geometry edits intentionally change pixels; lossless refers to encoding the edited image, not the original composition."]:[]),"Verify this exact candidate in the selected KEEL shell and browser decoder before choosing it for publication. Candidate size is not complete tokenURI size."]};
}

export async function getMediaPreparationCapabilities() {
  const movie = await resolveBundledFfmpeg();
  let image = false;
  try { await sharpFactory(); image = true; } catch { /* Optional pinned adapter absent. */ }
  return {schema:"keel-media-capabilities@1",original:{available:true,bytePreserving:true,requiresDecoder:false},image:{available:image,formats:["webp","avif"],animation:"WebP only, with full frame/timing verification",geometry:"still-image crop, resize, rotation and ordered duplicate-original layers; no implicit clipping"},movie:{available:movie.available,...(movie.reason?{reason:movie.reason}:{}),formats:["webp","avif","webm","mp4","mov"],input:"actual complete decoder probe of self-contained container bytes",audio:"preserved by stream copy unless No sound is explicitly enabled"},limits:{maxInputBytes:MAX_BYTES,maxDecodedPixels:MAX_PIXELS,maxMovieDecodedPixels:MAX_MOVIE_PIXELS,maxFrames:MAX_FRAMES},browserDecode:"requires-runtime-check",publication:"separate complete-tokenURI and selected-shell verification"};
}
function frameAt(info:KeelMediaInfo,timeMs:number) {
  let index=0;
  for (let i=1;i<info.frameTimesMs.length;i++) {if (info.frameTimesMs[i]!>timeMs) break; index=i;}
  return index;
}
async function readFrame(bytes:Uint8Array,timeMs:number, signal?:AbortSignal,purpose:"fidelity"|"native-inspection"="fidelity"):Promise<{bytes:Uint8Array;info:KeelMediaInfo;frameTimeMs:number;warnings?:readonly string[]}> {
  signal?.throwIfAborted();
  let image=false;
  try {await (await sharpFactory())(bytes,{animated:true,limitInputPixels:MAX_PIXELS}).metadata(); image=true;} catch { /* Probe movie. */ }
  if(image && !animatedAvif(bytes)) {
    const decoded=await decodeImage(bytes,purpose), index=frameAt(decoded.info,timeMs);
    const frame=await (await sharpFactory())(bytes,{page:index,pages:1,limitInputPixels:MAX_PIXELS}).png().timeout({seconds:60}).toBuffer();
    signal?.throwIfAborted(); return {bytes:new Uint8Array(frame),info:decoded.info,frameTimeMs:decoded.info.frameTimesMs[index]!,...(purpose==="native-inspection"&&decoded.imageMetadata?.format==="gif"&&decoded.info.animated?{warnings:["Native GIF inspection reports declared frame delays for one cycle. Browser timer clamping and loop playback require actual runtime checks; this is not conversion or lossless-candidate approval."]}:{})};
  }
  assertSingleFileMedia(bytes);
  const runtime=await resolveBundledFfmpeg(); if(!runtime.available||!runtime.binary) throw new Error(runtime.reason ?? "Movie decoder unavailable.");
  const dir=await mkdtemp(path.join(tmpdir(),"keel-frame-"));
  try {
    await writeFile(path.join(dir,"source"),bytes,{flag:"wx"});
    const decoded=await decodeMovie(runtime.binary,dir,"source",signal,false,purpose), index=frameAt(decoded.info,timeMs);
    await ffmpegRun(runtime.binary,dir,["-loglevel","error","-protocol_whitelist","file,pipe","-threads","2","-i","source","-map",decoded.videoMap ?? "0:v:0","-vf",`select=eq(n\\,${index})${decoded.nativePreviewFilter?","+decoded.nativePreviewFilter:""}`,"-vsync","0","-frames:v","1","-threads","2","-n","frame.png"],signal);
    return {bytes:new Uint8Array(await readFile(path.join(dir,"frame.png"))),info:decoded.info,frameTimeMs:decoded.info.frameTimesMs[index]!,...(decoded.nativeWarnings?{warnings:decoded.nativeWarnings}:{})};
  } finally {await rm(dir,{recursive:true,force:true});}
}
/** Decode both views at one source time. Never compares independently running animations. */
export async function compareMediaFrames(input:{readonly bytes:Uint8Array;readonly mediaType?:string;readonly recipe:unknown;readonly timeMs:number;readonly signal?:AbortSignal}) {
  // Capture every request identity before the first await. Hashing, complete
  // decoding and frame selection must never reread mutable caller bytes or a
  // replacement recipe/time/signal. The captured signal itself stays live.
  const {bytes:source,mediaType,timeMs,signal,recipe:rawRecipe}=input;
  signal?.throwIfAborted();bounded(source);
  if(!Number.isFinite(timeMs)||timeMs<0||timeMs>3_600_000) throw new RangeError("Comparison time must be between 0 and 3,600,000 milliseconds.");
  const bytes=Uint8Array.from(source),recipe=parseKeelMediaEditRecipe(rawRecipe);
  const candidate=await prepareMediaCandidate({bytes,recipe,...(mediaType===undefined?{}:{mediaType}),...(signal?{signal}:{})});
  const original=await readFrame(bytes,timeMs,signal,candidate.recipe.mode==="original"?"native-inspection":"fidelity");
  if (original.info.animated && timeMs>=original.info.durationMs) throw new RangeError("The requested comparison time is outside the source timeline.");
  const processed=candidate.recipe.mode === "original" ? original : await readFrame(candidate.bytes,timeMs,signal);
  return {originalFrame:original.bytes,processedFrame:processed.bytes,mediaType:"image/png" as const,timeMs,sourceFrameTimeMs:original.frameTimeMs,candidateFrameTimeMs:processed.frameTimeMs,sourceInfo:original.info,candidateInfo:processed.info,recipe:candidate.recipe,sourceIntegrity:candidate.sourceIntegrity,outputIntegrity:candidate.outputIntegrity,measurements:candidate.measurements,verification:candidate.verification,warnings:[...candidate.warnings,...(original.warnings??[])]};
}

const actualPairProofs = new WeakSet<object>();
const MAX_AUDIO_PCM_BYTES = 64 * 1024 * 1024;
const AUDIO_BLOCK_SAMPLES = 1024;
const MAX_AUDIO_BLOCKS = MAX_AUDIO_PCM_BYTES / (8 * AUDIO_BLOCK_SAMPLES);
function freezePair<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freezePair(child); Object.freeze(value); }
  return value;
}
/** Only the actual decoder factory's request-local output has authority. A
 * public/hydrated JSON assertion, even with matching SHA fields, is refused. */
export function assertActualMediaPairProof(value: unknown): asserts value is ActualMediaPairProof {
  if (!value || typeof value !== "object" || !actualPairProofs.has(value)) throw new TypeError("A fresh actual-media-pair decoder proof is required.");
}

async function decodePairAudio(binary: string, dir: string, name: string, timeline:MovieAudioTimeline, signal?: AbortSignal): Promise<ActualMediaAudio> {
  // Canonical full PCM blocks avoid comparing arbitrary source packet grouping.
  // p=0 preserves the real short final block; no silence is manufactured.
  // https://ffmpeg.org/ffmpeg-filters.html#asetnsamples
  // https://ffmpeg.org/ffmpeg-formats.html#framehash
  const { stdout, stderr } = await ffmpegRun(binary, dir, ["-protocol_whitelist", "file,pipe", "-threads", "2", "-copyts", "-i", name,
    "-map", "0:a:0", "-vn", "-af", `asetnsamples=n=${AUDIO_BLOCK_SAMPLES}:p=0`, "-c:a", "pcm_f64le", "-frames:a", String(MAX_AUDIO_BLOCKS + 1), "-f", "framehash", "-hash", "sha256", "pipe:1"], signal);
  const input = stderr.split("Output #")[0]!;
  const audioStreams = input.split("\n").filter(line => /^\s*Stream #.*Audio:/u.test(line));
  if (audioStreams.length !== 1) throw new Error("Multiple audio tracks require explicit verified selection; native media is retained.");
  // f64 represents every sample of these decoder formats without reducing its
  // precision. Unknown or signed-64-bit integer PCM is not silently quantized.
  if (!/,\s*(?:u8p?|s16p?|s32p?|fltp?|dblp?)(?:\s*\([^)]*\))?(?:,|\s*$)/u.test(audioStreams[0]!))
    throw new Error("The audio decoder precision is not admitted for exact PCM verification; native media is retained.");
  const rate = /^#sample_rate 0:\s*(\d+)$/mu.exec(stdout), layout = /^#channel_layout_name 0:\s*(.+)$/mu.exec(stdout), tb = /^#tb 0:\s*(\d+)\/(\d+)$/mu.exec(stdout);
  const rows = stdout.split("\n").filter(line => /^0,/u.test(line)).map(line => line.split(",").map(v => v.trim()));
  if (!rate || !layout || !tb || !/^#codec_id 0:\s*pcm_f64le$/mu.test(stdout) || !rows.length || rows.length > MAX_AUDIO_BLOCKS) throw new Error("The complete audio PCM timeline is unavailable or exceeds its verification bound.");
  const sampleRate = Number(rate[1]), timeBase = `${tb[1]}/${tb[2]}`, channelLayout = layout[1]!;
  if (sampleRate < 1 || sampleRate > 192_000 || Number(tb[1]) !== 1 || Number(tb[2]) !== sampleRate) throw new Error("The exact audio sample clock is unsupported; native media is retained.");
  const frameTimes = rows.map(row => Number(row[2])), frameSamples = rows.map(row => Number(row[3])), frameBytes = rows.map(row => Number(row[4])), frameHashes = rows.map(row => row[5]!);
  const totalBytes = frameBytes.reduce((n, v) => n + v, 0), totalSamples = frameSamples.reduce((n, v) => n + v, 0);
  const channels = frameBytes[0]! / (8 * frameSamples[0]!);
  if (!Number.isSafeInteger(channels) || channels < 1 || channels > 8 || totalBytes > MAX_AUDIO_PCM_BYTES
    || frameTimes.some((v, i) => !Number.isSafeInteger(v) || i > 0 && v !== frameTimes[i-1]! + frameSamples[i-1]!)
    || frameSamples.some((v, i) => !Number.isSafeInteger(v) || v < 1 || v > AUDIO_BLOCK_SAMPLES || i < rows.length-1 && v !== AUDIO_BLOCK_SAMPLES)
    || frameBytes.some((v, i) => !Number.isSafeInteger(v) || v !== 8 * channels * frameSamples[i]!) || frameHashes.some(v => !/^[0-9a-f]{64}$/u.test(v))) throw new Error("Audio PCM coverage, channel layout or timing changed or exceeds the complete verification budget.");
  const expected=timeline.codec==="pcm"?timeline.samples:timeline.samples*1024n-timeline.priming;
  if(BigInt(sampleRate)!==timeline.scale || sampleRate!==timeline.sampleRate || channels!==timeline.channels || frameTimes[0]!==0 || BigInt(totalSamples)!==expected || BigInt(frameTimes.at(-1)!+frameSamples.at(-1)!)!==expected) throw new Error("Actual full audio sample count, clock or end differs from its qualified container timeline; native media is retained.");
  if(timeline.codec==="aac-lc-1024") {
    // AAC-LC decodes complete 1024-sample frames, including its actual codec
    // tail. Preserve those samples; bind separately to the declared logical
    // presentation and known edit-list priming, never trim/pad to pass.
    const packets=await ffmpegRun(binary,dir,["-protocol_whitelist","file,pipe","-threads","2","-copyts","-i",name,"-map","0:a:0","-vn","-c:a","copy","-f","framehash","-hash","sha256","pipe:1"],signal);
    const packetBase=/^#tb 0:\s*(\d+)\/(\d+)$/mu.exec(packets.stdout),packetRate=/^#sample_rate 0:\s*(\d+)$/mu.exec(packets.stdout),packetRows=packets.stdout.split("\n").filter(line=>/^0,/u.test(line)).map(line=>line.split(",").map(value=>value.trim()));
    if(!/^#codec_id 0:\s*aac$/mu.test(packets.stdout) || !packetBase || packetBase[1]!=="1" || BigInt(packetBase[2]!)!==timeline.scale || !packetRate || Number(packetRate[1])!==sampleRate || BigInt(packetRows.length)!==timeline.samples)throw new Error("Actual AAC packet count or clock differs from the qualified audio timeline; native media is retained.");
    let at=-timeline.priming,index=0;
    for(const run of timeline.runs)for(let n=0n;n<run.count;n++) {
      const row=packetRows[index++]!;
      if(!/^-?\d+$/u.test(row[1]??"") || !/^-?\d+$/u.test(row[2]??"") || !/^\d+$/u.test(row[3]??"") || BigInt(row[1]!)!==at || BigInt(row[2]!)!==at || BigInt(row[3]!)!==run.duration)throw new Error("Actual AAC packet presentation differs from complete sample-table timing; native media is retained.");
      at+=run.duration;
    }
    if(at!==timeline.duration-timeline.priming)throw new Error("Actual AAC packet end differs from its declared audio presentation; native media is retained.");
  }
  const value = { codec: "pcm_f64le" as const, sampleRate, channelLayout, timeBase, frameTimes, frameSamples, frameBytes, frameHashes, totalBytes, totalSamples };
  return { ...value, sequenceDigest: `0x${hash(new TextEncoder().encode(canonicalJson(value)))}` };
}

async function decodeActualPairStream(bytes: Uint8Array, dir: string, name: string, signal?: AbortSignal): Promise<{ stream: ActualMediaPairStream; metadata?: ImageMetadata; audioTimeline?:MovieAudioTimeline }> {
  signal?.throwIfAborted(); assertSingleFileMedia(bytes);
  let metadata: ImageMetadata | undefined;
  if (!animatedAvif(bytes)) {
    try { metadata = await (await sharpFactory())(bytes, { animated: true, failOn: "warning", limitInputPixels: MAX_PIXELS }).metadata(); }
    catch { /* A failed image probe is not an audio-absence or static-image proof. */ }
  }
  let decoded: Decoded, loop: ActualMediaLoop;
  if (metadata) {
    if (metadata.orientation && metadata.orientation !== 1 || metadata.depth && metadata.depth !== "uchar" || metadata.space && !["srgb", "b-w"].includes(metadata.space)) throw new Error("High-depth, orientation or non-sRGB semantics require a preserving adapter; native media is retained.");
    decoded = await decodeImage(bytes);
    signal?.throwIfAborted();
    if (!decoded.info.animated) loop = { kind: "still" };
    else if (Number.isSafeInteger(metadata.loop) && metadata.loop! >= 0) loop = { kind: "container", repetitions: metadata.loop! };
    else throw new Error("The animated image's exact loop semantics are unavailable; native media is retained.");
  } else {
    const runtime = await resolveBundledFfmpeg();
    if (!runtime.available || !runtime.binary) throw new Error(runtime.reason ?? "Verified temporal decoder unavailable; native media is retained.");
    await writeFile(path.join(dir, name), bytes, { flag: "wx" });
    decoded = await decodeMovie(runtime.binary, dir, name, signal, true);
    if (decoded.extraStreams) throw new Error("Subtitle, data or attachment tracks require a preserving adapter; native media is retained.");
    if (decoded.info.hasAudio) {
      return { stream: { info: decoded.info, frameHashes: decoded.hashes, loop: { kind: "canonical-player-defined" }, startTimeMs: decoded.startTimeMs ?? 0, audio:decoded.audio!, colorSemantics: decoded.srgbFull ? "srgb-full" : "unspecified-rgb" },audioTimeline:decoded.audioTimeline! };
    }
    loop = { kind: "canonical-player-defined" };
  }
  return { stream: { info: decoded.info, frameHashes: decoded.hashes, loop, startTimeMs: decoded.startTimeMs ?? 0, colorSemantics: metadata || decoded.srgbFull ? "srgb-full" : "unspecified-rgb" }, ...(metadata ? { metadata } : {}) };
}

/** Verify the ACTUAL retained candidate, never a regenerated replacement. Every
 * pixel, frame timestamp, loop and decoded audio sample participates. The
 * caller must still measure complete canonical output in its authenticated
 * current context and prove any canonical-player-defined repeat semantics. */
export async function verifyActualMediaPair(input: { readonly sourceBytes: Uint8Array; readonly candidateBytes: Uint8Array; readonly recipe: unknown; readonly signal?: AbortSignal }): Promise<ActualMediaPairProof> {
  input.signal?.throwIfAborted(); bounded(input.sourceBytes); bounded(input.candidateBytes);
  const sourceBytes = Uint8Array.from(input.sourceBytes), candidateBytes = Uint8Array.from(input.candidateBytes), recipe = parseKeelMediaEditRecipe(input.recipe);
  const sourceIntegrity = await createIntegrity(sourceBytes), candidateIntegrity = await createIntegrity(candidateBytes);
  const base = { schema: "keel-actual-media-pair@1" as const, sourceIntegrity, candidateIntegrity, recipe,
    recipeDigest: `0x${hash(new TextEncoder().encode(canonicalJson(recipe)))}`, publicationReady: false as const, adoptionAuthorized: false as const };
  const admit = (proof: ActualMediaPairProof) => { freezePair(proof); actualPairProofs.add(proof); return proof; };
  if (recipe.mode !== "lossless" || recipe.noSound || geometry(recipe)) return admit({ ...base, eligibility: "explicit-edit-only", reason: "Explicit lossy, geometry or audio edits remain selected; automatic equivalence cannot restore their original composition." });
  const dir = await mkdtemp(path.join(tmpdir(), "keel-actual-media-pair-"));
  try {
    const source = await decodeActualPairStream(sourceBytes, dir, "source", input.signal);
    const candidate = await decodeActualPairStream(candidateBytes, dir, "candidate", input.signal);
    assertActualCandidateContainer(candidateBytes,recipe.format,candidate.metadata?.format);
    input.signal?.throwIfAborted();
    const a = source.stream, b = candidate.stream;
    if(a.colorSemantics!==b.colorSemantics) throw new Error("The actual candidate changed source color semantics; native media is retained.");
    if (canonicalJson(a.info) !== canonicalJson(b.info) || a.startTimeMs !== b.startTimeMs || a.frameHashes.length !== b.frameHashes.length
      || a.frameHashes.some((value, i) => value !== b.frameHashes[i])) throw new Error("The supplied candidate changed actual full-frame RGBA, dimensions, exact timing, start position or audio presence; selected native media is retained.");
    if (canonicalJson(a.audio ?? null) !== canonicalJson(b.audio ?? null)) throw new Error("The supplied candidate changed actual complete audio PCM, channels, sample clock or presentation timing; selected native media is retained.");
    if(!sameAudioPresentation(source.audioTimeline,candidate.audioTimeline))throw new Error("The supplied candidate changed the exact declared audio presentation duration; native media is retained.");
    for (const field of ["icc", "exif", "xmp", "iptc"] as const) {
      const original = source.metadata?.[field], processed = candidate.metadata?.[field];
      if ((original === undefined ? undefined : hash(original)) !== (processed === undefined ? undefined : hash(processed))) throw new Error("The supplied candidate changed embedded color or creator metadata; selected native media is retained.");
    }
    if (canonicalJson(a.loop) === canonicalJson(b.loop) && a.loop.kind !== "canonical-player-defined") return admit({ ...base, source: a, candidate: b, eligibility: "equivalent-lossless", reason: "Actual complete decoded media, intrinsic loops, metadata and audio are exactly equivalent." });
    if ([a.loop,b.loop].some(loop => loop.kind === "container" && loop.repetitions !== 0) || [a.loop,b.loop].some(loop => loop.kind === "still")) throw new Error("The supplied candidate changed finite animation looping; selected native media is retained.");
    return admit({ ...base, source: a, candidate: b, eligibility: "requires-canonical-player-proof", reason: "Decoded content is exactly equivalent; the authenticated canonical renderer must prove repeat playback for both containers before automatic selection." });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
