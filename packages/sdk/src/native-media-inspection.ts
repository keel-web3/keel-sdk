import { SaxesParser } from "saxes";

export const KEEL_NATIVE_AUDIO_MEDIA_TYPES = Object.freeze(["audio/wav", "audio/mpeg", "audio/ogg", "audio/flac", "audio/aac", "audio/mp4"] as const);
export type KeelNativeAudioMediaType = typeof KEEL_NATIVE_AUDIO_MEDIA_TYPES[number];
export class KeelNativeMediaError extends TypeError {
  constructor(readonly code: "invalid-container" | "unsupported-execution" | "external-dependency" | "unsupported-codec" | "inspection-budget", message: string) { super(message + " Original source bytes were not changed."); this.name = "KeelNativeMediaError"; }
}
function invalid(message: string): never { throw new KeelNativeMediaError("invalid-container", message); }
function unsupported(message: string): never { throw new KeelNativeMediaError("unsupported-codec", message); }
const execution = (): never => { throw new KeelNativeMediaError("unsupported-execution", "Executable or interactive SVG needs a separately qualified SVG document execution profile; the current canonical image viewer does not execute it."); };
const external = (): never => { throw new KeelNativeMediaError("external-dependency", "The native SVG viewer requires self-contained image content; external or unqualified embedded dependencies need a verified project route."); };
const svgNS = "http://www.w3.org/2000/svg";
const SVG_ELEMENTS = new Set("svg g defs desc title metadata symbol use image switch view path rect circle ellipse line polyline polygon text tspan textPath clipPath mask pattern marker linearGradient radialGradient stop filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence style animate animateMotion animateTransform mpath set".split(" "));
function inspectSVGStyle(value: string): void {
  // CSS escapes can conceal dependency tokens. Do not reinterpret/sanitize
  // those originals without a separately qualified CSS dependency parser.
  if (value.includes("\\") || /@(?:import|font-face)|expression\s*\(/iu.test(value)) external();
  for (const match of value.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/giu)) if (!/^#[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(match[1]!)) external();
  if (/(?:https?|javascript|vbscript|file|ftp)\s*:|\/\//iu.test(value)) external();
}
/** Strict XML parsing plus a conservative native-image subset. SMIL/CSS motion
 * remains native. This never strips scripts, changes XML into HTML or rasterizes. */
export function inspectKeelNativeSVG(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) invalid("SVG source is empty.");
  if (bytes.length > 32 * 1024 * 1024) throw new KeelNativeMediaError("inspection-budget", "SVG exceeds this bounded parser's 32 MiB inspection budget; select a supported project/read route.");
  let source: string; try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return invalid("SVG must be complete UTF-8 XML."); }
  const parser = new SaxesParser({ xmlns: true, fragment: false });
  let nodes = 0, depth = 0, root = false, animated = false, styleDepth = 0;
  parser.on("xmldecl", declaration => { if (declaration.encoding && !/^(?:utf-8|us-ascii)$/iu.test(declaration.encoding)) invalid("The native SVG profile requires the declared XML encoding to match its UTF-8 source bytes."); });
  parser.on("doctype", () => { throw new KeelNativeMediaError("unsupported-execution", "SVG DTDs/entities are not part of the native image profile; use a separately qualified project route."); });
  parser.on("processinginstruction", () => external());
  parser.on("opentag", tag => {
    if (++nodes > 65536 || ++depth > 128) throw new KeelNativeMediaError("inspection-budget", "SVG exceeds the bounded element/depth budget.");
    if (!root) { if (tag.local !== "svg" || tag.uri !== svgNS) invalid("The XML root must be an SVG namespace document."); root = true; }
    if (tag.uri !== svgNS || !SVG_ELEMENTS.has(tag.local)) execution();
    if (["animate", "animateMotion", "animateTransform", "set"].includes(tag.local)) animated = true;
    if (tag.local === "style") styleDepth = depth;
    for (const attribute of Object.values(tag.attributes)) {
      const name = attribute.local, value = attribute.value;
      if (attribute.prefix === "xmlns" || attribute.name === "xmlns") { if (value !== svgNS) external(); continue; }
      if (name.toLowerCase().startsWith("on") || attribute.name === "xml:base") execution();
      if (attribute.prefix && attribute.prefix !== "xml") external();
      if (["href", "src"].includes(name)) {
        if (!/^#[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(value)) external();
      }
      if (name === "attributeName" && /href|src|on[a-z]|:|style/iu.test(value)) execution();
      inspectSVGStyle(value);
      if (name === "style" && /(?:animation|transition)\s*:/iu.test(value)) animated = true;
    }
  });
  parser.on("text", value => { if (styleDepth) { inspectSVGStyle(value); if (/@keyframes|(?:animation|transition)\s*:/iu.test(value)) animated = true; } });
  parser.on("cdata", value => { if (styleDepth) { inspectSVGStyle(value); if (/@keyframes|(?:animation|transition)\s*:/iu.test(value)) animated = true; } });
  parser.on("closetag", () => { if (styleDepth === depth) styleDepth = 0; depth--; });
  try { parser.write(source).close(); } catch (error) { if (error instanceof KeelNativeMediaError) throw error; return invalid("SVG is not a complete well-formed XML document."); }
  if (!root || depth) invalid("SVG document is incomplete.");
  return Object.freeze({ kind: "svg" as const, mediaType: "image/svg+xml" as const, execution: "static" as const, motion: animated ? "animated" as const : "still" as const, byteLength: bytes.length, rendering: "native-image" as const, browserDecode: "required" as const });
}

const text = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
function data(b: Uint8Array) { if (!(b instanceof Uint8Array) || !b.length) invalid("Audio source is empty."); return new DataView(b.buffer, b.byteOffset, b.byteLength); }
function inspectWAV(b: Uint8Array, v: DataView) {
  if (b.length < 44 || text(b, 0, 4) !== "RIFF" || text(b, 8, 4) !== "WAVE" || v.getUint32(4, true) !== b.length - 8) invalid("WAV has an incomplete RIFF/WAVE boundary.");
  let at = 12, chunks = 0, fmt: { channels: number; rate: number; align: number; bits: number; codec: number } | undefined, size = 0;
  while (at < b.length) {
    if (++chunks > 65536 || at + 8 > b.length) invalid("WAV chunk inventory is invalid.");
    const n = v.getUint32(at + 4, true), end = at + 8 + n + n % 2;
    if (end > b.length) invalid("WAV chunk is truncated.");
    const name = text(b, at, 4);
    if (name === "fmt ") {
      if (fmt || n < 16) invalid("WAV needs one complete format chunk.");
      const codec = v.getUint16(at + 8, true), channels = v.getUint16(at + 10, true), rate = v.getUint32(at + 12, true), bytesPerSecond = v.getUint32(at + 16, true), align = v.getUint16(at + 20, true), bits = v.getUint16(at + 22, true);
      if (![1, 3].includes(codec)) unsupported("This WAV codec needs a separately qualified decoder.");
      if (!channels || channels > 32 || rate < 1000 || rate > 768000 || !(codec === 1 ? [8, 16, 24, 32] : [32, 64]).includes(bits) || align !== channels * bits / 8 || bytesPerSecond !== rate * align) invalid("WAV format fields do not describe complete PCM samples.");
      fmt = { codec, channels, rate, align, bits };
    }
    if (name === "data") { if (!fmt || !n || n % fmt.align) invalid("WAV data is empty, misaligned or precedes its format."); size += n; }
    at = end;
  }
  if (!fmt || !size) invalid("WAV needs actual complete sample data.");
  return { codec: fmt.codec === 1 ? "pcm" : "ieee-float", channels: fmt.channels, sampleRate: fmt.rate, duration: size / fmt.align / fmt.rate };
}
function id3End(b: Uint8Array) {
  if (text(b, 0, 3) !== "ID3") return 0;
  if (b.length < 10 || ![2, 3, 4].includes(b[3]!) || b[4] === 255 || [...b.subarray(6, 10)].some(n => n > 127)) invalid("MP3 has an invalid ID3 boundary.");
  const end = 10 + b.subarray(6, 10).reduce((n, byte) => n * 128 + byte, 0) + (b[3] === 4 && (b[5]! & 16) ? 10 : 0);
  if (end >= b.length) invalid("MP3 has no audio frames after ID3 metadata."); return end;
}
function inspectMP3(b: Uint8Array) {
  let at = id3End(b), count = 0, sampleRate = 0, samples = 0, channels = 0;
  const high = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], low = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  while (at < b.length) {
    if (b.length - at === 128 && text(b, at, 3) === "TAG") { at += 128; break; }
    if (++count > 1000000 || at + 4 > b.length || b[at] !== 255 || (b[at + 1]! & 224) !== 224) invalid("MP3 audio frame is incomplete.");
    const version = b[at + 1]! >> 3 & 3, layer = b[at + 1]! >> 1 & 3, bitrateIndex = b[at + 2]! >> 4, rateIndex = b[at + 2]! >> 2 & 3;
    if (version === 1 || layer !== 1 || !bitrateIndex || bitrateIndex === 15 || rateIndex === 3) unsupported("MP3 needs complete supported MPEG Layer III frames.");
    const rate = [44100, 48000, 32000][rateIndex]! / (version === 3 ? 1 : version === 2 ? 2 : 4), bitrate = (version === 3 ? high : low)[bitrateIndex]! * 1000, length = Math.floor((version === 3 ? 144 : 72) * bitrate / rate) + (b[at + 2]! >> 1 & 1);
    if (length < 4 || at + length > b.length || sampleRate && sampleRate !== rate) invalid("MP3 frame length/rate changed or is truncated.");
    sampleRate = rate; channels = b[at + 3]! >> 6 === 3 ? 1 : 2; samples += version === 3 ? 1152 : 576; at += length;
  }
  if (!count || !sampleRate) invalid("MP3 contains no complete audio frame.");
  return { codec: "mp3", sampleRate, channels, duration: samples / sampleRate };
}
function inspectAAC(b: Uint8Array) {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]; let at = 0, frames = 0, sampleRate = 0, channels = 0, samples = 0;
  while (at < b.length) {
    if (++frames > 1000000 || at + 7 > b.length || b[at] !== 255 || (b[at + 1]! & 246) !== 240) invalid("AAC ADTS frame header is invalid.");
    const rate = rates[b[at + 2]! >> 2 & 15], channel = (b[at + 2]! & 1) << 2 | b[at + 3]! >> 6, header = b[at + 1]! & 1 ? 7 : 9, n = (b[at + 3]! & 3) << 11 | b[at + 4]! << 3 | b[at + 5]! >> 5;
    if (!rate || !channel || channel > 7) unsupported("AAC needs a supported explicit sample rate and channel layout.");
    if (n <= header || at + n > b.length || sampleRate && sampleRate !== rate || channels && channels !== channel) invalid("AAC ADTS frame length or format is inconsistent.");
    sampleRate = rate; channels = channel; samples += 1024 * ((b[at + 6]! & 3) + 1); at += n;
  }
  return { codec: "aac-adts", sampleRate, channels, duration: samples / sampleRate };
}
function crc(b: Uint8Array, polynomial: number, width: 16 | 32, zero?: [number, number]) {
  let value = 0; for (let at = 0; at < b.length; at++) { value ^= ((zero && at >= zero[0] && at < zero[1]) ? 0 : b[at]!) << (width - 8); for (let i = 0; i < 8; i++) value = value & (width === 32 ? 0x80000000 : 0x8000) ? value << 1 ^ polynomial : value << 1; if (width === 16) value &= 65535; } return value >>> 0;
}
function inspectOgg(b: Uint8Array, v: DataView) {
  let at = 0, pages = 0, serial: number | undefined, ended = false, packet: number[] = [], codec = "", channels = 0, sampleRate = 0, preSkip = 0, granule = 0n, packets = 0;
  while (at < b.length) {
    if (++pages > 1000000 || at + 27 > b.length || text(b, at, 4) !== "OggS" || b[at + 4] !== 0 || ended) invalid("Ogg page boundary is invalid.");
    const flags = b[at + 5]!;
    if (flags & ~7 || Boolean(flags & 1) !== (packet.length > 0) || pages > 1 && flags & 2) invalid("Ogg page flags do not match its packet boundaries.");
    const segments = b[at + 26]!, header = at + 27 + segments; if (header > b.length) invalid("Ogg lacing table is truncated.");
    const length = b.subarray(at + 27, header).reduce((n, x) => n + x, 0), end = header + length; if (end > b.length) invalid("Ogg payload is truncated.");
    const currentSerial = v.getUint32(at + 14, true); if (serial === undefined) serial = currentSerial;
    if (serial !== currentSerial || v.getUint32(at + 18, true) !== pages - 1 || (pages === 1 && !(b[at + 5]! & 2)) || crc(b.subarray(at, end), 0x04c11db7, 32, [22, 26]) !== v.getUint32(at + 22, true)) invalid("Ogg stream order or page checksum is invalid.");
    let pos = header;
    for (const size of b.subarray(at + 27, header)) {
      packet.push(...b.subarray(pos, pos + size)); pos += size;
      if (packet.length > 16 * 1024 * 1024) throw new KeelNativeMediaError("inspection-budget", "Ogg packet exceeds the bounded audio inspection budget.");
      if (size < 255) {
        const p = Uint8Array.from(packet); packets++;
        if (!codec) {
          if (text(p, 0, 8) === "OpusHead" && p.length === 19 && p[8] === 1 && p[9] && p[9]! <= 2 && p[18] === 0) { codec = "opus"; channels = p[9]!; sampleRate = 48000; preSkip = p[10]! | p[11]! << 8; }
          else if (p[0] === 1 && text(p, 1, 6) === "vorbis" && p.length === 30 && p[11] && p[29]! & 1 && new DataView(p.buffer).getUint32(7, true) === 0) { codec = "vorbis"; channels = p[11]!; sampleRate = new DataView(p.buffer).getUint32(12, true); }
          else unsupported("Ogg requires a qualified Opus or Vorbis audio stream; mixed/video chains are not inferred as audio.");
        } else if (codec === "opus" && packets === 2 && (text(p, 0, 8) !== "OpusTags" || p.length < 16)) invalid("Opus needs its complete comments header before audio packets.");
        else if (codec === "vorbis" && packets <= 3 && (p[0] !== (packets === 2 ? 3 : 5) || text(p, 1, 6) !== "vorbis" || p.length <= 7)) invalid("Vorbis headers are incomplete.");
        packet = [];
      }
    }
    granule = v.getBigUint64(at + 6, true); ended = (b[at + 5]! & 4) !== 0; at = end;
  }
  if (!ended || packet.length || !codec || packets < (codec === "opus" ? 3 : 4) || !sampleRate || granule === 0xffffffffffffffffn || granule <= BigInt(preSkip)) invalid("Ogg needs a complete nonempty audio stream and end page.");
  return { codec, channels, sampleRate, duration: Number(granule - BigInt(preSkip)) / sampleRate };
}
function inspectFLAC(b: Uint8Array, v: DataView) {
  if (b.length < 48 || text(b, 0, 4) !== "fLaC") invalid("FLAC stream is truncated."); let at = 4, count = 0, ended = false, info = 0n;
  while (!ended) {
    if (++count > 65536 || at + 4 > b.length) invalid("FLAC metadata is truncated."); const kind = b[at]! & 127, n = b[at + 1]! << 16 | b[at + 2]! << 8 | b[at + 3]!; ended = !!(b[at]! & 128);
    if (at + 4 + n > b.length || count === 1 && (kind !== 0 || n !== 34) || count > 1 && kind === 0) invalid("FLAC needs one exact initial STREAMINFO.");
    if (count === 1) info = v.getBigUint64(at + 14); at += 4 + n;
  }
  const sampleRate = Number(info >> 44n), channels = Number(info >> 41n & 7n) + 1, bits = Number(info >> 36n & 31n) + 1, samples = info & 0xfffffffffn;
  if (!sampleRate || bits < 4 || !samples || at + 6 > b.length || b[at] !== 255 || (b[at + 1]! & 254) !== 248 || crc(b.subarray(at), 0x8005, 16) !== 0) invalid("FLAC needs complete nonempty checked audio frames.");
  return { codec: "flac", sampleRate, channels, duration: Number(samples) / sampleRate };
}
interface Box { kind: string; at: number; body: number; end: number }
function boxes(b: Uint8Array, v: DataView, start = 0, end = b.length) {
  const result: Box[] = []; let at = start;
  while (at < end) { if (result.length > 65536 || at + 8 > end) invalid("MP4 box header is truncated."); let n = v.getUint32(at), header = 8;
    if (n === 1) { if (at + 16 > end) invalid("MP4 extended box is truncated."); const size = v.getBigUint64(at + 8); if (size > BigInt(Number.MAX_SAFE_INTEGER)) invalid("MP4 box length is unsafe."); n = Number(size); header = 16; }
    if (!n) n = end - at; if (n < header || at + n > end) invalid("MP4 box boundary is invalid."); result.push({ kind: text(b, at + 4, 4), at, body: at + header, end: at + n }); at += n;
  } return result;
}
function inspectMP4(b: Uint8Array, v: DataView) {
  const top = boxes(b, v), ftyp = top.find(x => x.kind === "ftyp"), moov = top.find(x => x.kind === "moov"), mdat = top.filter(x => x.kind === "mdat");
  if (!ftyp || ftyp.at !== 0 || ftyp.end - ftyp.body < 8 || !moov || !mdat.some(x => x.end > x.body)) invalid("M4A needs a complete file type, movie and actual media payload.");
  if (top.some(x => x.kind === "moof")) unsupported("Fragmented MP4 audio needs a separately qualified complete-file decoder route.");
  const tracks = boxes(b, v, moov.body, moov.end).filter(x => x.kind === "trak"); let audio = 0;
  for (const track of tracks) {
    const mdia = boxes(b, v, track.body, track.end).find(x => x.kind === "mdia"); if (!mdia) invalid("M4A track has no media header.");
    const children = boxes(b, v, mdia.body, mdia.end), hdlr = children.find(x => x.kind === "hdlr");
    if (!hdlr || hdlr.end - hdlr.body < 12 || text(b, hdlr.body + 8, 4) !== "soun") unsupported("Declared audio/mp4 contains a non-audio track; use its actual supported media route.");
    const minf = children.find(x => x.kind === "minf"); if (!minf) invalid("M4A audio track has no media information.");
    const stbl = boxes(b, v, minf.body, minf.end).find(x => x.kind === "stbl"); if (!stbl) invalid("M4A has no sample table.");
    const tables = boxes(b, v, stbl.body, stbl.end), stsd = tables.find(x => x.kind === "stsd"), stsz = tables.find(x => x.kind === "stsz"), offsets = tables.find(x => ["stco", "co64"].includes(x.kind));
    if (!stsd || stsd.end - stsd.body < 8 || v.getUint32(stsd.body + 4) !== 1 || !stsz || stsz.end - stsz.body < 12 || !offsets || offsets.end - offsets.body < 8) invalid("M4A sample records are incomplete.");
    const entries = boxes(b, v, stsd.body + 8, stsd.end); if (entries.length !== 1 || entries[0]!.kind !== "mp4a") unsupported("M4A needs a qualified AAC audio sample entry.");
    const sampleSize = v.getUint32(stsz.body + 4), samples = v.getUint32(stsz.body + 8); if (!samples || (!sampleSize && stsz.end - stsz.body !== 12 + samples * 4)) invalid("M4A samples are empty or truncated.");
    if (samples > 1000000) throw new KeelNativeMediaError("inspection-budget", "M4A sample inventory exceeds its inspection budget.");
    const sampleSizes = Array.from({length: samples}, (_, index) => sampleSize || v.getUint32(stsz.body + 12 + index * 4));
    if (sampleSizes.some(size => !size)) invalid("M4A sample inventory is empty or exceeds its inspection budget.");
    const stsc = tables.find(x => x.kind === "stsc");
    if (!stsc || stsc.end - stsc.body < 8) invalid("M4A has no complete sample-to-chunk map.");
    const mapCount = v.getUint32(stsc.body + 4);
    if (!mapCount || stsc.end - stsc.body !== 8 + mapCount * 12) invalid("M4A chunk mapping is truncated.");
    const map = Array.from({length: mapCount}, (_, index) => ({first: v.getUint32(stsc.body + 8 + index * 12), samples: v.getUint32(stsc.body + 12 + index * 12), description: v.getUint32(stsc.body + 16 + index * 12)}));
    if (map[0]!.first !== 1 || map.some((row, index) => !row.samples || row.description !== 1 || index > 0 && row.first <= map[index - 1]!.first)) invalid("M4A chunk mapping is inconsistent.");
    const count = v.getUint32(offsets.body + 4), width = offsets.kind === "co64" ? 8 : 4;
    if (!count || offsets.end - offsets.body !== 8 + count * width) invalid("M4A chunk offsets are incomplete.");
    let sampleIndex = 0, mapIndex = 0;
    for (let i = 0; i < count; i++) {
      if (map[mapIndex + 1] && i + 1 >= map[mapIndex + 1]!.first) mapIndex++;
      const number = map[mapIndex]!.samples;
      if (sampleIndex + number > samples) invalid("M4A chunk map exceeds its exact sample inventory.");
      const length = sampleSizes.slice(sampleIndex, sampleIndex + number).reduce((n, size) => n + size, 0); sampleIndex += number;
      const at = offsets.body + 8 + i * width, offset = width === 8 ? v.getBigUint64(at) : BigInt(v.getUint32(at));
      if (!mdat.some(x => offset >= BigInt(x.body) && offset + BigInt(length) <= BigInt(x.end))) invalid("M4A sample range leaves its actual media bytes.");
    }
    if (sampleIndex !== samples || map.at(-1)!.first > count) invalid("M4A chunk map does not cover its complete samples.");
    audio++;
  }
  if (audio !== 1) unsupported("The native audio profile needs one complete audio track."); return { codec: "aac-mp4" };
}
/** Container inspection is not audio decode, playback, registration or publication
 * proof. The real browser must decode the same committed source before approval. */
export function inspectKeelNativeAudio(input: { readonly mediaType: string; readonly source: Uint8Array }) {
  const b = input.source, v = data(b), mime = input.mediaType.split(";", 1)[0]!.trim().toLowerCase();
  const inspected = mime === "audio/wav" ? inspectWAV(b, v) : mime === "audio/mpeg" ? inspectMP3(b) : mime === "audio/ogg" ? inspectOgg(b, v) : mime === "audio/flac" ? inspectFLAC(b, v) : mime === "audio/aac" ? inspectAAC(b) : mime === "audio/mp4" ? inspectMP4(b, v) : unsupported("This audio MIME has no current native adapter.");
  return Object.freeze({ kind: "audio" as const, mediaType: mime as KeelNativeAudioMediaType, execution: "static" as const, motion: "unknown" as const, byteLength: b.length, ...inspected, browserDecode: "required" as const });
}
export function inspectKeelNativeMedia(input: { readonly mediaType: string; readonly source: Uint8Array }) {
  return input.mediaType.split(";", 1)[0]!.trim().toLowerCase() === "image/svg+xml" ? inspectKeelNativeSVG(input.source) : inspectKeelNativeAudio(input);
}
