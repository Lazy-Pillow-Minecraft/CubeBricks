import { modelFormatRegistry } from '../common/config/model-formats.js';
import { JavaBlockVersion, constrainProject } from '../common/core/format-constraints.js';
import { normalizeTextureLayers } from '../common/core/texture-features.js';

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
  compactProjectHistorySnapshot, markDirty, scheduleProjectJournal }) {
let projectTabs = [];
let activeProjectTabId = null;
let editingProjectTabId = null;
let draggingProjectTabId = null;
let draggingProjectTabInsertIndex = null;
let closingProjects = false;

function projectTabById(tabId) {
  return projectTabs.find(tab => tab.id === tabId) || null;
}

function createProjectSession(project, options = {}) {
  const selectedUid = options.selectedUid ?? project.elements[0]?.uid ?? null;
  const textureAssets = (options.textureAssets || []).map(asset => ({
    ...asset,
    _uid: textureUid(asset),
    groupId: asset.groupId || null,
    layers: normalizeTextureLayers(asset)
  }));
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
  if (tab) tab.session = captureProjectSession();
  return tab;
}

function projectTabLabel(tab) {
  if (tab.displayName) return tab.displayName;
  const filePath = tab.session.filePath;
  return filePath ? filePath.split(/[\\/]/).pop() : tab.session.project.name || 'untitled';
}

function renderProjectTabs() {
  if (!projectTabsNode) return;
  document.body.classList.toggle('project-home-active', projectTabs.length === 0);
  projectTabsNode.innerHTML = projectTabs.map(tab => {
    const active = tab.id === activeProjectTabId;
    const label = projectTabLabel(tab);
    const format = modelFormatRegistry.get(tab.session.project.formatId);
    const title = [label, format?.name, tab.session.filePath].filter(Boolean).join(' · ');
    return `<div class="project-tab ${active ? 'active' : ''} ${tab.session.dirty ? 'dirty' : ''}" role="tab"
        aria-selected="${active}" tabindex="${active ? '0' : '-1'}" draggable="true" data-project-tab="${tab.id}" title="${escapeAttribute(title)}">
      <span class="project-tab-status" aria-hidden="true"></span>
      <span class="project-tab-name">${escapeHtml(label)}</span>
      <button class="project-tab-close" type="button" data-close-project-tab="${tab.id}" title="關閉項目" aria-label="關閉 ${escapeAttribute(label)}">×</button>
    </div>`;
  }).join('');
  projectTabsNode.querySelector('.project-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function updateProjectStateLabel() {
  if (!projectTabs.length) {
    projectState.textContent = '項目首頁';
    projectState.style.color = '';
    document.title = 'CubeBricks';
    return;
  }
  const fileName = state.filePath ? state.filePath.split(/[\\/]/).pop() : `${state.project.name}.cbmodel`;
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
    if (previous?.journalPending) void flushProjectJournal(previous);
  }
  activeProjectTabId = tabId;
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
  return true;
}

function addProjectTab(project, options = {}) {
  syncActiveProjectTab();
  const tab = {
    id: `project_${crypto.randomUUID()}`,
    displayName: options.displayName || null,
    session: createProjectSession(project, options)
  };
  projectTabs.push(tab);
  startProjectJournal(tab, options.journalId ? null : options.imported ? 'core.project.import' : 'core.project.create', options.journalId);
  activateProjectTab(tab.id, { render: options.render !== false });
  return tab;
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
  await window.cubeBricksDesktop.discardProjectJournal({ journalId: tab.journalId });
}

function closeProjectTab(tabId) {
  syncActiveProjectTab();
  const index = projectTabs.findIndex(tab => tab.id === tabId);
  if (index < 0) return;
  const tab = projectTabs[index];
  if (tab.session.dirty && !window.confirm(`「${projectTabLabel(tab)}」尚未保存，仍要關閉嗎？`)) return;
  const discard = tab.session.dirty || !tab.session.filePath;
  const pending = discard ? discardProjectTabJournal(tab) : (async () => {
    await flushProjectJournal(tab);
    await tab.journalReady;
    await tab.journalWrites;
  })();
  pending.catch(error => toast(`關閉工作項目失敗：${error.message}`));
  // Blob-backed textures must remain readable until the captured final write
  // has converted them into durable image data.
  pending.catch(() => {}).then(() => disposeProjectTab(tab));
  projectTabs.splice(index, 1);
  if (!projectTabs.length) {
    activeProjectTabId = null;
    renderProjectTabs();
    updateProjectStateLabel();
    window.dispatchEvent(new Event('cubebricks:project-home'));
    return;
  }
  if (tabId === activeProjectTabId) {
    activeProjectTabId = null;
    activateProjectTab(projectTabs[Math.min(index, projectTabs.length - 1)].id);
  } else renderProjectTabs();
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
  if (!tab) return;
  editingProjectTabId = tabId;
  const project = tab.session.project;
  $('#projectInfoName').value = project.name || '';
  $('#projectInfoFormat').textContent = modelFormatRegistry.get(project.formatId)?.name || project.formatId;
  $('#projectInfoJavaVersionRow').hidden = project.formatId !== 'java_block_item';
  $('#projectInfoJavaVersion').value = project.formatData?.javaBlockVersion || JavaBlockVersion.LEGACY;
  $('#projectInfoTextureWidth').value = project.textureSize?.[0] || 16;
  $('#projectInfoTextureHeight').value = project.textureSize?.[1] || 16;
  $('#projectInfoSnap').value = project.snap?.subdivisions || state.settingsSnap;
  $('#projectInfoDescription').value = project.formatData?.projectDescription || '';
  projectInfoDialog.showModal();
  requestAnimationFrame(() => $('#projectInfoName').focus());
}

function applyProjectInfo() {
  const tab = projectTabById(editingProjectTabId);
  if (!tab) return;
  const name = $('#projectInfoName').value.trim();
  const width = Math.max(1, Math.round(Number($('#projectInfoTextureWidth').value)));
  const height = Math.max(1, Math.round(Number($('#projectInfoTextureHeight').value)));
  const snap = Number($('#projectInfoSnap').value);
  if (!name || !Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(snap) || snap <= 0) return;
  if (tab.journalPending) void flushProjectJournal(tab);
  tab.journalEditRevision = (tab.journalEditRevision || 0) + 1;
  tab.session.history.push(compactProjectHistorySnapshot(tab.session.project, tab.session.referenceImageSources));
  if (tab.session.history.length > 60) tab.session.history.shift();
  tab.session.future.length = 0;
  tab.session.project.name = name;
  tab.session.project.textureSize = [width, height];
  tab.session.project.snap = { subdivisions: snap };
  tab.session.project.formatData = {
    ...(tab.session.project.formatData || {}),
    projectDescription: $('#projectInfoDescription').value.trim(),
    ...($('#projectInfoJavaVersionRow').hidden ? {} : { javaBlockVersion: $('#projectInfoJavaVersion').value })
  };
  constrainProject(tab.session.project);
  tab.displayName = null;
  tab.session.dirty = true;
  tab.journalPending = 'core.project.information';
  scheduleProjectJournal(tab);
  projectInfoDialog.close();
  editingProjectTabId = null;
  if (tab.id === activeProjectTabId) {
    for (const key of PROJECT_SESSION_KEYS) state[key] = tab.session[key];
    markDirty(true);
    renderAll();
  } else renderProjectTabs();
  toast('項目信息已更新');
}

function initializeProjectTabs() {
  projectTabs = [];
  activeProjectTabId = null;
  renderProjectTabs();
  updateProjectStateLabel();
}

function requestProjectClose() {
  if (closingProjects) return;
  syncActiveProjectTab();
  const dialog = $('#closeProjectsDialog');
  if (dialog.open) return;
  $('#closeProjectsList').innerHTML = projectTabs.map(tab => `<label class="close-project-row">
    <input type="checkbox" data-retain-tab="${escapeAttribute(tab.id)}" checked />
    <span title="${escapeAttribute(tab.session.filePath || projectTabLabel(tab))}">${escapeHtml(projectTabLabel(tab))}</span>
    <small>${tab.session.dirty ? '未保存' : '已保存'}</small>
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
    await Promise.all(projectTabs.map(async tab => {
      await flushProjectJournal(tab);
      await tab.journalReady;
      await tab.journalWrites;
    }));
    const retained = [], discarded = [];
    for (const tab of projectTabs) {
      if (!tab.journalId) continue;
      const keep = $(`[data-retain-tab="${tab.id}"]`, $('#closeProjectsList'))?.checked;
      if (keep) retained.push({ journalId: tab.journalId, filePath: tab.session.filePath, dirty: tab.session.dirty,
        active: tab.id === activeProjectTabId });
      else discarded.push(tab.journalId);
    }
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
  renderProjectTabs, updateProjectStateLabel, activateProjectTab, addProjectTab,
  closeProjectTab, projectTabInsertionIndex, previewProjectTabInsertion,
  moveProjectTabToIndex, openProjectInfo, applyProjectInfo, initializeProjectTabs,
  requestProjectClose, confirmProjectClose
};
}
