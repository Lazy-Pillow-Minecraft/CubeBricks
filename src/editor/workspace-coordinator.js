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

export function canReuseJournalOutliner(previousProject, project, changedUids, rows) {
  if (!previousProject || !Array.isArray(changedUids) || !Array.isArray(rows)
    || previousProject.formatId !== project.formatId
    || previousProject.elements.length !== project.elements.length
    || previousProject.groups.length !== project.groups.length
    || previousProject.outliner.length !== project.outliner.length
    || previousProject.outliner.some((uid, index) => uid !== project.outliner[index])) return false;
  for (let index = 0; index < project.groups.length; index++) {
    const before = previousProject.groups[index], after = project.groups[index];
    if (before.uid !== after.uid || before.children.length !== after.children.length
      || before.children.some((uid, child) => uid !== after.children[child])) return false;
  }
  for (let index = 0; index < project.elements.length; index++)
    if (previousProject.elements[index].uid !== project.elements[index].uid) return false;
  for (const uid of changedUids) {
    const before = previousProject.getNode(uid), after = project.getNode(uid);
    if (before?.type !== 'cube' || after?.type !== 'cube'
      || ['name', 'visible', 'locked', 'exported', 'autoUv', 'uvNormalized', 'uvMode', 'subdivisionOwnerUid']
        .some(key => before[key] !== after[key])
      || [before, after].some(node => node.modifiers?.some(modifier => modifier.type === 'element_copy' && modifier.enabled))) return false;
  }
  return true;
}

export function createWorkspaceCoordinator({
  state, $, sceneRenderer, uvPreviewRenderer,
  getTextureAssetController, getTextureAtlasController,
  livePaintTextureSources, animationRasterCache,
  renderTextureList, renderTexture, activateProjectTexture,
  rebuildTextureAtlas, updateSnapButton, updateRenderModeControl,
  updateToolOptions, renderOutliner, renderInspector, renderScene,
  setMode,
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

function renderAll(geometryScope = 'all', changedUids = null, previousProject = null) {
  if (geometryScope === 'selection') invalidateSelectionRenderGeometry();
  else if (geometryScope === 'journal' && sceneRenderer.restoreJournalGeometry(state.project, changedUids, state.selectedUids, state.mode)) {
    getUvPreviewController().uvPreviewRenderDirty = true;
    getUvEditorController().textureUvEntryCache = null;
    getTransformContext().clearCache();
    uvPreviewRenderer.invalidateGeometry();
  }
  else invalidateAllRenderGeometry();
  const javaBlock = state.project.formatId === 'java_block_item';
  const modeButton = document.querySelector('.mode-tab[data-mode="animate"], .mode-tab[data-mode="display"]');
  if (modeButton && modeButton.dataset.mode !== (javaBlock ? 'display' : 'animate')) {
    modeButton.dataset.mode = javaBlock ? 'display' : 'animate';
    modeButton.innerHTML = javaBlock ? '<span>▣</span> 顯示設置' : '<span>⌁</span> 動畫';
  }
  $('#cullFaces').closest('.cull-toggle').hidden = javaBlock;
  if (javaBlock && state.mode === 'animate') setMode('display');
  else if (!javaBlock && state.mode === 'display') setMode('edit');
  $('#minecraftRenderType').value = state.project.renderType;
  $('#cullFaces').checked = javaBlock || state.project.cullFaces;
  updateSnapButton();
  updateRenderModeControl();
  updateToolOptions();
  if (geometryScope === 'journal' && canReuseJournalOutliner(previousProject, state.project, changedUids, state.outlinerRows)) {
    // Visible rows are already correct. Only their model references need to
    // follow the new project, avoiding a full tree walk and DOM replacement.
    for (const row of state.outlinerRows) if (row.node && !row.curveNode && !row.copyNode)
      row.node = state.project.getNode(row.node.uid);
  } else renderOutliner();
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
