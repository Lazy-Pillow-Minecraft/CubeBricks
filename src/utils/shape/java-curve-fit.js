import { rotateVector, inverseRotateVector } from '../math/rotation.js';

// Legal single-axis beams approximate the sampled path, not its occupied
// volume. Subdivide only when angular error would move the path outside the
// original cross-section; never enlarge that cross-section to enclose a box.
export function fitLimitedCurveCubes(cubes, { toWorld, toLocal, fitCube, maxCubes = 10000 }) {
  const result = [], originalDirections = [], budget = Math.max(maxCubes, cubes.length);
  const append = (cube, direction) => { result.push(cube); originalDirections.push(direction); };
  for (let index = 0; index < cubes.length; index++) {
    const source = cubes[index], world = toWorld(source), fitted = fitCube(source);
    const forward = rotateVector([0, 0, 1], world.rotation);
    if (world.size.slice(0, 2).some(value => Math.abs(value) < 1e-7)) { append(fitted, forward); continue; }
    const legal = toWorld(fitted);
    const drift = inverseRotateVector(forward, legal.rotation);
    const length = Math.abs(world.size[2]);
    const maxSpan = Math.min(...[0, 1].map(axis => Math.abs(drift[axis]) < 1e-7 ? Infinity
      : Math.max(1e-6, Math.abs(world.size[axis])) * .75 / Math.abs(drift[axis])));
    const count = Math.max(1, Math.min(Math.ceil(length / maxSpan), budget - result.length - (cubes.length - index - 1)));
    if (count === 1) { append(fitted, forward); continue; }
    const center = rotateVector(world.position.map((value, axis) => value + world.size[axis] / 2 - world.pivot[axis]), world.rotation)
      .map((value, axis) => value + world.pivot[axis]);
    for (let part = 0; part < count; part++) {
      const pivot = center.map((value, axis) => value + forward[axis] * world.size[2] * ((part + .5) / count - .5));
      const size = [...legal.size]; size[2] /= count;
      const child = toLocal({ ...structuredClone(legal), pivot, size,
        position: pivot.map((value, axis) => value - size[axis] / 2) });
      append(fitCube(child), forward);
    }
  }
  const world = result.map(toWorld), directions = world.map(cube => rotateVector([0, 0, 1], cube.rotation));
  const extensions = world.map(() => [0, 0]);
  const miter = (a, b, width) => {
    const cosine = Math.max(-1, Math.min(1, a.reduce((sum, value, axis) => sum + value * b[axis], 0)));
    const angle = Math.min(Math.acos(cosine), Math.PI - .02);
    return Math.min(width * 4, width * .5 * Math.tan(angle / 2));
  };
  for (let index = 1; index < world.length; index++) {
    const width = Math.max(...world[index - 1].size.slice(0, 2).map(Math.abs), ...world[index].size.slice(0, 2).map(Math.abs));
    const extra = miter(directions[index - 1], directions[index], width)
      - miter(originalDirections[index - 1], originalDirections[index], width);
    // Snapping can turn a gentle joint into a larger bend. Fill its outer
    // wedge along the beams, keeping their cross-sections unchanged.
    if (extra > 1e-7) { extensions[index - 1][1] = extra; extensions[index][0] = extra; }
  }
  world.forEach((cube, index) => {
    const [start, end] = extensions[index];
    if (!start && !end) return;
    const sign = cube.size[2] < 0 ? -1 : 1;
    cube.position[2] -= sign * start; cube.size[2] += sign * (start + end);
    result[index] = fitCube(toLocal(cube));
  });
  return result;
}
