import { getBlockbenchBoxUv } from '../render/webgl-renderer.js';
import { setPivotPreservingGeometry } from '../model.js';
import { dot3, cross3, normalize3 } from '../utils/math/vector3.js';
import { inverseRotateVector, quaternionFromAxisAngle, quaternionMultiply, quaternionFromEuler, eulerFromQuaternion } from '../utils/math/rotation.js';

export function createTransformGeometry({
  state, CUBE_FACE_NAMES, isShapeElement, isBezierElement,
  captureGroupMembers, selected, updateToolOptions, renderScene,
  toast, snapshot, markDirty, invalidateAllRenderGeometry, renderAll
}) {
function freezeCubeUvs(cube, disableAutoUv = false) {
  const existing = cube.faces || {};
  cube.faces = Object.fromEntries(CUBE_FACE_NAMES.map(faceName => {
    const face = { ...(existing[faceName] || {}) };
    face.uv = Array.isArray(face.uv) && face.uv.length >= 4
      ? [...face.uv]
      : [...getBlockbenchBoxUv(cube, faceName)];
    return [faceName, face];
  }));
  if (disableAutoUv) cube.autoUv = false;
}

function translateItemByLocalDelta(item, delta) {
  if (item.type === 'cube') {
    item.position = item.position.map((value, axis) => value + delta[axis]);
    item.pivot = item.pivot.map((value, axis) => value + delta[axis]);
  } else if (item.origin) {
    item.origin = item.origin.map((value, axis) => value + delta[axis]);
    if (isShapeElement(item)) item.pivot = item.pivot.map((value, axis) => value + delta[axis]);
  }
  else if (item.position) item.position = item.position.map((value, axis) => value + delta[axis]);
  else if (item.type === 'group') {
    const members = captureGroupMembers(item);
    item.pivot = item.pivot.map((value, axis) => value + delta[axis]);
    members.forEach(member => {
      if (member.node.type === 'cube') {
        member.node.position = member.position.map((value, axis) => value + delta[axis]);
        member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
      } else if (member.node.origin) {
        member.node.origin = member.position.map((value, axis) => value + delta[axis]);
        if (isShapeElement(member.node) && member.pivot) member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
      }
      else if (member.node.position) member.node.position = member.position.map((value, axis) => value + delta[axis]);
      else member.node.pivot = member.position.map((value, axis) => value + delta[axis]);
    });
  }
}

function worldVectorToParentLocal(item, vector) {
  let local = [...vector];
  state.project.getGroupChain(item.uid).forEach(group => { local = inverseRotateVector(local, group.rotation || [0, 0, 0]); });
  return local;
}

function worldPointToParentLocal(item, worldPoint) {
  let local = [...worldPoint];
  for (const group of state.project.getGroupChain(item.uid)) {
    const offset = local.map((value, axis) => value - group.pivot[axis]);
    local = inverseRotateVector(offset, group.rotation || [0, 0, 0]).map((value, axis) => value + group.pivot[axis]);
  }
  return local;
}

function worldPointToCubeLocal(cube, worldPoint) {
  let local = worldPointToParentLocal(cube, worldPoint);
  const offset = local.map((value, axis) => value - cube.pivot[axis]);
  return inverseRotateVector(offset, cube.rotation || [0, 0, 0]).map((value, axis) => value + cube.pivot[axis]);
}

function movePivotToRotationVertex(pointEntry) {
  if (state.tool !== 'rotate' || !state.rotationVertexPick || !pointEntry?.point) return false;
  const item = state.project.getNode(pointEntry.targetUid);
  if (!item || !(['cube', 'group'].includes(item.type) || isShapeElement(item))) return false;
  const nextPivot = worldPointToParentLocal(item, pointEntry.point);
  if (nextPivot.every((value, axis) => Math.abs(value - item.pivot[axis]) < 1e-8)) return false;
  snapshot('core.element.pivot');
  setPivotPreservingGeometry(state.project, item, nextPivot);
  markDirty();
  renderAll();
  return true;
}

function quaternionFromVectors(from, to) {
  const first = normalize3(from), second = normalize3(to);
  const cosine = Math.max(-1, Math.min(1, dot3(first, second)));
  if (cosine < -0.999999) {
    const reference = Math.abs(first[0]) < .8 ? [1, 0, 0] : [0, 1, 0];
    return quaternionFromAxisAngle(normalize3(cross3(first, reference)), 180);
  }
  const axis = cross3(first, second);
  const quaternion = [...axis, 1 + cosine];
  const length = Math.hypot(...quaternion) || 1;
  return quaternion.map(value => value / length);
}

function vertexRotationTurn(from, to, mode) {
  if (mode === 'pivot') return quaternionFromVectors(from, to);
  let axisIndex = { x: 0, y: 1, z: 2 }[mode];
  if (mode === 'longest') {
    const cross = cross3(from, to);
    axisIndex = [0, 1, 2].reduce((best, axis) => Math.abs(cross[axis]) > Math.abs(cross[best]) ? axis : best, 0);
  }
  const axis = [0, 0, 0]; axis[axisIndex] = 1;
  const first = from.map((value, index) => index === axisIndex ? 0 : value);
  const second = to.map((value, index) => index === axisIndex ? 0 : value);
  if (Math.hypot(...first) < 1e-6 || Math.hypot(...second) < 1e-6) return null;
  const angle = Math.atan2(dot3(axis, cross3(first, second)), dot3(first, second)) * 180 / Math.PI;
  return quaternionFromAxisAngle(axis, angle);
}

function useVertexSnapPoint(pointEntry) {
  const currentItem = selected();
  if (!currentItem || !pointEntry) return;
  if (!state.vertexSnapSource) {
    if (pointEntry.targetOnly) return toast('交點只能作為目標點，請先選普通頂點或樞軸點');
    if (pointEntry.generated) return toast('修改器結果只能作為目標捕捉點');
    state.vertexSnapSource = { rootUid: currentItem.uid, uid: pointEntry.uid, pointType: pointEntry.pointType,
      nodeIndex: pointEntry.nodeIndex, point: [...pointEntry.point] };
    updateToolOptions();
    renderScene();
    return;
  }
  const sourceItem = state.project.getNode(state.vertexSnapSource.rootUid);
  if (!sourceItem) {
    state.vertexSnapSource = null;
    updateToolOptions();
    return;
  }
  if (state.vertexSnapMode === 'scale' && sourceItem.type !== 'cube') return toast('縮放捕捉目前只適用於 Cube');
  if (state.vertexSnapMode === 'rotate' && !sourceItem.rotation) return toast('這個物件不能旋轉捕捉');
  snapshot('core.element.vertex_snap');
  if (state.vertexSnapMode === 'move') {
    if (state.vertexSnapSource.pointType === 'curveNode' && isBezierElement(sourceItem)) {
      const node = sourceItem.nodes[state.vertexSnapSource.nodeIndex];
      const worldDelta = pointEntry.point.map((value, axis) => value - state.vertexSnapSource.point[axis]);
      let localDelta = worldVectorToParentLocal(sourceItem, worldDelta);
      localDelta = inverseRotateVector(localDelta, sourceItem.rotation || [0, 0, 0]);
      node.position = node.position.map((value, axis) => sourceItem.dimension === 2 && axis === 1 ? 0 : value + localDelta[axis]);
    } else if (state.vertexSnapSource.pointType === 'pivot' && (['cube', 'group'].includes(sourceItem.type) || isShapeElement(sourceItem))) {
      setPivotPreservingGeometry(state.project, sourceItem, worldPointToParentLocal(sourceItem, pointEntry.point));
    } else {
      const worldDelta = pointEntry.point.map((value, axis) => value - state.vertexSnapSource.point[axis]);
      translateItemByLocalDelta(sourceItem, worldVectorToParentLocal(sourceItem, worldDelta));
    }
  } else if (state.vertexSnapMode === 'scale') {
    if (sourceItem.autoUv === false) freezeCubeUvs(sourceItem);
    const sourcePoint = worldPointToCubeLocal(sourceItem, state.vertexSnapSource.point);
    const targetPoint = worldPointToCubeLocal(sourceItem, pointEntry.point);
    const nextPosition = [...sourceItem.position], nextSize = [...sourceItem.size];
    for (let axis = 0; axis < 3; axis++) {
      const start = sourceItem.position[axis], end = start + sourceItem.size[axis];
      if (Math.abs(sourcePoint[axis] - start) <= Math.abs(sourcePoint[axis] - end)) {
        nextPosition[axis] = targetPoint[axis];
        nextSize[axis] = end - targetPoint[axis];
      } else nextSize[axis] = targetPoint[axis] - start;
      if (!state.allowNegativeSize && nextSize[axis] < 0) {
        nextPosition[axis] += nextSize[axis];
        nextSize[axis] = Math.abs(nextSize[axis]);
      }
    }
    sourceItem.position = nextPosition;
    sourceItem.size = nextSize;
  } else {
    const pivot = sourceItem.pivot || sourceItem.origin || sourceItem.position;
    const sourcePoint = worldPointToParentLocal(sourceItem, state.vertexSnapSource.point);
    const targetPoint = worldPointToParentLocal(sourceItem, pointEntry.point);
    const from = sourcePoint.map((value, axis) => value - pivot[axis]);
    const to = targetPoint.map((value, axis) => value - pivot[axis]);
    const turn = Math.hypot(...from) > 1e-6 && Math.hypot(...to) > 1e-6
      ? vertexRotationTurn(from, to, state.vertexSnapRotationMode)
      : null;
    if (!turn) {
      state.history.pop();
      return toast('所選頂點無法建立旋轉方向');
    }
    sourceItem.rotation = eulerFromQuaternion(quaternionMultiply(turn, quaternionFromEuler(sourceItem.rotation || [0, 0, 0])));
  }
  const completedMode = state.vertexSnapMode;
  const movedPivotOnly = completedMode === 'move' && state.vertexSnapSource.pointType === 'pivot';
  state.vertexSnapSource = null;
  markDirty();
  invalidateAllRenderGeometry();
  renderAll();
  toast(movedPivotOnly ? '已將樞軸移至目標頂點（幾何保持不動）'
    : { move: '已移動至目標頂點', scale: '已縮放至目標頂點', rotate: '已旋轉對齊目標頂點' }[completedMode]);
}

function clamp(value, minimum, maximum) {
  return Math.max(Math.min(minimum, maximum), Math.min(Math.max(minimum, maximum), value));
}

return {
  movePivotToRotationVertex,
  freezeCubeUvs,
  translateItemByLocalDelta,
  worldVectorToParentLocal,
  worldPointToParentLocal,
  worldPointToCubeLocal,
  quaternionFromVectors,
  vertexRotationTurn,
  useVertexSnapPoint,
  clamp,
};
}
