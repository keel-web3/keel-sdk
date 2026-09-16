// KEEL Pixel core -- copied from NOCTURNES src/sdf.js (tests/core-equality.test.mjs
// proves every export identical to the original). Change NOCTURNES' copy and
// this one together, or not at all.
//
// Signed distance primitives on scalars. Hot path: no arrays, no allocation.

export function sdSphere(x, y, z, r) {
  return Math.sqrt(x * x + y * y + z * z) - r;
}

export function sdBox(x, y, z, bx, by, bz, round = 0) {
  const qx = Math.abs(x) - bx + round;
  const qy = Math.abs(y) - by + round;
  const qz = Math.abs(z) - bz + round;
  const ox = qx > 0 ? qx : 0;
  const oy = qy > 0 ? qy : 0;
  const oz = qz > 0 ? qz : 0;
  const inside = Math.min(Math.max(qx, qy, qz), 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + inside - round;
}

/** Vertical torus lying flat (ring in xz-plane). */
export function sdTorus(x, y, z, R, r) {
  const q = Math.sqrt(x * x + z * z) - R;
  return Math.sqrt(q * q + y * y) - r;
}

/** Capped cylinder around y, centred, half-height h. */
export function sdCylinder(x, y, z, r, h, round = 0) {
  const dx = Math.sqrt(x * x + z * z) - r + round;
  const dy = Math.abs(y) - h + round;
  const ox = dx > 0 ? dx : 0;
  const oy = dy > 0 ? dy : 0;
  return Math.min(Math.max(dx, dy), 0) + Math.sqrt(ox * ox + oy * oy) - round;
}

export function sdCapsule(x, y, z, ax, ay, az, bx, by, bz, r) {
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

/** Hexagonal prism along y, apothem r, half-height h. */
export function sdHexPrism(x, y, z, r, h) {
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

export function sdEllipsoid(x, y, z, rx, ry, rz) {
  const k0 = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
  const k1 = Math.sqrt((x / (rx * rx)) ** 2 + (y / (ry * ry)) ** 2 + (z / (rz * rz)) ** 2);
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

export function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * Signed distance to a closed polygon (iq). xs/ys are Float64Arrays. Used for
 * surfaces of revolution: evaluate at (hypot(x,z), y).
 */
export function sdPolygon(px, py, xs, ys) {
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

/** A profile [[r,y],...] as typed arrays plus its extent. */
export function profile(points) {
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

/** Surface of revolution around local y. */
export function sdLathe(x, y, z, prof, round = 0) {
  const r = Math.sqrt(x * x + z * z);
  // Cheap early out: far outside the bounding cylinder, the cylinder is a
  // valid lower bound on the distance.
  const out = Math.max(r - prof.rmax, prof.ymin - y, y - prof.ymax);
  if (out > 0.15) return out;
  return sdPolygon(r, y, prof.xs, prof.ys) - round;
}

/** Convex polyhedron from planes [nx,ny,nz,d] (Float64Array, stride 4). */
export function sdPlanes(x, y, z, planes) {
  let d = -Infinity;
  for (let i = 0; i < planes.length; i += 4) {
    const v = planes[i] * x + planes[i + 1] * y + planes[i + 2] * z - planes[i + 3];
    if (v > d) d = v;
  }
  return d;
}
