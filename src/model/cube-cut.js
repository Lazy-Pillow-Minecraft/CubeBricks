// Knife cuts use face-local UV coordinates to retain the original mapping.
export const CUT_FACE_LAYOUT = Object.freeze({
  south: Object.freeze({ horizontal: 0, horizontalReversed: false, vertical: 1, verticalReversed: true }),
  north: Object.freeze({ horizontal: 0, horizontalReversed: true, vertical: 1, verticalReversed: true }),
  east: Object.freeze({ horizontal: 2, horizontalReversed: true, vertical: 1, verticalReversed: true }),
  west: Object.freeze({ horizontal: 2, horizontalReversed: false, vertical: 1, verticalReversed: true }),
  up: Object.freeze({ horizontal: 0, horizontalReversed: false, vertical: 2, verticalReversed: false }),
  down: Object.freeze({ horizontal: 0, horizontalReversed: false, vertical: 2, verticalReversed: true })
});

function getCubeBoxUv(cube, faceName) {
  const [u, v] = cube.uv || [0, 0];
  const [x, y, z] = cube.size.map(Math.abs);
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

function rotateFaceUvSlots(rectangle, rotation = 0) {
  let slots = [
    [rectangle[0], rectangle[1]], [rectangle[2], rectangle[1]],
    [rectangle[0], rectangle[3]], [rectangle[2], rectangle[3]]
  ];
  let turns = ((Math.round(rotation / 90) % 4) + 4) % 4;
  while (turns-- > 0) slots = [slots[2], slots[0], slots[3], slots[1]];
  return slots;
}

function faceUvRectangleFromSlots(slots, rotation = 0) {
  let restored = slots.map(slot => [...slot]);
  let turns = ((Math.round(rotation / 90) % 4) + 4) % 4;
  while (turns-- > 0) restored = [restored[1], restored[3], restored[0], restored[2]];
  return [restored[0][0], restored[0][1], restored[3][0], restored[3][1]];
}

export function splitFaceUv(face, layout, axis, ratio) {
  const dimension = layout.horizontal === axis ? 'horizontal' : layout.vertical === axis ? 'vertical' : null;
  if (!dimension || !Array.isArray(face.uv) || face.uv.length < 4) return [structuredClone(face), structuredClone(face)];
  const slots = rotateFaceUvSlots(face.uv, face.rotation || 0);
  const physicalStart = dimension === 'horizontal' ? [0, 2] : [0, 1];
  const physicalEnd = dimension === 'horizontal' ? [1, 3] : [2, 3];
  const reversed = dimension === 'horizontal' ? layout.horizontalReversed : layout.verticalReversed;
  const startIndices = reversed ? physicalEnd : physicalStart;
  const endIndices = reversed ? physicalStart : physicalEnd;
  const firstSlots = slots.map(slot => [...slot]);
  const secondSlots = slots.map(slot => [...slot]);
  for (let index = 0; index < startIndices.length; index++) {
    const startIndex = startIndices[index], endIndex = endIndices[index];
    const cut = slots[startIndex].map((value, uvAxis) => value + (slots[endIndex][uvAxis] - value) * ratio);
    firstSlots[endIndex] = cut;
    secondSlots[startIndex] = cut;
  }
  return [
    { ...structuredClone(face), uv: faceUvRectangleFromSlots(firstSlots, face.rotation || 0) },
    { ...structuredClone(face), uv: faceUvRectangleFromSlots(secondSlots, face.rotation || 0) }
  ];
}

export function materializeCutFaces(cube) {
  return Object.fromEntries(Object.keys(CUT_FACE_LAYOUT).map(faceName => {
    const face = structuredClone(cube.faces?.[faceName] || {});
    if (!Array.isArray(face.uv) || face.uv.length < 4) face.uv = [...getCubeBoxUv(cube, faceName)];
    return [faceName, face];
  }));
}

const KNIFE_FACE_AXES = Object.freeze({
  north: Object.freeze({ normal: 2, horizontal: 0, vertical: 1 }),
  south: Object.freeze({ normal: 2, horizontal: 0, vertical: 1 }),
  east: Object.freeze({ normal: 0, horizontal: 2, vertical: 1 }),
  west: Object.freeze({ normal: 0, horizontal: 2, vertical: 1 }),
  up: Object.freeze({ normal: 1, horizontal: 0, vertical: 2 }),
  down: Object.freeze({ normal: 1, horizontal: 0, vertical: 2 })
});

export function getKnifeFaceAxes(faceName) {
  return KNIFE_FACE_AXES[faceName] || null;
}

export function chooseKnifeCutAxis(firstPoint, secondPoint, faceName, cube = null) {
  const axes = getKnifeFaceAxes(faceName);
  if (!axes || !Array.isArray(firstPoint) || !Array.isArray(secondPoint)) return null;
  const choices = [
    { axis: axes.horizontal, distance: Math.abs(secondPoint[axes.horizontal] - firstPoint[axes.horizontal]) },
    { axis: axes.vertical, distance: Math.abs(secondPoint[axes.vertical] - firstPoint[axes.vertical]) }
  ];
  const valid = cube ? choices.filter(choice => {
    const start = cube.position[choice.axis];
    const end = start + cube.size[choice.axis];
    const coordinate = firstPoint[choice.axis];
    return coordinate > Math.min(start, end) + 1e-6 && coordinate < Math.max(start, end) - 1e-6;
  }) : choices;
  valid.sort((left, right) => left.distance - right.distance);
  return valid[0]?.axis ?? null;
}
