export const FACE_TILING_FIELDS = Object.freeze(['offsetX', 'offsetY', 'width', 'height']);
export const DEFAULT_FACE_TILING = Object.freeze({ offsetX: 0, offsetY: 0, width: 16, height: 16 });

// Width/height describe the entire face in source-texture pixels. The source
// image repeats intact within that span; they never resize a single tile.

// Read defaults without materializing or changing an ordinary face's UVs.
export function faceTilingValues(face) {
  return FACE_TILING_FIELDS.map(key => {
    const value = Number(face?.tiling?.[key]);
    return Number.isFinite(value) && (key.startsWith('offset') || value > 0)
      ? value : DEFAULT_FACE_TILING[key];
  });
}

export function faceTilingSettings(face) {
  const values = faceTilingValues(face);
  return Object.fromEntries(FACE_TILING_FIELDS.map((key, index) => [key, values[index]]));
}

export function faceTilingRegion(face, region = null) {
  const tile = faceTilingSettings(face);
  if (!region) return tile;
  return {
    offsetX: tile.offsetX + region.x / region.faceWidth * tile.width,
    offsetY: tile.offsetY + region.y / region.faceHeight * tile.height,
    width: region.width / region.faceWidth * tile.width,
    height: region.height / region.faceHeight * tile.height
  };
}

export function setFaceTilingCoordinate(face, coordinate, value) {
  const key = FACE_TILING_FIELDS[coordinate];
  if (!face || !key || !Number.isFinite(value)) return false;
  const next = coordinate >= 2 ? Math.max(.0001, value) : value;
  if (faceTilingValues(face)[coordinate] === next) return false;
  face.tiling = { ...DEFAULT_FACE_TILING, ...face.tiling, [key]: next };
  return true;
}
