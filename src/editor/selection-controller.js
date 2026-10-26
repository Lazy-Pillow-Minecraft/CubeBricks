export function createSelectionController({
  state, $$, outliner, inspector, sceneRenderer, inspectorController,
  renderOutliner, renderOutlinerWindow, invalidateSelectionRenderGeometry,
  updateToolOptions, renderInspector, renderScene, renderTextureUvOverlay,
  updateSelectionLabels, cancelKnifeSelection, toast, selected,
  inspectorBatchNodes, sharedVectorValues, round
}) {
let selectionExpansionCache = null;
function revealOutlinerItem(uid) {
  let hierarchyChanged = false;
  for (const group of state.project.getGroupChain(uid)) {
    if (!state.collapsedGroups.delete(group.uid)) continue;
    hierarchyChanged = true;
  }
  if (hierarchyChanged) renderOutliner();
  let index = (state.outlinerRows || []).findIndex(row => row.node?.uid === uid);
  if (index < 0) {
    const search = document.getElementById('outlinerSearch');
    if (search?.value) {
      search.value = '';
      renderOutliner();
      index = (state.outlinerRows || []).findIndex(row => row.node?.uid === uid);
    }
  }
  if (index < 0) return;
  const rowTop = state.outlinerRows[index].top;
  const rowBottom = rowTop + state.outlinerRows[index].height;
  const visibleTop = outliner.scrollTop;
  const visibleBottom = visibleTop + outliner.clientHeight;
  let target = null;
  if (rowTop < visibleTop) target = rowTop;
  else if (rowBottom > visibleBottom) target = Math.max(0, rowBottom - outliner.clientHeight);
  if (target !== null) outliner.scrollTo({ top: target, behavior: 'smooth' });
  else {
    state.outlinerWindowStart = -1;
    state.outlinerWindowEnd = -1;
    renderOutlinerWindow();
  }
}

function refreshSelectionUi() {
  const outlinerFocused = outliner.contains(document.activeElement) || document.activeElement === outliner;
  state.outlinerWindowStart = -1;
  state.outlinerWindowEnd = -1;
  renderOutlinerWindow();
  if (outlinerFocused) outliner.focus({ preventScroll: true });
  invalidateSelectionRenderGeometry(false);
  updateToolOptions();
  renderInspector();
  renderScene();
  renderTextureUvOverlay();
  updateSelectionLabels();
}

function clearSelection() {
  if (!state.selectedUids.size && !state.selectedUid && !state.selectedGenerated) return;
  sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
  state.selectedUids = new Set();
  state.selectedUid = null;
  state.selectedGenerated = null;
  state.selectionAnchorUid = null;
  state.selectedCurveNodeIndex = null;
  state.selectedModifierUid = null;
  state.vertexSnapSource = null;
  if (state.tool === 'knife') cancelKnifeSelection(false);
  refreshSelectionUi();
}

function selectAllElements() {
  const ownerUid = inspectorController.subdivisionSession?.ownerUid;
  const uids = state.project.elements
    .filter(element => ownerUid ? element.subdivisionOwnerUid === ownerUid : !element.subdivisionOwnerUid)
    .map(element => element.uid);
  if (!uids.length) return;
  sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
  state.selectedUids = new Set(uids);
  state.selectedUid = uids.at(-1);
  state.selectedGenerated = null;
  state.selectionAnchorUid = state.selectedUid;
  state.selectedCurveNodeIndex = null;
  state.selectedModifierUid = null;
  state.vertexSnapSource = null;
  if (state.tool === 'knife') cancelKnifeSelection(false);
  refreshSelectionUi();
}

function selectItem(uid, { revealInOutliner = false, toggle = false, range = false } = {}) {
  const requestedNode = state.project.getNode(uid);
  if (!requestedNode) return;
  if (inspectorController.subdivisionSession && requestedNode.subdivisionOwnerUid !== inspectorController.subdivisionSession.ownerUid) {
    toast('細分編輯期間只能選擇目前 Shape 內的 Cube');
    return;
  }
  const previousSelectedUid = state.selectedUid;
  state.selectedGenerated = null;
  sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
  if (range && state.selectionAnchorUid) {
    const rows = state.outlinerRows || [];
    const start = rows.findIndex(row => row.node?.uid === state.selectionAnchorUid);
    const end = rows.findIndex(row => row.node?.uid === uid);
    if (start >= 0 && end >= 0) {
      const extended = new Set(state.selectedUids);
      rows.slice(Math.min(start, end), Math.max(start, end) + 1)
        .filter(row => row.node && !row.curveNode)
        .forEach(row => extended.add(row.node.uid));
      state.selectedUids = extended;
    } else state.selectedUids = new Set([...state.selectedUids, uid]);
  } else if (toggle) {
    const toggled = new Set(state.selectedUids);
    if (toggled.has(uid)) toggled.delete(uid);
    else toggled.add(uid);
    state.selectedUids = toggled;
    state.selectionAnchorUid = uid;
  } else {
    state.selectedUids = new Set([uid]);
    state.selectionAnchorUid = uid;
  }
  state.selectedUid = state.selectedUids.has(uid) ? uid : [...state.selectedUids].at(-1) || null;
  state.selectedModifierUid = null;
  if (state.selectedUid !== previousSelectedUid) {
    state.selectedCurveNodeIndex = null;
  }
  if (state.project.getNode(state.selectedUid)?.type !== 'bezier2d' && state.project.getNode(state.selectedUid)?.type !== 'bezier3d') {
    state.selectedCurveNodeIndex = null;
  }
  if (state.tool !== 'vertexSnap') state.vertexSnapSource = null;
  if (state.tool === 'knife' && state.knifeSelection?.uid !== state.selectedUid) {
    state.knifeSelection = null;
    state.knifeHover = null;
    state.knifePointer = null;
    updateToolOptions();
  }
  if (revealInOutliner && state.selectedUid) revealOutlinerItem(state.selectedUid);
  refreshSelectionUi();
}

function syncInspectorValues() {
  const item = selected();
  if (!item) return;
  const items = inspectorBatchNodes();
  $$('[data-vector]', inspector).forEach(input => {
    if (document.activeElement === input) return;
    const field = input.dataset.vector;
    if (field.startsWith('curve-node:')) return;
    const values = sharedVectorValues(items, field, item[field] || [0, 0, 0]);
    const value = values[Number(input.dataset.axis)];
    input.value = value === null ? '' : String(round(value));
    if (value === null) input.dataset.mixed = 'true';
    else delete input.dataset.mixed;
  });
  $$('[data-parameter]', inspector).forEach(input => {
    if (document.activeElement === input) return;
    const key = input.dataset.parameter;
    const first = items[0]?.parameters?.[key];
    const value = items.length <= 1 ? first
      : Number.isFinite(first) && items.every(node => Number.isFinite(node?.parameters?.[key]) && Math.abs(node.parameters[key] - first) < 1e-9) ? first : null;
    input.value = value === null || value === undefined ? '' : String(round(value));
    if (value === null || value === undefined) input.dataset.mixed = 'true';
    else delete input.dataset.mixed;
  });
}

function getSelectionExpansion() {
  if (selectionExpansionCache?.project === state.project
    && selectionExpansionCache.selection === state.selectedUids
    && selectionExpansionCache.size === state.selectedUids.size
    && selectionExpansionCache.hierarchyRevision === state.project.hierarchyRevision) return selectionExpansionCache;
  const nodeUids = [...state.selectedUids].filter(uidValue => state.project.getNode(uidValue));
  const elements = new Set();
  for (const uidValue of nodeUids) {
    const node = state.project.getNode(uidValue);
    if (node?.type === 'group') state.project.getDescendantElementUids(uidValue).forEach(childUid => elements.add(childUid));
    else if (node) elements.add(node.uid);
  }
  selectionExpansionCache = {
    project: state.project,
    selection: state.selectedUids,
    size: state.selectedUids.size,
    hierarchyRevision: state.project.hierarchyRevision,
    nodeUids,
    elementUids: [...elements],
    elementSet: elements
  };
  return selectionExpansionCache;
}

function selectedNodeUids() {
  return getSelectionExpansion().nodeUids;
}

function selectedElementUids() {
  return getSelectionExpansion().elementUids;
}

function selectedTopLevelNodes() {
  return topLevelSelectedUids().map(uidValue => state.project.getNode(uidValue)).filter(Boolean);
}

function deepestCommonSelectionGroup() {
  const paths = selectedTopLevelNodes().map(node => [
    ...state.project.getGroupChain(node.uid),
    ...(node.type === 'group' ? [node] : [])
  ]);
  if (!paths.length) return null;
  const shortest = Math.min(...paths.map(path => path.length));
  let common = null;
  for (let index = 0; index < shortest; index++) {
    const candidate = paths[0][index];
    if (!paths.every(path => path[index]?.uid === candidate.uid)) break;
    common = candidate;
  }
  return common;
}

function topLevelSelectedUids() {
  const chosen = new Set(selectedNodeUids());
  return [...chosen].filter(uidValue => !state.project.getGroupChain(uidValue).some(group => chosen.has(group.uid)));
}

return {
  revealOutlinerItem,
  refreshSelectionUi,
  clearSelection,
  selectAllElements,
  selectItem,
  syncInspectorValues,
  getSelectionExpansion,
  selectedNodeUids,
  selectedElementUids,
  selectedTopLevelNodes,
  deepestCommonSelectionGroup,
  topLevelSelectedUids,
};
}
