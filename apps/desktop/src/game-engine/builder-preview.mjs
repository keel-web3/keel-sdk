// The builder's preview frame: the engine's pixel renderer drawing whatever
// the editor posts (the live build as its ops stream in, variants, clip
// frames), orbit and zoom, clicking a voxel face (the editor turns it into a
// brush op), the rig overlay with joints to drag (the editor turns a drop into
// a joint op), and the engine's baker for sprite previews. It runs sandboxed
// (a keel-preview frame: scripts only, no network) and knows nothing of the
// project: it only answers messages from the editor window that holds it.
// Bundled by the builder worker with the engine checkout's own source.
import { createPixelRenderer } from '@keel-engine/render';
import { cameraBasis } from '@keel-engine/core';
import { bakeSprites, planBake } from '@keel-engine/bake';

const view = document.getElementById('view');
const overlay = document.getElementById('overlay');
const label = document.getElementById('label');
const statsEl = document.getElementById('stats');
const g = view.getContext('2d');
const o = overlay.getContext('2d');
const gl = document.createElement('canvas');
const send = (message) => parent.postMessage(message, '*');
let px;
try { px = createPixelRenderer(gl, { width: 256, height: 256 }); }
catch (error) { label.textContent = `The pixel renderer needs WebGL2: ${error.message}`; send({ type: 'error', message: String(error.message) }); }

const state = { frame: null, size: 256, yaw: 0.7, pitch: 0.42, zoom: 1, fitH: 0.4, mode: 'orbit', showRig: true, hover: null, drag: null, joint: null, stats: { draws: 0, lit: 0, passes: 0, boxes: 0, capsules: 0, ms: 0 } };
globalThis.builderPreview = state;

// ---------------------------------------------------------------- the look

/** The build's look plus a sky and a ground (as the engine's tool pages draw them). */
function pageLook(look) {
  const colours = [...look.colours];
  const ramps = { ...look.ramps };
  const add = (name, list) => { ramps[name] = [colours.length, list.length]; colours.push(...list); };
  add('sky', [[22, 24, 34], [30, 33, 46], [40, 44, 60], [52, 57, 76]]);
  add('ground', [[34, 38, 44], [48, 54, 60], [64, 72, 78], [82, 92, 96], [104, 114, 116]]);
  const materials = [...look.materials];
  while (materials.length < 6) materials.push({ ramp: 'ground' });
  materials[4] = { ramp: 'ground' };
  materials[5] = { ramp: 'sky' };
  materials.push({ ramp: 'ground', light: 1, pattern: 1 });
  return { colours, ramps, materials, ground: materials.length - 1 };
}

const heightOf = (s) => Math.max(0.12, ...s.boxes.map((b) => b.c[1] + b.h[1]), ...(s.capsules ?? []).map((c) => Math.max(c.a[1], c.b[1]) + c.r), ...(s.wedges ?? []).map((w) => w.c[1] + w.h[1]));
const acrossOf = (s) => Math.max(0, ...s.boxes.map((b) => Math.hypot(b.c[0], b.c[2]) + Math.max(b.h[0], b.h[2])), ...(s.capsules ?? []).map((c) => Math.max(Math.hypot(c.a[0], c.a[2]), Math.hypot(c.b[0], c.b[2])) + c.r));
const fitOf = (s) => Math.max(heightOf(s), acrossOf(s) * 1.1);

function camera(h, yaw = state.yaw, pitch = state.pitch, zoom = state.zoom) {
  h = Math.max(h, 0.5); // (an empty or tiny build still frames a patch of ground, not a close-up of it)
  const dist = (h * 2.3 + 0.3) * zoom;
  const target = [0, h * 0.42, 0];
  return { eye: [target[0] + Math.sin(yaw) * Math.cos(pitch) * dist, target[1] + Math.sin(pitch) * dist, target[2] + Math.cos(yaw) * Math.cos(pitch) * dist], target, fov: 0.8 };
}

/**
 * Draw solids through the pixel renderer. It holds 256 boxes a scene, so a
 * bigger build is drawn in passes of up to 255 boxes (plus the ground) and put
 * together per pixel by depth -- the renderer's own depth buffer (readData).
 */
function draw(solids, look, size, cam) {
  const L = pageLook(look);
  px.setTarget(size, size);
  px.setPalette(L.colours, L.ramps);
  px.setMaterials(L.materials);
  px.setStyle({ screen: size <= 128 ? 4 : 8, dither: 0.9, outline: 1 });
  px.setFx([]);
  const ground = { c: [0, -0.5, 0], h: [40, 0.5, 40], yaw: 0, mat: L.ground };
  const boxes = solids.boxes, capsules = solids.capsules ?? [], wedges = solids.wedges ?? [];
  const passes = Math.max(1, Math.ceil(boxes.length / 255), Math.ceil(capsules.length / 256), Math.ceil(wedges.length / 128));
  const render = { eye: cam.eye, target: cam.target, fov: cam.fov, sun: [0.5, 0.85, 0.4], waterY: -50, fogNear: 60, fogFar: 200 };
  if (passes === 1) {
    px.setWorld({ boxes: [...boxes, ground], capsules, wedges });
    px.render(render);
    return { rgba: px.read(), passes };
  }
  let out = null, depth = null;
  for (let p = 0; p < passes; p += 1) {
    px.setWorld({ boxes: [...boxes.slice(p * 255, (p + 1) * 255), ground], capsules: capsules.slice(p * 256, (p + 1) * 256), wedges: wedges.slice(p * 128, (p + 1) * 128) });
    px.render(render);
    const rgba = px.read();
    const d = px.readData().depth;
    if (!out) { out = new Uint8Array(rgba); depth = new Float32Array(d); continue; }
    for (let i = 0; i < d.length; i += 1) if (d[i] < depth[i]) { depth[i] = d[i]; out[i * 4] = rgba[i * 4]; out[i * 4 + 1] = rgba[i * 4 + 1]; out[i * 4 + 2] = rgba[i * 4 + 2]; out[i * 4 + 3] = 255; }
  }
  return { rgba: out, passes };
}

/** GL rows run bottom first: an ImageData top first. */
function imageOf(rgba, size) {
  const img = new ImageData(size, size);
  for (let y = 0; y < size; y += 1) img.data.set(rgba.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
  return img;
}

// ---------------------------------------------------------------- the live view

function layout() {
  const w = innerWidth, h = innerHeight;
  const side = Math.max(64, Math.min(w, h));
  for (const c of [view, overlay]) { c.style.width = `${side}px`; c.style.height = `${side}px`; c.style.left = `${(w - side) / 2}px`; c.style.top = `${(h - side) / 2}px`; }
  overlay.width = Math.round(side * devicePixelRatio); overlay.height = Math.round(side * devicePixelRatio);
  return side;
}
let side = layout();
addEventListener('resize', () => { side = layout(); redraw(); });

let queued = false;
function redraw() {
  if (queued) return;
  queued = true;
  // (A timer, not requestAnimationFrame: a hidden pane stops rAF and the build still has to draw.)
  setTimeout(() => { queued = false; paint(); }, 0);
}

function paint() {
  const f = state.frame;
  if (!px || !f) return;
  const t0 = performance.now();
  const size = state.size;
  const cam = camera(state.fitH);
  const { rgba, passes } = draw(f, f.look, size, cam);
  view.width = size; view.height = size;
  const img = imageOf(rgba, size);
  g.putImageData(img, 0, 0);
  let lit = 0;
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i] + img.data[i + 1] + img.data[i + 2] > 150) lit += 1;
  state.stats = { draws: state.stats.draws + 1, lit, passes, boxes: f.boxes.length, capsules: (f.capsules ?? []).length, ms: Math.round(performance.now() - t0), n: f.n, voxels: f.voxels };
  statsEl.textContent = `${f.kind === 'character' ? `${(f.capsules ?? []).length} capsules · ${f.boxes.length} boxes` : `${f.voxels} voxels · ${f.boxes.length} boxes`}${passes > 1 ? ` · ${passes} passes` : ''}`;
  label.textContent = f.label ?? '';
  paintOverlay();
}

/** A point in the model frame to overlay pixels (CSS pixels times the device ratio). */
function project(p, cam = camera(state.fitH)) {
  const B = cameraBasis(cam.eye, cam.target);
  const q = [p[0] - cam.eye[0], p[1] - cam.eye[1], p[2] - cam.eye[2]];
  const z = q[0] * B.forward[0] + q[1] * B.forward[1] + q[2] * B.forward[2];
  if (z <= 1e-4) return null;
  const tan = Math.tan(cam.fov / 2);
  const x = (q[0] * B.right[0] + q[1] * B.right[1] + q[2] * B.right[2]) / z / tan;
  const y = (q[0] * B.up[0] + q[1] * B.up[1] + q[2] * B.up[2]) / z / tan;
  return [(x + 1) / 2 * overlay.width, (1 - y) / 2 * overlay.height, z];
}

/** Where a joint is on screen (the frame's CSS pixels): for the editor's acceptance tests. */
state.jointScreen = (name) => {
  const bone = state.frame?.rig?.bones?.find((b) => b.name === name);
  const p = bone && project(bone.at);
  const r = view.getBoundingClientRect();
  return p ? { x: r.left + p[0] / devicePixelRatio, y: r.top + p[1] / devicePixelRatio } : null;
};

function paintOverlay() {
  o.clearRect(0, 0, overlay.width, overlay.height);
  const f = state.frame;
  if (!f) return;
  const k = devicePixelRatio;
  // The cell a click would change.
  if (state.hover && f.kind === 'voxels') {
    const { cell } = state.hover, u = f.unit, pv = f.pivot;
    const c = [0, 1].flatMap((dx) => [0, 1].flatMap((dy) => [0, 1].map((dz) => project([(cell[0] + dx - pv[0]) * u, (cell[1] + dy - pv[1]) * u, (cell[2] + dz - pv[2]) * u]))));
    if (c.every(Boolean)) {
      o.strokeStyle = state.hover.erase ? '#ff704d' : '#4ee2ff'; o.lineWidth = 1.5 * k;
      for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) { o.beginPath(); o.moveTo(c[a][0], c[a][1]); o.lineTo(c[b][0], c[b][1]); o.stroke(); }
    }
  }
  // The rig: bones as lines, joints as dots (draggable on a voxel rig).
  const rig = f.rig;
  if (state.showRig && rig?.bones?.length) {
    const at = new Map(rig.bones.map((b) => [b.name, state.drag?.bone === b.name ? state.drag.at : b.at]));
    o.lineWidth = 1.5 * k;
    for (const b of rig.bones) {
      const p = project(at.get(b.name)); const q = b.parent ? project(at.get(b.parent)) : null;
      if (p && q) { o.strokeStyle = '#ffffffaa'; o.beginPath(); o.moveTo(q[0], q[1]); o.lineTo(p[0], p[1]); o.stroke(); }
    }
    for (const b of rig.bones) {
      const p = project(at.get(b.name)); if (!p) continue;
      const hot = state.joint === b.name || state.drag?.bone === b.name;
      o.fillStyle = rig.editable ? (hot ? '#4ee2ff' : '#ffd36e') : '#c9ccd8';
      o.beginPath(); o.arc(p[0], p[1], (hot ? 5 : 3.5) * k, 0, Math.PI * 2); o.fill();
      if (hot) { o.font = `${11 * k}px ui-monospace, monospace`; o.fillStyle = '#e8ebf7'; o.fillText(b.name, p[0] + 7 * k, p[1] - 6 * k); }
    }
  }
}

// ---------------------------------------------------------------- picking and dragging

/** The ray under a point of the view (CSS pixels relative to the canvas). */
function rayAt(x, y) {
  const cam = camera(state.fitH);
  const B = cameraBasis(cam.eye, cam.target);
  const tan = Math.tan(cam.fov / 2);
  const a = (x / side * 2 - 1) * tan, b = (1 - y / side * 2) * tan;
  const d = [B.forward[0] + B.right[0] * a + B.up[0] * b, B.forward[1] + B.right[1] * a + B.up[1] * b, B.forward[2] + B.right[2] * a + B.up[2] * b];
  const l = Math.hypot(...d);
  return { o: cam.eye, d: [d[0] / l, d[1] / l, d[2] / l], cam };
}

/** The voxel face under a point: the cell hit and the empty cell against that face (or the ground's cell). */
function pick(x, y) {
  const f = state.frame;
  if (!f || f.kind !== 'voxels') return null;
  const { o: eye, d } = rayAt(x, y);
  let best = Infinity, normal = null;
  for (const b of f.boxes) {
    if (b.yaw) continue;
    let t0 = -Infinity, t1 = Infinity, n0 = 0;
    let ok = true;
    for (let k = 0; k < 3; k += 1) {
      const lo = b.c[k] - b.h[k], hi = b.c[k] + b.h[k];
      if (Math.abs(d[k]) < 1e-12) { if (eye[k] < lo || eye[k] > hi) { ok = false; break; } continue; }
      let ta = (lo - eye[k]) / d[k], tb = (hi - eye[k]) / d[k];
      if (ta > tb) [ta, tb] = [tb, ta];
      if (ta > t0) { t0 = ta; n0 = k; }
      t1 = Math.min(t1, tb);
    }
    if (!ok || t0 > t1 || t1 < 0 || t0 >= best) continue;
    best = t0; normal = [0, 0, 0]; normal[n0] = -Math.sign(d[n0]);
  }
  const u = f.unit, pv = f.pivot;
  const cellOf = (p) => [Math.floor(p[0] / u + pv[0]), Math.floor(p[1] / u + pv[1]), Math.floor(p[2] / u + pv[2])];
  if (normal) {
    const p = [eye[0] + d[0] * best, eye[1] + d[1] * best, eye[2] + d[2] * best];
    const e = u * 0.01;
    return { on: cellOf([p[0] - normal[0] * e, p[1] - normal[1] * e, p[2] - normal[2] * e]), add: cellOf([p[0] + normal[0] * e, p[1] + normal[1] * e, p[2] + normal[2] * e]), normal };
  }
  if (d[1] >= 0) return null;
  const t = -eye[1] / d[1];
  const p = [eye[0] + d[0] * t, u * 0.01, eye[2] + d[2] * t];
  const c = cellOf(p);
  return { on: null, add: c, normal: [0, 1, 0], ground: true };
}

function jointAt(x, y) {
  const rig = state.frame?.rig;
  if (!state.showRig || !rig?.editable) return null;
  const k = devicePixelRatio;
  let best = null, bd = 9 * k;
  for (const b of rig.bones) { const p = project(b.at); if (!p) continue; const dd = Math.hypot(p[0] - x * k, p[1] - y * k); if (dd < bd) { bd = dd; best = b; } }
  return best;
}

let down = null;
view.addEventListener('pointerdown', (event) => {
  const r = view.getBoundingClientRect(), x = event.clientX - r.left, y = event.clientY - r.top;
  try { view.setPointerCapture(event.pointerId); } catch { /* A synthetic pointer has nothing to capture. */ }
  const joint = jointAt(x, y);
  down = { x, y, yaw: state.yaw, pitch: state.pitch, moved: false, button: event.button, shift: event.shiftKey, alt: event.altKey };
  if (joint) state.drag = { bone: joint.name, from: joint.at, at: joint.at, depth: project(joint.at)[2] };
});
view.addEventListener('pointermove', (event) => {
  const r = view.getBoundingClientRect(), x = event.clientX - r.left, y = event.clientY - r.top;
  if (down) {
    if (Math.hypot(x - down.x, y - down.y) > 3) down.moved = true;
    if (state.drag) {
      // (In the plane facing the camera through the joint: its depth stays.)
      const { o: eye, d, cam } = rayAt(x, y);
      const B = cameraBasis(cam.eye, cam.target);
      const t = state.drag.depth / (d[0] * B.forward[0] + d[1] * B.forward[1] + d[2] * B.forward[2]);
      state.drag.at = [eye[0] + d[0] * t, eye[1] + d[1] * t, eye[2] + d[2] * t];
      paintOverlay();
      return;
    }
    if (down.moved) { state.yaw = down.yaw - (x - down.x) * 0.012; state.pitch = Math.max(-0.2, Math.min(1.45, down.pitch + (y - down.y) * 0.01)); redraw(); }
    return;
  }
  const joint = jointAt(x, y);
  const hot = joint?.name ?? null;
  const hover = state.mode === 'pick' && !joint ? pick(x, y) : null;
  const cell = hover ? (state.erase ? hover.on : hover.add) : null;
  const next = cell ? { cell, erase: !!state.erase } : null;
  if (hot !== state.joint || JSON.stringify(next) !== JSON.stringify(state.hover)) { state.joint = hot; state.hover = next; paintOverlay(); }
});
view.addEventListener('pointerup', (event) => {
  const r = view.getBoundingClientRect(), x = event.clientX - r.left, y = event.clientY - r.top;
  const was = down; down = null;
  if (state.drag) {
    const drag = state.drag;
    if (was?.moved) {
      const f = state.frame, u = f.unit, pv = f.pivot;
      const at = drag.at.map((v, k) => Math.round((v / u + pv[k]) * 2) / 2);
      send({ type: 'joint', bone: drag.bone, at });
    } else state.drag = null;
    paintOverlay();
    return;
  }
  if (was && !was.moved && state.mode === 'pick') {
    const hit = pick(x, y);
    if (hit) send({ type: 'pick', ...hit, shift: event.shiftKey || was.shift, alt: event.altKey || was.alt });
  }
});
view.addEventListener('pointerleave', () => { if (!down && (state.hover || state.joint)) { state.hover = null; state.joint = null; paintOverlay(); } });
view.addEventListener('wheel', (event) => { event.preventDefault(); state.zoom = Math.max(0.25, Math.min(4, state.zoom * Math.exp(event.deltaY * 0.0012))); redraw(); }, { passive: false });
view.addEventListener('contextmenu', (event) => event.preventDefault());

// ---------------------------------------------------------------- shots and bakes for the editor

function shot({ boxes, capsules = [], wedges = [], look, size = 96, height, yaw = 0.7, pitch = 0.42 }) {
  const solids = { boxes, capsules, wedges };
  const h = height ?? fitOf(solids);
  const { rgba } = draw(solids, look, size, camera(h, yaw, pitch, 1));
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  c.getContext('2d').putImageData(imageOf(rgba, size), 0, 0);
  return c.toDataURL('image/png');
}

/** The engine's baker on a design posed by the builder (its palette, materials and a clip's frames): sprites at a pixel height. */
function bake({ source, sizes = [32, 64, 128], directions = 4 }) {
  const out = [];
  const src = { palette: { colours: source.look.colours, ramps: source.look.ramps }, materials: source.look.materials, pose: (_clip, frame) => source.frames[Math.min(frame, source.frames.length - 1)] };
  const clip = { name: source.clip, frames: source.frames.length, loop: true };
  for (const size of sizes) {
    const t0 = performance.now();
    const pixelsPerMetre = size / Math.max(0.05, source.height * 1.12);
    const design = { key: `${source.key}@${size}`, clips: [clip], height: source.height, radius: source.radius };
    const plan = planBake([design], { directions, pixelsPerMetre, pitch: 0.6 });
    const result = bakeSprites(px, plan.sprites, new Map([[design.key, src]]));
    const byKey = new Map(result.baked.map((s) => [s.key, s]));
    // A sheet: a row per direction, a column per frame, each sprite on its anchor.
    const w = Math.max(...result.baked.map((s) => s.w)), h = Math.max(...result.baked.map((s) => s.h));
    const cols = clip.frames, rows = directions;
    const c = document.createElement('canvas'); c.width = cols * (w + 2) + 2; c.height = rows * (h + 2) + 2;
    const cg = c.getContext('2d');
    for (const job of plan.sprites) {
      const s = byKey.get(job.key); if (!s) continue;
      const img = new ImageData(new Uint8ClampedArray(s.rgba), s.w, s.h);
      const cx = 1 + job.frame * (w + 2) + Math.round(w / 2 - s.ax), cy = 1 + job.direction * (h + 2) + (h - s.ay);
      const t = document.createElement('canvas'); t.width = s.w; t.height = s.h; t.getContext('2d').putImageData(img, 0, 0);
      cg.drawImage(t, cx, cy);
    }
    out.push({ size, url: c.toDataURL('image/png'), sprites: result.baked.length, w, h, directions, frames: clip.frames, ms: Math.round(performance.now() - t0), dropped: result.stats.dropped });
  }
  setTimeout(paint, 0);
  return out;
}

// ---------------------------------------------------------------- messages from the editor

addEventListener('message', (event) => {
  if (event.source !== parent) return;
  const m = event.data;
  if (!m || typeof m !== 'object') return;
  try {
    if (m.type === 'frame' && m.frame) {
      const f = m.frame;
      const h = fitOf(f);
      state.fitH = f.reset || !state.frame || state.frame.key !== f.key ? h : Math.max(state.fitH, h);
      if (f.reset && m.keepCamera !== true) state.zoom = Math.min(state.zoom, 1.6);
      state.frame = f; state.drag = null;
      redraw();
    } else if (m.type === 'tool') {
      if (m.mode) state.mode = m.mode;
      if (m.showRig !== undefined) state.showRig = !!m.showRig;
      if (m.erase !== undefined) state.erase = !!m.erase;
      if (m.size) state.size = m.size;
      state.hover = null; paintOverlay(); if (m.size) redraw();
    } else if (m.type === 'camera') {
      if (m.fit && state.frame) { state.fitH = fitOf(state.frame); state.zoom = 1; }
      if (m.yaw !== undefined) state.yaw = m.yaw;
      if (m.pitch !== undefined) state.pitch = m.pitch;
      redraw();
    } else if (m.type === 'shots') {
      send({ type: 'shots', id: m.id, images: m.shots.map(shot) });
      setTimeout(paint, 0);
    } else if (m.type === 'bake') {
      send({ type: 'baked', id: m.id, sheets: bake(m) });
    }
  } catch (error) {
    send({ type: 'error', id: m.id, message: String(error?.message ?? error) });
  }
});
send({ type: 'ready', webgl: !!px });
