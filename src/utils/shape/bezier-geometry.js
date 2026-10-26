export function bezierCubes(curve, { Cube, vectorLength, directionFrameEuler }) {
  const points = curve.sampleCurve();
  const thickness = Math.max(.01, Number(curve.parameters.thickness) || 1);
  const segments = [];
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index].point, end = points[index + 1].point;
    const delta = end.map((value, axis) => value - start[axis]);
    const length = vectorLength(delta);
    if (length < 1e-6) continue;
    const localThickness = curve.variant === 'envelope'
      ? Math.max(0, (Number(points[index].radius) + Number(points[index + 1].radius)))
      : thickness;
    segments.push({ start, end, length, thickness: localThickness,
      roll: (points[index].roll + points[index + 1].roll) / 2,
      direction: delta.map(value => value / length) });
  }
  const jointExtension = (left, right) => {
    if (!left || !right) return 0;
    const cosine = Math.max(-1, Math.min(1,
      left.direction.reduce((sum, value, axis) => sum + value * right.direction[axis], 0)));
    const turn = Math.acos(cosine);
    // Different cube widths also need a short overlap on a straight run;
    // otherwise the step at a radius node exposes the neighbour's end cap.
    const widthStep = Math.abs(left.thickness - right.thickness) / 2;
    if (turn < 1e-5) return widthStep;
    // Butt-ended cube columns leave a wedge on the outside of a bend. A
    // square-stroke miter closes it by extending both neighbours according
    // to their half-width and half of the turning angle. Cap pathological
    // near-reversals so an accidental cusp cannot create a huge cube.
    const width = Math.max(left.thickness, right.thickness);
    return widthStep + Math.min(width * 4, width * .5 * Math.tan(Math.min(turn, Math.PI - .02) / 2));
  };
  const cubes = [];
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const { start, end, direction } = segment;
    const width = segment.thickness;
    const startExtension = jointExtension(segments[index - 1], segment);
    const endExtension = jointExtension(segment, segments[index + 1]);
    const length = segment.length + startExtension + endExtension;
    const midpoint = start.map((value, axis) => (value + end[axis]) / 2
      + direction[axis] * (endExtension - startExtension) / 2);
    const rotation = directionFrameEuler(direction, segment.roll);
    cubes.push(new Cube({
      name: `${curve.name}_${index + 1}`,
      position: [midpoint[0] - width / 2, midpoint[1] - width / 2, midpoint[2] - length / 2],
      size: [width, width, length],
      pivot: midpoint,
      rotation,
      uvMode: curve.uvMode,
      uvNormalized: curve.uvNormalized,
      autoUv: curve.autoUv,
      exported: curve.exported,
      locked: curve.locked,
      shade: curve.shade,
      color: curve.color
    }));
  }
  return cubes;
}

