import { getBlockbenchBoxUv, isCubeFaceCulled } from '../render/webgl-renderer.js';

const CUBE_FACE_NAMES = ['north', 'east', 'south', 'west', 'up', 'down'];

export function createUvEditorController({
  state, $, $$, getSelectionExpansion, activeTextureAsset,
  textureAtlasReferences, effectiveFaceTextureReference, isFaceTiled,
  round, renderTextureTileControls, syncTexturePreviewPriority,
  clamp, snapValue, snapshot, markDirty,
  invalidateSelectionRenderGeometry, scheduleSceneRender
}) {
let texturePreviewSize = [1, 1];
let focusedDockHotspot = null;
let textureUvDrag = null;
let textureViewLayout = null;
let textureFocusFrame = null;
let textureUvEntryCache = null;

function updateTexturePreviewFrame(width, height) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  texturePreviewSize = [safeWidth, safeHeight];
  const preview = $('#texturePreview');
  preview.style.setProperty('--texture-aspect', `${safeWidth} / ${safeHeight}`);
  $('.texture-preview > span').textContent = `${safeWidth} × ${safeHeight}`;
  syncTexturePreviewPriority();
  updateTextureStageTransform();
}

function uvFaceKey(uidValue, faceName) {
  return `${uidValue}::${faceName}`;
}

function parseUvFaceKey(key) {
  const separator = key.lastIndexOf('::');
  return separator < 0 ? null : { uid: key.slice(0, separator), faceName: key.slice(separator + 2) };
}

function textureUvEntries() {
  const expansion = getSelectionExpansion();
  if (textureUvEntryCache?.project === state.project
    && textureUvEntryCache.selection === state.selectedUids
    && textureUvEntryCache.selectionSize === state.selectedUids.size
    && textureUvEntryCache.activeTextureUid === state.activeTextureUid
    && textureUvEntryCache.hierarchyRevision === state.project.hierarchyRevision) return textureUvEntryCache.entries;
  const entries = [];
  const activeAsset = activeTextureAsset();
  const activeReferences = activeAsset
    ? new Set(textureAtlasReferences(activeAsset, state.textureAssets.indexOf(activeAsset))
      .flatMap(reference => [reference, reference.startsWith('#') ? reference.slice(1) : `#${reference}`]))
    : null;
  for (const uidValue of expansion.elementUids) {
    const cube = state.project.getNode(uidValue);
    if (cube?.type !== 'cube') continue;
    for (const faceName of CUBE_FACE_NAMES) {
      const face = cube.faces?.[faceName];
      if (isFaceTiled(face)) continue;
      const textureReference = effectiveFaceTextureReference(face);
      if (activeReferences && !activeReferences.has(String(textureReference))) continue;
      let uv = cube.uvMode !== 'box' && Array.isArray(face?.uv) && face.uv.length >= 4
        ? face.uv.map(Number)
        : getBlockbenchBoxUv(cube, faceName).map(Number);
      if (!uv.every(Number.isFinite)) uv = getBlockbenchBoxUv(cube, faceName).map(Number);
      entries.push({ key: uvFaceKey(cube.uid, faceName), uid: cube.uid, cube, faceName, face, uv, culled: isCubeFaceCulled(face) });
    }
  }
  const byKey = new Map(entries.map(entry => [entry.key, entry]));
  const faceCounts = new Map(CUBE_FACE_NAMES.map(faceName => [faceName, 0]));
  entries.forEach(entry => faceCounts.set(entry.faceName, (faceCounts.get(entry.faceName) || 0) + 1));
  textureUvEntryCache = {
    project: state.project,
    selection: state.selectedUids,
    selectionSize: state.selectedUids.size,
    activeTextureUid: state.activeTextureUid,
    hierarchyRevision: state.project.hierarchyRevision,
    entries,
    byKey,
    faceCounts
  };
  return entries;
}

function selectedTextureUvEntries(entries = textureUvEntries()) {
  const byKey = textureUvEntryCache?.entries === entries
    ? textureUvEntryCache.byKey
    : new Map(entries.map(entry => [entry.key, entry]));
  const selected = [];
  const retainedTileKeys = [];
  let removedInvalid = false;
  for (const key of state.selectedUvFaces) {
    const entry = byKey.get(key);
    if (entry) selected.push(entry);
    else {
      const parsed = parseUvFaceKey(key);
      if (parsed && isFaceTiled(state.project.getNode(parsed.uid)?.faces?.[parsed.faceName])) retainedTileKeys.push(key);
      else removedInvalid = true;
    }
  }
  if (removedInvalid) state.selectedUvFaces = new Set([...selected.map(entry => entry.key), ...retainedTileKeys]);
  return selected;
}

function normalizedUvBounds(entries) {
  if (!entries.length) return null;
  const u = entries.flatMap(entry => [entry.uv[0], entry.uv[2]]);
  const v = entries.flatMap(entry => [entry.uv[1], entry.uv[3]]);
  return { minU: Math.min(...u), minV: Math.min(...v), maxU: Math.max(...u), maxV: Math.max(...v) };
}

function textureUvPath(entries, layout) {
  const screen = (value, offset) => Math.round(offset + value * layout.scale) + .5;
  return entries.map(({ uv }) => {
    const [u1, v1, u2, v2] = uv;
    const x1 = screen(u1, layout.left), y1 = screen(v1, layout.top);
    const x2 = screen(u2, layout.left), y2 = screen(v2, layout.top);
    return `M${x1},${y1}H${x2}V${y2}H${x1}Z`;
  }).join('');
}

function updateTextureUvFields(selectedEntries) {
  const boxUv = selectedEntries.some(entry => entry.cube.uvMode === 'box');
  $$('[data-uv-coordinate]').forEach(input => {
    const coordinate = Number(input.dataset.uvCoordinate);
    const first = selectedEntries[0]?.uv[coordinate];
    const shared = selectedEntries.length && selectedEntries.every(entry => Math.abs(entry.uv[coordinate] - first) < 1e-8);
    if (document.activeElement !== input) input.value = shared ? String(round(first)) : '';
    input.disabled = !selectedEntries.length || boxUv;
    input.title = boxUv ? '箱型 UV 的各面位置固定；可在預覽中整體移動' : '';
    input.dataset.mixed = selectedEntries.length && !shared ? 'true' : 'false';
  });
}

function renderTextureUvOverlay(selectionOnly = false) {
  renderTextureTileControls();
  const overlay = $('#textureUvOverlay');
  if (!overlay || !textureViewLayout) return;
  const layout = textureViewLayout;
  const entries = textureUvEntries();
  const visibleEntries = entries.filter(entry => !entry.culled);
  const culledEntries = entries.filter(entry => entry.culled);
  const selectedEntries = selectedTextureUvEntries(entries);
  const selectedPath = textureUvPath(selectedEntries, layout);
  const bounds = normalizedUvBounds(selectedEntries);
  let boundsMarkup = '';
  if (bounds) {
    const { minU, minV, maxU, maxV } = bounds;
    const screenX = value => Math.round(layout.left + value * layout.scale) + .5;
    const screenY = value => Math.round(layout.top + value * layout.scale) + .5;
    const left = screenX(minU), top = screenY(minV), right = screenX(maxU), bottom = screenY(maxV);
    const handleSize = 7;
    const positions = [
      ['nw', left, top], ['n', (left + right) / 2, top], ['ne', right, top],
      ['w', left, (top + bottom) / 2], ['e', right, (top + bottom) / 2],
      ['sw', left, bottom], ['s', (left + right) / 2, bottom], ['se', right, bottom]
    ];
    boundsMarkup = `<rect class="texture-uv-bounds" x="${left}" y="${top}" width="${right - left}" height="${bottom - top}"/>${positions.map(([name, x, y]) => `<rect class="texture-uv-handle" data-uv-handle="${name}" x="${Math.round(x - handleSize / 2)}" y="${Math.round(y - handleSize / 2)}" width="${handleSize}" height="${handleSize}"/>`).join('')}`;
  }
  let allPathNode = overlay.querySelector('.texture-uv-all');
  let culledPathNode = overlay.querySelector('.texture-uv-culled');
  let selectedPathNode = overlay.querySelector('.texture-uv-selected');
  let selectionUi = overlay.querySelector('.texture-uv-selection-ui');
  if (!selectionOnly || !allPathNode || !culledPathNode || !selectedPathNode || !selectionUi) {
    overlay.setAttribute('viewBox', `0 0 ${layout.viewportWidth} ${layout.viewportHeight}`);
    overlay.innerHTML = '<path class="texture-uv-all"/><path class="texture-uv-culled"/><path class="texture-uv-selected"/><g class="texture-uv-selection-ui"></g><rect class="texture-uv-alt-box" hidden/>';
    allPathNode = overlay.querySelector('.texture-uv-all');
    culledPathNode = overlay.querySelector('.texture-uv-culled');
    selectedPathNode = overlay.querySelector('.texture-uv-selected');
    selectionUi = overlay.querySelector('.texture-uv-selection-ui');
    allPathNode.setAttribute('d', textureUvPath(visibleEntries, layout));
    culledPathNode.setAttribute('d', textureUvPath(culledEntries, layout));
  }
  selectedPathNode.setAttribute('d', selectedPath);
  selectionUi.innerHTML = boundsMarkup;
  const altBox = overlay.querySelector('.texture-uv-alt-box');
  if (altBox && textureUvDrag?.kind === 'assign' && textureUvDrag.moved && textureUvDrag.currentUv) {
    const start = textureUvDrag.startUv, end = textureUvDrag.currentUv;
    const left = layout.left + Math.min(start[0], end[0]) * layout.scale;
    const top = layout.top + Math.min(start[1], end[1]) * layout.scale;
    altBox.setAttribute('x', String(left));
    altBox.setAttribute('y', String(top));
    altBox.setAttribute('width', String(Math.abs(end[0] - start[0]) * layout.scale));
    altBox.setAttribute('height', String(Math.abs(end[1] - start[1]) * layout.scale));
    altBox.removeAttribute('hidden');
  } else altBox?.setAttribute('hidden', '');
  updateTextureUvFields(selectedEntries);
  const selectedFaceCounts = new Map(CUBE_FACE_NAMES.map(faceName => [faceName, 0]));
  selectedEntries.forEach(entry => selectedFaceCounts.set(entry.faceName, (selectedFaceCounts.get(entry.faceName) || 0) + 1));
  $$('[data-texture-face]').forEach(button => {
    const faceName = button.dataset.textureFace;
    const total = textureUvEntryCache?.faceCounts.get(faceName) || 0;
    button.classList.toggle('active', total > 0 && selectedFaceCounts.get(faceName) === total);
  });
}

function updateTextureStageTransform() {
  const preview = $('#texturePreview');
  const stage = $('#textureStage');
  if (!preview || !stage) return;
  const viewportWidth = Math.max(1, preview.clientWidth);
  const viewportHeight = Math.max(1, preview.clientHeight);
  const [textureWidth, textureHeight] = texturePreviewSize;
  const baseScale = Math.min(viewportWidth / textureWidth, viewportHeight / textureHeight);
  state.textureView.zoom = Math.max(.05, Math.min(64, Number(state.textureView.zoom) || 1));
  const scale = baseScale * state.textureView.zoom;
  const left = (viewportWidth - textureWidth * scale) / 2 + state.textureView.panX;
  const top = (viewportHeight - textureHeight * scale) / 2 + state.textureView.panY;
  stage.style.width = `${textureWidth}px`;
  stage.style.height = `${textureHeight}px`;
  stage.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
  textureViewLayout = { left, top, scale, baseScale, viewportWidth, viewportHeight, textureWidth, textureHeight };
  renderTextureUvOverlay();
  window.dispatchEvent(new Event('cubebricks:texture-view-change'));
}

function cancelTextureFocus() {
  if (textureFocusFrame !== null) cancelAnimationFrame(textureFocusFrame);
  textureFocusFrame = null;
}

function animateTextureView(target, animate = true) {
  cancelTextureFocus();
  const from = { ...state.textureView };
  if (!animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    state.textureView = { ...target };
    updateTextureStageTransform();
    return;
  }
  const started = performance.now();
  const duration = 250;
  const step = now => {
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - (1 - progress) ** 3;
    state.textureView = {
      zoom: from.zoom + (target.zoom - from.zoom) * eased,
      panX: from.panX + (target.panX - from.panX) * eased,
      panY: from.panY + (target.panY - from.panY) * eased
    };
    updateTextureStageTransform();
    if (progress < 1) textureFocusFrame = requestAnimationFrame(step);
    else textureFocusFrame = null;
  };
  textureFocusFrame = requestAnimationFrame(step);
}

function resetTextureView(animate = true) {
  animateTextureView({ zoom: 1, panX: 0, panY: 0 }, animate);
}

function focusSelectedTextureUvs(animate = true, retry = true) {
  const entries = selectedTextureUvEntries();
  const bounds = normalizedUvBounds(entries);
  if (!bounds || !Object.values(bounds).every(Number.isFinite)) return resetTextureView(animate);
  const preview = $('#texturePreview');
  if (preview.clientWidth < 8 || preview.clientHeight < 8) {
    if (retry) requestAnimationFrame(() => focusSelectedTextureUvs(animate, false));
    return;
  }
  const viewportWidth = preview.clientWidth;
  const viewportHeight = preview.clientHeight;
  const [textureWidth, textureHeight] = texturePreviewSize;
  const baseScale = Math.min(viewportWidth / textureWidth, viewportHeight / textureHeight);
  const spanU = Math.max(.25, bounds.maxU - bounds.minU);
  const spanV = Math.max(.25, bounds.maxV - bounds.minV);
  const desiredScale = Math.min(viewportWidth * .78 / spanU, viewportHeight * .78 / spanV);
  const zoom = Math.max(.05, Math.min(32, desiredScale / baseScale));
  const scale = baseScale * zoom;
  animateTextureView({
    zoom,
    panX: -(((bounds.minU + bounds.maxU) / 2) - textureWidth / 2) * scale,
    panY: -(((bounds.minV + bounds.maxV) / 2) - textureHeight / 2) * scale
  }, animate);
}

function setDockHotspotFocus(panelId) {
  focusedDockHotspot = panelId;
  $$('[data-hotspot-focus="true"]').forEach(panel => panel.classList.toggle('hotspot-focused', panel.dataset.panel === panelId));
}

function clientToTextureUv(clientX, clientY) {
  if (!textureViewLayout) updateTextureStageTransform();
  const rect = $('#texturePreview').getBoundingClientRect();
  return [
    (clientX - rect.left - textureViewLayout.left) / textureViewLayout.scale,
    (clientY - rect.top - textureViewLayout.top) / textureViewLayout.scale
  ];
}

function textureUvHit(entries, point) {
  return entries
    .filter(entry => point[0] >= Math.min(entry.uv[0], entry.uv[2]) && point[0] <= Math.max(entry.uv[0], entry.uv[2])
      && point[1] >= Math.min(entry.uv[1], entry.uv[3]) && point[1] <= Math.max(entry.uv[1], entry.uv[3]))
    .sort((left, right) => Math.abs((left.uv[2] - left.uv[0]) * (left.uv[3] - left.uv[1]))
      - Math.abs((right.uv[2] - right.uv[0]) * (right.uv[3] - right.uv[1])))[0] || null;
}

function textureUvHandleAt(point, bounds) {
  if (!bounds || !textureViewLayout) return null;
  const tolerance = 9 / textureViewLayout.scale;
  const nearLeft = Math.abs(point[0] - bounds.minU) <= tolerance;
  const nearRight = Math.abs(point[0] - bounds.maxU) <= tolerance;
  const nearTop = Math.abs(point[1] - bounds.minV) <= tolerance;
  const nearBottom = Math.abs(point[1] - bounds.maxV) <= tolerance;
  if (nearLeft && nearTop) return 'nw';
  if (nearRight && nearTop) return 'ne';
  if (nearLeft && nearBottom) return 'sw';
  if (nearRight && nearBottom) return 'se';
  const withinX = point[0] >= bounds.minU - tolerance && point[0] <= bounds.maxU + tolerance;
  const withinY = point[1] >= bounds.minV - tolerance && point[1] <= bounds.maxV + tolerance;
  if (nearTop && withinX) return 'n';
  if (nearBottom && withinX) return 's';
  if (nearLeft && withinY) return 'w';
  if (nearRight && withinY) return 'e';
  return null;
}

function snapTexturePan() {
  if (!textureViewLayout) return;
  const { viewportWidth, viewportHeight, textureWidth, textureHeight, scale } = textureViewLayout;
  let left = (viewportWidth - textureWidth * scale) / 2 + state.textureView.panX;
  let top = (viewportHeight - textureHeight * scale) / 2 + state.textureView.panY;
  const right = left + textureWidth * scale;
  const bottom = top + textureHeight * scale;
  const distance = 12;
  if (Math.abs(left) <= distance) state.textureView.panX -= left;
  else if (Math.abs(right - viewportWidth) <= distance) state.textureView.panX += viewportWidth - right;
  if (Math.abs(top) <= distance) state.textureView.panY -= top;
  else if (Math.abs(bottom - viewportHeight) <= distance) state.textureView.panY += viewportHeight - bottom;
}

function constrainUvMoveDelta(bounds, delta) {
  const [width, height] = texturePreviewSize;
  const minimumU = bounds.minU < 0 ? 0 : -bounds.minU;
  const maximumU = bounds.maxU > width ? 0 : width - bounds.maxU;
  const minimumV = bounds.minV < 0 ? 0 : -bounds.minV;
  const maximumV = bounds.maxV > height ? 0 : height - bounds.maxV;
  return [clamp(delta[0], minimumU, maximumU), clamp(delta[1], minimumV, maximumV)];
}

function materializeUvFaces(entries) {
  for (const entry of entries) {
    if (entry.cube.uvMode === 'box') continue;
    entry.cube.faces ||= {};
    const existing = entry.cube.faces[entry.faceName];
    if (existing === null) continue;
    entry.cube.faces[entry.faceName] = {
      ...(existing || {}),
      uv: Array.isArray(existing?.uv) && existing.uv.length >= 4
        ? [...existing.uv]
        : [...getBlockbenchBoxUv(entry.cube, entry.faceName)]
    };
    entry.cube.autoUv = false;
  }
}

function beginTextureUvMutation(drag) {
  if (drag.snapshotTaken) return;
  snapshot(drag.kind === 'resize' ? 'core.uv.resize' : 'core.uv.move');
  materializeUvFaces(selectedTextureUvEntries());
  const entries = selectedTextureUvEntries();
  drag.entries = entries;
  drag.boxCubes = new Map(entries.filter(entry => entry.cube.uvMode === 'box')
    .map(entry => [entry.cube.uid, { cube: entry.cube, uv: [...entry.cube.uv] }]));
  drag.originals = new Map(entries.map(entry => [entry.key, entry.cube.uvMode === 'box'
    ? [...getBlockbenchBoxUv(entry.cube, entry.faceName)] : [...entry.cube.faces[entry.faceName].uv]]));
  const boxBounds = [...drag.boxCubes.values()].flatMap(({ cube }) => CUBE_FACE_NAMES.map(faceName => ({ uv: getBlockbenchBoxUv(cube, faceName) })));
  drag.bounds = normalizedUvBounds([...entries, ...boxBounds]);
  drag.snapshotTaken = true;
}

function applyTextureUvDrag(event) {
  const drag = textureUvDrag;
  if (!drag || !['move', 'resize'].includes(drag.kind)) return;
  beginTextureUvMutation(drag);
  if (!drag.entries.length || !drag.bounds) return;
  const point = clientToTextureUv(event.clientX, event.clientY);
  let delta = [snapValue(point[0] - drag.startUv[0], event), snapValue(point[1] - drag.startUv[1], event)];
  if (drag.kind === 'move') {
    delta = constrainUvMoveDelta(drag.bounds, delta);
    drag.entries.forEach(entry => {
      if (entry.cube.uvMode === 'box') return;
      const original = drag.originals.get(entry.key);
      entry.cube.faces[entry.faceName].uv = [original[0] + delta[0], original[1] + delta[1], original[2] + delta[0], original[3] + delta[1]];
    });
    for (const { cube, uv } of drag.boxCubes.values()) cube.uv = [uv[0] + delta[0], uv[1] + delta[1]];
  } else {
    const original = drag.bounds;
    let next = { ...original };
    if (drag.handle.includes('w')) next.minU = snapValue(original.minU + delta[0], event);
    if (drag.handle.includes('e')) next.maxU = snapValue(original.maxU + delta[0], event);
    if (drag.handle.includes('n')) next.minV = snapValue(original.minV + delta[1], event);
    if (drag.handle.includes('s')) next.maxV = snapValue(original.maxV + delta[1], event);
    const [width, height] = texturePreviewSize;
    if (drag.handle.includes('w')) next.minU = clamp(next.minU, original.minU < 0 ? original.minU : 0, next.maxU - .001);
    if (drag.handle.includes('e')) next.maxU = clamp(next.maxU, next.minU + .001, original.maxU > width ? original.maxU : width);
    if (drag.handle.includes('n')) next.minV = clamp(next.minV, original.minV < 0 ? original.minV : 0, next.maxV - .001);
    if (drag.handle.includes('s')) next.maxV = clamp(next.maxV, next.minV + .001, original.maxV > height ? original.maxV : height);
    const oldWidth = Math.max(1e-8, original.maxU - original.minU);
    const oldHeight = Math.max(1e-8, original.maxV - original.minV);
    drag.entries.forEach(entry => {
      if (entry.cube.uvMode === 'box') return;
      const source = drag.originals.get(entry.key);
      entry.cube.faces[entry.faceName].uv = source.map((value, index) => index % 2 === 0
        ? next.minU + (value - original.minU) / oldWidth * (next.maxU - next.minU)
        : next.minV + (value - original.minV) / oldHeight * (next.maxV - next.minV));
    });
  }
  if (!state.dirty) markDirty();
  textureUvEntryCache = null;
  invalidateSelectionRenderGeometry();
  renderTextureUvOverlay();
  scheduleSceneRender();
}
return {
  get texturePreviewSize() { return texturePreviewSize; }, set texturePreviewSize(value) { texturePreviewSize = value; },
  get focusedDockHotspot() { return focusedDockHotspot; }, set focusedDockHotspot(value) { focusedDockHotspot = value; },
  get textureUvDrag() { return textureUvDrag; }, set textureUvDrag(value) { textureUvDrag = value; },
  get textureViewLayout() { return textureViewLayout; }, set textureViewLayout(value) { textureViewLayout = value; },
  get textureFocusFrame() { return textureFocusFrame; }, set textureFocusFrame(value) { textureFocusFrame = value; },
  get textureUvEntryCache() { return textureUvEntryCache; }, set textureUvEntryCache(value) { textureUvEntryCache = value; },
  updateTexturePreviewFrame, uvFaceKey, parseUvFaceKey, textureUvEntries,
  selectedTextureUvEntries, normalizedUvBounds, renderTextureUvOverlay,
  updateTextureStageTransform, cancelTextureFocus, resetTextureView,
  focusSelectedTextureUvs, setDockHotspotFocus, clientToTextureUv,
  textureUvHit, textureUvHandleAt, snapTexturePan, materializeUvFaces,
  applyTextureUvDrag
};
}
