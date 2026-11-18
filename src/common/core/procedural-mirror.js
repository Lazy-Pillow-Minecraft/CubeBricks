export function proceduralMirrorVector(owner, vector) {
  if (!owner.geometryMirrorX) return vector;
  return vector.map((value, axis) => owner.geometryMirrorX && axis === 0 ? -value : value);
}

export function proceduralMirrorPoint(owner, point) {
  return proceduralMirrorVector(owner, point);
}
