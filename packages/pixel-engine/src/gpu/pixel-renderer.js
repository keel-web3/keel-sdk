// The realtime pixel renderer (WebGL2). A world of boxes, wedges (ramps) and
// capsules (and the water and the sky), drawn at a TARGET size -- 32×32 to
// 256×256 or any W×H -- then quantized to a palette, dithered and outlined,
// and shown pixel-sharp at whatever size the canvas is on the page. The same
// world reads at every target: the palette's ramps and the screen do the work
// a bigger picture's detail would.
//
//   const px = createPixelRenderer(canvas, { width: 128, height: 128 });
//   px.setPalette(colours, ramps);            // [[r,g,b]...] (up to 65536), { name: [base, length] } (up to 256 ramps)
//   px.setMaterials([{ ramp, light, pattern, glow }, ...]);   // up to 255 materials
//   px.setWorld({ boxes, wedges, capsules }); // boxes/wedges: {c, h, yaw, mat} (a wedge: + lo); capsules: {a, b, r, mat}
//   px.setFx([{ name: "glow" }, { name: "vignette" }]);   // src/fx: all on the ramps, all at the target size
//   px.render({ eye, target, fov, time, sun, particles });
//
// Nothing here is sized for a GIF or an art piece: palettes of thousands of
// colours, 256 ramps, 255 materials. Every pixel is still a palette entry.

import { cameraBasis } from "../core/frame.js";
import { ALL_FX, fxUniforms, resolveFx, screenTile, toggleFx } from "../fx/fx.js";
import {
  FAR, FULLSCREEN_VS, MAX_BOXES, MAX_CAPS, MAX_COLOURS, MAX_MATERIALS, MAX_RAMPS, MAX_WEDGES, PALETTE_WIDTH,
  PIXEL_FS, POINTS_FS, POINTS_VS, SCREEN_TILE, WORLD_FS,
} from "./shaders.js";

export { MAX_BOXES, MAX_CAPS, MAX_COLOURS, MAX_MATERIALS, MAX_RAMPS, MAX_WEDGES } from "./shaders.js";

function program(gl, vs, fs) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const loc = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i += 1) { const u = gl.getActiveUniform(p, i); loc[u.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, u.name); }
  return { p, loc };
}

const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function createPixelRenderer(canvas, { width = 128, height = 128 } = {}) {
  const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("WebGL2 is not available");
  const world = program(gl, FULLSCREEN_VS, WORLD_FS);
  const pixel = program(gl, FULLSCREEN_VS, PIXEL_FS);
  const points = program(gl, POINTS_VS, POINTS_FS);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const pbuf = gl.createBuffer();
  const nearest = () => { for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); };
  const floatTex = (w, h, data = null) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data); nearest(); return t; };

  let W = width;
  let H = height;
  let fbo = null;
  let dataTex = null;
  let data2Tex = null;
  let depthTex = null;
  function target(w, h) {
    W = w; H = h;
    canvas.width = W; canvas.height = H;
    for (const t of [dataTex, data2Tex, depthTex]) if (t) gl.deleteTexture(t);
    if (fbo) gl.deleteFramebuffer(fbo);
    const rgba8 = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); nearest(); return t; };
    dataTex = rgba8();
    data2Tex = rgba8();
    depthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, W, H, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    nearest();
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dataTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, data2Tex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    fxDirty = true;
  }

  // The world's solids: three uniform blocks; the ramps and the materials: float textures (see shaders.js).
  const blocks = [["Boxes", 2 * MAX_BOXES], ["Wedges", 3 * MAX_WEDGES], ["Capsules", 2 * MAX_CAPS]].map(([name, vecs], i) => {
    const data = new Float32Array(vecs * 4);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, buf);
    gl.bufferData(gl.UNIFORM_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    gl.uniformBlockBinding(world.p, gl.getUniformBlockIndex(world.p, name), i);
    return { data, buf, i };
  });
  const [boxBlock, wedgeBlock, capBlock] = blocks;
  const rampRows = new Float32Array(MAX_RAMPS * 2 * 4);
  const rampTex = floatTex(MAX_RAMPS, 2, rampRows);
  const matRows = new Float32Array(256 * 4);
  const matTex = floatTex(256, 1, matRows);
  const screenTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, screenTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, SCREEN_TILE, SCREEN_TILE, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(SCREEN_TILE * SCREEN_TILE));
  nearest();
  let screenLoaded = null;
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  let query = null;
  let gpuMs = null;

  let palTex = null;
  let palette = [];
  let rampIndex = {};
  let rampList = [];
  let nBoxes = 0;
  let nWedges = 0;
  let nCaps = 0;
  let style = { screen: 4, dither: 0.9, outline: 1 };
  let fxList = [];
  let fxResolved = [];
  let fxU = null;
  let fxDirty = true;

  function uploadRamps() {
    rampRows.fill(0);
    rampList.forEach(([base, len], i) => { rampRows.set([base, len, 0, 0], i * 4); });
    for (let i = 0; i < MAX_RAMPS; i += 1) rampRows[(MAX_RAMPS + i) * 4] = -1; // (row 1: graded twin, -1 = itself)
    if (fxU) {
      for (const [r, from, speed] of fxU.ramps.cycle) { rampRows[r * 4 + 2] = from; rampRows[r * 4 + 3] = speed; }
      for (const [r, to] of fxU.ramps.grade) rampRows[(MAX_RAMPS + r) * 4] = to;
    }
    gl.bindTexture(gl.TEXTURE_2D, rampTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAX_RAMPS, 2, gl.RGBA, gl.FLOAT, rampRows);
  }
  function refreshFx() {
    fxResolved = resolveFx(fxList, { width: W, height: H });
    fxU = fxUniforms(fxResolved, { ramp: (n) => rampIndex[n] ?? -1, rampOf: (i) => rampList[i] ?? [0, 1], style, far: FAR });
    if (fxU.screen && fxU.screen !== screenLoaded) {
      gl.bindTexture(gl.TEXTURE_2D, screenTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SCREEN_TILE, SCREEN_TILE, gl.RED, gl.UNSIGNED_BYTE, screenTile(fxU.screen, SCREEN_TILE));
      screenLoaded = fxU.screen;
    }
    uploadRamps();
    fxDirty = false;
  }
  target(W, H);

  const api = {
    gl,
    get width() { return W; },
    get height() { return H; },
    /** What this renderer holds at most (and what the GPU says it can). */
    limits: {
      boxes: MAX_BOXES, wedges: MAX_WEDGES, capsules: MAX_CAPS, ramps: MAX_RAMPS, materials: MAX_MATERIALS, colours: MAX_COLOURS,
      fragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS), maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    },
    /** The target size (the picture's own pixels). */
    setTarget(w, h) { target(Math.max(8, w | 0), Math.max(8, h | 0)); },
    /** Colours ([[r,g,b],...] 0-255) and ramps ({ name: [base, length] }), ramps in order 0..255. */
    setPalette(colours, ramps) {
      if (colours.length > MAX_COLOURS) throw new RangeError(`${colours.length} colours: at most ${MAX_COLOURS}`);
      palette = colours.map((c) => [c[0], c[1], c[2]]);
      const rows = Math.max(1, Math.ceil(colours.length / PALETTE_WIDTH));
      const bytes = new Uint8Array(PALETTE_WIDTH * rows * 4);
      colours.forEach((c, i) => { bytes[i * 4] = c[0]; bytes[i * 4 + 1] = c[1]; bytes[i * 4 + 2] = c[2]; bytes[i * 4 + 3] = 255; });
      if (palTex) gl.deleteTexture(palTex);
      palTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, palTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PALETTE_WIDTH, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      nearest();
      const entries = Object.entries(ramps);
      if (entries.length > MAX_RAMPS) throw new RangeError(`${entries.length} ramps: at most ${MAX_RAMPS}`);
      rampIndex = {};
      rampList = entries.map(([name, [base, len]], i) => { rampIndex[name] = i; return [base, len]; });
      fxDirty = true;
    },
    /** The palette as set ([[r,g,b], ...]): what a palette-true frame's pixels must all be. */
    get palette() { return palette; },
    ramp: (name) => rampIndex[name] ?? 0,
    /**
     * Materials 0..254: { ramp (name), light (scale), pattern (0 none, 1 checker), glow (added lightness; the glow
     * fx's emissive) }. (Material 4 lights the water and 5 the sky.)
     */
    setMaterials(list) {
      if (list.length > MAX_MATERIALS) throw new RangeError(`${list.length} materials: at most ${MAX_MATERIALS}`);
      matRows.fill(0);
      list.forEach((m, i) => { matRows.set([rampIndex[m.ramp] ?? 0, m.light ?? 1, m.pattern ?? 0, m.glow ?? 0], i * 4); });
      gl.bindTexture(gl.TEXTURE_2D, matTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.FLOAT, matRows);
    },
    /** The dither screen (0 none, 2, 4, 8, or a core screen id such as "stipple"), how far it reaches, and the outline. */
    setStyle({ screen: s = style.screen, dither: d = style.dither, outline: o = style.outline } = {}) {
      style = { screen: s, dither: d, outline: o ? 1 : 0 };
      fxDirty = true;
    },
    /** The world's solids: boxes and wedges turned about y (a box with `kind: "wedge"` is a wedge too), and capsules. */
    setWorld({ boxes = [], wedges = [], capsules = [] }) {
      const bx = [];
      const wd = [...wedges];
      for (const b of boxes) (b.kind === "wedge" ? wd : bx).push(b);
      nBoxes = Math.min(MAX_BOXES, bx.length);
      for (let i = 0; i < nBoxes; i += 1) { const b = bx[i]; boxBlock.data.set([b.c[0], b.c[1], b.c[2], b.mat ?? 0, b.h[0], b.h[1], b.h[2], b.yaw ?? 0], i * 8); }
      nWedges = Math.min(MAX_WEDGES, wd.length);
      for (let i = 0; i < nWedges; i += 1) { const w = wd[i]; wedgeBlock.data.set([w.c[0], w.c[1], w.c[2], w.mat ?? 0, w.h[0], w.h[1], w.h[2], w.yaw ?? 0, Math.max(0, Math.min(0.98, w.lo ?? 0)), 0, 0, 0], i * 12); }
      nCaps = Math.min(MAX_CAPS, capsules.length);
      for (let i = 0; i < nCaps; i += 1) { const c = capsules[i]; capBlock.data.set([c.a[0], c.a[1], c.a[2], c.r, c.b[0], c.b[1], c.b[2], c.mat ?? 0], i * 8); }
      // (Only the used parts go up: a few KB a frame.)
      for (const [blk, n] of [[boxBlock, nBoxes * 8], [wedgeBlock, nWedges * 12], [capBlock, nCaps * 8]]) {
        gl.bindBuffer(gl.UNIFORM_BUFFER, blk.buf);
        if (n) gl.bufferSubData(gl.UNIFORM_BUFFER, 0, blk.data, 0, n);
      }
      return { boxes: nBoxes, wedges: nWedges, capsules: nCaps, dropped: bx.length - nBoxes + wd.length - nWedges + capsules.length - nCaps };
    },
    /** The fx list (src/fx): [{ name, on?, ...params }]. Resolved for the target now and on every setTarget. */
    setFx(list = []) { fxList = list.map((e) => ({ ...e })); resolveFx(fxList, { width: W, height: H }); fxDirty = true; },
    /** Turn one pass on or off by name (added with its defaults if it wasn't listed). */
    toggleFx(name, on) { fxList = toggleFx(fxList, name, on); fxDirty = true; },
    /** The list as given, and as resolved for the current target. */
    get fx() { return fxList.map((e) => ({ ...e })); },
    get fxResolved() { if (fxDirty) refreshFx(); return fxResolved; },
    allFx: ALL_FX,
    /** The last measured GPU time of a frame in ms (EXT_disjoint_timer_query_webgl2), or null where there is none. */
    get gpuMs() { return gpuMs; },
    /** One frame: the camera (eye, target, fov in radians), the time, the sun, particles [{p:[x,y,z], size, light, ramp, glow}]. */
    render({ eye, target: look, fov = 1.2, time = 0, sun = [0.4, 0.8, 0.3], waterY = 0, fogNear = 25, fogFar = 110, particles = [] }) {
      if (fxDirty) refreshFx();
      // (GPU time, where the timer query exists: one query in flight, read back a frame or two later.)
      let timing = false;
      if (timer) {
        if (query && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
          gl.deleteQuery(query); query = null;
        }
        if (!query) { query = gl.createQuery(); gl.beginQuery(timer.TIME_ELAPSED_EXT, query); timing = true; }
      }
      // (core/frame.js: right = up x forward, so looking along +z, +x is on the screen's right.)
      const { forward: fwd, right, up } = cameraBasis(eye, look);
      const tanF = Math.tan(fov / 2);
      const sunN = norm(sun);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.ALWAYS);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const U = world.loc;
      gl.useProgram(world.p);
      gl.uniform2f(U.uRes, W, H);
      gl.uniform3fv(U.uEye, eye); gl.uniform3fv(U.uFwd, fwd); gl.uniform3fv(U.uRight, right); gl.uniform3fv(U.uUp, up);
      gl.uniform1f(U.uTan, tanF); gl.uniform1f(U.uTime, time);
      gl.uniform1i(U.uBoxes, nBoxes); gl.uniform1i(U.uWedges, nWedges); gl.uniform1i(U.uCaps, nCaps);
      for (const blk of blocks) gl.bindBufferBase(gl.UNIFORM_BUFFER, blk.i, blk.buf);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, matTex); gl.uniform1i(U.uMats, 1);
      gl.uniform3fv(U.uSun, sunN);
      gl.uniform1f(U.uWaterY, waterY); gl.uniform1f(U.uFogNear, fogNear); gl.uniform1f(U.uFogFar, fogFar);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      const aw = gl.getAttribLocation(world.p, "aPos");
      gl.enableVertexAttribArray(aw);
      gl.vertexAttribPointer(aw, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Particles into the same buffers, behind or in front of what's there.
      if (particles.length) {
        gl.depthFunc(gl.LESS);
        const data = new Float32Array(particles.length * 7);
        particles.forEach((q, i) => data.set([q.p[0], q.p[1], q.p[2], q.size ?? 1, q.light ?? 0.8, rampIndex[q.ramp] ?? 0, q.glow ?? 0], i * 7));
        gl.useProgram(points.p);
        const P = points.loc;
        gl.uniform3fv(P.uEye, eye); gl.uniform3fv(P.uFwd, fwd); gl.uniform3fv(P.uRight, right); gl.uniform3fv(P.uUp, up);
        gl.uniform1f(P.uTan, tanF); gl.uniform1f(P.uAspect, W / H); gl.uniform1f(P.uH, H);
        gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        const a0 = gl.getAttribLocation(points.p, "aPos");
        const a1 = gl.getAttribLocation(points.p, "aLook");
        gl.enableVertexAttribArray(a0); gl.vertexAttribPointer(a0, 4, gl.FLOAT, false, 28, 0);
        gl.enableVertexAttribArray(a1); gl.vertexAttribPointer(a1, 3, gl.FLOAT, false, 28, 16);
        gl.drawArrays(gl.POINTS, 0, particles.length);
        gl.disableVertexAttribArray(a1);
      }
      gl.disable(gl.DEPTH_TEST);
      // Pass 2: the palette, the screen, the fx, the outline.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(pixel.p);
      const X = pixel.loc;
      const T = [[dataTex, "uData"], [data2Tex, "uData2"], [depthTex, "uDepth"], [palTex, "uPalette"], [rampTex, "uRamps"], [screenTex, "uScreenTex"]];
      T.forEach(([t, name], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(X[name], i); });
      const u = fxU.u;
      gl.uniform1i(X.uScreen, u.uScreen); gl.uniform1f(X.uDither, u.uDither);
      gl.uniform1f(X.uTime, time);
      gl.uniform3fv(X.uOutline, u.uOutline); gl.uniform1i(X.uOutlineInk, u.uOutlineInk);
      gl.uniform4fv(X.uFog, u.uFog); gl.uniform2fv(X.uFogLook, u.uFogLook);
      gl.uniform4fv(X.uGlow, u.uGlow); gl.uniform2fv(X.uGlowK, u.uGlowK);
      gl.uniform4fv(X.uVig, u.uVig); gl.uniform4fv(X.uScan, u.uScan); gl.uniform4fv(X.uCrt, u.uCrt);
      gl.uniform4fv(X.uRim, u.uRim);
      // (The rim light comes from the sun's side of the screen, unless the pass names a direction.)
      let rd = u.uRimDir;
      if (!rd) { const sx = dot(sunN, right); const sy = dot(sunN, up); const l = Math.hypot(sx, sy); rd = l > 1e-3 ? [sx / l, sy / l] : [0, 1]; }
      gl.uniform2fv(X.uRimDir, rd);
      gl.uniform4fv(X.uFlash, u.uFlash); gl.uniform4iv(X.uFlashMats, u.uFlashMats);
      gl.uniform2fv(X.uGrade, u.uGrade); gl.uniform1i(X.uCycle, u.uCycle);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      const ap = gl.getAttribLocation(pixel.p, "aPos");
      gl.enableVertexAttribArray(ap);
      gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (timing) gl.endQuery(timer.TIME_ELAPSED_EXT);
    },
    /** The last frame's pixels (RGBA, bottom row first). */
    read() { const out = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out); return out; },
    /** How many of the last frame's pixels are NOT palette entries (0 for a palette-true frame). */
    offPalette(pixels = api.read()) {
      const set = new Set(palette.map((c) => (c[0] << 16) | (c[1] << 8) | c[2]));
      let off = 0;
      for (let i = 0; i < pixels.length; i += 4) if (!set.has((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2])) off += 1;
      return off;
    },
  };
  return api;
}
