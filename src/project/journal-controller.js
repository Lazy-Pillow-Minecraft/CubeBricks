import { CubeBricksProject } from '../model.js';
import { formatRules, constrainNode } from '../common/core/format-constraints.js';
import { operationDefinition, operationIndex, requireOperation } from '../common/core/operation-registry.js';
import { normalizeTextureLayers, releaseTextureRasters } from '../common/core/texture-features.js';
import { PROJECT_SESSION_KEYS } from './tabs-controller.js';
import { ConfigKey, configRegistry } from '../common/config/app-config.js';
import { performanceMonitor } from '../utils/performance-monitor.js';
import { RecentModelHistory, historySnapshot } from './recent-model-history.js';
import { pendingPaintCommit } from '../paint/commit-order.js';

export function createProjectJournalController({ state, projectTabsController, textureCanvas,
  isBezierElement, textureUid, clearSubdivisionSession, renderAll, toast,
  renderTextureList, activateProjectTexture, rebuildTextureAtlas,
  restoreProjectTextureView,
  serializableTextureAssets, serializeCbmodel, referenceImages,
  getTexturePaintDrag, getTextureUvDrag, scheduleProjectCover, finishActivePaintGesture }) {
const journalTimers = new Map();
const PIXEL_HISTORY_OPS = new Set(['brush', 'line', 'rectangle', 'ellipse', 'fill', 'gradient', 'paint', 'selection-transform']
  .map(tool => `core.texture.${tool}`));
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

function restoredProjectSession(session, data, restoreTextures = false, changedUids = null, modelChanged = true, changedTextureUids = null) {
  const previousSelectedUids = new Set(session.selectedUids);
  const previousSelectedUid = session.selectedUid;
  const previousSelectionAnchorUid = session.selectionAnchorUid;
  const restored = { ...session, project: modelChanged ? new CubeBricksProject(data, {
    reuseElementsFrom: session.project, changedUids
  }) : session.project, selectedGenerated: null, dirty: true };
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
    const changed = changedTextureUids && new Set(changedTextureUids);
    const previousAssets = changed && new Map(session.textureAssets.map(asset => [asset._uid, asset]));
    restored.textureAssets = (data.textures || []).map(asset => {
      const uid = textureUid(asset);
      if (changed && !changed.has(uid) && previousAssets.has(uid)) return previousAssets.get(uid);
      return { ...asset, _uid: uid, uvWidth: asset.uv_width,
      uvHeight: asset.uv_height, useAsDefault: asset.use_as_default === true,
      templateUvIndependent: asset.template_uv_independent ?? null,
      groupId: asset.group_id || null, activeLayerUid: asset.active_layer_uid || null,
      layers: normalizeTextureLayers(asset), externalFile: asset.external_file || null
      };
    });
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
        animation: asset.animation ? structuredClone(asset.animation) : null,
        width: asset.uvWidth || textureCanvas.width,
        height: asset.uvHeight || textureCanvas.height,
        group: entry.group || null
      });
      asset.source = entry.source;
      asset.layers = entry.layers ? structuredClone(entry.layers) : null;
      asset.activeLayerUid = entry.activeLayerUid || null;
      if (Object.hasOwn(entry, 'animation')) asset.animation = entry.animation ? structuredClone(entry.animation) : null;
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
  const paintCommit = pendingPaintCommit(state.project);
  if (paintCommit) {
    await paintCommit;
    if (tab.id !== projectTabsController.activeId) return true;
  }
  const requestedAt = performanceMonitor.enabled ? performance.now() : 0;
  // Reserve a place in the same queue as commits before yielding. Rapid undo /
  // redo and writes from a subsequent edit must never overtake one another.
  void flushProjectJournal(tab);
  const requestedRevision = tab.journalEditRevision || 0;
  const previousWrite = tab.journalWrites || Promise.resolve();
  const navigationSerial = tab.journalNavigationSerial = (tab.journalNavigationSerial || 0) + 1;
  const canSeedCheckout = !tab.journalUnpreviewedNavigation;
  // Explicit graph changes can remove a cached edge without changing the
  // visible head (for example deleting its redo branch).
  if (!direction) tab.recentModelHistory?.reset(null, null);
  // Nearby transactions already have immutable snapshots waiting in this
  // tab's write queue. Display that state without waiting for fsyncs.
  // Keep the durable checkout queued; edits made after this preview belong to
  // the target head, so their later commits must follow it rather than cancel it.
  const candidate = direction && !tab.journalWriteBlocked && !tab.journalUnpreviewedNavigation
    ? tab.recentModelHistory?.navigate(direction, { textureOnlyData: true }) : null;
  let preview = null;
  const showPreview = value => {
    if (value && (tab.journalEditRevision || 0) !== requestedRevision) {
      tab.recentModelHistory?.reset(null, null); value = null;
    }
    preview = value;
    if (!preview) { tab.journalUnpreviewedNavigation = navigationSerial; return; }
    tab.journalPreviewCount = (tab.journalPreviewCount || 0) + 1;
    if (tab.id === projectTabsController.activeId) syncActiveProjectTab();
    applyJournalModel(tab, preview.data, preview.textureChanged === true, preview.changedUids,
      preview.modelChanged !== false, preview.geometryChanged !== false, preview.changedTextureUids);
    if (performanceMonitor.enabled) performanceMonitor.record('journal.localNavigation', performance.now() - requestedAt);
  };
  // Pixel proofs run in a worker. They can finish while the durable queue is
  // busy, and never make visual restoration wait for a storage transaction.
  let localReady;
  try {
    if (candidate?.then) localReady = candidate.then(showPreview);
    else { showPreview(candidate); localReady = Promise.resolve(); }
  } catch (error) { localReady = Promise.reject(error); }
  // Register a handler immediately, even when an earlier disk write is slow.
  const localResult = localReady.then(() => null, error => {
    tab.journalWriteBlocked = true; return error;
  });
  const queuedAt = performanceMonitor.enabled ? performance.now() : 0;
  let diskCheckoutApplied = false;
  const navigate = async () => {
    const profile = performanceMonitor.enabled;
    if (profile) performanceMonitor.record('journal.queue', performance.now() - queuedAt);
    const waitStart = profile ? performance.now() : 0;
    await tab.journalReady;
    const localError = await localResult;
    if (localError) throw localError;
    if (preview && tab.journalWriteBlocked) throw new Error('工作記錄寫入失敗，已停止後續切換');
    if (!preview && (tab.journalEditRevision || 0) !== requestedRevision) return;
    if (!preview && tab.journalPending) throw new Error('目前變更尚未寫入工作記錄');
    const headBefore = tab.journalHead ?? (await window.cubeBricksDesktop.projectJournalState?.({ journalId: tab.journalId }))?.activeHead;
    const beforeData = canSeedCheckout && !preview && direction && navigationSerial === tab.journalNavigationSerial
      && typeof tab.session.project.serialize === 'function'
      ? historySnapshot(tab.session.project.serialize(), tab.session.textureAssets, tab.session.textureGroups) : null;
    if (!preview && (tab.journalEditRevision || 0) !== requestedRevision) return;
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
      if (preview) throw new Error('最近操作快取與工作記錄不一致；已停止後續寫入');
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
    if (!preview && (tab.journalEditRevision || 0) !== requestedRevision) {
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
    if (preview) {
      if (!await preview.matches(JSON.parse(result.content))) {
        throw new Error('最近操作快取與工作記錄不一致；已停止後續寫入');
      }
      diskCheckoutApplied = false;
      return;
    }
    if (!projectTabsController.tabs.includes(tab)) return;
    if (navigationSerial !== tab.journalNavigationSerial) return;
    if (tab.id === projectTabsController.activeId) syncActiveProjectTab();
    const resultData = JSON.parse(result.content);
    const hydrateStart = profile ? performance.now() : 0;
    if (profile) performanceMonitor.record('journal.parse', hydrateStart - parseStart);
    applyJournalModel(tab, resultData, result.textureChanged !== false, result.changedUids);
    if (profile) performanceMonitor.record('journal.apply', performance.now() - hydrateStart);
    diskCheckoutApplied = false;
    // Seed a verified neighboring edge after cold navigation. An arbitrary
    // graph jump starts with its target only; it is not an adjacent undo step.
    tab.recentModelHistory ||= new RecentModelHistory(null, null);
    if (beforeData && !request.prune) tab.recentModelHistory.seedCheckout?.(beforeData, resultData, direction);
    else tab.recentModelHistory.reset(result.content, null);
    if (request.prune && result.cleanupWarning)toast(`歷史清理未完成：${result.cleanupWarning}`);
    window.dispatchEvent(new CustomEvent('cubebricks:history-change',{detail:{tabId:tab.id}}));
  };
  const navigation = previousWrite.catch(() => {}).then(navigate);
  tab.journalWrites = navigation;
  try {
    await navigation;
  } catch (error) {
    if (diskCheckoutApplied || preview) tab.journalWriteBlocked = true;
    tab.recentModelHistory?.reset(null, null);
    toast(`操作記錄切換失敗：${error.message}`);
  } finally {
    if (preview) tab.journalPreviewCount--;
    if (tab.journalUnpreviewedNavigation === navigationSerial) tab.journalUnpreviewedNavigation = null;
  }
  return true;
}

function applyJournalModel(tab, data, textureChanged, changedUids, modelChanged = true, geometryChanged = true, changedTextureUids = null) {
  const previousProject = tab.session.project;
  const oldAssets = tab.session.textureAssets;
  tab.session = restoredProjectSession(tab.session, data, textureChanged, changedUids, modelChanged, changedTextureUids);
  if (textureChanged) for (const asset of oldAssets) releaseTextureRasters(asset, tab.session.textureAssets);
  if (tab.id !== projectTabsController.activeId) { renderProjectTabs(); return; }
  suppressJournalRecording = true;
  try {
    clearSubdivisionSession();
    for (const key of PROJECT_SESSION_KEYS) state[key] = tab.session[key];
    markDirty(true, { constrain: false });
    if (textureChanged) restoreProjectTextureView(geometryChanged || !changedTextureUids
      ? { preserveAtlas: true } : { preserveAtlas: true, changedTextureUids });
    renderAll(geometryChanged ? 'journal' : 'texture-journal', changedUids, previousProject);
  } finally { suppressJournalRecording = false; }
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
  if (state.mode === 'paint' && finishActivePaintGesture?.()) return;
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
  if (state.mode === 'paint') finishActivePaintGesture?.();
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
    if (rules.javaBlock || rules.moddedEntity || rules.bedrockBlock) {
      for (const uidValue of state.selectedUids) constrainNode(state.project.getNode(uidValue), rules, state.project);
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
  tab.recentModelHistory = new RecentModelHistory(null, null);
  const projectContent = tab.session.project.serialize();
  const initialModel = tab.journalModelSnapshot = { project: tab.session.project, text: projectContent, data: JSON.parse(projectContent) };
  const textureGroups = structuredClone(tab.session.textureGroups);
  tab.recentModelHistory.reset(projectContent, structuredClone(tab.session.textureAssets), textureGroups);
  if (existingId) {
    tab.journalReady = Promise.resolve();
    return;
  }
  tab.journalReady = serializableTextureAssets(structuredClone(tab.session.textureAssets))
    .then(textures => window.cubeBricksDesktop.initProjectJournal({
      journalId: tab.journalId,
      operationId,
      imported: tab.persistedWorkingCopy,
      operationIndex: operationIndex(),
      content: serializeCbmodel(textures, { ...initialModel.data }, textureGroups, { snapshotOwned: true, compact: true })
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
    if (pendingPaintCommit(tab.session.project)) { scheduleProjectJournal(tab); return; }
    if (tab.id === projectTabsController.activeId
      && (editingDrag || getTexturePaintDrag() || getTextureUvDrag() || referenceImages.drag)) {
      scheduleProjectJournal(tab);
      return;
    }
    void flushProjectJournal(tab);
  }, 400));
}

function noteJournalOperation(operationId, group = null) {
  if (state.projectHomeActive) return;
  const id = requireOperation(operationId);
  const tab = projectTabById(projectTabsController.activeId);
  if (!tab || tab.kind === 'home') return;
  tab.journalEditRevision = (tab.journalEditRevision || 0) + 1;
  if (tab.journalPending && (tab.journalPending !== id || group != null && tab.journalPendingGroup !== group))
    void flushProjectJournal(tab);
  tab.journalPending = id;
  tab.journalPendingGroup = group;
  scheduleProjectJournal(tab);
}

async function flushProjectJournal(tab = projectTabById(projectTabsController.activeId)) {
  if (!tab?.journalPending || !window.cubeBricksDesktop?.commitProjectJournal) return null;
  clearTimeout(journalTimers.get(tab.id));
  journalTimers.delete(tab.id);
  if (tab.id === projectTabsController.activeId) syncActiveProjectTab();
  const operationId = requireOperation(tab.journalPending);
  tab.journalPending = null;
  tab.journalPendingGroup = null;
  const session = tab.session;
  const retention = session.project.historyLimit ?? configRegistry.get(ConfigKey.HISTORY_LIMIT);
  const ordinal = tab.journalCommitOrdinal = (tab.journalCommitOrdinal || 0) + 1;
  let modelSnapshot = tab.journalModelSnapshot;
  if (modelSnapshot?.project !== session.project || !PIXEL_HISTORY_OPS.has(operationId)) {
    const text = session.project.serialize();
    modelSnapshot = tab.journalModelSnapshot = { project: session.project, text, data: JSON.parse(text) };
  }
  const projectContent = modelSnapshot.text;
  const textureGroups = structuredClone(session.textureGroups);
  const assets = structuredClone(session.textureAssets);
  if (tab.recentModelHistory) {
    tab.recentModelHistory.countLimit = Math.max(0, Math.min(9, retention + 1));
    tab.recentModelHistory.trim();
  }
  const snapshotEntry = tab.recentModelHistory?.push(projectContent, assets, operationId, textureGroups, {
    ordinal,
    canKeepForkParent: entry => (entry.provenNew && Number.isInteger(entry.ordinal) && ordinal - entry.ordinal <= retention)
      || (Number.isInteger(entry.sequence) && Number.isInteger(tab.journalLatestSequence)
        && tab.journalLatestSequence - entry.sequence + ordinal - (tab.journalCommittedOrdinal || 0) <= retention)
  });
  const textureSnapshot = serializableTextureAssets(assets);
  const write = async () => {
    await tab.journalReady;
    if (tab.journalWriteBlocked) throw new Error('歷史指針未能安全恢復，請先另存目前模型並重新開啟');
    const textures = await textureSnapshot;
    const content = serializeCbmodel(textures, { ...modelSnapshot.data }, textureGroups, { snapshotOwned: true, compact: true });
    const result = await window.cubeBricksDesktop.commitProjectJournal({
      journalId: tab.journalId, content, operationId,
      operationLabel: operationDefinition(operationId).label,
      operationIndex: operationIndex(),
      historyLimit: retention
    });
    if (result?.sequence) {
      tab.journalHead = result.sequence;
      tab.journalLatestSequence = Math.max(tab.journalLatestSequence || 0, result.sequence);
      tab.journalCommittedOrdinal = ordinal;
      if (snapshotEntry) snapshotEntry.sequence = result.sequence;
    }
    window.dispatchEvent(new CustomEvent('cubebricks:history-change',{detail:{tabId:tab.id}}));
    if (result?.sequence) scheduleProjectCover?.(tab);
    if (result?.historyWarning) toast(`歷史裁剪未完成：${result.historyWarning}`);
    return result;
  };
  tab.journalWrites = (tab.journalWrites || Promise.resolve()).catch(() => {}).then(write);
  try { return await tab.journalWrites; }
  catch (error) {
    if (tab.journalPreviewCount) tab.journalWriteBlocked = true;
    tab.recentModelHistory?.reset(null, null);
    tab.journalPending ||= operationId; toast(`操作記錄失敗：${error.message}`); return null;
  }
}
return {
  get suppressRecording() { return suppressJournalRecording; },
  set suppressRecording(value) { suppressJournalRecording = Boolean(value); },
  compactProjectHistorySnapshot, snapshot, restore, undo, redo, markDirty,
  startProjectJournal, scheduleProjectJournal, noteJournalOperation, flushProjectJournal,
  getProjectHistoryGraph, checkoutProjectHistory, pruneProjectHistoryBranch, setProjectHistoryMark
};
}
