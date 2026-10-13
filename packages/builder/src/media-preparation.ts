import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createIntegrity, type Integrity } from "@keel/protocol";
import { resolveBundledFfmpeg } from "./media-optimization.js";
import { parseKeelMediaEditRecipe, type KeelMediaEditRecipe } from "./media-edit-recipe.js";
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
function animatedAvif(bytes:Uint8Array) { return new TextDecoder("latin1").decode(bytes.subarray(4,40)).includes("avis"); }
interface Decoded { info: KeelMediaInfo; hashes: readonly string[]; rgba?:Uint8Array; }
function hash(bytes: Uint8Array) { const h = createHash("sha256"); h.update(bytes); return h.digest("hex"); }
function bounded(bytes: Uint8Array) { if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) throw new RangeError(`Media must contain 1–${MAX_BYTES} bytes.`); }
function geometry(recipe: KeelMediaEditRecipe) { return recipe.crop !== undefined || recipe.width !== undefined || recipe.height !== undefined || (recipe.rotate ?? 0) !== 0 || (recipe.layers?.length ?? 0) > 0; }
function sameTimeline(a: KeelMediaInfo, b: KeelMediaInfo) {
  return a.frameCount === b.frameCount && a.frameTimesMs.every((n,i) => Math.abs(n - b.frameTimesMs[i]!) < 0.51) && a.frameDurationsMs.every((n,i) => Math.abs(n - b.frameDurationsMs[i]!) < 0.51);
}
interface ImageMetadata { width?:number; height?:number; pages?:number; pageHeight?:number; delay?:number[]; loop?:number; orientation?:number; depth?:string; space?:string; format?:string; icc?:Uint8Array; }
interface SharpImage {
  metadata():Promise<ImageMetadata>; ensureAlpha():SharpImage; raw():SharpImage;
  toBuffer():Promise<Uint8Array>; toBuffer(options:{resolveWithObject:true}):Promise<{data:Uint8Array;info:{channels:number}}>;
  keepMetadata():SharpImage; extract(options:unknown):SharpImage; rotate(angle:number):SharpImage;
  composite(options:unknown):SharpImage; resize(options:unknown):SharpImage; webp(options:unknown):SharpImage; avif(options:unknown):SharpImage; png():SharpImage;
  timeout(options:{seconds:number}):SharpImage;
}
type SharpFactory = (bytes:Uint8Array,options?:Record<string,unknown>)=>SharpImage;
async function sharpFactory():Promise<SharpFactory> { return (await import("sharp")).default as unknown as SharpFactory; }
async function decodeImage(bytes: Uint8Array): Promise<Decoded> {
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
  return { info: { width, height, durationMs: duration, frameCount: count, animated: count > 1, hasAudio: false, frameTimesMs: times, frameDurationsMs: delays }, rgba:raw.data, hashes: Array.from({length:count}, (_,i) => hash(raw.data.subarray(i*size,(i+1)*size))) };
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
async function decodeMovie(binary: string, cwd: string, input: string, signal?:AbortSignal): Promise<Decoded> {
  signal?.throwIfAborted();
  const videoMap = animatedAvif(new Uint8Array(await readFile(path.join(cwd,input)))) ? "0:v:1" : "0:v:0";
  const probe = await ffmpegRun(binary,cwd,["-protocol_whitelist","file,pipe","-threads","2","-i",input,"-t","0","-map",videoMap,"-an","-f","null","-"],signal);
  const dims = /Video:[^\n]*?\b(\d{1,5})x(\d{1,5})\b/u.exec(probe.stderr);
  if (!dims || Number(dims[1])*Number(dims[2]) > MAX_PIXELS || Math.max(Number(dims[1]),Number(dims[2])) > 8192) throw new Error("Movie dimensions are unavailable or exceed the decode budget.");
  const videoStreams=probe.stderr.split("Output #")[0]!.split("\n").filter(line=>/^\s*Stream #.*Video:/u.test(line));
  if (videoStreams.length > (videoMap === "0:v:1" ? 2 : 1)) throw new Error("Multiple video streams need an explicit stream-selection recipe; none are silently discarded.");
  const duration=/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/u.exec(probe.stderr), rate=/,\s*([\d.]+) fps/u.exec(videoStreams[0] ?? "");
  if (duration && rate) {
    const expectedFrames=(Number(duration[1])*3600+Number(duration[2])*60+Number(duration[3]))*Number(rate[1]);
    if (expectedFrames>MAX_FRAMES+1 || expectedFrames*Number(dims[1])*Number(dims[2])>MAX_MOVIE_PIXELS) throw new RangeError("Movie exceeds the bounded duration/frame decode budget.");
  }
  // Local, immutable single-file input only. No network, concat files or external dependency protocols.
  const {stdout,stderr} = await ffmpegRun(binary,cwd,["-protocol_whitelist","file,pipe","-threads","2","-i",input,"-map",videoMap,"-an","-vsync","0","-pix_fmt","rgba","-threads","2","-frames:v",String(MAX_FRAMES+1),"-enc_time_base","-1","-f","framehash","-hash","sha256","pipe:1"],signal);
  const dimensions = /^#dimensions 0:\s*(\d+)x(\d+)/mu.exec(stdout), timebase = /^#tb 0:\s*(\d+)\/(\d+)/mu.exec(stdout);
  if (!dimensions || !timebase) throw new Error("The movie decoder did not expose complete frame dimensions or timing.");
  const width = Number(dimensions[1]), height = Number(dimensions[2]);
  const tb = Number(timebase[1])/Number(timebase[2])*1000;
  const frames = stdout.split("\n").filter(line => /^0,/.test(line)).map(line => line.split(",").map(s=>s.trim()));
  if (!frames.length || frames.length > MAX_FRAMES || width*height*frames.length > MAX_MOVIE_PIXELS) throw new RangeError("Movie exceeds the bounded full-frame verification budget.");
  const first = Number(frames[0]![2]), times = frames.map(f => (Number(f[2])-first)*tb), delays = frames.map(f => Number(f[3])*tb);
  if (times.some(n=>!Number.isFinite(n)) || delays.some(n=>!Number.isFinite(n)||n<=0)) throw new Error("Movie frame timing is incomplete.");
  // RGBA8 hashes must never be misrepresented as verification of HDR or high-depth source samples.
  if (/Video:[^\n]*(?:yuv\w*p(?:9|10|12|14|16)|gbrp(?:9|10|12|14|16)|rgba64|rgb48|bt2020|smpte2084|arib-std-b67)/iu.test(stderr)) throw new Error("High-depth/HDR movie edits need a color-preserving adapter. Original bytes remain supported.");
  return {info:{width,height,durationMs:times.at(-1)!+delays.at(-1)!,frameCount:frames.length,animated:frames.length>1,hasAudio:/Stream #.*Audio:/u.test(stderr),frameTimesMs:times,frameDurationsMs:delays},hashes:frames.map(f=>f[5]!)};
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
    if (geometry(recipe)) throw new Error("Movie geometry editing is not yet verified by this adapter; preserve original geometry or use an explicit image edit.");
    const args = ["-loglevel","error","-protocol_whitelist","file,pipe","-threads","2",...(variableImageTiming ? ["-i","timeline.apng"] : decodedImage ? ["-f","rawvideo","-pixel_format","rgba","-video_size",`${source.info.width}x${source.info.height}`,"-framerate",`1000/${imageDelay}`,"-i","source.rgba"] : ["-i","source"]),"-map",animatedAvif(bytes)?"0:v:1":"0:v:0","-vsync","0","-enc_time_base","-1"];
    if (recipe.noSound || ["webp","avif"].includes(recipe.format)) args.push("-an"); else args.push("-map","0:a?","-c:a","copy");
    const crf = String(Math.round((100-recipe.quality)*0.51));
    if (recipe.format === "webp") args.push("-c:v","libwebp_anim","-lossless",recipe.mode === "lossless" ? "1":"0","-quality",String(recipe.quality),"-loop","0");
    else if (recipe.format === "avif") args.push("-c:v","libaom-av1","-crf",recipe.mode === "lossless" ? "0":crf,"-cpu-used","6","-pix_fmt",recipe.mode === "lossless" ? "gbrp":"yuv444p","-threads","2");
    else if (recipe.format === "webm") args.push("-c:v","libvpx-vp9","-lossless",recipe.mode === "lossless" ? "1":"0","-crf",recipe.mode === "lossless" ? "0":crf,"-b:v","0","-threads","2");
    else args.push("-c:v",recipe.mode === "lossless" ? "libx264rgb":"libx264","-crf",recipe.mode === "lossless" ? "0":crf,"-preset","medium","-threads","2");
    const outputName = `candidate.${recipe.format}`; args.push("-n",outputName);
    await ffmpegRun(runtime.binary,dir,args,signal);
    const info = await stat(path.join(dir,outputName)); if (info.size>MAX_BYTES) throw new RangeError("Candidate exceeds the output byte budget.");
    const output = new Uint8Array(await readFile(path.join(dir,outputName))); bounded(output);
    const candidate = recipe.format === "webp" ? await decodeImage(output) : await decodeMovie(runtime.binary,dir,outputName,signal);
    if (!sameTimeline(source.info,candidate.info) || source.info.width !== candidate.info.width || source.info.height !== candidate.info.height) throw new Error(`Movie ${recipe.format} candidate changed frames, timing or dimensions; original retained.`);
    if (!recipe.noSound && source.info.hasAudio !== candidate.info.hasAudio) throw new Error("Movie candidate changed audio presence; original retained.");
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
async function readFrame(bytes:Uint8Array,timeMs:number, signal?:AbortSignal):Promise<{bytes:Uint8Array;info:KeelMediaInfo;frameTimeMs:number}> {
  signal?.throwIfAborted();
  let image=false;
  try {await (await sharpFactory())(bytes,{animated:true,limitInputPixels:MAX_PIXELS}).metadata(); image=true;} catch { /* Probe movie. */ }
  if(image && !animatedAvif(bytes)) {
    const decoded=await decodeImage(bytes), index=frameAt(decoded.info,timeMs);
    const frame=await (await sharpFactory())(bytes,{page:index,pages:1,limitInputPixels:MAX_PIXELS}).png().timeout({seconds:60}).toBuffer();
    signal?.throwIfAborted(); return {bytes:new Uint8Array(frame),info:decoded.info,frameTimeMs:decoded.info.frameTimesMs[index]!};
  }
  assertSingleFileMedia(bytes);
  const runtime=await resolveBundledFfmpeg(); if(!runtime.available||!runtime.binary) throw new Error(runtime.reason ?? "Movie decoder unavailable.");
  const dir=await mkdtemp(path.join(tmpdir(),"keel-frame-"));
  try {
    await writeFile(path.join(dir,"source"),bytes,{flag:"wx"});
    const decoded=await decodeMovie(runtime.binary,dir,"source",signal), index=frameAt(decoded.info,timeMs);
    await ffmpegRun(runtime.binary,dir,["-loglevel","error","-protocol_whitelist","file,pipe","-threads","2","-i","source","-map",animatedAvif(bytes)?"0:v:1":"0:v:0","-vf",`select=eq(n\\,${index})`,"-vsync","0","-frames:v","1","-threads","2","-n","frame.png"],signal);
    return {bytes:new Uint8Array(await readFile(path.join(dir,"frame.png"))),info:decoded.info,frameTimeMs:decoded.info.frameTimesMs[index]!};
  } finally {await rm(dir,{recursive:true,force:true});}
}
/** Decode both views at one source time. Never compares independently running animations. */
export async function compareMediaFrames(input:{readonly bytes:Uint8Array;readonly mediaType?:string;readonly recipe:unknown;readonly timeMs:number;readonly signal?:AbortSignal}) {
  if(!Number.isFinite(input.timeMs)||input.timeMs<0||input.timeMs>3_600_000) throw new RangeError("Comparison time must be between 0 and 3,600,000 milliseconds.");
  const candidate=await prepareMediaCandidate(input);
  const original=await readFrame(input.bytes,input.timeMs,input.signal);
  if (original.info.animated && input.timeMs>=original.info.durationMs) throw new RangeError("The requested comparison time is outside the source timeline.");
  const processed=candidate.recipe.mode === "original" ? original : await readFrame(candidate.bytes,input.timeMs,input.signal);
  return {originalFrame:original.bytes,processedFrame:processed.bytes,mediaType:"image/png" as const,timeMs:input.timeMs,sourceFrameTimeMs:original.frameTimeMs,candidateFrameTimeMs:processed.frameTimeMs,sourceInfo:original.info,candidateInfo:processed.info,recipe:candidate.recipe,sourceIntegrity:candidate.sourceIntegrity,outputIntegrity:candidate.outputIntegrity,measurements:candidate.measurements,verification:candidate.verification,warnings:candidate.warnings};
}
