// src/gpu without a GPU: the shaders' contracts (limits, uniform budget, the
// uniforms the renderer sets exist), the wedge the shader draws is the wedge
// physics collides with, and the renderer's bookkeeping through a recording
// stand-in for WebGL2. (Pixels are checked in the browser: tools/fx-sheet.html,
// every cell palette-true.)
import { test } from "node:test";
import assert from "node:assert/strict";
import * as SH from "../src/gpu/shaders.js";
import { createPixelRenderer } from "../src/gpu/pixel-renderer.js";
import { wedgeDistance } from "../src/physics/character.js";
import { ALL_FX } from "../src/fx/fx.js";

test("limits a full game won't hit: 256 ramps, 255 materials, thousands of colours, hundreds of solids", () => {
  assert.ok(SH.MAX_RAMPS >= 64 && SH.MAX_MATERIALS >= 64);
  assert.ok(SH.MAX_COLOURS >= 1024 && SH.PALETTE_WIDTH >= 1024);
  assert.ok(SH.MAX_BOXES >= 96 && SH.MAX_CAPS >= 64 && SH.MAX_WEDGES >= 32, "never fewer than before");
  // (Each solid block within WebGL2's baseline 16 KB uniform block.)
  for (const [n, per] of [[SH.MAX_BOXES, 2], [SH.MAX_WEDGES, 3], [SH.MAX_CAPS, 2]]) assert.ok(n * per * 16 <= 16384);
});

// The plain (non-block) uniforms a shader declares, in vec4-equivalents (a rough upper bound: one slot each, arrays by length).
function plainUniformSlots(src) {
  const body = src.replace(/layout\(std140\) uniform \w+ \{[^}]*\};/g, "");
  let n = 0;
  for (const m of body.matchAll(/^uniform\s+\w+\s+([^;]+);/gm)) for (const part of m[1].split(",")) { const a = part.match(/\[(\d+)\]/); n += a ? +a[1] : 1; }
  return n;
}
test("the fragment shaders stay inside WebGL2's baseline uniform budget (224 vectors)", () => {
  for (const [name, src] of [["WORLD_FS", SH.WORLD_FS], ["PIXEL_FS", SH.PIXEL_FS]]) {
    const n = plainUniformSlots(src);
    assert.ok(n < 224, `${name}: ${n} slots`);
  }
});

test("every uniform the renderer sets is declared by its shader", async () => {
  const { readFile } = await import("node:fs/promises");
  const js = await readFile(new URL("../src/gpu/pixel-renderer.js", import.meta.url), "utf8");
  for (const [prog, src] of [["U", SH.WORLD_FS], ["X", SH.PIXEL_FS], ["P", SH.POINTS_VS]]) {
    const used = new Set([...js.matchAll(new RegExp(`\\b${prog}\\.(u\\w+)`, "g"))].map((m) => m[1]));
    assert.ok(used.size > 0);
    for (const u of used) assert.match(src, new RegExp(`uniform [^;]*\\b${u}\\b`), `${u} declared`);
  }
  for (const name of ["uData", "uData2", "uDepth", "uPalette", "uRamps", "uScreenTex"]) assert.match(SH.PIXEL_FS, new RegExp(`uniform sampler2D ${name};`));
  for (const block of ["Boxes", "Wedges", "Capsules"]) assert.match(SH.WORLD_FS, new RegExp(`uniform ${block} \\{`));
});

// The shader's wedge, line for line in JS (sdSection + sdWedge in WORLD_FS).
function shaderWedge(q, h, lo) {
  const v = [[-h[2], -h[1]], [h[2], -h[1]], [h[2], -h[1] + 2 * h[1] * lo], [-h[2], h[1]]];
  const p = [q[2], q[1]];
  let out2 = 1e18;
  let far = -1e9;
  let inside = true;
  for (let i = 0; i < 4; i += 1) {
    const a = v[i];
    const e = [v[(i + 1) & 3][0] - a[0], v[(i + 1) & 3][1] - a[1]];
    const L2 = e[0] * e[0] + e[1] * e[1];
    if (L2 < 1e-12) continue;
    const w = [p[0] - a[0], p[1] - a[1]];
    const t = Math.max(0, Math.min(1, (w[0] * e[0] + w[1] * e[1]) / L2));
    const r = [w[0] - e[0] * t, w[1] - e[1] * t];
    out2 = Math.min(out2, r[0] * r[0] + r[1] * r[1]);
    const s = (w[0] * e[1] - w[1] * e[0]) / Math.sqrt(L2);
    if (s > 0) inside = false;
    far = Math.max(far, s);
  }
  const b = inside ? far : Math.sqrt(out2);
  const ax = Math.abs(q[0]) - h[0];
  return Math.hypot(Math.max(ax, 0), Math.max(b, 0)) + Math.min(Math.max(ax, b), 0);
}
test("the wedge the shader draws is the wedge physics collides with (same turn, same solid)", () => {
  assert.match(SH.WORLD_FS, /vec2\(-h\.x, -h\.y\), vec2\(h\.x, -h\.y\), vec2\(h\.x, -h\.y \+ 2\.0 \* h\.y \* lo\), vec2\(-h\.x, h\.y\)/);
  for (const yaw of [0, 0.7, -2.2, Math.PI]) {
    for (const lo of [0, 0.4]) {
      const w = { c: [1, 0.5, -2], h: [0.9, 0.7, 1.6], yaw, lo };
      for (let k = 0; k < 80; k += 1) {
        const p = [1 + Math.sin(k * 1.3) * 2.4, 0.5 + Math.cos(k * 0.7) * 1.4, -2 + Math.sin(k * 2.1 + 0.4) * 2.6];
        // (The shader's turn: q.xz = mat2(c, s, -s, c) * q.xz.)
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        const x = p[0] - w.c[0];
        const z = p[2] - w.c[2];
        const q = [c * x - s * z, p[1] - w.c[1], s * x + c * z];
        assert.ok(Math.abs(shaderWedge(q, w.h, lo) - wedgeDistance(p, w).d) < 1e-9, `yaw ${yaw} lo ${lo} at ${p}`);
      }
    }
  }
});

// A WebGL2 stand-in that records what it's asked to do.
function fakeCanvas() {
  const calls = [];
  const consts = new Proxy({}, { get: (t, k) => (typeof k === "string" ? k : undefined) });
  const gl = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === "string" && /^[A-Z][A-Z0-9_]+$/.test(k)) return consts[k];
      return (...args) => { calls.push([k, args]); return {}; };
    },
  });
  Object.assign(gl, {
    getShaderParameter: () => true, getProgramParameter: (p, k) => (k === "ACTIVE_UNIFORMS" ? 0 : true), getExtension: () => null,
    getParameter: (k) => ({ MAX_FRAGMENT_UNIFORM_VECTORS: 224, MAX_TEXTURE_SIZE: 4096 })[k] ?? 0, getUniformBlockIndex: () => 0, getAttribLocation: () => 0,
    readPixels: (x, y, w, h, f, t, out) => { calls.push(["readPixels", [w, h]]); out.fill(0); },
  });
  return { canvas: { getContext: () => gl, width: 0, height: 0 }, calls };
}

test("the renderer (on a stand-in GL): big palettes, many materials, wedges by list or by kind, fx resolved per target", () => {
  const { canvas, calls } = fakeCanvas();
  const px = createPixelRenderer(canvas, { width: 64, height: 64 });
  // 3000 colours in 120 ramps of 25.
  const colours = Array.from({ length: 3000 }, (_, i) => [i % 256, (i >> 8) & 255, 7]);
  const ramps = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`r${i}`, [i * 25, 25]]));
  px.setPalette(colours, ramps);
  const pal = calls.filter(([k, a]) => k === "texImage2D" && a[2] === "RGBA8" && a[3] === SH.PALETTE_WIDTH);
  assert.equal(pal.at(-1)[1][4], 3, "3000 colours on three rows of 1024");
  assert.equal(px.ramp("r119"), 119);
  px.setMaterials(Array.from({ length: 200 }, (_, i) => ({ ramp: `r${i % 120}` })));
  assert.throws(() => px.setMaterials(Array(256).fill({ ramp: "r0" })), /at most 255/);
  assert.throws(() => px.setPalette(colours, Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`x${i}`, [0, 1]]))), /at most 256/);
  const got = px.setWorld({
    boxes: [{ c: [0, 0, 0], h: [1, 1, 1] }, { c: [0, 2, 0], h: [1, 1, 1], kind: "wedge", lo: 0.2 }],
    wedges: [{ c: [3, 0, 0], h: [1, 1, 2], yaw: 1 }],
    capsules: [{ a: [0, 0, 0], b: [0, 1, 0], r: 0.1 }],
  });
  assert.deepEqual(got, { boxes: 1, wedges: 2, capsules: 1, dropped: 0 });
  const over = px.setWorld({ boxes: Array.from({ length: SH.MAX_BOXES + 5 }, () => ({ c: [0, 0, 0], h: [1, 1, 1] })) });
  assert.equal(over.dropped, 5, "past the limit is reported, not silent");
  px.setFx(ALL_FX());
  assert.equal(px.fxResolved.find((p) => p.name === "scanlines").on, false, "no scanlines at 64");
  px.setTarget(128, 128);
  assert.equal(px.fxResolved.find((p) => p.name === "scanlines").on, true, "re-resolved for the new target");
  px.toggleFx("scanlines", false);
  assert.equal(px.fxResolved.find((p) => p.name === "scanlines").on, false);
  assert.throws(() => px.setFx([{ name: "sparkle" }]), /Unknown fx pass/);
  px.render({ eye: [0, 2, -5], target: [0, 0, 0] });
  assert.ok(calls.some(([k]) => k === "drawArrays"));
  assert.equal(px.offPalette(new Uint8Array([0, 0, 7, 255, 1, 2, 3, 255])), 1, "one pixel off the palette");
});
