import { animationGroupPoint } from './model.js';
import { matrixDeterminant } from '../model/transform-math.js';
import { identity, multiply, transform, rayTriangleDistance, projectScreenPoint, normalizeScreenRect, screenPolygonIntersectsRect } from '../render/viewport-math.js';
import { queryFaceBvh } from '../render/face-bvh.js';
import { getMinecraftRenderType, getSurfaceRenderMode, RenderPass } from '../render/render-types.js';
import { projectCullsBackfaces, faceAcceptsInteraction } from '../render/face-culling.js';

const point = (matrix, p) => transform(matrix, [...p, 1]).slice(0, 3);
const affine4 = ({ matrix: m, translation: t }) => [m[0][0], m[1][0], m[2][0], 0, m[0][1], m[1][1], m[2][1], 0, m[0][2], m[1][2], m[2][2], 0, ...t, 1];
function inverse(matrix) {
  const m = [[matrix[0], matrix[4], matrix[8]], [matrix[1], matrix[5], matrix[9]], [matrix[2], matrix[6], matrix[10]]];
  if (Math.abs(matrixDeterminant(m)) < 1e-10) return null;
  const [a, b, c] = m, determinant = matrixDeterminant(m);
  const inverseMatrix = [
    [b[1] * c[2] - b[2] * c[1], a[2] * c[1] - a[1] * c[2], a[1] * b[2] - a[2] * b[1]],
    [b[2] * c[0] - b[0] * c[2], a[0] * c[2] - a[2] * c[0], a[2] * b[0] - a[0] * b[2]],
    [b[0] * c[1] - b[1] * c[0], a[1] * c[0] - a[0] * c[1], a[0] * b[1] - a[1] * b[0]]
  ].map(row => row.map(value => value / determinant));
  const translation = inverseMatrix.map(row => -row.reduce((sum, value, i) => sum + value * matrix[12 + i], 0));
  return affine4({ matrix: inverseMatrix, translation });
}
function groupMatrix(group) {
  const origin = animationGroupPoint([0, 0, 0], group);
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(unit => animationGroupPoint(unit, group).map((value, i) => value - origin[i]));
  return [...axes[0], 0, ...axes[1], 0, ...axes[2], 0, ...origin, 1];
}
function mergeVertices(source, ranges) {
  const result = new Float32Array(ranges.reduce((sum, range) => sum + range.count * 12, 0));
  let offset = 0;
  for (const range of ranges) {
    result.set(source.slice(range.start * 12, (range.start + range.count) * 12), offset);
    offset += range.count * 12;
  }
  return result;
}

// The editor's rest meshes remain untouched. A bounded idle job copies their
// existing vertices into group batches; animation only uploads matrix uniforms.
export class AnimationMeshCache {
  constructor(renderer) { this.renderer = renderer; this.generation = 0; this.entries = []; }
  invalidate() { this.generation++; this.source = null; }
  ready(project, source) { return this.project === project && this.source === source && this.builtGeneration === this.generation; }
  ensure(project, source, instances = []) {
    if (source && this.source === source && this.builtGeneration === this.generation) { this.project = project; this.instances = instances; return; }
    if (!source || this.ready(project, source) || this.pending?.source === source && this.pending.generation === this.generation) return;
    const { renderer } = this, generation = this.generation;
    const grouped = new Map();
    for (const element of project.elements) {
      const uid = project.getParentGroup(element.uid)?.uid || null;
      if (!grouped.has(uid)) grouped.set(uid, []);
      grouped.get(uid).push(element.uid);
    }
    const queue = [...grouped], entries = [], pending = { source, generation };
    this.pending = pending;
    // Capture rest transforms without changing persistent group properties.
    const poses = project.groups.map(group => [group, group._animationPose]);
    poses.forEach(([group]) => { delete group._animationPose; });
    const restWorld = new Map();
    const world = uid => {
      if (!uid) return identity();
      if (restWorld.has(uid)) return restWorld.get(uid);
      const group = project.getNode(uid), parent = project.getParentGroup(uid);
      const matrix = multiply(world(parent?.uid), groupMatrix(group));
      restWorld.set(uid, matrix); return matrix;
    };
    for (const [uid] of queue) world(uid);
    poses.forEach(([group, pose]) => { if (pose) Object.defineProperty(group, '_animationPose', { value: pose, configurable: true, writable: true }); });
    const release = items => items.forEach(entry => { renderer.gl.deleteBuffer(entry.triangles); renderer.gl.deleteBuffer(entry.edges); });
    const schedule = callback => typeof requestIdleCallback === 'function' ? requestIdleCallback(callback, { timeout: 100 }) : setTimeout(callback, 0);
    const work = () => {
      if (this.pending !== pending || this.generation !== generation || renderer.staticCache !== source) { release(entries); return; }
      const started = performance.now();
      while (queue.length && performance.now() - started < 4) {
        const [uid, uids] = queue.shift(), triangles = renderer.gl.createBuffer(), edges = renderer.gl.createBuffer();
        const triangleData = mergeVertices(source.triangles, uids.map(id => source.triangleRanges.get(id)).filter(Boolean));
        const edgeData = mergeVertices(source.edges, uids.map(id => source.edgeRanges.get(id)).filter(Boolean));
        renderer.uploadBuffer(triangles, triangleData, renderer.gl.STATIC_DRAW);
        renderer.uploadBuffer(edges, edgeData, renderer.gl.STATIC_DRAW);
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (const id of uids) for (const p of source.ownerPoints.get(id) || []) for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]);
        }
        const bounds = Number.isFinite(min[0]) ? Array.from({ length: 8 }, (_, bits) => min.map((value, axis) => bits & (1 << axis) ? max[axis] : value)) : [];
        entries.push({ uid, uids: new Set(uids), triangles, edges, triangleCount: triangleData.length / 12, edgeCount: edgeData.length / 12,
          bounds, inverseRest: uid ? inverse(restWorld.get(uid)) : identity() });
      }
      if (queue.length) return schedule(work);
      release(this.entries); this.entries = entries; this.source = source; this.project = project;
      this.poseProject = null; this.poses = null;
      this.instances = instances; this.builtGeneration = generation; this.pending = null;
      this.onReady?.();
    };
    schedule(work);
  }
  updateMatrices() {
    const poses = this.project.groups.map(group => group._animationPose);
    if (this.poseProject === this.project && this.poses?.length === poses.length && poses.every((pose, i) => pose === this.poses[i])) return;
    this.poseProject = this.project; this.poses = poses; this.vertexCache = new Map();
    const worlds = new Map();
    const world = uid => {
      if (!uid) return identity();
      if (worlds.has(uid)) return worlds.get(uid);
      const group = this.project.getNode(uid), parent = this.project.getParentGroup(uid);
      const matrix = multiply(world(parent?.uid), groupMatrix(group));
      worlds.set(uid, matrix); return matrix;
    };
    for (const entry of this.entries) {
      entry.matrix = multiply(world(entry.uid), entry.inverseRest);
      entry.inverse = inverse(entry.matrix);
      entry.reflected = matrixDeterminant([[entry.matrix[0], entry.matrix[4], entry.matrix[8]], [entry.matrix[1], entry.matrix[5], entry.matrix[9]], [entry.matrix[2], entry.matrix[6], entry.matrix[10]]]) < 0;
    }
  }
  draw(camera, viewProjection, { baseOnly = false, generatedOnly = false } = {}) {
    this.updateMatrices();
    const renderer = this.renderer, { gl } = renderer, project = this.project;
    const pipeline = getMinecraftRenderType(project.renderType), wire = camera.renderMode === 'wireframe';
    const options = { cull: !wire && projectCullsBackfaces(project), renderMode: wire ? 0 : getSurfaceRenderMode(camera.renderMode),
      alphaMode: camera.renderMode === 'textured' ? pipeline.alphaMode : 0,
      blend: camera.renderMode === 'textured' && pipeline.pass === RenderPass.TRANSLUCENT };
    for (const entry of this.entries) {
      const selected = camera.selectedUids?.has(entry.uid) || entry.uid && project.getGroupChain(entry.uid).some(group => camera.selectedUids?.has(group.uid));
      if (!generatedOnly) renderer.drawBuffer(wire ? entry.edges : entry.triangles, wire ? entry.edgeCount : entry.triangleCount,
        wire ? gl.LINES : gl.TRIANGLES, viewProjection, { ...options, depthWrite: !options.blend, flipWinding: entry.reflected, modelTransform: entry.matrix });
      if (!generatedOnly && selected && !wire) renderer.drawBuffer(entry.edges, entry.edgeCount, gl.LINES, viewProjection,
        { depthWrite: false, cull: false, renderMode: 0, modelTransform: entry.matrix, colorOverride: [...renderer.selectionOutline, 1] });
      if (baseOnly || camera.modifierResultGhost) continue;
      for (const instance of this.instances || []) {
        const ranges = [];
        for (const uid of instance.sourceUids) if (entry.uids.has(uid)) {
          const source = instance.cubeIndices?.[uid];
          const key = wire ? 'cubeEdgeRanges' : 'cubeTriangleRanges';
          ranges.push(...(source ? source.map(i => this.source[key]?.get(uid)?.[i]).filter(Boolean)
            : [this.source[wire ? 'edgeRanges' : 'triangleRanges'].get(uid)]).filter(Boolean));
        }
        if (ranges.length) renderer.drawBuffer(wire ? renderer.staticWireBuffer : renderer.staticTriangleBuffer,
          ranges.reduce((sum, range) => sum + range.count, 0), wire ? gl.LINES : gl.TRIANGLES, viewProjection,
          { ...options, ranges, flipWinding: entry.reflected !== instance.reflected, modelTransform: multiply(entry.matrix, instance.transform) });
      }
    }
  }
  vertices(uid) {
    if (this.vertexCache?.has(uid)) return this.vertexCache.get(uid);
    const node = this.project.getNode(uid), uids = node?.type === 'group' ? this.project.getDescendantElementUids(uid) : [uid];
    const wanted = new Set(uids), result = [];
    for (const surface of this.surfaces()) for (const id of surface.uids) if (wanted.has(id)) {
      const points = surface.instance ? (surface.instance.cubeIndices?.[id] || (this.source.cubePoints.get(id) || []).map((_, i) => i))
        .flatMap(index => this.source.cubePoints.get(id)?.[index] || []) : this.source.ownerPoints.get(id) || [];
      for (const p of points) result.push({ uid: id, point: point(surface.matrix, p) });
    }
    this.vertexCache?.set(uid, result);
    return result;
  }
  pick(ray) {
    let best = null;
    for (const surface of this.surfaces(this.renderer.lastCameraInput?.modifierResultGhost !== true)) {
      if (!surface.inverse) continue;
      const origin = point(surface.inverse, ray.origin), end = point(surface.inverse, ray.origin.map((value, axis) => value + ray.direction[axis]));
      const direction = end.map((value, axis) => value - origin[axis]);
      for (const face of queryFaceBvh(this.source.faceBvh, { origin, direction })) {
        if (!surface.uids.has(face.uid) || !faceAcceptsInteraction(face, this.project, direction)) continue;
        if (surface.instance?.cubeIndices?.[face.uid] && !surface.instance.cubeIndices[face.uid].includes(face.cubeIndex ?? 0)) continue;
        const quad = face.quad.map(p => point(surface.matrix, p));
        for (const [a, b, c] of [[0, 2, 1], [2, 3, 1]]) {
          const distance = rayTriangleDistance(ray.origin, ray.direction, quad[a], quad[b], quad[c]);
          if (distance !== null && distance > 0 && (!best || distance < best.distance)) best = { uid: face.uid, faceName: face.faceName, distance, point: ray.origin.map((v, i) => v + ray.direction[i] * distance), facePoints: quad };
        }
      }
    }
    return best;
  }
  projectionExtent(selection, origin, axis) {
    let extent = 0;
    for (const entry of this.entries) {
      if (!selection.has(entry.uid) && !(entry.uid && this.project.getGroupChain(entry.uid).some(group => selection.has(group.uid)))) continue;
      for (const p of entry.bounds) {
        const world = point(entry.matrix, p);
        extent = Math.max(extent, Math.abs(world.reduce((sum, value, index) => sum + (value - origin[index]) * axis[index], 0)));
      }
    }
    return extent;
  }
  selectRect(rect, matrix, viewport) {
    const result = new Set(), box = normalizeScreenRect(rect);
    for (const surface of this.surfaces(this.renderer.lastCameraInput?.modifierResultGhost !== true)) for (const uid of surface.uids) {
      const points = (this.source.ownerPoints.get(uid) || []).map(p => projectScreenPoint(point(surface.matrix, p), matrix, viewport.width, viewport.height));
      if (points.length && points.some(p => !p.behind) && screenPolygonIntersectsRect(points, box)) result.add(uid);
    }
    return [...result];
  }
  *surfaces(includeGenerated = true) {
    for (const entry of this.entries) {
      yield entry;
      if (!includeGenerated) continue;
      for (const instance of this.instances || []) {
        const uids = new Set(instance.sourceUids.filter(uid => entry.uids.has(uid)));
        if (!uids.size) continue;
        const matrix = multiply(entry.matrix, instance.transform);
        yield { uids, matrix, inverse: inverse(matrix), instance };
      }
    }
  }
}
