import { isCubeFaceCulled } from '../common/core/geometry-utils.js';
import { cross3, dot3 } from '../utils/math/vector3.js';

export const paintSymmetryRelationCache = new Map();
const paintSymmetryBuildScheduled = new Set();

function faceNormal(points) {
  const first = points[2].map((value, axis) => value - points[0][axis]);
  const second = points[1].map((value, axis) => value - points[0][axis]);
  const normal = cross3(first, second);
  const length = Math.hypot(...normal);
  return length > 1e-9 ? normal.map(value => value / length) : null;
}

export function createPaintSymmetryController({ state, sceneRenderer, faceUvPixelSlots, symmetryModifierAngles,
  mirrorControllerWorldFrame, barycentricPoint, renderInspector, PAINT_FACE_EDGES }) {
  function paintSymmetryScopeUids(owner) {
    return new Set(owner?.type === 'group' ? state.project.getDescendantElementUids(owner.uid) : owner ? [owner.uid] : []);
  }

  function paintSymmetryFaceKey(face) {
    return `${face.uid}::${face.cubeUid || face.uid}::${face.faceName}`;
  }

  function paintSymmetryFaceRecords(owner) {
    return sceneRenderer.getFaceQuadsForUids(paintSymmetryScopeUids(owner), { modelSpace: true }).flatMap(face => {
      const cube = face.cube?.type === 'cube' ? face.cube : state.project.getNode(face.uid);
      if (cube?.type !== 'cube' || isCubeFaceCulled(cube.faces?.[face.faceName])) return [];
      const uvSlots = faceUvPixelSlots(cube, face.faceName);
      if (!uvSlots) return [];
      return [{ ...face, cube, uvSlots, normal: faceNormal(face.facePoints), key: paintSymmetryFaceKey(face) }];
    });
  }

  function paintSymmetryFramePoint(frame, point) {
    const offset = point.map((value, axis) => value - frame.origin[axis]);
    return frame.axes.map(axis => dot3(offset, axis));
  }

  function paintSymmetryWorldPoint(frame, point) {
    return frame.origin.map((value, axis) => value
      + frame.axes[0][axis] * point[0]
      + frame.axes[1][axis] * point[1]
      + frame.axes[2][axis] * point[2]);
  }

  function paintSymmetryTransformedNormal(frame, normal, transform) {
    if (!normal) return null;
    const local = frame.axes.map(axis => dot3(normal, axis));
    const mirrored = transform(local);
    return [0, 1, 2].map(axis => frame.axes.reduce((sum, direction, index) =>
      sum + direction[axis] * mirrored[index], 0));
  }

  function paintSymmetryTransforms(operator) {
    const transforms = [];
    if (operator.mode === 'axes') {
      const enabled = ['x', 'y', 'z'].map(axis => operator.axes?.[axis] === true);
      for (let mask = 1; mask < 8; mask++) {
        if ([0, 1, 2].some(axis => (mask & (1 << axis)) && !enabled[axis])) continue;
        transforms.push(point => point.map((value, axis) => mask & (1 << axis) ? -value : value));
      }
      return transforms;
    }
    const angles = symmetryModifierAngles(operator);
    const rotate = (point, degrees) => {
      const angle = degrees * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
      return [point[0] * cosine + point[2] * sine, point[1], -point[0] * sine + point[2] * cosine];
    };
    for (const degrees of angles) {
      if (Math.abs(((degrees % 360) + 360) % 360) > 1e-6) transforms.push(point => rotate(point, degrees));
      if (operator.mode === 'mandala') {
        // R(angle) composed with reflection across local X gives a reflection
        // axis at half that angle, producing all N distinct mandala reflections.
        const angle = -degrees * Math.PI / 360;
        const axis = [Math.cos(angle), Math.sin(angle)];
        transforms.push(point => {
          const projection = point[0] * axis[0] + point[2] * axis[1];
          return [2 * axis[0] * projection - point[0], point[1], 2 * axis[1] * projection - point[2]];
        });
      }
    }
    return transforms;
  }

  function paintSymmetryPermutation(points, candidate, tolerance) {
    const used = new Set(), permutation = [];
    for (const point of points) {
      let best = -1, distance = Infinity;
      for (let index = 0; index < candidate.length; index++) {
        if (used.has(index)) continue;
        const next = Math.hypot(...point.map((value, axis) => value - candidate[index][axis]));
        if (next < distance) {
          distance = next;
          best = index;
        }
      }
      if (best < 0 || distance > tolerance) return null;
      used.add(best);
      permutation.push(best);
    }
    return permutation;
  }

  function paintSymmetryUvEdgesMatch(source, target, permutation) {
    const edgeKey = (first, second) => first < second ? `${first}:${second}` : `${second}:${first}`;
    const targetEdges = new Set(PAINT_FACE_EDGES.map(edge => edgeKey(edge[0], edge[1])));
    return PAINT_FACE_EDGES.every(([first, second]) => {
      const targetFirst = permutation[first], targetSecond = permutation[second];
      if (!targetEdges.has(edgeKey(targetFirst, targetSecond))) return false;
      const sourceLength = Math.hypot(source.uvSlots[first][0] - source.uvSlots[second][0], source.uvSlots[first][1] - source.uvSlots[second][1]);
      const targetLength = Math.hypot(target.uvSlots[targetFirst][0] - target.uvSlots[targetSecond][0], target.uvSlots[targetFirst][1] - target.uvSlots[targetSecond][1]);
      return Math.abs(sourceLength - targetLength) <= Math.max(1e-4, Math.max(sourceLength, targetLength) * 1e-5);
    });
  }

  function paintSymmetryCenterKey(points) {
    return [0, 1, 2].map(axis => Math.round(points.reduce((sum, point) => sum + point[axis], 0) / points.length * 1e4)).join(':');
  }

  function paintSymmetryCacheSignature(owner, operator, records, frame) {
    const geometry = records.map(record => `${record.key}:${record.facePoints.map(point => paintSymmetryFramePoint(frame, point).map(value => value.toFixed(4)).join(',')).join(';')}:${record.uvSlots.map(point => point.map(value => Number(value).toFixed(4)).join(',')).join(';')}`).sort();
    return JSON.stringify({
      owner: owner.uid, mode: operator.mode, axes: operator.axes, copies: operator.copies,
      distribution: operator.distribution, rangeStart: operator.rangeStart, rangeEnd: operator.rangeEnd,
      geometry
    });
  }

  function buildPaintSymmetryRelationsForFace(cache, key) {
    if (cache.relations.has(key)) return cache.relations.get(key);
    const source = cache.records.get(key);
    if (!source) return [];
    const relations = [];
    const seen = new Set();
    const coordinateScale = Math.max(1, ...source.facePoints.flatMap(point => point.map(value => Math.abs(value))));
    const tolerance = Math.max(1e-4, coordinateScale * 1e-5);
    for (const transform of cache.transforms) {
      const transformed = source.facePoints.map(point => paintSymmetryWorldPoint(cache.frame,
        transform(paintSymmetryFramePoint(cache.frame, point))));
      const transformedNormal = paintSymmetryTransformedNormal(cache.frame, source.normal, transform);
      if (!transformedNormal) continue;
      const candidates = cache.centerBuckets.get(paintSymmetryCenterKey(transformed)) || [];
      for (const target of candidates) {
        if (!target.normal || dot3(transformedNormal, target.normal) < .99999) continue;
        const permutation = paintSymmetryPermutation(transformed, target.facePoints, tolerance);
        if (!permutation || !paintSymmetryUvEdgesMatch(source, target, permutation)) continue;
        const relationKey = `${target.key}:${permutation.join('')}`;
        if (seen.has(relationKey)) continue;
        seen.add(relationKey);
        relations.push({ targetKey: target.key, permutation });
      }
    }
    cache.relations.set(key, relations);
    cache.relationCount += relations.length;
    return relations;
  }

  function beginPaintSymmetryBackgroundBuild(cache) {
    if (cache.building) return;
    cache.building = true;
    const keys = [...cache.records.keys()];
    let index = 0;
    const chunk = () => {
      const end = Math.min(keys.length, index + 10);
      while (index < end) buildPaintSymmetryRelationsForFace(cache, keys[index++]);
      if (index < keys.length) setTimeout(chunk, 0);
      else {
        cache.building = false;
        if (state.inspectorPage === 'operators') renderInspector();
      }
    };
    setTimeout(chunk, 0);
  }

  function schedulePaintSymmetryBuild(owner, operator) {
    if (!owner || !operator?.enabled || paintSymmetryBuildScheduled.has(operator.uid)) return;
    paintSymmetryBuildScheduled.add(operator.uid);
    requestAnimationFrame(() => {
      paintSymmetryBuildScheduled.delete(operator.uid);
      if (operator.enabled && owner.operators?.includes(operator) && state.project.getNode(owner.uid) === owner) ensurePaintSymmetryCache(owner, operator);
    });
  }

  function scheduleAllPaintSymmetryBuilds() {
    for (const owner of [...(state.project.groups || []), ...(state.project.elements || [])]) {
      for (const operator of owner.operators || []) {
        if (operator.enabled && operator.type === 'paint_symmetry') schedulePaintSymmetryBuild(owner, operator);
      }
    }
  }

  function ensurePaintSymmetryCache(owner, operator, session = null) {
    const sessionCache = session?.paintSymmetryCaches?.get(operator.uid);
    if (sessionCache) return sessionCache;
    const frame = mirrorControllerWorldFrame(owner, operator);
    if (!frame) return null;
    const records = paintSymmetryFaceRecords(owner);
    const signature = paintSymmetryCacheSignature(owner, operator, records, frame);
    let cache = paintSymmetryRelationCache.get(operator.uid);
    if (cache?.signature === signature) {
      cache.frame = frame;
      cache.records = new Map(records.map(record => [record.key, record]));
      cache.centerBuckets = new Map();
      for (const record of records) {
        const key = paintSymmetryCenterKey(record.facePoints);
        const bucket = cache.centerBuckets.get(key) || [];
        bucket.push(record);
        cache.centerBuckets.set(key, bucket);
      }
      session?.paintSymmetryCaches?.set(operator.uid, cache);
      return cache;
    }
    cache = {
      signature, owner, operator, frame,
      records: new Map(records.map(record => [record.key, record])),
      relations: new Map(), transforms: paintSymmetryTransforms(operator),
      relationCount: 0, building: false
    };
    cache.centerBuckets = new Map();
    for (const record of records) {
      const key = paintSymmetryCenterKey(record.facePoints);
      const bucket = cache.centerBuckets.get(key) || [];
      bucket.push(record);
      cache.centerBuckets.set(key, bucket);
    }
    paintSymmetryRelationCache.set(operator.uid, cache);
    beginPaintSymmetryBackgroundBuild(cache);
    session?.paintSymmetryCaches?.set(operator.uid, cache);
    return cache;
  }

  function paintSymmetryOperatorsForUid(uidValue, session = null) {
    if (!session?.paintSymmetryOperatorScopes) {
      const owners = [...(state.project.groups || []), ...(state.project.elements || [])];
      const scopes = owners.flatMap(owner => {
        const operators = (owner.operators || []).filter(operator => operator.enabled && operator.type === 'paint_symmetry');
        return operators.length ? [{ owner, operators, uids: paintSymmetryScopeUids(owner) }] : [];
      });
      if (session) session.paintSymmetryOperatorScopes = scopes;
      else return scopes.filter(scope => scope.uids.has(uidValue)).flatMap(scope => scope.operators.map(operator => ({ owner: scope.owner, operator })));
    }
    return session.paintSymmetryOperatorScopes.filter(scope => scope.uids.has(uidValue))
      .flatMap(scope => scope.operators.map(operator => ({ owner: scope.owner, operator })));
  }

  function paintSymmetryMappedHit(sourceHit, sourceRecord, targetRecord, permutation) {
    const sourceOffset = sceneRenderer.paintExplodeOffsets.get(sourceHit.uid) || [0, 0, 0];
    const targetOffset = sceneRenderer.paintExplodeOffsets.get(targetRecord.uid) || [0, 0, 0];
    const modelPoint = sourceHit.modelPoint || sourceHit.point.map((value, axis) => value - sourceOffset[axis]);
    const triangles = [[0, 2, 1], [2, 3, 1]];
    for (const indices of triangles) {
      const weights = barycentricPoint(modelPoint,
        sourceRecord.facePoints[indices[0]], sourceRecord.facePoints[indices[1]], sourceRecord.facePoints[indices[2]]);
      if (!weights) continue;
      const mappedModelPoint = [0, 1, 2].map(axis => indices.reduce((sum, slot, index) =>
        sum + targetRecord.facePoints[permutation[slot]][axis] * weights[index], 0));
      const point = mappedModelPoint.map((value, axis) => value + targetOffset[axis]);
      return {
        uid: targetRecord.uid, cubeUid: targetRecord.cubeUid, cubeIndex: targetRecord.cubeIndex,
        cube: targetRecord.cube, faceName: targetRecord.faceName,
        facePoints: targetRecord.facePoints.map(entry => entry.map((value, axis) => value + targetOffset[axis])), point,
        modelPoint: mappedModelPoint,
        symmetryPermutation: (sourceHit.symmetryPermutation || [0, 1, 2, 3]).map(slot => permutation[slot]),
        symmetryInstanceKey: `${targetRecord.key}:${(sourceHit.symmetryPermutation || [0, 1, 2, 3]).map(slot => permutation[slot]).join(',')}`
      };
    }
    return null;
  }

  function paintSymmetryRelatedHits(hit, session = null) {
    const resultKey = paintHit => `${paintSymmetryFaceKey(paintHit)}:${(paintHit.symmetryPermutation || [0, 1, 2, 3]).join(',')}`;
    const result = new Map([[resultKey(hit), hit]]);
    const queue = [hit];
    while (queue.length) {
      const sourceHit = queue.shift();
      for (const { owner, operator } of paintSymmetryOperatorsForUid(sourceHit.uid, session)) {
        const cache = ensurePaintSymmetryCache(owner, operator, session);
        const sourceKey = paintSymmetryFaceKey(sourceHit);
        const sourceRecord = cache?.records.get(sourceKey);
        if (!sourceRecord) continue;
        // A face requested by a live stroke jumps ahead of the background build.
        for (const relation of buildPaintSymmetryRelationsForFace(cache, sourceKey)) {
          const targetRecord = cache.records.get(relation.targetKey);
          if (!targetRecord) continue;
          const mapped = paintSymmetryMappedHit(sourceHit, sourceRecord, targetRecord, relation.permutation);
          if (!mapped) continue;
          const key = resultKey(mapped);
          if (result.has(key)) continue;
          result.set(key, mapped);
          queue.push(mapped);
        }
      }
    }
    return [...result.values()];
  }
  return {
    paintSymmetryFaceKey, paintSymmetryRelatedHits, scheduleAllPaintSymmetryBuilds,
    schedulePaintSymmetryBuild, ensurePaintSymmetryCache
  };
}
