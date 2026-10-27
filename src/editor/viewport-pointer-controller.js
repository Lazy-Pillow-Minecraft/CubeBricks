import { PAINT_TOOLS } from './tool-registry.js';

export function createViewportPointerController({
  state, sceneCanvas, sceneRenderer, selectionMarquee, uvEditorController,
  getCurveWorldPlane, isBezierElement, isEffectivelyLocked,
  refreshSelectionUi, renderInspector, renderOutlinerWindow, renderScene,
  renderTextureUvOverlay, revealOutlinerItem, selected, selectItem,
  setDockHotspotFocus, startScenePaintPointer, updateFaceSelectionOverlay,
  updateUvFaceUi, uvFaceKey, useKnifePoint, cancelCameraFocus, bakeCameraPan
}) {
function startCurveHandleDrag(event, curve, hit) {
  if (state.mode === 'paint') return;
  event.preventDefault();
  event.stopPropagation();
  sceneCanvas.setPointerCapture(event.pointerId);
  state.selectedModifierUid = null;
  if (isBezierElement(curve)) state.selectedCurveNodeIndex = hit.index;
  const frame = sceneRenderer.getCameraFrame();
  const plane = curve.dimension === 2
    ? getCurveWorldPlane(curve, hit.point)
    : { point: [...hit.point], normal: [...frame.forward] };
  state.dragging = {
    type: 'curve-handle', pointerId: event.pointerId,
    x: event.clientX, y: event.clientY,
    rect: sceneCanvas.getBoundingClientRect(),
    curve, node: curve.type === 'node' ? curve : curve.nodes[hit.index], nodeIndex: hit.index,
    property: hit.property, plane, snapshotTaken: false
  };
  sceneCanvas.classList.add('is-curve-handle');
  state.outlinerWindowStart = -1;
  renderOutlinerWindow();
  renderInspector();
  renderScene();
}

function onPointerDown(event) {
  const rect = sceneCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  if (event.button === 1) {
    startCameraDrag(event, sceneCanvas);
    return;
  }
  if (state.mode === 'display') return;
  if (event.button !== 0) return;
  if (state.mode === 'paint' && PAINT_TOOLS.includes(state.tool)) {
    startScenePaintPointer(event, x, y);
    return;
  }
  const suppressBlankDeselect = Boolean(uvEditorController.focusedDockHotspot);
  if (uvEditorController.focusedDockHotspot) setDockHotspotFocus(null);
  if (state.tool === 'knife') {
    event.preventDefault();
    useKnifePoint(event);
    return;
  }
  if (state.tool === 'faceSelect') {
    event.preventDefault();
    const hit = sceneRenderer.pickDetailed(state.project, x, y, true);
    const cube = hit && state.project.getNode(hit.uid);
    if (!hit?.faceName || cube?.type !== 'cube') {
      if (!suppressBlankDeselect) state.selectedUvFaces = new Set();
      renderTextureUvOverlay(true);
      updateFaceSelectionOverlay();
      return;
    }
    if (!state.selectedUids.has(hit.uid)) {
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
        state.selectedUids = new Set([...state.selectedUids, hit.uid]);
        state.selectedUid = hit.uid;
        state.selectionAnchorUid = hit.uid;
        refreshSelectionUi();
      } else selectItem(hit.uid, { revealInOutliner: true });
    }
    const key = uvFaceKey(hit.uid, hit.faceName);
    const next = event.shiftKey || event.ctrlKey || event.metaKey
      ? new Set(state.selectedUvFaces)
      : new Set();
    if (event.ctrlKey || event.metaKey) next.has(key) ? next.delete(key) : next.add(key);
    else next.add(key);
    state.selectedUvFaces = next;
    state.uvPreviewSelectedFace = { uid: hit.uid, faceName: hit.faceName, points: hit.facePoints.map(point => [...point]) };
    renderTextureUvOverlay(true);
    updateFaceSelectionOverlay();
    updateUvFaceUi();
    return;
  }
  const activeCurve = selected();
  const handleOwner = isBezierElement(activeCurve) || activeCurve?.type === 'node' ? activeCurve : null;
  const nodeHit = isBezierElement(activeCurve) && !isEffectivelyLocked(activeCurve.uid)
    ? sceneRenderer.pickCurveNode(state.project, activeCurve.uid, x, y) : null;
  const unselectedNodeHit = sceneRenderer.pickUnselectedCurveNode(state.project, x, y,
    isBezierElement(activeCurve) ? activeCurve.uid : null, state.selectedCurveNodeIndex,
    14, uid => !isEffectivelyLocked(uid));
  const selectCurveNode = hit => {
    event.preventDefault();
    if (isEffectivelyLocked(hit.uid)) return;
    if (hit.uid !== activeCurve?.uid) selectItem(hit.uid, { revealInOutliner: true });
    state.selectedModifierUid = null;
    state.selectedCurveNodeIndex = hit.index;
    state.outlinerWindowStart = -1;
    renderOutlinerWindow();
    renderInspector();
    renderScene();
  };
  // An unselected node wins over a nearby handle. Once the node is active,
  // its handle takes precedence so the handle remains easy to drag.
  if (unselectedNodeHit) {
    selectCurveNode(unselectedNodeHit);
    return;
  }
  if (handleOwner && !isEffectivelyLocked(handleOwner.uid)) {
    const handleHit = sceneRenderer.pickCurveHandle(state.project, handleOwner.uid, x, y, null);
    if (handleHit) {
      startCurveHandleDrag(event, handleOwner, handleHit);
      return;
    }
  }
  if (isBezierElement(activeCurve) && !isEffectivelyLocked(activeCurve.uid)) {
    if (nodeHit) {
      selectCurveNode(nodeHit);
      return;
    }
    state.selectedCurveNodeIndex = null;
  }
  const selectionHit = sceneRenderer.pickDetailed(state.project, x, y, state.geometryOnly,
    { includeGenerated: !state.modifierResultGhost });
  const hitUid = selectionHit?.generated ? null : selectionHit?.uid || null;
  event.preventDefault();
  sceneCanvas.setPointerCapture(event.pointerId);
  state.dragging = {
    type: 'selection-box', pointerId: event.pointerId,
    x: event.clientX, y: event.clientY, startX: x, startY: y,
    currentX: x, currentY: y, moved: false, hitUid,
    generatedHit: selectionHit?.generated ? selectionHit : null,
    selection: new Set(state.selectedUids),
    mode: viewportSelectionMode(event), suppressBlankDeselect
  };
}

function viewportSelectionMode(event) {
  if (event.ctrlKey || event.metaKey) return 'remove';
  if (event.shiftKey) return 'add';
  return 'replace';
}

function updateSelectionMarquee(drag) {
  const x1 = Math.min(drag.startX, drag.currentX);
  const y1 = Math.min(drag.startY, drag.currentY);
  const x2 = Math.max(drag.startX, drag.currentX);
  const y2 = Math.max(drag.startY, drag.currentY);
  selectionMarquee.hidden = false;
  selectionMarquee.classList.toggle('is-add', drag.mode === 'add');
  selectionMarquee.classList.toggle('is-remove', drag.mode === 'remove');
  selectionMarquee.style.left = `${x1}px`;
  selectionMarquee.style.top = `${y1}px`;
  selectionMarquee.style.width = `${x2 - x1}px`;
  selectionMarquee.style.height = `${y2 - y1}px`;
}

function applyViewportBoxSelection(hitUids, drag) {
  sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
  const next = drag.mode === 'replace' ? new Set() : new Set(drag.selection);
  if (drag.mode === 'remove') {
    const hits = new Set(hitUids);
    for (const uidValue of [...next]) {
      const node = state.project.getNode(uidValue);
      if (hits.has(uidValue)
        || (node?.type === 'group' && state.project.getDescendantElementUids(uidValue).some(uid => hits.has(uid)))) {
        next.delete(uidValue);
      }
    }
  } else hitUids.forEach(uidValue => next.add(uidValue));
  state.selectedUids = next;
  state.selectedGenerated = null;
  const lastHit = [...hitUids].reverse().find(uidValue => next.has(uidValue));
  state.selectedUid = lastHit || (next.has(state.selectedUid) ? state.selectedUid : [...next].at(-1) || null);
  state.selectionAnchorUid = state.selectedUid;
  state.vertexSnapSource = null;
  refreshSelectionUi();
  if (state.selectedUid) revealOutlinerItem(state.selectedUid);
}

function startCameraDrag(event, captureTarget) {
  event.preventDefault();
  cancelCameraFocus();
  if (Number.isFinite(event.pointerId)) captureTarget.setPointerCapture(event.pointerId);
  bakeCameraPan();
  const frame = sceneRenderer.getCameraFrame();
  state.dragging = event.shiftKey || state.axisView
    ? {
        type: 'pan', pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        target: [...state.target], right: [...frame.right], up: [...frame.up], worldPerPixel: frame.worldPerPixel
      }
    : { type: 'orbit', pointerId: event.pointerId, x: event.clientX, y: event.clientY, yaw: state.yaw, pitch: state.pitch };
  sceneCanvas.classList.add(event.shiftKey || state.axisView ? 'is-panning' : 'is-orbiting');
}

return {
  startCurveHandleDrag,
  onPointerDown,
  viewportSelectionMode,
  updateSelectionMarquee,
  applyViewportBoxSelection,
  startCameraDrag,
};
}
