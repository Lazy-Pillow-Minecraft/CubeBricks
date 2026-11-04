import { modelFormatRegistry } from '../common/config/model-formats.js';
import { JavaBlockVersion, constrainProject } from '../common/core/format-constraints.js';
import { normalizeTextureLayers } from '../common/core/texture-features.js';
import { isolateTextureLayerIds } from '../common/core/texture-layer-identity.js';
import { ConfigKey, configRegistry } from '../common/config/app-config.js';
import { showAppChoice } from '../screen/prompt-dialog.js';

export const PROJECT_SESSION_KEYS = Object.freeze([
  'project', 'selectedUid', 'selectedUids', 'selectedGenerated', 'selectionAnchorUid', 'selectedCurveNodeIndex', 'selectedModifierUid', 'filePath', 'dirty', 'history', 'future',
  'knifeSelection', 'knifeHover', 'knifePointer', 'vertexSnapSource', 'zoom', 'panX', 'panY', 'yaw', 'pitch',
  'target', 'axisView', 'axisViewSign', 'axisViewCameras', 'generalCamera', 'referenceImageSelection', 'referenceImageSources', 'collapsedGroups', 'textureAssets', 'textureGroups', 'activeTextureUid', 'paintHistory', 'paintFuture', 'timelineFrame',
  'selectedUvFaces', 'textureView', 'paintSelection'
]);

export function createProjectTabsController({ state, $, escapeHtml, escapeAttribute, projectTabsNode,
  projectState, projectInfoDialog, textureUid, restoreProjectTextureView, renderAll,
  getSubdivisionSession, exitSubdivisionEdit, referenceImages, cancelCameraFocus,
  sceneRenderer, startProjectJournal, flushProjectJournal, toast,
  compactProjectHistorySnapshot, markDirty, scheduleProjectJournal,
  onProjectActivated, onProjectClosing }) {
let projectTabs = [];
let activeProjectTabId = null;
let editingProjectTabId = null;
let draggingProjectTabId = null;
let draggingProjectTabInsertIndex = null;
let closingProjects = false;
let homeSession = null;

function projectTabById(tabId) {
  return projectTabs.find(tab => tab.id === tabId) || null;
}

function createProjectSession(project, options = {}) {
  const selectedUid = options.selectedUid ?? project.elements[0]?.uid ?? null;
  const textureAssets = isolateTextureLayerIds((options.textureAssets || []).map(asset => ({
    ...asset,
    _uid: textureUid(asset),
    groupId: asset.groupId || null,
    layers: normalizeTextureLayers(asset),animation:asset.animation?structuredClone(asset.animation):null
  })));
  const preferredTexture = textureAssets.find(asset => asset.useAsDefault) || textureAssets[0] || null;
  return {
    project,
    selectedUid,
    selectedUids: new Set(selectedUid ? [selectedUid] : []),
    selectedGenerated: null,
    selectionAnchorUid: selectedUid,
    selectedCurveNodeIndex: null,
    selectedModifierUid: null,
    filePath: options.filePath || null,
    dirty: options.dirty ?? false,
    history: [],
    future: [],
    knifeSelection: null,
    knifeHover: null,
    knifePointer: null,
    vertexSnapSource: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    yaw: -Math.PI * 3 / 4,
    pitch: Math.PI / 6,
    target: [0, 0, 0],
    axisView: null,
    axisViewSign: 1,
    axisViewCameras: { x: null, y: null, z: null },
    generalCamera: null,
    referenceImageSelection: { general: null, x: null, y: null, z: null },
    referenceImageSources: new Map(),
    collapsedGroups: new Set(),
    textureAssets,
    textureGroups: structuredClone(options.textureGroups || []),
    activeTextureUid: preferredTexture?._uid || null,
    paintHistory: [],
    paintFuture: [],
    paintSelection: { active: false, masks: new Map() },
    selectedUvFaces: new Set(),
    textureView: { zoom: 1, panX: 0, panY: 0 },
    timelineFrame: 0
  };
}

function captureProjectSession() {
  return Object.fromEntries(PROJECT_SESSION_KEYS.map(key => [key, state[key]]));
}

function syncActiveProjectTab() {
  const tab = projectTabById(activeProjectTabId);
  if (tab?.kind === 'home') return null;
  if (tab) tab.session = captureProjectSession();
  return tab;
}

function projectTabLabel(tab) {
  if (tab.kind === 'home') return '項目首頁';
  if (tab.displayName) return tab.displayName;
  const filePath = tab.session.filePath;
  return filePath ? filePath.split(/[\\/]/).pop() : tab.session.project.name || 'untitled';
}

function renderProjectTabs() {
  if (!projectTabsNode) return;
  const home = projectTabById(activeProjectTabId)?.kind === 'home';
  state.projectHomeActive = home;
  document.body.classList.toggle('project-home-active', home);
  const historyButton=$('[data-action="history"]');
  if(historyButton)historyButton.disabled=home;
  projectTabsNode.innerHTML = projectTabs.map(tab => {
    const active = tab.id === activeProjectTabId;
    const label = projectTabLabel(tab);
    const format = tab.kind === 'home' ? null : modelFormatRegistry.get(tab.session.project.formatId);
    const title = [label, format?.name, tab.session?.filePath].filter(Boolean).join(' · ');
    return `<div class="project-tab ${active ? 'active' : ''} ${tab.session?.dirty ? 'dirty' : ''}" role="tab"
        aria-selected="${active}" tabindex="${active ? '0' : '-1'}" draggable="true" data-project-tab="${tab.id}" title="${escapeAttribute(title)}">
      <span class="project-tab-status" aria-hidden="true"></span>
      <span class="project-tab-name">${escapeHtml(label)}</span>
      <button class="project-tab-close" type="button" data-close-project-tab="${tab.id}" title="關閉項目" aria-label="關閉 ${escapeAttribute(label)}">×</button>
    </div>`;
  }).join('');
  projectTabsNode.querySelector('.project-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function updateProjectStateLabel() {
  if (!projectTabs.length || projectTabById(activeProjectTabId)?.kind === 'home') {
    projectState.textContent = '項目首頁';
    projectState.style.color = '';
    document.title = 'CubeBricks';
    return;
  }
  const fileName = state.filePath ? state.filePath.split(/[\\/]/).pop() : state.project.name;
  const label = `${state.dirty ? '● ' : ''}${fileName}`;
  const title = `${state.dirty ? '● ' : ''}${projectTabLabel(projectTabById(activeProjectTabId) || { session: captureProjectSession() })} — CubeBricks`;
  if (projectState.textContent !== label) projectState.textContent = label;
  const color = state.dirty ? 'var(--accent)' : '';
  if (projectState.style.color !== color) projectState.style.color = color;
  if (document.title !== title) document.title = title;
}

function activateProjectTab(tabId, { render = true } = {}) {
  const tab = projectTabById(tabId);
  if (!tab) return false;
  if (tabId !== activeProjectTabId && getSubdivisionSession()) exitSubdivisionEdit(false);
  if (tabId !== activeProjectTabId) {
    const previous = syncActiveProjectTab();
    if (previous) {
      onProjectClosing?.(previous);
      if (previous.journalPending) void flushProjectJournal(previous);
    }
  }
  activeProjectTabId = tabId;
  if (tab.kind === 'home') {
    if (homeSession) for (const key of PROJECT_SESSION_KEYS) state[key] = homeSession[key];
    state.dragging = null;
    cancelCameraFocus();
    updateProjectStateLabel();
    renderProjectTabs();
    window.dispatchEvent(new Event('cubebricks:project-home'));
    return true;
  }
  state.projectHomeActive = false;
  for (const key of PROJECT_SESSION_KEYS) state[key] = tab.session[key];
  state.dragging = null;
  referenceImages.resetInteraction();
  state.hitAreas = [];
  state.lockedHoverPoint = null;
  state.lockedHoverStrength = 0;
  cancelCameraFocus();
  sceneRenderer.invalidateLockState();
  restoreProjectTextureView();
  window.dispatchEvent(new Event('cubebricks:texture-change'));
  updateProjectStateLabel();
  renderProjectTabs();
  if (render) renderAll();
  onProjectActivated?.(tab);
  return true;
}

function addProjectTab(project, options = {}) {
  syncActiveProjectTab();
  const home = projectTabById(options.replaceTabId === undefined ? activeProjectTabId : options.replaceTabId);
  const tab = {
    id: `project_${crypto.randomUUID()}`,
    kind: 'project',
    displayName: options.displayName || null,
    createdThisLaunch: !options.imported && !options.journalId,
    persistedWorkingCopy: options.persistent ?? Boolean(options.imported || options.journalId),
    session: createProjectSession(project, options)
  };
  if (home?.kind === 'home') {
    projectTabs.splice(projectTabs.indexOf(home), 1, tab);
    if (activeProjectTabId === home.id) activeProjectTabId = null;
  } else projectTabs.push(tab);
  startProjectJournal(tab, options.journalId ? null : options.imported ? 'core.project.import' : 'core.project.create', options.journalId);
  // Opening an existing project must not put a full history compaction ahead
  // of the first undo. Commits and saves already enforce the configured cap.
  activateProjectTab(tab.id, { render: options.render !== false });
  return tab;
}

function addHomeTab() {
  syncActiveProjectTab();
  const tab = { id: `home_${crypto.randomUUID()}`, kind: 'home', session: null };
  projectTabs.push(tab);
  activateProjectTab(tab.id);
  return tab;
}

function removeProjectTab(tab) {
  const index = projectTabs.indexOf(tab);
  if (index < 0) return;
  projectTabs.splice(index, 1);
  if (tab.kind !== 'home') disposeProjectTab(tab);
  if (!projectTabs.length) { activeProjectTabId = null; addHomeTab(); }
  else if (tab.id === activeProjectTabId) {
    activeProjectTabId = null;
    activateProjectTab(projectTabs[Math.min(index, projectTabs.length - 1)].id);
  } else renderProjectTabs();
}

async function deleteWorkspaceProject(journalId) {
  const tab = projectTabs.find(item => item.journalId === journalId);
  syncActiveProjectTab();
  if (tab) {
    await flushProjectJournal(tab);
    await tab.journalReady;
    await tab.journalWrites;
    if (tab.journalPending) throw new Error('尚有未寫入的操作，工作目錄已保留');
  }
  const deleted = await window.cubeBricksDesktop.deleteWorkspaceProject({ journalId });
  if (deleted && tab) removeProjectTab(tab);
  return deleted;
}

function disposeProjectTab(tab) {
  tab.session.referenceImageSources?.clear();
  for (const asset of tab.session.textureAssets || []) {
    if (typeof asset.source === 'string' && asset.source.startsWith('blob:')) URL.revokeObjectURL(asset.source);
  }
}

async function discardProjectTabJournal(tab) {
  if (!tab?.journalId || !window.cubeBricksDesktop?.discardProjectJournal) return;
  await flushProjectJournal(tab);
  if (tab.journalPending) throw new Error('尚有未寫入的操作，工作目錄已保留');
  await tab.journalReady;
  await tab.journalWrites;
  if (!await window.cubeBricksDesktop.discardProjectJournal({ journalId: tab.journalId }))
    throw new Error('已保存的項目不能自動刪除');
}

async function closeProjectTab(tabId) {
  syncActiveProjectTab();
  const index = projectTabs.findIndex(tab => tab.id === tabId);
  if (index < 0) return;
  const tab = projectTabs[index];
  if (tab.kind === 'home') { removeProjectTab(tab); return; }
  if (tab.closing) return;
  tab.closing = true;
  try {
    let discard = false;
    if (!tab.persistedWorkingCopy) {
      const choice = await showAppChoice({ title: '關閉項目', message: `是否保留「${projectTabLabel(tab)}」？`,
        detail: '這個新建項目從未保存。保存後會一直保留在項目文件夾中。',
        buttons: ['保存並關閉', '不保留', '取消'], cancelIndex: 2 });
      if (choice.index === 2) return;
      discard = choice.index === 1;
    }
    if (!discard && tabId === activeProjectTabId) await onProjectClosing?.(tab);
    if (discard) await discardProjectTabJournal(tab);
    else {
      await flushProjectJournal(tab);
      await tab.journalReady;
      await tab.journalWrites;
      if (tab.journalPending) throw new Error('尚有未寫入的操作，工作目錄已保留');
      if (window.cubeBricksDesktop?.retainProjectJournal)
        await window.cubeBricksDesktop.retainProjectJournal({ journalId: tab.journalId });
      tab.persistedWorkingCopy = true;
    }
    removeProjectTab(tab);
  } catch (error) { toast(`關閉工作項目失敗：${error.message}`); }
  finally { tab.closing = false; }
}

function projectTabInsertionIndex(clientX, sourceId = draggingProjectTabId) {
  const candidates = [...projectTabsNode.querySelectorAll('[data-project-tab]')]
    .filter(node => node.dataset.projectTab !== sourceId);
  const index = candidates.findIndex(node => clientX < node.getBoundingClientRect().left + node.offsetWidth / 2);
  return index < 0 ? candidates.length : index;
}

function previewProjectTabInsertion(index, sourceId = draggingProjectTabId) {
  const candidates = [...projectTabsNode.querySelectorAll('[data-project-tab]')]
    .filter(node => node.dataset.projectTab !== sourceId);
  projectTabsNode.querySelectorAll('.drop-before,.drop-after').forEach(node => node.classList.remove('drop-before', 'drop-after'));
  if (!candidates.length) return;
  if (index >= candidates.length) candidates.at(-1).classList.add('drop-after');
  else candidates[Math.max(0, index)].classList.add('drop-before');
}

function moveProjectTabToIndex(sourceId, insertionIndex) {
  if (!sourceId || insertionIndex === null) return;
  const sourceIndex = projectTabs.findIndex(tab => tab.id === sourceId);
  if (sourceIndex < 0) return;
  const [source] = projectTabs.splice(sourceIndex, 1);
  projectTabs.splice(Math.max(0, Math.min(projectTabs.length, insertionIndex)), 0, source);
  renderProjectTabs();
}

function openProjectInfo(tabId) {
  syncActiveProjectTab();
  const tab = projectTabById(tabId);
  if (!tab || tab.kind === 'home') return;
  editingProjectTabId = tabId;
  const project = tab.session.project;
  $('#projectInfoName').value = project.name || '';
  $('#projectInfoFormat').textContent = modelFormatRegistry.get(project.formatId)?.name || project.formatId;
  $('#projectInfoJavaVersionRow').hidden = project.formatId !== 'java_block_item';
  $('#projectInfoJavaVersion').value = project.formatData?.javaBlockVersion || JavaBlockVersion.LEGACY;
  $('#projectInfoTextureWidth').value = project.textureSize?.[0] || 16;
  $('#projectInfoTextureHeight').value = project.textureSize?.[1] || 16;
  $('#projectInfoSnap').value = project.snap?.subdivisions || state.settingsSnap;
  $('#projectInfoHistoryLimit').value = project.historyLimit ?? '';
  $('#projectInfoDescription').value = project.formatData?.projectDescription || '';
  projectInfoDialog.showModal();
  requestAnimationFrame(() => $('#projectInfoName').focus());
}

function applyProjectInfo() {
  const tab = projectTabById(editingProjectTabId);
  if (!tab || tab.kind === 'home') return;
  const name = $('#projectInfoName').value.trim();
  const width = Math.max(1, Math.round(Number($('#projectInfoTextureWidth').value)));
  const height = Math.max(1, Math.round(Number($('#projectInfoTextureHeight').value)));
  const snap = Number($('#projectInfoSnap').value);
  const historyText = $('#projectInfoHistoryLimit').value.trim();
  const historyLimit = historyText === '' ? null : Number(historyText);
  if (!name || !Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(snap) || snap <= 0
    || historyLimit !== null && (!Number.isInteger(historyLimit) || historyLimit < 0 || historyLimit > 10000)) return;
  const project=tab.session.project,previousHistoryLimit=project.historyLimit;
  const description=$('#projectInfoDescription').value.trim();
  const javaVersion=$('#projectInfoJavaVersionRow').hidden?null:$('#projectInfoJavaVersion').value;
  const modelChanged=name!==project.name||width!==(project.textureSize?.[0]||16)||height!==(project.textureSize?.[1]||16)
    ||snap!==(project.snap?.subdivisions||state.settingsSnap)||description!==(project.formatData?.projectDescription||'')
    ||javaVersion!==null&&javaVersion!==(project.formatData?.javaBlockVersion||JavaBlockVersion.LEGACY);
  const historyChanged=historyLimit!==previousHistoryLimit;
  if(modelChanged){
    if (tab.journalPending) void flushProjectJournal(tab);
    tab.journalEditRevision = (tab.journalEditRevision || 0) + 1;
    if (!window.cubeBricksDesktop?.checkoutProjectJournal) {
      tab.session.history.push(compactProjectHistorySnapshot(project, tab.session.referenceImageSources));
      if (tab.session.history.length > 60) tab.session.history.shift();
      tab.session.future.length = 0;
    }
    project.name=name;project.textureSize=[width,height];project.snap={subdivisions:snap};
    project.formatData={...(project.formatData||{}),projectDescription:description,
      ...(javaVersion===null?{}:{javaBlockVersion:javaVersion})};
    constrainProject(project);
    tab.displayName = null;
    tab.session.dirty = true;
    tab.journalPending = 'core.project.information';
    scheduleProjectJournal(tab);
  }
  project.historyLimit=historyLimit;
  projectInfoDialog.close();
  editingProjectTabId = null;
  if (modelChanged&&tab.id === activeProjectTabId) {
    for (const key of PROJECT_SESSION_KEYS) state[key] = tab.session[key];
    markDirty(true);
    renderAll();
  } else if(modelChanged)renderProjectTabs();
  if(historyChanged)persistProjectHistoryLimit(tab,historyLimit,previousHistoryLimit);
  toast('項目信息已更新');
}

function persistProjectHistoryLimit(tab,historyLimit,previousHistoryLimit) {
  if(!window.cubeBricksDesktop?.updateProjectJournalSettings)return;
  // Save real pending edits before pruning; the setting itself creates no
  // snapshot, changes no edit revision, and does not clear the redo branch.
  void flushProjectJournal(tab);
  const save=async()=>{
    await tab.journalReady;
    await window.cubeBricksDesktop.updateProjectJournalSettings({journalId:tab.journalId,historyLimit});
    try{await window.cubeBricksDesktop.compactProjectJournal({journalId:tab.journalId,
      historyLimit:historyLimit??configRegistry.get(ConfigKey.HISTORY_LIMIT)});}
    catch(error){toast(`歷史裁剪失敗：${error.message}`);}
    window.dispatchEvent(new CustomEvent('cubebricks:history-change',{detail:{tabId:tab.id}}));
  };
  const saved=(tab.journalWrites||Promise.resolve()).catch(()=>{}).then(save);
  tab.journalWrites=saved;
  saved.catch(error=>{
    if(tab.session.project.historyLimit===historyLimit)tab.session.project.historyLimit=previousHistoryLimit;
    toast(error.message);
  });
}

function initializeProjectTabs() {
  projectTabs = [];
  activeProjectTabId = null;
  homeSession = captureProjectSession();
  addHomeTab();
  configRegistry.subscribe(ConfigKey.HISTORY_LIMIT, change => {
    if (!window.cubeBricksDesktop?.compactProjectJournal) return;
    for (const tab of projectTabs.filter(item => item.kind !== 'home' && item.session.project.historyLimit === null)) {
      const compact = async () => {
        await tab.journalReady;
        await window.cubeBricksDesktop.compactProjectJournal({ journalId: tab.journalId, historyLimit: change.value });
        window.dispatchEvent(new CustomEvent('cubebricks:history-change',{detail:{tabId:tab.id}}));
      };
      tab.journalWrites = (tab.journalWrites || Promise.resolve()).catch(() => {}).then(compact);
      tab.journalWrites.catch(error => toast(`歷史裁剪失敗：${error.message}`));
    }
  });
}

function requestProjectClose() {
  if (closingProjects) return;
  syncActiveProjectTab();
  const dialog = $('#closeProjectsDialog');
  if (dialog.open) return;
  const newTabs = projectTabs.filter(tab => tab.kind !== 'home' && !tab.persistedWorkingCopy);
  if (!newTabs.length) { void confirmProjectClose(); return; }
  $('#closeProjectsList').innerHTML = newTabs.map(tab => `<label class="close-project-row">
    <input type="checkbox" data-retain-tab="${escapeAttribute(tab.id)}" checked />
    <span title="${escapeAttribute(tab.session.filePath || projectTabLabel(tab))}">${escapeHtml(projectTabLabel(tab))}</span>
    <small>從未保存</small>
  </label>`).join('');
  dialog.showModal();
}

async function confirmProjectClose() {
  if (closingProjects) return;
  closingProjects = true;
  const submit = $('#closeProjectsForm button[type="submit"]');
  submit.disabled = true;
  try {
    syncActiveProjectTab();
    await Promise.all(projectTabs.filter(tab => tab.kind !== 'home').map(async tab => {
      await flushProjectJournal(tab);
      await tab.journalReady;
      await tab.journalWrites;
    }));
    const retained = [], discarded = [];
    for (const tab of projectTabs) {
      if (!tab.journalId) continue;
      const keep = tab.persistedWorkingCopy || $(`[data-retain-tab="${tab.id}"]`, $('#closeProjectsList'))?.checked;
      if (keep) retained.push({ journalId: tab.journalId, filePath: tab.session.filePath, dirty: tab.session.dirty,
        active: tab.id === activeProjectTabId });
      else discarded.push(tab.journalId);
    }
    const active = projectTabById(activeProjectTabId);
    if (active && retained.some(tab => tab.journalId === active.journalId)) await onProjectClosing?.(active);
    await window.cubeBricksDesktop.confirmProjectClose({ retained, discarded });
  } catch (error) {
    closingProjects = false;
    submit.disabled = false;
    toast(`關閉失敗：${error.message}`);
  }
}
function clearEditingProjectTab() { editingProjectTabId = null; }

return {
  get tabs() { return projectTabs; },
  get activeId() { return activeProjectTabId; },
  get editingTabId() { return editingProjectTabId; },
  set editingTabId(value) { editingProjectTabId = value; },
  get draggingTabId() { return draggingProjectTabId; },
  set draggingTabId(value) { draggingProjectTabId = value; },
  get draggingInsertIndex() { return draggingProjectTabInsertIndex; },
  set draggingInsertIndex(value) { draggingProjectTabInsertIndex = value; },
  clearEditingProjectTab,
  projectTabById, projectTabLabel, discardProjectTabJournal,
  createProjectSession, captureProjectSession, syncActiveProjectTab,
  renderProjectTabs, updateProjectStateLabel, activateProjectTab, addProjectTab, addHomeTab, removeProjectTab, deleteWorkspaceProject,
  closeProjectTab, projectTabInsertionIndex, previewProjectTabInsertion,
  moveProjectTabToIndex, openProjectInfo, applyProjectInfo, initializeProjectTabs,
  requestProjectClose, confirmProjectClose
};
}
