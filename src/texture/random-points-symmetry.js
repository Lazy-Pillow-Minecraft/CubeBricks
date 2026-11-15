// Copy one random raster through the same face and corner relationships used by
// paint symmetry. Work on a snapshot so a destination can never become a source.
const IDENTITY = [0, 1, 2, 3];

function uvCoordinates(slots, x, y) {
  const [origin, u, v] = [slots[0], slots[1], slots[2]];
  const ux = u[0] - origin[0], uy = u[1] - origin[1];
  const vx = v[0] - origin[0], vy = v[1] - origin[1];
  const determinant = ux * vy - uy * vx;
  if (Math.abs(determinant) < 1e-8) return null;
  const dx = x - origin[0], dy = y - origin[1];
  return [(dx * vy - dy * vx) / determinant, (ux * dy - uy * dx) / determinant];
}

function facePixels(slots, width, height, visit) {
  const left = Math.max(0, Math.floor(Math.min(...slots.map(slot => slot[0]))));
  const right = Math.min(width, Math.ceil(Math.max(...slots.map(slot => slot[0]))));
  const top = Math.max(0, Math.floor(Math.min(...slots.map(slot => slot[1]))));
  const bottom = Math.min(height, Math.ceil(Math.max(...slots.map(slot => slot[1]))));
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const coordinates = uvCoordinates(slots, x + .5, y + .5);
    if (coordinates && coordinates.every(value => value >= -1e-6 && value <= 1 + 1e-6)) {
      visit(x, y, coordinates);
    }
  }
}

export function copyRandomPointsToSymmetricFaces(canvas, graph, matchesTexture) {
  if (!graph?.relations?.size) return 0;
  const { width, height } = canvas;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const output = context.getImageData(0, 0, width, height);
  const source = new Uint8ClampedArray(output.data);
  const eligible = new Map([...graph.records].filter(([, record]) => matchesTexture(record)));
  const links = new Map();
  for (const [key, relations] of graph.relations) {
    if (!eligible.has(key)) continue;
    const filtered = relations.filter(relation => eligible.has(relation.targetKey));
    if (filtered.length) links.set(key, filtered);
  }
  const visitedFaces = new Set();
  let copiedFaces = 0;
  for (const start of links.keys()) {
    if (visitedFaces.has(start)) continue;
    const queue = [{ key: start, permutation: IDENTITY }];
    const states = new Map(), component = new Set();
    while (queue.length && states.size < 512) {
      const current = queue.shift();
      const stateKey = `${current.key}:${current.permutation.join('')}`;
      if (states.has(stateKey)) continue;
      states.set(stateKey, current);
      component.add(current.key);
      for (const relation of links.get(current.key) || []) {
        queue.push({
          key: relation.targetKey,
          permutation: current.permutation.map(index => relation.permutation[index])
        });
      }
    }
    for (const key of component) visitedFaces.add(key);
    const sourceFace = eligible.get(start);
    if (!sourceFace) continue;
    const sourcePixels = [];
    facePixels(sourceFace.uvSlots, width, height, (x, y, coordinates) => {
      const offset = (y * width + x) * 4;
      if (source[offset + 3]) sourcePixels.push({ coordinates, rgba: source.slice(offset, offset + 4) });
    });
    for (const key of component) {
      const face = eligible.get(key);
      facePixels(face.uvSlots, width, height, (x, y) => {
        output.data[(y * width + x) * 4 + 3] = 0;
      });
    }
    for (const { key, permutation } of states.values()) {
      const target = eligible.get(key);
      if (!target) continue;
      const a = target.uvSlots[permutation[0]];
      const b = target.uvSlots[permutation[1]];
      const c = target.uvSlots[permutation[2]];
      for (const pixel of sourcePixels) {
        const [u, v] = pixel.coordinates;
        const x = Math.floor(a[0] + u * (b[0] - a[0]) + v * (c[0] - a[0]));
        const y = Math.floor(a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]));
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        output.data.set(pixel.rgba, (y * width + x) * 4);
      }
    }
    copiedFaces += component.size;
  }
  if (copiedFaces) context.putImageData(output, 0, 0);
  return copiedFaces;
}
