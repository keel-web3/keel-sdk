// The realtime pixel pipeline's shaders (WebGL2 / GLSL ES 3.00).
//
// Pass 1 raymarches the world -- boxes and wedges (ramps) turned about y,
// capsules (rails, the character's limbs), an endless water plane and the
// sky -- at the TARGET size, lights it, and writes per pixel, into two
// buffers: lightness, which palette ramp, which material and which thing it
// is; and how much it glows and how squarely it faces the eye. Particles are
// drawn into the same buffers as points, depth-tested against them.
//
// Pass 2 turns that into pixel art: each pixel's lightness picks an entry on
// its ramp, the dither screen breaking the step between two entries, and a
// thing's edge against what's behind it takes a darker entry (the outline).
// The fx (src/fx) run here too, all at the target size and all on the ramps:
// each moves a pixel up or down its ramp, or onto another ramp, BEFORE the
// screen decides the entry -- so a glow's halo, a vignette or fog come out
// dithered in palette entries like everything else.
//
// The world's solids live in uniform blocks (three, each under WebGL2's 16 KB
// baseline block size), the ramps and the materials in float textures: the
// plain uniforms stay far inside the baseline budget (224 vectors).

export const MAX_BOXES = 256;
export const MAX_WEDGES = 128;
export const MAX_CAPS = 256;
export const MAX_RAMPS = 256;
export const MAX_MATERIALS = 255; // (index 255 is the particles')
export const PALETTE_WIDTH = 1024; // (the palette texture's row; colours wrap onto more rows)
export const MAX_COLOURS = PALETTE_WIDTH * 64;
export const SCREEN_TILE = 192; // (every core screen repeats within 192 px: 64, 6, 12, 8, 3 all divide it)
export const FAR = 140;
// Material 4 is the water's and 5 the sky's (the contract WALLRUN's palette keeps).
export const WATER_MAT = 4;
export const SKY_MAT = 5;
export const PARTICLE_MAT = 255;

export const FULLSCREEN_VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// ---------------------------------------------------------------- pass 1: the world

export const WORLD_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
#define MAXB ${MAX_BOXES}
#define MAXW ${MAX_WEDGES}
#define MAXC ${MAX_CAPS}
#define FAR ${FAR.toFixed(1)}
uniform vec2 uRes;
uniform vec3 uEye, uFwd, uRight, uUp;
uniform float uTan, uTime;
uniform int uBoxes, uWedges, uCaps;
// The solids, in uniform blocks (fast to read in the march's inner loop; each block well under the 16 KB baseline).
layout(std140) uniform Boxes { vec4 uBox[2 * MAXB]; };      // [centre, mat][half, yaw]
layout(std140) uniform Wedges { vec4 uWedge[3 * MAXW]; };   // [centre, mat][half, yaw][lo, 0, 0, 0]
layout(std140) uniform Capsules { vec4 uCap[2 * MAXC]; };   // [a, r][b, mat]
uniform sampler2D uMats;   // row 0 per material: ramp, lightness scale, pattern (0 none, 1 checker), emissive
uniform vec3 uSun;
uniform float uWaterY, uFogNear, uFogFar;
layout(location = 0) out vec4 outData;  // lightness, ramp / 255, material / 255, id / 255
layout(location = 1) out vec4 outData2; // glow, facing, 0, 0

float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdCap(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h) - r; }
// A wedge's cross-section in (z, y): the foot at +z (lo x its height), rising to full height at -z.
// Exact for a convex polygon: outside, the nearest edge; inside, the nearest edge's plane.
// (physics/character.js wedgeDistance is the same solid.)
float sdSection(vec2 p, vec2 h, float lo) {
  vec2 v[4] = vec2[4](vec2(-h.x, -h.y), vec2(h.x, -h.y), vec2(h.x, -h.y + 2.0 * h.y * lo), vec2(-h.x, h.y));
  float out2 = 1e18;
  float far = -1e9;
  bool inside = true;
  for (int i = 0; i < 4; i++) {
    vec2 a = v[i];
    vec2 e = v[(i + 1) & 3] - a;
    float L2 = dot(e, e);
    if (L2 < 1e-12) continue;
    vec2 w = p - a;
    vec2 q = w - e * clamp(dot(w, e) / L2, 0.0, 1.0);
    out2 = min(out2, dot(q, q));
    float s = (w.x * e.y - w.y * e.x) * inversesqrt(L2);
    if (s > 0.0) inside = false;
    far = max(far, s);
  }
  return inside ? far : sqrt(out2);
}
float sdWedge(vec3 q, vec3 h, float lo) {
  float a = abs(q.x) - h.x;
  float b = sdSection(q.zy, h.zy, lo);
  return length(max(vec2(a, b), 0.0)) + min(max(a, b), 0.0);
}

// The world: nearest distance and which thing (material in .y, index in .z).
vec3 map(vec3 p) {
  vec3 best = vec3(1e9, -1.0, -1.0);
  for (int i = 0; i < MAXB; i++) {
    if (i >= uBoxes) break;
    vec4 A = uBox[2 * i]; vec4 B = uBox[2 * i + 1];
    vec3 q = p - A.xyz;
    float c = cos(B.w), s = sin(B.w);
    q.xz = mat2(c, s, -s, c) * q.xz; // (world -> the box's frame, core/frame.js: x' = c x - s z, z' = s x + c z)
    float d = sdBox(q, B.xyz);
    if (d < best.x) best = vec3(d, A.w, float(i));
  }
  for (int i = 0; i < MAXW; i++) {
    if (i >= uWedges) break;
    vec4 A = uWedge[3 * i]; vec4 B = uWedge[3 * i + 1];
    float lo = uWedge[3 * i + 2].x;
    vec3 q = p - A.xyz;
    float c = cos(B.w), s = sin(B.w);
    q.xz = mat2(c, s, -s, c) * q.xz; // (the same turn as a box)
    float d = sdWedge(q, B.xyz, lo);
    if (d < best.x) best = vec3(d, A.w, float(200 + i));
  }
  for (int i = 0; i < MAXC; i++) {
    if (i >= uCaps) break;
    vec4 A = uCap[2 * i]; vec4 B = uCap[2 * i + 1];
    float d = sdCap(p, A.xyz, B.xyz, A.w);
    if (d < best.x) best = vec3(d, B.w, float(100 + i));
  }
  return best;
}
vec3 normalAt(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.002;
  return normalize(k.xyy * map(p + k.xyy * e).x + k.yyx * map(p + k.yyx * e).x + k.yxy * map(p + k.yxy * e).x + k.xxx * map(p + k.xxx * e).x);
}
float shadowAt(vec3 p, vec3 l) {
  float res = 1.0, t = 0.05;
  for (int i = 0; i < 24; i++) {
    float h = map(p + l * t).x;
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.04, 0.6);
    if (res < 0.02 || t > 18.0) break;
  }
  return clamp(res, 0.0, 1.0);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }

// Checker tiles on whichever face a point is on, with a dark joint.
float tiles(vec3 p, vec3 n) {
  vec2 uv = abs(n.y) > 0.6 ? p.xz : abs(n.x) > abs(n.z) ? p.zy : p.xy;
  vec2 g = uv * 1.0;
  vec2 f = fract(g);
  float joint = step(0.95, max(f.x, f.y)) * 0.06;
  float chk = mod(floor(g.x) + floor(g.y), 2.0);
  return 0.16 * chk - 0.08 - joint;
}
vec4 matOf(int i) { return texelFetch(uMats, ivec2(i, 0), 0); }

void main() {
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  float aspect = uRes.x / uRes.y;
  vec3 rd = normalize(uFwd + uv.x * uTan * aspect * uRight + uv.y * uTan * uUp);
  vec3 ro = uEye;
  float t = 0.05;
  vec3 hit = vec3(1e9, -1.0, -1.0);
  for (int i = 0; i < 110; i++) {
    vec3 h = map(ro + rd * t);
    if (h.x < 0.0015 * t) { hit = vec3(t, h.y, h.z); break; }
    t += h.x;
    if (t > FAR) break;
  }
  float tw = rd.y < -1e-4 ? (uWaterY - ro.y) / rd.y : 1e9;
  float L; float ramp; float id; float depth; float mat; float glow = 0.0; float facing = 1.0;
  if (tw < hit.x && tw < FAR) {
    // The water: dark and deep, bright where it meets what stands in it, rippled, catching the sky.
    vec3 p = ro + rd * tw;
    float edge = clamp(1.0 - map(p).x / 0.9, 0.0, 1.0);
    float ripple = fbm(p.xz * 1.7 + vec2(uTime * 0.35, uTime * 0.2)) ;
    float glint = step(0.72, fbm(p.xz * 5.0 + uTime * 0.8)) * 0.35 * clamp(1.0 - tw / 40.0, 0.0, 1.0);
    L = 0.1 + 0.16 * ripple * ripple + 0.7 * pow(edge, 3.0) + glint;
    L *= mix(1.0, 0.45, clamp((tw - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0));
    ramp = matOf(${WATER_MAT}).x; id = 254.0; depth = tw / FAR; mat = ${WATER_MAT}.0; facing = -rd.y;
  } else if (hit.y >= 0.0) {
    vec3 p = ro + rd * hit.x;
    vec3 n = normalAt(p);
    int mi = int(hit.y + 0.5);
    vec4 mr = matOf(mi);
    float sh = shadowAt(p + n * 0.01, uSun);
    float diff = max(dot(n, uSun), 0.0) * sh;
    // (Water light: the glow off the water reaches the bottom of walls.)
    float wglow = clamp(1.0 - (p.y - uWaterY) / 1.6, 0.0, 1.0) * max(0.0, -n.y * 0.2 + 0.8) * 0.35;
    L = (0.16 + 0.1 * n.y + 0.5 * diff) * mr.y + wglow + mr.w; // (headroom: the brightest lit face stays under the top of its ramp)
    // (Patterns know the resolution: a tile a few pixels across fades rather than aliasing, and small targets
    // quieten every pattern so the subject still reads.)
    float tilePx = uRes.y / max(hit.x * 2.0 * uTan, 1e-3);
    float patternK = smoothstep(2.5, 7.0, tilePx) * (0.35 + 0.65 * smoothstep(28.0, 96.0, uRes.y));
    if (mr.z > 0.5 && mr.z < 1.5) L += tiles(p, n) * patternK;
    L = mix(L, 0.12, clamp((hit.x - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0));
    ramp = mr.x; id = mod(hit.z, 250.0); depth = hit.x / FAR; mat = float(mi);
    glow = clamp(mr.w, 0.0, 1.0); facing = clamp(dot(n, -rd), 0.0, 1.0);
  } else {
    // The sky: a lid of low cloud, lit warm from somewhere, dark at the horizon.
    float up = max(rd.y, 0.0);
    vec2 sp = rd.xz / (rd.y + 0.12) * 1.4 + vec2(uTime * 0.02, 0.0);
    float cl = fbm(sp) * smoothstep(0.02, 0.35, up);
    L = 0.08 + cl * 0.75;
    ramp = matOf(${SKY_MAT}).x; id = 255.0; depth = 1.0; mat = ${SKY_MAT}.0;
  }
  outData = vec4(clamp(L, 0.0, 1.0), ramp / 255.0, mat / 255.0, id / 255.0);
  outData2 = vec4(glow, facing, 0.0, 0.0);
  gl_FragDepth = clamp(depth, 0.0, 1.0);
}`;

// ---------------------------------------------------------------- particles

// Particles: points in the world, the same projection as the rays.
export const POINTS_VS = `#version 300 es
in vec4 aPos;   // xyz, size
in vec3 aLook;  // lightness, ramp, glow
uniform vec3 uEye, uFwd, uRight, uUp;
uniform float uTan, uAspect, uH;
out vec3 vLook;
void main() {
  vec3 v = aPos.xyz - uEye;
  float z = dot(v, uFwd);
  float depth = length(v) / ${FAR.toFixed(1)};
  gl_Position = z > 0.05 ? vec4(dot(v, uRight) / (z * uTan * uAspect), dot(v, uUp) / (z * uTan), depth * 2.0 - 1.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = max(1.0, aPos.w * 6.0 * (uH / 128.0) / max(z, 0.5)); // (a speck is the same size in the world at any target: fewer pixels, smaller dots)
  vLook = aLook;
}`;
export const POINTS_FS = `#version 300 es
precision highp float;
in vec3 vLook;
layout(location = 0) out vec4 outData;
layout(location = 1) out vec4 outData2;
void main() { outData = vec4(vLook.x, vLook.y / 255.0, ${PARTICLE_MAT}.0 / 255.0, 253.0 / 255.0); outData2 = vec4(vLook.z, 1.0, 0.0, 0.0); }`;

// ---------------------------------------------------------------- pass 2: pixels, and the fx

export const PIXEL_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uData;
uniform sampler2D uData2;
uniform sampler2D uDepth;
uniform sampler2D uPalette; // colours, ${PALETTE_WIDTH} to a row
uniform sampler2D uRamps;   // row 0 per ramp: base, length, cycle from (entry), cycle speed (entries/s); row 1: graded ramp (-1 itself)
uniform sampler2D uScreenTex; // a core screen's thresholds, ${SCREEN_TILE} px square
uniform int uScreen;        // 0 none, 2 / 4 / 8: Bayer size, -1: the screen texture
uniform float uDither;      // how far the screen reaches between two entries (0..1)
uniform float uTime;
// Outline: on, steps darker, the depth gap behind that makes an edge (metres / FAR: 0.56 m the classic, more for outer-only)
uniform vec3 uOutline;
uniform int uOutlineInk;    // palette index to ink with (< 0: darken the pixel's own ramp)
uniform vec4 uFog;          // on, near, far, amount
uniform vec2 uFogLook;      // ramp, lightness it tends to
uniform vec4 uGlow;         // on, halo radius (px), halo steps, self steps
uniform vec2 uGlowK;        // threshold, tint (1: the halo wears the glowing thing's ramp)
uniform vec4 uVig;          // on, inner, outer, steps
uniform vec4 uScan;         // on, period (px), dark rows per period, steps
uniform vec4 uCrt;          // on, curvature, border palette index, 0
uniform vec4 uRim;          // on, width (px), steps, 0
uniform vec2 uRimDir;       // screen direction the light comes from
uniform vec4 uFlash;        // amount, ramp (-1: its own top), id from, id to
uniform ivec4 uFlashMats[2];// up to 8 materials (-1 none)
uniform vec2 uGrade;        // on, shift (entries)
uniform int uCycle;         // on
out vec4 outColor;

float bayer(ivec2 p, int n) {
  if (n == 2) { int m[4] = int[4](0, 2, 3, 1); return (float(m[(p.y & 1) * 2 + (p.x & 1)]) + 0.5) / 4.0; }
  if (n == 4) { int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return (float(m[(p.y & 3) * 4 + (p.x & 3)]) + 0.5) / 16.0; }
  // 8x8 from 4x4
  ivec2 q = p & 7;
  int m4[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  int a = m4[(q.y & 3) * 4 + (q.x & 3)];
  int b = m4[(q.y >> 2) * 4 + (q.x >> 2)];
  return (float(a * 4 + (b & 3)) + 0.5) / 64.0;
}
float screenAt(ivec2 p) {
  if (uScreen > 0) return bayer(p, uScreen);
  if (uScreen < 0) return texelFetch(uScreenTex, p % ${SCREEN_TILE}, 0).r;
  return 0.5;
}
vec4 pal(int i) { return texelFetch(uPalette, ivec2(i % ${PALETTE_WIDTH}, i / ${PALETTE_WIDTH}), 0); }
vec4 rampOf(int r) { return texelFetch(uRamps, ivec2(r, 0), 0); }
bool flashed(int mat, int id) {
  if (uFlash.x <= 0.0) return false;
  if (float(id) >= uFlash.z && float(id) <= uFlash.w) return true;
  for (int k = 0; k < 2; k++) { ivec4 m = uFlashMats[k]; if (m.x == mat || m.y == mat || m.z == mat || m.w == mat) return true; }
  return false;
}

void main() {
  ivec2 size = textureSize(uData, 0);
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec2 res = vec2(size);
  // CRT: bend the picture as a tube does -- whole pixels moved, none invented.
  if (uCrt.x > 0.5) {
    vec2 uv = (vec2(px) + 0.5) / res * 2.0 - 1.0;
    uv *= 1.0 + uCrt.y * dot(uv, uv);
    if (abs(uv.x) > 1.0 || abs(uv.y) > 1.0) { outColor = pal(int(uCrt.z)); return; }
    px = clamp(ivec2(floor((uv * 0.5 + 0.5) * res)), ivec2(0), size - 1);
  }
  vec4 d = texelFetch(uData, px, 0);
  vec4 d2 = texelFetch(uData2, px, 0);
  float z = texelFetch(uDepth, px, 0).r;
  int ramp = int(d.g * 255.0 + 0.5);
  int mat = int(d.b * 255.0 + 0.5);
  int id = int(d.a * 255.0 + 0.5);
  float s = screenAt(ivec2(gl_FragCoord.xy)); // (the screen stays put on the glass, under a CRT's bend too)
  float L = d.r;

  // Colour grading: each ramp swapped for its graded one (day / dusk / night), and shifted along it.
  if (uGrade.x > 0.5) { float g = texelFetch(uRamps, ivec2(ramp, 1), 0).x; if (g >= 0.0) ramp = int(g); }
  // Fog: past its near, pixels go over to the fog's ramp -- the screen decides which, so the edge is dithered.
  if (uFog.x > 0.5 && id != 255) {
    float dist = z * ${FAR.toFixed(1)}; // (depth is the ray's length over FAR)
    float f = clamp((dist - uFog.y) / max(uFog.z - uFog.y, 1e-3), 0.0, 1.0) * uFog.w;
    if (f > s) { ramp = int(uFogLook.x); L = mix(L, uFogLook.y, f); }
  }
  vec4 R = rampOf(ramp);
  int base = int(R.x);
  int len = max(int(R.y), 1);
  float top = float(len - 1);
  float x = L * top;
  if (uGrade.x > 0.5) x += uGrade.y;

  // Glow: what glows climbs its ramp; round it, a halo climbs the ramps of what's near (or wears the glow's).
  if (uGlow.x > 0.5) {
    if (d2.r >= uGlowK.x) x += uGlow.w * d2.r;
    else {
      float best = 0.0;
      int bestRamp = -1;
      float r = uGlow.y;
      // (A golden-angle spiral of taps covers the disc evenly: about one tap per 1.5 px square at the largest radius.)
      int taps = int(clamp(r * r * 1.4, 8.0, 48.0));
      for (int k = 0; k < 48; k++) {
        if (k >= taps) break;
        float a = float(k) * 2.3999632;
        float rr = max(1.0, r * sqrt((float(k) + 0.5) / float(taps)));
        ivec2 q = clamp(px + ivec2(round(vec2(cos(a), sin(a)) * rr)), ivec2(0), size - 1);
        vec4 o2 = texelFetch(uData2, q, 0);
        if (o2.r >= uGlowK.x) {
          float f = rr / (r + 1.0);
          float w = smoothstep(uGlowK.x, uGlowK.x + 0.3, o2.r) * (1.0 - f * f); // (strong glows reach full halo; it falls off outward)
          if (w > best) { best = w; bestRamp = int(texelFetch(uData, q, 0).g * 255.0 + 0.5); }
        }
      }
      if (best > 0.0) {
        if (uGlowK.y > 0.5 && best * 1.6 > s) {
          ramp = bestRamp; R = rampOf(ramp); base = int(R.x); len = max(int(R.y), 1); top = float(len - 1);
          x = (0.35 + 0.4 * best) * top;
        } else x += uGlow.z * best;
      }
    }
  }
  // Rim light: a thing's edge on the light's side, where what's beyond it is far behind, climbs its ramp.
  if (uRim.x > 0.5 && id < 253) {
    ivec2 q = clamp(px + ivec2(round(uRimDir * uRim.y)), ivec2(0), size - 1);
    float oz = texelFetch(uDepth, q, 0).r;
    // (Only a silhouette: another thing, well behind -- a floor seen edge-on is one thing, and gets none.)
    if (abs(texelFetch(uData, q, 0).a - d.a) > 0.5 / 255.0 && oz > z + 0.004) x += uRim.z;
  }
  // Hit flash: the struck thing (by material, or by id) goes up toward white (or onto a flash ramp).
  if (flashed(mat, id)) {
    if (uFlash.y >= 0.0) { ramp = int(uFlash.y); R = rampOf(ramp); base = int(R.x); len = max(int(R.y), 1); top = float(len - 1); x = mix(L * top, top, uFlash.x); }
    else x = mix(x, top + 0.49, uFlash.x);
  }
  // Vignette: the corners step down their ramps.
  if (uVig.x > 0.5) {
    vec2 uv = gl_FragCoord.xy / res * 2.0 - 1.0;
    float r = length(uv * vec2(res.x / res.y, 1.0)) / length(vec2(res.x / res.y, 1.0));
    x -= smoothstep(uVig.y, uVig.z, r) * uVig.w;
  }
  // Scanlines: every so many rows, a step down.
  if (uScan.x > 0.5 && float(int(gl_FragCoord.y) % int(uScan.y)) < uScan.z) x -= uScan.w;

  // The outline: a thing's edge against what's behind it (mode 1), or only across a gap (2: outer only).
  bool edge = false;
  if (uOutline.x > 0.5 && d.a < 0.99) {
    float gap = uOutline.z; // (in depth: metres / FAR)
    for (int k = 0; k < 4; k++) {
      ivec2 o = k == 0 ? ivec2(1, 0) : k == 1 ? ivec2(-1, 0) : k == 2 ? ivec2(0, 1) : ivec2(0, -1);
      ivec2 q = clamp(px + o, ivec2(0), size - 1);
      float other = texelFetch(uData, q, 0).a;
      float oz = texelFetch(uDepth, q, 0).r;
      if (abs(other - d.a) > 0.5 / 255.0 && oz > z + gap) edge = true;
    }
  }
  if (edge && uOutlineInk >= 0) { outColor = pal(uOutlineInk); return; }

  // To an entry: the screen breaks the step between two.
  float th = uScreen == 0 ? 0.0 : s - 0.5;
  x = x + th * uDither;
  int idx = clamp(int(floor(x + 0.5)), 0, len - 1);
  if (edge) idx = max(0, idx - int(uOutline.y));
  // Palette cycling: a ramp's upper entries turn over, so water shimmers and neon runs.
  else if (uCycle == 1 && R.w > 0.0 && idx >= int(R.z)) { int from = int(R.z); idx = from + (idx - from + int(floor(uTime * R.w))) % (len - from); }
  outColor = pal(base + idx);
}`;
