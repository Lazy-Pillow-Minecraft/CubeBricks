const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;

function unitVector(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map(value => value / length);
}

function vectorCross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0]
  ];
}

function vectorDot(left, right) {
  return left.reduce((total, value, axis) => total + value * right[axis], 0);
}

function orderPolyhedronFace(points, normal) {
  const center = [0, 1, 2].map(axis => points.reduce((sum, point) => sum + point[axis], 0) / points.length);
  const basisU = unitVector(points[0].map((value, axis) => value - center[axis]));
  const basisV = unitVector(vectorCross(normal, basisU));
  const ordered = [...points].sort((left, right) => {
    const leftOffset = left.map((value, axis) => value - center[axis]);
    const rightOffset = right.map((value, axis) => value - center[axis]);
    return Math.atan2(vectorDot(leftOffset, basisV), vectorDot(leftOffset, basisU))
      - Math.atan2(vectorDot(rightOffset, basisV), vectorDot(rightOffset, basisU));
  });
  const winding = vectorDot(vectorCross(
    ordered[1].map((value, axis) => value - ordered[0][axis]),
    ordered[2].map((value, axis) => value - ordered[0][axis])
  ), normal);
  if (winding < 0) ordered.reverse();
  return { normal, vertices: ordered };
}

function convexPolyhedronFaces(vertices, verticesPerFace) {
  const faces = [];
  const seen = new Set();
  const epsilon = 1e-6;
  for (let first = 0; first < vertices.length - 2; first++) {
    for (let second = first + 1; second < vertices.length - 1; second++) {
      for (let third = second + 1; third < vertices.length; third++) {
        let normal = vectorCross(
          vertices[second].map((value, axis) => value - vertices[first][axis]),
          vertices[third].map((value, axis) => value - vertices[first][axis])
        );
        if (Math.hypot(...normal) < epsilon) continue;
        normal = unitVector(normal);
        const plane = vectorDot(normal, vertices[first]);
        const distances = vertices.map(vertex => vectorDot(normal, vertex) - plane);
        if (!distances.every(distance => distance <= epsilon) && !distances.every(distance => distance >= -epsilon)) continue;
        const indices = distances.map((distance, index) => Math.abs(distance) <= epsilon ? index : -1).filter(index => index >= 0);
        if (indices.length !== verticesPerFace) continue;
        const key = [...indices].sort((left, right) => left - right).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        const center = [0, 1, 2].map(axis => indices.reduce((sum, index) => sum + vertices[index][axis], 0) / indices.length);
        if (vectorDot(normal, center) < 0) normal = normal.map(value => -value);
        faces.push(orderPolyhedronFace(indices.map(index => vertices[index]), normal));
      }
    }
  }
  return faces;
}

function dodecahedronUnitFaces() {
  const inverse = 1 / GOLDEN_RATIO;
  const vertices = [
    ...[-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => [x, y, z]))),
    ...[-1, 1].flatMap(y => [-1, 1].map(z => [0, y * inverse, z * GOLDEN_RATIO])),
    ...[-1, 1].flatMap(x => [-1, 1].map(y => [x * inverse, y * GOLDEN_RATIO, 0])),
    ...[-1, 1].flatMap(x => [-1, 1].map(z => [x * GOLDEN_RATIO, 0, z * inverse]))
  ].map(unitVector);
  return convexPolyhedronFaces(vertices, 5);
}

export const DODECAHEDRON_UNIT_FACES = dodecahedronUnitFaces();

function truncatedIcosahedronUnitFaces() {
  const vertices = [
    ...[-1, 1].flatMap(y => [-1, 1].map(z => [0, y, z * GOLDEN_RATIO])),
    ...[-1, 1].flatMap(x => [-1, 1].map(y => [x, y * GOLDEN_RATIO, 0])),
    ...[-1, 1].flatMap(x => [-1, 1].map(z => [x * GOLDEN_RATIO, 0, z]))
  ].map(unitVector);
  const distances = [];
  for (let left = 0; left < vertices.length; left++) {
    for (let right = left + 1; right < vertices.length; right++) {
      const distance = Math.hypot(...vertices[left].map((value, axis) => value - vertices[right][axis]));
      if (distance > 1e-6) distances.push(distance);
    }
  }
  const edgeLength = Math.min(...distances);
  const adjacent = (left, right) => Math.abs(Math.hypot(...vertices[left].map((value, axis) => value - vertices[right][axis])) - edgeLength) < 1e-5;
  const directedPoint = (from, to) => unitVector(vertices[from].map((value, axis) => (value * 2 + vertices[to][axis]) / 3));
  const pentagons = vertices.map((vertex, index) => {
    const neighbors = vertices.map((_, candidate) => candidate).filter(candidate => adjacent(index, candidate));
    return orderPolyhedronFace(neighbors.map(neighbor => directedPoint(index, neighbor)), unitVector(vertex));
  });
  const hexagons = [];
  for (let first = 0; first < vertices.length; first++) {
    for (let second = first + 1; second < vertices.length; second++) {
      if (!adjacent(first, second)) continue;
      for (let third = second + 1; third < vertices.length; third++) {
        if (!adjacent(first, third) || !adjacent(second, third)) continue;
        const source = [vertices[first], vertices[second], vertices[third]];
        let normal = unitVector(vectorCross(
          source[1].map((value, axis) => value - source[0][axis]),
          source[2].map((value, axis) => value - source[0][axis])
        ));
        const center = [0, 1, 2].map(axis => source.reduce((sum, point) => sum + point[axis], 0) / 3);
        if (vectorDot(normal, center) < 0) normal = normal.map(value => -value);
        hexagons.push(orderPolyhedronFace([
          directedPoint(first, second), directedPoint(second, first),
          directedPoint(second, third), directedPoint(third, second),
          directedPoint(third, first), directedPoint(first, third)
        ], normal));
      }
    }
  }
  return [...pentagons, ...hexagons];
}

export const TRUNCATED_ICOSAHEDRON_UNIT_FACES = truncatedIcosahedronUnitFaces();

export function regularPolyhedronCubes(shape, unitFaces, mergeEvenFaces = false, { Cube, matrixEuler }) {
  const radius = Math.max(.001, Number(shape.parameters.radius) || 0);
  return unitFaces.flatMap((face, faceIndex) => {
    const vertices = face.vertices.map(point => point.map(value => value * radius));
    const center = [0, 1, 2].map(axis => vertices.reduce((sum, point) => sum + point[axis], 0) / vertices.length);
    const depth = Math.max(.001, Math.hypot(...center));
    const mergedOpposites = mergeEvenFaces && vertices.length % 2 === 0;
    const edgeCount = mergedOpposites ? vertices.length / 2 : vertices.length;
    return Array.from({ length: edgeCount }, (_, edgeIndex) => {
      const start = vertices[edgeIndex];
      const end = vertices[(edgeIndex + 1) % vertices.length];
      const edge = end.map((value, axis) => value - start[axis]);
      const edgeLength = Math.hypot(...edge);
      const edgeMidpoint = start.map((value, axis) => (value + end[axis]) / 2);
      const oppositeIndex = mergedOpposites ? (edgeIndex + vertices.length / 2) % vertices.length : -1;
      const oppositeStart = mergedOpposites ? vertices[oppositeIndex] : null;
      const oppositeEnd = mergedOpposites ? vertices[(oppositeIndex + 1) % vertices.length] : null;
      const oppositeMidpoint = mergedOpposites
        ? oppositeStart.map((value, axis) => (value + oppositeEnd[axis]) / 2)
        : null;
      const inward = mergedOpposites
        ? oppositeMidpoint.map((value, axis) => value - edgeMidpoint[axis])
        : center.map((value, axis) => value - edgeMidpoint[axis]);
      const faceSpan = Math.hypot(...inward);
      let xAxis = unitVector(edge);
      const yAxis = [...face.normal];
      const zAxis = unitVector(inward);
      if (vectorDot(vectorCross(xAxis, yAxis), zAxis) < 0) xAxis = xAxis.map(value => -value);
      const faceMidpoint = mergedOpposites
        ? edgeMidpoint.map((value, axis) => (value + oppositeMidpoint[axis]) / 2)
        : edgeMidpoint.map((value, axis) => value + zAxis[axis] * faceSpan / 2);
      const midpoint = faceMidpoint.map((value, axis) => value - yAxis[axis] * depth / 2);
      const size = [edgeLength, depth, faceSpan + Math.max(.001, edgeLength * .002)];
      const orientation = [0, 1, 2].map(row => [xAxis[row], yAxis[row], zAxis[row]]);
      return new Cube({
        name: `${shape.name}_${faceIndex + 1}_${edgeIndex + 1}`,
        position: midpoint.map((value, axis) => value - size[axis] / 2),
        size,
        pivot: midpoint,
        rotation: matrixEuler(orientation),
        uvMode: shape.uvMode,
        uvNormalized: shape.uvNormalized,
        autoUv: shape.autoUv,
        exported: shape.exported,
        locked: shape.locked,
        shade: shape.shade,
        color: shape.color
      });
    });
  });
}

