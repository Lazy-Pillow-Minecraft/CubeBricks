import { CurveNode } from '../model.js';
import { applyGroupTransforms } from '../render/webgl-renderer.js';
import { rotateVector, inverseRotateVector } from '../utils/math/rotation.js';
import { normalize3 } from '../utils/math/vector3.js';

export function createCurvePlacementController({
  state, sceneCanvas, sceneRenderer, intersectRayPlane, snapValue,
  snapshot, discardSubdivisionEdits, markDirty, renderAll, toast,
  worldPointToParentLocal
}) {
function addCurveNodeAtViewportPoint(curve, event, rect = sceneCanvas.getBoundingClientRect()) {
  if (state.mode === 'paint') return;
  const selectedIndex = Math.max(0, Math.min(curve.nodes.length - 1, state.selectedCurveNodeIndex));
  const selectedWorld = sceneRenderer.getCurveNodeWorldPoints(state.project, curve.uid)[selectedIndex]?.point;
  if (!selectedWorld) return;
  const frame = sceneRenderer.getCameraFrame();
  const ray = sceneRenderer.getScreenRay(event.clientX - rect.left, event.clientY - rect.top);
  const plane = curve.dimension === 2 ? getCurveWorldPlane(curve, selectedWorld) : { point: selectedWorld, normal: frame.forward };
  const intersection = intersectRayPlane(ray, plane.point, plane.normal);
  if (!intersection) return toast('無法在目前視覺平面建立節點');
  const local = worldPointToCurveLocal(curve, intersection).map(value => snapValue(value, {}));
  if (curve.dimension === 2) local[1] = 0;
  const node = new CurveNode({ position: local }, curve.dimension === 2);
  const insertionIndex = selectedIndex === 0 ? 0 : selectedIndex + 1;
  snapshot('core.curve.node_add');
  discardSubdivisionEdits(curve);
  curve.nodes.splice(insertionIndex, 0, node);
  state.selectedCurveNodeIndex = insertionIndex;
  markDirty(); renderAll('selection'); toast('已建立並連接新節點');
}

function worldPointToCurveLocal(curve, worldPoint) {
  const parentPoint = worldPointToParentLocal(curve, worldPoint);
  return inverseRotateVector(parentPoint.map((value, axis) => value - curve.origin[axis]), curve.rotation || [0, 0, 0]);
}

function getCurveWorldPlane(curve, planePoint = null) {
  const chain = state.project.getGroupChain(curve.uid);
  const originWorld = applyGroupTransforms(curve.origin, chain);
  const normalParentPoint = curve.origin.map((value, axis) => value + rotateVector([0, 1, 0], curve.rotation || [0, 0, 0])[axis]);
  const normalWorldPoint = applyGroupTransforms(normalParentPoint, chain);
  return {
    point: planePoint ? [...planePoint] : originWorld,
    normal: normalize3(normalWorldPoint.map((value, axis) => value - originWorld[axis]))
  };
}

return {
  addCurveNodeAtViewportPoint,
  worldPointToCurveLocal,
  getCurveWorldPlane,
};
}
