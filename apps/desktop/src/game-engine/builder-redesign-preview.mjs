// Only engine-owned mesh writers execute here. The output GLB is disposable
// preview transport; the validated seed + native program remains the artifact.
export const REDESIGN_PREVIEW_LIMITS = Object.freeze({ primitives: 4096, triangles: 200_000, glbBytes: 32 * 1024 * 1024, voxelResolution: 24, voxelCells: 50_000 });

function wedge(importer, mesh, solid, colour) {
  // Match the native renderer: foot at +z, full height at -z.
  const local = importer.meshData(); importer.addBox(local, [0, 0, 0], solid.h, { colour });
  const co = Math.cos(solid.yaw ?? 0), si = Math.sin(solid.yaw ?? 0);
  for (let i = 0; i < local.positions.length; i += 3) {
    const x = local.positions[i], z = local.positions[i + 2]; let y = local.positions[i + 1];
    if (y > 0 && z > 0) y = -solid.h[1] + 2 * solid.h[1] * (solid.lo ?? 0);
    local.positions[i] = solid.c[0] + co * x + si * z;
    local.positions[i + 1] = solid.c[1] + y;
    local.positions[i + 2] = solid.c[2] - si * x + co * z;
  }
  importer.mergeMesh(mesh, local);
}
function buildGlb(importer, mesh) {
  return importer.writeGlb({ nodes: [{ name: 'native-redesign', mesh: 0 }], meshes: [{ name: 'native-primitives', primitives: [{ mesh, material: 0, colours: true }] }], materials: [{ name: 'native-palette', colour: [1, 1, 1, 1] }] });
}
function geometryBounds(mesh) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], mesh.positions[i + a]); max[a] = Math.max(max[a], mesh.positions[i + a]); }
  return { min, max, space: 'source-world', pose: 'static-hint' };
}
export function nativeRedesignPlayback({ importer, solids, look, style, name }) {
  const boxes = solids.boxes ?? [], caps = solids.capsules ?? [], wedges = solids.wedges ?? [];
  if (boxes.length + caps.length + wedges.length > REDESIGN_PREVIEW_LIMITS.primitives) throw new RangeError('Generated redesign has too many primitives for an isolated preview');
  const estimatedTriangles = boxes.length * 12 + wedges.length * 12 + caps.length * 440;
  if (estimatedTriangles > REDESIGN_PREVIEW_LIMITS.triangles) throw new RangeError('Generated redesign exceeds the preview triangle budget');
  let mesh = importer.meshData();
  const colourOf = mat => {
    const material = look.materials[mat ?? 0] ?? look.materials[0], ramp = look.palette.ramps[material?.ramp] ?? [0, 1];
    const rgb = look.palette.colours[ramp[0] + Math.floor((ramp[1] - 1) * .65)] ?? [160, 160, 160];
    return [...rgb.map(n => importer.srgbToLinear(n / 255)), 1];
  };
  for (const b of boxes) { const colour = colourOf(b.mat); if (b.kind === 'wedge') wedge(importer, mesh, b, colour); else importer.addBox(mesh, b.c, b.h, { colour }, b.yaw ?? 0); }
  for (const w of wedges) wedge(importer, mesh, w, colourOf(w.mat));
  for (const c of caps) importer.addCapsule(mesh, c.a, c.b, c.r, { colour: colourOf(c.mat) }, 10);
  if (!mesh.indices.length) throw new RangeError('The redesign produced no visible geometry');
  let previewVoxels = 0;
  if (style.kind === 'voxel') {
    // This is a display derivation of newly generated geometry, not conversion
    // of the input model. Styles never replace the native program or its ops.
    const grid = importer.voxelize(importer.parseModel(buildGlb(importer, mesh)), { voxels: REDESIGN_PREVIEW_LIMITS.voxelResolution, maxCells: REDESIGN_PREVIEW_LIMITS.voxelCells });
    const occupied = grid.occ.reduce((n, v) => n + (v ? 1 : 0), 0);
    if (occupied * 12 > REDESIGN_PREVIEW_LIMITS.triangles) throw new RangeError('Voxel preview exceeds the triangle budget');
    mesh = importer.meshData();
    for (let i = 0; i < grid.occ.length; i++) if (grid.occ[i]) {
      const cell = importer.cellOf(grid, i), c = cell.map((n, a) => grid.origin[a] + (n + .5) * grid.unit), colour = [...grid.colour.subarray(i * 3, i * 3 + 3), 1];
      importer.addBox(mesh, c, [grid.unit / 2, grid.unit / 2, grid.unit / 2], { colour }); previewVoxels++;
    }
  }
  if (mesh.indices.length / 3 > REDESIGN_PREVIEW_LIMITS.triangles) throw new RangeError('Generated preview exceeds the triangle budget');
  const glb = buildGlb(importer, mesh);
  if (glb.byteLength > REDESIGN_PREVIEW_LIMITS.glbBytes) throw new RangeError('Generated redesign exceeds the preview byte budget');
  return {
    playback: { format: 'KEEL-IMPORTED-STYLED-ASSET', version: 2, name, style, animation: { mode: style.kind === 'voxel' ? 'static-pose' : 'none', clips: 0 }, sourceBounds: geometryBounds(mesh), glbBase64: Buffer.from(glb).toString('base64'), provenance: 'generated-native-program-static-preview' },
    stats: { boxes: boxes.filter(b => b.kind !== 'wedge').length, capsules: caps.length, wedges: wedges.length + boxes.filter(b => b.kind === 'wedge').length, triangles: mesh.indices.length / 3, glbBytes: glb.byteLength, previewVoxels, ...(style.kind === 'voxel' ? { voxelResolution: REDESIGN_PREVIEW_LIMITS.voxelResolution } : {}) },
  };
}
