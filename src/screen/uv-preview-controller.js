import { createBlockbenchFaceUvSlots, getBlockbenchBoxUv, isCubeFaceCulled } from '../render/webgl-renderer.js';
import { normalize3 } from '../utils/math/vector3.js';
import { UV_FACE_LABELS, CULLED_FACE_TEXTURE_KEY } from '../texture/face-constants.js';

const CUBE_FACE_NAMES = ['north', 'east', 'south', 'west', 'up', 'down'];

export function createUvPreviewController({
  state, $, $$, uvPreviewCanvas, uvPreviewViewport, uvPreviewRenderer,
  sceneRenderer, textureCanvas, getTextureAtlasEntries, getTextureAtlasCanvas,
  getDockManager, selectedElementUids, isShapeElement, isBezierElement,
  faceTextureReference, activeTextureAsset, renderTextureTileControls,
  formatNumber, addScaled3, uvFaceKey, parseUvFaceKey, snapshot, markDirty,
  invalidateSelectionRenderGeometry, renderScene, renderAll, toast
}) {
let uvPreviewAnimationFrame = null;
let uvPreviewResizeFrame = null;
let uvPreviewLastFrame = 0;
let uvPreviewProjectCache = null;
let uvPreviewDrag = null;
let uvPreviewTextureDirty = true;
let uvPreviewRenderDirty = true;
let uvPreviewPanelMetrics = null;
const uvPreviewFaceLabelCanvas = document.createElement('canvas');
let uvPreviewFaceLabelCacheKey = null;
let uvPreviewFaceLabelFontRevision = 0;
const dockManagerProxy = { get current() { return getDockManager(); } };
function uvPreviewIsActive() {
  const panel = dockManagerProxy.current?.get('uvPreview');
  if (document.hidden || !state.uvPreviewEnabled || !panel || panel.element.hidden || panel.state.collapsed || state.layoutResizing) return false;
  if (panel.state.dock !== 'floating' && dockManagerProxy.current.zoneState?.[panel.state.dock]) return false;
  const rect = uvPreviewViewport.getBoundingClientRect();
  return rect.width >= 2 && rect.height >= 2;
}

function uvPreviewElements() {
  return selectedElementUids()
    .map(uidValue => state.project.getNode(uidValue))
    .filter(element => element && (element.type === 'cube' || isShapeElement(element) || isBezierElement(element)));
}

function getUvPreviewProject() {
  const sourceElements = uvPreviewElements();
  const key = sourceElements.map(element => element.uid).sort().join('|');
  if (state.uvPreviewSelectedFace && !sourceElements.some(element => element.uid === state.uvPreviewSelectedFace.uid)) {
    state.uvPreviewSelectedFace = null;
  }
  if (uvPreviewProjectCache?.source === state.project
    && uvPreviewProjectCache.key === key
    && uvPreviewProjectCache.hierarchyRevision === state.project.hierarchyRevision) return uvPreviewProjectCache;

  // Visibility and locking are editor concerns. This isolated preview always
  // shows the selected geometry while inheriting its real transform and UVs.
  const previewTexture = faceTextureReference(activeTextureAsset()) || '__cubebricks_uv_preview__';
  const elements = sourceElements.map(element => {
    const preview = Object.assign(Object.create(element), { visible: true, locked: false, modifiers: [] });
    if (element.type !== 'cube') return preview;
    const sourceFaces = element.faces || {};
    preview.faces = Object.fromEntries(CUBE_FACE_NAMES.map(faceName => {
      const sourceFace = sourceFaces[faceName];
      if (!isCubeFaceCulled(sourceFace)) return [faceName, sourceFace ? { ...sourceFace } : sourceFace];
      const storedTexture = effectiveFaceTextureReference(sourceFace);
      return [faceName, {
        ...(sourceFace && typeof sourceFace === 'object' ? sourceFace : {}),
        enabled: true,
        texture: storedTexture ?? previewTexture,
        uv: Array.isArray(sourceFace?.uv) ? [...sourceFace.uv] : [...getBlockbenchBoxUv(element, faceName)],
        rotation: Number(sourceFace?.rotation) || 0
      }];
    }));
    return preview;
  });
  const groups = state.project.groups.map(group => Object.assign(Object.create(group), { locked: false, modifiers: [] }));
  const previewNodes = new Map([...elements, ...groups].map(node => [node.uid, node]));
  const previewGroups = new Map(groups.map(group => [group.uid, group]));
  const project = {
    elements,
    groups,
    outliner: elements.map(element => element.uid),
    textureSize: state.project.textureSize,
    renderType: state.uvPreviewFaceColors ? 'solid' : state.project.renderType,
    cullFaces: state.project.cullFaces || state.project.formatId === 'java_block_item',
    getNode: uidValue => previewNodes.get(uidValue) || null,
    getGroupChain: uidValue => state.project.getGroupChain(uidValue)
      .map(group => previewGroups.get(group.uid) || group),
    getDescendantElementUids: uidValue => state.project.getDescendantElementUids(uidValue)
  };
  uvPreviewProjectCache = {
    source: state.project,
    key,
    hierarchyRevision: state.project.hierarchyRevision,
    elements,
    project,
    fit: null
  };
  uvPreviewRenderer.invalidateGeometry();
  return uvPreviewProjectCache;
}

function uvPreviewFit(cache) {
  if (cache.fit) return cache.fit;
  // The scene renderer does not maintain a selection cache in paint mode.
  // Derive the fit from the actual selected geometry in either mode instead
  // of falling back to an average of pivots (which can be far from the mesh).
  const faces = sceneRenderer.getFaceQuadsForUids(new Set(cache.elements.map(element => element.uid)));
  const points = faces.flatMap(face => face.facePoints || []);
  let center = null;
  let span = null;
  if (points.length) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const point of points) for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
    center = min.map((value, axis) => (value + max[axis]) / 2);
    span = min.map((value, axis) => max[axis] - value);
  }
  if (!center || !span) {
    const positions = cache.elements.map(element => element.pivot || element.origin || element.position).filter(Boolean);
    center = positions.length
      ? [0, 1, 2].map(axis => positions.reduce((sum, point) => sum + Number(point[axis] || 0), 0) / positions.length)
      : [0, 0, 0];
    span = [16, 16, 16];
  }
  const radius = Math.max(.25, Math.hypot(...span) / 2);
  cache.fit = {
    target: [...center],
    zoom: Math.max(.025, Math.min(20, 42 * Math.tan(Math.PI / 8) / (radius * 1.28)))
  };
  return cache.fit;
}

function syncUvPreviewPanelAspect(textureWidth, textureHeight) {
  const panel = dockManagerProxy.current?.get('uvPreview');
  if (!panel || panel.state.collapsed || panel.element.hidden) {
    uvPreviewPanelMetrics = null;
    return;
  }
  const width = Math.max(1, panel.element.getBoundingClientRect().width || panel.state.width);
  const ratio = Math.max(.001, textureHeight / textureWidth);
  const current = { width, ratio };
  const previous = uvPreviewPanelMetrics;
  uvPreviewPanelMetrics = current;
  if (!previous) return;

  const widthChanged = Math.abs(current.width - previous.width) >= .75;
  const ratioChanged = Math.abs(current.ratio - previous.ratio) >= .0001;
  if (!widthChanged && !ratioChanged) return;

  // Keep manual vertical resizing intact. Only compensate for the amount by which
  // a horizontal resize (or texture aspect change) changes the preview itself.
  const previousPreviewHeight = Math.max(1, (previous.width - 16) * previous.ratio);
  const currentPreviewHeight = Math.max(1, (current.width - 16) * current.ratio);
  const heightDelta = currentPreviewHeight - previousPreviewHeight;
  if (Math.abs(heightDelta) < .5) return;
  const maximum = panel.state.dock === 'floating'
    ? Math.max(180, window.innerHeight - panel.state.y)
    : Math.max(180, window.innerHeight - 120);
  const desired = Math.min(maximum, Math.max(180, panel.state.height + heightDelta));
  if (Math.abs(panel.state.height - desired) < .5) return;
  panel.state.height = desired;
  dockManagerProxy.current.applyPanelState(panel);
}

function setUvPreviewPlaceholder(message, visible) {
  const empty = $('#uvPreviewEmpty');
  empty.textContent = message;
  empty.hidden = !visible;
  uvPreviewCanvas.hidden = visible;
  if (visible) {
    $('#uvPreviewSize').textContent = '—';
    $('#uvPreviewFaceOverlay').innerHTML = '';
    $('#uvSelectedFaceLabel').textContent = '未選擇面';
    $$('[data-uv-face-action]').forEach(button => button.disabled = true);
  }
  $('[data-panel="uvPreview"]')?.classList.toggle('preview-disabled', !state.uvPreviewEnabled);
}

function effectiveFaceTextureReference(face) {
  if (!face || typeof face !== 'object') return undefined;
  if (face.texture !== null && face.texture !== undefined) return face.texture;
  if (Object.prototype.hasOwnProperty.call(face, CULLED_FACE_TEXTURE_KEY)) {
    const stored = face[CULLED_FACE_TEXTURE_KEY];
    return stored === null ? undefined : stored;
  }
  return undefined;
}

function ensureCubeFaceRecord(cube, faceName) {
  if (!cube.faces) cube.faces = {};
  const existing = cube.faces[faceName];
  if (existing && typeof existing === 'object') {
    if (!Array.isArray(existing.uv) || existing.uv.length < 4) existing.uv = [...getBlockbenchBoxUv(cube, faceName)];
    return existing;
  }
  const face = {
    uv: [...getBlockbenchBoxUv(cube, faceName)],
    rotation: 0
  };
  if (existing === null) face.texture = null;
  cube.faces[faceName] = face;
  return face;
}

function setCubeFaceCulled(cube, faceName, culled) {
  const face = ensureCubeFaceRecord(cube, faceName);
  if (culled) {
    if (!Object.prototype.hasOwnProperty.call(face, CULLED_FACE_TEXTURE_KEY) && face.texture !== null) {
      face[CULLED_FACE_TEXTURE_KEY] = face.texture === undefined ? null : face.texture;
    }
    face.texture = null;
    delete face.enabled;
    return;
  }
  if (!isCubeFaceCulled(face)) return;
  if (Object.prototype.hasOwnProperty.call(face, CULLED_FACE_TEXTURE_KEY)) {
    const stored = face[CULLED_FACE_TEXTURE_KEY];
    if (stored === null || stored === undefined) delete face.texture;
    else face.texture = stored;
    delete face[CULLED_FACE_TEXTURE_KEY];
  } else {
    const activeReference = faceTextureReference(activeTextureAsset());
    if (activeReference === undefined || activeReference === null) delete face.texture;
    else face.texture = activeReference;
  }
  delete face.enabled;
}

function cubeHasOnlyCulledFaces(cube) {
  return CUBE_FACE_NAMES.every(faceName => isCubeFaceCulled(cube.faces?.[faceName]));
}

function textureOrderedFacePoints(points, uv, rotation) {
  const slots = createBlockbenchFaceUvSlots(uv, rotation);
  const uValues = slots.map(slot => slot[0]), vValues = slots.map(slot => slot[1]);
  const minU = Math.min(...uValues), maxU = Math.max(...uValues);
  const minV = Math.min(...vValues), maxV = Math.max(...vValues);
  const used = new Set();
  return [[minU, minV], [maxU, minV], [minU, maxV], [maxU, maxV]].map(([u, v]) => {
    let bestIndex = -1, bestDistance = Infinity;
    slots.forEach((slot, index) => {
      if (used.has(index)) return;
      const distance = (slot[0] - u) ** 2 + (slot[1] - v) ** 2;
      if (distance < bestDistance) { bestIndex = index; bestDistance = distance; }
    });
    if (bestIndex < 0) bestIndex = used.size;
    used.add(bestIndex);
    return points[bestIndex];
  });
}

function buildUvPreviewFaceLabel() {
  const selection = state.uvPreviewSelectedFace;
  const data = selectedUvFaceData(false);
  const points = selection?.points || [];
  if (!data || points.length !== 4) return null;
  const [u1, v1, u2, v2] = data.uv;
  const rotation = ((Math.round(Number(data.face.rotation) || 0) % 360) + 360) % 360;
  const info = `↻${rotation}°${u2 < u1 ? ' ↔' : ''}${v2 < v1 ? ' ↕' : ''}`;
  const cacheKey = `${uvPreviewFaceLabelFontRevision}:${info}`;
  if (uvPreviewFaceLabelCacheKey !== cacheKey) {
    const context = uvPreviewFaceLabelCanvas.getContext('2d');
    const font = '12px "Fusion Pixel Latin", monospace';
    context.font = font;
    const metrics = context.measureText(info);
    const ascent = Math.ceil(metrics.actualBoundingBoxAscent || 10);
    const descent = Math.ceil(metrics.actualBoundingBoxDescent || 2);
    uvPreviewFaceLabelCanvas.width = Math.max(1, Math.ceil(metrics.width) + 4);
    uvPreviewFaceLabelCanvas.height = Math.max(1, ascent + descent + 4);
    context.clearRect(0, 0, uvPreviewFaceLabelCanvas.width, uvPreviewFaceLabelCanvas.height);
    context.imageSmoothingEnabled = false;
    context.font = font;
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#080908';
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) context.fillText(info, 2 + dx, 2 + ascent + dy);
    context.fillStyle = '#f5f6f2';
    context.fillText(info, 2, 2 + ascent);
    uvPreviewFaceLabelCacheKey = cacheKey;
  }

  const uVector = points[1].map((value, axis) => value - points[0][axis]);
  const vVector = points[2].map((value, axis) => value - points[0][axis]);
  const uLength = Math.hypot(...uVector), vLength = Math.hypot(...vVector);
  if (uLength < 1e-5 || vLength < 1e-5) return null;
  const uDirection = normalize3(uVector), vDirection = normalize3(vVector);
  const textureAspect = uvPreviewFaceLabelCanvas.width / uvPreviewFaceLabelCanvas.height;
  // Deliberately size from the longest face edge. Thin faces must not crush
  // the label merely because their other axis is short.
  const labelHeight = Math.max(uLength, vLength) * .18;
  const labelWidth = labelHeight * textureAspect;
  const origin = addScaled3(addScaled3(points[0], uDirection, uLength * .055), vDirection, vLength * .035);
  const topRight = addScaled3(origin, uDirection, labelWidth);
  const bottomLeft = addScaled3(origin, vDirection, labelHeight);
  const bottomRight = addScaled3(topRight, vDirection, labelHeight);
  return {
    key: cacheKey,
    source: uvPreviewFaceLabelCanvas,
    quad: [origin, topRight, bottomLeft, bottomRight]
  };
}

function selectedUvFaceData(create = false) {
  const selection = state.uvPreviewSelectedFace;
  const cube = selection && state.project.getNode(selection.uid);
  if (!cube || cube.type !== 'cube' || !selection.faceName) return null;
  if (!cube.faces) {
    if (!create) return { cube, face: {}, uv: getBlockbenchBoxUv(cube, selection.faceName) };
    cube.faces = {};
  }
  if (!Object.prototype.hasOwnProperty.call(cube.faces, selection.faceName)) {
    if (!create) return { cube, face: {}, uv: getBlockbenchBoxUv(cube, selection.faceName) };
    cube.faces[selection.faceName] = { uv: getBlockbenchBoxUv(cube, selection.faceName), rotation: 0 };
  }
  let face = cube.faces[selection.faceName];
  if (face === null) {
    if (create) face = ensureCubeFaceRecord(cube, selection.faceName);
    else return { cube, face: { texture: null }, uv: getBlockbenchBoxUv(cube, selection.faceName), culled: true };
  }
  return { cube, face, uv: face.uv?.length >= 4 ? face.uv : getBlockbenchBoxUv(cube, selection.faceName) };
}

function updateUvFaceUi() {
  renderTextureTileControls();
  const selection = state.uvPreviewSelectedFace;
  const data = selectedUvFaceData(false);
  const controls = $$('[data-uv-face-action]');
  controls.forEach(button => button.disabled = !data || (state.mode === 'paint' && button.dataset.uvFaceAction === 'cull'));
  const label = $('#uvSelectedFaceLabel');
  const size = $('#uvPreviewSize');
  const overlay = $('#uvPreviewFaceOverlay');
  if (!data || !selection) {
    label.textContent = '未選擇面';
    size.textContent = '—';
    overlay.innerHTML = '';
    controls.forEach(button => button.classList.remove('active'));
    return;
  }
  const [u1, v1, u2, v2] = data.uv;
  const rotation = ((Math.round(Number(data.face.rotation) || 0) % 360) + 360) % 360;
  const mirrorX = u2 < u1, mirrorY = v2 < v1;
  const culled = isCubeFaceCulled(data.cube.faces?.[selection.faceName]);
  label.textContent = `${data.cube.name} · ${UV_FACE_LABELS[selection.faceName] || selection.faceName}${culled ? ' · 已剔除' : ''}`;
  size.textContent = `${formatNumber(Math.abs(u2 - u1))} × ${formatNumber(Math.abs(v2 - v1))} px`;
  $('[data-uv-face-action="mirror-x"]').classList.toggle('active', mirrorX);
  $('[data-uv-face-action="mirror-y"]').classList.toggle('active', mirrorY);
  $('[data-uv-face-action="cull"]').classList.toggle('active', culled);
  $('[data-uv-face-action="cull"]').title = culled ? '恢復面' : '剔除面';
  const points = selection.points || [];
  const projected = points.map(point => uvPreviewRenderer.projectPoint(point));
  if (projected.length !== 4 || projected.some(point => point.behind || point.depth < -1 || point.depth > 1)) {
    overlay.innerHTML = ''; return;
  }
  const width = uvPreviewViewport.clientWidth, height = uvPreviewViewport.clientHeight;
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const perimeter = [projected[0], projected[1], projected[3], projected[2]];
  const texturePoints = textureOrderedFacePoints(points, data.uv, rotation);
  const textureProjected = texturePoints.map(point => uvPreviewRenderer.projectPoint(point));
  const [textureTopLeft, textureTopRight] = textureProjected;
  overlay.innerHTML = `<path class="uv-preview-face-outline" d="M${perimeter.map(point => `${point.x},${point.y}`).join(' L')} Z"/>
    <path class="uv-preview-face-north" d="M${textureTopLeft.x},${textureTopLeft.y} L${textureTopRight.x},${textureTopRight.y}"/>`;
}

function editSelectedUvFace(action) {
  if (action === 'cull') {
    toggleSelectedUvFacesCull();
    return;
  }
  const data = selectedUvFaceData(true);
  if (!data) return toast('請先在 UV 預覽中選擇 Cube 的面');
  if (data.cube.uvMode === 'box' && action !== 'rotate') return toast('箱型 UV 的面不能單獨鏡像');
  snapshot(action === 'rotate' ? 'core.uv.rotate' : 'core.uv.mirror');
  if (data.cube.uvMode !== 'box' && (!Array.isArray(data.face.uv) || data.face.uv.length < 4)) data.face.uv = [...data.uv];
  if (action === 'rotate') data.face.rotation = ((Number(data.face.rotation) || 0) + 90) % 360;
  if (action === 'mirror-x') [data.face.uv[0], data.face.uv[2]] = [data.face.uv[2], data.face.uv[0]];
  if (action === 'mirror-y') [data.face.uv[1], data.face.uv[3]] = [data.face.uv[3], data.face.uv[1]];
  data.cube.autoUv = data.cube.uvMode === 'box';
  markDirty();
  uvPreviewProjectCache = null;
  invalidateSelectionRenderGeometry();
  renderScene();
}

function toggleSelectedUvFacesCull() {
  if (state.mode === 'paint') return;
  const selection = state.uvPreviewSelectedFace;
  const current = selectedUvFaceData(false);
  if (!selection || !current) return toast('請先在 UV 預覽中選擇 Cube 的面');
  const currentKey = uvFaceKey(selection.uid, selection.faceName);
  const keys = state.selectedUvFaces.has(currentKey) && state.selectedUvFaces.size
    ? [...state.selectedUvFaces]
    : [currentKey];
  const targets = keys.map(parseUvFaceKey).filter(Boolean).map(entry => ({
    ...entry,
    cube: state.project.getNode(entry.uid)
  })).filter(entry => entry.cube?.type === 'cube' && CUBE_FACE_NAMES.includes(entry.faceName));
  if (!targets.length) return;
  const culled = !isCubeFaceCulled(current.cube.faces?.[selection.faceName]);
  snapshot('core.uv.cull_face');
  targets.forEach(entry => setCubeFaceCulled(entry.cube, entry.faceName, culled));

  const removed = new Set();
  for (const cube of new Set(targets.map(entry => entry.cube))) {
    if (!cubeHasOnlyCulledFaces(cube)) continue;
    removed.add(cube.uid);
    state.project.removeNode(cube.uid);
  }
  if (removed.size) {
    state.selectedUids = new Set([...state.selectedUids].filter(uidValue => !removed.has(uidValue)));
    if (removed.has(state.selectedUid)) state.selectedUid = [...state.selectedUids].at(-1) || null;
    if (removed.has(state.selectionAnchorUid)) state.selectionAnchorUid = state.selectedUid;
    state.selectedUvFaces = new Set([...state.selectedUvFaces].filter(key => {
      const parsed = parseUvFaceKey(key);
      return parsed && !removed.has(parsed.uid);
    }));
    if (removed.has(state.uvPreviewSelectedFace?.uid)) state.uvPreviewSelectedFace = null;
  }
  markDirty();
  uvPreviewProjectCache = null;
  renderAll();
  if (removed.size) toast(removed.size > 1 ? `全部面已剔除，已刪除 ${removed.size} 個 Cube` : '全部面已剔除，Cube 已刪除');
  else toast(culled ? `已剔除 ${targets.length} 個面` : `已恢復 ${targets.length} 個面`);
}

function renderUvPreview() {
  if (!state.uvPreviewEnabled) {
    setUvPreviewPlaceholder('預覽已關閉', true);
    uvPreviewRenderDirty = false;
    return false;
  }
  if (!uvPreviewIsActive()) {
    uvPreviewRenderDirty = false;
    return false;
  }
  const cache = getUvPreviewProject();
  if (!cache.elements.length) {
    setUvPreviewPlaceholder('選擇 Cube、Shape 或貝塞爾', true);
    uvPreviewRenderDirty = false;
    return false;
  }
  setUvPreviewPlaceholder('', false);
  if (uvPreviewTextureDirty) {
    if (getTextureAtlasEntries().length) uvPreviewRenderer.setTextureAtlas(getTextureAtlasCanvas(), getTextureAtlasEntries());
    else uvPreviewRenderer.setTexture(textureCanvas);
    uvPreviewTextureDirty = false;
  }
  cache.project.textureSize = state.project.textureSize;
  cache.project.renderType = state.project.renderType;
  cache.project.cullFaces = state.project.cullFaces || state.project.formatId === 'java_block_item';
  const fit = uvPreviewFit(cache);
  const textureWidth = Math.max(1, Number(state.project.textureSize?.[0]) || 1);
  const textureHeight = Math.max(1, Number(state.project.textureSize?.[1]) || 1);
  uvPreviewViewport.style.setProperty('--uv-preview-aspect', `${textureWidth} / ${textureHeight}`);
  syncUvPreviewPanelAspect(textureWidth, textureHeight);
  uvPreviewRenderer.render(cache.project, null, {
    projection: 'perspective',
    zoom: fit.zoom,
    panX: 0,
    panY: 0,
    yaw: state.uvPreviewYaw,
    pitch: state.uvPreviewPitch,
    target: fit.target,
    selectedUids: new Set(),
    renderMode: 'textured',
    previewShade: true,
    grid: false,
    wire: false,
    geometryOnly: true,
    snap: state.settingsSnap,
    faceDistinct: state.uvPreviewFaceColors,
    faceLabel: buildUvPreviewFaceLabel(),
    lockedDefaultAlpha: 100,
    lockedHoverFade: false,
    editorOverlayLines: []
  });
  uvPreviewRenderDirty = false;
  updateUvFaceUi();
  return true;
}

function stopUvPreviewAnimation() {
  if (uvPreviewAnimationFrame !== null) cancelAnimationFrame(uvPreviewAnimationFrame);
  uvPreviewAnimationFrame = null;
  uvPreviewLastFrame = 0;
}

function scheduleUvPreviewAnimation() {
  if (!uvPreviewIsActive() || !state.uvPreviewAutoRotate || !uvPreviewElements().length) {
    stopUvPreviewAnimation();
    return;
  }
  if (uvPreviewAnimationFrame !== null) return;
  const tick = now => {
    uvPreviewAnimationFrame = null;
    if (!uvPreviewIsActive() || !state.uvPreviewAutoRotate) {
      stopUvPreviewAnimation();
      return;
    }
    if (!uvPreviewLastFrame) uvPreviewLastFrame = now;
    const elapsed = Math.min(80, now - uvPreviewLastFrame);
    if (elapsed >= 30) {
      state.uvPreviewYaw += elapsed * .00018;
      uvPreviewLastFrame = now;
      renderUvPreview();
    }
    uvPreviewAnimationFrame = requestAnimationFrame(tick);
  };
  uvPreviewAnimationFrame = requestAnimationFrame(tick);
}

function refreshUvPreview(force = true) {
  if (force) uvPreviewRenderDirty = true;
  if (uvPreviewRenderDirty) renderUvPreview();
  scheduleUvPreviewAnimation();
}
return {
  get uvPreviewAnimationFrame() { return uvPreviewAnimationFrame; }, set uvPreviewAnimationFrame(value) { uvPreviewAnimationFrame = value; },
  get uvPreviewResizeFrame() { return uvPreviewResizeFrame; }, set uvPreviewResizeFrame(value) { uvPreviewResizeFrame = value; },
  get uvPreviewLastFrame() { return uvPreviewLastFrame; }, set uvPreviewLastFrame(value) { uvPreviewLastFrame = value; },
  get uvPreviewProjectCache() { return uvPreviewProjectCache; }, set uvPreviewProjectCache(value) { uvPreviewProjectCache = value; },
  get uvPreviewDrag() { return uvPreviewDrag; }, set uvPreviewDrag(value) { uvPreviewDrag = value; },
  get uvPreviewTextureDirty() { return uvPreviewTextureDirty; }, set uvPreviewTextureDirty(value) { uvPreviewTextureDirty = value; },
  get uvPreviewRenderDirty() { return uvPreviewRenderDirty; }, set uvPreviewRenderDirty(value) { uvPreviewRenderDirty = value; },
  get uvPreviewPanelMetrics() { return uvPreviewPanelMetrics; }, set uvPreviewPanelMetrics(value) { uvPreviewPanelMetrics = value; },
  get uvPreviewFaceLabelFontRevision() { return uvPreviewFaceLabelFontRevision; }, set uvPreviewFaceLabelFontRevision(value) { uvPreviewFaceLabelFontRevision = value; },
  invalidateFaceLabelCache() { uvPreviewFaceLabelCacheKey = null; },
  uvPreviewIsActive, uvPreviewElements, getUvPreviewProject,
  syncUvPreviewPanelAspect, effectiveFaceTextureReference, ensureCubeFaceRecord,
  setCubeFaceCulled, selectedUvFaceData, updateUvFaceUi, editSelectedUvFace,
  renderUvPreview, stopUvPreviewAnimation, refreshUvPreview
};
}
