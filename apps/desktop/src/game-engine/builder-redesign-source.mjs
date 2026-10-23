import { inflateSync } from 'node:zlib';

// Bounded, text-only source analysis. Uploaded files are data; no path, URL,
// extras, arbitrary source labels or executable value is copied to the prompt.
export const REDESIGN_SOURCE_LIMITS = Object.freeze({ bytes: 32 * 1024 * 1024, triangles: 250_000, nodes: 1024, vertices: 750_000, imagePixels: 4_194_304, voxelCells: 4_000_000, parts: 32, palette: 12, joints: 64 });
const fail = message => { throw new TypeError(`Redesign source: ${message}`); };
const round = n => Math.round(n * 10000) / 10000;
const vector = v => Array.from(v, round);
const bound = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const add = (b, p) => { for (let a = 0; a < 3; a++) { if (!Number.isFinite(p[a]) || Math.abs(p[a]) > 1e8) fail('geometry has invalid coordinates'); b.min[a] = Math.min(b.min[a], p[a]); b.max[a] = Math.max(b.max[a], p[a]); } };
const decodedImage = image => !!image && image.width > 0 && image.height > 0 && image.data?.length >= image.width * image.height * 4;
const bounded = b => ({ min: vector(b.min), max: vector(b.max) });
const semanticWords = new Set('head neck torso chest body pelvis hip spine arm elbow hand wrist finger leg knee foot ankle toe tail ear eye nose muzzle mouth jaw horn antler wing fin crest mane hair fur shell helmet hat hood crown collar coat shirt dress belt skirt pants shoe boot glove sword shield handle blade door roof wall trunk branch leaf wheel seat base lid latch box crate robot statue dog cat fox wolf rabbit bear bird fish human left right upper lower front back house building tower train town car bicycle lamp pole platform window street bridge sign bus boat support'.split(' '));
// A closed vocabulary keeps source labels useful without forwarding hidden
// metadata, paths, tokens, credentials or instructions embedded in names.
const semantics = value => [...new Set(String(value ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter(w => semanticWords.has(w)))].slice(0, 6);
export const redesignSourceLabels = (...values) => [...new Set(values.flatMap(v => semantics(String(v ?? '').split(/[\\/]/).at(-1))))].slice(0, 8);
const count = (n, max, what) => { if (!Number.isSafeInteger(n) || n < 0 || n > max) fail(`${what} exceeds the inspection limit`); };

function checkPng(bytes, maxPixels) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || !signature.every((v, i) => bytes[i] === v)) return 0;
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), chunks = [];
  let pos = 8, pixels = 0, expected = 0, header = false, ended = false, chunkCount = 0;
  while (pos + 12 <= bytes.length) {
    count(++chunkCount, 4096, 'PNG chunks');
    const len = d.getUint32(pos), end = pos + 12 + len;
    if (end > bytes.length) fail('invalid embedded PNG chunk extent');
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    if (type === 'IHDR') {
      if (header || pos !== 8 || len !== 13) fail('invalid embedded PNG header');
      header = true;
      const w = d.getUint32(pos + 8), h = d.getUint32(pos + 12), depth = bytes[pos + 16], kind = bytes[pos + 17], channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[kind];
      pixels = w * h; count(pixels, maxPixels, 'combined texture size');
      if (!w || !h || !channels || ![1, 2, 4, 8, 16].includes(depth) || bytes[pos + 18] || bytes[pos + 19] || bytes[pos + 20]) fail('unsupported embedded PNG layout');
      expected = h * (Math.ceil(w * channels * depth / 8) + 1);
    } else if (type === 'IDAT') { if (!header) fail('embedded PNG data precedes its header'); chunks.push(bytes.subarray(pos + 8, pos + 8 + len)); }
    else if (type === 'IEND') { ended = true; break; }
    pos = end;
  }
  if (!header || !ended || !chunks.length) fail('incomplete embedded PNG');
  // The importer's PNG decoder inflates in JS. Bound zlib output first so a
  // tiny IHDR cannot conceal an enormous IDAT stream (or trailing scanlines).
  try { const raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: expected }); if (raw.byteLength !== expected) fail('embedded PNG scanline extent differs from its header'); }
  catch { fail('embedded PNG data exceeds its declared scanline limit or is malformed'); }
  return pixels;
}

/** Reject references before the importer can inspect them; embedded data only. */
export function preflightRedesignGltf(json, bin) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) fail('invalid glTF document');
  const list = key => { const a = json[key] ?? []; if (!Array.isArray(a)) fail(`invalid glTF ${key}`); return a; };
  for (const key of ['nodes', 'meshes', 'materials', 'skins', 'images', 'textures', 'buffers', 'bufferViews', 'accessors']) count(list(key).length, key === 'accessors' || key === 'bufferViews' ? 8192 : REDESIGN_SOURCE_LIMITS.nodes, key);
  const nodes = list('nodes'), parents = new Int32Array(nodes.length).fill(-1), visits = new Uint8Array(nodes.length);
  const index = (n, length, what) => { count(n, length - 1, what); };
  let edges = 0;
  for (const [i, node] of nodes.entries()) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) fail('invalid glTF node');
    const children = node.children ?? []; if (!Array.isArray(children)) fail('invalid node children');
    edges += children.length; count(edges, REDESIGN_SOURCE_LIMITS.nodes, 'node edges');
    for (const child of children) { index(child, nodes.length, 'child node'); if (parents[child] !== -1) fail('a glTF node has repeated or multiple parents'); parents[child] = i; }
    if (node.mesh !== undefined) index(node.mesh, list('meshes').length, 'mesh index');
    if (node.skin !== undefined) index(node.skin, list('skins').length, 'skin index');
    for (const [key, length] of [['matrix', 16], ['translation', 3], ['rotation', 4], ['scale', 3]]) if (node[key] !== undefined && (!Array.isArray(node[key]) || node[key].length !== length || node[key].some(n => !Number.isFinite(n) || Math.abs(n) > 1e8))) fail('invalid node transform');
  }
  const visit = i => { if (visits[i] === 1) fail('cyclic glTF node graph'); if (visits[i] === 2) return; visits[i] = 1; for (const child of nodes[i].children ?? []) visit(child); visits[i] = 2; };
  for (let i = 0; i < nodes.length; i++) visit(i);
  count(list('scenes').length, REDESIGN_SOURCE_LIMITS.nodes, 'scene count');
  for (const scene of list('scenes')) { if (!Array.isArray(scene.nodes ?? [])) fail('invalid scene roots'); count((scene.nodes ?? []).length, nodes.length, 'scene roots'); const seen = new Set(); for (const root of scene.nodes ?? []) { index(root, nodes.length, 'scene root'); if (seen.has(root) || parents[root] !== -1) fail('invalid or repeated scene root'); seen.add(root); } }
  count(list('animations').length, 256, 'animation count');
  let jointReferences = 0;
  for (const skin of list('skins')) {
    if (!Array.isArray(skin.joints)) fail('invalid skin joints'); count(skin.joints.length, nodes.length, 'skin joints');
    jointReferences += skin.joints.length; count(jointReferences, 8192, 'combined skin joints');
    const seen = new Set(); for (const joint of skin.joints) { index(joint, nodes.length, 'skin joint index'); if (seen.has(joint)) fail('repeated skin joint'); seen.add(joint); }
    if (skin.skeleton !== undefined) index(skin.skeleton, nodes.length, 'skin skeleton index');
  }

  let accessorElements = 0;
  for (const a of list('accessors')) {
    count(a.count, REDESIGN_SOURCE_LIMITS.vertices * 3, 'accessor count');
    const arity = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }[a.type] ?? 16;
    accessorElements += a.count * arity;
    if (a.sparse !== undefined) { count(a.sparse?.count, Math.min(a.count, REDESIGN_SOURCE_LIMITS.vertices), 'sparse accessor count'); accessorElements += a.sparse.count * (arity + 1); }
  }
  count(accessorElements, 12_000_000, 'accessor allocation');
  let primitiveCount = 0, expandedVertices = 0, expandedTriangles = 0, copiedElements = 0;
  const meshTriangles = [];
  const accessor = (id, types, what) => { index(id, list('accessors').length, what); const a = list('accessors')[id]; if (!types.includes(a.type)) fail(`invalid ${what} type`); return a; };
  for (const mesh of list('meshes')) {
    if (!Array.isArray(mesh.primitives)) fail('invalid mesh primitives'); primitiveCount += mesh.primitives.length; count(primitiveCount, 2048, 'primitive count');
    let meshFaces = 0;
    for (const primitive of mesh.primitives) {
      const mode = primitive.mode ?? 4; count(mode, 6, 'primitive mode'); if (mode < 4) continue;
      const attrs = primitive.attributes ?? {}; if (attrs.POSITION === undefined) continue;
      const position = accessor(attrs.POSITION, ['VEC3'], 'POSITION accessor'), n = position.count;
      expandedVertices += n; count(expandedVertices, REDESIGN_SOURCE_LIMITS.vertices, 'expanded mesh vertices'); copiedElements += n * 3;
      for (const [key, types, width] of [['TEXCOORD_0', ['VEC2'], 2], ['TEXCOORD_1', ['VEC2'], 2], ['COLOR_0', ['VEC3', 'VEC4'], 4], ['JOINTS_0', ['VEC4'], 4], ['WEIGHTS_0', ['VEC4'], 4]]) if (attrs[key] !== undefined) {
        const a = accessor(attrs[key], types, `${key} accessor`); if (a.count !== n) fail('per-vertex accessor count differs from POSITION'); copiedElements += n * width;
      }
      const indexCount = primitive.indices === undefined ? n : accessor(primitive.indices, ['SCALAR'], 'index accessor').count;
      const faces = mode === 5 || mode === 6 ? Math.max(0, indexCount - 2) : Math.floor(indexCount / 3);
      copiedElements += indexCount + faces * 3; meshFaces += faces; expandedTriangles += faces;
      count(expandedTriangles, REDESIGN_SOURCE_LIMITS.triangles, 'expanded mesh triangles'); count(copiedElements, 12_000_000, 'expanded attribute allocation');
    }
    meshTriangles.push(meshFaces);
  }
  count(nodes.reduce((n, node) => n + (node.mesh === undefined ? 0 : meshTriangles[node.mesh]), 0), REDESIGN_SOURCE_LIMITS.triangles, 'instanced scene triangles');
  const buffers = list('buffers').map(b => {
    count(b.byteLength, REDESIGN_SOURCE_LIMITS.bytes, 'buffer size');
    if (b.uri === undefined) return bin;
    if (typeof b.uri !== 'string' || !/^data:[^,;]*(?:;[^,]*)?;base64,[A-Za-z0-9+/=\s]*$/.test(b.uri)) fail('external buffers and images are not allowed; choose a self-contained file');
    return Buffer.from(b.uri.slice(b.uri.indexOf(',') + 1), 'base64');
  });
  for (const v of list('bufferViews')) {
    index(v.buffer, buffers.length, 'buffer index'); count(v.byteOffset ?? 0, REDESIGN_SOURCE_LIMITS.bytes, 'buffer offset'); count(v.byteLength, REDESIGN_SOURCE_LIMITS.bytes, 'buffer view size');
    if (!buffers[v.buffer] || (v.byteOffset ?? 0) + v.byteLength > buffers[v.buffer].byteLength) fail('buffer view exceeds uploaded bytes');
  }
  let texturePixels = 0;
  for (const im of list('images')) {
    let data;
    if (im.uri !== undefined) {
      if (typeof im.uri !== 'string' || !/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]*$/i.test(im.uri)) fail('external buffers and images are not allowed; choose a self-contained file');
      data = Buffer.from(im.uri.slice(im.uri.indexOf(',') + 1), 'base64');
    } else if (im.bufferView !== undefined) { const v = list('bufferViews')[im.bufferView]; if (v && buffers[v.buffer]) data = buffers[v.buffer].subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength); }
    if (data) texturePixels += checkPng(data, REDESIGN_SOURCE_LIMITS.imagePixels - texturePixels);
  }
  count(texturePixels, REDESIGN_SOURCE_LIMITS.imagePixels, 'combined texture size');
}

function preflightVox(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), sizes = [0, 0, 0], translations = [0, 0, 0];
  let pos = 20, total = 0, chunks = 0, pendingSize = null, shapeInstances = 0;
  const models = [], placements = [], nodes = new Set(), children = [];
  if (bytes.length < 20 || dv.getUint32(12, true) !== 0 || dv.getUint32(16, true) !== bytes.length - 20) fail('invalid VOX MAIN extent');
  const int = (p, end) => { if (p + 4 > end) fail('invalid VOX integer extent'); return dv.getInt32(p, true); };
  const str = (p, end) => { const len = int(p, end); count(len, 4096, 'VOX label'); if (p + 4 + len > end) fail('invalid VOX string'); return [new TextDecoder().decode(bytes.subarray(p + 4, p + 4 + len)), p + 4 + len]; };
  const dict = (p, end) => { const n = int(p, end); count(n, 64, 'VOX metadata'); p += 4; const out = Object.create(null); for (let i = 0; i < n; i++) { const [k, next] = str(p, end), [v, after] = str(next, end); p = after; if (k === '_t' || k === '_r') out[k] = v; } return [out, p]; };
  while (pos + 12 <= bytes.length) {
    count(++chunks, 4096, 'VOX chunks');
    const type = new TextDecoder().decode(bytes.subarray(pos, pos + 4)), len = dv.getInt32(pos + 4, true), nested = dv.getInt32(pos + 8, true), p = pos + 12, end = p + len;
    if (len < 0 || nested !== 0 || end > bytes.length) fail('invalid VOX chunk extent');
    if (type === 'SIZE') { pendingSize = []; for (let a = 0; a < 3; a++) { const n = int(p + a * 4, end); count(n, 256, 'VOX dimension'); if (!n) fail('invalid VOX dimension'); pendingSize.push(n); sizes[a] = Math.max(sizes[a], n); } }
    else if (type === 'XYZI') {
      if (!pendingSize) fail('VOX cells have no size'); const n = int(p, end); count(n, REDESIGN_SOURCE_LIMITS.voxelCells, 'VOX cell count'); if (4 + n * 4 > len) fail('invalid VOX cell extent');
      for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) if (bytes[p + 4 + i * 4 + a] >= pendingSize[a]) fail('VOX cell lies outside its declared size');
      total += n; count(total, REDESIGN_SOURCE_LIMITS.voxelCells, 'VOX cells'); models.push(n); count(models.length, REDESIGN_SOURCE_LIMITS.nodes, 'VOX models'); pendingSize = null;
    } else if (['nTRN', 'nGRP', 'nSHP'].includes(type)) {
      const id = int(p, end); count(id, 1_000_000, 'VOX node ID'); if (nodes.has(id)) fail('duplicate VOX node'); nodes.add(id); count(nodes.size, REDESIGN_SOURCE_LIMITS.nodes, 'VOX nodes');
      const [, q] = dict(p + 4, end);
      if (type === 'nTRN') {
        children.push(int(q, end)); const frames = int(q + 12, end); count(frames, 1024, 'VOX frames');
        if (frames) { const [frame] = dict(q + 16, end); if (frame._t) { const t = frame._t.split(/\s+/).map(Number); if (t.length !== 3 || t.some(n => !Number.isSafeInteger(n) || Math.abs(n) > 256)) fail('VOX transform exceeds limit'); for (let a = 0; a < 3; a++) translations[a] += Math.abs(t[a]); }
          if (frame._r) { const r = Number(frame._r); count(r, 127, 'VOX rotation'); if ((r & 3) > 2 || ((r >> 2) & 3) > 2 || (r & 3) === ((r >> 2) & 3)) fail('invalid VOX axis rotation'); }
        }
      } else {
        const n = int(q, end); count(n, REDESIGN_SOURCE_LIMITS.nodes, type === 'nSHP' ? 'VOX shape instances' : 'VOX group children');
        if (type === 'nGRP') { for (let i = 0; i < n; i++) children.push(int(q + 4 + i * 4, end)); }
        else { shapeInstances += n; count(shapeInstances, REDESIGN_SOURCE_LIMITS.nodes, 'VOX shape instances'); let at = q + 4; for (let i = 0; i < n; i++) { placements.push(int(at, end)); [, at] = dict(at + 4, end); } }
      }
      count(children.length, REDESIGN_SOURCE_LIMITS.nodes * 2, 'VOX edges');
    } else if (type === 'RGBA' && len !== 1024) fail('invalid VOX palette extent');
    pos = end;
  }
  for (const child of children) if (!nodes.has(child)) fail('invalid VOX child reference');
  let visits = 0; for (const model of placements) { count(model, models.length - 1, 'VOX model reference'); visits += models[model]; }
  count(nodes.size ? visits : total, REDESIGN_SOURCE_LIMITS.voxelCells, 'VOX placed voxel visits');
  // Valid axis rotations can exchange axes but cannot scale the envelope.
  const extent = Math.max(...sizes) + 2 * translations.reduce((a, b) => a + b, 0);
  count(extent ** 3, REDESIGN_SOURCE_LIMITS.voxelCells, 'VOX transformed grid');
}

function preflightText(bytes, format, importer) {
  if (format === 'stl' && importer.isBinaryStl(bytes)) { count(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true), REDESIGN_SOURCE_LIMITS.triangles, 'STL triangles'); return; }
  const text = new TextDecoder().decode(bytes);
  let vertices = 0, coordinates = 0, triangles = 0, groups = 0, materials = 0, libraries = 0, continuation = '', inSolid = false;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length + continuation.length > 65_536) fail('source text line exceeds limit');
    const line = continuation + raw;
    if (line.endsWith('\\')) { if (format !== 'obj') fail('ASCII STL continuations are not supported'); continuation = line.slice(0, -1) + ' '; continue; } continuation = '';
    const clean = (format === 'obj' ? line.replace(/#.*$/, '') : line).trim(); if (!clean) continue;
    const words = clean.split(/\s+/), kind = words[0];
    if (format === 'obj') {
      if (kind === 'v') count(++vertices, REDESIGN_SOURCE_LIMITS.vertices, 'OBJ vertices');
      if (kind === 'vt' || kind === 'vn') count(++coordinates, REDESIGN_SOURCE_LIMITS.vertices * 2, 'OBJ texture/normal coordinates');
      if (kind === 'f') { triangles += Math.max(0, words.length - 3); count(triangles, REDESIGN_SOURCE_LIMITS.triangles, 'OBJ fan triangles'); }
      if (kind === 'o' || kind === 'g') { count(clean.length, 512, 'OBJ group label'); count(++groups, REDESIGN_SOURCE_LIMITS.nodes, 'OBJ groups'); }
      if (kind === 'usemtl') { count(clean.length, 512, 'OBJ material label'); count(++materials, 4096, 'OBJ material switches'); }
      if (kind === 'mtllib') { libraries += words.length - 1; count(libraries, 1024, 'OBJ material references'); }
    } else {
      if (kind === 'solid') { if (inSolid) fail('nested ASCII STL solids'); count(clean.length, 512, 'STL solid label'); inSolid = true; count(++groups, REDESIGN_SOURCE_LIMITS.nodes, 'STL solids'); }
      else if (kind === 'endsolid') { if (!inSolid) fail('ASCII STL end without solid'); count(clean.length, 512, 'STL solid label'); inSolid = false; }
      else if (!inSolid || !['facet', 'outer', 'vertex', 'endloop', 'endfacet'].includes(kind)) fail('unsupported ASCII STL line');
      // The native importer scans vertex occurrences anywhere in a solid's
      // body. Require exact line shapes so hidden inline vertices cannot bypass
      // this pre-parse allocation budget (including on facet/endloop lines).
      if (kind === 'vertex') {
        if (words.length !== 4 || words.slice(1).some(n => !Number.isFinite(Number(n)))) fail('ASCII STL vertex requires exactly three finite coordinates');
        count(++vertices, REDESIGN_SOURCE_LIMITS.triangles * 3, 'STL vertices');
      } else if (kind === 'facet' && (words.length !== 5 || words[1] !== 'normal' || words.slice(2).some(n => !Number.isFinite(Number(n))))) fail('invalid ASCII STL facet line');
      else if (kind === 'outer' && (words.length !== 2 || words[1] !== 'loop')) fail('invalid ASCII STL outer loop');
      else if (['endloop', 'endfacet'].includes(kind) && words.length !== 1) fail('invalid ASCII STL terminator');
    }
  }
  if (continuation) fail('unterminated source text continuation');
  if (inSolid) fail('unterminated ASCII STL solid');
}

export function redesignSourceBytes(value) {
  let bytes;
  if (value instanceof Uint8Array) bytes = value;
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else if (Array.isArray(value) && value.length <= REDESIGN_SOURCE_LIMITS.bytes && value.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) bytes = Uint8Array.from(value);
  else fail('provide explicit uploaded source bytes');
  if (!bytes.byteLength || bytes.byteLength > REDESIGN_SOURCE_LIMITS.bytes) fail('file must be between 1 byte and 32 MiB');
  return bytes;
}

export function inspectRedesignSource(bytes, { importer, fileName = '', sourceKind, animation = null, sourceStyle = null, semanticLabels = [] }) {
  bytes = redesignSourceBytes(bytes);
  const extension = String(fileName).split('.').at(-1).toLowerCase();
  const format = importer.isGlb(bytes) ? 'glb' : importer.isVox(bytes) ? 'vox' : ['gltf', 'obj', 'stl'].includes(extension) ? extension : null;
  if (!format) fail('choose a self-contained GLB, glTF, OBJ, STL, VOX or .keelasset file');
  if (format === 'glb' || format === 'gltf') { const parsed = format === 'glb' ? importer.readGlb(bytes) : { json: JSON.parse(new TextDecoder().decode(bytes)), bin: null }; preflightRedesignGltf(parsed.json, parsed.bin); }
  if (format === 'vox') preflightVox(bytes);
  if (format === 'obj' || format === 'stl') preflightText(bytes, format, importer);
  const omittedExternalMaterials = format === 'obj' && /^\s*mtllib\s/m.test(new TextDecoder().decode(bytes));
  let scene;
  try { scene = importer.parseModel(bytes, { format, name: 'redesign-source' }); } catch { fail('the trusted importer could not read this self-contained model (check its format and embedded codecs)'); }
  count(scene.nodes.length, REDESIGN_SOURCE_LIMITS.nodes, 'scene nodes');
  const all = bound(), partMap = new Map(), colours = new Map(), points = [], maxPoints = 12000;
  let triangles = 0, voxels = 0;
  const paletteSample = linear => {
    const rgb = linear.slice(0, 3).map(n => Math.round(Math.max(0, Math.min(1, importer.linearToSrgb(n))) * 255));
    if (rgb.some(n => !Number.isFinite(n))) return;
    const key = rgb.map(n => Math.round(n / 24)).join(',');
    const item = colours.get(key) ?? { rgb: [0, 0, 0], samples: 0 }; item.samples++; for (let a = 0; a < 3; a++) item.rgb[a] += rgb[a]; colours.set(key, item);
  };
  const recordPoint = (p, key, labels, weight = 1) => { add(all, p); let part = partMap.get(key); if (!part) { part = { key, labels, bounds: bound(), samples: 0 }; partMap.set(key, part); } add(part.bounds, p); part.samples += weight; };
  if (scene.voxels) {
    const v = scene.voxels, [sx, sy] = v.size; count(v.cells.length, REDESIGN_SOURCE_LIMITS.voxelCells, 'VOX grid');
    const step = Math.max(1, Math.ceil(v.cells.length / maxPoints));
    for (let i = 0; i < v.cells.length; i++) if (v.cells[i]) {
      voxels++; const p = [i % sx, Math.floor(i / sx) % sy, Math.floor(i / (sx * sy))].map(n => n * scene.metres), key = v.model[i];
      recordPoint(p, key, semantics(v.modelNames[key])); add(all, p.map(n => n + scene.metres));
      if (i % step === 0 || points.length < 64) { points.push(p); paletteSample(Array.from(v.palette.subarray(v.cells[i] * 4, v.cells[i] * 4 + 4))); }
    }
  } else {
    let estimated = 0; for (const n of scene.nodes) if (n.mesh !== undefined) for (const p of scene.meshes[n.mesh].primitives) estimated += p.indices.length / 3;
    count(estimated, REDESIGN_SOURCE_LIMITS.triangles, 'triangle count');
    const soup = importer.soupOf(scene); triangles = soup.count;
    const step = Math.max(1, Math.ceil(triangles / (maxPoints / 3)));
    for (let t = 0; t < triangles; t++) {
      for (let k = 0; k < 3; k++) { const o = t * 9 + k * 3, p = Array.from(soup.positions.subarray(o, o + 3)); recordPoint(p, soup.node[t], [...new Set([...semantics(scene.nodes[soup.node[t]]?.name), ...semantics(scene.meshes[soup.mesh[t]]?.name)])].slice(0, 6)); if (t % step === 0) points.push(p); }
      if (t % step === 0) {
        const mat = scene.materials[soup.material[t]], o = t * 12, colour = [0, 1, 2].map(a => (mat?.colour[a] ?? 1) * soup.colours[o + a]);
        if (mat?.texture) { const tex = importer.sampleTexture(scene, mat.texture.texture, soup.uvs[t * 6], soup.uvs[t * 6 + 1]); for (let a = 0; a < 3; a++) colour[a] *= tex[a]; }
        paletteSample(colour);
      }
    }
  }
  if (!Number.isFinite(all.min[0])) fail('the source contains no visible geometry');
  const size = all.max.map((v, a) => v - all.min[a]), longest = Math.max(...size, 1e-9);
  const normBounds = b => ({ min: vector(b.min.map((v, a) => (v - all.min[a]) / longest)), max: vector(b.max.map((v, a) => (v - all.min[a]) / longest)) });
  const slices = Array.from({ length: 12 }, (_, i) => ({ height: round((i + .5) / 12), points: 0, x: [Infinity, -Infinity], z: [Infinity, -Infinity] }));
  for (const p of points) { const slice = slices[Math.min(11, Math.max(0, Math.floor((p[1] - all.min[1]) / (size[1] || 1) * 12)))]; slice.points++; for (const [key, a] of [['x', 0], ['z', 2]]) { const n = (p[a] - all.min[a]) / longest; slice[key][0] = Math.min(slice[key][0], n); slice[key][1] = Math.max(slice[key][1], n); } }
  const parts = [...partMap.values()].sort((a, b) => b.samples - a.samples).slice(0, REDESIGN_SOURCE_LIMITS.parts).map((p, i) => ({ id: `part-${i + 1}`, labels: p.labels, relativeBounds: normBounds(p.bounds), sampleShare: round(p.samples / [...partMap.values()].reduce((n, v) => n + v.samples, 0)) }));
  const totalColours = [...colours.values()].reduce((n, v) => n + v.samples, 0);
  const palette = [...colours.values()].sort((a, b) => b.samples - a.samples).slice(0, REDESIGN_SOURCE_LIMITS.palette).map(p => ({ rgb: p.rgb.map(n => Math.round(n / p.samples)), share: round(p.samples / totalColours) }));
  const jointSet = [...new Set(scene.skins.flatMap(s => s.joints))], jointMap = new Map(jointSet.map((j, i) => [j, i]));
  const joints = jointSet.slice(0, REDESIGN_SOURCE_LIMITS.joints).map((j, i) => ({ id: `joint-${i + 1}`, labels: semantics(scene.nodes[j]?.name), parent: jointMap.has(scene.nodes[j]?.parent) && jointMap.get(scene.nodes[j].parent) < REDESIGN_SOURCE_LIMITS.joints ? `joint-${jointMap.get(scene.nodes[j].parent) + 1}` : null, at: vector(importer.jointPosition(scene, j).map((v, a) => (v - all.min[a]) / longest)) }));
  return { format: 'keel-redesign-source@1', modality: 'text-only-geometry-analysis', sourceFormat: sourceKind ?? format, semanticLabels: semanticLabels.filter(w => semanticWords.has(w)).slice(0, 8), evidence: 'Measured only the explicitly supplied bytes. No image was shown to the model. Labels are a closed vocabulary; mesh parts and sampled vertex envelopes are geometric hints, not semantic certainty.', geometry: { bounds: bounded(all), size: vector(size), normalizedSize: vector(size.map(v => v / longest)), triangles, voxels, meshes: scene.meshes.length, nodes: scene.nodes.length, materials: scene.materials.length, decodedTextures: scene.images.filter(decodedImage).length, unavailableTextures: scene.textures.filter(t => !decodedImage(scene.images[t.image])).length }, silhouette: { kind: 'sampled-vertex-envelope', axes: 'x-right,y-up,z-front', slices: slices.filter(s => s.points).map(s => ({ height: s.height, x: vector(s.x), z: vector(s.z) })) }, parts, palette, rig: { skinned: !!scene.skins.length, skins: scene.skins.length, jointCount: jointSet.length, joints, truncated: jointSet.length > joints.length }, ...(animation ? { animation } : {}), ...(sourceStyle ? { sourceStyle } : {}), limits: { partsTruncated: partMap.size > parts.length, sampledPoints: points.length, warnings: scene.warnings.length, omittedExternalMaterials } };
}
