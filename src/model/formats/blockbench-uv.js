import { getBlockbenchBoxUv, isCubeFaceCulled } from '../../common/core/geometry-utils.js';

const UV_TOLERANCE = 1e-4;

function matchesBoxLayout(faces, cube) {
  return Object.entries(faces).every(([direction, face]) => {
    if (isCubeFaceCulled(face) || !Array.isArray(face?.uv)) return true;
    const expected = getBlockbenchBoxUv(cube, direction);
    return expected && face.uv.length >= 4 && face.uv.slice(0, 4).every((value, index) =>
      Number.isFinite(Number(value)) && Math.abs(Number(value) - expected[index]) <= UV_TOLERANCE);
  });
}

// A bbmodel's box_uv flag describes the editor mode, but individual cubes can
// carry edited face rectangles. Trust the rectangles before reconstructing UVs.
export function importBlockbenchCubeUv(item, faces, projectBoxUv) {
  if (item.box_uv === false) return { uvMode: 'face', boxUvFloor: false };
  const boxDeclared = item.box_uv === true || projectBoxUv === true;
  const hasFaceUv = Object.values(faces || {}).some(face => Array.isArray(face?.uv));
  if (!boxDeclared && !hasFaceUv) return { uvMode: 'box', boxUvFloor: false };
  if (!boxDeclared && projectBoxUv === false) return { uvMode: 'face', boxUvFloor: false };

  const size = item.to?.map((value, axis) => Number(value) - Number(item.from?.[axis]));
  if (!Array.isArray(size) || size.some(value => !Number.isFinite(value))) {
    return { uvMode: hasFaceUv ? 'face' : 'box', boxUvFloor: false };
  }
  const cube = {
    size, uv: Array.isArray(item.uv_offset) ? item.uv_offset : [0, 0],
    mirrorUv: item.mirror_uv === true
  };
  const exact = matchesBoxLayout(faces || {}, cube);
  const floored = matchesBoxLayout(faces || {}, { ...cube, boxUvFloor: true });
  if (!exact && !floored) return { uvMode: 'face', boxUvFloor: false };

  // Keep the same box editing workflow while matching Blockbench formats that
  // floor fractional cube dimensions for UV layout. Face UVs are then derived
  // from the stored box offset and current size, never from stale import data.
  for (const face of Object.values(faces || {})) if (face && typeof face === 'object') delete face.uv;
  return { uvMode: 'box', boxUvFloor: !exact && floored };
}
