import { PAINT_TOOLS } from '../editor/tool-registry.js';

export function createTexturePointerController({
  state, $, dockManager, uvEditorController, getTexturePaintDrag,
  cancelTextureFocus, setDockHotspotFocus, startTexturePaintPointer,
  clientToTextureUv, textureUvEntries, selectedTextureUvEntries,
  normalizedUvBounds, textureUvHandleAt, textureUvHit,
  renderTextureUvOverlay, updateFaceSelectionOverlay, updateTextureBrushCursor,
  moveTexturePaintPointer, endTexturePaintPointer, applyTextureUvDrag,
  clamp, snapValue, snapTexturePan, updateTextureStageTransform,
  snapshot, materializeUvFaces, markDirty, invalidateSelectionRenderGeometry,
  scheduleSceneRender, renderAll, toast
}) {
function startTexturePointer(event) {
  if (![0, 1].includes(event.button)) return;
  event.preventDefault();
  cancelTextureFocus();
  setDockHotspotFocus('texture');
  const preview = $('#texturePreview');
  if (state.mode === 'paint' && event.button === 0 && PAINT_TOOLS.includes(state.tool)) {
    startTexturePaintPointer(event);
    return;
  }
  preview.setPointerCapture(event.pointerId);
  if (event.button === 1) {
    $('#textureBrushCursor').hidden = true;
    preview.style.cursor = '';
    uvEditorController.textureUvDrag = { kind: 'pan', pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    preview.classList.add('is-panning');
    return;
  }
  const point = clientToTextureUv(event.clientX, event.clientY);
  const entries = textureUvEntries();
  let selectedEntries = selectedTextureUvEntries(entries);
  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    uvEditorController.textureUvDrag = {
      kind: 'marquee', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      startUv: point, currentUv: point, moved: false,
      subtract: Boolean(event.ctrlKey || event.metaKey),
      baseSelection: new Set(state.selectedUvFaces), entries
    };
    preview.style.cursor = 'crosshair';
    return;
  }
  if (event.altKey && selectedEntries.length) {
    if (selectedEntries.some(entry => entry.cube.uvMode === 'box')) {
      toast('箱型 UV 只能整體移動，不能逐面重新指定');
      return;
    }
    uvEditorController.textureUvDrag = {
      kind: 'assign', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      startUv: point, currentUv: point, entries: selectedEntries, moved: false, blank: false, snapshotTaken: false
    };
    preview.style.cursor = 'crosshair';
    return;
  }
  const bounds = normalizedUvBounds(selectedEntries);
  const handle = selectedEntries.some(entry => entry.cube.uvMode === 'box') ? null : textureUvHandleAt(point, bounds);
  const hit = textureUvHit(entries, point);
  if (!handle && hit) {
    const next = event.shiftKey || event.ctrlKey || event.metaKey
      ? new Set(state.selectedUvFaces)
      : new Set();
    if (event.ctrlKey || event.metaKey) next.has(hit.key) ? next.delete(hit.key) : next.add(hit.key);
    else next.add(hit.key);
    state.selectedUvFaces = next;
    selectedEntries = selectedTextureUvEntries(entries);
    renderTextureUvOverlay(true);
    updateFaceSelectionOverlay();
  }
  uvEditorController.textureUvDrag = {
    kind: handle ? 'resize' : selectedEntries.length && (!hit || state.selectedUvFaces.has(hit.key)) ? 'move' : 'select',
    handle, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
    startUv: point, moved: false, blank: !hit && !handle, snapshotTaken: false
  };
}

function moveTexturePointer(event) {
  updateTextureBrushCursor(event);
  if (moveTexturePaintPointer(event)) return;
  if (state.mode === 'paint' && PAINT_TOOLS.includes(state.tool) && !uvEditorController.textureUvDrag) return;
  if (!uvEditorController.textureUvDrag) {
    updateTextureUvCursor(event);
    return;
  }
  if (uvEditorController.textureUvDrag.pointerId !== event.pointerId) return;
  if (uvEditorController.textureUvDrag.kind === 'pan') {
    const dx = event.clientX - uvEditorController.textureUvDrag.x;
    const dy = event.clientY - uvEditorController.textureUvDrag.y;
    uvEditorController.textureUvDrag.x = event.clientX;
    uvEditorController.textureUvDrag.y = event.clientY;
    uvEditorController.textureUvDrag.moved ||= Math.hypot(dx, dy) > 0;
    state.textureView.panX += dx;
    state.textureView.panY += dy;
    updateTextureStageTransform();
    return;
  }
  if (!uvEditorController.textureUvDrag.moved && Math.hypot(event.clientX - uvEditorController.textureUvDrag.startX, event.clientY - uvEditorController.textureUvDrag.startY) < 3) return;
  uvEditorController.textureUvDrag.moved = true;
  if (uvEditorController.textureUvDrag.kind === 'marquee') {
    const drag = uvEditorController.textureUvDrag;
    drag.currentUv = clientToTextureUv(event.clientX, event.clientY);
    const [left, right] = [drag.startUv[0], drag.currentUv[0]].sort((a, b) => a - b);
    const [top, bottom] = [drag.startUv[1], drag.currentUv[1]].sort((a, b) => a - b);
    const next = new Set(drag.baseSelection);
    for (const entry of drag.entries) {
      const [u1, v1, u2, v2] = entry.uv;
      if (Math.max(u1, u2) < left || Math.min(u1, u2) > right
        || Math.max(v1, v2) < top || Math.min(v1, v2) > bottom) continue;
      if (drag.subtract) next.delete(entry.key);
      else next.add(entry.key);
    }
    state.selectedUvFaces = next;
    renderTextureUvOverlay(true);
    updateFaceSelectionOverlay();
    return;
  }
  if (uvEditorController.textureUvDrag.kind === 'assign') {
    const [width, height] = uvEditorController.texturePreviewSize;
    const point = clientToTextureUv(event.clientX, event.clientY);
    uvEditorController.textureUvDrag.currentUv = [
      clamp(snapValue(point[0], event), 0, width),
      clamp(snapValue(point[1], event), 0, height)
    ];
    renderTextureUvOverlay(true);
    return;
  }
  if (uvEditorController.textureUvDrag.kind === 'select') return;
  applyTextureUvDrag(event);
}

function onTexturePointerMove(event) {
  if (event.pointerType === 'pen' && getTexturePaintDrag()
    && typeof event.getCoalescedEvents === 'function') {
    const samples = event.getCoalescedEvents();
    if (samples.length) {
      event.preventDefault();
      for (const sample of samples) moveTexturePaintPointer(sample);
      updateTextureBrushCursor(event);
      return;
    }
  }
  moveTexturePointer(event);
}

function endTexturePointer(event) {
  if (endTexturePaintPointer(event)) {
    updateTextureBrushCursor(event);
    return;
  }
  if (!uvEditorController.textureUvDrag || uvEditorController.textureUvDrag.pointerId !== event.pointerId) return;
  const drag = uvEditorController.textureUvDrag;
  uvEditorController.textureUvDrag = null;
  const preview = $('#texturePreview');
  if (preview.hasPointerCapture?.(event.pointerId)) preview.releasePointerCapture(event.pointerId);
  preview.classList.remove('is-panning');
  if (drag.kind === 'pan') {
    snapTexturePan();
    updateTextureStageTransform();
  } else if (drag.kind === 'marquee') {
    if (!drag.moved) {
      const hit = textureUvHit(drag.entries, drag.startUv);
      const next = new Set(drag.baseSelection);
      if (hit) {
        if (drag.subtract) next.delete(hit.key);
        else next.add(hit.key);
      }
      state.selectedUvFaces = next;
    }
    renderTextureUvOverlay(true);
    updateFaceSelectionOverlay();
  } else if (drag.kind === 'assign' && drag.moved && drag.entries.length) {
    snapshot('core.uv.assign');
    materializeUvFaces(drag.entries);
    const [width, height] = uvEditorController.texturePreviewSize;
    const u1 = clamp(snapValue(Math.min(drag.startUv[0], drag.currentUv[0]), event), 0, width);
    const v1 = clamp(snapValue(Math.min(drag.startUv[1], drag.currentUv[1]), event), 0, height);
    const u2 = clamp(snapValue(Math.max(drag.startUv[0], drag.currentUv[0]), event), 0, width);
    const v2 = clamp(snapValue(Math.max(drag.startUv[1], drag.currentUv[1]), event), 0, height);
    if (u2 > u1 && v2 > v1) drag.entries.forEach(entry => {
      entry.cube.faces[entry.faceName].uv = [u1, v1, u2, v2];
    });
    markDirty();
    invalidateSelectionRenderGeometry();
    renderTextureUvOverlay();
    scheduleSceneRender();
  } else if (!drag.moved && drag.blank) {
    state.selectedUvFaces = new Set();
    renderTextureUvOverlay(true);
    updateFaceSelectionOverlay();
  } else if (drag.snapshotTaken) {
    markDirty();
    renderAll('selection');
  }
  updateTextureUvCursor(event);
}

function updateTextureUvCursor(event) {
  const preview = $('#texturePreview');
  if (!uvEditorController.textureViewLayout || !selectedTextureUvEntries().length) {
    preview.style.cursor = event?.altKey ? 'crosshair' : '';
    return;
  }
  if (event?.altKey) {
    preview.style.cursor = 'crosshair';
    return;
  }
  const point = clientToTextureUv(event.clientX, event.clientY);
  const selectedEntries = selectedTextureUvEntries();
  const bounds = normalizedUvBounds(selectedEntries);
  const handle = selectedEntries.some(entry => entry.cube.uvMode === 'box') ? null : textureUvHandleAt(point, bounds);
  const cursors = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
  preview.style.cursor = cursors[handle]
    || (textureUvHit(selectedEntries, point) ? 'move' : '');
}

function wheelTextureView(event) {
  event.preventDefault();
  cancelTextureFocus();
  setDockHotspotFocus('texture');
  if (!uvEditorController.textureViewLayout) updateTextureStageTransform();
  if (event.ctrlKey || event.metaKey) {
    const before = clientToTextureUv(event.clientX, event.clientY);
    state.textureView.zoom = Math.max(.05, Math.min(64, state.textureView.zoom * (event.deltaY > 0 ? .9 : 1.1)));
    updateTextureStageTransform();
    const after = clientToTextureUv(event.clientX, event.clientY);
    state.textureView.panX += (after[0] - before[0]) * uvEditorController.textureViewLayout.scale;
    state.textureView.panY += (after[1] - before[1]) * uvEditorController.textureViewLayout.scale;
  } else if (event.shiftKey) state.textureView.panX -= event.deltaY || event.deltaX;
  else if (uvEditorController.textureViewLayout.textureHeight * uvEditorController.textureViewLayout.scale > uvEditorController.textureViewLayout.viewportHeight + 1) state.textureView.panY -= event.deltaY;
  snapTexturePan();
  updateTextureStageTransform();
  updateTextureBrushCursor(event);
}

function setUvCoordinate(coordinate, value) {
  const entries = selectedTextureUvEntries();
  if (!entries.length || !Number.isFinite(value)) return;
  if (entries.some(entry => entry.cube.uvMode === 'box')) return toast('箱型 UV 的六面相對位置固定，不能單獨修改面座標');
  snapshot('core.uv.coordinate');
  const maximum = coordinate % 2 === 0 ? uvEditorController.texturePreviewSize[0] : uvEditorController.texturePreviewSize[1];
  const nextValue = clamp(value, 0, maximum);
  materializeUvFaces(entries);
  entries.forEach(entry => { entry.cube.faces[entry.faceName].uv[coordinate] = nextValue; });
  markDirty();
  renderAll('selection');
  updateTextureStageTransform();
}

function syncTexturePreviewPriority() {
  const panel = dockManager?.get('texture');
  const element = panel?.element || $('[data-panel="texture"]');
  if (!element || element.hidden || element.classList.contains('is-collapsed')) return;
  const width = element.getBoundingClientRect().width || panel?.state.width || 236;
  const [textureWidth, textureHeight] = uvEditorController.texturePreviewSize;
  const previewHeight = Math.max(1, width - 24) * textureHeight / textureWidth;
  element.style.setProperty('--texture-preview-priority-height', `${previewHeight}px`);
}

return {
  startTexturePointer,
  moveTexturePointer,
  onTexturePointerMove,
  endTexturePointer,
  updateTextureUvCursor,
  wheelTextureView,
  setUvCoordinate,
  syncTexturePreviewPriority,
};
}
