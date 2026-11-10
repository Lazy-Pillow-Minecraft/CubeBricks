const DEG = Math.PI / 180;
export const UV_PREVIEW_CULLED_UV = -2000000;

export function isCubeFaceCulled(face) {
  return face === null || face?.enabled === false || face?.texture === null;
}

export function hasAssignedFaceTexture(face) {
  return face?.texture !== undefined && face?.texture !== null;
}

export function getEffectiveInflate(cube, groupChain = []) {
  return (Number(cube?.inflate) || 0)
    + groupChain.reduce((total, group) => total + (Number(group?.inflate) || 0), 0);
}

export function rotatePoint(point, pivot, rotation) {
  let x = point[0] - pivot[0], y = point[1] - pivot[1], z = point[2] - pivot[2];
  const [rx, ry, rz] = rotation.map(value => value * DEG);
  let c = Math.cos(rx), s = Math.sin(rx);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry);
  s = Math.sin(ry);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz);
  s = Math.sin(rz);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x + pivot[0], y + pivot[1], z + pivot[2]];
}

// Java's optional rotation rescale expands the two axes perpendicular to the
// rotation axis before rotating. Keeping this visual transform separate leaves
// the native from/to values and their format limits unchanged.
export function rescaleRotationPoint(point, pivot, rotation, enabled) {
  if (!enabled) return point;
  const axis = rotation.reduce((best, value, index) => Math.abs(value) > Math.abs(rotation[best]) ? index : best, 0);
  const cosine = Math.abs(Math.cos(rotation[axis] * DEG));
  if (cosine < 1e-7) return point;
  return point.map((value, index) => index === axis ? value : pivot[index] + (value - pivot[index]) / cosine);
}

export function applyGroupTransforms(point, groupChain = []) {
  let transformed = [...point];
  for (const group of [...groupChain].reverse())
    transformed = rotatePoint(transformed, group.pivot, group.rotation || [0, 0, 0]);
  return transformed;
}

export function createBlockbenchFaceUvSlots(rectangle, rotation = 0) {
  let slots = [
    [rectangle[0], rectangle[1]], [rectangle[2], rectangle[1]],
    [rectangle[0], rectangle[3]], [rectangle[2], rectangle[3]]
  ];
  let turns = ((Math.round(rotation / 90) % 4) + 4) % 4;
  while (turns-- > 0) slots = [slots[2], slots[0], slots[3], slots[1]];
  return slots;
}

export function getBlockbenchBoxUv(cube, faceName) {
  const [u, v] = cube.uv || [0, 0];
  const scale = Number(cube.uvScale) || 1;
  const [x, y, z] = cube.size.map(value => {
    const length = Math.abs(Number(value) || 0) * scale;
    return scale === 1 ? length : length > 0 ? Math.max(1, Math.round(length)) : 0;
  });
  const rectangles = {
    east: [u, v + z, u + z, v + z + y],
    north: [u + z, v + z, u + z + x, v + z + y],
    west: [u + z + x, v + z, u + z + x + z, v + z + y],
    south: [u + z + x + z, v + z, u + z + x + z + x, v + z + y],
    up: [u + z + x, v + z, u + z, v],
    down: [u + z + x + x, v, u + z + x, v + z]
  };
  if (cube.mirrorUv) {
    for (const rectangle of Object.values(rectangles)) [rectangle[0], rectangle[2]] = [rectangle[2], rectangle[0]];
    [rectangles.east, rectangles.west] = [rectangles.west, rectangles.east];
  }
  return rectangles[faceName];
}
