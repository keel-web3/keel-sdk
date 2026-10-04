// The engine's one frame convention. Every system -- renderer, physics,
// entities, objects, cameras, input -- uses this, and only this.
//
//   world: y up. An entity's (or object's, or camera's) own frame:
//     +z  FRONT   (where a face looks, where a screen shows, where a runner runs)
//     +x  RIGHT   (its right hand, as it sees it)
//     +y  UP
//
//   yaw (heading) turns the front about +y:  front(yaw) = [sin yaw, 0, cos yaw]
//                                            right(yaw) = [cos yaw, 0, -sin yaw]
//   so yaw = atan2(dx, dz) is "facing along (dx, dz)", and yaw 0 faces +z.
//
//   A camera looking along +z has +x on the RIGHT of the screen. So a thing
//   seen from behind shows its right hand on the screen's right, and a thing
//   seen from the front shows its right hand on the screen's left -- as in a
//   mirror, as in life.
//
// (NOCTURNES turns its instances the other way -- its front(yaw) is
// [-sin yaw, 0, cos yaw] -- so its yaws come in through fromNocturnesYaw.)

export const FRONT = Object.freeze([0, 0, 1]);
export const RIGHT = Object.freeze([1, 0, 0]);
export const UP = Object.freeze([0, 1, 0]);

export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** The world direction a yaw faces. */
export const frontOf = (yaw) => [Math.sin(yaw), 0, Math.cos(yaw)];
/** The world direction of the right hand at a yaw. */
export const rightOf = (yaw) => [Math.cos(yaw), 0, -Math.sin(yaw)];
/** The yaw that faces along a direction (its horizontal part). */
export const yawOf = (dir) => Math.atan2(dir[0], dir[2]);
/** The yaw that faces from `from` toward `to`. */
export const yawTo = (from, to) => Math.atan2(to[0] - from[0], to[2] - from[2]);

/** Local [x right, y up, z front] -> world, for a thing at `pos` turned by `yaw`. */
export function localToWorld(pos, yaw, [x, y, z]) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [pos[0] + x * c + z * s, pos[1] + y, pos[2] - x * s + z * c];
}
/** World -> local, the inverse of localToWorld. */
export function worldToLocal(pos, yaw, p) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const dx = p[0] - pos[0];
  const dz = p[2] - pos[2];
  return [dx * c - dz * s, p[1] - pos[1], dx * s + dz * c];
}

/**
 * A camera's basis from where it is and what it looks at: forward, right
 * (screen right) and up. Right = up x forward, so looking along +z, +x is right.
 */
export function cameraBasis(eye, target) {
  let f = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const fl = Math.hypot(...f) || 1;
  f = f.map((v) => v / fl);
  let r = [f[2], 0, -f[0]]; // UP x f
  const rl = Math.hypot(...r) || 1;
  r = rl < 1e-6 ? [1, 0, 0] : r.map((v) => v / rl);
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]]; // f x r
  return { forward: f, right: r, up: u };
}

/**
 * Movement intent on the ground from a stick or keys, relative to a view yaw:
 * forward 1 goes where the view faces, strafe 1 goes to the view's right.
 * Returns a horizontal world direction [x, z] (length <= 1).
 */
export function moveFromView(viewYaw, forward, strafe) {
  const f = frontOf(viewYaw);
  const r = rightOf(viewYaw);
  let x = f[0] * forward + r[0] * strafe;
  let z = f[2] * forward + r[2] * strafe;
  const l = Math.hypot(x, z);
  if (l > 1) { x /= l; z /= l; }
  return [x, z];
}

/** NOCTURNES instance yaw -> engine yaw (NOCTURNES turns the other way). */
export const fromNocturnesYaw = (y) => -y;
export const toNocturnesYaw = (y) => -y;
