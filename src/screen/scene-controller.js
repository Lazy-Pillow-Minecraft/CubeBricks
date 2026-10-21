export function createSceneController({
  state, $, $$, sceneCanvas, sceneRenderer, inspectorController,
  uvPreviewController, LOCATOR_ICON_SHAPES, getSelectionExpansion,
  getTransformPivot, updateTransformGizmo, refreshUvPreview,
  currentProjection, buildEditorOverlayLines, updateMirrorGuideOverlay,
  updateAxisWidget, updateReferenceImageLayer
}) {
let lockedHoverFrame = null;
let lockedHoverPickFrame = null;
let lockedHoverPointer = null;
let sceneRenderFrame = null;
function renderScene() {
  if (sceneRenderFrame !== null) cancelAnimationFrame(sceneRenderFrame);
  sceneRenderFrame = null;
  const hidePaintSelection = state.mode === 'paint';
  sceneRenderer.render(state.project, hidePaintSelection ? null : state.selectedUid, {
    ...state,
    selectedUids: hidePaintSelection ? new Set() : state.selectedUids,
    selectedUvFaces: hidePaintSelection ? new Set() : state.selectedUvFaces,
    projection: currentProjection(),
    subdivisionEditOwnerUid: inspectorController.subdivisionSession?.ownerUid || null,
    lockedDefaultAlpha: inspectorController.subdivisionSession ? 12 : state.lockedDefaultAlpha,
    lockedHoverFade: inspectorController.subdivisionSession ? false : state.lockedHoverFade,
    editorOverlayLines: buildEditorOverlayLines()
  });
  updateLocatorOverlay();
  updateMirrorGuideOverlay();
  updateTransformGizmo();
  updateAxisWidget();
  updateReferenceImageLayer();
  refreshUvPreview(false);
  if (sceneRenderer.hasActiveCubeTransitions()) scheduleSceneRender();
}



function updateFaceSelectionOverlay() {
  const overlay = $('#faceSelectionOverlay');
  // Face outlines are kept in one GPU line buffer by the scene renderer.  The
  // old SVG path-per-face overlay forced every selected face through DOM layout
  // and reprojection on every camera frame, which made viewport motion degrade
  // continuously on large selections.
  if (overlay) {
    overlay.replaceChildren();
    overlay.setAttribute('hidden', '');
  }
  uvPreviewController.uvPreviewRenderDirty = true;
  scheduleSceneRender();
}

function scheduleSceneRender() {
  if (sceneRenderFrame !== null) return;
  sceneRenderFrame = requestAnimationFrame(() => {
    sceneRenderFrame = null;
    renderScene();
  });
}

function renderLockedHoverFrame() {
  sceneRenderer.redrawLockedOverlay({ ...state, editorOverlayLines: buildEditorOverlayLines() });
  updateLocatorHoverOpacity();
}

function updateLocatorOverlay() {
  const overlay = $('#locatorOverlay');
  const selectedElements = state.mode === 'paint' ? new Set() : getSelectionExpansion().elementSet;
  const rect = sceneCanvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (state.geometryOnly) {
    if (overlay.childElementCount) overlay.replaceChildren();
    overlay.setAttribute('hidden', '');
    return;
  }
  const icons = state.project.elements
    .filter(element => element.type === 'locator' && element.visible !== false)
    .flatMap(element => {
      let world = getTransformPivot(element);
      if (selectedElements.has(element.uid)) world = sceneRenderer.transformSelectionPreviewPoint(world);
      if (!world) return [];
      const point = sceneRenderer.projectPoint(world);
      if (!point || point.behind || point.depth < -1 || point.depth > 1
        || point.x < -9 || point.y < -9 || point.x > width + 9 || point.y > height + 9) return [];
      return [{ element, point, size: sceneRenderer.getLocatorScreenSize(world), opacity: lockedObjectOpacity(element.uid, point) }];
    })
    .sort((left, right) => right.point.depth - left.point.depth);
  const existing = new Map([...overlay.querySelectorAll('[data-locator-uid]')]
    .map(node => [node.dataset.locatorUid, node]));
  icons.forEach(({ element, point, size, opacity }, index) => {
    let node = existing.get(element.uid);
    if (!node) {
      node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      node.classList.add('locator-screen-icon');
      node.dataset.locatorUid = element.uid;
      node.setAttribute('viewBox', '0 0 197.49 189.08');
      node.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      node.innerHTML = LOCATOR_ICON_SHAPES;
    }
    existing.delete(element.uid);
    node.classList.toggle('selected', selectedElements.has(element.uid));
    node.setAttribute('x', point.x - size / 2);
    node.setAttribute('y', point.y - size / 2);
    node.setAttribute('width', size);
    node.setAttribute('height', size);
    node.setAttribute('opacity', opacity);
    node.setAttribute('aria-label', element.name);
    if (overlay.children[index] !== node) overlay.insertBefore(node, overlay.children[index] || null);
  });
  existing.forEach(node => node.remove());
  overlay.toggleAttribute('hidden', icons.length === 0);
}

function isEffectivelyLocked(uidValue) {
  return sceneRenderer.isLocked(uidValue);
}

function lockedObjectOpacity(uidValue, screenPoint) {
  if (!isEffectivelyLocked(uidValue)) return 1;
  const base = inspectorController.subdivisionSession ? .12 : state.lockedDefaultAlpha / 100;
  const hover = state.lockedHoverAlpha / 100;
  if (inspectorController.subdivisionSession || !state.lockedHoverFade || !state.lockedHoverPoint || !screenPoint || state.lockedHoverStrength <= 0) return base;
  const distance = Math.hypot(screenPoint.x - state.lockedHoverPoint[0], screenPoint.y - state.lockedHoverPoint[1]);
  const ratio = Math.min(1, distance / Math.max(1, state.lockedHoverRadius));
  const smooth = ratio * ratio * (3 - 2 * ratio);
  const radialOpacity = hover + (base - hover) * smooth;
  return base + (radialOpacity - base) * state.lockedHoverStrength;
}

function updateLocatorHoverOpacity() {
  $$('#locatorOverlay [data-locator-uid]').forEach(icon => {
    const width = Number(icon.getAttribute('width')) || 0;
    const height = Number(icon.getAttribute('height')) || 0;
    const point = {
      x: (Number(icon.getAttribute('x')) || 0) + width / 2,
      y: (Number(icon.getAttribute('y')) || 0) + height / 2
    };
    icon.setAttribute('opacity', lockedObjectOpacity(icon.dataset.locatorUid, point));
  });
}

function animateLockedHoverStrength(target) {
  target = target ? 1 : 0;
  if (Math.abs(state.lockedHoverStrength - target) < .001) {
    state.lockedHoverStrength = target;
    if (!target) state.lockedHoverPoint = null;
    return;
  }
  if (lockedHoverFrame !== null) cancelAnimationFrame(lockedHoverFrame);
  const from = state.lockedHoverStrength;
  const start = performance.now();
  const tick = now => {
    const progress = Math.min(1, (now - start) / 200);
    const eased = progress * progress * (3 - 2 * progress);
    state.lockedHoverStrength = from + (target - from) * eased;
    renderLockedHoverFrame();
    if (progress < 1) lockedHoverFrame = requestAnimationFrame(tick);
    else {
      lockedHoverFrame = null;
      state.lockedHoverStrength = target;
      if (!target) state.lockedHoverPoint = null;
    }
  };
  lockedHoverFrame = requestAnimationFrame(tick);
}

function updateLockedHover(event) {
  if (!state.lockedHoverFade || !sceneRenderer.hasLockedObjects()) {
    animateLockedHoverStrength(false);
    return;
  }
  const rect = sceneCanvas.getBoundingClientRect();
  state.lockedHoverPoint = [event.clientX - rect.left, event.clientY - rect.top];
  if (state.lockedHoverStrength < .999) animateLockedHoverStrength(true);
  else renderLockedHoverFrame();
}

function scheduleLockedHover(event) {
  if (!state.lockedHoverFade || !sceneRenderer.hasLockedObjects()) {
    lockedHoverPointer = null;
    if (state.lockedHoverStrength > 0) animateLockedHoverStrength(false);
    return;
  }
  lockedHoverPointer = { clientX: event.clientX, clientY: event.clientY };
  if (lockedHoverPickFrame !== null) return;
  lockedHoverPickFrame = requestAnimationFrame(() => {
    lockedHoverPickFrame = null;
    if (lockedHoverPointer) updateLockedHover(lockedHoverPointer);
  });
}

function clearLockedHoverCapture() {
  lockedHoverPointer = null;
  if (lockedHoverPickFrame !== null) cancelAnimationFrame(lockedHoverPickFrame);
  lockedHoverPickFrame = null;
}

return {
  renderScene,
  updateFaceSelectionOverlay,
  scheduleSceneRender,
  renderLockedHoverFrame,
  updateLocatorOverlay,
  isEffectivelyLocked,
  lockedObjectOpacity,
  updateLocatorHoverOpacity,
  animateLockedHoverStrength,
  updateLockedHover,
  scheduleLockedHover,
  clearLockedHoverCapture,
};
}
