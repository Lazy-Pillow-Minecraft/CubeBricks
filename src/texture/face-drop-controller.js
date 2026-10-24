import { getBlockbenchBoxUv } from '../render/webgl-renderer.js';
import { CULLED_FACE_TEXTURE_KEY, UV_FACE_LABELS } from './face-constants.js';

export function createTextureFaceDropController({
  state, $, viewport, uvPreviewViewport, getSelectionExpansion,
  ensureCubeFaceRecord, snapshot, persistGeneratedPaintCube, markDirty,
  uvPreviewController, uvEditorController, invalidateAllRenderGeometry, renderTextureList,
  renderOutliner, renderInspector, renderScene, updateTextureStageTransform,
  toast, CUBE_FACE_NAMES, remapNumericFaceTextureReferences
}) {
let textureFaceDropTarget = null;
function faceTextureReference(asset) {
  return asset?.uuid || asset?.id || asset?._uid;
}

function draggedTextureAsset(event) {
  if (state.textureDrag?.type === 'asset') {
    return state.textureAssets.find(asset => asset._uid === state.textureDrag.id) || null;
  }
  const transfer = event?.dataTransfer?.getData('text/x-cubebricks-texture') || '';
  if (!transfer.startsWith('asset:')) return null;
  return state.textureAssets.find(asset => asset._uid === transfer.slice(6)) || null;
}

function clearTextureFaceDropTarget() {
  textureFaceDropTarget = null;
  viewport.classList.remove('texture-face-drop-active');
  uvPreviewViewport.classList.remove('texture-face-drop-active');
  for (const selector of ['#sceneTextureDropFaceOverlay', '#uvTextureDropFaceOverlay']) {
    const overlay = $(selector);
    if (!overlay) continue;
    overlay.innerHTML = '';
    overlay.setAttribute('hidden', '');
  }
}

function showTextureFaceDropTarget(surface, renderer, hit, overlaySelector) {
  clearTextureFaceDropTarget();
  if (!hit?.faceName || !hit.facePoints?.length) return;
  textureFaceDropTarget = { surface, hit };
  surface.classList.add('texture-face-drop-active');
  const overlay = $(overlaySelector);
  const projected = hit.facePoints.map(point => renderer.projectPoint(point));
  if (!overlay || projected.length !== 4 || projected.some(point => point.behind || point.depth < -1 || point.depth > 1)) return;
  const width = surface.clientWidth, height = surface.clientHeight;
  const perimeter = [projected[0], projected[1], projected[3], projected[2]];
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  overlay.innerHTML = `<path d="M${perimeter.map(point => `${point.x},${point.y}`).join(' L')} Z"/>`;
  overlay.removeAttribute('hidden');
}

function textureDropCubes(hit) {
  const hitCube = hit?.cube?.type === 'cube' ? hit.cube : hit && state.project.getNode(hit.uid);
  if (hitCube?.type !== 'cube') return [];
  const expansion = getSelectionExpansion();
  if (expansion.elementUids.length < 2 && !expansion.elementSet.has(hit.uid)) return [hitCube];
  const cubes = expansion.elementUids
    .map(uidValue => state.project.getNode(uidValue))
    .flatMap(element => element?.type === 'cube' ? [element] : element?.toCubes?.() || []);
  return cubes.length ? cubes : [hitCube];
}

function applyTextureAssetToFace(asset, hit) {
  if (!asset || !hit?.faceName || !CUBE_FACE_NAMES.includes(hit.faceName)) return false;
  const cubes = textureDropCubes(hit);
  if (!cubes.length) return false;
  const reference = faceTextureReference(asset);
  snapshot('core.texture.assign');
  for (const cube of cubes) {
    const face = ensureCubeFaceRecord(cube, hit.faceName);
    if (cube.uvMode !== 'box' && !Array.isArray(face.uv)) face.uv = [...getBlockbenchBoxUv(cube, hit.faceName)];
    face.texture = reference;
    delete face.enabled;
    delete face[CULLED_FACE_TEXTURE_KEY];
    cube.autoUv = cube.uvMode === 'box';
    persistGeneratedPaintCube(cube);
  }
  markDirty();
  uvPreviewController.uvPreviewProjectCache = null;
  uvEditorController.textureUvEntryCache = null;
  invalidateAllRenderGeometry();
  renderTextureList();
  renderOutliner();
  renderInspector();
  renderScene();
  updateTextureStageTransform();
  toast(cubes.length > 1
    ? `已將貼圖套用到 ${cubes.length} 個 Cube 的${UV_FACE_LABELS[hit.faceName] || hit.faceName}`
    : `已將貼圖套用到${UV_FACE_LABELS[hit.faceName] || hit.faceName}`);
  return true;
}

function bindTextureFaceDropSurface(surface, canvas, renderer, projectProvider, overlaySelector) {
  surface.addEventListener('dragover', event => {
    const asset = draggedTextureAsset(event);
    if (!asset) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const project = projectProvider();
    if (!project) return clearTextureFaceDropTarget();
    const rect = canvas.getBoundingClientRect();
    const hit = renderer.pickDetailed(project, event.clientX - rect.left, event.clientY - rect.top, true);
    if (hit?.faceName) showTextureFaceDropTarget(surface, renderer, hit, overlaySelector);
    else clearTextureFaceDropTarget();
  });
  surface.addEventListener('dragleave', event => {
    if (event.relatedTarget && surface.contains(event.relatedTarget)) return;
    clearTextureFaceDropTarget();
  });
  surface.addEventListener('drop', event => {
    const asset = draggedTextureAsset(event);
    if (!asset) return;
    event.preventDefault();
    event.stopPropagation();
    const project = projectProvider();
    const rect = canvas.getBoundingClientRect();
    const hit = textureFaceDropTarget?.surface === surface
      ? textureFaceDropTarget.hit
      : renderer.pickDetailed(project, event.clientX - rect.left, event.clientY - rect.top, true);
    clearTextureFaceDropTarget();
    if (!applyTextureAssetToFace(asset, hit)) toast('請把貼圖拖到 Cube 面上');
    state.textureDrag = null;
  });
}

return {
  faceTextureReference,
  draggedTextureAsset,
  clearTextureFaceDropTarget,
  showTextureFaceDropTarget,
  textureDropCubes,
  applyTextureAssetToFace,
  bindTextureFaceDropSurface,
};
}
