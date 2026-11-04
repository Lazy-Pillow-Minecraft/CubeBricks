import { CubeBricksProject } from '../model.js';
import { formatRules, constrainNode } from '../common/core/format-constraints.js';
import { operationDefinition, operationIndex, requireOperation } from '../common/core/operation-registry.js';
import { normalizeTextureLayers } from '../common/core/texture-features.js';
import { PROJECT_SESSION_KEYS } from './tabs-controller.js';
import { ConfigKey, configRegistry } from '../common/config/app-config.js';
import { performanceMonitor } from '../utils/performance-monitor.js';

export function createProjectJournalController({ state, projectTabsController, textureCanvas,
  isBezierElement, textureUid, clearSubdivisionSession, renderAll, toast,
  renderTextureList, activateProjectTexture, rebuildTextureAtlas,
  restoreProjectTextureView,
  serializableTextureAssets, serializeCbmodel, referenceImages,
  getTexturePaintDrag, getTextureUvDrag, scheduleProjectCover }) {
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
  if (state.projectHomeActive) return;
  requireOperation(operationId);
  const tab = projectTabById(projectTabsController.activeId);
  if (tab) tab.journalEditRevision = (tab.journalEditRevision || 0) + 1;
  if (tab?.journalPending) void flushProjectJournal(tab);
  if (tab) tab.journalPending = operationId;
  if (!window.cubeBricksDesktop?.checkoutProjectJournal) {
    state.history.push(compactProjectHistorySnapshot(state.project, state.referenceImageSources));
    if (state.history.length > 60) state.history.shift();
    state.future.length = 0;
  }
}

function restoredProjectSession(session, data, restoreTextures = false, changedUids = null) {
  const previousSelectedUids = new Set(session.selectedUids);
  const previousSelectedUid = session.selectedUid;
  const previousSelectionAnchorUid = session.selectionAnchorUid;
  const restored = { ...session, project: new CubeBricksProject(data, {
    reuseElementsFrom: session.project, changedUids
  }), selectedGenerated: null, dirty: true };
  // History retention is project configuration, never an undoable model field.
  restored.project.historyLimit=session.project.historyLimit??null;
  restored.selectedUids = new Set([...previousSelectedUids].filter(uidValue => restored.project.getNode(uidValue)));
  restored.selectedUid = previousSelectedUid && restored.selectedUids.has(previousSelectedUid)
    ? previousSelectedUid
    : [...restored.selectedUids].at(-1) || null;
  restored.selectionAnchorUid = previousSelectionAnchorUid && restored.project.getNode(previousSelectionAnchorUid)
    ? previousSelectionAnchorUid
    : restored.selectedUid;
  const restoredSelection = restored.project.getNode(restored.selectedUid);
  const previousCurve = session.project.getNode(previousSelectedUid);
  if (!isBezierElement(restoredSelection) || !isBezierElement(previousCurve)
    || !Number.isInteger(session.selectedCurveNodeIndex)) restored.selectedCurveNodeIndex = null;
  else {
    const previousNodeUid = previousCurve.nodes[session.selectedCurveNodeIndex]?.uid;
    const nextIndex = restoredSelection.nodes.findIndex(node => node.uid === previousNodeUid);
    restored.selectedCurveNodeIndex = nextIndex < 0 ? null : nextIndex;
  }
  if (![...(restoredSelection?.modifiers || []), ...(restoredSelection?.operators || [])].some(modifier => modifier.uid === restored.selectedModifierUid)) restored.selectedModifierUid = null;
  if (restored.vertexSnapSource && !restored.project.getNode(restored.vertexSnapSource.rootUid)) restored.vertexSnapSource = null;
  if (restored.knifeSelection && !restored.project.getNode(restored.knifeSelection.uid)) restored.knifeSelection = null;
  if (restoreTextures) {
    restored.textureAssets = (data.textures || []).map(asset => ({
      ...asset, _uid: textureUid(asset), uvWidth: asset.uv_width,
      uvHeight: asset.uv_height, useAsDefault: asset.use_as_default === true,
      templateUvIndependent: asset.template_uv_independent ?? null,
      groupId: asset.group_id || null, activeLayerUid: asset.active_layer_uid || null,
      layers: normalizeTextureLayers(asset)
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
    // the previous GPU copy. UV/geometry has not changed, so the existing
    // mesh buffers stay valid; rebuilding them made paint undo visibly stall.
    rebuildTextureAtlas();
    markDirty();
    return true;
  }
  return false;
}

async function navigateProjectJournal(direction, request = {}) {
  const tab = projectTabById(projectTabsController.activeId);
  if (!tab?.journalId || !window.cubeBricksDesktop?.checkoutProjectJournal) return false;
  // Reserve a place in the same queue as commits before yielding. Rapid undo /
  // redo and writes from a subsequent edit must never overtake one another.
  void flushProjectJournal(tab);
  const requestedRevision = tab.journalEditRevision || 0;
  const previousWrite = tab.journalWrites || Promise.resolve();
  const navigationSerial = tab.journalNavigationSerial = (tab.journalNavigationSerial || 0) + 1;
  const queuedAt = performanceMonitor.enabled ? performance.now() : 0;
  let diskCheckoutApplied = false;
  const navigate = async () => {
    const profile = performanceMonitor.enabled;
    if (profile) performanceMonitor.record('journal.queue', performance.now() - queuedAt);
    const waitStart = profile ? performance.now() : 0;
    await tab.journalReady;
    if ((tab.journalEditRevision || 0) !== requestedRevision) return;
    if (tab.journalPending) throw new Error('目前變更尚未寫入工作記錄');
    const headBefore = tab.journalHead ?? (await window.cubeBricksDesktop.projectJournalState?.({ journalId: tab.journalId }))?.activeHead;
    if ((tab.journalEditRevision || 0) !== requestedRevision) return;
    const checkoutStart = profile ? performance.now() : 0;
    if (profile) performanceMonitor.record('journal.waitPending', checkoutStart - waitStart);
    const result = request.prune
      ? await window.cubeBricksDesktop.pruneProjectHistoryBranch({journalId:tab.journalId,sequence:request.sequence,single:request.single===true})
      : await window.cubeBricksDesktop.checkoutProjectJournal({ journalId: tab.journalId,
        ...(direction ? {direction} : {sequence:request.sequence}) });
    request.result = result;
    const parseStart = profile ? performance.now() : 0;
    if (profile) performanceMonitor.record('journal.diskCheckout', parseStart - checkoutStart);
    if (!result) {
      toast(direction === 'undo' ? '沒有可撤銷的操作' : '沒有可重做的操作');
      return;
    }
    if (request.prune && !result.content) {
      tab.journalHead = result.sequence;
      if(result.cleanupWarning)toast(`歷史清理未完成：${result.cleanupWarning}`);
      window.dispatchEvent(new CustomEvent('cubebricks:history-change',{detail:{tabId:tab.id}}));
      return;
    }
    diskCheckoutApplied = true;
    if ((tab.journalEditRevision || 0) !== requestedRevision) {
      // Without a local preview, a new edit was made against the old visible
      // head. Undo the disk navigation before that edit's queued commit runs.
      // If restoration fails, block writes rather than attaching it to the
      // wrong branch and silently losing the preceding operation.
      tab.journalWriteBlocked = true;
      if (!Number.isInteger(headBefore)) throw new Error('無法確認撤回前的歷史位置；已停止後續寫入');
      await window.cubeBricksDesktop.checkoutProjectJournal({ journalId: tab.journalId, sequence: headBefore });
      tab.journalHead = headBefore;
      tab.journalWriteBlocked = false;
      diskCheckoutApplied = false;
      tab.journalPending ||= 'core.element.property';
      scheduleProjectJournal(tab);
      return;
    }
    tab.journalHead = result.sequence;
    if (!projectTabsController.tabs.includes(tab)) return;
    if (navigationSerial !== tab.journalNavigationSerial) return;
    if (tab.id === projectTabsController.activeId) syncActiveProjectTab();
    const resultData = JSON.parse(result.content);
    const hydrateStart = profile ? performance.now() : 0;
    if (profile) performanceMonitor.record('journal.parse', hydrateStart - parseStart);
    const textureChanged = result.textureChanged !== false;
    const previousProject = tab.session.project;
    tab.session = restoredProjectSession(tab.session, resultData, textureChanged, result.changedUids);
    const renderStart = profile ? performance.now() : 0;
    if (profile) performanceMonitor.record('journal.hydrate', renderStart - hydrateStart);
    if (tab.id !== projectTabsController.activeId) { renderProjectTabs(); return; }
    suppressJournalRecording = true;
    try {
      clearSubdivisionSession();
      for (const key of PROJECT_SESSION_KEYS) state[key] = tab.session[key];
      markDirty(true, { constrain: false });
      if (textureChanged) restoreProjectTextureView({ preserveAtlas: true });
      renderAll('journal', result.changedUids, previousProject);
      if (profile) performanceMonitor.record('journal.render', performance.now() - renderStart);
      diskCheckoutApplied = false;
    } finally { suppressJournalRecording = false; }
    if (request.prune && result.cleanupWarning)toast(`歷史清理未完成：${result.cleanupWarning}`);
    window.dispatchEvent(new CustomEvent('cubebricks:history-change',{detail:{tabId:tab.id}}));
  };
  const navigation = previousWrite.catch(() => {}).then(navigate);
  tab.journalWrites = navigation;
  try {
    await navigation;
  } catch (error) {
    if (diskCheckoutApplied) tab.journalWriteBlocked = true;
    toast(`操作記錄切換失敗：${error.message}`);
  }
  return true;
}

async function getProjectHistoryGraph() {
  const tab=projectTabById(projectTabsController.activeId);
  if(!tab?.journalId||!window.cubeBricksDesktop?.projectHistoryGraph)return null;
  void flushProjectJournal(tab);
  const read=(tab.journalWrites||Promise.resolve()).catch(()=>{}).then(async()=>{
    await tab.journalReady;
    if(tab.journalPending)throw Error('目前變更尚未寫入工作記錄');
    const graph=await window.cubeBricksDesktop.projectHistoryGraph({journalId:tab.journalId});
    tab.journalHead=graph.current;
    return graph;
  });
  tab.journalWrites=read;
  return read;
}

async function checkoutProjectHistory(sequence) {
  requireOperation('core.history.checkout');
  const request={sequence};await navigateProjectJournal(null,request);return request.result;
}
async function setProjectHistoryMark(sequence,mark) {
  requireOperation('core.history.mark');
  const tab=projectTabById(projectTabsController.activeId);
  if(!tab?.journalId||!window.cubeBricksDesktop?.setProjectHistoryMark)return;
  const save=(tab.journalWrites||Promise.resolve()).catch(()=>{}).then(async()=>{
    await tab.journalReady;
    const result=await window.cubeBricksDesktop.setProjectHistoryMark({journalId:tab.journalId,sequence,mark});
    window.dispatchEvent(new CustomEvent('cubebricks:history-change',{detail:{tabId:tab.id}}));
    return result;
  });
  tab.journalWrites=save;return save;
}
async function pruneProjectHistoryBranch(sequence, {single=false}={}) {
  requireOperation(single?'core.history.delete':'core.history.prune');
  const request={sequence,prune:true,single};await navigateProjectJournal(null,request);return request.result;
}

async function undo() {
  if (state.projectHomeActive) return;
  // Desktop projects have one ordered journal for geometry, UVs and pixels.
  // The paint-only stack is a browser fallback; using it here makes Ctrl+Z
  // skip newer modelling edits and turns an undo into a fresh journal commit.
  if (!window.cubeBricksDesktop?.checkoutProjectJournal && state.mode === 'paint' && state.paintHistory.length) {
    restoreTexturePaintHistory(state.paintHistory, state.paintFuture);
    return;
  }
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
  if (state.projectHomeActive) return;
  if (!window.cubeBricksDesktop?.checkoutProjectJournal && state.mode === 'paint' && state.paintFuture.length) {
    restoreTexturePaintHistory(state.paintFuture, state.paintHistory);
    return;
  }
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
  if (state.projectHomeActive) return;
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
      imported: tab.persistedWorkingCopy,
      operationIndex: operationIndex(),
      content: serializeCbmodel(textures, JSON.parse(projectContent), textureGroups, { snapshotOwned: true })
    })).then(result => { if (result?.persistent !== undefined) tab.persistedWorkingCopy = result.persistent; });
  tab.journalReady.catch(error => toast(`工作目錄建立失敗：${error.message}`));
}

function scheduleProjectJournal(tab) {
  if (!window.cubeBricksDesktop?.commitProjectJournal) return;
  clearTimeout(journalTimers.get(tab.id));
  journalTimers.set(tab.id, setTimeout(() => {
    journalTimers.delete(tab.id);
    performanceMonitor.mark('journal.autosaveWake');
    const editingDrag = state.dragging && !['pan', 'orbit', 'selection-box'].includes(state.dragging.type);
    if (tab.id === projectTabsController.activeId
      && (editingDrag || getTexturePaintDrag() || getTextureUvDrag() || referenceImages.drag)) {
      scheduleProjectJournal(tab);
      return;
    }
    void flushProjectJournal(tab);
  }, 400));
}

function noteJournalOperation(operationId) {
  if (state.projectHomeActive) return;
  const id = requireOperation(operationId);
  const tab = projectTabById(projectTabsController.activeId);
  if (!tab || tab.kind === 'home') return;
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
    if (tab.journalWriteBlocked) throw new Error('歷史指針未能安全恢復，請先另存目前模型並重新開啟');
    const textures = await textureSnapshot;
    const content = serializeCbmodel(textures, JSON.parse(projectContent), textureGroups, { snapshotOwned: true });
    const result = await window.cubeBricksDesktop.commitProjectJournal({
      journalId: tab.journalId, content, operationId,
      operationLabel: operationDefinition(operationId).label,
      operationIndex: operationIndex(),
      historyLimit: session.project.historyLimit ?? configRegistry.get(ConfigKey.HISTORY_LIMIT)
    });
    if (result?.sequence) tab.journalHead = result.sequence;
    window.dispatchEvent(new CustomEvent('cubebricks:history-change',{detail:{tabId:tab.id}}));
    if (result?.sequence) scheduleProjectCover?.(tab);
    if (result?.historyWarning) toast(`歷史裁剪未完成：${result.historyWarning}`);
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
  startProjectJournal, scheduleProjectJournal, noteJournalOperation, flushProjectJournal,
  getProjectHistoryGraph, checkoutProjectHistory, pruneProjectHistoryBranch, setProjectHistoryMark
};
}
