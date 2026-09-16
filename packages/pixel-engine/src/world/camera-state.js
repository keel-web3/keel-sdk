// Saving and restoring a src/camera camera. Its rigs keep their state on
// themselves (yaw, pitch, pivot, arm, eye, look, turn, t ...), so those are
// copied field by field; the camera's own view (eye, target, fov, yaw, pitch,
// time, trauma, nod) likewise. Four things live in camera.js's closure and
// can't be reached from here: a blend in progress, the fov kick, and the
// "entering"/"fresh" flags. A restore therefore builds a NEW camera, steps it
// once (so it has entered its rig), then writes the saved fields over it: exact
// unless the save was taken mid-blend (the blend is dropped) or with fovKick on.

const plain = (v) => v === null || typeof v === "number" || typeof v === "string" || typeof v === "boolean" || (Array.isArray(v) && v.every(plain));
const copy = (v) => (Array.isArray(v) ? v.map(copy) : v);
const CAM_FIELDS = ["eye", "target", "fov", "yaw", "pitch", "time", "trauma", "nod", "nodVel", "nearSubject", "mode", "width", "height"];

/** A camera's state as plain data. */
export function saveCamera(cam) {
  const out = { cam: {}, rigs: {} };
  for (const k of CAM_FIELDS) out.cam[k] = copy(cam[k]);
  if (!Number.isFinite(out.cam.nearSubject)) out.cam.nearSubject = null;
  for (const [name, rig] of Object.entries(cam.rigs)) {
    const r = {};
    for (const [k, v] of Object.entries(rig)) if (k !== "opt" && k !== "name" && typeof v !== "function" && plain(v)) r[k] = copy(v);
    out.rigs[name] = r;
  }
  return out;
}

/**
 * Put a saved state onto a camera that has already been stepped once in the
 * saved mode (so its rig has entered and nothing will reset it).
 */
export function loadCamera(cam, state) {
  for (const [name, r] of Object.entries(state.rigs)) {
    const rig = cam.rigs[name];
    if (!rig) continue;
    for (const [k, v] of Object.entries(r)) rig[k] = copy(v);
  }
  for (const k of CAM_FIELDS) if (k !== "mode") cam[k] = copy(state.cam[k]);
  if (cam.nearSubject === null) cam.nearSubject = Infinity;
  return cam;
}
