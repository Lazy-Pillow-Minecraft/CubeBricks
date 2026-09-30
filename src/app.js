import { BezierElement, Cube, CurveNode, Group, Locator, NodeElement, Shape, CubeBricksProject, chooseKnifeCutAxis, exportBlockbench, getKnifeFaceAxes, importBlockbench, setPivotPreservingGeometry, splitCubeAt } from './model.js';
import { ConfigKey, applyLanguage, configRegistry, getLanguageLabel } from './config/app-config.js';
import { createModelProjectData, modelFormatRegistry } from './config/model-formats.js';
import { WebGLSceneRenderer, applyGroupTransforms, getBlockbenchBoxUv, getEffectiveInflate } from './render/webgl-renderer.js';
import { DockManager } from './ui/dock-manager.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const LOCATOR_ICON_SHAPES = '<path d="M98.74,144.52c-38.86,0-72.06-19.5-85.3-46.99-1.11,4.43-1.7,9-1.7,13.69,0,38.28,38.95,69.32,87,69.32s87-31.03,87-69.32c0-4.69-.59-9.26-1.7-13.69-13.24,27.49-46.44,46.99-85.3,46.99Z"/><rect x="81.01" y="56.54" width="35.47" height="96.98"/><rect x="59.53" y="77.83" width="78.43" height="25.75" rx="7.93" ry="7.93"/><path d="M98.74,0c-18.89,0-34.21,15.31-34.21,34.21s15.31,34.21,34.21,34.21,34.21-15.31,34.21-34.21S117.63,0,98.74,0ZM98.74,49.2c-8.28,0-14.99-6.71-14.99-14.99s6.71-14.99,14.99-14.99,14.99,6.71,14.99,14.99-6.71,14.99-14.99,14.99Z"/><path d="M26.73,85.59l17.01,31.01c1.89,3.45-.6,7.66-4.54,7.66H5.18c-3.93,0-6.43-4.22-4.54-7.66l17.01-31.01c1.96-3.58,7.11-3.58,9.07,0Z"/><path d="M179.83,85.59l17.01,31.01c1.89,3.45-.6,7.66-4.54,7.66h-34.03c-3.93,0-6.43-4.22-4.54-7.66l17.01-31.01c1.96-3.58,7.11-3.58,9.07,0Z"/><path d="M97.08,188.46l-18.84-16.15c-1.8-1.55-.71-4.5,1.67-4.5h37.68c2.38,0,3.47,2.96,1.67,4.5l-18.84,16.15c-.96.82-2.37.82-3.33,0Z"/>';
const TOOL_REGISTRY = Object.freeze({
  move: { modes: ['edit', 'animate'] },
  resize: { modes: ['edit', 'animate'] },
  rotate: { modes: ['edit', 'animate'] },
  pivot: { modes: ['edit'] },
  vertexSnap: { modes: ['edit'] },
  knife: { modes: ['edit'] },
  brush: { modes: ['paint'] }
});

const state = {
  project: new CubeBricksProject({ name: 'untitled' }),
  selectedUid: null,
  selectedUids: new Set(),
  selectionAnchorUid: null,
  selectedCurveNodeIndex: null,
  mode: 'edit',
  tool: 'move',
  filePath: null,
  dirty: false,
  grid: configRegistry.get(ConfigKey.SHOW_GRID),
  wire: configRegistry.get(ConfigKey.SHOW_WIREFRAME),
  renderMode: 'textured',
  transformSpace: 'global',
  multiTransformMode: 'unified',
  rotationMode: 'pose',
  scaleHandleMode: 'fixed',
  knifeSelection: null,
  knifeHover: null,
  knifePointer: null,
  vertexSnapSource: null,
  vertexSnapMode: 'move',
  vertexSnapRotationMode: 'pivot',
  projection: configRegistry.get(ConfigKey.PROJECTION),
  previewShade: configRegistry.get(ConfigKey.PREVIEW_SHADE),
  geometryOnly: configRegistry.get(ConfigKey.SHOW_GEOMETRY_ONLY),
  settingsSnap: configRegistry.get(ConfigKey.SNAP),
  allowNegativeSize: configRegistry.get(ConfigKey.ALLOW_NEGATIVE_SIZE),
  modifierSnap: {
    shift: { mode: configRegistry.get(ConfigKey.SHIFT_SNAP_MODE), value: configRegistry.get(ConfigKey.SHIFT_SNAP_VALUE) },
    ctrl: { mode: configRegistry.get(ConfigKey.CTRL_SNAP_MODE), value: configRegistry.get(ConfigKey.CTRL_SNAP_VALUE) },
    shiftCtrl: { mode: configRegistry.get(ConfigKey.SHIFT_CTRL_SNAP_MODE), value: configRegistry.get(ConfigKey.SHIFT_CTRL_SNAP_VALUE) }
  },
  symmetry: configRegistry.get(ConfigKey.SYMMETRY),
  alphaLock: configRegistry.get(ConfigKey.ALPHA_LOCK),
  lockedDefaultAlpha: configRegistry.get(ConfigKey.LOCKED_DEFAULT_ALPHA),
  lockedHoverFade: configRegistry.get(ConfigKey.LOCKED_HOVER_FADE),
  lockedHoverAlpha: configRegistry.get(ConfigKey.LOCKED_HOVER_ALPHA),
  lockedHoverRadius: configRegistry.get(ConfigKey.LOCKED_HOVER_RADIUS),
  lockedHoverPoint: null,
  lockedHoverStrength: 0,
  outlinerDetailed: true,
  zoom: 1,
  panX: 0,
  panY: 0,
  yaw: -Math.PI * 3 / 4,
  pitch: Math.PI / 6,
  target: [0, 0, 0],
  history: [],
  future: [],
  hitAreas: [],
  dragging: null,
  outlinerCollapsed: false,
  collapsedGroups: new Set(),
  textureAssets: [],
  textureGroups: [],
  activeTextureUid: null,
  uvPreviewEnabled: true,
  uvPreviewAutoRotate: false,
  uvPreviewFaceColors: false,
  uvPreviewYaw: -Math.PI / 4,
  uvPreviewPitch: Math.PI / 7,
  timelinePlaying: false,
  timelineFrame: 0,
  layoutResizing: false
};

const DOCK_PANEL_DEFINITIONS = Object.freeze([
  { id: 'texture', index: 0, modes: ['edit', 'paint'], defaultDock: 'left', defaultOrder: 0, defaultPosition: { x: 24, y: 104 }, defaultSize: { width: 236, height: 620 }, defaultCollapsed: false },
  { id: 'uvPreview', index: 1, modes: ['edit', 'paint', 'animate'], defaultDock: 'left', defaultOrder: 1, defaultPosition: { x: 24, y: 520 }, defaultSize: { width: 236, height: 260 }, defaultCollapsed: false },
  { id: 'inspector', index: 2, modes: ['edit', 'paint', 'animate'], defaultDock: 'right', defaultOrder: 0, defaultPosition: { x: 920, y: 104 }, defaultSize: { width: 292, height: 340 }, defaultCollapsed: false },
  { id: 'outliner', index: 3, modes: ['edit', 'paint', 'animate'], defaultDock: 'right', defaultOrder: 1, defaultPosition: { x: 920, y: 460 }, defaultSize: { width: 292, height: 340 }, defaultCollapsed: false },
  { id: 'bottom', index: 4, modes: ['paint', 'animate'], defaultDock: 'bottom', defaultOrder: 0, defaultPosition: { x: 280, y: 620 }, defaultSize: { width: 720, height: 176 }, defaultCollapsed: false }
]);

state.selectedUid = state.project.elements[0]?.uid;
if (state.selectedUid) state.selectedUids.add(state.selectedUid);

const sceneCanvas = $('#sceneCanvas');
const viewport = $('#viewport');
const selectionMarquee = $('#selectionMarquee');
const sceneRenderer = new WebGLSceneRenderer(sceneCanvas);
const uvPreviewCanvas = $('#uvPreviewCanvas');
const uvPreviewViewport = $('#uvPreviewViewport');
const uvPreviewRenderer = new WebGLSceneRenderer(uvPreviewCanvas);
const textureCanvas = $('#textureCanvas');
const textureCtx = textureCanvas.getContext('2d');
const outliner = $('#outliner');
const inspector = $('#inspector');
const projectState = $('#projectState');
const projectTabsNode = $('#projectTabs');
const newProjectDialog = $('#newProjectDialog');
const projectInfoDialog = $('#projectInfoDialog');
const themeDialog = $('#themeDialog');
const languageSelect = $('#languageSelect');
const fileInput = $('#fileInput');
const textureInput = $('#textureInput');
let toastTimer;
let outlinerFrame = null;
let outlinerDragGhost = null;
let dockManager = null;
let cameraFocusFrame = null;
let lockedHoverFrame = null;
let lockedHoverPickFrame = null;
let lockedHoverPointer = null;
let sceneRenderFrame = null;
let transformUpdateFrame = null;
let uvPreviewAnimationFrame = null;
let uvPreviewLastFrame = 0;
let uvPreviewProjectCache = null;
let uvPreviewDrag = null;
let uvPreviewTextureDirty = true;
let projectTabs = [];
let activeProjectTabId = null;
let editingProjectTabId = null;
let draggingProjectTabId = null;
let draggingProjectTabInsertIndex = null;
let selectionExpansionCache = null;

const PROJECT_SESSION_KEYS = Object.freeze([
  'project', 'selectedUid', 'selectedUids', 'selectionAnchorUid', 'selectedCurveNodeIndex', 'filePath', 'dirty', 'history', 'future',
  'knifeSelection', 'knifeHover', 'knifePointer', 'vertexSnapSource', 'zoom', 'panX', 'panY', 'yaw', 'pitch',
  'target', 'collapsedGroups', 'textureAssets', 'textureGroups', 'activeTextureUid', 'timelineFrame'
]);

function projectTabById(tabId) {
  return projectTabs.find(tab => tab.id === tabId) || null;
}

function createProjectSession(project, options = {}) {
  const selectedUid = options.selectedUid ?? project.elements[0]?.uid ?? null;
  const textureAssets = (options.textureAssets || []).map(asset => ({
    ...asset,
    _uid: textureUid(asset),
    groupId: asset.groupId || null
  }));
  const preferredTexture = textureAssets.find(asset => asset.useAsDefault) || textureAssets[0] || null;
  return {
    project,
    selectedUid,
    selectedUids: new Set(selectedUid ? [selectedUid] : []),
    selectionAnchorUid: selectedUid,
    selectedCurveNodeIndex: null,
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
    collapsedGroups: new Set(),
    textureAssets,
    textureGroups: [],
    activeTextureUid: preferredTexture?._uid || null,
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
  const fileName = state.filePath ? state.filePath.split(/[\\/]/).pop() : `${state.project.name}.cbmodel`;
  const label = `${state.dirty ? '● ' : ''}${fileName}`;
  const title = `${state.dirty ? '● ' : ''}${projectTabLabel(projectTabById(activeProjectTabId) || { session: captureProjectSession() })} — CubeBricks`;
  if (projectState.textContent !== label) projectState.textContent = label;
  const color = state.dirty ? 'var(--accent)' : '';
  if (projectState.style.color !== color) projectState.style.color = color;
  if (document.title !== title) document.title = title;
}

function restoreProjectTextureView() {
  renderTextureList();
  if (!state.textureAssets.length) {
    renderTexture();
    return;
  }
  let index = state.textureAssets.findIndex(asset => asset._uid === state.activeTextureUid);
  if (index < 0) index = Math.max(0, state.textureAssets.findIndex(asset => asset.useAsDefault));
  activateProjectTexture(index);
}

function activateProjectTab(tabId, { render = true } = {}) {
  const tab = projectTabById(tabId);
  if (!tab) return false;
  if (tabId !== activeProjectTabId) syncActiveProjectTab();
  activeProjectTabId = tabId;
  for (const key of PROJECT_SESSION_KEYS) state[key] = tab.session[key];
  state.dragging = null;
  state.hitAreas = [];
  state.lockedHoverPoint = null;
  state.lockedHoverStrength = 0;
  if (cameraFocusFrame) cancelAnimationFrame(cameraFocusFrame);
  cameraFocusFrame = null;
  sceneRenderer.invalidateLockState();
  restoreProjectTextureView();
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
  activateProjectTab(tab.id, { render: options.render !== false });
  return tab;
}

function disposeProjectTab(tab) {
  for (const asset of tab.session.textureAssets || []) {
    if (typeof asset.source === 'string' && asset.source.startsWith('blob:')) URL.revokeObjectURL(asset.source);
  }
}

function closeProjectTab(tabId) {
  syncActiveProjectTab();
  const index = projectTabs.findIndex(tab => tab.id === tabId);
  if (index < 0) return;
  const tab = projectTabs[index];
  if (tab.session.dirty && !window.confirm(`「${projectTabLabel(tab)}」尚未保存，仍要關閉嗎？`)) return;
  disposeProjectTab(tab);
  projectTabs.splice(index, 1);
  if (!projectTabs.length) {
    const project = new CubeBricksProject({ name: 'untitled', ...createModelProjectData('java_block_item', { name: 'untitled' }) });
    const replacement = { id: `project_${crypto.randomUUID()}`, displayName: null, session: createProjectSession(project) };
    projectTabs.push(replacement);
    activeProjectTabId = null;
    activateProjectTab(replacement.id);
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
  tab.session.history.push(tab.session.project.serialize());
  if (tab.session.history.length > 60) tab.session.history.shift();
  tab.session.future.length = 0;
  tab.session.project.name = name;
  tab.session.project.textureSize = [width, height];
  tab.session.project.snap = { subdivisions: snap };
  tab.session.project.formatData = {
    ...(tab.session.project.formatData || {}),
    projectDescription: $('#projectInfoDescription').value.trim()
  };
  tab.displayName = null;
  tab.session.dirty = true;
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
  const tab = { id: `project_${crypto.randomUUID()}`, displayName: null, session: captureProjectSession() };
  projectTabs = [tab];
  activeProjectTabId = tab.id;
  renderProjectTabs();
  updateProjectStateLabel();
}

function selected() {
  return state.project.getNode(state.selectedUid);
}

function snapshot() {
  state.history.push(state.project.serialize());
  if (state.history.length > 60) state.history.shift();
  state.future.length = 0;
}

function restore(serialized) {
  const previousSelectedUids = new Set(state.selectedUids);
  const previousSelectedUid = state.selectedUid;
  const previousSelectionAnchorUid = state.selectionAnchorUid;
  state.project = new CubeBricksProject(JSON.parse(serialized));
  state.selectedUids = new Set([...previousSelectedUids].filter(uidValue => state.project.getNode(uidValue)));
  state.selectedUid = previousSelectedUid && state.selectedUids.has(previousSelectedUid)
    ? previousSelectedUid
    : [...state.selectedUids].at(-1) || null;
  state.selectionAnchorUid = previousSelectionAnchorUid && state.project.getNode(previousSelectionAnchorUid)
    ? previousSelectionAnchorUid
    : state.selectedUid;
  const restoredSelection = state.project.getNode(state.selectedUid);
  if (!isBezierElement(restoredSelection) || state.selectedCurveNodeIndex >= restoredSelection.nodes.length) state.selectedCurveNodeIndex = null;
  if (state.vertexSnapSource && !state.project.getNode(state.vertexSnapSource.rootUid)) state.vertexSnapSource = null;
  if (state.knifeSelection && !state.project.getNode(state.knifeSelection.uid)) cancelKnifeSelection(false);
  markDirty(true);
  renderAll();
}

function undo() {
  if (!state.history.length) return toast('沒有可撤銷的操作');
  state.future.push(state.project.serialize());
  restore(state.history.pop());
}

function redo() {
  if (!state.future.length) return toast('沒有可重做的操作');
  state.history.push(state.project.serialize());
  restore(state.future.pop());
}

function markDirty(value = true) {
  const activeTab = projectTabById(activeProjectTabId);
  const previousDirty = activeTab?.session.dirty;
  const previousLabel = activeTab ? projectTabLabel(activeTab) : '';
  state.dirty = value;
  const tab = syncActiveProjectTab();
  if (tab) tab.session.dirty = value;
  updateProjectStateLabel();
  if (!tab || previousDirty !== value || previousLabel !== projectTabLabel(tab)) renderProjectTabs();
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
  updateSelectionLabels();
}

function invalidateAllRenderGeometry() {
  sceneRenderer.invalidateGeometry();
  uvPreviewRenderer.invalidateGeometry();
  if (uvPreviewProjectCache) uvPreviewProjectCache.fit = null;
}

function invalidateSelectionRenderGeometry(geometryChanged = true) {
  sceneRenderer.invalidateSelectionGeometry(geometryChanged);
  if (geometryChanged) {
    uvPreviewRenderer.invalidateGeometry();
    if (uvPreviewProjectCache) uvPreviewProjectCache.fit = null;
  }
}

function updateSelectionLabels() {
  const item = selected();
  const format = modelFormatRegistry.get(state.project.formatId);
  $('#selectionType').textContent = item?.type || format?.name || 'Scene';
  $('#selectionName').textContent = state.selectedUids.size > 1 ? `已選 ${state.selectedUids.size} 項` : item?.name || state.project.name;
  $('#uidChip').textContent = item?.uid || '—';
  const selectedCount = selectedElementUids().length;
  const counter = $('#outlinerSelectionCount');
  if (counter) counter.textContent = `${selectedCount}/${state.project.elements.length}`;
}

function renderOutliner() {
  const filter = $('#outlinerSearch').value.trim().toLowerCase();
  const matches = uidValue => {
    const node = state.project.getNode(uidValue);
    if (!node) return false;
    if (!filter || node.name.toLowerCase().includes(filter) || node.uid.toLowerCase().includes(filter)) return true;
    return node.type === 'group' && node.children.some(matches);
  };
  const rows = [];
  const collectNode = (uidValue, depth = 0) => {
    const node = state.project.getNode(uidValue);
    if (!node || !matches(uidValue)) return;
    const group = node.type === 'group';
    const collapsed = group && state.collapsedGroups.has(node.uid);
    rows.push({ node, depth, group, collapsed });
    if (group && !collapsed) node.children.forEach(child => collectNode(child, depth + 1));
  };
  state.project.outliner.forEach(uidValue => collectNode(uidValue));
  state.outlinerRows = rows;
  state.outlinerWindowStart = -1;
  state.outlinerWindowEnd = -1;
  const scrollTop = outliner.scrollTop;
  outliner.innerHTML = `<div class="outliner-virtual-spacer" style="height:${rows.length * 31}px"></div><div class="outliner-virtual-window"></div>`;
  outliner.scrollTop = scrollTop;
  renderOutlinerWindow();
}

function renderOutlinerWindow() {
  const rows = state.outlinerRows || [];
  const rowHeight = 31;
  const overscan = 6;
  const start = Math.max(0, Math.floor(outliner.scrollTop / rowHeight) - overscan);
  const end = Math.min(rows.length, Math.ceil((outliner.scrollTop + outliner.clientHeight) / rowHeight) + overscan);
  if (start === state.outlinerWindowStart && end === state.outlinerWindowEnd) return;
  state.outlinerWindowStart = start;
  state.outlinerWindowEnd = end;
  const windowNode = $('.outliner-virtual-window', outliner);
  if (!windowNode) return;
  windowNode.style.transform = `translateY(${start * rowHeight}px)`;
  windowNode.innerHTML = rows.slice(start, end).map(({ node, depth, group, collapsed }) => `<button class="outliner-item ${state.outlinerDetailed ? 'has-details' : ''} ${state.selectedUids.has(node.uid) ? 'active' : ''}" data-uid="${node.uid}" draggable="true" style="padding-left:${5 + depth * 13}px">
      ${group ? openIconMarkup(collapsed ? 'right' : 'down', 'outliner-disclosure', `data-disclosure="${node.uid}"`) : '<span></span>'}
      <span class="kind">${outlinerKindMarkup(node)}</span>
      <span class="item-name">${escapeHtml(node.name)}</span>${outlinerStateMarkup(node)}
    </button>`).join('');
}

function stateIconMarkup(id) {
  return `<svg class="outliner-state-icon" aria-hidden="true"><use href="#${id}"></use></svg>`;
}

function nodeAutoUvEnabled(node) {
  if (node.type === 'group') {
    const cubes = state.project.getDescendantElementUids(node.uid)
      .map(uidValue => state.project.getNode(uidValue))
      .filter(child => child?.type === 'cube');
    return cubes.length ? cubes.every(cube => cube.autoUv !== false) : node.autoUv !== false;
  }
  return node.autoUv !== false;
}

function outlinerFlag(node, key, enabled, onIcon, offIcon, onTitle, offTitle, available = true) {
  return `<span class="outliner-flag ${enabled ? '' : 'is-off'} ${available ? '' : 'unavailable'}" role="button"
      data-node-toggle="${key}" data-node-uid="${node.uid}" title="${enabled ? onTitle : offTitle}">
    ${stateIconMarkup(enabled ? onIcon : offIcon)}
  </span>`;
}

function outlinerStateMarkup(node) {
  const visible = outlinerFlag(node, 'visible', node.visible !== false, 'icon-show', 'icon-unshow', '可見', '隱藏');
  if (!state.outlinerDetailed) return visible;
  const autoUvAvailable = ['cube', 'shape', 'bezier2d', 'bezier3d', 'group'].includes(node.type);
  return [
    outlinerFlag(node, 'autoUv', nodeAutoUvEnabled(node), 'icon-uv-update', 'icon-unuv-update', '自動 UV', '不自動更新 UV', autoUvAvailable),
    outlinerFlag(node, 'exported', node.exported !== false, 'icon-save', 'icon-unsave', '參與後續格式轉換', '不參與後續格式轉換'),
    outlinerFlag(node, 'locked', node.locked === true, 'icon-locked', 'icon-unlocked', '鎖定', '解鎖'),
    visible
  ].join('');
}

function outlinerKindMarkup(node) {
  if (node.type === 'node') return '<span class="outliner-curve-kind" aria-hidden="true">●</span>';
  if (node.type === 'bezier2d' || node.type === 'bezier3d') return `<span class="outliner-curve-kind" aria-hidden="true">⌁${node.type === 'bezier2d' ? '²' : '³'}</span>`;
  if (node.type !== 'locator') return `<svg class="outliner-kind-icon object-icon" aria-hidden="true"><use href="#icon-${node.type}"></use></svg>`;
  return `<svg class="outliner-kind-icon" aria-hidden="true" viewBox="0 0 197.49 189.08">${LOCATOR_ICON_SHAPES}</svg>`;
}

function openIconMarkup(direction = 'down', className = '', attributes = '') {
  return `<svg class="open-icon ${className}" data-icon-direction="${direction}" ${attributes} aria-hidden="true"><use href="#icon-open"></use></svg>`;
}

function scheduleOutlinerWindow() {
  if (outlinerFrame !== null) return;
  outlinerFrame = requestAnimationFrame(() => {
    outlinerFrame = null;
    renderOutlinerWindow();
  });
}

function inspectorBatchNodes() {
  const nodes = topLevelSelectedUids().map(uidValue => state.project.getNode(uidValue)).filter(Boolean);
  return nodes.length ? nodes : [selected()].filter(Boolean);
}

function sharedVectorValues(nodes, field, fallback) {
  if (nodes.length <= 1) return [...fallback];
  return [0, 1, 2].map(axis => {
    const first = nodes[0]?.[field]?.[axis];
    if (!Number.isFinite(first) || !nodes.every(node => Number.isFinite(node?.[field]?.[axis]) && Math.abs(node[field][axis] - first) < 1e-9)) return null;
    return first;
  });
}

function sharedNumberValue(nodes, field, fallback) {
  if (nodes.length <= 1) return Number(fallback) || 0;
  const first = nodes[0]?.[field];
  if (!Number.isFinite(first) || !nodes.every(node => Number.isFinite(node?.[field]) && Math.abs(node[field] - first) < 1e-9)) return null;
  return first;
}

function numberInputAttributes(value) {
  return value === null
    ? 'value="" placeholder="-" data-mixed="true"'
    : `value="${round(value)}"`;
}

function isBezierElement(item) {
  return item?.type === 'bezier2d' || item?.type === 'bezier3d';
}

function curveNodeEditorMarkup(item) {
  return `<div class="curve-node-list">${item.nodes.map((node, index) => {
    const displayedRotation = node.autoTangent ? item.resolvedNodeState(index).rotation : node.rotation;
    return `
    <section class="curve-node-card ${state.selectedCurveNodeIndex === index ? 'active' : ''}" data-curve-node-card="${index}">
      <button type="button" class="curve-node-title" data-select-curve-node="${index}">節點 ${index + 1}</button>
      ${vectorField('位置', `curve-node:${index}:position`, node.position)}
      ${vectorField('旋轉', `curve-node:${index}:rotation`, displayedRotation)}
      <div class="option-row"><span>自動切線</span><label class="switch"><input type="checkbox" data-curve-node-auto="${index}" ${node.autoTangent ? 'checked' : ''}/><i></i></label></div>
      ${item.dimension === 3 ? `<div class="option-row"><span>滾動角</span><div class="number-wrap" style="width:68px"><input type="number" step="0.1" data-curve-node-roll="${index}" value="${round(node.roll || 0)}" /></div></div>` : ''}
      <div class="option-row"><span>貝塞爾手柄</span><label class="switch"><input type="checkbox" data-curve-node-toggle="${index}" ${node.handlesEnabled ? 'checked' : ''}/><i></i></label></div>
      ${node.handlesEnabled ? `${vectorField('前手柄', `curve-node:${index}:handleIn`, node.handleIn)}${vectorField('後手柄', `curve-node:${index}:handleOut`, node.handleOut)}` : ''}
      <button type="button" class="curve-node-remove" data-remove-curve-node="${index}" ${item.nodes.length <= 2 ? 'disabled' : ''}>刪除節點</button>
    </section>`;
  }).join('')}</div>`;
}

function renderInspector() {
  const item = selected();
  if (!item) {
    inspector.innerHTML = '<div class="field-section"><p style="color:var(--muted);font-size:.7rem">選擇一個 Cube、Shape、節點、貝塞爾、Locator 或組來編輯。</p></div>';
    return;
  }
  const items = inspectorBatchNodes();
  const rotation = item.rotation || [0, 0, 0];
  const typeLabel = item.type === 'shape' ? '程序化形狀' : item.type === 'locator' ? 'Locator'
    : item.type === 'node' ? '節點' : item.type === 'bezier2d' ? '二維貝塞爾'
      : item.type === 'bezier3d' ? '三維貝塞爾' : item.type === 'group' ? '組' : '立方體';
  const details = item.type === 'cube' ? `
      <div class="field-title"><span>幾何</span><button data-action="resetTransform">重置</button></div>
      ${vectorField('位置', 'position', item.position, items)}
      ${vectorField('尺寸', 'size', item.size, items)}
      ${vectorField('樞軸', 'pivot', item.pivot, items)}
      ${vectorField('旋轉', 'rotation', rotation, items)}
      ${scalarField('膨脹', 'inflate', item.inflate, items)}
      <div class="option-row"><span>UV 模式</span><select data-field="uvMode"><option value="box" ${item.uvMode === 'box' ? 'selected' : ''}>箱型 UV</option><option value="face" ${item.uvMode === 'face' ? 'selected' : ''}>逐面 UV</option></select></div>`
    : item.type === 'shape' ? `
      <div class="field-title"><span>形狀參數</span><span>${item.shapeType}</span></div>
      ${vectorField('位置', 'origin', item.origin, items)}
      ${vectorField('旋轉', 'rotation', rotation, items)}
      ${parameterField('半徑', 'radius', item.parameters.radius, .1, items)}
      ${parameterField('高度', 'height', item.parameters.height, .1, items)}
      ${parameterField('邊數', 'sides', item.parameters.sides, 1, items)}
      ${parameterField('Cube 邊長', 'cubeSize', item.parameters.cubeSize, .0625, items)}
      <div class="option-row"><span>柱體吸附</span><select data-shape-snap-mode><option value="cube" ${item.parameters.snapMode === 'cube' ? 'selected' : ''}>按內含 Cube 邊長</option><option value="bounds" ${item.parameters.snapMode === 'bounds' ? 'selected' : ''}>按整體邊長</option></select></div>
      <div class="option-row"><span>生成 Cube</span><strong style="color:var(--accent)">${item.toCubes().length} 個</strong></div>`
    : item.type === 'locator' ? `
      <div class="field-title"><span>Locator 變換</span><button data-action="resetTransform">重置</button></div>
      ${vectorField('位置', 'position', item.position, items)}
      ${vectorField('旋轉', 'rotation', rotation, items)}`
    : item.type === 'node' ? `
      <div class="field-title"><span>節點</span><span>只可移動／旋轉</span></div>
      ${vectorField('位置', 'position', item.position, items)}
      ${vectorField('旋轉', 'rotation', rotation, items)}
      <div class="option-row"><span>貝塞爾手柄</span><label class="switch"><input type="checkbox" data-field="handlesEnabled" ${item.handlesEnabled ? 'checked' : ''}/><i></i></label></div>
      ${item.handlesEnabled ? `${vectorField('前手柄', 'handleIn', item.handleIn, items)}${vectorField('後手柄', 'handleOut', item.handleOut, items)}` : ''}`
    : isBezierElement(item) ? `
      <div class="field-title"><span>${item.dimension === 2 ? '二維' : '三維'}貝塞爾</span><span>${item.nodes.length} 節點</span></div>
      ${vectorField('位置', 'origin', item.origin, items)}
      ${vectorField('旋轉', 'rotation', rotation, items)}
      ${parameterField('Cube 柱粗細', 'thickness', item.parameters.thickness, .1, items)}
      <div class="option-row"><span>分段方式</span><select data-curve-segmentation><option value="distance" ${item.parameters.segmentationMode === 'distance' ? 'selected' : ''}>按距離</option><option value="angle" ${item.parameters.segmentationMode === 'angle' ? 'selected' : ''}>按角度</option></select></div>
      ${item.parameters.segmentationMode === 'angle'
        ? parameterField('角度步長', 'angleStep', item.parameters.angleStep, .1, items)
        : parameterField('距離步長', 'segmentLength', item.parameters.segmentLength, .1, items)}
      <div class="option-row"><span>生成 Cube</span><strong style="color:var(--accent)">${item.toCubes().length} 個</strong></div>
      ${curveNodeEditorMarkup(item)}`
    : `
      <div class="field-title"><span>組屬性</span></div>
      ${vectorField('樞軸', 'pivot', item.pivot, items)}
      ${scalarField('膨脹', 'inflate', item.inflate, items)}
      <div class="option-row"><span>直接子項</span><strong style="color:var(--accent)">${item.children.length}</strong></div>`;
  inspector.innerHTML = `
    <div class="field-section">
      <div class="field-title"><span>基本</span><span>${items.length > 1 ? `多選 ${items.length}` : typeLabel}</span></div>
      <input class="name-field" data-field="name" value="${escapeAttribute(item.name)}" aria-label="名稱" />
      <div class="option-row"><span>可見</span><label class="switch"><input type="checkbox" data-field="visible" ${item.visible ? 'checked' : ''}/><i></i></label></div>
    </div>
    <div class="field-section">
      ${details}
    </div>
    ${item.type === 'cube' || item.type === 'shape' || isBezierElement(item) || item.type === 'group' ? `
    <div class="field-section">
      <div class="field-title"><span>外觀</span><span>預覽色</span></div>
      ${item.color ? `<div class="option-row"><span>材質色</span><input type="color" data-field="color" value="${item.color}" /></div>` : ''}
      <div class="option-row"><span>面陰影</span><label class="switch"><input type="checkbox" data-field="shade" ${item.shade !== false ? 'checked' : ''}/><i></i></label></div>
    </div>` : ''}
    <div class="field-section"><button class="danger-button" data-action="deleteSelected">${items.length > 1 ? '刪除選中項' : `刪除${item.type === 'group' ? '組及其內容' : '物件'}`}</button></div>`;
  bindInspector();
}

function vectorField(label, field, values, nodes = [selected()]) {
  const displayed = sharedVectorValues(nodes, field, values);
  return `<div class="vector-field"><span>${label}</span>${displayed.map((value, index) => `<label class="number-wrap"><b>${'XYZ'[index]}</b><input type="number" step="0.0001" data-vector="${field}" data-axis="${index}" ${numberInputAttributes(value)} /></label>`).join('')}</div>`;
}

function scalarField(label, field, value, nodes = [selected()]) {
  const displayed = sharedNumberValue(nodes, field, value);
  return `<div class="vector-field scalar-field"><span>${label}</span><label class="number-wrap"><input type="number" step="0.1" data-field="${field}" ${numberInputAttributes(displayed)} /></label></div>`;
}

function parameterField(label, key, value, step, nodes = [selected()]) {
  const displayed = nodes.length <= 1 ? value : (() => {
    const first = nodes[0]?.parameters?.[key];
    return Number.isFinite(first) && nodes.every(node => Number.isFinite(node?.parameters?.[key]) && Math.abs(node.parameters[key] - first) < 1e-9) ? first : null;
  })();
  const minimum = key === 'sides' ? 3 : key === 'cubeSize' || key === 'segmentLength' ? .0625 : .1;
  return `<div class="option-row"><span>${label}</span><div class="number-wrap" style="width:68px"><input type="number" min="${minimum}" step="${step}" data-parameter="${key}" ${numberInputAttributes(displayed)} /></div></div>`;
}

function setNodeVisibility(node, visible, cascadeGroup = true) {
  if (!node) return;
  node.visible = visible;
  if (node.type !== 'group' || !cascadeGroup) return;
  for (const childUid of node.children) setNodeVisibility(state.project.getNode(childUid), visible, true);
}

function setNodeAutoUv(node, enabled) {
  if (!node) return;
  node.autoUv = enabled;
  if (node.type === 'cube') {
    if (enabled) {
      for (const face of Object.values(node.faces || {})) delete face.uv;
    } else freezeCubeUvs(node);
    return;
  }
  if (node.type === 'group') {
    for (const uidValue of state.project.getDescendantElementUids(node.uid)) {
      const child = state.project.getNode(uidValue);
      if (child?.type === 'cube') setNodeAutoUv(child, enabled);
      else if (child && ['shape', 'bezier2d', 'bezier3d'].includes(child.type)) child.autoUv = enabled;
    }
  }
}

function setNodeFlag(node, key, value) {
  if (!node) return;
  if (key === 'visible') return setNodeVisibility(node, value);
  if (key === 'autoUv') return setNodeAutoUv(node, value);
  if (key === 'shade' && node.type === 'locator') return;
  node[key] = value;
  if (node.type === 'group') {
    for (const childUid of node.children) setNodeFlag(state.project.getNode(childUid), key, value);
  }
}

function bindInspector() {
  const item = selected();
  if (!item) return;
  const items = inspectorBatchNodes();
  $$('[data-field]', inspector).forEach(input => {
    input.addEventListener('change', () => {
      const key = input.dataset.field;
      if (input.type === 'number' && input.value === '') return;
      snapshot();
      const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
      const targets = key === 'name' ? [item]
        : key === 'shade' ? items.filter(node => ['cube', 'shape', 'bezier2d', 'bezier3d', 'group'].includes(node.type))
        : key === 'inflate' ? items.filter(node => ['cube', 'group'].includes(node.type))
        : key === 'uvMode' ? items.filter(node => node.type === 'cube')
        : key === 'color' ? items.filter(node => typeof node.color === 'string')
        : items.filter(node => key in node);
      for (const target of targets) {
        if (['visible', 'shade', 'autoUv', 'exported', 'locked'].includes(key)) setNodeFlag(target, key, value);
        else target[key] = value;
      }
      if (key === 'locked') sceneRenderer.invalidateLockState();
      markDirty();
      renderAll('selection');
    });
  });
  $$('[data-vector]', inspector).forEach(input => {
    let snapshotTaken = false;
    const apply = () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      if (!snapshotTaken) { snapshot(); snapshotTaken = true; }
      delete input.dataset.mixed;
      const field = input.dataset.vector;
      const axis = Number(input.dataset.axis);
      if (field.startsWith('curve-node:') && isBezierElement(item)) {
        const [, indexText, property] = field.split(':');
        const node = item.nodes[Number(indexText)];
        if (!node || !Array.isArray(node[property])) return;
        if (property === 'rotation' && node.autoTangent) bakeCurveNodeTangent(item, Number(indexText));
        const planarVector = property === 'position' || property === 'handleIn' || property === 'handleOut';
        const lockedPlanarAxis = item.dimension === 2
          && ((planarVector && axis === 1) || (property === 'rotation' && axis !== 1));
        node[property][axis] = lockedPlanarAxis ? 0 : value;
        if (item.dimension === 2 && planarVector) node[property][1] = 0;
        if (item.dimension === 2 && property === 'rotation') {
          node.rotation[0] = 0;
          node.rotation[2] = 0;
        }
        if (property === 'rotation') node.autoTangent = false;
        if (lockedPlanarAxis) input.value = '0';
        markDirty(); invalidateSelectionRenderGeometry(); renderScene();
        return;
      }
      for (const target of items.filter(node => Array.isArray(node[field]))) {
        const nextValue = target.type === 'cube' && field === 'size' && !state.allowNegativeSize
          ? Math.max(0, value)
          : value;
        if (target.type === 'cube' && field === 'position') {
          const delta = nextValue - target.position[axis];
          target.position[axis] = nextValue;
          target.pivot[axis] += delta;
        } else if (field === 'pivot' && ['cube', 'group'].includes(target.type)) {
          const nextPivot = [...target.pivot];
          nextPivot[axis] = nextValue;
          setPivotPreservingGeometry(state.project, target, nextPivot);
        } else target[field][axis] = nextValue;
      }
      const displayedValue = item.type === 'cube' && field === 'size' && !state.allowNegativeSize ? Math.max(0, value) : value;
      if (displayedValue !== value) input.value = String(displayedValue);
      markDirty(); invalidateSelectionRenderGeometry(); syncInspectorValues(); renderScene();
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
    input.addEventListener('blur', () => { snapshotTaken = false; });
  });
  $$('[data-parameter]', inspector).forEach(input => {
    let snapshotTaken = false;
    const apply = () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      if (!snapshotTaken) { snapshot(); snapshotTaken = true; }
      delete input.dataset.mixed;
      const key = input.dataset.parameter;
      const nextValue = key === 'sides' ? Math.max(3, Math.round(value))
        : Math.max(key === 'cubeSize' || key === 'segmentLength' ? .0625 : .1, value);
      for (const target of items.filter(node => node.parameters && key in node.parameters)) {
        target.parameters[key] = nextValue;
      }
      markDirty(); invalidateSelectionRenderGeometry(); syncInspectorValues(); renderScene();
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
    input.addEventListener('blur', () => { snapshotTaken = false; });
  });
  $('[data-shape-snap-mode]', inspector)?.addEventListener('change', event => {
    snapshot();
    for (const target of items.filter(node => node.type === 'shape')) target.parameters.snapMode = event.target.value;
    markDirty(); renderAll('selection');
  });
  $('[data-curve-segmentation]', inspector)?.addEventListener('change', event => {
    snapshot();
    for (const target of items.filter(isBezierElement)) target.parameters.segmentationMode = event.target.value;
    markDirty(); renderAll('selection');
  });
  $$('[data-select-curve-node]', inspector).forEach(button => button.addEventListener('click', () => {
    state.selectedCurveNodeIndex = Number(button.dataset.selectCurveNode);
    renderInspector(); renderScene();
  }));
  $$('[data-curve-node-toggle]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
    const node = item.nodes?.[Number(toggle.dataset.curveNodeToggle)];
    if (!node) return;
    snapshot(); node.handlesEnabled = toggle.checked; markDirty(); renderAll('selection');
  }));
  $$('[data-curve-node-auto]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
    const index = Number(toggle.dataset.curveNodeAuto);
    const node = item.nodes?.[index];
    if (!node) return;
    snapshot();
    if (!toggle.checked && node.autoTangent) bakeCurveNodeTangent(item, index);
    else node.autoTangent = toggle.checked;
    markDirty(); renderAll('selection');
  }));
  $$('[data-curve-node-roll]', inspector).forEach(input => {
    let snapshotTaken = false;
    const apply = () => {
      const node = item.nodes?.[Number(input.dataset.curveNodeRoll)];
      const value = Number(input.value);
      if (!node || !Number.isFinite(value) || item.dimension !== 3) return;
      if (!snapshotTaken) { snapshot(); snapshotTaken = true; }
      node.roll = value;
      markDirty(); invalidateSelectionRenderGeometry(); renderScene();
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
    input.addEventListener('blur', () => { snapshotTaken = false; });
  });
  $$('[data-remove-curve-node]', inspector).forEach(button => button.addEventListener('click', () => {
    if (!isBezierElement(item) || item.nodes.length <= 2) return;
    snapshot();
    item.nodes.splice(Number(button.dataset.removeCurveNode), 1);
    state.selectedCurveNodeIndex = Math.min(item.nodes.length - 1, state.selectedCurveNodeIndex ?? 0);
    markDirty(); renderAll('selection');
  }));
  $('[data-action="deleteSelected"]', inspector)?.addEventListener('click', deleteSelected);
  $('[data-action="resetTransform"]', inspector)?.addEventListener('click', () => {
    snapshot();
    for (const target of items) {
      if (target.type !== 'group' && Array.isArray(target.rotation)) target.rotation = [0, 0, 0];
    }
    markDirty(); renderAll('selection');
  });
}

function revealOutlinerItem(uid) {
  let hierarchyChanged = false;
  for (const group of state.project.getGroupChain(uid)) {
    if (!state.collapsedGroups.delete(group.uid)) continue;
    hierarchyChanged = true;
  }
  if (hierarchyChanged) renderOutliner();
  const index = (state.outlinerRows || []).findIndex(row => row.node.uid === uid);
  if (index < 0) return;
  const rowHeight = 31;
  const rowTop = index * rowHeight;
  const rowBottom = rowTop + rowHeight;
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
  state.outlinerWindowStart = -1;
  state.outlinerWindowEnd = -1;
  renderOutlinerWindow();
  sceneRenderer.invalidateSelectionGeometry(false);
  updateToolOptions();
  renderInspector();
  renderScene();
  updateSelectionLabels();
}

function clearSelection() {
  if (!state.selectedUids.size && !state.selectedUid) return;
  sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
  state.selectedUids = new Set();
  state.selectedUid = null;
  state.selectionAnchorUid = null;
  state.selectedCurveNodeIndex = null;
  state.vertexSnapSource = null;
  if (state.tool === 'knife') cancelKnifeSelection(false);
  refreshSelectionUi();
}

function selectItem(uid, { revealInOutliner = false, toggle = false, range = false } = {}) {
  if (!state.project.getNode(uid)) return;
  const previousSelectedUid = state.selectedUid;
  sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
  if (range && state.selectionAnchorUid) {
    const rows = state.outlinerRows || [];
    const start = rows.findIndex(row => row.node.uid === state.selectionAnchorUid);
    const end = rows.findIndex(row => row.node.uid === uid);
    if (start >= 0 && end >= 0) {
      const extended = new Set(state.selectedUids);
      rows.slice(Math.min(start, end), Math.max(start, end) + 1).forEach(row => extended.add(row.node.uid));
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
  if (state.selectedUid !== previousSelectedUid) state.selectedCurveNodeIndex = null;
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

function nodeContainer(uidValue) {
  const parent = state.project.getParentGroup(uidValue);
  return { parent, items: parent ? parent.children : state.project.outliner };
}

function insertNewNodeUid(uidValue) {
  const selectedIds = selectedNodeUids();
  const reference = state.project.getNode(state.selectedUid);
  if (!reference) {
    state.project.outliner.push(uidValue);
    state.project.invalidateHierarchyIndex();
    return;
  }
  // A single selected group is an insertion target. In a multi-selection it is
  // treated like any other row, so creation follows the last selected row.
  if (selectedIds.length === 1 && reference.type === 'group') {
    reference.children.push(uidValue);
    state.collapsedGroups.delete(reference.uid);
    state.project.invalidateHierarchyIndex();
    return;
  }
  const { items } = nodeContainer(reference.uid);
  const index = items.indexOf(reference.uid);
  items.splice(index < 0 ? items.length : index + 1, 0, uidValue);
  state.project.invalidateHierarchyIndex();
}

function selectCreatedNode(uidValue) {
  state.selectedUid = uidValue;
  state.selectedUids = new Set([uidValue]);
  state.selectionAnchorUid = uidValue;
  state.selectedCurveNodeIndex = null;
}

function addCube() {
  snapshot();
  const count = state.project.elements.filter(item => item.type === 'cube').length + 1;
  const cube = new Cube({ name: `cube_${count}`, position: [-3, 1, -3], size: [6, 6, 6], pivot: [0, 4, 0], color: '#a7d352' });
  state.project.elements.push(cube);
  insertNewNodeUid(cube.uid);
  selectCreatedNode(cube.uid);
  markDirty(); renderAll(); toast('已新增 Cube');
}

function addShape() {
  snapshot();
  const shape = new Shape({ name: 'cylinder_shape', origin: [0, 2, 0] });
  state.project.elements.push(shape);
  insertNewNodeUid(shape.uid);
  selectCreatedNode(shape.uid);
  markDirty(); renderAll(); toast('已新增程序化 Shape');
}

function addLocator() {
  snapshot();
  const count = state.project.elements.filter(item => item.type === 'locator').length + 1;
  const locator = new Locator({ name: `locator_${count}`, position: [0, 4, 0] });
  state.project.elements.push(locator);
  insertNewNodeUid(locator.uid);
  selectCreatedNode(locator.uid);
  markDirty(); renderAll(); toast('已新增 Locator');
}

function addNodeElement() {
  snapshot();
  const count = state.project.elements.filter(item => item.type === 'node').length + 1;
  const node = new NodeElement({ name: `node_${count}`, position: [0, 4, 0] });
  state.project.elements.push(node);
  insertNewNodeUid(node.uid);
  selectCreatedNode(node.uid);
  markDirty(); renderAll(); toast('已新增節點');
}

function addBezierElement(dimension) {
  snapshot();
  const type = dimension === 2 ? 'bezier2d' : 'bezier3d';
  const count = state.project.elements.filter(item => item.type === type).length + 1;
  const curve = new BezierElement({ name: `${type}_${count}`, origin: [0, 4, 0] }, dimension);
  state.project.elements.push(curve);
  insertNewNodeUid(curve.uid);
  selectCreatedNode(curve.uid);
  state.selectedCurveNodeIndex = 0;
  markDirty(); renderAll(); toast(`已新增${dimension === 2 ? '二維' : '三維'}貝塞爾元素`);
}

function addGroup() {
  const previousRowPositions = captureOutlinerRowPositions();
  snapshot();
  const group = new Group({ name: `group_${state.project.groups.length + 1}`, children: [] });
  const hadMultipleSelection = selectedNodeUids().length > 1;
  const selectedIds = topLevelSelectedUids();
  state.project.groups.push(group);
  state.project.invalidateHierarchyIndex();
  if (hadMultipleSelection && selectedIds.length) {
    const sourceContainers = selectedIds.map(uidValue => nodeContainer(uidValue));
    const sharedContainer = sourceContainers.every(container => container.items === sourceContainers[0].items)
      ? sourceContainers[0]
      : null;
    // When every selected row is already in the same directory, keep the new
    // group exactly where those rows lived. This makes grouping an in-place
    // wrap instead of unexpectedly sending the selection to the directory end.
    const sharedInsertionIndex = sharedContainer
      ? Math.min(...selectedIds.map(uidValue => sharedContainer.items.indexOf(uidValue)).filter(index => index >= 0))
      : -1;
    const chains = selectedIds.map(uidValue => state.project.getGroupChain(uidValue));
    let commonParent = null;
    const shortest = Math.min(...chains.map(chain => chain.length));
    for (let index = 0; index < shortest; index++) {
      const candidate = chains[0][index];
      if (chains.every(chain => chain[index]?.uid === candidate.uid)) commonParent = candidate;
      else break;
    }
    const order = new Map((state.outlinerRows || []).map((row, index) => [row.node.uid, index]));
    selectedIds.sort((left, right) => (order.get(left) ?? Infinity) - (order.get(right) ?? Infinity));
    for (const uidValue of selectedIds) {
      const { items } = nodeContainer(uidValue);
      const index = items.indexOf(uidValue);
      if (index >= 0) items.splice(index, 1);
    }
    group.children.push(...selectedIds);
    if (sharedContainer && sharedInsertionIndex >= 0) {
      sharedContainer.items.splice(sharedInsertionIndex, 0, group.uid);
    } else {
      (commonParent ? commonParent.children : state.project.outliner).push(group.uid);
    }
    state.collapsedGroups.delete(group.uid);
  } else {
    insertNewNodeUid(group.uid);
  }
  state.project.invalidateHierarchyIndex();
  selectCreatedNode(group.uid);
  markDirty(); renderAll(); animateOutlinerReorder(previousRowPositions); toast('已新增組');
}

function deleteSelected() {
  const selectedIds = topLevelSelectedUids();
  if (!selectedIds.length) return;
  snapshot();
  selectedIds.forEach(uidValue => state.project.removeNode(uidValue));
  state.selectedUid = null;
  state.selectedUids = new Set();
  state.selectionAnchorUid = null;
  state.selectedCurveNodeIndex = null;
  markDirty(); renderAll(); toast(selectedIds.length > 1 ? `已刪除 ${selectedIds.length} 項` : '物件已刪除');
}

function clearOutlinerDropState({ keepDragging = false } = {}) {
  outliner.querySelectorAll('.drop-before, .drop-after, .drop-inside').forEach(item =>
    item.classList.remove('drop-before', 'drop-after', 'drop-inside'));
  if (!keepDragging) outliner.querySelectorAll('.is-dragging').forEach(item => item.classList.remove('is-dragging'));
}

function captureOutlinerRowPositions() {
  return new Map($$('.outliner-item[data-uid]', outliner).map(item => [item.dataset.uid, item.getBoundingClientRect().top]));
}

function animateOutlinerReorder(previousPositions) {
  requestAnimationFrame(() => {
    $$('.outliner-item[data-uid]', outliner).forEach(item => {
      const previousTop = previousPositions.get(item.dataset.uid);
      if (previousTop === undefined) return;
      const delta = previousTop - item.getBoundingClientRect().top;
      if (Math.abs(delta) < 1) return;
      item.animate([
        { transform: `translateY(${delta}px)` },
        { transform: 'translateY(0)' }
      ], { duration: 170, easing: 'cubic-bezier(.2,.75,.25,1)' });
    });
  });
}

function removeOutlinerDragGhost() {
  outlinerDragGhost?.remove();
  outlinerDragGhost = null;
}

function createOutlinerDragGhost(uids) {
  removeOutlinerDragGhost();
  const nodes = uids.map(uidValue => state.project.getNode(uidValue)).filter(Boolean);
  const shown = nodes.slice(0, 4);
  const ghost = document.createElement('div');
  ghost.className = 'outliner-drag-ghost';
  ghost.style.width = `${Math.max(150, Math.min(280, outliner.clientWidth - 14))}px`;
  ghost.innerHTML = shown.map(node => `<div class="outliner-drag-ghost-row ${node.type === 'group' ? 'group' : ''}">
      <span class="kind">${outlinerKindMarkup(node)}</span>
      <span class="item-name">${escapeHtml(node.name)}</span>
    </div>`).join('')
    + (nodes.length > shown.length ? `<div class="outliner-drag-ghost-more">＋${nodes.length - shown.length}</div>` : '')
    + (nodes.length > 1 ? `<div class="outliner-drag-ghost-count">${nodes.length}</div>` : '');
  document.body.append(ghost);
  outlinerDragGhost = ghost;
  return ghost;
}

function moveSelectedNodes(targetUid = null, zone = 'after') {
  const moving = topLevelSelectedUids();
  if (!moving.length) return;
  const movingSet = new Set(moving);
  const target = targetUid && state.project.getNode(targetUid);
  if (target && movingSet.has(target.uid)) return;
  let destinationParent = null;
  let destination;
  let insertionIndex;
  if (target?.type === 'group' && zone === 'inside') {
    destinationParent = target;
    destination = target.children;
    insertionIndex = destination.length;
  } else if (target) {
    const container = nodeContainer(target.uid);
    destinationParent = container.parent;
    destination = container.items;
    const targetIndex = destination.indexOf(target.uid);
    insertionIndex = targetIndex + (zone === 'after' ? 1 : 0);
  } else {
    destination = state.project.outliner;
    insertionIndex = destination.length;
  }
  // A group can never be reparented into itself or one of its descendants.
  if (destinationParent && moving.some(uidValue => {
    const node = state.project.getNode(uidValue);
    return node?.type === 'group' && (destinationParent.uid === uidValue
      || state.project.getGroupChain(destinationParent.uid).some(group => group.uid === uidValue));
  })) return toast('不能把組拖進它自己的子級');

  const previousRowPositions = captureOutlinerRowPositions();
  snapshot();
  const order = new Map((state.outlinerRows || []).map((row, index) => [row.node.uid, index]));
  moving.sort((left, right) => (order.get(left) ?? Infinity) - (order.get(right) ?? Infinity));
  for (const uidValue of moving) {
    const container = nodeContainer(uidValue).items;
    const index = container.indexOf(uidValue);
    if (container === destination && index >= 0 && index < insertionIndex) insertionIndex--;
    if (index >= 0) container.splice(index, 1);
  }
  destination.splice(Math.max(0, insertionIndex), 0, ...moving);
  state.project.invalidateHierarchyIndex();
  if (destinationParent) state.collapsedGroups.delete(destinationParent.uid);
  markDirty();
  renderAll();
  animateOutlinerReorder(previousRowPositions);
}

function uvPreviewIsActive() {
  const panel = dockManager?.get('uvPreview');
  if (document.hidden || !state.uvPreviewEnabled || !panel || panel.element.hidden || panel.state.collapsed || state.layoutResizing) return false;
  if (panel.state.dock !== 'floating' && dockManager.zoneState?.[panel.state.dock]) return false;
  const rect = uvPreviewViewport.getBoundingClientRect();
  return rect.width >= 2 && rect.height >= 2;
}

function uvPreviewElements() {
  return selectedElementUids()
    .map(uidValue => state.project.getNode(uidValue))
    .filter(element => element && (element.type === 'cube' || element.type === 'shape' || isBezierElement(element)));
}

function getUvPreviewProject() {
  const sourceElements = uvPreviewElements();
  const key = sourceElements.map(element => element.uid).sort().join('|');
  if (uvPreviewProjectCache?.source === state.project
    && uvPreviewProjectCache.key === key
    && uvPreviewProjectCache.hierarchyRevision === state.project.hierarchyRevision) return uvPreviewProjectCache;

  // Visibility and locking are editor concerns. This isolated preview always
  // shows the selected geometry while inheriting its real transform and UVs.
  const elements = sourceElements.map(element => Object.assign(Object.create(element), {
    visible: true,
    locked: false
  }));
  const groups = state.project.groups.map(group => Object.assign(Object.create(group), { locked: false }));
  const project = {
    elements,
    groups,
    outliner: elements.map(element => element.uid),
    textureSize: state.project.textureSize,
    renderType: state.uvPreviewFaceColors ? 'solid' : state.project.renderType,
    cullFaces: state.project.cullFaces,
    getNode: uidValue => state.project.getNode(uidValue),
    getGroupChain: uidValue => state.project.getGroupChain(uidValue),
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
  const bounds = sceneRenderer.getSelectionBounds(state.project, state.selectedUids);
  let center = bounds?.center;
  let span = bounds ? bounds.max.map((value, axis) => Math.abs(value - bounds.min[axis])) : null;
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

function setUvPreviewPlaceholder(message, visible) {
  const empty = $('#uvPreviewEmpty');
  empty.textContent = message;
  empty.hidden = !visible;
  uvPreviewCanvas.hidden = visible;
  $('[data-panel="uvPreview"]')?.classList.toggle('preview-disabled', !state.uvPreviewEnabled);
}

function renderUvPreview() {
  if (!state.uvPreviewEnabled) {
    setUvPreviewPlaceholder('預覽已關閉', true);
    return false;
  }
  if (!uvPreviewIsActive()) {
    return false;
  }
  const cache = getUvPreviewProject();
  if (!cache.elements.length) {
    setUvPreviewPlaceholder('選擇 Cube、Shape 或貝塞爾', true);
    return false;
  }
  setUvPreviewPlaceholder('', false);
  if (uvPreviewTextureDirty) {
    uvPreviewRenderer.setTexture(textureCanvas);
    uvPreviewTextureDirty = false;
  }
  cache.project.textureSize = state.project.textureSize;
  cache.project.renderType = state.uvPreviewFaceColors ? 'solid' : state.project.renderType;
  cache.project.cullFaces = state.project.cullFaces;
  const fit = uvPreviewFit(cache);
  uvPreviewRenderer.render(cache.project, null, {
    projection: 'perspective',
    zoom: fit.zoom,
    panX: 0,
    panY: 0,
    yaw: state.uvPreviewYaw,
    pitch: state.uvPreviewPitch,
    target: fit.target,
    selectedUids: new Set(),
    renderMode: state.uvPreviewFaceColors ? 'solid' : 'textured',
    previewShade: true,
    grid: false,
    wire: false,
    geometryOnly: true,
    snap: state.settingsSnap,
    faceDistinct: state.uvPreviewFaceColors,
    lockedDefaultAlpha: 100,
    lockedHoverFade: false,
    editorOverlayLines: []
  });
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

function refreshUvPreview() {
  renderUvPreview();
  scheduleUvPreviewAnimation();
}

function renderScene() {
  if (sceneRenderFrame !== null) cancelAnimationFrame(sceneRenderFrame);
  sceneRenderFrame = null;
  sceneRenderer.render(state.project, state.selectedUid, { ...state, editorOverlayLines: buildKnifeOverlayLines() });
  updateLocatorOverlay();
  updateTransformGizmo();
  updateAxisWidget();
  refreshUvPreview();
}

function scheduleSceneRender() {
  if (sceneRenderFrame !== null) return;
  sceneRenderFrame = requestAnimationFrame(() => {
    sceneRenderFrame = null;
    renderScene();
  });
}

function renderLockedHoverFrame() {
  sceneRenderer.redrawLockedOverlay({ ...state, editorOverlayLines: buildKnifeOverlayLines() });
  updateLocatorHoverOpacity();
}

function updateLocatorOverlay() {
  const overlay = $('#locatorOverlay');
  const selectedElements = getSelectionExpansion().elementSet;
  const rect = sceneCanvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (state.geometryOnly) {
    overlay.innerHTML = '';
    overlay.setAttribute('hidden', '');
    return;
  }
  const icons = state.project.elements
    .filter(element => element.type === 'locator' && element.visible !== false)
    .flatMap(element => {
      let world = getTransformPivot(element);
      if (selectedElements.has(element.uid)) world = sceneRenderer.transformSelectionPreviewPoint(world);
      if (!world) return [];
      const point = sceneRenderer.projectPoint(world);
      if (!point || point.behind || point.depth < -1 || point.depth > 1
        || point.x < -9 || point.y < -9 || point.x > width + 9 || point.y > height + 9) return [];
      return [{ element, point, size: sceneRenderer.getLocatorScreenSize(world), opacity: lockedObjectOpacity(element.uid, point) }];
    })
    .sort((left, right) => right.point.depth - left.point.depth);
  overlay.innerHTML = icons.map(({ element, point, size, opacity }) => `<svg class="locator-screen-icon ${selectedElements.has(element.uid) ? 'selected' : ''}"
      data-locator-uid="${element.uid}" x="${point.x - size / 2}" y="${point.y - size / 2}" width="${size}" height="${size}"
      opacity="${opacity}" viewBox="0 0 197.49 189.08" preserveAspectRatio="xMidYMid meet" aria-label="${escapeHtml(element.name)}">${LOCATOR_ICON_SHAPES}</svg>`).join('');
  overlay.toggleAttribute('hidden', icons.length === 0);
}

function isEffectivelyLocked(uidValue) {
  return sceneRenderer.isLocked(uidValue);
}

function lockedObjectOpacity(uidValue, screenPoint) {
  if (!isEffectivelyLocked(uidValue)) return 1;
  const base = state.lockedDefaultAlpha / 100;
  const hover = state.lockedHoverAlpha / 100;
  if (!state.lockedHoverFade || !state.lockedHoverPoint || !screenPoint || state.lockedHoverStrength <= 0) return base;
  const distance = Math.hypot(screenPoint.x - state.lockedHoverPoint[0], screenPoint.y - state.lockedHoverPoint[1]);
  const ratio = Math.min(1, distance / Math.max(1, state.lockedHoverRadius));
  const smooth = ratio * ratio * (3 - 2 * ratio);
  const radialOpacity = hover + (base - hover) * smooth;
  return base + (radialOpacity - base) * state.lockedHoverStrength;
}

function updateLocatorHoverOpacity() {
  $$('#locatorOverlay [data-locator-uid]').forEach(icon => {
    const width = Number(icon.getAttribute('width')) || 0;
    const height = Number(icon.getAttribute('height')) || 0;
    const point = {
      x: (Number(icon.getAttribute('x')) || 0) + width / 2,
      y: (Number(icon.getAttribute('y')) || 0) + height / 2
    };
    icon.setAttribute('opacity', lockedObjectOpacity(icon.dataset.locatorUid, point));
  });
}

function animateLockedHoverStrength(target) {
  target = target ? 1 : 0;
  if (Math.abs(state.lockedHoverStrength - target) < .001) {
    state.lockedHoverStrength = target;
    if (!target) state.lockedHoverPoint = null;
    return;
  }
  if (lockedHoverFrame !== null) cancelAnimationFrame(lockedHoverFrame);
  const from = state.lockedHoverStrength;
  const start = performance.now();
  const tick = now => {
    const progress = Math.min(1, (now - start) / 200);
    const eased = progress * progress * (3 - 2 * progress);
    state.lockedHoverStrength = from + (target - from) * eased;
    renderLockedHoverFrame();
    if (progress < 1) lockedHoverFrame = requestAnimationFrame(tick);
    else {
      lockedHoverFrame = null;
      state.lockedHoverStrength = target;
      if (!target) state.lockedHoverPoint = null;
    }
  };
  lockedHoverFrame = requestAnimationFrame(tick);
}

function updateLockedHover(event) {
  if (!state.lockedHoverFade || !sceneRenderer.hasLockedObjects()) {
    animateLockedHoverStrength(false);
    return;
  }
  const rect = sceneCanvas.getBoundingClientRect();
  state.lockedHoverPoint = [event.clientX - rect.left, event.clientY - rect.top];
  if (state.lockedHoverStrength < .999) animateLockedHoverStrength(true);
  else renderLockedHoverFrame();
}

function scheduleLockedHover(event) {
  if (!state.lockedHoverFade || !sceneRenderer.hasLockedObjects()) {
    lockedHoverPointer = null;
    if (state.lockedHoverStrength > 0) animateLockedHoverStrength(false);
    return;
  }
  lockedHoverPointer = { clientX: event.clientX, clientY: event.clientY };
  if (lockedHoverPickFrame !== null) return;
  lockedHoverPickFrame = requestAnimationFrame(() => {
    lockedHoverPickFrame = null;
    if (lockedHoverPointer) updateLockedHover(lockedHoverPointer);
  });
}

function bakeCameraPan() {
  const frame = sceneRenderer.getCameraFrame();
  if (frame?.target) state.target = [...frame.target];
  state.panX = 0;
  state.panY = 0;
}

function cancelCameraFocus() {
  if (cameraFocusFrame !== null) cancelAnimationFrame(cameraFocusFrame);
  cameraFocusFrame = null;
}

function animateCameraFocus(target, duration = 250) {
  cancelCameraFocus();
  bakeCameraPan();
  const from = [...state.target];
  const to = [...target];
  const startedAt = performance.now();
  const tick = now => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = progress < .5
      ? 4 * progress ** 3
      : 1 - (-2 * progress + 2) ** 3 / 2;
    state.target = from.map((value, axis) => value + (to[axis] - value) * eased);
    renderScene();
    if (progress < 1) cameraFocusFrame = requestAnimationFrame(tick);
    else cameraFocusFrame = null;
  };
  cameraFocusFrame = requestAnimationFrame(tick);
}

function focusSelected() {
  const center = state.selectedUid && sceneRenderer.getGeometryCenter(state.project, state.selectedUid);
  if (!center) return toast('目前沒有可聚焦的物件');
  animateCameraFocus(center);
}

function focusSceneOrigin() {
  animateCameraFocus([0, 0, 0]);
}

function updateAxisWidget() {
  const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch), cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
  const forward = [-sy * cp, -sp, -cy * cp];
  const right = normalize3(cross3(forward, [0, 1, 0]));
  const up = normalize3(cross3(right, forward));
  const axes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  for (const [name, axis] of Object.entries(axes)) {
    const x = 33 + dot3(axis, right) * 22;
    const y = 33 - dot3(axis, up) * 22;
    const depth = dot3(axis, forward);
    const line = $(`#axisLine${name.toUpperCase()}`);
    line.setAttribute('x2', x); line.setAttribute('y2', y);
    line.style.opacity = String(.45 + Math.max(0, depth) * .55);
    const button = $(`[data-view-axis="${name}"]`);
    button.style.left = `${x}px`; button.style.top = `${y}px`;
    button.style.zIndex = depth > 0 ? '2' : '1';
    button.style.opacity = String(.6 + Math.max(0, depth) * .4);
  }
}

function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize3(vector) { const length = Math.hypot(...vector) || 1; return vector.map(value => value / length); }

function updateTransformSpaceButtons() {
  $$('[data-transform-space]').forEach(button => {
    const active = button.dataset.transformSpace === state.transformSpace;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function updateRotationModeButtons() {
  $$('[data-rotation-mode]').forEach(button => {
    const active = button.dataset.rotationMode === state.rotationMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function updateScaleHandleModeButtons() {
  $$('[data-scale-handle-mode]').forEach(button => {
    const active = button.dataset.scaleHandleMode === state.scaleHandleMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function updateMultiTransformModeButtons() {
  $$('[data-multi-transform-mode]').forEach(button => {
    const active = button.dataset.multiTransformMode === state.multiTransformMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function rotateVector(vector, rotation) {
  let [x, y, z] = vector;
  const [rx, ry, rz] = rotation.map(value => value * Math.PI / 180);
  let c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry); s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz); s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

function inverseRotateVector(vector, rotation) {
  return rotateVector(rotateVector(rotateVector(vector, [0, 0, -rotation[2]]), [0, -rotation[1], 0]), [-rotation[0], 0, 0]);
}

function quaternionMultiply(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}

function quaternionFromEuler(rotation) {
  const half = rotation.map(value => value * Math.PI / 360);
  const qx = [Math.sin(half[0]), 0, 0, Math.cos(half[0])];
  const qy = [0, Math.sin(half[1]), 0, Math.cos(half[1])];
  const qz = [0, 0, Math.sin(half[2]), Math.cos(half[2])];
  return quaternionMultiply(quaternionMultiply(qz, qy), qx);
}

function quaternionFromAxisAngle(axis, degrees) {
  const half = degrees * Math.PI / 360, direction = normalize3(axis);
  return [...direction.map(value => value * Math.sin(half)), Math.cos(half)];
}

function eulerFromQuaternion(q) {
  const [x, y, z, w] = q;
  const sinY = 2 * (w * y - z * x);
  const rx = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const ry = Math.asin(Math.max(-1, Math.min(1, sinY)));
  const rz = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return [rx, ry, rz].map(value => value * 180 / Math.PI);
}

function getTransformPivot(item) {
  const local = item.type === 'cube' || item.type === 'group' ? item.pivot : item.position || item.origin;
  return applyGroupTransforms(local, state.project.getGroupChain(item.uid));
}

function inverseApplyGroupTransforms(point, groupChain = []) {
  let transformed = [...point];
  for (const group of groupChain) {
    const offset = transformed.map((value, axis) => value - group.pivot[axis]);
    const rotated = inverseRotateVector(offset, group.rotation || [0, 0, 0]);
    transformed = rotated.map((value, axis) => value + group.pivot[axis]);
  }
  return transformed;
}

function selectedWorldPoints() {
  return selectedElementUids().flatMap(uidValue => sceneRenderer.getWorldVertices(state.project, uidValue).map(entry => entry.point));
}

function selectionGeometryCenter() {
  const cachedBounds = sceneRenderer.getSelectionBounds(state.project, state.selectedUids);
  if (cachedBounds) return cachedBounds.center;
  let points = selectedWorldPoints();
  if (!points.length) points = selectedTopLevelNodes().map(getTransformPivot).filter(Boolean);
  if (!points.length) return null;
  return [0, 1, 2].map(axis => {
    const values = points.map(point => point[axis]);
    return (Math.min(...values) + Math.max(...values)) / 2;
  });
}

function getSelectionTransformContext() {
  if (state.dragging?.type === 'transform' && state.dragging.batchPreview) return state.dragging.selectionContext;
  const nodes = selectedTopLevelNodes();
  const multiple = nodes.length > 1;
  const commonGroup = multiple ? deepestCommonSelectionGroup() : null;
  const center = multiple ? selectionGeometryCenter() : null;
  return {
    nodes,
    multiple,
    commonGroup,
    center,
    pivot: multiple ? (commonGroup ? getTransformPivot(commonGroup) : center) : null
  };
}

function getTransformAxes(item) {
  const chain = state.project.getGroupChain(item.uid);
  const parentRotation = vector => applyGroupTransforms(vector, chain.map(group => ({ pivot: [0, 0, 0], rotation: group.rotation })));
  return [0, 1, 2].map(axis => {
    const unit = [0, 0, 0]; unit[axis] = 1;
    let direction = state.transformSpace === 'global' ? unit : parentRotation(unit);
    if (state.transformSpace === 'self' || (state.tool === 'resize' && item.type !== 'group')) {
      const rotation = item.rotation || [0, 0, 0];
      if (state.tool === 'rotate' && state.rotationMode === 'euler') {
        // The renderer uses Rz * Ry * Rx. Its Euler gimbal therefore has a
        // fixed Z axis, Y follows Z, and X follows Z then Y. Rotations later
        // in the Z -> Y -> X hierarchy never move an earlier axis.
        const stagedRotation = axis === 0 ? [0, rotation[1], rotation[2]]
          : axis === 1 ? [0, 0, rotation[2]]
          : [0, 0, 0];
        direction = parentRotation(rotateVector(unit, stagedRotation));
      } else {
        direction = parentRotation(rotateVector(unit, rotation));
      }
    }
    return normalize3(direction);
  });
}

function getSelectionTransformAxes(context, fallbackItem) {
  if (!context.multiple) return getTransformAxes(fallbackItem);
  if (context.commonGroup) return getTransformAxes(context.commonGroup);
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
}

function activeCurveNodeContext() {
  const curve = selected();
  if (!isBezierElement(curve) || !Number.isInteger(state.selectedCurveNodeIndex)) return null;
  const node = curve.nodes[state.selectedCurveNodeIndex];
  return node ? { curve, node, index: state.selectedCurveNodeIndex } : null;
}

function bakeCurveNodeTangent(curve, index) {
  const node = curve?.nodes?.[index];
  if (!node?.autoTangent || !isBezierElement(curve)) return node;
  const resolved = curve.resolvedNodeState(index);
  node.rotation = [...resolved.rotation];
  node.handleIn = [...resolved.localHandleIn];
  node.handleOut = [...resolved.localHandleOut];
  node.autoTangent = false;
  return node;
}

function getCurveNodeTransformAxes(context) {
  const chain = [...state.project.getGroupChain(context.curve.uid), { pivot: [0, 0, 0], rotation: context.curve.rotation || [0, 0, 0] }];
  return [0, 1, 2].map(axis => {
    const unit = [0, 0, 0]; unit[axis] = 1;
    if (state.transformSpace === 'global') return unit;
    let direction = unit;
    if (state.transformSpace === 'self') {
      const rotation = context.node.autoTangent
        ? context.curve.resolvedNodeState(context.index).rotation
        : context.node.rotation || [0, 0, 0];
      direction = rotateVector(direction, rotation);
    }
    return normalize3(applyGroupTransforms(direction, chain));
  });
}

function addScaled3(point, direction, amount) {
  return point.map((value, axis) => value + direction[axis] * amount);
}

function intersectRayPlane(ray, planePoint, planeNormal) {
  if (!ray) return null;
  const denominator = dot3(ray.direction, planeNormal);
  if (Math.abs(denominator) < 1e-6) return null;
  const distance = dot3(planePoint.map((value, axis) => value - ray.origin[axis]), planeNormal) / denominator;
  return addScaled3(ray.origin, ray.direction, distance);
}

function projectViewportPoint(point) {
  const projected = sceneRenderer.projectPoint(point);
  return { ...projected, worldPerPixel: sceneRenderer.getCameraFrame()?.worldPerPixel || .08 };
}

function axisBasis(axis) {
  const reference = Math.abs(axis[1]) < .82 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize3(cross3(axis, reference));
  return [u, normalize3(cross3(axis, u))];
}

function pointsPath(points, close = false) {
  if (!points.length) return '';
  return `${points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}${close ? ' Z' : ''}`;
}

function gizmoDepthAttributes(shape, pointGroups, priority = '') {
  const groups = (Array.isArray(pointGroups[0]) ? pointGroups : [pointGroups]).filter(group => group.length);
  const points = groups.flat();
  const averageDepth = points.reduce((sum, point) => sum + point.depth, 0) / Math.max(1, points.length);
  const encoded = groups.map(group => group.map(point =>
    `${point.x.toFixed(3)},${point.y.toFixed(3)},${point.depth.toFixed(6)}`).join(';')).join('|');
  return `data-hit-shape="${shape}" data-hit-depth="${averageDepth.toFixed(6)}" data-hit-points="${encoded}"${priority ? ` data-hit-priority="${priority}"` : ''}`;
}

function gizmoControlLayer(control) {
  if (control.dataset.hitPriority === 'center') return 2;
  return control.dataset.kind?.startsWith('plane') ? 1 : 0;
}

function sortGizmoControlsByDepth(gizmo) {
  const controls = [...gizmo.children].filter(element => element.classList.contains('gizmo-control'));
  const anchor = [...gizmo.children].find(element => !element.classList.contains('gizmo-control')) || null;
  controls.sort((left, right) => {
    const leftLayer = gizmoControlLayer(left);
    const rightLayer = gizmoControlLayer(right);
    if (leftLayer !== rightLayer) return leftLayer - rightLayer;
    // OpenGL NDC depth grows away from the camera, so farther controls are
    // painted first and the nearer control remains visible on top.
    return Number(right.dataset.hitDepth || 1) - Number(left.dataset.hitDepth || 1);
  });
  controls.forEach(control => gizmo.insertBefore(control, anchor));
}

function parseGizmoDepthGroups(control) {
  return (control.dataset.hitPoints || '').split('|').map(group => group.split(';').map(point => {
    const values = point.split(',').map(Number);
    return values.length === 3 && values.every(Number.isFinite) ? values : null;
  }).filter(Boolean)).filter(group => group.length);
}

function triangleDepthAtPoint(point, first, second, third) {
  const denominator = (second[1] - third[1]) * (first[0] - third[0])
    + (third[0] - second[0]) * (first[1] - third[1]);
  if (Math.abs(denominator) < 1e-6) return null;
  const a = ((second[1] - third[1]) * (point[0] - third[0])
    + (third[0] - second[0]) * (point[1] - third[1])) / denominator;
  const b = ((third[1] - first[1]) * (point[0] - third[0])
    + (first[0] - third[0]) * (point[1] - third[1])) / denominator;
  const c = 1 - a - b;
  if (a < -.001 || b < -.001 || c < -.001) return null;
  return a * first[2] + b * second[2] + c * third[2];
}

function gizmoControlDepthAtPoint(control, x, y) {
  const groups = parseGizmoDepthGroups(control);
  const fallback = Number(control.dataset.hitDepth || 1);
  if (!groups.length) return fallback;
  if (control.dataset.hitShape === 'polygon' && groups[0].length >= 3) {
    const polygon = groups[0];
    for (let index = 1; index < polygon.length - 1; index++) {
      const depth = triangleDepthAtPoint([x, y], polygon[0], polygon[index], polygon[index + 1]);
      if (depth !== null) return depth;
    }
    return fallback;
  }
  let closest = { distance: Infinity, depth: fallback };
  for (const group of groups) {
    if (group.length === 1) continue;
    for (let index = 0; index < group.length - 1; index++) {
      const first = group[index], second = group[index + 1];
      const dx = second[0] - first[0], dy = second[1] - first[1];
      const lengthSquared = dx * dx + dy * dy;
      const amount = lengthSquared > 1e-6
        ? Math.max(0, Math.min(1, ((x - first[0]) * dx + (y - first[1]) * dy) / lengthSquared))
        : 0;
      const nearestX = first[0] + dx * amount, nearestY = first[1] + dy * amount;
      const distance = (x - nearestX) ** 2 + (y - nearestY) ** 2;
      if (distance < closest.distance) closest = {
        distance,
        depth: first[2] + (second[2] - first[2]) * amount
      };
    }
  }
  return closest.depth;
}

function resolveGizmoHandle(event) {
  const gizmo = $('#transformGizmo');
  const controls = [];
  const seen = new Set();
  for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
    const control = element.closest?.('.gizmo-control');
    if (!control || !gizmo.contains(control) || seen.has(control)) continue;
    seen.add(control); controls.push(control);
  }
  const fallback = event.target.closest?.('.gizmo-control');
  if (fallback && gizmo.contains(fallback) && !seen.has(fallback)) controls.push(fallback);
  if (!controls.length) return null;
  const frontLayer = Math.max(...controls.map(gizmoControlLayer));
  const frontControls = controls.filter(control => gizmoControlLayer(control) === frontLayer);
  const rect = gizmo.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  return frontControls.reduce((nearest, control) => {
    const depth = gizmoControlDepthAtPoint(control, x, y);
    if (!nearest || depth < nearest.depth - 1e-6) return { control, depth };
    if (Math.abs(depth - nearest.depth) <= 1e-6
      && control.dataset.kind === 'axis' && nearest.control.dataset.kind !== 'axis') return { control, depth };
    return nearest;
  }, null)?.control || fallback;
}

function updateGizmoDepthHover(event) {
  if (state.dragging?.type === 'transform') return;
  const gizmo = $('#transformGizmo');
  const handle = resolveGizmoHandle(event);
  gizmo.querySelectorAll('.depth-hover').forEach(control => control.classList.toggle('depth-hover', control === handle));
  handle?.classList.add('depth-hover');
}

const GIZMO_AXIS_PIXELS = 93;
const GIZMO_HEAD_GAP_PIXELS = 25;
// Rz * Ry * Rx is presented as the Z -> Y -> X Euler hierarchy. Keep that
// application order legible by nesting the corresponding rings outside-in.
const EULER_RING_RADIUS_SCALES = Object.freeze([.775, .87, .965]);

function coneMarkup(handle, origin, axisClass, pixelWorld) {
  const baseWorld = addScaled3(origin, handle.vector, handle.positiveDistance);
  const tipWorld = addScaled3(baseWorld, handle.vector, pixelWorld * 19.5);
  const u = handle.basisU, v = handle.basisV;
  const base = Array.from({ length: 12 }, (_, index) => {
    const angle = index / 12 * Math.PI * 2;
    let point = addScaled3(baseWorld, u, Math.cos(angle) * pixelWorld * 8.25);
    point = addScaled3(point, v, Math.sin(angle) * pixelWorld * 8.25);
    return projectViewportPoint(point);
  });
  const tip = projectViewportPoint(tipWorld);
  const baseCenter = projectViewportPoint(baseWorld);
  const center = projectViewportPoint(origin);
  const faces = base.map((point, index) => `<path class="gizmo-visible gizmo-head cone-face" d="${pointsPath([tip, point, base[(index + 1) % base.length]], true)}"/>`).join('');
  return `<g class="gizmo-control ${axisClass}" data-axis="${handle.axis}" data-kind="axis" ${gizmoDepthAttributes('segment', [center, tip])}>
    <line class="gizmo-hit" x1="${handle.centerX}" y1="${handle.centerY}" x2="${tip.x}" y2="${tip.y}"/>
    <line class="gizmo-visible axis-stem" x1="${handle.centerX}" y1="${handle.centerY}" x2="${baseCenter.x}" y2="${baseCenter.y}"/>
    ${faces}<circle class="gizmo-hit-point" cx="${tip.x}" cy="${tip.y}" r="18"/>
  </g>`;
}

function prismMarkup(handle, origin, axisClass, pixelWorld, sign) {
  const direction = handle.vector.map(value => value * sign);
  const distance = sign > 0 ? handle.positiveDistance : handle.negativeDistance;
  const endpointWorld = addScaled3(origin, direction, distance);
  const side = pixelWorld * 13.5;
  const halfSide = side / 2;
  const halfThickness = side / 4;
  const corners = [];
  for (const along of [-halfThickness, halfThickness]) for (const acrossU of [-halfSide, halfSide]) for (const acrossV of [-halfSide, halfSide]) {
    let point = addScaled3(endpointWorld, direction, along);
    point = addScaled3(point, handle.basisU, acrossU);
    point = addScaled3(point, handle.basisV, acrossV);
    corners.push(projectViewportPoint(point));
  }
  const faces = [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]]
    .map(indices => ({ points: indices.map(index => corners[index]), depth: indices.reduce((sum, index) => sum + corners[index].depth, 0) / 4 }))
    .sort((a, b) => b.depth - a.depth)
    .map(face => `<path class="gizmo-visible gizmo-head prism-face" d="${pointsPath(face.points, true)}"/>`).join('');
  const endpoint = projectViewportPoint(endpointWorld);
  const center = projectViewportPoint(origin);
  return `<g class="gizmo-control ${axisClass}" data-axis="${handle.axis}" data-kind="axis" data-sign="${sign}" ${gizmoDepthAttributes('segment', [center, endpoint])}>
    <line class="gizmo-hit" x1="${handle.centerX}" y1="${handle.centerY}" x2="${endpoint.x}" y2="${endpoint.y}"/>
    <line class="gizmo-visible axis-stem" x1="${handle.centerX}" y1="${handle.centerY}" x2="${endpoint.x}" y2="${endpoint.y}"/>
    ${faces}<circle class="gizmo-hit-point" cx="${endpoint.x}" cy="${endpoint.y}" r="18"/>
  </g>`;
}

const GIZMO_PLANES = Object.freeze([
  { axes: [0, 1], key: 'xy' },
  { axes: [1, 2], key: 'yz' },
  { axes: [2, 0], key: 'zx' }
]);

function planeMarkup(handles, origin, plane, pixelWorld, signs = [1, 1]) {
  const [firstIndex, secondIndex] = plane.axes;
  const first = handles[firstIndex].vector.map(value => value * signs[0]);
  const second = handles[secondIndex].vector.map(value => value * signs[1]);
  const near = pixelWorld * 18;
  const far = pixelWorld * 39;
  const point = (firstDistance, secondDistance) => {
    let world = addScaled3(origin, first, firstDistance);
    world = addScaled3(world, second, secondDistance);
    return projectViewportPoint(world);
  };
  const corners = [point(near, near), point(far, near), point(far, far), point(near, far)];
  const path = pointsPath(corners, true);
  const axisKey = `plane-${firstIndex}${secondIndex}`;
  return `<g class="gizmo-control plane-${plane.key}" data-axis="${axisKey}" data-kind="plane" ${gizmoDepthAttributes('polygon', corners)}
      data-axes="${firstIndex},${secondIndex}" data-signs="${signs.join(',')}">
    <path class="gizmo-plane-hit" d="${path}"/>
    <path class="gizmo-visible plane-handle" d="${path}"/>
  </g>`;
}

function planeScaleCornerMarkup(handles, origin, plane, pixelWorld, signs) {
  const [firstIndex, secondIndex] = plane.axes;
  const first = handles[firstIndex].vector.map(value => value * signs[0]);
  const second = handles[secondIndex].vector.map(value => value * signs[1]);
  const inner = pixelWorld * 22;
  const outer = pixelWorld * 52;
  const point = (firstDistance, secondDistance) => {
    let world = addScaled3(origin, first, firstDistance);
    world = addScaled3(world, second, secondDistance);
    return projectViewportPoint(world);
  };
  const points = [point(outer, inner), point(outer, outer), point(inner, outer)];
  const path = pointsPath(points);
  const axisKey = `plane-uniform-${firstIndex}${secondIndex}`;
  return `<g class="gizmo-control plane-${plane.key}" data-axis="${axisKey}" data-kind="plane-uniform" ${gizmoDepthAttributes('polyline', points)}
      data-axes="${firstIndex},${secondIndex}" data-signs="${signs.join(',')}">
    <path class="gizmo-plane-corner-hit" d="${path}"/>
    <path class="gizmo-visible plane-scale-corner" d="${path}"/>
  </g>`;
}

function centerCubeMarkup(origin, axes, pixelWorld, { axisKey = 'uniform', kind = 'uniform', className = 'uniform-scale-control' } = {}) {
  const half = pixelWorld * 7.5;
  const corners = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    let point = addScaled3(origin, axes[0], x * half);
    point = addScaled3(point, axes[1], y * half);
    point = addScaled3(point, axes[2], z * half);
    corners.push(projectViewportPoint(point));
  }
  const faces = [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]]
    .map(indices => ({ points: indices.map(index => corners[index]), depth: indices.reduce((sum, index) => sum + corners[index].depth, 0) / 4 }))
    .sort((left, right) => right.depth - left.depth)
    .map(face => `<path class="gizmo-visible center-cube-face" d="${pointsPath(face.points, true)}"/>`).join('');
  const center = projectViewportPoint(origin);
  return `<g class="gizmo-control ${className}" data-axis="${axisKey}" data-kind="${kind}" ${gizmoDepthAttributes('polygon', [center], 'center')}>
    <circle class="gizmo-hit-point" cx="${center.x}" cy="${center.y}" r="16"/>
    ${faces}
  </g>`;
}

function pivotMarkerMarkup(origin) {
  const center = projectViewportPoint(origin);
  const x = center.x, y = center.y, radius = 11;
  return `<g class="pivot-marker" aria-label="選中項樞軸點">
    <path class="pivot-marker-ring" d="M${x},${y - radius} L${x + radius},${y} L${x},${y + radius} L${x - radius},${y} Z"/>
    <path class="pivot-marker-cross" d="M${x - 15},${y} H${x + 15} M${x},${y - 15} V${y + 15}"/>
    <circle class="pivot-marker-core" cx="${x}" cy="${y}" r="3.5"/>
  </g>`;
}

function frontRingGeometry(origin, axis, radius, cameraFrame) {
  const [u, v] = axisBasis(axis);
  let path = '', drawing = false, group = [], groups = [];
  for (let step = 0; step <= 144; step++) {
    const angle = step / 144 * Math.PI * 2;
    let offset = u.map(value => value * Math.cos(angle) * radius);
    offset = offset.map((value, component) => value + v[component] * Math.sin(angle) * radius);
    const world = origin.map((value, component) => value + offset[component]);
    const toCamera = cameraFrame.projection === 'perspective'
      ? normalize3(cameraFrame.eye.map((value, component) => value - world[component]))
      : cameraFrame.forward.map(value => -value);
    if (dot3(offset, toCamera) < -.0001) {
      if (group.length) groups.push(group);
      group = []; drawing = false; continue;
    }
    const point = projectViewportPoint(world);
    path += `${drawing ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)} `;
    group.push(point);
    drawing = true;
  }
  if (group.length) groups.push(group);
  if (groups.length > 1) {
    const first = groups[0];
    const last = groups[groups.length - 1];
    const firstPoint = first[0], lastPoint = last[last.length - 1];
    if (Math.hypot(firstPoint.x - lastPoint.x, firstPoint.y - lastPoint.y) < 1) {
      groups = [[...last.slice(0, -1), ...first], ...groups.slice(1, -1)];
    }
  }
  path = groups.map(pointsPath).join(' ');
  const mainArc = [...groups].sort((left, right) => right.length - left.length)[0] || [];
  const handleIndex = Math.floor(mainArc.length / 2);
  const handlePoint = mainArc[handleIndex] || null;
  let handle = null;
  if (handlePoint) {
    const previous = mainArc[Math.max(0, handleIndex - 1)] || handlePoint;
    const next = mainArc[Math.min(mainArc.length - 1, handleIndex + 1)] || handlePoint;
    const tangentX = next.x - previous.x;
    const tangentY = next.y - previous.y;
    const tangentLength = Math.max(.0001, Math.hypot(tangentX, tangentY));
    handle = {
      ...handlePoint,
      tangentX: tangentX / tangentLength,
      tangentY: tangentY / tangentLength
    };
  }
  return { path: path.trim(), groups, handle };
}

function taperedRingPath(points) {
  if (points.length < 2) return '';
  const sides = points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x, dy = next.y - previous.y;
    const length = Math.max(.0001, Math.hypot(dx, dy));
    const progress = index / Math.max(1, points.length - 1);
    const width = .8 + 3.2 * Math.pow(Math.sin(progress * Math.PI), .7);
    const normalX = -dy / length * width / 2;
    const normalY = dx / length * width / 2;
    return {
      left: { x: point.x + normalX, y: point.y + normalY },
      right: { x: point.x - normalX, y: point.y - normalY }
    };
  });
  return pointsPath([...sides.map(entry => entry.left), ...sides.map(entry => entry.right).reverse()], true);
}

function taperedRingMarkup(ring) {
  const arcs = ring.groups.map(group => `<path class="gizmo-visible rotate-ring" d="${taperedRingPath(group)}"/>`).join('');
  if (!ring.handle) return arcs;
  const tangent = [ring.handle.tangentX, ring.handle.tangentY];
  const normal = [-tangent[1], tangent[0]];
  const diamond = [
    { x: ring.handle.x - tangent[0] * 15, y: ring.handle.y - tangent[1] * 15 },
    { x: ring.handle.x + normal[0] * 5, y: ring.handle.y + normal[1] * 5 },
    { x: ring.handle.x + tangent[0] * 15, y: ring.handle.y + tangent[1] * 15 },
    { x: ring.handle.x - normal[0] * 5, y: ring.handle.y - normal[1] * 5 }
  ];
  return `${arcs}<path class="gizmo-visible rotate-handle" d="${pointsPath(diamond, true)}"/>
    <circle class="gizmo-hit-point rotate-handle-hit" cx="${ring.handle.x}" cy="${ring.handle.y}" r="18"/>`;
}

function cameraRingGeometry(origin, radius, cameraFrame) {
  const points = Array.from({ length: 97 }, (_, step) => {
    const angle = step / 96 * Math.PI * 2;
    let point = addScaled3(origin, cameraFrame.right, Math.cos(angle) * radius);
    point = addScaled3(point, cameraFrame.up, Math.sin(angle) * radius);
    return projectViewportPoint(point);
  });
  return { path: pointsPath(points, true), points };
}

function infiniteGuideMarkup(handle, width, height, axisClass) {
  const direction = [handle.screen[0], -handle.screen[1]];
  const center = [handle.centerX, handle.centerY];
  const candidates = [];
  if (Math.abs(direction[0]) > .0001) {
    for (const x of [0, width]) {
      const t = (x - center[0]) / direction[0];
      const y = center[1] + direction[1] * t;
      if (y >= 0 && y <= height) candidates.push([x, y, t]);
    }
  }
  if (Math.abs(direction[1]) > .0001) {
    for (const y of [0, height]) {
      const t = (y - center[1]) / direction[1];
      const x = center[0] + direction[0] * t;
      if (x >= 0 && x <= width) candidates.push([x, y, t]);
    }
  }
  candidates.sort((a, b) => a[2] - b[2]);
  if (candidates.length < 2) return '';
  const first = candidates[0], last = candidates[candidates.length - 1];
  return `<line class="drag-infinite-line ${axisClass}" x1="${first[0]}" y1="${first[1]}" x2="${last[0]}" y2="${last[1]}"/>`;
}

function renderVertexSnapGizmo(gizmo, width, height) {
  const item = selected();
  const points = [];
  for (const vertex of sceneRenderer.getWorldVertices(state.project, item.uid)) {
    const projected = projectViewportPoint(vertex.point);
    if (projected.behind || projected.x < -12 || projected.y < -12 || projected.x > width + 12 || projected.y > height + 12) continue;
    points.push({ ...vertex, pointType: 'vertex', projected });
  }
  if (isBezierElement(item)) {
    for (const entry of sceneRenderer.getCurveNodeWorldPoints(state.project, item.uid)) {
      const projected = projectViewportPoint(entry.point);
      if (projected.behind || projected.x < -12 || projected.y < -12 || projected.x > width + 12 || projected.y > height + 12) continue;
      points.push({ uid: item.uid, nodeIndex: entry.index, point: entry.point, pointType: 'curveNode', projected });
    }
  }
  if (state.vertexSnapMode === 'move' && ['cube', 'group'].includes(item.type)) {
    const pivotPoint = getTransformPivot(item);
    const projected = projectViewportPoint(pivotPoint);
    if (!projected.behind && projected.x >= -14 && projected.y >= -14 && projected.x <= width + 14 && projected.y <= height + 14) {
      points.push({ uid: item.uid, point: pivotPoint, pointType: 'pivot', projected });
    }
  }
  points.sort((left, right) => right.projected.depth - left.projected.depth);
  state.vertexSnapPoints = points;
  gizmo.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const pointMarkup = points.map((entry, index) => {
    const sourceActive = state.vertexSnapSource?.uid === entry.uid
      && state.vertexSnapSource.pointType === entry.pointType
      && state.vertexSnapSource.nodeIndex === entry.nodeIndex
      && state.vertexSnapSource.point.every((value, axis) => Math.abs(value - entry.point[axis]) < 1e-5);
    const classes = ['gizmo-control', 'vertex-snap-control', 'source-candidate', sourceActive ? 'source-active' : ''].filter(Boolean).join(' ');
    if (entry.pointType === 'pivot') return `<g class="${classes} vertex-snap-pivot-control pivot-marker" data-kind="vertex" data-vertex-index="${index}" ${gizmoDepthAttributes('point', [entry.projected], 'front')}>
      <circle class="gizmo-hit-point" cx="${entry.projected.x}" cy="${entry.projected.y}" r="17"/>
      <path class="gizmo-visible pivot-marker-ring" d="M${entry.projected.x},${entry.projected.y - 11} L${entry.projected.x + 11},${entry.projected.y} L${entry.projected.x},${entry.projected.y + 11} L${entry.projected.x - 11},${entry.projected.y} Z"/>
      <path class="gizmo-visible pivot-marker-cross" d="M${entry.projected.x - 15},${entry.projected.y} H${entry.projected.x + 15} M${entry.projected.x},${entry.projected.y - 15} V${entry.projected.y + 15}"/>
      <circle class="gizmo-visible pivot-marker-core" cx="${entry.projected.x}" cy="${entry.projected.y}" r="3.5"/>
    </g>`;
    return `<g class="${classes}" data-kind="vertex" data-vertex-index="${index}" ${gizmoDepthAttributes('point', [entry.projected])}>
      <circle class="gizmo-hit-point" cx="${entry.projected.x}" cy="${entry.projected.y}" r="13"/>
      <circle class="gizmo-visible vertex-snap-point" cx="${entry.projected.x}" cy="${entry.projected.y}" r="5"/>
    </g>`;
  }).join('');
  let sourceMarkup = '';
  if (state.vertexSnapSource && state.vertexSnapSource.rootUid !== item.uid) {
    const source = projectViewportPoint(state.vertexSnapSource.point);
    if (!source.behind && state.vertexSnapSource.pointType === 'pivot') sourceMarkup = `<g class="pivot-marker vertex-snap-source-pivot">
      <path class="pivot-marker-ring" d="M${source.x},${source.y - 11} L${source.x + 11},${source.y} L${source.x},${source.y + 11} L${source.x - 11},${source.y} Z"/>
      <path class="pivot-marker-cross" d="M${source.x - 15},${source.y} H${source.x + 15} M${source.x},${source.y - 15} V${source.y + 15}"/>
      <circle class="pivot-marker-core" cx="${source.x}" cy="${source.y}" r="3.5"/>
    </g>`;
    else if (!source.behind) sourceMarkup = `<path class="vertex-snap-source-marker" d="M${source.x},${source.y - 9} L${source.x + 9},${source.y} L${source.x},${source.y + 9} L${source.x - 9},${source.y} Z"/>`;
  }
  gizmo.innerHTML = pointMarkup + sourceMarkup;
  sortGizmoControlsByDepth(gizmo);
  gizmo.removeAttribute('hidden');
}

function updateTransformGizmo() {
  const gizmo = $('#transformGizmo');
  const item = selected();
  const curveNodeContext = activeCurveNodeContext();
  const selectionContext = getSelectionTransformContext();
  if (!item || isEffectivelyLocked(item.uid) || !['move', 'resize', 'rotate', 'pivot', 'vertexSnap'].includes(state.tool)
    || (state.tool === 'resize' && (curveNodeContext || (!selectionContext.multiple && !['cube', 'shape'].includes(item.type))))) {
    gizmo.setAttribute('hidden', ''); gizmo.innerHTML = ''; state.gizmoAxes = null; state.gizmoCenter = null; state.gizmoOrigin = null; return;
  }
  const rect = sceneCanvas.getBoundingClientRect();
  const width = rect.width, height = rect.height;
  if (state.tool === 'vertexSnap') {
    renderVertexSnapGizmo(gizmo, width, height);
    return;
  }
  if (state.tool === 'pivot' && selectionContext.multiple && !selectionContext.commonGroup) {
    gizmo.setAttribute('hidden', ''); gizmo.innerHTML = ''; return;
  }
  const transformItem = state.tool === 'pivot' && selectionContext.multiple ? selectionContext.commonGroup : item;
  if (state.tool === 'pivot' && !curveNodeContext && !['cube', 'group', 'node'].includes(transformItem?.type)) {
    gizmo.setAttribute('hidden', ''); gizmo.innerHTML = ''; return;
  }
  const pivot = curveNodeContext
    ? sceneRenderer.getCurveNodeWorldPoints(state.project, item.uid)[curveNodeContext.index]?.point
    : selectionContext.multiple ? selectionContext.pivot : getTransformPivot(item);
  const geometryCenter = curveNodeContext ? pivot : selectionContext.multiple
    ? selectionContext.center || pivot
    : sceneRenderer.getSelectionBounds(state.project, state.selectedUids)?.center
      || sceneRenderer.getGeometryCenter(state.project, item.uid)
      || pivot;
  const gizmoOrigin = curveNodeContext || item.type === 'node' || ['rotate', 'pivot'].includes(state.tool) ? pivot : geometryCenter;
  const center = projectViewportPoint(gizmoOrigin);
  state.gizmoCenter = { x: center.x, y: center.y };
  state.gizmoOrigin = [...gizmoOrigin];
  const axes = curveNodeContext ? getCurveNodeTransformAxes(curveNodeContext) : getSelectionTransformAxes(selectionContext, item);
  const classes = ['x', 'y', 'z'];
  const cameraFrame = sceneRenderer.getCameraFrame();
  const pixelSample = projectViewportPoint(addScaled3(gizmoOrigin, cameraFrame.right, 1));
  const pixelWorld = 1 / Math.max(.0001, Math.hypot(pixelSample.x - center.x, pixelSample.y - center.y));
  const relativeAxisLength = pixelWorld * GIZMO_AXIS_PIXELS;
  const handles = axes.map((axis, index) => {
    const unitPoint = projectViewportPoint(addScaled3(gizmoOrigin, axis, 1));
    const pixelsPerUnit = Math.hypot(unitPoint.x - center.x, unitPoint.y - center.y);
    const screenDelta = [unitPoint.x - center.x, -(unitPoint.y - center.y), 0];
    const screen = Math.hypot(screenDelta[0], screenDelta[1]) > 1
      ? normalize3(screenDelta)
      : index === 1 ? [0, 1, 0] : [1, 0, 0];
    let positiveDistance = relativeAxisLength, negativeDistance = relativeAxisLength;
    if (state.tool === 'resize' && state.scaleHandleMode === 'bounds') {
      let extent;
      if (selectionContext.multiple) {
        extent = sceneRenderer.getSelectionProjectionExtent(state.project, state.selectedUids, gizmoOrigin, axis) ?? 0;
      } else extent = item.type === 'cube'
        ? Math.abs(item.size[index]) / 2
        : index === 1 ? Math.abs(item.parameters.height) / 2 : Math.abs(item.parameters.radius);
      positiveDistance = extent + pixelWorld * GIZMO_HEAD_GAP_PIXELS;
      negativeDistance = positiveDistance;
    }
    return { axis: index, vector: axis, screen, screenPerWorld: screenDelta.slice(0, 2), positiveDistance, negativeDistance,
      basisU: axes[(index + 1) % 3], basisV: axes[(index + 2) % 3],
      worldPerPixel: 1 / Math.max(pixelsPerUnit, .0001) };
  });
  state.gizmoAxes = handles.map(handle => ({ ...handle, centerX: center.x, centerY: center.y }));
  gizmo.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (state.tool === 'rotate') {
    const pixelsPerUnit = 1 / pixelWorld;
    const radius = 87 / pixelsPerUnit;
    const sphere = cameraRingGeometry(gizmoOrigin, radius, cameraFrame);
    const layeredEulerRings = state.transformSpace === 'self' && state.rotationMode === 'euler';
    const rotationHandles = curveNodeContext?.curve.dimension === 2
      ? handles.filter(handle => handle.axis === 1)
      : handles;
    const rings = rotationHandles.map(handle => {
      const ringScale = layeredEulerRings ? EULER_RING_RADIUS_SCALES[handle.axis] : .965;
      const ring = frontRingGeometry(gizmoOrigin, handle.vector, radius * ringScale, cameraFrame);
      return `<g class="gizmo-control axis-${classes[handle.axis]}" data-axis="${handle.axis}" data-kind="rotate" ${gizmoDepthAttributes('polyline', ring.groups)}>
        <path class="gizmo-hit rotate-hit" d="${ring.path}"/>${taperedRingMarkup(ring)}
      </g>`;
    }).join('');
    const viewRing = curveNodeContext?.curve.dimension === 2 ? '' : `<g class="gizmo-control sphere-control" data-axis="view" data-kind="rotate-view" ${gizmoDepthAttributes('polyline', sphere.points)}>
      <path class="gizmo-hit rotate-hit" d="${sphere.path}"/><path class="gizmo-visible rotation-sphere" d="${sphere.path}"/>
    </g>`;
    gizmo.innerHTML = `${viewRing}${rings}<circle class="gizmo-visible rotation-pivot" cx="${center.x}" cy="${center.y}" r="5"/>`;
  } else if (state.tool === 'move' || state.tool === 'pivot') {
    const planes = GIZMO_PLANES.map(plane => planeMarkup(handles, gizmoOrigin, plane, pixelWorld)).join('');
    gizmo.innerHTML = `${planes}${handles.map(handle => coneMarkup({ ...handle, centerX: center.x, centerY: center.y }, gizmoOrigin, `axis-${classes[handle.axis]}`, pixelWorld)).join('')}
      ${centerCubeMarkup(gizmoOrigin, axes, pixelWorld, { axisKey: 'free', kind: 'free', className: 'center-control' })}
      ${state.tool === 'pivot' && !curveNodeContext && item.type !== 'node' ? pivotMarkerMarkup(gizmoOrigin) : ''}`;
  } else {
    const toCamera = cameraFrame.projection === 'perspective'
      ? normalize3(cameraFrame.eye.map((value, component) => value - gizmoOrigin[component]))
      : cameraFrame.forward.map(value => -value);
    const closestSigns = handles.map(handle => dot3(handle.vector, toCamera) >= 0 ? 1 : -1);
    const planes = GIZMO_PLANES.map(plane => planeMarkup(handles, gizmoOrigin, plane, pixelWorld,
      plane.axes.map(axisIndex => closestSigns[axisIndex]))).join('');
    const planeCorners = GIZMO_PLANES.map(plane => planeScaleCornerMarkup(handles, gizmoOrigin, plane, pixelWorld,
      plane.axes.map(axisIndex => closestSigns[axisIndex]))).join('');
    const axesMarkup = handles.flatMap(handle => [-1, 1].map(sign => prismMarkup({ ...handle, centerX: center.x, centerY: center.y }, gizmoOrigin, `axis-${classes[handle.axis]}`, pixelWorld, sign))).join('');
    gizmo.innerHTML = `${planes}${axesMarkup}${planeCorners}${centerCubeMarkup(gizmoOrigin, axes, pixelWorld)}`;
  }
  sortGizmoControlsByDepth(gizmo);
  if (state.dragging?.type === 'transform' && ['move', 'resize', 'pivot'].includes(state.dragging.tool)) {
    const guideAxes = state.dragging.kind.startsWith('plane')
      ? state.dragging.axisIndices
      : state.dragging.axisIndex === null ? [] : [state.dragging.axisIndex];
    const guides = guideAxes.map(axisIndex => infiniteGuideMarkup(state.gizmoAxes[axisIndex], width, height, `axis-${classes[axisIndex]}`)).join('');
    gizmo.innerHTML = guides + gizmo.innerHTML;
  }
  if (state.dragging?.type === 'transform') {
    const axis = state.dragging.axisKey;
    const sign = state.dragging.axisIndex === null ? '' : `[data-sign="${state.dragging.sign}"]`;
    const active = gizmo.querySelector(`[data-axis="${axis}"]${sign}`) || gizmo.querySelector(`[data-axis="${axis}"]`);
    active?.classList.add('active');
    state.dragging.handleElement = active;
  }
  gizmo.removeAttribute('hidden');
}

function updateTexturePreviewFrame(width, height) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const preview = $('#texturePreview');
  preview.style.setProperty('--texture-aspect', `${safeWidth} / ${safeHeight}`);
  $('.texture-preview > span').textContent = `${safeWidth} × ${safeHeight}`;
}

function syncRendererTexture(source) {
  sceneRenderer.setTexture(source);
  uvPreviewTextureDirty = true;
  if (uvPreviewIsActive()) {
    uvPreviewRenderer.setTexture(source);
    uvPreviewTextureDirty = false;
  }
}

function renderTexture() {
  textureCanvas.width = 1;
  textureCanvas.height = 1;
  textureCtx.imageSmoothingEnabled = false;
  textureCtx.fillStyle = '#fff';
  textureCtx.fillRect(0, 0, 1, 1);
  syncRendererTexture(textureCanvas);
  textureCtx.clearRect(0, 0, 1, 1);
  $('#texturePreview').style.setProperty('--texture-aspect', '1 / 1');
  $('.texture-preview > span').textContent = '無貼圖';
}

const paletteRows = [
  { id: crypto.randomUUID(), name: '苔原', gradient: false, marker: .5, colors: ['#172016','#273522','#3a4d2c','#526b35','#708d42','#91ad52','#b4ce68','#d3e18b','#e9efb3','#f5f5da','#c8a85a','#a77a3f','#76502f','#463324'] },
  { id: crypto.randomUUID(), name: '深潭', gradient: false, marker: .5, colors: ['#11191b','#1d2a29','#2b403a','#3b5b4c','#4b7560','#629178','#7aaf91','#9bc9aa','#c3dfc9','#f1f3dd','#8baab2','#587989','#365261','#263640'] },
  { id: crypto.randomUUID(), name: '暖岩', gradient: false, marker: .5, colors: ['#22191b','#402329','#663233','#8b443b','#b65e48','#d9805a','#eca875','#f6d09b','#f4e4c2','#8b705b','#66503e','#48382f','#2f2926','#1c1d19'] }
];

function renderPalette() {
  $('#paletteSummary').textContent = `${paletteRows.length} 行 · 每行獨立設定`;
  $('#paletteRows').innerHTML = paletteRows.map((row, index) => `
    <div class="palette-row-card" data-palette-id="${row.id}">
      <div class="palette-row-controls">
        <span class="palette-row-name" title="${escapeAttribute(row.name)}">${escapeHtml(row.name)}</span>
        <label class="row-gradient-toggle" title="此行使用連續漸變">
          <input type="checkbox" data-gradient-row="${index}" ${row.gradient ? 'checked' : ''} /> 漸變
        </label>
        <button class="delete-palette-row" data-delete-row="${index}" title="刪除此行">×</button>
      </div>
      ${row.gradient
        ? `<div class="gradient-picker" data-gradient-picker="${index}" style="background:linear-gradient(90deg, ${row.colors.join(', ')})"><i class="gradient-marker" style="left:${row.marker * 100}%"></i></div>`
        : `<div class="palette-row">${row.colors.map(color => `<button class="swatch" data-color="${color}" style="background:${color}" title="${color}"></button>`).join('')}</div>`}
    </div>`).join('');

  $$('.swatch').forEach(swatch => swatch.addEventListener('click', () => { snapshot(); applyPaletteColor(swatch.dataset.color); }));
  $$('[data-gradient-row]').forEach(toggle => toggle.addEventListener('change', () => {
    paletteRows[Number(toggle.dataset.gradientRow)].gradient = toggle.checked;
    renderPalette();
  }));
  $$('[data-delete-row]').forEach(button => button.addEventListener('click', () => {
    if (paletteRows.length === 1) return toast('至少保留一行色卡');
    paletteRows.splice(Number(button.dataset.deleteRow), 1);
    renderPalette();
  }));
  $$('[data-gradient-picker]').forEach(picker => {
    picker.addEventListener('pointerdown', event => {
      event.preventDefault(); snapshot(); picker.setPointerCapture(event.pointerId); pickGradientColor(picker, event);
    });
    picker.addEventListener('pointermove', event => { if (picker.hasPointerCapture(event.pointerId)) pickGradientColor(picker, event); });
  });
}

function addPaletteRow() {
  const number = paletteRows.length + 1;
  paletteRows.push({
    id: crypto.randomUUID(), name: `自定義 ${number}`, gradient: false, marker: .5,
    colors: ['#101410', '#283323', '#4c6338', '#78964d', '#a9c866', '#d8e79a', '#f1f3d0']
  });
  renderPalette();
  const rows = $('#paletteRows'); rows.scrollTop = rows.scrollHeight;
}

function pickGradientColor(picker, event) {
  const index = Number(picker.dataset.gradientPicker);
  const rect = picker.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  paletteRows[index].marker = ratio;
  picker.querySelector('.gradient-marker').style.left = `${ratio * 100}%`;
  applyPaletteColor(sampleGradient(paletteRows[index].colors, ratio), false);
}

function sampleGradient(colors, ratio) {
  if (colors.length === 1) return colors[0];
  const scaled = ratio * (colors.length - 1);
  const left = Math.floor(scaled);
  const right = Math.min(colors.length - 1, left + 1);
  const amount = scaled - left;
  const a = hexToRgb(colors[left]), b = hexToRgb(colors[right]);
  return `#${a.map((channel, axis) => Math.round(channel + (b[axis] - channel) * amount).toString(16).padStart(2, '0')).join('')}`;
}

function applyPaletteColor(color, notify = true) {
  const item = selected();
  if (!item) return toast('先選擇一個物件');
  item.color = color;
  markDirty(); renderAll('selection');
  if (notify) toast(`已套用 ${color}`);
}

function activeSnapSubdivisions() {
  const projectValue = Number(state.project.snap?.subdivisions);
  return Number.isFinite(projectValue) && projectValue > 0 ? projectValue : state.settingsSnap;
}

function updateSnapButton() {
  const value = activeSnapSubdivisions();
  $('#snapButton').textContent = `吸附 ${formatNumber(value)} · ${formatNumber(16 / value)}px`;
}

function cycleSnap(direction = 1) {
  const values = [4, 8, 16, 32, 64];
  const currentIndex = values.indexOf(activeSnapSubdivisions());
  const nextIndex = currentIndex < 0
    ? direction < 0 ? values.length - 1 : 0
    : (currentIndex + direction + values.length) % values.length;
  const next = values[nextIndex];
  if (!state.project.snap) state.project.snap = {};
  state.project.snap.subdivisions = next;
  updateSnapButton();
  markDirty();
  toast(`吸附精度 ${next}（${formatNumber(16 / next)} px）`);
}

function textureUid(asset = {}) {
  return asset._uid || asset.uuid || asset.id || `texture_${crypto.randomUUID()}`;
}

function textureItemMarkup(asset, index) {
  return `<button class="texture-item ${asset._uid === state.activeTextureUid ? 'active' : ''}" draggable="true"
      data-texture-uid="${escapeAttribute(asset._uid)}" data-texture-index="${index}">
    <span class="texture-thumb" style="background-image:url(&quot;${escapeAttribute(asset.source || '')}&quot;);background-size:cover;image-rendering:pixelated"></span>
    <span><strong>${escapeHtml(asset.name || `texture_${index + 1}.png`)}</strong><small>${asset.uvWidth || '?'} × ${asset.uvHeight || '?'} · ${asset.kind || 'IMAGE'}</small></span><i>◉</i>
  </button>`;
}

function renderTextureList() {
  const list = $('#textureList');
  const ungrouped = state.textureAssets.filter(asset => !asset.groupId);
  const groups = state.textureGroups.map(group => {
    const assets = state.textureAssets.filter(asset => asset.groupId === group.id);
    return `<section class="texture-group" data-texture-group="${group.id}" draggable="true">
      <button class="texture-group-header" data-texture-group-toggle="${group.id}">${openIconMarkup(group.collapsed ? 'right' : 'down', 'texture-disclosure')}<strong>${escapeHtml(group.name)}</strong><small>${assets.length}</small></button>
      <div class="texture-group-items" ${group.collapsed ? 'hidden' : ''}>${assets.map(asset => textureItemMarkup(asset, state.textureAssets.indexOf(asset))).join('')}</div>
    </section>`;
  }).join('');
  list.innerHTML = ungrouped.map(asset => textureItemMarkup(asset, state.textureAssets.indexOf(asset))).join('') + groups;
}

function addTextureGroup() {
  const group = { id: `texture_group_${crypto.randomUUID()}`, name: `貼圖組 ${state.textureGroups.length + 1}`, collapsed: false };
  state.textureGroups.push(group);
  const active = state.textureAssets.find(asset => asset._uid === state.activeTextureUid);
  if (active) active.groupId = group.id;
  renderTextureList();
  toast('已新增貼圖組');
}

function importTexture(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    textureCanvas.width = image.naturalWidth;
    textureCanvas.height = image.naturalHeight;
    textureCtx.imageSmoothingEnabled = false;
    textureCtx.clearRect(0, 0, image.naturalWidth, image.naturalHeight);
    textureCtx.drawImage(image, 0, 0);
    syncRendererTexture(textureCanvas);
    renderScene();
    updateTexturePreviewFrame(image.naturalWidth, image.naturalHeight);
    const asset = { _uid: textureUid(), name: file.name, source: url, uvWidth: image.naturalWidth, uvHeight: image.naturalHeight,
      kind: file.type.split('/')[1]?.toUpperCase() || 'IMAGE', groupId: null };
    state.textureAssets.unshift(asset);
    state.activeTextureUid = asset._uid;
    renderTextureList();
    toast(`已導入貼圖 ${file.name}`);
  };
  image.onerror = () => { URL.revokeObjectURL(url); toast('無法讀取這張圖片'); };
  image.src = url;
}

function loadTextureSource(source, name) {
  const image = new Image();
  image.onload = () => {
    textureCanvas.width = image.naturalWidth;
    textureCanvas.height = image.naturalHeight;
    textureCtx.imageSmoothingEnabled = false;
    textureCtx.clearRect(0, 0, image.naturalWidth, image.naturalHeight);
    textureCtx.drawImage(image, 0, 0);
    syncRendererTexture(textureCanvas);
    updateTexturePreviewFrame(image.naturalWidth, image.naturalHeight);
    const activeName = $('.texture-item.active strong');
    if (activeName) activeName.textContent = name;
    renderScene();
  };
  image.src = source;
}

function installProjectTextures(assets) {
  state.textureGroups = [];
  state.textureAssets = assets.map(asset => ({ ...asset, _uid: textureUid(asset), groupId: asset.groupId || null }));
  state.activeTextureUid = null;
  if (!assets.length) {
    renderTextureList();
    renderTexture();
    renderScene();
    return;
  }
  renderTextureList();
  const defaultIndex = state.textureAssets.findIndex(asset => asset.useAsDefault);
  activateProjectTexture(defaultIndex >= 0 ? defaultIndex : 0);
}

function activateProjectTexture(index) {
  const asset = state.textureAssets[index];
  if (!asset) return;
  state.activeTextureUid = asset._uid;
  $$('.texture-item').forEach(item => item.classList.toggle('active', item.dataset.textureUid === asset._uid));
  loadTextureSource(asset.source, asset.name);
}

function setMode(mode) {
  state.mode = mode;
  if (mode !== 'animate' && state.timelinePlaying) stopTimeline();
  dockManager?.setMode(mode);
  $$('.mode-tab').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  updateToolVisibility();
  if (!TOOL_REGISTRY[state.tool]?.modes.includes(mode)) setTool(mode === 'paint' ? 'brush' : 'move');
  $('#viewLabel').textContent = mode === 'paint' ? '貼圖預覽' : mode === 'animate' ? '動畫預覽' : '實體著色';
  if (mode === 'paint') activateDock('palette');
  if (mode === 'animate') activateDock('timeline');
  toast({ edit: '編輯模式', paint: '繪畫模式', animate: '動畫模式' }[mode]);
}

function updateToolVisibility() {
  $$('.tool[data-tool]').forEach(button => {
    const definition = TOOL_REGISTRY[button.dataset.tool];
    button.hidden = !definition || !definition.modes.includes(state.mode);
  });
}

function setTool(tool) {
  if (!TOOL_REGISTRY[tool]?.modes.includes(state.mode)) return;
  if (tool !== 'vertexSnap') state.vertexSnapSource = null;
  if (tool !== 'knife') cancelKnifeSelection(false);
  state.tool = tool;
  sceneCanvas.classList.toggle('is-knife', tool === 'knife');
  $$('.tool').forEach(button => button.classList.toggle('active', button.dataset.tool === tool));
  updateToolOptions();
  renderScene();
}

function updateToolOptions() {
  const lane = $('#toolOptionsLane');
  const labels = { move: '移動', resize: '縮放', rotate: '旋轉', pivot: '移動樞軸', vertexSnap: '頂點捕捉', knife: '刀具切割' };
  lane.hidden = !labels[state.tool];
  $('#transformSpaceControl').hidden = !['move', 'rotate', 'pivot'].includes(state.tool);
  $('#rotationModeControl').hidden = state.tool !== 'rotate' || state.transformSpace !== 'self';
  $('#multiTransformModeControl').hidden = selectedTopLevelNodes().length < 2 || !['move', 'rotate'].includes(state.tool);
  $('#scaleHandleModeControl').hidden = state.tool !== 'resize';
  $('#vertexSnapModeControl').hidden = state.tool !== 'vertexSnap';
  $('#vertexSnapRotationControl').hidden = state.tool !== 'vertexSnap' || state.vertexSnapMode !== 'rotate';
  $('#vertexSnapStatus').hidden = state.tool !== 'vertexSnap';
  $('#vertexSnapStatus').textContent = state.vertexSnapSource ? '再選目標頂點' : '先選來源頂點';
  $('#knifeStatus').hidden = state.tool !== 'knife';
  const knifePreview = getKnifePreviewLabel();
  $('#knifeStatus').textContent = knifePreview ? `預覽：${knifePreview}` : state.knifeSelection ? '選擇橫切或豎切' : '選擇切割點';
  if (!lane.hidden) $('#toolContext').textContent = labels[state.tool];
  updateTransformSpaceButtons();
  updateRotationModeButtons();
  updateScaleHandleModeButtons();
  updateMultiTransformModeButtons();
  $$('[data-vertex-snap-mode]').forEach(button => button.classList.toggle('active', button.dataset.vertexSnapMode === state.vertexSnapMode));
  $$('[data-vertex-rotation-mode]').forEach(button => button.classList.toggle('active', button.dataset.vertexRotationMode === state.vertexSnapRotationMode));
}

const renderModeLabels = Object.freeze({ wireframe: '線框', solid: '體塊', textured: '紋理' });

function updateRenderModeControl() {
  const label = renderModeLabels[state.renderMode] || renderModeLabels.textured;
  const button = $('#renderModeButton');
  button.dataset.mode = state.renderMode;
  button.dataset.tooltip = `目前：${label}`;
  button.title = `目前：${label}`;
  button.setAttribute('aria-label', `目前渲染模式：${label}`);
  $$('[data-render-mode]').forEach(option => option.classList.toggle('active', option.dataset.renderMode === state.renderMode));
}

function setRenderModeMenu(open) {
  $('#renderModeMenu').hidden = !open;
  $('#renderModeButton').setAttribute('aria-expanded', String(open));
}

function activateDock(name) {
  $$('.dock-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.dock === name));
  $$('[data-dock-view]').forEach(view => view.classList.toggle('active', view.dataset.dockView === name));
  dockManager?.expand('bottom');
}

async function openProject() {
  try {
    if (window.cubeBricksDesktop) {
      const result = await window.cubeBricksDesktop.openProject();
      if (!result) return;
      loadProjectContent(result.content, result.filePath, result.textureAssets || []);
    } else fileInput.click();
  } catch (error) { toast(`打開失敗：${error.message}`); }
}

function loadProjectContent(content, filePath = '', resolvedTextures = []) {
  const data = JSON.parse(content);
  const project = filePath.toLowerCase().endsWith('.bbmodel') || data.meta?.model_format ? importBlockbench(data) : new CubeBricksProject(data);
  const savedPath = filePath.toLowerCase().endsWith('.cbmodel') ? filePath : null;
  const embeddedTextures = (data.textures || []).filter(texture => typeof texture.source === 'string' && texture.source.startsWith('data:image/')).map(texture => ({
    uuid: texture.uuid, id: texture.id, name: texture.name || 'embedded_texture.png', source: texture.source,
    uvWidth: texture.uv_width, uvHeight: texture.uv_height, useAsDefault: texture.use_as_default === true
  }));
  addProjectTab(project, {
    filePath: savedPath,
    displayName: filePath ? filePath.split(/[\\/]/).pop() : null,
    textureAssets: resolvedTextures.length ? resolvedTextures : embeddedTextures,
    dirty: !savedPath
  });
  markDirty(!savedPath);
  toast(`已打開 ${project.name}`);
}

async function saveProject(saveAs = false) {
  try {
    const content = state.project.serialize();
    if (window.cubeBricksDesktop) {
      const result = await window.cubeBricksDesktop.saveProject({ filePath: saveAs ? null : state.filePath, name: state.project.name, content });
      if (!result) return;
      state.filePath = result.filePath;
      const tab = projectTabById(activeProjectTabId);
      if (tab) tab.displayName = null;
    } else download(content, `${state.project.name}.cbmodel`, 'application/json');
    markDirty(false); toast('項目已保存');
  } catch (error) { toast(`保存失敗：${error.message}`); }
}

async function exportProject() {
  try {
    const textureAssets = await Promise.all(state.textureAssets.map(async texture => {
      if (!String(texture.source || '').startsWith('blob:')) return texture;
      const blob = await fetch(texture.source).then(response => response.blob());
      const source = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('貼圖轉換失敗'));
        reader.readAsDataURL(blob);
      });
      return { ...texture, source };
    }));
    const content = JSON.stringify(exportBlockbench(state.project, textureAssets), null, 2);
    download(content, `${state.project.name}.bbmodel`, 'application/json');
    toast('已導出 .bbmodel（程序化物件已轉為 Cube 組）');
  } catch (error) {
    toast(`導出失敗：${error.message}`);
  }
}

function download(content, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

const MODEL_FORMAT_ICONS = Object.freeze({
  generic: '<path d="M4 12 12 8l8 4-8 4-8-4Z" stroke="none"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5" fill="none" stroke-width="1.8"/><circle cx="8.3" cy="9" r="1.7" stroke="none"/><path d="m5.5 17 4.4-4.4 3.1 3 2.5-2.4 3 3.8" fill="none" stroke-width="1.8"/>',
  'java-block': '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5M12 12 4 7.5M12 12v9" fill="none" stroke-width="1.8"/>',
  'bedrock-entity': '<path d="m12 3 5 2.8v5.7L12 14l-5-2.5V5.8L12 3Z" stroke="none"/><path d="M5 18.5h14M8 14.5v4m8-4v4" fill="none" stroke-width="1.8"/>',
  'bedrock-block': '<path d="M5 7.5 12 4l7 3.5v9L12 20l-7-3.5v-9Zm7 1v7m-7-8 7 3.5 7-3.5" fill="none" stroke-width="1.8"/><path d="M8 9v5l4 2" fill="none" stroke-width="1.8"/>',
  'modded-entity': '<path d="M7 8h10v9a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4V8Zm10 2h2a2 2 0 0 1 0 4h-2M9 5h6" fill="none" stroke-width="1.8"/>',
  skin: '<circle cx="12" cy="5.3" r="2.8" stroke="none"/><path d="M9.2 9h5.6l1.2 5-2 1v6h-1.5l-.5-5-.5 5H10v-6l-2-1 1.2-5Z" stroke="none"/>',
  geckolib: '<path d="m12 3.5 7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7L12 3.5Z" fill="none" stroke-width="1.7" stroke-dasharray="3 2"/><path d="M8 8.5h8v7H8z" fill="none" stroke-width="1.7"/>'
});

function modelFormatIconMarkup(icon) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${MODEL_FORMAT_ICONS[icon] || MODEL_FORMAT_ICONS.generic}</svg>`;
}

function renderModelFormatPicker() {
  const container = $('#modelFormatList');
  if (!container) return;
  const categories = new Map();
  for (const format of modelFormatRegistry.list()) {
    if (!categories.has(format.category)) categories.set(format.category, []);
    categories.get(format.category).push(format);
  }
  const categoryLabels = { general: '通用', minecraft: 'Minecraft' };
  container.innerHTML = [...categories].map(([category, formats]) => `<section class="model-format-category">
    <h3>${escapeHtml(categoryLabels[category] || category)}</h3>
    <div class="model-format-grid">${formats.map(format => {
      const placeholder = format.status === 'placeholder';
      const snap = Number(format.snap?.subdivisions);
      const details = [format.description, Number.isFinite(snap) ? `標準吸附 ${formatNumber(snap)} · ${formatNumber(16 / snap)}px` : ''].filter(Boolean).join(' · ');
      return `<button type="button" class="model-format-card ${placeholder ? 'is-placeholder' : ''}" data-model-format="${escapeAttribute(format.id)}" aria-disabled="${placeholder}">
        <span class="model-format-card-icon">${modelFormatIconMarkup(format.icon)}</span>
        <span class="model-format-card-copy"><strong>${escapeHtml(format.name)}</strong><small>${escapeHtml(details)}</small></span>
        ${placeholder ? `<span class="model-format-placeholder">佔位</span>` : ''}
      </button>`;
    }).join('')}</div>
  </section>`).join('');
}

function openNewProjectDialog() {
  renderModelFormatPicker();
  newProjectDialog.showModal();
}

function newProject(formatId) {
  const format = modelFormatRegistry.get(formatId);
  if (!format) return toast('未知模型格式');
  if (format.status === 'placeholder') return toast(format.placeholderReason || '這個格式尚未實現');
  const initialData = createModelProjectData(format.id, {
    name: 'untitled',
    language: configRegistry.get(ConfigKey.LANGUAGE)
  });
  const project = new CubeBricksProject({ name: 'untitled', ...initialData });
  addProjectTab(project, { dirty: true, textureAssets: [] });
  newProjectDialog.close();
  markDirty(); toast(`已建立 ${format.name}`);
}

const themePresets = {
  moss: { '--accent': '#b9f55a', '--selection-outline': '#d8f59b', '--bg': '#11130f', '--panel': '#1b1f18', '--viewport': '#20251e', '--panel-2': '#22271f', '--panel-3': '#292f25', '--text': '#e9eee3', '--muted': '#8f9b86', '--subtle': '#5f6959', '--line': 'rgba(226, 239, 213, .1)', '--line-strong': 'rgba(226, 239, 213, .18)', '--danger': '#ff7d68', '--accent-contrast': '#17200e', '--surface-tint': '#2b3327', '--dialog-tint': '#38432e', '--viewport-glow': '#53604d' },
  amber: { '--accent': '#e6a20d', '--selection-outline': '#fff0c8', '--bg': '#140904', '--panel': '#1c0d06', '--viewport': '#21120b', '--panel-2': '#241108', '--panel-3': '#2d160b', '--text': '#fff4d8', '--muted': '#c7a77a', '--subtle': '#765738', '--line': 'rgba(255, 224, 171, .11)', '--line-strong': 'rgba(255, 224, 171, .2)', '--danger': '#ff765f', '--accent-contrast': '#261306', '--surface-tint': '#3a1c0b', '--dialog-tint': '#4a260e', '--viewport-glow': '#5a3518' },
  ember: { '--accent': '#ff9d57', '--selection-outline': '#ffd0a6', '--bg': '#160f0e', '--panel': '#241917', '--viewport': '#291d1b', '--panel-2': '#2d201d', '--panel-3': '#362623', '--text': '#f3e7e0', '--muted': '#aa8d82', '--subtle': '#755d55', '--line': 'rgba(255, 220, 202, .1)', '--line-strong': 'rgba(255, 220, 202, .18)', '--danger': '#ff7565', '--accent-contrast': '#27110b', '--surface-tint': '#3c2420', '--dialog-tint': '#4a2d27', '--viewport-glow': '#5a3931' },
  slate: { '--accent': '#65d7e8', '--selection-outline': '#a7f0fa', '--bg': '#0d1115', '--panel': '#171e24', '--viewport': '#1b242b', '--panel-2': '#1d2830', '--panel-3': '#25323b', '--text': '#e4eef2', '--muted': '#8b9da7', '--subtle': '#5c6c75', '--line': 'rgba(211, 237, 245, .1)', '--line-strong': 'rgba(211, 237, 245, .18)', '--danger': '#ff7d68', '--accent-contrast': '#092126', '--surface-tint': '#263640', '--dialog-tint': '#304550', '--viewport-glow': '#405965' }
};

const themeVariableKeys = [...new Set(Object.values(themePresets).flatMap(preset => Object.keys(preset)))];

function setThemeVar(key, value, persist = true) {
  document.documentElement.style.setProperty(key, value);
  if (key === '--accent') document.documentElement.style.setProperty('--accent-rgb', hexToRgb(value).join(', '));
  if (key === '--selection-outline') sceneRenderer.setSelectionOutline(value);
  if (key === '--radius') $('#radiusOutput').textContent = value;
  if (key === '--ui-scale') {
    const scale = Math.max(1, Number.parseFloat(value) || 100) / 100;
    document.documentElement.style.fontSize = `${21 * scale}px`;
    $('#scaleOutput').textContent = value;
  }
  if (persist) saveTheme();
  renderScene();
}

function saveTheme() {
  const computed = getComputedStyle(document.documentElement);
  const theme = Object.fromEntries(themeVariableKeys.map(key => [key, computed.getPropertyValue(key).trim()]));
  $$('[data-theme-var]').forEach(input => theme[input.dataset.themeVar] = input.dataset.unit ? `${input.value}${input.dataset.unit}` : input.value);
  localStorage.setItem('cubebricks.theme', JSON.stringify(theme));
}

function loadTheme() {
  const raw = localStorage.getItem('cubebricks.theme');
  if (!raw) return;
  try {
    const theme = JSON.parse(raw);
    Object.entries(theme).forEach(([key, value]) => {
      setThemeVar(key, value, false);
      const input = $(`[data-theme-var="${key}"]`);
      if (input) input.value = String(value).replace(input.dataset.unit || '', '');
    });
  } catch { localStorage.removeItem('cubebricks.theme'); }
}

function applyPreset(name) {
  Object.entries(themePresets[name]).forEach(([key, value]) => {
    const input = $(`[data-theme-var="${key}"]`); if (input) input.value = value;
    setThemeVar(key, value, false);
  });
  saveTheme(); toast('外觀已套用');
}

function initializeConfigRegistry() {
  configRegistry.list().forEach(definition => applyRegisteredConfig(definition.id, configRegistry.get(definition.id), false));
  configRegistry.subscribe(change => applyRegisteredConfig(change.id, change.value, true));

  window.CubeBricks = Object.freeze({
    config: Object.freeze({
      get: id => configRegistry.get(id),
      set: (id, value) => configRegistry.set(id, value, { source: 'public-api' }),
      reset: id => configRegistry.reset(id, { source: 'public-api' }),
      list: () => configRegistry.list(),
      subscribe: (id, listener) => configRegistry.subscribe(id, listener)
    }),
    docks: Object.freeze({
      list: () => dockManager?.getIndex() || [],
      get: id => dockManager?.getIndex().find(panel => panel.id === id) || null
    }),
    formats: Object.freeze({
      list: () => modelFormatRegistry.list(),
      get: id => modelFormatRegistry.get(id),
      current: () => modelFormatRegistry.get(state.project.formatId),
      register: definition => modelFormatRegistry.register(definition),
      subscribe: listener => modelFormatRegistry.subscribe(listener)
    })
  });
}

function applyRegisteredConfig(id, value, notify = false) {
  const control = $(`[data-config-key="${id}"]`);
  if (control) control.type === 'checkbox' ? control.checked = Boolean(value) : control.value = String(value);

  if (id === ConfigKey.LANGUAGE) {
    languageSelect.value = value; applyLanguage(value);
    if (notify) toast(`介面語言：${getLanguageLabel(value)}`);
  }
  if (id === ConfigKey.SNAP) {
    state.settingsSnap = value;
    updateSnapButton();
  }
  if (id === ConfigKey.ALLOW_NEGATIVE_SIZE) state.allowNegativeSize = value;
  if (id === ConfigKey.SHIFT_SNAP_MODE) state.modifierSnap.shift.mode = value;
  if (id === ConfigKey.SHIFT_SNAP_VALUE) state.modifierSnap.shift.value = value;
  if (id === ConfigKey.CTRL_SNAP_MODE) state.modifierSnap.ctrl.mode = value;
  if (id === ConfigKey.CTRL_SNAP_VALUE) state.modifierSnap.ctrl.value = value;
  if (id === ConfigKey.SHIFT_CTRL_SNAP_MODE) state.modifierSnap.shiftCtrl.mode = value;
  if (id === ConfigKey.SHIFT_CTRL_SNAP_VALUE) state.modifierSnap.shiftCtrl.value = value;
  if (id === ConfigKey.SYMMETRY) { state.symmetry = value; $('#symmetryToggle').checked = value; }
  if (id === ConfigKey.ALPHA_LOCK) { state.alphaLock = value; $('#alphaLockToggle').checked = value; }
  if (id === ConfigKey.PREVIEW_SHADE) { state.previewShade = value; $('#previewShadeToggle').checked = value; }
  if (id === ConfigKey.SHOW_GEOMETRY_ONLY) { state.geometryOnly = value; $('#geometryOnlyToggle').checked = value; }
  if (id === ConfigKey.PROJECTION) {
    if (state.projection && state.projection !== value) {
      state.zoom = mapProjectionZoom(state.zoom, state.projection, value);
    }
    state.projection = value;
    $$('[data-projection]').forEach(button => button.classList.toggle('active', button.dataset.projection === value));
  }
  if (id === ConfigKey.SHOW_GRID) state.grid = value;
  if (id === ConfigKey.SHOW_WIREFRAME) state.wire = value;
  if (id === ConfigKey.LOCKED_DEFAULT_ALPHA) state.lockedDefaultAlpha = value;
  if (id === ConfigKey.LOCKED_HOVER_FADE) {
    state.lockedHoverFade = value;
    if (!value) animateLockedHoverStrength(false);
  }
  if (id === ConfigKey.LOCKED_HOVER_ALPHA) state.lockedHoverAlpha = value;
  if (id === ConfigKey.LOCKED_HOVER_RADIUS) state.lockedHoverRadius = value;
  if (notify && id !== ConfigKey.LANGUAGE) renderScene();
}

function mapProjectionZoom(zoom, fromProjection, toProjection) {
  if (fromProjection === toProjection) return zoom;
  const perspectiveHalfHeightAtUnitZoom = 42 * Math.tan(45 * Math.PI / 360);
  const orthographicHalfHeightAtUnitZoom = 18;
  const mapped = fromProjection === 'perspective' && toProjection === 'orthographic'
    ? zoom * orthographicHalfHeightAtUnitZoom / perspectiveHalfHeightAtUnitZoom
    : zoom * perspectiveHalfHeightAtUnitZoom / orthographicHalfHeightAtUnitZoom;
  return Math.max(.002, Math.min(100, mapped));
}

function setConfigFromControl(control) {
  const definition = configRegistry.getDefinition(control.dataset.configKey);
  let value = control.type === 'checkbox' ? control.checked : control.value;
  if (definition.type === 'number') value = Number(value);
  if (definition.type === 'enum') value = definition.options.find(option => String(option.value) === String(value))?.value;
  try {
    configRegistry.set(definition.id, value, { source: 'settings-panel' });
  } catch {
    control.type === 'checkbox' ? control.checked = Boolean(configRegistry.get(definition.id)) : control.value = String(configRegistry.get(definition.id));
    toast('這個配置值無效');
  }
}

function initializeDockSystem() {
  dockManager = new DockManager({
    root: $('.workspace'),
    definitions: DOCK_PANEL_DEFINITIONS,
    onInteraction: active => {
      state.layoutResizing = active;
      if (active) stopUvPreviewAnimation();
      else requestAnimationFrame(refreshUvPreview);
    },
    onLayoutChange: () => {
      scheduleOutlinerWindow();
      requestAnimationFrame(renderScene);
    }
  });
  dockManager.setMode(state.mode);
}

let contextMenuSource = null;

function closeContextMenu() {
  $('#contextMenu').hidden = true;
  contextMenuSource?.classList.remove('context-active');
  contextMenuSource = null;
}

function showContextMenu(event, { title = '', source = null, items = [] } = {}) {
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();
  const menu = $('#contextMenu');
  contextMenuSource = source;
  source?.classList.add('context-active');
  menu.innerHTML = `${title ? `<div class="context-menu-title">${escapeHtml(title)}</div>` : ''}`;
  items.forEach(item => {
    if (item.separator) {
      menu.insertAdjacentHTML('beforeend', '<div class="context-menu-separator" role="separator"></div>');
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'menuitem';
    if (item.danger) button.classList.add('danger');
    button.innerHTML = `${item.icon ? `<span>${item.icon}</span>` : ''}<span>${escapeHtml(item.label)}</span>`;
    button.addEventListener('click', () => {
      closeContextMenu();
      item.action?.();
    });
    menu.append(button);
  });
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, event.clientX))}px`;
  menu.style.top = `${Math.max(8, Math.min(window.innerHeight - rect.height - 8, event.clientY))}px`;
  menu.querySelector('button')?.focus({ preventScroll: true });
}

function setActiveTextureItem(item) {
  if (!item) return;
  const index = state.textureAssets.findIndex(asset => asset._uid === item.dataset.textureUid);
  if (index >= 0) activateProjectTexture(index);
}

function showElementContextMenu(event, uidValue, source = null) {
  if (!state.project.getNode(uidValue)) return;
  if (!state.selectedUids.has(uidValue)) selectItem(uidValue);
  const node = state.project.getNode(uidValue);
  const selectedNodes = selectedNodeUids().map(id => state.project.getNode(id)).filter(Boolean);
  const allVisible = selectedNodes.every(entry => entry.visible);
  showContextMenu(event, {
    title: selectedNodes.length > 1 ? `已選 ${selectedNodes.length} 項` : node.name,
    source,
    items: [
      { icon: '⌖', label: '聚焦此物件', action: focusSelected },
      { icon: allVisible ? '○' : '◉', label: allVisible ? '隱藏選中項' : '顯示選中項', action: () => {
        snapshot(); selectedNodes.forEach(entry => setNodeVisibility(entry, !allVisible)); markDirty(); renderAll();
      } },
      ...(node.type === 'group' ? [{
        icon: openIconMarkup(state.collapsedGroups.has(node.uid) ? 'down' : 'up', 'context-open-icon'),
        label: state.collapsedGroups.has(node.uid) ? '展開組' : '折疊組',
        action: () => {
          state.collapsedGroups.has(node.uid) ? state.collapsedGroups.delete(node.uid) : state.collapsedGroups.add(node.uid);
          renderOutliner();
        }
      }] : []),
      ...(selectedNodes.length > 1 ? [{ icon: '▰', label: '將選中項建立為組', action: addGroup }] : []),
      { separator: true },
      { icon: '×', label: '刪除選中項', danger: true, action: deleteSelected }
    ]
  });
}

function bindContextMenus() {
  $('#viewport').addEventListener('contextmenu', event => {
    if (state.tool === 'knife' && state.knifeSelection) {
      event.preventDefault();
      event.stopPropagation();
      cancelKnifeSelection();
      return;
    }
    if (state.tool === 'vertexSnap' && state.vertexSnapSource) {
      event.preventDefault();
      event.stopPropagation();
      state.vertexSnapSource = null;
      updateToolOptions();
      renderScene();
      toast('已取消來源頂點');
      return;
    }
    const rect = sceneCanvas.getBoundingClientRect();
    const hitUid = sceneRenderer.pick(state.project, event.clientX - rect.left, event.clientY - rect.top, state.geometryOnly);
    if (hitUid) {
      showElementContextMenu(event, hitUid);
      return;
    }
    const activeCurve = selected();
    if (isBezierElement(activeCurve) && Number.isInteger(state.selectedCurveNodeIndex)) {
      event.preventDefault();
      event.stopPropagation();
      addCurveNodeAtViewportPoint(activeCurve, event, rect);
      return;
    }
    showContextMenu(event, {
      title: selected()?.name || state.project.name,
      items: [
        { icon: '⌖', label: '聚焦選中物件', action: focusSelected },
        { icon: '◎', label: '回到場景中心', action: focusSceneOrigin },
        { separator: true },
        { icon: '#', label: state.grid ? '隱藏網格' : '顯示網格', action: () => configRegistry.set(ConfigKey.SHOW_GRID, !state.grid, { source: 'viewport-context-menu' }) },
        { icon: '▧', label: state.wire ? '隱藏邊界線框' : '顯示邊界線框', action: () => configRegistry.set(ConfigKey.SHOW_WIREFRAME, !state.wire, { source: 'viewport-context-menu' }) }
      ]
    });
  });
  outliner.addEventListener('contextmenu', event => {
    const item = event.target.closest('.outliner-item');
    if (!item) { event.preventDefault(); event.stopPropagation(); return; }
    const uidValue = item.dataset.uid;
    const source = outliner.querySelector(`[data-uid="${uidValue}"]`);
    showElementContextMenu(event, uidValue, source);
  });
  $('#textureList').addEventListener('contextmenu', event => {
    const item = event.target.closest('.texture-item');
    const groupNode = event.target.closest('.texture-group');
    if (item) setActiveTextureItem(item);
    if (item) {
      const asset = state.textureAssets.find(entry => entry._uid === item.dataset.textureUid);
      return showContextMenu(event, { title: asset?.name || '貼圖', source: item, items: [
        { icon: '◉', label: '設為目前貼圖', action: () => setActiveTextureItem(item) },
        { icon: '▰', label: '移到新貼圖組', action: addTextureGroup },
        { separator: true },
        { icon: '×', label: '刪除貼圖', danger: true, action: () => {
          state.textureAssets = state.textureAssets.filter(entry => entry._uid !== asset?._uid);
          if (state.activeTextureUid === asset?._uid) state.activeTextureUid = null;
          renderTextureList(); renderTexture(); renderScene();
        } }
      ] });
    }
    if (groupNode) {
      const group = state.textureGroups.find(entry => entry.id === groupNode.dataset.textureGroup);
      return showContextMenu(event, { title: group?.name || '貼圖組', source: groupNode, items: [
        { icon: openIconMarkup(group?.collapsed ? 'down' : 'up', 'context-open-icon'), label: group?.collapsed ? '展開組' : '折疊組', action: () => { group.collapsed = !group.collapsed; renderTextureList(); } },
        { icon: '×', label: '解散貼圖組', action: () => {
          state.textureAssets.forEach(asset => { if (asset.groupId === group.id) asset.groupId = null; });
          state.textureGroups = state.textureGroups.filter(entry => entry.id !== group.id); renderTextureList();
        } }
      ] });
    }
    event.preventDefault();
  });
  $('#texturePreview').addEventListener('contextmenu', event => showContextMenu(event, { title: '貼圖預覽', source: $('#texturePreview'), items: [
    { icon: '◒', label: '在繪畫模式打開', action: () => setMode('paint') },
    { icon: '＋', label: '導入新貼圖', action: () => textureInput.click() }
  ] }));
  $('#paletteRows').addEventListener('contextmenu', event => {
    const rowNode = event.target.closest('.palette-row-card');
    if (!rowNode) return;
    const index = paletteRows.findIndex(row => row.id === rowNode.dataset.paletteId);
    const row = paletteRows[index];
    showContextMenu(event, { title: row.name, source: rowNode, items: [
      { icon: '◫', label: row.gradient ? '改用離散色卡' : '啟用連續漸變', action: () => { row.gradient = !row.gradient; renderPalette(); } },
      { icon: '＋', label: '新增色卡行', action: addPaletteRow }
    ] });
  });
  inspector.addEventListener('contextmenu', event => {
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const item = selected();
    if (!item) return;
    showContextMenu(event, { title: item.name, source: event.target.closest('.field-section'), items: [
      { icon: '⌖', label: '聚焦此物件', action: focusSelected },
      { icon: item.visible ? '◉' : '○', label: item.visible ? '隱藏' : '顯示', action: () => { snapshot(); setNodeVisibility(item, !item.visible); markDirty(); renderAll(); } }
    ] });
  });
  $('.workspace').addEventListener('contextmenu', event => {
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    showContextMenu(event, { title: 'CubeBricks', items: [
      { icon: '⌖', label: '聚焦選中物件', action: focusSelected },
      { icon: '◎', label: '回到場景中心', action: focusSceneOrigin }
    ] });
  });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#contextMenu')) closeContextMenu(); });
  window.addEventListener('blur', closeContextMenu);
}

function addCurveNodeAtViewportPoint(curve, event, rect = sceneCanvas.getBoundingClientRect()) {
  const selectedIndex = Math.max(0, Math.min(curve.nodes.length - 1, state.selectedCurveNodeIndex));
  const selectedWorld = sceneRenderer.getCurveNodeWorldPoints(state.project, curve.uid)[selectedIndex]?.point;
  if (!selectedWorld) return;
  const frame = sceneRenderer.getCameraFrame();
  const ray = sceneRenderer.getScreenRay(event.clientX - rect.left, event.clientY - rect.top);
  const plane = curve.dimension === 2 ? getCurveWorldPlane(curve, selectedWorld) : { point: selectedWorld, normal: frame.forward };
  const intersection = intersectRayPlane(ray, plane.point, plane.normal);
  if (!intersection) return toast('無法在目前視覺平面建立節點');
  const local = worldPointToCurveLocal(curve, intersection).map(value => snapValue(value, {}));
  if (curve.dimension === 2) local[1] = 0;
  const node = new CurveNode({ position: local }, curve.dimension === 2);
  const insertionIndex = selectedIndex === 0 ? 0 : selectedIndex + 1;
  snapshot();
  curve.nodes.splice(insertionIndex, 0, node);
  state.selectedCurveNodeIndex = insertionIndex;
  markDirty(); renderAll('selection'); toast('已建立並連接新節點');
}

function worldPointToCurveLocal(curve, worldPoint) {
  const parentPoint = worldPointToParentLocal(curve, worldPoint);
  return inverseRotateVector(parentPoint.map((value, axis) => value - curve.origin[axis]), curve.rotation || [0, 0, 0]);
}

function getCurveWorldPlane(curve, planePoint = null) {
  const chain = state.project.getGroupChain(curve.uid);
  const originWorld = applyGroupTransforms(curve.origin, chain);
  const normalParentPoint = curve.origin.map((value, axis) => value + rotateVector([0, 1, 0], curve.rotation || [0, 0, 0])[axis]);
  const normalWorldPoint = applyGroupTransforms(normalParentPoint, chain);
  return {
    point: planePoint ? [...planePoint] : originWorld,
    normal: normalize3(normalWorldPoint.map((value, axis) => value - originWorld[axis]))
  };
}

function bindEvents() {
  // Chromium may promote a pointer-focused button to :focus-visible when a
  // modifier key is pressed later. Only Tab explicitly enters keyboard focus
  // navigation, so Shift used for snapping never resurrects a stale outline.
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab') document.body.classList.add('keyboard-navigation');
  }, true);
  document.addEventListener('pointerdown', () => {
    document.body.classList.remove('keyboard-navigation');
  }, true);
  bindContextMenus();
  projectTabsNode.addEventListener('click', event => {
    const close = event.target.closest('[data-close-project-tab]');
    if (close) {
      event.stopPropagation();
      closeProjectTab(close.dataset.closeProjectTab);
      return;
    }
    const tab = event.target.closest('[data-project-tab]');
    if (tab) activateProjectTab(tab.dataset.projectTab);
  });
  projectTabsNode.addEventListener('auxclick', event => {
    if (event.button !== 1) return;
    const tab = event.target.closest('[data-project-tab]');
    if (!tab) return;
    event.preventDefault();
    closeProjectTab(tab.dataset.projectTab);
  });
  projectTabsNode.addEventListener('contextmenu', event => {
    const tab = event.target.closest('[data-project-tab]');
    if (!tab) return;
    event.preventDefault();
    event.stopPropagation();
    openProjectInfo(tab.dataset.projectTab);
  });
  projectTabsNode.addEventListener('keydown', event => {
    const tab = event.target.closest('[data-project-tab]');
    if (tab && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      activateProjectTab(tab.dataset.projectTab);
    }
  });
  projectTabsNode.addEventListener('dragstart', event => {
    const tab = event.target.closest('[data-project-tab]');
    if (!tab || event.target.closest('[data-close-project-tab]')) { event.preventDefault(); return; }
    draggingProjectTabId = tab.dataset.projectTab;
    draggingProjectTabInsertIndex = projectTabInsertionIndex(event.clientX, draggingProjectTabId);
    tab.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/x-cubebricks-project-tab', draggingProjectTabId);
  });
  projectTabsNode.addEventListener('dragover', event => {
    if (!draggingProjectTabId) return;
    event.preventDefault();
    draggingProjectTabInsertIndex = projectTabInsertionIndex(event.clientX);
    previewProjectTabInsertion(draggingProjectTabInsertIndex);
  });
  projectTabsNode.addEventListener('drop', event => {
    if (!draggingProjectTabId) return;
    event.preventDefault();
    draggingProjectTabInsertIndex = projectTabInsertionIndex(event.clientX);
    moveProjectTabToIndex(draggingProjectTabId, draggingProjectTabInsertIndex);
    draggingProjectTabId = null;
    draggingProjectTabInsertIndex = null;
  });
  projectTabsNode.addEventListener('dragend', event => {
    if (draggingProjectTabId) {
      moveProjectTabToIndex(draggingProjectTabId, projectTabInsertionIndex(event.clientX));
    }
    draggingProjectTabId = null;
    draggingProjectTabInsertIndex = null;
    projectTabsNode.querySelectorAll('.is-dragging,.drop-before,.drop-after').forEach(node => node.classList.remove('is-dragging', 'drop-before', 'drop-after'));
  });
  $('#newProjectTab').addEventListener('click', openNewProjectDialog);
  $('#projectInfoForm').addEventListener('submit', event => {
    event.preventDefault();
    applyProjectInfo();
  });
  $$('[data-action="closeProjectInfo"]').forEach(button => button.addEventListener('click', () => {
    projectInfoDialog.close();
    editingProjectTabId = null;
  }));
  $$('.mode-tab').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $$('.tool').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
  $$('.dock-tab').forEach(button => button.addEventListener('click', () => activateDock(button.dataset.dock)));
  $('[data-action="addCube"]').addEventListener('click', addCube);
  $('[data-action="addShape"]').addEventListener('click', addShape);
  $('[data-action="addLocator"]').addEventListener('click', addLocator);
  $('[data-action="addNode"]').addEventListener('click', addNodeElement);
  $('[data-action="addBezier2d"]').addEventListener('click', () => addBezierElement(2));
  $('[data-action="addBezier3d"]').addEventListener('click', () => addBezierElement(3));
  $('[data-action="addGroup"]').addEventListener('click', addGroup);
  $('.outliner-create-actions [data-action="deleteSelected"]').addEventListener('click', deleteSelected);
  $('[data-action="new"]').addEventListener('click', openNewProjectDialog);
  $('#modelFormatList').addEventListener('click', event => {
    const card = event.target.closest('[data-model-format]');
    if (card) newProject(card.dataset.modelFormat);
  });
  $('[data-action="open"]').addEventListener('click', openProject);
  $('[data-action="save"]').addEventListener('click', () => saveProject(false));
  $('[data-action="export"]').addEventListener('click', exportProject);
  $('[data-action="undo"]').addEventListener('click', undo);
  $('[data-action="redo"]').addEventListener('click', redo);
  $('[data-action="theme"]').addEventListener('click', () => themeDialog.showModal());
  $$('[data-settings-page]').forEach(button => button.addEventListener('click', () => {
    $$('[data-settings-page]').forEach(entry => entry.classList.toggle('active', entry === button));
    $$('[data-settings-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.settingsPanel === button.dataset.settingsPage));
  }));
  languageSelect.addEventListener('change', event => {
    configRegistry.set(ConfigKey.LANGUAGE, event.target.value, { source: 'appearance-dialog' });
  });
  $$('[data-config-key]').forEach(control => {
    control.addEventListener('change', () => setConfigFromControl(control));
    if (control.type === 'number') control.addEventListener('input', () => {
      if (control.value !== '') setConfigFromControl(control);
    });
  });
  $('#symmetryToggle').addEventListener('change', event => configRegistry.set(ConfigKey.SYMMETRY, event.target.checked, { source: 'toolbar' }));
  $('#alphaLockToggle').addEventListener('change', event => configRegistry.set(ConfigKey.ALPHA_LOCK, event.target.checked, { source: 'toolbar' }));
  $('#previewShadeToggle').addEventListener('change', event => configRegistry.set(ConfigKey.PREVIEW_SHADE, event.target.checked, { source: 'toolbar' }));
  $('#uvPreviewEnabled').addEventListener('change', event => {
    state.uvPreviewEnabled = event.target.checked;
    if (!state.uvPreviewEnabled) stopUvPreviewAnimation();
    refreshUvPreview();
  });
  $('#uvPreviewAutoRotate').addEventListener('change', event => {
    state.uvPreviewAutoRotate = event.target.checked;
    if (!state.uvPreviewAutoRotate) stopUvPreviewAnimation();
    refreshUvPreview();
  });
  $('#uvPreviewFaceColors').addEventListener('change', event => {
    state.uvPreviewFaceColors = event.target.checked;
    uvPreviewRenderer.invalidateGeometry();
    renderUvPreview();
  });
  uvPreviewViewport.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !uvPreviewIsActive() || !uvPreviewElements().length) return;
    event.preventDefault();
    uvPreviewDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    uvPreviewViewport.classList.add('is-rotating');
    uvPreviewViewport.setPointerCapture(event.pointerId);
  });
  uvPreviewViewport.addEventListener('pointermove', event => {
    if (!uvPreviewDrag || uvPreviewDrag.pointerId !== event.pointerId) return;
    const dx = event.clientX - uvPreviewDrag.x;
    const dy = event.clientY - uvPreviewDrag.y;
    uvPreviewDrag.x = event.clientX;
    uvPreviewDrag.y = event.clientY;
    state.uvPreviewYaw += dx * .01;
    state.uvPreviewPitch = Math.max(-Math.PI / 2 + .02, Math.min(Math.PI / 2 - .02, state.uvPreviewPitch + dy * .01));
    renderUvPreview();
  });
  const endUvPreviewDrag = event => {
    if (!uvPreviewDrag || uvPreviewDrag.pointerId !== event.pointerId) return;
    uvPreviewViewport.releasePointerCapture?.(event.pointerId);
    uvPreviewViewport.classList.remove('is-rotating');
    uvPreviewDrag = null;
  };
  uvPreviewViewport.addEventListener('pointerup', endUvPreviewDrag);
  uvPreviewViewport.addEventListener('pointercancel', endUvPreviewDrag);
  $('#geometryOnlyToggle').addEventListener('change', event => configRegistry.set(ConfigKey.SHOW_GEOMETRY_ONLY, event.target.checked, { source: 'toolbar' }));
  $$('[data-transform-space]').forEach(button => button.addEventListener('click', () => {
    state.transformSpace = button.dataset.transformSpace;
    updateToolOptions();
    renderScene();
  }));
  $$('[data-rotation-mode]').forEach(button => button.addEventListener('click', () => {
    state.rotationMode = button.dataset.rotationMode;
    updateRotationModeButtons();
    renderScene();
  }));
  $$('[data-multi-transform-mode]').forEach(button => button.addEventListener('click', () => {
    state.multiTransformMode = button.dataset.multiTransformMode;
    updateMultiTransformModeButtons();
    renderScene();
  }));
  $$('[data-scale-handle-mode]').forEach(button => button.addEventListener('click', () => {
    state.scaleHandleMode = button.dataset.scaleHandleMode;
    updateScaleHandleModeButtons();
    renderScene();
  }));
  $$('[data-vertex-snap-mode]').forEach(button => button.addEventListener('click', () => {
    state.vertexSnapMode = button.dataset.vertexSnapMode;
    state.vertexSnapSource = null;
    updateToolOptions();
    renderScene();
  }));
  $$('[data-vertex-rotation-mode]').forEach(button => button.addEventListener('click', () => {
    state.vertexSnapRotationMode = button.dataset.vertexRotationMode;
    state.vertexSnapSource = null;
    updateToolOptions();
    renderScene();
  }));
  $('[data-action="grid"]').addEventListener('click', () => configRegistry.set(ConfigKey.SHOW_GRID, !state.grid, { source: 'viewport-toolbar' }));
  $('[data-action="wire"]').addEventListener('click', () => configRegistry.set(ConfigKey.SHOW_WIREFRAME, !state.wire, { source: 'viewport-toolbar' }));
  const snapButton = $('[data-action="cycleSnap"]');
  snapButton.addEventListener('click', () => cycleSnap(1));
  snapButton.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    cycleSnap(-1);
  });
  $('[data-action="frame"]').addEventListener('click', focusSelected);
  $$('[data-projection]').forEach(button => button.addEventListener('click', () => {
    configRegistry.set(ConfigKey.PROJECTION, button.dataset.projection, { source: 'viewport-toolbar' });
  }));
  $('#renderModeButton').addEventListener('click', event => {
    event.stopPropagation();
    setRenderModeMenu($('#renderModeMenu').hidden);
  });
  $$('[data-render-mode]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    state.renderMode = button.dataset.renderMode;
    updateRenderModeControl();
    setRenderModeMenu(false);
    renderScene();
  }));
  document.addEventListener('click', event => {
    if (!event.target.closest('#viewportRenderMenu')) setRenderModeMenu(false);
  });
  $('#minecraftRenderType').addEventListener('change', event => {
    snapshot();
    state.project.renderType = event.target.value;
    markDirty();
    renderScene();
  });
  $('#cullFaces').addEventListener('change', event => {
    snapshot();
    state.project.cullFaces = event.target.checked;
    markDirty();
    renderScene();
  });
  $('[data-action="addTexture"]').addEventListener('click', () => textureInput.click());
  $('[data-action="playTimeline"]').addEventListener('click', playTimeline);
  $('[data-action="stopTimeline"]').addEventListener('click', stopTimeline);
  $('[data-action="addPaletteRow"]').addEventListener('click', addPaletteRow);
  $('#outlinerSearch').addEventListener('input', renderOutliner);
  $('#outlinerDetailsToggle').addEventListener('change', event => {
    state.outlinerDetailed = event.target.checked;
    state.outlinerWindowStart = -1;
    renderOutlinerWindow();
  });
  outliner.addEventListener('scroll', scheduleOutlinerWindow, { passive: true });
  outliner.addEventListener('click', event => {
    const button = event.target.closest('[data-uid]');
    if (!button) { clearSelection(); return; }
    const flag = event.target.closest('[data-node-toggle]');
    if (flag && !flag.classList.contains('unavailable')) {
      event.preventDefault();
      event.stopPropagation();
      const node = state.project.getNode(flag.dataset.nodeUid);
      const key = flag.dataset.nodeToggle;
      const current = key === 'autoUv' ? nodeAutoUvEnabled(node)
        : key === 'locked' ? node.locked === true
        : node[key] !== false;
      const targets = state.selectedUids.has(node.uid) && state.selectedUids.size > 1
        ? inspectorBatchNodes()
        : [node];
      snapshot();
      for (const target of targets) setNodeFlag(target, key, !current);
      markDirty();
      if (key === 'locked') sceneRenderer.invalidateLockState();
      if (key === 'visible' || key === 'autoUv') renderAll();
      else {
        state.outlinerWindowStart = -1;
        renderOutlinerWindow();
        if (key === 'locked') renderScene();
      }
      return;
    }
    const disclosure = event.target.closest('[data-disclosure]');
    if (disclosure?.dataset.disclosure) {
      const uidValue = disclosure.dataset.disclosure;
      state.collapsedGroups.has(uidValue) ? state.collapsedGroups.delete(uidValue) : state.collapsedGroups.add(uidValue);
      renderOutliner(); return;
    }
    selectItem(button.dataset.uid, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
  });
  outliner.addEventListener('dragstart', event => {
    if (event.target.closest('[data-node-toggle]')) { event.preventDefault(); return; }
    const item = event.target.closest('.outliner-item');
    if (!item) return;
    if (!state.selectedUids.has(item.dataset.uid)) {
      sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
      state.selectedUid = item.dataset.uid;
      state.selectedUids = new Set([item.dataset.uid]);
      state.selectionAnchorUid = item.dataset.uid;
      outliner.querySelectorAll('.outliner-item.active').forEach(row => row.classList.remove('active'));
      item.classList.add('active');
      sceneRenderer.invalidateSelectionGeometry(false);
      renderInspector(); renderScene(); updateSelectionLabels();
    }
    state.outlinerDragUids = topLevelSelectedUids();
    state.outlinerDragUids.forEach(uidValue =>
      outliner.querySelector(`.outliner-item[data-uid="${CSS.escape(uidValue)}"]`)?.classList.add('is-dragging'));
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/x-cubebricks-outliner', state.outlinerDragUids.join(','));
    const ghost = createOutlinerDragGhost(state.outlinerDragUids);
    event.dataTransfer.setDragImage(ghost, 24, 17);
  });
  outliner.addEventListener('dragover', event => {
    if (!state.outlinerDragUids?.length) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    clearOutlinerDropState({ keepDragging: true });
    const item = event.target.closest('.outliner-item');
    if (!item) return;
    const node = state.project.getNode(item.dataset.uid);
    const rect = item.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    const zone = node?.type === 'group' && ratio > .27 && ratio < .73 ? 'inside' : ratio < .5 ? 'before' : 'after';
    item.classList.add(`drop-${zone}`);
    item.dataset.dropZone = zone;
  });
  outliner.addEventListener('drop', event => {
    if (!state.outlinerDragUids?.length) return;
    event.preventDefault();
    const item = event.target.closest('.outliner-item');
    const targetUid = item?.dataset.uid || null;
    const zone = item?.dataset.dropZone || 'after';
    clearOutlinerDropState();
    removeOutlinerDragGhost();
    moveSelectedNodes(targetUid, zone);
    state.outlinerDragUids = null;
  });
  outliner.addEventListener('dragend', () => {
    clearOutlinerDropState();
    removeOutlinerDragGhost();
    state.outlinerDragUids = null;
  });
  $$('[data-theme-var]').forEach(input => input.addEventListener('input', () => setThemeVar(input.dataset.themeVar, `${input.value}${input.dataset.unit || ''}`)));
  $$('[data-preset]').forEach(button => button.addEventListener('click', () => applyPreset(button.dataset.preset)));
  $('[data-action="resetTheme"]').addEventListener('click', () => {
    localStorage.removeItem('cubebricks.theme'); applyPreset('moss');
    setThemeVar('--radius', '10px'); setThemeVar('--ui-scale', '100%');
    configRegistry.resetAll();
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]; if (!file) return;
    try { loadProjectContent(await file.text(), file.name); } catch (error) { toast(`文件無法讀取：${error.message}`); }
    fileInput.value = '';
  });
  textureInput.addEventListener('change', () => {
    importTexture(textureInput.files[0]);
    textureInput.value = '';
  });
  $('[data-action="addTextureGroup"]').addEventListener('click', addTextureGroup);
  $('#textureList').addEventListener('click', event => {
    const groupToggle = event.target.closest('[data-texture-group-toggle]');
    if (groupToggle) {
      const group = state.textureGroups.find(entry => entry.id === groupToggle.dataset.textureGroupToggle);
      if (group) { group.collapsed = !group.collapsed; renderTextureList(); }
      return;
    }
    const item = event.target.closest('.texture-item'); if (!item) return;
    setActiveTextureItem(item);
  });
  $('#textureList').addEventListener('dragstart', event => {
    const item = event.target.closest('.texture-item');
    const group = !item && event.target.closest('.texture-group');
    if (!item && !group) return;
    state.textureDrag = item ? { type: 'asset', id: item.dataset.textureUid } : { type: 'group', id: group.dataset.textureGroup };
    (item || group).classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/x-cubebricks-texture', `${state.textureDrag.type}:${state.textureDrag.id}`);
  });
  $('#textureList').addEventListener('dragover', event => {
    if (!state.textureDrag) return;
    event.preventDefault();
    $('#textureList').querySelectorAll('.drop-before,.drop-after,.drop-inside').forEach(node => node.classList.remove('drop-before', 'drop-after', 'drop-inside'));
    const item = event.target.closest('.texture-item');
    const group = !item && event.target.closest('.texture-group');
    if (item && state.textureDrag.type === 'asset') {
      const zone = event.clientY < item.getBoundingClientRect().top + item.offsetHeight / 2 ? 'before' : 'after';
      item.classList.add(`drop-${zone}`); item.dataset.dropZone = zone;
    } else if (group) group.classList.add('drop-inside');
  });
  $('#textureList').addEventListener('drop', event => {
    if (!state.textureDrag) return;
    event.preventDefault();
    const item = event.target.closest('.texture-item');
    const groupNode = !item && event.target.closest('.texture-group');
    if (state.textureDrag.type === 'asset') {
      const asset = state.textureAssets.find(entry => entry._uid === state.textureDrag.id);
      if (asset && item && item.dataset.textureUid !== asset._uid) {
        const target = state.textureAssets.find(entry => entry._uid === item.dataset.textureUid);
        state.textureAssets = state.textureAssets.filter(entry => entry !== asset);
        const targetIndex = state.textureAssets.indexOf(target);
        state.textureAssets.splice(targetIndex + (item.dataset.dropZone === 'after' ? 1 : 0), 0, asset);
        asset.groupId = target.groupId || null;
      } else if (asset && groupNode) asset.groupId = groupNode.dataset.textureGroup;
      else if (asset) asset.groupId = null;
    } else if (state.textureDrag.type === 'group' && groupNode && groupNode.dataset.textureGroup !== state.textureDrag.id) {
      const moving = state.textureGroups.find(entry => entry.id === state.textureDrag.id);
      const target = state.textureGroups.find(entry => entry.id === groupNode.dataset.textureGroup);
      state.textureGroups = state.textureGroups.filter(entry => entry !== moving);
      state.textureGroups.splice(state.textureGroups.indexOf(target) + 1, 0, moving);
    }
    state.textureDrag = null;
    renderTextureList();
  });
  $('#textureList').addEventListener('dragend', () => { state.textureDrag = null; renderTextureList(); });
  $$('[data-view-axis]').forEach(button => button.addEventListener('click', () => {
    cancelCameraFocus();
    const axis = button.dataset.viewAxis;
    if (axis === 'x') { state.yaw = Math.PI / 2; state.pitch = 0; }
    if (axis === 'y') { state.yaw = 0; state.pitch = Math.PI / 2 - .001; }
    if (axis === 'z') { state.yaw = 0; state.pitch = 0; }
    renderScene();
  }));
  $('#transformGizmo').addEventListener('pointerdown', event => {
    if (event.button === 1) {
      event.preventDefault(); event.stopPropagation();
      startCameraDrag(event, event.currentTarget);
      return;
    }
    if (event.button !== 0) return;
    const handle = resolveGizmoHandle(event);
    if (!handle) return;
    event.preventDefault(); event.stopPropagation();
    if (handle.dataset.kind === 'vertex') {
      useVertexSnapPoint(state.vertexSnapPoints?.[Number(handle.dataset.vertexIndex)]);
      return;
    }
    const axisKey = handle.dataset.axis;
    const axisIndex = /^[0-2]$/.test(axisKey) ? Number(axisKey) : null;
    const axisIndices = handle.dataset.axes
      ? handle.dataset.axes.split(',').map(Number).filter(index => index >= 0 && index <= 2)
      : axisIndex === null ? [] : [axisIndex];
    const axisSigns = handle.dataset.signs
      ? handle.dataset.signs.split(',').map(Number)
      : axisIndex === null ? [] : [Number(handle.dataset.sign || 1)];
    startTransformDrag(event, axisIndex, event.currentTarget, handle.dataset.kind || 'free',
      Number(handle.dataset.sign || 1), handle, axisKey, axisIndices, axisSigns);
  });
  $('#transformGizmo').addEventListener('pointermove', event => { updateGizmoDepthHover(event); onPointerMove(event); });
  $('#transformGizmo').addEventListener('pointerleave', () => {
    $('#transformGizmo').querySelectorAll('.depth-hover').forEach(control => control.classList.remove('depth-hover'));
  });
  $('#transformGizmo').addEventListener('pointerup', endPointerDrag);
  $('#transformGizmo').addEventListener('pointercancel', endPointerDrag);
  sceneCanvas.addEventListener('pointerdown', onPointerDown);
  sceneCanvas.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointermove', scheduleLockedHover);
  viewport.addEventListener('pointerleave', () => {
    sceneCanvas.classList.remove('is-curve-handle-hover');
    lockedHoverPointer = null;
    if (lockedHoverPickFrame !== null) cancelAnimationFrame(lockedHoverPickFrame);
    lockedHoverPickFrame = null;
    animateLockedHoverStrength(false);
    if (state.tool !== 'knife' || state.dragging) return;
    state.knifeHover = null;
    renderScene();
  });
  sceneCanvas.addEventListener('pointerup', endPointerDrag);
  sceneCanvas.addEventListener('pointercancel', endPointerDrag);
  sceneCanvas.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
  sceneCanvas.addEventListener('wheel', event => { event.preventDefault(); cancelCameraFocus(); state.zoom = Math.max(.002, Math.min(100, state.zoom * (event.deltaY > 0 ? .9 : 1.1))); renderScene(); }, { passive: false });
  window.addEventListener('resize', renderScene);
  document.addEventListener('visibilitychange', refreshUvPreview);
  window.addEventListener('keydown', event => {
    if (event.target.matches('input,select')) return;
    if (event.key === 'Escape') setRenderModeMenu(false);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(event.shiftKey); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if (event.key === 'Delete') deleteSelected();
    if (event.key.toLowerCase() === 'f') { cancelCameraFocus(); state.zoom = 1.12; state.panX = 0; state.panY = 0; renderScene(); }
    if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      event.shiftKey ? focusSceneOrigin() : focusSelected();
    }
    const shortcuts = { '1': 'move', '2': 'resize', '3': 'rotate', '4': 'pivot', '5': 'vertexSnap', '6': 'knife' }; if (shortcuts[event.key]) setTool(shortcuts[event.key]);
    if (state.tool === 'knife' && state.knifePointer && ['Shift', 'Control'].includes(event.key)) refreshKnifeFromModifierEvent(event);
  });
  window.addEventListener('keyup', event => {
    if (state.tool === 'knife' && state.knifePointer && ['Shift', 'Control'].includes(event.key)) refreshKnifeFromModifierEvent(event);
  });
}

let timelineAnimation = null;
let timelineLastTime = 0;

function playTimeline() {
  if (state.timelinePlaying) return;
  state.timelinePlaying = true;
  timelineLastTime = performance.now();
  $('[data-action="playTimeline"]').textContent = '❚❚';
  const tick = now => {
    if (!state.timelinePlaying) return;
    state.timelineFrame = (state.timelineFrame + (now - timelineLastTime) / 1000 * 24) % 48;
    timelineLastTime = now;
    updateTimelineUI();
    timelineAnimation = requestAnimationFrame(tick);
  };
  timelineAnimation = requestAnimationFrame(tick);
}

function stopTimeline() {
  state.timelinePlaying = false;
  state.timelineFrame = 0;
  if (timelineAnimation) cancelAnimationFrame(timelineAnimation);
  timelineAnimation = null;
  $('[data-action="playTimeline"]').textContent = '▶';
  updateTimelineUI();
}

function updateTimelineUI() {
  const frame = Math.floor(state.timelineFrame);
  const seconds = Math.floor(frame / 24);
  $('#timelineTime').textContent = `00:00:${String(seconds).padStart(2, '0')}:${String(frame % 24).padStart(2, '0')}`;
  $('#timelineRuler').style.setProperty('--playhead', `${state.timelineFrame / 48 * 100}%`);
}

function startCurveHandleDrag(event, curve, hit) {
  event.preventDefault();
  event.stopPropagation();
  sceneCanvas.setPointerCapture(event.pointerId);
  if (isBezierElement(curve)) state.selectedCurveNodeIndex = hit.index;
  const frame = sceneRenderer.getCameraFrame();
  const plane = curve.dimension === 2
    ? getCurveWorldPlane(curve, hit.point)
    : { point: [...hit.point], normal: [...frame.forward] };
  state.dragging = {
    type: 'curve-handle', pointerId: event.pointerId,
    x: event.clientX, y: event.clientY,
    rect: sceneCanvas.getBoundingClientRect(),
    curve, node: curve.type === 'node' ? curve : curve.nodes[hit.index], nodeIndex: hit.index,
    property: hit.property, plane, snapshotTaken: false
  };
  sceneCanvas.classList.add('is-curve-handle');
  renderInspector();
  renderScene();
}

function onPointerDown(event) {
  const rect = sceneCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  if (event.button === 1) {
    startCameraDrag(event, sceneCanvas);
    return;
  }
  if (event.button !== 0) return;
  if (state.tool === 'knife') {
    event.preventDefault();
    useKnifePoint(event);
    return;
  }
  const activeCurve = selected();
  const handleOwner = isBezierElement(activeCurve) || activeCurve?.type === 'node' ? activeCurve : null;
  if (handleOwner && !isEffectivelyLocked(handleOwner.uid)) {
    const handleHit = sceneRenderer.pickCurveHandle(state.project, handleOwner.uid, x, y, null);
    if (handleHit) {
      startCurveHandleDrag(event, handleOwner, handleHit);
      return;
    }
  }
  if (isBezierElement(activeCurve) && !isEffectivelyLocked(activeCurve.uid)) {
    const nodeHit = sceneRenderer.pickCurveNode(state.project, activeCurve.uid, x, y);
    if (nodeHit) {
      event.preventDefault();
      state.selectedCurveNodeIndex = nodeHit.index;
      renderInspector();
      renderScene();
      return;
    }
    state.selectedCurveNodeIndex = null;
  }
  const hitUid = sceneRenderer.pick(state.project, x, y, state.geometryOnly);
  event.preventDefault();
  sceneCanvas.setPointerCapture(event.pointerId);
  state.dragging = {
    type: 'selection-box', pointerId: event.pointerId,
    x: event.clientX, y: event.clientY, startX: x, startY: y,
    currentX: x, currentY: y, moved: false, hitUid,
    selection: new Set(state.selectedUids),
    mode: viewportSelectionMode(event)
  };
}

function viewportSelectionMode(event) {
  if (event.ctrlKey || event.metaKey) return 'remove';
  if (event.shiftKey) return 'add';
  return 'replace';
}

function updateSelectionMarquee(drag) {
  const x1 = Math.min(drag.startX, drag.currentX);
  const y1 = Math.min(drag.startY, drag.currentY);
  const x2 = Math.max(drag.startX, drag.currentX);
  const y2 = Math.max(drag.startY, drag.currentY);
  selectionMarquee.hidden = false;
  selectionMarquee.classList.toggle('is-add', drag.mode === 'add');
  selectionMarquee.classList.toggle('is-remove', drag.mode === 'remove');
  selectionMarquee.style.left = `${x1}px`;
  selectionMarquee.style.top = `${y1}px`;
  selectionMarquee.style.width = `${x2 - x1}px`;
  selectionMarquee.style.height = `${y2 - y1}px`;
}

function applyViewportBoxSelection(hitUids, drag) {
  sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
  const next = drag.mode === 'replace' ? new Set() : new Set(drag.selection);
  if (drag.mode === 'remove') {
    const hits = new Set(hitUids);
    for (const uidValue of [...next]) {
      const node = state.project.getNode(uidValue);
      if (hits.has(uidValue)
        || (node?.type === 'group' && state.project.getDescendantElementUids(uidValue).some(uid => hits.has(uid)))) {
        next.delete(uidValue);
      }
    }
  } else hitUids.forEach(uidValue => next.add(uidValue));
  state.selectedUids = next;
  const lastHit = [...hitUids].reverse().find(uidValue => next.has(uidValue));
  state.selectedUid = lastHit || (next.has(state.selectedUid) ? state.selectedUid : [...next].at(-1) || null);
  state.selectionAnchorUid = state.selectedUid;
  state.vertexSnapSource = null;
  refreshSelectionUi();
  if (state.selectedUid) revealOutlinerItem(state.selectedUid);
}

function startCameraDrag(event, captureTarget) {
  event.preventDefault();
  cancelCameraFocus();
  captureTarget.setPointerCapture(event.pointerId);
  bakeCameraPan();
  const frame = sceneRenderer.getCameraFrame();
  state.dragging = event.shiftKey
    ? {
        type: 'pan', pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        target: [...state.target], right: [...frame.right], up: [...frame.up], worldPerPixel: frame.worldPerPixel
      }
    : { type: 'orbit', pointerId: event.pointerId, x: event.clientX, y: event.clientY, yaw: state.yaw, pitch: state.pitch };
  sceneCanvas.classList.add(event.shiftKey ? 'is-panning' : 'is-orbiting');
}

const CUBE_FACE_NAMES = ['north', 'east', 'south', 'west', 'up', 'down'];

function freezeCubeUvs(cube, disableAutoUv = false) {
  const existing = cube.faces || {};
  cube.faces = Object.fromEntries(CUBE_FACE_NAMES.map(faceName => {
    const face = { ...(existing[faceName] || {}) };
    face.uv = Array.isArray(face.uv) && face.uv.length >= 4
      ? [...face.uv]
      : [...getBlockbenchBoxUv(cube, faceName)];
    return [faceName, face];
  }));
  if (disableAutoUv) cube.autoUv = false;
}

function translateItemByLocalDelta(item, delta) {
  if (item.type === 'cube') {
    item.position = item.position.map((value, axis) => value + delta[axis]);
    item.pivot = item.pivot.map((value, axis) => value + delta[axis]);
  } else if (item.origin) item.origin = item.origin.map((value, axis) => value + delta[axis]);
  else if (item.position) item.position = item.position.map((value, axis) => value + delta[axis]);
  else if (item.type === 'group') {
    const members = captureGroupMembers(item);
    item.pivot = item.pivot.map((value, axis) => value + delta[axis]);
    members.forEach(member => {
      if (member.node.type === 'cube') {
        member.node.position = member.position.map((value, axis) => value + delta[axis]);
        member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
      } else if (member.node.origin) member.node.origin = member.position.map((value, axis) => value + delta[axis]);
      else if (member.node.position) member.node.position = member.position.map((value, axis) => value + delta[axis]);
      else member.node.pivot = member.position.map((value, axis) => value + delta[axis]);
    });
  }
}

function worldVectorToParentLocal(item, vector) {
  let local = [...vector];
  state.project.getGroupChain(item.uid).forEach(group => { local = inverseRotateVector(local, group.rotation || [0, 0, 0]); });
  return local;
}

function worldPointToParentLocal(item, worldPoint) {
  let local = [...worldPoint];
  for (const group of state.project.getGroupChain(item.uid)) {
    const offset = local.map((value, axis) => value - group.pivot[axis]);
    local = inverseRotateVector(offset, group.rotation || [0, 0, 0]).map((value, axis) => value + group.pivot[axis]);
  }
  return local;
}

function worldPointToCubeLocal(cube, worldPoint) {
  let local = worldPointToParentLocal(cube, worldPoint);
  const offset = local.map((value, axis) => value - cube.pivot[axis]);
  return inverseRotateVector(offset, cube.rotation || [0, 0, 0]).map((value, axis) => value + cube.pivot[axis]);
}

function quaternionFromVectors(from, to) {
  const first = normalize3(from), second = normalize3(to);
  const cosine = Math.max(-1, Math.min(1, dot3(first, second)));
  if (cosine < -0.999999) {
    const reference = Math.abs(first[0]) < .8 ? [1, 0, 0] : [0, 1, 0];
    return quaternionFromAxisAngle(normalize3(cross3(first, reference)), 180);
  }
  const axis = cross3(first, second);
  const quaternion = [...axis, 1 + cosine];
  const length = Math.hypot(...quaternion) || 1;
  return quaternion.map(value => value / length);
}

function vertexRotationTurn(from, to, mode) {
  if (mode === 'pivot') return quaternionFromVectors(from, to);
  let axisIndex = { x: 0, y: 1, z: 2 }[mode];
  if (mode === 'longest') {
    const cross = cross3(from, to);
    axisIndex = [0, 1, 2].reduce((best, axis) => Math.abs(cross[axis]) > Math.abs(cross[best]) ? axis : best, 0);
  }
  const axis = [0, 0, 0]; axis[axisIndex] = 1;
  const first = from.map((value, index) => index === axisIndex ? 0 : value);
  const second = to.map((value, index) => index === axisIndex ? 0 : value);
  if (Math.hypot(...first) < 1e-6 || Math.hypot(...second) < 1e-6) return null;
  const angle = Math.atan2(dot3(axis, cross3(first, second)), dot3(first, second)) * 180 / Math.PI;
  return quaternionFromAxisAngle(axis, angle);
}

function useVertexSnapPoint(pointEntry) {
  const currentItem = selected();
  if (!currentItem || !pointEntry) return;
  if (!state.vertexSnapSource) {
    state.vertexSnapSource = { rootUid: currentItem.uid, uid: pointEntry.uid, pointType: pointEntry.pointType,
      nodeIndex: pointEntry.nodeIndex, point: [...pointEntry.point] };
    updateToolOptions();
    renderScene();
    return;
  }
  const sourceItem = state.project.getNode(state.vertexSnapSource.rootUid);
  if (!sourceItem) {
    state.vertexSnapSource = null;
    updateToolOptions();
    return;
  }
  if (state.vertexSnapMode === 'scale' && sourceItem.type !== 'cube') return toast('縮放捕捉目前只適用於 Cube');
  if (state.vertexSnapMode === 'rotate' && !sourceItem.rotation) return toast('這個物件不能旋轉捕捉');
  snapshot();
  if (state.vertexSnapMode === 'move') {
    if (state.vertexSnapSource.pointType === 'curveNode' && isBezierElement(sourceItem)) {
      const node = sourceItem.nodes[state.vertexSnapSource.nodeIndex];
      const worldDelta = pointEntry.point.map((value, axis) => value - state.vertexSnapSource.point[axis]);
      let localDelta = worldVectorToParentLocal(sourceItem, worldDelta);
      localDelta = inverseRotateVector(localDelta, sourceItem.rotation || [0, 0, 0]);
      node.position = node.position.map((value, axis) => sourceItem.dimension === 2 && axis === 1 ? 0 : value + localDelta[axis]);
    } else if (state.vertexSnapSource.pointType === 'pivot' && ['cube', 'group'].includes(sourceItem.type)) {
      setPivotPreservingGeometry(state.project, sourceItem, worldPointToParentLocal(sourceItem, pointEntry.point));
    } else {
      const worldDelta = pointEntry.point.map((value, axis) => value - state.vertexSnapSource.point[axis]);
      translateItemByLocalDelta(sourceItem, worldVectorToParentLocal(sourceItem, worldDelta));
    }
  } else if (state.vertexSnapMode === 'scale') {
    if (sourceItem.autoUv === false) freezeCubeUvs(sourceItem);
    const sourcePoint = worldPointToCubeLocal(sourceItem, state.vertexSnapSource.point);
    const targetPoint = worldPointToCubeLocal(sourceItem, pointEntry.point);
    const nextPosition = [...sourceItem.position], nextSize = [...sourceItem.size];
    for (let axis = 0; axis < 3; axis++) {
      const start = sourceItem.position[axis], end = start + sourceItem.size[axis];
      if (Math.abs(sourcePoint[axis] - start) <= Math.abs(sourcePoint[axis] - end)) {
        nextPosition[axis] = targetPoint[axis];
        nextSize[axis] = end - targetPoint[axis];
      } else nextSize[axis] = targetPoint[axis] - start;
      if (!state.allowNegativeSize && nextSize[axis] < 0) {
        nextPosition[axis] += nextSize[axis];
        nextSize[axis] = Math.abs(nextSize[axis]);
      }
    }
    sourceItem.position = nextPosition;
    sourceItem.size = nextSize;
  } else {
    const pivot = sourceItem.pivot || sourceItem.origin || sourceItem.position;
    const sourcePoint = worldPointToParentLocal(sourceItem, state.vertexSnapSource.point);
    const targetPoint = worldPointToParentLocal(sourceItem, pointEntry.point);
    const from = sourcePoint.map((value, axis) => value - pivot[axis]);
    const to = targetPoint.map((value, axis) => value - pivot[axis]);
    const turn = Math.hypot(...from) > 1e-6 && Math.hypot(...to) > 1e-6
      ? vertexRotationTurn(from, to, state.vertexSnapRotationMode)
      : null;
    if (!turn) {
      state.history.pop();
      return toast('所選頂點無法建立旋轉方向');
    }
    sourceItem.rotation = eulerFromQuaternion(quaternionMultiply(turn, quaternionFromEuler(sourceItem.rotation || [0, 0, 0])));
  }
  const completedMode = state.vertexSnapMode;
  const movedPivotOnly = completedMode === 'move' && state.vertexSnapSource.pointType === 'pivot';
  state.vertexSnapSource = null;
  markDirty();
  invalidateAllRenderGeometry();
  renderAll();
  toast(movedPivotOnly ? '已將樞軸移至目標頂點（幾何保持不動）'
    : { move: '已移動至目標頂點', scale: '已縮放至目標頂點', rotate: '已旋轉對齊目標頂點' }[completedMode]);
}

function clamp(value, minimum, maximum) {
  return Math.max(Math.min(minimum, maximum), Math.min(Math.max(minimum, maximum), value));
}

function cubeLocalPointToWorld(cube, localPoint) {
  const offset = localPoint.map((value, axis) => value - cube.pivot[axis]);
  const rotated = rotateVector(offset, cube.rotation || [0, 0, 0]).map((value, axis) => value + cube.pivot[axis]);
  return applyGroupTransforms(rotated, state.project.getGroupChain(cube.uid));
}

function getKnifeCandidate(event) {
  const rect = sceneCanvas.getBoundingClientRect();
  const hit = sceneRenderer.pickDetailed(state.project, event.clientX - rect.left, event.clientY - rect.top, true);
  const cube = hit && state.project.getNode(hit.uid);
  const faceAxes = hit && getKnifeFaceAxes(hit.faceName);
  if (!hit || cube?.type !== 'cube' || !faceAxes) return null;
  const localPoint = worldPointToCubeLocal(cube, hit.point);
  for (const axis of [faceAxes.horizontal, faceAxes.vertical]) {
    localPoint[axis] = clamp(snapValue(localPoint[axis], event), cube.position[axis], cube.position[axis] + cube.size[axis]);
  }
  return { uid: cube.uid, faceName: hit.faceName, localPoint, worldPoint: cubeLocalPointToWorld(cube, localPoint) };
}

function getKnifePreviewAxis() {
  if (!state.knifeSelection || !state.knifeHover
    || state.knifeSelection.uid !== state.knifeHover.uid
    || state.knifeSelection.faceName !== state.knifeHover.faceName) return null;
  const cube = state.project.getNode(state.knifeSelection.uid);
  return chooseKnifeCutAxis(state.knifeSelection.localPoint, state.knifeHover.localPoint,
    state.knifeSelection.faceName, cube);
}

function getKnifePreviewLabel(axis = getKnifePreviewAxis()) {
  const faceAxes = state.knifeSelection && getKnifeFaceAxes(state.knifeSelection.faceName);
  if (axis === null || !faceAxes) return null;
  return axis === faceAxes.horizontal ? '豎切' : '橫切';
}

function updateKnifeHover(event) {
  state.knifePointer = {
    clientX: event.clientX,
    clientY: event.clientY,
    shiftKey: Boolean(event.shiftKey),
    ctrlKey: Boolean(event.ctrlKey || event.metaKey)
  };
  const candidate = getKnifeCandidate(event);
  state.knifeHover = state.knifeSelection && candidate
    && (candidate.uid !== state.knifeSelection.uid || candidate.faceName !== state.knifeSelection.faceName)
    ? null
    : candidate;
  updateToolOptions();
  renderScene();
}

function refreshKnifeFromModifierEvent(event) {
  updateKnifeHover({
    ...state.knifePointer,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey || event.metaKey
  });
}

function cancelKnifeSelection(notify = true) {
  const hadSelection = Boolean(state.knifeSelection);
  state.knifeSelection = null;
  state.knifeHover = null;
  state.knifePointer = null;
  updateToolOptions();
  if (state.tool === 'knife') renderScene();
  if (notify && hadSelection) toast('已取消切割點');
}

function completeKnifeCut(cube, axis, coordinate) {
  snapshot();
  freezeCubeUvs(cube, true);
  const second = splitCubeAt(cube, axis, coordinate);
  if (!second) {
    state.history.pop();
    return toast('切割位置必須位於 Cube 內部');
  }
  state.project.elements.push(second);
  const parent = state.project.getParentGroup(cube.uid);
  const container = parent ? parent.children : state.project.outliner;
  const index = container.indexOf(cube.uid);
  container.splice(index < 0 ? container.length : index + 1, 0, second.uid);
  state.project.invalidateHierarchyIndex();
  const cutLabel = getKnifePreviewLabel(axis);
  state.knifeSelection = null;
  state.knifeHover = null;
  state.knifePointer = null;
  markDirty();
  renderAll();
  toast(`已${cutLabel || '完成切割'} ${cube.name}（${'XYZ'[axis]} 軸）`);
}

function splitBezierAtSegment(curve, segmentIndex) {
  if (!isBezierElement(curve) || segmentIndex < 1 || segmentIndex > curve.nodes.length - 3) {
    return toast('切割後兩端都必須至少保留兩個節點');
  }
  snapshot();
  const originalNodes = curve.nodes.map(node => new CurveNode(structuredClone(node), curve.dimension === 2));
  curve.nodes = originalNodes.slice(0, segmentIndex + 1);
  const second = new BezierElement({
    name: `${curve.name}_split`,
    origin: [...curve.origin], rotation: [...curve.rotation],
    nodes: originalNodes.slice(segmentIndex + 1).map(node => structuredClone(node)),
    parameters: structuredClone(curve.parameters), autoUv: curve.autoUv,
    exported: curve.exported, locked: curve.locked, shade: curve.shade,
    visible: curve.visible, color: curve.color
  }, curve.dimension);
  state.project.elements.push(second);
  const parent = state.project.getParentGroup(curve.uid);
  const container = parent ? parent.children : state.project.outliner;
  const index = container.indexOf(curve.uid);
  container.splice(index < 0 ? container.length : index + 1, 0, second.uid);
  state.project.invalidateHierarchyIndex();
  state.selectedCurveNodeIndex = curve.nodes.length - 1;
  markDirty(); renderAll(); toast('已將貝塞爾元素斷開為兩段');
}

function useKnifePoint(event) {
  const rect = sceneCanvas.getBoundingClientRect();
  const activeCurve = isBezierElement(selected()) ? selected() : null;
  const curveHit = sceneRenderer.pickCurveSegment(state.project,
    event.clientX - rect.left, event.clientY - rect.top, activeCurve?.uid || null);
  if (curveHit) return splitBezierAtSegment(state.project.getNode(curveHit.uid), curveHit.segmentIndex);
  const candidate = getKnifeCandidate(event);
  if (!candidate) return toast(state.knifeSelection ? '第二點必須位於同一個 Cube 面上' : '刀具目前只能切割 Cube');
  const cube = state.project.getNode(candidate.uid);
  if (!state.knifeSelection) {
    if (cube.uid !== state.selectedUid) selectItem(cube.uid, { revealInOutliner: true });
    state.knifeSelection = candidate;
    state.knifeHover = candidate;
    updateToolOptions();
    renderScene();
    toast('已選擇切割點；再選橫切或豎切方向');
    return;
  }
  if (candidate.uid !== state.knifeSelection.uid || candidate.faceName !== state.knifeSelection.faceName) {
    return toast('第二點必須位於同一個 Cube 面上');
  }
  state.knifeHover = candidate;
  const axis = getKnifePreviewAxis();
  if (axis === null) return toast('這個吸附點無法建立有效切面');
  completeKnifeCut(cube, axis, state.knifeSelection.localPoint[axis]);
}

function cssLineColor(variable, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  const rgb = /^#[0-9a-f]{6}$/i.test(value) ? hexToRgb(value) : fallback;
  return [...rgb.map(channel => channel / 255), 1];
}

function offsetKnifePoint(cube, localPoint, faceName) {
  const axes = getKnifeFaceAxes(faceName);
  const point = [...localPoint];
  const center = cube.position[axes.normal] + cube.size[axes.normal] / 2;
  const fallbackSign = ['east', 'up', 'south'].includes(faceName) ? 1 : -1;
  point[axes.normal] += (Math.sign(point[axes.normal] - center) || fallbackSign) * .012;
  return point;
}

function pushKnifeLocalLine(lines, cube, faceName, start, end, color) {
  lines.push({
    start: cubeLocalPointToWorld(cube, offsetKnifePoint(cube, start, faceName)),
    end: cubeLocalPointToWorld(cube, offsetKnifePoint(cube, end, faceName)),
    color
  });
}

function pushKnifeCutLoop(lines, cube, cutAxis, coordinate, color) {
  const [firstAxis, secondAxis] = [0, 1, 2].filter(axis => axis !== cutAxis);
  const inflate = getEffectiveInflate(cube, state.project.getGroupChain(cube.uid));
  const direction = cube.size.map(value => value < 0 ? -1 : 1);
  const surfaceStart = cube.position.map((value, axis) => value - direction[axis] * inflate);
  const surfaceEnd = cube.position.map((value, axis) => value + cube.size[axis] + direction[axis] * inflate);
  const minimum = surfaceStart.map((value, axis) => Math.min(value, surfaceEnd[axis]));
  const maximum = surfaceStart.map((value, axis) => Math.max(value, surfaceEnd[axis]));
  const point = (first, second) => {
    const result = [0, 0, 0];
    result[cutAxis] = coordinate;
    result[firstAxis] = first;
    result[secondAxis] = second;
    return result;
  };
  const corners = [
    point(minimum[firstAxis], minimum[secondAxis]),
    point(maximum[firstAxis], minimum[secondAxis]),
    point(maximum[firstAxis], maximum[secondAxis]),
    point(minimum[firstAxis], maximum[secondAxis])
  ];
  const edges = [
    [0, 1, secondAxis, -1],
    [1, 2, firstAxis, 1],
    [2, 3, secondAxis, 1],
    [3, 0, firstAxis, -1]
  ];
  for (const [startIndex, endIndex, normalAxis, normalSign] of edges) {
    const start = [...corners[startIndex]], end = [...corners[endIndex]];
    start[normalAxis] += normalSign * .012;
    end[normalAxis] += normalSign * .012;
    lines.push({ start: cubeLocalPointToWorld(cube, start), end: cubeLocalPointToWorld(cube, end), color });
  }
}

function pushKnifeCross(lines, candidate, color) {
  if (!candidate) return;
  const cube = state.project.getNode(candidate.uid);
  const axes = cube && getKnifeFaceAxes(candidate.faceName);
  if (!cube || !axes) return;
  const shortest = Math.min(Math.abs(cube.size[axes.horizontal]), Math.abs(cube.size[axes.vertical]));
  const radius = Math.max(.18, Math.min(.52, shortest * .06 || .3));
  const thickness = Math.max(.012, Math.min(.026, radius * .05));
  for (const axis of [axes.horizontal, axes.vertical]) {
    const thicknessAxis = axis === axes.horizontal ? axes.vertical : axes.horizontal;
    for (const offset of [-thickness, 0, thickness]) {
      const start = [...candidate.localPoint], end = [...candidate.localPoint];
      start[axis] = clamp(start[axis] - radius, cube.position[axis], cube.position[axis] + cube.size[axis]);
      end[axis] = clamp(end[axis] + radius, cube.position[axis], cube.position[axis] + cube.size[axis]);
      start[thicknessAxis] = end[thicknessAxis] = clamp(candidate.localPoint[thicknessAxis] + offset,
        cube.position[thicknessAxis], cube.position[thicknessAxis] + cube.size[thicknessAxis]);
      pushKnifeLocalLine(lines, cube, candidate.faceName, start, end, color);
    }
  }
}

function buildKnifeOverlayLines() {
  if (state.tool !== 'knife') return [];
  const lines = [];
  const accent = cssLineColor('--accent', [230, 162, 13]);
  const selectedColor = cssLineColor('--selection-outline', [255, 240, 200]);
  if (state.knifeSelection) pushKnifeCross(lines, state.knifeSelection, selectedColor);
  else if (state.knifeHover) pushKnifeCross(lines, state.knifeHover, accent);
  const axis = getKnifePreviewAxis();
  if (axis === null || !state.knifeSelection) return lines;
  const cube = state.project.getNode(state.knifeSelection.uid);
  pushKnifeCutLoop(lines, cube, axis, state.knifeSelection.localPoint[axis], accent);
  return lines;
}

function nodeTransformAnchor(node) {
  if (node.type === 'cube' || node.type === 'group') return node.pivot;
  return node.position || node.origin;
}

function captureTransformTarget(node) {
  const chain = state.project.getGroupChain(node.uid);
  const worldToLocalAxes = [0, 1, 2].map(worldAxis => {
    let local = [0, 1, 2].map(axis => axis === worldAxis ? 1 : 0);
    chain.forEach(group => { local = inverseRotateVector(local, group.rotation || [0, 0, 0]); });
    return local;
  });
  const anchor = [...nodeTransformAnchor(node)];
  return {
    node,
    chain,
    anchor,
    worldAnchor: applyGroupTransforms(anchor, chain),
    worldToLocalAxes,
    transformAxes: getTransformAxes(node).map(axis => [...axis]),
    position: node.position ? [...node.position] : node.origin ? [...node.origin] : node.pivot ? [...node.pivot] : [0, 0, 0],
    pivot: node.pivot ? [...node.pivot] : null,
    rotation: [...(node.rotation || [0, 0, 0])],
    size: node.size ? [...node.size] : null,
    radius: node.parameters?.radius,
    height: node.parameters?.height,
    groupMembers: node.type === 'group' ? captureGroupMembers(node) : []
  };
}

function translateCapturedTarget(target, delta) {
  const { node } = target;
  if (node.type === 'cube') {
    node.position = target.position.map((value, axis) => value + delta[axis]);
    node.pivot = target.pivot.map((value, axis) => value + delta[axis]);
  } else if (node.origin) node.origin = target.position.map((value, axis) => value + delta[axis]);
  else if (node.position) node.position = target.position.map((value, axis) => value + delta[axis]);
  else if (node.type === 'group') {
    node.pivot = target.position.map((value, axis) => value + delta[axis]);
    target.groupMembers.forEach(member => {
      if (member.node.type === 'cube') {
        member.node.position = member.position.map((value, axis) => value + delta[axis]);
        member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
      } else if (member.node.origin) member.node.origin = member.position.map((value, axis) => value + delta[axis]);
      else if (member.node.position) member.node.position = member.position.map((value, axis) => value + delta[axis]);
      else member.node.pivot = member.position.map((value, axis) => value + delta[axis]);
    });
  }
}

function localDirectionFromWorld(direction, chain) {
  let local = [...direction];
  chain.forEach(group => { local = inverseRotateVector(local, group.rotation || [0, 0, 0]); });
  return normalize3(local);
}

function localDeltaFromWorld(target, worldDelta) {
  return [0, 1, 2].map(component => worldDelta.reduce((sum, value, worldAxis) =>
    sum + value * target.worldToLocalAxes[worldAxis][component], 0));
}

function rotatePointAroundAxis(point, pivot, axis, degrees) {
  const direction = normalize3(axis);
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  const offset = point.map((value, index) => value - pivot[index]);
  const crossed = cross3(direction, offset);
  const aligned = dot3(direction, offset) * (1 - cosine);
  return offset.map((value, index) => pivot[index] + value * cosine + crossed[index] * sine + direction[index] * aligned);
}

function translationMatrix(delta) {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    delta[0], delta[1], delta[2], 1
  ];
}

function rotationMatrixAroundAxis(axis, degrees, pivot) {
  const [x, y, z] = normalize3(axis);
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians), turn = 1 - cosine;
  const r00 = turn * x * x + cosine;
  const r01 = turn * x * y - sine * z;
  const r02 = turn * x * z + sine * y;
  const r10 = turn * x * y + sine * z;
  const r11 = turn * y * y + cosine;
  const r12 = turn * y * z - sine * x;
  const r20 = turn * x * z - sine * y;
  const r21 = turn * y * z + sine * x;
  const r22 = turn * z * z + cosine;
  const rotatedPivot = [
    r00 * pivot[0] + r01 * pivot[1] + r02 * pivot[2],
    r10 * pivot[0] + r11 * pivot[1] + r12 * pivot[2],
    r20 * pivot[0] + r21 * pivot[1] + r22 * pivot[2]
  ];
  return [
    r00, r10, r20, 0,
    r01, r11, r21, 0,
    r02, r12, r22, 0,
    pivot[0] - rotatedPivot[0], pivot[1] - rotatedPivot[1], pivot[2] - rotatedPivot[2], 1
  ];
}

function applyTargetRotation(target, worldAxis, degrees, { separate = false, selfRelative = false, axisIndex = null, euler = false } = {}) {
  const { node } = target;
  if (euler && separate && axisIndex !== null) {
    node.rotation = [...target.rotation];
    node.rotation[axisIndex] = target.rotation[axisIndex] + degrees;
    return;
  }
  const localAxis = selfRelative && axisIndex !== null
    ? [0, 1, 2].map(index => index === axisIndex ? 1 : 0)
    : normalize3(localDeltaFromWorld(target, worldAxis));
  const turn = quaternionFromAxisAngle(localAxis, degrees);
  const current = quaternionFromEuler(target.rotation);
  node.rotation = eulerFromQuaternion(separate && selfRelative
    ? quaternionMultiply(current, turn)
    : quaternionMultiply(turn, current));
}

function startTransformDrag(event, axisIndex, captureTarget, kind = 'free', sign = 1, handleElement = null,
  axisKey = axisIndex === null ? 'free' : String(axisIndex), axisIndices = axisIndex === null ? [] : [axisIndex], axisSigns = [sign]) {
  if (event.button !== 0) return;
  const selectionContext = getSelectionTransformContext();
  const curveNodeContext = activeCurveNodeContext();
  let item = selected();
  if (state.tool === 'pivot' && selectionContext.multiple) item = selectionContext.commonGroup;
  if (!item || !['move', 'resize', 'rotate', 'pivot'].includes(state.tool)) return;
  const targetNodes = state.tool === 'resize'
    ? selectedElementUids().map(uidValue => state.project.getNode(uidValue)).filter(Boolean)
    : selectionContext.nodes;
  const targets = selectionContext.multiple && ['move', 'rotate', 'resize'].includes(state.tool)
    ? targetNodes.map(captureTransformTarget)
    : [captureTransformTarget(item)];
  const rect = sceneCanvas.getBoundingClientRect();
  let handle = axisIndex === null ? null : state.gizmoAxes?.[axisIndex];
  const referenceHandle = handle || state.gizmoAxes?.[axisIndices[0]] || null;
  if (kind === 'rotate-view') {
    const cameraFrame = sceneRenderer.getCameraFrame();
    handle = {
      vector: [...cameraFrame.forward], screen: [1, 0, 0], worldPerPixel: cameraFrame.worldPerPixel,
      centerX: state.gizmoCenter.x, centerY: state.gizmoCenter.y
    };
  }
  const chain = curveNodeContext
    ? [...state.project.getGroupChain(item.uid), { pivot: item.origin, rotation: item.rotation || [0, 0, 0] }]
    : state.project.getGroupChain(item.uid);
  const cameraFrame = sceneRenderer.getCameraFrame();
  const freeMovePlane = kind === 'free' && ['move', 'pivot'].includes(state.tool)
    ? { point: [...state.gizmoOrigin], normal: [...cameraFrame.forward] }
    : null;
  const freeMoveStart = freeMovePlane
    ? intersectRayPlane(sceneRenderer.getScreenRay(event.clientX - rect.left, event.clientY - rect.top), freeMovePlane.point, freeMovePlane.normal)
    : null;
  let storedAxis = handle ? handle.vector.map(value => value * sign) : null;
  const planeAxes = kind.startsWith('plane') ? axisIndices.map((index, pairIndex) => {
    const source = state.gizmoAxes[index];
    const axisSign = axisSigns[pairIndex] || 1;
    let stored = source.vector.map(value => value * axisSign);
    chain.forEach(group => { stored = inverseRotateVector(stored, group.rotation || [0, 0, 0]); });
    if (state.tool === 'resize' && item.type !== 'group') stored = inverseRotateVector(stored, item.rotation || [0, 0, 0]);
    return {
      index,
      sign: axisSign,
      worldAxis: source.vector.map(value => value * axisSign),
      storedAxis: stored,
      screenPerWorld: source.screenPerWorld.map(value => value * axisSign),
      worldPerPixel: source.worldPerPixel
    };
  }) : [];
  const planeDragPlane = planeAxes.length === 2
    ? { point: [...state.gizmoOrigin], normal: normalize3(cross3(planeAxes[0].worldAxis, planeAxes[1].worldAxis)) }
    : null;
  const planeDragStart = planeDragPlane
    ? intersectRayPlane(sceneRenderer.getScreenRay(event.clientX - rect.left, event.clientY - rect.top),
      planeDragPlane.point, planeDragPlane.normal)
    : null;
  let rotationAxis = null;
  let rotationScreenSign = 1;
  if (storedAxis) {
    if (kind === 'rotate' || kind === 'rotate-view') {
      const cameraFrame = sceneRenderer.getCameraFrame();
      const toCamera = cameraFrame.forward.map(value => -value);
      rotationScreenSign = dot3(handle.vector, toCamera) >= 0 ? -1 : 1;
      rotationAxis = [...storedAxis];
      chain.forEach(group => { rotationAxis = inverseRotateVector(rotationAxis, group.rotation || [0, 0, 0]); });
      if (state.transformSpace === 'self' && kind === 'rotate') rotationAxis = [0, 0, 0].map((_, index) => index === axisIndex ? 1 : 0);
    } else {
      chain.forEach(group => { storedAxis = inverseRotateVector(storedAxis, group.rotation || [0, 0, 0]); });
      if (state.tool === 'resize' && item.type !== 'group') storedAxis = inverseRotateVector(storedAxis, item.rotation || [0, 0, 0]);
    }
  }
  captureTarget.setPointerCapture(event.pointerId);
  handleElement?.classList.add('active');
  sceneRenderer.clearSelectionPreviewTransform();
  const gizmoCenter = referenceHandle
    ? { x: referenceHandle.centerX + rect.left, y: referenceHandle.centerY + rect.top }
    : { x: state.gizmoCenter.x + rect.left, y: state.gizmoCenter.y + rect.top };
  state.dragging = {
    type: 'transform', tool: state.tool, pointerId: event.pointerId,
    snapshotTaken: false,
    x: event.clientX, y: event.clientY, item, axisIndex, axisIndices, axisSigns, axisKey,
    axis: handle ? { ...handle, screen: handle.screen.map(value => value * sign) } : null,
    planeAxes, planeDragPlane, planeDragStart,
    referenceWorldPerPixel: referenceHandle?.worldPerPixel, freeMovePlane, freeMoveStart,
    kind, sign, rotationAxis, rotationScreenSign, handleElement, gizmoCenter: handle ? gizmoCenter : null,
    rotationMode: state.transformSpace === 'self' ? state.rotationMode : 'pose',
    startAngle: kind.startsWith('rotate') && handle ? Math.atan2(event.clientY - (handle.centerY + rect.top), event.clientX - (handle.centerX + rect.left)) : 0,
    rect, storedAxis, chain, selectionContext, targets, multiTransformMode: state.multiTransformMode,
    batchPreview: selectionContext.multiple && state.multiTransformMode === 'unified'
      && ['move', 'rotate'].includes(state.tool),
    baseSelectionCenter: selectionContext.center ? [...selectionContext.center] : null,
    baseSelectionPivot: selectionContext.pivot ? [...selectionContext.pivot] : null,
    position: curveNodeContext ? [...curveNodeContext.node.position]
      : item.position ? [...item.position] : item.origin ? [...item.origin] : item.pivot ? [...item.pivot] : [0, 0, 0],
    pivot: curveNodeContext ? [...curveNodeContext.node.position]
      : item.pivot ? [...item.pivot] : item.type === 'node' ? [...item.position] : null,
    size: item.size ? [...item.size] : null,
    rotation: [...(curveNodeContext
      ? curveNodeContext.node.autoTangent
        ? curveNodeContext.curve.resolvedNodeState(curveNodeContext.index).rotation
        : curveNodeContext.node.rotation
      : item.rotation || [0, 0, 0])],
    nodeRoll: curveNodeContext?.node.roll || 0,
    radius: item.parameters?.radius,
    height: item.parameters?.height,
    uvFrozen: false,
    groupMembers: item.type === 'group' ? captureGroupMembers(item) : [],
    curveNodeContext
  };
  sceneRenderer.beginTransformGhost();
  $('#transformTooltip').hidden = true;
  sceneCanvas.classList.add(`is-${state.tool}`);
}

function onPointerMove(event) {
  if (state.tool === 'knife' && !state.dragging) {
    updateKnifeHover(event);
    return;
  }
  if (!state.dragging) {
    const curve = selected();
    const rect = sceneCanvas.getBoundingClientRect();
    const handle = (isBezierElement(curve) || curve?.type === 'node') && !isEffectivelyLocked(curve.uid)
      ? sceneRenderer.pickCurveHandle(state.project, curve.uid, event.clientX - rect.left, event.clientY - rect.top, null)
      : null;
    sceneCanvas.classList.toggle('is-curve-handle-hover', Boolean(handle));
    return;
  }
  const dx = event.clientX - state.dragging.x;
  const dy = event.clientY - state.dragging.y;
  if (state.dragging.type === 'curve-handle') {
    const drag = state.dragging;
    if (!drag.snapshotTaken && Math.hypot(dx, dy) < .5) return;
    if (!drag.snapshotTaken) {
      snapshot();
      drag.snapshotTaken = true;
      markDirty();
    }
    const ray = sceneRenderer.getScreenRay(event.clientX - drag.rect.left, event.clientY - drag.rect.top);
    const intersection = intersectRayPlane(ray, drag.plane.point, drag.plane.normal);
    if (!intersection) return;
    const curvePoint = drag.curve.type === 'node'
      ? worldPointToParentLocal(drag.curve, intersection)
      : worldPointToCurveLocal(drag.curve, intersection);
    if (isBezierElement(drag.curve) && drag.node.autoTangent) bakeCurveNodeTangent(drag.curve, drag.nodeIndex);
    let handle = inverseRotateVector(
      curvePoint.map((value, axis) => value - drag.node.position[axis]),
      drag.node.rotation || [0, 0, 0]
    );
    if (drag.curve.dimension === 2) handle[1] = 0;
    if (isBezierElement(drag.curve)) drag.node.autoTangent = false;
    drag.node[drag.property] = handle;
    drag.tooltipText = `${drag.property === 'handleIn' ? '前' : '後'}手柄 ${formatNumber(Math.hypot(...handle))} px`;
    invalidateSelectionRenderGeometry();
    updateTransformTooltip(event, drag);
    renderScene();
    return;
  }
  if (state.dragging.type === 'selection-box') {
    const rect = sceneCanvas.getBoundingClientRect();
    state.dragging.currentX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    state.dragging.currentY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    state.dragging.mode = viewportSelectionMode(event);
    if (!state.dragging.moved && Math.hypot(dx, dy) < 4) return;
    state.dragging.moved = true;
    updateSelectionMarquee(state.dragging);
    return;
  }
  if (state.dragging.type === 'transform') {
    if (Math.hypot(dx, dy) < .5) return;
    if (!state.dragging.snapshotTaken) {
      snapshot();
      state.dragging.snapshotTaken = true;
    }
    if (state.dragging.tool === 'resize' && !state.dragging.uvFrozen) {
      state.dragging.targets.filter(target => target.node.type === 'cube' && target.node.autoUv === false)
        .forEach(target => freezeCubeUvs(target.node));
      state.dragging.uvFrozen = true;
    }
    state.dragging.pendingTransform = {
      dx,
      dy,
      event: {
        clientX: event.clientX,
        clientY: event.clientY,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey
      }
    };
    scheduleTransformUpdate(state.dragging);
    return;
  } else if (state.dragging.type === 'pan') {
    state.target = [0, 1, 2].map(axis => state.dragging.target[axis]
      - state.dragging.right[axis] * dx * state.dragging.worldPerPixel
      + state.dragging.up[axis] * dy * state.dragging.worldPerPixel);
  } else {
    const fullTurn = Math.PI * 2;
    state.yaw = ((state.dragging.yaw - dx * .01) % fullTurn + fullTurn) % fullTurn;
    state.pitch = Math.max(-Math.PI / 2 + .001, Math.min(Math.PI / 2 - .001, state.dragging.pitch + dy * .01));
  }
  renderScene();
}

function applyPendingTransform(drag) {
  const pending = drag?.pendingTransform;
  if (!pending) return false;
  drag.pendingTransform = null;
  applyTransformDrag(drag, pending.dx, pending.dy, pending.event);
  updateTransformTooltip(pending.event, drag);
  if (!drag.batchPreview) invalidateSelectionRenderGeometry();
  if (!state.dirty) markDirty();
  if (!drag.selectionContext.multiple) syncInspectorValues();
  return true;
}

function commitBatchTransform(drag) {
  const preview = drag.previewCommit;
  if (!drag.batchPreview || !preview) {
    sceneRenderer.clearSelectionPreviewTransform();
    return false;
  }
  if (preview.type === 'move') {
    for (const target of drag.targets) {
      translateCapturedTarget(target, localDeltaFromWorld(target, preview.worldDelta));
    }
  } else if (preview.type === 'rotate') {
    for (const target of drag.targets) {
      const nextWorldAnchor = rotatePointAroundAxis(target.worldAnchor, preview.pivot, preview.axis, preview.degrees);
      const worldDelta = nextWorldAnchor.map((value, axis) => value - target.worldAnchor[axis]);
      translateCapturedTarget(target, localDeltaFromWorld(target, worldDelta));
      applyTargetRotation(target, preview.axis, preview.degrees);
    }
  }
  sceneRenderer.clearSelectionPreviewTransform();
  invalidateSelectionRenderGeometry();
  return true;
}

function scheduleTransformUpdate(drag) {
  if (transformUpdateFrame !== null) return;
  transformUpdateFrame = requestAnimationFrame(() => {
    transformUpdateFrame = null;
    if (state.dragging !== drag || !applyPendingTransform(drag)) return;
    renderScene();
  });
}

function endPointerDrag(event) {
  if (!state.dragging) return;
  const finishedDrag = state.dragging;
  if (finishedDrag.type === 'transform') {
    if (transformUpdateFrame !== null) cancelAnimationFrame(transformUpdateFrame);
    transformUpdateFrame = null;
    applyPendingTransform(finishedDrag);
    commitBatchTransform(finishedDrag);
  }
  state.dragging.handleElement?.classList.remove('active');
  const captureTarget = event.currentTarget;
  if (captureTarget.hasPointerCapture?.(event.pointerId)) captureTarget.releasePointerCapture(event.pointerId);
  state.dragging = null;
  if (finishedDrag.type === 'selection-box') {
    selectionMarquee.hidden = true;
    selectionMarquee.classList.remove('is-add', 'is-remove');
    finishedDrag.mode = viewportSelectionMode(event);
    if (event.type !== 'pointercancel' && finishedDrag.moved) {
      const hitUids = sceneRenderer.selectInScreenRect(state.project, {
        x1: finishedDrag.startX, y1: finishedDrag.startY,
        x2: finishedDrag.currentX, y2: finishedDrag.currentY
      }, state.geometryOnly);
      applyViewportBoxSelection(hitUids, finishedDrag);
    } else if (event.type !== 'pointercancel') {
      if (finishedDrag.hitUid) selectItem(finishedDrag.hitUid, {
        revealInOutliner: true,
        toggle: event.ctrlKey || event.metaKey,
        range: event.shiftKey
      });
      else clearSelection();
    }
    return;
  }
  if (finishedDrag.type === 'curve-handle') {
    if (finishedDrag.snapshotTaken) renderInspector();
    $('#transformTooltip').hidden = true;
    sceneCanvas.classList.remove('is-curve-handle', 'is-curve-handle-hover');
    renderScene();
    return;
  }
  if (finishedDrag.type === 'transform' && finishedDrag.snapshotTaken) {
    sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
    syncInspectorValues();
  }
  sceneRenderer.endTransformGhost();
  $('#transformTooltip').hidden = true;
  sceneCanvas.classList.remove('is-orbiting', 'is-panning', 'is-move', 'is-resize', 'is-rotate', 'is-pivot');
  renderScene();
}

function getPlaneDragDistances(drag, event, dx, dy) {
  const [first, second] = drag.planeAxes;
  if (!first || !second) return [];
  const pointer = drag.planeDragPlane && intersectRayPlane(
    sceneRenderer.getScreenRay(event.clientX - drag.rect.left, event.clientY - drag.rect.top),
    drag.planeDragPlane.point,
    drag.planeDragPlane.normal
  );
  if (pointer && drag.planeDragStart) {
    const worldDelta = pointer.map((value, axis) => value - drag.planeDragStart[axis]);
    return [first, second].map(axis => dot3(worldDelta, axis.worldAxis));
  }
  const [ax, ay] = first.screenPerWorld;
  const [bx, by] = second.screenPerWorld;
  const pointerX = dx, pointerY = -dy;
  const determinant = ax * by - ay * bx;
  if (Math.abs(determinant) > .0001) {
    return [
      (pointerX * by - pointerY * bx) / determinant,
      (ax * pointerY - ay * pointerX) / determinant
    ];
  }
  return [first, second].map(axis => {
    const direction = normalize3([axis.screenPerWorld[0], axis.screenPerWorld[1], 0]);
    return (pointerX * direction[0] + pointerY * direction[1]) * axis.worldPerPixel;
  });
}

function getPlaneUniformDistance(drag, dx, dy) {
  const [first, second] = drag.planeAxes;
  if (!first || !second) return 0;
  const combined = [
    first.screenPerWorld[0] + second.screenPerWorld[0],
    first.screenPerWorld[1] + second.screenPerWorld[1]
  ];
  const lengthSquared = dot3([combined[0], combined[1], 0], [combined[0], combined[1], 0]);
  if (lengthSquared < .0001) return 0;
  return (dx * combined[0] + -dy * combined[1]) / lengthSquared;
}

function applyTransformDrag(drag, dx, dy, event) {
  const item = drag.item;
  const axisDelta = drag.kind.startsWith('rotate') && drag.axis
    ? (() => {
      const angle = Math.atan2(event.clientY - drag.gizmoCenter.y, event.clientX - drag.gizmoCenter.x);
      let delta = angle - drag.startAngle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      return delta * 180 / Math.PI * drag.rotationScreenSign;
    })()
    : drag.axis
    ? (dx * drag.axis.screen[0] + -dy * drag.axis.screen[1]) * drag.axis.worldPerPixel
    : null;
  const fallbackScale = drag.axis?.worldPerPixel || drag.referenceWorldPerPixel || (state.projection === 'perspective'
    ? 2 * (42 / state.zoom) * Math.tan(Math.PI / 8) / drag.rect.height
    : 36 / (drag.rect.height * state.zoom));
  if (drag.tool === 'pivot') {
    let delta;
    if (drag.kind === 'plane') {
      const distances = getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event));
      delta = [0, 0, 0];
      drag.planeAxes.forEach((axis, index) => {
        delta = delta.map((value, component) => value + axis.storedAxis[component] * distances[index]);
      });
    } else if (drag.axis) {
      const distance = snapValue(axisDelta, event);
      delta = drag.storedAxis.map(value => value * distance);
    } else {
      const frame = sceneRenderer.getCameraFrame();
      const pointer = intersectRayPlane(
        sceneRenderer.getScreenRay(event.clientX - drag.rect.left, event.clientY - drag.rect.top),
        drag.freeMovePlane.point,
        drag.freeMovePlane.normal
      );
      delta = pointer && drag.freeMoveStart
        ? pointer.map((value, axis) => value - drag.freeMoveStart[axis])
        : [0, 1, 2].map(axis => frame.right[axis] * dx * fallbackScale + frame.up[axis] * -dy * fallbackScale);
      drag.chain.forEach(group => { delta = inverseRotateVector(delta, group.rotation || [0, 0, 0]); });
    }
    const nextPivot = drag.axis || drag.kind === 'plane'
      ? drag.pivot.map((value, axis) => value + delta[axis])
      : drag.pivot.map((value, axis) => snapValue(value + delta[axis], event));
    if (drag.curveNodeContext) {
      drag.curveNodeContext.node.position = nextPivot.map((value, axis) => drag.curveNodeContext.curve.dimension === 2 && axis === 1 ? 0 : value);
    } else if (item.type === 'node') item.position = nextPivot;
    else setPivotPreservingGeometry(state.project, item, nextPivot);
    drag.tooltipText = `${drag.curveNodeContext || item.type === 'node' ? '節點' : '樞軸'} ${nextPivot.map(formatNumber).join(' / ')}`;
  }
  if (drag.tool === 'move' && drag.targets.length > 1) {
    let distances = [];
    let commonWorldDelta;
    if (drag.kind === 'plane') {
      distances = getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event));
      commonWorldDelta = [0, 0, 0];
      drag.planeAxes.forEach((axis, index) => {
        commonWorldDelta = commonWorldDelta.map((value, component) => value + axis.worldAxis[component] * distances[index]);
      });
      drag.tooltipText = `距離 ${drag.axisIndices.map(index => 'XYZ'[index]).join('')} ${distances.map(formatSigned).join(' / ')} px`;
    } else if (drag.axis) {
      distances = [snapValue(axisDelta, event)];
      const direction = drag.axis.vector.map(value => value * drag.sign);
      commonWorldDelta = direction.map(value => value * distances[0]);
      drag.tooltipText = `距離 ${formatSigned(distances[0])} px`;
    } else {
      const frame = sceneRenderer.getCameraFrame();
      const pointer = intersectRayPlane(
        sceneRenderer.getScreenRay(event.clientX - drag.rect.left, event.clientY - drag.rect.top),
        drag.freeMovePlane.point,
        drag.freeMovePlane.normal
      );
      commonWorldDelta = pointer && drag.freeMoveStart
        ? pointer.map((value, axis) => value - drag.freeMoveStart[axis])
        : [0, 1, 2].map(axis => frame.right[axis] * dx * fallbackScale + frame.up[axis] * -dy * fallbackScale);
      commonWorldDelta = commonWorldDelta.map(value => snapValue(value, event));
      drag.tooltipText = `距離 ${formatSigned(Math.hypot(...commonWorldDelta))} px`;
    }
    if (drag.batchPreview) {
      drag.previewCommit = { type: 'move', worldDelta: [...commonWorldDelta] };
      sceneRenderer.setSelectionPreviewTransform(translationMatrix(commonWorldDelta));
      if (drag.baseSelectionCenter) drag.selectionContext.center = drag.baseSelectionCenter
        .map((value, axis) => value + commonWorldDelta[axis]);
      return;
    }
    for (const target of drag.targets) {
      let worldDelta = commonWorldDelta;
      if (drag.multiTransformMode === 'separate' && drag.axis) {
        const targetAxes = target.transformAxes;
        if (drag.kind === 'plane') {
          worldDelta = [0, 0, 0];
          drag.axisIndices.forEach((axisIndex, index) => {
            const signValue = drag.axisSigns[index] || 1;
            worldDelta = worldDelta.map((value, component) => value + targetAxes[axisIndex][component] * signValue * distances[index]);
          });
        } else {
          worldDelta = targetAxes[drag.axisIndex].map(value => value * drag.sign * distances[0]);
        }
      }
      translateCapturedTarget(target, localDeltaFromWorld(target, worldDelta));
    }
    return;
  }
  if (drag.tool === 'move') {
    let delta;
    if (drag.kind === 'plane') {
      const distances = getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event));
      delta = [0, 0, 0];
      drag.planeAxes.forEach((axis, index) => {
        delta = delta.map((value, component) => value + axis.storedAxis[component] * distances[index]);
      });
      drag.tooltipText = `距離 ${drag.axisIndices.map(index => 'XYZ'[index]).join('')} ${distances.map(formatSigned).join(' / ')} px`;
    } else if (drag.axis) {
      const snappedDistance = snapValue(axisDelta, event);
      delta = drag.storedAxis.map(value => value * snappedDistance);
    }
    else {
      const frame = sceneRenderer.getCameraFrame();
      const pointer = intersectRayPlane(
        sceneRenderer.getScreenRay(event.clientX - drag.rect.left, event.clientY - drag.rect.top),
        drag.freeMovePlane.point,
        drag.freeMovePlane.normal
      );
      const worldDelta = pointer && drag.freeMoveStart
        ? pointer.map((value, axis) => value - drag.freeMoveStart[axis])
        : [0, 1, 2].map(axis => frame.right[axis] * dx * fallbackScale + frame.up[axis] * -dy * fallbackScale);
      delta = [...worldDelta];
      drag.chain.forEach(group => { delta = inverseRotateVector(delta, group.rotation || [0, 0, 0]); });
    }
    const next = drag.axis || drag.kind === 'plane'
      ? drag.position.map((value, axis) => value + delta[axis])
      : drag.position.map((value, axis) => snapValue(value + delta[axis], event));
    if (drag.kind !== 'plane') drag.tooltipText = `距離 ${formatSigned(Math.hypot(...next.map((value, axis) => value - drag.position[axis])))} px`;
    if (drag.curveNodeContext) {
      drag.curveNodeContext.node.position = next.map((value, axis) => drag.curveNodeContext.curve.dimension === 2 && axis === 1 ? 0 : value);
    } else if (item.type === 'cube') {
      const applied = next.map((value, axis) => value - drag.position[axis]);
      item.position = next;
      item.pivot = drag.pivot.map((value, axis) => value + applied[axis]);
    } else if (item.origin) item.origin = next;
    else if (item.position) item.position = next;
    else if (item.type === 'group') {
      const delta = next.map((value, axis) => value - drag.position[axis]);
      item.pivot = next;
      drag.groupMembers.forEach(member => {
        if (member.node.type === 'cube') {
          member.node.position = member.position.map((value, axis) => value + delta[axis]);
          member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
        } else if (member.node.origin) member.node.origin = member.position.map((value, axis) => value + delta[axis]);
        else if (member.node.position) member.node.position = member.position.map((value, axis) => value + delta[axis]);
        else member.node.pivot = member.position.map((value, axis) => value + delta[axis]);
      });
    }
  }
  if (drag.tool === 'resize' && drag.selectionContext.multiple) {
    const planeDistances = drag.kind === 'plane'
      ? getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event))
      : [];
    for (const target of drag.targets) {
      const targetItem = target.node;
      if (targetItem.type === 'cube') {
        const size = [...target.size];
        const position = [...target.position];
        if (drag.kind === 'plane-uniform') {
          const distance = snapValue(getPlaneUniformDistance(drag, dx, dy), event);
          for (const targetAxis of drag.axisIndices) {
            const proposed = target.size[targetAxis] + distance * 2;
            size[targetAxis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
            position[targetAxis] = target.position[targetAxis] - (size[targetAxis] - target.size[targetAxis]) / 2;
          }
        } else if (drag.kind === 'uniform') {
          const factor = 1 - dy * .01;
          for (let axis = 0; axis < 3; axis++) {
            const proposed = snapValue(target.size[axis] * factor, event);
            size[axis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
            position[axis] = target.position[axis] - (size[axis] - target.size[axis]) / 2;
          }
        } else if (drag.kind === 'plane') {
          drag.axisIndices.forEach((targetAxis, index) => {
            const proposed = target.size[targetAxis] + planeDistances[index];
            size[targetAxis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
            if ((drag.axisSigns[index] || 1) < 0) position[targetAxis] = target.position[targetAxis] + size[targetAxis] - target.size[targetAxis];
          });
        } else {
          const targetAxis = drag.axis ? drag.axisIndex : 0;
          const requestedChange = drag.axis ? snapValue(axisDelta, event) : snapValue(dx * fallbackScale, event);
          const proposed = target.size[targetAxis] + requestedChange;
          size[targetAxis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
          if (drag.axis && drag.sign < 0) position[targetAxis] = target.position[targetAxis] + size[targetAxis] - target.size[targetAxis];
        }
        targetItem.position = position;
        targetItem.size = size;
      } else if (targetItem.type === 'shape') {
        if (drag.kind === 'plane-uniform') {
          const distance = snapValue(getPlaneUniformDistance(drag, dx, dy), event);
          if (drag.axisIndices.includes(1)) targetItem.parameters.height = Math.max(0, snapShapeDimension(targetItem, 'height', target.height + distance * 2, event));
          if (drag.axisIndices.some(index => index !== 1)) targetItem.parameters.radius = Math.max(0, snapShapeDimension(targetItem, 'radius', target.radius + distance, event));
        } else if (drag.kind === 'uniform') {
          const factor = Math.max(0, 1 - dy * .01);
          targetItem.parameters.radius = Math.max(0, snapShapeDimension(targetItem, 'radius', target.radius * factor, event));
          targetItem.parameters.height = Math.max(0, snapShapeDimension(targetItem, 'height', target.height * factor, event));
        } else if (drag.kind === 'plane') {
          const radialChanges = [];
          drag.axisIndices.forEach((targetAxis, index) => {
            if (targetAxis === 1) targetItem.parameters.height = Math.max(0, snapShapeDimension(targetItem, 'height', target.height + planeDistances[index], event));
            else radialChanges.push(planeDistances[index]);
          });
          if (radialChanges.length) targetItem.parameters.radius = Math.max(0, snapShapeDimension(targetItem, 'radius', target.radius + radialChanges.reduce((sum, value) => sum + value, 0) / radialChanges.length, event));
        } else if (drag.axisIndex === 1) targetItem.parameters.height = Math.max(0, snapShapeDimension(targetItem, 'height', target.height + axisDelta, event));
        else targetItem.parameters.radius = Math.max(0, snapShapeDimension(targetItem, 'radius', target.radius + (axisDelta ?? dx * fallbackScale), event));
      }
    }
    drag.tooltipText = drag.kind === 'uniform' ? `等比縮放 ${drag.targets.length} 項` : `縮放 ${drag.targets.length} 項`;
    return;
  }
  if (drag.tool === 'resize') {
    if (item.type === 'cube') {
      const size = [...drag.size];
      if (drag.kind === 'plane-uniform') {
        const distance = snapValue(getPlaneUniformDistance(drag, dx, dy), event);
        const position = [...drag.position];
        for (const targetAxis of drag.axisIndices) {
          const proposed = drag.size[targetAxis] + distance * 2;
          size[targetAxis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
          const appliedChange = size[targetAxis] - drag.size[targetAxis];
          position[targetAxis] = drag.position[targetAxis] - appliedChange / 2;
        }
        item.position = position;
        drag.tooltipText = `平面等距 ${drag.axisIndices.map(index => `${'XYZ'[index]} ${formatNumber(size[index])}`).join(' / ')} px`;
      } else if (drag.kind === 'uniform') {
        const factor = 1 - dy * .01;
        const changes = [];
        for (let axis = 0; axis < 3; axis++) {
          const proposed = snapValue(drag.size[axis] * factor, event);
          size[axis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
          changes[axis] = size[axis] - drag.size[axis];
        }
        item.position = drag.position.map((value, axis) => value - changes[axis] / 2);
        drag.tooltipText = `等比尺寸 ${size.map(formatNumber).join(' × ')} px`;
      } else if (drag.kind === 'plane') {
        const distances = getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event));
        let position = [...drag.position];
        drag.planeAxes.forEach((planeAxis, index) => {
          const targetAxis = planeAxis.index;
          const proposed = drag.size[targetAxis] + distances[index];
          size[targetAxis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
          const appliedChange = size[targetAxis] - drag.size[targetAxis];
          if (planeAxis.sign < 0) position = position.map((value, component) => value + planeAxis.storedAxis[component] * appliedChange);
        });
        item.position = position;
        drag.tooltipText = `尺寸 ${drag.axisIndices.map(index => `${'XYZ'[index]} ${formatNumber(size[index])}`).join(' / ')} px`;
      } else {
        const targetAxis = drag.axis ? drag.axisIndex : 0;
        const requestedChange = drag.axis ? snapValue(axisDelta, event) : snapValue(dx * fallbackScale, event);
        const proposedSize = drag.size[targetAxis] + requestedChange;
        size[targetAxis] = state.allowNegativeSize ? proposedSize : Math.max(0, proposedSize);
        const appliedChange = size[targetAxis] - drag.size[targetAxis];
        if (drag.axis && drag.sign < 0) item.position = drag.position.map((value, component) => value + drag.storedAxis[component] * appliedChange);
        drag.tooltipText = `尺寸 ${'XYZ'[targetAxis]} ${formatNumber(size[targetAxis])} px`;
      }
      item.size = size;
    }
    if (item.type === 'shape') {
      if (drag.kind === 'plane-uniform') {
        const distance = snapValue(getPlaneUniformDistance(drag, dx, dy), event);
        if (drag.axisIndices.includes(1)) item.parameters.height = Math.max(0, snapShapeDimension(item, 'height', drag.height + distance * 2, event));
        if (drag.axisIndices.some(index => index !== 1)) item.parameters.radius = Math.max(0, snapShapeDimension(item, 'radius', drag.radius + distance, event));
        drag.tooltipText = `平面等距 半徑 ${formatNumber(item.parameters.radius)} / 高度 ${formatNumber(item.parameters.height)} px`;
      } else if (drag.kind === 'uniform') {
        const factor = Math.max(0, 1 - dy * .01);
        item.parameters.radius = Math.max(0, snapShapeDimension(item, 'radius', drag.radius * factor, event));
        item.parameters.height = Math.max(0, snapShapeDimension(item, 'height', drag.height * factor, event));
        drag.tooltipText = `等比尺寸 半徑 ${formatNumber(item.parameters.radius)} / 高度 ${formatNumber(item.parameters.height)} px`;
      } else if (drag.kind === 'plane') {
        const distances = getPlaneDragDistances(drag, dx, dy).map(value => snapValue(value, event));
        const radialChanges = [];
        drag.planeAxes.forEach((planeAxis, index) => {
          if (planeAxis.index === 1) item.parameters.height = Math.max(0, snapShapeDimension(item, 'height', drag.height + distances[index], event));
          else radialChanges.push(distances[index]);
        });
        if (radialChanges.length) item.parameters.radius = Math.max(0, snapShapeDimension(item, 'radius', drag.radius + radialChanges.reduce((sum, value) => sum + value, 0) / radialChanges.length, event));
        drag.tooltipText = `尺寸 半徑 ${formatNumber(item.parameters.radius)} / 高度 ${formatNumber(item.parameters.height)} px`;
      } else {
        if (drag.axisIndex === 1) item.parameters.height = Math.max(0, snapShapeDimension(item, 'height', drag.height + axisDelta, event));
        else item.parameters.radius = Math.max(0, snapShapeDimension(item, 'radius', drag.radius + (axisDelta ?? dx * fallbackScale), event));
        drag.tooltipText = `${drag.axisIndex === 1 ? '高度' : '半徑'} ${formatNumber(drag.axisIndex === 1 ? item.parameters.height : item.parameters.radius)} px`;
      }
    }
  }
  if (drag.tool === 'rotate' && drag.targets.length > 1) {
    const angleStep = getAngleSnapStep(event);
    const angle = drag.axis ? axisDelta : (dx - dy) * .4;
    const snappedDelta = snapAngle(angle, angleStep);
    const commonAxis = drag.axis
      ? drag.axis.vector.map(value => value * drag.sign)
      : [0, 1, 0];
    const commonPivot = drag.selectionContext.pivot || drag.selectionContext.center || state.gizmoOrigin;
    if (drag.batchPreview) {
      drag.previewCommit = {
        type: 'rotate', axis: [...commonAxis], pivot: [...commonPivot], degrees: snappedDelta,
        axisIndex: drag.axisIndex, kind: drag.kind
      };
      sceneRenderer.setSelectionPreviewTransform(rotationMatrixAroundAxis(commonAxis, snappedDelta, commonPivot));
      if (drag.baseSelectionCenter) drag.selectionContext.center = rotatePointAroundAxis(
        drag.baseSelectionCenter, commonPivot, commonAxis, snappedDelta);
      return;
    }
    for (const target of drag.targets) {
      const separate = drag.multiTransformMode === 'separate';
      const targetAxis = separate && drag.kind === 'rotate'
        ? target.transformAxes[drag.axisIndex]
        : commonAxis;
      if (!separate) {
        const nextWorldAnchor = rotatePointAroundAxis(target.worldAnchor, commonPivot, targetAxis, snappedDelta);
        const worldDelta = nextWorldAnchor.map((value, axis) => value - target.worldAnchor[axis]);
        translateCapturedTarget(target, localDeltaFromWorld(target, worldDelta));
      }
      applyTargetRotation(target, targetAxis, snappedDelta, {
        separate,
        selfRelative: separate && drag.kind === 'rotate' && state.transformSpace === 'self',
        axisIndex: drag.axisIndex,
        euler: separate && drag.rotationMode === 'euler' && drag.kind === 'rotate'
      });
    }
    drag.tooltipText = `角度 ${formatSigned(snappedDelta)}°`;
    return;
  }
  if (drag.tool === 'rotate') {
    const angleStep = getAngleSnapStep(event);
    const angle = drag.axis ? axisDelta : (dx - dy) * .4;
    const editsCurveRoll = drag.curveNodeContext?.curve.dimension === 3
      && state.transformSpace === 'self'
      && drag.kind === 'rotate'
      && drag.axisIndex === 2;
    if (editsCurveRoll) {
      const snappedDelta = snapAngle(angle, angleStep);
      drag.curveNodeContext.node.roll = drag.nodeRoll + snappedDelta;
      drag.tooltipText = `滾動角 ${formatSigned(drag.curveNodeContext.node.roll)}°`;
      return;
    }
    if (drag.curveNodeContext?.node.autoTangent) {
      bakeCurveNodeTangent(drag.curveNodeContext.curve, drag.curveNodeContext.index);
    }
    if (drag.axis) {
      const snappedDelta = snapAngle(angle, angleStep);
      if (drag.rotationMode === 'euler' && drag.kind === 'rotate') {
        const target = drag.curveNodeContext?.node || item;
        target.rotation = [...drag.rotation];
        target.rotation[drag.axisIndex] = drag.rotation[drag.axisIndex] + snappedDelta;
      } else {
        const turn = quaternionFromAxisAngle(drag.rotationAxis, snappedDelta);
        const current = quaternionFromEuler(drag.rotation);
        const target = drag.curveNodeContext?.node || item;
        target.rotation = eulerFromQuaternion(state.transformSpace === 'self' && drag.kind !== 'rotate-view'
          ? quaternionMultiply(current, turn)
          : quaternionMultiply(turn, current));
      }
      if (drag.curveNodeContext?.curve.dimension === 2) {
        drag.curveNodeContext.node.rotation[0] = 0;
        drag.curveNodeContext.node.rotation[2] = 0;
      }
      if (drag.curveNodeContext) drag.curveNodeContext.node.autoTangent = false;
      drag.tooltipText = `角度 ${formatSigned(snappedDelta)}°`;
    } else {
      const target = drag.curveNodeContext?.node || item;
      target.rotation = [snapAngle(drag.rotation[0] - dy * .4, angleStep), snapAngle(drag.rotation[1] + dx * .4, angleStep), drag.rotation[2]];
      if (drag.curveNodeContext?.curve.dimension === 2) {
        target.rotation[0] = 0;
        target.rotation[2] = 0;
      }
      if (drag.curveNodeContext) drag.curveNodeContext.node.autoTangent = false;
      drag.tooltipText = `角度 ${formatSigned(Math.hypot(dx, dy) * .4)}°`;
    }
  }
}

function updateTransformTooltip(event, drag) {
  const tooltip = $('#transformTooltip');
  const viewportRect = $('#viewport').getBoundingClientRect();
  tooltip.textContent = drag.tooltipText || '';
  tooltip.style.left = `${Math.max(8, Math.min(viewportRect.width - 150, event.clientX - viewportRect.left + 14))}px`;
  tooltip.style.top = `${Math.max(28, event.clientY - viewportRect.top - 10)}px`;
  tooltip.hidden = !drag.tooltipText;
}

function captureGroupMembers(group) {
  const members = [];
  const visit = uidValue => {
    const node = state.project.getNode(uidValue); if (!node) return;
    if (node.type === 'group') {
      if (node !== group) members.push({ node, position: [...node.pivot] });
      node.children.forEach(visit);
    } else if (node.type === 'cube') members.push({ node, position: [...node.position], pivot: [...node.pivot] });
    else if (node.position) members.push({ node, position: [...node.position] });
    else members.push({ node, position: [...node.origin] });
  };
  group.children.forEach(visit);
  return members;
}

function getSnapSubdivisions(event = {}) {
  const standard = activeSnapSubdivisions();
  const modifier = event.shiftKey && event.ctrlKey
    ? state.modifierSnap.shiftCtrl
    : event.shiftKey
      ? state.modifierSnap.shift
      : event.ctrlKey
        ? state.modifierSnap.ctrl
        : null;
  if (!modifier) return standard;
  return modifier.mode === 'multiplier' ? standard * modifier.value : modifier.value;
}

function getSnapStep(event = {}) { return 16 / Math.max(.0001, getSnapSubdivisions(event)); }
function snapValue(value, event) { const step = getSnapStep(event); return Math.round(value / step) * step; }
function getAngleSnapStep(event = {}) {
  const ctrl = event.ctrlKey || event.metaKey;
  if (event.shiftKey && ctrl) return .05;
  if (event.shiftKey) return .5;
  if (ctrl) return 15;
  return 2.5;
}

function snapShapeDimension(shape, key, value, event = {}) {
  const mode = shape?.parameters?.snapMode === 'bounds' ? 'bounds' : 'cube';
  if (mode === 'cube') {
    const step = Math.max(.0625, Number(shape.parameters.cubeSize) || 1);
    if (key !== 'radius') return Math.round(value / step) * step;
    const sides = Math.max(3, Math.round(Number(shape.parameters.sides) || 3));
    const halfTurn = Math.PI / sides;
    const outwardOffset = step / (2 * Math.cos(halfTurn));
    const centerRadius = Math.max(.001, value - outwardOffset);
    const wallLength = 2 * centerRadius * Math.sin(halfTurn) + step * Math.tan(halfTurn);
    const snappedLength = Math.max(step, Math.round(wallLength / step) * step);
    return Math.max(.001,
      (snappedLength - step * Math.tan(halfTurn)) / (2 * Math.sin(halfTurn))) + outwardOffset;
  }
  return key === 'radius' ? snapValue(value * 2, event) / 2 : snapValue(value, event);
}
function snapAngle(value, step) { return Math.round(value / step) * step; }
function formatNumber(value) { return Number(value.toFixed(4)).toString(); }
function formatSigned(value) { const rounded = formatNumber(value); return value > 0 ? `+${rounded}` : rounded; }

function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function escapeAttribute(value) { return escapeHtml(value).replaceAll('"', '&quot;'); }
function round(value) { return Math.round(value * 10000) / 10000; }
function hexToRgb(hex) { const n = parseInt(hex.replace('#', ''), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }

initializeDockSystem();
initializeConfigRegistry();
modelFormatRegistry.subscribe(() => {
  renderModelFormatPicker();
  updateSelectionLabels();
});
loadTheme();
sceneRenderer.setSelectionOutline(getComputedStyle(document.documentElement).getPropertyValue('--selection-outline').trim());
initializeProjectTabs();
renderTexture();
renderPalette();
renderModelFormatPicker();
bindEvents();
updateToolVisibility();
renderAll();
markDirty(false);
