// Broad phase uses rounded bounds and signed dimensions. Coincident bounds
// still require an exact unordered-vertex comparison, including rotated boxes.
export class CubeOverlapIndex {
  constructor(worldVertices) {
    this.worldVertices = worldVertices; this.buckets = new Map();
    this.bounds = new WeakMap(); this.axisPermutations = new WeakMap();
  }
  key(source, affine = null) {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const matrix = affine?.matrix, translation = affine?.translation;
    let axes = affine && this.axisPermutations.get(affine);
    if (affine && axes === undefined) {
      axes = matrix.map(row => row.findIndex(value => value === 1 || value === -1));
      if (new Set(axes).size !== 3 || axes.some((axis, row) => axis < 0 || matrix[row].some((value, col) => col !== axis && value !== 0))) axes = null;
      this.axisPermutations.set(affine, axes);
    }
    let points;
    if (!matrix || axes) {
      let bounds = this.bounds.get(source);
      if (!bounds) {
        const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
        for (const point of this.worldVertices(source)) for (let axis = 0; axis < 3; axis++) {
          low[axis] = Math.min(low[axis], point[axis]); high[axis] = Math.max(high[axis], point[axis]);
        }
        bounds = [low, high]; this.bounds.set(source, bounds);
      }
      // Exact signed axis permutations map an AABB to another AABB. General
      // rotations still inspect all eight corners; no approximate shortcut.
      points = bounds;
    } else points = this.worldVertices(source);
    for (const point of points) {
      const x = Math.round((matrix ? matrix[0][0] * point[0] + matrix[0][1] * point[1] + matrix[0][2] * point[2] + translation[0] : point[0]) * 100000);
      const y = Math.round((matrix ? matrix[1][0] * point[0] + matrix[1][1] * point[1] + matrix[1][2] * point[2] + translation[1] : point[1]) * 100000);
      const z = Math.round((matrix ? matrix[2][0] * point[0] + matrix[2][1] * point[1] + matrix[2][2] * point[2] + translation[2] : point[2]) * 100000);
      minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
    }
    source.overlapSigns ||= source.cube.size.map(Math.sign).join(',');
    return { bucket: `${source.overlapSigns}:${minX},${minY},${minZ}:${maxX},${maxY},${maxZ}`, source, affine, signature: null };
  }
  signature(entry) {
    if (entry.signature) return entry.signature;
    const matrix = entry.affine?.matrix, translation = entry.affine?.translation;
    const keys = [];
    for (const point of this.worldVertices(entry.source)) {
      const x = Math.round((matrix ? matrix[0][0] * point[0] + matrix[0][1] * point[1] + matrix[0][2] * point[2] + translation[0] : point[0]) * 100000);
      const y = Math.round((matrix ? matrix[1][0] * point[0] + matrix[1][1] * point[1] + matrix[1][2] * point[2] + translation[1] : point[1]) * 100000);
      const z = Math.round((matrix ? matrix[2][0] * point[0] + matrix[2][1] * point[1] + matrix[2][2] * point[2] + translation[2] : point[2]) * 100000);
      keys.push(`${x},${y},${z}`);
    }
    return entry.signature = keys.sort().join('|');
  }
  has(entry) {
    const candidates = this.buckets.get(entry.bucket);
    return Boolean(candidates?.some(candidate => this.signature(candidate) === this.signature(entry)));
  }
  add(entry) {
    const candidates = this.buckets.get(entry.bucket);
    if (candidates) candidates.push(entry); else this.buckets.set(entry.bucket, [entry]);
  }
}
