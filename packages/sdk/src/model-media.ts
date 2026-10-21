/** Original model/dependency admission, distinct from category or preview. No network. */
export const KEEL_MODEL_MEDIA_TYPES = Object.freeze(["model/gltf-binary", "model/gltf+json", "model/obj"] as const);
export type KeelModelMediaType = typeof KEEL_MODEL_MEDIA_TYPES[number];
export interface KeelModelResource {
  readonly id: string;
  readonly mediaType: string;
  readonly source: Uint8Array;
  readonly aliases?: readonly string[];
}
export const KEEL_GLTF_SUPPORTED_EXTENSIONS = Object.freeze([
  "KHR_materials_unlit", "KHR_texture_transform", "KHR_mesh_quantization", "KHR_lights_punctual",
  "KHR_materials_clearcoat", "KHR_materials_dispersion", "KHR_materials_sheen", "KHR_materials_transmission",
  "KHR_materials_volume", "KHR_materials_ior", "KHR_materials_emissive_strength", "KHR_materials_specular",
  "KHR_materials_iridescence", "KHR_materials_anisotropy", "EXT_mesh_gpu_instancing",
]);

/** Decode a relative URI once and refuse network, authority, query and root escape. */
export function resolveKeelModelResourcePath(base: string, uri: string): string {
  if (!uri || /[\\?#\u0000-\u001f]/u.test(uri) || /^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(uri)) throw new TypeError("Model dependencies require exact relative verified paths.");
  let decoded: string; try { decoded = decodeURIComponent(uri); } catch { throw new TypeError("Malformed model dependency URI."); }
  if (/[\\?#%\u0000-\u001f]/u.test(decoded) || /^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(decoded)) throw new TypeError("Ambiguous model dependency URI.");
  const parts = base.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") { if (!parts.length) throw new TypeError("Model dependency escapes its verified resource root."); parts.pop(); }
    else parts.push(part);
  }
  if (!parts.length) throw new TypeError("Empty model dependency path.");
  return parts.join("/");
}

export function decodeKeelModelDataURI(uri: string): Uint8Array {
  const match = /^data:(?:application\/octet-stream|application\/gltf-buffer|image\/(?:png|jpeg|webp|avif));base64,([A-Za-z0-9+/]*={0,2})$/u.exec(uri);
  if (!match || !match[1] || match[1].length % 4 !== 0) throw new TypeError("Model embedded dependencies require a canonical supported Base64 data URI.");
  const raw = atob(match[1]);
  if (btoa(raw) !== match[1]) throw new TypeError("Noncanonical model data URI.");
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

/** Parse the exact GLB JSON/binary boundary, never a four-byte magic placeholder. */
export function parseKeelModelGLTF(source: Uint8Array, mediaType: KeelModelMediaType): {json: Record<string, any>; binary?: Uint8Array} {
  const decoder = new TextDecoder("utf-8", {fatal: true});
  if (mediaType === "model/gltf+json") return {json: JSON.parse(decoder.decode(source))};
  if (source.length < 20) throw new TypeError("Malformed GLB header or length.");
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== source.length) throw new TypeError("Malformed GLB header or length.");
  let at = 12, json: Record<string, any> | undefined, binary: Uint8Array | undefined;
  while (at < source.length) {
    if (at + 8 > source.length) throw new TypeError("Truncated GLB chunk.");
    const size = view.getUint32(at, true), kind = view.getUint32(at + 4, true), end = at + 8 + size;
    if (size % 4 || end > source.length) throw new TypeError("Malformed GLB chunk boundary.");
    if (kind === 0x4e4f534a) { if (at !== 12 || json) throw new TypeError("GLB requires one first JSON chunk."); json = JSON.parse(decoder.decode(source.subarray(at + 8, end))); }
    else if (kind === 0x004e4942) { if (!json || binary) throw new TypeError("GLB has an ambiguous binary chunk."); binary = source.subarray(at + 8, end); }
    else throw new TypeError("Unsupported GLB chunk cannot be silently discarded.");
    at = end;
  }
  if (!json) throw new TypeError("GLB JSON is missing.");
  return binary === undefined ? {json} : {json, binary};
}

/** Exact upstream MTL option arities; keep texture filenames, never a first-match alias. */
export function keelModelMTLTexturePath(value: string): string {
  const items = value.trim().split(/\s+/u), arities: Record<string, number> = {"-bm": 1, "-mm": 2, "-s": 3, "-o": 3};
  for (let at = 0; at < items.length;) {
    const token = items[at]!;
    if (token.startsWith("-")) {
      const count = arities[token];
      if (count === undefined || at + count >= items.length || !items.slice(at + 1, at + count + 1).every(item => Number.isFinite(Number(item)))) throw new TypeError("Unsupported or malformed MTL texture option.");
      items.splice(at, count + 1);
    } else at++;
  }
  return items.join(" ");
}

/** Core glTF/OBJ texture support must not silently flatten animated images. */
export function assertKeelModelTexture(bytes: Uint8Array, mediaType: string): void {
  if (mediaType === "image/jpeg") {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new TypeError("Model JPEG texture bytes do not match their MIME.");
    return;
  }
  if (mediaType !== "image/png" || bytes.length < 33 || bytes[0] !== 137 || String.fromCharCode(...bytes.subarray(1, 8)) !== "PNG\r\n\x1a\n") throw new TypeError("This exact model adapter supports static PNG/JPEG textures; other texture codecs/motion require a qualified adapter.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length); let at = 8, chunks = 0, image = false, ended = false;
  while (at < bytes.length) {
    if (++chunks > 65536 || at + 12 > bytes.length || ended) throw new TypeError("Malformed PNG texture chunks.");
    const n = view.getUint32(at), end = at + n + 12, kind = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (end > bytes.length || chunks === 1 && (kind !== "IHDR" || n !== 13) || chunks > 1 && kind === "IHDR") throw new TypeError("Malformed PNG texture boundary.");
    if (["acTL", "fcTL", "fdAT"].includes(kind)) throw new TypeError("Animated PNG texture requires a qualified temporal texture adapter; no frame was discarded.");
    let crc = 0xffffffff; for (let i = at + 4; i < end - 4; i++) { crc ^= bytes[i]!; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(end - 4)) throw new TypeError("Corrupt original PNG texture checksum.");
    if (kind === "IDAT") image = true; if (kind === "IEND") { if (n !== 0) throw new TypeError("Malformed PNG texture trailer."); ended = true; } at = end;
  }
  if (!image || !ended) throw new TypeError("Incomplete original PNG texture.");
}

/** Reject absent/extra resources and unsupported required features before preparing bytes. */
export function inspectKeelModelMedia(entry: KeelModelResource, assets: readonly KeelModelResource[] = []): Readonly<{
  format: "gltf" | "obj";
  entryPath: string;
  dependencyIds: readonly string[];
  materialLibraryIds: readonly string[];
  requiredExtensions: readonly string[];
  sourceByteLength: number;
}> {
  if (!(KEEL_MODEL_MEDIA_TYPES as readonly string[]).includes(entry.mediaType)) throw new TypeError("Unsupported model media type.");
  const byPath = new Map<string, KeelModelResource>(), ids = new Set<string>();
  for (const resource of [entry, ...assets]) {
    if (!resource.source.length || ids.has(resource.id)) throw new TypeError("Empty or duplicate model resource identity."); ids.add(resource.id);
    for (const alias of [resource.id, ...(resource.aliases ?? [])]) {
      const path = resolveKeelModelResourcePath("", alias);
      if (path !== alias) throw new TypeError("Model resource aliases must be canonical paths, not traversal spellings.");
      if (byPath.has(path)) throw new TypeError("Ambiguous or duplicate model resource path " + path);
      byPath.set(path, resource);
    }
  }
  const entryPath = resolveKeelModelResourcePath("", entry.aliases?.[0] ?? entry.id), used = new Set<string>(), libraries: string[] = [], required: string[] = [];
  const resolve = (base: string, uri: string): Uint8Array => {
    if (uri.startsWith("data:")) return decodeKeelModelDataURI(uri);
    const path = resolveKeelModelResourcePath(base, uri), found = byPath.get(path);
    if (!found || found === entry) throw new TypeError("Missing verified model dependency " + path);
    used.add(found.id); return found.source;
  };
  const texture = (base: string, uri: string): void => {
    const bytes = resolve(base, uri), mime = uri.startsWith("data:") ? uri.slice(5, uri.indexOf(";")) : byPath.get(resolveKeelModelResourcePath(base, uri))!.mediaType;
    assertKeelModelTexture(bytes, mime);
  };
  if (entry.mediaType === "model/obj") {
    const text = new TextDecoder("utf-8", {fatal: true}).decode(entry.source), names = new Set<string>();
    if (!/^v\s/mu.test(text) || !/^f\s/mu.test(text)) throw new TypeError("OBJ has no complete vertex/face geometry.");
    for (const line of text.split(/\r?\n/u)) { const trimmed = line.trim(); if (trimmed && !trimmed.startsWith("#") && !/^(?:v|vt|vn|f|o|g|s|l|p|mtllib|usemtl)\s/u.test(trimmed)) throw new TypeError("Unsupported OBJ statement cannot be silently discarded."); }
    for (const match of text.matchAll(/^\s*mtllib\s+(.+)$/gmu)) for (const uri of match[1]!.trim().split(/\s+/u)) {
      const path = resolveKeelModelResourcePath(entryPath, uri), library = byPath.get(path); resolve(entryPath, uri);
      if (!library || libraries.includes(library.id)) throw new TypeError("Ambiguous OBJ material library."); libraries.push(library.id);
      const source = new TextDecoder("utf-8", {fatal: true}).decode(library.source);
      for (const line of source.split(/\r?\n/u)) {
        const match = /^\s*(\S+)\s+(.*?)\s*$/u.exec(line); if (!match) continue;
        const key = match[1]!.toLowerCase(), value = match[2]!;
        if (key === "newmtl") { if (names.has(value)) throw new TypeError("Ambiguous OBJ material name " + value); names.add(value); }
        if (key.startsWith("map_") || key === "bump" || key === "disp" || key === "norm") {
          if (!["map_kd", "map_ks", "map_ke", "map_bump", "map_d", "bump", "disp", "norm"].includes(key)) throw new TypeError("Unsupported MTL texture semantics cannot be silently discarded.");
          texture(path, keelModelMTLTexturePath(value));
        }
      }
    }
    for (const match of text.matchAll(/^\s*usemtl\s+(.+)$/gmu)) if (!names.has(match[1]!.trim())) throw new TypeError("Missing verified OBJ material " + match[1]!.trim());
  } else {
    const {json, binary} = parseKeelModelGLTF(entry.source, entry.mediaType as KeelModelMediaType);
    if (!json || json.asset?.version !== "2.0" || !Array.isArray(json.scenes) || !json.scenes.length || !Array.isArray(json.meshes) || !json.meshes.length) throw new TypeError("A complete glTF2 scene and geometry are required.");
    for (const extension of [...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])]) {
      if (typeof extension !== "string" || !KEEL_GLTF_SUPPORTED_EXTENSIONS.includes(extension)) throw new TypeError("Unsupported glTF extension requires an exact registered decoder/adapter: " + extension);
    }
    required.push(...(json.extensionsRequired ?? []));
    for (const [index, buffer] of (json.buffers ?? []).entries()) {
      const bytes = buffer.uri === undefined && index === 0 ? binary : typeof buffer.uri === "string" ? resolve(entryPath, buffer.uri) : undefined;
      if (!bytes || !Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 1 || bytes.length < buffer.byteLength || bytes.length - buffer.byteLength > (buffer.uri === undefined ? 3 : 0)) throw new TypeError("Model buffer length does not match its original bytes.");
    }
    for (const image of json.images ?? []) {
      if (typeof image.uri === "string") texture(entryPath, image.uri);
      else if (Number.isSafeInteger(image.bufferView)) {
        const view = json.bufferViews?.[image.bufferView], definition = json.buffers?.[view?.buffer], source = definition?.uri === undefined && view?.buffer === 0 ? binary : typeof definition?.uri === "string" ? resolve(entryPath, definition.uri) : undefined;
        if (!source || !Number.isSafeInteger(view.byteLength) || !Number.isSafeInteger(view.byteOffset ?? 0) || (view.byteOffset ?? 0) < 0 || view.byteLength < 1 || (view.byteOffset ?? 0) + view.byteLength > source.length) throw new TypeError("Model texture bufferView is invalid.");
        assertKeelModelTexture(source.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength), image.mimeType);
      } else throw new TypeError("Model image requires a verified URI or bufferView.");
    }
  }
  if (assets.some(asset => !used.has(asset.id))) throw new TypeError("Extra model resources are not part of the exact dependency closure.");
  return Object.freeze({format: entry.mediaType === "model/obj" ? "obj" : "gltf", entryPath, dependencyIds: Object.freeze([...used]), materialLibraryIds: Object.freeze(libraries), requiredExtensions: Object.freeze(required), sourceByteLength: [entry, ...assets].reduce((n, r) => n + r.source.length, 0)});
}
