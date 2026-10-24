export function selectionAffectsModifierResults(project, selectedIds) {
  if (!selectedIds?.length) return false;
  const selectedSet = new Set(selectedIds);
  let selectedGroup = false;
  for (const uidValue of selectedIds) {
    const node = project.getNode(uidValue);
    if (node?.type === 'group') selectedGroup = true;
    if (node?.modifiers?.some(modifier => modifier.type === 'symmetry' && modifier.enabled)) return true;
    if (project.getGroupChain(uidValue).some(group =>
      group.modifiers?.some(modifier => modifier.type === 'symmetry' && modifier.enabled))) return true;
  }
  if (!selectedGroup) return false;
  // Transforming a selected ancestor also moves an embedded modifier frame.
  return [...project.groups, ...project.elements].some(owner => owner.modifiers?.some(modifier =>
    modifier.type === 'symmetry' && modifier.enabled)
    && project.getGroupChain(owner.uid).some(parent => selectedSet.has(parent.uid)));
}

export function createWorkspaceCoordinator({
  state, $, sceneRenderer, uvPreviewRenderer,
  getTextureAssetController, getTextureAtlasController,
  livePaintTextureSources, animationRasterCache,
  renderTextureList, renderTexture, activateProjectTexture,
  rebuildTextureAtlas, updateSnapButton, updateRenderModeControl,
  updateToolOptions, renderOutliner, renderInspector, renderScene,
  updateTextureStageTransform, updateSelectionLabels,
  getUvPreviewController, getUvEditorController, getTransformContext,
  scheduleAllPaintSymmetryBuilds, syncSubdivisionEdits
}) {
let toastTimer;
function restoreProjectTextureView({ preserveAtlas = false } = {}) {
  // Texture previews and the scene atlas are separate consumers. Rebuild the
  // atlas as soon as a project becomes active; otherwise an image-load callback
  // for the currently selected preview is the only thing that starts it.
  getTextureAssetController().textureLoadRevision++;
  getTextureAtlasController().resetAtlas({ preserveGpu: preserveAtlas && state.textureAssets.length > 0 });
  livePaintTextureSources.clear();
  animationRasterCache.clear();
  renderTextureList();
  if (!state.textureAssets.length) {
    renderTexture();
    return;
  }
  let index = state.textureAssets.findIndex(asset => asset._uid === state.activeTextureUid);
  if (index < 0) index = Math.max(0, state.textureAssets.findIndex(asset => asset.useAsDefault));
  activateProjectTexture(index);
  rebuildTextureAtlas();
}

function selected() {
  return state.project.getNode(state.selectedUid);
}


function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2100);
}

function renderAll(geometryScope = 'all') {
  if (geometryScope === 'selection') invalidateSelectionRenderGeometry();
  else invalidateAllRenderGeometry();
  $('#minecraftRenderType').value = state.project.renderType;
  $('#cullFaces').checked = state.project.cullFaces;
  updateSnapButton();
  updateRenderModeControl();
  updateToolOptions();
  renderOutliner();
  renderInspector();
  renderScene();
  updateTextureStageTransform();
  updateSelectionLabels();
}

function invalidateAllRenderGeometry() {
  sceneRenderer.invalidateGeometry();
  uvPreviewRenderer.invalidateGeometry();
  getUvPreviewController().uvPreviewRenderDirty = true;
  getUvEditorController().textureUvEntryCache = null;
  getTransformContext().clearCache();
  if (getUvPreviewController().uvPreviewProjectCache) getUvPreviewController().uvPreviewProjectCache.fit = null;
  if (getTextureAtlasController().textureAtlasEntries.some(entry => entry.tileSourceUid)) rebuildTextureAtlas();
  scheduleAllPaintSymmetryBuilds();
}

function selectionAffectsMirrorPreview() {
  const selectedIds = state.selectedUids?.size
    ? [...state.selectedUids]
    : state.selectedUid ? [state.selectedUid] : [];
  return selectionAffectsModifierResults(state.project, selectedIds);
}

function invalidateSelectionRenderGeometry(geometryChanged = true) {
  if (geometryChanged) syncSubdivisionEdits();
  sceneRenderer.invalidateSelectionGeometry(geometryChanged);
  getUvPreviewController().uvPreviewRenderDirty = true;
  getTransformContext().clearCache();
  if (geometryChanged) {
    if (selectionAffectsMirrorPreview()) sceneRenderer.invalidateMirrorGeometry();
    uvPreviewRenderer.invalidateGeometry();
    getUvEditorController().textureUvEntryCache = null;
    if (getUvPreviewController().uvPreviewProjectCache) getUvPreviewController().uvPreviewProjectCache.fit = null;
    if (getTextureAtlasController().textureAtlasEntries.some(entry => entry.tileSourceUid)) rebuildTextureAtlas();
  }
}

return {
  restoreProjectTextureView,
  selected,
  toast,
  renderAll,
  invalidateAllRenderGeometry,
  selectionAffectsMirrorPreview,
  invalidateSelectionRenderGeometry,
};
}
