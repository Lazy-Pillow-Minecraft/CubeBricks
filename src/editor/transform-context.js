import { applyGroupTransforms } from '../render/webgl-renderer.js';
import { dot3, cross3, normalize3 } from '../utils/math/vector3.js';
import { rotateVector, inverseRotateVector } from '../utils/math/rotation.js';

export function createTransformContext({
  state, $, $$, sceneRenderer, deepestCommonSelectionGroup,
  isBezierElement, isShapeElement, selected, selectedElementUids,
  selectedTopLevelNodes, subdivisionOwner
}) {
let selectionTransformContextCache = null;
function clearCache() { selectionTransformContextCache = null; }
function updateTransformSpaceButtons() {
  $$('[data-transform-space]').forEach(button => {
    const active = button.dataset.transformSpace === state.transformSpace;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function updateRotationModeButtons() {
  $$('[data-rotation-mode]').forEach(button => {
    const active = button.dataset.rotationMode === state.rotationMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function updateScaleHandleModeButtons() {
  $$('[data-scale-handle-mode]').forEach(button => {
    const active = button.dataset.scaleHandleMode === state.scaleHandleMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function updateMultiTransformModeButtons() {
  $$('[data-multi-transform-mode]').forEach(button => {
    const active = button.dataset.multiTransformMode === state.multiTransformMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}


function getTransformPivot(item) {
  const owner = subdivisionOwner(item);
  if (owner) {
    const ownerPivot = (owner.pivot || owner.origin).map((value, axis) => value - owner.origin[axis]);
    const localPoint = item.pivot || [0, 0, 0];
    const parentPoint = rotateVector(localPoint.map((value, axis) => value - ownerPivot[axis]), owner.rotation || [0, 0, 0])
      .map((value, axis) => value + ownerPivot[axis] + owner.origin[axis]);
    return applyGroupTransforms(parentPoint, state.project.getGroupChain(owner.uid));
  }
  const local = item.type === 'cube' || item.type === 'group' || isShapeElement(item) ? item.pivot : item.position || item.origin;
  return applyGroupTransforms(local, state.project.getGroupChain(item.uid));
}

function inverseApplyGroupTransforms(point, groupChain = []) {
  let transformed = [...point];
  for (const group of groupChain) {
    const offset = transformed.map((value, axis) => value - group.pivot[axis]);
    const rotated = inverseRotateVector(offset, group.rotation || [0, 0, 0]);
    transformed = rotated.map((value, axis) => value + group.pivot[axis]);
  }
  return transformed;
}

function selectedWorldPoints() {
  return selectedElementUids().flatMap(uidValue => sceneRenderer.getWorldVertices(state.project, uidValue).map(entry => entry.point));
}

function selectionGeometryCenter() {
  const cachedBounds = sceneRenderer.getSelectionBounds(state.project, state.selectedUids);
  if (cachedBounds) return cachedBounds.center;
  let points = selectedWorldPoints();
  if (!points.length) points = selectedTopLevelNodes().map(getTransformPivot).filter(Boolean);
  if (!points.length) return null;
  return [0, 1, 2].map(axis => {
    const values = points.map(point => point[axis]);
    return (Math.min(...values) + Math.max(...values)) / 2;
  });
}

function getSelectionTransformContext() {
  if (state.dragging?.type === 'transform' && state.dragging.batchPreview) return state.dragging.selectionContext;
  if (selectionTransformContextCache?.project === state.project
    && selectionTransformContextCache.selection === state.selectedUids
    && selectionTransformContextCache.size === state.selectedUids.size
    && selectionTransformContextCache.hierarchyRevision === state.project.hierarchyRevision) {
    return selectionTransformContextCache.context;
  }
  const nodes = selectedTopLevelNodes();
  const multiple = nodes.length > 1;
  const commonGroup = multiple ? deepestCommonSelectionGroup() : null;
  const center = multiple ? selectionGeometryCenter() : null;
  const averagePivot = multiple ? [0, 1, 2].map(axis =>
    nodes.reduce((sum, node) => sum + getTransformPivot(node)[axis], 0) / nodes.length) : null;
  const context = {
    nodes,
    multiple,
    commonGroup,
    center,
    pivot: averagePivot
  };
  selectionTransformContextCache = {
    project: state.project,
    selection: state.selectedUids,
    size: state.selectedUids.size,
    hierarchyRevision: state.project.hierarchyRevision,
    context
  };
  return context;
}

function getTransformAxes(item) {
  const owner = subdivisionOwner(item);
  const chain = state.project.getGroupChain(owner?.uid || item.uid);
  const parentRotation = vector => applyGroupTransforms(vector, chain.map(group => ({ pivot: [0, 0, 0], rotation: group.rotation })));
  return [0, 1, 2].map(axis => {
    const unit = [0, 0, 0]; unit[axis] = 1;
    let direction = state.transformSpace === 'global' ? unit
      : parentRotation(owner ? rotateVector(unit, owner.rotation || [0, 0, 0]) : unit);
    if (state.transformSpace === 'self' || (state.tool === 'resize' && item.type !== 'group')) {
      const rotation = item.rotation || [0, 0, 0];
      if (state.tool === 'rotate' && state.rotationMode === 'euler') {
        // The renderer uses Rz * Ry * Rx. Its Euler gimbal therefore has a
        // fixed Z axis, Y follows Z, and X follows Z then Y. Rotations later
        // in the Z -> Y -> X hierarchy never move an earlier axis.
        const stagedRotation = axis === 0 ? [0, rotation[1], rotation[2]]
          : axis === 1 ? [0, 0, rotation[2]]
          : [0, 0, 0];
        const localDirection = rotateVector(unit, stagedRotation);
        direction = parentRotation(owner ? rotateVector(localDirection, owner.rotation || [0, 0, 0]) : localDirection);
      } else {
        const localDirection = rotateVector(unit, rotation);
        direction = parentRotation(owner ? rotateVector(localDirection, owner.rotation || [0, 0, 0]) : localDirection);
      }
    }
    return normalize3(direction);
  });
}

function getSelectionTransformAxes(context, fallbackItem) {
  if (state.tool === 'resize') {
    const elements = selectedElementUids().map(uidValue => state.project.getNode(uidValue))
      .filter(node => node?.type === 'cube' || isShapeElement(node));
    if (elements.length) {
      const frames = elements.map(getTransformAxes);
      const first = frames[0];
      const mean = [0, 1, 2].map(axis => frames.reduce((sum, frame) => sum.map((value, component) => value + frame[axis][component]), [0, 0, 0]));
      const x = Math.hypot(...mean[0]) > 1e-6 ? normalize3(mean[0]) : first[0];
      const projectedY = mean[1].map((value, component) => value - x[component] * dot3(mean[1], x));
      let y = Math.hypot(...projectedY) > 1e-6 ? normalize3(projectedY) : normalize3(cross3(first[2], x));
      if (Math.hypot(...y) < 1e-6) y = normalize3(cross3(Math.abs(x[1]) < .9 ? [0, 1, 0] : [0, 0, 1], x));
      let z = normalize3(cross3(x, y));
      if (dot3(z, mean[2]) < 0) { y = y.map(value => -value); z = z.map(value => -value); }
      return [x, y, z];
    }
  }
  if (!context.multiple) return getTransformAxes(fallbackItem);
  if (context.commonGroup) return getTransformAxes(context.commonGroup);
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
}

function activeCurveNodeContext() {
  const curve = selected();
  if (!isBezierElement(curve) || !Number.isInteger(state.selectedCurveNodeIndex)) return null;
  const node = curve.nodes[state.selectedCurveNodeIndex];
  return node ? { curve, node, index: state.selectedCurveNodeIndex } : null;
}

function activeModifierAnchorContext() {
  const owner = selected();
  const modifier = [...(owner?.modifiers || []), ...(owner?.operators || [])].find(entry => entry.uid === state.selectedModifierUid);
  return modifier?.enabled && ['symmetry', 'paint_symmetry'].includes(modifier.type) ? { owner, modifier } : null;
}

function bakeCurveNodeTangent(curve, index) {
  const node = curve?.nodes?.[index];
  if (!node?.autoTangent || !isBezierElement(curve)) return node;
  const resolved = curve.resolvedNodeState(index);
  node.rotation = [...resolved.rotation];
  node.handleIn = [...resolved.localHandleIn];
  node.handleOut = [...resolved.localHandleOut];
  node.autoTangent = false;
  return node;
}

function setCurveHandle(node, property, value, planar = false) {
  const handle = value.map(component => Number(component) || 0);
  if (planar) handle[1] = 0;
  node[property] = handle;
  if (node.symmetricHandles) {
    const opposite = property === 'handleIn' ? 'handleOut' : 'handleIn';
    node[opposite] = handle.map(component => -component);
  }
}

function getCurveNodeTransformAxes(context) {
  const chain = [...state.project.getGroupChain(context.curve.uid), { pivot: [0, 0, 0], rotation: context.curve.rotation || [0, 0, 0] }];
  return [0, 1, 2].map(axis => {
    const unit = [0, 0, 0]; unit[axis] = 1;
    if (state.transformSpace === 'global') return unit;
    let direction = unit;
    if (state.transformSpace === 'self') {
      const rotation = context.node.autoTangent
        ? context.curve.resolvedNodeState(context.index).rotation
        : context.node.rotation || [0, 0, 0];
      direction = rotateVector(direction, rotation);
    }
    return normalize3(applyGroupTransforms(direction, chain));
  });
}

function getModifierAnchorTransformAxes(context) {
  const units = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (state.transformSpace === 'global') return units;
  const owner = context.owner;
  const chain = [...state.project.getGroupChain(owner.uid), {
    pivot: [0, 0, 0],
    rotation: owner.rotation || [0, 0, 0]
  }];
  const rotationChain = chain.map(entry => ({ pivot: [0, 0, 0], rotation: entry.rotation || [0, 0, 0] }));
  const transformDirection = direction => normalize3(applyGroupTransforms(direction, rotationChain));
  const parentAxes = units.map(transformDirection);
  if (state.transformSpace !== 'self') return parentAxes;
  return units.map(unit => transformDirection(rotateVector(unit, context.modifier.anchor.rotation || [0, 0, 0])));
}

return {
  clearCache,
  updateTransformSpaceButtons,
  updateRotationModeButtons,
  updateScaleHandleModeButtons,
  updateMultiTransformModeButtons,
  getTransformPivot,
  inverseApplyGroupTransforms,
  selectedWorldPoints,
  selectionGeometryCenter,
  getSelectionTransformContext,
  getTransformAxes,
  getSelectionTransformAxes,
  activeCurveNodeContext,
  activeModifierAnchorContext,
  bakeCurveNodeTangent,
  setCurveHandle,
  getCurveNodeTransformAxes,
  getModifierAnchorTransformAxes,
};
}
