// WALLRUN -- built on the KEEL pixel engine by scripts/build-keel.mjs.
(function __piece() {
const __defs = new Map();
const __cache = new Map();
const __def = (name, fn) => __defs.set(name, fn);
const __mod = (name) => {
  if (!__cache.has(name)) { const box = {}; __cache.set(name, box); Object.defineProperties(box, Object.getOwnPropertyDescriptors(__defs.get(name)())); }
  return __cache.get(name);
};
__def("src/core/frame.js", () => {

const FRONT = Object.freeze([0, 0, 1]);
const RIGHT = Object.freeze([1, 0, 0]);
const UP = Object.freeze([0, 1, 0]);

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const frontOf = (yaw) => [Math.sin(yaw), 0, Math.cos(yaw)];
const rightOf = (yaw) => [Math.cos(yaw), 0, -Math.sin(yaw)];
const yawOf = (dir) => Math.atan2(dir[0], dir[2]);
const yawTo = (from, to) => Math.atan2(to[0] - from[0], to[2] - from[2]);

function localToWorld(pos, yaw, [x, y, z]) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [pos[0] + x * c + z * s, pos[1] + y, pos[2] - x * s + z * c];
}
function worldToLocal(pos, yaw, p) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const dx = p[0] - pos[0];
  const dz = p[2] - pos[2];
  return [dx * c - dz * s, p[1] - pos[1], dx * s + dz * c];
}

function cameraBasis(eye, target) {
  let f = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const fl = Math.hypot(...f) || 1;
  f = f.map((v) => v / fl);
  let r = [f[2], 0, -f[0]]; // UP x f
  const rl = Math.hypot(...r) || 1;
  r = rl < 1e-6 ? [1, 0, 0] : r.map((v) => v / rl);
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]]; // f x r
  return { forward: f, right: r, up: u };
}

function moveFromView(viewYaw, forward, strafe) {
  const f = frontOf(viewYaw);
  const r = rightOf(viewYaw);
  let x = f[0] * forward + r[0] * strafe;
  let z = f[2] * forward + r[2] * strafe;
  const l = Math.hypot(x, z);
  if (l > 1) { x /= l; z /= l; }
  return [x, z];
}

const fromNocturnesYaw = (y) => -y;
const toNocturnesYaw = (y) => -y;

return { get FRONT() { return FRONT; }, get RIGHT() { return RIGHT; }, get UP() { return UP; }, get wrapAngle() { return wrapAngle; }, get frontOf() { return frontOf; }, get rightOf() { return rightOf; }, get yawOf() { return yawOf; }, get yawTo() { return yawTo; }, get localToWorld() { return localToWorld; }, get worldToLocal() { return worldToLocal; }, get cameraBasis() { return cameraBasis; }, get moveFromView() { return moveFromView; }, get fromNocturnesYaw() { return fromNocturnesYaw; }, get toNocturnesYaw() { return toNocturnesYaw; } };
});

__def("src/core/math.js", () => {

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const fract = (v) => v - Math.floor(v);
const smooth = (a, b, v) => {
  const t = sat((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const tri = (v) => 1 - Math.abs(2 * fract(v) - 1);

function hash2(x, y, s = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function hash3(x, y, z, s = 0) {
  return hash2(x, Math.imul(y | 0, 0x1b873593) ^ (z | 0), s);
}

const fade = (t) => t * t * (3 - 2 * t);

function vnoise2(x, y, s = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const a = hash2(xi, yi, s);
  const b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s);
  const d = hash2(xi + 1, yi + 1, s);
  return mix(mix(a, b, u), mix(c, d, u), v);
}

function wrapNoise2(x, y, period, s = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const x0 = ((xi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const a = hash2(x0, yi, s);
  const b = hash2(x1, yi, s);
  const c = hash2(x0, yi + 1, s);
  const d = hash2(x1, yi + 1, s);
  return mix(mix(a, b, u), mix(c, d, u), v);
}

function fbm2(x, y, s = 0, octaves = 3) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * vnoise2(x, y, s + o * 31);
    norm += amp;
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 9.2;
    amp *= 0.5;
  }
  return sum / norm;
}

function loopFbm2(x, y, dx, dy, t, s = 0, octaves = 3) {
  const a = fbm2(x + dx * t, y + dy * t, s, octaves);
  const b = fbm2(x + dx * (t - 1), y + dy * (t - 1), s, octaves);
  return mix(a, b, t);
}


const v3 = (x, y, z) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

return { get TAU() { return TAU; }, get clamp() { return clamp; }, get sat() { return sat; }, get mix() { return mix; }, get fract() { return fract; }, get smooth() { return smooth; }, get tri() { return tri; }, get hash2() { return hash2; }, get hash3() { return hash3; }, get vnoise2() { return vnoise2; }, get wrapNoise2() { return wrapNoise2; }, get fbm2() { return fbm2; }, get loopFbm2() { return loopFbm2; }, get v3() { return v3; }, get add() { return add; }, get sub() { return sub; }, get scale() { return scale; }, get dot() { return dot; }, get cross() { return cross; }, get len() { return len; }, get norm() { return norm; } };
});

__def("src/core/dither.js", () => {

const { fract, tri } = __mod("src/core/math.js");
const BAYER2 = [0, 2, 3, 1];
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const BAYER8 = (() => {
  const out = new Array(64);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const q = BAYER4[(y & 3) * 4 + (x & 3)];
      const b = BAYER2[(y >> 2) * 2 + (x >> 2)];
      out[y * 8 + x] = q * 4 + b;
    }
  }
  return out;
})();


function equalize(shape, w, h, tie = (x, y) => BAYER8[(y & 7) * 8 + (x & 7)]) {
  const cells = [];
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) cells.push([Math.round(shape(x, y) * 1e6), tie(x, y), y * w + x]);
  cells.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const table = new Float32Array(w * h);
  cells.forEach(([, , k], rank) => { table[k] = (rank + 0.5) / cells.length; });
  return (x, y) => table[(((y % h) + h) % h) * w + (((x % w) + w) % w)];
}

const along = (x) => [0, 4, 2, 6, 1, 5, 3, 7][x & 7];

function dotScreen([ax, ay], [bx, by], w, h) {
  const det = ax * by - ay * bx;
  const coords = (x, y) => [(x * by - y * bx) / det, (y * ax - x * ay) / det];
  const shape = (x, y) => {
    const [u, v] = coords(x, y);
    return -(Math.cos(2 * Math.PI * u) + Math.cos(2 * Math.PI * v));
  };
  const tie = (x, y) => {
    const [u, v] = coords(x, y);
    const [i, j] = [Math.round(u), Math.round(v)];
    const dx = x - (i * ax + j * bx);
    const dy = y - (i * ay + j * by);
    const oct = Math.floor((((Math.atan2(dy, dx) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) + 1e-9) & 7;
    return [0, 4, 2, 6, 1, 5, 3, 7][oct];
  };
  return equalize(shape, w, h, tie);
}

const BLUE_NOISE = (() => {
  const s = atob("5mkewUkqf948qxhk/1Z7InJdnyjRPMYG7J5vuSVFfs4icUOTeFyxR58dPbIYZuANoGHAbEzFDJw5+ljabO1AJ643o3lg9rRoBovgpDXGlNyt+kC2evOhaYJS+QPXqpU1uO3UK/Ib4Qf4wG7wUJM5tydE9Bi0eVrYHHQqnBKOt3fNj+sA2xmZT9EsSXQdqwxOMRJu2AlWHjPQFT2GZ+RWCGaHD1SdvYFlky2LBMSp/VvIepgujv9BrIzJsuZPxRlKDFgut0SHMu16vfaQ12LtiM6X7UqRr+C+keOkxy8YwP+hPa/fa0Ex0kzmW9omcBCD5gjbX9EAKOZgRQlqNf6A4mn1gtNvrccOnh9bAblFI3C2XB3DLWR9Q14ic1HqjHVKzRl8yAD8qRC2G6N6ONBKpTRUsT2mb8OCFfaV1apgK6E6mhBQJP1cQWzdrjzogMT3BDuBoOoX/AGo8boSnzyxJZHwWimWUIXsb8tD+bWN7yK/i/gaheFJojO9eiGIArjbILPG4qESkum4MYpvEZkyVafR43FIs47TLoNG2GLzA+BtN7Tlc8QhW5owiQxhF1fechBqyixZEfJm21Q+7NBIdY1hQH1nN89/B1X70ahf1xyKZSgQyjJuUMFmCZInxoRY1BOgQxbZO7IE8lLZqsmYP6LXRa3pmrqJJKcMsVyYE/nLBe4orOZOJqLHG0cp7Hq0P/68k1vcohblm/qwdUOpMLx++mGIneh402S7JHUyfgLwL5JiC3Y1yUl0/McufbtSMNiUvAuKwXbwZZR/vU4O358HS+18C/VAfCU6VuIO95dNBs0tvA5OKow9n+NK9s9ktVXHIfxH2QPknByMbfEhpYRDcVP0XxpC3DCyC/dsyS9cd7E2pymMtF/dvhXMgGEf6W2aU+1rrfrFG3AJkhedKYIR4Im6p4NptFg71wZF3mix/xehOdCzmARU1j+jIZaD684e2mXDTs8NoYVrmS6xxYo9tRnSPoAIWKnst2DBUNX6pUFpMFYX9CuR72SuxZQPWyjF3nwkavx9v2iH41e6RRSbVYoD6nYy/Ukg8EHnTwzWKvR1kSThldgmRIQz5ng9IHHCBOXOm0LTEcAnf1Q06buKTQGU5kYVpyjvETLNAPVxOcH6Qp8crolnxqcA0mihelqlAsBMtDVkfMz3HqIGs49Y7ZV6I2CucIRPpuwcz3I98ahiNa3EWN+PTZ10q2OO3KgnZ4HUWeUH1y9ZeY8p/hrcQuVg/HAV7qUBV5DXYvHJFDSuSO/CC/4y4ABojaEIfxnTdu4RinE60B7H/kDVLFEN5rMQNr9xQJO49xeswEiJu5cxhA2eyE+9OnK/RyuBSp7VZRCHOZNSuZbLNvpM2GebLbpI2Cv4B3qxVg1/GJ/EdYxM9JAfpPMUf0ngN1/sCWkgy6xF138ljeKeE/+pDeR2I/u13GnPIXYVSXu7JK43/FYJgaJhlLzqYy6WuuJe+jy8JaFq20/FYiedbckgeKXTVHLyHF43+BFjLcyFark4wlGQLksDquRd8ajcClnnF42qxvIbz0sYP4fS7WtJJIYF4FrPOwF+Mq3s0wSHst4/K+oEirvfl7d1pulZPyHuXYYSzW6f9n8zw4gnZZ6Kx0vWbyZdOnuu4J0jqwU4krLRbqcZern9l+MNiztb+00OkLV9o0kuawhSyEYFsZHVmgDgou8cv1YZmkYNuT73L3O4A0Hdmb3rAVp0+099wfURTu82lutQKmfMU3Cowi+ga/FX2SHK/rCE7yDXfvMYc0yyNGNGgTngccrzV+J5xBHlXp71hQ5tLI3WNLcb3l8sooIgwmYJjrAaP7si8BB80ibAEjpqj1cXQKA0k187wSz7e8ghrdSUCbMoZ6qOHU6khiHLLk+t/0emEsdlkKRE5W3MWqriR9l385t63kyXYudGi3j1qwvmeMLcbb4U355k0BWR8nQSXfmGQdEFNdVo8DvdeGPDH9Be43lL7wrVIYkB9zoQgyzGEVbVA480zB6vAaXWTb0005clVAf7qk2IC0KlVDe93UmjH+t7nP62ggyxkgjvnII3kxqzKYY6c6zGS5eycvCZXac4tyln/7mDWPcwYBWVdUhj9KiMMXki7LDccOcEZ5svyWusUBdeQibHVUasGEPdBL5q+Zvav1X7MGffKNFAuB75cIfkpVIKPtpzmsfjKe8Dtho/513Vu2sygx+3jf4XeegHOOHDlOagc/iH5XG2XHroPlEHYh6UDYG4E5BXBGqO1AlExRt865MltQxCbIbDoYDObsQUmkIC+E7LXz2sUbyRYLWIKWwA0TIcYDjNKvKXJqnSgLbpQcha7j93/sHiLlCb62Ew061pxlGJ8aoZTjjiUiqGrVLkkcSgDtoof+AlQPQQ10byhVew2sKZGoNJDslvG/MteKjcJp3Qrx2fRH7KsxWDn0oQNvoW3TNbzfVoEZn9Bt4teB5aNXXuk8IGb82ifVWpFbw+kwpLaf2k1rFZOYuiSF4CiGwRUzJmiAztIGU7+7ly6I9dnXm6CJV7JbrUdEG+YvOz1oiwFmVJ95tXMh7Hb90n+m3nLLoCVi9z9tu5FN+88TnD44/xvt5bqXOU2VUB1yi/RM8jathAs+aHMlylkBiDRQn8S8wzqHwT3rf9jjebWoIUpovsd92QHZoFTWmEIZhOryl7BUcmzTL3EsMtjmCmgAbnr0z+KmAATKwP2O84zqVkKnCX6iHQQYhkBUrqC861RtRfPBe0R843e8X9NNVwC/dj16C0dpBSu0J9q+8/GPZuNo8OgqPTkfi/dyhQbhDskdq8AF22au8nrdR5p2Q08HMgrcqC9Wes7V6hD6xYxoakPR1Z+RXnBJ9j6QtszbJPnMle7cVxGDxpHOiGyJe7VSA+fuFHjA/CUpgZ5CfDhg+a5QiWTyoHhBbhKI1F7hYx5XnNlTFpr4XeI9BPmCaF2C0WqT4fTt6pylSePgX/M3bMrhahKvSlNnjMPVmT+0qxWDP5ZeO/nUK2UdB33GqZulITtkbawh1NNHWnN8L5DmTyftFtvJf1CYkt1rhdrRyL6F/6a9JTgOII+Gy8AnIi4M5/tR86dtHzbpM6AbYiP9Ru/4wAg17zmMf9GI5beUa4k00C6S9+Xjhw6xRsgd9Ong1FMJIKxB9gsY0rqNs3n2MVQnHakhNaLhvC7qNc9n4Iqytg6yamPHsIZrHrBNukHjbfoFiwEdfEspRG9SA5zWzBq9x2tECc1koX5kZ8yO+Lw6IAUr3/poneYBOFSsGS5EvPo75Q4xa82VQ7fyzKaunAdCiD90SNJFIG0J+7iAP4I4JOGeVm+TF0yWKcHVcKSizzmSd8Qwq1N3ivK9kONWYedzoTec1qiyqc5L2WQhGJXAvYvRxv5KD9g2YuUOOwWTvumsgthQKPpvIKvuqVuHjWX7Lty2rbVPDJR/yZcrL0nN+P9povs0n4EHAaWvGiS/+rPpZTzA5iM9oZyXkXb5bSagpcrOtRxSNCgDVuKPwThD4OjTUbhZskBIliH8xUFsNXB2ZG6gxhxahK1nzCMNIZf2boMah8u0uvkvGpQusuE6rdNnge1G20WN+Q0Udlo8Hhclyp6b5AcaThvD3pikJ/L6vWI6TckTeB7yauAm2PtSrIBYz5IuACdD1bCIzItX5Eivu/nT4P/6AYugKr2zNUJMb7SgVh1fg0Vg95rAOiz/xwwIZRdCDQCGWUO/lV3kH0Ua9uQ1yVyvYjv9ljH0/yyyVTB2XijnoxaPVTfhuS8J87HZC4Kn0Wsc+V9C9o5SBPDzzyBLD+R7nhUsZ+IaMKdJ3aGM61L4ZPpIIy/J53AGeWuIDMTSK72EOLJsrpbAV8r9lo5J3ITIdkHUjWtliVe7mbXssvmGyFIqMN57dfzociOfB+C+hmEuJtDbg+4qk15xz0L63rVwen5bJhP75N0F8LgzlVCeow26Rwiw45x+0u2xqB51QS7TjXa0STL+RIvWeWU6ZDxq840JlZhRXUUbB1RZ8Ma5LKdhY2hhKb+C2h7iWr+nWZwQ/8JcDygBdnSoyraD+1zp5ds4kW83IPrOoAxCv6diKK9U0d7sssbI0K2V2H0zz5K0qe9M63chyJUMFv1Rq5PF2ATq5gQ5nSpwLjJ8cMjyh1Afssv1HJl1l9QdqNENSdXgd9v2hDl7v+P8AX57Mff77fWW8KUdc83xM1lkVjjiPjnjHSCucpVf1zt1j2fNXvO8VOmXbdHzb9FadvWrlLNObKoSqrBehaJH6ZMXJQm2EDqh2R4SygfrT/d+IFy/BwyADujWmleb4cNoVDoCBMYaOE5A87pmW3hdIt8xzhdLAZbT33itd7FKbhY/fLDe7ZRYT9QK5m8wJhyCmvWZwTSKhVdz3EGNpFj8zsCsRusgjbHlyx9owD5ERhwJo+iAT/jlXcFl5IuDfSSwKqQIonunDRLcN7Gr5DjKVNgvY1voct2boh9lmVCa5dJpXjM/+QvjFv0SNSwXQjkAlTzaZexSScuXfOI/JsiL0qe8NapjgPmmMI7laW2x/lDNMbdd5c/RWSZakz5Wz4fNxIW4AbRHjwoEKA6TOj8bTcdSXqOH1I7TUBr42gCljolPMR4Hf2U+iySKHUMnNbO7pmlUSkB7N6ReIGg8ZMGzq0E6TA2a5UFMoGl2DTDUxrMfeED7TfFMuCUftkLt2zHDZoSZgdyY0ZdcwjgQv5m4TxMMrsJWnSM6DJVbclotaKynLuAWcn6Itk+bYZfZvKG6pJwphuU6ViluAdRMSBQXfYpc8wYqpB3zSR61HGtRetcQFTgMGPTOoYa/o/d+gFYyNQjz+dfcc5rEwu4kD+WYrWA2E21CvxCjC/eKPqEpnxVgVz/LoJg1/AAGk6jmJHItSathQ69QywiCuaE5JSvZz80i3E+E0J2x56wpBtJro5duOm+xmBxXKwTdgHa1PLGrDFJoFO1PApmP6r4SfM51c3/WXhqFpzzlbnv9pn9CxAeBGnYhu4kW2e61cA0akM7JQpVIu1S5U5+RqJOrf+M4RDkOk8nCBxrkZXFHKeBnyoiRpGeinbnB1BewE4sBqE3bdT64bhM1j1PhOw30WCX8dIEs1xBtkg5GOiVeOTHqpu1WEUtuFbyA3ThbvZNPS/EOm+lMsEhjb7tqJci89HpAtoljkGdK7RJMSHaSyV8h9zn/W5POlXqn0I07wne1/dDPMroW8DjjV59TwaW5JLaD1xLF3xrU/IZg7V7CVu8FrG9iLWwEiYEHunUPzJFlOv2jBkgiKYastEkjZr7AHBPpi5Vsz6R73mpiSX6neyJNiYz6kSO23oJJR2MEudtBWRNH9Mq2v+K91j5Qs4o3a9PIwD5k+s/Q4puPQSnEmo91Ehhzp9H5ZkFk1ow0fODfiBBlD7h9WdD7tW8sOEB9NB57wC5IwUW4izRCjNjl3oD/hcpMIUzziJ2HRZ3YDPK4tz0uoGp94x7oHQrwOIMaNewA==");
  const t = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) t[i] = s.charCodeAt(i);
  return t;
})();

const SCREENS = {
  bayer2: { name: "Bayer 2", at: (x, y) => (BAYER2[(y & 1) * 2 + (x & 1)] + 0.5) / 4 },
  bayer4: { name: "Bayer 4", at: (x, y) => (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 },
  bayer8: { name: "Bayer 8", at: (x, y) => (BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64 },
  chunky: { name: "Chunky", at: (x, y) => (BAYER4[((y >> 1) & 3) * 4 + ((x >> 1) & 3)] + 0.5) / 16 },
  halftone: { name: "Halftone", at: dotScreen([3, 3], [3, -3], 6, 6) },
  coarseDot: { name: "Coarse Dot", at: (x, y) => (Math.cos(((x + y) / 6) * Math.PI) * Math.cos(((x - y) / 6) * Math.PI) + 1) * 0.5 },
  lines: { name: "Line Screen", at: (x, y) => tri(y / 3 + 0.5) * 0.9 + (BAYER2[(y & 1) * 2 + (x & 1)] / 4) * 0.1 },
  diagonal: { name: "Diagonal", at: equalize((x, y) => [3, 1, 0, 2][(x + y) & 3], 8, 8, (x, y) => along(x + 4 * ((x + y) >> 2))) },
  hatch: { name: "Crosshatch", at: (x, y) => (tri((x + y) / 4) + tri((x - y) / 4)) * 0.5 },
  stipple: { name: "Stipple", at: (x, y) => (BLUE_NOISE[(y & 63) * 64 + (x & 63)] + 0.5) / 256 },
  ign: { name: "Interleaved", at: (x, y) => fract(52.9829189 * fract(0.06711056 * x + 0.00583715 * y)) },
  checker: { name: "Checker", at: (x, y) => (((x + y) & 1) ? 0.3 : 0.7) },
  weave: { name: "Weave", at: (x, y) => ((((x >> 1) + (y >> 1)) & 1) ? tri(x / 4) : tri(y / 4)) * 0.94 + 0.03 },
};

const SCREEN_IDS = Object.keys(SCREENS);

function measureScreen(at, T = 24) {
  const vals = [];
  for (let y = 0; y < T; y += 1) for (let x = 0; x < T; x += 1) vals.push(at(x, y));
  const levels = new Set(vals.map((v) => v.toFixed(4))).size;
  const bins = new Array(16).fill(0);
  for (const v of vals) bins[Math.min(15, Math.floor(v * 16))] += 1;
  const maxBin = Math.max(...bins) / vals.length;
  const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
  const varr = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length || 1;
  const corr = (dx, dy) => {
    let acc = 0;
    let n = 0;
    for (let y = 0; y < T - 8; y += 1) for (let x = 8; x < T - 8; x += 1) { acc += (at(x, y) - mean) * (at(x + dx, y + dy) - mean); n += 1; }
    return acc / n / varr;
  };
  const shifts = [];
  for (let dy = 0; dy <= 8; dy += 1) for (let dx = -8; dx <= 8; dx += 1) if (dy > 0 || dx > 0) shifts.push({ r: corr(dx, dy), dx, dy });
  const rMax = Math.max(...shifts.map((s) => s.r));
  const best = shifts.filter((s) => s.r > rMax - 0.02).sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy))[0];
  const angle = ((Math.atan2(best.dy, best.dx) * 180) / Math.PI + 180) % 180;
  const unit = [[0, 1, 0], [45, 1, 1], [90, 0, 1], [135, -1, 1]].map(([a, dx, dy]) => [a, corr(dx, dy)]);
  const top = Math.max(...unit.map(([, r]) => r));
  return {
    levels, maxBin, period: +Math.hypot(best.dx, best.dy).toFixed(2), angle: +angle.toFixed(1), r: +best.r.toFixed(2),
    lines: unit.filter(([, r]) => r > top - 0.02).map(([a]) => a),
  };
}

const SCREEN_GEOM = Object.fromEntries(SCREEN_IDS.map((id) => {
  const m = measureScreen(SCREENS[id].at);
  return [id, { period: m.period, angle: m.angle, r: m.r, lines: m.lines }];
}));

function screenIndex(light, x, y, screen, rampLen, lums = null) {
  const steps = screen.steps;
  const v = (light < 0 ? 0 : light > 1 ? 1 : light) * (steps - 1);
  const base = Math.floor(v);
  const threshold = SCREENS[screen.id].at(x, y);
  const entry = (q) => { const at = Math.round((q / (steps - 1)) * (rampLen - 1 - screen.bias)) + (q > 0 ? screen.bias : 0); return at < 0 ? 0 : at >= rampLen ? rampLen - 1 : at; };
  let f = v - base;
  if (lums && f > 0 && base < steps - 1) {
    const L0 = lums[entry(base)];
    const L1 = lums[entry(base + 1)];
    if (L1 > L0 + 1e-6) { const Lt = L0 + f * (L1 - L0); f = (Lt ** 3 - L0 ** 3) / (L1 ** 3 - L0 ** 3); }
  }
  return entry(base + (f > threshold ? 1 : 0));
}

const SCREEN_KIND = {
  bayer2: ["ordered", 1, "grid"], bayer4: ["ordered", 1, "grid"], bayer8: ["ordered", 1, "grid"], chunky: ["ordered", 3, "grid"],
  halftone: ["dot", 2, "diag"], coarseDot: ["dot", 3, "grid"],
  lines: ["line", 2, "h"], diagonal: ["line", 2, "d"], hatch: ["line", 2, "x"],
  stipple: ["noise", 1, "none"], ign: ["noise", 1, "ign"],
  checker: ["pattern", 3, "diag"], weave: ["pattern", 3, "grid"],
};
const SCREEN_PAIRS = {
  "halftone+bayer4": 4, "halftone+bayer8": 3, "coarseDot+bayer8": 4, "coarseDot+bayer4": 3, "hatch+stipple": 4, "lines+halftone": 4,
  "diagonal+ign": 3, "chunky+bayer8": 3, "chunky+bayer4": 2, "hatch+bayer8": 3, "weave+bayer8": 2, "checker+stipple": 0, "halftone+coarseDot": 1,
};
const KIND_PAIRS = {
  "ordered+ordered": 1, "ordered+dot": 3, "ordered+line": 2, "ordered+noise": 2, "ordered+pattern": 1,
  "dot+dot": 1, "dot+line": 3, "dot+noise": 2, "dot+pattern": 1,
  "line+line": 0, "line+noise": 2, "line+pattern": 0,
  "noise+noise": 0, "noise+pattern": 1, "pattern+pattern": 0,
};
function screenPair(a, b) {
  if (a === b) return 0;
  const hit = SCREEN_PAIRS[`${a}+${b}`] ?? SCREEN_PAIRS[`${b}+${a}`];
  if (hit !== undefined) return hit;
  const [ka, ga] = SCREEN_KIND[a];
  const [kb, gb] = SCREEN_KIND[b];
  if (ga === 3 && gb === 3) return 0; // two coarse screens fight
  return KIND_PAIRS[`${ka}+${kb}`] ?? KIND_PAIRS[`${kb}+${ka}`] ?? 1;
}


const TARGET_BANDS = [["tiny", 48], ["small", 128], ["large", Infinity]];

const TARGET_SCREENS = {
  ordered: { tiny: "bayer2", small: "bayer4", large: "bayer8" },
  dot: { tiny: "bayer2", small: "halftone", large: "halftone" },
  line: { tiny: "bayer2", small: "lines", large: "hatch" },
  noise: { tiny: "ign", small: "stipple", large: "stipple" },
  pattern: { tiny: "checker", small: "bayer4", large: "weave" },
};

const TARGET_STEPS = { tiny: 3, small: 5, large: 7 };

const SCREEN_MIN_BAND = {
  bayer2: "tiny", checker: "tiny", ign: "tiny",
  bayer4: "small", halftone: "small", lines: "small", diagonal: "small", stipple: "small",
  bayer8: "large", chunky: "large", coarseDot: "large", hatch: "large", weave: "large",
};

const BAND_ORDER = { tiny: 0, small: 1, large: 2 };

function bandOf(width, height = width) {
  const side = Math.min(width, height);
  for (const [band, max] of TARGET_BANDS) if (side <= max) return band;
  return "large";
}

function screenForTarget(width, height = width, preference = "ordered") {
  const band = bandOf(width, height);
  let family;
  let id;
  if (SCREENS[preference]) {
    family = SCREEN_KIND[preference][0];
    id = BAND_ORDER[SCREEN_MIN_BAND[preference]] <= BAND_ORDER[band] ? preference : TARGET_SCREENS[family][band];
  } else if (TARGET_SCREENS[preference]) {
    family = preference;
    id = TARGET_SCREENS[family][band];
  } else {
    throw new RangeError(`Unknown screen or family: ${preference}`);
  }
  return { id, steps: TARGET_STEPS[band], bias: 0, family, band };
}

return { get SCREENS() { return SCREENS; }, get SCREEN_IDS() { return SCREEN_IDS; }, get measureScreen() { return measureScreen; }, get SCREEN_GEOM() { return SCREEN_GEOM; }, get screenIndex() { return screenIndex; }, get SCREEN_KIND() { return SCREEN_KIND; }, get SCREEN_PAIRS() { return SCREEN_PAIRS; }, get KIND_PAIRS() { return KIND_PAIRS; }, get screenPair() { return screenPair; }, get TARGET_BANDS() { return TARGET_BANDS; }, get TARGET_SCREENS() { return TARGET_SCREENS; }, get TARGET_STEPS() { return TARGET_STEPS; }, get SCREEN_MIN_BAND() { return SCREEN_MIN_BAND; }, get bandOf() { return bandOf; }, get screenForTarget() { return screenForTarget; } };
});

__def("src/fx/fx.js", () => {

const { SCREENS, screenForTarget } = __mod("src/core/dither.js");
const FX_ORDER = ["crt", "grade", "fog", "glow", "rim", "flash", "vignette", "scanlines", "dither", "outline", "cycle"];

const scalePx = (v, side, min = 1, max = 64) => Math.max(min, Math.min(max, Math.round((v * side) / 128)));
const GRADE_PRESETS = { day: { shift: 0 }, dusk: { shift: -0.6 }, night: { shift: -1.4 } };

const FX = {
  crt: { defaults: { curve: 0.08, border: { ramp: 0, index: 0 }, minSize: 64 }, resolve: (p, side) => (side < p.minSize ? { off: `below ${p.minSize} px` } : { curve: p.curve, border: p.border }) },
  grade: {
    defaults: { preset: "day", shift: null, map: {} },
    resolve: (p) => ({ shift: p.shift ?? (GRADE_PRESETS[p.preset] ?? GRADE_PRESETS.day).shift, map: { ...p.map } }),
  },
  fog: { defaults: { ramp: "sky", near: 25, far: 90, amount: 1, light: 0.3 }, resolve: (p) => ({ ...p }) },
  glow: {
    defaults: { radius: 3, halo: 2.5, self: 1, threshold: 0.2, tint: false },
    resolve: (p, side) => ({ ...p, radius: scalePx(p.radius, side, 1, 16) }),
  },
  rim: { defaults: { width: 1, steps: 1.5, dir: "sun" }, resolve: (p, side) => ({ ...p, width: scalePx(p.width, side, 1, 4) }) },
  flash: { defaults: { amount: 0, mats: [], ids: null, ramp: null }, resolve: (p) => ({ ...p, amount: Math.max(0, Math.min(1, p.amount)), mats: p.mats.slice(0, 8) }) },
  vignette: { defaults: { inner: 0.55, outer: 1.1, steps: 2 }, resolve: (p) => ({ ...p }) },
  scanlines: {
    defaults: { period: 2, steps: 1, minSize: 96 },
    resolve: (p, side) => {
      if (side < p.minSize) return { off: `below ${p.minSize} px` };
      const period = Math.max(2, scalePx(p.period, side, 2, 16));
      return { period, dark: Math.max(1, Math.floor(period / 2)), steps: p.steps };
    },
  },
  dither: {
    defaults: { screen: "auto", amount: 0.9 },
    resolve: (p, side, W, H) => {
      if (p.screen === "none" || p.amount <= 0) return { screen: "none", amount: 0 };
      const pref = p.screen === "auto" ? "ordered" : p.screen;
      return { screen: screenForTarget(W, H, pref).id, amount: p.amount };
    },
  },
  outline: {
    defaults: { mode: "all", steps: 3, gap: 1.5, color: null },
    resolve: (p) => (p.mode === "none" ? { off: "mode none" } : { mode: p.mode, steps: p.steps, gap: p.mode === "outer" ? p.gap : 0.56, color: p.color }),
  },
  cycle: {
    defaults: { ramps: {}, speed: 3, from: 0.5 },
    resolve: (p) => {
      const list = Array.isArray(p.ramps) ? Object.fromEntries(p.ramps.map((r) => [r, {}])) : p.ramps;
      return { ramps: Object.fromEntries(Object.entries(list).map(([r, o]) => [r, { speed: o.speed ?? p.speed, from: o.from ?? p.from }])) };
    },
  },
};

const FX_NAMES = Object.keys(FX);

const sideOf = (target) => (typeof target === "number" ? target : Math.min(target.width ?? target[0], target.height ?? target[1]));
const dims = (target) => (typeof target === "number" ? [target, target] : [target.width ?? target[0], target.height ?? target[1]]);

function resolveFx(list = [], target = 128) {
  const [W, H] = dims(target);
  const side = sideOf(target);
  const byName = new Map();
  for (const e of list) {
    if (!e || !FX[e.name]) throw new RangeError(`Unknown fx pass: ${e?.name}`);
    byName.set(e.name, { ...(byName.get(e.name) ?? {}), ...e });
  }
  const out = [];
  for (const name of FX_ORDER) {
    if (!byName.has(name)) continue;
    const { name: _, on = true, ...given } = byName.get(name);
    const def = FX[name];
    const params = { ...def.defaults, ...given };
    if (!on) { out.push({ name, on: false, params, note: "turned off" }); continue; }
    const r = def.resolve(params, side, W, H);
    if (r.off) out.push({ name, on: false, params, note: r.off });
    else out.push({ name, on: true, params: r });
  }
  return out;
}

function toggleFx(list, name, on) {
  if (!FX[name]) throw new RangeError(`Unknown fx pass: ${name}`);
  const has = list.some((e) => e.name === name);
  return has ? list.map((e) => (e.name === name ? { ...e, on } : e)) : [...list, { name, on }];
}

const ALL_FX = () => [
  { name: "grade", preset: "dusk" }, { name: "fog" }, { name: "glow" }, { name: "rim" }, { name: "vignette" },
  { name: "scanlines" }, { name: "dither", screen: "auto" }, { name: "outline", mode: "all" }, { name: "cycle", ramps: ["water"] },
];

function fxUniforms(resolved, look) {
  const on = Object.fromEntries(resolved.filter((p) => p.on).map((p) => [p.name, p.params]));
  const ramp = (r) => (typeof r === "number" ? r : look.ramp(r));
  const entry = (c) => {
    if (c == null) return -1;
    if (typeof c === "number") return c;
    const r = ramp(c.ramp);
    if (r < 0) return -1;
    const [base, len] = look.rampOf(r);
    return base + Math.max(0, Math.min(len - 1, c.index < 0 ? len + c.index : c.index));
  };
  const u = {};
  const style = look.style ?? { screen: 4, dither: 0.9, outline: 1 };
  let screen = style.screen;
  let dither = style.dither;
  if (on.dither) { screen = on.dither.screen; dither = on.dither.amount; }
  else if (resolved.some((p) => p.name === "dither")) { screen = 0; dither = 0; }
  const bayer = { bayer2: 2, bayer4: 4, bayer8: 8, none: 0 };
  if (typeof screen === "string") {
    if (screen in bayer) { u.uScreen = bayer[screen]; screen = null; }
    else if (SCREENS[screen]) u.uScreen = -1;
    else throw new RangeError(`Unknown screen: ${screen}`);
  } else { u.uScreen = screen | 0; screen = null; }
  u.uDither = dither;
  const ol = resolved.find((p) => p.name === "outline");
  if (ol) {
    u.uOutline = ol.on ? [1, ol.params.steps, ol.params.gap / look.far] : [0, 3, 0.004];
    u.uOutlineInk = ol.on ? entry(ol.params.color) : -1;
  } else { u.uOutline = [style.outline ? 1 : 0, 3, 0.004]; u.uOutlineInk = -1; }
  const crt = on.crt;
  u.uCrt = crt ? [1, crt.curve, Math.max(0, entry(crt.border)), 0] : [0, 0, 0, 0];
  u.uGrade = on.grade ? [1, on.grade.shift] : [0, 0];
  const fog = on.fog;
  u.uFog = fog ? [ramp(fog.ramp) >= 0 ? 1 : 0, fog.near, fog.far, fog.amount] : [0, 0, 1, 0];
  u.uFogLook = fog ? [Math.max(0, ramp(fog.ramp)), fog.light] : [0, 0];
  const glow = on.glow;
  u.uGlow = glow ? [1, glow.radius, glow.halo, glow.self] : [0, 1, 0, 0];
  u.uGlowK = glow ? [glow.threshold, glow.tint ? 1 : 0] : [1, 0];
  const rim = on.rim;
  u.uRim = rim ? [1, rim.width, rim.steps, 0] : [0, 1, 0, 0];
  u.uRimDir = rim && Array.isArray(rim.dir) ? rim.dir : null; // (null: the renderer aims it at the sun)
  const fl = on.flash;
  const mats = fl ? [...fl.mats, -1, -1, -1, -1, -1, -1, -1, -1].slice(0, 8) : Array(8).fill(-1);
  u.uFlash = fl ? [fl.amount, fl.ramp == null ? -1 : ramp(fl.ramp), fl.ids ? fl.ids[0] : 1, fl.ids ? fl.ids[1] : 0] : [0, -1, 1, 0];
  u.uFlashMats = mats;
  const vig = on.vignette;
  u.uVig = vig ? [1, vig.inner, vig.outer, vig.steps] : [0, 0, 1, 0];
  const sc = on.scanlines;
  u.uScan = sc ? [1, sc.period, sc.dark, sc.steps] : [0, 2, 0, 0];
  const cy = on.cycle;
  const cycle = [];
  if (cy) {
    for (const [name, o] of Object.entries(cy.ramps)) {
      const r = ramp(name);
      if (r < 0) continue;
      const len = look.rampOf(r)[1];
      cycle.push([r, Math.min(len - 1, Math.max(0, Math.round(o.from * len))), o.speed]);
    }
  }
  u.uCycle = cycle.length ? 1 : 0;
  const grade = [];
  if (on.grade) for (const [from, to] of Object.entries(on.grade.map)) { const a = ramp(from); const b = ramp(to); if (a >= 0 && b >= 0) grade.push([a, b]); }
  return { u, ramps: { cycle, grade }, screen };
}

function screenTile(id, tile = 192) {
  const at = SCREENS[id].at;
  const out = new Uint8Array(tile * tile);
  for (let y = 0; y < tile; y += 1) for (let x = 0; x < tile; x += 1) out[y * tile + x] = Math.max(0, Math.min(255, Math.round(at(x, y) * 255)));
  return out;
}

return { get FX_ORDER() { return FX_ORDER; }, get GRADE_PRESETS() { return GRADE_PRESETS; }, get FX() { return FX; }, get FX_NAMES() { return FX_NAMES; }, get resolveFx() { return resolveFx; }, get toggleFx() { return toggleFx; }, get ALL_FX() { return ALL_FX; }, get fxUniforms() { return fxUniforms; }, get screenTile() { return screenTile; } };
});

__def("src/gpu/shaders.js", () => {

const MAX_BOXES = 256;
const MAX_WEDGES = 128;
const MAX_CAPS = 256;
const MAX_RAMPS = 256;
const MAX_MATERIALS = 255; // (index 255 is the particles')
const PALETTE_WIDTH = 1024; // (the palette texture's row; colours wrap onto more rows)
const MAX_COLOURS = PALETTE_WIDTH * 64;
const SCREEN_TILE = 192; // (every core screen repeats within 192 px: 64, 6, 12, 8, 3 all divide it)
const FAR = 140;
const WATER_MAT = 4;
const SKY_MAT = 5;
const PARTICLE_MAT = 255;

const FULLSCREEN_VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;


const WORLD_FS = `#version 300 es
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


const POINTS_VS = `#version 300 es
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
const POINTS_FS = `#version 300 es
precision highp float;
in vec3 vLook;
layout(location = 0) out vec4 outData;
layout(location = 1) out vec4 outData2;
void main() { outData = vec4(vLook.x, vLook.y / 255.0, ${PARTICLE_MAT}.0 / 255.0, 253.0 / 255.0); outData2 = vec4(vLook.z, 1.0, 0.0, 0.0); }`;


const PIXEL_FS = `#version 300 es
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

return { get MAX_BOXES() { return MAX_BOXES; }, get MAX_WEDGES() { return MAX_WEDGES; }, get MAX_CAPS() { return MAX_CAPS; }, get MAX_RAMPS() { return MAX_RAMPS; }, get MAX_MATERIALS() { return MAX_MATERIALS; }, get PALETTE_WIDTH() { return PALETTE_WIDTH; }, get MAX_COLOURS() { return MAX_COLOURS; }, get SCREEN_TILE() { return SCREEN_TILE; }, get FAR() { return FAR; }, get WATER_MAT() { return WATER_MAT; }, get SKY_MAT() { return SKY_MAT; }, get PARTICLE_MAT() { return PARTICLE_MAT; }, get FULLSCREEN_VS() { return FULLSCREEN_VS; }, get WORLD_FS() { return WORLD_FS; }, get POINTS_VS() { return POINTS_VS; }, get POINTS_FS() { return POINTS_FS; }, get PIXEL_FS() { return PIXEL_FS; } };
});

__def("src/gpu/pixel-renderer.js", () => {

const { cameraBasis } = __mod("src/core/frame.js");
const { ALL_FX, fxUniforms, resolveFx, screenTile, toggleFx } = __mod("src/fx/fx.js");
const { FAR, FULLSCREEN_VS, MAX_BOXES, MAX_CAPS, MAX_COLOURS, MAX_MATERIALS, MAX_RAMPS, MAX_WEDGES, PALETTE_WIDTH, PIXEL_FS, POINTS_FS, POINTS_VS, SCREEN_TILE, WORLD_FS } = __mod("src/gpu/shaders.js");

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

function createPixelRenderer(canvas, { width = 128, height = 128 } = {}) {
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
    limits: {
      boxes: MAX_BOXES, wedges: MAX_WEDGES, capsules: MAX_CAPS, ramps: MAX_RAMPS, materials: MAX_MATERIALS, colours: MAX_COLOURS,
      fragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS), maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    },
    setTarget(w, h) { target(Math.max(8, w | 0), Math.max(8, h | 0)); },
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
    get palette() { return palette; },
    ramp: (name) => rampIndex[name] ?? 0,
    setMaterials(list) {
      if (list.length > MAX_MATERIALS) throw new RangeError(`${list.length} materials: at most ${MAX_MATERIALS}`);
      matRows.fill(0);
      list.forEach((m, i) => { matRows.set([rampIndex[m.ramp] ?? 0, m.light ?? 1, m.pattern ?? 0, m.glow ?? 0], i * 4); });
      gl.bindTexture(gl.TEXTURE_2D, matTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.FLOAT, matRows);
    },
    setStyle({ screen: s = style.screen, dither: d = style.dither, outline: o = style.outline } = {}) {
      style = { screen: s, dither: d, outline: o ? 1 : 0 };
      fxDirty = true;
    },
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
      for (const [blk, n] of [[boxBlock, nBoxes * 8], [wedgeBlock, nWedges * 12], [capBlock, nCaps * 8]]) {
        gl.bindBuffer(gl.UNIFORM_BUFFER, blk.buf);
        if (n) gl.bufferSubData(gl.UNIFORM_BUFFER, 0, blk.data, 0, n);
      }
      return { boxes: nBoxes, wedges: nWedges, capsules: nCaps, dropped: bx.length - nBoxes + wd.length - nWedges + capsules.length - nCaps };
    },
    setFx(list = []) { fxList = list.map((e) => ({ ...e })); resolveFx(fxList, { width: W, height: H }); fxDirty = true; },
    toggleFx(name, on) { fxList = toggleFx(fxList, name, on); fxDirty = true; },
    get fx() { return fxList.map((e) => ({ ...e })); },
    get fxResolved() { if (fxDirty) refreshFx(); return fxResolved; },
    allFx: ALL_FX,
    get gpuMs() { return gpuMs; },
    render({ eye, target: look, fov = 1.2, time = 0, sun = [0.4, 0.8, 0.3], waterY = 0, fogNear = 25, fogFar = 110, particles = [] }) {
      if (fxDirty) refreshFx();
      let timing = false;
      if (timer) {
        if (query && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
          gl.deleteQuery(query); query = null;
        }
        if (!query) { query = gl.createQuery(); gl.beginQuery(timer.TIME_ELAPSED_EXT, query); timing = true; }
      }
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
    read() { const out = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out); return out; },
    offPalette(pixels = api.read()) {
      const set = new Set(palette.map((c) => (c[0] << 16) | (c[1] << 8) | c[2]));
      let off = 0;
      for (let i = 0; i < pixels.length; i += 4) if (!set.has((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2])) off += 1;
      return off;
    },
  };
  return api;
}

return { get createPixelRenderer() { return createPixelRenderer; }, get MAX_BOXES() { return __mod("src/gpu/shaders.js").MAX_BOXES; }, get MAX_CAPS() { return __mod("src/gpu/shaders.js").MAX_CAPS; }, get MAX_COLOURS() { return __mod("src/gpu/shaders.js").MAX_COLOURS; }, get MAX_MATERIALS() { return __mod("src/gpu/shaders.js").MAX_MATERIALS; }, get MAX_RAMPS() { return __mod("src/gpu/shaders.js").MAX_RAMPS; }, get MAX_WEDGES() { return __mod("src/gpu/shaders.js").MAX_WEDGES; } };
});

__def("src/audio/score.js", () => {


const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
};
const MINORISH = new Set(["dorian", "phrygian", "aeolian", "harmonic"]);
const MOVES = {
  major: { 0: [[5, 3], [3, 3], [1, 2], [2, 1], [4, 1]], 1: [[4, 5], [6, 1], [3, 1]], 2: [[5, 3], [3, 2], [1, 1]], 3: [[4, 3], [1, 2], [0, 2], [2, 1]], 4: [[0, 5], [5, 2], [3, 1]], 5: [[1, 3], [3, 3], [4, 1], [2, 1]], 6: [[0, 3], [2, 1]] },
  minor: { 0: [[3, 3], [5, 3], [6, 2], [2, 1], [1, 1]], 1: [[4, 3], [6, 1]], 2: [[5, 2], [3, 2], [6, 1]], 3: [[6, 3], [0, 2], [4, 2], [1, 1]], 4: [[0, 4], [5, 2]], 5: [[2, 2], [6, 3], [3, 2], [1, 1]], 6: [[2, 3], [0, 3], [5, 1]] },
};


const BANDS = {
  "Late Shift": { keys: [["rhodes", 4], ["wurli", 2], ["piano", 1]], lead: [["rhodes", 2], ["vibes", 1], ["guitar", 1], ["kalimba", 1]], bass: [["sub", 2], ["electric", 2], ["upright", 1]], feel: [["dusty", 3], ["boombap", 2], ["rim", 1]], tempo: [68, 90], swing: [0.22, 0.36], room: 0.25, jazz: 0.35, vox: 0.3, scratch: 0.5, bright: 0.5, worn: 0.5 },
  "Retro Den": { keys: [["wurli", 2], ["organ", 2], ["rhodes", 1]], lead: [["chip", 3], ["kalimba", 1]], bass: [["synth", 3], ["electric", 1]], feel: [["chip", 2], ["boombap", 2]], tempo: [80, 93], swing: [0.08, 0.2], room: 0.2, jazz: 0.1, vox: 0.1, scratch: 0.6, bright: 0.6, worn: 0.6, mode: "dorian" },
  Candlelight: { keys: [["felt", 3], ["piano", 2], ["guitar", 1]], lead: [["celesta", 2], ["vibes", 1], ["musicbox", 1]], bass: [["upright", 3], ["sub", 1]], feel: [["brushed", 3], ["soft", 2]], tempo: [66, 80], swing: [0.2, 0.32], room: 0.42, jazz: 0.3, vox: 0.4, scratch: 0.15, bright: 0.35, worn: 0.5, lean: "major" },
  Bedside: { keys: [["felt", 3], ["piano", 1], ["rhodes", 1]], lead: [["musicbox", 3], ["kalimba", 2], ["celesta", 1]], bass: [["sub", 3], ["upright", 1]], feel: [["soft", 3], ["brushed", 1]], tempo: [64, 78], swing: [0.18, 0.28], room: 0.4, jazz: 0.2, vox: 0.25, scratch: 0.1, bright: 0.3, worn: 0.55, lean: "major" },
  "The Reading": { keys: [["rhodes", 2], ["piano", 1], ["felt", 1]], lead: [["celesta", 2], ["kalimba", 1], ["vibes", 1]], bass: [["sub", 3], ["upright", 1]], feel: [["dusty", 2], ["soft", 1]], tempo: [66, 82], swing: [0.18, 0.3], room: 0.48, jazz: 0.25, vox: 0.5, scratch: 0.25, bright: 0.4, worn: 0.6, mode: "dorian" },
  "Night Desk": { keys: [["rhodes", 3], ["piano", 2], ["wurli", 1]], lead: [["rhodes", 1], ["vibes", 1], ["guitar", 1]], bass: [["upright", 3], ["electric", 1]], feel: [["rim", 3], ["dusty", 1]], tempo: [68, 86], swing: [0.26, 0.38], room: 0.3, jazz: 0.45, vox: 0.2, scratch: 0.3, bright: 0.45, worn: 0.45 },
  "Game Night": { keys: [["rhodes", 2], ["wurli", 2], ["organ", 1]], lead: [["chip", 3], ["kalimba", 1]], bass: [["synth", 2], ["electric", 2]], feel: [["boombap", 3], ["chip", 1]], tempo: [80, 93], swing: [0.14, 0.26], room: 0.2, jazz: 0.15, vox: 0.2, scratch: 0.7, bright: 0.6, worn: 0.4, mode: "mixolydian" },
  Nightcap: { keys: [["vibes", 2], ["piano", 2], ["rhodes", 1]], lead: [["vibes", 2], ["guitar", 1], ["rhodes", 1]], bass: [["upright", 4]], feel: [["brushed", 3], ["rim", 1]], tempo: [66, 84], swing: [0.3, 0.4], room: 0.35, jazz: 0.6, vox: 0.2, scratch: 0.15, bright: 0.45, worn: 0.45, mode: "dorian" },
  Collector: { keys: [["felt", 2], ["rhodes", 1], ["wurli", 1]], lead: [["musicbox", 2], ["kalimba", 2]], bass: [["sub", 2], ["electric", 1]], feel: [["boombap", 2], ["dusty", 1]], tempo: [72, 90], swing: [0.18, 0.3], room: 0.3, jazz: 0.2, vox: 0.3, scratch: 0.5, bright: 0.55, worn: 0.5, lean: "major" },
  "Green Sill": { keys: [["felt", 2], ["guitar", 2], ["piano", 1]], lead: [["celesta", 1], ["kalimba", 2], ["musicbox", 1]], bass: [["sub", 2], ["upright", 1]], feel: [["soft", 2], ["brushed", 2]], tempo: [66, 82], swing: [0.18, 0.3], room: 0.38, jazz: 0.25, vox: 0.35, scratch: 0.15, bright: 0.4, worn: 0.5, lean: "major" },
  Mixtape: { keys: [["rhodes", 2], ["wurli", 1], ["piano", 1]], lead: [["rhodes", 1], ["guitar", 1], ["vibes", 1]], bass: [["electric", 2], ["sub", 1]], feel: [["boombap", 3], ["dusty", 1]], tempo: [74, 93], swing: [0.26, 0.36], room: 0.25, jazz: 0.3, vox: 0.35, scratch: 0.8, bright: 0.5, worn: 0.8 },
  "A Room": { keys: [["rhodes", 2], ["felt", 2], ["guitar", 1], ["piano", 1]], lead: [["celesta", 1], ["kalimba", 1], ["vibes", 1]], bass: [["sub", 2], ["upright", 1]], feel: [["dusty", 2], ["soft", 1], ["brushed", 1]], tempo: [66, 86], swing: [0.2, 0.32], room: 0.45, jazz: 0.3, vox: 0.35, scratch: 0.35, bright: 0.45, worn: 0.5 },
  Loose: { keys: [["rhodes", 2], ["felt", 1], ["piano", 1]], lead: [["rhodes", 1], ["celesta", 1], ["kalimba", 1]], bass: [["sub", 2], ["electric", 1]], feel: [["dusty", 2], ["boombap", 1]], tempo: [68, 88], swing: [0.2, 0.32], room: 0.3, jazz: 0.3, vox: 0.3, scratch: 0.4, bright: 0.45, worn: 0.5 },
};

const CHOICES = {
  band: Object.keys(BANDS), kit: ["dusty", "boombap", "brushed", "soft", "rim", "chip"], keys: ["rhodes", "wurli", "piano", "felt", "vibes", "organ", "guitar"],
  lead: ["rhodes", "piano", "celesta", "kalimba", "musicbox", "vibes", "guitar", "chip"], bass: ["sub", "upright", "electric", "synth"], mode: Object.keys(MODES),
  key: ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"],
};
const WEATHER_KINDS = ["rain", "waves", "traffic", "wind", "hush", "crickets", "car", "chimes", "shimmer"];
const ROOM_KINDS = ["vinyl", "crackle", "fan", "hum"];


function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
function streamOf(text) {
  let a = hash(String(text)) || 1;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const weighted = (l) => { let s = 0; for (const [, w] of l) s += w; let r = f() * s; for (const [v, w] of l) { if ((r -= w) < 0) return v; } return l[l.length - 1][0]; };
  return { f, between: (x, y) => x + (y - x) * f(), int: (x, y) => x + Math.floor(f() * (y - x + 1)), pick: (l) => l[Math.floor(f() * l.length)], chance: (p) => f() < p, weighted };
}


function diatonic(mode, d) {
  const sc = MODES[mode];
  const at = (k) => sc[(d + k) % 7] + 12 * Math.floor((d + k) / 7);
  return { root: at(0) % 12, tones: [at(2), at(4), at(6), at(8)], deg: d };
}
const dominantOf = (target) => { const r = (target.root + 7) % 12; return { root: r, tones: [r + 4, r + 7, r + 10, r + 14], deg: -1 }; };
const borrowedIv = (mode) => { const r = MODES[mode][3]; return { root: r, tones: [r + 3, r + 7, r + 10, r + 14], deg: -2 }; };

function progression(S, plan, from, len, cadence) {
  const moves = MOVES[plan.family === "major" ? "major" : "minor"];
  const degs = [from];
  for (let i = 1; i < len; i += 1) degs.push(S.weighted(moves[degs[i - 1]] ?? [[0, 1]]));
  degs[len - 1] = cadence ?? (plan.family === "major" ? S.pick([4, 4, 1]) : S.pick([6, 4, 3]));
  const chords = degs.map((d) => diatonic(plan.mode, d));
  for (let i = 0; i < len - 1; i += 1) {
    if (S.chance(plan.jazz * 0.5) && [1, 2, 5].includes(degs[i + 1])) chords[i] = dominantOf(chords[i + 1]);
    else if (plan.family === "major" && degs[i] === 3 && S.chance(plan.jazz * 0.6)) chords[i] = borrowedIv(plan.mode);
  }
  return chords;
}

function motif(S) {
  const rhythms = [[0, 3, 6, 10, 16, 22], [0, 4, 7, 12, 18], [2, 6, 8, 14, 16, 20, 26], [0, 6, 10, 14, 20, 24], [0, 3, 8, 16, 19, 24], [4, 7, 12, 20, 23, 28]];
  const rhythm = S.pick(rhythms);
  const moves = rhythm.map(() => S.weighted([[1, 3], [-1, 3], [2, 2], [-2, 2], [0, 1], [3, 1], [-3, 1]]));
  return { rhythm, moves, lengths: rhythm.map((s, i) => Math.max(2, (rhythm[i + 1] ?? 32) - s)) };
}

function grooveOf(S, feel) {
  const g = { kick: [0], back: [4, 12], hat: [], ghost: [], open: [], shaker: [] };
  const kicks = {
    dusty: [[10, 0.7], [7, 0.5], [3, 0.2], [13, 0.2], [6, 0.15]], boombap: [[10, 0.6], [3, 0.5], [8, 0.4], [7, 0.35], [14, 0.2]],
    brushed: [[10, 0.5], [8, 0.35], [6, 0.15]], soft: [[8, 0.5], [10, 0.45], [3, 0.1]], rim: [[7, 0.6], [10, 0.6], [3, 0.25]], chip: [[8, 0.8], [11, 0.5], [3, 0.3]],
  }[feel] ?? [[10, 0.6], [7, 0.4]];
  for (const [s, p] of kicks) if (S.chance(p)) g.kick.push(s);
  if (g.kick.length === 1) g.kick.push(10);
  const style = S.weighted(feel === "chip" ? [["16", 3], ["8", 1]] : feel === "brushed" || feel === "soft" ? [["shaker", 3], ["4", 2], ["8", 1]] : [["8", 3], ["16skip", 2], ["swing16", 2], ["4", 1]]);
  g.hat = { 16: [...Array(16).keys()], 8: [0, 2, 4, 6, 8, 10, 12, 14], 4: [0, 4, 8, 12], "16skip": [0, 2, 3, 4, 6, 8, 10, 11, 12, 14], swing16: [0, 2, 4, 6, 7, 8, 10, 12, 14, 15], shaker: [] }[style];
  if (style === "shaker" || (feel !== "chip" && S.chance(0.25))) g.shaker = [0, 2, 4, 6, 8, 10, 12, 14];
  g.ghost = [3, 6, 7, 9, 11, 14, 15].filter(() => S.chance(0.25));
  if (S.chance(0.55)) g.open = [S.pick([6, 14, 10])];
  return g;
}

function keyOf(k) {
  if (typeof k === "string" && Number.isNaN(+k)) { const i = CHOICES.key.indexOf(k.trim()); return i < 0 ? NaN : i; }
  return ((+k % 12) + 12) % 12;
}

function scoreOf(mood = {}, seed = mood.seed, opts = {}) {
  const S = streamOf(`${seed}|music`);
  const o = { ...(mood.pins ?? {}), ...(opts.pins ?? {}) };
  const given = typeof mood.band === "string" ? BANDS[mood.band] : mood.band;
  const theme = o.band || mood.name || (typeof mood.band === "string" ? mood.band : "Loose");
  const band = { ...BANDS.Loose, ...(o.band ? BANDS[o.band] ?? {} : given ?? {}) };
  const keys = o.keys || S.weighted(band.keys);
  const lead = o.lead || S.weighted(band.lead);
  const bass = o.bass || S.weighted(band.bass);
  const kit = o.kit || S.weighted(band.feel);
  const hue = ((mood.hue ?? S.between(0, 360)) % 360 + 360) % 360;
  let tonic = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5][Math.round(hue / 30) % 12];
  let mode = band.mode ?? mood.mode ?? "aeolian";
  if (band.lean === "major" && MINORISH.has(mode)) mode = S.chance(0.6) ? "lydian" : "ionian";
  if (!band.mode && !band.lean && S.chance(0.3)) mode = S.pick(MINORISH.has(mode) ? ["dorian", "aeolian"] : ["ionian", "mixolydian", "lydian"]); // (a seed's own turn)
  if (mood.eclipse) mode = "harmonic"; // (a darker record)
  if (o.mode && MODES[o.mode]) mode = o.mode;
  if (o.key !== undefined && o.key !== "") tonic = keyOf(o.key);
  const family = MINORISH.has(mode) ? "minor" : "major";
  const picture = mood.picture;
  const [lo, hi] = band.tempo;
  let tempo;
  if (typeof picture === "number") {
    const options = [[5, 4], [4, 3], [3, 2], [8, 5], [5, 3], [2, 1], [9, 4], [5, 2], [8, 3], [3, 1]]
      .map(([a, b]) => ({ a, bpm: (240 * a) / b / picture, bars: [32, 36, 40].filter((n) => n % a === 0) }))
      .filter((r) => r.bars.length && r.bpm >= 62 && r.bpm <= 95);
    const mid = (lo + hi) / 2;
    const inRange = options.filter((r) => r.bpm >= lo && r.bpm <= hi);
    const nearest = (want) => options.reduce((best, r) => (Math.abs(r.bpm - want) < Math.abs(best.bpm - want) ? r : best));
    tempo = o.tempo ? nearest(+o.tempo) : inRange.length ? S.pick(inRange) : nearest(mid);
  } else {
    tempo = { bpm: o.tempo ? Math.max(40, Math.min(160, +o.tempo)) : S.between(lo, hi), bars: [32, 36, 40] };
  }
  const bars = S.pick(tempo.bars);
  const FORMS = {
    32: [[["A", 8], ["B", 8], ["A2", 8], ["C", 4], ["T", 4]], [["A", 8], ["A2", 8], ["B", 8], ["C", 4], ["T", 4]], [["A", 8], ["B", 8], ["C", 4], ["B", 8], ["T", 4]]],
    36: [[["A", 8], ["B", 8], ["A2", 8], ["C", 4], ["T", 8]], [["A", 8], ["A2", 8], ["B", 8], ["C", 4], ["T", 8]], [["A", 8], ["B", 8], ["C", 4], ["A2", 8], ["T", 8]]],
    40: [[["A", 8], ["B", 8], ["A2", 8], ["C", 8], ["T", 8]], [["A", 8], ["B", 8], ["C", 4], ["B", 8], ["A2", 8], ["T", 4]], [["A", 8], ["A2", 8], ["B", 8], ["C", 8], ["T", 8]]],
  };
  const form = S.pick(FORMS[bars]);
  const bpm = tempo.bpm;
  const barSec = (60 * 4) / bpm;
  const plan = {
    seed: String(seed), theme, view: mood.view ?? "Stars", eclipse: Boolean(mood.eclipse), mode, family, tonic,
    bpm: Math.round(bpm * 1000) / 1000, barSec, swing: S.between(...band.swing), jazz: band.jazz,
    keys, lead, bass, kit, vox: band.vox, scratch: band.scratch,
    form, loopBars: form.reduce((a, [, n]) => a + n, 0),
  };
  plan.loopSec = plan.loopBars * barSec;
  plan.picture = typeof picture === "number" ? picture : null; // (seconds of the picture's own loop: the music's is a whole number of them)
  plan.comp = S.weighted({
    guitar: [["strum", 3], ["arp", 2], ["stabs", 1]], organ: [["sustain", 3], ["push", 1]], felt: [["arp", 3], ["sustain", 2], ["strum", 1]],
    piano: [["arp", 2], ["stabs", 2], ["sustain", 1], ["push", 1]], vibes: [["stabs", 2], ["arp", 2], ["sustain", 1]],
  }[keys] ?? [["stabs", 3], ["push", 2], ["sustain", 2], ["arp", 1]]);
  plan.bassStyle = S.weighted([["root", 2], ["rootfifth", 3], ["walk", bass === "upright" || band.jazz > 0.4 ? 4 : 1], ["sync", bass === "synth" || bass === "electric" ? 3 : 1]]);
  plan.groove = grooveOf(S, kit);
  const clamp = (x) => Math.max(0, Math.min(1, x));
  plan.design = {
    seed: hash(`${seed}|design`), bright: clamp(band.bright + S.between(-0.2, 0.2)), bell: S.between(6.4, 8.3),
    kickHz: S.between(44, 62), kickDecay: S.between(0.24, 0.55), punch: S.f(),
    snareBody: S.between(160, 235), snareTone: S.between(1300, 3400), snareDecay: S.between(0.1, 0.24), hatTone: S.between(0.82, 1.35),
    bits: Math.max(8, Math.min(14, Math.round(13 - band.worn * 4 + S.between(-1, 1)))), hold: S.chance(0.25 + band.worn * 0.4) ? 2 : 1,
    top: Math.round(5200 + (1 - band.worn) * 4000 + S.between(-800, 800)),
    pump: S.between(0.3, 0.65), strum: S.between(0.004, 0.028), spread: S.pick(["close", "open", "drop2"]),
    back: kit === "rim" ? "rim" : kit === "brushed" ? S.pick(["snare", "rim"]) : S.weighted([["snare", 4], ["clap", 1], ["both", 2]]),
  };
  const len = (name) => Math.max(...form.filter(([n]) => n === name).map(([, n]) => n), 0);
  const A = progression(S, plan, 0, 8);
  const B = progression(S, plan, family === "major" ? S.pick([3, 5]) : S.pick([3, 5, 2]), 8);
  const A2 = A.map((c, i) => (i % 4 === 3 && S.chance(0.5) ? progression(S, plan, c.deg < 0 ? 0 : c.deg, 2)[1] : c));
  const cAlt = diatonic(mode, family === "major" ? S.pick([3, 5]) : S.pick([5, 3]));
  const C = Array.from({ length: Math.max(4, len("C")) }, (_, i) => (i % 2 ? cAlt : diatonic(mode, 0)));
  const T = progression(S, plan, family === "major" ? 1 : 3, Math.max(4, len("T")));
  T[T.length - 1] = family === "major" ? diatonic(mode, 4) : diatonic(mode, 6); // (it leads back to the top)
  const byName = { A, B, A2, C, T };
  plan.bars = form.flatMap(([name, n]) => byName[name].slice(0, n).map((chord, k) => ({ sec: name, k, of: n, chord })));
  plan.motif = motif(S);
  plan.weather = [...(mood.weather ?? ["hush"])];
  plan.room = ["vinyl", ...(mood.room ?? []).filter((r) => r !== "vinyl")];
  const dark = mood.dark ?? 0.72;
  plan.mix = {
    cutoff: Math.round((2400 + 3600 * dark) * (0.85 + 0.3 * plan.design.bright)), tape: Math.min(0.5, 0.1 + 0.3 * band.worn + S.between(0, 0.06)),
    reverb: Math.min(0.6, band.room + (mood.space ?? 0)), wow: S.between(0.1, 0.35) * (0.6 + band.worn),
    level: -4,
  };
  if (mood.energy !== undefined) plan.energy = mood.energy; // (games: where intensity starts)
  return plan;
}


const W = (pairs) => pairs.filter(([, w]) => w > 0.001).map(([v, w]) => [v, Math.round(w * 1000) / 1000]);
const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(+x) ? +x : 0.5));

function moodFor({ energy = 0.5, darkness = 0.6, weather = ["hush"], tempo, hue, name = "Game", room = [], space = 0, pins = {} } = {}) {
  const e = clamp01(energy);
  const k = clamp01(darkness);
  const lo = Math.round(64 + 18 * e);
  const hi = Math.min(96, Math.round(lo + 12 + 4 * e));
  const band = {
    keys: W([["rhodes", 2 + 2 * k], ["wurli", 0.5 + 1.5 * e], ["piano", 1 + k], ["felt", 2 * (1 - e) + (1 - k)], ["vibes", 0.5 + (1 - k)], ["organ", e > 0.5 ? 2 * (e - 0.5) : 0], ["guitar", 1.5 * (1 - k)]]),
    lead: W([["rhodes", 1 + k], ["celesta", 1.5 * (1 - e)], ["kalimba", 1.5], ["musicbox", 2 * (1 - e) * (1 - k)], ["vibes", 1 + 0.5 * k], ["guitar", 1], ["chip", e > 0.6 ? (e - 0.6) * 4 : 0]]),
    bass: W([["sub", 2 + k], ["upright", 1.5 * (1 - e) + 0.5], ["electric", 1 + 2 * e], ["synth", 1.5 * e]]),
    feel: W([["dusty", 1.5 + k], ["boombap", 3 * e + 0.3], ["brushed", 2.5 * (1 - e)], ["soft", 2 * (1 - e) * (1 - k) + 0.2], ["rim", 0.8 + 0.6 * k], ["chip", e > 0.7 ? (e - 0.7) * 3 : 0]]),
    tempo: Array.isArray(tempo) ? [+tempo[0], +tempo[1]] : [lo, hi],
    swing: [0.12 + 0.1 * (1 - e), 0.24 + 0.12 * (1 - e)],
    room: 0.22 + 0.25 * (1 - e), jazz: 0.15 + 0.35 * k * (1 - 0.5 * e), vox: 0.18 + 0.2 * (1 - e), scratch: 0.2 + 0.6 * e,
    bright: 0.35 + 0.3 * (1 - k), worn: 0.45 + 0.15 * k,
  };
  if (k < 0.3) band.lean = "major";
  const mode = k > 0.62 ? "aeolian" : k > 0.4 ? "dorian" : k > 0.2 ? "mixolydian" : "ionian"; // (the seed turns it a third of the time)
  const layers = (Array.isArray(weather) ? weather : [weather]).filter((w) => WEATHER_KINDS.includes(w));
  return {
    name, band, mode, hue, view: name, weather: layers.length ? layers : ["hush"], room: room.filter((r) => ROOM_KINDS.includes(r)),
    dark: 0.3 + 0.35 * (1 - k) + 0.15 * e, space, energy: e,
    pins: typeof tempo === "number" ? { tempo, ...pins } : pins,
  };
}

return { get MODES() { return MODES; }, get MINORISH() { return MINORISH; }, get BANDS() { return BANDS; }, get CHOICES() { return CHOICES; }, get WEATHER_KINDS() { return WEATHER_KINDS; }, get ROOM_KINDS() { return ROOM_KINDS; }, get hash() { return hash; }, get streamOf() { return streamOf; }, get diatonic() { return diatonic; }, get scoreOf() { return scoreOf; }, get moodFor() { return moodFor; } };
});

__def("src/audio/samples.js", () => {

const TAU = Math.PI * 2;


function partials(out, rate, list, vel = 1) {
  const n = out.length;
  for (const [f, a, tau, phase = 0, attack = 0.002] of list) {
    if (f >= rate / 2.2 || a <= 0) continue;
    const w = (TAU * f) / rate;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    let c = Math.cos(phase);
    let s = Math.sin(phase);
    const k = Math.exp(-1 / (tau * rate));
    const at = Math.max(1, Math.round(attack * rate));
    let env = a * vel;
    for (let i = 0; i < n; i += 1) {
      const rise = i < at ? i / at : 1;
      out[i] += s * env * rise;
      const c2 = c * cw - s * sw;
      s = s * cw + c * sw;
      c = c2;
      env *= k;
      if (env < 1e-5) break;
    }
  }
  return out;
}
function noiseOf(seed) {
  let a = seed >>> 0 || 1;
  return () => { a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 2147483648 - 1; };
}
function onePole(x, hz, rate, high = false) {
  const k = Math.exp((-TAU * hz) / rate);
  let y = 0;
  for (let i = 0; i < x.length; i += 1) { y = (1 - k) * x[i] + k * y; x[i] = high ? x[i] - y : y; }
  return x;
}
function bandpass(x, f0, q, rate) {
  const w = (TAU * f0) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const b0 = alpha; const a0 = 1 + alpha; const a1 = -2 * Math.cos(w); const a2 = 1 - alpha;
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const y = (b0 * x[i] - b0 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}
const drive = (x, k) => { const n = Math.tanh(k); for (let i = 0; i < x.length; i += 1) x[i] = Math.tanh(x[i] * k) / n; return x; };
const normalize = (x, peak = 0.9) => { let m = 1e-9; for (const v of x) m = Math.max(m, Math.abs(v)); const g = peak / m; for (let i = 0; i < x.length; i += 1) x[i] *= g; return x; };
function wear(x, rate, { bits = 12, hold = 2, top = 9000, dust = 0 }, rnd) {
  const q = 2 ** (bits - 1);
  let held = 0;
  for (let i = 0; i < x.length; i += 1) {
    if (i % hold === 0) held = Math.round(x[i] * q) / q;
    x[i] = held;
    if (dust && rnd() > 1 - dust) x[i] += rnd() * 0.02;
  }
  return onePole(x, top, rate);
}
const buf = (rate, sec) => new Float32Array(Math.round(rate * sec));


const KEYS = {
  rhodes: (f, v, d, rate) => partials(buf(rate, 3.2), rate, [
    [f, 1, 2.6], [f * 2, 0.22 + 0.2 * d.bright, 1.3], [f * 3, 0.06, 0.7],
    [f * d.bell, 0.3 * v * (0.5 + d.bright), 0.05 + 0.03 * d.bright, 0, 0.001], [f * (d.bell * 1.52), 0.12 * v, 0.03, 0, 0.001],
  ], v),
  wurli: (f, v, d, rate) => partials(buf(rate, 2.4), rate, [[f, 1, 1.6], [f * 2, 0.15, 1], [f * 3, 0.32 * (0.6 + d.bright), 0.6], [f * 5, 0.12 * (0.5 + d.bright), 0.3], [f * 7, 0.05, 0.15]], v),
  piano: (f, v, d, rate) => {
    const list = [];
    const B = 0.00012 * (1 + f / 400);
    for (let n = 1; n <= 9; n += 1) {
      const fn = n * f * Math.sqrt(1 + B * n * n);
      const a = (1 / n ** 1.15) * Math.exp(-(n - 1) * (0.55 - 0.35 * d.bright));
      const tau = 3.2 / (1 + 0.35 * n) * (1 - f / 3000);
      list.push([fn, a * 0.6, tau], [fn * 1.0007, a * 0.4, tau * 0.9, 1.3]);
    }
    return partials(buf(rate, 3.2), rate, list, v);
  },
  felt: (f, v, d, rate) => onePole(KEYS.piano(f, v * 0.9, { ...d, bright: d.bright * 0.3 }, rate), 1600 + 1400 * d.bright, rate),
  vibes: (f, v, d, rate) => partials(buf(rate, 3.4), rate, [[f, 1, 3], [f * 4, 0.18 + 0.12 * d.bright, 0.6], [f * 10, 0.05, 0.15, 0, 0.001]], v),
  organ: (f, v, d, rate) => partials(buf(rate, 2.2), rate, [[f, 0.8, 30, 0, 0.02], [f * 2, 0.45, 30, 0, 0.02], [f * 3, 0.25 * (0.5 + d.bright), 30, 0, 0.02], [f * 4, 0.12, 30, 0, 0.02], [f / 2, 0.3, 30, 0, 0.02]], v),
  guitar: (f, v, d, rate) => pluck(f, v, 2.6, 0.35 + 0.5 * d.bright, 0.996, rate, d.seed),
  kalimba: (f, v, d, rate) => partials(buf(rate, 1.8), rate, [[f, 1, 0.9], [f * 5.4, 0.25 + 0.2 * d.bright, 0.08, 0, 0.001], [f * 2.02, 0.08, 0.4]], v),
  musicbox: (f, v, d, rate) => partials(buf(rate, 1.6), rate, [[f, 1, 0.7], [f * 2.0, 0.35, 0.35], [f * 4.2, 0.2 * (0.6 + d.bright), 0.12, 0, 0.001], [f * 7.9, 0.08, 0.05, 0, 0.001]], v),
  celesta: (f, v, d, rate) => partials(buf(rate, 2), rate, [[f, 1, 1.1], [f * 3.9, 0.22 * (0.6 + d.bright), 0.2, 0, 0.001], [f * 2, 0.1, 0.6]], v),
};

function pluck(f, v, sec, bright, decay, rate, seed) {
  const out = buf(rate, sec);
  const n = Math.max(2, Math.round(rate / f));
  const rnd = noiseOf(seed ^ Math.round(f * 97));
  const line = new Float32Array(n);
  for (let i = 0; i < n; i += 1) line[i] = rnd() * v;
  onePole(line, 1500 + 7000 * bright, rate);
  let p = 0;
  for (let i = 0; i < out.length; i += 1) {
    const a = line[p];
    const b = line[(p + 1) % n];
    line[p] = (a + b) * 0.5 * decay;
    out[i] = a;
    p = (p + 1) % n;
  }
  return out;
}


const BASS = {
  upright: (f, v, d, rate) => onePole(pluck(f, v, 2.2, 0.15, 0.9985, rate, d.seed), 900, rate),
  sub: (f, v, d, rate) => partials(buf(rate, 1.8), rate, [[f, 1, 1.4, 0, 0.012], [f * 2, 0.18, 0.5, 0, 0.012]], v),
  electric: (f, v, d, rate) => onePole(pluck(f, v, 1.8, 0.3, 0.998, rate, d.seed), 1400, rate),
  synth: (f, v, d, rate) => { const list = []; for (let n = 1; n <= 10; n += 1) list.push([f * n, 0.6 / n, 1.2 / (1 + 0.25 * n), 0, 0.004]); return onePole(partials(buf(rate, 1.6), rate, list, v), 700, rate); },
};


const DRUMS = {
  kick: (d, rate) => {
    const x = buf(rate, 0.6);
    const rnd = noiseOf(d.seed ^ 11);
    let ph = 0;
    for (let i = 0; i < x.length; i += 1) {
      const t = i / rate;
      const f = d.kickHz + d.kickHz * 2.6 * Math.exp(-t / 0.035);
      ph += (TAU * f) / rate;
      x[i] = Math.sin(ph) * Math.exp(-t / d.kickDecay) + (t < 0.004 ? rnd() * 0.4 * (1 - t / 0.004) : 0);
    }
    return drive(x, 1.4 + d.punch * 2);
  },
  snare: (d, rate) => {
    const x = partials(buf(rate, 0.45), rate, [[d.snareBody, 0.7, 0.06], [d.snareBody * 1.72, 0.4, 0.04]]);
    const rnd = noiseOf(d.seed ^ 23);
    const wires = buf(rate, 0.45);
    for (let i = 0; i < wires.length; i += 1) wires[i] = rnd() * Math.exp(-i / rate / d.snareDecay);
    bandpass(wires, d.snareTone, 0.8, rate);
    for (let i = 0; i < x.length; i += 1) x[i] += wires[i] * 2.2;
    return drive(normalize(x), 1.3);
  },
  clap: (d, rate) => {
    const x = buf(rate, 0.4);
    const rnd = noiseOf(d.seed ^ 31);
    for (let i = 0; i < x.length; i += 1) {
      const t = i / rate;
      const burst = [0, 0.011, 0.023].reduce((a, s) => a + (t >= s ? Math.exp(-(t - s) / 0.006) : 0), 0);
      x[i] = rnd() * (burst * 0.6 + Math.exp(-t / 0.12) * 0.5);
    }
    return bandpass(x, 1400, 0.9, rate);
  },
  rim: (d, rate) => partials(buf(rate, 0.12), rate, [[1720, 1, 0.012, 0, 0.0005], [460, 0.5, 0.02, 0, 0.0005]]),
  hat: (d, rate, open = false) => {
    const x = buf(rate, open ? 0.5 : 0.09);
    const fs = [205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => f * d.hatTone);
    const rnd = noiseOf(d.seed ^ (open ? 41 : 43));
    const phases = fs.map(() => 0);
    for (let i = 0; i < x.length; i += 1) {
      let s = 0;
      for (let k = 0; k < fs.length; k += 1) { phases[k] += fs[k] / rate; s += phases[k] % 1 < 0.5 ? 1 : -1; }
      x[i] = (s / 6 + rnd() * 0.5) * Math.exp(-i / rate / (open ? 0.22 : 0.028));
    }
    onePole(x, 6500, rate, true);
    return bandpass(x, 9500, 0.7, rate);
  },
  shaker: (d, rate) => {
    const x = buf(rate, 0.12);
    const rnd = noiseOf(d.seed ^ 53);
    for (let i = 0; i < x.length; i += 1) { const t = i / rate; x[i] = rnd() * Math.min(1, t / 0.012) * Math.exp(-t / 0.04); }
    return bandpass(x, 6200, 1.2, rate);
  },
};


const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

function makeSampleData(plan, rate = 44100) {
  const d = plan.design;
  const rnd = noiseOf(d.seed);
  const worn = (x, extra = {}) => wear(x, rate, { bits: d.bits, hold: d.hold, top: d.top, dust: 0.0004, ...extra }, rnd);
  const instrument = (make, lo, hi, step, vel) => {
    const map = {};
    for (let m = lo; m <= hi; m += step) map[m] = normalize(worn(make(midiHz(m), vel, d, rate)), 0.8);
    return map;
  };
  return {
    keys: instrument(KEYS[plan.keys] ?? KEYS.rhodes, 45, 84, 6, 0.8),
    lead: instrument(KEYS[plan.lead] ?? KEYS.celesta, 57, 93, 6, 0.8),
    bass: instrument(BASS[plan.bass] ?? BASS.sub, 28, 52, 6, 0.9),
    drums: Object.fromEntries([
      ["kick", DRUMS.kick(d, rate)], ["snare", DRUMS.snare(d, rate)], ["clap", DRUMS.clap(d, rate)], ["rim", DRUMS.rim(d, rate)],
      ["hat", DRUMS.hat(d, rate)], ["open", DRUMS.hat(d, rate, true)], ["shaker", DRUMS.shaker(d, rate)],
    ].map(([k, x]) => [k, normalize(worn(x, { top: d.top * 0.8 }), 0.9)])),
  };
}

function toAudioBuffer(x, rate, ctx = null) {
  const b = ctx ? ctx.createBuffer(1, x.length, rate) : new AudioBuffer({ length: x.length, numberOfChannels: 1, sampleRate: rate });
  b.copyToChannel(x, 0);
  return b;
}

function makeSamples(plan, rate = 44100) {
  const data = makeSampleData(plan, rate);
  const map = (o) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, toAudioBuffer(x, rate)]));
  return { keys: map(data.keys), lead: map(data.lead), bass: map(data.bass), drums: map(data.drums) };
}


return { get partials() { return partials; }, get noiseOf() { return noiseOf; }, get onePole() { return onePole; }, get bandpass() { return bandpass; }, get drive() { return drive; }, get normalize() { return normalize; }, get wear() { return wear; }, get pluck() { return pluck; }, get KEYS() { return KEYS; }, get BASS() { return BASS; }, get DRUMS() { return DRUMS; }, get midiHz() { return midiHz; }, get makeSampleData() { return makeSampleData; }, get toAudioBuffer() { return toAudioBuffer; }, get makeSamples() { return makeSamples; } };
});

__def("src/audio/player.js", () => {

const { makeSamples } = __mod("src/audio/samples.js");
const { MODES, streamOf } = __mod("src/audio/score.js");
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

function voice(plan, chord, prev) {
  const target = prev ? prev.reduce((a, b) => a + b, 0) / prev.length : 63;
  let out = chord.tones.map((t) => {
    let m = 48 + plan.tonic + t;
    while (m < target - 6) m += 12;
    while (m > target + 6) m -= 12;
    return Math.min(79, Math.max(52, m));
  });
  out = [...new Set(out)].sort((a, b) => a - b);
  if (plan.design?.spread === "open" && out.length > 2 && out[1] - 12 >= 45) out[1] -= 12;
  if (plan.design?.spread === "drop2" && out.length > 2 && out[out.length - 2] - 12 >= 45) out[out.length - 2] -= 12;
  return out.sort((a, b) => a - b);
}

function intensityMix(x, { tempo = 0.04 } = {}) {
  const i = Math.max(0, Math.min(1, Number.isFinite(+x) ? +x : 0.5));
  const s = (a, b) => { const t = Math.max(0, Math.min(1, (i - a) / (b - a))); return t * t * (3 - 2 * t); };
  return {
    intensity: i,
    keys: 1,
    drums: 0.3 + 0.7 * s(0.12, 0.5), // (a soft pulse when idle)
    bass: 0.55 + 0.45 * s(0.08, 0.45),
    lead: s(0.2, 0.5), // (the tune comes in toward the middle)
    focus: 650 * 2 ** (5 * s(0, 0.5)), // (the idle record is heard through a wall; open by the middle)
    lift: s(0.6, 1), // (above the middle: a busier kit on top)
    rate: 1 + tempo * (i - 0.5) * 2, // (the tempo, pushed or laid back by a few percent)
  };
}

function pool(Tone, make, n, tail) {
  const list = Array.from({ length: n }, () => ({ v: make(), free: 0 }));
  return (t, dur, fire) => {
    const d = typeof dur === "number" ? dur : Tone.Time(dur).toSeconds();
    const one = list.find((x) => x.free <= t);
    if (!one) return;
    one.free = t + d + tail;
    fire(one.v, t, d);
  };
}

const DRUM_NOTE = { kick: 24, snare: 26, clap: 27, rim: 28, hat: 30, shaker: 32, open: 34 };

function makePlayers(Tone, plan, outs, cyc) {
  const s = makeSamples(plan, Tone.getContext().sampleRate);
  const keys = new Tone.Sampler({ urls: s.keys, release: plan.keys === "organ" ? 0.25 : 1.1 });
  keys.volume.value = { organ: -15, vibes: -9, guitar: -8, felt: -8 }[plan.keys] ?? -10;
  if (["rhodes", "wurli", "vibes"].includes(plan.keys)) keys.connect(new Tone.Tremolo({ frequency: cyc(plan.keys === "vibes" ? 5 : 3.1), depth: 0.3, spread: 100 }).start(0).connect(outs.keys));
  else keys.connect(outs.keys);
  const echo = new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.28, wet: 0.24 }).connect(outs.lead);
  let lead;
  if (plan.lead === "chip") {
    const voices = pool(Tone, () => { const v = new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.002, decay: 0.25, sustain: 0.15, release: 0.2 } }).connect(echo); v.volume.value = -26; return v; }, 3, 0.3);
    lead = (t, m, dur, vel) => voices(t, dur, (v, tt, d) => v.triggerAttackRelease(midiHz(m), d, tt, vel));
  } else {
    const l = new Tone.Sampler({ urls: s.lead, release: 0.9 });
    l.volume.value = -11;
    l.connect(echo);
    lead = (t, m, dur, vel) => l.triggerAttackRelease(midiHz(m), dur, t, vel);
  }
  const bass = new Tone.Sampler({ urls: s.bass, release: 0.2 });
  bass.volume.value = -5;
  bass.connect(outs.bass);
  const urls = Object.fromEntries(Object.entries(DRUM_NOTE).map(([k, n]) => [n, s.drums[k]]));
  const drums = new Tone.Sampler({ urls, release: 0.6 });
  drums.volume.value = -3;
  drums.connect(outs.drums);
  return {
    keys: (t, notes, dur, vel) => keys.triggerAttackRelease(notes.map(midiHz), dur, t, vel),
    lead,
    bass: (t, m, dur, vel) => bass.triggerAttackRelease(midiHz(m), dur, t, vel),
    hit: (name, t, vel) => drums.triggerAttack(midiHz(DRUM_NOTE[name]), t, vel),
  };
}

function makeVox(Tone, out) {
  const bus = new Tone.Gain(0.5).connect(out);
  const f1 = new Tone.Filter({ frequency: 700, type: "bandpass", Q: 5 }).connect(bus);
  const f2 = new Tone.Filter({ frequency: 1150, type: "bandpass", Q: 6 }).connect(bus);
  const voices = pool(Tone, () => {
    const s = new Tone.MonoSynth({ oscillator: { type: "sawtooth" }, portamento: 0.03, envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.12 }, filterEnvelope: { baseFrequency: 2400, octaves: 0 } });
    s.volume.value = -14;
    s.fan(f1, f2);
    return s;
  }, 2, 0.2);
  return (t, m, dur, vowel = 0) => voices(t, dur, (v, tt, d) => {
    f1.frequency.setValueAtTime(vowel ? 500 : 720, tt);
    f2.frequency.setValueAtTime(vowel ? 880 : 1180, tt);
    v.triggerAttackRelease(midiHz(m), d, tt, 0.7);
  });
}


function makeDeck(Tone, out) {
  const noise = new Tone.Noise("pink");
  const bp = new Tone.Filter({ frequency: 1200, type: "bandpass", Q: 2.2 });
  const gateN = new Tone.Gain(0);
  noise.chain(bp, gateN, out);
  const osc = new Tone.Oscillator(220, "sawtooth");
  const lp = new Tone.Filter({ frequency: 1800, type: "lowpass" });
  const gateO = new Tone.Gain(0);
  osc.chain(lp, gateO, out);
  const start = (t) => { noise.start(t); osc.start(t); };
  const stroke = (t, d, up, hz, level) => {
    const [a, b] = up ? [0.45, 1.6] : [1.6, 0.45];
    bp.frequency.setValueAtTime(900 * a, t);
    bp.frequency.exponentialRampToValueAtTime(900 * b, t + d);
    osc.frequency.setValueAtTime(hz * a, t);
    osc.frequency.exponentialRampToValueAtTime(hz * b, t + d);
    for (const [gate, l] of [[gateN, level], [gateO, level * 0.35]]) {
      gate.gain.setValueAtTime(0, t);
      gate.gain.linearRampToValueAtTime(l, t + d * 0.15);
      gate.gain.setValueAtTime(l, t + d * 0.8);
      gate.gain.linearRampToValueAtTime(0, t + d);
    }
  };
  return {
    start,
    scratch: (t, hz, R, beatSec) => {
      const kind = R.pick(["baby", "baby", "transformer", "chirp"]);
      const n = kind === "transformer" ? 8 : 4;
      const d = beatSec / (n / 2);
      for (let i = 0; i < n; i += 1) stroke(t + i * d, d * (kind === "chirp" ? 0.55 : 0.92), i % 2 === 0, hz, kind === "transformer" && i % 2 ? 0.05 : 0.22);
    },
  };
}


function makeWeather(Tone, plan, out, cyc) {
  const layers = [];
  const db = (x) => 10 ** (x / 20);
  const bed = (type, lo, hi, level) => {
    const n = new Tone.Noise(type);
    const f = new Tone.Filter({ frequency: hi, type: "lowpass" });
    const h = new Tone.Filter({ frequency: lo, type: "highpass" });
    const v = new Tone.Gain(db(level));
    n.chain(h, f, v, out);
    layers.push(n);
    return { n, f, v };
  };
  const swell = (param, rate, lo, hi, lin = false) => new Tone.LFO({ frequency: cyc(rate), min: lin ? lo : db(lo), max: lin ? hi : db(hi) }).start(0).connect(param);
  for (const w of [...plan.weather, ...plan.room]) {
    if (w === "rain") { const r = bed("pink", 400, 3200, -30); swell(r.v.gain, 0.07, -33, -27); }
    else if (w === "waves") { const s = bed("pink", 120, 900, -30); swell(s.f.frequency, 0.11, 300, 1300, true); swell(s.v.gain, 0.11, -40, -27); }
    else if (w === "traffic") { const s = bed("brown", 30, 380, -32); swell(s.v.gain, 0.03, -36, -29); }
    else if (w === "wind") { const s = bed("pink", 200, 700, -38); swell(s.f.frequency, 0.05, 250, 900, true); }
    else if (w === "hush") bed("pink", 900, 6000, -46);
    else if (w === "vinyl") { bed("brown", 500, 2600, -40); const rum = new Tone.Oscillator(cyc(31), "sine"); rum.chain(new Tone.Gain(db(-38)), out); layers.push(rum); } // (the platter's rumble)
    else if (w === "fan") { const s = bed("pink", 180, 1100, -36); swell(s.v.gain, 7.5, -38, -34); }
    else if (w === "hum") { const o = new Tone.Oscillator(cyc(60), "sine"); o.chain(new Tone.Gain(db(-44)), out); layers.push(o); }
    else if (w === "crackle") bed("brown", 1500, 5000, -44);
    else if (w === "shimmer") {
      for (const [k, rate] of [[24, 0.05], [31, 0.071], [36, 0.093]]) {
        const o = new Tone.Oscillator(cyc(midiHz(48 + plan.tonic + k)), "sine"); // (a tone held round the loop comes back in phase)
        const v = new Tone.Gain(0);
        o.chain(v, out);
        swell(v.gain, rate, -62, -40);
        layers.push(o);
      }
    }
  }
  const tickOut = new Tone.Filter({ frequency: 3000, type: "bandpass", Q: 1 });
  tickOut.chain(new Tone.Gain(db(-24)), out);
  const tick = pool(Tone, () => new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.01, sustain: 0 } }).connect(tickOut), 4, 0.05);
  const chirpOut = new Tone.Gain(db(-38)).connect(out);
  const chirp = pool(Tone, () => new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.004, decay: 0.03, sustain: 0, release: 0.02 } }).connect(chirpOut), 6, 0.05);
  const chimeOut = new Tone.Gain(db(-34)).connect(out);
  const chime = pool(Tone, () => new Tone.FMSynth({ harmonicity: 3.1, modulationIndex: 5, envelope: { attack: 0.001, decay: 2.5, sustain: 0, release: 2 } }).connect(chimeOut), 2, 2.5);
  const carN = new Tone.Noise("pink");
  const carF = new Tone.Filter({ frequency: 400, type: "lowpass" });
  const carV = new Tone.Gain(0);
  carN.chain(carF, carV, out);
  layers.push(carN);
  const kinds = [...plan.weather, ...plan.room];
  const events = (t0, t1, R) => {
    for (let t = t0; t < t1; t += 0.05) {
      if (kinds.includes("rain") && R.chance(0.08)) chirp(t, 0.02, (s, tt, d) => s.triggerAttackRelease(R.between(2200, 4200), d, tt, 0.3));
      if (R.chance(kinds.includes("crackle") ? 0.07 : 0.035)) tick(t, 0.01, (s, tt, d) => s.triggerAttackRelease(d, tt, R.between(0.2, 0.9))); // (the record's pops)
      if (kinds.includes("crickets") && R.chance(0.025)) { const f = R.between(4300, 4800); for (let k = 0; k < 3; k += 1) chirp(t + k * 0.06, 0.025, (s, tt, d) => s.triggerAttackRelease(f, d, tt, 0.5)); }
      if (kinds.includes("chimes") && R.chance(0.004)) chime(t, 2, (s, tt, d) => s.triggerAttackRelease(midiHz(84 + plan.tonic + R.pick([0, 7, 12])), d, tt, 0.4));
      if ((kinds.includes("car") || kinds.includes("traffic")) && R.chance(0.003)) {
        const d = R.between(2.5, 4);
        carV.gain.setValueAtTime(0, t);
        carV.gain.linearRampToValueAtTime(db(-30), t + d * 0.5);
        carV.gain.linearRampToValueAtTime(0, t + d);
        carF.frequency.setValueAtTime(900, t);
        carF.frequency.exponentialRampToValueAtTime(260, t + d);
      }
    }
  };
  return { start: (t) => layers.forEach((l) => l.start(t)), events };
}


function play(Tone0, plan, out = null, { start = true, from = 0, intensity = plan.energy ?? 0.5, tempo = 0.04 } = {}) {
  const made = [];
  const Tone = new Proxy(Tone0, {
    get(t, k) {
      const v = t[k];
      if (typeof v !== "function" || !/^[A-Z]/.test(k) || !v.prototype?.dispose) return v;
      return new Proxy(v, { construct(C, args) { const o = new C(...args); made.push(o); return o; } });
    },
  });
  const T = Tone.getTransport();
  let mix = intensityMix(intensity, { tempo });
  T.bpm.value = plan.bpm * mix.rate;
  T.swing = plan.swing;
  T.swingSubdivision = "16n";
  const d = plan.design;
  const cyc = (hz) => Math.max(1, Math.round(hz * plan.loopSec)) / plan.loopSec;

  const master = new Tone.Volume(plan.mix.level);
  const comp = new Tone.Compressor({ threshold: -32, ratio: 8, knee: 12, attack: 0.05, release: 0.4 });
  const tone = new Tone.Filter({ frequency: plan.mix.cutoff, type: "lowpass", rolloff: -12 });
  new Tone.LFO({ frequency: 1 / plan.loopSec, min: plan.mix.cutoff * 0.72, max: plan.mix.cutoff * 1.2, phase: 90 }).start(0).connect(tone.frequency);
  const warm = new Tone.Filter({ frequency: 90, type: "highshelf", gain: 0 }); // (placeholder stage kept flat: the samples carry their own colour)
  const reel = new Tone.Delay({ delayTime: 0.002, maxDelay: 2 });
  const reelLevel = new Tone.Gain(1);
  const tape = new Tone.Distortion({ distortion: 0.22, wet: plan.mix.tape, oversample: "none" });
  const room = new Tone.Reverb({ decay: 2 + plan.mix.reverb * 4, preDelay: 0.02, wet: plan.mix.reverb });
  const limit = new Tone.Limiter(-3);
  const ceiling = new Tone.WaveShaper((x) => (Math.tanh(x * 1.2) / Math.tanh(1.2)) * 0.97, 1024);
  tone.chain(warm, reel, reelLevel, tape, room, comp, master, limit, ceiling);
  ceiling.connect(out ?? Tone.getDestination());
  const focus = new Tone.Filter({ frequency: Math.min(20000, mix.focus), type: "lowpass", rolloff: -12, Q: 0.5 });
  focus.connect(tone);
  const wow = new Tone.Vibrato({ frequency: cyc(plan.mix.wow + 0.25), depth: 0.04 + plan.mix.wow * 0.08 });
  wow.connect(focus);
  const level = (x, to) => new Tone.Gain(x).connect(to);
  const layer = { keys: level(mix.keys, wow), lead: level(mix.lead, wow), bass: level(mix.bass, focus), drums: level(mix.drums, focus) };
  const duck = new Tone.Gain(1);
  duck.connect(layer.keys);
  const drumBus = new Tone.Compressor({ threshold: -18, ratio: 4, attack: 0.005, release: 0.12 });
  drumBus.chain(new Tone.Filter({ frequency: Math.min(9000, d.top * 1.1), type: "lowpass" }), layer.drums);
  const band = makePlayers(Tone, plan, { keys: duck, lead: layer.lead, bass: layer.bass, drums: drumBus }, cyc);
  const vox = makeVox(Tone, duck);
  const deck = makeDeck(Tone, comp);
  const weather = makeWeather(Tone, plan, comp, cyc);
  const pad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "fatsawtooth", count: 3, spread: 16 }, envelope: { attack: 1.2, decay: 1, sustain: 0.7, release: 2.5 } });
  pad.volume.value = -28;
  pad.chain(new Tone.Filter({ frequency: 800, type: "lowpass", rolloff: -24 }), duck);
  const riser = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: (60 / plan.bpm) * 3.8, decay: 0.01, sustain: 1, release: 0.05 } });
  riser.chain(new Tone.Filter({ frequency: 5000, type: "highpass" }), new Tone.Gain(0.05), comp);

  const sc = MODES[plan.mode];
  const L = plan.loopBars;

  function melody(bar) {
    const m = plan.motif;
    const home = 69 + plan.tonic - (plan.tonic > 5 ? 12 : 0);
    const startOn = (chord) => { const cand = chord.tones.map((x) => home - 5 + ((x - (home - 5 - plan.tonic)) % 12 + 12) % 12); return cand.reduce((a, b) => (Math.abs(b - home) < Math.abs(a - home) ? b : a)); };
    const half = bar.k % 2;
    const phraseFirst = plan.bars[(bar.index - half + L) % L];
    let moves = m.moves;
    let shift = 0;
    const part = Math.floor(bar.k / 2);
    if (bar.sec === "B") { if (part === 2) moves = moves.map((x) => -x); if (part === 3) shift = 2; }
    let p = startOn(phraseFirst.chord);
    const notes = [];
    m.rhythm.forEach((s, i) => {
      p += moves[i];
      const step = s + shift;
      if (Math.floor(step / 16) !== half) return;
      const want = step % 4 === 0 ? bar.chord.tones.map((x) => (x + plan.tonic) % 12) : sc.map((x) => (x + plan.tonic) % 12);
      let q = p;
      for (let k = 0; k < 7 && !want.includes(((q % 12) + 12) % 12); k += 1) q += k % 2 ? -k : k;
      notes.push([step % 16, Math.max(60, Math.min(88, q)), Math.min(m.lengths[i], 8)]);
    });
    if (bar.sec === "B" && bar.k === bar.of - 1 && notes.length) notes[notes.length - 1][2] = 12;
    return notes;
  }

  const bar = (time, n) => {
    const sixteenth = Tone.Time("16n").toSeconds();
    const beat = sixteenth * 4;
    const index = ((n % L) + L) % L;
    const b = { ...plan.bars[index], index };
    const R = streamOf(`${plan.seed}|bar|${index}`);
    const next = plan.bars[(index + 1) % L];
    const prevChord = plan.bars[(index - 1 + L) % L].chord;
    const notes = voice(plan, b.chord, voice(plan, prevChord, null));
    const root = 36 + ((plan.tonic + b.chord.root) % 12);
    const toNext = 36 + ((plan.tonic + next.chord.root) % 12);
    const at = (step) => Math.max(time, time + step * sixteenth + R.between(-0.006, 0.012)); // (a hand's looseness, never before the bar)
    const sec = b.sec;
    const last = b.k === b.of - 1;
    const gr = plan.groove;

    const chordAt = (t, dur, vel) => {
      notes.forEach((m, i) => band.keys(t + i * d.strum, [m], dur, vel * R.between(0.85, 1.05)));
    };
    if (sec === "C") chordAt(at(0), "1m", 0.5);
    else if (plan.comp === "arp") {
      const up = [...notes, notes[0] + 12, notes[1] + 12];
      const steps = sec === "B" ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 3, 6, 8, 11, 14];
      const path = R.pick([[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 1, 3, 2, 4, 3, 1], [4, 3, 2, 1, 0, 1, 2, 3]]);
      steps.forEach((s, k) => band.keys(at(s), [up[path[k % path.length] % up.length]], "8n", R.between(0.35, 0.55)));
      if (R.chance(0.5)) band.keys(at(0), [notes[0]], "2n", 0.35);
    } else {
      const hits = {
        sustain: sec === "B" ? [[0, "2n", 0.6], [8, "2n", 0.45]] : [[0, "1m", 0.6]],
        push: [[0, "8n", 0.6], [7, "4n", 0.5], [14, "8n", 0.42]],
        strum: [[0, "4n.", 0.62], [6, "8n", 0.38], [8, "4n", 0.55], [14, "8n", 0.35]],
        stabs: sec === "B" ? R.pick([[[0, "4n.", 0.62], [6, "8n", 0.4], [10, "4n", 0.5]], [[0, "8n", 0.6], [3, "8n", 0.4], [8, "4n.", 0.55]]]) : R.pick([[[0, "2n", 0.6], [10, "4n", 0.45]], [[0, "4n.", 0.6], [11, "8n", 0.4]]]),
      }[plan.comp] ?? [[0, "2n", 0.6]];
      for (const [s, dur, v] of hits) if (s === 0 || R.chance(0.85)) chordAt(at(s), dur, v);
    }
    if (sec === "C" || (sec === "A2" && R.chance(0.3))) pad.triggerAttackRelease(notes.map(midiHz), "1m", time, 0.5);

    if (sec === "C") { if (b.k === 0) band.bass(at(0), root, "1m", 0.7); }
    else {
      const third = root + (b.chord.tones[0] - b.chord.root + 24) % 12;
      const fifth = root + 7;
      const line = {
        root: [[0, root, "2n"], [10, root, "8n"]],
        rootfifth: [[0, root, "4n."], [8, fifth, "4n"], [14, toNext + R.pick([-1, 1]), "16n"]],
        walk: [[0, root, "4n"], [4, R.pick([third, fifth]), "4n"], [8, R.pick([fifth, root + 9, root + 12]), "4n"], [12, toNext + R.pick([-1, 1, -2]), "4n"]],
        sync: [[0, root, "8n."], [3, root, "16n"], [7, root + 12, "8n"], [10, root, "8n"], [14, fifth, "16n"]],
      }[plan.bassStyle];
      for (const [s, m, dur] of line) if (s === 0 || R.chance(sec === "A" ? 0.75 : 0.9)) band.bass(at(s), m, dur, s === 0 ? 0.9 : 0.7);
    }

    if (sec === "C") {
      if (b.k % 2 === 0) band.hit("kick", at(0), 0.55);
      for (const s of [0, 4, 8, 12]) band.hit(gr.shaker.length ? "shaker" : "hat", at(s), 0.25);
    } else {
      const kicks = [...gr.kick];
      if (sec !== "A" && R.chance(0.35)) kicks.push(R.pick([3, 11, 13, 15]));
      for (const s of kicks) {
        band.hit("kick", at(s), R.between(0.78, 0.98));
        duck.gain.setValueAtTime(1 - d.pump, at(s));
        duck.gain.linearRampToValueAtTime(1, at(s) + beat * 0.65);
      }
      for (const s of gr.back) {
        const v = R.between(0.66, 0.86);
        if (d.back === "rim") band.hit("rim", at(s), v);
        else if (d.back === "clap") band.hit("clap", at(s), v);
        else { band.hit("snare", at(s), v); if (d.back === "both") band.hit("clap", at(s) + 0.008, v * 0.6); }
      }
      for (const s of gr.hat) band.hit(gr.open.includes(s) && R.chance(sec === "B" ? 0.7 : 0.35) ? "open" : "hat", at(s), (s % 4 === 0 ? 0.62 : 0.4) * R.between(0.8, 1.1));
      for (const s of gr.shaker) band.hit("shaker", at(s), (s % 4 === 2 ? 0.45 : 0.3) * R.between(0.8, 1.1));
      if (sec !== "A") for (const s of gr.ghost) if (R.chance(0.6)) band.hit(d.back === "rim" ? "rim" : "snare", at(s), 0.16);
      if (last && sec !== "T") for (const s of [12, 13, 14, 15]) if (s > 12 || R.chance(0.5)) band.hit("snare", at(s), R.between(0.3, 0.55));
      if (mix.lift > 0) {
        const U = streamOf(`${plan.seed}|bar|${index}|lift`);
        for (const s of [1, 3, 5, 7, 9, 11, 13, 15]) if (!gr.hat.includes(s) && U.chance(mix.lift * 0.8)) band.hit("hat", at(s), 0.22 * U.between(0.8, 1.1));
        if (U.chance(mix.lift * 0.5)) band.hit("kick", at(U.pick([6, 14, 15])), 0.6);
        if (!gr.shaker.length && U.chance(mix.lift * 0.6)) for (const s of [2, 6, 10, 14]) band.hit("shaker", at(s), 0.2);
      }
    }

    if (sec === "B") for (const [s, m, len] of melody(b)) band.lead(at(s), m, len * sixteenth, R.between(0.5, 0.75));
    if (sec === "A2" && b.k % 2 === 1) for (const [s, m] of melody(b).slice(-2)) band.lead(at(s), m + (R.chance(0.5) ? 12 : 0), "8n", 0.45);
    if ((sec === "T" || (sec === "A2" && R.chance(plan.vox))) && R.chance(0.3 + plan.vox)) {
      const tones = notes.slice(-3);
      for (const s of R.pick([[0, 3, 6], [2, 6, 10, 11], [0, 6, 8, 14]])) vox(at(s), R.pick(tones) + 12, sixteenth * R.pick([1.5, 2, 3]), R.int(0, 1));
    }
    if (last && sec !== "C" && R.chance(plan.scratch)) deck.scratch(at(12), midiHz(root + 24), R, beat);
    if (sec === "T" && b.k === 0 && R.chance(plan.scratch)) deck.scratch(at(0), midiHz(root + 24), R, beat);
    if (index === L - 1) {
      const t0 = time + 12 * sixteenth;
      const curve = new Float32Array(32).map((_, i) => 0.002 + ((i / 31) * beat) ** 2 / (2 * beat));
      reel.delayTime.setValueCurveAtTime(curve, t0, beat * 0.98);
      reelLevel.gain.setValueAtTime(1, t0 + beat * 0.6);
      reelLevel.gain.linearRampToValueAtTime(0, t0 + beat * 0.97);
      reel.delayTime.setValueAtTime(0.002, t0 + beat);
      reelLevel.gain.setValueAtTime(1, t0 + beat);
    }
    if (sec === "C" && last) riser.triggerAttackRelease(beat * 3.9, time);
    weather.events(time, time + 16 * sixteenth, R);
  };

  let n = from;
  const loop = new Tone.Loop((time) => { bar(time, n); n += 1; }, "1m");
  deck.start(0);
  weather.start(0);
  loop.start(0);
  if (start) { T.stop(); T.position = 0; T.start("+0.05"); } // (from the top, whatever played before)

  return {
    ready: room.ready, // (the reverb's room is worked out before it sounds)
    stop: (fade = 0.4, { transport = true } = {}) => {
      loop.dispose();
      master.volume.rampTo(-80, fade);
      if (transport) T.stop(); // (at once -- a stop left pending in a context that's then suspended would fire after the next start)
      setTimeout(() => { for (const o of made) { try { o.dispose(); } catch {} } }, fade * 1000 + 80);
    },
    react: (what) => {
      const now = Tone.now();
      if (what === "dim") master.volume.rampTo(plan.mix.level - 4, 1.2, now);
      if (what === "bright") master.volume.rampTo(plan.mix.level, 1.2, now);
    },
    setIntensity(x, ramp = 1.2) {
      const next = intensityMix(x, { tempo });
      if (Math.abs(next.intensity - mix.intensity) < 0.01) return; // (called every step: only a real change moves anything)
      mix = next;
      for (const k of ["keys", "lead", "bass", "drums"]) layer[k].gain.rampTo(mix[k], ramp);
      focus.frequency.exponentialRampTo(Math.min(20000, mix.focus), ramp);
      if (tempo) T.bpm.rampTo(plan.bpm * mix.rate, ramp * 2);
    },
    get intensity() { return mix.intensity; },
  };
}

async function render(Tone, plan, { preroll = 4, intensity, rate = 44100, overrun = 0 } = {}) {
  const pre = preroll * plan.barSec;
  const buf = await Tone.Offline(async () => {
    const band = play(Tone, plan, null, { start: false, from: plan.loopBars - preroll, intensity: intensity ?? plan.energy ?? 0.5, tempo: 0 });
    await band.ready;
    Tone.getTransport().start(0);
  }, pre + plan.loopSec + overrun, 2, rate);
  const raw = buf.get?.() ?? buf;
  const skip = Math.round(pre * raw.sampleRate);
  const len = Math.round((plan.loopSec + overrun) * raw.sampleRate);
  const out = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: raw.sampleRate });
  for (let c = 0; c < 2; c += 1) out.copyToChannel(raw.getChannelData(c).subarray(skip, skip + len), c);
  return out;
}

return { get midiHz() { return midiHz; }, get voice() { return voice; }, get intensityMix() { return intensityMix; }, get play() { return play; }, get render() { return render; } };
});

__def("src/audio/sfx.js", () => {

const { bandpass, noiseOf, normalize, onePole, partials, wear } = __mod("src/audio/samples.js");
const { hash, streamOf } = __mod("src/audio/score.js");
const TAU = Math.PI * 2;


const SURFACES = ["stone", "metal", "water"];
const SFX_NAMES = ["step", "jump", "land", "wallStart", "wallJump", "railStart", "railEnd", "splash", "skimStart", "respawn", "blip", "select", "back", "confirm", "error", "hover"];
const LOOP_NAMES = ["grind", "wallrun", "skim", "wind"];

const STYLES = {
  lofi: { bright: 0.45, bits: 11, hold: 2, top: 7000, wave: "triangle", room: 0.25 },
  clean: { bright: 0.6, bits: 16, hold: 1, top: 14000, wave: "sine", room: 0.12 },
  chip: { bright: 0.7, bits: 6, hold: 3, top: 9000, wave: "square", room: 0.05 },
  soft: { bright: 0.3, bits: 12, hold: 2, top: 4500, wave: "sine", room: 0.35 },
};
const STYLE_NAMES = Object.keys(STYLES);

function sfxStyle(seed = "1", style = "lofi") {
  const given = typeof style === "string" ? { name: style } : { ...style };
  const preset = STYLES[given.name] ?? STYLES.lofi;
  const S = streamOf(`${seed}|sfx`);
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const metal = [1, S.between(2.6, 2.9), S.between(5.1, 5.6), S.between(8.4, 9.3)];
  return {
    name: given.name ?? "lofi",
    pitch: S.between(0.88, 1.14), bright: clamp(preset.bright + S.between(-0.15, 0.15)), weight: S.between(0.3, 0.8),
    bits: Math.max(4, Math.min(16, preset.bits + S.int(-1, 1))), hold: preset.hold, top: Math.round(preset.top * S.between(0.85, 1.1)),
    shoe: S.pick(["sneaker", "boot", "soft"]), metal, metalHz: S.between(520, 860), water: S.between(0.75, 1.3), wind: S.between(0.8, 1.2),
    tonic: S.int(0, 11), wave: preset.wave, room: preset.room, seed: hash(`${seed}|sfx|make`),
    ...Object.fromEntries(Object.entries(given).filter(([k]) => k !== "name")),
  };
}


const buf = (rate, sec) => new Float32Array(Math.max(1, Math.round(rate * sec)));
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

function sweep(x, hzAt, q, rate, type = "band") {
  let low = 0;
  let band = 0;
  const damp = 1 / q;
  for (let i = 0; i < x.length; i += 1) {
    const f = 2 * Math.sin(Math.PI * Math.min(rate / 6.5, Math.max(20, hzAt(i / rate))) / rate);
    low += f * band;
    const high = x[i] - low - damp * band;
    band += f * high;
    x[i] = type === "low" ? low : type === "high" ? high : band;
  }
  return x;
}
function burst(x, rate, rnd, t0, env, amp = 1) {
  const i0 = Math.round(t0 * rate);
  for (let i = i0; i < x.length; i += 1) { const e = env((i - i0) / rate); if (e < 1e-4 && i > i0 + rate * 0.01) break; x[i] += rnd() * e * amp; }
  return x;
}
function bubble(x, rate, t0, f0, dur, amp) {
  const i0 = Math.round(t0 * rate);
  let ph = 0;
  for (let i = i0; i < Math.min(x.length, i0 + Math.round(dur * 4 * rate)); i += 1) {
    const t = (i - i0) / rate;
    ph += (TAU * f0 * (1 + (2.2 * t) / dur)) / rate;
    x[i] += Math.sin(ph) * amp * Math.exp(-t / dur) * Math.min(1, t / 0.002);
  }
  return x;
}
function thump(x, rate, t0, hi, lo, decay, amp) {
  const i0 = Math.round(t0 * rate);
  let ph = 0;
  for (let i = i0; i < x.length; i += 1) {
    const t = (i - i0) / rate;
    const e = Math.exp(-t / decay);
    if (e < 1e-4) break;
    ph += (TAU * (lo + (hi - lo) * Math.exp(-t / 0.03))) / rate;
    x[i] += Math.sin(ph) * e * amp * Math.min(1, t / 0.001);
  }
  return x;
}
const add = (x, y, g = 1) => { for (let i = 0; i < Math.min(x.length, y.length); i += 1) x[i] += y[i] * g; return x; };
const env = (a, d) => (t) => (t < a ? t / a : Math.exp(-(t - a) / d));
function tone(rate, f, sec, wave, decay) {
  const list = [];
  const top = wave === "sine" ? 1 : 15;
  for (let n = 1; n <= top; n += wave === "sine" ? 1 : 2) list.push([f * n, wave === "square" ? 1 / n : 1 / (n * n), decay, wave === "triangle" && (n >> 1) % 2 ? Math.PI : 0, 0.002]);
  return partials(buf(rate, sec), rate, list);
}
function loopify(x, rate, fade) {
  const F = Math.min(Math.round(fade * rate), x.length >> 1);
  const L = x.length - F;
  const out = x.slice(0, L);
  for (let i = 0; i < F; i += 1) { const a = (i / F) * (Math.PI / 2); out[i] = x[i] * Math.sin(a) + x[L + i] * Math.cos(a); }
  return out;
}

function step(st, surface, v, rate) {
  const rnd = noiseOf(st.seed ^ (surface.length * 977 + v * 31 + 7));
  const R = streamOf(`${st.seed}|step|${surface}|${v}`);
  const shoe = st.shoe;
  const x = buf(rate, surface === "water" ? 0.3 : surface === "metal" ? 0.3 : 0.16);
  const toe = R.between(0.02, 0.04);
  if (surface === "water") {
    burst(x, rate, rnd, 0, env(0.004, 0.05), 0.8);
    sweep(x, (t) => 2600 * st.water * Math.exp(-t / 0.08) + 400, 1.4, rate, "low");
    for (let k = 0; k < 3 + R.int(0, 2); k += 1) bubble(x, rate, R.between(0.01, 0.12), R.between(420, 1100) * st.water, R.between(0.012, 0.03), 0.35);
    thump(x, rate, 0, 160, 80, 0.035, 0.3);
  } else {
    const bp = (shoe === "boot" ? 1100 : shoe === "soft" ? 900 : 1800) * (0.8 + 0.5 * st.bright) * R.between(0.9, 1.1);
    const n = buf(rate, x.length / rate);
    burst(n, rate, rnd, 0, env(0.001, 0.011), 1);
    burst(n, rate, rnd, toe, env(0.001, 0.008), 0.6);
    bandpass(n, bp, 0.9, rate);
    add(x, n, 2.2);
    thump(x, rate, 0, shoe === "boot" ? 150 : 120, shoe === "boot" ? 55 : 70, 0.02 + st.weight * 0.03, 0.5 + st.weight * 0.4);
    if (surface === "metal") {
      const f = st.metalHz * R.between(0.9, 1.12);
      add(x, partials(buf(rate, x.length / rate), rate, st.metal.map((r, i) => [f * r, [0.5, 0.35, 0.22, 0.12][i], 0.12 / (1 + i * 0.6), 0, 0.0008])), 0.8);
      add(x, partials(buf(rate, x.length / rate), rate, st.metal.map((r, i) => [f * r * 1.07, [0.3, 0.2, 0.12, 0.06][i], 0.08, 0, 0.0008])).map((v2, i) => (i / rate >= toe ? v2 : 0)), 0.6);
    }
    if (shoe === "sneaker" && surface === "stone" && R.chance(0.3)) { // (a squeak now and then)
      const s = partials(buf(rate, 0.05), rate, [[R.between(2400, 3400), 0.08, 0.02, 0, 0.004]]);
      add(x, s, 1);
    }
    if (shoe === "soft") onePole(x, 2400, rate);
  }
  return x;
}

function sfxSamples(st, rate = 44100) {
  const rnd = noiseOf(st.seed);
  const worn = (x, peak = 0.9) => normalize(wear(x, rate, { bits: st.bits, hold: st.hold, top: Math.min(rate / 2.3, st.top), dust: 0 }, rnd), peak);
  const R = streamOf(`${st.seed}|sfx|make`);
  const n = (k) => noiseOf(st.seed ^ (k * 2654435761));
  const out = {};
  for (const s of SURFACES) out[`step_${s}`] = [0, 1, 2, 3].map((v) => worn(step(st, s, v, rate), s === "metal" ? 0.7 : 0.8));
  const jump = () => {
    const x = burst(buf(rate, 0.32), rate, n(1), 0, (t) => Math.sin(Math.PI * Math.min(1, t / 0.3)) ** 2, 0.9);
    sweep(x, (t) => 500 + 2600 * (t / 0.3) * (0.7 + st.bright * 0.6), 2.5, rate);
    const s = burst(buf(rate, 0.32), rate, n(2), 0, env(0.001, 0.012), 1);
    bandpass(s, 1500, 0.9, rate);
    return add(x, s, 1.4);
  };
  out.jump = [worn(jump(), 0.7)];
  const land = (hard) => {
    const x = thump(buf(rate, 0.55), rate, 0, hard ? 130 : 110, hard ? 38 : 48, 0.12 + st.weight * (hard ? 0.18 : 0.1), 1);
    const c = burst(buf(rate, 0.55), rate, n(hard ? 3 : 4), 0, env(0.001, hard ? 0.07 : 0.04), 1);
    onePole(c, hard ? 1300 : 1900, rate);
    add(x, c, hard ? 1.3 : 0.9);
    if (hard) burst(x, rate, n(5), 0.05, env(0.01, 0.08), 0.12); // (the scatter of grit)
    return x;
  };
  out.land = [worn(land(false))];
  out.land_hard = [worn(land(true))];
  const scuff = (k, lo, hi, dur) => sweep(burst(buf(rate, dur + 0.05), rate, n(k), 0, env(0.005, dur / 3), 1), (t) => lo + (hi - lo) * Math.min(1, t / dur), 2, rate);
  out.wallStart = [worn(scuff(6, 800, 2200, 0.14), 0.7)];
  out.wallJump = [worn(add(thump(buf(rate, 0.4), rate, 0, 140, 60, 0.05, 0.8), jump(), 0.8), 0.75)];
  const ring = (k, f, len, tau, strike) => {
    const x = partials(buf(rate, len), rate, st.metal.map((r, i) => [f * r, [1, 0.6, 0.4, 0.25][i], tau / (1 + i * 0.7), i * 0.7, 0.0006]));
    add(x, partials(buf(rate, len), rate, st.metal.map((r, i) => [f * r * 1.013, [0.5, 0.3, 0.2, 0.1][i], tau * 0.8 / (1 + i), 0.3, 0.0006])));
    const s = burst(buf(rate, len), rate, n(k), 0, env(0.0005, 0.006), strike);
    bandpass(s, 3000, 0.7, rate);
    return add(x, s);
  };
  out.railStart = [worn(add(ring(7, st.metalHz * 0.85, 0.9, 0.5, 1.4), thump(buf(rate, 0.9), rate, 0, 120, 60, 0.05, 0.5)), 0.8)];
  out.railEnd = [worn(ring(8, st.metalHz * 1.3, 0.45, 0.18, 0.6), 0.6)];
  const splash = (k, len, big) => {
    const x = burst(buf(rate, len), rate, n(k), 0, env(0.004, big ? 0.22 : 0.1), 1);
    sweep(x, (t) => 6000 * st.water * Math.exp(-t / (big ? 0.2 : 0.1)) + 500, 1.2, rate, "low");
    thump(x, rate, 0, 200, 90, big ? 0.07 : 0.04, big ? 0.9 : 0.5);
    for (let i = 0; i < (big ? 14 : 5); i += 1) bubble(x, rate, R.between(0.03, len * 0.7), R.between(380, 1400) * st.water, R.between(0.01, 0.035), R.between(0.15, 0.4));
    return x;
  };
  out.splash = [worn(splash(9, 0.95, true))];
  out.skimStart = [worn(splash(10, 0.4, false), 0.7)];
  const key = 72 + st.tonic;
  const arp = (notes, gap, decay, len) => {
    const x = buf(rate, len);
    notes.forEach((m, i) => { const t = tone(rate, midiHz(m), len - i * gap, st.wave, decay); for (let j = 0; j < t.length; j += 1) x[j + Math.round(i * gap * rate)] += t[j] * 0.5; });
    return x;
  };
  out.respawn = [worn(add(arp([key - 12, key - 5, key, key + 7], 0.07, 0.25, 0.7), sweep(burst(buf(rate, 0.7), rate, n(11), 0, (t) => Math.sin(Math.PI * Math.min(1, t / 0.6)), 0.15), (t) => 1500 + 6000 * t, 3, rate)), 0.7)];
  out.blip = [worn(arp([key + 12], 0, 0.03, 0.08), 0.6)];
  out.hover = [worn(arp([key + 19], 0, 0.012, 0.04), 0.35)];
  out.select = [worn(arp([key + 7, key + 12], 0.05, 0.05, 0.16), 0.6)];
  out.back = [worn(arp([key + 7, key], 0.05, 0.05, 0.16), 0.6)];
  out.confirm = [worn(arp([key, key + 4 + (st.tonic % 2 ? 0 : -1), key + 7, key + 12], 0.055, 0.08, 0.36), 0.65)];
  out.error = [worn(add(tone(rate, 150, 0.1, "square", 0.05), tone(rate, 140, 0.24, "square", 0.05).map((v, i) => (i > rate * 0.12 ? v : 0))), 0.55)];

  const grind = () => {
    const len = 1.2;
    const x = burst(buf(rate, len + 0.2), rate, n(12), 0, () => 1, 1);
    const sing = new Float32Array(x.length);
    st.metal.forEach((r, i) => { const f = st.metalHz * 1.6 * r; if (f >= rate / 2.3) return; const b = x.slice(); bandpass(b, f, 28, rate); add(sing, b, [1.6, 1.1, 0.7, 0.4][i]); }); // (none past what the rate can hold)
    const rattle = x.slice();
    bandpass(rattle, 2400, 0.8, rate);
    const flutter = streamOf(`${st.seed}|grind`);
    const bumps = Array.from({ length: 24 }, () => flutter.between(0.25, 1));
    for (let i = 0; i < x.length; i += 1) { const t = i / rate; x[i] = sing[i] * 2 + rattle[i] * 0.25 * bumps[Math.floor((t / (len + 0.2)) * 24) % 24] + Math.sin(TAU * 70 * t) * 0.05; }
    return x;
  };
  const wallrun = () => {
    const len = 0.5;
    const x = buf(rate, len + 0.06);
    burst(x, rate, n(13), 0, () => 0.15, 1);
    onePole(x, 700, rate);
    for (const t0 of [0.12, 0.37]) { const s = scuff(14 + t0 * 10, 900, 1900, 0.09); const o = Math.round(t0 * rate); for (let i = 0; i < s.length && i + o < x.length; i += 1) x[i + o] += s[i]; }
    return x;
  };
  const skim = () => {
    const len = 0.8;
    const x = burst(buf(rate, len + 0.1), rate, n(15), 0, () => 0.35, 1);
    sweep(x, () => 3800 * st.water, 0.9, rate);
    for (const t0 of [0.02, 0.42]) { const s = splash(16 + t0 * 10, 0.3, false); for (let i = 0; i < s.length && i + t0 * rate < x.length; i += 1) x[i + Math.round(t0 * rate)] += s[i] * 0.4; }
    return x;
  };
  const wind = () => {
    const len = 4;
    const x = burst(buf(rate, len + 0.3), rate, n(17), 0, () => 1, 1);
    onePole(x, 1200, rate);
    const g = streamOf(`${st.seed}|wind`);
    const [k1, k2] = [g.int(1, 2), g.int(3, 5)];
    const ph = g.between(0, TAU);
    sweep(x, (t) => (380 + 320 * Math.sin((TAU * k1 * t) / len + ph) + 140 * Math.sin((TAU * k2 * t) / len)) * st.wind, 1.6, rate);
    return x;
  };
  const wornLoop = (x, fade, peak) => normalize(loopify(wear(x, rate, { bits: st.bits, hold: st.hold, top: Math.min(rate / 2.3, st.top), dust: 0 }, rnd), rate, fade), peak);
  out.grind = wornLoop(grind(), 0.2, 0.7);
  out.wallrun = wornLoop(wallrun(), 0.05, 0.6);
  out.skim = wornLoop(skim(), 0.1, 0.6);
  out.wind = wornLoop(wind(), 0.3, 0.6);
  return out;
}


const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+x) ? +x : lo));

function paramsFor(name, p = {}, st = { pitch: 1 }) {
  const speed = clamp(p.speed ?? 0, 0, 40);
  const base = { key: name, rate: st.pitch ?? 1, gain: 1, pan: clamp(p.pan ?? 0, -1, 1), cutoff: 20000 };
  if (name === "step") {
    const surface = SURFACES.includes(p.surface) ? p.surface : "stone";
    Object.assign(base, { key: `step_${surface}`, gain: clamp(0.35 + speed * 0.05, 0.3, 0.85), rate: base.rate * clamp(0.94 + speed * 0.01, 0.94, 1.06) });
  } else if (name === "land") {
    Object.assign(base, { key: speed > 9 ? "land_hard" : "land", gain: clamp(0.3 + speed / 12, 0.3, 1.2), rate: base.rate * clamp(1.12 - speed / 50, 0.78, 1.12) });
  } else if (name === "grind") {
    const s = clamp((speed - 4) / 10, 0, 1);
    Object.assign(base, { rate: base.rate * (0.8 + 0.5 * s), gain: 0.35 + 0.4 * s, cutoff: 3000 + 9000 * s });
  } else if (name === "wallrun") {
    Object.assign(base, { rate: clamp(speed / 7, 0.7, 1.5), gain: 0.45 });
  } else if (name === "skim") {
    const s = clamp((speed - 6.5) / 6, 0, 1);
    Object.assign(base, { rate: 0.9 + 0.3 * s, gain: 0.3 + 0.3 * s, cutoff: 5000 + 7000 * s });
  } else if (name === "wind") {
    const s = clamp((speed - 2) / 16, 0, 1);
    Object.assign(base, { rate: clamp(0.85 + speed * 0.02, 0.85, 1.25), gain: 0.7 * s ** 1.5, cutoff: 500 + 5500 * s });
  } else if (["blip", "hover", "select", "back", "confirm", "error"].includes(name)) {
    base.rate = 1; // (the UI stays in key)
  }
  base.gain = clamp(base.gain * clamp(p.gain ?? 1, 0, 2), 0, 2);
  if (p.rate !== undefined) base.rate = clamp(base.rate * p.rate, 0.25, 4);
  base.rate = clamp(base.rate, 0.25, 4);
  return base;
}


function createSfx(target, { seed = "1", style = "lofi", out = null, volume = 0.8 } = {}) {
  const isTone = typeof target?.getContext === "function" && typeof target?.getDestination === "function";
  const ctx = isTone ? target.getContext().rawContext : target;
  const st = sfxStyle(seed, style);
  const data = sfxSamples(st, ctx.sampleRate);
  const toBuf = (x) => { const b = ctx.createBuffer(1, x.length, ctx.sampleRate); b.copyToChannel(x, 0); return b; };
  const bufs = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.map(toBuf) : toBuf(v)]));
  const master = ctx.createGain();
  master.gain.value = volume;
  const bus = out ?? (isTone ? ctx.createGain() : ctx.destination);
  if (!out && isTone) target.connect(bus, target.getDestination());
  master.connect(bus);
  if (st.room > 0) {
    const slap = ctx.createDelay(0.5);
    slap.delayTime.value = 0.07;
    const fb = ctx.createGain();
    fb.gain.value = st.room * 0.8;
    const wet = ctx.createGain();
    wet.gain.value = st.room;
    const dark = ctx.createBiquadFilter();
    dark.frequency.value = 2500;
    master.connect(slap); slap.connect(dark); dark.connect(fb); fb.connect(slap); dark.connect(wet); wet.connect(bus);
  }
  const J = streamOf(`${seed}|sfx|play`);
  const turn = {};
  const voiceOf = (key, loop) => {
    const b = bufs[key];
    if (!b) return null;
    const src = ctx.createBufferSource();
    if (Array.isArray(b)) { turn[key] = ((turn[key] ?? -1) + 1 + (b.length > 2 && J.chance(0.3) ? 1 : 0)) % b.length; src.buffer = b[turn[key]]; }
    else src.buffer = b;
    src.loop = loop;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(filter); filter.connect(gain);
    if (pan) { gain.connect(pan); pan.connect(master); } else gain.connect(master);
    return { src, filter, gain, pan };
  };
  const loops = new Set();
  const api = {
    style: st,
    get context() { return ctx; },
    get volume() { return master.gain.value; },
    set volume(v) { master.gain.value = clamp(v, 0, 1.5); },
    play(name, p = {}) {
      const q = paramsFor(name, p, st);
      const v = voiceOf(q.key, false);
      if (!v) return null;
      const when = p.when ?? ctx.currentTime;
      const jitter = name === "step" || name === "land" || name === "jump" ? 1 + J.between(-0.035, 0.035) : 1;
      v.src.playbackRate.value = q.rate * jitter;
      v.gain.gain.value = q.gain * (name === "step" ? J.between(0.88, 1.05) : 1);
      v.filter.frequency.value = q.cutoff;
      if (v.pan) v.pan.pan.value = q.pan;
      v.src.start(when);
      return v.src;
    },
    loop(name, p = {}) {
      const v = voiceOf(name, true);
      if (!v) return { set() {}, stop() {}, playing: false };
      const when = p.when ?? ctx.currentTime;
      let q = paramsFor(name, p, st);
      v.src.playbackRate.value = q.rate;
      v.filter.frequency.value = q.cutoff;
      if (v.pan) v.pan.pan.value = q.pan;
      v.gain.gain.setValueAtTime(0, when);
      v.gain.gain.linearRampToValueAtTime(q.gain, when + 0.04);
      v.src.start(when, J.between(0, v.src.buffer.duration)); // (from anywhere in it: two grinds never start alike)
      const h = {
        playing: true,
        get params() { return q; },
        set(p2 = {}, ramp = 0.08) {
          if (!h.playing) return;
          q = paramsFor(name, { ...p, ...p2 }, st);
          const t = p2.when ?? ctx.currentTime;
          v.src.playbackRate.setTargetAtTime(q.rate, t, ramp / 3);
          v.gain.gain.setTargetAtTime(q.gain, t, ramp / 3);
          v.filter.frequency.setTargetAtTime(q.cutoff, t, ramp / 3);
          if (v.pan) v.pan.pan.setTargetAtTime(q.pan, t, ramp / 3);
        },
        stop(fade = 0.12, at = ctx.currentTime) {
          if (!h.playing) return;
          h.playing = false;
          loops.delete(h);
          v.gain.gain.cancelScheduledValues(at);
          v.gain.gain.setValueAtTime(v.gain.gain.value, at);
          v.gain.gain.linearRampToValueAtTime(0, at + fade);
          v.src.stop(at + fade + 0.02);
        },
      };
      loops.add(h);
      return h;
    },
    stopAll(fade = 0.1) { for (const h of [...loops]) h.stop(fade); },
    dispose() { api.stopAll(0.02); try { master.disconnect(); } catch {} },
  };
  return api;
}


function bodySfx(sfx, { surfaceOf = () => "stone", wind = true, gain = 1 } = {}) {
  const held = {};
  let stride = 0;
  const hold = (name, on, p) => {
    if (on && !held[name]) held[name] = sfx.loop(name, { ...p, gain });
    else if (on) held[name].set({ ...p, gain });
    else if (held[name]) { held[name].stop(); held[name] = null; }
  };
  const ONE = { jumped: "jump", wallStart: "wallStart", wallJump: "wallJump", railStart: "railStart", railEnd: "railEnd", skimStart: "skimStart", splashIn: "splash", respawn: "respawn" };
  return {
    update(body, dt) {
      const hs = Math.hypot(body.vel[0], body.vel[2]);
      const speed = Math.hypot(body.vel[0], body.vel[1], body.vel[2]);
      for (const e of body.events ?? []) {
        if (e.type === "landed") { sfx.play("land", { speed: e.speed, gain }); stride = 0; }
        else if (ONE[e.type]) sfx.play(ONE[e.type], { gain, speed: hs });
      }
      if (body.mode === "ground" && hs > 0.6) {
        stride += hs * dt;
        if (stride >= 0.7 + 0.24 * hs) { stride = 0; sfx.play("step", { surface: surfaceOf(body), speed: hs, gain }); }
      } else if (body.mode !== "ground") stride = 0.5; // (the first step lands soon after touching down)
      hold("grind", body.mode === "grind", { speed });
      hold("wallrun", body.mode === "wall", { speed: hs });
      hold("skim", body.mode === "skim", { speed: hs });
      if (wind) hold("wind", true, { speed });
    },
    stop() { for (const k of Object.keys(held)) hold(k, false); },
    get held() { return Object.keys(held).filter((k) => held[k]); },
  };
}

return { get SURFACES() { return SURFACES; }, get SFX_NAMES() { return SFX_NAMES; }, get LOOP_NAMES() { return LOOP_NAMES; }, get STYLE_NAMES() { return STYLE_NAMES; }, get sfxStyle() { return sfxStyle; }, get sfxSamples() { return sfxSamples; }, get paramsFor() { return paramsFor; }, get createSfx() { return createSfx; }, get bodySfx() { return bodySfx; } };
});

__def("src/audio/sound.js", () => {

const { play, render } = __mod("src/audio/player.js");
const { createSfx } = __mod("src/audio/sfx.js");
const { hash } = __mod("src/audio/score.js");
const SPEAKER = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path data-wave fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/><path data-mute fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>';

const QUIET = { play: () => null, loop: () => ({ set() {}, stop() {}, playing: false }), stopAll() {}, style: null };

function createSound(host, { id = "keel", key = `${id}:sound`, corner = "top-right", button: withButton = true, sfx: sfxOpts = null, intensity = null } = {}) {
  const K = globalThis.KEEL_AUDIO ?? null;
  const Tone = () => globalThis.Tone ?? null;
  let plan = null;
  let playing = null; // (what the band is playing: its plan's hash)
  let band = null;
  let on = false;
  let wanted = false;
  let level = intensity;
  let fx = null;
  const watchers = [];
  try { wanted = localStorage.getItem(key) === "on"; } catch {}
  const planKey = (p) => (p ? hash(JSON.stringify(p)) : null);
  const notify = () => { for (const w of watchers) { try { w(api); } catch {} } };

  async function begin() {
    if (!Tone()) return;
    if (!K) await Tone().start(); // (inside the listener's click: that's what lets it sound)
    if (sfxOpts && !fx) fx = createSfx(Tone(), sfxOpts);
    if (plan) {
      band?.stop(0.25, { transport: false }); // (the next one takes the transport on)
      band = play(Tone(), plan, null, level === null ? {} : { intensity: level }); // (into Tone's destination: keel-audio sets its level and mute)
      playing = planKey(plan);
    }
    notify();
  }
  function end() { band?.stop(); band = null; playing = null; fx?.stopAll(); notify(); }
  function remember(v) { try { localStorage.setItem(key, v ? "on" : "off"); } catch {} }

  let button = null;
  function label() {
    if (!button) return;
    button.setAttribute("aria-pressed", String(on));
    button.setAttribute("aria-label", on ? "Turn the sound off" : "Turn the sound on");
    button.title = on ? "sound off" : "sound on";
    button.querySelector("[data-wave]").style.display = on ? "" : "none";
    button.querySelector("[data-mute]").style.display = on ? "none" : "";
  }
  async function set(v) {
    on = v;
    remember(on);
    label();
    if (on) await begin(); else end();
  }
  if (K) {
    K.configure({ id: String(id).replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 96) || "keel" });
    K.onStart(() => { on = true; begin(); });
    K.onStop(() => { on = false; end(); });
    if (withButton) K.mountButton(host, { corner });
  } else {
    if (withButton && host) {
      button = document.createElement("button");
      button.type = "button";
      button.innerHTML = SPEAKER;
      const [v, h] = corner.split("-");
      button.style.cssText = `position:absolute;${v}:10px;${h}:10px;z-index:3;width:30px;height:30px;padding:0;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(8,8,14,.55);color:#cfd3e6;cursor:pointer;opacity:.7`;
      button.onclick = (e) => { e.stopPropagation(); set(!on); }; // (it isn't a click on the game)
      button.onmouseenter = () => { button.style.opacity = "1"; };
      button.onmouseleave = () => { button.style.opacity = ".7"; };
      label();
      host.append(button);
    }
    if (wanted) {
      const again = () => { removeEventListener("pointerdown", again, true); if (!on) set(true); };
      addEventListener("pointerdown", again, true);
    }
    document.addEventListener("visibilitychange", () => {
      const ctx = Tone()?.getContext?.().rawContext;
      if (!ctx || !on) return;
      if (document.hidden) ctx.suspend?.(); else ctx.resume?.();
    });
  }

  const api = {
    setPlan(p) {
      plan = p ?? null;
      if (on && plan && planKey(plan) !== playing) begin();
      else if (on && !plan) { band?.stop(); band = null; playing = null; notify(); }
      else notify();
    },
    setIntensity(x, ramp) { level = x; band?.setIntensity(x, ramp); },
    get intensity() { return band?.intensity ?? level; },
    react(what) { band?.react(what); },
    get sfx() { return on && fx ? fx : QUIET; },
    get on() { return on; },
    get plan() { return plan; },
    start: () => (K ? K.start() : set(true)),
    stop: () => (K ? K.stop() : set(false)),
    toggle: () => (on ? api.stop() : api.start()),
    get volume() { return K ? K.volume : 10 ** ((Tone()?.getDestination().volume.value ?? 0) / 20); },
    set volume(v) { if (K) K.volume = v; else if (Tone()) Tone().getDestination().volume.value = 20 * Math.log10(Math.max(1e-4, v)); },
    position() {
      if (!band || !plan || !Tone()) return null;
      const T = Tone().getTransport();
      const bar = Math.floor(T.ticks / (T.PPQ * 4)) % plan.loopBars;
      return { bar, of: plan.loopBars, sec: plan.bars[bar]?.sec, seconds: T.seconds % plan.loopSec };
    },
    renderLoop: (opts) => (plan && Tone() ? render(Tone(), plan, opts) : Promise.resolve(null)),
    onChange(fn) { watchers.push(fn); return () => watchers.splice(watchers.indexOf(fn), 1); },
  };
  return api;
}

return { get createSound() { return createSound; } };
});

__def("src/audio/nocturnes.js", () => {

const { BANDS, streamOf } = __mod("src/audio/score.js");
const KIT_BAND = {
  "Music Corner": { keys: [["guitar", 3], ["rhodes", 1]], lead: [["guitar", 1], ["vibes", 1]], feel: [["brushed", 2], ["soft", 1]] },
  "Media Corner": { lead: [["chip", 2], ["kalimba", 1]], feel: [["boombap", 2], ["chip", 1]], tempo: [78, 93], scratch: 0.7 },
  "Reading Corner": { keys: [["felt", 2], ["piano", 1]], feel: [["soft", 2], ["brushed", 1]] },
  Stargazing: { keys: [["rhodes", 2], ["vibes", 1]], lead: [["celesta", 1], ["kalimba", 1]], feel: [["soft", 2]], vox: 0.5 },
  "Teen Room": { lead: [["chip", 2], ["guitar", 1]], feel: [["boombap", 3]], tempo: [80, 93], scratch: 0.9 },
  "Summer Night": { keys: [["felt", 1], ["guitar", 2]], lead: [["musicbox", 1], ["kalimba", 1]], feel: [["brushed", 2]] },
};
const ANCHOR_KIT = { tv: "Media Corner", guitar: "Music Corner", telescope: "Stargazing", fan: "Summer Night", speaker: "Teen Room", amp: "Teen Room", chair: "Reading Corner", plant: "Reading Corner", lamp: "Reading Corner" };
const WEATHER = {
  Rain: ["rain"], Snow: ["hush", "chimes"], City: ["traffic"], Skyscraper: ["traffic", "wind"], Town: ["traffic", "hush"],
  Suburb: ["crickets", "car"], CountryRoad: ["crickets", "car"], Sea: ["waves"], Cruise: ["waves"],
  Fog: ["hush"], Aurora: ["shimmer"], Space: ["shimmer"], Moon: ["hush"], Stars: ["hush"],
  Hills: ["crickets"], Dusk: ["hush"], Void: ["hush"], Vaporwave: ["hush"],
};
const DARK = { Rain: 0.35, Fog: 0.4, Void: 0.3, Stars: 0.5, Moon: 0.6, Space: 0.55, Aurora: 0.6 };
const SCHEME_MODE = {
  Nocturne: "aeolian", Monochrome: "dorian", Duotone: "dorian", "Two Worlds": "mixolydian", Triad: "lydian",
  Split: "aeolian", "Neon Noir": "dorian", Spectrum: "lydian", Prism: "ionian",
};
const THEME_ITEMS = [
  ["Late Shift", [["Desk", "lamp"], ["Still Life", "Houseplant"], ["Decor", "photo"], ["Decor", "flipclock"]], [["Still Life", "Mug"], ["Desk", "energy"], ["Decor", "pencils"], ["Still Life", "Houseplant"], ["Desk", "smartphone"], ["Decor", "calendar"]]],
  ["Retro Den", [["Relic", "console"], ["Relic", "gamepad"], ["Relic", "cartridge"]], [["Relic", "gamepad"], ["Relic", "soda"], ["Relic", "cartridge"], ["Relic", "cases"], ["Relic", "joystick"], ["Relic", "floppies"]]],
  ["Candlelight", [["Occult", "candles"], ["Still Life", "Light"]], [["Decor", "vase"], ["Still Life", "Book"], ["Still Life", "Drink"], ["Still Life", "Flowers"]]],
  ["Bedside", [["Relic", "clockRadio"], ["Desk", "lamp"], ["Decor", "flipclock"]], [["Still Life", "Vessel"], ["Relic", "phone"], ["Relic", "glasses"], ["Still Life", "Book"], ["Desk", "lamp"], ["Relic", "watch"], ["Relic", "analogWatch"], ["Desk", "smartphone"]]],
  ["The Reading", [["Occult", "crystalBall"], ["Occult", "tarot"], ["Occult", "board"], ["Occult", "orrery"]], [["Occult", "candles"], ["Occult", "tarot"], ["Occult", "incense"], ["Occult", "runes"], ["Occult", "pendulum"], ["Occult", "skull"]]],
  ["Night Desk", [["Desk", "lamp"], ["Decor", "globe"], ["Decor", "flipclock"]], [["Still Life", "Book"], ["Still Life", "Mug"], ["Decor", "pencils"], ["Decor", "photo"], ["Decor", "calendar"], ["Decor", "rolodex"], ["Decor", "stapler"]]],
  ["Game Night", [["Relic", "handheldLine"], ["Relic", "console"], ["Relic", "handheld"], ["Relic", "tamagotchi"]], [["Relic", "controller"], ["Relic", "cartridge"], ["Relic", "cases"], ["Relic", "soda"], ["Desk", "energy"], ["Relic", "cards"]]],
  ["Nightcap", [["Still Life", "Drink"], ["Still Life", "Vessel"]], [["Desk", "ashtray"], ["Relic", "lighter"], ["Relic", "phone"], ["Still Life", "Plate"], ["Desk", "keys"], ["Desk", "wallet"]]],
  ["Collector", [["Relic", "bobble"], ["Relic", "robot"], ["Relic", "vinyl"], ["Relic", "troll"], ["Relic", "dino"]], [["Relic", "vinyl"], ["Relic", "robot"], ["Relic", "dino"], ["Relic", "troll"], ["Relic", "duck"], ["Relic", "blister"], ["Relic", "cards"]]],
  ["Green Sill", [["Still Life", "Houseplant"], ["Still Life", "Flowers"], ["Decor", "vase"]], [["Still Life", "Mug"], ["Still Life", "Houseplant"], ["Still Life", "Book"], ["Decor", "cat"], ["Decor", "diffuser"]]],
  ["Mixtape", [["Relic", "boombox"], ["Relic", "walkman"], ["Relic", "discman"]], [["Relic", "cassette"], ["Relic", "headphones"], ["Relic", "cases"], ["Relic", "cd"], ["Relic", "player"]]],
];

function themeForItems(items, S) {
  let best = null;
  let bestScore = 0;
  for (const [name, hero, company] of THEME_ITEMS) {
    let score = 0;
    for (const it of items) {
      if (hero.some(([r, k]) => r === it.realm && k === it.key)) score += 2;
      else if (company.some(([r, k]) => r === it.realm && k === it.key)) score += 1;
    }
    score += S.f() * 0.5; // (a tie goes to the seed)
    if (score > bestScore) { bestScore = score; best = name; }
  }
  return bestScore >= 1 ? best : null;
}

function themeOfScene(g) {
  if (g.canvas?.theme && g.canvas.theme !== "Loose") return g.canvas.theme;
  if (g.setting === "Workstation") return g.monitor?.crt ? "Retro Den" : "Late Shift";
  if (g.setting === "Floor") return "A Room";
  const items = (g.placements ?? []).map((pl) => ({ realm: pl.obj.realm, key: pl.obj.key }));
  return themeForItems(items, streamOf(`${g.seed}|theme`)) ?? "Loose";
}
function kitOfScene(g) {
  if (g.setting !== "Floor") return null;
  const pls = g.placements ?? [];
  const anchor = pls.find((pl) => pl.obj.kitRole === "anchor") ?? pls.find((pl) => pl.obj.realm === "Floor");
  return (anchor && ANCHOR_KIT[anchor.obj.key]) ?? g.canvas?.kit ?? null;
}

function moodOfNocturnes(g) {
  const o = g.recipe?.music ?? {};
  const theme = themeOfScene(g);
  const view = g.view?.kind ?? "Stars";
  const has = (re) => (g.placements ?? []).some((pl) => re.test(`${pl.obj.form ?? ""} ${pl.obj.family ?? ""}`));
  const room = [];
  if (has(/Candle|Incense|Censer|Lantern|Lighter/)) room.push("crackle");
  if (has(/Fan/)) room.push("fan");
  if (has(/TV|Television|CRT|Monitor/) || g.setting === "Workstation") room.push("hum");
  const { theme: bandPin, ...rest } = o;
  return {
    seed: g.seed, name: theme,
    band: { ...(BANDS[theme] ?? {}), ...(KIT_BAND[kitOfScene(g)] ?? {}) },
    hue: g.palette?.hue ?? g.palette?.ramps?.key?.hues?.[0],
    mode: SCHEME_MODE[g.palette?.scheme], eclipse: Boolean(g.view?.eclipse),
    picture: ((g.frames ?? 48) * (g.delay ?? 9)) / 100,
    view, weather: WEATHER[view] ?? ["hush"], room, dark: DARK[view] ?? 0.72,
    space: g.setting === "Floor" ? 0.08 : 0,
    pins: { ...rest, ...(bandPin ? { band: bandPin } : {}) },
  };
}


return { get KIT_BAND() { return KIT_BAND; }, get WEATHER() { return WEATHER; }, get DARK() { return DARK; }, get SCHEME_MODE() { return SCHEME_MODE; }, get themeForItems() { return themeForItems; }, get moodOfNocturnes() { return moodOfNocturnes; } };
});

__def("src/audio/wav.js", () => {

function encodeWav(channels, rate = 44100) {
  const ch = channels.length;
  const n = channels[0].length;
  const dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, t) => { for (let i = 0; i < t.length; i += 1) dv.setUint8(o + i, t.charCodeAt(i)); };
  str(0, "RIFF"); dv.setUint32(4, 36 + n * ch * 2, true); str(8, "WAVEfmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); str(36, "data"); dv.setUint32(40, n * ch * 2, true);
  for (let i = 0; i < n; i += 1) for (let c = 0; c < ch; c += 1) dv.setInt16(44 + (i * ch + c) * 2, Math.max(-32768, Math.min(32767, Math.round(channels[c][i] * 32767))), true);
  return new Uint8Array(dv.buffer);
}

const db = (x) => Math.round(20 * Math.log10(Math.max(x, 1e-9)) * 10) / 10;
const rmsOf = (x, a, b) => { let s = 0; for (let i = a; i < b; i += 1) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };

function measureLoop(channels, rate = 44100, { edge = 0.05 } = {}) {
  const n = channels[0].length;
  const e = Math.min(n >> 1, Math.round(edge * rate));
  let peak = 0;
  let sum = 0;
  let nan = 0;
  const steps = [];
  let wrap = 0;
  for (const x of channels) {
    for (let i = 0; i < n; i += 1) { const v = x[i]; if (!Number.isFinite(v)) nan += 1; else { peak = Math.max(peak, Math.abs(v)); sum += v * v; } }
    for (let i = 1; i < n; i += 7) steps.push(Math.abs(x[i] - x[i - 1]));
    wrap = Math.max(wrap, Math.abs(x[0] - x[n - 1]));
  }
  steps.sort((a, b) => a - b);
  const p99 = steps[Math.floor(steps.length * 0.99)] ?? 0;
  const head = Math.max(...channels.map((x) => rmsOf(x, 0, e)));
  const tail = Math.max(...channels.map((x) => rmsOf(x, n - e, n)));
  return {
    seconds: Math.round((n / rate) * 1000) / 1000, rmsDb: db(Math.sqrt(sum / (n * channels.length))), peak: Math.round(peak * 1000) / 1000, nan,
    headDb: db(head), tailDb: db(tail), edgeDiffDb: Math.round(Math.abs(db(head) - db(tail)) * 10) / 10,
    wrapStep: Math.round(wrap * 10000) / 10000, stepP99: Math.round(p99 * 10000) / 10000,
    seamless: wrap <= Math.max(p99 * 1.5, 0.02), // (the wrap is a step like the music's own)
  };
}

return { get encodeWav() { return encodeWav; }, get measureLoop() { return measureLoop; } };
});

__def("src/audio/index.js", () => {







return { get BANDS() { return __mod("src/audio/score.js").BANDS; }, get CHOICES() { return __mod("src/audio/score.js").CHOICES; }, get MODES() { return __mod("src/audio/score.js").MODES; }, get ROOM_KINDS() { return __mod("src/audio/score.js").ROOM_KINDS; }, get WEATHER_KINDS() { return __mod("src/audio/score.js").WEATHER_KINDS; }, get moodFor() { return __mod("src/audio/score.js").moodFor; }, get scoreOf() { return __mod("src/audio/score.js").scoreOf; }, get streamOf() { return __mod("src/audio/score.js").streamOf; }, get hash() { return __mod("src/audio/score.js").hash; }, get intensityMix() { return __mod("src/audio/player.js").intensityMix; }, get play() { return __mod("src/audio/player.js").play; }, get render() { return __mod("src/audio/player.js").render; }, get voice() { return __mod("src/audio/player.js").voice; }, get makeSampleData() { return __mod("src/audio/samples.js").makeSampleData; }, get makeSamples() { return __mod("src/audio/samples.js").makeSamples; }, get LOOP_NAMES() { return __mod("src/audio/sfx.js").LOOP_NAMES; }, get SFX_NAMES() { return __mod("src/audio/sfx.js").SFX_NAMES; }, get STYLE_NAMES() { return __mod("src/audio/sfx.js").STYLE_NAMES; }, get SURFACES() { return __mod("src/audio/sfx.js").SURFACES; }, get bodySfx() { return __mod("src/audio/sfx.js").bodySfx; }, get createSfx() { return __mod("src/audio/sfx.js").createSfx; }, get paramsFor() { return __mod("src/audio/sfx.js").paramsFor; }, get sfxSamples() { return __mod("src/audio/sfx.js").sfxSamples; }, get sfxStyle() { return __mod("src/audio/sfx.js").sfxStyle; }, get createSound() { return __mod("src/audio/sound.js").createSound; }, get moodOfNocturnes() { return __mod("src/audio/nocturnes.js").moodOfNocturnes; }, get encodeWav() { return __mod("src/audio/wav.js").encodeWav; }, get measureLoop() { return __mod("src/audio/wav.js").measureLoop; } };
});

__def("src/physics/character.js", () => {

const TUNING = {
  radius: 0.26, gravity: 24, runSpeed: 9.5, runAccel: 48, friction: 30, airAccel: 16, jump: 8.6,
  coyote: 0.1, buffer: 0.12, wallMin: 4.5, wallGravity: 0.16, wallTime: 1.35, wallKick: 7.5, wallUp: 7.4,
  railSnap: 0.45, railLift: 0.28, railPush: 3, railCruise: 11, railMax: 14, skimMin: 6.5, skimDrag: 1.4, respawn: 0.9,
  slopeMax: 42, // (degrees: a wedge up to this stands and runs; steeper slides)
  maxFall: 30, // (m/s: never faster than radius x 120 Hz, so nothing is fallen through)
  stepDown: 0.3, // (m: off a ramp's crest the feet find the floor this far below)
};

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

function boxDistance(p, b) {
  const c = Math.cos(b.yaw ?? 0);
  const s = Math.sin(b.yaw ?? 0);
  const x = p[0] - b.c[0];
  const y = p[1] - b.c[1];
  const z = p[2] - b.c[2];
  const l = [c * x - s * z, y, s * x + c * z]; // (world -> the box's frame: core/frame.js worldToLocal)
  const q = [Math.abs(l[0]) - b.h[0], Math.abs(l[1]) - b.h[1], Math.abs(l[2]) - b.h[2]];
  const o = [Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)];
  const out = len(o);
  let n;
  let d;
  if (out > 0) { d = out; n = [Math.sign(l[0]) * o[0] / out, Math.sign(l[1]) * o[1] / out, Math.sign(l[2]) * o[2] / out]; }
  else {
    const k = q[0] > q[1] ? (q[0] > q[2] ? 0 : 2) : q[1] > q[2] ? 1 : 2;
    d = q[k];
    n = [0, 0, 0];
    n[k] = Math.sign(l[k]) || 1;
  }
  return { d, n: [c * n[0] + s * n[2], n[1], -s * n[0] + c * n[2]] };
}

function polyDistance(u, v, P) {
  let best = Infinity;
  let gu = 0;
  let gv = 0;
  let inside = true;
  let far = -Infinity;
  let fu = 0;
  let fv = 0;
  for (let i = 0; i < P.length; i += 1) {
    const [au, av] = P[i];
    const [bu, bv] = P[(i + 1) % P.length];
    const eu = bu - au;
    const ev = bv - av;
    const L2 = eu * eu + ev * ev;
    if (L2 < 1e-18) continue;
    const t = Math.max(0, Math.min(1, ((u - au) * eu + (v - av) * ev) / L2));
    const du = u - (au + eu * t);
    const dv = v - (av + ev * t);
    const d = Math.hypot(du, dv);
    if (d < best) { best = d; gu = du; gv = dv; }
    const L = Math.sqrt(L2);
    const s = ((u - au) * ev - (v - av) * eu) / L;
    if (s > 0) inside = false;
    if (s > far) { far = s; fu = ev / L; fv = -eu / L; }
  }
  if (inside) return { d: far, gu: fu, gv: fv };
  return { d: best, gu: gu / (best || 1), gv: gv / (best || 1) };
}

function wedgeSection({ h, lo = 0 }) {
  const f = Math.max(0, Math.min(0.98, lo));
  return [[-h[2], -h[1]], [h[2], -h[1]], [h[2], -h[1] + 2 * h[1] * f], [-h[2], h[1]]];
}
const slopeOf = ({ h, lo = 0 }) => Math.atan2(2 * h[1] * (1 - Math.max(0, Math.min(0.98, lo))), 2 * h[2]);

function wedgeDistance(p, w) {
  const c = Math.cos(w.yaw ?? 0);
  const s = Math.sin(w.yaw ?? 0);
  const x = p[0] - w.c[0];
  const y = p[1] - w.c[1];
  const z = p[2] - w.c[2];
  const lx = c * x - s * z; // (world -> the wedge's frame, as boxDistance)
  const lz = s * x + c * z;
  const a = Math.abs(lx) - w.h[0];
  const sec = polyDistance(lz, y, wedgeSection(w));
  const b = sec.d;
  let n;
  let d;
  if (a > 0 && b > 0) { d = Math.hypot(a, b); n = [(Math.sign(lx) * a) / d, (sec.gv * b) / d, (sec.gu * b) / d]; }
  else if (a > b) { d = a; n = [Math.sign(lx) || 1, 0, 0]; }
  else { d = b; n = [0, sec.gv, sec.gu]; }
  return { d, n: [c * n[0] + s * n[2], n[1], -s * n[0] + c * n[2]] };
}

const solidDistance = (p, b) => (b.kind === "wedge" ? wedgeDistance(p, b) : boxDistance(p, b));

function nearestOnRail(p, rail) {
  let best = null;
  for (let i = 0; i < rail.length - 1; i += 1) {
    const a = rail[i];
    const b = rail[i + 1];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L2 = dot(ab, ab);
    const t = Math.max(0, Math.min(1, dot([p[0] - a[0], p[1] - a[1], p[2] - a[2]], ab) / L2));
    const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    if (!best || d < best.d) { const l = Math.sqrt(L2); best = { d, i, t, q, tan: [ab[0] / l, ab[1] / l, ab[2] / l], segLen: l }; }
  }
  return best;
}

function createCharacter({ boxes = [], wedges = [], rails = [], waterY = 0, spawn = [0, 1, 0], tuning = {} }) {
  const K = { ...TUNING, ...tuning };
  if (boxes.some((b) => b.kind === "wedge")) { wedges = [...wedges, ...boxes.filter((b) => b.kind === "wedge")]; boxes = boxes.filter((b) => b.kind !== "wedge"); }
  const walkable = Math.cos((K.slopeMax * Math.PI) / 180);
  const body = {
    pos: [...spawn], vel: [0, 0, 0], mode: "air", facing: 0, time: 0,
    wall: null, wallFace: null, wallTime: 0, rail: null, railS: 0, railDir: 1, coyote: 0, buffer: 0, sinking: 0,
    checkpoint: [...spawn], events: [], slope: null,
  };
  const emit = (type, extra = {}) => body.events.push({ type, at: [...body.pos], ...extra });

  function collide() {
    let ground = null;
    let side = null;
    let sideBox = null;
    let slope = null;
    for (const h of [K.radius, 0.56, 0.86]) {
      for (const b of boxes) {
        const c = [body.pos[0], body.pos[1] + h, body.pos[2]];
        const { d, n } = boxDistance(c, b);
        if (d < K.radius) {
          const push = K.radius - d;
          body.pos[0] += n[0] * push; body.pos[1] += n[1] * push; body.pos[2] += n[2] * push;
          const vn = dot(body.vel, n);
          if (vn < 0) { body.vel[0] -= n[0] * vn; body.vel[1] -= n[1] * vn; body.vel[2] -= n[2] * vn; }
          if (n[1] > 0.65 && h === K.radius) ground = n;
          else if (Math.abs(n[1]) < 0.35) { side = n; sideBox = b; }
        } else if (h === K.radius && d < K.radius + 0.06 && n[1] > 0.65 && body.vel[1] <= 0.5) ground = n;
      }
      for (const w of wedges) {
        const c = [body.pos[0], body.pos[1] + h, body.pos[2]];
        const { d, n } = wedgeDistance(c, w);
        const stand = h === K.radius && n[1] > walkable;
        if (d < K.radius) {
          const push = K.radius - d;
          if (stand) body.pos[1] += push / n[1];
          else { body.pos[0] += n[0] * push; body.pos[1] += n[1] * push; body.pos[2] += n[2] * push; }
          const vn = dot(body.vel, n);
          if (vn < 0) {
            if (stand) body.vel[1] = -(n[0] * body.vel[0] + n[2] * body.vel[2]) / n[1]; // (along the slope, the run kept)
            else { body.vel[0] -= n[0] * vn; body.vel[1] -= n[1] * vn; body.vel[2] -= n[2] * vn; }
          }
          if (stand) { ground = n; slope = n; }
        } else if (stand && d < K.radius + 0.06 && dot(body.vel, n) <= 0.5) { ground = n; slope = n; }
      }
    }
    return { ground, side, sideBox, slope: slope && ground === slope ? slope : null };
  }
  function groundBelow() {
    const c = [body.pos[0], body.pos[1] + K.radius, body.pos[2]];
    let best = null;
    const look = (list, wedge) => {
      for (const b of list) {
        const { d, n } = wedge ? wedgeDistance(c, b) : boxDistance(c, b);
        if (n[1] <= (wedge ? walkable : 0.65) || d < K.radius) continue;
        const drop = (d - K.radius) / n[1];
        if (drop < K.stepDown && (!best || drop < best.drop)) best = { drop, n, wedge };
      }
    };
    look(boxes, false);
    look(wedges, true);
    return best;
  }
  const runnable = (n, b) => {
    if (b.c[1] + b.h[1] < body.pos[1] + 1.1) return false;
    const c = Math.cos(b.yaw ?? 0);
    const s = Math.sin(b.yaw ?? 0);
    return Math.abs(n[0] * c - n[2] * s) > 0.99 || Math.abs(n[0] * s + n[2] * c) > 0.99;
  };
  function wallBeside(face = null) {
    const c = [body.pos[0], body.pos[1] + 0.56, body.pos[2]];
    let best = null;
    for (const b of boxes) {
      const { d, n } = boxDistance(c, b);
      if (face && dot(n, face) < 0.99) continue;
      if (b.c[1] + b.h[1] < body.pos[1] + 1.1) continue; // (a wall rises past the head; a floor's edge is a step, not a wall)
      if (d < K.radius + 0.42 && Math.abs(n[1]) < 0.3 && (!best || d < best.d)) best = { d, n, b };
    }
    return best;
  }

  body.step = (dt, input) => {
    body.events.length = 0;
    body.time += dt;
    const move = input.move ?? [0, 0];
    const mlen = Math.min(1, Math.hypot(move[0], move[1]));
    const wish = mlen > 0.05 ? [move[0] / Math.hypot(move[0], move[1]), 0, move[1] / Math.hypot(move[0], move[1])] : null;
    if (input.jump) body.buffer = K.buffer; else body.buffer = Math.max(0, body.buffer - dt);
    const hv = [body.vel[0], 0, body.vel[2]];
    const hs = len(hv);

    if (body.mode === "sink") {
      body.sinking += dt;
      body.vel = [body.vel[0] * 0.9, -1.2, body.vel[2] * 0.9];
      body.pos[1] += body.vel[1] * dt;
      if (body.sinking > K.respawn) { body.pos = [...body.checkpoint]; body.vel = [0, 0, 0]; body.mode = "air"; body.sinking = 0; emit("respawn"); }
      return body;
    }

    if (body.mode === "grind") {
      const rail = rails[body.rail];
      const at = nearestOnRail(body.pos.map((v, i) => (i === 1 ? v - K.railLift : v)), rail);
      const tan = at.tan.map((v) => v * body.railDir);
      let speed = dot(body.vel, tan) - K.gravity * tan[1] * dt * 0.8;
      speed += (K.railCruise - speed) * Math.min(1, 1.5 * dt);
      speed = Math.min(K.railMax, Math.max(4, speed));
      body.vel = tan.map((v) => v * speed);
      body.pos = [at.q[0] + body.vel[0] * dt, at.q[1] + K.railLift + body.vel[1] * dt, at.q[2] + body.vel[2] * dt];
      emit("grinding", { tan });
      const end = (body.railDir > 0 && at.i === rail.length - 2 && at.t > 0.98) || (body.railDir < 0 && at.i === 0 && at.t < 0.02);
      if (body.buffer > 0) { body.vel[1] = K.jump; body.mode = "air"; body.buffer = 0; body.coyote = 0; emit("jumped"); }
      else if (end) { body.mode = "air"; body.vel[1] += 2; emit("railEnd"); }
      body.facing = Math.atan2(body.vel[0], body.vel[2]);
      return body;
    }

    if (body.mode === "wall") {
      const w = wallBeside(body.wallFace);
      body.wallTime += dt;
      if (!w || body.wallTime > K.wallTime || hs < K.wallMin * 0.6) { body.mode = "air"; emit("wallEnd"); }
      else {
        const n = w.n;
        const along = [hv[0] - n[0] * dot(hv, n), 0, hv[2] - n[2] * dot(hv, n)];
        const al = len(along) || 1;
        const sp = Math.max(K.wallMin + 1, al);
        body.vel[0] = (along[0] / al) * sp - n[0] * 0.8;
        body.vel[2] = (along[2] / al) * sp - n[2] * 0.8;
        body.vel[1] -= K.gravity * K.wallGravity * dt;
        body.wall = n;
        emit("wallRunning", { n });
        if (body.buffer > 0) {
          body.vel = [body.vel[0] * 0.9 + n[0] * K.wallKick, K.wallUp, body.vel[2] * 0.9 + n[2] * K.wallKick];
          body.mode = "air"; body.buffer = 0; emit("wallJump", { n });
        }
      }
    }

    if (body.mode === "ground" || body.mode === "air" || body.mode === "skim") {
      const onGround = body.mode === "ground";
      const accel = onGround ? K.runAccel : body.mode === "skim" ? K.runAccel * 0.4 : K.airAccel;
      if (wish) {
        const target = [wish[0] * K.runSpeed * mlen, wish[2] * K.runSpeed * mlen];
        const dx = target[0] - body.vel[0];
        const dz = target[1] - body.vel[2];
        const dl = Math.hypot(dx, dz);
        const stepA = Math.min(dl, accel * dt);
        if (onGround || dl > 0) { body.vel[0] += (dx / (dl || 1)) * stepA; body.vel[2] += (dz / (dl || 1)) * stepA; }
      } else if (onGround) {
        const f = Math.max(0, hs - K.friction * dt) / (hs || 1);
        body.vel[0] *= f; body.vel[2] *= f;
      }
      if (body.mode === "skim") {
        const f = Math.max(0, hs - K.skimDrag * dt) / (hs || 1);
        body.vel[0] *= f; body.vel[2] *= f;
        body.vel[1] = 0;
        body.pos[1] = waterY;
        emit("skimming");
        if (hs < K.skimMin * 0.9) { body.mode = "sink"; emit("splashIn"); return body; }
        if (body.buffer > 0) { body.vel[1] = K.jump * 0.9; body.mode = "air"; body.buffer = 0; emit("jumped"); }
      } else {
        if (onGround && body.slope) {
          const n = body.slope;
          body.vel[1] = -(n[0] * body.vel[0] + n[2] * body.vel[2]) / n[1];
        } else body.vel[1] = Math.max(body.vel[1] - K.gravity * dt, -K.maxFall);
        if (body.coyote > 0 && body.buffer > 0) { body.vel[1] = K.jump; body.mode = "air"; body.coyote = 0; body.buffer = 0; emit("jumped"); }
        if (body.mode === "air" && body.vel[1] > 0 && !input.hold) body.vel[1] -= K.gravity * 1.4 * dt;
      }
    }

    body.pos[0] += body.vel[0] * dt; body.pos[1] += body.vel[1] * dt; body.pos[2] += body.vel[2] * dt;
    let { ground, side, sideBox, slope } = collide();
    if (!ground && wedges.length && body.mode === "ground" && !body.events.some((e) => e.type === "jumped")) {
      const below = groundBelow();
      if (below && (body.slope || below.wedge)) { body.pos[1] -= below.drop; ground = below.n; slope = below.wedge ? below.n : null; body.vel[1] = slope ? -(slope[0] * body.vel[0] + slope[2] * body.vel[2]) / slope[1] : 0; }
    }
    body.slope = slope; // (standing on a wedge: its normal)
    const wasAir = body.mode === "air";
    if (body.mode !== "wall" && body.mode !== "skim") {
      if (ground) {
        if (wasAir) emit("landed", { speed: -body.vel[1] });
        body.mode = "ground"; body.coyote = K.coyote; body.checkpoint = [body.pos[0], body.pos[1] + 0.2, body.pos[2]];
        if (body.vel[1] < 0 && !slope) body.vel[1] = 0;
      } else {
        if (body.mode === "ground") body.mode = "air";
        body.coyote = Math.max(0, body.coyote - dt);
      }
    }
    if (body.mode === "air" && hs > K.wallMin && body.vel[1] < 4) {
      const w = side ? { n: side, b: sideBox } : wallBeside();
      if (w && Math.abs(dot(hv, w.n)) < hs * 0.75 && runnable(w.n, w.b)) { body.mode = "wall"; body.wallTime = 0; body.wall = w.n; body.wallFace = w.n; body.vel[1] = Math.max(body.vel[1], 1.2); emit("wallStart", { n: w.n }); }
    }
    if (body.mode === "air" && body.vel[1] <= 0.5) {
      rails.forEach((rail, i) => {
        if (body.mode !== "air") return;
        const at = nearestOnRail([body.pos[0], body.pos[1] - 0.05, body.pos[2]], rail);
        if (at && at.d < K.railSnap) {
          const dir = dot(body.vel, at.tan) >= 0 ? 1 : -1;
          if ((dir > 0 && at.i === rail.length - 2 && at.t > 0.98) || (dir < 0 && at.i === 0 && at.t < 0.02)) return;
          body.mode = "grind"; body.rail = i;
          body.railDir = dir;
          const sp = Math.min(K.railMax, Math.max(Math.abs(dot(body.vel, at.tan)), hs, 6) + K.railPush);
          body.vel = at.tan.map((v) => v * body.railDir * sp);
          emit("railStart");
        }
      });
    }
    if ((body.mode === "air" || body.mode === "ground") && body.pos[1] <= waterY && body.vel[1] <= 0) {
      if (hs >= K.skimMin) { body.mode = "skim"; body.pos[1] = waterY; body.vel[1] = 0; emit("skimStart"); }
      else { body.mode = "sink"; body.sinking = 0; emit("splashIn"); }
    }
    if (hs > 0.5) body.facing = Math.atan2(body.vel[0], body.vel[2]);
    return body;
  };
  return body;
}

return { get TUNING() { return TUNING; }, get boxDistance() { return boxDistance; }, get wedgeSection() { return wedgeSection; }, get slopeOf() { return slopeOf; }, get wedgeDistance() { return wedgeDistance; }, get solidDistance() { return solidDistance; }, get nearestOnRail() { return nearestOnRail; }, get createCharacter() { return createCharacter; } };
});

__def("src/particles/particles.js", () => {

const RECIPES = {
  dust: { life: [0.35, 0.7], speed: [0.4, 1.4], up: [0.3, 1.2], gravity: -0.4, drag: 3, size: [0.9, 1.6], light: [0.72, 0.9], fade: 0.5, ramp: "stone" },
  spark: { life: [0.15, 0.4], speed: [1, 3.5], up: [0.5, 2.5], gravity: 14, drag: 0.5, size: [0.5, 0.9], light: [0.75, 1], fade: 0.7, ramp: "spark" },
  splash: { life: [0.3, 0.6], speed: [0.5, 2], up: [1.5, 3.5], gravity: 12, drag: 0.8, size: [0.6, 1.1], light: [0.8, 1], fade: 0.4, ramp: "water" },
  mote: { life: [2, 4], speed: [0.05, 0.2], up: [-0.05, 0.1], gravity: 0, drag: 0.2, size: [0.5, 0.8], light: [0.6, 0.95], fade: 0.5, ramp: "stone" },
};

function createParticles(max = 600) {
  const pool = [];
  const lerp = (S, [a, b]) => a + (b - a) * S.f();
  return {
    recipes: RECIPES,
    emit(kind, at, { count = 4, S, vel = [0, 0, 0], spread = 1, ramp } = {}) {
      const R = RECIPES[kind];
      for (let i = 0; i < count && pool.length < max; i += 1) {
        const a = S.f() * Math.PI * 2;
        const sp = lerp(S, R.speed) * spread;
        pool.push({
          p: [...at], v: [vel[0] + Math.cos(a) * sp, vel[1] + lerp(S, R.up), vel[2] + Math.sin(a) * sp],
          age: 0, life: lerp(S, R.life), size: lerp(S, R.size), light: lerp(S, R.light), ramp: ramp ?? R.ramp, R,
        });
      }
    },
    step(dt) {
      for (let i = pool.length - 1; i >= 0; i -= 1) {
        const q = pool[i];
        q.age += dt;
        if (q.age >= q.life) { pool.splice(i, 1); continue; }
        const k = Math.exp(-q.R.drag * dt);
        q.v[0] *= k; q.v[2] *= k;
        q.v[1] = q.v[1] * k - q.R.gravity * dt;
        q.p[0] += q.v[0] * dt; q.p[1] += q.v[1] * dt; q.p[2] += q.v[2] * dt;
      }
    },
    list() {
      return pool.map((q) => ({ p: q.p, size: q.size, ramp: q.ramp, light: q.light * (1 - q.R.fade * (q.age / q.life)) }));
    },
    get count() { return pool.length; },
  };
}

return { get createParticles() { return createParticles; } };
});

__def("src/entity/rig.js", () => {

const { frontOf } = __mod("src/core/frame.js");
const IDENTITY = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const rotX = (a) => { const c = Math.cos(a); const s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const rotY = (a) => { const c = Math.cos(a); const s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotZ = (a) => { const c = Math.cos(a); const s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
function mul(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return o;
}
const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
function euler(rx = 0, ry = 0, rz = 0) {
  if (rx === 0 && ry === 0 && rz === 0) return [...IDENTITY];
  return mul(rotY(ry), mul(rotX(rx), rotZ(rz)));
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a); return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0]; };

function rotateOnto(u, v) {
  const c = dot(u, v);
  if (c > 1 - 1e-12) return [...IDENTITY];
  let k = cross(u, v);
  if (c < -1 + 1e-9) {
    k = Math.abs(u[0]) < 0.9 ? cross(u, [1, 0, 0]) : cross(u, [0, 1, 0]);
    k = unit(k);
    return [2 * k[0] * k[0] - 1, 2 * k[0] * k[1], 2 * k[0] * k[2], 2 * k[1] * k[0], 2 * k[1] * k[1] - 1, 2 * k[1] * k[2], 2 * k[2] * k[0], 2 * k[2] * k[1], 2 * k[2] * k[2] - 1];
  }
  const s = len(k);
  k = scale(k, 1 / s);
  const t = 1 - c;
  const [x, y, z] = k;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}


function solveTwoBone(a, target, L1, L2, pole) {
  let d = sub(target, a);
  let dist = len(d);
  const n = dist > 1e-9 ? scale(d, 1 / dist) : unit(pole);
  const lo = Math.abs(L1 - L2) + 1e-9;
  const hi = L1 + L2 - 1e-9;
  const reached = dist <= hi && dist >= lo;
  dist = Math.min(hi, Math.max(lo, dist));
  const end = add(a, scale(n, dist));
  const cosA = Math.max(-1, Math.min(1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  let q = sub(pole, scale(n, dot(pole, n)));
  if (len(q) < 1e-9) q = Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0]);
  q = unit(q);
  const mid = add(a, add(scale(n, L1 * cosA), scale(q, L1 * sinA)));
  return { mid, end, reached };
}


function humanoidRig(b) {
  const T = b.torso;
  const tl = b.tailLen || b.torsoR * 0.5;
  const tailDir = unit([0, 0.55, -1]);
  const bones = [
    { name: "hips", parent: null, off: [0, b.hipH, 0] },
    { name: "spine", parent: "hips", off: [0, T * 0.28, 0] },
    { name: "chest", parent: "spine", off: [0, T * 0.3, 0] },
    { name: "neck", parent: "chest", off: [0, T * 0.42, 0] },
    { name: "head", parent: "neck", off: [0, b.neck, 0], tip: [0, b.headR * 2, 0] },
    { name: "tail0", parent: "hips", off: [0, T * 0.05, -b.torsoR * 0.8] },
    { name: "tail1", parent: "tail0", off: scale(tailDir, tl * 0.5), tip: scale(tailDir, tl * 0.5) },
  ];
  for (const [s, side] of [[-1, "L"], [1, "R"]]) {
    bones.push(
      { name: `shoulder.${side}`, parent: "chest", off: [s * b.shoulderW * 0.35, T * 0.36, 0] },
      { name: `upperArm.${side}`, parent: `shoulder.${side}`, off: [s * b.shoulderW * 0.65, 0, 0] },
      { name: `forearm.${side}`, parent: `upperArm.${side}`, off: [0, -b.upperArm, 0] },
      { name: `hand.${side}`, parent: `forearm.${side}`, off: [0, -b.forearm, 0], tip: [0, -b.handLen, 0] },
      { name: `thigh.${side}`, parent: "hips", off: [s * b.hipW, 0, 0] },
      { name: `shin.${side}`, parent: `thigh.${side}`, off: [0, -b.thigh, 0] },
      { name: `foot.${side}`, parent: `shin.${side}`, off: [0, -b.shin, 0], tip: [0, -(b.ankleH - b.footR), b.footLen * 0.78] },
    );
  }
  return makeRig("humanoid", bones, {
    "leg.L": { bones: ["thigh.L", "shin.L", "foot.L"], pole: [0, 0, 1], poleIn: "hips" },
    "leg.R": { bones: ["thigh.R", "shin.R", "foot.R"], pole: [0, 0, 1], poleIn: "hips" },
    "arm.L": { bones: ["upperArm.L", "forearm.L", "hand.L"], pole: [-0.35, 0, -1], poleIn: "chest" },
    "arm.R": { bones: ["upperArm.R", "forearm.R", "hand.R"], pole: [0.35, 0, -1], poleIn: "chest" },
  }, b);
}

function quadrupedRig(b) {
  const rise = (b.shoulderH - b.hipH) * 0.5;
  const seg = b.tailLen / 3;
  const tr = b.tailRise ?? 0.4;
  const tailDir = [0, Math.sin(tr), -Math.cos(tr)];
  const bones = [
    { name: "pelvis", parent: null, off: [0, b.hipH, -b.bodyLen / 2] },
    { name: "spine", parent: "pelvis", off: [0, rise, b.bodyLen / 2] },
    { name: "chest", parent: "spine", off: [0, rise, b.bodyLen / 2] },
    { name: "neck", parent: "chest", off: [0, b.bodyR * 0.35, b.bodyR * 0.45] },
    { name: "head", parent: "neck", off: [0, b.neckLen * Math.sin(b.neckRise), b.neckLen * Math.cos(b.neckRise)], tip: [0, 0, b.headR * 2] },
    { name: "tail0", parent: "pelvis", off: [0, b.bodyR * 0.3, -b.bodyR * 0.55] },
    { name: "tail1", parent: "tail0", off: scale(tailDir, seg) },
    { name: "tail2", parent: "tail1", off: scale(tailDir, seg), tip: scale(tailDir, seg) },
  ];
  for (const [s, side] of [[-1, "L"], [1, "R"]]) {
    for (const [end, parent, up, lo] of [["F", "chest", b.upperF, b.lowerF], ["H", "pelvis", b.upperH, b.lowerH]]) {
      const k = `${end}${side}`;
      bones.push(
        { name: `upper.${k}`, parent, off: [s * b.w, 0, 0] },
        { name: `lower.${k}`, parent: `upper.${k}`, off: [0, -up, 0] },
        { name: `paw.${k}`, parent: `lower.${k}`, off: [0, -lo, 0], tip: [0, -(b.ankleH - b.pawR), b.pawLen] },
      );
    }
  }
  const chains = {};
  for (const k of ["FL", "FR", "HL", "HR"]) {
    chains[`leg.${k}`] = { bones: [`upper.${k}`, `lower.${k}`, `paw.${k}`], pole: [0, 0, k[0] === "F" ? 1 : -1], poleIn: k[0] === "F" ? "chest" : "pelvis" };
  }
  return makeRig("quadruped", bones, chains, b);
}

function makeRig(plan, bones, chains, body) {
  const index = {};
  bones.forEach((bone, i) => {
    if (bone.parent !== null && index[bone.parent] === undefined) throw new Error(`${plan}: ${bone.name} comes before its parent ${bone.parent}`);
    index[bone.name] = i;
  });
  const children = Object.fromEntries(bones.map((bn) => [bn.name, []]));
  for (const bn of bones) if (bn.parent) children[bn.parent].push(bn.name);
  for (const c of Object.values(chains)) c.lengths = [len(bones[index[c.bones[1]]].off), len(bones[index[c.bones[2]]].off)];
  return { plan, bones, index, children, chains, body, top: bones[0].name };
}

function restLengths(rig) {
  const out = {};
  for (const bn of rig.bones) if (bn.parent) out[bn.name] = len(bn.off);
  return out;
}


function poseSkeleton(rig, pose = {}, place = {}) {
  const R = pose.root ?? {};
  const yaw = place.yaw ?? 0;
  const pos = R.shift ? add(place.pos ?? [0, 0, 0], apply(rotY(yaw), R.shift)) : place.pos ?? [0, 0, 0];
  const rootM = mul(rotY(yaw + (R.yaw ?? 0)), mul(rotX(R.pitch ?? 0), rotZ(R.roll ?? 0)));
  const rot = pose.rot ?? {};
  const out = {};
  const fk = (bn) => {
    const parent = bn.parent ? out[bn.parent] : { p: pos, m: rootM };
    const off = bn.parent ? bn.off : add(bn.off, R.off ?? [0, 0, 0]);
    const r = rot[bn.name];
    out[bn.name] = { p: add(parent.p, apply(parent.m, off)), m: r ? mul(parent.m, euler(r[0], r[1], r[2])) : parent.m };
  };
  for (const bn of rig.bones) fk(bn);
  const refk = (name) => { for (const c of rig.children[name]) { fk(rig.bones[rig.index[c]]); refk(c); } };

  for (const [name, goal] of Object.entries(pose.ik ?? {})) {
    const chain = rig.chains[name];
    const w = goal?.w ?? 1;
    if (!chain || !(w > 0) || !goal.at) continue;
    const [b0, b1, b2] = chain.bones;
    const A = out[b0].p;
    const wanted = add(pos, apply(rootM, goal.at));
    const target = w >= 1 ? wanted : add(out[b2].p, scale(sub(wanted, out[b2].p), w));
    const pole = unit(apply(out[chain.poleIn].m, goal.pole ?? chain.pole));
    const [L1, L2] = chain.lengths;
    const { mid, end } = solveTwoBone(A, target, L1, L2, pole);
    const r0 = rig.bones[rig.index[b1]].off;
    const r1 = rig.bones[rig.index[b2]].off;
    const m0 = mul(rotateOnto(unit(apply(out[b0].m, r0)), unit(sub(mid, A))), out[b0].m);
    const m1fk = mul(m0, euler(...(rot[b1] ?? [0, 0, 0])));
    const m1 = mul(rotateOnto(unit(apply(m1fk, r1)), unit(sub(end, mid))), m1fk);
    out[b0] = { p: A, m: m0 };
    out[b1] = { p: mid, m: m1 };
    const flat = goal.flat ?? w >= 1;
    const m2 = flat ? mul(rootM, euler(goal.pitch ?? 0, goal.yaw ?? 0, 0)) : mul(m1, euler(...(rot[b2] ?? [0, 0, 0])));
    out[b2] = { p: end, m: m2 };
    refk(b2);
  }
  return { plan: rig.plan, root: { pos: [...pos], yaw, m: rootM }, bones: out, pose };
}

const boneToWorld = (skel, name, local) => { const b = skel.bones[name]; return add(b.p, apply(b.m, local)); };
const boneFront = (skel, name) => apply(skel.bones[name].m, [0, 0, 1]);

function measuredLengths(rig, skel) {
  const out = {};
  for (const bn of rig.bones) if (bn.parent) out[bn.name] = len(sub(skel.bones[bn.name].p, skel.bones[bn.parent].p));
  return out;
}

const declaredFront = (skel) => frontOf(skel.root.yaw + (skel.pose?.root?.yaw ?? 0));

return { get IDENTITY() { return IDENTITY; }, get rotX() { return rotX; }, get rotY() { return rotY; }, get rotZ() { return rotZ; }, get mul() { return mul; }, get apply() { return apply; }, get euler() { return euler; }, get rotateOnto() { return rotateOnto; }, get solveTwoBone() { return solveTwoBone; }, get humanoidRig() { return humanoidRig; }, get quadrupedRig() { return quadrupedRig; }, get restLengths() { return restLengths; }, get poseSkeleton() { return poseSkeleton; }, get boneToWorld() { return boneToWorld; }, get boneFront() { return boneFront; }, get measuredLengths() { return measuredLengths; }, get declaredFront() { return declaredFront; } };
});

__def("src/core/rng.js", () => {

const HEX_SEED = /^0x[0-9a-f]{64}$/u;

function normalizeSeed(value) {
  const clean = String(value ?? "").toLowerCase().replace(/^0x/u, "");
  if (!/^[0-9a-f]+$/u.test(clean) || clean.length > 64) {
    throw new TypeError("Seed must be one to sixty-four hexadecimal digits.");
  }
  const seed = `0x${clean.padStart(64, "0")}`;
  if (!HEX_SEED.test(seed)) throw new TypeError("Seed must resolve to bytes32.");
  return seed;
}

function seedFromToken(tokenId, collection = "nocturnes-v0") {
  const index = BigInt(tokenId);
  if (index < 0n) throw new RangeError("Token ID must not be negative.");
  let state = 0x811c9dc5;
  const feed = (text) => {
    for (let at = 0; at < text.length; at += 1) {
      state = Math.imul(state ^ text.charCodeAt(at), 0x01000193) >>> 0;
      state = (state ^ (state >>> 13)) >>> 0;
    }
    return state >>> 0;
  };
  feed(`${collection}:${index}`);
  let hex = "";
  for (let word = 0; word < 8; word += 1) hex += feed(`:${word}`).toString(16).padStart(8, "0");
  return `0x${hex}`;
}

function seedBytes(seed) {
  const clean = normalizeSeed(seed).slice(2);
  const bytes = new Uint8Array(32);
  for (let at = 0; at < 32; at += 1) bytes[at] = Number.parseInt(clean.slice(at * 2, at * 2 + 2), 16);
  return bytes;
}

function expand(bytes, slot) {
  let state = 0x811c9dc5;
  for (const byte of bytes) state = Math.imul(state ^ byte, 0x01000193) >>> 0;
  for (let shift = 0; shift < 32; shift += 8) {
    state = Math.imul(state ^ ((slot >>> shift) & 0xff), 0x01000193) >>> 0;
  }
  state = (state ^ (state >>> 15)) >>> 0;
  return state & 0xffff;
}

function createRoll(seed) {
  const bytes = seedBytes(seed);
  const words = new Uint16Array(16);
  for (let at = 0; at < 16; at += 1) words[at] = (bytes[at * 2] << 8) | bytes[at * 2 + 1];

  const at = (slot) => (slot < 16 ? words[slot] : expand(bytes, slot));

  const api = {
    seed: normalizeSeed(seed),
    at,
    pick(slot, list) { return list[at(slot) % list.length]; },
    index(slot, length) { return at(slot) % length; },
    range(slot, low, high) { return low + (at(slot) % (high - low + 1)); },
    chance(slot, numerator, denominator = 100) { return at(slot) % denominator < numerator; },
    weighted(slot, entries) {
      let total = 0;
      for (const [, weight] of entries) total += weight;
      let ticket = at(slot) % total;
      for (const [value, weight] of entries) {
        if (ticket < weight) return value;
        ticket -= weight;
      }
      return entries[entries.length - 1][0];
    },
    sub(slot) {
      let cursor = 0;
      const base = 0x10000 + slot * 4096;
      const next = () => expand(bytes, base + cursor++);
      return {
        next,
        index: (length) => next() % length,
        pick: (list) => list[next() % list.length],
        range: (low, high) => low + (next() % (high - low + 1)),
        chance: (numerator, denominator = 100) => next() % denominator < numerator,
        weighted(entries) {
          let total = 0;
          for (const [, weight] of entries) total += weight;
          let ticket = next() % total;
          for (const [value, weight] of entries) {
            if (ticket < weight) return value;
            ticket -= weight;
          }
          return entries[entries.length - 1][0];
        },
      };
    },
  };
  return api;
}


function stream(roll, slot) {
  const sub = roll.sub(slot);
  const f = () => sub.next() / 65536;
  return {
    f,
    between: (a, b) => a + (b - a) * f(),
    int: (a, b) => a + Math.floor(f() * (b - a + 1)),
    pick: (list) => list[Math.floor(f() * list.length)],
    chance: (p) => f() < p,
    weighted(entries) {
      let total = 0;
      for (const [, w] of entries) total += w;
      let ticket = f() * total;
      for (const [value, w] of entries) {
        if (ticket < w) return value;
        ticket -= w;
      }
      return entries[entries.length - 1][0];
    },
  };
}

function deriveSeed(seed, label) {
  let h = 0x811c9dc5;
  const text = `${seed}:${label}`;
  let hex = "";
  for (let w = 0; w < 8; w += 1) {
    for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    h = Math.imul(h ^ w, 0x01000193) >>> 0;
    hex += (h >>> 0).toString(16).padStart(8, "0");
  }
  return `0x${hex}`;
}

return { get normalizeSeed() { return normalizeSeed; }, get seedFromToken() { return seedFromToken; }, get createRoll() { return createRoll; }, get stream() { return stream; }, get deriveSeed() { return deriveSeed; } };
});

__def("src/entity/species.js", () => {

const { createRoll, deriveSeed, stream } = __mod("src/core/rng.js");
const { humanoidRig, quadrupedRig } = __mod("src/entity/rig.js");
const KINDS = ["humanoid", "anthro", "animal"];

const SPECIES = {
  humanoid: [["human", 1]],
  anthro: [["cat", 4], ["fox", 3], ["bunny", 3], ["bear", 2], ["mouse", 2], ["frog", 1], ["dog", 2]],
  animal: [["cat", 3], ["dog", 3], ["fox", 2], ["bear", 1], ["rabbit", 2], ["mouse", 1], ["deer", 2]],
};
const ALIAS = { anthro: { rabbit: "bunny" }, animal: { bunny: "rabbit" } };

const LOOK = {
  human: { ears: ["none"], snout: 0.08, tail: ["none", 0], coats: [["plain", 1]], fur: [[0.82, 0.05, 60], [0.72, 0.07, 55], [0.6, 0.08, 50], [0.45, 0.06, 45], [0.35, 0.05, 40]], alt: 0.05 },
  cat: { ears: ["point", "point", "tuft"], snout: 0.18, tail: ["long", 0.38], coats: [["plain", 3], ["socks", 2], ["muzzle", 2], ["tipped", 1]], fur: [[0.93, 0.01, 80], [0.72, 0.12, 60], [0.6, 0.02, 250], [0.3, 0.02, 280], [0.8, 0.05, 75]], alt: 0.95 },
  fox: { ears: ["tall"], snout: 0.62, tail: ["bushy", 0.42], coats: [["tipped", 3], ["muzzle", 2], ["socks", 2]], fur: [[0.66, 0.15, 50], [0.72, 0.13, 60], [0.55, 0.14, 40], [0.85, 0.02, 250]], alt: 0.95 },
  bunny: { ears: ["long", "long", "lop"], snout: 0.18, tail: ["puff", 0.07], coats: [["plain", 3], ["muzzle", 2]], fur: [[0.95, 0.01, 80], [0.8, 0.03, 70], [0.62, 0.04, 60], [0.5, 0.03, 50]], alt: 0.97 },
  rabbit: { ears: ["long", "long", "lop"], snout: 0.22, tail: ["puff", 0.3], coats: [["plain", 3], ["muzzle", 2]], fur: [[0.95, 0.01, 80], [0.8, 0.03, 70], [0.62, 0.04, 60], [0.5, 0.03, 50]], alt: 0.97 },
  bear: { ears: ["round"], snout: 0.5, tail: ["stub", 0.06], coats: [["muzzle", 3], ["plain", 1]], fur: [[0.45, 0.06, 55], [0.35, 0.04, 50], [0.95, 0.01, 90], [0.25, 0.01, 270], [0.6, 0.08, 60]], alt: 0.7 },
  mouse: { ears: ["big"], snout: 0.42, tail: ["thin", 0.5], coats: [["plain", 2], ["muzzle", 1]], fur: [[0.7, 0.01, 260], [0.6, 0.04, 60], [0.9, 0.01, 80]], alt: 0.85 },
  frog: { ears: ["none"], snout: 0, tail: ["none", 0], coats: [["plain", 2], ["muzzle", 1]], fur: [[0.7, 0.15, 140], [0.65, 0.14, 120], [0.72, 0.12, 170]], alt: 0.9 },
  dog: { ears: ["flop", "flop", "point"], snout: 0.55, tail: ["long", 0.25], coats: [["plain", 2], ["muzzle", 2], ["socks", 2]], fur: [[0.7, 0.09, 70], [0.4, 0.06, 55], [0.9, 0.02, 85], [0.25, 0.01, 280], [0.6, 0.1, 60]], alt: 0.92 },
  deer: { ears: ["side"], snout: 0.9, tail: ["stub", 0.15], coats: [["muzzle", 2], ["plain", 1]], fur: [[0.58, 0.09, 55], [0.5, 0.08, 50], [0.65, 0.07, 65]], alt: 0.9 },
};
const EARS = {
  none: [0, 0, 0],
  point: [0.62, 0.2, 0.52], tuft: [0.72, 0.18, 0.5], tall: [0.9, 0.24, 0.48], long: [1.55, 0.2, 0.3],
  lop: [1.2, 0.2, 0.7], round: [0.3, 0.3, 0.72], big: [0.5, 0.46, 0.78], flop: [0.75, 0.24, 0.8], side: [0.75, 0.2, 0.9],
};

const QUAD = {
  cat: { sh: 0.25, len: 1.45, head: 0.3, girth: 0.3, neck: 0.45, rise: 0.75, hind: 1.02, snout: 0.3, paw: 0.26, tailRise: 0.45, leg: 0.075 },
  dog: { sh: 0.5, len: 1.25, head: 0.25, girth: 0.28, neck: 0.5, rise: 0.8, hind: 0.98, snout: 0.85, paw: 0.2, tailRise: 0.6, leg: 0.07 },
  fox: { sh: 0.35, len: 1.4, head: 0.26, girth: 0.25, neck: 0.5, rise: 0.65, hind: 1, snout: 0.95, paw: 0.2, tailRise: 0.15, leg: 0.06 },
  bear: { sh: 0.85, len: 1.45, head: 0.28, girth: 0.42, neck: 0.38, rise: 0.25, hind: 1.02, snout: 0.7, paw: 0.24, tailRise: 0.3, leg: 0.11 },
  rabbit: { sh: 0.15, len: 1.45, head: 0.5, girth: 0.5, neck: 0.3, rise: 0.9, hind: 1.12, snout: 0.35, paw: 0.55, tailRise: 0.6, leg: 0.1 },
  mouse: { sh: 0.05, len: 1.8, head: 0.55, girth: 0.5, neck: 0.25, rise: 0.45, hind: 1.05, snout: 0.7, paw: 0.35, tailRise: 0.15, leg: 0.1 },
  deer: { sh: 0.95, len: 1.05, head: 0.17, girth: 0.22, neck: 0.8, rise: 1.05, hind: 1.05, snout: 1.1, paw: 0.14, tailRise: 0.8, leg: 0.045 },
};
const ANTHRO_H = { cat: 1, fox: 1.05, bunny: 0.95, bear: 1.12, mouse: 0.86, frog: 0.86, dog: 1.04 };

const between = (u, a, b) => a + (b - a) * u;
const isOutfitted = (kind) => kind !== "animal";

const CHOICES = [
  { name: "kind", reads: [], options: KINDS, pick: (S) => S.weighted([["humanoid", 2], ["anthro", 3], ["animal", 2]]) },
  { name: "species", reads: ["kind"], optionsOf: (c) => SPECIES[c.kind].map(([s]) => s), pick: (S, c) => S.weighted(SPECIES[c.kind]) },
  { name: "height", reads: [], pick: (S) => between(S.f(), 0.9, 1.1) },
  { name: "head", reads: [], pick: (S) => between(S.f(), 0.88, 1.12) },
  { name: "legs", reads: [], pick: (S) => between(S.f(), 0.92, 1.08) },
  { name: "arms", reads: [], pick: (S) => between(S.f(), 0.92, 1.08) },
  { name: "girth", reads: [], pick: (S) => between(S.f(), 0.85, 1.15) },
  { name: "ears", reads: ["species"], optionsOf: (c) => [...new Set(LOOK[c.species].ears)], pick: (S, c) => S.pick(LOOK[c.species].ears) },
  { name: "earSize", reads: [], pick: (S) => between(S.f(), 0.85, 1.15) },
  { name: "snout", reads: [], pick: (S) => between(S.f(), 0.85, 1.2) },
  { name: "tail", reads: [], pick: (S) => between(S.f(), 0.8, 1.2) },
  { name: "eyes", reads: [], pick: (S) => between(S.f(), 0.85, 1.2) },
  { name: "coat", reads: ["species"], optionsOf: (c) => LOOK[c.species].coats.map(([v]) => v), pick: (S, c) => S.weighted(LOOK[c.species].coats) },
  { name: "hair", reads: ["species"], options: ["none", "short", "long", "bun", "spiky", "pony"], pick: (S, c) => (c.species === "human" ? S.weighted([["short", 4], ["long", 2], ["bun", 2], ["spiky", 2], ["pony", 2], ["none", 1]]) : "none") },
  { name: "top", reads: ["kind"], options: ["jacket", "hoodie", "tee", "vest", "none"], pick: (S, c) => (isOutfitted(c.kind) ? S.weighted([["jacket", 4], ["hoodie", 3], ["tee", 2], ["vest", 1]]) : "none") },
  { name: "hood", reads: ["species", "top"], options: [true, false], pick: (S, c) => (c.species !== "frog" && (c.top === "jacket" || c.top === "hoodie") ? S.chance(c.top === "hoodie" ? 0.6 : 0.35) : false) },
  { name: "pants", reads: ["kind"], options: ["long", "shorts", "none"], pick: (S, c) => (isOutfitted(c.kind) ? S.weighted(c.kind === "humanoid" ? [["long", 3], ["shorts", 1]] : [["none", 3], ["long", 2], ["shorts", 2]]) : "none") },
  { name: "shoes", reads: ["kind", "species"], options: ["sneakers", "boots", "bare"], pick: (S, c) => (!isOutfitted(c.kind) || c.species === "frog" ? "bare" : S.weighted([["sneakers", 4], ["boots", 2], ["bare", c.kind === "anthro" ? 1 : 0.2]])) },
  { name: "pack", reads: ["kind"], options: ["round", "tall", "small", "none"], pick: (S, c) => (isOutfitted(c.kind) ? S.weighted([["round", 4], ["tall", 2], ["small", 2], ["none", 2]]) : "none") },
  { name: "accessory", reads: ["kind", "species"], options: ["none", "scarf", "cap", "goggles", "headband", "collar"], pick: (S, c) => (isOutfitted(c.kind) ? S.weighted([["none", 5], ["scarf", 2], ["cap", 2], ["goggles", 1], ["headband", 1]]) : c.species === "cat" || c.species === "dog" ? S.weighted([["none", 1], ["collar", 1]]) : "none") },
  { name: "antlers", reads: ["kind", "species"], options: [true, false], pick: (S, c) => c.kind === "animal" && c.species === "deer" && S.chance(0.55) },
  { name: "stride", reads: [], pick: (S) => between(S.f(), 0.9, 1.1) },
  { name: "furColour", reads: ["species"], pick: (S, c) => S.pick(LOOK[c.species].fur) },
  { name: "outfitColour", reads: [], pick: (S) => { const h = S.pick([165, 180, 200, 140, 25, 300, 260, 45, 350]); return { cloth: [0.55, 0.12, h], clothAlt: [0.35, 0.04, h + 120], accent: [0.52, 0.12, (h + S.pick([150, 180, 200])) % 360] }; } },
  { name: "hairColour", reads: [], pick: (S) => S.pick([[0.25, 0.03, 50], [0.4, 0.07, 55], [0.72, 0.1, 85], [0.55, 0.14, 40], [0.2, 0.01, 280], [0.85, 0.02, 90]]) },
];
const BY_NAME = Object.fromEntries(CHOICES.map((c) => [c.name, c]));

function readsOf(name) {
  const out = new Set();
  const walk = (n) => { for (const r of BY_NAME[n].reads) if (!out.has(r)) { out.add(r); walk(r); } };
  walk(name);
  return out;
}

const choiceStream = (seed, name) => stream(createRoll(deriveSeed(deriveSeed(String(seed), "entity"), name)), 0);

function entityOf(seed, { kind, species, pins = {}, size } = {}) {
  const locked = { ...pins };
  if (kind !== undefined) locked.kind = kind;
  if (species !== undefined) locked.species = species;
  for (const name of Object.keys(locked)) if (!BY_NAME[name]) throw new TypeError(`No entity choice called "${name}" (choices: ${CHOICES.map((c) => c.name).join(", ")}).`);
  const c = {};
  for (const ch of CHOICES) {
    if (locked[ch.name] !== undefined) {
      let v = locked[ch.name];
      if (ch.name === "species") v = ALIAS[c.kind]?.[v] ?? v;
      const opts = ch.optionsOf ? ch.optionsOf(c) : ch.options;
      if (opts && !opts.includes(v)) throw new RangeError(`Entity choice ${ch.name} = ${JSON.stringify(v)} is not one of ${JSON.stringify(opts)}${ch.optionsOf ? ` (for ${ch.reads.map((r) => `${r} ${c[r]}`).join(", ")})` : ""}.`);
      c[ch.name] = v;
    } else {
      c[ch.name] = ch.pick(choiceStream(seed, ch.name), c);
    }
  }
  const body = c.kind === "animal" ? quadrupedBody(c, size) : humanoidBody(c, size);
  const features = featuresOf(c, body);
  const outfit = { top: c.top, hood: c.hood, pants: c.pants, shoes: c.shoes, pack: c.pack, accessory: c.accessory };
  const colours = { fur: c.furColour, furAlt: [LOOK[c.species].alt, 0.02, c.furColour[2]], ...c.outfitColour, hair: c.hairColour, dark: [0.18, 0.02, 280], blush: [0.72, 0.1, 15] };
  const rig = c.kind === "animal" ? quadrupedRig(body) : humanoidRig(body);
  return {
    seed: String(seed),
    kind: c.kind,
    species: c.species,
    plan: rig.plan,
    choices: c,
    pinned: Object.keys(locked).sort(),
    body,
    features,
    outfit,
    colours,
    front: { dir: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
    rig,
  };
}

function humanoidBody(c, size) {
  const human = c.kind === "humanoid";
  const H = size ?? (human ? 1.7 : ANTHRO_H[c.species] ?? 1) * c.height;
  const headR = (H * (human ? 0.135 : 0.38) * c.head) / 2;
  const hipH = H * (human ? 0.5 : 0.3) * c.legs;
  const neck = H * (human ? 0.035 : 0.012);
  const torso = H - hipH - neck - headR * 2;
  const footR = H * (human ? 0.028 : 0.045);
  const ankleH = Math.max(footR * 1.25, hipH * 0.08);
  const reach = hipH - ankleH;
  const torsoR = H * (human ? 0.085 : 0.14) * c.girth;
  const tail = LOOK[c.species].tail;
  return {
    H, hipH, ankleH, footR, neck, torso, headR, torsoR,
    thigh: reach * 0.5, shin: reach * 0.5,
    footLen: H * (human ? 0.13 : 0.13),
    hipW: human ? H * 0.055 * Math.sqrt(c.girth) : torsoR * 0.52,
    shoulderW: human ? H * 0.115 * Math.sqrt(c.girth) : torsoR * 0.95,
    upperArm: H * (human ? 0.17 : 0.11) * c.arms,
    forearm: H * (human ? 0.145 : 0.095) * c.arms,
    handLen: H * (human ? 0.055 : 0.04),
    legR: H * (human ? 0.034 : 0.052) * Math.sqrt(c.girth),
    armR: H * (human ? 0.028 : 0.038) * Math.sqrt(c.girth),
    tailLen: tail[0] === "none" ? 0 : H * tail[1] * c.tail,
    stride: c.stride,
  };
}

function quadrupedBody(c, size) {
  const q = QUAD[c.species];
  const sh = size ?? q.sh * c.height * c.legs;
  const hipH = sh * q.hind;
  const legR = sh * q.leg * Math.sqrt(c.girth);
  const ankleH = Math.max(sh * 0.085, legR * 1.05); // (a thick leg's end stays off the ground)
  const bodyR = sh * q.girth * c.girth;
  const tail = LOOK[c.species].tail;
  return {
    shoulderH: sh, hipH, ankleH, bodyR, legR,
    H: sh + bodyR + sh * q.neck * Math.sin(q.rise) + sh * q.head * c.head * 2,
    bodyLen: sh * q.len / c.legs,
    neckLen: sh * q.neck,
    neckRise: q.rise,
    headR: sh * q.head * c.head,
    w: bodyR * 0.62,
    upperF: (sh - ankleH) * 0.5, lowerF: (sh - ankleH) * 0.5,
    upperH: (hipH - ankleH) * 0.5, lowerH: (hipH - ankleH) * 0.5,
    pawR: legR * 1.2,
    pawLen: sh * q.paw,
    snoutLen: q.snout,
    tailLen: tail[0] === "none" ? 0 : sh * tail[1] * 3 * c.tail,
    tailRise: q.tailRise,
    stride: c.stride,
  };
}

function featuresOf(c, body) {
  const [len, w, spread] = EARS[c.ears];
  const tail = LOOK[c.species].tail;
  const quad = c.kind === "animal";
  return {
    ears: { shape: c.ears, len: len * c.earSize, w: w * Math.sqrt(c.earSize), spread },
    snout: (quad ? QUAD[c.species].snout : LOOK[c.species].snout) * c.snout,
    tail: { shape: tail[0], len: body.tailLen },
    eyes: { r: (c.kind === "humanoid" ? 0.1 : quad ? 0.16 : 0.14) * c.eyes, spread: c.species === "frog" ? 0.5 : c.kind === "humanoid" ? 0.36 : 0.4 },
    coat: c.coat,
    hair: c.hair,
    antlers: c.antlers,
    frogEyes: c.species === "frog",
  };
}

return { get KINDS() { return KINDS; }, get SPECIES() { return SPECIES; }, get EARS() { return EARS; }, get CHOICES() { return CHOICES; }, get readsOf() { return readsOf; }, get choiceStream() { return choiceStream; }, get entityOf() { return entityOf; } };
});

__def("src/entity/skin.js", () => {

const { boneToWorld } = __mod("src/entity/rig.js");
const DEFAULT_MATERIALS = Object.freeze({ dark: 3, fur: 6, cloth: 7, accent: 8, blush: 9 });
const FALLBACK = { furAlt: "fur", clothAlt: "dark", hair: "dark", accent: "cloth", blush: "fur", cloth: "fur", fur: "dark" };
const MAX_CAPSULES = 28;

function materialFor(role, table = DEFAULT_MATERIALS) {
  let r = role;
  for (let i = 0; i < 8 && table[r] === undefined; i += 1) r = FALLBACK[r];
  return table[r] ?? 0;
}

function skinOf(spec, skel, materials = DEFAULT_MATERIALS, { max = MAX_CAPSULES } = {}) {
  const list = [];
  const cap = (part, role, a, b, r, drop = 0) => list.push({ a, b, r, part, role, drop });
  const ball = (part, role, p, r, drop = 0) => cap(part, role, p, p, r, drop);
  const W = (bone, local) => boneToWorld(skel, bone, local);
  const P = (bone) => skel.bones[bone].p;
  if (spec.plan === "quadruped") skinQuadruped(spec, skel, { cap, ball, W, P });
  else skinHumanoid(spec, skel, { cap, ball, W, P });
  let out = list;
  if (out.length > max) {
    const order = out.map((c, i) => [c.drop, i]).sort((x, y) => y[0] - x[0] || y[1] - x[1]);
    const gone = new Set(order.slice(0, out.length - max).map(([, i]) => i));
    out = out.filter((_, i) => !gone.has(i));
  }
  return out.map(({ a, b, r, part, role }) => ({ a, b, r, mat: materialFor(role, materials), part, role }));
}

function skinHumanoid(spec, skel, { cap, ball, W, P }) {
  const B = spec.body;
  const F = spec.features;
  const O = spec.outfit;
  const human = spec.kind === "humanoid";
  const hr = B.headR;
  const T = B.torso;
  const longTop = O.top === "jacket" || O.top === "hoodie";
  const sleeves = longTop || O.top === "tee";
  const bare = O.top === "none";

  cap("hips", longTop ? "cloth" : O.pants !== "none" ? "clothAlt" : bare ? "fur" : "cloth", P("hips"), P("spine"), B.torsoR * (human ? 0.9 : 0.93));
  if (human) cap("chest", bare ? "fur" : "cloth", W("chest", [-B.shoulderW * 0.42, T * 0.24, 0]), W("chest", [B.shoulderW * 0.42, T * 0.24, 0]), B.torsoR);
  else cap("chest", bare ? "fur" : "cloth", P("spine"), W("neck", [0, -B.torsoR * 0.35, 0]), B.torsoR);

  for (const s of ["L", "R"]) {
    cap(`thigh.${s}`, O.pants === "none" ? "fur" : "clothAlt", P(`thigh.${s}`), P(`shin.${s}`), B.legR);
    cap(`shin.${s}`, O.pants === "long" ? "clothAlt" : "fur", P(`shin.${s}`), P(`foot.${s}`), B.legR * 0.92);
    const sole = -(B.ankleH - B.footR);
    cap(`foot.${s}`, O.shoes === "bare" ? (F.coat === "socks" ? "furAlt" : "fur") : "dark", W(`foot.${s}`, [0, sole, -B.footLen * 0.18]), W(`foot.${s}`, [0, sole, B.footLen * 0.78]), B.footR);
  }
  for (const s of ["L", "R"]) {
    cap(`upperArm.${s}`, sleeves ? "cloth" : "fur", P(`upperArm.${s}`), P(`forearm.${s}`), B.armR);
    cap(`forearm.${s}`, longTop ? "cloth" : "fur", P(`forearm.${s}`), P(`hand.${s}`), B.armR * 0.95);
    ball(`hand.${s}`, F.coat === "socks" ? "furAlt" : "fur", W(`hand.${s}`, [0, -B.handLen * 0.45, 0]), B.armR * (human ? 1.15 : 1.3));
  }

  const C = (x, y, z) => W("head", [x * hr, hr * (1 + y), z * hr]);
  if (human) cap("neck", "fur", P("neck"), P("head"), B.armR * 1.25);
  ball("head", "fur", C(0, 0, 0.04), hr);
  const er = F.eyes.r * hr;
  if (F.frogEyes) {
    for (const [s, x] of [["L", -1], ["R", 1]]) {
      ball(`brow.${s}`, "fur", C(x * 0.5, 0.62, 0.42), hr * 0.34);
      ball(`eye.${s}`, "dark", C(x * 0.5, 0.72, 0.72), er);
    }
  } else {
    for (const [s, x] of [["L", -1], ["R", 1]]) ball(`eye.${s}`, "dark", C(x * F.eyes.spread, 0.02, 0.88), er);
  }
  const sn = F.snout;
  if (human) ball("nose", "fur", C(0, -0.12, 0.98), hr * 0.12);
  else if (sn > 0.3) {
    cap("snout", F.coat === "muzzle" ? "furAlt" : "fur", C(0, -0.3, 0.55), C(0, -0.32, 0.72 + sn), hr * 0.3);
    ball("nose", spec.species === "bear" || spec.species === "dog" ? "dark" : "blush", C(0, -0.2, 0.98 + sn), hr * 0.12);
  } else if (sn > 0) {
    if (F.coat === "muzzle") ball("snout", "furAlt", C(0, -0.3, 0.72), hr * 0.3);
    ball("nose", "blush", C(0, -0.18, 0.93 + sn * 0.6), hr * (0.07 + sn * 0.3));
  } else {
    ball("nose", "fur", C(0, -0.25, 0.97), hr * 0.08); // (a frog: a nub of a nose, still on the front)
  }
  ears(spec, skel, cap, ball, C, hr, skel.pose?.ears ?? 0);

  const hair = F.hair;
  if (hair !== "none") {
    ball("hair", "hair", C(0, 0.14, -0.1), hr * 0.99);
    if (hair === "long") cap("hair.back", "hair", C(0, 0.1, -0.4), C(0, -1.25, -0.55), hr * 0.66);
    if (hair === "bun") ball("hair.back", "hair", C(0, 0.95, -0.5), hr * 0.42);
    if (hair === "spiky") cap("hair.back", "hair", C(0, 0.4, -0.15), C(0, 1.05, -0.5), hr * 0.5);
    if (hair === "pony") cap("hair.back", "hair", C(0, 0.45, -0.9), C(0, -0.7, -1.3), hr * 0.3);
  }
  if (O.hood) cap("hood", "cloth", C(0, 0.06, -0.3), C(0, -0.4, -0.45), hr * 0.95, 4);
  const acc = O.accessory;
  if (acc === "scarf") cap("accessory", "accent", W("neck", [-B.torsoR * 0.55, 0, B.torsoR * 0.2]), W("neck", [B.torsoR * 0.55, 0, B.torsoR * 0.2]), B.armR * 1.15, 3);
  if (acc === "cap") cap("accessory", "accent", C(0, 0.72, -0.1), C(0, 0.55, 0.78), hr * 0.48, 3);
  if (acc === "goggles") cap("accessory", "dark", C(-0.55, 0.42, 0.78), C(0.55, 0.42, 0.78), hr * 0.18, 3);
  if (acc === "headband") cap("accessory", "accent", C(-0.62, 0.5, 0.62), C(0.62, 0.5, 0.62), hr * 0.12, 3);
  if (O.pack !== "none") {
    const pr = B.torsoR * (O.pack === "round" ? 0.95 : O.pack === "tall" ? 0.72 : 0.7);
    const back = -(B.torsoR + pr * 0.45);
    if (O.pack === "tall") cap("pack", "accent", W("chest", [0, -T * 0.08, back]), W("chest", [0, T * 0.3, back]), pr, 2);
    else ball("pack", "accent", W("chest", [0, T * 0.12, back]), pr, 2);
  }
  tail(spec, skel, cap, ball, P, W, B.legR, B.torsoR);
}

function ears(spec, skel, cap, ball, C, hr, back) {
  const E = spec.features.ears;
  if (E.shape === "none" || !(E.len > 0)) return;
  const sp = E.spread;
  const up = Math.sqrt(Math.max(0, 1 - sp * sp));
  for (const [s, x] of [["L", -1], ["R", 1]]) {
    const base = [x * sp * 0.95, up * 0.95, -0.05];
    let dir;
    if (E.shape === "lop") dir = [x * 0.75, -0.62, -0.15];
    else if (E.shape === "flop") dir = [x * 0.45, -0.88, 0.1];
    else if (E.shape === "side") dir = [x * 0.95, 0.3, -0.15];
    else dir = [x * 0.28, 1, -0.08 - back * 0.9];
    const l = Math.hypot(...dir);
    const tip = [base[0] + (dir[0] / l) * E.len, base[1] + (dir[1] / l) * E.len, base[2] + (dir[2] / l) * E.len];
    if (E.shape === "round" || E.shape === "big") { ball(`ear.${s}`, "fur", C(base[0] * 1.05, base[1] * 1.05, 0), E.w * hr); continue; }
    cap(`ear.${s}`, "fur", C(...base), C(...tip), E.w * hr);
    if (E.shape !== "flop" && E.shape !== "lop" && E.shape !== "side") {
      cap(`innerEar.${s}`, "blush", C(base[0], base[1], 0.02), C((base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2, (base[2] + tip[2]) / 2 + E.w * 0.6), E.w * hr * 0.5, 9);
    }
  }
}

function tail(spec, skel, cap, ball, P, W, legR, bodyR) {
  const T = spec.features.tail;
  if (T.shape === "none" || !(T.len > 0)) return;
  const quad = spec.plan === "quadruped";
  const tip = quad ? W("tail2", spec.rig.bones[spec.rig.index.tail2].tip) : W("tail1", spec.rig.bones[spec.rig.index.tail1].tip);
  const tipped = spec.features.coat === "tipped" ? "furAlt" : "fur";
  if (T.shape === "puff" || T.shape === "stub") { ball("tail", quad ? "furAlt" : "fur", P("tail0"), Math.max(T.len * (quad ? 0.3 : 0.9), legR)); return; }
  const r = T.shape === "bushy" ? bodyR * (quad ? 0.32 : 0.28) : T.shape === "thin" ? legR * 0.32 : legR * (quad ? 0.8 : 0.62);
  if (quad) {
    cap("tail", "fur", P("tail0"), P("tail1"), r * (T.shape === "bushy" ? 0.8 : 1));
    cap("tail.mid", "fur", P("tail1"), P("tail2"), r * (T.shape === "bushy" ? 1.25 : 1), 1);
    cap("tail.tip", tipped, P("tail2"), tip, r * (T.shape === "bushy" ? 1.15 : 0.9));
  } else {
    cap("tail", "fur", P("tail0"), P("tail1"), r * (T.shape === "bushy" ? 0.85 : 1));
    cap("tail.tip", tipped, P("tail1"), tip, r * (T.shape === "bushy" ? 1.3 : 0.9), 1);
  }
}

function skinQuadruped(spec, skel, { cap, ball, W, P }) {
  const B = spec.body;
  const F = spec.features;
  const hr = B.headR;
  cap("body", "fur", W("pelvis", [0, 0, -B.bodyR * 0.15]), P("chest"), B.bodyR);
  ball("chest", "fur", W("chest", [0, -B.bodyR * 0.08, B.bodyR * 0.1]), B.bodyR * 1.08, 5);
  cap("neck", "fur", P("neck"), P("head"), Math.min(B.bodyR * 0.55, hr * 0.75));
  const C = (x, y, z) => W("head", [x * hr, hr * (0.25 + y), hr * (0.5 + z)]);
  ball("head", "fur", C(0, 0, 0), hr);
  const sn = F.snout;
  cap("snout", F.coat === "muzzle" ? "furAlt" : "fur", C(0, -0.25, 0.4), C(0, -0.3, 0.55 + sn), hr * 0.42);
  ball("nose", spec.species === "cat" || spec.species === "rabbit" || spec.species === "mouse" ? "blush" : "dark", C(0, -0.14, 0.9 + sn), hr * 0.15);
  for (const [s, x] of [["L", -1], ["R", 1]]) ball(`eye.${s}`, "dark", C(x * F.eyes.spread * 1.1, 0.3, 0.84), F.eyes.r * hr);
  ears(spec, skel, cap, ball, (x, y, z) => C(x, y, z - 0.1), hr, skel.pose?.ears ?? 0);
  if (F.antlers) {
    for (const [s, x] of [["L", -1], ["R", 1]]) {
      cap(`antler.${s}`, "furAlt", C(x * 0.35, 0.85, -0.1), C(x * 1.1, 2.4, -0.45), hr * 0.1);
      cap(`antler.${s}`, "furAlt", C(x * 0.75, 1.6, -0.27), C(x * 0.55, 2.3, 0.35), hr * 0.08, 6);
    }
  }
  if (spec.outfit.accessory === "collar") cap("collar", "accent", W("neck", [-B.bodyR * 0.5, 0, B.bodyR * 0.1]), W("neck", [B.bodyR * 0.5, 0, B.bodyR * 0.1]), B.legR * 0.9, 3);
  for (const k of ["FL", "FR", "HL", "HR"]) {
    const hind = k[0] === "H";
    cap(`upper.${k}`, "fur", P(`upper.${k}`), P(`lower.${k}`), B.legR * (hind ? 1.45 : 1.15));
    cap(`lower.${k}`, "fur", P(`lower.${k}`), P(`paw.${k}`), B.legR);
    const sole = -(B.ankleH - B.pawR);
    cap(`paw.${k}`, F.coat === "socks" ? "furAlt" : "fur", W(`paw.${k}`, [0, sole, -B.pawR * 0.3]), W(`paw.${k}`, [0, sole, B.pawLen]), B.pawR);
  }
  tail(spec, skel, cap, ball, P, W, B.legR, B.bodyR);
}

const lowestY = (caps) => Math.min(...caps.map((c) => Math.min(c.a[1], c.b[1]) - c.r));
const partsOf = (caps, name) => caps.filter((c) => c.part === name || (name.endsWith(".") && c.part.startsWith(name)));


return { get DEFAULT_MATERIALS() { return DEFAULT_MATERIALS; }, get MAX_CAPSULES() { return MAX_CAPSULES; }, get materialFor() { return materialFor; }, get skinOf() { return skinOf; }, get lowestY() { return lowestY; }, get partsOf() { return partsOf; } };
});

__def("src/entity/clips.js", () => {

const { rightOf } = __mod("src/core/frame.js");
const { poseSkeleton } = __mod("src/entity/rig.js");
const { skinOf } = __mod("src/entity/skin.js");
const TAU = Math.PI * 2;
const frac = (v) => v - Math.floor(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (v) => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
const SIDES = [["L", -1], ["R", 1]];

function footCycle(q, duty, s, lift) {
  if (q < duty) { const u = q / duty; return { z: s / 2 - s * u, y: 0, stance: true, u }; }
  const u = (q - duty) / (1 - duty);
  return { z: -s / 2 + s * smooth(u), y: lift * Math.sin(Math.PI * u), stance: false, u };
}

const blank = () => ({ root: { yaw: 0, pitch: 0, roll: 0, off: [0, 0, 0] }, rot: {}, ik: {}, ears: 0, cycle: 0 });


function legsAt(spec) {
  const b = spec.body;
  return { b, reach: b.hipH - b.ankleH, w: b.hipW };
}

function bipedGait(spec, t, ph, params, cfg) {
  const { b, reach, w } = legsAt(spec);
  const p = blank();
  const s = cfg.s * reach * (b.stride ?? 1);
  const duty = cfg.duty;
  const zs = {};
  for (const [side, x] of SIDES) {
    const c = footCycle(frac(ph.phase + (x > 0 ? 0.5 : 0)), duty, s, cfg.lift * reach);
    zs[side] = c.z / (s / 2 || 1);
    p.ik[`leg.${side}`] = { at: [x * w * 1.05, b.ankleH + c.y, c.z], w: 1, pitch: c.stance ? 0 : 0.35 * Math.sin(Math.PI * c.u), yaw: x * 0.06 };
  }
  const mid = ph.phase - duty / 2;
  const sway = -cfg.sway * reach * Math.cos(TAU * mid);
  let lift = -cfg.crouch * reach + cfg.bob * reach * Math.cos(TAU * 2 * mid);
  const twist = cfg.twist * zs.L;
  for (const [side, x] of SIDES) {
    const g = p.ik[`leg.${side}`];
    if (g.at[1] > b.ankleH + 1e-12) continue;
    const hx = sway + x * w * Math.cos(twist);
    const hz = -x * w * Math.sin(twist);
    const flat2 = (g.at[0] - hx) ** 2 + (g.at[2] - hz) ** 2;
    const high = b.ankleH + Math.sqrt(Math.max(0, (reach * 0.985) ** 2 - flat2)) - b.hipH;
    if (lift > high) lift = high;
  }
  p.root.off = [sway, lift, 0];
  p.rot.hips = [0, twist, 0];
  p.rot.spine = [cfg.lean, 0, 0];
  p.rot.chest = [cfg.lean * 0.3, -cfg.twist * 1.4 * zs.L, 0];
  p.rot.neck = [-cfg.lean * 0.6, 0, 0];
  p.rot.head = [-cfg.lean * 0.5, cfg.twist * 0.5 * zs.L, 0];
  for (const [side, x] of SIDES) {
    const k = zs[side];
    const arm = cfg.armBack ?? 0;
    p.rot[`upperArm.${side}`] = [arm + cfg.armAmp * k, 0, x * cfg.armOut];
    p.rot[`forearm.${side}`] = [-cfg.elbow - 0.35 * cfg.armAmp * Math.max(0, -k), 0, 0];
  }
  p.rot.tail0 = [0.15 + cfg.lean * 0.4, 0.3 * Math.sin(TAU * ph.phase), 0];
  p.rot.tail1 = [0.1, 0.35 * Math.sin(TAU * ph.phase - 0.8), 0];
  p.ears = cfg.ears;
  p.cycle = s / duty;
  return p;
}

const WALK = { duty: 0.62, s: 0.85, lift: 0.16, bob: 0.03, sway: 0.035, crouch: 0.04, lean: 0.06, twist: 0.14, armAmp: 0.38, armOut: 0.1, elbow: 0.25, ears: 0.1 };
const runCfg = (spec, speed) => {
  const v = speed / (Math.max(0.05, spec.body.hipH - spec.body.ankleH) * 10);
  return { duty: clamp(0.4 - 0.065 * v, 0.15, 0.38), s: 1.12, lift: 0.42, bob: -0.05, sway: 0.012, crouch: 0.1, lean: 0.3 + clamp(v * 0.03, 0, 0.12), twist: 0.2, armAmp: 0.85, armOut: 0.14, elbow: 1.35, ears: 0.6 };
};

const SEAT_SINK = 0.85;
const seatOf = (spec) => spec.body.ankleH + spec.body.shin - spec.body.torsoR * SEAT_SINK;

const RUN_FROM = 4.5;
const mixCfg = (a, b, k) => Object.fromEntries(Object.keys(b).map((n) => [n, (a[n] ?? 0) + ((b[n] ?? 0) - (a[n] ?? 0)) * k]));

const HUMANOID_CLIPS = {
  idle(spec, t) {
    const { b, reach, w } = legsAt(spec);
    const p = blank();
    const br = Math.sin((TAU * t) / 3.4);
    p.root.off = [0, -reach * 0.035 + br * b.H * 0.004, 0];
    p.rot.spine = [0.03 + br * 0.012, 0, 0];
    p.rot.chest = [br * 0.02, 0, 0];
    p.rot.head = [-0.04 + 0.03 * Math.sin((TAU * t) / 5.1), 0.28 * Math.sin((TAU * t) / 7.3) * Math.sin((TAU * t) / 11.1), 0];
    for (const [side, x] of SIDES) {
      p.rot[`upperArm.${side}`] = [0.04, 0, x * (0.1 + br * 0.02)];
      p.rot[`forearm.${side}`] = [-0.25, 0, 0];
      p.ik[`leg.${side}`] = { at: [x * w * 1.15, b.ankleH, 0.01 * b.H], w: 1, yaw: x * 0.12 };
    }
    p.rot.tail0 = [0.1, 0.3 * Math.sin((TAU * t) / 2.3), 0];
    p.rot.tail1 = [0.2, 0.3 * Math.sin((TAU * t) / 2.3 - 0.9), 0];
    return p;
  },
  walk: (spec, t, ph) => bipedGait(spec, t, ph, {}, WALK),
  run: (spec, t, ph, params = {}) => bipedGait(spec, t, ph, params, runCfg(spec, params.speed ?? 8)),
  move(spec, t, ph, params = {}) {
    const reach = spec.body.hipH - spec.body.ankleH;
    const v = (params.speed ?? 0) / reach;
    const k = smooth((v - RUN_FROM * 0.55) / (RUN_FROM * 0.9));
    return bipedGait(spec, t, ph, params, k <= 0 ? WALK : mixCfg(WALK, runCfg(spec, params.speed ?? 0), k));
  },
  skim: (spec, t, ph) => bipedGait(spec, t, ph, {}, { duty: 0.3, s: 0.75, lift: 0.14, bob: -0.02, sway: 0.01, crouch: 0.24, lean: 0.55, twist: 0.1, armAmp: 0.15, armOut: 0.3, armBack: 0.95, elbow: 0.15, ears: 1 }),
  jump(spec) {
    const { b, reach, w } = legsAt(spec);
    const p = blank();
    p.ik["leg.L"] = { at: [-w, b.hipH - reach * 0.45, reach * 0.35], w: 1, pitch: 0.3 };
    p.ik["leg.R"] = { at: [w, b.ankleH + reach * 0.22, -reach * 0.3], w: 1, pitch: 0.5 };
    p.rot.spine = [0.15, 0, 0];
    p.rot.head = [-0.15, 0, 0];
    for (const [side, x] of SIDES) { p.rot[`upperArm.${side}`] = [-1.7, 0, x * 0.45]; p.rot[`forearm.${side}`] = [-0.6, 0, 0]; }
    p.rot.tail0 = [0.5, 0, 0];
    p.ears = 0.8;
    return p;
  },
  fall(spec, t) {
    const { b, reach, w } = legsAt(spec);
    const p = blank();
    p.ik["leg.L"] = { at: [-w * 1.4, b.ankleH + reach * 0.2, reach * 0.18], w: 1, pitch: 0.3 };
    p.ik["leg.R"] = { at: [w * 1.4, b.ankleH + reach * 0.14, -reach * 0.08], w: 1, pitch: 0.35 };
    p.rot.spine = [-0.04, 0, 0];
    const flap = 0.12 * Math.sin(TAU * t * 2.2);
    for (const [side, x] of SIDES) { p.rot[`upperArm.${side}`] = [-0.3, 0, x * (2 + flap)]; p.rot[`forearm.${side}`] = [-0.45, 0, 0]; }
    p.rot.tail0 = [-0.3, 0, 0];
    p.ears = 1;
    return p;
  },
  land(spec, t, ph) {
    const { b, reach, w } = legsAt(spec);
    const p = blank();
    const sq = 1 - smooth((ph.landT ?? 0) / LAND_TIME);
    p.root.off = [0, -reach * (0.04 + 0.3 * sq), 0];
    p.rot.spine = [0.08 + 0.35 * sq, 0, 0];
    p.rot.head = [-0.25 * sq, 0, 0];
    for (const [side, x] of SIDES) {
      p.ik[`leg.${side}`] = { at: [x * w * 1.35, b.ankleH, x * 0.03 * reach], w: 1, yaw: x * 0.15 };
      p.rot[`upperArm.${side}`] = [-0.7 * sq, 0, x * (0.25 + 0.3 * sq)];
      p.rot[`forearm.${side}`] = [-0.5, 0, 0];
    }
    p.ears = 0.4 * sq;
    return p;
  },
  wallRun(spec, t, ph, params = {}) {
    const p = bipedGait(spec, t, ph, params, runCfg(spec, params.speed ?? 8));
    const side = params.wall ?? 0;
    p.root.roll = -0.5 * side;
    if (params.wallGap > 0 && side !== 0) p.root.shift = [-side * Math.max(0, params.wallGap - spec.body.footR), 0, 0];
    const near = side > 0 ? "L" : "R";
    if (side !== 0) { p.rot[`upperArm.${near}`] = [0.35, 0, -side * 1.25]; p.rot[`forearm.${near}`] = [-0.3, 0, 0]; }
    return p;
  },
  grind(spec, t) {
    const { b, reach, w } = legsAt(spec);
    const p = blank();
    const bal = Math.sin(TAU * t * 0.9);
    p.root.off = [0.06 * reach * bal, -reach * 0.28, 0];
    p.rot.hips = [0, 0.3, 0.06 * bal];
    p.rot.spine = [0.25, 0, -0.1 * bal];
    p.rot.chest = [0.05, -0.2, 0];
    p.rot.head = [-0.2, -0.1, 0];
    p.ik["leg.L"] = { at: [-w * 0.55, b.ankleH, -reach * 0.3], w: 1, yaw: -0.5 };
    p.ik["leg.R"] = { at: [w * 0.55, b.ankleH, reach * 0.3], w: 1, yaw: 0.25 };
    for (const [side, x] of SIDES) { p.rot[`upperArm.${side}`] = [-0.1, 0, x * (1.35 + 0.1 * bal * x)]; p.rot[`forearm.${side}`] = [-0.2, 0, 0]; }
    p.rot.tail0 = [0, 0.4 * bal, 0];
    p.ears = 0.3;
    return p;
  },
  sit(spec, t, ph, params = {}) {
    const { b, reach, w } = legsAt(spec);
    const p = blank();
    const br = Math.sin((TAU * t) / 3.8);
    if (params.seat === 0) {
      const hy = b.torsoR * 0.95;
      const z = Math.sqrt(Math.max(0, (reach * 0.97) ** 2 - (hy - b.ankleH) ** 2));
      p.root.off = [0, hy - b.hipH, 0];
      for (const [side, x] of SIDES) {
        p.ik[`leg.${side}`] = { at: [x * w * 1.3, b.ankleH, z], w: 1, yaw: x * 0.2, pole: [0, 1, 0.2] };
        p.ik[`arm.${side}`] = { at: [x * (b.shoulderW + b.armR * 2), b.armR * 1.2, -b.torsoR * 1.3], w: 1 };
      }
    } else {
      const hy = (params.seat ?? seatOf(spec)) + b.torsoR * SEAT_SINK;
      const drop = Math.sqrt(Math.max(0, (reach * 0.995) ** 2 - b.thigh ** 2));
      p.root.off = [0, hy - b.hipH, 0];
      for (const [side, x] of SIDES) {
        p.ik[`leg.${side}`] = { at: [x * w * 1.15, Math.max(b.ankleH, hy - drop), b.thigh], w: 1, yaw: x * 0.08, pole: [0, 0.35, 1] };
        p.ik[`arm.${side}`] = { at: [x * w * 1.25, hy + b.legR * 1.6, b.thigh * 0.75], w: 1 };
      }
    }
    p.rot.spine = [-0.04 + br * 0.01, 0, 0];
    p.rot.head = [0.05, 0.2 * Math.sin((TAU * t) / 9), 0];
    p.rot.tail0 = [-0.45, 0.5, 0];
    p.rot.tail1 = [-0.2, 0.6, 0];
    return p;
  },
  turn(spec, t, ph, params = {}) {
    const { b, reach, w } = legsAt(spec);
    const p = HUMANOID_CLIPS.idle(spec, t);
    const q = frac(t * 1.8);
    for (const [side, x] of SIDES) {
      const u = x < 0 ? q * 2 : q * 2 - 1;
      const lift = u > 0 && u < 1 ? Math.sin(Math.PI * u) * reach * 0.12 : 0;
      p.ik[`leg.${side}`] = { at: [x * w * 1.15, b.ankleH + lift, 0.01 * b.H], w: 1, yaw: x * 0.12 - Math.sign(params.turn ?? 0) * 0.2 * (lift > 0 ? 1 : 0) };
    }
    p.rot.chest = [0, Math.sign(params.turn ?? 0) * 0.15, 0];
    p.rot.head = [0, Math.sign(params.turn ?? 0) * 0.3, 0];
    return p;
  },
};
HUMANOID_CLIPS.wallrun = HUMANOID_CLIPS.wallRun;


const GAITS = {
  walk: { at: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, duty: 0.66, s: 0.7, lift: 0.2, bob: 0.02, flex: 0.02, nod: 0.05 },
  trot: { at: { HL: 0, FR: 1, HR: 0.5, FL: 0.5 }, duty: 0.48, s: 0.9, lift: 0.3, bob: 0.03, flex: 0.03, nod: 0.04 },
  gallop: { at: { HL: 0, HR: 0.1, FL: 0.42, FR: 0.52 }, duty: 0.3, s: 1.05, lift: 0.38, bob: 0.06, flex: 0.18, nod: 0.08 },
  bound: { at: { HL: 0, HR: 0.03, FL: 0.5, FR: 0.53 }, duty: 0.32, s: 1.1, lift: 0.45, bob: 0.08, flex: 0.25, nod: 0.06 },
};
const HOPPERS = new Set(["rabbit", "mouse"]);
const QUAD_GAIT_AT = { trot: 3.2, gallop: 7 };
const mixGait = (a, b, k) => ({
  at: Object.fromEntries(Object.keys(a.at).map((f) => [f, a.at[f] + (b.at[f] - a.at[f]) * k])),
  ...Object.fromEntries(["duty", "s", "lift", "bob", "flex", "nod"].map((n) => [n, a[n] + (b[n] - a[n]) * k])),
});
function gaitAt(spec, speed) {
  const v = speed / (spec.body.shoulderH - spec.body.ankleH);
  const hop = HOPPERS.has(spec.species);
  const trot = hop ? GAITS.bound : GAITS.trot;
  const fast = hop ? GAITS.bound : GAITS.gallop;
  const k1 = smooth((v - QUAD_GAIT_AT.trot * 0.75) / (QUAD_GAIT_AT.trot * 0.5));
  const k2 = smooth((v - QUAD_GAIT_AT.gallop * 0.8) / (QUAD_GAIT_AT.gallop * 0.4));
  return k2 > 0 ? mixGait(trot, fast, k2) : mixGait(GAITS.walk, trot, k1);
}

function quadAt(spec) {
  const b = spec.body;
  return { b, zF: b.bodyLen / 2, zH: -b.bodyLen / 2, rF: b.shoulderH - b.ankleH, rH: b.hipH - b.ankleH };
}

function quadGait(spec, t, ph, g) {
  const { b, zF, zH, rF, rH } = quadAt(spec);
  const p = blank();
  const reach = (rF + rH) / 2;
  const s = g.s * reach * (b.stride ?? 1);
  for (const k of ["FL", "FR", "HL", "HR"]) {
    const x = k[1] === "L" ? -1 : 1;
    const c = footCycle(frac(ph.phase - g.at[k]), g.duty, s, g.lift * (k[0] === "F" ? rF : rH));
    p.ik[`leg.${k}`] = { at: [x * b.w, b.ankleH + c.y, (k[0] === "F" ? zF : zH) + c.z], w: 1, pitch: c.stance ? 0 : -0.4 * Math.sin(Math.PI * c.u) };
  }
  const flex = g.flex * Math.sin(TAU * ph.phase);
  p.root.off = [0, -reach * 0.04 + g.bob * reach * Math.cos(TAU * 2 * ph.phase), 0];
  p.rot.pelvis = [flex * 0.5, 0, 0];
  p.rot.spine = [-flex, 0, 0];
  p.rot.chest = [flex * 0.5, 0, 0];
  p.rot.neck = [g.nod * Math.sin(TAU * 2 * ph.phase + 0.6), 0, 0];
  p.rot.tail0 = [-(b.tailRise ?? 0.4) * g.flex * 2.5 + 0.1, 0.3 * Math.sin(TAU * ph.phase), 0];
  p.rot.tail1 = [0.1, 0.35 * Math.sin(TAU * ph.phase - 0.7), 0];
  p.rot.tail2 = [0.05, 0.35 * Math.sin(TAU * ph.phase - 1.4), 0];
  p.ears = g.flex;
  p.cycle = s / g.duty;
  return p;
}

function pitchFor(spec, pelvisY, want) {
  const b = spec.body;
  const rise = b.shoulderH - b.hipH;
  const h = (a) => pelvisY + rise * Math.cos(a) + b.bodyLen * Math.sin(-a);
  let lo = -1.35;
  let hi = 0;
  for (let i = 0; i < 24; i += 1) { const m = (lo + hi) / 2; if (h(m) > want) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

const QUADRUPED_CLIPS = {
  idle(spec, t) {
    const { b, zF, zH, rF } = quadAt(spec);
    const p = blank();
    const br = Math.sin((TAU * t) / 3);
    p.root.off = [0, -rF * 0.03 + br * b.bodyR * 0.02, 0];
    p.rot.spine = [br * 0.01, 0, 0];
    p.rot.neck = [-0.05, 0.3 * Math.sin((TAU * t) / 6.7) * Math.sin((TAU * t) / 9.9), 0];
    p.rot.head = [0.05 * Math.sin((TAU * t) / 4.3), 0, 0];
    for (const k of ["FL", "FR", "HL", "HR"]) p.ik[`leg.${k}`] = { at: [(k[1] === "L" ? -1 : 1) * b.w, b.ankleH, k[0] === "F" ? zF : zH], w: 1 };
    p.rot.tail0 = [0.15, 0.4 * Math.sin((TAU * t) / 2.6), 0];
    p.rot.tail1 = [0.1, 0.4 * Math.sin((TAU * t) / 2.6 - 0.8), 0];
    p.rot.tail2 = [0.05, 0.4 * Math.sin((TAU * t) / 2.6 - 1.6), 0];
    return p;
  },
  move: (spec, t, ph, params = {}) => quadGait(spec, t, ph, gaitAt(spec, params.speed ?? 0)),
  walk: (spec, t, ph) => quadGait(spec, t, ph, GAITS.walk),
  trot: (spec, t, ph) => quadGait(spec, t, ph, HOPPERS.has(spec.species) ? GAITS.bound : GAITS.trot),
  gallop: (spec, t, ph) => quadGait(spec, t, ph, HOPPERS.has(spec.species) ? GAITS.bound : GAITS.gallop),
  bound: (spec, t, ph) => quadGait(spec, t, ph, GAITS.bound),
  sit(spec, t) {
    const { b, zF, zH, rF } = quadAt(spec);
    const p = blank();
    const py = b.bodyR * 1.12;
    const a = pitchFor(spec, py, b.ankleH + rF * 0.96);
    p.root.off = [0, py - b.hipH, 0];
    p.rot.pelvis = [a, 0, 0];
    p.rot.neck = [-a * 0.75, 0.25 * Math.sin((TAU * t) / 7), 0];
    p.rot.head = [-a * 0.2, 0, 0];
    const rise = b.shoulderH - b.hipH;
    const zc = zH + rise * Math.sin(a) + b.bodyLen * Math.cos(a);
    for (const [side, x] of SIDES) {
      p.ik[`leg.F${side}`] = { at: [x * b.w, b.ankleH, zc + b.pawLen * 0.2], w: 1 };
      p.ik[`leg.H${side}`] = { at: [x * b.w * 1.35, b.ankleH, zH + b.upperH * 0.9], w: 1, pole: [x * 0.3, 0.7, 1] };
    }
    p.rot.tail0 = [-(b.tailRise ?? 0.4) - a - 0.15, 0.5, 0];
    p.rot.tail1 = [0.05, 0.7, 0];
    p.rot.tail2 = [0, 0.7, 0];
    return p;
  },
  lie(spec, t) {
    const { b, zF, zH } = quadAt(spec);
    const p = blank();
    const br = Math.sin((TAU * t) / 3.6);
    const a = pitchFor(spec, b.bodyR * 1.1, b.bodyR * 1.25 + Math.max(0, b.shoulderH - b.hipH) * 0.3);
    p.root.off = [0, b.bodyR * 1.1 - b.hipH, 0];
    p.rot.pelvis = [a, 0, 0];
    p.rot.spine = [br * 0.015, 0, 0];
    p.rot.neck = [-0.25, 0.3 * Math.sin((TAU * t) / 8), 0];
    for (const [side, x] of SIDES) {
      p.ik[`leg.F${side}`] = { at: [x * b.w * 1.1, b.ankleH, zF + b.upperF * 1.25], w: 1 };
      p.ik[`leg.H${side}`] = { at: [x * b.w * 1.9, b.ankleH, zH + b.upperH * 0.9], w: 1, yaw: x * 0.5, pole: [x * 0.8, 0.6, 0.5] };
    }
    p.rot.tail0 = [-(b.tailRise ?? 0.4) - a - 0.1, 0.5, 0];
    p.rot.tail1 = [0, 0.5, 0];
    p.rot.tail2 = [0, 0.4, 0];
    return p;
  },
  leap(spec) {
    const { b, zF, zH, rF, rH } = quadAt(spec);
    const p = blank();
    for (const [side, x] of SIDES) {
      p.ik[`leg.F${side}`] = { at: [x * b.w, b.ankleH + rF * 0.55, zF + rF * 0.6], w: 1, pitch: -0.3 };
      p.ik[`leg.H${side}`] = { at: [x * b.w, b.ankleH + rH * 0.45, zH - rH * 0.65], w: 1, pitch: 0.6 };
    }
    p.rot.spine = [-0.08, 0, 0];
    p.rot.neck = [0.1, 0, 0];
    p.rot.tail0 = [0.1, 0, 0];
    p.ears = 0.8;
    return p;
  },
};

const clipsFor = (spec) => (spec.plan === "quadruped" ? QUADRUPED_CLIPS : HUMANOID_CLIPS);
const LOCOMOTION = new Set(["walk", "run", "move", "skim", "wallRun", "trot", "gallop", "bound"]);
const LAND_TIME = 0.22;
const FADES = { land: 0.85, jump: 0.9, fall: 1.5, sit: 2.5, lie: 3, turn: 1.5, idle: 1.5, gallop: 1.3, trot: 1.3 };


function blendPoses(list) {
  let total = 0;
  for (const [, w] of list) total += w;
  if (!(total > 0)) return list.length ? list[0][0] : blank();
  if (list.length === 1) return list[0][0];
  const out = blank();
  const names = new Set();
  const chains = new Set();
  for (const [p] of list) { for (const n of Object.keys(p.rot)) names.add(n); for (const n of Object.keys(p.ik)) chains.add(n); }
  for (const n of names) out.rot[n] = [0, 0, 0];
  for (const [p, w0] of list) {
    const w = w0 / total;
    out.root.yaw += w * (p.root.yaw ?? 0); out.root.pitch += w * (p.root.pitch ?? 0); out.root.roll += w * (p.root.roll ?? 0);
    for (let i = 0; i < 3; i += 1) out.root.off[i] += w * (p.root.off?.[i] ?? 0);
    if (p.root.shift) { out.root.shift ??= [0, 0, 0]; for (let i = 0; i < 3; i += 1) out.root.shift[i] += w * p.root.shift[i]; }
    for (const n of names) { const r = p.rot[n]; if (r) for (let i = 0; i < 3; i += 1) out.rot[n][i] += w * r[i]; }
    out.ears += w * (p.ears ?? 0);
    out.cycle += w * (p.cycle ?? 0);
  }
  for (const n of chains) {
    let sw = 0;
    const g = { at: [0, 0, 0], w: 0, pitch: 0, yaw: 0 };
    let pole = null;
    for (const [p, w0] of list) {
      const e = p.ik[n];
      if (!e) continue;
      const w = w0 / total;
      sw += w;
      for (let i = 0; i < 3; i += 1) g.at[i] += w * e.at[i];
      g.w += w * (e.w ?? 1); g.pitch += w * (e.pitch ?? 0); g.yaw += w * (e.yaw ?? 0);
      if (e.pole) pole = pole ? pole.map((v, i) => v + w * e.pole[i]) : e.pole.map((v) => v * w);
    }
    g.at = g.at.map((v) => v / sw); g.pitch /= sw; g.yaw /= sw;
    if (pole) g.pole = pole.map((v) => v / sw);
    g.flat = g.w > 0.999;
    out.ik[n] = g;
  }
  return out;
}


function animator(spec, { fade = 0.14 } = {}) {
  const quad = spec.plan === "quadruped";
  const clips = clipsFor(spec);
  const b = spec.body;
  const reach = quad ? b.shoulderH - b.ankleH : b.hipH - b.ankleH;
  const st = { layers: [], phase: 0, time: 0, dist: 0, landT: 99, mode: null, facing: null, turn: 0, last: null, clip: null, held: null, params: {} };
  let pose = blank();
  let body0 = { pos: [0, 0, 0], vel: [0, 0, 0], facing: 0, mode: "ground" };

  function pick(body, speed) {
    if (st.held) return st.held.clip;
    const m = body.mode ?? "ground";
    if (quad) {
      if (m === "air" || m === "sink") return "leap";
      if (m === "wall" || m === "skim") return "gallop";
      if (speed < reach * 0.25) return "idle";
      if (speed < reach * QUAD_GAIT_AT.trot) return "walk";
      if (speed < reach * QUAD_GAIT_AT.gallop) return "trot";
      return "gallop";
    }
    if (m === "air") return (body.vel?.[1] ?? 0) > 0.5 ? "jump" : "fall";
    if (m === "sink") return "fall";
    if (m === "wall") return "wallRun";
    if (m === "grind") return "grind";
    if (m === "skim") return "skim";
    const runFrom = reach * RUN_FROM;
    if (st.landT < LAND_TIME && speed < runFrom) return "land";
    if (speed < reach * 0.3) return Math.abs(st.turn) > 1.5 ? "turn" : "idle";
    return speed < runFrom ? "walk" : "run";
  }

  const api = {
    get pose() { return pose; },
    get state() { return { clip: st.clip, phase: st.phase, time: st.time, dist: st.dist, layers: st.layers.map((l) => ({ ...l })) }; },
    hold(clip, params = {}) { if (!clips[clip]) throw new RangeError(`No ${spec.plan} clip "${clip}" (${Object.keys(clips).join(", ")}).`); st.held = { clip, params }; return api; },
    release() { st.held = null; return api; },
    step(dt, body, { dist } = {}) {
      body0 = body;
      st.time += dt;
      let dd;
      if (dist !== undefined) { dd = st.last === null ? 0 : Math.max(0, dist - st.last); st.last = dist; }
      else {
        const prev = st.prevPos ?? body.pos;
        const dy = body.mode === "wall" ? body.pos[1] - prev[1] : 0;
        dd = Math.hypot(body.pos[0] - prev[0], dy, body.pos[2] - prev[2]);
        st.prevPos = [...body.pos];
      }
      if (dd > reach * 20) dd = 0;
      st.dist += dd;
      const speed = Math.hypot(body.vel?.[0] ?? 0, body.vel?.[2] ?? 0);
      if (st.facing !== null && dt > 0) {
        const d = Math.atan2(Math.sin(body.facing - st.facing), Math.cos(body.facing - st.facing));
        st.turn += (d / dt - st.turn) * Math.min(1, dt * 10);
      }
      st.facing = body.facing ?? 0;
      if (st.mode !== null && st.mode !== "ground" && body.mode === "ground") st.landT = 0;
      else st.landT += dt;
      st.mode = body.mode;
      const wall = body.mode === "wall" && body.wall ? Math.sign(body.wall[0] * rightOf(st.facing)[0] + body.wall[2] * rightOf(st.facing)[2]) : 0;
      st.gait = st.gait === undefined ? speed : st.gait + (speed - st.gait) * Math.min(1, dt * (quad ? 3.5 : 10));
      st.params = { speed: st.gait, vy: body.vel?.[1] ?? 0, wall, wallGap: body.wallGap, turn: st.turn, ...(st.held?.params ?? {}) };

      const clip = pick(body, speed);
      const layer = clip === "walk" || clip === "run" || (quad && (clip === "trot" || clip === "gallop")) ? "move" : clip;
      st.clip = clip;
      if (!st.layers.some((l) => l.name === layer)) st.layers.push({ name: layer, w: st.layers.length ? 0 : 1 });
      const span = fade * (FADES[layer] ?? 1);
      const rate = span > 0 ? dt / span : 1;
      const top = st.layers.find((l) => l.name === layer);
      top.w = Math.min(1, top.w + rate);
      const rest = st.layers.reduce((a, l) => a + (l === top ? 0 : l.w), 0);
      for (const l of st.layers) if (l !== top) l.w = rest > 0 ? (l.w / rest) * (1 - top.w) : 0;
      st.layers = st.layers.filter((l) => l.w > 1e-6 || l === top);
      if (st.layers.length === 1) top.w = 1;
      if (pose.cycle > 1e-6) st.phase = frac(st.phase + dd / pose.cycle);
      const ph = { phase: st.phase, landT: st.landT };
      pose = blendPoses(st.layers.map((l) => [clips[l.name](spec, st.time, ph, st.params), l.w]));
      if (!(pose.cycle > 0)) {
        pose.cycle = clips.move(spec, st.time, ph, { speed: 0 }).cycle;
      }
      return api;
    },
    skeleton(place) { return poseSkeleton(spec.rig, pose, place ?? { pos: body0.pos, yaw: body0.facing ?? 0 }); },
    capsules(materials, opts) { return skinOf(spec, api.skeleton(), materials, opts); },
  };
  return api;
}

function posed(spec, clip, { t = 0, phase = 0, params = {}, pos = [0, 0, 0], yaw = 0, landT = 0 } = {}) {
  const clips = clipsFor(spec);
  if (!clips[clip]) throw new RangeError(`No ${spec.plan} clip "${clip}" (${Object.keys(clips).join(", ")}).`);
  const pose = clips[clip](spec, t, { phase, landT }, params);
  return poseSkeleton(spec.rig, pose, { pos, yaw });
}

return { get footCycle() { return footCycle; }, get seatOf() { return seatOf; }, get RUN_FROM() { return RUN_FROM; }, get HUMANOID_CLIPS() { return HUMANOID_CLIPS; }, get GAITS() { return GAITS; }, get QUAD_GAIT_AT() { return QUAD_GAIT_AT; }, get gaitAt() { return gaitAt; }, get QUADRUPED_CLIPS() { return QUADRUPED_CLIPS; }, get clipsFor() { return clipsFor; }, get LOCOMOTION() { return LOCOMOTION; }, get LAND_TIME() { return LAND_TIME; }, get blendPoses() { return blendPoses; }, get animator() { return animator; }, get posed() { return posed; } };
});

__def("src/entity/front.js", () => {

const { frontOf, yawOf } = __mod("src/core/frame.js");
const { declaredFront } = __mod("src/entity/rig.js");
const TORSO = new Set(["hips", "chest"]);
const FACE = (p) => p === "nose" || p === "snout" || p.startsWith("eye.");
const UP = [0, 1, 0];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const flat = (v) => { const l = Math.hypot(v[0], v[2]); return l > 1e-12 ? [v[0] / l, 0, v[2] / l] : null; };
const mid = (c) => [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2, (c.a[2] + c.b[2]) / 2];

function featurePoints(caps) {
  const out = {};
  const torso = caps.some((c) => c.part === "body") ? new Set(["body"]) : TORSO;
  const sums = {};
  const push = (k, p, w = 1) => { const s = (sums[k] ??= [0, 0, 0, 0]); s[0] += p[0] * w; s[1] += p[1] * w; s[2] += p[2] * w; s[3] += w; };
  for (const c of caps) {
    push(c.part, mid(c));
    const m = /^(foot|paw)\.(.+)$/.exec(c.part);
    if (m) { push(`toe.${m[2]}`, c.b); push(`heel.${m[2]}`, c.a); }
    if (FACE(c.part)) push("face", mid(c), c.r);
    if (torso.has(c.part)) push("centre", mid(c), c.r ** 3);
  }
  for (const [k, s] of Object.entries(sums)) out[k] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
  return out;
}

function frontOfEntity(thing, { yaw: meant } = {}) {
  let res;
  if (Array.isArray(thing)) res = seenFront(thing);
  else if (thing?.bones && thing?.root) { const dir = declaredFront(thing); res = { yaw: yawOf(dir), dir, confidence: 1, why: "declared: the skeleton's heading (own +z)", cues: [] }; }
  else if (thing?.front) res = { yaw: 0, dir: [...thing.front.dir], confidence: 1, why: "declared: own +z is the front, +x the right hand (core/frame.js)", cues: [] };
  else throw new TypeError("frontOfEntity wants a spec, a posed skeleton or a list of capsules.");
  if (meant !== undefined) {
    const f = frontOf(meant);
    const d = res.dir[0] * f[0] + res.dir[2] * f[2];
    res.error = Math.acos(Math.max(-1, Math.min(1, d)));
    res.agrees = d > Math.cos(Math.PI / 4);
  }
  return res;
}

function seenFront(caps) {
  const F = featurePoints(caps);
  const cues = [];
  const cue = (name, v, weight) => { const d = v && flat(v); if (d) cues.push({ name, dir: d, weight }); };
  const centre = F.centre ?? F.head;
  if (F.face && centre) cue("face ahead of the body", sub(F.face, centre), 3);
  if (F.face && F.head) cue("face on the front of the head", sub(F.face, F.head), 2);
  if (F["eye.L"] && F["eye.R"]) cue("eyes left-to-right", cross(sub(F["eye.R"], F["eye.L"]), UP), 2);
  let toes = null;
  for (const k of Object.keys(F)) {
    if (!k.startsWith("toe.")) continue;
    const v = sub(F[k], F[`heel.${k.slice(4)}`]);
    toes = toes ? [toes[0] + v[0], toes[1] + v[1], toes[2] + v[2]] : v;
  }
  cue("toes ahead of heels", toes, 1.5);
  if (F["hand.L"] && F["hand.R"]) cue("right hand on the right", cross(sub(F["hand.R"], F["hand.L"]), UP), 1);
  if (!cues.length) return { yaw: 0, dir: [0, 0, 1], confidence: 0, why: "no face, eyes, toes or hands to read", cues };
  let x = 0;
  let z = 0;
  let wsum = 0;
  for (const c of cues) { x += c.dir[0] * c.weight; z += c.dir[2] * c.weight; wsum += c.weight; }
  const l = Math.hypot(x, z);
  const dir = l > 1e-12 ? [x / l, 0, z / l] : [0, 0, 1];
  const against = cues.filter((c) => c.dir[0] * dir[0] + c.dir[2] * dir[2] < 0).map((c) => c.name);
  const why = `seen: ${cues.map((c) => c.name).join(", ")}${against.length ? `; DISAGREEING: ${against.join(", ")}` : "; all agree"}`;
  return { yaw: yawOf(dir), dir, confidence: l / wsum, why, cues };
}

return { get featurePoints() { return featurePoints; }, get frontOfEntity() { return frontOfEntity; } };
});

__def("src/entity/index.js", () => {





return Object.defineProperties({  }, Object.assign({}, Object.getOwnPropertyDescriptors(__mod("src/entity/rig.js")), Object.getOwnPropertyDescriptors(__mod("src/entity/species.js")), Object.getOwnPropertyDescriptors(__mod("src/entity/skin.js")), Object.getOwnPropertyDescriptors(__mod("src/entity/clips.js")), Object.getOwnPropertyDescriptors(__mod("src/entity/front.js"))));
});

__def("src/camera/camera.js", () => {

const { cameraBasis, frontOf, moveFromView, rightOf, wrapAngle, yawOf } = __mod("src/core/frame.js");
const { boxDistance } = __mod("src/physics/character.js");
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const smoothstep = (k) => k * k * (3 - 2 * k);
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
const dirOf = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
const along = (a, b, t) => { const d = sub(b, a); const l = len(d); return l < 1e-9 ? [...a] : add(a, scale(d, t / l)); };

const fovForTarget = (w, h, base = 1.15) => base * clamp((Math.min(w, h) / 128) ** 0.3, 0.6, 1);
const fillForTarget = (w, h) => 0.72 + 0.14 * clamp((128 - Math.min(w, h)) / 96, 0, 1);


function clearance(world, p) {
  let d = Infinity;
  for (const b of world?.boxes ?? []) { const q = boxDistance(p, b).d; if (q < d) d = q; }
  if (world?.floorY !== undefined) d = Math.min(d, p[1] - world.floorY);
  if (world?.distance) d = Math.min(d, world.distance(p));
  return d;
}

function sphereCast(world, from, to, radius = 0.2) {
  const d = sub(to, from);
  const L = len(d);
  if (L < 1e-9) return 0;
  let t = 0;
  for (let i = 0; i < 160; i += 1) {
    const c = clearance(world, add(from, scale(d, t / L))) - radius;
    if (c < 1e-3) return t;
    t += c;
    if (t >= L) return L;
  }
  return t; // (grazing along a face: as far as it has proven clear)
}

function armTo(rig, hit, dt, rate) {
  if (rig.arm === null || hit <= rig.arm) { rig.arm = hit; rig.armVel = 0; return hit; }
  rig.armVel += (rate * rate * (hit - rig.arm) - 2 * rate * rig.armVel) * dt;
  rig.arm = Math.min(hit, rig.arm + Math.max(0, rig.armVel) * dt);
  return rig.arm;
}

const SKIN = 0.08;

function normalAt(world, p) {
  let best = Infinity;
  let n = [0, 1, 0];
  for (const b of world?.boxes ?? []) { const q = boxDistance(p, b); if (q.d < best) { best = q.d; n = q.n; } }
  if (world?.floorY !== undefined && p[1] - world.floorY < best) { best = p[1] - world.floorY; n = [0, 1, 0]; }
  if (world?.distance && world.distance(p) < best) {
    const e = 1e-3;
    const g = [0, 1, 2].map((i) => { const a = [...p]; const b = [...p]; a[i] += e; b[i] -= e; return world.distance(a) - world.distance(b); });
    const l = len(g) || 1;
    n = scale(g, 1 / l);
  }
  return n;
}

function armPath(world, from, to, radius = 0.2) {
  const L = len(sub(to, from));
  const t = sphereCast(world, from, to, radius);
  const hit = along(from, to, t);
  if (t >= L - 1e-9) return { points: [from, hit], reach: t };
  const n = normalAt(world, hit);
  const rest = sub(to, hit);
  const into = dot(rest, n);
  if (Math.abs(n[1]) < 0.7 || into >= 0) return { points: [from, hit], reach: t };
  const off = add(hit, scale(n, SKIN));
  if (clearance(world, off) < radius) return { points: [from, hit], reach: t };
  const slideTo = add(off, sub(rest, scale(n, into)));
  const t2 = sphereCast(world, off, slideTo, radius);
  return { points: [from, hit, off, along(off, slideTo, t2)], reach: t + SKIN + t2 };
}
function alongPath(points, s) {
  let left = s;
  for (let i = 0; i < points.length - 1; i += 1) {
    const l = len(sub(points[i + 1], points[i]));
    if (left <= l || i === points.length - 2) return along(points[i], points[i + 1], Math.min(left, l));
    left -= l;
  }
  return [...points[0]];
}

const coreOf = (s) => [s.pos[0], s.pos[1] + (s.height ?? 1.1) * 0.5, s.pos[2]];
function safePoint(world, s, p, radius) {
  const core = coreOf(s);
  const t = sphereCast(world, core, p, radius);
  return along(core, p, t >= len(sub(p, core)) - 1e-9 ? t : Math.max(0, t - SKIN));
}
const headingOf = (s) => (s.yaw !== undefined ? s.yaw : Math.hypot(s.vel?.[0] ?? 0, s.vel?.[2] ?? 0) > 1e-6 ? yawOf(s.vel) : 0);


function orbitRig(o = {}) {
  const opt = {
    distance: 3.4, above: 0.45, shoulder: 0, pitch: -0.28, minPitch: -1.2, maxPitch: 0.55,
    follow: 18, followY: 9, recover: 6, radius: 0.2, recenter: 0, recenterRate: 1.5, ...o,
  };
  const rig = {
    name: "orbit", opt, yaw: 0, pitch: opt.pitch, pivot: null, arm: null, armVel: 0, idle: 0,
    enter(cam, s, fresh) {
      rig.yaw = fresh ? headingOf(s) : cam.yaw;
      rig.pitch = fresh ? opt.pitch : clamp(cam.pitch, opt.minPitch, opt.maxPitch);
      rig.pivot = null; rig.arm = null; rig.idle = 0;
    },
    step(dt, s, world, input = {}, cam = null) {
      const look = input.look ?? [0, 0];
      rig.yaw = wrapAngle(rig.yaw + look[0]);
      rig.pitch = clamp(rig.pitch + look[1], opt.minPitch, opt.maxPitch);
      const hv = Math.hypot(s.vel?.[0] ?? 0, s.vel?.[2] ?? 0);
      rig.idle = Math.abs(look[0]) + Math.abs(look[1]) > 1e-6 ? 0 : rig.idle + dt;
      if (opt.recenter > 0 && rig.idle > opt.recenter && hv > 2) rig.yaw = wrapAngle(rig.yaw + wrapAngle(headingOf(s) - rig.yaw) * ease(opt.recenterRate, dt));
      const r = rightOf(rig.yaw);
      const h = s.height ?? 1.1;
      const k = cam ? Math.tan(cam.baseFov / 2) / Math.tan(1.15 / 2) : 1;
      const want = [s.pos[0] + r[0] * opt.shoulder, s.pos[1] + h * 0.5 + (h * 0.5 + opt.above) * k, s.pos[2] + r[2] * opt.shoulder];
      if (!rig.pivot) rig.pivot = want;
      else {
        const kx = ease(opt.follow, dt);
        const ky = ease(opt.followY, dt);
        rig.pivot = [rig.pivot[0] + (want[0] - rig.pivot[0]) * kx, rig.pivot[1] + (want[1] - rig.pivot[1]) * ky, rig.pivot[2] + (want[2] - rig.pivot[2]) * kx];
      }
      const pivot = safePoint(world, s, rig.pivot, opt.radius);
      const f = dirOf(rig.yaw, rig.pitch);
      const path = armPath(world, pivot, sub(pivot, scale(f, opt.distance)), opt.radius);
      armTo(rig, path.reach, dt, opt.recover);
      const eye = alongPath(path.points, rig.arm);
      return { eye, target: add(pivot, scale(f, opt.distance - rig.arm)) };
    },
  };
  return rig;
}

function chaseRig(o = {}) {
  const opt = {
    distance: 3, height: 1.5, rise: 0.12, lookHeight: 0.7, lookAhead: 1.4, lead: 0.12,
    turn: 1.45, turnBySpeed: 0.145, swing: 1.5, swingRate: 3.6, eyeRate: 7.4, lookRate: 14, recover: 6, radius: 0.2,
    above: 0.35, unblock: 4, ...o,
  };
  const rig = {
    name: "chase", opt, yaw: 0, side: [0, 0], eye: null, look: null, arm: null, armVel: 0, reach: 0,
    enter(cam, s, fresh) {
      rig.yaw = fresh ? headingOf(s) : cam.yaw;
      rig.side = [0, 0]; rig.arm = null;
      rig.eye = fresh ? null : [...cam.eye];
      rig.look = fresh ? null : [...cam.target];
    },
    step(dt, s, world) {
      const vel = s.vel ?? [0, 0, 0];
      const hv = Math.hypot(vel[0], vel[2]);
      const blocked = rig.arm !== null && rig.arm < 0.5 * rig.reach;
      const turn = (opt.turn + hv * opt.turnBySpeed) * (blocked ? opt.unblock : 1);
      if (hv > 1) rig.yaw = wrapAngle(rig.yaw + wrapAngle(headingOf(s) - rig.yaw) * ease(turn, dt));
      const wall = s.mode === "wall" && s.wall ? [s.wall[0] * opt.swing, s.wall[2] * opt.swing] : [0, 0];
      const ks = ease(opt.swingRate, dt);
      rig.side = [rig.side[0] + (wall[0] - rig.side[0]) * ks, rig.side[1] + (wall[1] - rig.side[1]) * ks];
      const f = frontOf(rig.yaw);
      const wantEye = [s.pos[0] - f[0] * opt.distance + rig.side[0], s.pos[1] + opt.height + opt.distance * opt.rise, s.pos[2] - f[2] * opt.distance + rig.side[1]];
      const wantLook = [s.pos[0] + f[0] * opt.lookAhead + vel[0] * opt.lead, s.pos[1] + opt.lookHeight, s.pos[2] + f[2] * opt.lookAhead + vel[2] * opt.lead];
      rig.eye = rig.eye ? lerp3(rig.eye, wantEye, ease(opt.eyeRate * (blocked ? opt.unblock : 1), dt)) : wantEye;
      rig.look = rig.look ? lerp3(rig.look, wantLook, ease(opt.lookRate, dt)) : wantLook;
      const pivot = safePoint(world, s, [s.pos[0], s.pos[1] + (s.height ?? 1.1) + opt.above, s.pos[2]], opt.radius);
      const path = armPath(world, pivot, rig.eye, opt.radius);
      armTo(rig, path.reach, dt, opt.recover);
      rig.reach = len(sub(rig.eye, pivot));
      return { eye: alongPath(path.points, rig.arm), target: rig.look };
    },
  };
  return rig;
}

function firstRig(o = {}) {
  const opt = { eyeHeight: 0.88, minPitch: -1.45, maxPitch: 1.45, ...o };
  const rig = {
    name: "first", opt, yaw: 0, pitch: 0, hidesSubject: true,
    enter(cam, s, fresh) { rig.yaw = fresh ? headingOf(s) : cam.yaw; rig.pitch = fresh ? 0 : clamp(cam.pitch, opt.minPitch, opt.maxPitch); },
    step(dt, s, world, input = {}) {
      const look = input.look ?? [0, 0];
      rig.yaw = wrapAngle(rig.yaw + look[0]);
      rig.pitch = clamp(rig.pitch + look[1], opt.minPitch, opt.maxPitch);
      const eye = [s.pos[0], s.pos[1] + (s.height ?? 1.1) * opt.eyeHeight, s.pos[2]];
      return { eye, target: add(eye, dirOf(rig.yaw, rig.pitch)) };
    },
  };
  return rig;
}

function boundsOf(s) {
  const b = s.bounds;
  if (Array.isArray(b) && b.length === 6) return b;
  if (b?.min && b?.max) return [...b.min, ...b.max];
  const r = s.radius ?? 0.3;
  const h = s.height ?? 1.1;
  return [s.pos[0] - r, s.pos[1], s.pos[2] - r, s.pos[0] + r, s.pos[1] + h, s.pos[2] + r];
}

function frameView(s, { front, turn = 0, elevation = 0.14, fov = 1.15, aspect = 1, fill = 0.8, near = 0.3 } = {}) {
  const fy = front === undefined || front === null ? headingOf(s) : Array.isArray(front) ? yawOf(front) : front;
  const a = fy + turn;
  const out = [Math.sin(a) * Math.cos(elevation), Math.sin(elevation), Math.cos(a) * Math.cos(elevation)]; // (subject -> camera: its front side)
  const fwd = scale(out, -1);
  const { right, up } = cameraBasis([0, 0, 0], fwd);
  const [x0, y0, z0, x1, y1, z1] = boundsOf(s);
  const corners = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) corners.push([x, y, z]);
  const ty = Math.tan(fov / 2) * fill;
  const tx = ty * aspect;
  let target = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  let D = near;
  for (let pass = 0; pass < 3; pass += 1) {
    D = near;
    for (const p of corners) {
      const rel = sub(p, target);
      const z = dot(rel, fwd);
      D = Math.max(D, Math.abs(dot(rel, right)) / tx - z, Math.abs(dot(rel, up)) / ty - z, near - z);
    }
    if (pass === 2) break;
    let lx = Infinity; let hx = -Infinity; let ly = Infinity; let hy = -Infinity;
    for (const p of corners) {
      const rel = sub(p, target);
      const z = D + dot(rel, fwd);
      const sx = dot(rel, right) / z;
      const sy = dot(rel, up) / z;
      lx = Math.min(lx, sx); hx = Math.max(hx, sx); ly = Math.min(ly, sy); hy = Math.max(hy, sy);
    }
    target = add(target, add(scale(right, ((lx + hx) / 2) * D), scale(up, ((ly + hy) / 2) * D)));
  }
  return { eye: add(target, scale(out, D)), target, distance: D, yaw: a + Math.PI };
}

function frameRig(o = {}) {
  const opt = { turn: 0.45, elevation: 0.14, spin: 0, rate: 6, fill: null, pixels: null, front: null, collide: true, radius: 0.2, ...o };
  const rig = {
    name: "frame", opt, turn: opt.turn, eye: null, target: null,
    enter() { rig.turn = opt.turn; rig.eye = null; rig.target = null; },
    step(dt, s, world, input = {}, cam) {
      rig.turn += opt.spin * dt + (input.look?.[0] ?? 0);
      const fill = opt.pixels ? clamp(opt.pixels / cam.height, 0.1, 0.95) : opt.fill ?? fillForTarget(cam.width, cam.height);
      const v = frameView(s, { front: opt.front, turn: rig.turn, elevation: opt.elevation, fov: cam.baseFov, aspect: cam.aspect, fill });
      const k = opt.rate > 0 && rig.eye ? ease(opt.rate, dt) : 1;
      rig.eye = rig.eye ? lerp3(rig.eye, v.eye, k) : v.eye;
      rig.target = rig.target ? lerp3(rig.target, v.target, k) : v.target;
      if (!opt.collide || !world?.boxes?.length) return { eye: rig.eye, target: rig.target };
      const from = safePoint(world, s, rig.target, opt.radius);
      return { eye: alongPath(armPath(world, from, rig.eye, opt.radius).points, Infinity), target: rig.target };
    },
  };
  return rig;
}

function spline(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return p1.map((_, i) => 0.5 * (2 * p1[i] + (p2[i] - p0[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (3 * p1[i] - p0[i] - 3 * p2[i] + p3[i]) * t3));
}

function railRig(o = {}) {
  const opt = { keys: [], loop: true, speed: 1, period: null, name: "rail", ...o };
  const rig = {
    name: opt.name, opt, t: 0,
    enter() { rig.t = 0; },
    at(t, s) {
      const keys = opt.keys;
      const aim = (k) => (k.target ? k.target : s ? [s.pos[0], s.pos[1] + (s.height ?? 1.1) * 0.6, s.pos[2]] : [0, 0, 0]);
      if (keys.length === 1) return { eye: [...keys[0].eye], target: [...aim(keys[0])], fov: keys[0].fov };
      const n = keys.length;
      const first = keys[0].at;
      const last = keys[n - 1].at;
      const period = opt.period ?? last - first + (last - first) / (n - 1);
      let tt = first + t;
      if (opt.loop) tt = first + (((t % period) + period) % period);
      else tt = clamp(tt, first, last);
      let i = n - 1;
      while (i > 0 && keys[i].at > tt) i -= 1;
      const next = (j) => (opt.loop ? keys[((j % n) + n) % n] : keys[clamp(j, 0, n - 1)]);
      const end = i === n - 1 ? (opt.loop ? first + period : last) : keys[i + 1].at;
      const u = end > keys[i].at ? clamp((tt - keys[i].at) / (end - keys[i].at), 0, 1) : 0;
      const [k0, k1, k2, k3] = [next(i - 1), next(i), next(i + 1), next(i + 2)];
      const fov = k1.fov !== undefined && k2.fov !== undefined ? k1.fov + (k2.fov - k1.fov) * u : k1.fov;
      return { eye: spline(k0.eye, k1.eye, k2.eye, k3.eye, u), target: spline(aim(k0), aim(k1), aim(k2), aim(k3), u), fov };
    },
    step(dt, s) {
      rig.t += dt * opt.speed;
      return opt.keys.length ? rig.at(rig.t, s) : { eye: [0, 2, -4], target: [0, 1, 0] };
    },
  };
  return rig;
}
const fixedRig = (o = {}) => railRig({ name: "fixed", keys: o.eye ? [{ at: 0, eye: o.eye, target: o.target, fov: o.fov }] : [], ...o });


function subjectOf(body, { height = 1.1, radius = 0.26 } = {}) {
  return { pos: body.pos, yaw: body.facing, vel: body.vel, height, radius, mode: body.mode, wall: body.mode === "wall" ? body.wall : null };
}

function createCamera(o = {}) {
  const opt = { mode: "orbit", width: 128, height: 128, fov: null, blend: 0.3, fovKick: 0, kickSpeeds: [6, 12], hideWithin: 0.35, ...o };
  const shakeOpt = { max: 0.05, decay: 1.6, ...o.shake };
  const rigs = {
    orbit: orbitRig(o.orbit), chase: chaseRig(o.chase), first: firstRig(o.first),
    frame: frameRig(o.frame), rail: railRig(o.rail), fixed: fixedRig(o.fixed), ...o.rigs,
  };
  let entering = true;
  let fresh = true;
  let blending = null;
  let kick = 0;
  const cam = {
    eye: [0, 2, -4], target: [0, 1, 0], fov: opt.fov ?? fovForTarget(opt.width, opt.height),
    yaw: 0, pitch: 0, mode: opt.mode, width: opt.width, height: opt.height,
    time: 0, trauma: 0, nod: 0, nodVel: 0, nearSubject: Infinity, rigs,
    get aspect() { return cam.width / cam.height; },
    get baseFov() { return opt.fov ?? fovForTarget(cam.width, cam.height); },
    get rig() { return rigs[cam.mode]; },
    get hidesSubject() { return (Boolean(rigs[cam.mode].hidesSubject) && (!blending || blending.t > blending.dur * 0.5)) || cam.nearSubject < opt.hideWithin; },
    setTarget(w, h) { cam.width = w; cam.height = h; },
    setMode(name, { blend = opt.blend } = {}) {
      if (!rigs[name]) throw new Error(`no camera mode "${name}"`);
      if (name === cam.mode) return cam;
      blending = blend > 0 && !fresh ? { from: { eye: [...cam.eye], target: [...cam.target], fov: cam.fov }, t: 0, dur: blend } : null;
      cam.mode = name;
      entering = true;
      return cam;
    },
    step(dt, subject, world = {}, input = {}) {
      cam.time += dt;
      const rig = rigs[cam.mode];
      if (entering) { rig.enter?.(cam, subject, fresh); entering = false; fresh = false; }
      const out = rig.step(dt, subject, world, input, cam);
      let fov = out.fov ?? cam.baseFov;
      if (opt.fovKick) {
        const hv = Math.hypot(subject.vel?.[0] ?? 0, subject.vel?.[2] ?? 0);
        const [s0, s1] = opt.kickSpeeds;
        kick += (clamp((hv - s0) / (s1 - s0), 0, 1) - kick) * ease(4, dt);
        fov *= 1 + opt.fovKick * kick;
      }
      let { eye, target } = out;
      if (blending) {
        blending.t += dt;
        const k = smoothstep(clamp(blending.t / blending.dur, 0, 1));
        eye = lerp3(blending.from.eye, eye, k);
        target = lerp3(blending.from.target, target, k);
        fov = blending.from.fov + (fov - blending.from.fov) * k;
        if (blending.t >= blending.dur) blending = null;
      }
      cam.eye = [...eye]; cam.target = [...target]; cam.fov = fov;
      const r = subject.radius ?? 0.3;
      const ay = clamp(eye[1], subject.pos[1] + r, subject.pos[1] + Math.max(r, (subject.height ?? 1.1) - r));
      cam.nearSubject = len(sub(eye, [subject.pos[0], ay, subject.pos[2]])) - r;
      const f = sub(target, eye);
      const fl = len(f) || 1;
      if (Math.hypot(f[0], f[2]) > 1e-9) cam.yaw = yawOf(f);
      cam.pitch = Math.asin(clamp(f[1] / fl, -1, 1));
      cam.trauma = Math.max(0, cam.trauma - shakeOpt.decay * dt);
      cam.nodVel += (-180 * cam.nod - 13.4 * cam.nodVel) * dt;
      cam.nod += cam.nodVel * dt;
      return cam;
    },
    shake(amount) { cam.trauma = clamp(cam.trauma + amount, 0, 1); return cam; },
    thud(amount) { cam.nodVel -= amount * 24.5; return cam; }, // (the spring's first dip is ~0.041 of the kick)
    view() {
      const d = sub(cam.target, cam.eye);
      const L = len(d) || 1;
      const t = cam.time;
      const s = cam.trauma * cam.trauma * shakeOpt.max;
      const jy = s * (0.6 * Math.sin(t * 37.1 + 1.3) + 0.4 * Math.sin(t * 61.7));
      const jp = s * (0.6 * Math.sin(t * 43.3 + 0.7) + 0.4 * Math.sin(t * 71.9 + 2.1)) + cam.nod;
      if (jy === 0 && jp === 0) return { eye: [...cam.eye], target: [...cam.target], fov: cam.fov };
      return { eye: [...cam.eye], target: add(cam.eye, scale(dirOf(cam.yaw + jy, clamp(cam.pitch + jp, -1.55, 1.55)), L)), fov: cam.fov };
    },
    move(forward, strafe) { return moveFromView(cam.yaw, forward, strafe); },
  };
  return cam;
}

return { get dirOf() { return dirOf; }, get fovForTarget() { return fovForTarget; }, get fillForTarget() { return fillForTarget; }, get clearance() { return clearance; }, get sphereCast() { return sphereCast; }, get normalAt() { return normalAt; }, get armPath() { return armPath; }, get alongPath() { return alongPath; }, get orbitRig() { return orbitRig; }, get chaseRig() { return chaseRig; }, get firstRig() { return firstRig; }, get boundsOf() { return boundsOf; }, get frameView() { return frameView; }, get frameRig() { return frameRig; }, get railRig() { return railRig; }, get fixedRig() { return fixedRig; }, get subjectOf() { return subjectOf; }, get createCamera() { return createCamera; } };
});

__def("src/input/input.js", () => {

const { moveFromView } = __mod("src/core/frame.js");
const GAME_KEYS = Object.freeze({
  KeyW: "forward", ArrowUp: "forward", KeyS: "back", ArrowDown: "back",
  KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
  Space: "jump", ShiftLeft: "sprint", ShiftRight: "sprint",
});
const BY_NAME = {
  w: "KeyW", a: "KeyA", s: "KeyS", d: "KeyD", " ": "Space", space: "Space", spacebar: "Space", shift: "ShiftLeft",
  arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
};
const MODIFIERS = new Set(["meta", "os", "control", "alt", "altgraph", "contextmenu", "fn", "hyper", "super", "capslock"]);
const isModifier = (name) => MODIFIERS.has(String(name ?? "").toLowerCase().replace(/(left|right)$/, ""));

function codeOf(k) {
  if (k && typeof k === "object") return (k.code && GAME_KEYS[k.code] ? k.code : null) ?? codeOf(k.key ?? "");
  const s = String(k);
  if (GAME_KEYS[s]) return s;
  return BY_NAME[s.toLowerCase()] ?? null;
}

function deadzone(x, y, dz) {
  const l = Math.hypot(x, y);
  if (l <= dz) return [0, 0];
  const k = Math.min(1, (l - dz) / (1 - dz)) / l;
  return [x * k, y * k];
}
const pressed = (b) => (typeof b === "number" ? b > 0.5 : Boolean(b?.pressed));

function createArbiter({ idle = 6, start = "autopilot" } = {}) {
  const a = {
    driver: start, idleFor: 0, idle,
    update(dt, real) {
      if (real) { a.driver = "player"; a.idleFor = 0; }
      else {
        a.idleFor += dt;
        if (a.driver === "player" && a.idleFor >= a.idle - 1e-9) a.driver = "autopilot"; // (steps summed in floats: 240 of 1/120 is 2 s)
      }
      return a.driver;
    },
    takeOver() { a.driver = "player"; a.idleFor = 0; },
    giveBack() { a.driver = "autopilot"; },
  };
  return a;
}

function createInput(o = {}) {
  const opt = { sensitivity: 0.0025, invertY: false, lookSpeed: 2.8, deadzone: 0.18, idle: 6, start: "autopilot", touchSensitivity: 0.006, touchRadius: 48, maxMouse: 240, ...o };
  const arbiter = createArbiter({ idle: opt.idle, start: opt.start });
  const held = new Set();
  let mouse = [0, 0];
  let touchLook = [0, 0];
  let stick = [0, 0];
  let pad = null;
  let padJumpWas = false;
  let jumpLatch = false;
  let real = false;
  const doing = (action) => { for (const c of held) if (GAME_KEYS[c] === action) return true; return false; };

  const input = {
    opt, arbiter, locked: false, pollPads: null,
    get driver() { return arbiter.driver; },
    get player() { return arbiter.driver === "player"; },
    key(k, down) {
      const ev = k && typeof k === "object" ? k : null;
      if (isModifier(ev ? ev.key ?? ev.code : k) || isModifier(ev?.code)) { if (down) input.blur(); return false; }
      const code = codeOf(k);
      if (!code) return false;
      if (!down) { held.delete(code); return true; }
      if (ev && (ev.metaKey || ev.ctrlKey || ev.altKey)) return false; // (a shortcut, not a move)
      if (!held.has(code)) {
        held.add(code);
        if (GAME_KEYS[code] === "jump") jumpLatch = true;
        if (GAME_KEYS[code] !== "sprint") real = true; // (shift alone takes nothing over)
      }
      return true;
    },
    look(dx, dy) {
      const c = (v) => Math.max(-opt.maxMouse, Math.min(opt.maxMouse, v || 0)); // (some browsers throw one huge jump when the lock starts)
      mouse = [mouse[0] + c(dx), mouse[1] + c(dy)];
      if (dx || dy) real = true;
    },
    touchLook(dx, dy) { touchLook = [touchLook[0] + dx, touchLook[1] + dy]; if (dx || dy) real = true; },
    stick(x, y) { stick = [x, y]; if (x || y) real = true; },
    tap() { jumpLatch = true; real = true; },
    pad(p) { pad = p ?? null; },
    blur() { held.clear(); stick = [0, 0]; mouse = [0, 0]; touchLook = [0, 0]; },
    sample(dt, viewYaw = 0) {
      if (input.pollPads) pad = input.pollPads() ?? null;
      let fwd = (doing("forward") ? 1 : 0) - (doing("back") ? 1 : 0);
      let strafe = (doing("right") ? 1 : 0) - (doing("left") ? 1 : 0);
      const inv = opt.invertY ? -1 : 1;
      let lookYaw = mouse[0] * opt.sensitivity + touchLook[0] * opt.touchSensitivity;
      let lookPitch = -(mouse[1] * opt.sensitivity + touchLook[1] * opt.touchSensitivity) * inv;
      mouse = [0, 0]; touchLook = [0, 0];
      let padJump = false;
      let padSprint = false;
      if (pad) {
        const ax = pad.axes ?? [];
        const [lx, ly] = deadzone(ax[0] ?? 0, ax[1] ?? 0, opt.deadzone);
        const [rx, ry] = deadzone(ax[2] ?? 0, ax[3] ?? 0, opt.deadzone);
        strafe += lx; fwd -= ly; // (a stick's up is -y)
        lookYaw += rx * opt.lookSpeed * dt;
        lookPitch -= ry * opt.lookSpeed * dt * inv;
        const b = pad.buttons ?? [];
        padJump = pressed(b[0]);
        padSprint = pressed(b[10]) || pressed(b[5]);
        if (padJump && !padJumpWas) jumpLatch = true;
        if (lx || ly || rx || ry || padJump) real = true;
      }
      padJumpWas = padJump;
      strafe += stick[0]; fwd += stick[1];
      const l = Math.hypot(strafe, fwd);
      if (l > 1) { strafe /= l; fwd /= l; }
      const jump = jumpLatch;
      jumpLatch = false;
      const hold = doing("jump") || padJump || jump;
      const moving = Math.abs(fwd) + Math.abs(strafe) > 0;
      const driver = arbiter.update(dt, real || moving || hold);
      real = false;
      return {
        move: moveFromView(viewYaw, fwd, strafe), axes: [strafe || 0, fwd || 0], look: [lookYaw || 0, lookPitch || 0], // (|| 0: no -0s)
        jump, hold, sprint: doing("sprint") || padSprint, driver, player: driver === "player",
      };
    },
    attach(target = globalThis, { canvas = null, lock = true, touch = true, document: doc = globalThis.document, navigator: nav = globalThis.navigator } = {}) {
      const offs = [];
      const on = (el, type, fn, how) => { if (!el?.addEventListener) return; el.addEventListener(type, fn, how); offs.push(() => el.removeEventListener(type, fn, how)); };
      const editable = (e) => { const t = e.target; return Boolean(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ""))); };
      on(target, "keydown", (e) => { if (!editable(e) && input.key(e, true)) e.preventDefault(); });
      on(target, "keyup", (e) => { if (input.key(e, false) && !editable(e)) e.preventDefault(); });
      on(target, "blur", () => input.blur());
      on(doc, "visibilitychange", () => { if (doc.hidden) input.blur(); });
      if (nav?.getGamepads) input.pollPads = () => { for (const p of nav.getGamepads() ?? []) if (p?.connected) return p; return null; };
      if (canvas) {
        let drag = false;
        const ask = (how) => { try { const r = how ? canvas.requestPointerLock?.(how) : canvas.requestPointerLock?.(); return r?.then ? r : Promise.resolve(); } catch (e) { return Promise.reject(e); } };
        const requestLock = () => { ask({ unadjustedMovement: true }).catch(() => ask().catch(() => {})); };
        on(canvas, "click", () => { if (lock && doc?.pointerLockElement !== canvas) requestLock(); });
        on(doc, "pointerlockchange", () => { input.locked = doc.pointerLockElement === canvas; if (!input.locked) drag = false; });
        on(canvas, "mousedown", (e) => { if (e.button === 0 && !input.locked) drag = true; });
        on(globalThis, "mouseup", () => { drag = false; });
        on(doc, "mousemove", (e) => { if (input.locked || drag) input.look(e.movementX, e.movementY); });
        if (touch) {
          let moveId = null;
          let moveAt = null;
          let lookId = null;
          let lookAt = null;
          const opts = { passive: false };
          on(canvas, "touchstart", (e) => {
            const r = canvas.getBoundingClientRect();
            for (const t of e.changedTouches) {
              if (t.clientX < r.left + r.width / 2 && moveId === null) { moveId = t.identifier; moveAt = [t.clientX, t.clientY]; }
              else if (lookId === null) { lookId = t.identifier; lookAt = { x: t.clientX, y: t.clientY, far: 0, t: e.timeStamp }; }
            }
            e.preventDefault();
          }, opts);
          on(canvas, "touchmove", (e) => {
            for (const t of e.changedTouches) {
              if (t.identifier === moveId) {
                let sx = (t.clientX - moveAt[0]) / opt.touchRadius;
                let sy = -(t.clientY - moveAt[1]) / opt.touchRadius;
                const l = Math.hypot(sx, sy);
                if (l > 1) { sx /= l; sy /= l; }
                input.stick(sx, sy);
              } else if (t.identifier === lookId) {
                const dx = t.clientX - lookAt.x;
                const dy = t.clientY - lookAt.y;
                lookAt.far += Math.abs(dx) + Math.abs(dy); lookAt.x = t.clientX; lookAt.y = t.clientY;
                input.touchLook(dx, dy);
              }
            }
            e.preventDefault();
          }, opts);
          const end = (e) => {
            for (const t of e.changedTouches) {
              if (t.identifier === moveId) { moveId = null; input.stick(0, 0); }
              else if (t.identifier === lookId) { if (lookAt.far < 12 && e.timeStamp - lookAt.t < 250) input.tap(); lookId = null; }
            }
          };
          on(canvas, "touchend", end);
          on(canvas, "touchcancel", end);
        }
      }
      return () => {
        for (const off of offs) off();
        input.pollPads = null;
        if (canvas && doc?.pointerLockElement === canvas) doc.exitPointerLock?.();
        input.locked = false;
        input.blur();
      };
    },
  };
  return input;
}

return { get GAME_KEYS() { return GAME_KEYS; }, get codeOf() { return codeOf; }, get createArbiter() { return createArbiter; }, get createInput() { return createInput; } };
});

__def("src/scene/registry.js", () => {

const { createRoll, stream } = __mod("src/core/rng.js");
const ASSET_SLOTS = { REALM: 0, BUILD: 1 };

function roleMatches(entryRole, wanted) {
  if (wanted === null || wanted === undefined || wanted === "any") return true;
  if (entryRole === "both" || entryRole === "any" || entryRole === undefined) return true;
  return Array.isArray(entryRole) ? entryRole.includes(wanted) : entryRole === wanted;
}

function makeRealm(name, weight) {
  const entries = [];
  const realm = {
    name,
    weight,
    add({ key, weight: w = 1, role = "both", build, keyOnly = false, ...meta }) {
      if (typeof key !== "string" || !key) throw new TypeError("A builder needs a string key.");
      if (typeof build !== "function") throw new TypeError(`Builder ${key} needs build(S, ctx).`);
      if (!(w > 0)) throw new RangeError(`Builder ${key} needs a positive weight.`);
      if (entries.some((e) => e.key === key)) throw new Error(`${name} already has ${key}.`);
      entries.push({ key, weight: w, role, build, keyOnly, meta });
      return realm;
    },
    entries: () => entries.slice(),
    keys: () => entries.map((e) => e.key),
    get: (key) => entries.find((e) => e.key === key) ?? null,
    pool: (role = "any") => entries.filter((e) => !e.keyOnly && roleMatches(e.role, role)),
    pick(S, role = "any", opts = {}) {
      const pool = realm.pool(role);
      let chosen = null;
      if (pool.length) chosen = S.weighted(pool.map((e) => [e, e.weight]));
      if (opts.key) chosen = realm.get(opts.key) ?? chosen;
      if (!chosen) throw new RangeError(`${name} has nothing for role ${role}.`);
      const { key, build } = chosen;
      const fn = (...a) => {
        const obj = build(...a);
        if (obj && typeof obj === "object" && obj.key === undefined) obj.key = key;
        return obj;
      };
      fn.key = key;
      return fn;
    },
  };
  return realm;
}

function createRegistry() {
  const realms = [];
  const registry = {
    defineRealm(name, { weight = 1 } = {}) {
      const have = realms.find((r) => r.name === name);
      if (have) return have;
      if (!(weight > 0)) throw new RangeError(`Realm ${name} needs a positive weight.`);
      const r = makeRealm(name, weight);
      realms.push(r);
      return r;
    },
    realm: (name) => realms.find((r) => r.name === name) ?? null,
    realms: () => realms.slice(),
    pickRealm(S) {
      if (!realms.length) throw new RangeError("The registry has no realms.");
      return S.weighted(realms.map((r) => [r, r.weight]));
    },
    makeAsset(seed, { realm: realmName = null, key = null, role = "any", ctx = {}, state = null } = {}) {
      const roll = createRoll(seed);
      const rr = stream(roll, ASSET_SLOTS.REALM);
      let realm = registry.pickRealm(rr);
      if (realmName) {
        realm = registry.realm(realmName);
        if (!realm) throw new RangeError(`No realm named ${realmName}.`);
      }
      const S = stream(roll, ASSET_SLOTS.BUILD);
      const build = realm.pick(S, role, { key });
      const obj = build(S, ctx, { seed: roll.seed, role, state, realm: realm.name, roll });
      if (!obj || typeof obj !== "object") return obj ?? null;
      obj.realm = realm.name;
      if (obj.seed === undefined) obj.seed = roll.seed;
      return obj;
    },
  };
  return registry;
}

const DEFAULT = createRegistry();
const defineRealm = (name, opts) => DEFAULT.defineRealm(name, opts);
const makeAsset = (seed, opts) => DEFAULT.makeAsset(seed, opts);
const defaultRegistry = DEFAULT;

return { get ASSET_SLOTS() { return ASSET_SLOTS; }, get roleMatches() { return roleMatches; }, get createRegistry() { return createRegistry; }, get defineRealm() { return defineRealm; }, get makeAsset() { return makeAsset; }, get defaultRegistry() { return defaultRegistry; } };
});

__def("src/core/sdf.js", () => {

function sdSphere(x, y, z, r) {
  return Math.sqrt(x * x + y * y + z * z) - r;
}

function sdBox(x, y, z, bx, by, bz, round = 0) {
  const qx = Math.abs(x) - bx + round;
  const qy = Math.abs(y) - by + round;
  const qz = Math.abs(z) - bz + round;
  const ox = qx > 0 ? qx : 0;
  const oy = qy > 0 ? qy : 0;
  const oz = qz > 0 ? qz : 0;
  const inside = Math.min(Math.max(qx, qy, qz), 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + inside - round;
}

function sdTorus(x, y, z, R, r) {
  const q = Math.sqrt(x * x + z * z) - R;
  return Math.sqrt(q * q + y * y) - r;
}

function sdCylinder(x, y, z, r, h, round = 0) {
  const dx = Math.sqrt(x * x + z * z) - r + round;
  const dy = Math.abs(y) - h + round;
  const ox = dx > 0 ? dx : 0;
  const oy = dy > 0 ? dy : 0;
  return Math.min(Math.max(dx, dy), 0) + Math.sqrt(ox * ox + oy * oy) - round;
}

function sdCapsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const px = x - ax;
  const py = y - ay;
  const pz = z - az;
  const ex = bx - ax;
  const ey = by - ay;
  const ez = bz - az;
  let h = (px * ex + py * ey + pz * ez) / (ex * ex + ey * ey + ez * ez);
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  const dx = px - ex * h;
  const dy = py - ey * h;
  const dz = pz - ez * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

function sdHexPrism(x, y, z, r, h) {
  const kx = -0.8660254;
  const ky = 0.5;
  const kz = 0.57735;
  let px = Math.abs(x);
  let pz = Math.abs(z);
  const d0 = 2 * Math.min(kx * px + ky * pz, 0);
  px -= d0 * kx;
  pz -= d0 * ky;
  const cx = Math.min(Math.max(px, -kz * r), kz * r);
  const lx = px - cx;
  const lz = pz - r;
  const dxz = Math.sqrt(lx * lx + lz * lz) * Math.sign(lz);
  const dy = Math.abs(y) - h;
  return Math.min(Math.max(dxz, dy), 0) + Math.hypot(Math.max(dxz, 0), Math.max(dy, 0));
}

function sdEllipsoid(x, y, z, rx, ry, rz) {
  const k0 = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
  const k1 = Math.sqrt((x / (rx * rx)) ** 2 + (y / (ry * ry)) ** 2 + (z / (rz * rz)) ** 2);
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function sdPolygon(px, py, xs, ys) {
  const n = xs.length;
  let dx = px - xs[0];
  let dy = py - ys[0];
  let d = dx * dx + dy * dy;
  let s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const ex = xs[j] - xs[i];
    const ey = ys[j] - ys[i];
    const wx = px - xs[i];
    const wy = py - ys[i];
    let h = (wx * ex + wy * ey) / (ex * ex + ey * ey);
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const bx = wx - ex * h;
    const by = wy - ey * h;
    const dd = bx * bx + by * by;
    if (dd < d) d = dd;
    const c1 = py >= ys[i];
    const c2 = py < ys[j];
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

function profile(points) {
  const xs = new Float64Array(points.length);
  const ys = new Float64Array(points.length);
  let rmax = 0;
  let ymin = Infinity;
  let ymax = -Infinity;
  points.forEach(([r, y], at) => {
    xs[at] = r;
    ys[at] = y;
    if (r > rmax) rmax = r;
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
  });
  return { xs, ys, rmax, ymin, ymax };
}

function sdLathe(x, y, z, prof, round = 0) {
  const r = Math.sqrt(x * x + z * z);
  const out = Math.max(r - prof.rmax, prof.ymin - y, y - prof.ymax);
  if (out > 0.15) return out;
  return sdPolygon(r, y, prof.xs, prof.ys) - round;
}

function sdPlanes(x, y, z, planes) {
  let d = -Infinity;
  for (let i = 0; i < planes.length; i += 4) {
    const v = planes[i] * x + planes[i + 1] * y + planes[i + 2] * z - planes[i + 3];
    if (v > d) d = v;
  }
  return d;
}

return { get sdSphere() { return sdSphere; }, get sdBox() { return sdBox; }, get sdTorus() { return sdTorus; }, get sdCylinder() { return sdCylinder; }, get sdCapsule() { return sdCapsule; }, get sdHexPrism() { return sdHexPrism; }, get sdEllipsoid() { return sdEllipsoid; }, get smin() { return smin; }, get sdPolygon() { return sdPolygon; }, get profile() { return profile; }, get sdLathe() { return sdLathe; }, get sdPlanes() { return sdPlanes; } };
});

__def("src/scene/kit.js", () => {

const { TAU } = __mod("src/core/math.js");
const { profile, sdBox, sdCapsule, sdCylinder, sdEllipsoid, sdLathe, sdSphere, sdTorus } = __mod("src/core/sdf.js");
function rotation(yaw = 0, pitch = 0, roll = 0) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  return [
    cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp,
    cp * sr, cp * cr, -sp,
    -sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp,
  ];
}

function placed(sdf, pos, m) {
  const [px, py, pz] = pos;
  if (!m) return (x, y, z, t, V) => sdf(x - px, y - py, z - pz, t, V);
  return (x, y, z, t, V) => {
    const dx = x - px;
    const dy = y - py;
    const dz = z - pz;
    return sdf(
      m[0] * dx + m[3] * dy + m[6] * dz,
      m[1] * dx + m[4] * dy + m[7] * dz,
      m[2] * dx + m[5] * dy + m[8] * dz,
      t,
      V,
    );
  };
}

const ball = (x, y, z, r) => [x - r, y - r, z - r, x + r, y + r, z + r];

function unionBounds(list) {
  const out = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const b of list) {
    for (let i = 0; i < 3; i += 1) {
      if (b[i] < out[i]) out[i] = b[i];
      if (b[i + 3] > out[i + 3]) out[i + 3] = b[i + 3];
    }
  }
  return out;
}

function mat3mul(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return out;
}

const angleOf = (x, z) => Math.atan2(z, x) / TAU;


const bx = (c, h) => [c[0] - h[0], c[1] - h[1], c[2] - h[2], c[0] + h[0], c[1] + h[1], c[2] + h[2]];

const box = (c, h, r = 0.01) => ({ f: (x, y, z) => sdBox(x - c[0], y - c[1], z - c[2], h[0], h[1], h[2], r), b: bx(c, h) });

function cyl(c, r, h, axis = "y", round = 0) {
  if (axis === "y") return { f: (x, y, z) => sdCylinder(x - c[0], y - c[1], z - c[2], r, h, round), b: bx(c, [r, h, r]) };
  if (axis === "z") return { f: (x, y, z) => sdCylinder(x - c[0], z - c[2], y - c[1], r, h, round), b: bx(c, [r, r, h]) };
  return { f: (x, y, z) => sdCylinder(y - c[1], x - c[0], z - c[2], r, h, round), b: bx(c, [h, r, r]) };
}

const sphere = (c, r) => ({ f: (x, y, z) => sdSphere(x - c[0], y - c[1], z - c[2], r), b: bx(c, [r, r, r]) });
const ellipsoid = (c, rs) => ({ f: (x, y, z) => sdEllipsoid(x - c[0], y - c[1], z - c[2], rs[0], rs[1], rs[2]), b: bx(c, rs) });
const capsule = (a, b, r) => ({
  f: (x, y, z) => sdCapsule(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], r),
  b: unionBounds([bx(a, [r, r, r]), bx(b, [r, r, r])]),
});

function torus(c, R, r, axis = "y") {
  const e = R + r;
  if (axis === "y") return { f: (x, y, z) => sdTorus(x - c[0], y - c[1], z - c[2], R, r), b: bx(c, [e, r, e]) };
  if (axis === "z") return { f: (x, y, z) => sdTorus(x - c[0], z - c[2], y - c[1], R, r), b: bx(c, [e, e, r]) };
  return { f: (x, y, z) => sdTorus(y - c[1], x - c[0], z - c[2], R, r), b: bx(c, [r, e, e]) };
}

const U = (...shapes) => ({
  f: (x, y, z, t, V) => {
    let d = Infinity;
    for (const s of shapes) {
      const v = s.f(x, y, z, t, V);
      if (v < d) d = v;
    }
    return d;
  },
  b: unionBounds(shapes.map((s) => s.b)),
});

const cut = (a, ...holes) => ({
  f: (x, y, z, t, V) => {
    let d = a.f(x, y, z, t, V);
    for (const h of holes) d = Math.max(d, -h.f(x, y, z, t, V));
    return d;
  },
  b: a.b,
});

const inter = (a, b) => ({ f: (x, y, z, t, V) => Math.max(a.f(x, y, z, t, V), b.f(x, y, z, t, V)), b: a.b });

function turned(shape, m, pivot = [0, 0, 0]) {
  const f = placed((x, y, z, t, V) => shape.f(x + pivot[0], y + pivot[1], z + pivot[2], t, V), pivot, m);
  return { f, b: rotateBounds(shape.b, m, pivot) };
}

function rotateBounds(b, m, pivot = [0, 0, 0]) {
  const pts = [];
  for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) {
    const dx = x - pivot[0];
    const dy = y - pivot[1];
    const dz = z - pivot[2];
    const px = m[0] * dx + m[1] * dy + m[2] * dz + pivot[0];
    const py = m[3] * dx + m[4] * dy + m[5] * dz + pivot[1];
    const pz = m[6] * dx + m[7] * dy + m[8] * dz + pivot[2];
    pts.push([px, py, pz, px, py, pz]);
  }
  return unionBounds(pts);
}

function lowest(parts) {
  const b = unionBounds(parts.map((p) => p.bounds));
  const hitY = (x, z) => {
    let y = b[1] - 0.05;
    for (let s = 0; s < 160 && y < b[4]; s += 1) {
      let d = Infinity;
      for (const p of parts) d = Math.min(d, p.sdf(x, y, z, 0));
      if (d < 0.0005) return y;
      y += Math.max(d * 0.9, 0.0005);
    }
    return Infinity;
  };
  let low = Infinity;
  let bx0 = 0;
  let bz0 = 0;
  const n = 18;
  for (let i = 0; i <= n; i += 1) {
    for (let k = 0; k <= n; k += 1) {
      const x = b[0] + ((b[3] - b[0]) * i) / n;
      const z = b[2] + ((b[5] - b[2]) * k) / n;
      const y = hitY(x, z);
      if (y < low) { low = y; bx0 = x; bz0 = z; }
    }
  }
  if (low === Infinity) return b[1];
  let h = Math.max(b[3] - b[0], b[5] - b[2]) / n / 2;
  for (let it = 0; it < 40 && h > 1e-4; it += 1) {
    let moved = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const y = hitY(bx0 + dx * h, bz0 + dz * h);
      if (y < low - 1e-6) { low = y; bx0 += dx * h; bz0 += dz * h; moved = true; break; }
    }
    if (!moved) h /= 2;
  }
  return low;
}

const mul3 = (a, b) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
function rotateOnto(a, b) {
  const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (c < -0.9999) {
    const ax = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    const k = [a[1] * ax[2] - a[2] * ax[1], a[2] * ax[0] - a[0] * ax[2], a[0] * ax[1] - a[1] * ax[0]];
    const l = Math.hypot(...k);
    const u = k.map((v) => v / l);
    return [0, 1, 2].flatMap((r) => [0, 1, 2].map((q) => 2 * u[r] * u[q] - (r === q ? 1 : 0)));
  }
  const v = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const K = [0, -v[2], v[1], v[2], 0, -v[0], -v[1], v[0], 0];
  const K2 = mul3(K, K);
  return [0, 1, 2].flatMap((r) => [0, 1, 2].map((q) => (r === q ? 1 : 0) + K[r * 3 + q] + K2[r * 3 + q] / (1 + c)));
}
function rotatedSdf(f, R) {
  return (x, y, z, t, V) => f(R[0] * x + R[3] * y + R[6] * z, R[1] * x + R[4] * y + R[7] * z, R[2] * x + R[5] * y + R[8] * z, t, V);
}


let nextPartId = 1;

function part(spec, materials = null) {
  if (typeof spec.sdf !== "function") throw new TypeError("A part needs an sdf(x, y, z, t).");
  if (!Array.isArray(spec.bounds) || spec.bounds.length !== 6) throw new TypeError("A part needs bounds [x0,y0,z0,x1,y1,z1].");
  const m = (materials && spec.mat && materials[spec.mat]) ?? spec.m ?? {};
  return { ...spec, id: spec.id ?? nextPartId++, name: spec.name ?? spec.mat ?? "part", mat: spec.mat ?? null, m };
}

const mk = (shape, spec = {}, materials = null) => part({ ...spec, sdf: shape.f, bounds: shape.b }, materials);

function lathePart(spec, materials = null) {
  const prof = profile(spec.points);
  const round = spec.round ?? 0.008;
  const oy = spec.y ?? 0;
  return part({
    ...spec,
    axisym: true,
    sdf: (x, y, z) => sdLathe(x, y - oy, z, prof, round),
    bounds: [-prof.rmax, prof.ymin + oy, -prof.rmax, prof.rmax, prof.ymax + oy, prof.rmax],
  }, materials);
}

return { get rotation() { return rotation; }, get placed() { return placed; }, get ball() { return ball; }, get unionBounds() { return unionBounds; }, get mat3mul() { return mat3mul; }, get angleOf() { return angleOf; }, get box() { return box; }, get cyl() { return cyl; }, get sphere() { return sphere; }, get ellipsoid() { return ellipsoid; }, get capsule() { return capsule; }, get torus() { return torus; }, get U() { return U; }, get cut() { return cut; }, get inter() { return inter; }, get turned() { return turned; }, get rotateBounds() { return rotateBounds; }, get lowest() { return lowest; }, get rotateOnto() { return rotateOnto; }, get rotatedSdf() { return rotatedSdf; }, get part() { return part; }, get mk() { return mk; }, get lathePart() { return lathePart; } };
});

__def("src/scene/entity.js", () => {

const { rotation } = __mod("src/scene/kit.js");
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function makeTransform(t = {}) {
  const pos = t.pos ?? [0, 0, 0];
  if (!Array.isArray(pos) || pos.length !== 3) throw new TypeError("transform.pos must be [x, y, z].");
  const scale = t.scale ?? 1;
  if (!(scale > 0)) throw new RangeError("transform.scale must be a positive number.");
  return { pos: [pos[0], pos[1], pos[2]], yaw: t.yaw ?? 0, pitch: t.pitch ?? 0, roll: t.roll ?? 0, scale };
}

function rotationOf(transform) {
  const { yaw = 0, pitch = 0, roll = 0 } = transform;
  return yaw === 0 && pitch === 0 && roll === 0 ? IDENTITY : rotation(yaw, pitch, roll);
}

function createEntity({ id, transform = {}, parts = [], tags = [], components = {} } = {}) {
  if (id === undefined || id === null) throw new TypeError("An entity needs an id.");
  for (const p of parts) {
    if (typeof p.sdf !== "function") throw new TypeError(`Part ${p.name ?? "?"} of ${id} has no sdf.`);
    if (!Array.isArray(p.bounds) || p.bounds.length !== 6) throw new TypeError(`Part ${p.name ?? "?"} of ${id} has no bounds.`);
  }
  return {
    id,
    transform: makeTransform(transform),
    parts: [...parts],
    tags: [...new Set(tags)].sort(),
    components: { ...components },
  };
}

function withTransform(entity, patch) {
  return { ...entity, transform: makeTransform({ ...entity.transform, ...patch }) };
}

const hasTag = (entity, tag) => entity.tags.includes(tag);

function withComponent(entity, name, data) {
  const components = { ...entity.components };
  if (data === undefined) delete components[name];
  else components[name] = data;
  return { ...entity, components };
}

const byTag = (entities, ...tags) => entities.filter((e) => tags.every((t) => e.tags.includes(t)));

function toWorld(entity, p) {
  const { pos, scale } = entity.transform;
  const m = rotationOf(entity.transform);
  const x = p[0] * scale;
  const y = p[1] * scale;
  const z = p[2] * scale;
  return [
    m[0] * x + m[1] * y + m[2] * z + pos[0],
    m[3] * x + m[4] * y + m[5] * z + pos[1],
    m[6] * x + m[7] * y + m[8] * z + pos[2],
  ];
}

function toLocal(entity, p) {
  const { pos, scale } = entity.transform;
  const m = rotationOf(entity.transform);
  const dx = p[0] - pos[0];
  const dy = p[1] - pos[1];
  const dz = p[2] - pos[2];
  return [
    (m[0] * dx + m[3] * dy + m[6] * dz) / scale,
    (m[1] * dx + m[4] * dy + m[7] * dz) / scale,
    (m[2] * dx + m[5] * dy + m[8] * dz) / scale,
  ];
}

function dirToWorld(entity, d) {
  const m = rotationOf(entity.transform);
  return [m[0] * d[0] + m[1] * d[1] + m[2] * d[2], m[3] * d[0] + m[4] * d[1] + m[5] * d[2], m[6] * d[0] + m[7] * d[1] + m[8] * d[2]];
}

function dirToLocal(entity, d) {
  const m = rotationOf(entity.transform);
  return [m[0] * d[0] + m[3] * d[1] + m[6] * d[2], m[1] * d[0] + m[4] * d[1] + m[7] * d[2], m[2] * d[0] + m[5] * d[1] + m[8] * d[2]];
}

function worldSdf(entity, p) {
  const { pos, scale } = entity.transform;
  const m = rotationOf(entity.transform);
  const f = p.sdf;
  const inv = 1 / scale;
  return (x, y, z, t = 0, V) => {
    const dx = x - pos[0];
    const dy = y - pos[1];
    const dz = z - pos[2];
    return scale * f(
      (m[0] * dx + m[3] * dy + m[6] * dz) * inv,
      (m[1] * dx + m[4] * dy + m[7] * dz) * inv,
      (m[2] * dx + m[5] * dy + m[8] * dz) * inv,
      t,
      V,
    );
  };
}

function entitySdf(entity) {
  const fs = entity.parts.map((p) => worldSdf(entity, p));
  return (x, y, z, t = 0, V) => {
    let d = Infinity;
    for (const f of fs) {
      const v = f(x, y, z, t, V);
      if (v < d) d = v;
    }
    return d;
  };
}

return { get makeTransform() { return makeTransform; }, get rotationOf() { return rotationOf; }, get createEntity() { return createEntity; }, get withTransform() { return withTransform; }, get hasTag() { return hasTag; }, get withComponent() { return withComponent; }, get byTag() { return byTag; }, get toWorld() { return toWorld; }, get toLocal() { return toLocal; }, get dirToWorld() { return dirToWorld; }, get dirToLocal() { return dirToLocal; }, get worldSdf() { return worldSdf; }, get entitySdf() { return entitySdf; } };
});

__def("src/scene/bounds.js", () => {

const { rotateBounds, unionBounds } = __mod("src/scene/kit.js");
const { entitySdf, rotationOf, worldSdf } = __mod("src/scene/entity.js");
const EMPTY = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

function localAabbOf(entity) {
  return entity.parts.length ? unionBounds(entity.parts.map((p) => p.bounds)) : EMPTY.slice();
}

function transformAabb(box, transform) {
  if (!Number.isFinite(box[0])) return EMPTY.slice();
  const { pos, scale } = transform;
  const m = rotationOf(transform);
  const r = rotateBounds(box, m);
  return [r[0] * scale + pos[0], r[1] * scale + pos[1], r[2] * scale + pos[2], r[3] * scale + pos[0], r[4] * scale + pos[1], r[5] * scale + pos[2]];
}

const partAabbOf = (entity, part) => transformAabb(part.bounds, entity.transform);

function aabbOf(entity) {
  if (!entity.parts.length) return EMPTY.slice();
  return unionBounds(entity.parts.map((p) => partAabbOf(entity, p)));
}

function sphereOf(entity) {
  const b = aabbOf(entity);
  if (!Number.isFinite(b[0])) return { center: [0, 0, 0], radius: 0 };
  const center = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
  return { center, radius: Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 };
}

const boxOf = (a) => (Array.isArray(a) ? a : aabbOf(a));

function overlaps(a, b, margin = 0) {
  const p = boxOf(a);
  const q = boxOf(b);
  return p[0] <= q[3] + margin && p[3] >= q[0] - margin
    && p[1] <= q[4] + margin && p[4] >= q[1] - margin
    && p[2] <= q[5] + margin && p[5] >= q[2] - margin;
}

function containsPoint(a, p) {
  const b = boxOf(a);
  return p[0] >= b[0] && p[0] <= b[3] && p[1] >= b[1] && p[1] <= b[4] && p[2] >= b[2] && p[2] <= b[5];
}

const mergeAabb = (a, b) => unionBounds([a, b]);

function distance(entity, point, t = 0) {
  let d = Infinity;
  for (const p of entity.parts) {
    const v = worldSdf(entity, p)(point[0], point[1], point[2], t);
    if (v < d) d = v;
  }
  return d;
}

function nearestPart(entity, point, t = 0) {
  let best = null;
  for (const p of entity.parts) {
    const v = worldSdf(entity, p)(point[0], point[1], point[2], t);
    if (!best || v < best.distance) best = { part: p, distance: v };
  }
  return best;
}

function normalAt(entity, point, t = 0, h = 0.0012) {
  const f = entitySdf(entity);
  const [x, y, z] = point;
  const nx = f(x + h, y, z, t) - f(x - h, y, z, t);
  const ny = f(x, y + h, z, t) - f(x, y - h, z, t);
  const nz = f(x, y, z + h, t) - f(x, y, z - h, t);
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

function rayAabb(o, d, b) {
  let tn = -Infinity;
  let tf = Infinity;
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < b[i] || o[i] > b[i + 3]) return null;
      continue;
    }
    let t0 = (b[i] - o[i]) / d[i];
    let t1 = (b[i + 3] - o[i]) / d[i];
    if (t0 > t1) [t0, t1] = [t1, t0];
    if (t0 > tn) tn = t0;
    if (t1 < tf) tf = t1;
    if (tn > tf) return null;
  }
  if (tf < 0) return null;
  return [Math.max(tn, 0), tf];
}

function raycast(entity, o, d, { far = Infinity, t = 0, eps = 0.0005, steps = 200 } = {}) {
  const span = rayAabb(o, d, aabbOf(entity));
  if (!span || span[0] > far) return null;
  const f = entitySdf(entity);
  let s = span[0];
  const end = Math.min(span[1], far);
  for (let i = 0; i < steps && s <= end; i += 1) {
    const p = [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s];
    const v = f(p[0], p[1], p[2], t);
    if (v < eps) return { t: s, point: p };
    s += Math.max(v, eps);
  }
  return null;
}

function touching(a, b, { margin = 0, n = 8, t = 0 } = {}) {
  const pa = aabbOf(a);
  const pb = aabbOf(b);
  if (!overlaps(pa, pb, margin)) return false;
  const lo = [Math.max(pa[0], pb[0]) - margin, Math.max(pa[1], pb[1]) - margin, Math.max(pa[2], pb[2]) - margin];
  const hi = [Math.min(pa[3], pb[3]) + margin, Math.min(pa[4], pb[4]) + margin, Math.min(pa[5], pb[5]) + margin];
  const fa = entitySdf(a);
  const fb = entitySdf(b);
  const cell = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / n;
  for (let i = 0; i <= n; i += 1) for (let j = 0; j <= n; j += 1) for (let k = 0; k <= n; k += 1) {
    const x = lo[0] + ((hi[0] - lo[0]) * i) / n;
    const y = lo[1] + ((hi[1] - lo[1]) * j) / n;
    const z = lo[2] + ((hi[2] - lo[2]) * k) / n;
    if (fa(x, y, z, t) <= margin + cell * 0.5 && fb(x, y, z, t) <= margin + cell * 0.5) return true;
  }
  return false;
}

return { get localAabbOf() { return localAabbOf; }, get transformAabb() { return transformAabb; }, get partAabbOf() { return partAabbOf; }, get aabbOf() { return aabbOf; }, get sphereOf() { return sphereOf; }, get overlaps() { return overlaps; }, get containsPoint() { return containsPoint; }, get mergeAabb() { return mergeAabb; }, get distance() { return distance; }, get nearestPart() { return nearestPart; }, get normalAt() { return normalAt; }, get rayAabb() { return rayAabb; }, get raycast() { return raycast; }, get touching() { return touching; } };
});

__def("src/object/prims.js", () => {

const { worldToLocal } = __mod("src/core/frame.js");
const { sdBox, sdCapsule } = __mod("src/core/sdf.js");
const { part, unionBounds } = __mod("src/scene/kit.js");
const num3 = (v, what) => {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) throw new TypeError(`${what} must be [x, y, z].`);
  return [v[0], v[1], v[2]];
};

function boxBounds({ c, h, yaw = 0 }) {
  const co = Math.abs(Math.cos(yaw));
  const si = Math.abs(Math.sin(yaw));
  const ex = h[0] * co + h[2] * si;
  const ez = h[0] * si + h[2] * co;
  return [c[0] - ex, c[1] - h[1], c[2] - ez, c[0] + ex, c[1] + h[1], c[2] + ez];
}

const capsuleBounds = ({ a, b, r }) => unionBounds([
  [a[0] - r, a[1] - r, a[2] - r, a[0] + r, a[1] + r, a[2] + r],
  [b[0] - r, b[1] - r, b[2] - r, b[0] + r, b[1] + r, b[2] + r],
]);

function boxSdf({ c, h, yaw = 0, round = 0 }) {
  const co = Math.cos(yaw);
  const si = Math.sin(yaw);
  const [cx, cy, cz] = c;
  const [hx, hy, hz] = h;
  return (x, y, z) => {
    const dx = x - cx;
    const dz = z - cz;
    return sdBox(dx * co - dz * si, y - cy, dx * si + dz * co, hx, hy, hz, round);
  };
}

const capsuleSdf = ({ a, b, r }) => (x, y, z) => sdCapsule(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], r);

function boxPart(spec, extra = {}) {
  const c = num3(spec.c, "box.c");
  const h = num3(spec.h, "box.h");
  if (!h.every((v) => v > 0)) throw new RangeError("box.h must be positive half-extents.");
  const yaw = spec.yaw ?? 0;
  const prim = { type: "box", c, h, yaw };
  return part({ ...extra, sdf: boxSdf({ c, h, yaw, round: spec.round ?? 0 }), bounds: boxBounds(prim), prim });
}

function capsulePart(spec, extra = {}) {
  const a = num3(spec.a, "capsule.a");
  const b = num3(spec.b, "capsule.b");
  if (!(spec.r > 0)) throw new RangeError("capsule.r must be positive.");
  const prim = { type: "capsule", a, b, r: spec.r };
  return part({ ...extra, sdf: capsuleSdf(prim), bounds: capsuleBounds(prim), prim });
}

function toPart(spec) {
  if (!spec || typeof spec !== "object") throw new TypeError("A part must be an object.");
  if (typeof spec.sdf === "function") return spec;
  const { box, capsule, shape, ...rest } = spec;
  if (box) return boxPart(box, rest);
  if (capsule) return capsulePart(capsule, rest);
  if (shape) return part({ ...rest, sdf: shape.f, bounds: shape.b });
  if (spec.c && spec.h) {
    const { c, h, yaw, round, ...more } = spec;
    return boxPart({ c, h, yaw, round }, more);
  }
  if (spec.a && spec.b && spec.r) {
    const { a, b, r, ...more } = spec;
    return capsulePart({ a, b, r }, more);
  }
  throw new TypeError(`Part ${spec.name ?? "?"} is neither a box, a capsule, a shape nor an SDF part.`);
}

function overTop(p, bx, margin = 0) {
  const l = worldToLocal(bx.c, bx.yaw ?? 0, p);
  return Math.abs(l[0]) <= bx.h[0] + margin && Math.abs(l[2]) <= bx.h[2] + margin;
}

return { get boxBounds() { return boxBounds; }, get capsuleBounds() { return capsuleBounds; }, get boxSdf() { return boxSdf; }, get capsuleSdf() { return capsuleSdf; }, get boxPart() { return boxPart; }, get capsulePart() { return capsulePart; }, get toPart() { return toPart; }, get overTop() { return overTop; } };
});

__def("src/scene/front.js", () => {

const { wrapAngle } = __mod("src/core/frame.js");
const { dirToWorld } = __mod("src/scene/entity.js");
const { unionBounds } = __mod("src/scene/kit.js");
const { rayAabb } = __mod("src/scene/bounds.js");
const { toPart } = __mod("src/object/prims.js");
const FEATURES = new Map();
const F = (weight) => ({ side: "front", weight });
const B = (weight) => ({ side: "back", weight });
for (const [word, spec] of Object.entries({
  face: F(1.2), eye: F(1), nose: F(1), mouth: F(0.8), snout: F(1), beak: F(1), visor: F(1), grin: F(0.8), brow: F(0.6),
  screen: F(1.5), display: F(1.5), lcd: F(1.2), lens: F(1.2), dial: F(0.8), gauge: F(0.8), bezel: F(0.8), clockface: F(1.2), readout: F(1),
  photo: F(1.2), picture: F(1.2), portrait: F(1.2), poster: F(1), soundhole: F(1), fretboard: F(0.6), chute: F(0.8),
  cone: F(1.1), speaker: F(1), grille: F(1), grill: F(1), woofer: F(1.1), tweeter: F(1.1),
  knob: F(0.6), button: F(0.5), buttons: F(0.5), key: F(0.3), keypad: F(0.5), slot: F(0.5), tray: F(0.5), switch: F(0.3),
  door: F(1.2), drawer: F(1.2), opening: F(1), hatch: F(1), headlight: F(1), front: F(1.5), fascia: F(1), label: F(0.4),
  back: B(1.2), backrest: B(1.5), rear: B(1.2), tail: B(1), hinge: B(0.5), cable: B(0.3), cord: B(0.3), plug: B(0.3), vent: B(0.3),
})) FEATURES.set(word, spec);

function defineFeature(word, { side = "front", weight = 1 } = {}) {
  if (side !== "front" && side !== "back") throw new RangeError('A feature side is "front" or "back".');
  if (!(weight > 0)) throw new RangeError("A feature weight must be positive.");
  FEATURES.set(String(word).toLowerCase(), { side, weight });
}

const USE_CASES = [
  { why: "a seat faces out from its backrest", from: ["backrest", "back"], to: ["seat", "cushion", "saddle"] },
  { why: "a screen faces away from its stand", from: ["stand", "neck", "mount", "bracket", "easel", "kickstand"], to: ["screen", "display", "panel", "sign", "board", "face"] },
  { why: "a picture faces away from the leg it leans on", from: ["leg", "easel", "kickstand"], to: ["photo", "picture", "portrait", "canvas"] },
  { why: "shelves open away from their back", from: ["back", "backboard", "backpanel"], to: ["shelf", "drawer", "door"] },
  { why: "a lamp faces where its head reaches", from: ["post", "pole", "column"], to: ["head", "lantern", "shade", "bulb", "lamp"] },
];
function defineUseCase({ why, from, to }) {
  if (!Array.isArray(from) || !Array.isArray(to) || !from.length || !to.length) throw new TypeError("A use case needs from[] and to[] words.");
  USE_CASES.push({ why: why ?? `${to[0]} faces away from ${from[0]}`, from: from.map((w) => w.toLowerCase()), to: to.map((w) => w.toLowerCase()) });
}

function wordsOf(p) {
  const text = [p.role, p.name, p.feature].filter((v) => typeof v === "string").join(" ");
  return text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

const lookup = (w, table) => (table.has(w) ? [w, table.get(w)] : w.endsWith("s") && table.has(w.slice(0, -1)) ? [w.slice(0, -1), table.get(w.slice(0, -1))] : null);

function featureOf(p, table = FEATURES) {
  if (p.feature === false) return null;
  let best = null;
  for (const w of wordsOf(p)) {
    const hit = lookup(w, table);
    if (hit && (!best || hit[1].weight > best.weight)) best = { ...hit[1], word: hit[0] };
  }
  if (!best && (p.mat === "screen" || p.mat === "lcd")) best = { ...(table.get("screen") ?? F(1.5)), word: `mat:${p.mat}` };
  return best;
}

const hasWord = (p, list) => wordsOf(p).some((w) => list.includes(w) || (w.endsWith("s") && list.includes(w.slice(0, -1))));


function parseFront(front) {
  if (front === null || front === undefined || front === false) return null;
  if (typeof front === "number") return wrapAngle(front);
  if (front === true) return 0;
  if (typeof front === "string") {
    const m = { "+z": 0, z: 0, front: 0, "-z": Math.PI, back: Math.PI, "+x": Math.PI / 2, x: Math.PI / 2, right: Math.PI / 2, "-x": -Math.PI / 2, left: -Math.PI / 2 }[front.trim().toLowerCase()];
    if (m === undefined) throw new RangeError(`Unknown front "${front}".`);
    return wrapAngle(m);
  }
  if (Array.isArray(front)) {
    if (Math.hypot(front[0], front[2]) < 1e-9) throw new RangeError("A front direction needs a horizontal part.");
    return Math.atan2(front[0], front[2]);
  }
  if (typeof front === "object") {
    if (front.yaw !== undefined) return parseFront(front.yaw);
    if (front.dir) return parseFront(front.dir);
  }
  throw new TypeError("A front is a yaw, a direction, a '+z'-style name, or { yaw } / { dir }.");
}

const dirOfYaw = (y) => [Math.sin(y), 0, Math.cos(y)];
const yawOfV = (v) => Math.atan2(v[0], v[1]); // (v is horizontal [x, z])
const angleBetween = (a, b) => Math.abs(wrapAngle(a - b));


function normalise(thing, opts) {
  let parts;
  let transform = null;
  let declared = null;
  let declaredFrom = null;
  const src = Array.isArray(thing) ? { parts: thing } : thing;
  if (!src || typeof src !== "object") throw new TypeError("detectFront needs an object, an entity, parts, or { boxes, capsules }.");
  if (Array.isArray(src.parts)) parts = src.parts.map(toPart);
  else parts = [];
  for (const b of src.boxes ?? []) parts.push(toPart({ name: b.name ?? "box", ...b }));
  for (const c of src.capsules ?? []) parts.push(toPart({ name: c.name ?? "capsule", ...c }));
  if (!parts.length) throw new RangeError("detectFront: the thing has no parts.");
  if (src.transform) transform = src.transform;
  const pick = [["opts.front", opts.front], ["front", src.front], ["def.front", src.def?.front], ["components.front", src.components?.front]];
  for (const [from, v] of pick) {
    if (v !== undefined && v !== null) { declared = parseFront(v); declaredFrom = from; break; }
  }
  if (declared === null && src.facing === true && opts.front !== null) { declared = 0; declaredFrom = "facing flag (+z)"; }
  return { parts, transform, declared, declaredFrom, facingFlag: src.facing };
}


function fieldOf(parts, pad) {
  const boxes = parts.map((p) => [p.bounds[0] - pad, p.bounds[1] - pad, p.bounds[2] - pad, p.bounds[3] + pad, p.bounds[4] + pad, p.bounds[5] + pad]);
  const dist = (x, y, z) => {
    let d = Infinity;
    for (let i = 0; i < parts.length; i += 1) {
      const b = boxes[i];
      const ox = Math.max(b[0] - x, 0, x - b[3]);
      const oy = Math.max(b[1] - y, 0, y - b[4]);
      const oz = Math.max(b[2] - z, 0, z - b[5]);
      const lb = Math.hypot(ox, oy, oz);
      if (lb >= d) continue;
      const v = parts[i].sdf(x, y, z, 0, null);
      if (v < d) d = v;
    }
    return d;
  };
  const hit = (o, dir, eps, steps) => {
    const cand = [];
    let t0 = Infinity;
    let t1 = -Infinity;
    for (let i = 0; i < parts.length; i += 1) {
      const s = rayAabb(o, dir, boxes[i]);
      if (!s) continue;
      cand.push(i);
      if (s[0] < t0) t0 = s[0];
      if (s[1] > t1) t1 = s[1];
    }
    if (!cand.length) return null;
    let t = t0;
    for (let n = 0; n < steps && t <= t1; n += 1) {
      const x = o[0] + dir[0] * t;
      const y = o[1] + dir[1] * t;
      const z = o[2] + dir[2] * t;
      let d = Infinity;
      let who = -1;
      for (const i of cand) {
        const v = parts[i].sdf(x, y, z, 0, null);
        if (v < d) { d = v; who = i; }
      }
      if (d < eps) return { t, part: who, p: [x, y, z] };
      t += Math.max(d * 0.9, eps);
    }
    return null;
  };
  return { dist, hit };
}

function massOf(parts, field, B, n) {
  const ext = [B[3] - B[0], B[4] - B[1], B[5] - B[2]];
  const cell = Math.max(...ext) / n;
  let m = 0;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  const pts = [];
  const nx = Math.max(2, Math.ceil(ext[0] / cell));
  const ny = Math.max(2, Math.ceil(ext[1] / cell));
  const nz = Math.max(2, Math.ceil(ext[2] / cell));
  for (let i = 0; i < nx; i += 1) for (let j = 0; j < ny; j += 1) for (let k = 0; k < nz; k += 1) {
    const x = B[0] + ((i + 0.5) * ext[0]) / nx;
    const y = B[1] + ((j + 0.5) * ext[1]) / ny;
    const z = B[2] + ((k + 0.5) * ext[2]) / nz;
    if (field.dist(x, y, z) < cell * 0.5) { m += 1; sx += x; sy += y; sz += z; pts.push(x, z); }
  }
  if (!m) {
    const c = [(B[0] + B[3]) / 2, (B[1] + B[4]) / 2, (B[2] + B[5]) / 2];
    return { centroid: c, axisYaw: 0, ratio: 1, mid: c, n: 0 };
  }
  const c = [sx / m, sy / m, sz / m];
  let cxx = 0;
  let czz = 0;
  let cxz = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i] - c[0];
    const dz = pts[i + 1] - c[2];
    cxx += dx * dx; czz += dz * dz; cxz += dx * dz;
  }
  const tr = cxx + czz;
  const det = cxx * czz - cxz * cxz;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  let ex = cxz;
  let ez = l1 - cxx;
  if (Math.hypot(ex, ez) < 1e-12) { ex = cxx >= czz ? 1 : 0; ez = cxx >= czz ? 0 : 1; }
  const axisYaw = Math.atan2(ex, ez);
  const a1 = [Math.sin(axisYaw), Math.cos(axisYaw)];
  const a2 = [a1[1], -a1[0]];
  let lo1 = Infinity; let hi1 = -Infinity; let lo2 = Infinity; let hi2 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i] - c[0];
    const dz = pts[i + 1] - c[2];
    const u = dx * a1[0] + dz * a1[1];
    const v = dx * a2[0] + dz * a2[1];
    if (u < lo1) lo1 = u; if (u > hi1) hi1 = u; if (v < lo2) lo2 = v; if (v > hi2) hi2 = v;
  }
  const m1 = (lo1 + hi1) / 2;
  const m2 = (lo2 + hi2) / 2;
  const mid = [c[0] + a1[0] * m1 + a2[0] * m2, c[1], c[2] + a1[1] * m1 + a2[1] * m2];
  return { centroid: c, axisYaw, ratio: l1 > 0 ? l2 / l1 : 1, mid, n: m, cell };
}

function addNormal(nsum, parts, h, e, w) {
  const f = parts[h.part].sdf;
  const [x, y, z] = h.p;
  const gx = f(x + e, y, z, 0, null) - f(x - e, y, z, 0, null);
  const gy = f(x, y + e, z, 0, null) - f(x, y - e, z, 0, null);
  const gz = f(x, y, z + e, 0, null) - f(x, y, z - e, 0, null);
  const l = Math.hypot(gx, gy, gz);
  if (!(l > 0)) return;
  nsum[h.part * 4] += (gx / l) * w;
  nsum[h.part * 4 + 1] += (gy / l) * w;
  nsum[h.part * 4 + 2] += (gz / l) * w;
  nsum[h.part * 4 + 3] += w;
}

function ringOf(parts, field, feats, { dirs, grid, elevation, phase, center, radius, R, B, eps, steps, nsum }) {
  const views = [];
  const ce = Math.cos(elevation);
  const se = Math.sin(elevation);
  const diam = 2 * radius;
  const s0 = -R;
  const s1 = R;
  const v0 = (B[1] - center[1]) * ce - R * se;
  const v1 = (B[4] - center[1]) * ce + R * se;
  const supp = R;
  for (let k = 0; k < dirs; k += 1) {
    const th = phase + (k * 2 * Math.PI) / dirs;
    const uh = [Math.sin(th), 0, Math.cos(th)];
    const u = [uh[0] * ce, se, uh[2] * ce]; // (toward the viewer)
    const d = [-u[0], -u[1], -u[2]];
    const r = [Math.cos(th), 0, -Math.sin(th)];
    const up = [-uh[0] * se, ce, -uh[2] * se];
    const back = radius * 2.2;
    const depth = new Float64Array(grid * grid).fill(NaN);
    const who = new Int32Array(grid * grid).fill(-1);
    const cellArea = ((s1 - s0) / grid) * ((v1 - v0) / grid);
    const perPart = new Float64Array(parts.length);
    let hits = 0;
    let front = 0;
    let behind = 0;
    let recess = 0;
    for (let i = 0; i < grid; i += 1) {
      const s = s0 + ((i + 0.5) * (s1 - s0)) / grid;
      for (let j = 0; j < grid; j += 1) {
        const v = v0 + ((j + 0.5) * (v1 - v0)) / grid;
        const o = [
          center[0] + u[0] * back + r[0] * s + up[0] * v,
          center[1] + u[1] * back + r[1] * s + up[1] * v,
          center[2] + u[2] * back + r[2] * s + up[2] * v,
        ];
        const h = field.hit(o, d, eps, steps);
        if (!h) continue;
        hits += 1;
        const proj = (h.p[0] - center[0]) * uh[0] + (h.p[2] - center[2]) * uh[2];
        depth[i * grid + j] = proj;
        who[i * grid + j] = h.part;
        perPart[h.part] += cellArea;
        recess += (supp - proj) / diam;
        const f = feats[h.part];
        if (f) {
          if (f.side === "front") front += f.weight; else behind += f.weight;
          addNormal(nsum, parts, h, eps * 4, cellArea);
        }
      }
    }
    const rays = grid * grid;
    let edges = 0;
    let pairs = 0;
    let top = -Infinity;
    for (let n = 0; n < rays; n += 1) if (depth[n] > top) top = depth[n];
    let flat = 0;
    for (let i = 0; i < grid; i += 1) for (let j = 0; j < grid; j += 1) {
      const a = i * grid + j;
      if (Number.isNaN(depth[a])) continue;
      if (depth[a] >= top - 0.025 * diam) flat += 1;
      for (const b of [i + 1 < grid ? a + grid : -1, j + 1 < grid ? a + 1 : -1]) {
        if (b < 0 || Number.isNaN(depth[b])) continue;
        pairs += 1;
        if (who[a] !== who[b] || Math.abs(depth[a] - depth[b]) > 0.04 * diam) edges += 1;
      }
    }
    views.push({
      yaw: th, uh, hits: hits / rays,
      front: front / rays, behind: behind / rays,
      edges: pairs ? edges / pairs : 0,
      recess: hits ? recess / hits : 0,
      flat: flat / rays,
      parts: new Set(Array.from(who).filter((w) => w >= 0)).size,
      perPart,
    });
  }
  return views;
}

function contrast(views, key, floor) {
  const n = views.length;
  const half = n / 2;
  let x = 0;
  let z = 0;
  for (let k = 0; k < n; k += 1) {
    const a = views[k][key];
    const b = views[(k + half) % n][key];
    const c = (a - b) / (a + b + floor);
    x += c * views[k].uh[0];
    z += c * views[k].uh[2];
  }
  return [(2 * x) / n, (2 * z) / n];
}

const len2 = (v) => Math.hypot(v[0], v[1]);
const scale2 = (v, k) => [v[0] * k, v[1] * k];
const clamp2 = (v, m = 1) => { const l = len2(v); return l > m ? scale2(v, m / l) : v; };
const deg = (a) => `${Math.round((a * 180) / Math.PI)}°`;

function topView(parts, field, feats, { center, R, B, grid, eps, steps, nsum }) {
  const seen = new Float64Array(parts.length);
  const y = B[4] + (B[4] - B[1]) * 0.1 + eps * 10;
  for (let i = 0; i < grid; i += 1) for (let j = 0; j < grid; j += 1) {
    const o = [center[0] - R + ((i + 0.5) * 2 * R) / grid, y, center[2] - R + ((j + 0.5) * 2 * R) / grid];
    const h = field.hit(o, [0, -1, 0], eps, steps);
    if (!h) continue;
    seen[h.part] += ((2 * R) / grid) ** 2;
    if (feats[h.part]) addNormal(nsum, parts, h, eps * 4, ((2 * R) / grid) ** 2);
  }
  return seen;
}

function solidCentroid(p, n = 8) {
  const b = p.bounds;
  let m = 0; let x = 0; let y = 0; let z = 0;
  const cell = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / n;
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) for (let k = 0; k < n; k += 1) {
    const px = b[0] + ((i + 0.5) * (b[3] - b[0])) / n;
    const py = b[1] + ((j + 0.5) * (b[4] - b[1])) / n;
    const pz = b[2] + ((k + 0.5) * (b[5] - b[2])) / n;
    if (p.sdf(px, py, pz, 0, null) < cell * 0.35) { m += 1; x += px; y += py; z += pz; }
  }
  return m ? [x / m, y / m, z / m, m] : [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2, 0];
}

function centroidOf(list) {
  let w = 0; let x = 0; let y = 0; let z = 0;
  for (const p of list) {
    const c = solidCentroid(p);
    const b = p.bounds;
    const v = Math.max(1e-9, (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2])) ** (1 / 3);
    w += v; x += c[0] * v; y += c[1] * v; z += c[2] * v;
  }
  return w ? [x / w, y / w, z / w] : null;
}

const applyRot = (m, v) => (m ? [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]] : v);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function declaredNormal(p) {
  if (Array.isArray(p.normal)) return p.normal;
  if (p.screen && Array.isArray(p.screen.ax) && Array.isArray(p.screen.ay)) return applyRot(p.rot, cross(p.screen.ax, p.screen.ay));
  return null;
}


function frontEvidence(partsIn, opts = {}) {
  const parts = partsIn.map(toPart);
  const table = opts.features ? new Map([...FEATURES, ...Object.entries(opts.features)]) : FEATURES;
  const B = unionBounds(parts.map((p) => p.bounds));
  const size = Math.max(B[3] - B[0], B[4] - B[1], B[5] - B[2]) || 1;
  const field = fieldOf(parts, size * 0.002);
  const mass = massOf(parts, field, B, opts.massGrid ?? 16);
  const center = mass.centroid;
  let radius = 0;
  for (const x of [B[0], B[3]]) for (const y of [B[1], B[4]]) for (const z of [B[2], B[5]]) radius = Math.max(radius, Math.hypot(x - center[0], y - center[1], z - center[2]));
  const R = Math.max(1e-6, Math.max(...[[B[0], B[2]], [B[0], B[5]], [B[3], B[2]], [B[3], B[5]]].map(([x, z]) => Math.hypot(x - center[0], z - center[2]))));
  const feats = parts.map((p) => featureOf(p, table));
  const why = [];

  const nsum = new Float64Array(parts.length * 4);
  const views = ringOf(parts, field, feats, {
    dirs: opts.dirs ?? 24, grid: opts.grid ?? 12, elevation: opts.elevation ?? 0.2, phase: mass.axisYaw,
    center, radius, R, B, eps: size * 0.0015, steps: opts.steps ?? 90, nsum,
  });

  const featured = parts.map((p, i) => ({ p, f: feats[i], i })).filter((q) => q.f);
  let features = null;
  let up = 0;
  if (featured.length) {
    topView(parts, field, feats, { center, R, B, grid: opts.grid ?? 12, eps: size * 0.0015, steps: opts.steps ?? 90, nsum });
    const upness = new Map();
    let sx = 0; let sz = 0; let sw = 0;
    const amax = Math.max(1e-12, ...featured.map(({ i }) => nsum[i * 4 + 3]));
    for (const { f, i } of featured) {
      const a = nsum[i * 4 + 3];
      if (!(a > 0)) { upness.set(i, 0); continue; }
      const n = [nsum[i * 4] / a, nsum[i * 4 + 1] / a, nsum[i * 4 + 2] / a];
      const l = Math.hypot(...n) || 1;
      upness.set(i, Math.max(0, n[1]) / l);
      const sgn = f.side === "front" ? 1 : -1;
      const w = f.weight * Math.min(1, (4 * a) / amax);
      sx += sgn * w * n[0]; sz += sgn * w * n[2]; sw += w;
    }
    const surf = sw ? clamp2([(sx / sw) * 1.25, (sz / sw) * 1.25]) : [0, 0];
    let vx = 0; let vz = 0; let tot = 0;
    for (const v of views) {
      for (const { f, i } of featured) {
        const w = v.perPart[i] * f.weight;
        const sgn = f.side === "front" ? 1 : -1;
        vx += sgn * w * v.uh[0]; vz += sgn * w * v.uh[2]; tot += w;
      }
    }
    const vis = tot > 1e-9 ? clamp2([(vx / tot) * 1.25, (vz / tot) * 1.25]) : [0, 0];
    let cx = 0; let cz = 0; let cw = 0; let uw = 0;
    let nx = 0; let nz = 0; let nw = 0;
    for (const { p, f, i } of featured) {
      const c = solidCentroid(p);
      const s = f.side === "front" ? 1 : -1;
      const out = 1 - upness.get(i);
      cx += s * f.weight * out * (c[0] - center[0]); cz += s * f.weight * out * (c[2] - center[2]); cw += f.weight;
      up += upness.get(i) * f.weight; uw += f.weight;
      const n = declaredNormal(p);
      if (n) {
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        nx += (s * f.weight * n[0]) / l; nz += (s * f.weight * n[2]) / l; nw += f.weight;
      }
    }
    up = uw ? up / uw : 0;
    const off = cw ? clamp2([cx / (cw * 0.25 * R), cz / (cw * 0.25 * R)]) : [0, 0];
    const nrm = nw ? clamp2([nx / nw, nz / nw]) : null;
    const parts3 = [[surf, 1], [vis, 0.7], [off, 0.4], ...(nrm ? [[nrm, 1.2]] : [])];
    const W = parts3.reduce((acc, [, w]) => acc + w, 0);
    const v = parts3.reduce((acc, [q, w]) => [acc[0] + q[0] * w, acc[1] + q[1] * w], [0, 0]).map((q) => q / W);
    const amount = Math.min(1, featured.reduce((acc, q) => acc + q.f.weight, 0));
    features = { v: scale2(v, amount), vis, surf, offset: off, normal: nrm, up, words: [...new Set(featured.map((q) => q.f.word))] };
    const say = (q) => (len2(q) > 0.05 ? `${deg(yawOfV(q))} (${len2(q).toFixed(2)})` : "none");
    why.push(`features [${features.words.join(", ")}]: their surfaces face ${say(surf)}, seen most from ${say(vis)}, sit off the body toward ${say(off)}${nrm ? `, declare normals toward ${say(nrm)}` : ""}${up > 0.5 ? `; mostly on top (${up.toFixed(2)} face up)` : ""}`);
  }

  let useCase = null;
  {
    let ux = 0; let uz = 0; let uw = 0;
    const said = [];
    for (const rule of opts.useCases ?? USE_CASES) {
      const from = parts.filter((p) => hasWord(p, rule.from));
      const to = parts.filter((p) => hasWord(p, rule.to) && !from.includes(p));
      if (!from.length || !to.length) continue;
      const a = centroidOf(from);
      const b = centroidOf(to);
      const off = [b[0] - a[0], b[2] - a[2]];
      if (len2(off) < 0.02 * R) continue;
      const s = Math.min(1, len2(off) / (0.15 * R));
      ux += (off[0] / len2(off)) * s; uz += (off[1] / len2(off)) * s; uw += 1;
      said.push(`${rule.why} (${deg(yawOfV(off))})`);
    }
    if (uw) { useCase = { v: clamp2([ux / uw, uz / uw]) }; why.push(`use: ${said.join("; ")}`); }
  }

  const recess = contrast(views, "recess", 0.05);
  const edges = contrast(views, "edges", 0.03);
  const flat = contrast(views, "flat", 0.05);
  const mo = [mass.centroid[0] - mass.mid[0], mass.centroid[2] - mass.mid[2]];
  const massV = clamp2(scale2(mo, 1 / (0.15 * R)));
  const GW = { recess: 1, edges: 0.8, flat: 0.5, mass: 0.5 };
  const gv = [
    (recess[0] * GW.recess + edges[0] * GW.edges + flat[0] * GW.flat - massV[0] * GW.mass) / (GW.recess + GW.edges + GW.flat + GW.mass),
    (recess[1] * GW.recess + edges[1] * GW.edges + flat[1] * GW.flat - massV[1] * GW.mass) / (GW.recess + GW.edges + GW.flat + GW.mass),
  ];
  const gs = Math.max(0, len2(gv) - 0.04) / (1 - 0.04);
  const geometry = { v: len2(gv) > 1e-9 ? scale2(gv, gs / len2(gv)) : [0, 0], recess, edges, flat, mass: massV };
  const spread = (key) => { const xs = views.map((v) => v[key]); const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) / (Math.abs(m) + 0.02); };
  const round = mass.ratio > 0.85 && spread("hits") < 0.06 && spread("recess") < 0.12 && spread("edges") < 0.25
    && Math.max(len2(recess), len2(edges), len2(flat)) < 0.15;
  why.push(`geometry: recess ${deg(yawOfV(recess))} (${len2(recess).toFixed(2)}), edges ${deg(yawOfV(edges))} (${len2(edges).toFixed(2)}), flat face ${deg(yawOfV(flat))} (${len2(flat).toFixed(2)}), mass leans ${deg(yawOfV(massV))} (${len2(massV).toFixed(2)})${round ? "; round: every view alike" : ""}`);

  const layers = [
    ["features", features, 3, 0.95],
    ["useCase", useCase, 2.5, 0.9],
    ["geometry", geometry, 1, 0.6],
  ].filter(([, L]) => L && len2(L.v) > 1e-6);
  let sx = 0; let sz = 0; let sabs = 0; let miss = 1;
  for (const [, L, W, q] of layers) {
    sx += L.v[0] * W; sz += L.v[1] * W; sabs += len2(L.v) * W;
    miss *= 1 - Math.min(1, len2(L.v)) * q;
  }
  const agreement = sabs > 0 ? Math.hypot(sx, sz) / sabs : 0;
  let confidence = agreement * (1 - miss);
  const yaw = Math.hypot(sx, sz) > 1e-9 ? Math.atan2(sx, sz) : 0;
  const onlyGeometry = !features && !useCase;
  const symmetric = onlyGeometry && (round || gs < 0.12);
  if (symmetric) confidence = Math.min(confidence, 0.15);
  const out = (L) => (L ? { yaw: yawOfV(L.v), strength: len2(L.v) } : null);
  return {
    yaw, dir: dirOfYaw(yaw), confidence,
    symmetric, symmetry: round ? "round" : symmetric ? "mirror" : null,
    up,
    axisYaw: wrapAngle(mass.axisYaw + Math.PI / 2),
    layers: {
      features: features ? { ...out(features), words: features.words, seen: yawOfV(features.vis), offset: yawOfV(features.offset), up: features.up } : null,
      useCase: out(useCase),
      geometry: { ...out(geometry), recess: len2(recess), edges: len2(edges), flat: len2(flat), mass: len2(massV) },
    },
    agreement,
    why,
  };
}


function detectFront(thing, opts = {}) {
  const T = normalise(thing, opts);
  const E = opts.evidence ?? frontEvidence(T.parts, opts);
  const why = [...E.why];
  let local = E.yaw;
  let confidence = E.confidence;
  let agrees = null;
  if (T.declared !== null) {
    const off = angleBetween(T.declared, E.yaw);
    if (E.confidence >= 0.2) agrees = off <= Math.PI / 4;
    why.unshift(`declared ${deg(T.declared)} (${T.declaredFrom}); the evidence says ${deg(E.yaw)} at ${E.confidence.toFixed(2)}${agrees === null ? " -- too weak to check" : agrees ? " -- agrees" : ` -- DISAGREES by ${deg(off)}`}`);
    local = T.declared;
    confidence = agrees === true ? Math.max(0.9, E.confidence) : agrees === false ? 0.5 : 0.8;
  } else if (T.facingFlag === false) {
    why.unshift("authored with no front (facing: false)");
  }
  if (E.symmetric && T.declared === null) why.push(`symmetric (${E.symmetry}): no front to find`);
  const toWorld = (y) => {
    if (!T.transform) return { yaw: wrapAngle(y), dir: dirOfYaw(y) };
    const d = dirToWorld({ transform: T.transform }, dirOfYaw(y));
    const h = Math.hypot(d[0], d[2]) || 1;
    return { yaw: Math.atan2(d[0], d[2]), dir: [d[0] / h, 0, d[2] / h] };
  };
  const w = toWorld(local);
  const det = toWorld(E.yaw);
  return {
    yaw: w.yaw, dir: w.dir, confidence,
    declared: T.declared !== null, declaredYaw: T.declared === null ? null : toWorld(T.declared).yaw,
    agrees,
    symmetric: E.symmetric, symmetry: E.symmetry,
    axisYaw: toWorld(E.axisYaw).yaw,
    detected: { yaw: det.yaw, dir: det.dir, confidence: E.confidence },
    local: { yaw: wrapAngle(local), dir: dirOfYaw(local), detectedYaw: E.yaw },
    layers: E.layers,
    why,
  };
}

function frontOffFrom(pos, yaw, eye) {
  return angleBetween(yaw, Math.atan2(eye[0] - pos[0], eye[2] - pos[2]));
}

return { get FEATURES() { return FEATURES; }, get defineFeature() { return defineFeature; }, get USE_CASES() { return USE_CASES; }, get defineUseCase() { return defineUseCase; }, get wordsOf() { return wordsOf; }, get featureOf() { return featureOf; }, get parseFront() { return parseFront; }, get angleBetween() { return angleBetween; }, get frontEvidence() { return frontEvidence; }, get detectFront() { return detectFront; }, get frontOffFrom() { return frontOffFrom; } };
});

__def("src/object/object.js", () => {

const { localToWorld, wrapAngle, worldToLocal } = __mod("src/core/frame.js");
const { createEntity, dirToWorld, toWorld } = __mod("src/scene/entity.js");
const { aabbOf, localAabbOf } = __mod("src/scene/bounds.js");
const { lowest } = __mod("src/scene/kit.js");
const { detectFront, parseFront } = __mod("src/scene/front.js");
const { boxBounds, overTop, toPart } = __mod("src/object/prims.js");
const SOCKET_KINDS = new Set(["top", "seat", "grab", "view", "anchor", "hang", "spawn"]);
const REST_MODES = new Set(["base", "hang", "float"]);


function capsuleCollider({ a, b, r }, mat) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(...d);
  const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const flat = Math.hypot(d[0], d[2]);
  if (L < 1e-9 || flat / (L || 1) < 0.02) return { c, h: [r, Math.abs(d[1]) / 2 + r, r], yaw: 0, mat };
  if (Math.abs(d[1]) / L < 0.02) return { c, h: [r, r, flat / 2 + r], yaw: Math.atan2(d[0], d[2]), mat };
  const bb = [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r];
  return { c: [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2], h: [(bb[3] - bb[0]) / 2, (bb[4] - bb[1]) / 2, (bb[5] - bb[2]) / 2], yaw: 0, mat, approx: true };
}

function collidersFromParts(parts) {
  const out = [];
  for (const p of parts) {
    if (p.collide === false) continue;
    const mat = p.mat ?? 0;
    if (p.prim?.type === "box") out.push({ c: [...p.prim.c], h: [...p.prim.h], yaw: p.prim.yaw ?? 0, mat, part: p.name });
    else if (p.prim?.type === "capsule") out.push({ ...capsuleCollider(p.prim, mat), part: p.name, capsule: true });
    else if (p.collide === "bounds") {
      const b = p.bounds;
      out.push({ c: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], h: [(b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2], yaw: 0, mat, part: p.name });
    }
  }
  return out;
}


function normSocket(name, s) {
  if (!s || !Array.isArray(s.pos) || s.pos.length !== 3) throw new TypeError(`Socket ${name} needs pos [x, y, z].`);
  const kind = s.kind ?? (SOCKET_KINDS.has(name) ? name : "anchor");
  const out = { name, kind, pos: [...s.pos], yaw: s.yaw === undefined ? null : parseFront(s.yaw) };
  if (s.extent) out.extent = [s.extent[0], s.extent[1]]; // (half-extents across x and z of the socket's own frame)
  if (s.normal) out.normal = [...s.normal];
  if (s.meta) out.meta = s.meta;
  return out;
}

function topsOf(parts, colliders = collidersFromParts(parts), { minHalf = 0.03 } = {}) {
  const tops = [];
  for (const b of colliders) {
    if (b.approx || b.capsule || b.h[0] < minHalf || b.h[2] < minHalf) continue;
    const y = b.c[1] + b.h[1];
    const pos = [b.c[0], y, b.c[2]];
    const probe = [b.c[0], y + Math.max(0.01, b.h[1] * 0.05), b.c[2]];
    const covered = parts.some((p) => p.name !== b.part && p.sdf(probe[0], probe[1], probe[2], 0, null) < 0);
    if (covered) continue;
    tops.push({ pos, yaw: b.yaw ?? 0, extent: [b.h[0], b.h[2]], area: 4 * b.h[0] * b.h[2], part: b.part });
  }
  return tops.sort((a, b) => b.area - a.area || b.pos[1] - a.pos[1]);
}


function defineObject({ key, parts, front = null, show = null, tags = [], colliders = null, sockets = {}, rest = "base", rails = [], meta = {} } = {}) {
  if (typeof key !== "string" || !key) throw new TypeError("An object needs a string key.");
  if (!Array.isArray(parts) || !parts.length) throw new TypeError(`Object ${key} needs parts.`);
  if (!REST_MODES.has(rest)) throw new RangeError(`Object ${key}: rest is "base", "hang" or "float".`);
  const ps = parts.map(toPart);
  const cols = (colliders ?? collidersFromParts(ps)).map((b) => ({ c: [...b.c], h: [...b.h], yaw: b.yaw ?? 0, mat: b.mat ?? 0, ...(b.part ? { part: b.part } : {}), ...(b.approx ? { approx: true } : {}), ...(b.capsule ? { capsule: true } : {}) }));
  const local = localAabbOf({ parts: ps });
  const frontYaw = parseFront(front);
  const showYaw = show === null ? frontYaw : parseFront(show);
  const sock = {};
  for (const [name, s] of Object.entries(sockets)) sock[name] = normSocket(name, s);
  if (!sock.top) {
    const t = topsOf(ps, cols)[0];
    if (t) sock.top = { name: "top", kind: "top", pos: t.pos, yaw: t.yaw, extent: t.extent, auto: true };
  }
  if (!sock.view && showYaw !== null) {
    const size = Math.max(local[3] - local[0], local[4] - local[1], local[5] - local[2]);
    const reach = Math.max(Math.abs(local[0]), Math.abs(local[3]), Math.abs(local[2]), Math.abs(local[5]));
    const dist = reach + Math.max(1, size * 1.2);
    const f = [Math.sin(showYaw), Math.cos(showYaw)];
    sock.view = { name: "view", kind: "view", pos: [f[0] * dist, (local[1] + local[4]) / 2, f[1] * dist], yaw: wrapAngle(showYaw + Math.PI), auto: true };
  }
  return {
    kind: "object",
    key,
    parts: ps,
    front: frontYaw,
    show: showYaw,
    tags: [...new Set(tags)].sort(),
    colliders: cols,
    sockets: sock,
    rest,
    rails: rails.map((r) => r.map((p) => [...p])),
    bounds: local,
    meta: { ...meta },
  };
}

const BOTTOMS = new WeakMap();
function bottomOf(def) {
  if (BOTTOMS.has(def)) return BOTTOMS.get(def);
  const allPrims = def.parts.every((p) => p.prim);
  const y = allPrims ? def.bounds[1] : lowest(def.parts);
  BOTTOMS.set(def, y);
  return y;
}


let nextInstance = 1;

function placeObject(def, { pos = [0, 0, 0], yaw = 0, scale = 1, id = null, tags = [] } = {}) {
  if (!def || def.kind !== "object") throw new TypeError("placeObject needs a definition from defineObject.");
  const e = createEntity({
    id: id ?? `${def.key}#${nextInstance++}`,
    transform: { pos, yaw: wrapAngle(yaw), scale },
    parts: def.parts,
    tags: [...def.tags, ...tags],
    components: { object: { key: def.key } },
  });
  return { ...e, def, key: def.key };
}

const movedObject = (inst, patch) => placeObject(inst.def, { pos: inst.transform.pos, yaw: inst.transform.yaw, scale: inst.transform.scale, id: inst.id, ...patch });

const worldAabb = (inst) => aabbOf(inst);
const localAabb = (inst) => (inst.def ?? inst).bounds;

function footprint(inst) {
  const b = inst.def.bounds;
  const { pos, yaw, scale } = inst.transform;
  const corners = [[b[0], b[2]], [b[3], b[2]], [b[3], b[5]], [b[0], b[5]]].map(([x, z]) => {
    const w = localToWorld(pos, yaw, [x * scale, 0, z * scale]);
    return [w[0], w[2]];
  });
  const xs = corners.map((c) => c[0]);
  const zs = corners.map((c) => c[1]);
  return { corners, rect: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
}

function colliderToWorld(inst, b) {
  const { pos, yaw, scale } = inst.transform;
  return {
    c: localToWorld(pos, yaw, [b.c[0] * scale, b.c[1] * scale, b.c[2] * scale]),
    h: [b.h[0] * scale, b.h[1] * scale, b.h[2] * scale],
    yaw: wrapAngle(yaw + (b.yaw ?? 0)),
    mat: b.mat ?? 0,
  };
}

const worldColliders = (inst) => inst.def.colliders.map((b) => colliderToWorld(inst, b));

const worldRails = (inst) => inst.def.rails.map((r) => r.map((p) => toWorld(inst, p)));

function socketOf(inst, name) {
  const s = inst.def.sockets[name];
  if (!s) return null;
  const { yaw, scale } = inst.transform;
  const out = { ...s, pos: toWorld(inst, s.pos) };
  if (s.yaw !== null && s.yaw !== undefined) {
    out.yaw = wrapAngle(s.yaw + yaw);
    out.dir = [Math.sin(out.yaw), 0, Math.cos(out.yaw)];
  }
  if (s.extent) out.extent = [s.extent[0] * scale, s.extent[1] * scale];
  if (s.normal) out.normal = dirToWorld(inst, s.normal);
  return out;
}

function worldSockets(inst) {
  const out = {};
  for (const name of Object.keys(inst.def.sockets)) out[name] = socketOf(inst, name);
  return out;
}

const socketsOfKind = (inst, kind) => Object.values(worldSockets(inst)).filter((s) => s.kind === kind);

function onSocket(inst, name, p, tol = 0.02) {
  const s = socketOf(inst, name);
  if (!s || !s.extent) return false;
  const l = worldToLocal(s.pos, s.yaw ?? 0, p);
  return Math.abs(l[0]) <= s.extent[0] && Math.abs(l[2]) <= s.extent[1] && Math.abs(l[1]) <= tol;
}


const frontOfObject = (thing, opts = {}) => detectFront(thing, opts);

function yawToShow(def, pos, target) {
  const side = def.show ?? def.front ?? 0;
  return wrapAngle(Math.atan2(target[0] - pos[0], target[2] - pos[2]) - side);
}


function supportBoxes(supports) {
  const out = [];
  for (const s of supports) {
    if (typeof s === "number") out.push({ plane: s, from: "floor" });
    else if (s && typeof s.y === "number" && !s.c) out.push({ plane: s.y, from: s.name ?? "floor" });
    else if (s && s.def && s.transform) for (const b of worldColliders(s)) out.push({ box: b, from: s.id });
    else if (s && s.c && s.h) out.push({ box: { c: s.c, h: s.h, yaw: s.yaw ?? 0 }, from: s.name ?? "box" });
    else throw new TypeError("A support is an object instance, a box { c, h, yaw }, a number or { y }.");
  }
  return out;
}

function contactPoints(inst, n = 5) {
  const def = inst.def;
  const low = bottomOf(def);
  const size = Math.max(def.bounds[4] - def.bounds[1], 1e-6);
  const feet = def.parts.filter((p) => p.bounds[1] <= low + size * 0.05 + 1e-6);
  const pts = [];
  for (const p of feet) {
    const b = p.bounds;
    for (let i = 0; i < n; i += 1) for (let k = 0; k < n; k += 1) {
      const x = b[0] + ((b[3] - b[0]) * (i + 0.5)) / n;
      const z = b[2] + ((b[5] - b[2]) * (k + 0.5)) / n;
      if (p.sdf(x, low + size * 0.06, z, 0, null) > size * 0.03) continue;
      pts.push(toWorld(inst, [x, low, z]));
    }
  }
  if (!pts.length) pts.push(toWorld(inst, [0, low, 0]));
  return pts;
}

function settle(inst, supports, { stepUp = 0.05, maxDrop = Infinity, minCover = 0.25 } = {}) {
  const S = supportBoxes(supports.filter((s) => s !== inst && !(s && s.id !== undefined && s.id === inst.id)));
  const bottom = inst.transform.pos[1] + bottomOf(inst.def) * inst.transform.scale;
  const pts = contactPoints(inst);
  let best = null;
  const offer = (top, from, covered) => {
    const cover = covered / pts.length;
    if (cover < minCover) return;
    if (top > bottom + stepUp || bottom - top > maxDrop) return;
    if (!best || top > best.top) best = { top, from, cover };
  };
  for (const s of S) {
    if (s.plane !== undefined) { offer(s.plane, s.from, pts.length); continue; }
    const top = s.box.c[1] + s.box.h[1];
    offer(top, s.from, pts.filter((p) => overTop(p, s.box)).length);
  }
  if (!best) return { instance: inst, gap: null, support: null, cover: 0, rests: inst.def.rest !== "base" };
  const gap = bottom - best.top;
  const pos = [inst.transform.pos[0], inst.transform.pos[1] - gap, inst.transform.pos[2]];
  return { instance: movedObject(inst, { pos }), gap, support: best.from, cover: best.cover, rests: true };
}

function restsOn(inst, support, { tol = 1e-3, minCover = 0.25 } = {}) {
  const bottom = inst.transform.pos[1] + bottomOf(inst.def) * inst.transform.scale;
  const pts = contactPoints(inst);
  for (const s of supportBoxes([support])) {
    if (s.plane !== undefined) { if (Math.abs(bottom - s.plane) <= tol) return true; continue; }
    const top = s.box.c[1] + s.box.h[1];
    if (Math.abs(bottom - top) <= tol && pts.filter((p) => overTop(p, s.box)).length / pts.length >= minCover) return true;
  }
  return false;
}


const matIndex = (m, mats) => (typeof m === "number" ? m : mats && m in mats ? mats[m] : 0);

function bakeForRenderer(instances, { mats = null, bounds = false } = {}) {
  const boxes = [];
  const capsules = [];
  const skipped = [];
  for (const inst of instances) {
    const { scale } = inst.transform;
    for (const p of inst.def.parts) {
      if (p.render === false) continue;
      const mat = matIndex(p.mat, mats);
      if (p.prim?.type === "box") boxes.push({ ...colliderToWorld(inst, p.prim), mat });
      else if (p.prim?.type === "capsule") capsules.push({ a: toWorld(inst, p.prim.a), b: toWorld(inst, p.prim.b), r: p.prim.r * scale, mat });
      else if (bounds) {
        const b = p.bounds;
        boxes.push({ ...colliderToWorld(inst, { c: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], h: [(b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2], yaw: 0 }), mat });
      } else skipped.push({ id: inst.id, part: p.name });
    }
  }
  return { boxes, capsules, skipped };
}

function bakeForPhysics(instances, { mats = null } = {}) {
  const boxes = [];
  const rails = [];
  for (const inst of instances) {
    for (const b of worldColliders(inst)) boxes.push({ ...b, mat: matIndex(b.mat, mats) });
    rails.push(...worldRails(inst));
  }
  return { boxes, rails };
}


return { get boxBounds() { return boxBounds; }, get collidersFromParts() { return collidersFromParts; }, get topsOf() { return topsOf; }, get defineObject() { return defineObject; }, get bottomOf() { return bottomOf; }, get placeObject() { return placeObject; }, get movedObject() { return movedObject; }, get worldAabb() { return worldAabb; }, get localAabb() { return localAabb; }, get footprint() { return footprint; }, get colliderToWorld() { return colliderToWorld; }, get worldColliders() { return worldColliders; }, get worldRails() { return worldRails; }, get socketOf() { return socketOf; }, get worldSockets() { return worldSockets; }, get socketsOfKind() { return socketsOfKind; }, get onSocket() { return onSocket; }, get frontOfObject() { return frontOfObject; }, get yawToShow() { return yawToShow; }, get settle() { return settle; }, get restsOn() { return restsOn; }, get bakeForRenderer() { return bakeForRenderer; }, get bakeForPhysics() { return bakeForPhysics; } };
});

__def("src/object/catalogue.js", () => {

const { createRegistry, defaultRegistry } = __mod("src/scene/registry.js");
const { createRoll, stream } = __mod("src/core/rng.js");
const { defineObject } = __mod("src/object/object.js");
const pick = (S, given, a, b) => { const v = S.between(a, b); return given ?? v; };
const pickInt = (S, given, a, b) => { const v = S.int(a, b); return given ?? v; };
const chance = (S, given, p) => { const v = S.chance(p); return given ?? v; };

const bx = (name, c, h, extra = {}) => ({ box: { c, h, yaw: extra.yaw ?? 0 }, name, mat: extra.mat ?? "wall", ...extra });
const cap = (name, a, b, r, extra = {}) => ({ capsule: { a, b, r }, name, mat: extra.mat ?? "metal", ...extra });


function pillar(S, ctx = {}) {
  const w = pick(S, ctx.w, 0.6, 3.5);
  const d = pick(S, ctx.d, 0.6, 3.5);
  const h = pick(S, ctx.h, 3, 12);
  const sink = ctx.sink ?? 0;
  return defineObject({
    key: "pillar", tags: ["level", "solid", "wallrun"], front: "+z",
    parts: [bx("pillar", [0, (h - sink) / 2, 0], [w / 2, (h + sink) / 2, d / 2])],
    sockets: { face: { kind: "anchor", pos: [0, h / 2, d / 2], yaw: 0, normal: [0, 0, 1] } },
    meta: { w, d, h },
  });
}

function wall(S, ctx = {}) {
  const length = pick(S, ctx.length, 4, 20);
  const h = pick(S, ctx.h, 3, 12);
  const thick = pick(S, ctx.thick, 0.3, 0.7);
  const sink = ctx.sink ?? 0;
  return defineObject({
    key: "wall", tags: ["level", "solid", "wallrun", "runnable"], front: "+z",
    parts: [bx("wall", [0, (h - sink) / 2, 0], [length / 2, (h + sink) / 2, thick / 2])],
    sockets: {
      runFront: { kind: "anchor", pos: [0, h * 0.35, thick / 2], yaw: Math.PI / 2, normal: [0, 0, 1], extent: [length / 2, 0] },
      runBack: { kind: "anchor", pos: [0, h * 0.35, -thick / 2], yaw: Math.PI / 2, normal: [0, 0, -1], extent: [length / 2, 0] },
    },
    meta: { length, h, thick },
  });
}

function pad(S, ctx = {}) {
  const w = pick(S, ctx.w, 2.5, 8);
  const d = pick(S, ctx.d, 2.5, 8);
  const h = pick(S, ctx.h, 0.2, 0.6);
  const sink = ctx.sink ?? 0;
  const lip = chance(S, ctx.lip, 0.4);
  const parts = [bx("pad", [0, (h - sink) / 2, 0], [w / 2, (h + sink) / 2, d / 2], { mat: "floor" })];
  if (lip) parts.push(bx("lip", [0, h + 0.04, d / 2 - 0.1], [w / 2, 0.04, 0.1], { mat: "trim", collide: false }));
  return defineObject({
    key: "pad", tags: ["level", "floor", "wallrun"], front: "+z", parts,
    sockets: {
      top: { kind: "top", pos: [0, h, 0], yaw: 0, extent: [w / 2, d / 2] },
      spawn: { kind: "spawn", pos: [0, h, 0], yaw: 0 },
    },
    meta: { w, d, h },
  });
}

function ramp(S, ctx = {}) {
  const w = pick(S, ctx.w, 1.5, 4);
  const length = pick(S, ctx.length, 3, 9);
  const h = pick(S, ctx.h, 0.6, 2.5);
  const steps = ctx.steps ?? Math.max(4, Math.ceil(h / 0.1));
  const parts = [];
  const run = length / steps;
  for (let i = 0; i < steps; i += 1) {
    const top = (h * (i + 1)) / steps;
    parts.push(bx(`slab${i}`, [0, top / 2, length / 2 - run * (i + 0.5)], [w / 2, top / 2, run / 2], { mat: "floor" }));
  }
  return defineObject({
    key: "ramp", tags: ["level", "floor", "wallrun"], front: "+z", parts,
    sockets: {
      foot: { kind: "anchor", pos: [0, 0, length / 2], yaw: Math.PI }, // (standing at the foot, facing up it)
      top: { kind: "top", pos: [0, h, -length / 2 + run / 2], yaw: 0, extent: [w / 2, run / 2] },
    },
    meta: { w, length, h, steps },
  });
}

function stairs(S, ctx = {}) {
  const w = pick(S, ctx.w, 1.2, 3);
  const steps = pickInt(S, ctx.steps, 4, 12);
  const rise = pick(S, ctx.rise, 0.15, 0.22);
  const tread = pick(S, ctx.tread, 0.25, 0.35);
  const length = steps * tread;
  const parts = [];
  for (let i = 0; i < steps; i += 1) {
    const top = rise * (i + 1);
    parts.push(bx(`step${i}`, [0, top / 2, length / 2 - tread * (i + 0.5)], [w / 2, top / 2, tread / 2], { mat: "floor" }));
  }
  return defineObject({
    key: "stairs", tags: ["level", "floor"], front: "+z", parts,
    sockets: {
      foot: { kind: "anchor", pos: [0, 0, length / 2 + 0.2], yaw: Math.PI },
      top: { kind: "top", pos: [0, rise * steps, -length / 2 + tread / 2], yaw: 0, extent: [w / 2, tread / 2] },
    },
    meta: { w, steps, rise, tread },
  });
}

function rail(S, ctx = {}) {
  const length = pick(S, ctx.length, 10, 26);
  const sgn = S.chance(0.5) ? -1 : 1;
  const bend = pick(S, ctx.bend, 0, 7) * (ctx.bend === undefined ? sgn : 1);
  const rise = pick(S, ctx.rise, 0, 1.6);
  const y0 = ctx.y ?? 0.8;
  const n = ctx.segments ?? 12;
  const r = ctx.r ?? 0.07;
  const ease = (ctx.shape ?? "ease") === "ease";
  const line = [];
  for (let k = 0; k <= n; k += 1) {
    const t = k / n;
    const k2 = ease ? Math.sin(Math.PI * t) ** 2 : Math.sin(Math.PI * t);
    line.push([bend * k2, y0 + rise * k2, length * t]);
  }
  const parts = [];
  for (let i = 0; i < n; i += 1) parts.push(cap(`bar${i}`, line[i], line[i + 1], r, { mat: "rail", collide: false }));
  const posts = ctx.posts ?? true;
  if (posts) for (let i = 0; i <= n; i += 3) parts.push(cap(`post${i}`, [line[i][0], 0.03, line[i][2]], [line[i][0], line[i][1] - r, line[i][2]], r * 0.6, { mat: "metal", collide: false }));
  const tan = (i, j) => Math.atan2(line[j][0] - line[i][0], line[j][2] - line[i][2]);
  return defineObject({
    key: "rail", tags: ["level", "rail", "wallrun"], front: "+z", parts, rails: [line],
    sockets: {
      start: { kind: "anchor", pos: line[0], yaw: tan(0, 1) },
      end: { kind: "anchor", pos: line[n], yaw: tan(n - 1, n) },
    },
    meta: { length, bend, rise },
  });
}

function arch(S, ctx = {}) {
  const span = pick(S, ctx.span, 2, 5);
  const h = pick(S, ctx.h, 2.5, 5);
  const thick = pick(S, ctx.thick, 0.4, 0.9);
  const post = pick(S, ctx.post, 0.4, 0.8);
  const lintel = post * 0.8;
  return defineObject({
    key: "arch", tags: ["level", "solid"], front: "+z",
    parts: [
      bx("post", [-(span / 2 + post / 2), h / 2, 0], [post / 2, h / 2, thick / 2]),
      bx("post", [span / 2 + post / 2, h / 2, 0], [post / 2, h / 2, thick / 2]),
      bx("lintel", [0, h + lintel / 2, 0], [span / 2 + post, lintel / 2, thick / 2]),
    ],
    sockets: {
      entry: { kind: "anchor", pos: [0, 0, thick / 2 + 0.5], yaw: Math.PI }, // (standing before it, facing through)
      exit: { kind: "anchor", pos: [0, 0, -thick / 2 - 0.5], yaw: Math.PI },
    },
    meta: { span, h, thick },
  });
}

function tunnel(S, ctx = {}) {
  const length = pick(S, ctx.length, 8, 16);
  const span = pick(S, ctx.span, 3, 6);
  const h = pick(S, ctx.h, 3, 5);
  const thick = pick(S, ctx.thick, 0.4, 0.7);
  const roof = pick(S, ctx.roof, 0.3, 0.6);
  const floor = chance(S, ctx.floor, 0.5);
  const parts = [
    bx("wall", [-(span / 2 + thick / 2), h / 2, 0], [thick / 2, h / 2, length / 2]),
    bx("wall", [span / 2 + thick / 2, h / 2, 0], [thick / 2, h / 2, length / 2]),
    bx("roof", [0, h + roof / 2, 0], [span / 2 + thick, roof / 2, length / 2]),
  ];
  if (floor) parts.push(bx("floor", [0, -0.15, 0], [span / 2, 0.15, length / 2], { mat: "floor" }));
  return defineObject({
    key: "tunnel", tags: ["level", "solid", "wallrun"], front: "+z", parts,
    sockets: {
      entry: { kind: "anchor", pos: [0, 0, length / 2 + 0.5], yaw: Math.PI },
      exit: { kind: "anchor", pos: [0, 0, -length / 2 - 0.5], yaw: Math.PI },
      runLeft: { kind: "anchor", pos: [-span / 2, h * 0.4, 0], yaw: Math.PI, normal: [1, 0, 0], extent: [0, length / 2] },
      runRight: { kind: "anchor", pos: [span / 2, h * 0.4, 0], yaw: Math.PI, normal: [-1, 0, 0], extent: [0, length / 2] },
    },
    meta: { length, span, h },
  });
}

function crate(S, ctx = {}) {
  const s = pick(S, ctx.size, 0.5, 1.2);
  const tall = s * pick(S, ctx.tall, 0.8, 1.2);
  const band = s * 0.06;
  const parts = [bx("crate", [0, tall / 2, 0], [s / 2, tall / 2, s / 2], { mat: "wood" })];
  for (const y of [tall * 0.15, tall * 0.85]) {
    parts.push(bx("band", [0, y, 0], [s / 2 + 0.01, band / 2, s / 2 + 0.01], { mat: "metal", collide: false }));
  }
  parts.push(bx("label", [0, tall * 0.5, s / 2 + 0.008], [s * 0.3, tall * 0.18, 0.008], { mat: "paint", collide: false }));
  return defineObject({
    key: "crate", tags: ["prop", "solid", "movable"], front: "+z", parts,
    sockets: {
      grabLeft: { kind: "grab", pos: [-s / 2, tall * 0.6, 0], yaw: -Math.PI / 2 },
      grabRight: { kind: "grab", pos: [s / 2, tall * 0.6, 0], yaw: Math.PI / 2 },
    },
    meta: { size: s, tall },
  });
}

function bench(S, ctx = {}) {
  const w = pick(S, ctx.w, 1.2, 2.4);
  const seatH = pick(S, ctx.seatH, 0.4, 0.5);
  const seatD = pick(S, ctx.seatD, 0.38, 0.5);
  const hasBack = chance(S, ctx.back, 0.75);
  const backH = pick(S, ctx.backH, 0.35, 0.55);
  const slab = 0.05;
  const leg = 0.05;
  const parts = [bx("seat", [0, seatH - slab / 2, 0], [w / 2, slab / 2, seatD / 2], { mat: "wood" })];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(bx("leg", [sx * (w / 2 - leg * 2), (seatH - slab) / 2, sz * (seatD / 2 - leg * 1.5)], [leg / 2, (seatH - slab) / 2, leg / 2], { mat: "metal" }));
  }
  if (hasBack) {
    const zb = -seatD / 2 + 0.03;
    parts.push(bx("backrest", [0, seatH + backH / 2 + 0.04, zb], [w / 2, backH / 2, 0.03], { mat: "wood" }));
    for (const sx of [-1, 1]) parts.push(bx("strut", [sx * (w / 2 - leg * 2), seatH + 0.02, zb], [leg / 2, 0.05, leg / 2], { mat: "metal" }));
  }
  return defineObject({
    key: "bench", tags: ["prop", "seat"], front: "+z", parts,
    sockets: {
      seat: { kind: "seat", pos: [0, seatH, hasBack ? 0.05 : 0], yaw: 0, extent: [w / 2 - 0.1, seatD / 2 - 0.05] },
      seatLeft: { kind: "seat", pos: [-w / 4, seatH, hasBack ? 0.05 : 0], yaw: 0 },
      seatRight: { kind: "seat", pos: [w / 4, seatH, hasBack ? 0.05 : 0], yaw: 0 },
    },
    meta: { w, seatH, hasBack },
  });
}

function sign(S, ctx = {}) {
  const w = pick(S, ctx.w, 1, 3.2);
  const h = pick(S, ctx.h, 0.6, 1.8);
  const lift = pick(S, ctx.lift, 0.8, 2.2);
  const board = 0.08;
  const twoPosts = chance(S, ctx.twoPosts, 0.6);
  const glow = chance(S, ctx.glow, 0.5);
  const parts = [bx("panel", [0, lift + h / 2, 0], [w / 2, h / 2, board / 2], { mat: "metal" })];
  parts.push(bx(glow ? "screen" : "display", [0, lift + h / 2, board / 2 + 0.01], [w / 2 - 0.06, h / 2 - 0.06, 0.012], { mat: glow ? "glow" : "paint", collide: false }));
  const pz = -board / 2 - 0.05;
  const posts = twoPosts ? [-w / 2 + 0.12, w / 2 - 0.12] : [0];
  for (const x of posts) parts.push(cap("post", [x, 0.05, pz], [x, lift + h * 0.9, pz], 0.05, { mat: "metal" }));
  parts.push(bx("stand", [0, 0.04, pz - 0.1], [twoPosts ? w / 2 - 0.05 : 0.3, 0.04, 0.2], { mat: "metal" }));
  return defineObject({
    key: "sign", tags: ["prop", "display"], front: "+z", parts,
    sockets: { face: { kind: "anchor", pos: [0, lift + h / 2, board / 2 + 0.02], yaw: 0, normal: [0, 0, 1], extent: [w / 2 - 0.06, 0] } },
    meta: { w, h, lift, glow },
  });
}

function lampPost(S, ctx = {}) {
  const h = pick(S, ctx.h, 3, 5.5);
  const reach = pick(S, ctx.reach, 0.6, 1.4);
  const r = pick(S, ctx.r, 0.06, 0.1);
  const parts = [
    bx("base", [0, 0.1, 0], [r * 3, 0.1, r * 3], { mat: "metal" }),
    cap("pole", [0, 0.2, 0], [0, h, 0], r, { mat: "metal" }),
    cap("arm", [0, h, 0], [0, h, reach], r * 0.7, { mat: "metal", collide: false }),
    bx("head", [0, h - 0.12, reach], [0.18, 0.1, 0.22], { mat: "metal", collide: false }),
    bx("bulb", [0, h - 0.25, reach], [0.1, 0.04, 0.12], { mat: "glow", collide: false }),
  ];
  return defineObject({
    key: "lampPost", tags: ["prop", "light"], front: "+z", parts,
    sockets: { light: { kind: "anchor", pos: [0, h - 0.3, reach], yaw: 0, normal: [0, -1, 0] } },
    meta: { h, reach },
  });
}


const PIECES = [
  ["pillar", 3, "level", pillar],
  ["wall", 3, "level", wall],
  ["pad", 3, "level", pad],
  ["ramp", 1, "level", ramp],
  ["stairs", 1, "level", stairs],
  ["rail", 2, "level", rail],
  ["arch", 1, "level", arch],
  ["tunnel", 1, "level", tunnel],
  ["crate", 2, "prop", crate],
  ["bench", 2, "prop", bench],
  ["sign", 2, "prop", sign],
  ["lampPost", 2, "prop", lampPost],
];
const PIECE_KEYS = PIECES.map(([k]) => k);

function registerCatalogue(registry = defaultRegistry, realmName = "Objects") {
  const realm = registry.defineRealm(realmName);
  for (const [key, weight, role, build] of PIECES) if (!realm.get(key)) realm.add({ key, weight, role, build });
  return realm;
}

const OWN = createRegistry();
registerCatalogue(OWN);

function buildPiece(key, seed, ctx = {}) {
  if (!PIECE_KEYS.includes(key)) throw new RangeError(`No piece ${key}. Pieces: ${PIECE_KEYS.join(", ")}.`);
  return OWN.makeAsset(seed, { realm: "Objects", key, ctx });
}

function buildPieceFrom(key, S, ctx = {}) {
  const e = PIECES.find(([k]) => k === key);
  if (!e) throw new RangeError(`No piece ${key}.`);
  const def = e[3](S, ctx);
  return def;
}

const pieceStream = (seed, slot = 1) => stream(createRoll(seed), slot);

return { get PIECES() { return PIECES; }, get PIECE_KEYS() { return PIECE_KEYS; }, get registerCatalogue() { return registerCatalogue; }, get buildPiece() { return buildPiece; }, get buildPieceFrom() { return buildPieceFrom; }, get pieceStream() { return pieceStream; } };
});

__def("projects/wallrun/seed.js", () => {
function hash(text) { let h = 2166136261; for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; }
function streamOf(text) {
  let a = hash(String(text)) || 1;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const weighted = (l) => { let s = 0; for (const [, w] of l) s += w; let r = f() * s; for (const [v, w] of l) { if ((r -= w) < 0) return v; } return l[l.length - 1][0]; };
  return { f, between: (x, y) => x + (y - x) * f(), int: (x, y) => x + Math.floor(f() * (y - x + 1)), pick: (l) => l[Math.floor(f() * l.length)], chance: (p) => f() < p, weighted };
}

return { get streamOf() { return streamOf; } };
});

__def("projects/wallrun/level.js", () => {

const { buildPieceFrom } = __mod("src/object/catalogue.js");
const { bakeForPhysics, bakeForRenderer, footprint, placeObject, settle, yawToShow } = __mod("src/object/object.js");
const { streamOf } = __mod("projects/wallrun/seed.js");
const PIECE_MATS = { wall: 0, floor: 1, trim: 0, rail: 2, metal: 2, dark: 3, wood: 14, paint: 8, glow: 15 };
const SINK = 3; // (everything stands in the water this deep)

function levelOf(seed) {
  const S = streamOf(`${seed}|level`);
  const P = streamOf(`${seed}|pieces`); // (the pieces' own draws; every size given here overrides them)
  const objects = [];
  const route = []; // { p: [x, y, z], act: "run" | "jump" | "wall" | "rail" }
  const top = 0.35; // (pads stand this far out of the water)
  const put = (key, ctx, pos, yaw = 0) => { const o = placeObject(buildPieceFrom(key, P, ctx), { pos, yaw, id: `${key}${objects.length}` }); objects.push(o); return o; };
  const floor = (x0, x1, z0, z1, y = top) => put("pad", { w: x1 - x0, d: z1 - z0, h: y + SINK, lip: false }, [(x0 + x1) / 2, -SINK, (z0 + z1) / 2]);
  const wall = (x, z0, z1, h, thick = 0.5) => put("wall", { length: z1 - z0, h: h + SINK, thick }, [x, -SINK, (z0 + z1) / 2], Math.PI / 2);
  const pillar = (x, z, w, d, h) => put("pillar", { w, d, h: h + SINK }, [x, -SINK, z]);

  floor(-7, 7, -8, 12);
  for (let i = 0; i < 7; i += 1) {
    const side = i % 2 ? 1 : -1;
    pillar(side * S.between(8, 16), S.between(-10, 20), S.between(0.6, 3.5), S.between(3, 10), S.between(6, 13));
  }
  pillar(S.between(-3, 3), -9, S.between(4, 8), 0.6, S.between(6, 10));
  route.push({ p: [0, top, -4], act: "run" }, { p: [0, top, 10], act: "run" });
  let z = 12;

  const cw = S.between(2.6, 3.4);
  const clen = S.between(15, 21);
  const side = S.pick([-1, 1]);
  wall(-cw, z - 1, z + clen, S.between(8, 12));
  wall(cw, z - 1, z + clen + 1, S.between(8, 12));
  route.push(
    { p: [side * (cw - 0.7), top + 1.2, z + 2], act: "wall" }, { p: [side * (cw - 0.7), top + 1.2, z + clen * 0.45], act: "wall" },
    { p: [-side * (cw - 0.7), top + 1.2, z + clen * 0.62], act: "wall" }, { p: [-side * (cw - 0.7), top + 1, z + clen - 1], act: "wall" },
  );
  z += clen;
  floor(-4.5, 4.5, z, z + 9);
  route.push({ p: [0, top, z + 3], act: "run" });
  pillar(-6.5, z + 4, 1.2, 7, S.between(7, 11));
  z += 9;

  const rlen = S.between(18, 26);
  const bend = S.pick([-1, 1]) * S.between(3, 7);
  const rise = S.between(0.4, 1.6);
  const railObj = put("rail", { length: rlen, bend, rise, y: 1.15, segments: 12, shape: "ease" }, [0, 0, z + 1.5]);
  const rail = railObj.def.rails[0].map((p) => [p[0], p[1], p[2] + z + 1.5]);
  route.push({ p: [0, top, z - 1.5], act: "jump" }, { p: rail[1], act: "rail" }, { p: rail[rail.length - 2], act: "rail" });
  z += rlen + 3;
  floor(-3.5, 3.5, z, z + 7);
  route.push({ p: [0, top, z + 3.5], act: "run" });
  z += 7;

  const hops = S.int(3, 5);
  let x = 0;
  for (let i = 0; i < hops; i += 1) {
    const gap = S.between(2.2, 3.4);
    const w = S.between(2.6, 3.6);
    const y = top + S.between(-0.1, 0.9);
    x = Math.max(-5, Math.min(5, x + S.between(-2.5, 2.5)));
    z += gap;
    floor(x - w / 2, x + w / 2, z, z + w, y);
    route.push({ p: [x, y, z - 0.6], act: "jump" }, { p: [x, y, z + w / 2], act: "run" });
    z += w;
  }

  z += 2.5;
  const tlen = S.between(11, 16);
  const tx = x;
  floor(tx - 3.2, tx + 3.2, z - 2.8, z + tlen);
  put("tunnel", { length: tlen, span: 4.9, h: 3.35 + SINK, thick: 0.5, roof: 0.7, floor: false }, [tx, -SINK, z + tlen / 2], Math.PI);
  route.push({ p: [tx, top, z - 1.5], act: "run" }, { p: [tx, top, z + tlen / 2], act: "run" }, { p: [tx * 0.5, top, z + tlen], act: "run" });
  z += tlen;

  const plaza = floor(-10, 10, z, z + 16);
  for (let i = 0; i < 5; i += 1) pillar(S.pick([-1, 1]) * S.between(11, 18), z + S.between(0, 16), S.between(0.6, 3), S.between(3, 9), S.between(6, 12));
  route.push({ p: [0, top, z + 12], act: "run" });
  dressPlaza(`${seed}|props`, objects, plaza, [0, top, z], P);

  const { boxes, rails } = bakeForPhysics(objects, { mats: PIECE_MATS });
  const { capsules } = bakeForRenderer(objects, { mats: PIECE_MATS });
  return { objects, boxes, rails, capsules, route, waterY: 0, spawn: [0, top + 0.1, -5], end: z + 16 };
}

function dressPlaza(seed, objects, plaza, [cx, top, z0], P) {
  const S = streamOf(seed);
  const comer = [cx, top + 1.2, z0 - 2]; // (where a runner comes out of the tunnel: what's shown faces them)
  const place = (key, ctx, x, z, yaw = null) => {
    const def = buildPieceFrom(key, P, ctx);
    const pos = [x, top + 2, z];
    const { instance: inst, rests } = settle(placeObject(def, { pos, yaw: yaw ?? yawToShow(def, pos, comer), id: `${key}${objects.length}` }), [plaza]);
    if (!rests) return null;
    const f = footprint(inst).rect;
    if (objects.some((o) => o !== plaza && o.def.tags.includes("prop") && overlapXZ(f, footprint(o).rect))) return null;
    objects.push(inst);
    return inst;
  };
  for (const sx of [-1, 1]) if (S.chance(0.85)) place("lampPost", {}, sx * S.between(5, 8), z0 + S.between(2, 13), sx > 0 ? -Math.PI / 2 : Math.PI / 2);
  for (let i = 0; i < S.int(1, 2); i += 1) place("bench", {}, S.pick([-1, 1]) * S.between(4.5, 8.5), z0 + S.between(4, 14));
  if (S.chance(0.7)) place("sign", {}, S.pick([-1, 1]) * S.between(4.5, 7), z0 + S.between(6, 12));
  for (let i = 0; i < S.int(1, 4); i += 1) place("crate", {}, S.pick([-1, 1]) * S.between(4.5, 9.5), z0 + S.between(1, 15), S.between(0, Math.PI));
}

const overlapXZ = (a, b) => a[0] < b[2] + 0.3 && a[2] > b[0] - 0.3 && a[1] < b[3] + 0.3 && a[3] > b[1] - 0.3; // (rects [x0, z0, x1, z1], a hand apart)

return { get PIECE_MATS() { return PIECE_MATS; }, get levelOf() { return levelOf; } };
});

__def("projects/wallrun/palette.js", () => {

const { streamOf } = __mod("projects/wallrun/seed.js");
function oklchToRgb(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((v) => { const c = Math.max(0, Math.min(1, v)); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)); });
}
function ramp(n, h, C, L0, L1, turn = 0) {
  return Array.from({ length: n }, (_, i) => { const k = i / (n - 1); return oklchToRgb(L0 + (L1 - L0) * k, C * Math.sin(Math.PI * (0.15 + 0.7 * k)), h + turn * (k - 0.5)); });
}

const rampAround = ([L, C, h], n = 5) => ramp(n, h, Math.max(C, 0.02), Math.max(0.12, L - 0.42), Math.min(0.98, L + 0.16), 12);

function paletteOf(seed, wear = null) {
  const S = streamOf(`${seed}|palette`);
  const jacketHue = S.pick([165, 180, 200, 140, 25, 300, 260]);
  const packHue = (jacketHue + S.pick([150, 180, 200])) % 360;
  const furHue = S.pick([80, 60, 30, 250]);
  const list = {
    stone: ramp(8, 250 + S.between(-20, 20), 0.018, 0.16, 0.86, 10),
    rail: ramp(5, 230, 0.03, 0.3, 0.92),
    dark: ramp(3, 280, 0.02, 0.08, 0.3),
    water: ramp(8, 172 + S.between(-10, 10), 0.13, 0.12, 0.93, -20),
    sky: ramp(6, 45 + S.between(-15, 15), 0.035, 0.08, 0.7, 20),
    fur: ramp(5, furHue, 0.03, 0.55, 0.98),
    jacket: ramp(5, jacketHue, 0.12, 0.3, 0.8, 15),
    pack: ramp(5, packHue, 0.12, 0.28, 0.72, 15),
    blush: ramp(4, 15, 0.1, 0.5, 0.85),
    spark: ramp(5, 40, 0.19, 0.55, 0.97, 60),
    wood: ramp(5, 55 + S.between(-10, 10), 0.07, 0.25, 0.7, 10),
    glow: ramp(4, 70, 0.12, 0.7, 0.98, 20),
  };
  if (wear) {
    list.fur = rampAround(wear.fur);
    list.jacket = rampAround(wear.cloth);
    list.pack = rampAround(wear.accent);
    list.blush = rampAround(wear.blush, 4);
    list.furAlt = rampAround(wear.furAlt);
    list.clothAlt = rampAround(wear.clothAlt);
    list.hair = rampAround(wear.hair);
  }
  const colours = [];
  const ramps = {};
  for (const [name, r] of Object.entries(list)) { ramps[name] = [colours.length, r.length]; colours.push(...r); }
  return { colours, ramps };
}

const MATERIALS = [
  { ramp: "stone", light: 1, pattern: 1 }, // 0 walls
  { ramp: "stone", light: 0.9, pattern: 1 }, // 1 floors and platforms
  { ramp: "rail", light: 1, glow: 0.1 }, // 2 rails
  { ramp: "dark", light: 0.8 }, // 3 eyes, soles
  { ramp: "water" }, // 4 water
  { ramp: "sky" }, // 5 sky
  { ramp: "fur", light: 1.1 }, // 6 head, hood
  { ramp: "jacket", light: 1 }, // 7 jacket, sleeves
  { ramp: "pack", light: 1 }, // 8 pack
  { ramp: "blush", light: 1 }, // 9 inner ears, nose
  { ramp: "spark", light: 1, glow: 0.4 }, // 10 sparks
  { ramp: "furAlt", light: 1.1 }, // 11 muzzle, socks, tail tip
  { ramp: "clothAlt", light: 1 }, // 12 trousers
  { ramp: "hair", light: 1 }, // 13 hair
  { ramp: "wood", light: 1 }, // 14 benches, crates
  { ramp: "glow", light: 0.6, glow: 0.5 }, // 15 lamps, lit signs
];
const RUNNER_MATERIALS = { dark: 3, fur: 6, cloth: 7, accent: 8, blush: 9, furAlt: 11, clothAlt: 12, hair: 13 };

return { get paletteOf() { return paletteOf; }, get MATERIALS() { return MATERIALS; }, get RUNNER_MATERIALS() { return RUNNER_MATERIALS; } };
});

__def("projects/wallrun/sim.js", () => {

const { boxDistance, createCharacter } = __mod("src/physics/character.js");
const { createParticles } = __mod("src/particles/particles.js");
const { animator, entityOf } = __mod("src/entity/index.js");
const { createCamera, subjectOf } = __mod("src/camera/camera.js");
const { createInput } = __mod("src/input/input.js");
const { levelOf } = __mod("projects/wallrun/level.js");
const { MATERIALS, RUNNER_MATERIALS, paletteOf } = __mod("projects/wallrun/palette.js");
const { streamOf } = __mod("projects/wallrun/seed.js");
const STEP = 1 / 120;
const runnerSpecOf = (seed) => entityOf(`${seed}|runner`, { kind: "anthro", size: 1.05, pins: { top: "jacket", pack: "round" } });
const screenFor = (w, h) => (Math.min(w, h) <= 48 ? 2 : Math.min(w, h) <= 128 ? 4 : 8);
const armFor = (w, h) => Math.min(1, Math.max(0.55, (Math.min(w, h) / 128) ** 0.45));
function fitArm(cam, w, h) {
  const k = armFor(w, h);
  cam.rigs.chase.opt.distance = 3 * k;
  cam.rigs.orbit.opt.distance = 3.4 * k;
}

function createSim({ seed = "1", width = 128, height = 128, onLoad = null, onStep = null } = {}) {
  let level;
  let runner;
  let anim;
  let body;
  let cam;
  let time = 0;
  let acc = 0;
  let wp = 0;
  let aim = null; // (where the autopilot's jump means to land)
  let autopilot = true; // (false: nobody drives when the player stops)
  let driver = "autopilot";
  let S;
  let dustClock = 0;
  let look; // (the palette, materials and style the picture wants)
  const ps = createParticles(700);
  const input = createInput({ idle: 8 });

  function load(s) {
    seed = String(s);
    level = levelOf(seed);
    runner = runnerSpecOf(seed);
    anim = animator(runner);
    const pal = paletteOf(seed, runner.colours);
    look = { colours: pal.colours, ramps: pal.ramps, materials: MATERIALS, style: { screen: screenFor(width, height), dither: 0.9, outline: 1 }, hue: runner.colours.cloth[2] };
    body = createCharacter({ boxes: level.boxes, rails: level.rails, waterY: level.waterY, spawn: level.spawn });
    S = streamOf(`${seed}|play`);
    cam = createCamera({ mode: "chase", width, height });
    fitArm(cam, width, height);
    wp = 0; time = 0; aim = null; driver = "autopilot";
    onLoad?.(api);
  }
  const floorUnder = (p) => level.boxes.some((b) => { const { d, n } = boxDistance([p[0], p[1] - 0.3, p[2]], b); return d < 0 || (d < 0.75 && n[1] > 0.6); });

  const G = 24; // (the body's gravity; hold keeps the rise at it)
  const flightTime = (vy, y, ty) => (vy + Math.sqrt(Math.max(0, vy * vy + 2 * G * (y - ty)))) / G;
  function landingAfter(i) {
    const r = level.route;
    for (let k = i; k < r.length; k += 1) {
      if (r[k].act === "wall") return null;
      if (r[k].act === "rail") return [r[k].p[0], r[k].p[1] + 0.28, r[k].p[2]];
      if (r[k].act === "run" && r[k].p[2] > body.pos[2] + 1.5) return r[k].p;
    }
    return null;
  }
  function pilot() {
    const r = level.route;
    while (wp < r.length - 1 && (Math.hypot(r[wp].p[0] - body.pos[0], r[wp].p[2] - body.pos[2]) < 1.6 || body.pos[2] > r[wp].p[2] + 0.8)) wp += 1;
    const goal = r[wp];
    let dx = goal.p[0] - body.pos[0];
    let dz = goal.p[2] - body.pos[2];
    let dl = Math.hypot(dx, dz) || 1;
    let move = [dx / dl, dz / dl];
    let jump = false;
    const hv = Math.hypot(body.vel[0], body.vel[2]);
    if (body.mode !== "air") aim = null;
    if (body.mode === "ground") {
      const next = goal.act === "jump" || goal.act === "rail" ? landingAfter(wp) : null;
      if (next && hv > 3) {
        const reach = hv * flightTime(8.6, body.pos[1], next[1]);
        if (Math.hypot(next[0] - body.pos[0], next[2] - body.pos[2]) <= reach + 0.2) { jump = true; aim = next; }
      }
      if (!jump && hv > 3) {
        const ahead = [body.pos[0] + (body.vel[0] / hv) * 1.1, body.pos[1], body.pos[2] + (body.vel[2] / hv) * 1.1];
        if (!floorUnder(ahead)) { jump = true; aim = landingAfter(wp); } // (an edge: off it)
      }
    }
    if (body.mode === "air" && aim) {
      const t = Math.max(0.12, flightTime(body.vel[1], body.pos[1], aim[1]));
      const want = [(aim[0] - body.pos[0]) / t, (aim[2] - body.pos[2]) / t];
      const wl = Math.hypot(want[0], want[1]) / 9.5;
      move = wl > 1 ? [want[0] / (wl * 9.5), want[1] / (wl * 9.5)] : [want[0] / 9.5, want[1] / 9.5];
    }
    if (body.mode === "wall" && body.wall && ((goal.act === "wall" && (goal.p[0] - body.pos[0]) * body.wall[0] > 1) || goal.act !== "wall" || body.wallTime > 1.15)) jump = true;
    if (body.pos[2] > level.end - 3) { body.pos = [...level.spawn]; body.vel = [0, 0, 0]; wp = 0; aim = null; body.mode = "air"; }
    return { move, jump, hold: true };
  }
  function resync() {
    const r = level.route;
    wp = r.findIndex((q) => q.p[2] > body.pos[2] + 0.5);
    if (wp < 0) wp = r.length - 1;
    aim = null;
  }

  function stepOnce() {
    const it = input.sample(STEP, cam.yaw); // (camera-relative: W is where the view looks)
    const now = it.player ? "player" : autopilot ? "autopilot" : "idle";
    if (now !== driver) {
      if (now === "autopilot") resync();
      cam.setMode(now === "player" ? "orbit" : "chase", { blend: 0.35 }); // (the player turns the camera; attract mode rides it)
      driver = now;
    }
    body.step(STEP, now === "player" ? it : now === "autopilot" ? pilot() : { move: [0, 0], jump: false, hold: false });
    anim.step(STEP, body);
    time += STEP;
    const hv = Math.hypot(body.vel[0], body.vel[2]);
    for (const e of body.events) {
      if (e.type === "landed") { ps.emit("dust", e.at, { count: Math.min(10, 3 + Math.round(e.speed)), S, spread: 1.4 }); cam.thud(Math.min(1, e.speed / 12) * 0.05); }
      if (e.type === "jumped" || e.type === "wallJump") ps.emit("dust", e.at, { count: 5, S });
      if (e.type === "grinding" && S.chance(0.6)) ps.emit("spark", e.at, { count: 2, S, vel: e.tan.map((v) => -v * 2.5) });
      if (e.type === "skimming" && S.chance(0.35)) ps.emit("splash", e.at, { count: 3, S, vel: [-body.vel[0] * 0.2, 0, -body.vel[2] * 0.2] });
      if (e.type === "splashIn" || e.type === "skimStart") ps.emit("splash", e.at, { count: 14, S, spread: 1.5 });
      if (e.type === "wallRunning" && S.chance(0.3)) ps.emit("dust", [e.at[0] - e.n[0] * 0.25, e.at[1] + 0.2, e.at[2] - e.n[2] * 0.25], { count: 1, S, spread: 0.5 });
    }
    dustClock += STEP * hv;
    if (body.mode === "ground" && dustClock > 2.2) { dustClock = 0; ps.emit("dust", body.pos, { count: 2, S, spread: 0.6 }); }
    if (S.chance(0.08)) ps.emit("mote", [body.pos[0] + S.between(-8, 8), S.between(0.5, 5), body.pos[2] + S.between(-4, 14)], { count: 1, S });
    ps.step(STEP);
    cam.step(STEP, subjectOf(body, { height: 1.15 }), { boxes: level.boxes }, it);
    onStep?.(api, STEP);
  }

  function surface() {
    if (body.mode === "skim" || body.mode === "sink" || body.pos[1] < level.waterY + 0.15) return "water";
    if (body.mode === "grind") return "metal";
    const under = level.boxes.find((b) => { const { d, n } = boxDistance([body.pos[0], body.pos[1] - 0.1, body.pos[2]], b); return d < 0.2 && n[1] > 0.6; });
    return under?.mat === 2 ? "metal" : "stone";
  }

  function frame() {
    return {
      boxes: level.boxes,
      capsules: cam.hidesSubject ? level.capsules : [...level.capsules, ...anim.capsules(RUNNER_MATERIALS)],
      particles: ps.list(),
      view: { ...cam.view(), time, sun: [0.35, 0.85, 0.25] },
    };
  }

  const api = {
    get seed() { return seed; }, get body() { return body; }, get runner() { return runner; }, get level() { return level; }, get cam() { return cam; }, get look() { return look; }, input,
    get width() { return width; }, get height() { return height; }, get time() { return time; }, get particles() { return ps; },
    get driver() { return driver; },
    set autopilot(v) { autopilot = v; if (v) input.arbiter.giveBack(); }, get autopilot() { return autopilot; },
    attachInput(target = globalThis, opts = {}) { return input.attach(target, opts); },
    load,
    setTarget(w, h) { width = w; height = h; look.style = { ...look.style, screen: screenFor(w, h) }; cam.setTarget(w, h); fitArm(cam, w, h); },
    simulate(sec) { for (let i = 0; i < Math.round(sec / STEP); i += 1) stepOnce(); },
    advance(dt) { acc += Math.min(dt, 0.1); while (acc >= STEP) { stepOnce(); acc -= STEP; } },
    step: stepOnce,
    frame,
    surface,
    key(k, down) { input.key(k, down); },
  };
  load(seed);
  return api;
}

return { get STEP() { return STEP; }, get runnerSpecOf() { return runnerSpecOf; }, get screenFor() { return screenFor; }, get createSim() { return createSim; } };
});

__def("projects/wallrun/game.js", () => {

const { createPixelRenderer } = __mod("src/gpu/pixel-renderer.js");
const { bodySfx, createSound, moodFor, scoreOf } = __mod("src/audio/index.js");
const { createSim } = __mod("projects/wallrun/sim.js");

const moodOf = (hue) => moodFor({ name: "Night Water", energy: 0.65, darkness: 0.7, weather: ["waves", "wind"], hue });

function createGame(canvas, { seed = "1", width = 128, height = 128, sound: withSound = true, host = document.body } = {}) {
  const px = createPixelRenderer(canvas, { width, height });
  const sound = withSound ? createSound(host, { id: "wallrun", sfx: { seed: String(seed), style: "lofi" } }) : null;
  let feet = null;
  const paint = (sim) => {
    const L = sim.look;
    px.setPalette(L.colours, L.ramps); px.setMaterials(L.materials); px.setStyle(L.style);
    sound?.setPlan(scoreOf(moodOf(L.hue), sim.seed));
  };
  const listen = (sim, dt) => {
    if (!sound) return;
    if (sound.on && !feet) feet = bodySfx(sound.sfx, { surfaceOf: () => sim.surface() });
    if (!sound.on && feet) { feet.stop(); feet = null; }
    feet?.update(sim.body, dt);
    const speed = Math.hypot(sim.body.vel[0], sim.body.vel[2]);
    sound.setIntensity(Math.min(1, 0.15 + speed / 11), 1.5);
  };
  const sim = createSim({ seed, width, height, onLoad: paint, onStep: listen });

  function draw() {
    const f = sim.frame();
    px.setWorld({ boxes: f.boxes, capsules: f.capsules });
    px.render({ ...f.view, particles: f.particles });
  }

  return Object.assign(Object.create(sim), {
    px,
    sound,
    attachInput(target = globalThis, opts = {}) { return sim.attachInput(target, { canvas, ...opts }); },
    setTarget(w, h) { px.setTarget(w, h); sim.setTarget(w, h); px.setStyle(sim.look.style); },
    tick(dt) { sim.advance(dt); draw(); },
    draw,
  });
}

return { get createGame() { return createGame; }, get screenFor() { return __mod("projects/wallrun/sim.js").screenFor; } };
});

__def("projects/wallrun/keel-entry.js", () => {

const { createGame } = __mod("projects/wallrun/game.js");
const q = new URLSearchParams(location.search);
const token = globalThis.KEEL?.data?.token;
const seed = String(token?.seed ?? q.get("seed") ?? (location.hash.slice(1) || "1"));
const px = Math.max(16, Math.min(256, Number(q.get("px") ?? token?.px ?? 128) || 128));

document.body.style.cssText = "margin:0;height:100vh;display:grid;place-items:center;background:#07080b;overflow:hidden";
const canvas = document.createElement("canvas");
canvas.style.cssText = "width:min(100vw,100vh);height:min(100vw,100vh);image-rendering:pixelated;cursor:crosshair";
document.body.append(canvas);

const game = createGame(canvas, { seed, width: px, height: px });
game.attachInput(globalThis);
globalThis.WALLRUN = game;

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  game.tick((now - last) / 1000);
  last = now;
}
requestAnimationFrame(loop);

return {  };
});
__mod("projects/wallrun/keel-entry.js");
})();
