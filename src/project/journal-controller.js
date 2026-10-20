import { CubeBricksProject } from '../model.js';
import { formatRules, constrainNode } from '../common/core/format-constraints.js';
import { operationDefinition, operationIndex, requireOperation } from '../common/core/operation-registry.js';
import { PROJECT_SESSION_KEYS } from './tabs-controller.js';

export function createProjectJournalController({ state, projectTabsController, textureCanvas,
  isBezierElement, textureUid, clearSubdivisionSession, renderAll, toast,
  renderTextureList, activateProjectTexture, rebuildTextureAtlas,
  invalidateAllRenderGeometry, restoreProjectTextureView,
  serializableTextureAssets, serializeCbmodel, referenceImages,
  getTexturePaintDrag, getTextureUvDrag }) {
const journalTimers = new Map();
let suppressJournalRecording = false;
const { projectTabById, captureProjectSession, syncActiveProjectTab,
  projectTabLabel, renderProjectTabs, updateProjectStateLabel } = projectTabsController;

function projectReferenceImageRecords(project) {
  return Object.values(project.referenceImages || {}).flatMap(value => Array.isArray(value) ? value : value ? [value] : [])
    .filter(record => record && typeof record === 'object');
}

function compactProjectHistorySnapshot(project, sources) {
  const data = JSON.parse(project.serialize());
  for (const record of projectReferenceImageRecords(data)) {
    if (typeof record.source !== 'string') continue;
    let reference = [...sources].find(([, source]) => source === record.source)?.[0];
    if (!reference) {
      reference = crypto.randomUUID();
      sources.set(reference, record.source);
    }
    record.sourceRef = reference;
    delete record.source;
  }
  return JSON.stringify(data);
}

function expandProjectHistorySnapshot(serialized, sources) {
  const data = JSON.parse(serialized);
  for (const record of projectReferenceImageRecords(data)) {
    if (!record.sourceRef || typeof record.source === 'string') continue;
    const source = sources.get(record.sourceRef);
    if (typeof source !== 'string') throw new Error(`參考圖快照缺失：${record.sourceRef}`);
    record.source = source;
    delete record.sourceRef;
  }
  return data;
}

function snapshot(operationId = 'core.element.property') {
  requireOperation(operationId);
  const tab = projectTabById(projectTabsController.activeId);
  if (tab) tab.journalEditRevision = (tab.journalEditRevision || 0) + 1;
  if (tab?.journalPending) void flushProjectJournal(tab);
  if (tab) tab.journalPending = operationId;
  state.history.push(compactProjectHistorySnapshot(state.project, state.referenceImageSources));
  if (state.history.length > 60) state.history.shift();
  state.future.length = 0;
}

function restoredProjectSession(session, data, restoreTextures = false) {
  const previousSelectedUids = new Set(session.selectedUids);
  const previousSelectedUid = session.selectedUid;
  const previousSelectionAnchorUid = session.selectionAnchorUid;
  const restored = { ...session, project: new CubeBricksProject(data), selectedGenerated: null, dirty: true };
  restored.selectedUids = new Set([...previousSelectedUids].filter(uidValue => restored.project.getNode(uidValue)));
  restored.selectedUid = previousSelectedUid && restored.selectedUids.has(previousSelectedUid)
    ? previousSelectedUid
    : [...restored.selectedUids].at(-1) || null;
  restored.selectionAnchorUid = previousSelectionAnchorUid && restored.project.getNode(previousSelectionAnchorUid)
    ? previousSelectionAnchorUid
    : restored.selectedUid;
  const restoredSelection = restored.project.getNode(restored.selectedUid);
  if (!isBezierElement(restoredSelection) || restored.selectedCurveNodeIndex >= restoredSelection.nodes.length) restored.selectedCurveNodeIndex = null;
  if (![...(restoredSelection?.modifiers || []), ...(restoredSelection?.operators || [])].some(modifier => modifier.uid === restored.selectedModifierUid)) restored.selectedModifierUid = null;
  if (restored.vertexSnapSource && !restored.project.getNode(restored.vertexSnapSource.rootUid)) restored.vertexSnapSource = null;
  if (restored.knifeSelection && !restored.project.getNode(restored.knifeSelection.uid)) restored.knifeSelection = null;
  if (restoreTextures) {
    restored.textureAssets = (data.textures || []).map(asset => ({
      ...asset, _uid: textureUid(asset), uvWidth: asset.uv_width,
      uvHeight: asset.uv_height, useAsDefault: asset.use_as_default === true,
      groupId: asset.group_id || null, activeLayerUid: asset.active_layer_uid || null
    }));
    restored.textureGroups = structuredClone(data.textureGroups || []);
    if (!restored.textureAssets.some(asset => asset._uid === restored.activeTextureUid)) {
      restored.activeTextureUid = restored.textureAssets.find(asset => asset.useAsDefault)?._uid
        || restored.textureAssets[0]?._uid || null;
    }
  }
  return restored;
}

function restore(serialized) {
  const restored = restoredProjectSession(captureProjectSession(), expandProjectHistorySnapshot(serialized, state.referenceImageSources));
  clearSubdivisionSession();
  for (const key of PROJECT_SESSION_KEYS) state[key] = restored[key];
  markDirty(true, { constrain: false });
  renderAll();
}

function restoreTexturePaintHistory(sourceStack, targetStack) {
  while (sourceStack.length) {
    const first = sourceStack.pop();
    const entries = [first];
    if (first.group) while (sourceStack.at(-1)?.group === first.group) entries.push(sourceStack.pop());
    let activeAsset = null;
    for (const entry of entries) {
      const asset = state.textureAssets.find(texture => texture._uid === entry.uid);
      if (!asset) continue;
      targetStack.push({
        uid: asset._uid, source: asset.source,
        layers: asset.layers ? structuredClone(asset.layers) : null, activeLayerUid: asset.activeLayerUid || null,
        width: asset.uvWidth || textureCanvas.width,
        height: asset.uvHeight || textureCanvas.height,
        group: entry.group || null
      });
      asset.source = entry.source;
      asset.layers = entry.layers ? structuredClone(entry.layers) : null;
      asset.activeLayerUid = entry.activeLayerUid || null;
      asset.uvWidth = entry.width;
      asset.uvHeight = entry.height;
      activeAsset ||= asset;
    }
    while (targetStack.length > 60) targetStack.shift();
    if (!activeAsset) continue;
    state.activeTextureUid = activeAsset._uid;
    renderTextureList();
    activateProjectTexture(state.textureAssets.indexOf(activeAsset));
    // A grouped stroke may touch several independent texture assets. Rebuild
    // the atlas as a unit so undo/redo cannot leave non-active faces showing
    // the previous GPU copy.
    rebuildTextureAtlas();
    invalidateAllRenderGeometry();
    markDirty();
    return true;
  }
  return false;
}

async function navigateProjectJournal(direction) {
  const tab = projectTabById(projectTabsController.activeId);
  if (!tab?.journalId || !window.cubeBricksDesktop?.checkoutProjectJournal) return false;
  // Reserve a place in the same queue as commits before yielding. Rapid undo /
  // redo and writes from a subsequent edit must never overtake one another.
  void flushProjectJournal(tab);
  const requestedRevision = tab.journalEditRevision || 0;
  const previousWrite = tab.journalWrites || Promise.resolve();
  const navigate = async () => {
    await tab.journalReady;
    if ((tab.journalEditRevision || 0) !== requestedRevision) return;
    if (tab.journalPending) throw new Error('目前變更尚未寫入工作記錄');
    const result = await window.cubeBricksDesktop.checkoutProjectJournal({ journalId: tab.journalId, direction });
    if (!result) { toast(direction === 'undo' ? '沒有可撤銷的操作' : '沒有可重做的操作'); return; }
    tab.journalHead = result.sequence;
    if ((tab.journalEditRevision || 0) !== requestedRevision) {
      // An edit made during IPC already owns a later slot in journalWrites (or
      // is pending). Keep that newer visible state; never overwrite it with an
      // older asynchronous checkout result.
      tab.journalPending ||= 'core.element.property';
      scheduleProjectJournal(tab);
      return;
    }
    if (!projectTabsController.tabs.includes(tab)) return;
    if (tab.id === projectTabsController.activeId) syncActiveProjectTab();
    tab.session = restoredProjectSession(tab.session, JSON.parse(result.content), true);
    if (tab.id !== projectTabsController.activeId) { renderProjectTabs(); return; }
    suppressJournalRecording = true;
    try {
      clearSubdivisionSession();
      for (const key of PROJECT_SESSION_KEYS) state[key] = tab.session[key];
      markDirty(true, { constrain: false });
      restoreProjectTextureView();
      renderAll();
    } finally { suppressJournalRecording = false; }
  };
  const navigation = previousWrite.catch(() => {}).then(navigate);
  tab.journalWrites = navigation;
  try {
    await navigation;
  } catch (error) { toast(`操作記錄切換失敗：${error.message}`); }
  return true;
}

async function undo() {
  if (await navigateProjectJournal('undo')) return;
  if (state.mode === 'paint') {
    if (!restoreTexturePaintHistory(state.paintHistory, state.paintFuture)) toast('沒有可撤銷的繪畫操作');
    return;
  }
  if (!state.history.length) return toast('沒有可撤銷的操作');
  state.future.push(compactProjectHistorySnapshot(state.project, state.referenceImageSources));
  restore(state.history.pop());
}

async function redo() {
  if (await navigateProjectJournal('redo')) return;
  if (state.mode === 'paint') {
    if (!restoreTexturePaintHistory(state.paintFuture, state.paintHistory)) toast('沒有可重做的繪畫操作');
    return;
  }
  if (!state.future.length) return toast('沒有可重做的操作');
  state.history.push(compactProjectHistorySnapshot(state.project, state.referenceImageSources));
  restore(state.future.pop());
}

function markDirty(value = true, { constrain = true } = {}) {
  if (value && constrain && !suppressJournalRecording && state.mode === 'edit') {
    const rules = formatRules(state.project);
    if (rules.javaBlock || rules.moddedEntity) {
      for (const uidValue of state.selectedUids) constrainNode(state.project.getNode(uidValue), rules);
    }
  }
  const activeTab = projectTabById(projectTabsController.activeId);
  const previousDirty = activeTab?.session.dirty;
  const previousLabel = activeTab ? projectTabLabel(activeTab) : '';
  state.dirty = value;
  const tab = syncActiveProjectTab();
  if (tab) tab.session.dirty = value;
  if (value && tab && !suppressJournalRecording) {
    tab.journalEditRevision = (tab.journalEditRevision || 0) + 1;
    tab.journalPending ||= 'core.element.property';
    scheduleProjectJournal(tab);
  }
  updateProjectStateLabel();
  if (!tab || previousDirty !== value || previousLabel !== projectTabLabel(tab)) renderProjectTabs();
}

function startProjectJournal(tab, operationId = 'core.project.create', existingId = null) {
  if (!window.cubeBricksDesktop?.initProjectJournal) return;
  tab.journalId = existingId || tab.id;
  if (existingId) {
    tab.journalReady = Promise.resolve();
    return;
  }
  const projectContent = tab.session.project.serialize();
  const textureGroups = structuredClone(tab.session.textureGroups);
  tab.journalReady = serializableTextureAssets(structuredClone(tab.session.textureAssets))
    .then(textures => window.cubeBricksDesktop.initProjectJournal({
      journalId: tab.journalId,
      operationId,
      operationIndex: operationIndex(),
      content: serializeCbmodel(textures, JSON.parse(projectContent), textureGroups)
    }));
  tab.journalReady.catch(error => toast(`工作目錄建立失敗：${error.message}`));
}

function scheduleProjectJournal(tab) {
  if (!window.cubeBricksDesktop?.commitProjectJournal) return;
  clearTimeout(journalTimers.get(tab.id));
  journalTimers.set(tab.id, setTimeout(() => {
    journalTimers.delete(tab.id);
    if (tab.id === projectTabsController.activeId && (state.dragging || getTexturePaintDrag() || getTextureUvDrag() || referenceImages.drag)) {
      scheduleProjectJournal(tab);
      return;
    }
    void flushProjectJournal(tab);
  }, 400));
}

function noteJournalOperation(operationId) {
  const id = requireOperation(operationId);
  const tab = projectTabById(projectTabsController.activeId);
  if (!tab) return;
  tab.journalEditRevision = (tab.journalEditRevision || 0) + 1;
  if (tab.journalPending && tab.journalPending !== id) void flushProjectJournal(tab);
  tab.journalPending = id;
  scheduleProjectJournal(tab);
}

async function flushProjectJournal(tab = projectTabById(projectTabsController.activeId)) {
  if (!tab?.journalPending || !window.cubeBricksDesktop?.commitProjectJournal) return null;
  clearTimeout(journalTimers.get(tab.id));
  journalTimers.delete(tab.id);
  if (tab.id === projectTabsController.activeId) syncActiveProjectTab();
  const operationId = requireOperation(tab.journalPending);
  tab.journalPending = null;
  const session = tab.session;
  const projectContent = session.project.serialize();
  const textureGroups = structuredClone(session.textureGroups);
  const assets = structuredClone(session.textureAssets);
  const textureSnapshot = serializableTextureAssets(assets);
  const write = async () => {
    await tab.journalReady;
    const textures = await textureSnapshot;
    const content = serializeCbmodel(textures, JSON.parse(projectContent), textureGroups);
    const result = await window.cubeBricksDesktop.commitProjectJournal({
      journalId: tab.journalId, content, operationId,
      operationLabel: operationDefinition(operationId).label,
      operationIndex: operationIndex()
    });
    if (result?.sequence) tab.journalHead = result.sequence;
    return result;
  };
  tab.journalWrites = (tab.journalWrites || Promise.resolve()).catch(() => {}).then(write);
  try { return await tab.journalWrites; }
  catch (error) { tab.journalPending ||= operationId; toast(`操作記錄失敗：${error.message}`); return null; }
}
return {
  get suppressRecording() { return suppressJournalRecording; },
  set suppressRecording(value) { suppressJournalRecording = Boolean(value); },
  compactProjectHistorySnapshot, snapshot, restore, undo, redo, markDirty,
  startProjectJournal, scheduleProjectJournal, noteJournalOperation, flushProjectJournal
};
}
