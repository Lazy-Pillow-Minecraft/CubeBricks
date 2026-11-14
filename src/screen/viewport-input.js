import { performanceMonitor } from '../utils/performance-monitor.js';
import { shortcutHeld } from './shortcuts.js';

// Keep pointer capture, camera input sampling and the rotation double-click
// state together. The workspace binder calls this in the original event order.
export function createViewportInputBinder({
  state, $, $$, viewport, sceneCanvas, sceneRenderer, cameraController, palette,
  enterAxisView, beginAxisWidgetDrag, moveAxisWidgetDrag, endAxisWidgetDrag,
  startCameraDrag, selected, isBezierElement, isEffectivelyLocked, selectItem,
  renderOutlinerWindow, renderInspector, renderScene, resolveGizmoHandle, setTool,
  updateSelectionLabels, useVertexSnapPoint, movePivotToRotationVertex,
  startTransformDrag, updateGizmoDepthHover, onPointerMove, restore, markDirty,
  openPreciseRotationInput, endPointerDrag, toast, onPointerDown, onScenePointerMove,
  scheduleLockedHover, clearLockedHoverCapture, animateLockedHoverStrength,
  cancelCameraFocus, scheduleSceneRender, refreshUvPreview
}) {
  let recentRotationPress = null;
  let pendingRotationPress = null;
  let lastProfiledPointerAt = 0;
  let lastProfiledPointerStamp = 0;
  let lastProfiledPointerId = null;
  let lastProfiledRawPointerAt = 0;
  let lastInputProfileSession = 0;
  function resetInputProfileSession() {
    if (lastInputProfileSession === performanceMonitor.session) return;
    lastInputProfileSession = performanceMonitor.session;
    lastProfiledPointerAt = lastProfiledPointerStamp = lastProfiledRawPointerAt = 0;
    lastProfiledPointerId = null;
  }
  let pendingCameraRawPointer = null;
  let cameraRawPointerFrame = null;
  let lastCameraDomInputAt = 0;
  let cameraCursorPollFrame = null;
  let cameraCursorPollPending = false;
  function noteCameraPointerInput(event) {
    const drag = state.dragging;
    if (!drag || !['pan', 'orbit'].includes(drag.type) || drag.pointerId !== event.pointerId) return;
    lastCameraDomInputAt = performance.now();
    ensureCameraCursorPoll();
  }
  function ensureCameraCursorPoll() {
    // Native cursor polling has not recovered a frame during an input gap, and
    // its IPC replies can themselves be delayed. Keep it for the short profiler
    // capture only, so ordinary camera drags do not create extra main-process work.
    if (!performanceMonitor.enabled || cameraCursorPollFrame !== null
      || !window.cubeBricksDesktop?.getCursorClientPoint) return;
    const poll = now => {
      cameraCursorPollFrame = null;
      const drag = state.dragging;
      if (!performanceMonitor.enabled || !drag || !['pan', 'orbit'].includes(drag.type)
        || !document.hasFocus()) return;
      cameraCursorPollFrame = requestAnimationFrame(poll);
      if (now - lastCameraDomInputAt < 35 || cameraCursorPollPending) return;
      cameraCursorPollPending = true;
      const requestedAt = performance.now();
      window.cubeBricksDesktop.getCursorClientPoint().then(point => {
        cameraCursorPollPending = false;
        performanceMonitor.record('input.nativePollLatency', performance.now() - requestedAt);
        if (Number.isFinite(point?.mainDurationMs))
          performanceMonitor.record('input.nativeMainDuration', point.mainDurationMs);
        performanceMonitor.record(point ? 'input.nativePoll' : 'input.nativeNull', 1);
        const current = state.dragging;
        if (point && current === drag && Number.isFinite(point.x) && Number.isFinite(point.y)
          && Math.hypot(point.x - current.lastX, point.y - current.lastY) >= .75)
          performanceMonitor.record('input.nativeMoved', 1);
        if (lastCameraDomInputAt > requestedAt) performanceMonitor.record('input.nativeLate', 1);
        // Measure the native path without injecting delayed samples into a drag.
      }).catch(() => { cameraCursorPollPending = false; });
    };
    cameraCursorPollFrame = requestAnimationFrame(poll);
  }
  return function bindViewportInput() {
    $$('[data-view-axis]').forEach(button => button.addEventListener('click', event => {
      if (cameraController.suppressAxisWidgetClick) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      enterAxisView(button.dataset.viewAxis, Number(button.dataset.axisSign));
    }));
    const axisWidget = $('.axis-widget');
    // Viewport pointer events are registered in capture and bubble order.
    axisWidget.addEventListener('pointerdown', beginAxisWidgetDrag);
    axisWidget.addEventListener('pointermove', moveAxisWidgetDrag);
    axisWidget.addEventListener('pointerup', endAxisWidgetDrag);
    axisWidget.addEventListener('pointercancel', endAxisWidgetDrag);
    $('#transformGizmo').addEventListener('pointerdown', event => {
      if (event.button === 1) {
        event.preventDefault();
        event.stopPropagation();
        startCameraDrag(event, event.currentTarget);
        return;
      }
      if (event.button !== 0) return;
      const curve = selected();
      if (state.mode !== 'paint') {
        const rect = sceneCanvas.getBoundingClientRect();
        const node = sceneRenderer.pickUnselectedCurveNode(state.project,
          event.clientX - rect.left, event.clientY - rect.top,
          isBezierElement(curve) ? curve.uid : null, state.selectedCurveNodeIndex,
          14, uid => !isEffectivelyLocked(uid));
        if (node) {
          event.preventDefault();
          event.stopPropagation();
          if (node.uid !== curve?.uid) selectItem(node.uid, { revealInOutliner: true });
          state.selectedCurveNodeIndex = node.index;
          state.selectedModifierUid = null;
          state.outlinerWindowStart = -1;
          renderOutlinerWindow();
          renderInspector();
          renderScene();
          return;
        }
      }
      const handle = resolveGizmoHandle(event);
      if (!handle) return;
      event.preventDefault();
      event.stopPropagation();
      if (handle.dataset.kind === 'modifier-anchor') {
        const owner = selected();
        const modifier = [...(owner?.modifiers || []), ...(owner?.operators || [])].find(entry => entry.uid === handle.dataset.modifierUid);
        if (!modifier?.enabled) return;
        state.selectedModifierUid = modifier.uid;
        state.selectedModifierNodeUid = handle.dataset.modifierNodeUid || null;
        state.selectedCurveNodeIndex = null;
        state.inspectorPage = modifier.type === 'paint_symmetry' ? 'operators' : 'modifiers';
        if (!['move', 'rotate', 'pivot'].includes(state.tool)) setTool('move');
        else {
          renderInspector();
          renderScene();
          updateSelectionLabels();
        }
        return;
      }
      if (handle.dataset.kind === 'vertex') {
        useVertexSnapPoint(state.vertexSnapPoints?.[Number(handle.dataset.vertexIndex)]);
        return;
      }
      if (handle.dataset.kind === 'rotation-pivot-vertex') {
        if (state.rotationVertexPick) {
          movePivotToRotationVertex(state.rotationPivotVertices[Number(handle.dataset.vertexIndex)]);
        }
        return;
      }
      if (state.tool === 'rotate' && handle.dataset.kind?.startsWith('rotate')) {
        const signature = `${handle.dataset.kind}:${handle.dataset.axis || 'view'}:${handle.dataset.sign || 1}`;
        pendingRotationPress = {
          x: event.clientX, y: event.clientY,
          signature, selectedUid: state.selectedUid,
          serialized: state.project.serialize(), historyLength: state.history.length,
          future: [...state.future], dirty: state.dirty
        };
      } else pendingRotationPress = null;
      const axisKey = handle.dataset.axis;
      const axisIndex = /^[0-2]$/.test(axisKey) ? Number(axisKey) : null;
      const axisIndices = handle.dataset.axes
        ? handle.dataset.axes.split(',').map(Number).filter(index => index >= 0 && index <= 2)
        : axisIndex === null ? [] : [axisIndex];
      const axisSigns = handle.dataset.signs
        ? handle.dataset.signs.split(',').map(Number)
        : axisIndex === null ? [] : [Number(handle.dataset.sign || 1)];
      startTransformDrag(event, axisIndex, event.currentTarget, handle.dataset.kind || 'free',
        Number(handle.dataset.sign || 1), handle, axisKey, axisIndices, axisSigns);
    });
    $('#transformGizmo').addEventListener('pointermove', event => {
      updateGizmoDepthHover(event);
      onPointerMove(event);
    });
    $('#transformGizmo').addEventListener('click', event => {
      if (event.detail === 1 && pendingRotationPress) recentRotationPress = pendingRotationPress;
    });
    $('#viewport').addEventListener('dblclick', event => {
      const prior = recentRotationPress;
      if (!prior || state.tool !== 'rotate' || prior.selectedUid !== state.selectedUid
        || Math.hypot(event.clientX - prior.x, event.clientY - prior.y) >= 12) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      recentRotationPress = null;
      // The browser's dblclick event uses the operating system's click timing.
      // Both pointer drags may already have committed by now; roll them back.
      if (state.project.serialize() !== prior.serialized) {
        state.history.length = prior.historyLength;
        state.future = prior.future;
        restore(prior.serialized);
        markDirty(prior.dirty);
      }
      const matching = control => control
        && `${control.dataset.kind}:${control.dataset.axis || 'view'}:${control.dataset.sign || 1}` === prior.signature;
      const resolved = resolveGizmoHandle(event);
      const handle = matching(resolved) ? resolved
        : [...$('#transformGizmo').querySelectorAll('.gizmo-control')].find(matching);
      if (handle) openPreciseRotationInput(event, handle);
    }, true);
    $('#transformGizmo').addEventListener('pointerleave', () => {
      $('#transformGizmo').querySelectorAll('.depth-hover').forEach(control => control.classList.remove('depth-hover'));
    });
    $('#transformGizmo').addEventListener('pointerup', endPointerDrag);
    $('#transformGizmo').addEventListener('pointercancel', endPointerDrag);
    sceneCanvas.addEventListener('pointerdown', () => sceneCanvas.focus({ preventScroll: true }), true);
    const controlsHintKey = 'cubebricks.controls-hint-seen';
    let controlsHintSeen = false;
    try { controlsHintSeen = window.localStorage.getItem(controlsHintKey) === '1'; } catch { /* Storage may be unavailable. */ }
    let firstDrag = null;
    const finishControlsHint = () => {
      controlsHintSeen = true;
      firstDrag = null;
      try { window.localStorage.setItem(controlsHintKey, '1'); } catch { /* Keep this session quiet. */ }
    };
    sceneCanvas.addEventListener('pointerdown', event => {
      if (controlsHintSeen) return;
      if (event.button === 1) {
        finishControlsHint();
        return;
      }
      if ((event.button === 0 || event.button === 2) && state.mode === 'edit' && !state.blockbenchControls)
        firstDrag = { pointerId: event.pointerId, button: event.button, x: event.clientX, y: event.clientY };
    }, true);
    sceneCanvas.addEventListener('pointermove', event => {
      if (!firstDrag || controlsHintSeen || event.pointerId !== firstDrag.pointerId) return;
      const held = firstDrag.button === 0 ? event.buttons & 1 : event.buttons & 2;
      if (!held) {
        firstDrag = null;
        return;
      }
      if (Math.hypot(event.clientX - firstDrag.x, event.clientY - firstDrag.y) < 7) return;
      finishControlsHint();
      toast('如果希望使用 BB 风格的界面操作，可以进入设置调整');
    }, true);
    sceneCanvas.addEventListener('pointerup', event => { if (firstDrag?.pointerId === event.pointerId) firstDrag = null; }, true);
    sceneCanvas.addEventListener('pointercancel', event => { if (firstDrag?.pointerId === event.pointerId) firstDrag = null; }, true);
    sceneCanvas.addEventListener('pointerdown', event => {
      onPointerDown(event);
      noteCameraPointerInput(event);
    });
    sceneCanvas.addEventListener('pointermove', event => {
      if (!performanceMonitor.enabled) {
        onScenePointerMove(event);
        noteCameraPointerInput(event);
        return;
      }
      resetInputProfileSession();
      const started = performance.now();
      if (event.buttons && lastProfiledPointerId === event.pointerId && lastProfiledPointerAt) {
        performanceMonitor.record('input.pointerInterval', started - lastProfiledPointerAt);
        if (lastProfiledPointerStamp) performanceMonitor.record('input.eventInterval', event.timeStamp - lastProfiledPointerStamp);
      }
      const eventLag = started - event.timeStamp;
      if (eventLag >= 0 && eventLag < 1000) performanceMonitor.record('input.eventLag', eventLag);
      lastProfiledPointerAt = event.buttons ? started : 0;
      lastProfiledPointerStamp = event.buttons ? event.timeStamp : 0;
      lastProfiledPointerId = event.pointerId;
      onScenePointerMove(event);
      performanceMonitor.record('input.pointerHandler', performance.now() - started);
      noteCameraPointerInput(event);
    });
    // Chromium may defer/coalesce pointermove while the compositor continues to
    // produce frames. The camera only needs the newest position each frame, so
    // accept raw updates as an alternate source without processing every mouse
    // polling sample or duplicating a later pointermove at the same position.
    sceneCanvas.addEventListener('pointerrawupdate', event => {
      const drag = state.dragging;
      if (!drag || !['pan', 'orbit'].includes(drag.type) || event.pointerId !== drag.pointerId) return;
      noteCameraPointerInput(event);
      if (performanceMonitor.enabled) {
        resetInputProfileSession();
        const now = performance.now();
        if (lastProfiledRawPointerAt && now - lastProfiledRawPointerAt < 1000)
          performanceMonitor.record('input.rawInterval', now - lastProfiledRawPointerAt);
        lastProfiledRawPointerAt = now;
      }
      pendingCameraRawPointer = event;
      if (cameraRawPointerFrame !== null) return;
      cameraRawPointerFrame = requestAnimationFrame(() => {
        cameraRawPointerFrame = null;
        const sample = pendingCameraRawPointer;
        pendingCameraRawPointer = null;
        const currentDrag = state.dragging;
        if (!sample || !currentDrag || !['pan', 'orbit'].includes(currentDrag.type)
          || sample.pointerId !== currentDrag.pointerId
          || sample.timeStamp <= (currentDrag.lastEventStamp ?? -Infinity)
          || sample.clientX === currentDrag.lastX && sample.clientY === currentDrag.lastY) return;
        onScenePointerMove(sample);
      });
    });
    viewport.addEventListener('pointermove', event => {
      if (!performanceMonitor.enabled) {
        scheduleLockedHover(event);
        return;
      }
      const started = performance.now();
      scheduleLockedHover(event);
      performanceMonitor.record('input.hoverHandler', performance.now() - started);
    });
    viewport.addEventListener('pointerleave', () => {
      sceneCanvas.classList.remove('is-curve-handle-hover', 'is-curve-node-hover');
      $('#transformGizmo').querySelectorAll('.curve-node-marker.hover').forEach(marker => marker.classList.remove('hover'));
      clearLockedHoverCapture();
      animateLockedHoverStrength(false);
      if (state.tool !== 'knife' || state.dragging) return;
      state.knifeHover = null;
      renderScene();
    });
    sceneCanvas.addEventListener('pointerup', endPointerDrag);
    sceneCanvas.addEventListener('pointercancel', endPointerDrag);
    sceneCanvas.addEventListener('lostpointercapture', endPointerDrag);
    sceneCanvas.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
    window.addEventListener('wheel', event => {
      if (!shortcutHeld('temporaryEyedropper') || !palette.scrollSelectedPaletteColor(event.deltaY)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, passive: false });
    sceneCanvas.addEventListener('wheel', event => {
      event.preventDefault();
      cancelCameraFocus();
      state.zoom = Math.max(.002, Math.min(100, state.zoom * (event.deltaY > 0 ? .9 : 1.1)));
      scheduleSceneRender();
    }, { passive: false });
    window.addEventListener('resize', renderScene);
    document.addEventListener('visibilitychange', refreshUvPreview);
  };
}
