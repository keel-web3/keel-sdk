import { inspectKeelNativeAudio, KEEL_NATIVE_AUDIO_MEDIA_TYPES } from "./native-media-inspection.js";
import { inspectKeelModelMedia } from "./model-media.js";

// Private admission checks for the existing rev5 identity decoder. Container
// inventory is not browser codec/playback proof and never rewrites source bytes.
const invalid = (): never => { throw new TypeError("Native None requires a complete supported original media container and role."); };
const text = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
interface Box { readonly kind: string; readonly at: number; readonly body: number; readonly end: number }
const ISO_VIDEO_MEDIA_TYPES = ["video/mp4", "video/x-m4v"] as const;
function inspectVideoISO(bytes: Uint8Array, mediaType: string): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let boxCount = 0;
  const boxes = (start = 0, end = bytes.length): Box[] => {
    const result: Box[] = [];
    for (let at = start; at < end;) {
      if (++boxCount > 65_536 || at + 8 > end) invalid();
      let length = view.getUint32(at), header = 8;
      if (length === 1) {
        if (at + 16 > end) invalid();
        const n = view.getBigUint64(at + 8); if (n > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
        length = Number(n); header = 16;
      } else if (length === 0) length = end - at;
      if (length < header || length > end - at) invalid();
      result.push({kind: text(bytes, at + 4, 4), at, body: at + header, end: at + length}); at += length;
    }
    return result;
  };
  const one = (rows: readonly Box[], kind: string): Box => {
    const found = rows.filter(row => row.kind === kind); if (found.length !== 1) invalid(); return found[0]!;
  };
  const top = boxes(), ftyp = one(top, "ftyp"), moov = one(top, "moov"), mdat = top.filter(row => row.kind === "mdat" && row.end > row.body);
  if (ftyp.at !== 0 || ftyp.end - ftyp.body < 8 || (ftyp.end - ftyp.body) % 4 || !mdat.length || top.some(row => row.kind === "moof")) invalid();
  // Preserve the actual native MIME, not an MP4 relabel. New aliases require
  // their known complete ISO container; brands never replace track validation.
  const majorBrand = text(bytes, ftyp.body, 4);
  if (mediaType === "video/x-m4v" && !["M4V ", "M4VH", "M4VP", "isom", "iso2", "mp41", "mp42", "avc1"].includes(majorBrand)) invalid();
  // An AVIF/image container cannot masquerade as a video through its MIME.
  for (let at = ftyp.body; at < ftyp.end; at += 4) if (at !== ftyp.body + 4 && ["avif", "avis", "heic", "heix", "mif1"].includes(text(bytes, at, 4))) invalid();
  const tracks = boxes(moov.body, moov.end).filter(row => row.kind === "trak");
  if (!tracks.length || tracks.length > 128) invalid();
  let videoTracks = 0;
  for (const track of tracks) {
    const mdia = one(boxes(track.body, track.end), "mdia"), children = boxes(mdia.body, mdia.end), handler = one(children, "hdlr");
    if (handler.end - handler.body < 12) invalid();
    const isVideo = text(bytes, handler.body + 8, 4) === "vide";
    const minf = one(children, "minf"), stbl = one(boxes(minf.body, minf.end), "stbl"), tables = boxes(stbl.body, stbl.end);
    const stsd = one(tables, "stsd"), stsz = one(tables, "stsz"), stsc = one(tables, "stsc"), stts = one(tables, "stts");
    const offsets = tables.filter(row => row.kind === "stco" || row.kind === "co64");
    if (offsets.length !== 1 || stsd.end - stsd.body < 8 || stsz.end - stsz.body < 12 || stsc.end - stsc.body < 8 || stts.end - stts.body < 8) invalid();
    const entries = boxes(stsd.body + 8, stsd.end);
    if (!entries.length || view.getUint32(stsd.body + 4) !== entries.length) invalid();
    if (isVideo) {
      // Complete ISO VisualSampleEntry, including nonzero source geometry.
      if (entries.some(entry => entry.end - entry.body < 78 || !view.getUint16(entry.body + 24) || !view.getUint16(entry.body + 26))) invalid();
      videoTracks++;
    }
    const sampleSize = view.getUint32(stsz.body + 4), count = view.getUint32(stsz.body + 8);
    if (!count || count > 1_000_000 || stsz.end - stsz.body !== (sampleSize ? 12 : 12 + count * 4)) invalid();
    const sizes = sampleSize ? undefined : Array.from({length: count}, (_, index) => view.getUint32(stsz.body + 12 + index * 4));
    if (sizes?.some(size => size === 0)) invalid();
    const timingCount = view.getUint32(stts.body + 4);
    if (!timingCount || timingCount > count || stts.end - stts.body !== 8 + timingCount * 8) invalid();
    let timedSamples = 0;
    for (let i = 0; i < timingCount; i++) {
      const n = view.getUint32(stts.body + 8 + i * 8), delta = view.getUint32(stts.body + 12 + i * 8);
      if (!n || !delta) invalid(); timedSamples += n;
    }
    if (timedSamples !== count) invalid();
    const mapCount = view.getUint32(stsc.body + 4);
    if (!mapCount || mapCount > count || stsc.end - stsc.body !== 8 + mapCount * 12) invalid();
    const map = Array.from({length: mapCount}, (_, index) => ({first: view.getUint32(stsc.body + 8 + index * 12), samples: view.getUint32(stsc.body + 12 + index * 12), description: view.getUint32(stsc.body + 16 + index * 12)}));
    if (map[0]!.first !== 1 || map.some((row, index) => !row.samples || !row.description || row.description > entries.length || index > 0 && row.first <= map[index - 1]!.first)) invalid();
    const table = offsets[0]!, width = table.kind === "co64" ? 8 : 4;
    if (table.end - table.body < 8) invalid();
    const chunks = view.getUint32(table.body + 4);
    if (!chunks || chunks > count || table.end - table.body !== 8 + chunks * width || map.at(-1)!.first > chunks) invalid();
    let sample = 0, mapping = 0;
    for (let chunk = 0; chunk < chunks; chunk++) {
      if (map[mapping + 1] && chunk + 1 >= map[mapping + 1]!.first) mapping++;
      const n = map[mapping]!.samples; if (n > count - sample) invalid();
      let length = 0; for (let i = 0; i < n; i++) length += sampleSize || sizes![sample + i]!;
      sample += n;
      const at = table.body + 8 + chunk * width, offset = width === 8 ? view.getBigUint64(at) : BigInt(view.getUint32(at));
      if (!mdat.some(row => offset >= BigInt(row.body) && offset + BigInt(length) <= BigInt(row.end))) invalid();
    }
    if (sample !== count) invalid();
  }
  if (!videoTracks) invalid();
}

function inspectVideoWebM(bytes: Uint8Array): void {
  let elements = 0;
  const vint = (at: number, end: number, id = false) => {
    if (at >= end || !bytes[at]) return invalid();
    let width = 1, mask = 128; while (!(bytes[at]! & mask)) { width++; mask >>= 1; }
    if (width > (id ? 4 : 8) || at + width > end) return invalid();
    let value = BigInt(id ? bytes[at]! : bytes[at]! & (mask - 1));
    for (let i = 1; i < width; i++) value = value * 256n + BigInt(bytes[at + i]!);
    return {width, value, unknown: !id && value === (1n << BigInt(width * 7)) - 1n};
  };
  const rows = (start: number, end: number, allowUnknownSegment = false) => {
    const result: {id: number; body: number; end: number}[] = [];
    for (let at = start; at < end;) {
      if (++elements > 65_536) invalid();
      const id = vint(at, end, true), size = vint(at + id.width, end), body = at + id.width + size.width;
      if (size.unknown && !(allowUnknownSegment && id.value === 0x18538067n) || !size.unknown && size.value > BigInt(end - body)) invalid();
      const next = size.unknown ? end : body + Number(size.value);
      result.push({id: Number(id.value), body, end: next}); at = next;
    }
    return result;
  };
  const unsigned = (row: {body: number; end: number}) => {
    if (row.end <= row.body || row.end - row.body > 8) return invalid();
    let n = 0n; for (let at = row.body; at < row.end; at++) n = n * 256n + BigInt(bytes[at]!);
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) return invalid(); return Number(n);
  };
  const top = rows(0, bytes.length, true);
  if (top.length !== 2 || top[0]!.id !== 0x1a45dfa3 || top[1]!.id !== 0x18538067) invalid();
  const header = rows(top[0]!.body, top[0]!.end), docType = header.filter(row => row.id === 0x4282);
  if (docType.length !== 1 || text(bytes, docType[0]!.body, docType[0]!.end - docType[0]!.body) !== "webm") invalid();
  const segment = rows(top[1]!.body, top[1]!.end), tracks = segment.filter(row => row.id === 0x1654ae6b), clusters = segment.filter(row => row.id === 0x1f43b675);
  if (tracks.length !== 1 || !clusters.length) invalid();
  const numbers = new Set<number>(), videos = new Set<number>(), blocks = new Set<number>();
  for (const track of rows(tracks[0]!.body, tracks[0]!.end).filter(row => row.id === 0xae)) {
    const fields = rows(track.body, track.end), number = fields.filter(row => row.id === 0xd7), type = fields.filter(row => row.id === 0x83), codec = fields.filter(row => row.id === 0x86);
    if (number.length !== 1 || type.length !== 1 || codec.length !== 1) invalid();
    const n = unsigned(number[0]!); if (!n || numbers.has(n)) invalid(); numbers.add(n);
    if (unsigned(type[0]!) === 1) {
      if (!["V_VP8", "V_VP9", "V_AV1"].includes(text(bytes, codec[0]!.body, codec[0]!.end - codec[0]!.body))) invalid();
      const geometry = fields.filter(row => row.id === 0xe0); if (geometry.length !== 1) invalid();
      const dimensions = rows(geometry[0]!.body, geometry[0]!.end);
      for (const id of [0xb0, 0xba]) { const dimension = dimensions.filter(row => row.id === id); if (dimension.length !== 1 || !unsigned(dimension[0]!)) invalid(); }
      videos.add(n);
    }
  }
  for (const cluster of clusters) for (const row of rows(cluster.body, cluster.end)) {
    const payloads = row.id === 0xa3 ? [row] : row.id === 0xa0 ? rows(row.body, row.end).filter(child => child.id === 0xa1) : [];
    for (const payload of payloads) {
      const track = vint(payload.body, payload.end);
      if (track.unknown || payload.end - payload.body <= track.width + 3 || !numbers.has(Number(track.value))) invalid(); blocks.add(Number(track.value));
    }
  }
  if (!videos.size || [...videos].some(n => !blocks.has(n))) invalid();
}

export function assertRegisteredNativeNoneIdentity(input: {readonly role: unknown; readonly mediaType: string}): void {
  if (typeof input.role !== "string" || !["entrypoint", "asset", "data"].includes(input.role)) invalid();
  if ((ISO_VIDEO_MEDIA_TYPES as readonly string[]).includes(input.mediaType) || input.mediaType === "video/webm") return;
  if (input.role !== "entrypoint" && ((KEEL_NATIVE_AUDIO_MEDIA_TYPES as readonly string[]).includes(input.mediaType)
    || ["model/gltf-binary", "application/octet-stream"].includes(input.mediaType))) return;
  return invalid();
}

export function assertRegisteredNativeNoneBinary(input: {readonly id: string; readonly role: unknown; readonly mediaType: string; readonly source: Uint8Array}): "model" | void {
  assertRegisteredNativeNoneIdentity(input);
  if (!input.source.length || input.source.length > 32 * 1024 * 1024) invalid();
  if ((ISO_VIDEO_MEDIA_TYPES as readonly string[]).includes(input.mediaType)) return inspectVideoISO(input.source, input.mediaType);
  if (input.mediaType === "video/webm") return inspectVideoWebM(input.source);
  if ((KEEL_NATIVE_AUDIO_MEDIA_TYPES as readonly string[]).includes(input.mediaType)) {
    // Rev5 audio uses the canonical derived HTML entry and verified audio asset,
    // not an unsupported direct audio entrypoint.
    if (input.role === "entrypoint") invalid();
    inspectKeelNativeAudio({mediaType: input.mediaType, source: input.source}); return;
  }
  if (input.mediaType === "model/gltf-binary" || input.mediaType === "application/octet-stream") {
    // Defer until every source has passed its original/stored commitment. An
    // octet-stream label is not permission: only actual referenced model assets
    // can pass the complete model inventory below.
    if (input.role === "entrypoint") invalid();
    return "model";
  }
  return invalid();
}

export interface RegisteredNativeDecodedResource {
  readonly id: string; readonly role: unknown; readonly mediaType: string;
  readonly aliases: unknown; readonly source: Uint8Array;
}
export function assertRegisteredNativeNoneModelGraph(resources: readonly RegisteredNativeDecodedResource[], requiredIds: readonly string[]): void {
  if (!requiredIds.length) return;
  if (resources.length > 128 || resources.reduce((n, resource) => n + resource.source.length, 0) > 32 * 1024 * 1024) invalid();
  const models = resources.filter(resource => ["model/gltf-binary", "model/gltf+json"].includes(resource.mediaType));
  if (models.length !== 1 || typeof models[0]!.role !== "string" || !["asset", "data"].includes(models[0]!.role as string)) invalid();
  const asModelResource = (resource: RegisteredNativeDecodedResource) => {
    if (!Array.isArray(resource.aliases) || resource.aliases.length > 128 || resource.aliases.some(alias => typeof alias !== "string" || alias.length > 300)) invalid();
    return {id: resource.id, mediaType: resource.mediaType, source: resource.source, aliases: resource.aliases as string[]};
  };
  const model = models[0]!, assets = resources.filter(resource => resource.id !== model.id && typeof resource.role === "string" && ["asset", "data"].includes(resource.role));
  const inspected = inspectKeelModelMedia(asModelResource(model), assets.map(asModelResource));
  const used = new Set([model.id, ...inspected.dependencyIds]);
  if (requiredIds.some(id => !used.has(id))) invalid();
}
