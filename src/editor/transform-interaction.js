import { Cube, Group, setPivotPreservingGeometry } from '../model.js';
import { constrainNode, formatRules } from '../common/core/format-constraints.js';
import { paintSymmetryRelationCache } from '../paint/symmetry-relations.js';
import { dot3, cross3, normalize3 } from '../utils/math/vector3.js';
import { inverseRotateVector, quaternionFromAxisAngle, quaternionFromEuler, quaternionMultiply, eulerFromQuaternion } from '../utils/math/rotation.js';

export function createTransformInteraction({
  state, $, sceneCanvas, sceneRenderer, viewport, preciseRotationInput, selectionMarquee,
  activeCurveNodeContext, activeModifierAnchorContext, applyTargetRotation,
  applyViewportBoxSelection, bakeCurveNodeTangent, captureGroupMembers,
  captureModifierAnchors, captureTransformTarget, clearSelection,
  discardSubdivisionEdits, finishScenePaintDrag, formatNumber, formatSigned,
  freezeCubeUvs, getAngleSnapStep, getSelectionTransformContext,
  intersectRayPlane, invalidateSelectionRenderGeometry, isBezierElement,
  isEffectivelyLocked, isShapeElement, localDeltaFromWorld, markDirty,
  moveScenePaintDrag, polyhedronEdgeLength, queueSceneBrushPointer,
  refreshSelectionUi, renderInspector, renderScene, rotatePointAroundAxis,
  rotationMatrixAroundAxis, scheduleSceneRender, selected, selectedElementUids,
  selectItem, setCurveHandle, snapAngle, snapShapeDimension, snapshot,
  snapValue, subdivisionOwner, syncInspectorValues, toast,
  translateCapturedTarget, translateModifierAnchorsFromSnapshot,
  translationMatrix, updatePaintGradientHover, updateSelectionMarquee,
  viewportSelectionMode, worldPointToCurveLocal, worldPointToParentLocal,
  updateKnifeHover, schedulePaintSymmetryBuild, currentProjection
}) {
let transformUpdateFrame = null;
function startTransformDrag(event, axisIndex, captureTarget, kind = 'free', sign = 1, handleElement = null,
  axisKey = axisIndex === null ? 'free' : String(axisIndex), axisIndices = axisIndex === null ? [] : [axisIndex], axisSigns = [sign]) {
  if (event.button !== 0) return;
  if (state.mode === 'paint') return;
  const modifierAnchorContext = activeModifierAnchorContext();
  const baseSelectionContext = getSelectionTransformContext();
  const selectionContext = modifierAnchorContext
    ? { nodes: [modifierAnchorContext.owner], multiple: false, commonGroup: null, center: null, pivot: null }
    : baseSelectionContext;
  const curveNodeContext = activeCurveNodeContext();
  let item = selected();
  if (state.tool === 'pivot' && selectionContext.multiple) item = selectionContext.commonGroup;
  if (!item || !['move', 'resize', 'rotate', 'pivot'].includes(state.tool)) return;
  if (state.tool === 'rotate' && formatRules(state.project).moddedEntity && item.type === 'cube') {
    toast('模組版實體的 Cube 不能旋轉；請把它放入組後旋轉組');
    return;
  }
  if (state.tool === 'rotate' && formatRules(state.project).singleAxisRotation && axisIndex === null) {
    toast('目前 Java 版本只允許單軸旋轉，請拖動 X、Y 或 Z 軸圓環');
    return;
  }
  const targetNodes = state.tool === 'resize'
    ? selectedElementUids().map(uidValue => state.project.getNode(uidValue)).filter(Boolean)
    : selectionContext.nodes;
  const resizeBatch = state.tool === 'resize' && (selectionContext.multiple || item.type === 'group');
  const targets = (resizeBatch || selectionContext.multiple) && ['move', 'rotate', 'resize'].includes(state.tool)
    ? targetNodes.map(captureTransformTarget)
    : [captureTransformTarget(item)];
  const rect = sceneCanvas.getBoundingClientRect();
  let handle = axisIndex === null ? null : state.gizmoAxes?.[axisIndex];
  const referenceHandle = handle || state.gizmoAxes?.[axisIndices[0]] || null;
  if (kind === 'rotate-view') {
    const cameraFrame = sceneRenderer.getCameraFrame();
    handle = {
      vector: [...cameraFrame.forward], screen: [1, 0, 0], worldPerPixel: cameraFrame.worldPerPixel,
      centerX: state.gizmoCenter.x, centerY: state.gizmoCenter.y
    };
  }
  const itemSubdivisionOwner = subdivisionOwner(item);
  const parentChain = state.project.getGroupChain(itemSubdivisionOwner?.uid || item.uid);
  const chain = modifierAnchorContext
    ? [...parentChain, { pivot: item.type === 'group' || item.type === 'cube' || isShapeElement(item) ? item.pivot : item.origin || item.position || [0, 0, 0], rotation: item.rotation || [0, 0, 0] }]
    : curveNodeContext
    ? [...parentChain, { pivot: item.origin, rotation: item.rotation || [0, 0, 0] }]
    : itemSubdivisionOwner
      ? [...parentChain, { pivot: (itemSubdivisionOwner.pivot || itemSubdivisionOwner.origin).map((value, axis) => value - itemSubdivisionOwner.origin[axis]), rotation: itemSubdivisionOwner.rotation || [0, 0, 0] }]
      : parentChain;
  const cameraFrame = sceneRenderer.getCameraFrame();
  const freeMovePlane = kind === 'free' && ['move', 'pivot'].includes(state.tool)
    ? { point: [...state.gizmoOrigin], normal: [...cameraFrame.forward] }
    : null;
  const freeMoveStart = freeMovePlane
    ? intersectRayPlane(sceneRenderer.getScreenRay(event.clientX - rect.left, event.clientY - rect.top), freeMovePlane.point, freeMovePlane.normal)
    : null;
  let storedAxis = handle ? handle.vector.map(value => value * sign) : null;
  const planeAxes = kind.startsWith('plane') ? axisIndices.map((index, pairIndex) => {
    const source = state.gizmoAxes[index];
    const axisSign = axisSigns[pairIndex] || 1;
    let stored = source.vector.map(value => value * axisSign);
    chain.forEach(group => { stored = inverseRotateVector(stored, group.rotation || [0, 0, 0]); });
    if (state.tool === 'resize' && item.type !== 'group') stored = inverseRotateVector(stored, item.rotation || [0, 0, 0]);
    return {
      index,
      sign: axisSign,
      worldAxis: source.vector.map(value => value * axisSign),
      storedAxis: stored,
      screenPerWorld: source.screenPerWorld.map(value => value * axisSign),
      worldPerPixel: source.worldPerPixel
    };
  }) : [];
  const planeDragPlane = planeAxes.length === 2
    ? { point: [...state.gizmoOrigin], normal: normalize3(cross3(planeAxes[0].worldAxis, planeAxes[1].worldAxis)) }
    : null;
  const planeDragStart = planeDragPlane
    ? intersectRayPlane(sceneRenderer.getScreenRay(event.clientX - rect.left, event.clientY - rect.top),
      planeDragPlane.point, planeDragPlane.normal)
    : null;
  let rotationAxis = null;
  let rotationScreenSign = 1;
  if (storedAxis) {
    if (kind === 'rotate' || kind === 'rotate-view') {
      const cameraFrame = sceneRenderer.getCameraFrame();
      const toCamera = cameraFrame.forward.map(value => -value);
      rotationScreenSign = dot3(handle.vector, toCamera) >= 0 ? -1 : 1;
      rotationAxis = [...storedAxis];
      chain.forEach(group => { rotationAxis = inverseRotateVector(rotationAxis, group.rotation || [0, 0, 0]); });
      if (state.transformSpace === 'self' && kind === 'rotate') rotationAxis = [0, 0, 0].map((_, index) => index === axisIndex ? 1 : 0);
    } else {
      chain.forEach(group => { storedAxis = inverseRotateVector(storedAxis, group.rotation || [0, 0, 0]); });
      if (state.tool === 'resize' && item.type !== 'group') storedAxis = inverseRotateVector(storedAxis, item.rotation || [0, 0, 0]);
    }
  }
  if (Number.isFinite(event.pointerId)) captureTarget.setPointerCapture(event.pointerId);
  handleElement?.classList.add('active');
  sceneRenderer.clearSelectionPreviewTransform();
  const gizmoCenter = referenceHandle
    ? { x: referenceHandle.centerX + rect.left, y: referenceHandle.centerY + rect.top }
    : { x: state.gizmoCenter.x + rect.left, y: state.gizmoCenter.y + rect.top };
  state.dragging = {
    type: 'transform', tool: state.tool, pointerId: event.pointerId,
    snapshotTaken: false,
    x: event.clientX, y: event.clientY, item, axisIndex, axisIndices, axisSigns, axisKey,
    axis: handle ? { ...handle, screen: handle.screen.map(value => value * sign) } : null,
    planeAxes, planeDragPlane, planeDragStart,
    referenceWorldPerPixel: referenceHandle?.worldPerPixel, freeMovePlane, freeMoveStart,
    kind, sign, rotationAxis, rotationScreenSign, handleElement, gizmoCenter: handle ? gizmoCenter : null,
    rotationMode: state.transformSpace === 'self' ? state.rotationMode : 'pose',
    startAngle: kind.startsWith('rotate') && handle ? Math.atan2(event.clientY - (handle.centerY + rect.top), event.clientX - (handle.centerX + rect.left)) : 0,
    rect, storedAxis, chain, selectionContext, targets, multiTransformMode: state.multiTransformMode,
    batchPreview: selectionContext.multiple && state.multiTransformMode === 'unified'
      && ['move', 'rotate'].includes(state.tool),
    baseSelectionCenter: selectionContext.center ? [...selectionContext.center] : null,
    baseSelectionPivot: selectionContext.pivot ? [...selectionContext.pivot] : null,
    position: modifierAnchorContext ? [...modifierAnchorContext.modifier.anchor.position]
      : curveNodeContext ? [...curveNodeContext.node.position]
      : item.position ? [...item.position] : item.origin ? [...item.origin] : item.pivot ? [...item.pivot] : [0, 0, 0],
    pivot: modifierAnchorContext ? [...modifierAnchorContext.modifier.anchor.position]
      : curveNodeContext ? [...curveNodeContext.node.position]
      : item.pivot ? [...item.pivot] : item.type === 'node' ? [...item.position] : null,
    size: item.size ? [...item.size] : null,
    rotation: [...(modifierAnchorContext ? modifierAnchorContext.modifier.anchor.rotation : curveNodeContext
      ? curveNodeContext.node.autoTangent
        ? curveNodeContext.curve.resolvedNodeState(curveNodeContext.index).rotation
        : curveNodeContext.node.rotation
      : item.rotation || [0, 0, 0])],
    nodeRoll: curveNodeContext?.node.roll || 0,
    radius: item.parameters?.radius,
    height: item.parameters?.height,
    modifierAnchors: captureModifierAnchors(item),
    uvFrozen: false,
    groupMembers: item.type === 'group' ? captureGroupMembers(item) : [],
    curveNodeContext,
    modifierAnchorContext,
    resizeBatch
  };
  sceneRenderer.beginTransformGhost();
  $('#transformTooltip').hidden = true;
  sceneCanvas.classList.add(`is-${state.tool}`);
}

function dismissPreciseRotationInput() {
  preciseRotationInput?.remove();
  preciseRotationInput = null;
}

function openPreciseRotationInput(event, handle) {
  dismissPreciseRotationInput();
  if (!handle || !handle.dataset.kind?.startsWith('rotate')) return;
  const gizmo = $('#transformGizmo');
  const axisKey = handle.dataset.axis || 'view';
  const axisIndex = /^[0-2]$/.test(axisKey) ? Number(axisKey) : null;
  startTransformDrag(event, axisIndex, gizmo, handle.dataset.kind, Number(handle.dataset.sign || 1),
    handle, axisKey, axisIndex === null ? [] : [axisIndex], [Number(handle.dataset.sign || 1)]);
  const drag = state.dragging;
  if (!drag || drag.type !== 'transform') return;
  state.dragging = null;
  if (Number.isFinite(event.pointerId) && gizmo.hasPointerCapture?.(event.pointerId))
    gizmo.releasePointerCapture(event.pointerId);
  handle.classList.remove('active');
  sceneRenderer.endTransformGhost();
  sceneCanvas.classList.remove('is-rotate');
  const viewport = $('#viewport');
  const rect = viewport.getBoundingClientRect();
  const field = document.createElement('div');
  field.className = 'precise-rotation-input';
  field.style.left = `${Math.min(rect.width - 118, Math.max(8, event.clientX - rect.left + 14))}px`;
  field.style.top = `${Math.max(8, event.clientY - rect.top - 32)}px`;
  field.innerHTML = '<input type="number" step="any" value="0" aria-label="旋轉角度（度）"/><span>°</span>';
  viewport.append(field);
  preciseRotationInput = field;
  const input = field.querySelector('input');
  input.focus(); input.select();
  const outside = down => {
    if (field.contains(down.target)) return;
    document.removeEventListener('pointerdown', outside, true);
    dismissPreciseRotationInput();
  };
  document.addEventListener('pointerdown', outside, true);
  input.addEventListener('keydown', keyEvent => {
    if (keyEvent.key !== 'Enter') return;
    const degrees = Number(input.value);
    if (!Number.isFinite(degrees)) return;
    keyEvent.preventDefault();
    if (degrees) {
      snapshot('core.element.precise_rotation');
      applyExactRotation(drag, degrees * drag.rotationScreenSign);
      const rules = formatRules(state.project);
      constrainNode(drag.item, rules);
      for (const target of drag.targets || []) constrainNode(target.node, rules);
      invalidateSelectionRenderGeometry();
      sceneRenderer.invalidateMirrorGeometry();
      markDirty();
      renderInspector();
      renderScene();
    }
    document.removeEventListener('pointerdown', outside, true);
    dismissPreciseRotationInput();
  });
}

function applyExactRotation(drag, degrees) {
  if (drag.targets.length > 1) {
    const commonAxis = drag.axis?.vector.map(value => value * drag.sign) || [0, 1, 0];
    const commonPivot = drag.selectionContext.pivot || drag.selectionContext.center || state.gizmoOrigin;
    for (const target of drag.targets) {
      const separate = drag.multiTransformMode === 'separate';
      const targetAxis = separate && drag.kind === 'rotate' ? target.transformAxes[drag.axisIndex] : commonAxis;
      if (!separate) {
        const next = rotatePointAroundAxis(target.worldAnchor, commonPivot, targetAxis, degrees);
        translateCapturedTarget(target, localDeltaFromWorld(target,
          next.map((value, axis) => value - target.worldAnchor[axis])));
      }
      applyTargetRotation(target, targetAxis, degrees, {
        separate, selfRelative: separate && drag.kind === 'rotate' && state.transformSpace === 'self',
        axisIndex: drag.axisIndex
      });
    }
    return;
  }
  if (drag.curveNodeContext?.curve.dimension === 3 && state.transformSpace === 'self'
    && drag.kind === 'rotate' && drag.axisIndex === 2) {
    drag.curveNodeContext.node.roll = drag.nodeRoll + degrees;
    return;
  }
  if (drag.curveNodeContext?.node.autoTangent) bakeCurveNodeTangent(drag.curveNodeContext.curve, drag.curveNodeContext.index);
  const target = drag.modifierAnchorContext?.modifier.anchor || drag.curveNodeContext?.node || drag.item;
  const turn = quaternionFromAxisAngle(drag.rotationAxis, degrees);
  const current = quaternionFromEuler(drag.rotation);
  target.rotation = eulerFromQuaternion(state.transformSpace === 'self' && drag.kind !== 'rotate-view'
    ? quaternionMultiply(current, turn) : quaternionMultiply(turn, current));
  if (drag.curveNodeContext?.curve.dimension === 2) {
    target.rotation[0] = 0; target.rotation[2] = 0;
  }
  if (drag.curveNodeContext) drag.curveNodeContext.node.autoTangent = false;
}

function onPointerMove(event) {
  if (state.dragging?.type === 'texture-paint-3d') {
    event.preventDefault?.();
    moveScenePaintDrag(event);
    return;
  }
  if (state.tool === 'knife' && !state.dragging) {
    updateKnifeHover(event);
    return;
  }
  if (state.tool === 'gradient' && !state.dragging && state.paintGradientAnchor) {
    updatePaintGradientHover(event);
    return;
  }
  if (!state.dragging) {
    const curve = selected();
    const rect = sceneCanvas.getBoundingClientRect();
    const handle = (isBezierElement(curve) || curve?.type === 'node') && !isEffectivelyLocked(curve.uid)
      ? sceneRenderer.pickCurveHandle(state.project, curve.uid, event.clientX - rect.left, event.clientY - rect.top, null)
      : null;
    sceneCanvas.classList.toggle('is-curve-handle-hover', Boolean(handle));
    return;
  }
  const dx = event.clientX - state.dragging.x;
  const dy = event.clientY - state.dragging.y;
  if (state.dragging.type === 'curve-handle') {
    const drag = state.dragging;
    if (!drag.snapshotTaken && Math.hypot(dx, dy) < .5) return;
    if (!drag.snapshotTaken) {
      snapshot('core.curve.node_move');
      discardSubdivisionEdits(drag.curve);
      drag.snapshotTaken = true;
      markDirty();
    }
    const ray = sceneRenderer.getScreenRay(event.clientX - drag.rect.left, event.clientY - drag.rect.top);
    const intersection = intersectRayPlane(ray, drag.plane.point, drag.plane.normal);
    if (!intersection) return;
    const curvePoint = drag.curve.type === 'node'
      ? worldPointToParentLocal(drag.curve, intersection)
      : worldPointToCurveLocal(drag.curve, intersection);
    if (isBezierElement(drag.curve) && drag.node.autoTangent) bakeCurveNodeTangent(drag.curve, drag.nodeIndex);
    let handle = inverseRotateVector(
      curvePoint.map((value, axis) => value - drag.node.position[axis]),
      drag.node.rotation || [0, 0, 0]
    ).map(value => snapValue(value, event));
    if (drag.curve.dimension === 2) handle[1] = 0;
    if (isBezierElement(drag.curve)) drag.node.autoTangent = false;
    setCurveHandle(drag.node, drag.property, handle, drag.curve.dimension === 2);
    drag.tooltipText = `${drag.property === 'handleIn' ? '前' : '後'}手柄 ${formatNumber(Math.hypot(...handle))} px`;
    invalidateSelectionRenderGeometry();
    updateTransformTooltip(event, drag);
    renderScene();
    return;
  }
  if (state.dragging.type === 'selection-box') {
    const rect = sceneCanvas.getBoundingClientRect();
    state.dragging.currentX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    state.dragging.currentY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    state.dragging.mode = viewportSelectionMode(event);
    if (!state.dragging.moved && Math.hypot(dx, dy) < 4) return;
    state.dragging.moved = true;
    updateSelectionMarquee(state.dragging);
    return;
  }
  if (state.dragging.type === 'transform') {
    if (Math.hypot(dx, dy) < .5) return;
    if (!state.dragging.snapshotTaken) {
      snapshot(state.dragging.tool === 'resize' ? 'core.element.scale'
        : state.dragging.tool === 'rotate' ? 'core.element.rotate'
          : state.dragging.tool === 'pivot' ? 'core.element.pivot' : 'core.element.move');
      if (state.dragging.tool === 'resize') {
        state.dragging.targets.forEach(target => discardSubdivisionEdits(target.node));
      }
      state.dragging.snapshotTaken = true;
    }
    if (state.dragging.tool === 'resize' && !state.dragging.uvFrozen) {
      state.dragging.targets.filter(target => target.node.type === 'cube' && target.node.autoUv === false)
        .forEach(target => freezeCubeUvs(target.node));
      state.dragging.uvFrozen = true;
    }
    state.dragging.pendingTransform = {
      dx,
      dy,
      event: {
        clientX: event.clientX,
        clientY: event.clientY,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey
      }
    };
    scheduleTransformUpdate(state.dragging);
    return;
  } else if (state.dragging.type === 'pan') {
    state.target = [0, 1, 2].map(axis => state.dragging.target[axis]
      - state.dragging.right[axis] * dx * state.dragging.worldPerPixel
      + state.dragging.up[axis] * dy * state.dragging.worldPerPixel);
  } else {
    const fullTurn = Math.PI * 2;
    state.yaw = ((state.dragging.yaw - dx * .01) % fullTurn + fullTurn) % fullTurn;
    state.pitch = Math.max(-Math.PI / 2 + .001, Math.min(Math.PI / 2 - .001, state.dragging.pitch + dy * .01));
  }
  // Pointer events can arrive far faster than the display refresh rate. Keep
  // the latest camera state, but render it only once per animation frame.
  scheduleSceneRender();
}

function onScenePointerMove(event) {
  if (event.pointerType === 'pen' && state.dragging?.type === 'texture-paint-3d'
    && typeof event.getCoalescedEvents === 'function') {
    const samples = event.getCoalescedEvents();
    if (samples.length) {
      event.preventDefault();
      for (const sample of samples) moveScenePaintDrag(sample);
      return;
    }
  }
  onPointerMove(event);
}

function applyPendingTransform(drag) {
  const pending = drag?.pendingTransform;
  if (!pending) return false;
  drag.pendingTransform = null;
  applyTransformDrag(drag, pending.dx, pending.dy, pending.event);
  const rules = formatRules(state.project);
  if (rules.javaBlock || rules.moddedEntity) {
    constrainNode(drag.item, rules);
    for (const target of drag.targets || []) constrainNode(target.node, rules);
  }
  updateTransformTooltip(pending.event, drag);
  if (!drag.batchPreview) invalidateSelectionRenderGeometry();
  if (drag.modifierAnchorContext) sceneRenderer.invalidateMirrorGeometry();
  if (!state.dirty) markDirty();
  if (!drag.selectionContext.multiple) syncInspectorValues();
  return true;
}

function commitBatchTransform(drag) {
  const preview = drag.previewCommit;
  if (!drag.batchPreview || !preview) {
    sceneRenderer.clearSelectionPreviewTransform();
    return false;
  }
  if (preview.type === 'move') {
    for (const target of drag.targets) {
      translateCapturedTarget(target, localDeltaFromWorld(target, preview.worldDelta));
    }
  } else if (preview.type === 'rotate') {
    for (const target of drag.targets) {
      const nextWorldAnchor = rotatePointAroundAxis(target.worldAnchor, preview.pivot, preview.axis, preview.degrees);
      const worldDelta = nextWorldAnchor.map((value, axis) => value - target.worldAnchor[axis]);
      translateCapturedTarget(target, localDeltaFromWorld(target, worldDelta));
      applyTargetRotation(target, preview.axis, preview.degrees);
      constrainNode(target.node, formatRules(state.project));
    }
  }
  sceneRenderer.clearSelectionPreviewTransform();
  invalidateSelectionRenderGeometry();
  return true;
}

function scheduleTransformUpdate(drag) {
  if (transformUpdateFrame !== null) return;
  transformUpdateFrame = requestAnimationFrame(() => {
    transformUpdateFrame = null;
    if (state.dragging !== drag || !applyPendingTransform(drag)) return;
    renderScene();
  });
}

function endPointerDrag(event) {
  if (!state.dragging) return;
  const finishedDrag = state.dragging;
  if (finishedDrag.type === 'texture-paint-3d') {
    if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      finishedDrag.latestClient = [event.clientX, event.clientY];
      if (finishedDrag.multiSurface) queueSceneBrushPointer(finishedDrag, event.clientX, event.clientY);
      else if (finishedDrag.ready) moveScenePaintDrag(event, finishedDrag);
    }
    state.dragging = null;
    const captureTarget = event.currentTarget;
    if (captureTarget.hasPointerCapture?.(event.pointerId)) captureTarget.releasePointerCapture(event.pointerId);
    finishedDrag.ended = true;
    if (finishedDrag.ready) finishScenePaintDrag(finishedDrag);
    return;
  }
  if (finishedDrag.type === 'transform') {
    if (transformUpdateFrame !== null) cancelAnimationFrame(transformUpdateFrame);
    transformUpdateFrame = null;
    applyPendingTransform(finishedDrag);
    commitBatchTransform(finishedDrag);
  }
  state.dragging.handleElement?.classList.remove('active');
  const captureTarget = event.currentTarget;
  if (captureTarget.hasPointerCapture?.(event.pointerId)) captureTarget.releasePointerCapture(event.pointerId);
  state.dragging = null;
  if (finishedDrag.type === 'selection-box') {
    selectionMarquee.hidden = true;
    selectionMarquee.classList.remove('is-add', 'is-remove');
    finishedDrag.mode = viewportSelectionMode(event);
    if (event.type !== 'pointercancel' && finishedDrag.moved) {
      const hitUids = sceneRenderer.selectInScreenRect(state.project, {
        x1: finishedDrag.startX, y1: finishedDrag.startY,
        x2: finishedDrag.currentX, y2: finishedDrag.currentY
      }, state.geometryOnly);
      applyViewportBoxSelection(hitUids, finishedDrag);
    } else if (event.type !== 'pointercancel') {
      if (finishedDrag.generatedHit && !state.modifierResultGhost) {
        sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
        state.selectedUids = new Set(); state.selectedUid = null;
        state.selectedGenerated = {
          uid: finishedDrag.generatedHit.uid,
          instanceKey: finishedDrag.generatedHit.instanceKey
        };
        state.selectedCurveNodeIndex = null; state.selectedModifierUid = null;
        refreshSelectionUi();
      } else if (finishedDrag.hitUid) selectItem(finishedDrag.hitUid, {
        revealInOutliner: true,
        toggle: event.ctrlKey || event.metaKey,
        range: event.shiftKey
      });
      else if (!finishedDrag.suppressBlankDeselect) clearSelection();
    }
    return;
  }
  if (finishedDrag.type === 'curve-handle') {
    if (finishedDrag.snapshotTaken) renderInspector();
    $('#transformTooltip').hidden = true;
    sceneCanvas.classList.remove('is-curve-handle', 'is-curve-handle-hover');
    renderScene();
    return;
  }
  if (finishedDrag.type === 'transform' && finishedDrag.snapshotTaken) {
    sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
    if (finishedDrag.modifierAnchorContext) {
      const { owner, modifier } = finishedDrag.modifierAnchorContext;
      if (modifier.type === 'paint_symmetry') {
        paintSymmetryRelationCache.delete(modifier.uid);
        schedulePaintSymmetryBuild(owner, modifier);
      }
      renderInspector();
    }
    else syncInspectorValues();
  }
  sceneRenderer.endTransformGhost();
  $('#transformTooltip').hidden = true;
  sceneCanvas.classList.remove('is-orbiting', 'is-panning', 'is-move', 'is-resize', 'is-rotate', 'is-pivot');
  renderScene();
}

function getPlaneDragDistances(drag, event, dx, dy) {
  const [first, second] = drag.planeAxes;
  if (!first || !second) return [];
  const pointer = drag.planeDragPlane && intersectRayPlane(
    sceneRenderer.getScreenRay(event.clientX - drag.rect.left, event.clientY - drag.rect.top),
    drag.planeDragPlane.point,
    drag.planeDragPlane.normal
  );
  if (pointer && drag.planeDragStart) {
    const worldDelta = pointer.map((value, axis) => value - drag.planeDragStart[axis]);
    return [first, second].map(axis => dot3(worldDelta, axis.worldAxis));
  }
  const [ax, ay] = first.screenPerWorld;
  const [bx, by] = second.screenPerWorld;
  const pointerX = dx, pointerY = -dy;
  const determinant = ax * by - ay * bx;
  if (Math.abs(determinant) > .0001) {
    return [
      (pointerX * by - pointerY * bx) / determinant,
      (ax * pointerY - ay * pointerX) / determinant
    ];
  }
  return [first, second].map(axis => {
    const direction = normalize3([axis.screenPerWorld[0], axis.screenPerWorld[1], 0]);
    return (pointerX * direction[0] + pointerY * direction[1]) * axis.worldPerPixel;
  });
}

function getPlaneUniformDistance(drag, dx, dy) {
  const [first, second] = drag.planeAxes;
  if (!first || !second) return 0;
  const combined = [
    first.screenPerWorld[0] + second.screenPerWorld[0],
    first.screenPerWorld[1] + second.screenPerWorld[1]
  ];
  const lengthSquared = dot3([combined[0], combined[1], 0], [combined[0], combined[1], 0]);
  if (lengthSquared < .0001) return 0;
  return (dx * combined[0] + -dy * combined[1]) / lengthSquared;
}

function applyTransformDrag(drag, dx, dy, event) {
  const rotationDragSensitivity = .75;
  const item = drag.item;
  const axisDelta = drag.kind.startsWith('rotate') && drag.axis
    ? (() => {
      const angle = Math.atan2(event.clientY - drag.gizmoCenter.y, event.clientX - drag.gizmoCenter.x);
      let delta = angle - drag.startAngle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      return delta * 180 / Math.PI * drag.rotationScreenSign * rotationDragSensitivity;
    })()
    : drag.axis
    ? (dx * drag.axis.screen[0] + -dy * drag.axis.screen[1]) * drag.axis.worldPerPixel
    : null;
  const fallbackScale = drag.axis?.worldPerPixel || drag.referenceWorldPerPixel || (currentProjection() === 'perspective'
    ? 2 * (42 / state.zoom) * Math.tan(Math.PI / 8) / drag.rect.height
    : 36 / (drag.rect.height * state.zoom));
  if (drag.tool === 'pivot') {
    let delta;
    if (drag.kind === 'plane') {
      const distances = getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event));
      delta = [0, 0, 0];
      drag.planeAxes.forEach((axis, index) => {
        delta = delta.map((value, component) => value + axis.storedAxis[component] * distances[index]);
      });
    } else if (drag.axis) {
      const distance = snapValue(axisDelta, event);
      delta = drag.storedAxis.map(value => value * distance);
    } else {
      const frame = sceneRenderer.getCameraFrame();
      const pointer = intersectRayPlane(
        sceneRenderer.getScreenRay(event.clientX - drag.rect.left, event.clientY - drag.rect.top),
        drag.freeMovePlane.point,
        drag.freeMovePlane.normal
      );
      delta = pointer && drag.freeMoveStart
        ? pointer.map((value, axis) => value - drag.freeMoveStart[axis])
        : [0, 1, 2].map(axis => frame.right[axis] * dx * fallbackScale + frame.up[axis] * -dy * fallbackScale);
      drag.chain.forEach(group => { delta = inverseRotateVector(delta, group.rotation || [0, 0, 0]); });
    }
    const nextPivot = drag.axis || drag.kind === 'plane'
      ? drag.pivot.map((value, axis) => value + delta[axis])
      : drag.pivot.map((value, axis) => snapValue(value + delta[axis], event));
    if (drag.modifierAnchorContext) {
      drag.modifierAnchorContext.modifier.anchor.position = nextPivot;
    } else if (drag.curveNodeContext) {
      drag.curveNodeContext.node.position = nextPivot.map((value, axis) => drag.curveNodeContext.curve.dimension === 2 && axis === 1 ? 0 : value);
    } else if (item.type === 'node') item.position = nextPivot;
    else setPivotPreservingGeometry(state.project, item, nextPivot);
    drag.tooltipText = `${drag.modifierAnchorContext ? '對稱軸點' : drag.curveNodeContext || item.type === 'node' ? '節點' : '樞軸'} ${nextPivot.map(formatNumber).join(' / ')}`;
  }
  if (drag.tool === 'move' && drag.targets.length > 1) {
    let distances = [];
    let commonWorldDelta;
    if (drag.kind === 'plane') {
      distances = getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event));
      commonWorldDelta = [0, 0, 0];
      drag.planeAxes.forEach((axis, index) => {
        commonWorldDelta = commonWorldDelta.map((value, component) => value + axis.worldAxis[component] * distances[index]);
      });
      drag.tooltipText = `距離 ${drag.axisIndices.map(index => 'XYZ'[index]).join('')} ${distances.map(formatSigned).join(' / ')} px`;
    } else if (drag.axis) {
      distances = [snapValue(axisDelta, event)];
      const direction = drag.axis.vector.map(value => value * drag.sign);
      commonWorldDelta = direction.map(value => value * distances[0]);
      drag.tooltipText = `距離 ${formatSigned(distances[0])} px`;
    } else {
      const frame = sceneRenderer.getCameraFrame();
      const pointer = intersectRayPlane(
        sceneRenderer.getScreenRay(event.clientX - drag.rect.left, event.clientY - drag.rect.top),
        drag.freeMovePlane.point,
        drag.freeMovePlane.normal
      );
      commonWorldDelta = pointer && drag.freeMoveStart
        ? pointer.map((value, axis) => value - drag.freeMoveStart[axis])
        : [0, 1, 2].map(axis => frame.right[axis] * dx * fallbackScale + frame.up[axis] * -dy * fallbackScale);
      commonWorldDelta = commonWorldDelta.map(value => snapValue(value, event));
      drag.tooltipText = `距離 ${formatSigned(Math.hypot(...commonWorldDelta))} px`;
    }
    if (drag.batchPreview) {
      drag.previewCommit = { type: 'move', worldDelta: [...commonWorldDelta] };
      sceneRenderer.setSelectionPreviewTransform(translationMatrix(commonWorldDelta));
      if (drag.baseSelectionCenter) drag.selectionContext.center = drag.baseSelectionCenter
        .map((value, axis) => value + commonWorldDelta[axis]);
      return;
    }
    for (const target of drag.targets) {
      let worldDelta = commonWorldDelta;
      if (drag.multiTransformMode === 'separate' && drag.axis) {
        const targetAxes = target.transformAxes;
        if (drag.kind === 'plane') {
          worldDelta = [0, 0, 0];
          drag.axisIndices.forEach((axisIndex, index) => {
            const signValue = drag.axisSigns[index] || 1;
            worldDelta = worldDelta.map((value, component) => value + targetAxes[axisIndex][component] * signValue * distances[index]);
          });
        } else {
          worldDelta = targetAxes[drag.axisIndex].map(value => value * drag.sign * distances[0]);
        }
      }
      translateCapturedTarget(target, localDeltaFromWorld(target, worldDelta));
    }
    return;
  }
  if (drag.tool === 'move') {
    let delta;
    if (drag.kind === 'plane') {
      const distances = getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event));
      delta = [0, 0, 0];
      drag.planeAxes.forEach((axis, index) => {
        delta = delta.map((value, component) => value + axis.storedAxis[component] * distances[index]);
      });
      drag.tooltipText = `距離 ${drag.axisIndices.map(index => 'XYZ'[index]).join('')} ${distances.map(formatSigned).join(' / ')} px`;
    } else if (drag.axis) {
      const snappedDistance = snapValue(axisDelta, event);
      delta = drag.storedAxis.map(value => value * snappedDistance);
    }
    else {
      const frame = sceneRenderer.getCameraFrame();
      const pointer = intersectRayPlane(
        sceneRenderer.getScreenRay(event.clientX - drag.rect.left, event.clientY - drag.rect.top),
        drag.freeMovePlane.point,
        drag.freeMovePlane.normal
      );
      const worldDelta = pointer && drag.freeMoveStart
        ? pointer.map((value, axis) => value - drag.freeMoveStart[axis])
        : [0, 1, 2].map(axis => frame.right[axis] * dx * fallbackScale + frame.up[axis] * -dy * fallbackScale);
      delta = [...worldDelta];
      drag.chain.forEach(group => { delta = inverseRotateVector(delta, group.rotation || [0, 0, 0]); });
    }
    const next = drag.axis || drag.kind === 'plane'
      ? drag.position.map((value, axis) => value + delta[axis])
      : drag.position.map((value, axis) => snapValue(value + delta[axis], event));
    if (drag.kind !== 'plane') drag.tooltipText = `距離 ${formatSigned(Math.hypot(...next.map((value, axis) => value - drag.position[axis])))} px`;
    if (drag.modifierAnchorContext) {
      drag.modifierAnchorContext.modifier.anchor.position = next;
    } else if (drag.curveNodeContext) {
      drag.curveNodeContext.node.position = next.map((value, axis) => drag.curveNodeContext.curve.dimension === 2 && axis === 1 ? 0 : value);
    } else if (item.type === 'cube') {
      const applied = next.map((value, axis) => value - drag.position[axis]);
      item.position = next;
      item.pivot = drag.pivot.map((value, axis) => value + applied[axis]);
      translateModifierAnchorsFromSnapshot(item, drag.modifierAnchors, applied);
    } else if (item.origin) {
      const applied = next.map((value, axis) => value - drag.position[axis]);
      item.origin = next;
      if (isShapeElement(item) && drag.pivot) item.pivot = drag.pivot.map((value, axis) => value + applied[axis]);
      translateModifierAnchorsFromSnapshot(item, drag.modifierAnchors, applied);
    }
    else if (item.position) {
      item.position = next;
      translateModifierAnchorsFromSnapshot(item, drag.modifierAnchors, next.map((value, axis) => value - drag.position[axis]));
    }
    else if (item.type === 'group') {
      const delta = next.map((value, axis) => value - drag.position[axis]);
      item.pivot = next;
      translateModifierAnchorsFromSnapshot(item, drag.modifierAnchors, delta);
      drag.groupMembers.forEach(member => {
        if (member.node.type === 'cube') {
          member.node.position = member.position.map((value, axis) => value + delta[axis]);
          member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
        } else if (member.node.origin) {
          member.node.origin = member.position.map((value, axis) => value + delta[axis]);
          if (isShapeElement(member.node) && member.pivot) member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
        }
        else if (member.node.position) member.node.position = member.position.map((value, axis) => value + delta[axis]);
        else member.node.pivot = member.position.map((value, axis) => value + delta[axis]);
        translateModifierAnchorsFromSnapshot(member.node, member.modifierAnchors, delta);
      });
    }
  }
  if (drag.tool === 'resize' && drag.resizeBatch) {
    const planeDistances = drag.kind === 'plane'
      ? getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event))
      : [];
    for (const target of drag.targets) {
      const targetItem = target.node;
      if (targetItem.type === 'cube') {
        const size = [...target.size];
        const position = [...target.position];
        if (drag.kind === 'plane-uniform') {
          const distance = snapValue(getPlaneUniformDistance(drag, dx, dy), event);
          for (const targetAxis of drag.axisIndices) {
            const proposed = target.size[targetAxis] + distance * 2;
            size[targetAxis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
            position[targetAxis] = target.position[targetAxis] - (size[targetAxis] - target.size[targetAxis]) / 2;
          }
        } else if (drag.kind === 'uniform') {
          const factor = 1 - dy * .01;
          for (let axis = 0; axis < 3; axis++) {
            const proposed = snapValue(target.size[axis] * factor, event);
            size[axis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
            position[axis] = target.position[axis] - (size[axis] - target.size[axis]) / 2;
          }
        } else if (drag.kind === 'plane') {
          drag.axisIndices.forEach((targetAxis, index) => {
            const proposed = target.size[targetAxis] + planeDistances[index];
            size[targetAxis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
            if ((drag.axisSigns[index] || 1) < 0) position[targetAxis] = target.position[targetAxis] - (size[targetAxis] - target.size[targetAxis]);
          });
        } else {
          const targetAxis = drag.axis ? drag.axisIndex : 0;
          const requestedChange = drag.axis ? snapValue(axisDelta, event) : snapValue(dx * fallbackScale, event);
          const proposed = target.size[targetAxis] + requestedChange;
          size[targetAxis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
          if (drag.axis && drag.sign < 0) position[targetAxis] = target.position[targetAxis] - (size[targetAxis] - target.size[targetAxis]);
        }
        targetItem.position = position;
        targetItem.size = size;
      } else if (isShapeElement(targetItem)) {
        if (targetItem.shapeType !== 'polygon_prism') {
          const distance = drag.kind === 'uniform'
            ? target.radius * (Math.max(0, 1 - dy * .01) - 1)
            : drag.kind === 'plane-uniform'
              ? getPlaneUniformDistance(drag, dx, dy)
              : drag.kind === 'plane'
                ? planeDistances.reduce((sum, value) => sum + value, 0) / Math.max(1, planeDistances.length)
                : axisDelta ?? dx * fallbackScale;
          targetItem.parameters.radius = Math.max(0, snapShapeDimension(targetItem, 'radius', target.radius + distance, event));
        } else if (drag.kind === 'plane-uniform') {
          const distance = snapValue(getPlaneUniformDistance(drag, dx, dy), event);
          if (drag.axisIndices.includes(1)) targetItem.parameters.height = Math.max(0, snapShapeDimension(targetItem, 'height', target.height + distance * 2, event));
          if (drag.axisIndices.some(index => index !== 1)) targetItem.parameters.radius = Math.max(0, snapShapeDimension(targetItem, 'radius', target.radius + distance, event));
        } else if (drag.kind === 'uniform') {
          const factor = Math.max(0, 1 - dy * .01);
          targetItem.parameters.radius = Math.max(0, snapShapeDimension(targetItem, 'radius', target.radius * factor, event));
          targetItem.parameters.height = Math.max(0, snapShapeDimension(targetItem, 'height', target.height * factor, event));
        } else if (drag.kind === 'plane') {
          const radialChanges = [];
          drag.axisIndices.forEach((targetAxis, index) => {
            if (targetAxis === 1) targetItem.parameters.height = Math.max(0, snapShapeDimension(targetItem, 'height', target.height + planeDistances[index], event));
            else radialChanges.push(planeDistances[index]);
          });
          if (radialChanges.length) targetItem.parameters.radius = Math.max(0, snapShapeDimension(targetItem, 'radius', target.radius + radialChanges.reduce((sum, value) => sum + value, 0) / radialChanges.length, event));
        } else if (drag.axisIndex === 1) targetItem.parameters.height = Math.max(0, snapShapeDimension(targetItem, 'height', target.height + axisDelta, event));
        else targetItem.parameters.radius = Math.max(0, snapShapeDimension(targetItem, 'radius', target.radius + (axisDelta ?? dx * fallbackScale), event));
      }
    }
    drag.tooltipText = drag.kind === 'uniform' ? `等比縮放 ${drag.targets.length} 項` : `縮放 ${drag.targets.length} 項`;
    return;
  }
  if (drag.tool === 'resize') {
    if (item.type === 'cube') {
      const size = [...drag.size];
      if (drag.kind === 'plane-uniform') {
        const distance = snapValue(getPlaneUniformDistance(drag, dx, dy), event);
        const position = [...drag.position];
        for (const targetAxis of drag.axisIndices) {
          const proposed = drag.size[targetAxis] + distance * 2;
          size[targetAxis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
          const appliedChange = size[targetAxis] - drag.size[targetAxis];
          position[targetAxis] = drag.position[targetAxis] - appliedChange / 2;
        }
        item.position = position;
        drag.tooltipText = `平面等距 ${drag.axisIndices.map(index => `${'XYZ'[index]} ${formatNumber(size[index])}`).join(' / ')} px`;
      } else if (drag.kind === 'uniform') {
        const factor = 1 - dy * .01;
        const changes = [];
        for (let axis = 0; axis < 3; axis++) {
          const proposed = snapValue(drag.size[axis] * factor, event);
          size[axis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
          changes[axis] = size[axis] - drag.size[axis];
        }
        item.position = drag.position.map((value, axis) => value - changes[axis] / 2);
        drag.tooltipText = `等比尺寸 ${size.map(formatNumber).join(' × ')} px`;
      } else if (drag.kind === 'plane') {
        const distances = getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event));
        let position = [...drag.position];
        drag.planeAxes.forEach((planeAxis, index) => {
          const targetAxis = planeAxis.index;
          const proposed = drag.size[targetAxis] + distances[index];
          size[targetAxis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
          const appliedChange = size[targetAxis] - drag.size[targetAxis];
          if (planeAxis.sign < 0) position = position.map((value, component) => value + planeAxis.storedAxis[component] * appliedChange);
        });
        item.position = position;
        drag.tooltipText = `尺寸 ${drag.axisIndices.map(index => `${'XYZ'[index]} ${formatNumber(size[index])}`).join(' / ')} px`;
      } else {
        const targetAxis = drag.axis ? drag.axisIndex : 0;
        const requestedChange = drag.axis ? snapValue(axisDelta, event) : snapValue(dx * fallbackScale, event);
        const proposedSize = drag.size[targetAxis] + requestedChange;
        size[targetAxis] = state.allowNegativeSize ? proposedSize : Math.max(0, proposedSize);
        const appliedChange = size[targetAxis] - drag.size[targetAxis];
        if (drag.axis && drag.sign < 0) item.position = drag.position.map((value, component) => value + drag.storedAxis[component] * appliedChange);
        drag.tooltipText = `尺寸 ${'XYZ'[targetAxis]} ${formatNumber(size[targetAxis])} px`;
      }
      item.size = size;
    }
    if (isShapeElement(item)) {
      if (item.shapeType !== 'polygon_prism') {
        const distances = drag.kind === 'plane' ? getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event)) : [];
        const distance = drag.kind === 'uniform'
          ? drag.radius * (Math.max(0, 1 - dy * .01) - 1)
          : drag.kind === 'plane-uniform'
            ? getPlaneUniformDistance(drag, dx, dy)
            : drag.kind === 'plane'
              ? distances.reduce((sum, value) => sum + value, 0) / Math.max(1, distances.length)
              : axisDelta ?? dx * fallbackScale;
        item.parameters.radius = Math.max(0, snapShapeDimension(item, 'radius', drag.radius + distance, event));
        drag.tooltipText = `半徑 ${formatNumber(item.parameters.radius)} / 邊長 ${formatNumber(polyhedronEdgeLength(item, item.parameters.radius))} px`;
      } else if (drag.kind === 'plane-uniform') {
        const distance = snapValue(getPlaneUniformDistance(drag, dx, dy), event);
        if (drag.axisIndices.includes(1)) item.parameters.height = Math.max(0, snapShapeDimension(item, 'height', drag.height + distance * 2, event));
        if (drag.axisIndices.some(index => index !== 1)) item.parameters.radius = Math.max(0, snapShapeDimension(item, 'radius', drag.radius + distance, event));
        drag.tooltipText = `平面等距 半徑 ${formatNumber(item.parameters.radius)} / 高度 ${formatNumber(item.parameters.height)} px`;
      } else if (drag.kind === 'uniform') {
        const factor = Math.max(0, 1 - dy * .01);
        item.parameters.radius = Math.max(0, snapShapeDimension(item, 'radius', drag.radius * factor, event));
        item.parameters.height = Math.max(0, snapShapeDimension(item, 'height', drag.height * factor, event));
        drag.tooltipText = `等比尺寸 半徑 ${formatNumber(item.parameters.radius)} / 高度 ${formatNumber(item.parameters.height)} px`;
      } else if (drag.kind === 'plane') {
        const distances = getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event));
        const radialChanges = [];
        drag.planeAxes.forEach((planeAxis, index) => {
          if (planeAxis.index === 1) item.parameters.height = Math.max(0, snapShapeDimension(item, 'height', drag.height + distances[index], event));
          else radialChanges.push(distances[index]);
        });
        if (radialChanges.length) item.parameters.radius = Math.max(0, snapShapeDimension(item, 'radius', drag.radius + radialChanges.reduce((sum, value) => sum + value, 0) / radialChanges.length, event));
        drag.tooltipText = `尺寸 半徑 ${formatNumber(item.parameters.radius)} / 高度 ${formatNumber(item.parameters.height)} px`;
      } else {
        if (drag.axisIndex === 1) item.parameters.height = Math.max(0, snapShapeDimension(item, 'height', drag.height + axisDelta, event));
        else item.parameters.radius = Math.max(0, snapShapeDimension(item, 'radius', drag.radius + (axisDelta ?? dx * fallbackScale), event));
        drag.tooltipText = `${drag.axisIndex === 1 ? '高度' : '半徑'} ${formatNumber(drag.axisIndex === 1 ? item.parameters.height : item.parameters.radius)} px`;
      }
    }
  }
  if (drag.tool === 'rotate' && drag.targets.length > 1) {
    const angleStep = getAngleSnapStep(event);
    const angle = drag.axis ? axisDelta : (dx - dy) * .4 * rotationDragSensitivity;
    const snappedDelta = snapAngle(angle, angleStep);
    const commonAxis = drag.axis
      ? drag.axis.vector.map(value => value * drag.sign)
      : [0, 1, 0];
    const commonPivot = drag.selectionContext.pivot || drag.selectionContext.center || state.gizmoOrigin;
    if (drag.batchPreview) {
      drag.previewCommit = {
        type: 'rotate', axis: [...commonAxis], pivot: [...commonPivot], degrees: snappedDelta,
        axisIndex: drag.axisIndex, kind: drag.kind
      };
      sceneRenderer.setSelectionPreviewTransform(rotationMatrixAroundAxis(commonAxis, snappedDelta, commonPivot));
      if (drag.baseSelectionCenter) drag.selectionContext.center = rotatePointAroundAxis(
        drag.baseSelectionCenter, commonPivot, commonAxis, snappedDelta);
      return;
    }
    for (const target of drag.targets) {
      const separate = drag.multiTransformMode === 'separate';
      const targetAxis = separate && drag.kind === 'rotate'
        ? target.transformAxes[drag.axisIndex]
        : commonAxis;
      if (!separate) {
        const nextWorldAnchor = rotatePointAroundAxis(target.worldAnchor, commonPivot, targetAxis, snappedDelta);
        const worldDelta = nextWorldAnchor.map((value, axis) => value - target.worldAnchor[axis]);
        translateCapturedTarget(target, localDeltaFromWorld(target, worldDelta));
      }
      applyTargetRotation(target, targetAxis, snappedDelta, {
        separate,
        selfRelative: separate && drag.kind === 'rotate' && state.transformSpace === 'self',
        axisIndex: drag.axisIndex,
        euler: separate && drag.rotationMode === 'euler' && drag.kind === 'rotate'
      });
    }
    drag.tooltipText = `角度 ${formatSigned(snappedDelta)}°`;
    return;
  }
  if (drag.tool === 'rotate') {
    const angleStep = getAngleSnapStep(event);
    const angle = drag.axis ? axisDelta : (dx - dy) * .4 * rotationDragSensitivity;
    const editsCurveRoll = drag.curveNodeContext?.curve.dimension === 3
      && state.transformSpace === 'self'
      && drag.kind === 'rotate'
      && drag.axisIndex === 2;
    if (editsCurveRoll) {
      const snappedDelta = snapAngle(angle, angleStep);
      drag.curveNodeContext.node.roll = drag.nodeRoll + snappedDelta;
      drag.tooltipText = `滾動角 ${formatSigned(drag.curveNodeContext.node.roll)}°`;
      return;
    }
    if (drag.curveNodeContext?.node.autoTangent) {
      bakeCurveNodeTangent(drag.curveNodeContext.curve, drag.curveNodeContext.index);
    }
    if (drag.axis) {
      const snappedDelta = snapAngle(angle, angleStep);
      if (drag.rotationMode === 'euler' && drag.kind === 'rotate') {
        const target = drag.modifierAnchorContext?.modifier.anchor || drag.curveNodeContext?.node || item;
        target.rotation = [...drag.rotation];
        target.rotation[drag.axisIndex] = drag.rotation[drag.axisIndex] + snappedDelta;
      } else {
        const turn = quaternionFromAxisAngle(drag.rotationAxis, snappedDelta);
        const current = quaternionFromEuler(drag.rotation);
        const target = drag.modifierAnchorContext?.modifier.anchor || drag.curveNodeContext?.node || item;
        target.rotation = eulerFromQuaternion(state.transformSpace === 'self' && drag.kind !== 'rotate-view'
          ? quaternionMultiply(current, turn)
          : quaternionMultiply(turn, current));
      }
      if (drag.curveNodeContext?.curve.dimension === 2) {
        drag.curveNodeContext.node.rotation[0] = 0;
        drag.curveNodeContext.node.rotation[2] = 0;
      }
      if (drag.curveNodeContext) drag.curveNodeContext.node.autoTangent = false;
      drag.tooltipText = `角度 ${formatSigned(snappedDelta)}°`;
    } else {
      const target = drag.modifierAnchorContext?.modifier.anchor || drag.curveNodeContext?.node || item;
      target.rotation = [snapAngle(drag.rotation[0] - dy * .4 * rotationDragSensitivity, angleStep), snapAngle(drag.rotation[1] + dx * .4 * rotationDragSensitivity, angleStep), drag.rotation[2]];
      if (drag.curveNodeContext?.curve.dimension === 2) {
        target.rotation[0] = 0;
        target.rotation[2] = 0;
      }
      if (drag.curveNodeContext) drag.curveNodeContext.node.autoTangent = false;
      drag.tooltipText = `角度 ${formatSigned(Math.hypot(dx, dy) * .4 * rotationDragSensitivity)}°`;
    }
  }
}

function updateTransformTooltip(event, drag) {
  const tooltip = $('#transformTooltip');
  const viewportRect = $('#viewport').getBoundingClientRect();
  tooltip.textContent = drag.tooltipText || '';
  tooltip.style.left = `${Math.max(8, Math.min(viewportRect.width - 150, event.clientX - viewportRect.left + 14))}px`;
  tooltip.style.top = `${Math.max(28, event.clientY - viewportRect.top - 10)}px`;
  tooltip.hidden = !drag.tooltipText;
}

return {
  startTransformDrag,
  dismissPreciseRotationInput,
  openPreciseRotationInput,
  applyExactRotation,
  onPointerMove,
  onScenePointerMove,
  applyPendingTransform,
  commitBatchTransform,
  scheduleTransformUpdate,
  endPointerDrag,
  getPlaneDragDistances,
  getPlaneUniformDistance,
  applyTransformDrag,
  updateTransformTooltip,
};
}
