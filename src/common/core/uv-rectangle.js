// UI fields describe the rectangle's top-left and positive width/height.
// Mirroring stays encoded in the stored endpoint order.
export function uvRectangleFields(uv) {
  return [Math.min(uv[0], uv[2]), Math.min(uv[1], uv[3]),
    Math.abs(uv[2] - uv[0]), Math.abs(uv[3] - uv[1])];
}

export function editUvRectangleField(uv, coordinate, value, maximum) {
  if (!Number.isInteger(coordinate) || coordinate < 0 || coordinate > 3 || !Number.isFinite(value)) return [...uv];
  const fields = uvRectangleFields(uv);
  const axis = coordinate % 2;
  const limit = Math.max(0, maximum - fields[coordinate < 2 ? axis + 2 : axis]);
  fields[coordinate] = Math.max(0, Math.min(limit, value));
  const result = [...uv];
  const start = fields[axis], end = start + fields[axis + 2];
  const mirrored = uv[axis + 2] < uv[axis];
  result[axis] = mirrored ? end : start;
  result[axis + 2] = mirrored ? start : end;
  return result;
}
