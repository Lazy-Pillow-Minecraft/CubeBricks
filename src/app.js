import { BezierElement, Cube, CurveNode, Group, Locator, NodeElement, Shape, CubeBricksProject, addModifier, addOperator, bakeModifier, chooseKnifeCutAxis, exportBlockbench, getKnifeFaceAxes, getModifier, importBlockbench, setPivotPreservingGeometry, splitCubeAt } from './model.js';
import { ConfigKey, applyLanguage, configRegistry, getLanguageLabel } from './config/app-config.js';
import { createModelProjectData, modelFormatRegistry } from './config/model-formats.js';
import { modifierRegistry } from './config/modifiers.js';
import { operatorRegistry } from './config/operators.js';
import { allocateGroupName, refreshAutomaticNodeName, setNodeName, setNodeUnnamed } from './model.js';
import { activeLayer, compositeLayers, flipbookFrame, imageCanvas, layerRasterCache, loadRaster, prepareLayers, tiledFaceRaster, tiledFaceReference, tiledFaceRegions, faceTileSize } from './core/texture-features.js';
import { WebGLSceneRenderer, applyGroupTransforms, createBlockbenchFaceUvSlots, getBlockbenchBoxUv, getEffectiveInflate, isCubeFaceCulled } from './render/webgl-renderer.js';
import { DockManager } from './ui/dock-manager.js';
import { DEFAULT_PLAYER_REFERENCE_TEXTURE, createPlayerReferenceProject } from './assets/player-reference.js';
import { operationDefinition, operationIndex, requireOperation } from './core/operation-registry.js';

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
  faceSelect: { modes: ['edit', 'uv'] },
  brush: { modes: ['paint'] },
  line: { modes: ['paint'] },
  rectangle: { modes: ['paint'] },
  ellipse: { modes: ['paint'] },
  fill: { modes: ['paint'] },
  gradient: { modes: ['paint'] },
  eyedropper: { modes: ['paint'] }
});
const PAINT_TOOLS = Object.freeze(['brush', 'line', 'rectangle', 'ellipse', 'fill', 'gradient', 'eyedropper']);
const PAINT_STROKE_TOOLS = Object.freeze(['brush', 'line', 'rectangle', 'ellipse']);
const PAINT_SHAPE_TOOLS = Object.freeze(['line', 'rectangle', 'ellipse']);
const PAINT_ERASE_TOOLS = Object.freeze(['brush', 'line', 'rectangle', 'ellipse', 'fill']);
const paintSymmetryRelationCache = new Map();
const paintSymmetryBuildScheduled = new Set();
const livePaintTextureSources = new Map();
const blobTextureSourceCache = new Map();
const animationRasterCache = new Map();
const paintHitAlphaCache = new Map();
let colorPickerPopupRoot = null;
let colorPickerPopupApply = null;
let recentRotationPress = null;
let pendingRotationPress = null;
let preciseRotationInput = null;

const state = {
  project: new CubeBricksProject({ name: 'untitled' }),
  selectedUid: null,
  selectedUids: new Set(),
  selectedGenerated: null,
  selectionAnchorUid: null,
  selectedCurveNodeIndex: null,
  selectedModifierUid: null,
  inspectorPage: 'basic',
  collapsedModifiers: new Set(),
  collapsedOperators: new Set(),
  mode: 'edit',
  separateUvMode: configRegistry.get(ConfigKey.SEPARATE_UV_MODE),
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
  playerReference: configRegistry.get(ConfigKey.SHOW_PLAYER_REFERENCE),
  geometryOnly: configRegistry.get(ConfigKey.SHOW_GEOMETRY_ONLY),
  modifierResultGhost: configRegistry.get(ConfigKey.MODIFIER_RESULT_GHOST),
  settingsSnap: configRegistry.get(ConfigKey.SNAP),
  allowNegativeSize: configRegistry.get(ConfigKey.ALLOW_NEGATIVE_SIZE),
  modifierSnap: {
    shift: { mode: configRegistry.get(ConfigKey.SHIFT_SNAP_MODE), value: configRegistry.get(ConfigKey.SHIFT_SNAP_VALUE) },
    ctrl: { mode: configRegistry.get(ConfigKey.CTRL_SNAP_MODE), value: configRegistry.get(ConfigKey.CTRL_SNAP_VALUE) },
    shiftCtrl: { mode: configRegistry.get(ConfigKey.SHIFT_CTRL_SNAP_MODE), value: configRegistry.get(ConfigKey.SHIFT_CTRL_SNAP_VALUE) }
  },
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
  axisView: null,
  axisViewSign: 1,
  axisViewCameras: { x: null, y: null, z: null },
  generalCamera: null,
  referenceImageSelection: { general: null, x: null, y: null, z: null },
  history: [],
  future: [],
  hitAreas: [],
  dragging: null,
  outlinerCollapsed: false,
  collapsedGroups: new Set(),
  textureAssets: [],
  textureGroups: [],
  activeTextureUid: null,
  paintColor: '#91ad52',
  paintBrushSize: 1,
  paintBrushShape: 'square',
  paintBrushAa: false,
  paintBrushDepth: 0,
  paintBrushOverlay: false,
  paintBrushOpacity: 100,
  paintToolSettings: Object.fromEntries(['line', 'rectangle', 'ellipse', 'fill', 'gradient'].map(tool => [tool, { size: 1, opacity: 100, erase: false }])),
  paintBrushErase: false,
  paintIgnoreTransparent: false,
  paintBucketScope: 'face',
  paintBucketSingleFace: true,
  paintGradientMode: 'face',
  paintGradientPalette: false,
  paintGradientStop: 'start',
  paintGradientStart: '#91ad52',
  paintGradientStartAlpha: 100,
  paintGradientEnd: '#000000',
  paintGradientEndAlpha: 0,
  paintGradientAnchor: null,
  paintGradientHover: null,
  paintColorPickerMode: 'square',
  paintColorPickerHue: .218,
  paintColorPickerSaturation: .526,
  paintColorPickerValue: .678,
  paintHistory: [],
  paintFuture: [],
  selectedUvFaces: new Set(),
  textureView: { zoom: 1, panX: 0, panY: 0 },
  uvPreviewAutoFocusTexture: true,
  uvPreviewEnabled: true,
  uvPreviewAutoRotate: false,
  uvPreviewFaceColors: true,
  uvPreviewSelectedFace: null,
  uvPreviewYaw: -Math.PI / 4,
  uvPreviewPitch: Math.PI / 7,
  timelinePlaying: false,
  timelineFrame: 0,
  layoutResizing: false
};

let temporaryPaintTool = null;

const DOCK_PANEL_DEFINITIONS = Object.freeze([
  { id: 'texture', index: 0, modes: ['edit', 'uv', 'paint'], hotspotFocus: true, defaultDock: 'left', defaultOrder: 0, defaultPosition: { x: 24, y: 104 }, defaultSize: { width: 236, height: 620 }, defaultCollapsed: false },
  { id: 'uvPreview', index: 1, modes: ['edit', 'uv', 'paint', 'animate'], defaultDock: 'left', defaultOrder: 1, defaultPosition: { x: 24, y: 520 }, defaultSize: { width: 236, height: 260 }, defaultCollapsed: false },
  { id: 'inspector', index: 2, modes: ['edit', 'uv', 'paint', 'animate'], defaultDock: 'right', defaultOrder: 0, defaultPosition: { x: 920, y: 104 }, defaultSize: { width: 292, height: 340 }, defaultCollapsed: false },
  { id: 'outliner', index: 3, modes: ['edit', 'uv', 'paint', 'animate'], defaultDock: 'right', defaultOrder: 1, defaultPosition: { x: 920, y: 460 }, defaultSize: { width: 292, height: 340 }, defaultCollapsed: false },
  { id: 'bottom', index: 4, modes: ['paint'], defaultDock: 'bottom', defaultOrder: 0, defaultPosition: { x: 280, y: 620 }, defaultSize: { width: 720, height: 176 }, defaultCollapsed: false }
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
const referenceImageInput = $('#referenceImageInput');
const referenceImageLayer = $('#referenceImageLayer');
const referenceImageHint = $('#referenceImageHint');
const playerReferenceTextureInput = $('#playerReferenceTextureInput');
const playerReferenceProject = createPlayerReferenceProject();
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
let uvPreviewResizeFrame = null;
let uvPreviewLastFrame = 0;
let uvPreviewProjectCache = null;
let uvPreviewDrag = null;
let uvPreviewTextureDirty = true;
let uvPreviewRenderDirty = true;
let uvPreviewPanelMetrics = null;
const uvPreviewFaceLabelCanvas = document.createElement('canvas');
let uvPreviewFaceLabelCacheKey = null;
let uvPreviewFaceLabelFontRevision = 0;
let texturePreviewSize = [1, 1];
let projectTabs = [];
let activeProjectTabId = null;
let editingProjectTabId = null;
let draggingProjectTabId = null;
let draggingProjectTabInsertIndex = null;
let selectionExpansionCache = null;
let selectionTransformContextCache = null;
let focusedDockHotspot = null;
let textureUvDrag = null;
let texturePaintDrag = null;
let texturePaintSyncFrame = null;
const texturePaintSyncTargets = new Map();
let textureFaceDropTarget = null;
let textureLoadRevision = 0;
const textureAtlasCanvas = document.createElement('canvas');
const textureAtlasCtx = textureAtlasCanvas.getContext('2d');
const textureAtlasPatchCanvas = document.createElement('canvas');
const textureAtlasPatchCtx = textureAtlasPatchCanvas.getContext('2d');
let textureAtlasEntries = [];
let textureAtlasLayoutByUid = new Map();
let textureAtlasRevision = 0;
let textureAtlasRebuildFrame = null;
let textureViewLayout = null;
let textureFocusFrame = null;
let textureUvEntryCache = null;
let mirrorGuideGroupUid = null;
let mirrorGuideEntryUid = null;
let mirrorGuideHoldTimer = null;
let mirrorGuideHideTimer = null;
let subdivisionSession = null;
let referenceImageEditing = false;
let referenceImageDrag = null;
let referenceImportViewKey = 'general';
let axisWidgetDrag = null;
let suppressAxisWidgetClick = false;
let playerReferenceTextureRevision = 0;
const journalTimers = new Map();
let suppressJournalRecording = false;

const PROJECT_SESSION_KEYS = Object.freeze([
  'project', 'selectedUid', 'selectedUids', 'selectedGenerated', 'selectionAnchorUid', 'selectedCurveNodeIndex', 'selectedModifierUid', 'filePath', 'dirty', 'history', 'future',
  'knifeSelection', 'knifeHover', 'knifePointer', 'vertexSnapSource', 'zoom', 'panX', 'panY', 'yaw', 'pitch',
  'target', 'axisView', 'axisViewSign', 'axisViewCameras', 'generalCamera', 'referenceImageSelection', 'collapsedGroups', 'textureAssets', 'textureGroups', 'activeTextureUid', 'paintHistory', 'paintFuture', 'timelineFrame',
  'selectedUvFaces', 'textureView'
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
    collapsedGroups: new Set(),
    textureAssets,
    textureGroups: [],
    activeTextureUid: preferredTexture?._uid || null,
    paintHistory: [],
    paintFuture: [],
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
  textureAtlasRevision++;
  textureAtlasEntries = [];
  textureAtlasLayoutByUid = new Map();
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
  if (tabId !== activeProjectTabId && subdivisionSession) exitSubdivisionEdit(false);
  if (tabId !== activeProjectTabId) {
    const previous = syncActiveProjectTab();
    if (previous?.journalPending) void flushProjectJournal(previous);
  }
  activeProjectTabId = tabId;
  for (const key of PROJECT_SESSION_KEYS) state[key] = tab.session[key];
  state.dragging = null;
  referenceImageEditing = false;
  referenceImageDrag = null;
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
  startProjectJournal(tab, options.journalId ? null : options.imported ? 'core.project.import' : 'core.project.create', options.journalId);
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
    startProjectJournal(replacement, 'core.project.create');
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
  const tab = { id: `project_${crypto.randomUUID()}`, displayName: null, session: captureProjectSession() };
  projectTabs = [tab];
  activeProjectTabId = tab.id;
  startProjectJournal(tab, 'core.project.create');
  renderProjectTabs();
  updateProjectStateLabel();
}

function selected() {
  return state.project.getNode(state.selectedUid);
}

function snapshot(operationId = 'core.element.property') {
  requireOperation(operationId);
  const tab = projectTabById(activeProjectTabId);
  if (tab?.journalPending) void flushProjectJournal(tab);
  if (tab) tab.journalPending = operationId;
  state.history.push(state.project.serialize());
  if (state.history.length > 60) state.history.shift();
  state.future.length = 0;
}

function restore(serialized) {
  const previousSelectedUids = new Set(state.selectedUids);
  const previousSelectedUid = state.selectedUid;
  const previousSelectionAnchorUid = state.selectionAnchorUid;
  subdivisionSession = null;
  state.project = new CubeBricksProject(JSON.parse(serialized));
  state.selectedGenerated = null;
  state.selectedUids = new Set([...previousSelectedUids].filter(uidValue => state.project.getNode(uidValue)));
  state.selectedUid = previousSelectedUid && state.selectedUids.has(previousSelectedUid)
    ? previousSelectedUid
    : [...state.selectedUids].at(-1) || null;
  state.selectionAnchorUid = previousSelectionAnchorUid && state.project.getNode(previousSelectionAnchorUid)
    ? previousSelectionAnchorUid
    : state.selectedUid;
  const restoredSelection = state.project.getNode(state.selectedUid);
  if (!isBezierElement(restoredSelection) || state.selectedCurveNodeIndex >= restoredSelection.nodes.length) state.selectedCurveNodeIndex = null;
  if (![...(restoredSelection?.modifiers || []), ...(restoredSelection?.operators || [])].some(modifier => modifier.uid === state.selectedModifierUid)) state.selectedModifierUid = null;
  if (state.vertexSnapSource && !state.project.getNode(state.vertexSnapSource.rootUid)) state.vertexSnapSource = null;
  if (state.knifeSelection && !state.project.getNode(state.knifeSelection.uid)) cancelKnifeSelection(false);
  markDirty(true);
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
  const tab = projectTabById(activeProjectTabId);
  if (!tab?.journalId || !window.cubeBricksDesktop?.checkoutProjectJournal) return false;
  try {
    await flushProjectJournal(tab);
    if (tab.journalPending) throw new Error('目前變更尚未寫入工作記錄');
    await tab.journalWrites;
    await tab.journalReady;
    const result = await window.cubeBricksDesktop.checkoutProjectJournal({ journalId: tab.journalId, direction });
    if (!result) { toast(direction === 'undo' ? '沒有可撤銷的操作' : '沒有可重做的操作'); return true; }
    const data = JSON.parse(result.content);
    suppressJournalRecording = true;
    try {
      state.textureAssets = (data.textures || []).map(asset => ({
        ...asset, _uid: textureUid(asset), uvWidth: asset.uv_width,
        uvHeight: asset.uv_height, useAsDefault: asset.use_as_default === true,
        groupId: asset.group_id || null, activeLayerUid: asset.active_layer_uid || null
      }));
      restore(JSON.stringify(data));
      restoreProjectTextureView();
      tab.journalHead = result.sequence;
    } finally { suppressJournalRecording = false; }
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
  state.future.push(state.project.serialize());
  restore(state.history.pop());
}

async function redo() {
  if (await navigateProjectJournal('redo')) return;
  if (state.mode === 'paint') {
    if (!restoreTexturePaintHistory(state.paintFuture, state.paintHistory)) toast('沒有可重做的繪畫操作');
    return;
  }
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
  if (value && tab && !suppressJournalRecording) {
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
  tab.journalReady = serializableTextureAssets(structuredClone(tab.session.textureAssets))
    .then(textures => window.cubeBricksDesktop.initProjectJournal({
      journalId: tab.journalId,
      operationId,
      operationIndex: operationIndex(),
      content: serializeCbmodel(textures, JSON.parse(projectContent))
    }));
  tab.journalReady.catch(error => toast(`工作目錄建立失敗：${error.message}`));
}

function scheduleProjectJournal(tab) {
  if (!window.cubeBricksDesktop?.commitProjectJournal) return;
  clearTimeout(journalTimers.get(tab.id));
  journalTimers.set(tab.id, setTimeout(() => {
    journalTimers.delete(tab.id);
    if (tab.id === activeProjectTabId && (state.dragging || texturePaintDrag || textureUvDrag || referenceImageDrag)) {
      scheduleProjectJournal(tab);
      return;
    }
    void flushProjectJournal(tab);
  }, 400));
}

function noteJournalOperation(operationId) {
  const id = requireOperation(operationId);
  const tab = projectTabById(activeProjectTabId);
  if (!tab) return;
  if (tab.journalPending && tab.journalPending !== id) void flushProjectJournal(tab);
  tab.journalPending = id;
  scheduleProjectJournal(tab);
}

async function flushProjectJournal(tab = projectTabById(activeProjectTabId)) {
  if (!tab?.journalPending || !window.cubeBricksDesktop?.commitProjectJournal) return null;
  clearTimeout(journalTimers.get(tab.id));
  journalTimers.delete(tab.id);
  if (tab.id === activeProjectTabId) syncActiveProjectTab();
  const operationId = requireOperation(tab.journalPending);
  tab.journalPending = null;
  const session = tab.session;
  const projectContent = session.project.serialize();
  const assets = structuredClone(session.textureAssets);
  const textureSnapshot = serializableTextureAssets(assets);
  const write = async () => {
    await tab.journalReady;
    const textures = await textureSnapshot;
    const content = serializeCbmodel(textures, JSON.parse(projectContent));
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
  uvPreviewRenderDirty = true;
  textureUvEntryCache = null;
  selectionTransformContextCache = null;
  if (uvPreviewProjectCache) uvPreviewProjectCache.fit = null;
  if (textureAtlasEntries.some(entry => entry.tileSourceUid)) rebuildTextureAtlas();
  scheduleAllPaintSymmetryBuilds();
}

function selectionAffectsMirrorPreview() {
  const selectedIds = state.selectedUids?.size
    ? [...state.selectedUids]
    : state.selectedUid ? [state.selectedUid] : [];
  if (!selectedIds.length) return false;
  const selectedSet = new Set(selectedIds);
  for (const uidValue of selectedIds) {
    const node = state.project.getNode(uidValue);
    if (node?.modifiers?.some(modifier => modifier.type === 'symmetry' && modifier.enabled)) return true;
  }
  // Moving an ancestor also moves the embedded symmetry frame even though the
  // modifier owner itself is not selected.
  return [...state.project.groups, ...state.project.elements].some(owner => owner.modifiers?.some(modifier => modifier.type === 'symmetry' && modifier.enabled)
    && state.project.getGroupChain(owner.uid).some(parent => selectedSet.has(parent.uid)));
}

function invalidateSelectionRenderGeometry(geometryChanged = true) {
  if (geometryChanged) syncSubdivisionEdits();
  sceneRenderer.invalidateSelectionGeometry(geometryChanged);
  uvPreviewRenderDirty = true;
  selectionTransformContextCache = null;
  if (geometryChanged) {
    if (selectionAffectsMirrorPreview()) sceneRenderer.invalidateMirrorGeometry();
    uvPreviewRenderer.invalidateGeometry();
    textureUvEntryCache = null;
    if (uvPreviewProjectCache) uvPreviewProjectCache.fit = null;
    if (textureAtlasEntries.some(entry => entry.tileSourceUid)) rebuildTextureAtlas();
  }
}

function updateSelectionLabels() {
  const item = selected();
  const modifierAnchorSelected = [...(item?.modifiers || []), ...(item?.operators || [])].find(modifier => modifier.uid === state.selectedModifierUid);
  const curveNodeSelected = isBezierElement(item) && Number.isInteger(state.selectedCurveNodeIndex)
    && item.nodes[state.selectedCurveNodeIndex];
  const format = modelFormatRegistry.get(state.project.formatId);
  $('#selectionType').textContent = state.selectedGenerated ? 'modifier_result' : modifierAnchorSelected ? 'modifier_anchor'
    : curveNodeSelected ? 'curve_node' : item?.type || format?.name || 'Scene';
  $('#selectionName').textContent = state.selectedGenerated
    ? `${state.project.getNode(state.selectedGenerated.uid)?.name || '生成物'} · 唯讀`
    : modifierAnchorSelected ? '對稱軸點'
    : curveNodeSelected ? `節點 ${state.selectedCurveNodeIndex + 1}`
    : state.selectedUids.size > 1 ? `已選 ${state.selectedUids.size} 項` : item?.name || state.project.name;
  $('#uidChip').textContent = state.selectedGenerated?.uid || modifierAnchorSelected?.uid || curveNodeSelected?.uid || item?.uid || '—';
  const selectedCount = selectedElementUids().length;
  const counter = $('#outlinerSelectionCount');
  if (counter) counter.textContent = `${selectedCount}/${state.project.elements.filter(element => !element.subdivisionOwnerUid).length}`;
}

function renderOutliner() {
  const filter = $('#outlinerSearch').value.trim().toLowerCase();
  const matches = uidValue => {
    const node = state.project.getNode(uidValue);
    if (!node) return false;
    if (!filter || node.name.toLowerCase().includes(filter) || node.uid.toLowerCase().includes(filter)) return true;
    if (node.type === 'group') return node.children.some(matches);
    return isBezierElement(node) && node.nodes.some((curveNode, index) => curveNode.uid.toLowerCase().includes(filter)
      || `節點 ${index + 1}`.includes(filter));
  };
  const rows = [];
  const collectNode = (uidValue, depth = 0) => {
    const node = state.project.getNode(uidValue);
    if (!node || !matches(uidValue)) return;
    const group = node.type === 'group';
    const curve = isBezierElement(node);
    const container = group || curve;
    const collapsed = container && state.collapsedGroups.has(node.uid);
    rows.push({ node, depth, group, curve, container, collapsed });
    if (group && !collapsed) node.children.forEach(child => collectNode(child, depth + 1));
    if (curve && !collapsed) node.nodes.forEach((curveNode, nodeIndex) => rows.push({
      node: curveNode, depth: depth + 1, group: false, curve: false, container: false, collapsed: false,
      curveNode: true, curveOwner: node, nodeIndex
    }));
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
  windowNode.innerHTML = rows.slice(start, end).map(({ node, depth, container, collapsed, curveNode, curveOwner, nodeIndex }) => {
    if (curveNode) {
      const active = state.selectedUid === curveOwner.uid && state.selectedCurveNodeIndex === nodeIndex;
      return `<button class="outliner-item curve-node-row ${active ? 'active' : ''}" data-uid="${curveOwner.uid}" data-curve-node-index="${nodeIndex}" draggable="false" style="padding-left:${5 + depth * 13}px">
        <span></span><span class="kind curve-node-kind">◆</span><span class="item-name">節點 ${nodeIndex + 1}</span><span></span>
      </button>`;
    }
    return `<button class="outliner-item ${state.outlinerDetailed && state.mode !== 'paint' ? 'has-details' : ''} ${state.selectedUids.has(node.uid) && state.selectedCurveNodeIndex === null ? 'active' : ''}" data-uid="${node.uid}" draggable="${state.mode !== 'paint'}" style="padding-left:${5 + depth * 13}px">
      ${container ? openIconMarkup(collapsed ? 'right' : 'down', 'outliner-disclosure', `data-disclosure="${node.uid}"`) : '<span></span>'}
      <span class="kind">${outlinerKindMarkup(node)}</span>
      <span class="item-name">${escapeHtml(node.name)}</span>${state.mode === 'paint' ? '<span></span>' : outlinerStateMarkup(node)}
    </button>`;
  }).join('');
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

function isUvCapable(node) {
  return Boolean(node && (node.type === 'cube' || isShapeElement(node) || isBezierElement(node) || node.type === 'group'));
}

function nodeUvNormalizedEnabled(node) {
  if (node.type === 'group') {
    const descendants = state.project.getDescendantElementUids(node.uid)
      .map(uidValue => state.project.getNode(uidValue)).filter(isUvCapable);
    return descendants.length ? descendants.every(child => child.uvNormalized !== false) : node.uvNormalized !== false;
  }
  return node.uvNormalized !== false;
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
  const autoUvAvailable = node.type === 'cube' || isShapeElement(node) || isBezierElement(node) || node.type === 'group';
  return [
    outlinerFlag(node, 'autoUv', nodeAutoUvEnabled(node), 'icon-uv-update', 'icon-unuv-update', '自動 UV', '不自動更新 UV', autoUvAvailable),
    outlinerFlag(node, 'uvNormalized', nodeUvNormalizedEnabled(node), 'icon-uv-normalize', 'icon-unuv-normalize', 'UV 歸一化', '保留原 UV 像素', isUvCapable(node)),
    outlinerFlag(node, 'exported', node.exported !== false, 'icon-save', 'icon-unsave', '參與後續格式轉換', '不參與後續格式轉換'),
    outlinerFlag(node, 'locked', node.locked === true, 'icon-locked', 'icon-unlocked', '鎖定', '解鎖'),
    visible
  ].join('');
}

function outlinerKindMarkup(node) {
  if (node.type === 'node') return '<span class="outliner-curve-kind" aria-hidden="true">●</span>';
  if (node.type === 'bezier2d' || node.type === 'bezier3d') return `<span class="outliner-curve-kind" aria-hidden="true">⌁${node.type === 'bezier2d' ? '²' : '³'}</span>`;
  if (isShapeElement(node)) return `<svg class="outliner-kind-icon object-icon" aria-hidden="true"><use href="#icon-${node.shapeType === 'truncated_icosahedron' ? 'truncated-icosahedron' : node.shapeType === 'dodecahedron' ? 'dodecahedron' : 'polygon-prism'}"></use></svg>`;
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

function isShapeElement(item) {
  return Boolean(item && ['shape', 'polygon_prism', 'dodecahedron', 'truncated_icosahedron'].includes(item.type));
}

function isProceduralShape(item) {
  return Boolean(item && item.type !== 'cube' && typeof item.toCubes === 'function' && typeof item.toBaseCubes === 'function');
}

function subdivisionOwner(item) {
  return item?.subdivisionOwnerUid ? state.project.getNode(item.subdivisionOwnerUid) : null;
}

function subdivisionPatch(owner, cube, index) {
  const base = owner.toBaseCubes?.()[index];
  if (!base) return null;
  const patch = {};
  for (const field of ['position', 'size', 'pivot', 'rotation']) {
    const delta = cube[field].map((value, axis) => Number(value) - Number(base[field][axis]));
    if (delta.some(value => Math.abs(value) > 1e-8)) patch[`${field}Delta`] = delta;
  }
  const inflateDelta = Number(cube.inflate || 0) - Number(base.inflate || 0);
  if (Math.abs(inflateDelta) > 1e-8) patch.inflateDelta = inflateDelta;
  for (const field of ['name', 'unnamed', 'uvMode', 'uvNormalized', 'uv', 'mirrorUv', 'faces', 'autoUv', 'exported', 'locked', 'shade', 'visible', 'color']) {
    if (JSON.stringify(cube[field]) !== JSON.stringify(base[field])) patch[field] = structuredClone(cube[field]);
  }
  return Object.keys(patch).length ? patch : null;
}

function syncSubdivisionEdits() {
  if (!subdivisionSession) return;
  const owner = state.project.getNode(subdivisionSession.ownerUid);
  if (!owner?.toBaseCubes) return;
  const edits = {};
  subdivisionSession.cubes.forEach((cube, index) => {
    const patch = subdivisionPatch(owner, cube, index);
    if (patch) edits[index] = patch;
  });
  owner.subdivisionEdits = edits;
}

function enterSubdivisionEdit(owner) {
  if (!isProceduralShape(owner)) return;
  if (state.mode === 'paint') return toast('繪畫模式可直接在 Shape 上繪畫，不使用細分編輯');
  if (subdivisionSession?.ownerUid === owner.uid) return;
  if (subdivisionSession) exitSubdivisionEdit(false);
  const cubes = owner.toCubes().map((cube, index) => {
    cube.uid = `${owner.uid}::subdivision::${index}`;
    cube.subdivisionOwnerUid = owner.uid;
    cube.subdivisionIndex = index;
    return cube;
  });
  if (!cubes.length) return toast('這個 Shape 目前沒有可編輯的 Cube');
  subdivisionSession = { ownerUid: owner.uid, cubes };
  if (state.tool === 'knife') setTool('move');
  state.project.elements.push(...cubes);
  state.project.invalidateHierarchyIndex();
  sceneRenderer.invalidateLockState();
  state.selectedUid = cubes[0].uid;
  state.selectedUids = new Set([cubes[0].uid]);
  state.selectionAnchorUid = cubes[0].uid;
  state.selectedUvFaces = new Set();
  invalidateAllRenderGeometry();
  renderAll('all');
  updateToolVisibility();
  toast('已進入細分編輯；其他物件已虛化');
}

function exitSubdivisionEdit(render = true) {
  if (!subdivisionSession) return;
  syncSubdivisionEdits();
  const ownerUid = subdivisionSession.ownerUid;
  const transientUids = new Set(subdivisionSession.cubes.map(cube => cube.uid));
  state.project.elements = state.project.elements.filter(element => !transientUids.has(element.uid));
  state.project.invalidateHierarchyIndex();
  sceneRenderer.invalidateLockState();
  subdivisionSession = null;
  state.selectedUid = state.project.getNode(ownerUid) ? ownerUid : null;
  state.selectedUids = new Set(state.selectedUid ? [state.selectedUid] : []);
  state.selectionAnchorUid = state.selectedUid;
  state.selectedUvFaces = new Set();
  invalidateAllRenderGeometry();
  updateToolVisibility();
  if (render) renderAll('all');
}

function discardSubdivisionEdits(target) {
  if (!isProceduralShape(target) || target.preserveSubdivisionEdits) return;
  target.subdivisionEdits = {};
}

function curveNodeInspectorMarkup(item, index) {
  const node = item.nodes[index];
  if (!node) return '';
  const displayedRotation = node.autoTangent ? item.resolvedNodeState(index).rotation : node.rotation;
  return `<div class="field-section curve-node-card active" data-curve-node-card="${index}">
    <div class="field-title"><span>節點 ${index + 1}</span><span>${item.dimension === 2 ? '2D' : '3D'}</span></div>
    ${vectorField('位置', `curve-node:${index}:position`, node.position)}
    ${vectorField('旋轉', `curve-node:${index}:rotation`, displayedRotation)}
    <div class="option-row"><span>自動切線</span><label class="switch"><input type="checkbox" data-curve-node-auto="${index}" ${node.autoTangent ? 'checked' : ''}/><i></i></label></div>
    ${item.dimension === 3 ? `<div class="option-row"><span>滾動角</span><div class="number-wrap" style="width:68px"><input type="number" step="0.1" data-curve-node-roll="${index}" value="${round(node.roll || 0)}" /></div></div>` : ''}
    <div class="option-row"><span>貝塞爾手柄</span><label class="switch"><input type="checkbox" data-curve-node-toggle="${index}" ${node.handlesEnabled ? 'checked' : ''}/><i></i></label></div>
    ${node.handlesEnabled ? `<div class="option-row"><span>對稱手柄</span><label class="switch"><input type="checkbox" data-curve-node-symmetric="${index}" ${node.symmetricHandles ? 'checked' : ''}/><i></i></label></div>` : ''}
    ${node.handlesEnabled ? `${vectorField('前手柄', `curve-node:${index}:handleIn`, node.handleIn)}${vectorField('後手柄', `curve-node:${index}:handleOut`, node.handleOut)}` : ''}
    <button type="button" class="curve-node-remove" data-remove-curve-node="${index}" ${item.nodes.length <= 2 ? 'disabled' : ''}>刪除節點</button>
  </div>`;
}

function modifierVectorField(label, modifier, property, values) {
  return `<div class="vector-field modifier-vector-field"><span>${label}</span><div class="axis-inputs">${['X', 'Y', 'Z'].map((axis, index) =>
    `<label><b>${axis}</b><input type="number" step="0.1" data-modifier-vector="${property}" data-modifier-uid="${modifier.uid}" data-axis="${index}" value="${round(values[index])}" /></label>`).join('')}</div></div>`;
}

function symmetryModifierMarkup(owner, modifier) {
  const radial = modifier.mode === 'radial' || modifier.mode === 'mandala';
  const editingAnchor = state.selectedModifierUid === modifier.uid;
  return `<div class="modifier-settings">
    <div class="option-row"><span>鏡像模式</span><select data-modifier-field="mode" data-modifier-uid="${modifier.uid}">
      <option value="axes" ${modifier.mode === 'axes' ? 'selected' : ''}>XYZ 鏡像</option>
      <option value="radial" ${modifier.mode === 'radial' ? 'selected' : ''}>徑向旋轉</option>
      <option value="mandala" ${modifier.mode === 'mandala' ? 'selected' : ''}>曼陀羅</option>
    </select></div>
    ${modifier.mode === 'axes' ? `<div class="option-row group-mirror-axes"><span>啟用軸</span>
      ${['x', 'y', 'z'].map(axis => `<label class="axis-${axis}"><input type="checkbox" data-modifier-axis="${axis}" data-modifier-uid="${modifier.uid}" ${modifier.axes[axis] ? 'checked' : ''}/><b>${axis.toUpperCase()}</b></label>`).join('')}
    </div>` : ''}
    ${radial ? `
      <div class="option-row"><span>${modifier.mode === 'mandala' ? '對稱軸數量' : '複製數量'}</span><div class="number-wrap" style="width:68px"><input type="number" min="1" max="256" step="1" data-modifier-field="copies" data-modifier-uid="${modifier.uid}" value="${modifier.copies}" /></div></div>
      <div class="option-row"><span>角度分布</span><select data-modifier-field="distribution" data-modifier-uid="${modifier.uid}"><option value="full" ${modifier.distribution === 'full' ? 'selected' : ''}>360° 均分</option><option value="range" ${modifier.distribution === 'range' ? 'selected' : ''}>限制範圍</option></select></div>
      ${modifier.distribution === 'range' ? `
        <div class="option-row"><span>起始角</span><div class="number-wrap" style="width:68px"><input type="number" step="0.1" data-modifier-field="rangeStart" data-modifier-uid="${modifier.uid}" value="${round(modifier.rangeStart)}" /></div></div>
        <div class="option-row"><span>結束角</span><div class="number-wrap" style="width:68px"><input type="number" step="0.1" data-modifier-field="rangeEnd" data-modifier-uid="${modifier.uid}" value="${round(modifier.rangeEnd)}" /></div></div>` : ''}` : ''}
    <div class="option-row"><span>導出時建立父組</span><label class="switch"><input type="checkbox" data-modifier-field="wrapParent" data-modifier-uid="${modifier.uid}" ${modifier.wrapParent ? 'checked' : ''}/><i></i></label></div>
    <div class="option-row"><span>忽視重複 Cube</span><label class="switch"><input type="checkbox" data-modifier-field="ignoreDuplicateCubes" data-modifier-uid="${modifier.uid}" ${modifier.ignoreDuplicateCubes ? 'checked' : ''}/><i></i></label></div>
    <div class="field-title"><span>內嵌軸點</span><button type="button" class="modifier-anchor-edit ${editingAnchor ? 'active' : ''}" data-edit-modifier-anchor="${modifier.uid}">${editingAnchor ? '結束軸點編輯' : '在主視圖編輯'}</button></div>
    <p class="modifier-anchor-note">不進入場景層級；可在主視圖點擊標記後移動或旋轉。</p>
    ${modifierVectorField('位置', modifier, 'anchor.position', modifier.anchor.position)}
    ${modifierVectorField('旋轉', modifier, 'anchor.rotation', modifier.anchor.rotation)}
  </div>`;
}

function modifierPanelMarkup(owner) {
  const modifiers = owner.modifiers || [];
  const available = modifierRegistry.listFor(owner.type).filter(definition =>
    definition.allowMultiple !== false || !modifiers.some(modifier => modifier.type === definition.id));
  const cards = modifiers.map((modifier, index) => {
    const definition = modifierRegistry.get(modifier.type);
    const collapsed = state.collapsedModifiers.has(modifier.uid);
    return `<section class="modifier-card ${modifier.enabled ? '' : 'disabled'}" data-modifier-card="${modifier.uid}">
      <div class="modifier-card-heading">
        <button type="button" class="modifier-collapse" data-modifier-collapse="${modifier.uid}" title="展開或折疊">${openIconMarkup(collapsed ? 'right' : 'down')}</button>
        <label class="switch" title="啟用修改器"><input type="checkbox" data-modifier-enabled="${modifier.uid}" ${modifier.enabled ? 'checked' : ''}/><i></i></label>
        <strong>${escapeHtml(definition?.label || modifier.type)}</strong>
        <button type="button" data-modifier-bake="${modifier.uid}" title="只烘焙這個修改器" ${modifier.enabled ? '' : 'disabled'}>烘焙</button>
        <button type="button" data-modifier-move="up" data-modifier-uid="${modifier.uid}" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" data-modifier-move="down" data-modifier-uid="${modifier.uid}" ${index === modifiers.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="danger" data-modifier-remove="${modifier.uid}">×</button>
      </div>
      ${collapsed ? '' : modifier.type === 'symmetry' ? symmetryModifierMarkup(owner, modifier) : ''}
    </section>`;
  }).join('');
  return `<div class="field-section modifier-page">
    <div class="modifier-add-row"><select data-modifier-add-type>${available.map(definition => `<option value="${definition.id}">${escapeHtml(definition.label)}</option>`).join('')}</select><button type="button" data-action="addModifier" ${available.length ? '' : 'disabled'}>＋ 新增修改器</button></div>
    ${cards || '<p class="modifier-empty">這個物件目前沒有修改器。</p>'}
  </div>`;
}

function operatorVectorField(label, operator, property, values) {
  return `<div class="vector-field modifier-vector-field"><span>${label}</span><div class="axis-inputs">${['X', 'Y', 'Z'].map((axis, index) =>
    `<label><b>${axis}</b><input type="number" step="0.1" data-operator-vector="${property}" data-operator-uid="${operator.uid}" data-axis="${index}" value="${round(values[index])}" /></label>`).join('')}</div></div>`;
}

function paintSymmetryOperatorMarkup(operator) {
  const radial = operator.mode === 'radial' || operator.mode === 'mandala';
  const cache = paintSymmetryRelationCache.get(operator.uid);
  const status = cache?.building ? '正在建立面關聯…' : cache ? `已建立 ${cache.relationCount || 0} 組關聯` : '等待首次繪製時建立';
  return `<div class="modifier-settings">
    <div class="option-row"><span>對稱模式</span><select data-operator-field="mode" data-operator-uid="${operator.uid}">
      <option value="axes" ${operator.mode === 'axes' ? 'selected' : ''}>XYZ 鏡像</option>
      <option value="radial" ${operator.mode === 'radial' ? 'selected' : ''}>徑向旋轉</option>
      <option value="mandala" ${operator.mode === 'mandala' ? 'selected' : ''}>曼陀羅</option>
    </select></div>
    ${operator.mode === 'axes' ? `<div class="option-row group-mirror-axes"><span>啟用軸</span>${['x', 'y', 'z'].map(axis => `<label class="axis-${axis}"><input type="checkbox" data-operator-axis="${axis}" data-operator-uid="${operator.uid}" ${operator.axes?.[axis] ? 'checked' : ''}/><b>${axis.toUpperCase()}</b></label>`).join('')}</div>` : ''}
    ${radial ? `<div class="option-row"><span>${operator.mode === 'mandala' ? '對稱軸數量' : '複製數量'}</span><div class="number-wrap" style="width:68px"><input type="number" min="1" max="256" step="1" data-operator-field="copies" data-operator-uid="${operator.uid}" value="${operator.copies}" /></div></div>
      <div class="option-row"><span>角度分布</span><select data-operator-field="distribution" data-operator-uid="${operator.uid}"><option value="full" ${operator.distribution === 'full' ? 'selected' : ''}>360° 均分</option><option value="range" ${operator.distribution === 'range' ? 'selected' : ''}>限制範圍</option></select></div>
      ${operator.distribution === 'range' ? `<div class="option-row"><span>起始角</span><div class="number-wrap" style="width:68px"><input type="number" step="0.1" data-operator-field="rangeStart" data-operator-uid="${operator.uid}" value="${round(operator.rangeStart)}" /></div></div><div class="option-row"><span>結束角</span><div class="number-wrap" style="width:68px"><input type="number" step="0.1" data-operator-field="rangeEnd" data-operator-uid="${operator.uid}" value="${round(operator.rangeEnd)}" /></div></div>` : ''}` : ''}
    <div class="field-title"><span>作用軸點</span><button type="button" class="modifier-anchor-edit ${state.selectedModifierUid === operator.uid ? 'active' : ''}" data-edit-operator-anchor="${operator.uid}">${state.selectedModifierUid === operator.uid ? '結束軸點編輯' : '在主視圖編輯'}</button></div>
    <p class="modifier-anchor-note">${status}</p>
    ${operatorVectorField('位置', operator, 'anchor.position', operator.anchor.position)}
    ${operatorVectorField('旋轉', operator, 'anchor.rotation', operator.anchor.rotation)}
    <p class="modifier-anchor-note">操作器只處理即時繪畫輸入，不生成物件，也沒有烘焙。</p>
  </div>`;
}

function operatorPanelMarkup(owner) {
  const operators = owner.operators || [];
  const available = operatorRegistry.listFor(owner.type).filter(definition =>
    definition.allowMultiple !== false || !operators.some(operator => operator.type === definition.id));
  const cards = operators.map((operator, index) => {
    if (operator.enabled && operator.type === 'paint_symmetry' && !paintSymmetryRelationCache.has(operator.uid)) {
      schedulePaintSymmetryBuild(owner, operator);
    }
    const definition = operatorRegistry.get(operator.type);
    const collapsed = state.collapsedOperators.has(operator.uid);
    return `<section class="modifier-card ${operator.enabled ? '' : 'disabled'}" data-operator-card="${operator.uid}">
      <div class="modifier-card-heading">
        <button type="button" class="modifier-collapse" data-operator-collapse="${operator.uid}" title="展開或折疊">${openIconMarkup(collapsed ? 'right' : 'down')}</button>
        <label class="switch" title="啟用操作器"><input type="checkbox" data-operator-enabled="${operator.uid}" ${operator.enabled ? 'checked' : ''}/><i></i></label>
        <strong>${escapeHtml(definition?.label || operator.type)}</strong>
        <button type="button" data-operator-move="up" data-operator-uid="${operator.uid}" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" data-operator-move="down" data-operator-uid="${operator.uid}" ${index === operators.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="danger" data-operator-remove="${operator.uid}">×</button>
      </div>
      ${collapsed ? '' : operator.type === 'paint_symmetry' ? paintSymmetryOperatorMarkup(operator) : ''}
    </section>`;
  }).join('');
  return `<div class="field-section modifier-page">
    <div class="modifier-add-row"><select data-operator-add-type>${available.map(definition => `<option value="${definition.id}">${escapeHtml(definition.label)}</option>`).join('')}</select><button type="button" data-action="addOperator" ${available.length ? '' : 'disabled'}>＋ 新增操作器</button></div>
    ${cards || '<p class="modifier-empty">這個物件目前沒有操作器。</p>'}
  </div>`;
}

function rgbToHsv(rgb) {
  const [red, green, blue] = rgb.map(channel => clamp(Number(channel) || 0, 0, 255) / 255);
  const maximum = Math.max(red, green, blue), minimum = Math.min(red, green, blue);
  const range = maximum - minimum;
  let hue = 0;
  if (range > 1e-8) {
    if (maximum === red) hue = ((green - blue) / range) % 6;
    else if (maximum === green) hue = (blue - red) / range + 2;
    else hue = (red - green) / range + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  return [hue, maximum <= 1e-8 ? 0 : range / maximum, maximum];
}

function hsvToRgb(hue, saturation, value) {
  const h = ((Number(hue) % 1) + 1) % 1 * 6;
  const s = clamp(Number(saturation) || 0, 0, 1), v = clamp(Number(value) || 0, 0, 1);
  const chroma = v * s, intermediate = chroma * (1 - Math.abs(h % 2 - 1)), offset = v - chroma;
  const segments = [[chroma, intermediate, 0], [intermediate, chroma, 0], [0, chroma, intermediate],
    [0, intermediate, chroma], [intermediate, 0, chroma], [chroma, 0, intermediate]];
  return segments[Math.min(5, Math.floor(h))].map(channel => Math.round((channel + offset) * 255));
}

function rgbToHex(rgb) {
  return `#${rgb.map(channel => clamp(Math.round(Number(channel) || 0), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

const COLOR_CONTROL_INSET = 2;
const TRIANGLE_RING_WIDTH = 14;
const TRIANGLE_FIELD_INSET = 22;

function insetControlRatio(clientCoordinate, start, length) {
  return clamp((clientCoordinate - start - COLOR_CONTROL_INSET)
    / Math.max(1, length - COLOR_CONTROL_INSET * 2), 0, 1);
}

function insetControlPosition(ratio, inset = COLOR_CONTROL_INSET) {
  const normalized = clamp(ratio, 0, 1);
  return `calc(${normalized * 100}% + ${inset - normalized * inset * 2}px)`;
}

function trianglePickerGeometry(rect) {
  const width = rect.width, height = rect.height;
  const center = [width / 2, height / 2];
  const radius = Math.max(2, Math.min(width, height) / 2 - TRIANGLE_FIELD_INSET);
  return {
    hue: [center[0], center[1] - radius],
    white: [center[0] - radius * Math.sqrt(3) / 2, center[1] + radius / 2],
    black: [center[0] + radius * Math.sqrt(3) / 2, center[1] + radius / 2]
  };
}

function barycentric2d(point, a, b, c) {
  const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(denominator) < 1e-8) return null;
  const first = ((b[1] - c[1]) * (point[0] - c[0]) + (c[0] - b[0]) * (point[1] - c[1])) / denominator;
  const second = ((c[1] - a[1]) * (point[0] - c[0]) + (a[0] - c[0]) * (point[1] - c[1])) / denominator;
  return [first, second, 1 - first - second];
}

function closestPointOnSegment2d(point, start, end) {
  const direction = [end[0] - start[0], end[1] - start[1]];
  const lengthSquared = direction[0] ** 2 + direction[1] ** 2;
  const amount = lengthSquared < 1e-8 ? 0 : clamp(
    ((point[0] - start[0]) * direction[0] + (point[1] - start[1]) * direction[1]) / lengthSquared, 0, 1);
  return [start[0] + direction[0] * amount, start[1] + direction[1] * amount];
}

function closestPointOnTriangle2d(point, geometry) {
  return [[geometry.hue, geometry.white], [geometry.white, geometry.black], [geometry.black, geometry.hue]]
    .map(([start, end]) => closestPointOnSegment2d(point, start, end))
    .sort((first, second) => Math.hypot(first[0] - point[0], first[1] - point[1])
      - Math.hypot(second[0] - point[0], second[1] - point[1]))[0];
}

function renderTrianglePickerCanvas(surface) {
  const canvas = surface?.querySelector('.color-picker-triangle-field');
  if (!canvas || state.paintColorPickerMode !== 'triangle') return;
  const rect = surface.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const renderKey = `${width}:${height}:${state.paintColorPickerHue.toFixed(6)}`;
  if (canvas.dataset.renderKey === renderKey) return;
  canvas.dataset.renderKey = renderKey;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  const geometry = trianglePickerGeometry({ width, height });
  const hueRgb = hsvToRgb(state.paintColorPickerHue, 1, 1);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const weights = barycentric2d([x + .5, y + .5], geometry.hue, geometry.white, geometry.black);
    if (!weights || weights.some(weight => weight < -1e-5)) continue;
    const offset = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) image.data[offset + channel] = Math.round(
      hueRgb[channel] * weights[0] + 255 * weights[1]);
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function updatePaintColorPickerVisual() {
  const root = colorPickerPopupRoot || inspector;
  const surface = $('[data-color-picker-surface]', root);
  if (!surface) return;
  const rgb = hexToRgb(state.paintColor);
  // Keep HSV as independent picker coordinates. Reading them back from rounded
  // 8-bit RGB on every pointermove causes severe jitter near black or grey.
  const hue = state.paintColorPickerHue;
  const saturation = state.paintColorPickerSaturation;
  const value = state.paintColorPickerValue;
  const hueColor = rgbToHex(hsvToRgb(hue, 1, 1));
  const brightColor = rgbToHex(hsvToRgb(hue, saturation, 1));
  surface.style.setProperty('--picker-hue', hueColor);
  surface.style.setProperty('--picker-darkness', String(1 - value));
  const marker = surface.querySelector('.color-picker-marker');
  let markerX = saturation, markerY = 1 - value;
  if (state.paintColorPickerMode === 'circle') {
    const angle = hue * Math.PI * 2;
    markerX = .5 + Math.cos(angle) * saturation * .5;
    markerY = .5 + Math.sin(angle) * saturation * .5;
  } else if (state.paintColorPickerMode === 'triangle') {
    const hueWeight = saturation * value;
    const whiteWeight = (1 - saturation) * value;
    const blackWeight = 1 - value;
    const width = surface.clientWidth || 1, height = surface.clientHeight || 1;
    const geometry = trianglePickerGeometry({ width, height });
    markerX = (geometry.hue[0] * hueWeight + geometry.white[0] * whiteWeight + geometry.black[0] * blackWeight) / width;
    markerY = (geometry.hue[1] * hueWeight + geometry.white[1] * whiteWeight + geometry.black[1] * blackWeight) / height;
    renderTrianglePickerCanvas(surface);
  }
  marker?.style.setProperty('left', state.paintColorPickerMode === 'triangle' ? `${markerX * 100}%` : insetControlPosition(markerX));
  marker?.style.setProperty('top', state.paintColorPickerMode === 'triangle' ? `${markerY * 100}%` : insetControlPosition(markerY));
  const hueRail = $('[data-color-hue]', root);
  hueRail?.style.setProperty('--picker-bright', brightColor);
  const hueMarker = $('.color-hue-marker', root);
  if (hueMarker) hueMarker.style.top = insetControlPosition(state.paintColorPickerMode === 'circle' ? 1 - value : hue);
  const ringMarker = $('.color-picker-ring-marker', root);
  if (ringMarker && state.paintColorPickerMode === 'triangle') {
    const angle = hue * Math.PI * 2;
    const radius = Math.max(1, (surface.clientWidth || 1) / 2 - TRIANGLE_RING_WIDTH / 2 - 2);
    ringMarker.style.left = `calc(50% + ${Math.sin(angle) * radius}px)`;
    ringMarker.style.top = `calc(50% - ${Math.cos(angle) * radius}px)`;
  }
  const preview = $('.color-picker-current', root);
  if (preview) preview.style.background = state.paintColor;
  ['r', 'g', 'b'].forEach((channel, index) => {
    const input = $(`[data-paint-channel="${channel}"]`, root);
    if (input && document.activeElement !== input) input.value = String(rgb[index]);
  });
  const hex = $('[data-paint-hex]', root);
  if (hex && document.activeElement !== hex) hex.value = state.paintColor;
}

function colorPickerPoint(surface, event, lockedZone = null) {
  const rect = surface.getBoundingClientRect();
  let x = insetControlRatio(event.clientX, rect.left, rect.width);
  const y = insetControlRatio(event.clientY, rect.top, rect.height);
  const currentSaturation = state.paintColorPickerSaturation;
  const currentValue = state.paintColorPickerValue;
  if (state.paintColorPickerMode === 'circle') {
    const dx = x - .5, dy = y - .5, distance = Math.hypot(dx, dy);
    return {
      hue: distance > 1e-5 ? ((Math.atan2(dy, dx) / (Math.PI * 2)) + 1) % 1 : state.paintColorPickerHue,
      saturation: clamp(distance * 2, 0, 1), value: currentValue
    };
  }
  if (state.paintColorPickerMode === 'triangle') {
    let local = [event.clientX - rect.left, event.clientY - rect.top];
    const geometry = trianglePickerGeometry(rect);
    let weights = barycentric2d(local, geometry.hue, geometry.white, geometry.black);
    const inside = weights && weights.every(weight => weight >= -1e-4);
    const zone = lockedZone || (inside ? 'triangle' : 'hue');
    if (zone === 'hue') {
      const angle = Math.atan2(local[0] - rect.width / 2, rect.height / 2 - local[1]);
      return { hue: (angle / (Math.PI * 2) + 1) % 1, saturation: currentSaturation, value: currentValue, zone: 'hue' };
    }
    if (!inside) {
      local = closestPointOnTriangle2d(local, geometry);
      weights = barycentric2d(local, geometry.hue, geometry.white, geometry.black);
    }
    const value = clamp(weights[0] + weights[1], 0, 1);
    return {
      hue: state.paintColorPickerHue,
      saturation: value > 1e-8 ? clamp(weights[0] / value, 0, 1) : currentSaturation,
      value, zone: 'triangle'
    };
  }
  return { hue: state.paintColorPickerHue, saturation: x, value: 1 - y };
}

function bindPaintColorPicker(root = inspector) {
  const surface = $('[data-color-picker-surface]', root);
  const hueRail = $('[data-color-hue]', root);
  let surfaceZone = null;
  const useSurface = (event, lockedZone = null) => {
    const point = colorPickerPoint(surface, event, lockedZone);
    state.paintColorPickerHue = point.hue;
    state.paintColorPickerSaturation = point.saturation;
    state.paintColorPickerValue = point.value;
    setPaintColor(rgbToHex(hsvToRgb(point.hue, point.saturation, point.value)), false, true);
  };
  const useHue = event => {
    const rect = hueRail.getBoundingClientRect();
    const position = insetControlRatio(event.clientY, rect.top, rect.height);
    const saturation = state.paintColorPickerSaturation;
    const value = state.paintColorPickerValue;
    if (state.paintColorPickerMode === 'circle') {
      state.paintColorPickerValue = 1 - position;
      setPaintColor(rgbToHex(hsvToRgb(state.paintColorPickerHue, saturation, state.paintColorPickerValue)), false, true);
    } else {
      state.paintColorPickerHue = position >= 1 ? 0 : position;
      setPaintColor(rgbToHex(hsvToRgb(state.paintColorPickerHue, saturation, value)), false, true);
    }
  };
  const bindPointer = (node, handler) => {
    node.addEventListener('pointerdown', event => {
      event.preventDefault();
      node.setPointerCapture(event.pointerId);
      handler(event);
    });
    node.addEventListener('pointermove', event => { if (node.hasPointerCapture(event.pointerId)) handler(event); });
  };
  surface.addEventListener('pointerdown', event => {
    event.preventDefault();
    const point = colorPickerPoint(surface, event);
    surfaceZone = point.zone || null;
    surface.setPointerCapture(event.pointerId);
    useSurface(event, surfaceZone);
  });
  surface.addEventListener('pointermove', event => {
    if (surface.hasPointerCapture(event.pointerId)) useSurface(event, surfaceZone);
  });
  const releaseSurface = event => {
    if (surface.hasPointerCapture?.(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    surfaceZone = null;
  };
  surface.addEventListener('pointerup', releaseSurface);
  surface.addEventListener('pointercancel', releaseSurface);
  surface.addEventListener('lostpointercapture', () => { surfaceZone = null; });
  if (hueRail) bindPointer(hueRail, useHue);
  $$('[data-color-picker-mode]', root).forEach(button => button.addEventListener('click', () => {
    state.paintColorPickerMode = button.dataset.colorPickerMode;
    if (colorPickerPopupRoot) renderPaintColorPicker(colorPickerPopupRoot);
    else renderInspector();
  }));
  $$('[data-paint-channel]', root).forEach(input => input.addEventListener('change', () => {
    const rgb = ['r', 'g', 'b'].map(channel => Number($(`[data-paint-channel="${channel}"]`, root)?.value) || 0);
    setPaintColor(rgbToHex(rgb));
  }));
  $('[data-paint-hex]', root)?.addEventListener('change', event => setPaintColor(event.target.value));
  $('[data-action="paintEyedropper"]', root)?.addEventListener('click', () => setTool('eyedropper'));
  $('[data-action="addPaintSwatch"]', root)?.addEventListener('click', () => {
    addPaintSwatchToSelection();
  });
  updatePaintColorPickerVisual();
}

function renderPaintColorPicker(root = inspector) {
  if (root === inspector) { $('#inspectorHeading').textContent = '選色器'; $('#inspectorMetaStrip').hidden = true; }
  const mode = ['square', 'circle', 'triangle'].includes(state.paintColorPickerMode) ? state.paintColorPickerMode : 'square';
  root.innerHTML = `<div class="paint-color-picker">
    <nav class="color-picker-modes" aria-label="選色器形態">
      <button type="button" data-color-picker-mode="square" class="${mode === 'square' ? 'active' : ''}">方形</button>
      <button type="button" data-color-picker-mode="circle" class="${mode === 'circle' ? 'active' : ''}">圓形</button>
      <button type="button" data-color-picker-mode="triangle" class="${mode === 'triangle' ? 'active' : ''}">三角形</button>
    </nav>
    <div class="color-picker-stage mode-${mode}">
      <div class="color-picker-surface" data-color-picker-surface><canvas class="color-picker-triangle-field"></canvas><i class="color-picker-marker"></i><i class="color-picker-ring-marker"></i></div>
      <div class="color-hue-rail" data-color-hue><i class="color-hue-marker"></i></div>
    </div>
    <div class="color-picker-values">
      <label>R<input type="number" min="0" max="255" step="1" data-paint-channel="r"></label>
      <label>G<input type="number" min="0" max="255" step="1" data-paint-channel="g"></label>
      <label>B<input type="number" min="0" max="255" step="1" data-paint-channel="b"></label>
    </div>
    <div class="color-picker-footer">
      <i class="color-picker-current"></i><input type="text" maxlength="7" data-paint-hex value="${state.paintColor}">
      ${root === inspector ? '<button type="button" data-action="addPaintSwatch" title="加入色卡">＋</button><button type="button" data-action="paintEyedropper" title="取色器">⌖</button>' : ''}
    </div>
  </div>`;
  bindPaintColorPicker(root);
}

function openColorPickerPopup(color, apply) {
  if (colorPickerPopupRoot) return;
  const saved = Object.fromEntries(['paintColor', 'paintColorPickerHue', 'paintColorPickerSaturation', 'paintColorPickerValue', 'paintColorPickerMode'].map(key => [key, state[key]]));
  const dialog = document.createElement('dialog');
  dialog.className = 'theme-dialog color-picker-dialog';
  dialog.innerHTML = '<form method="dialog"><div class="dialog-heading"><h2>選擇顏色</h2></div><div data-popup-picker></div><div class="dialog-actions"><button value="cancel">取消</button><button value="apply" class="primary">套用</button></div></form>';
  document.body.append(dialog);
  colorPickerPopupRoot = $('[data-popup-picker]', dialog);
  colorPickerPopupApply = apply;
  const hsv = rgbToHsv(hexToRgb(color));
  state.paintColor = color;
  [state.paintColorPickerHue, state.paintColorPickerSaturation, state.paintColorPickerValue] = hsv;
  dialog.addEventListener('close', () => {
    const value = state.paintColor, callback = colorPickerPopupApply;
    colorPickerPopupRoot = null; colorPickerPopupApply = null;
    Object.assign(state, saved); $('#paintColor').value = state.paintColor;
    dialog.remove();
    if (dialog.returnValue === 'apply') callback(value);
    if (state.mode === 'paint') renderInspector();
  }, { once: true });
  dialog.showModal();
  renderPaintColorPicker(colorPickerPopupRoot);
}

function renderInspector() {
  if (state.mode === 'paint') {
    renderPaintColorPicker();
    return;
  }
  $('#inspectorHeading').textContent = '物件屬性';
  $('#inspectorMetaStrip').hidden = false;
  const item = selected();
  if (!item) {
    inspector.innerHTML = state.selectedGenerated
      ? '<div class="field-section"><p style="color:var(--muted);font-size:.7rem">已選中修改器生成結果；可作頂點捕捉參考，但不能直接編輯。請選擇來源物件或烘焙修改器。</p></div>'
      : '<div class="field-section"><p style="color:var(--muted);font-size:.7rem">選擇一個 Cube、Shape、節點、貝塞爾、Locator 或組來編輯。</p></div>';
    return;
  }
  if (isBezierElement(item) && Number.isInteger(state.selectedCurveNodeIndex) && item.nodes[state.selectedCurveNodeIndex]) {
    inspector.innerHTML = `<nav class="inspector-tabs"><button type="button" class="active">節點</button></nav>${curveNodeInspectorMarkup(item, state.selectedCurveNodeIndex)}`;
    bindInspector();
    return;
  }
  const items = inspectorBatchNodes();
  const rotation = item.rotation || [0, 0, 0];
  const editOwner = subdivisionOwner(item);
  const typeLabel = editOwner ? 'Shape 細分 Cube' : isShapeElement(item)
    ? item.shapeType === 'truncated_icosahedron' ? '足球（截角二十面體）' : item.shapeType === 'dodecahedron' ? '正十二面體' : '多邊形柱體'
    : item.type === 'locator' ? 'Locator'
    : item.type === 'node' ? '節點' : item.type === 'bezier2d' ? '二維貝塞爾'
      : item.type === 'bezier3d' ? '三維貝塞爾' : item.type === 'group' ? '組' : '立方體';
  const details = item.type === 'cube' ? `
      <div class="field-title"><span>幾何</span><button data-action="resetTransform">重置</button></div>
      ${vectorField('位置', 'position', item.position, items)}
      ${vectorField('尺寸', 'size', item.size, items)}
      ${vectorField('樞軸', 'pivot', item.pivot, items)}
      ${vectorField('旋轉', 'rotation', rotation, items)}
      ${scalarField('膨脹', 'inflate', item.inflate, items)}`
    : isShapeElement(item) ? item.shapeType !== 'polygon_prism' ? `
      <div class="field-title"><span>${item.shapeType === 'truncated_icosahedron' ? '足球（截角二十面體）' : '正十二面體'}</span><span>${item.shapeType === 'truncated_icosahedron' ? 'TRUNCATED ICOSAHEDRON' : 'REGULAR DODECAHEDRON'}</span></div>
      ${vectorField('位置', 'origin', item.origin, items)}
      ${vectorField('樞軸', 'pivot', item.pivot, items)}
      ${vectorField('旋轉', 'rotation', rotation, items)}
      ${parameterField('半徑', 'radius', item.parameters.radius, .1, items)}
      <div class="option-row"><span>單邊邊長</span><strong style="color:var(--accent)">${formatNumber(polyhedronEdgeLength(item, item.parameters.radius))} px</strong></div>
      <div class="option-row"><span>尺寸擬合</span><select data-shape-snap-mode><option value="edge" ${item.parameters.snapMode !== 'radius' ? 'selected' : ''}>擬合單邊邊長</option><option value="radius" ${item.parameters.snapMode === 'radius' ? 'selected' : ''}>擬合整體半徑</option></select></div>
      <div class="option-row"><span>生成 Cube</span><strong style="color:var(--accent)">${item.toCubes().length} 個</strong></div>` : `
      <div class="field-title"><span>多邊形柱體</span><span>POLYGON PRISM</span></div>
      ${vectorField('位置', 'origin', item.origin, items)}
      ${vectorField('樞軸', 'pivot', item.pivot, items)}
      ${vectorField('旋轉', 'rotation', rotation, items)}
      ${parameterField('半徑', 'radius', item.parameters.radius, .1, items)}
      ${parameterField('高度', 'height', item.parameters.height, .1, items)}
      ${parameterField('邊數', 'sides', item.parameters.sides, 1, items)}
      <div class="option-row"><span>啟用內半徑</span><label class="switch"><input type="checkbox" data-shape-inner-radius ${item.parameters.innerRadiusEnabled ? 'checked' : ''}/><i></i></label></div>
      ${item.parameters.innerRadiusEnabled ? `
        <div class="option-row"><span>內半徑模式</span><select data-shape-inner-radius-mode><option value="radius" ${item.parameters.innerRadiusMode !== 'depth' ? 'selected' : ''}>實際內半徑</option><option value="depth" ${item.parameters.innerRadiusMode === 'depth' ? 'selected' : ''}>Cube 向內延伸</option></select></div>
        ${parameterField(item.parameters.innerRadiusMode === 'depth' ? '向內延伸距離' : '實際內半徑', 'innerRadius', item.parameters.innerRadius, .1, items)}` : ''}
      <div class="option-row"><span>尺寸擬合</span><select data-shape-snap-mode><option value="edge" ${item.parameters.snapMode !== 'radius' ? 'selected' : ''}>擬合多邊形邊長</option><option value="radius" ${item.parameters.snapMode === 'radius' ? 'selected' : ''}>擬合整體半徑</option></select></div>
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
      ${item.handlesEnabled ? `<div class="option-row"><span>對稱手柄</span><label class="switch"><input type="checkbox" data-field="symmetricHandles" ${item.symmetricHandles ? 'checked' : ''}/><i></i></label></div>` : ''}
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
      <div class="option-row"><span>生成 Cube</span><strong style="color:var(--accent)">${item.toCubes().length} 個</strong></div>`
    : `
      <div class="field-title"><span>組屬性</span></div>
      ${vectorField('樞軸', 'pivot', item.pivot, items)}
      ${scalarField('膨脹', 'inflate', item.inflate, items)}
      <div class="option-row"><span>直接子項</span><strong style="color:var(--accent)">${item.children.length}</strong></div>`;
  const appearanceCapable = item.type === 'cube' || isShapeElement(item) || isBezierElement(item) || item.type === 'group';
  const pages = [
    { id: 'basic', label: '基礎' },
    ...(appearanceCapable ? [{ id: 'appearance', label: '外觀' }] : []),
    ...(isUvCapable(item) ? [{ id: 'uv', label: 'UV' }] : []),
    ...(modifierRegistry.listFor(item.type).length || item.modifiers?.length ? [{ id: 'modifiers', label: '修改器' }] : []),
    ...(operatorRegistry.listFor(item.type).length || item.operators?.length ? [{ id: 'operators', label: '操作器' }] : [])
  ];
  if (!pages.some(page => page.id === state.inspectorPage)) state.inspectorPage = 'basic';
  const tabs = `<nav class="inspector-tabs" aria-label="物件屬性分類">${pages.map(page => `<button type="button" data-inspector-page="${page.id}" class="${state.inspectorPage === page.id ? 'active' : ''}">${page.label}</button>`).join('')}</nav>`;
  const basicPage = `<div class="field-section">
      <div class="field-title"><span>基本</span><span>${items.length > 1 ? `多選 ${items.length}` : typeLabel}</span></div>
      <input class="name-field" data-field="name" value="${escapeAttribute(item.name)}" aria-label="名稱" />
      <div class="option-row"><span>系統命名</span><label class="switch"><input type="checkbox" data-field="unnamed" ${item.unnamed ? 'checked' : ''}/><i></i></label></div>
      <div class="option-row"><span>可見</span><label class="switch"><input type="checkbox" data-field="visible" ${item.visible ? 'checked' : ''}/><i></i></label></div>
    </div>
    <div class="field-section">
      ${details}
    </div>
    ${isProceduralShape(item) ? `<div class="field-section subdivision-controls">
      <div class="field-title"><span>細分編輯</span><span>${Object.keys(item.subdivisionEdits || {}).length} 個覆寫</span></div>
      <div class="option-row"><span>操作時保留已有細分編輯</span><label class="switch"><input type="checkbox" data-field="preserveSubdivisionEdits" ${item.preserveSubdivisionEdits ? 'checked' : ''}/><i></i></label></div>
      <button type="button" data-action="enterSubdivisionEdit">進入細分編輯</button>
    </div>` : ''}
    ${editOwner ? `<div class="field-section subdivision-controls active">
      <div class="field-title"><span>${escapeHtml(editOwner.name)}</span><span>細分 ${item.subdivisionIndex + 1}</span></div>
      <p>正在非破壞地編輯 Shape 生成的 Cube。</p>
      <button type="button" data-action="exitSubdivisionEdit">完成細分編輯</button>
    </div>` : ''}
    ${editOwner ? '' : `<div class="field-section"><button class="danger-button" data-action="deleteSelected">${items.length > 1 ? '刪除選中項' : `刪除${item.type === 'group' ? '組及其內容' : '物件'}`}</button></div>`}`;
  const appearancePage = `<div class="field-section">
      <div class="field-title"><span>外觀</span><span>預覽色</span></div>
      ${item.color ? `<div class="option-row"><span>顯示色</span><button type="button" data-element-color-popup class="element-color-chip" style="background:${escapeAttribute(item.color)}" title="選擇顏色"></button></div>` : ''}
      <div class="option-row"><span>面陰影</span><label class="switch"><input type="checkbox" data-field="shade" ${item.shade !== false ? 'checked' : ''}/><i></i></label></div>
    </div>`;
  const uvPage = `<div class="field-section">
      <div class="field-title"><span>UV</span><span>${item.uvMode === 'face' ? 'PER FACE' : 'BOX'}</span></div>
      <div class="option-row"><span>UV 模式</span><select data-field="uvMode"><option value="box" ${item.uvMode !== 'face' ? 'selected' : ''}>箱型 UV</option><option value="face" ${item.uvMode === 'face' ? 'selected' : ''}>逐面 UV</option></select></div>
      <div class="option-row"><span>UV 歸一化</span><label class="switch"><input type="checkbox" data-field="uvNormalized" ${item.uvNormalized !== false ? 'checked' : ''}/><i></i></label></div>
    </div>`;
  const content = state.inspectorPage === 'appearance' ? appearancePage
    : state.inspectorPage === 'uv' ? uvPage
      : state.inspectorPage === 'modifiers' ? modifierPanelMarkup(item)
        : state.inspectorPage === 'operators' ? operatorPanelMarkup(item)
        : basicPage;
  inspector.innerHTML = `${tabs}${content}`;
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
  const minimum = key === 'sides' ? 3 : key === 'innerRadius' ? 0 : key === 'cubeSize' || key === 'segmentLength' ? .0625 : .1;
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
      else if (isShapeElement(child) || isBezierElement(child)) child.autoUv = enabled;
    }
  }
}

function setNodeFlag(node, key, value) {
  if (!node) return;
  if ((key === 'uvMode' || key === 'uvNormalized') && !isUvCapable(node)) return;
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
  $('[data-element-color-popup]', inspector)?.addEventListener('click', () => openColorPickerPopup(item.color, color => {
    snapshot('core.element.color'); items.filter(node => typeof node.color === 'string').forEach(node => { node.color = color; });
    markDirty(); renderAll('selection');
  }));
  $$('[data-field]', inspector).forEach(input => {
    input.addEventListener('change', () => {
      const key = input.dataset.field;
      if (input.type === 'number' && input.value === '') return;
      snapshot(`core.element.field.${key.toLowerCase()}`);
      const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
      const targets = key === 'name' ? [item]
        : key === 'shade' ? items.filter(node => node.type === 'cube' || isShapeElement(node) || isBezierElement(node) || node.type === 'group')
        : key === 'inflate' ? items.filter(node => ['cube', 'group'].includes(node.type))
        : key === 'uvMode' || key === 'uvNormalized' ? items.filter(isUvCapable)
        : key === 'color' ? items.filter(node => typeof node.color === 'string')
        : items.filter(node => key in node);
      for (const target of targets) {
        if (key === 'name') setNodeName(state.project, target, value);
        else if (key === 'unnamed') setNodeUnnamed(state.project, target, value);
        else if (['visible', 'shade', 'autoUv', 'uvMode', 'uvNormalized', 'exported', 'locked'].includes(key)) setNodeFlag(target, key, value);
        else {
          target[key] = value;
          if (key === 'symmetricHandles' && value && target.type === 'node') {
            setCurveHandle(target, 'handleOut', target.handleOut, false);
          }
        }
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
      if (!snapshotTaken) {
        const vectorName = input.dataset.vector.startsWith('curve-node:')
          ? input.dataset.vector.split(':')[2] : input.dataset.vector;
        snapshot(`core.element.vector.${vectorName.toLowerCase()}`);
        snapshotTaken = true;
      }
      delete input.dataset.mixed;
      const field = input.dataset.vector;
      const axis = Number(input.dataset.axis);
      if (field.startsWith('curve-node:') && isBezierElement(item)) {
        const [, indexText, property] = field.split(':');
        const node = item.nodes[Number(indexText)];
        if (!node || !Array.isArray(node[property])) return;
        discardSubdivisionEdits(item);
        if (property === 'rotation' && node.autoTangent) bakeCurveNodeTangent(item, Number(indexText));
        const planarVector = property === 'position' || property === 'handleIn' || property === 'handleOut';
        const lockedPlanarAxis = item.dimension === 2
          && ((planarVector && axis === 1) || (property === 'rotation' && axis !== 1));
        const nextVector = [...node[property]];
        nextVector[axis] = lockedPlanarAxis ? 0 : value;
        if (property === 'handleIn' || property === 'handleOut') setCurveHandle(node, property, nextVector, item.dimension === 2);
        else node[property] = nextVector;
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
          translateModifierAnchors(target, [0, 1, 2].map(index => index === axis ? delta : 0));
        } else if (field === 'pivot' && (['cube', 'group'].includes(target.type) || isShapeElement(target))) {
          const nextPivot = [...target.pivot];
          nextPivot[axis] = nextValue;
          setPivotPreservingGeometry(state.project, target, nextPivot);
        } else if ((field === 'handleIn' || field === 'handleOut') && target.type === 'node') {
          const nextHandle = [...target[field]];
          nextHandle[axis] = nextValue;
          setCurveHandle(target, field, nextHandle, false);
        } else {
          const delta = nextValue - target[field][axis];
          target[field][axis] = nextValue;
          if (field === 'origin' && isShapeElement(target)) target.pivot[axis] += delta;
          if (field === 'position' || field === 'origin') {
            translateModifierAnchors(target, [0, 1, 2].map(index => index === axis ? delta : 0));
          }
        }
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
      if (!snapshotTaken) { snapshot(`core.shape.parameter.${input.dataset.parameter.toLowerCase()}`); snapshotTaken = true; }
      delete input.dataset.mixed;
      const key = input.dataset.parameter;
      const nextValue = key === 'sides' ? Math.max(3, Math.round(value))
        : Math.max(key === 'innerRadius' ? 0 : key === 'cubeSize' || key === 'segmentLength' ? .0625 : .1, value);
      for (const target of items.filter(node => node.parameters && key in node.parameters)) {
        discardSubdivisionEdits(target);
        target.parameters[key] = nextValue;
      }
      markDirty(); invalidateSelectionRenderGeometry(); syncInspectorValues(); renderScene();
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
    input.addEventListener('blur', () => { snapshotTaken = false; });
  });
  $$('[data-inspector-page]', inspector).forEach(button => button.addEventListener('click', () => {
    state.inspectorPage = button.dataset.inspectorPage;
    renderInspector();
    renderScene();
  }));
  const modifierByUid = uidValue => item.modifiers?.find(modifier => modifier.uid === uidValue);
  $('[data-action="addModifier"]', inspector)?.addEventListener('click', () => {
    const type = $('[data-modifier-add-type]', inspector)?.value;
    if (!type) return;
    snapshot(`modifier.${type}.add`);
    const modifier = addModifier(item, type);
    if (!modifier) return;
    state.selectedModifierUid = modifier.uid;
    state.selectedCurveNodeIndex = null;
    sceneRenderer.invalidateMirrorGeometry();
    markDirty(); renderInspector(); renderScene(); updateSelectionLabels();
  });
  $$('[data-modifier-collapse]', inspector).forEach(button => button.addEventListener('click', () => {
    const uidValue = button.dataset.modifierCollapse;
    state.collapsedModifiers.has(uidValue) ? state.collapsedModifiers.delete(uidValue) : state.collapsedModifiers.add(uidValue);
    renderInspector();
  }));
  $$('[data-modifier-enabled]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
    const modifier = modifierByUid(toggle.dataset.modifierEnabled);
    if (!modifier) return;
    snapshot(`modifier.${modifier.type}.toggle`); modifier.enabled = toggle.checked;
    if (!modifier.enabled && state.selectedModifierUid === modifier.uid) state.selectedModifierUid = null;
    sceneRenderer.invalidateMirrorGeometry(); markDirty(); renderInspector(); renderScene(); updateSelectionLabels();
  }));
  $$('[data-modifier-remove]', inspector).forEach(button => button.addEventListener('click', () => {
    snapshot(`modifier.${item.modifiers?.find(modifier => modifier.uid === button.dataset.modifierRemove)?.type || 'symmetry'}.remove`);
    item.modifiers = (item.modifiers || []).filter(modifier => modifier.uid !== button.dataset.modifierRemove);
    if (state.selectedModifierUid === button.dataset.modifierRemove) state.selectedModifierUid = null;
    state.collapsedModifiers.delete(button.dataset.modifierRemove);
    sceneRenderer.invalidateMirrorGeometry(); markDirty(); renderInspector(); renderScene(); updateSelectionLabels();
  }));
  $$('[data-modifier-bake]', inspector).forEach(button => button.addEventListener('click', () => {
    const modifierUid = button.dataset.modifierBake;
    snapshot(`modifier.${item.modifiers?.find(modifier => modifier.uid === modifierUid)?.type || 'symmetry'}.bake`);
    const result = bakeModifier(state.project, item, modifierUid);
    if (!result) return toast('這個修改器目前無法烘焙');
    state.selectedModifierUid = null;
    state.collapsedModifiers.delete(modifierUid);
    state.selectedUid = result.rootUid;
    state.selectedUids = new Set([result.rootUid]);
    state.selectionAnchorUid = result.rootUid;
    sceneRenderer.invalidateMirrorGeometry();
    invalidateAllRenderGeometry();
    markDirty(); renderAll(); toast('已烘焙選中的修改器');
  }));
  $$('[data-edit-modifier-anchor]', inspector).forEach(button => button.addEventListener('click', () => {
    const modifier = modifierByUid(button.dataset.editModifierAnchor);
    if (!modifier?.enabled) return;
    state.selectedModifierUid = state.selectedModifierUid === modifier.uid ? null : modifier.uid;
    state.selectedCurveNodeIndex = null;
    if (state.selectedModifierUid && !['move', 'rotate', 'pivot'].includes(state.tool)) {
      setTool('move');
      return;
    }
    renderInspector(); renderScene(); updateSelectionLabels();
  }));
  $$('[data-modifier-move]', inspector).forEach(button => button.addEventListener('click', () => {
    const index = item.modifiers?.findIndex(modifier => modifier.uid === button.dataset.modifierUid) ?? -1;
    const target = index + (button.dataset.modifierMove === 'up' ? -1 : 1);
    if (index < 0 || target < 0 || target >= item.modifiers.length) return;
    snapshot(`modifier.${item.modifiers[index].type}.move`); [item.modifiers[index], item.modifiers[target]] = [item.modifiers[target], item.modifiers[index]];
    sceneRenderer.invalidateMirrorGeometry(); markDirty(); renderInspector(); renderScene();
  }));
  $$('[data-modifier-axis]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
    const modifier = modifierByUid(toggle.dataset.modifierUid);
    if (!modifier) return;
    snapshot(`modifier.${modifier.type}.change`); modifier.axes[toggle.dataset.modifierAxis] = toggle.checked;
    sceneRenderer.invalidateMirrorGeometry(); markDirty(); renderScene();
  }));
  $$('[data-modifier-field]', inspector).forEach(input => input.addEventListener('change', () => {
    const modifier = modifierByUid(input.dataset.modifierUid);
    if (!modifier) return;
    const key = input.dataset.modifierField;
    let value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
    if (key === 'copies') value = Math.max(1, Math.min(256, Math.round(value) || 1));
    if (!Number.isFinite(value) && input.type === 'number') return;
    snapshot(`modifier.${modifier.type}.change`); modifier[key] = value;
    sceneRenderer.invalidateMirrorGeometry(); markDirty();
    if (key === 'mode' || key === 'distribution') renderInspector();
    renderScene();
  }));
  $$('[data-modifier-vector]', inspector).forEach(input => {
    let snapshotTaken = false;
    const apply = () => {
      const modifier = modifierByUid(input.dataset.modifierUid);
      const value = Number(input.value);
      if (!modifier || !Number.isFinite(value)) return;
      if (!snapshotTaken) { snapshot(`modifier.${modifier.type}.transform`); snapshotTaken = true; }
      const [scope, property] = input.dataset.modifierVector.split('.');
      modifier[scope][property][Number(input.dataset.axis)] = value;
      sceneRenderer.invalidateMirrorGeometry(); markDirty(); renderScene();
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
    input.addEventListener('blur', () => { snapshotTaken = false; });
  });
  const operatorByUid = uidValue => item.operators?.find(operator => operator.uid === uidValue);
  $$('[data-edit-operator-anchor]', inspector).forEach(button => button.addEventListener('click', () => {
    const operator = operatorByUid(button.dataset.editOperatorAnchor);
    if (!operator?.enabled) return;
    state.selectedModifierUid = state.selectedModifierUid === operator.uid ? null : operator.uid;
    state.selectedCurveNodeIndex = null;
    if (state.selectedModifierUid) {
      if (state.mode !== 'edit') setMode('edit');
      if (!['move', 'rotate', 'pivot'].includes(state.tool)) setTool('move');
    }
    renderInspector(); renderScene(); updateSelectionLabels();
  }));
  const invalidatePaintOperator = operator => {
    if (operator) paintSymmetryRelationCache.delete(operator.uid);
    markDirty();
    if (operator?.enabled) schedulePaintSymmetryBuild(item, operator);
  };
  $('[data-action="addOperator"]', inspector)?.addEventListener('click', () => {
    const type = $('[data-operator-add-type]', inspector)?.value;
    if (!type) return;
    snapshot(`operator.${type}.add`);
    const operator = addOperator(item, type);
    if (!operator) return;
    invalidatePaintOperator(operator);
    renderInspector(); renderScene(); updateSelectionLabels();
  });
  $$('[data-operator-collapse]', inspector).forEach(button => button.addEventListener('click', () => {
    const uidValue = button.dataset.operatorCollapse;
    state.collapsedOperators.has(uidValue) ? state.collapsedOperators.delete(uidValue) : state.collapsedOperators.add(uidValue);
    renderInspector();
  }));
  $$('[data-operator-enabled]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
    const operator = operatorByUid(toggle.dataset.operatorEnabled);
    if (!operator) return;
    snapshot(`operator.${operator.type}.toggle`); operator.enabled = toggle.checked;
    if (!operator.enabled && state.selectedModifierUid === operator.uid) state.selectedModifierUid = null;
    invalidatePaintOperator(operator); renderInspector(); renderScene();
  }));
  $$('[data-operator-remove]', inspector).forEach(button => button.addEventListener('click', () => {
    const uidValue = button.dataset.operatorRemove;
    snapshot(`operator.${item.operators?.find(operator => operator.uid === uidValue)?.type || 'paint_symmetry'}.remove`); item.operators = (item.operators || []).filter(operator => operator.uid !== uidValue);
    if (state.selectedModifierUid === uidValue) state.selectedModifierUid = null;
    state.collapsedOperators.delete(uidValue); paintSymmetryRelationCache.delete(uidValue);
    markDirty(); renderInspector(); renderScene();
  }));
  $$('[data-operator-move]', inspector).forEach(button => button.addEventListener('click', () => {
    const index = item.operators?.findIndex(operator => operator.uid === button.dataset.operatorUid) ?? -1;
    const target = index + (button.dataset.operatorMove === 'up' ? -1 : 1);
    if (index < 0 || target < 0 || target >= item.operators.length) return;
    snapshot(`operator.${item.operators[index].type}.move`); [item.operators[index], item.operators[target]] = [item.operators[target], item.operators[index]];
    invalidatePaintOperator(item.operators[target]); renderInspector();
  }));
  $$('[data-operator-axis]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
    const operator = operatorByUid(toggle.dataset.operatorUid);
    if (!operator) return;
    snapshot(`operator.${operator.type}.change`); operator.axes[toggle.dataset.operatorAxis] = toggle.checked;
    invalidatePaintOperator(operator);
    renderScene();
  }));
  $$('[data-operator-field]', inspector).forEach(input => input.addEventListener('change', () => {
    const operator = operatorByUid(input.dataset.operatorUid);
    if (!operator) return;
    const key = input.dataset.operatorField;
    let value = input.type === 'number' ? Number(input.value) : input.value;
    if (key === 'copies') value = Math.max(1, Math.min(256, Math.round(value) || 1));
    if (!Number.isFinite(value) && input.type === 'number') return;
    snapshot(`operator.${operator.type}.change`); operator[key] = value; invalidatePaintOperator(operator);
    if (key === 'mode' || key === 'distribution') renderInspector();
    renderScene();
  }));
  $$('[data-operator-vector]', inspector).forEach(input => {
    let snapshotTaken = false;
    const apply = () => {
      const operator = operatorByUid(input.dataset.operatorUid);
      const value = Number(input.value);
      if (!operator || !Number.isFinite(value)) return;
      if (!snapshotTaken) { snapshot(`operator.${operator.type}.transform`); snapshotTaken = true; }
      const [scope, property] = input.dataset.operatorVector.split('.');
      operator[scope][property][Number(input.dataset.axis)] = value;
      invalidatePaintOperator(operator);
      renderScene();
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
    input.addEventListener('blur', () => { snapshotTaken = false; });
  });
  $('[data-shape-snap-mode]', inspector)?.addEventListener('change', event => {
    snapshot('core.shape.snap_mode');
    for (const target of items.filter(isShapeElement)) target.parameters.snapMode = event.target.value === 'radius' ? 'radius' : 'edge';
    markDirty(); renderAll('selection');
  });
  $('[data-shape-inner-radius]', inspector)?.addEventListener('change', event => {
    snapshot('core.shape.inner_radius');
    for (const target of items.filter(isShapeElement)) {
      discardSubdivisionEdits(target);
      target.parameters.innerRadiusEnabled = event.target.checked;
    }
    markDirty(); renderAll('selection');
  });
  $('[data-shape-inner-radius-mode]', inspector)?.addEventListener('change', event => {
    snapshot('core.shape.inner_radius_mode');
    for (const target of items.filter(isShapeElement)) {
      discardSubdivisionEdits(target);
      target.parameters.innerRadiusMode = event.target.value === 'depth' ? 'depth' : 'radius';
    }
    markDirty(); renderAll('selection');
  });
  $('[data-curve-segmentation]', inspector)?.addEventListener('change', event => {
    snapshot('core.curve.segmentation');
    for (const target of items.filter(isBezierElement)) {
      discardSubdivisionEdits(target);
      target.parameters.segmentationMode = event.target.value;
    }
    markDirty(); renderAll('selection');
  });
  $$('[data-select-curve-node]', inspector).forEach(button => button.addEventListener('click', () => {
    state.selectedModifierUid = null;
    state.selectedCurveNodeIndex = Number(button.dataset.selectCurveNode);
    renderInspector(); renderScene(); updateSelectionLabels();
  }));
  $$('[data-curve-node-toggle]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
    const node = item.nodes?.[Number(toggle.dataset.curveNodeToggle)];
    if (!node) return;
    snapshot('core.curve.handle'); discardSubdivisionEdits(item); node.handlesEnabled = toggle.checked; markDirty(); renderAll('selection');
  }));
  $$('[data-curve-node-symmetric]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
    const node = item.nodes?.[Number(toggle.dataset.curveNodeSymmetric)];
    if (!node) return;
    snapshot('core.curve.handle');
    discardSubdivisionEdits(item);
    node.symmetricHandles = toggle.checked;
    if (toggle.checked) setCurveHandle(node, 'handleOut', node.handleOut, item.dimension === 2);
    markDirty(); renderAll('selection');
  }));
  $$('[data-curve-node-auto]', inspector).forEach(toggle => toggle.addEventListener('change', () => {
    const index = Number(toggle.dataset.curveNodeAuto);
    const node = item.nodes?.[index];
    if (!node) return;
    snapshot('core.curve.tangent');
    discardSubdivisionEdits(item);
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
      if (!snapshotTaken) { snapshot('core.curve.roll'); snapshotTaken = true; }
      discardSubdivisionEdits(item);
      node.roll = value;
      markDirty(); invalidateSelectionRenderGeometry(); renderScene();
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
    input.addEventListener('blur', () => { snapshotTaken = false; });
  });
  $$('[data-remove-curve-node]', inspector).forEach(button => button.addEventListener('click', () => {
    if (!isBezierElement(item) || item.nodes.length <= 2) return;
    snapshot('core.curve.node_remove');
    discardSubdivisionEdits(item);
    item.nodes.splice(Number(button.dataset.removeCurveNode), 1);
    state.selectedCurveNodeIndex = Math.min(item.nodes.length - 1, state.selectedCurveNodeIndex ?? 0);
    markDirty(); renderAll('selection');
  }));
  $('[data-action="deleteSelected"]', inspector)?.addEventListener('click', deleteSelected);
  $('[data-action="enterSubdivisionEdit"]', inspector)?.addEventListener('click', () => enterSubdivisionEdit(item));
  $('[data-action="exitSubdivisionEdit"]', inspector)?.addEventListener('click', () => exitSubdivisionEdit());
  $('[data-action="resetTransform"]', inspector)?.addEventListener('click', () => {
    snapshot('core.element.reset_rotation');
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

function selectItem(uid, { revealInOutliner = false, toggle = false, range = false } = {}) {
  const requestedNode = state.project.getNode(uid);
  if (!requestedNode) return;
  if (subdivisionSession && requestedNode.subdivisionOwnerUid !== subdivisionSession.ownerUid) {
    toast('細分編輯期間只能選擇目前 Shape 內的 Cube');
    return;
  }
  const previousSelectedUid = state.selectedUid;
  state.selectedGenerated = null;
  sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
  if (range && state.selectionAnchorUid) {
    const rows = state.outlinerRows || [];
    const start = rows.findIndex(row => row.node.uid === state.selectionAnchorUid);
    const end = rows.findIndex(row => row.node.uid === uid);
    if (start >= 0 && end >= 0) {
      const extended = new Set(state.selectedUids);
      rows.slice(Math.min(start, end), Math.max(start, end) + 1)
        .filter(row => !row.curveNode)
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
    refreshAutomaticNodeName(state.project, state.project.getNode(uidValue));
    return;
  }
  // A single selected group is an insertion target. In a multi-selection it is
  // treated like any other row, so creation follows the last selected row.
  if (selectedIds.length === 1 && reference.type === 'group') {
    reference.children.push(uidValue);
    state.collapsedGroups.delete(reference.uid);
    state.project.invalidateHierarchyIndex();
    refreshAutomaticNodeName(state.project, state.project.getNode(uidValue));
    return;
  }
  const { items } = nodeContainer(reference.uid);
  const index = items.indexOf(reference.uid);
  items.splice(index < 0 ? items.length : index + 1, 0, uidValue);
  state.project.invalidateHierarchyIndex();
  refreshAutomaticNodeName(state.project, state.project.getNode(uidValue));
}

function selectCreatedNode(uidValue) {
  state.selectedUid = uidValue;
  state.selectedUids = new Set([uidValue]);
  state.selectionAnchorUid = uidValue;
  state.selectedCurveNodeIndex = null;
}

function addCube() {
  if (state.mode === 'paint') return;
  snapshot('core.cube.create');
  const cube = new Cube({ position: [-3, 1, -3], size: [6, 6, 6], pivot: [0, 4, 0], color: '#a7d352' });
  state.project.elements.push(cube);
  insertNewNodeUid(cube.uid);
  selectCreatedNode(cube.uid);
  markDirty(); renderAll(); toast('已新增 Cube');
}

function addShape(shapeType = 'polygon_prism') {
  if (state.mode === 'paint') return;
  snapshot('core.shape.create');
  const type = ['dodecahedron', 'truncated_icosahedron'].includes(shapeType) ? shapeType : 'polygon_prism';
  const shape = new Shape({ type, shapeType: type, origin: [0, 2, 0], pivot: [0, 2, 0] });
  state.project.elements.push(shape);
  insertNewNodeUid(shape.uid);
  selectCreatedNode(shape.uid);
  const label = type === 'truncated_icosahedron' ? '足球（截角二十面體）' : type === 'dodecahedron' ? '正十二面體' : '多邊形柱體';
  markDirty(); renderAll(); toast(`已新增${label} Shape`);
}

function addLocator() {
  if (state.mode === 'paint') return;
  snapshot('core.locator.create');
  const locator = new Locator({ position: [0, 4, 0] });
  state.project.elements.push(locator);
  insertNewNodeUid(locator.uid);
  selectCreatedNode(locator.uid);
  markDirty(); renderAll(); toast('已新增 Locator');
}

function addBezierElement(dimension) {
  if (state.mode === 'paint') return;
  snapshot('core.curve.create');
  const type = dimension === 2 ? 'bezier2d' : 'bezier3d';
  const curve = new BezierElement({ origin: [0, 4, 0] }, dimension);
  state.project.elements.push(curve);
  insertNewNodeUid(curve.uid);
  selectCreatedNode(curve.uid);
  state.selectedCurveNodeIndex = 0;
  markDirty(); renderAll(); toast(`已新增${dimension === 2 ? '二維' : '三維'}貝塞爾元素`);
}

function addGroup() {
  if (state.mode === 'paint') return;
  const previousRowPositions = captureOutlinerRowPositions();
  snapshot('core.group.create');
  const group = new Group({ name: allocateGroupName(state.project), unnamed: true, children: [] });
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
  group.children.forEach(childUid => refreshAutomaticNodeName(state.project, state.project.getNode(childUid)));
  selectCreatedNode(group.uid);
  markDirty(); renderAll(); animateOutlinerReorder(previousRowPositions); toast('已新增組');
}

function deleteSelected(operationId = 'core.element.delete') {
  if (state.mode === 'paint') return;
  const selectedIds = topLevelSelectedUids();
  if (!selectedIds.length) return;
  if (subdivisionSession && selectedIds.some(uidValue => state.project.getNode(uidValue)?.subdivisionOwnerUid)) {
    return toast('細分 Cube 由 Shape 管理，不能單獨刪除');
  }
  snapshot(operationId);
  selectedIds.forEach(uidValue => state.project.removeNode(uidValue));
  state.selectedUid = null;
  state.selectedUids = new Set();
  state.selectionAnchorUid = null;
  state.selectedCurveNodeIndex = null;
  markDirty(); renderAll(); toast(selectedIds.length > 1 ? `已刪除 ${selectedIds.length} 項` : '物件已刪除');
}

let elementClipboard = null;

function captureSelectedElements() {
  const order = new Map((state.outlinerRows || []).map((row, index) => [row.node.uid, index]));
  const roots = topLevelSelectedUids()
    .sort((left, right) => (order.get(left) ?? Infinity) - (order.get(right) ?? Infinity));
  if (!roots.length) return null;
  const records = new Map();
  const visit = uidValue => {
    if (records.has(uidValue)) return;
    const node = state.project.getNode(uidValue);
    if (!node) return;
    records.set(uidValue, structuredClone(node));
    if (node.type === 'group') node.children.forEach(visit);
  };
  roots.forEach(visit);
  return { roots: [...roots], records: [...records.entries()] };
}

function copySelected({ notify = true } = {}) {
  const payload = captureSelectedElements();
  if (!payload) return false;
  elementClipboard = payload;
  if (notify) toast(payload.roots.length > 1 ? `已複製 ${payload.roots.length} 項` : '已複製選中項');
  return true;
}

function instantiateClipboard(payload) {
  if (!payload?.records?.length) return null;
  const instances = new Map();
  const reservedGroupNames = [];
  for (const [oldUid, source] of payload.records) {
    const data = structuredClone(source);
    delete data.uid;
    delete data.uuid;
    if (data.type === 'group') {
      data.name = allocateGroupName(state.project, data.unnamed ? 'group_1' : data.name || 'group', {
        duplicate: true, reservedNames: reservedGroupNames
      });
      reservedGroupNames.push(data.name);
    }
    let node;
    if (data.type === 'group') node = new Group({ ...data, children: [] });
    else if (data.type === 'shape' || data.type === 'polygon_prism' || data.type === 'dodecahedron' || data.type === 'truncated_icosahedron') node = new Shape(data);
    else if (data.type === 'locator') node = new Locator(data);
    else if (data.type === 'node') node = new NodeElement(data);
    else if (data.type === 'bezier2d') node = new BezierElement(data, 2);
    else if (data.type === 'bezier3d') node = new BezierElement(data, 3);
    else node = new Cube(data);
    instances.set(oldUid, node);
  }
  for (const [oldUid, source] of payload.records) {
    const node = instances.get(oldUid);
    if (node?.type === 'group') node.children = (source.children || [])
      .map(childUid => instances.get(childUid)?.uid).filter(Boolean);
  }
  return {
    nodes: [...instances.values()],
    roots: payload.roots.map(uidValue => instances.get(uidValue)).filter(Boolean)
  };
}

function insertClonedRoots(cloned, sourceRootUids = null) {
  const roots = cloned.roots.map(node => node.uid);
  if (sourceRootUids?.length) {
    sourceRootUids.forEach((sourceUid, index) => {
      const { items } = nodeContainer(sourceUid);
      const sourceIndex = items.indexOf(sourceUid);
      items.splice(sourceIndex < 0 ? items.length : sourceIndex + 1, 0, roots[index]);
    });
    return;
  }
  const selectedIds = selectedNodeUids();
  const reference = state.project.getNode(state.selectedUid);
  if (selectedIds.length === 1 && reference?.type === 'group') {
    reference.children.push(...roots);
    state.collapsedGroups.delete(reference.uid);
    return;
  }
  if (reference) {
    const { items } = nodeContainer(reference.uid);
    const index = items.indexOf(reference.uid);
    items.splice(index < 0 ? items.length : index + 1, 0, ...roots);
  } else state.project.outliner.push(...roots);
}

function pasteElements({ inPlace = false } = {}) {
  if (state.mode === 'paint') return;
  const payload = inPlace ? captureSelectedElements() : elementClipboard;
  if (!payload) return toast(inPlace ? '沒有可複製的選中項' : '元素剪貼簿是空的');
  const cloned = instantiateClipboard(payload);
  if (!cloned?.roots.length) return;
  snapshot(inPlace ? 'core.element.duplicate' : 'core.element.paste');
  for (const node of cloned.nodes) {
    if (node.type === 'group') state.project.groups.push(node);
    else state.project.elements.push(node);
  }
  insertClonedRoots(cloned, inPlace ? payload.roots : null);
  state.project.invalidateHierarchyIndex();
  state.selectedUids = new Set(cloned.roots.map(node => node.uid));
  state.selectedUid = cloned.roots.at(-1).uid;
  state.selectionAnchorUid = state.selectedUid;
  state.selectedCurveNodeIndex = null;
  markDirty(); renderAll();
  toast(inPlace ? '已就地複製選中項' : '已貼上元素');
}

function cutSelected() {
  if (state.mode === 'paint') return;
  if (!copySelected({ notify: false })) return;
  const count = elementClipboard.roots.length;
  deleteSelected('core.element.cut');
  toast(count > 1 ? `已剪切 ${count} 項` : '已剪切選中項');
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
  snapshot('core.element.reparent');
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
  moving.forEach(uidValue => refreshAutomaticNodeName(state.project, state.project.getNode(uidValue)));
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
    .filter(element => element && (element.type === 'cube' || isShapeElement(element) || isBezierElement(element)));
}

function getUvPreviewProject() {
  const sourceElements = uvPreviewElements();
  const key = sourceElements.map(element => element.uid).sort().join('|');
  if (state.uvPreviewSelectedFace && !sourceElements.some(element => element.uid === state.uvPreviewSelectedFace.uid)) {
    state.uvPreviewSelectedFace = null;
  }
  if (uvPreviewProjectCache?.source === state.project
    && uvPreviewProjectCache.key === key
    && uvPreviewProjectCache.hierarchyRevision === state.project.hierarchyRevision) return uvPreviewProjectCache;

  // Visibility and locking are editor concerns. This isolated preview always
  // shows the selected geometry while inheriting its real transform and UVs.
  const previewTexture = faceTextureReference(activeTextureAsset()) || '__cubebricks_uv_preview__';
  const elements = sourceElements.map(element => {
    const preview = Object.assign(Object.create(element), { visible: true, locked: false, modifiers: [] });
    if (element.type !== 'cube') return preview;
    const sourceFaces = element.faces || {};
    preview.faces = Object.fromEntries(CUBE_FACE_NAMES.map(faceName => {
      const sourceFace = sourceFaces[faceName];
      if (!isCubeFaceCulled(sourceFace)) return [faceName, sourceFace ? { ...sourceFace } : sourceFace];
      const storedTexture = effectiveFaceTextureReference(sourceFace);
      return [faceName, {
        ...(sourceFace && typeof sourceFace === 'object' ? sourceFace : {}),
        enabled: true,
        texture: storedTexture ?? previewTexture,
        uv: Array.isArray(sourceFace?.uv) ? [...sourceFace.uv] : [...getBlockbenchBoxUv(element, faceName)],
        rotation: Number(sourceFace?.rotation) || 0
      }];
    }));
    return preview;
  });
  const groups = state.project.groups.map(group => Object.assign(Object.create(group), { locked: false, modifiers: [] }));
  const previewNodes = new Map([...elements, ...groups].map(node => [node.uid, node]));
  const previewGroups = new Map(groups.map(group => [group.uid, group]));
  const project = {
    elements,
    groups,
    outliner: elements.map(element => element.uid),
    textureSize: state.project.textureSize,
    renderType: state.uvPreviewFaceColors ? 'solid' : state.project.renderType,
    cullFaces: state.project.cullFaces,
    getNode: uidValue => previewNodes.get(uidValue) || null,
    getGroupChain: uidValue => state.project.getGroupChain(uidValue)
      .map(group => previewGroups.get(group.uid) || group),
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

function syncUvPreviewPanelAspect(textureWidth, textureHeight) {
  const panel = dockManager?.get('uvPreview');
  if (!panel || panel.state.collapsed || panel.element.hidden) {
    uvPreviewPanelMetrics = null;
    return;
  }
  const width = Math.max(1, panel.element.getBoundingClientRect().width || panel.state.width);
  const ratio = Math.max(.001, textureHeight / textureWidth);
  const current = { width, ratio };
  const previous = uvPreviewPanelMetrics;
  uvPreviewPanelMetrics = current;
  if (!previous) return;

  const widthChanged = Math.abs(current.width - previous.width) >= .75;
  const ratioChanged = Math.abs(current.ratio - previous.ratio) >= .0001;
  if (!widthChanged && !ratioChanged) return;

  // Keep manual vertical resizing intact. Only compensate for the amount by which
  // a horizontal resize (or texture aspect change) changes the preview itself.
  const previousPreviewHeight = Math.max(1, (previous.width - 16) * previous.ratio);
  const currentPreviewHeight = Math.max(1, (current.width - 16) * current.ratio);
  const heightDelta = currentPreviewHeight - previousPreviewHeight;
  if (Math.abs(heightDelta) < .5) return;
  const maximum = panel.state.dock === 'floating'
    ? Math.max(180, window.innerHeight - panel.state.y)
    : Math.max(180, window.innerHeight - 120);
  const desired = Math.min(maximum, Math.max(180, panel.state.height + heightDelta));
  if (Math.abs(panel.state.height - desired) < .5) return;
  panel.state.height = desired;
  dockManager.applyPanelState(panel);
}

function setUvPreviewPlaceholder(message, visible) {
  const empty = $('#uvPreviewEmpty');
  empty.textContent = message;
  empty.hidden = !visible;
  uvPreviewCanvas.hidden = visible;
  if (visible) {
    $('#uvPreviewSize').textContent = '—';
    $('#uvPreviewFaceOverlay').innerHTML = '';
    $('#uvSelectedFaceLabel').textContent = '未選擇面';
    $$('[data-uv-face-action]').forEach(button => button.disabled = true);
  }
  $('[data-panel="uvPreview"]')?.classList.toggle('preview-disabled', !state.uvPreviewEnabled);
}

const UV_FACE_LABELS = Object.freeze({ north: '北面', south: '南面', east: '東面', west: '西面', up: '上面', down: '下面' });
const CULLED_FACE_TEXTURE_KEY = '_cubebricksCulledTexture';

function effectiveFaceTextureReference(face) {
  if (!face || typeof face !== 'object') return undefined;
  if (face.texture !== null && face.texture !== undefined) return face.texture;
  if (Object.prototype.hasOwnProperty.call(face, CULLED_FACE_TEXTURE_KEY)) {
    const stored = face[CULLED_FACE_TEXTURE_KEY];
    return stored === null ? undefined : stored;
  }
  return undefined;
}

function ensureCubeFaceRecord(cube, faceName) {
  if (!cube.faces) cube.faces = {};
  const existing = cube.faces[faceName];
  if (existing && typeof existing === 'object') {
    if (!Array.isArray(existing.uv) || existing.uv.length < 4) existing.uv = [...getBlockbenchBoxUv(cube, faceName)];
    return existing;
  }
  const face = {
    uv: [...getBlockbenchBoxUv(cube, faceName)],
    rotation: 0
  };
  if (existing === null) face.texture = null;
  cube.faces[faceName] = face;
  return face;
}

function setCubeFaceCulled(cube, faceName, culled) {
  const face = ensureCubeFaceRecord(cube, faceName);
  if (culled) {
    if (!Object.prototype.hasOwnProperty.call(face, CULLED_FACE_TEXTURE_KEY) && face.texture !== null) {
      face[CULLED_FACE_TEXTURE_KEY] = face.texture === undefined ? null : face.texture;
    }
    face.texture = null;
    delete face.enabled;
    return;
  }
  if (!isCubeFaceCulled(face)) return;
  if (Object.prototype.hasOwnProperty.call(face, CULLED_FACE_TEXTURE_KEY)) {
    const stored = face[CULLED_FACE_TEXTURE_KEY];
    if (stored === null || stored === undefined) delete face.texture;
    else face.texture = stored;
    delete face[CULLED_FACE_TEXTURE_KEY];
  } else {
    const activeReference = faceTextureReference(activeTextureAsset());
    if (activeReference === undefined || activeReference === null) delete face.texture;
    else face.texture = activeReference;
  }
  delete face.enabled;
}

function cubeHasOnlyCulledFaces(cube) {
  return CUBE_FACE_NAMES.every(faceName => isCubeFaceCulled(cube.faces?.[faceName]));
}

function textureOrderedFacePoints(points, uv, rotation) {
  const slots = createBlockbenchFaceUvSlots(uv, rotation);
  const uValues = slots.map(slot => slot[0]), vValues = slots.map(slot => slot[1]);
  const minU = Math.min(...uValues), maxU = Math.max(...uValues);
  const minV = Math.min(...vValues), maxV = Math.max(...vValues);
  const used = new Set();
  return [[minU, minV], [maxU, minV], [minU, maxV], [maxU, maxV]].map(([u, v]) => {
    let bestIndex = -1, bestDistance = Infinity;
    slots.forEach((slot, index) => {
      if (used.has(index)) return;
      const distance = (slot[0] - u) ** 2 + (slot[1] - v) ** 2;
      if (distance < bestDistance) { bestIndex = index; bestDistance = distance; }
    });
    if (bestIndex < 0) bestIndex = used.size;
    used.add(bestIndex);
    return points[bestIndex];
  });
}

function buildUvPreviewFaceLabel() {
  const selection = state.uvPreviewSelectedFace;
  const data = selectedUvFaceData(false);
  const points = selection?.points || [];
  if (!data || points.length !== 4) return null;
  const [u1, v1, u2, v2] = data.uv;
  const rotation = ((Math.round(Number(data.face.rotation) || 0) % 360) + 360) % 360;
  const info = `↻${rotation}°${u2 < u1 ? ' ↔' : ''}${v2 < v1 ? ' ↕' : ''}`;
  const cacheKey = `${uvPreviewFaceLabelFontRevision}:${info}`;
  if (uvPreviewFaceLabelCacheKey !== cacheKey) {
    const context = uvPreviewFaceLabelCanvas.getContext('2d');
    const font = '12px "Fusion Pixel Latin", monospace';
    context.font = font;
    const metrics = context.measureText(info);
    const ascent = Math.ceil(metrics.actualBoundingBoxAscent || 10);
    const descent = Math.ceil(metrics.actualBoundingBoxDescent || 2);
    uvPreviewFaceLabelCanvas.width = Math.max(1, Math.ceil(metrics.width) + 4);
    uvPreviewFaceLabelCanvas.height = Math.max(1, ascent + descent + 4);
    context.clearRect(0, 0, uvPreviewFaceLabelCanvas.width, uvPreviewFaceLabelCanvas.height);
    context.imageSmoothingEnabled = false;
    context.font = font;
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#080908';
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) context.fillText(info, 2 + dx, 2 + ascent + dy);
    context.fillStyle = '#f5f6f2';
    context.fillText(info, 2, 2 + ascent);
    uvPreviewFaceLabelCacheKey = cacheKey;
  }

  const uVector = points[1].map((value, axis) => value - points[0][axis]);
  const vVector = points[2].map((value, axis) => value - points[0][axis]);
  const uLength = Math.hypot(...uVector), vLength = Math.hypot(...vVector);
  if (uLength < 1e-5 || vLength < 1e-5) return null;
  const uDirection = normalize3(uVector), vDirection = normalize3(vVector);
  const textureAspect = uvPreviewFaceLabelCanvas.width / uvPreviewFaceLabelCanvas.height;
  // Deliberately size from the longest face edge. Thin faces must not crush
  // the label merely because their other axis is short.
  const labelHeight = Math.max(uLength, vLength) * .18;
  const labelWidth = labelHeight * textureAspect;
  const origin = addScaled3(addScaled3(points[0], uDirection, uLength * .055), vDirection, vLength * .035);
  const topRight = addScaled3(origin, uDirection, labelWidth);
  const bottomLeft = addScaled3(origin, vDirection, labelHeight);
  const bottomRight = addScaled3(topRight, vDirection, labelHeight);
  return {
    key: cacheKey,
    source: uvPreviewFaceLabelCanvas,
    quad: [origin, topRight, bottomLeft, bottomRight]
  };
}

function selectedUvFaceData(create = false) {
  const selection = state.uvPreviewSelectedFace;
  const cube = selection && state.project.getNode(selection.uid);
  if (!cube || cube.type !== 'cube' || !selection.faceName) return null;
  if (!cube.faces) {
    if (!create) return { cube, face: {}, uv: getBlockbenchBoxUv(cube, selection.faceName) };
    cube.faces = {};
  }
  if (!Object.prototype.hasOwnProperty.call(cube.faces, selection.faceName)) {
    if (!create) return { cube, face: {}, uv: getBlockbenchBoxUv(cube, selection.faceName) };
    cube.faces[selection.faceName] = { uv: getBlockbenchBoxUv(cube, selection.faceName), rotation: 0 };
  }
  let face = cube.faces[selection.faceName];
  if (face === null) {
    if (create) face = ensureCubeFaceRecord(cube, selection.faceName);
    else return { cube, face: { texture: null }, uv: getBlockbenchBoxUv(cube, selection.faceName), culled: true };
  }
  return { cube, face, uv: face.uv?.length >= 4 ? face.uv : getBlockbenchBoxUv(cube, selection.faceName) };
}

function updateUvFaceUi() {
  renderTextureTileControls();
  const selection = state.uvPreviewSelectedFace;
  const data = selectedUvFaceData(false);
  const controls = $$('[data-uv-face-action]');
  controls.forEach(button => button.disabled = !data || (state.mode === 'paint' && button.dataset.uvFaceAction === 'cull'));
  const label = $('#uvSelectedFaceLabel');
  const size = $('#uvPreviewSize');
  const overlay = $('#uvPreviewFaceOverlay');
  if (!data || !selection) {
    label.textContent = '未選擇面';
    size.textContent = '—';
    overlay.innerHTML = '';
    controls.forEach(button => button.classList.remove('active'));
    return;
  }
  const [u1, v1, u2, v2] = data.uv;
  const rotation = ((Math.round(Number(data.face.rotation) || 0) % 360) + 360) % 360;
  const mirrorX = u2 < u1, mirrorY = v2 < v1;
  const culled = isCubeFaceCulled(data.cube.faces?.[selection.faceName]);
  label.textContent = `${data.cube.name} · ${UV_FACE_LABELS[selection.faceName] || selection.faceName}${culled ? ' · 已剔除' : ''}`;
  size.textContent = `${formatNumber(Math.abs(u2 - u1))} × ${formatNumber(Math.abs(v2 - v1))} px`;
  $('[data-uv-face-action="mirror-x"]').classList.toggle('active', mirrorX);
  $('[data-uv-face-action="mirror-y"]').classList.toggle('active', mirrorY);
  $('[data-uv-face-action="cull"]').classList.toggle('active', culled);
  $('[data-uv-face-action="cull"]').title = culled ? '恢復面' : '剔除面';
  const points = selection.points || [];
  const projected = points.map(point => uvPreviewRenderer.projectPoint(point));
  if (projected.length !== 4 || projected.some(point => point.behind || point.depth < -1 || point.depth > 1)) {
    overlay.innerHTML = ''; return;
  }
  const width = uvPreviewViewport.clientWidth, height = uvPreviewViewport.clientHeight;
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const perimeter = [projected[0], projected[1], projected[3], projected[2]];
  const texturePoints = textureOrderedFacePoints(points, data.uv, rotation);
  const textureProjected = texturePoints.map(point => uvPreviewRenderer.projectPoint(point));
  const [textureTopLeft, textureTopRight] = textureProjected;
  overlay.innerHTML = `<path class="uv-preview-face-outline" d="M${perimeter.map(point => `${point.x},${point.y}`).join(' L')} Z"/>
    <path class="uv-preview-face-north" d="M${textureTopLeft.x},${textureTopLeft.y} L${textureTopRight.x},${textureTopRight.y}"/>`;
}

function editSelectedUvFace(action) {
  if (action === 'cull') {
    toggleSelectedUvFacesCull();
    return;
  }
  const data = selectedUvFaceData(true);
  if (!data) return toast('請先在 UV 預覽中選擇 Cube 的面');
  snapshot(action === 'rotate' ? 'core.uv.rotate' : 'core.uv.mirror');
  if (!Array.isArray(data.face.uv) || data.face.uv.length < 4) data.face.uv = [...data.uv];
  if (action === 'rotate') data.face.rotation = ((Number(data.face.rotation) || 0) + 90) % 360;
  if (action === 'mirror-x') [data.face.uv[0], data.face.uv[2]] = [data.face.uv[2], data.face.uv[0]];
  if (action === 'mirror-y') [data.face.uv[1], data.face.uv[3]] = [data.face.uv[3], data.face.uv[1]];
  data.cube.autoUv = false;
  markDirty();
  uvPreviewProjectCache = null;
  invalidateSelectionRenderGeometry();
  renderScene();
}

function toggleSelectedUvFacesCull() {
  if (state.mode === 'paint') return;
  const selection = state.uvPreviewSelectedFace;
  const current = selectedUvFaceData(false);
  if (!selection || !current) return toast('請先在 UV 預覽中選擇 Cube 的面');
  const currentKey = uvFaceKey(selection.uid, selection.faceName);
  const keys = state.selectedUvFaces.has(currentKey) && state.selectedUvFaces.size
    ? [...state.selectedUvFaces]
    : [currentKey];
  const targets = keys.map(parseUvFaceKey).filter(Boolean).map(entry => ({
    ...entry,
    cube: state.project.getNode(entry.uid)
  })).filter(entry => entry.cube?.type === 'cube' && CUBE_FACE_NAMES.includes(entry.faceName));
  if (!targets.length) return;
  const culled = !isCubeFaceCulled(current.cube.faces?.[selection.faceName]);
  snapshot('core.uv.cull_face');
  targets.forEach(entry => setCubeFaceCulled(entry.cube, entry.faceName, culled));

  const removed = new Set();
  for (const cube of new Set(targets.map(entry => entry.cube))) {
    if (!cubeHasOnlyCulledFaces(cube)) continue;
    removed.add(cube.uid);
    state.project.removeNode(cube.uid);
  }
  if (removed.size) {
    state.selectedUids = new Set([...state.selectedUids].filter(uidValue => !removed.has(uidValue)));
    if (removed.has(state.selectedUid)) state.selectedUid = [...state.selectedUids].at(-1) || null;
    if (removed.has(state.selectionAnchorUid)) state.selectionAnchorUid = state.selectedUid;
    state.selectedUvFaces = new Set([...state.selectedUvFaces].filter(key => {
      const parsed = parseUvFaceKey(key);
      return parsed && !removed.has(parsed.uid);
    }));
    if (removed.has(state.uvPreviewSelectedFace?.uid)) state.uvPreviewSelectedFace = null;
  }
  markDirty();
  uvPreviewProjectCache = null;
  renderAll();
  if (removed.size) toast(removed.size > 1 ? `全部面已剔除，已刪除 ${removed.size} 個 Cube` : '全部面已剔除，Cube 已刪除');
  else toast(culled ? `已剔除 ${targets.length} 個面` : `已恢復 ${targets.length} 個面`);
}

function renderUvPreview() {
  if (!state.uvPreviewEnabled) {
    setUvPreviewPlaceholder('預覽已關閉', true);
    uvPreviewRenderDirty = false;
    return false;
  }
  if (!uvPreviewIsActive()) {
    uvPreviewRenderDirty = false;
    return false;
  }
  const cache = getUvPreviewProject();
  if (!cache.elements.length) {
    setUvPreviewPlaceholder('選擇 Cube、Shape 或貝塞爾', true);
    uvPreviewRenderDirty = false;
    return false;
  }
  setUvPreviewPlaceholder('', false);
  if (uvPreviewTextureDirty) {
    if (textureAtlasEntries.length) uvPreviewRenderer.setTextureAtlas(textureAtlasCanvas, textureAtlasEntries);
    else uvPreviewRenderer.setTexture(textureCanvas);
    uvPreviewTextureDirty = false;
  }
  cache.project.textureSize = state.project.textureSize;
  cache.project.renderType = state.project.renderType;
  cache.project.cullFaces = state.project.cullFaces;
  const fit = uvPreviewFit(cache);
  const textureWidth = Math.max(1, Number(state.project.textureSize?.[0]) || 1);
  const textureHeight = Math.max(1, Number(state.project.textureSize?.[1]) || 1);
  uvPreviewViewport.style.setProperty('--uv-preview-aspect', `${textureWidth} / ${textureHeight}`);
  syncUvPreviewPanelAspect(textureWidth, textureHeight);
  uvPreviewRenderer.render(cache.project, null, {
    projection: 'perspective',
    zoom: fit.zoom,
    panX: 0,
    panY: 0,
    yaw: state.uvPreviewYaw,
    pitch: state.uvPreviewPitch,
    target: fit.target,
    selectedUids: new Set(),
    renderMode: 'textured',
    previewShade: true,
    grid: false,
    wire: false,
    geometryOnly: true,
    snap: state.settingsSnap,
    faceDistinct: state.uvPreviewFaceColors,
    faceLabel: buildUvPreviewFaceLabel(),
    lockedDefaultAlpha: 100,
    lockedHoverFade: false,
    editorOverlayLines: []
  });
  uvPreviewRenderDirty = false;
  updateUvFaceUi();
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

function refreshUvPreview(force = true) {
  if (force) uvPreviewRenderDirty = true;
  if (uvPreviewRenderDirty) renderUvPreview();
  scheduleUvPreviewAnimation();
}

function renderScene() {
  if (sceneRenderFrame !== null) cancelAnimationFrame(sceneRenderFrame);
  sceneRenderFrame = null;
  const hidePaintSelection = state.mode === 'paint';
  sceneRenderer.render(state.project, hidePaintSelection ? null : state.selectedUid, {
    ...state,
    selectedUids: hidePaintSelection ? new Set() : state.selectedUids,
    selectedUvFaces: hidePaintSelection ? new Set() : state.selectedUvFaces,
    projection: currentProjection(),
    subdivisionEditOwnerUid: subdivisionSession?.ownerUid || null,
    lockedDefaultAlpha: subdivisionSession ? 12 : state.lockedDefaultAlpha,
    lockedHoverFade: subdivisionSession ? false : state.lockedHoverFade,
    editorOverlayLines: buildEditorOverlayLines()
  });
  updateLocatorOverlay();
  updateMirrorGuideOverlay();
  updateTransformGizmo();
  updateAxisWidget();
  updateReferenceImageLayer();
  refreshUvPreview(false);
}

function selectedMirrorGuideGroup() {
  const owner = selected();
  const entries = [...(owner?.modifiers || []), ...(owner?.operators || [])];
  const isSymmetry = entry => ['symmetry', 'paint_symmetry'].includes(entry.type) && entry.enabled;
  const modifier = entries.find(entry => entry.uid === state.selectedModifierUid && isSymmetry(entry))
    || (state.inspectorPage === 'operators' ? owner?.operators?.find(isSymmetry) : null)
    || owner?.modifiers?.find(isSymmetry);
  return modifier?.enabled ? { owner, modifier } : null;
}

function mirrorControllerWorldFrame(owner, modifier) {
  if (!owner || !modifier?.anchor) return null;
  const chain = state.project.getGroupChain(owner.uid);
  const pivot = owner.type === 'group' || owner.type === 'cube' || isShapeElement(owner) ? owner.pivot : owner.origin || owner.position || [0, 0, 0];
  const ownerRotation = owner.rotation || [0, 0, 0];
  const offset = modifier.anchor.position.map((value, axis) => value - pivot[axis]);
  const localOrigin = rotateVector(offset, ownerRotation).map((value, axis) => value + pivot[axis]);
  const rotateDirection = direction => normalize3(applyGroupTransforms(
    rotateVector(rotateVector(direction, modifier.anchor.rotation || [0, 0, 0]), ownerRotation),
    chain.map(parent => ({ pivot: [0, 0, 0], rotation: parent.rotation || [0, 0, 0] }))
  ));
  return {
    origin: applyGroupTransforms(localOrigin, chain),
    axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(rotateDirection)
  };
}

function symmetryModifierAngles(modifier) {
  const count = Math.max(1, Math.min(256, Math.round(Number(modifier.copies) || 1)));
  if (modifier.distribution !== 'range') return Array.from({ length: count }, (_, index) => index * 360 / count);
  const start = Number(modifier.rangeStart) || 0;
  const end = Number(modifier.rangeEnd) || 0;
  if (count === 1) return [start];
  return Array.from({ length: count }, (_, index) => start + (end - start) * index / (count - 1));
}

function mirrorProjectedSegment(start, end) {
  const first = projectViewportPoint(start), second = projectViewportPoint(end);
  if (first.behind || second.behind) return '';
  return `M${first.x.toFixed(1)},${first.y.toFixed(1)}L${second.x.toFixed(1)},${second.y.toFixed(1)}`;
}

function mirrorGridPlaneMarkup(origin, firstAxis, secondAxis, className) {
  const size = 24, step = 4;
  const minor = [], major = [];
  for (let offset = -size; offset <= size + .001; offset += step) {
    const firstStart = addScaled3(addScaled3(origin, firstAxis, -size), secondAxis, offset);
    const firstEnd = addScaled3(addScaled3(origin, firstAxis, size), secondAxis, offset);
    const secondStart = addScaled3(addScaled3(origin, secondAxis, -size), firstAxis, offset);
    const secondEnd = addScaled3(addScaled3(origin, secondAxis, size), firstAxis, offset);
    const target = Math.abs(offset) < .001 || Math.abs(offset % 8) < .001 ? major : minor;
    const firstPath = mirrorProjectedSegment(firstStart, firstEnd);
    const secondPath = mirrorProjectedSegment(secondStart, secondEnd);
    if (firstPath) target.push(firstPath);
    if (secondPath) target.push(secondPath);
  }
  return `<g class="mirror-guide ${className}">
    <path class="mirror-grid-minor" d="${minor.join('')}"/>
    <path class="mirror-grid-major" d="${major.join('')}"/>
  </g>`;
}

function mirrorInfiniteLineMarkup(origin, direction, width, height, className, ray = false) {
  return finiteWorldGuideMarkup(origin, direction, `mirror-guide ${className} ${ray ? 'mirror-ray' : 'mirror-axis-line'}`, ray);
}

function finiteWorldGuideMarkup(origin, direction, className, ray = false) {
  if (!origin || !direction) return '';
  const cameraForward = sceneRenderer.getCameraFrame()?.forward;
  const viewFade = cameraForward ? clamp(Math.hypot(...cross3(normalize3(direction), cameraForward)) * 20, 0, 1) : 1;
  const limit = 2048;
  const positive = [0, ...Array.from({ length: 29 }, (_, index) => .125 * 2 ** (index / 2)), ...Array.from({ length: 13 }, (_, index) => limit * (.7 + index * .025))];
  const distances = [...new Set(positive.filter(value => value <= limit))].sort((a, b) => a - b);
  const samples = ray ? distances : [...distances.slice(1).reverse().map(value => -value), ...distances];
  const projected = samples.map(distance => ({ distance, point: projectViewportPoint(addScaled3(origin, direction, distance)) }));
  const lines = [];
  for (let index = 1; index < projected.length; index++) {
    const first = projected[index - 1], second = projected[index];
    if (first.point.behind || second.point.behind || first.point.depth < -1 || second.point.depth < -1) continue;
    if (!Number.isFinite(first.point.x + first.point.y + second.point.x + second.point.y)) continue;
    if (Math.hypot(second.point.x - first.point.x, second.point.y - first.point.y) < .05) continue;
    const distance = Math.max(Math.abs(first.distance), Math.abs(second.distance));
    const opacity = clamp((limit - distance) / (limit * .3), 0, 1) * viewFade;
    lines.push(`<line class="${className}" style="opacity:${opacity}" x1="${first.point.x}" y1="${first.point.y}" x2="${second.point.x}" y2="${second.point.y}"/>`);
  }
  return lines.join('');
}

function renderMirrorGuide(entry) {
  const overlay = $('#mirrorGuideOverlay');
  const { owner, modifier } = entry;
  const frame = mirrorControllerWorldFrame(owner, modifier);
  if (!frame) { overlay.innerHTML = ''; return false; }
  const rect = sceneCanvas.getBoundingClientRect();
  const width = rect.width, height = rect.height;
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const [xAxis, yAxis, zAxis] = frame.axes;
  const markup = [];
  if (modifier.mode === 'axes') {
    const definitions = [
      ['x', xAxis, yAxis, zAxis],
      ['y', yAxis, zAxis, xAxis],
      ['z', zAxis, xAxis, yAxis]
    ];
    for (const [axisName, normal, first, second] of definitions) {
      if (!modifier.axes[axisName]) continue;
      markup.push(mirrorGridPlaneMarkup(frame.origin, first, second, `axis-${axisName}`));
      markup.push(mirrorInfiniteLineMarkup(frame.origin, normal, width, height, `axis-${axisName}`));
    }
  } else {
    markup.push(mirrorInfiniteLineMarkup(frame.origin, yAxis, width, height, 'radial-axis'));
    const angles = symmetryModifierAngles(modifier);
    for (const degrees of angles) {
      const radians = degrees * Math.PI / 180;
      const radial = normalize3(xAxis.map((value, axis) => value * Math.cos(radians) + zAxis[axis] * Math.sin(radians)));
      markup.push(mirrorGridPlaneMarkup(frame.origin, yAxis, radial, 'radial-plane'));
      markup.push(mirrorInfiniteLineMarkup(frame.origin, radial, width, height, 'radial-ray', true));
    }
  }
  overlay.innerHTML = markup.join('');
  return Boolean(markup.length);
}

function updateMirrorGuideOverlay() {
  const overlay = $('#mirrorGuideOverlay');
  const activeGroup = selectedMirrorGuideGroup();
  if (activeGroup) {
    clearTimeout(mirrorGuideHoldTimer);
    clearTimeout(mirrorGuideHideTimer);
    mirrorGuideHoldTimer = null;
    mirrorGuideHideTimer = null;
    mirrorGuideGroupUid = activeGroup.owner.uid;
    mirrorGuideEntryUid = activeGroup.modifier.uid;
    const visible = renderMirrorGuide(activeGroup);
    overlay.toggleAttribute('hidden', !visible);
    if (visible) requestAnimationFrame(() => overlay.classList.add('visible'));
    return;
  }
  const previousOwner = mirrorGuideGroupUid && state.project.getNode(mirrorGuideGroupUid);
  const previousModifier = [...(previousOwner?.modifiers || []), ...(previousOwner?.operators || [])]
    .find(entry => entry.uid === mirrorGuideEntryUid);
  if (!previousModifier?.enabled) {
    overlay.classList.remove('visible');
    overlay.setAttribute('hidden', '');
    overlay.innerHTML = '';
    mirrorGuideGroupUid = null;
    mirrorGuideEntryUid = null;
    return;
  }
  renderMirrorGuide({ owner: previousOwner, modifier: previousModifier });
  if (mirrorGuideHoldTimer || mirrorGuideHideTimer) return;
  mirrorGuideHoldTimer = setTimeout(() => {
    mirrorGuideHoldTimer = null;
    overlay.classList.remove('visible');
    mirrorGuideHideTimer = setTimeout(() => {
      mirrorGuideHideTimer = null;
      if (selectedMirrorGuideGroup()) return;
      overlay.setAttribute('hidden', '');
      overlay.innerHTML = '';
      mirrorGuideGroupUid = null;
      mirrorGuideEntryUid = null;
    }, 340);
  }, 1500);
}

function updateFaceSelectionOverlay() {
  const overlay = $('#faceSelectionOverlay');
  // Face outlines are kept in one GPU line buffer by the scene renderer.  The
  // old SVG path-per-face overlay forced every selected face through DOM layout
  // and reprojection on every camera frame, which made viewport motion degrade
  // continuously on large selections.
  if (overlay) {
    overlay.replaceChildren();
    overlay.setAttribute('hidden', '');
  }
  uvPreviewRenderDirty = true;
  scheduleSceneRender();
}

function scheduleSceneRender() {
  if (sceneRenderFrame !== null) return;
  sceneRenderFrame = requestAnimationFrame(() => {
    sceneRenderFrame = null;
    renderScene();
  });
}

function renderLockedHoverFrame() {
  sceneRenderer.redrawLockedOverlay({ ...state, editorOverlayLines: buildEditorOverlayLines() });
  updateLocatorHoverOpacity();
}

function updateLocatorOverlay() {
  const overlay = $('#locatorOverlay');
  const selectedElements = state.mode === 'paint' ? new Set() : getSelectionExpansion().elementSet;
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
  const base = subdivisionSession ? .12 : state.lockedDefaultAlpha / 100;
  const hover = state.lockedHoverAlpha / 100;
  if (subdivisionSession || !state.lockedHoverFade || !state.lockedHoverPoint || !screenPoint || state.lockedHoverStrength <= 0) return base;
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

function currentProjection() {
  return state.axisView ? 'orthographic' : state.projection;
}

function captureCameraState() {
  return {
    zoom: state.zoom,
    panX: state.panX,
    panY: state.panY,
    yaw: state.yaw,
    pitch: state.pitch,
    target: [...state.target]
  };
}

function applyCameraState(camera) {
  if (!camera) return;
  state.zoom = Number(camera.zoom) || 1;
  state.panX = Number(camera.panX) || 0;
  state.panY = Number(camera.panY) || 0;
  state.yaw = Number(camera.yaw) || 0;
  state.pitch = Number(camera.pitch) || 0;
  state.target = Array.isArray(camera.target) ? [...camera.target] : [0, 0, 0];
}

function axisViewOrientation(axis, sign = 1) {
  if (axis === 'x') return { yaw: sign > 0 ? Math.PI / 2 : -Math.PI / 2, pitch: 0 };
  if (axis === 'y') return { yaw: 0, pitch: sign > 0 ? Math.PI / 2 - .001 : -Math.PI / 2 + .001 };
  return { yaw: sign > 0 ? 0 : Math.PI, pitch: 0 };
}

function updateProjectionControls() {
  const projection = currentProjection();
  $$('[data-projection]').forEach(button => {
    button.classList.toggle('active', button.dataset.projection === projection);
    button.disabled = Boolean(state.axisView);
    button.title = state.axisView ? '三軸視圖固定使用正交投影' : '';
  });
}

function enterAxisView(axis, sign = 1) {
  if (!['x', 'y', 'z'].includes(axis)) return;
  cancelCameraFocus();
  bakeCameraPan();
  const previousAxis = state.axisView;
  if (!previousAxis) state.generalCamera = captureCameraState();
  else state.axisViewCameras[previousAxis] = captureCameraState();
  if (previousAxis === axis) {
    state.axisViewSign *= -1;
  } else {
    const general = state.generalCamera || captureCameraState();
    const saved = state.axisViewCameras[axis];
    applyCameraState(saved || {
      ...general,
      zoom: mapProjectionZoom(general.zoom, state.projection, 'orthographic'),
      panX: 0,
      panY: 0,
      target: [...general.target]
    });
    state.axisView = axis;
    state.axisViewSign = sign < 0 ? -1 : 1;
  }
  const orientation = axisViewOrientation(axis, state.axisViewSign);
  state.yaw = orientation.yaw;
  state.pitch = orientation.pitch;
  updateProjectionControls();
  setReferenceImageEditing(false);
  renderScene();
}

function exitAxisView({ render = true } = {}) {
  if (!state.axisView) return false;
  state.axisViewCameras[state.axisView] = captureCameraState();
  applyCameraState(state.generalCamera || captureCameraState());
  state.axisView = null;
  state.axisViewSign = 1;
  state.generalCamera = null;
  updateProjectionControls();
  setReferenceImageEditing(false);
  if (render) renderScene();
  return true;
}

function referenceViewKey() {
  return state.axisView || 'general';
}

function referenceImageStore() {
  state.project.referenceImages ||= { general: [], x: [], y: [], z: [] };
  for (const key of ['general', 'x', 'y', 'z']) {
    const stored = state.project.referenceImages[key];
    const records = Array.isArray(stored) ? stored : stored ? [stored] : [];
    for (const record of records) record.uid ||= `reference_${crypto.randomUUID().slice(0, 8)}`;
    state.project.referenceImages[key] = records;
  }
  return state.project.referenceImages;
}

function referenceImagesForView(key = referenceViewKey()) {
  return referenceImageStore()[key];
}

function currentReferenceImage(key = referenceViewKey()) {
  const records = referenceImagesForView(key);
  if (!records.length) {
    state.referenceImageSelection[key] = null;
    return null;
  }
  let record = records.find(entry => entry.uid === state.referenceImageSelection[key]);
  if (!record) {
    record = records.at(-1);
    state.referenceImageSelection[key] = record.uid;
  }
  return record;
}

function axisReferenceBasis(axis) {
  if (axis === 'x') return { horizontal: [0, 0, -1], vertical: [0, 1, 0] };
  if (axis === 'y') return { horizontal: [1, 0, 0], vertical: [0, 0, -1] };
  return { horizontal: [1, 0, 0], vertical: [0, 1, 0] };
}

function referenceDefaultScale(record, key = referenceViewKey()) {
  if (key !== 'general') return 16 / Math.max(1, record.naturalWidth, record.naturalHeight);
  const width = Math.max(1, viewport.clientWidth * .68);
  const height = Math.max(1, viewport.clientHeight * .68);
  return Math.min(width / record.naturalWidth, height / record.naturalHeight);
}

function updateReferenceImageControls() {
  const key = referenceViewKey();
  const records = referenceImagesForView(key);
  const record = currentReferenceImage(key);
  const labels = { general: '一般視圖參考圖', x: 'X 軸視圖參考圖', y: 'Y 軸視圖參考圖', z: 'Z 軸視圖參考圖' };
  $('#referenceImageViewLabel').textContent = labels[key];
  $('#referenceImageName').textContent = record ? `${record.name} · ${records.indexOf(record) + 1}/${records.length}` : '尚未導入';
  $('#referenceImageList').innerHTML = records.length
    ? records.map((entry, index) => `<button type="button" class="reference-image-entry ${entry === record ? 'active' : ''}" data-reference-select="${escapeHtml(entry.uid)}" title="${escapeHtml(entry.name)}"><span>${index + 1}</span><b>${escapeHtml(entry.name)}</b></button>`).join('')
    : '<small class="reference-image-empty">這個視圖還沒有參考圖</small>';
  const control = $('[data-action="referenceImage"]');
  control.classList.toggle('active', records.length > 0);
  control.classList.toggle('editing', referenceImageEditing && Boolean(record));
  $$('[data-reference-action="edit"], [data-reference-action="reset"], [data-reference-action="remove"]')
    .forEach(button => { button.disabled = !record; });
  const editButton = $('[data-reference-action="edit"]');
  if (editButton) editButton.textContent = referenceImageEditing ? '結束調整' : '調整位置與尺寸';
}

function applyReferenceImageTransform(element, record, key) {
  if (key === 'general') {
    const scale = record.scale;
    const x = viewport.clientWidth / 2 + record.offset[0] - record.naturalWidth * scale / 2;
    const y = viewport.clientHeight / 2 + record.offset[1] - record.naturalHeight * scale / 2;
    element.style.transform = `matrix(${scale},0,0,${scale},${x},${y})`;
    return;
  }
  const basis = axisReferenceBasis(key);
  const origin = [0, 0, 0];
  const centerWorld = origin.map((value, index) => value
    + basis.horizontal[index] * record.offset[0]
    + basis.vertical[index] * record.offset[1]);
  const center = sceneRenderer.projectPoint(centerWorld);
  const horizontal = sceneRenderer.projectPoint(basis.horizontal);
  const vertical = sceneRenderer.projectPoint(basis.vertical);
  const base = sceneRenderer.projectPoint(origin);
  const a = (horizontal.x - base.x) * record.scale;
  const b = (horizontal.y - base.y) * record.scale;
  const c = -(vertical.x - base.x) * record.scale;
  const d = -(vertical.y - base.y) * record.scale;
  const x = center.x - a * record.naturalWidth / 2 - c * record.naturalHeight / 2;
  const y = center.y - b * record.naturalWidth / 2 - d * record.naturalHeight / 2;
  element.style.transform = `matrix(${a},${b},${c},${d},${x},${y})`;
}

function updateReferenceImageLayer() {
  const key = referenceViewKey();
  const records = referenceImagesForView(key);
  const selected = currentReferenceImage(key);
  if (!records.length) {
    referenceImageLayer.hidden = true;
    referenceImageLayer.querySelectorAll('img').forEach(image => image.remove());
    updateReferenceImageControls();
    return;
  }
  referenceImageLayer.hidden = false;
  referenceImageLayer.classList.toggle('editing', referenceImageEditing && Boolean(selected));
  const existing = new Map([...referenceImageLayer.querySelectorAll('img')].map(image => [image.dataset.referenceUid, image]));
  for (const record of records) {
    let image = existing.get(record.uid);
    if (!image) {
      image = document.createElement('img');
      image.dataset.referenceUid = record.uid;
      image.alt = record.name;
      image.draggable = false;
      referenceImageLayer.insertBefore(image, referenceImageHint);
    }
    existing.delete(record.uid);
    if (image.getAttribute('src') !== record.source) image.src = record.source;
    image.width = record.naturalWidth;
    image.height = record.naturalHeight;
    image.classList.toggle('selected', record === selected);
    applyReferenceImageTransform(image, record, key);
  }
  existing.forEach(image => image.remove());
  updateReferenceImageControls();
}

function setReferenceImageEditing(value) {
  referenceImageEditing = Boolean(value && currentReferenceImage());
  referenceImageDrag = null;
  referenceImageLayer.classList.remove('dragging');
  updateReferenceImageLayer();
}

function setReferenceImageMenu(open) {
  $('#referenceImageMenu').hidden = !open;
  $('[data-action="referenceImage"]').setAttribute('aria-expanded', String(open));
  if (open) updateReferenceImageControls();
}

function beginReferenceImageImport() {
  referenceImportViewKey = referenceViewKey();
  referenceImageInput.value = '';
  referenceImageInput.click();
  setReferenceImageMenu(false);
}

function resetReferenceImage() {
  const record = currentReferenceImage();
  if (!record) return;
  snapshot('core.reference.reset');
  record.offset = [0, 0];
  record.scale = referenceDefaultScale(record);
  markDirty();
  updateReferenceImageLayer();
}

function removeReferenceImage() {
  const key = referenceViewKey();
  const records = referenceImagesForView(key);
  const record = currentReferenceImage(key);
  if (!record) return;
  snapshot('core.reference.remove');
  const index = records.indexOf(record);
  records.splice(index, 1);
  const next = records[Math.min(index, records.length - 1)] || null;
  state.referenceImageSelection[key] = next?.uid || null;
  if (!next) referenceImageEditing = false;
  markDirty();
  updateReferenceImageLayer();
}

function readReferenceImageFile(file, key) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const record = {
          uid: `reference_${crypto.randomUUID().slice(0, 8)}`,
          name: file.name || 'reference.png',
          source: String(reader.result),
          naturalWidth: Math.max(1, image.naturalWidth || image.width),
          naturalHeight: Math.max(1, image.naturalHeight || image.height),
          offset: [0, 0],
          scale: 1
        };
        record.scale = referenceDefaultScale(record, key);
        resolve(record);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

async function loadReferenceImageFiles(files, key) {
  if (!['general', 'x', 'y', 'z'].includes(key)) return;
  const candidates = [...(files || [])];
  if (!candidates.length) return;
  const settled = await Promise.allSettled(candidates.map(file => readReferenceImageFile(file, key)));
  const records = settled.filter(result => result.status === 'fulfilled').map(result => result.value);
  if (!records.length) return toast('無法讀取這些參考圖');
  snapshot('core.reference.add');
  referenceImagesForView(key).push(...records);
  state.referenceImageSelection[key] = records.at(-1).uid;
  referenceImageEditing = key === referenceViewKey();
  markDirty();
  updateReferenceImageLayer();
  if (settled.some(result => result.status === 'rejected')) toast(`已導入 ${records.length} 張參考圖，部分檔案無法讀取`);
  else toast(`已導入${key === 'general' ? '一般視圖' : key.toUpperCase() + ' 軸視圖'}參考圖 · ${records.length} 張`);
}

function updatePlayerReferenceTexture(setting = configRegistry.get(ConfigKey.PLAYER_REFERENCE_TEXTURE)) {
  const customSource = typeof setting?.source === 'string' ? setting.source : '';
  const source = customSource || DEFAULT_PLAYER_REFERENCE_TEXTURE;
  const name = customSource ? (setting.name || '自定義玩家紋理') : '內置玩家紋理';
  const preview = $('#playerReferenceTexturePreview');
  const label = $('#playerReferenceTextureName');
  if (preview) preview.src = source;
  if (label) label.textContent = name;
  const revision = ++playerReferenceTextureRevision;
  const image = new Image();
  image.onload = () => {
    if (revision !== playerReferenceTextureRevision) return;
    sceneRenderer.setPlayerReference(playerReferenceProject, image);
    renderScene();
  };
  image.onerror = () => {
    if (revision !== playerReferenceTextureRevision) return;
    if (!customSource) return toast('無法讀取內置玩家紋理');
    toast('無法讀取自定義玩家紋理，已回退內置紋理');
    updatePlayerReferenceTexture({ name: '內置玩家紋理', source: '' });
  };
  image.src = source;
}

function importPlayerReferenceTexture(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => toast('無法讀取這張玩家紋理');
  reader.onload = () => {
    const image = new Image();
    image.onerror = () => toast('這個檔案不是可用的 PNG 玩家紋理');
    image.onload = () => {
      if (image.naturalWidth !== image.naturalHeight || image.naturalWidth < 64) {
        toast('玩家紋理必須是至少 64×64 的正方形圖片');
        return;
      }
      configRegistry.set(ConfigKey.PLAYER_REFERENCE_TEXTURE, {
        name: file.name || '自定義玩家紋理.png',
        source: String(reader.result)
      }, { source: 'player-reference-settings' });
      toast(`玩家參考紋理：${file.name || '已導入'}`);
    };
    image.src = String(reader.result);
  };
  reader.readAsDataURL(file);
}

function referenceDragBasis() {
  if (!state.axisView) return null;
  const basis = axisReferenceBasis(state.axisView);
  const origin = sceneRenderer.projectPoint([0, 0, 0]);
  const horizontal = sceneRenderer.projectPoint(basis.horizontal);
  const vertical = sceneRenderer.projectPoint(basis.vertical);
  return {
    horizontal: [horizontal.x - origin.x, horizontal.y - origin.y],
    vertical: [vertical.x - origin.x, vertical.y - origin.y]
  };
}

function beginReferenceImageDrag(event) {
  if (!referenceImageEditing || !currentReferenceImage() || ![0, 1].includes(event.button)) return;
  event.preventDefault();
  event.stopPropagation();
  referenceImageLayer.setPointerCapture(event.pointerId);
  const record = currentReferenceImage();
  referenceImageDrag = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    offset: [...record.offset],
    uid: record.uid,
    key: referenceViewKey(),
    basis: referenceDragBasis(),
    snapshotTaken: false
  };
  referenceImageLayer.classList.add('dragging');
}

function moveReferenceImageDrag(event) {
  const drag = referenceImageDrag;
  if (!drag || drag.pointerId !== event.pointerId || drag.key !== referenceViewKey()) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.snapshotTaken && Math.hypot(dx, dy) < .5) return;
  if (!drag.snapshotTaken) {
    snapshot('core.reference.move');
    drag.snapshotTaken = true;
  }
  const record = currentReferenceImage();
  if (!record || record.uid !== drag.uid) return;
  if (!drag.basis) {
    record.offset = [drag.offset[0] + dx, drag.offset[1] + dy];
  } else {
    const [hx, hy] = drag.basis.horizontal;
    const [vx, vy] = drag.basis.vertical;
    const determinant = hx * vy - hy * vx;
    if (Math.abs(determinant) < .000001) return;
    const horizontalDelta = (dx * vy - dy * vx) / determinant;
    const verticalDelta = (hx * dy - hy * dx) / determinant;
    record.offset = [drag.offset[0] + horizontalDelta, drag.offset[1] + verticalDelta];
  }
  markDirty();
  updateReferenceImageLayer();
}

function endReferenceImageDrag(event) {
  if (!referenceImageDrag || referenceImageDrag.pointerId !== event.pointerId) return;
  if (referenceImageLayer.hasPointerCapture?.(event.pointerId)) referenceImageLayer.releasePointerCapture(event.pointerId);
  referenceImageDrag = null;
  referenceImageLayer.classList.remove('dragging');
}

function scaleReferenceImage(event) {
  if (!referenceImageEditing) return;
  const record = currentReferenceImage();
  if (!record) return;
  event.preventDefault();
  snapshot('core.reference.scale');
  const factor = event.deltaY > 0 ? .9 : 1.1;
  record.scale = Math.max(.00001, Math.min(100, record.scale * factor));
  markDirty();
  updateReferenceImageLayer();
}

function updateAxisWidget() {
  const frame = sceneRenderer.getCameraFrame();
  if (!frame) return;
  const { forward, right, up } = frame;
  const axes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  const widget = $('.axis-widget');
  const endpoints = $$('[data-view-axis]', widget).map(button => {
    const name = button.dataset.viewAxis;
    const sign = Number(button.dataset.axisSign) < 0 ? -1 : 1;
    const axis = axes[name].map(value => value * sign);
    const x = 33 + dot3(axis, right) * 22;
    const y = 33 - dot3(axis, up) * 22;
    const depth = dot3(axis, forward);
    return { button, name, sign, x, y, depth };
  }).sort((first, second) => second.depth - first.depth);
  // Camera-forward depth increases away from the viewer. Draw the far end
  // first, including pointer hit testing when the projected circles overlap.
  for (let index = 0; index < endpoints.length; index++) {
    const { button, name, sign, x, y, depth } = endpoints[index];
    const line = $(`[data-axis-line="${name}"][data-axis-sign="${sign}"]`, widget);
    line.setAttribute('x2', x); line.setAttribute('y2', y);
    line.style.opacity = String(.65 - depth * .25);
    line.parentNode.appendChild(line);
    button.style.left = `${x}px`; button.style.top = `${y}px`;
    button.style.zIndex = String(index + 1);
    button.style.setProperty('--axis-tone', `color-mix(in srgb, var(--axis-color) ${Math.round(75 - depth * 25)}%, var(--panel))`);
    const active = state.axisView === name && state.axisViewSign === sign;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  $('#viewHint').innerHTML = state.axisView
    ? '<kbd>中鍵</kbd> 平移 <kbd>Shift + 中鍵</kbd> 平移 <kbd>滾輪</kbd> 縮放 <kbd>拖動輪盤</kbd> 一般視圖'
    : '<kbd>中鍵</kbd> 旋轉 <kbd>Shift + 中鍵</kbd> 平移 <kbd>滾輪</kbd> 縮放 <kbd>R</kbd> 聚焦 <kbd>Shift+R</kbd> 中心';
  updateProjectionControls();
}

function beginAxisWidgetDrag(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  cancelCameraFocus();
  const widget = event.currentTarget;
  widget.setPointerCapture(event.pointerId);
  axisWidgetDrag = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    moved: false,
    sourceAxis: event.target.closest('[data-view-axis]')?.dataset.viewAxis || null,
    sourceSign: Number(event.target.closest('[data-view-axis]')?.dataset.axisSign) < 0 ? -1 : 1,
    yaw: state.yaw,
    pitch: state.pitch
  };
}

function moveAxisWidgetDrag(event) {
  const drag = axisWidgetDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 3) return;
  if (!drag.moved) {
    drag.moved = true;
    if (state.axisView) {
      exitAxisView({ render: false });
      drag.yaw = state.yaw;
      drag.pitch = state.pitch;
    }
    $('.axis-widget').classList.add('dragging');
    sceneCanvas.classList.add('is-orbiting');
  }
  const fullTurn = Math.PI * 2;
  state.yaw = ((drag.yaw - dx * .01) % fullTurn + fullTurn) % fullTurn;
  state.pitch = Math.max(-Math.PI / 2 + .001, Math.min(Math.PI / 2 - .001, drag.pitch + dy * .01));
  renderScene();
}

function endAxisWidgetDrag(event) {
  if (!axisWidgetDrag || axisWidgetDrag.pointerId !== event.pointerId) return;
  const moved = axisWidgetDrag.moved;
  const sourceAxis = axisWidgetDrag.sourceAxis;
  const sourceSign = axisWidgetDrag.sourceSign;
  const widget = event.currentTarget;
  if (widget.hasPointerCapture?.(event.pointerId)) widget.releasePointerCapture(event.pointerId);
  axisWidgetDrag = null;
  widget.classList.remove('dragging');
  sceneCanvas.classList.remove('is-orbiting');
  if (moved || sourceAxis) {
    suppressAxisWidgetClick = true;
    setTimeout(() => { suppressAxisWidgetClick = false; }, 0);
  }
  if (event.type !== 'pointercancel' && !moved && sourceAxis) enterAxisView(sourceAxis, sourceSign);
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
  const owner = subdivisionOwner(item);
  if (owner) {
    const ownerPivot = (owner.pivot || owner.origin).map((value, axis) => value - owner.origin[axis]);
    const localPoint = item.pivot || [0, 0, 0];
    const parentPoint = rotateVector(localPoint.map((value, axis) => value - ownerPivot[axis]), owner.rotation || [0, 0, 0])
      .map((value, axis) => value + ownerPivot[axis] + owner.origin[axis]);
    return applyGroupTransforms(parentPoint, state.project.getGroupChain(owner.uid));
  }
  const local = item.type === 'cube' || item.type === 'group' || isShapeElement(item) ? item.pivot : item.position || item.origin;
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
  if (selectionTransformContextCache?.project === state.project
    && selectionTransformContextCache.selection === state.selectedUids
    && selectionTransformContextCache.size === state.selectedUids.size
    && selectionTransformContextCache.hierarchyRevision === state.project.hierarchyRevision) {
    return selectionTransformContextCache.context;
  }
  const nodes = selectedTopLevelNodes();
  const multiple = nodes.length > 1;
  const commonGroup = multiple ? deepestCommonSelectionGroup() : null;
  const center = multiple ? selectionGeometryCenter() : null;
  const context = {
    nodes,
    multiple,
    commonGroup,
    center,
    pivot: multiple ? (commonGroup ? getTransformPivot(commonGroup) : center) : null
  };
  selectionTransformContextCache = {
    project: state.project,
    selection: state.selectedUids,
    size: state.selectedUids.size,
    hierarchyRevision: state.project.hierarchyRevision,
    context
  };
  return context;
}

function getTransformAxes(item) {
  const owner = subdivisionOwner(item);
  const chain = state.project.getGroupChain(owner?.uid || item.uid);
  const parentRotation = vector => applyGroupTransforms(vector, chain.map(group => ({ pivot: [0, 0, 0], rotation: group.rotation })));
  return [0, 1, 2].map(axis => {
    const unit = [0, 0, 0]; unit[axis] = 1;
    let direction = state.transformSpace === 'global' ? unit
      : parentRotation(owner ? rotateVector(unit, owner.rotation || [0, 0, 0]) : unit);
    if (state.transformSpace === 'self' || (state.tool === 'resize' && item.type !== 'group')) {
      const rotation = item.rotation || [0, 0, 0];
      if (state.tool === 'rotate' && state.rotationMode === 'euler') {
        // The renderer uses Rz * Ry * Rx. Its Euler gimbal therefore has a
        // fixed Z axis, Y follows Z, and X follows Z then Y. Rotations later
        // in the Z -> Y -> X hierarchy never move an earlier axis.
        const stagedRotation = axis === 0 ? [0, rotation[1], rotation[2]]
          : axis === 1 ? [0, 0, rotation[2]]
          : [0, 0, 0];
        const localDirection = rotateVector(unit, stagedRotation);
        direction = parentRotation(owner ? rotateVector(localDirection, owner.rotation || [0, 0, 0]) : localDirection);
      } else {
        const localDirection = rotateVector(unit, rotation);
        direction = parentRotation(owner ? rotateVector(localDirection, owner.rotation || [0, 0, 0]) : localDirection);
      }
    }
    return normalize3(direction);
  });
}

function getSelectionTransformAxes(context, fallbackItem) {
  if (state.tool === 'resize') {
    const elements = selectedElementUids().map(uidValue => state.project.getNode(uidValue))
      .filter(node => node?.type === 'cube' || isShapeElement(node));
    if (elements.length) {
      const frames = elements.map(getTransformAxes);
      const first = frames[0];
      const mean = [0, 1, 2].map(axis => frames.reduce((sum, frame) => sum.map((value, component) => value + frame[axis][component]), [0, 0, 0]));
      const x = Math.hypot(...mean[0]) > 1e-6 ? normalize3(mean[0]) : first[0];
      const projectedY = mean[1].map((value, component) => value - x[component] * dot3(mean[1], x));
      let y = Math.hypot(...projectedY) > 1e-6 ? normalize3(projectedY) : normalize3(cross3(first[2], x));
      if (Math.hypot(...y) < 1e-6) y = normalize3(cross3(Math.abs(x[1]) < .9 ? [0, 1, 0] : [0, 0, 1], x));
      let z = normalize3(cross3(x, y));
      if (dot3(z, mean[2]) < 0) { y = y.map(value => -value); z = z.map(value => -value); }
      return [x, y, z];
    }
  }
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

function activeModifierAnchorContext() {
  const owner = selected();
  const modifier = [...(owner?.modifiers || []), ...(owner?.operators || [])].find(entry => entry.uid === state.selectedModifierUid);
  return modifier?.enabled && ['symmetry', 'paint_symmetry'].includes(modifier.type) ? { owner, modifier } : null;
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

function setCurveHandle(node, property, value, planar = false) {
  const handle = value.map(component => Number(component) || 0);
  if (planar) handle[1] = 0;
  node[property] = handle;
  if (node.symmetricHandles) {
    const opposite = property === 'handleIn' ? 'handleOut' : 'handleIn';
    node[opposite] = handle.map(component => -component);
  }
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

function getModifierAnchorTransformAxes(context) {
  const units = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (state.transformSpace === 'global') return units;
  const owner = context.owner;
  const chain = [...state.project.getGroupChain(owner.uid), {
    pivot: [0, 0, 0],
    rotation: owner.rotation || [0, 0, 0]
  }];
  const rotationChain = chain.map(entry => ({ pivot: [0, 0, 0], rotation: entry.rotation || [0, 0, 0] }));
  const transformDirection = direction => normalize3(applyGroupTransforms(direction, rotationChain));
  const parentAxes = units.map(transformDirection);
  if (state.transformSpace !== 'self') return parentAxes;
  return units.map(unit => transformDirection(rotateVector(unit, context.modifier.anchor.rotation || [0, 0, 0])));
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

function modifierAnchorMarkerMarkup(entry, active = false) {
  const frame = mirrorControllerWorldFrame(entry.owner, entry.modifier);
  if (!frame) return '';
  const point = projectViewportPoint(frame.origin);
  if (point.behind || point.depth < -1 || point.depth > 1) return '';
  const radius = active ? 11 : 9;
  return `<g class="${active ? '' : 'gizmo-control '}modifier-anchor-marker ${active ? 'active' : ''}" ${active ? '' : `data-kind="modifier-anchor" data-modifier-uid="${entry.modifier.uid}" ${gizmoDepthAttributes('point', [point], 'center')}`}>
    ${active ? '' : `<circle class="gizmo-hit-point" cx="${point.x}" cy="${point.y}" r="18"/>`}
    <path class="gizmo-visible modifier-anchor-ring" d="M${point.x},${point.y - radius} L${point.x + radius},${point.y} L${point.x},${point.y + radius} L${point.x - radius},${point.y} Z"/>
    <path class="gizmo-visible modifier-anchor-axis" d="M${point.x - 14},${point.y} H${point.x + 14} M${point.x},${point.y - 14} V${point.y + 14}"/>
    <circle class="gizmo-visible modifier-anchor-core" cx="${point.x}" cy="${point.y}" r="3.4"/>
  </g>`;
}

function curveEditorOverlayMarkup(curve) {
  if (!isBezierElement(curve)) return '';
  const nodes = sceneRenderer.getCurveNodeWorldPoints(state.project, curve.uid);
  const handles = sceneRenderer.getCurveHandleWorldPoints(state.project, curve.uid, null);
  const nodeMarkup = nodes.map(entry => {
    const point = projectViewportPoint(entry.point);
    if (point.behind || point.depth < -1 || point.depth > 1) return '';
    const active = entry.index === state.selectedCurveNodeIndex ? ' active' : '';
    return `<g class="curve-node-marker${active}" aria-label="曲線節點">
      <path class="curve-node-marker-cross" d="M${point.x - 12},${point.y} H${point.x + 12} M${point.x},${point.y - 12} V${point.y + 12}"/>
      <path class="curve-node-marker-ring" d="M${point.x},${point.y - 8} L${point.x + 8},${point.y} L${point.x},${point.y + 8} L${point.x - 8},${point.y} Z"/>
      <circle class="curve-node-marker-core" cx="${point.x}" cy="${point.y}" r="2.8"/>
    </g>`;
  }).join('');
  const handleMarkup = handles.map(entry => {
    const point = projectViewportPoint(entry.point);
    if (point.behind || point.depth < -1 || point.depth > 1) return '';
    const radius = 5.5;
    return `<path class="curve-handle-head" aria-label="貝塞爾手柄" d="M${point.x},${point.y - radius} L${point.x + radius},${point.y} L${point.x},${point.y + radius} L${point.x - radius},${point.y} Z"/>`;
  }).join('');
  return `<g class="curve-editor-overlay">${nodeMarkup}${handleMarkup}</g>`;
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
  return finiteWorldGuideMarkup(state.gizmoOrigin, handle.vector, `drag-infinite-line ${axisClass}`);
}

function renderVertexSnapGizmo(gizmo, width, height) {
  const item = selected();
  const points = [];
  const generatedSourceUids = item.type === 'group'
    ? state.project.getDescendantElementUids(item.uid) : [item.uid];
  for (const vertex of [...sceneRenderer.getWorldVertices(state.project, item.uid),
    ...generatedSourceUids.flatMap(uidValue => sceneRenderer.getGeneratedWorldVertices(uidValue))]) {
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
  if (state.vertexSnapMode === 'move' && (['cube', 'group'].includes(item.type) || isShapeElement(item))) {
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
    const classes = ['gizmo-control', 'vertex-snap-control', 'source-candidate', entry.generated ? 'generated-reference' : '', sourceActive ? 'source-active' : ''].filter(Boolean).join(' ');
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
  if (state.mode === 'paint') {
    state.gizmoAxes = null; state.gizmoCenter = null; state.gizmoOrigin = null;
    gizmo.setAttribute('hidden', '');
    gizmo.innerHTML = '';
    return;
  }
  const item = selected();
  const rect = sceneCanvas.getBoundingClientRect();
  const width = rect.width, height = rect.height;
  const curveOverlay = curveEditorOverlayMarkup(item);
  const symmetryEntry = selectedMirrorGuideGroup();
  const modifierAnchorContext = activeModifierAnchorContext();
  const modifierAnchorMarker = symmetryEntry
    ? modifierAnchorMarkerMarkup(symmetryEntry, modifierAnchorContext?.modifier.uid === symmetryEntry.modifier.uid)
    : '';
  const editorOverlay = curveOverlay + modifierAnchorMarker;
  if (!item || isEffectivelyLocked(item.uid) || !['move', 'resize', 'rotate', 'pivot', 'vertexSnap'].includes(state.tool)) {
    state.gizmoAxes = null; state.gizmoCenter = null; state.gizmoOrigin = null;
    if (editorOverlay && item && !isEffectivelyLocked(item.uid)) {
      gizmo.setAttribute('viewBox', `0 0 ${width} ${height}`);
      gizmo.innerHTML = editorOverlay;
      gizmo.removeAttribute('hidden');
    } else { gizmo.setAttribute('hidden', ''); gizmo.innerHTML = ''; }
    return;
  }
  const curveNodeContext = activeCurveNodeContext();
  const selectionContext = getSelectionTransformContext();
  if (state.tool === 'resize' && (modifierAnchorContext || curveNodeContext || (!selectionContext.multiple && !['cube', 'group'].includes(item.type) && !isShapeElement(item)))) {
    state.gizmoAxes = null; state.gizmoCenter = null; state.gizmoOrigin = null;
    if (editorOverlay) {
      gizmo.setAttribute('viewBox', `0 0 ${width} ${height}`);
      gizmo.innerHTML = editorOverlay;
      gizmo.removeAttribute('hidden');
    } else { gizmo.setAttribute('hidden', ''); gizmo.innerHTML = ''; }
    return;
  }
  if (state.tool === 'vertexSnap') {
    renderVertexSnapGizmo(gizmo, width, height);
    gizmo.insertAdjacentHTML('beforeend', editorOverlay);
    return;
  }
  if (state.tool === 'pivot' && selectionContext.multiple && !selectionContext.commonGroup) {
    gizmo.setAttribute('hidden', ''); gizmo.innerHTML = ''; return;
  }
  const transformItem = state.tool === 'pivot' && selectionContext.multiple ? selectionContext.commonGroup : item;
  if (state.tool === 'pivot' && !modifierAnchorContext && !curveNodeContext
    && !['cube', 'group', 'node'].includes(transformItem?.type) && !isShapeElement(transformItem)) {
    gizmo.setAttribute('hidden', ''); gizmo.innerHTML = ''; return;
  }
  const modifierFrame = modifierAnchorContext
    ? mirrorControllerWorldFrame(modifierAnchorContext.owner, modifierAnchorContext.modifier)
    : null;
  const pivot = modifierFrame?.origin || (curveNodeContext
    ? sceneRenderer.getCurveNodeWorldPoints(state.project, item.uid)[curveNodeContext.index]?.point
    : selectionContext.multiple ? selectionContext.pivot : getTransformPivot(item));
  const geometryCenter = modifierAnchorContext || curveNodeContext ? pivot : selectionContext.multiple
    ? selectionContext.center || pivot
    : sceneRenderer.getSelectionBounds(state.project, state.selectedUids)?.center
      || sceneRenderer.getGeometryCenter(state.project, item.uid)
      || pivot;
  const gizmoOrigin = modifierAnchorContext || curveNodeContext || item.type === 'node' || ['rotate', 'pivot'].includes(state.tool) ? pivot : geometryCenter;
  const center = projectViewportPoint(gizmoOrigin);
  state.gizmoCenter = { x: center.x, y: center.y };
  state.gizmoOrigin = [...gizmoOrigin];
  const axes = modifierAnchorContext ? getModifierAnchorTransformAxes(modifierAnchorContext)
    : curveNodeContext ? getCurveNodeTransformAxes(curveNodeContext)
      : getSelectionTransformAxes(selectionContext, item);
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
      if (selectionContext.multiple || item.type === 'group') {
        extent = sceneRenderer.getSelectionProjectionExtent(state.project, state.selectedUids, gizmoOrigin, axis) ?? 0;
      } else extent = item.type === 'cube'
        ? Math.abs(item.size[index]) / 2
        : item.shapeType !== 'polygon_prism' || index !== 1
          ? Math.abs(item.parameters.radius)
          : Math.abs(item.parameters.height) / 2;
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
  gizmo.insertAdjacentHTML('beforeend', editorOverlay);
  gizmo.removeAttribute('hidden');
}

function updateTexturePreviewFrame(width, height) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  texturePreviewSize = [safeWidth, safeHeight];
  const preview = $('#texturePreview');
  preview.style.setProperty('--texture-aspect', `${safeWidth} / ${safeHeight}`);
  $('.texture-preview > span').textContent = `${safeWidth} × ${safeHeight}`;
  syncTexturePreviewPriority();
  updateTextureStageTransform();
}

function uvFaceKey(uidValue, faceName) {
  return `${uidValue}::${faceName}`;
}

function parseUvFaceKey(key) {
  const separator = key.lastIndexOf('::');
  return separator < 0 ? null : { uid: key.slice(0, separator), faceName: key.slice(separator + 2) };
}

function textureUvEntries() {
  const expansion = getSelectionExpansion();
  if (textureUvEntryCache?.project === state.project
    && textureUvEntryCache.selection === state.selectedUids
    && textureUvEntryCache.selectionSize === state.selectedUids.size
    && textureUvEntryCache.activeTextureUid === state.activeTextureUid
    && textureUvEntryCache.hierarchyRevision === state.project.hierarchyRevision) return textureUvEntryCache.entries;
  const entries = [];
  const activeAsset = activeTextureAsset();
  const activeReferences = activeAsset
    ? new Set(textureAtlasReferences(activeAsset, state.textureAssets.indexOf(activeAsset))
      .flatMap(reference => [reference, reference.startsWith('#') ? reference.slice(1) : `#${reference}`]))
    : null;
  for (const uidValue of expansion.elementUids) {
    const cube = state.project.getNode(uidValue);
    if (cube?.type !== 'cube') continue;
    for (const faceName of CUBE_FACE_NAMES) {
      const face = cube.faces?.[faceName];
      if (isFaceTiled(face)) continue;
      const textureReference = effectiveFaceTextureReference(face);
      if (activeReferences && !activeReferences.has(String(textureReference))) continue;
      let uv = Array.isArray(face?.uv) && face.uv.length >= 4
        ? face.uv.map(Number)
        : getBlockbenchBoxUv(cube, faceName).map(Number);
      if (!uv.every(Number.isFinite)) uv = getBlockbenchBoxUv(cube, faceName).map(Number);
      entries.push({ key: uvFaceKey(cube.uid, faceName), uid: cube.uid, cube, faceName, face, uv, culled: isCubeFaceCulled(face) });
    }
  }
  const byKey = new Map(entries.map(entry => [entry.key, entry]));
  const faceCounts = new Map(CUBE_FACE_NAMES.map(faceName => [faceName, 0]));
  entries.forEach(entry => faceCounts.set(entry.faceName, (faceCounts.get(entry.faceName) || 0) + 1));
  textureUvEntryCache = {
    project: state.project,
    selection: state.selectedUids,
    selectionSize: state.selectedUids.size,
    activeTextureUid: state.activeTextureUid,
    hierarchyRevision: state.project.hierarchyRevision,
    entries,
    byKey,
    faceCounts
  };
  return entries;
}

function selectedTextureUvEntries(entries = textureUvEntries()) {
  const byKey = textureUvEntryCache?.entries === entries
    ? textureUvEntryCache.byKey
    : new Map(entries.map(entry => [entry.key, entry]));
  const selected = [];
  const retainedTileKeys = [];
  let removedInvalid = false;
  for (const key of state.selectedUvFaces) {
    const entry = byKey.get(key);
    if (entry) selected.push(entry);
    else {
      const parsed = parseUvFaceKey(key);
      if (parsed && isFaceTiled(state.project.getNode(parsed.uid)?.faces?.[parsed.faceName])) retainedTileKeys.push(key);
      else removedInvalid = true;
    }
  }
  if (removedInvalid) state.selectedUvFaces = new Set([...selected.map(entry => entry.key), ...retainedTileKeys]);
  return selected;
}

function normalizedUvBounds(entries) {
  if (!entries.length) return null;
  const u = entries.flatMap(entry => [entry.uv[0], entry.uv[2]]);
  const v = entries.flatMap(entry => [entry.uv[1], entry.uv[3]]);
  return { minU: Math.min(...u), minV: Math.min(...v), maxU: Math.max(...u), maxV: Math.max(...v) };
}

function textureUvPath(entries, layout) {
  const screen = (value, offset) => Math.round(offset + value * layout.scale) + .5;
  return entries.map(({ uv }) => {
    const [u1, v1, u2, v2] = uv;
    const x1 = screen(u1, layout.left), y1 = screen(v1, layout.top);
    const x2 = screen(u2, layout.left), y2 = screen(v2, layout.top);
    return `M${x1},${y1}H${x2}V${y2}H${x1}Z`;
  }).join('');
}

function updateTextureUvFields(selectedEntries) {
  $$('[data-uv-coordinate]').forEach(input => {
    const coordinate = Number(input.dataset.uvCoordinate);
    const first = selectedEntries[0]?.uv[coordinate];
    const shared = selectedEntries.length && selectedEntries.every(entry => Math.abs(entry.uv[coordinate] - first) < 1e-8);
    if (document.activeElement !== input) input.value = shared ? String(round(first)) : '';
    input.disabled = !selectedEntries.length;
    input.dataset.mixed = selectedEntries.length && !shared ? 'true' : 'false';
  });
}

function renderTextureUvOverlay(selectionOnly = false) {
  renderTextureTileControls();
  const overlay = $('#textureUvOverlay');
  if (!overlay || !textureViewLayout) return;
  const layout = textureViewLayout;
  const entries = textureUvEntries();
  const visibleEntries = entries.filter(entry => !entry.culled);
  const culledEntries = entries.filter(entry => entry.culled);
  const selectedEntries = selectedTextureUvEntries(entries);
  const selectedPath = textureUvPath(selectedEntries, layout);
  const bounds = normalizedUvBounds(selectedEntries);
  let boundsMarkup = '';
  if (bounds) {
    const { minU, minV, maxU, maxV } = bounds;
    const screenX = value => Math.round(layout.left + value * layout.scale) + .5;
    const screenY = value => Math.round(layout.top + value * layout.scale) + .5;
    const left = screenX(minU), top = screenY(minV), right = screenX(maxU), bottom = screenY(maxV);
    const handleSize = 7;
    const positions = [
      ['nw', left, top], ['n', (left + right) / 2, top], ['ne', right, top],
      ['w', left, (top + bottom) / 2], ['e', right, (top + bottom) / 2],
      ['sw', left, bottom], ['s', (left + right) / 2, bottom], ['se', right, bottom]
    ];
    boundsMarkup = `<rect class="texture-uv-bounds" x="${left}" y="${top}" width="${right - left}" height="${bottom - top}"/>${positions.map(([name, x, y]) => `<rect class="texture-uv-handle" data-uv-handle="${name}" x="${Math.round(x - handleSize / 2)}" y="${Math.round(y - handleSize / 2)}" width="${handleSize}" height="${handleSize}"/>`).join('')}`;
  }
  let allPathNode = overlay.querySelector('.texture-uv-all');
  let culledPathNode = overlay.querySelector('.texture-uv-culled');
  let selectedPathNode = overlay.querySelector('.texture-uv-selected');
  let selectionUi = overlay.querySelector('.texture-uv-selection-ui');
  if (!selectionOnly || !allPathNode || !culledPathNode || !selectedPathNode || !selectionUi) {
    overlay.setAttribute('viewBox', `0 0 ${layout.viewportWidth} ${layout.viewportHeight}`);
    overlay.innerHTML = '<path class="texture-uv-all"/><path class="texture-uv-culled"/><path class="texture-uv-selected"/><g class="texture-uv-selection-ui"></g><rect class="texture-uv-alt-box" hidden/>';
    allPathNode = overlay.querySelector('.texture-uv-all');
    culledPathNode = overlay.querySelector('.texture-uv-culled');
    selectedPathNode = overlay.querySelector('.texture-uv-selected');
    selectionUi = overlay.querySelector('.texture-uv-selection-ui');
    allPathNode.setAttribute('d', textureUvPath(visibleEntries, layout));
    culledPathNode.setAttribute('d', textureUvPath(culledEntries, layout));
  }
  selectedPathNode.setAttribute('d', selectedPath);
  selectionUi.innerHTML = boundsMarkup;
  const altBox = overlay.querySelector('.texture-uv-alt-box');
  if (altBox && textureUvDrag?.kind === 'assign' && textureUvDrag.moved && textureUvDrag.currentUv) {
    const start = textureUvDrag.startUv, end = textureUvDrag.currentUv;
    const left = layout.left + Math.min(start[0], end[0]) * layout.scale;
    const top = layout.top + Math.min(start[1], end[1]) * layout.scale;
    altBox.setAttribute('x', String(left));
    altBox.setAttribute('y', String(top));
    altBox.setAttribute('width', String(Math.abs(end[0] - start[0]) * layout.scale));
    altBox.setAttribute('height', String(Math.abs(end[1] - start[1]) * layout.scale));
    altBox.removeAttribute('hidden');
  } else altBox?.setAttribute('hidden', '');
  updateTextureUvFields(selectedEntries);
  const selectedFaceCounts = new Map(CUBE_FACE_NAMES.map(faceName => [faceName, 0]));
  selectedEntries.forEach(entry => selectedFaceCounts.set(entry.faceName, (selectedFaceCounts.get(entry.faceName) || 0) + 1));
  $$('[data-texture-face]').forEach(button => {
    const faceName = button.dataset.textureFace;
    const total = textureUvEntryCache?.faceCounts.get(faceName) || 0;
    button.classList.toggle('active', total > 0 && selectedFaceCounts.get(faceName) === total);
  });
}

function updateTextureStageTransform() {
  const preview = $('#texturePreview');
  const stage = $('#textureStage');
  if (!preview || !stage) return;
  const viewportWidth = Math.max(1, preview.clientWidth);
  const viewportHeight = Math.max(1, preview.clientHeight);
  const [textureWidth, textureHeight] = texturePreviewSize;
  const baseScale = Math.min(viewportWidth / textureWidth, viewportHeight / textureHeight);
  state.textureView.zoom = Math.max(.05, Math.min(64, Number(state.textureView.zoom) || 1));
  const scale = baseScale * state.textureView.zoom;
  const left = (viewportWidth - textureWidth * scale) / 2 + state.textureView.panX;
  const top = (viewportHeight - textureHeight * scale) / 2 + state.textureView.panY;
  stage.style.width = `${textureWidth}px`;
  stage.style.height = `${textureHeight}px`;
  stage.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
  const checker = $('.checkerboard', stage);
  if (checker) {
    checker.style.backgroundSize = `${18 / scale}px ${18 / scale}px`;
    checker.style.backgroundPosition = `0 0, ${9 / scale}px ${9 / scale}px`;
  }
  textureViewLayout = { left, top, scale, baseScale, viewportWidth, viewportHeight, textureWidth, textureHeight };
  renderTextureUvOverlay();
}

function cancelTextureFocus() {
  if (textureFocusFrame !== null) cancelAnimationFrame(textureFocusFrame);
  textureFocusFrame = null;
}

function animateTextureView(target, animate = true) {
  cancelTextureFocus();
  const from = { ...state.textureView };
  if (!animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    state.textureView = { ...target };
    updateTextureStageTransform();
    return;
  }
  const started = performance.now();
  const duration = 250;
  const step = now => {
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - (1 - progress) ** 3;
    state.textureView = {
      zoom: from.zoom + (target.zoom - from.zoom) * eased,
      panX: from.panX + (target.panX - from.panX) * eased,
      panY: from.panY + (target.panY - from.panY) * eased
    };
    updateTextureStageTransform();
    if (progress < 1) textureFocusFrame = requestAnimationFrame(step);
    else textureFocusFrame = null;
  };
  textureFocusFrame = requestAnimationFrame(step);
}

function resetTextureView(animate = true) {
  animateTextureView({ zoom: 1, panX: 0, panY: 0 }, animate);
}

function focusSelectedTextureUvs(animate = true, retry = true) {
  const entries = selectedTextureUvEntries();
  const bounds = normalizedUvBounds(entries);
  if (!bounds || !Object.values(bounds).every(Number.isFinite)) return resetTextureView(animate);
  const preview = $('#texturePreview');
  if (preview.clientWidth < 8 || preview.clientHeight < 8) {
    if (retry) requestAnimationFrame(() => focusSelectedTextureUvs(animate, false));
    return;
  }
  const viewportWidth = preview.clientWidth;
  const viewportHeight = preview.clientHeight;
  const [textureWidth, textureHeight] = texturePreviewSize;
  const baseScale = Math.min(viewportWidth / textureWidth, viewportHeight / textureHeight);
  const spanU = Math.max(.25, bounds.maxU - bounds.minU);
  const spanV = Math.max(.25, bounds.maxV - bounds.minV);
  const desiredScale = Math.min(viewportWidth * .78 / spanU, viewportHeight * .78 / spanV);
  const zoom = Math.max(.05, Math.min(32, desiredScale / baseScale));
  const scale = baseScale * zoom;
  animateTextureView({
    zoom,
    panX: -(((bounds.minU + bounds.maxU) / 2) - textureWidth / 2) * scale,
    panY: -(((bounds.minV + bounds.maxV) / 2) - textureHeight / 2) * scale
  }, animate);
}

function setDockHotspotFocus(panelId) {
  focusedDockHotspot = panelId;
  $$('[data-hotspot-focus="true"]').forEach(panel => panel.classList.toggle('hotspot-focused', panel.dataset.panel === panelId));
}

function clientToTextureUv(clientX, clientY) {
  if (!textureViewLayout) updateTextureStageTransform();
  const rect = $('#texturePreview').getBoundingClientRect();
  return [
    (clientX - rect.left - textureViewLayout.left) / textureViewLayout.scale,
    (clientY - rect.top - textureViewLayout.top) / textureViewLayout.scale
  ];
}

function textureUvHit(entries, point) {
  return entries
    .filter(entry => point[0] >= Math.min(entry.uv[0], entry.uv[2]) && point[0] <= Math.max(entry.uv[0], entry.uv[2])
      && point[1] >= Math.min(entry.uv[1], entry.uv[3]) && point[1] <= Math.max(entry.uv[1], entry.uv[3]))
    .sort((left, right) => Math.abs((left.uv[2] - left.uv[0]) * (left.uv[3] - left.uv[1]))
      - Math.abs((right.uv[2] - right.uv[0]) * (right.uv[3] - right.uv[1])))[0] || null;
}

function textureUvHandleAt(point, bounds) {
  if (!bounds || !textureViewLayout) return null;
  const tolerance = 9 / textureViewLayout.scale;
  const nearLeft = Math.abs(point[0] - bounds.minU) <= tolerance;
  const nearRight = Math.abs(point[0] - bounds.maxU) <= tolerance;
  const nearTop = Math.abs(point[1] - bounds.minV) <= tolerance;
  const nearBottom = Math.abs(point[1] - bounds.maxV) <= tolerance;
  if (nearLeft && nearTop) return 'nw';
  if (nearRight && nearTop) return 'ne';
  if (nearLeft && nearBottom) return 'sw';
  if (nearRight && nearBottom) return 'se';
  const withinX = point[0] >= bounds.minU - tolerance && point[0] <= bounds.maxU + tolerance;
  const withinY = point[1] >= bounds.minV - tolerance && point[1] <= bounds.maxV + tolerance;
  if (nearTop && withinX) return 'n';
  if (nearBottom && withinX) return 's';
  if (nearLeft && withinY) return 'w';
  if (nearRight && withinY) return 'e';
  return null;
}

function snapTexturePan() {
  if (!textureViewLayout) return;
  const { viewportWidth, viewportHeight, textureWidth, textureHeight, scale } = textureViewLayout;
  let left = (viewportWidth - textureWidth * scale) / 2 + state.textureView.panX;
  let top = (viewportHeight - textureHeight * scale) / 2 + state.textureView.panY;
  const right = left + textureWidth * scale;
  const bottom = top + textureHeight * scale;
  const distance = 12;
  if (Math.abs(left) <= distance) state.textureView.panX -= left;
  else if (Math.abs(right - viewportWidth) <= distance) state.textureView.panX += viewportWidth - right;
  if (Math.abs(top) <= distance) state.textureView.panY -= top;
  else if (Math.abs(bottom - viewportHeight) <= distance) state.textureView.panY += viewportHeight - bottom;
}

function constrainUvMoveDelta(bounds, delta) {
  const [width, height] = texturePreviewSize;
  const minimumU = bounds.minU < 0 ? 0 : -bounds.minU;
  const maximumU = bounds.maxU > width ? 0 : width - bounds.maxU;
  const minimumV = bounds.minV < 0 ? 0 : -bounds.minV;
  const maximumV = bounds.maxV > height ? 0 : height - bounds.maxV;
  return [clamp(delta[0], minimumU, maximumU), clamp(delta[1], minimumV, maximumV)];
}

function materializeUvFaces(entries) {
  for (const entry of entries) {
    entry.cube.faces ||= {};
    const existing = entry.cube.faces[entry.faceName];
    if (existing === null) continue;
    entry.cube.faces[entry.faceName] = {
      ...(existing || {}),
      uv: Array.isArray(existing?.uv) && existing.uv.length >= 4
        ? [...existing.uv]
        : [...getBlockbenchBoxUv(entry.cube, entry.faceName)]
    };
    entry.cube.autoUv = false;
  }
}

function beginTextureUvMutation(drag) {
  if (drag.snapshotTaken) return;
  snapshot(drag.kind === 'resize' ? 'core.uv.resize' : 'core.uv.move');
  materializeUvFaces(selectedTextureUvEntries());
  const entries = selectedTextureUvEntries();
  drag.entries = entries;
  drag.originals = new Map(entries.map(entry => [entry.key, [...entry.cube.faces[entry.faceName].uv]]));
  drag.bounds = normalizedUvBounds(entries);
  drag.snapshotTaken = true;
}

function applyTextureUvDrag(event) {
  const drag = textureUvDrag;
  if (!drag || !['move', 'resize'].includes(drag.kind)) return;
  beginTextureUvMutation(drag);
  if (!drag.entries.length || !drag.bounds) return;
  const point = clientToTextureUv(event.clientX, event.clientY);
  let delta = [snapValue(point[0] - drag.startUv[0], event), snapValue(point[1] - drag.startUv[1], event)];
  if (drag.kind === 'move') {
    delta = constrainUvMoveDelta(drag.bounds, delta);
    drag.entries.forEach(entry => {
      const original = drag.originals.get(entry.key);
      entry.cube.faces[entry.faceName].uv = [original[0] + delta[0], original[1] + delta[1], original[2] + delta[0], original[3] + delta[1]];
    });
  } else {
    const original = drag.bounds;
    let next = { ...original };
    if (drag.handle.includes('w')) next.minU = snapValue(original.minU + delta[0], event);
    if (drag.handle.includes('e')) next.maxU = snapValue(original.maxU + delta[0], event);
    if (drag.handle.includes('n')) next.minV = snapValue(original.minV + delta[1], event);
    if (drag.handle.includes('s')) next.maxV = snapValue(original.maxV + delta[1], event);
    const [width, height] = texturePreviewSize;
    if (drag.handle.includes('w')) next.minU = clamp(next.minU, original.minU < 0 ? original.minU : 0, next.maxU - .001);
    if (drag.handle.includes('e')) next.maxU = clamp(next.maxU, next.minU + .001, original.maxU > width ? original.maxU : width);
    if (drag.handle.includes('n')) next.minV = clamp(next.minV, original.minV < 0 ? original.minV : 0, next.maxV - .001);
    if (drag.handle.includes('s')) next.maxV = clamp(next.maxV, next.minV + .001, original.maxV > height ? original.maxV : height);
    const oldWidth = Math.max(1e-8, original.maxU - original.minU);
    const oldHeight = Math.max(1e-8, original.maxV - original.minV);
    drag.entries.forEach(entry => {
      const source = drag.originals.get(entry.key);
      entry.cube.faces[entry.faceName].uv = source.map((value, index) => index % 2 === 0
        ? next.minU + (value - original.minU) / oldWidth * (next.maxU - next.minU)
        : next.minV + (value - original.minV) / oldHeight * (next.maxV - next.minV));
    });
  }
  if (!state.dirty) markDirty();
  invalidateSelectionRenderGeometry();
  renderTextureUvOverlay();
  scheduleSceneRender();
}

const paintBrushOffsetCache = new Map();
const PAINT_FACE_LAYOUTS = Object.freeze({
  south: [7, 6, 4, 5], north: [2, 3, 1, 0], east: [6, 2, 5, 1],
  west: [3, 7, 0, 4], up: [3, 2, 7, 6], down: [4, 5, 0, 1]
});
const PAINT_FACE_EDGES = Object.freeze([[0, 1], [1, 3], [2, 3], [0, 2]]);

function activeTextureAsset() {
  return state.textureAssets.find(asset => asset._uid === state.activeTextureUid) || null;
}

function setPaintColor(color, notify = false, preservePickerHue = false) {
  if (!/^#[0-9a-f]{6}$/i.test(String(color))) return;
  state.paintColor = String(color).toLowerCase();
  if (!colorPickerPopupRoot && state.tool === 'gradient' && !state.paintGradientPalette) {
    if (state.paintGradientStop === 'end') state.paintGradientEnd = state.paintColor;
    else state.paintGradientStart = state.paintColor;
  }
  const [hue, saturation, value] = rgbToHsv(hexToRgb(state.paintColor));
  if (!preservePickerHue) {
    if (saturation > 1e-4 && value > 1e-4) state.paintColorPickerHue = hue;
    state.paintColorPickerSaturation = saturation;
    state.paintColorPickerValue = value;
  }
  $('#paintColor').value = state.paintColor;
  const startButton = $('#paintGradientStartControl'), endButton = $('#paintGradientEndControl');
  startButton?.style.setProperty('--gradient-color', state.paintGradientStart);
  endButton?.style.setProperty('--gradient-color', state.paintGradientEnd);
  updatePaintColorPickerVisual();
  renderPaintGradientPreview();
  if (notify) toast(`繪畫顏色 ${state.paintColor}`);
}

function selectPaintGradientStop(stop) {
  state.paintGradientStop = stop === 'end' ? 'end' : 'start';
  setPaintColor(state.paintGradientStop === 'end' ? state.paintGradientEnd : state.paintGradientStart);
  updateToolOptions();
}

function paintSetting(tool = state.tool) {
  return tool === 'brush'
    ? { size: state.paintBrushSize, opacity: state.paintBrushOpacity, erase: state.paintBrushErase }
    : state.paintToolSettings[tool] || { size: 1, opacity: 100, erase: false };
}

function paintToolErasing(tool = state.tool) {
  return PAINT_ERASE_TOOLS.includes(tool) && paintSetting(tool).erase === true;
}

function paintToolOpacity(tool = state.tool) {
  return clamp(Number(paintSetting(tool).opacity) || 100, 1, 100) / 100;
}

function paintBrushOffsets(size, shape = state.paintBrushShape, antialias = state.paintBrushAa) {
  const normalized = clamp(Math.round(size) || 1, 1, 64);
  const key = `${normalized}:${shape}:${antialias ? 1 : 0}`;
  if (paintBrushOffsetCache.has(key)) return paintBrushOffsetCache.get(key);
  const offsets = [];
  const center = (normalized - 1) / 2;
  const radius = normalized / 2;
  for (let y = 0; y < normalized; y++) {
    for (let x = 0; x < normalized; x++) {
      let coverage = 1;
      if (shape === 'circle' && normalized > 1) {
        if (antialias) {
          let inside = 0;
          for (let sampleY = 0; sampleY < 4; sampleY++) for (let sampleX = 0; sampleX < 4; sampleX++) {
            const px = x - center + (sampleX + .5) / 4 - .5;
            const py = y - center + (sampleY + .5) / 4 - .5;
            if (Math.hypot(px, py) <= radius) inside++;
          }
          coverage = inside / 16;
          if (coverage <= 0) continue;
        } else if (Math.hypot(x - center, y - center) > radius) continue;
      }
      offsets.push([x - Math.floor(center), y - Math.floor(center), coverage]);
    }
  }
  paintBrushOffsetCache.set(key, offsets);
  return offsets;
}

function paintPointFromEvent(event) {
  const point = clientToTextureUv(event.clientX, event.clientY);
  return [Math.floor(point[0]), Math.floor(point[1])];
}

function paintPointInside(point) {
  return point[0] >= 0 && point[1] >= 0 && point[0] < textureCanvas.width && point[1] < textureCanvas.height;
}

function faceUvPixelSlots(cube, faceName) {
  const face = cube?.faces?.[faceName] || {};
  if (isFaceTiled(face)) return null;
  const rectangle = Array.isArray(face.uv) && face.uv.length >= 4
    ? face.uv : getBlockbenchBoxUv(cube, faceName);
  return rectangle ? createBlockbenchFaceUvSlots(rectangle, face.rotation || 0) : null;
}

function paintFaceDepthNeighbors(hit, target) {
  const sourcePoints = hit.facePoints;
  const sourceLayout = PAINT_FACE_LAYOUTS[target.faceName];
  const sourceSlots = faceUvPixelSlots(target.cube, target.faceName);
  if (sourcePoints?.length !== 4 || !sourceLayout || !sourceSlots) return [];
  const extent = Math.max(1, ...[0, 1, 2].map(axis => Math.max(...sourcePoints.map(point => point[axis]))
    - Math.min(...sourcePoints.map(point => point[axis]))));
  const neighbors = [];
  for (const [sourceFirst, sourceSecond] of PAINT_FACE_EDGES) {
    const worldStart = sourcePoints[sourceFirst], worldEnd = sourcePoints[sourceSecond];
    const cornerStart = sourceLayout[sourceFirst], cornerEnd = sourceLayout[sourceSecond];
    for (const [candidateName, candidateLayout] of Object.entries(PAINT_FACE_LAYOUTS)) {
      if (candidateName === target.faceName) continue;
      const candidateSlots = faceUvPixelSlots(target.cube, candidateName);
      if (!candidateSlots) continue;
      const pair = PAINT_FACE_EDGES.find(([first, second]) => (
        candidateLayout[first] === cornerStart && candidateLayout[second] === cornerEnd
      ) || (candidateLayout[first] === cornerEnd && candidateLayout[second] === cornerStart));
      if (!pair) continue;
      const [candidateFirst, candidateSecond] = pair;
      const forward = candidateLayout[candidateFirst] === cornerStart;
      const targetStart = candidateSlots[forward ? candidateFirst : candidateSecond];
      const targetEnd = candidateSlots[forward ? candidateSecond : candidateFirst];
      const targetCenter = candidateSlots.reduce((sum, point) => [sum[0] + point[0] / 4, sum[1] + point[1] / 4], [0, 0]);
      const targetMidpoint = [(targetStart[0] + targetEnd[0]) / 2, (targetStart[1] + targetEnd[1]) / 2];
      const inwardRaw = [targetCenter[0] - targetMidpoint[0], targetCenter[1] - targetMidpoint[1]];
      const inwardLength = Math.hypot(...inwardRaw) || 1;
      const sourceStart = sourceSlots[sourceFirst], sourceEnd = sourceSlots[sourceSecond];
      const sourceCenter = sourceSlots.reduce((sum, point) => [sum[0] + point[0] / 4, sum[1] + point[1] / 4], [0, 0]);
      const sourceMidpoint = [(sourceStart[0] + sourceEnd[0]) / 2, (sourceStart[1] + sourceEnd[1]) / 2];
      const sourceInwardRaw = [sourceCenter[0] - sourceMidpoint[0], sourceCenter[1] - sourceMidpoint[1]];
      const sourceInwardLength = Math.hypot(...sourceInwardRaw) || 1;
      const midpointWorld = worldStart.map((value, axis) => (value + worldEnd[axis]) / 2);
      const inwardWorld = faceUvWorldPoint(target.cube, target.faceName, sourcePoints, [
        sourceMidpoint[0] + sourceInwardRaw[0] / sourceInwardLength,
        sourceMidpoint[1] + sourceInwardRaw[1] / sourceInwardLength
      ]);
      neighbors.push({
        faceName: candidateName, sourceFacePoints: sourcePoints,
        sourceStart, sourceEnd,
        worldStart, worldEnd,
        worldPixelDepth: inwardWorld ? Math.max(1e-7, Math.hypot(...inwardWorld.map((value, axis) => value - midpointWorld[axis]))) : extent * 1e-4,
        targetStart, targetEnd,
        inward: inwardRaw.map(value => value / inwardLength)
      });
      break;
    }
  }
  return neighbors;
}

function prepareHolisticPaintSurface(surface) {
  const base = surface?.baseSurface || surface;
  if (!base?.canvas || !base.context) return null;
  if (base.strokeImage && base.strokeImage.width === base.canvas.width && base.strokeImage.height === base.canvas.height) return base;
  base.strokeImage = base.context.getImageData(0, 0, base.canvas.width, base.canvas.height);
  base.strokeBasePixels = new Uint8ClampedArray(base.strokeImage.data);
  base.strokeCoverage = new Uint8Array(base.canvas.width * base.canvas.height);
  base.strokeDirty = null;
  return base;
}

function extendPaintDirtyRect(surface, x, y) {
  const dirty = surface.strokeDirty;
  if (!dirty) surface.strokeDirty = { minX: x, minY: y, maxX: x, maxY: y };
  else {
    dirty.minX = Math.min(dirty.minX, x); dirty.minY = Math.min(dirty.minY, y);
    dirty.maxX = Math.max(dirty.maxX, x); dirty.maxY = Math.max(dirty.maxY, y);
  }
}

function flushHolisticPaintSurface(surface) {
  const base = surface?.baseSurface || surface;
  const dirty = base?.strokeDirty;
  if (!base?.strokeImage || !dirty) return;
  base.context.putImageData(base.strokeImage, 0, 0,
    dirty.minX, dirty.minY, dirty.maxX - dirty.minX + 1, dirty.maxY - dirty.minY + 1);
  base.strokeDirty = null;
}

function compositeHolisticPaintPixel(surface, x, y, coverage, tool, opacity) {
  const base = prepareHolisticPaintSurface(surface);
  if (!base) return false;
  const pixel = y * base.canvas.width + x;
  const offset = pixel * 4;
  const source = base.strokeBasePixels;
  if (state.paintIgnoreTransparent && source[offset + 3] === 0) return true;
  if (paintToolErasing(tool) && state.alphaLock) return true;
  const coverageByte = Math.round(clamp(coverage, 0, 1) * 255);
  if (coverageByte <= base.strokeCoverage[pixel]) return true;
  base.strokeCoverage[pixel] = coverageByte;
  const blend = opacity * coverageByte / 255;
  const output = base.strokeImage.data;
  const sourceAlpha = source[offset + 3] / 255;
  if (paintToolErasing(tool)) {
    output[offset] = source[offset]; output[offset + 1] = source[offset + 1]; output[offset + 2] = source[offset + 2];
    output[offset + 3] = Math.round(source[offset + 3] * (1 - blend));
  } else if (state.alphaLock) {
    const color = paintColorBytes();
    for (let channel = 0; channel < 3; channel++) output[offset + channel] = Math.round(source[offset + channel] * (1 - blend) + color[channel] * blend);
    output[offset + 3] = source[offset + 3];
  } else {
    const color = paintColorBytes();
    const outputAlpha = blend + sourceAlpha * (1 - blend);
    for (let channel = 0; channel < 3; channel++) output[offset + channel] = outputAlpha <= 0 ? 0 : Math.round(
      (color[channel] * blend + source[offset + channel] * sourceAlpha * (1 - blend)) / outputAlpha);
    output[offset + 3] = Math.round(outputAlpha * 255);
  }
  extendPaintDirtyRect(base, x, y);
  return true;
}

function drawPaintPixel(surface, x, y, coverage, tool, opacity) {
  if (!surface?.canvas || !surface.context || x < 0 || y < 0 || x >= surface.canvas.width || y >= surface.canvas.height) return;
  if (surface.rootDrag?.holisticStroke && compositeHolisticPaintPixel(surface, x, y, coverage, tool, opacity)) return;
  const context = surface.context;
  if (paintToolErasing(tool) && state.alphaLock) return;
  if (state.paintIgnoreTransparent && context.getImageData(x, y, 1, 1).data[3] === 0) return;
  context.globalAlpha = opacity * coverage;
  context.globalCompositeOperation = paintToolErasing(tool)
    ? 'destination-out' : state.alphaLock ? 'source-atop' : 'source-over';
  context.fillStyle = state.paintColor;
  context.fillRect(x, y, 1, 1);
}

function touchScenePaintSurface(surface) {
  const root = surface?.rootDrag;
  if (!root || root.historyAssets.has(surface.asset._uid)) return;
  root.historyAssets.add(surface.asset._uid);
  root.touchedSurfaces.add(surface.baseSurface || surface);
  pushTexturePaintHistory(surface.asset, surface.canvas, root.historyGroup);
}

function paintBrushDepthStamp(drag, centerX, centerY, offsets, opacity) {
  const depth = clamp(Math.round(Number(state.paintBrushDepth)) || 0, 0, 32);
  if (!depth || drag.tool !== 'brush' || !drag.paintFace?.cube || !drag.depthEdges?.length) return;
  for (const edge of drag.depthEdges) {
    const surface = edge.surface;
    if (!surface) continue;
    const sourceEdge = [edge.sourceEnd[0] - edge.sourceStart[0], edge.sourceEnd[1] - edge.sourceStart[1]];
    const sourceLengthSquared = sourceEdge[0] ** 2 + sourceEdge[1] ** 2;
    if (sourceLengthSquared < 1e-8) continue;
    const targetEdge = [edge.targetEnd[0] - edge.targetStart[0], edge.targetEnd[1] - edge.targetStart[1]];
    let touched = false;
    for (const [offsetX, offsetY, coverage] of offsets) {
      // Test the complete stamp, including pixels just outside the source UV
      // rectangle. This makes crossing a 3D cube edge deterministic instead
      // of depending on whether a clipped border pixel happened to survive.
      const sourcePoint = [centerX + offsetX + .5, centerY + offsetY + .5];
      const rawRatio = ((sourcePoint[0] - edge.sourceStart[0]) * sourceEdge[0]
        + (sourcePoint[1] - edge.sourceStart[1]) * sourceEdge[1]) / sourceLengthSquared;
      if (rawRatio < -.02 || rawRatio > 1.02) continue;
      const ratio = clamp(rawRatio, 0, 1);
      const closest = [edge.sourceStart[0] + sourceEdge[0] * ratio, edge.sourceStart[1] + sourceEdge[1] * ratio];
      if (Math.hypot(sourcePoint[0] - closest[0], sourcePoint[1] - closest[1]) > .8) continue;
      if (!touched) { touchScenePaintSurface(surface); touched = true; }
      const edgePoint = [edge.targetStart[0] + targetEdge[0] * ratio, edge.targetStart[1] + targetEdge[1] * ratio];
      for (let layer = 0; layer < depth; layer++) {
        const targetX = Math.floor(edgePoint[0] + edge.inward[0] * (layer + .5));
        const targetY = Math.floor(edgePoint[1] + edge.inward[1] * (layer + .5));
        drawPaintPixel(surface, targetX, targetY, coverage, drag.tool, opacity);
      }
    }
  }
}

function updateTextureBrushCursor(event) {
  const cursor = $('#textureBrushCursor');
  const preview = $('#texturePreview');
  const paintTool = state.mode === 'paint' && PAINT_TOOLS.includes(state.tool);
  if (!paintTool || !event || !textureViewLayout) {
    cursor.hidden = true;
    preview.style.cursor = '';
    return;
  }
  const point = clientToTextureUv(event.clientX, event.clientY);
  if (point[0] < 0 || point[1] < 0 || point[0] >= textureCanvas.width || point[1] >= textureCanvas.height) {
    cursor.hidden = true;
    preview.style.cursor = '';
    return;
  }
  const previewRect = preview.getBoundingClientRect();
  const diameter = ['eyedropper', 'fill'].includes(state.tool) ? 7 : Math.max(3, paintSetting().size * textureViewLayout.scale);
  cursor.style.left = `${event.clientX - previewRect.left}px`;
  cursor.style.top = `${event.clientY - previewRect.top}px`;
  cursor.style.width = `${diameter}px`;
  cursor.style.height = `${diameter}px`;
  cursor.classList.toggle('eraser', paintToolErasing());
  cursor.classList.toggle('square', state.tool === 'brush' && state.paintBrushShape === 'square');
  cursor.hidden = false;
  preview.style.cursor = 'none';
}

function syncPaintedTextureNow() {
  if (texturePaintSyncFrame !== null) cancelAnimationFrame(texturePaintSyncFrame);
  texturePaintSyncFrame = null;
  const targets = [...texturePaintSyncTargets.values()];
  texturePaintSyncTargets.clear();
  if (!targets.length) return;
  targets.forEach(target => syncRendererTextureAsset(target.asset, target.canvas));
  scheduleSceneRender();
  if (uvPreviewIsActive()) renderUvPreview();
}

function queuePaintedTextureSync(asset, canvas) {
  texturePaintSyncTargets.set(asset._uid, { asset, canvas });
  if (texturePaintSyncFrame !== null) return;
  texturePaintSyncFrame = requestAnimationFrame(syncPaintedTextureNow);
}

function drawPaintSegment(drag, from, to, sync = true) {
  const { canvas, context, asset, tool } = drag;
  const size = clamp(Math.round(paintSetting(tool).size) || 1, 1, 64);
  const opacity = paintToolOpacity(tool);
  const offsets = paintBrushOffsets(size, tool === 'brush' ? state.paintBrushShape : 'square', tool === 'brush' && state.paintBrushAa);
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const steps = Math.max(1, Math.max(Math.abs(dx), Math.abs(dy)));
  touchScenePaintSurface(drag);
  context.save();
  context.imageSmoothingEnabled = false;
  for (let step = 0; step <= steps; step++) {
    const ratio = step / steps;
    const centerX = Math.round(from[0] + dx * ratio);
    const centerY = Math.round(from[1] + dy * ratio);
    for (const [offsetX, offsetY, coverage] of offsets) {
      const x = centerX + offsetX, y = centerY + offsetY;
      const insideClip = !drag.clip || (x >= drag.clip.minU && y >= drag.clip.minV && x < drag.clip.maxU && y < drag.clip.maxV);
      if (insideClip && x >= 0 && y >= 0 && x < canvas.width && y < canvas.height) {
        drawPaintPixel(drag, x, y, coverage, tool, opacity);
      }
    }
    paintBrushDepthStamp(drag, centerX, centerY, offsets, opacity);
  }
  context.restore();
  flushHolisticPaintSurface(drag);
  const depthSurfaces = new Set((drag.depthEdges || []).map(edge => edge.surface).filter(Boolean));
  for (const surface of depthSurfaces) flushHolisticPaintSurface(surface);
  if (sync) queuePaintedTextureSync(asset, canvas);
  if (sync) {
    for (const surface of depthSurfaces) {
      if (drag.rootDrag?.historyAssets.has(surface.asset._uid)) queuePaintedTextureSync(surface.asset, surface.canvas);
    }
  }
}

function drawPaintShape(drag, to, restoreBase = true) {
  if (!drag?.baseImage || !drag.start || !PAINT_SHAPE_TOOLS.includes(drag.tool)) return;
  if (restoreBase) {
    drag.context.putImageData(drag.baseImage, 0, 0);
    const base = drag.baseSurface || drag;
    base.strokeImage = null;
    base.strokeCoverage = null;
  }
  const [startX, startY] = drag.start;
  const [endX, endY] = to;
  if (drag.tool === 'line') drawPaintSegment(drag, drag.start, to, false);
  else if (drag.tool === 'rectangle') {
    const corners = [[startX, startY], [endX, startY], [endX, endY], [startX, endY], [startX, startY]];
    for (let index = 0; index < corners.length - 1; index++) drawPaintSegment(drag, corners[index], corners[index + 1], false);
  } else {
    const center = [(startX + endX) / 2, (startY + endY) / 2];
    const radius = [Math.abs(endX - startX) / 2, Math.abs(endY - startY) / 2];
    const steps = Math.max(16, Math.ceil(Math.PI * Math.max(radius[0], radius[1]) * 2));
    let previous = [Math.round(center[0] + radius[0]), Math.round(center[1])];
    for (let index = 1; index <= steps; index++) {
      const angle = index / steps * Math.PI * 2;
      const next = [Math.round(center[0] + Math.cos(angle) * radius[0]), Math.round(center[1] + Math.sin(angle) * radius[1])];
      drawPaintSegment(drag, previous, next, false);
      previous = next;
    }
  }
  queuePaintedTextureSync(drag.asset, drag.canvas);
}

function paintUvBounds(cube, faceName, canvas) {
  const face = cube.faces?.[faceName] || {};
  if (isFaceTiled(face)) return { minU: 0, minV: 0, maxU: canvas.width, maxV: canvas.height };
  const uv = Array.isArray(face.uv) && face.uv.length >= 4 ? face.uv : getBlockbenchBoxUv(cube, faceName);
  return {
    minU: clamp(Math.floor(Math.min(uv[0], uv[2])), 0, canvas.width),
    minV: clamp(Math.floor(Math.min(uv[1], uv[3])), 0, canvas.height),
    maxU: clamp(Math.ceil(Math.max(uv[0], uv[2])), 0, canvas.width),
    maxV: clamp(Math.ceil(Math.max(uv[1], uv[3])), 0, canvas.height)
  };
}

function fillPaintRects(result, asset, rectangles) {
  const { canvas, context } = result;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const color = paintColorBytes(), opacity = paintToolOpacity('fill');
  for (const rectangle of rectangles) {
    const minX = clamp(Math.floor(rectangle.minU), 0, canvas.width), maxX = clamp(Math.ceil(rectangle.maxU), 0, canvas.width);
    const minY = clamp(Math.floor(rectangle.minV), 0, canvas.height), maxY = clamp(Math.ceil(rectangle.maxV), 0, canvas.height);
    for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) blendPaintPixel(image.data, (y * canvas.width + x) * 4, color, opacity, 'fill');
  }
  context.putImageData(image, 0, 0);
  queuePaintedTextureSync(asset, result.canvas);
}

function paintColorBytes() {
  const value = state.paintColor.slice(1);
  return [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16));
}

function blendPaintPixel(data, offset, color, opacity, tool = 'fill') {
  const destinationAlpha = data[offset + 3] / 255;
  if (state.paintIgnoreTransparent && destinationAlpha <= 0) return;
  if (paintToolErasing(tool)) {
    if (!state.alphaLock) data[offset + 3] = Math.round(data[offset + 3] * (1 - opacity));
    return;
  }
  if (state.alphaLock && destinationAlpha <= 0) return;
  if (state.alphaLock) {
    for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.round(data[offset + channel] * (1 - opacity) + color[channel] * opacity);
    return;
  }
  const outputAlpha = opacity + destinationAlpha * (1 - opacity);
  for (let channel = 0; channel < 3; channel++) data[offset + channel] = outputAlpha <= 0 ? 0 : Math.round(
    (color[channel] * opacity + data[offset + channel] * destinationAlpha * (1 - opacity)) / outputAlpha);
  data[offset + 3] = Math.round(outputAlpha * 255);
}

function replacePaintColor(result, point, contiguous, clip = null) {
  const { canvas, context } = result;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const startX = clamp(Math.floor(point[0]), 0, canvas.width - 1);
  const startY = clamp(Math.floor(point[1]), 0, canvas.height - 1);
  const startOffset = (startY * canvas.width + startX) * 4;
  const target = [...image.data.slice(startOffset, startOffset + 4)];
  const matches = pixel => {
    const offset = pixel * 4;
    return image.data[offset] === target[0] && image.data[offset + 1] === target[1]
      && image.data[offset + 2] === target[2] && image.data[offset + 3] === target[3];
  };
  const insideClip = (x, y) => !clip || (x >= clip.minU && y >= clip.minV && x < clip.maxU && y < clip.maxV);
  const color = paintColorBytes();
  const opacity = paintToolOpacity('fill');
  if (!contiguous) {
    for (let pixel = 0; pixel < canvas.width * canvas.height; pixel++) {
      const x = pixel % canvas.width, y = Math.floor(pixel / canvas.width);
      if (insideClip(x, y) && matches(pixel)) blendPaintPixel(image.data, pixel * 4, color, opacity);
    }
  } else {
    const visited = new Uint8Array(canvas.width * canvas.height);
    const pending = [startY * canvas.width + startX];
    while (pending.length) {
      const pixel = pending.pop();
      const x = pixel % canvas.width, y = Math.floor(pixel / canvas.width);
      if (visited[pixel] || !insideClip(x, y) || !matches(pixel)) continue;
      visited[pixel] = 1;
      blendPaintPixel(image.data, pixel * 4, color, opacity);
      if (x > 0) pending.push(pixel - 1);
      if (x + 1 < canvas.width) pending.push(pixel + 1);
      if (y > 0) pending.push(pixel - canvas.width);
      if (y + 1 < canvas.height) pending.push(pixel + canvas.width);
    }
  }
  context.putImageData(image, 0, 0);
}

function allTextureUvEntriesForAsset(asset) {
  const references = new Set(textureAtlasReferences(asset, state.textureAssets.indexOf(asset))
    .flatMap(reference => [reference, reference.startsWith('#') ? reference.slice(1) : `#${reference}`]));
  const entries = [];
  for (const cube of state.project.elements.filter(element => element.type === 'cube')) {
    for (const faceName of CUBE_FACE_NAMES) {
      const face = cube.faces?.[faceName];
      if (isFaceTiled(face)) continue;
      if (isCubeFaceCulled(face) || !references.has(String(effectiveFaceTextureReference(face)))) continue;
      const uv = Array.isArray(face?.uv) && face.uv.length >= 4 ? face.uv.map(Number) : getBlockbenchBoxUv(cube, faceName).map(Number);
      entries.push({ cube, faceName, uv });
    }
  }
  return entries;
}

async function paintBucketAsset(asset, point, rectangles = null, contiguous = false, clip = null) {
  const result = asset._uid === state.activeTextureUid
    ? { canvas: textureCanvas, context: textureCtx }
    : await paintCanvasForAsset(asset);
  if (!result) return false;
  pushTexturePaintHistory(asset, result.canvas);
  if (rectangles) fillPaintRects(result, asset, rectangles);
  else {
    replacePaintColor(result, point, contiguous, clip);
    queuePaintedTextureSync(asset, result.canvas);
  }
  syncPaintedTextureNow();
  commitPaintedTextureAsset(asset, result.canvas);
  return true;
}

async function paintBucketElement(cube) {
  const byAsset = new Map();
  for (const faceName of CUBE_FACE_NAMES) {
    const existing = cube.faces?.[faceName];
    if (isCubeFaceCulled(existing)) continue;
    const asset = textureAssetForReference(existing?.texture);
    if (!asset) continue;
    const list = byAsset.get(asset) || [];
    list.push(faceName);
    byAsset.set(asset, list);
  }
  let painted = 0;
  for (const [asset, faceNames] of byAsset) {
    const result = asset._uid === state.activeTextureUid
      ? { canvas: textureCanvas, context: textureCtx }
      : await paintCanvasForAsset(asset);
    if (!result) continue;
    pushTexturePaintHistory(asset, result.canvas);
    fillPaintRects(result, asset, faceNames.map(faceName => paintUvBounds(cube, faceName, result.canvas)));
    syncPaintedTextureNow();
    commitPaintedTextureAsset(asset, result.canvas);
    painted++;
  }
  if (painted) {
    invalidateAllRenderGeometry();
    markDirty();
    renderScene();
  }
  return painted > 0;
}

async function applyTextureBucket(asset, point, hitEntry = null) {
  if (state.paintBucketScope === 'element') {
    if (!hitEntry?.cube) return toast('請指向一個元素的貼圖面');
    if (!await paintBucketElement(hitEntry.cube)) toast('這個元素沒有可繪畫的貼圖');
    return;
  }
  if (state.paintBucketScope === 'face') {
    if (!hitEntry?.cube || !hitEntry.faceName) return toast('請指向一個貼圖面');
    const result = asset._uid === state.activeTextureUid
      ? { canvas: textureCanvas, context: textureCtx }
      : await paintCanvasForAsset(asset);
    if (!result) return;
    pushTexturePaintHistory(asset, result.canvas);
    fillPaintRects(result, asset, [paintUvBounds(hitEntry.cube, hitEntry.faceName, result.canvas)]);
    syncPaintedTextureNow();
    commitPaintedTextureAsset(asset, result.canvas);
    return;
  }
  const singleFaceClip = state.paintBucketSingleFace && hitEntry?.cube && hitEntry.faceName
    ? paintUvBounds(hitEntry.cube, hitEntry.faceName, asset._uid === state.activeTextureUid ? textureCanvas : {
      width: asset.uvWidth || state.project.textureSize?.[0] || 16,
      height: asset.uvHeight || state.project.textureSize?.[1] || 16
    })
    : null;
  if (state.paintBucketSingleFace && !singleFaceClip) return toast('單面局限時請先指向一個貼圖面');
  await paintBucketAsset(asset, point, null, state.paintBucketScope === 'contiguous', singleFaceClip);
}

function pushTexturePaintHistory(asset, canvas = textureCanvas, group = null, operationId = null) {
  const id = requireOperation(operationId || `core.texture.${PAINT_TOOLS.includes(state.tool) ? state.tool : 'paint'}`);
  noteJournalOperation(id);
  state.paintHistory.push({
    uid: asset._uid,
    source: asset.layers?.length ? asset.source : canvas.toDataURL('image/png'),
    layers: asset.layers ? structuredClone(asset.layers) : null,
    activeLayerUid: asset.activeLayerUid || null,
    width: canvas.width,
    height: canvas.height,
    group
  });
  if (state.paintHistory.length > 60) state.paintHistory.shift();
  state.paintFuture.length = 0;
}

function commitPaintedTextureAsset(asset, canvas) {
  if (!asset || !canvas) return;
  paintHitAlphaCache.delete(asset._uid);
  const layer = activeLayer(asset);
  if (layer) layer.source = canvas.toDataURL('image/png');
  const composite = layer ? compositeLayers(asset, canvas) : canvas;
  asset.source = composite.toDataURL('image/png');
  asset.uvWidth = canvas.width;
  asset.uvHeight = canvas.height;
  asset.kind = 'PNG';
  if (asset._uid === state.activeTextureUid && canvas !== textureCanvas) {
    textureCanvas.width = canvas.width;
    textureCanvas.height = canvas.height;
    textureCtx.imageSmoothingEnabled = false;
    textureCtx.clearRect(0, 0, canvas.width, canvas.height);
    textureCtx.drawImage(canvas, 0, 0);
    updateTexturePreviewFrame(canvas.width, canvas.height);
  }
  syncRendererTextureAsset(asset, composite, true);
  const item = $$('.texture-item').find(node => node.dataset.textureUid === asset._uid);
  const thumbnail = item?.querySelector('.texture-thumb');
  if (thumbnail) thumbnail.style.backgroundImage = `url("${asset.source}")`;
  markDirty();
}

function replayTexturePaintPoints(drag) {
  const points = drag.pendingPoints.splice(0);
  for (const point of points) {
    if (PAINT_SHAPE_TOOLS.includes(drag.tool)) drawPaintShape(drag, point);
    else drawPaintSegment(drag, drag.last || point, point);
    drag.last = point;
  }
}

function finishTexturePaintDrag(drag) {
  if (!drag || drag.finished) return;
  drag.finished = true;
  syncPaintedTextureNow();
  const surfaces = drag.touchedSurfaces?.size ? [...drag.touchedSurfaces] : [drag];
  for (const surface of surfaces) commitPaintedTextureAsset(surface.asset, surface.canvas);
}

function useTexturePaintGradient(asset, point, hit) {
  if (state.paintGradientMode === 'volume') {
    toast('體漸變需要在三維視圖的同一個 Cube 上選取兩點');
    return;
  }
  if (!hit) return toast('請在一個 UV 面內選擇漸變點');
  const anchor = state.paintGradientAnchor;
  if (!anchor || anchor.surface !== 'texture') {
    state.paintGradientAnchor = { surface: 'texture', assetUid: asset._uid, point, cubeUid: hit.cube.uid, faceName: hit.faceName };
    toast('選擇面漸變終點');
    return;
  }
  if (anchor.assetUid !== asset._uid || anchor.cubeUid !== hit.cube.uid || anchor.faceName !== hit.faceName) {
    toast('面漸變的第二點必須在同一個 UV 面');
    return;
  }
  const direction = [point[0] - anchor.point[0], point[1] - anchor.point[1]];
  const lengthSquared = direction[0] ** 2 + direction[1] ** 2;
  if (lengthSquared < 1e-8) return toast('漸變兩點距離太短');
  pushTexturePaintHistory(asset, textureCanvas);
  const bounds = paintUvBounds(hit.cube, hit.faceName, textureCanvas);
  const image = textureCtx.getImageData(0, 0, textureCanvas.width, textureCanvas.height);
  const stops = activePaintGradientStops();
  const projections = [
    [bounds.minU, bounds.minV], [bounds.maxU, bounds.minV],
    [bounds.minU, bounds.maxV], [bounds.maxU, bounds.maxV]
  ].map(corner => (corner[0] - anchor.point[0]) * direction[0] + (corner[1] - anchor.point[1]) * direction[1]);
  const minProjection = Math.min(...projections), maxProjection = Math.max(...projections);
  const projectionSpan = Math.max(1e-8, maxProjection - minProjection);
  for (let y = bounds.minV; y < bounds.maxV; y++) for (let x = bounds.minU; x < bounds.maxU; x++) {
    const projection = (x + .5 - anchor.point[0]) * direction[0] + (y + .5 - anchor.point[1]) * direction[1];
    const rgba = samplePaintGradient((projection - minProjection) / projectionSpan, stops);
    blendRgbaPixel(image.data, (y * textureCanvas.width + x) * 4, rgba, paintToolOpacity('gradient'));
  }
  textureCtx.putImageData(image, 0, 0);
  commitPaintedTextureAsset(asset, textureCanvas);
  queuePaintedTextureSync(asset, textureCanvas);
  syncPaintedTextureNow();
  clearPaintGradientSelection();
}

function startTexturePaintPointer(event) {
  const asset = activeTextureAsset();
  if (!asset) {
    toast('請先建立或導入一張貼圖');
    return;
  }
  const point = paintPointFromEvent(event);
  if (!paintPointInside(point)) return;
  const hit = textureUvHit(allTextureUvEntriesForAsset(asset), point);
  if (state.tool === 'gradient') {
    useTexturePaintGradient(asset, point, hit);
    return;
  }
  if (state.tool === 'fill') {
    applyTextureBucket(asset, point, hit);
    return;
  }
  if (state.tool === 'eyedropper') {
    const pixel = textureCtx.getImageData(point[0], point[1], 1, 1).data;
    setPaintColor(`#${[pixel[0], pixel[1], pixel[2]].map(value => value.toString(16).padStart(2, '0')).join('')}`, true);
    updateToolOptions();
    return;
  }
  const historyGroup = crypto.randomUUID();
  pushTexturePaintHistory(asset, textureCanvas, historyGroup);
  texturePaintDrag = {
    pointerId: event.pointerId, uid: asset._uid, asset,
    canvas: textureCanvas, context: textureCtx, tool: state.tool, start: point, last: point,
    baseImage: PAINT_SHAPE_TOOLS.includes(state.tool) ? textureCtx.getImageData(0, 0, textureCanvas.width, textureCanvas.height) : null,
    historyGroup, historyAssets: new Set([asset._uid]), touchedSurfaces: new Set(), pendingPoints: [point],
    holisticStroke: true,
    ready: true, ended: false, finished: false
  };
  texturePaintDrag.rootDrag = texturePaintDrag;
  texturePaintDrag.baseSurface = texturePaintDrag;
  texturePaintDrag.touchedSurfaces.add(texturePaintDrag);
  $('#texturePreview').setPointerCapture(event.pointerId);
  replayTexturePaintPoints(texturePaintDrag);
}

function moveTexturePaintPointer(event) {
  if (!texturePaintDrag || texturePaintDrag.pointerId !== event.pointerId) return false;
  let point = paintPointFromEvent(event);
  const outside = !paintPointInside(point);
  if (outside && texturePaintDrag.last && !PAINT_SHAPE_TOOLS.includes(texturePaintDrag.tool)) {
    const [startX, startY] = texturePaintDrag.last;
    const dx = point[0] - startX, dy = point[1] - startY;
    const limits = [dx < 0 ? (0 - startX) / dx : dx > 0 ? (textureCanvas.width - 1 - startX) / dx : 1,
      dy < 0 ? (0 - startY) / dy : dy > 0 ? (textureCanvas.height - 1 - startY) / dy : 1];
    const ratio = clamp(Math.min(...limits), 0, 1);
    point = [clamp(Math.round(startX + dx * ratio), 0, textureCanvas.width - 1),
      clamp(Math.round(startY + dy * ratio), 0, textureCanvas.height - 1)];
  }
  if (!texturePaintDrag.ready) {
    texturePaintDrag.pendingPoints.push(point);
    return true;
  }
  if (PAINT_SHAPE_TOOLS.includes(texturePaintDrag.tool)) drawPaintShape(texturePaintDrag, point);
  else drawPaintSegment(texturePaintDrag, texturePaintDrag.outside ? point : texturePaintDrag.last, point);
  texturePaintDrag.last = point;
  texturePaintDrag.outside = outside;
  return true;
}

function endTexturePaintPointer(event) {
  if (!texturePaintDrag || texturePaintDrag.pointerId !== event.pointerId) return false;
  const drag = texturePaintDrag;
  if (drag.ready && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) moveTexturePaintPointer(event);
  texturePaintDrag = null;
  const preview = $('#texturePreview');
  if (preview.hasPointerCapture?.(event.pointerId)) preview.releasePointerCapture(event.pointerId);
  drag.ended = true;
  // A lost capture ends at the last received sample. Keeping that partial
  // stroke is safer than leaving the canvas and texture asset out of sync.
  if (drag.ready) finishTexturePaintDrag(drag);
  return true;
}

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
    if (!Array.isArray(face.uv)) face.uv = [...getBlockbenchBoxUv(cube, hit.faceName)];
    face.texture = reference;
    delete face.enabled;
    delete face[CULLED_FACE_TEXTURE_KEY];
    cube.autoUv = false;
    persistGeneratedPaintCube(cube);
  }
  markDirty();
  uvPreviewProjectCache = null;
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

function facePaintTarget(hit) {
  if (!hit?.faceName) return null;
  const hitNode = state.project.getNode(hit.uid);
  const cube = hit.cube?.type === 'cube' ? hit.cube : hitNode;
  if (cube?.type !== 'cube') return null;
  const existingFace = cube.faces?.[hit.faceName];
  const asset = textureAssetForReference(existingFace?.texture);
  if (!asset) return null;
  return { cube, faceName: hit.faceName, asset, owner: cube.subdivisionOwnerUid ? state.project.getNode(cube.subdivisionOwnerUid) : null };
}

function persistGeneratedPaintCube(cube) {
  const owner = cube?.subdivisionOwnerUid && state.project.getNode(cube.subdivisionOwnerUid);
  const index = Number(cube?.subdivisionIndex);
  if (!owner?.toBaseCubes || !Number.isInteger(index) || index < 0) return;
  const edits = { ...(owner.subdivisionEdits || {}) };
  const patch = subdivisionPatch(owner, cube, index);
  if (patch) edits[index] = patch;
  else delete edits[index];
  owner.subdivisionEdits = edits;
}

function adjacentPaintFaceAsset(cube, faceName) {
  const existingFace = cube.faces?.[faceName];
  if (isCubeFaceCulled(existingFace)) return null;
  const assignedAsset = textureAssetForReference(existingFace?.texture);
  if (assignedAsset) return assignedAsset;
  return null;
}

function barycentricPoint(point, a, b, c) {
  const v0 = b.map((value, axis) => value - a[axis]);
  const v1 = c.map((value, axis) => value - a[axis]);
  const v2 = point.map((value, axis) => value - a[axis]);
  const d00 = dot3(v0, v0), d01 = dot3(v0, v1), d11 = dot3(v1, v1);
  const d20 = dot3(v2, v0), d21 = dot3(v2, v1);
  const denominator = d00 * d11 - d01 * d01;
  if (Math.abs(denominator) < 1e-10) return null;
  const second = (d11 * d20 - d01 * d21) / denominator;
  const third = (d00 * d21 - d01 * d20) / denominator;
  const first = 1 - second - third;
  return first >= -1e-4 && second >= -1e-4 && third >= -1e-4 ? [first, second, third] : null;
}

function facePaintUvPoint(hit, target, canvas) {
  if (!hit?.point || !hit.facePoints?.length || !target || !canvas) return null;
  const face = target.cube.faces?.[target.faceName] || {};
  if (isFaceTiled(face)) {
    const uAxis = hit.facePoints[1].map((value, axis) => value - hit.facePoints[0][axis]);
    const vAxis = hit.facePoints[2].map((value, axis) => value - hit.facePoints[0][axis]);
    const offset = hit.point.map((value, axis) => value - hit.facePoints[0][axis]);
    const size = faceTileSize(target.cube, target.faceName);
    const u = dot3(offset, uAxis) / Math.max(1e-8, dot3(uAxis, uAxis)) * size[0];
    const v = dot3(offset, vAxis) / Math.max(1e-8, dot3(vAxis, vAxis)) * size[1];
    const fraction = value => ((value % 1) + 1) % 1;
    return [Math.floor(fraction((u + (Number(face.tiling?.offsetX) || 0)) / Math.max(.0001, Number(face.tiling?.width) || 16)) * canvas.width),
      Math.floor(fraction((v + (Number(face.tiling?.offsetY) || 0)) / Math.max(.0001, Number(face.tiling?.height) || 16)) * canvas.height)];
  }
  const rectangle = Array.isArray(face.uv) && face.uv.length >= 4
    ? face.uv
    : getBlockbenchBoxUv(target.cube, target.faceName);
  if (!rectangle) return null;
  const slots = createBlockbenchFaceUvSlots(rectangle, face.rotation || 0);
  const triangles = [[0, 2, 1], [2, 3, 1]];
  for (const indices of triangles) {
    const weights = barycentricPoint(hit.point,
      hit.facePoints[indices[0]], hit.facePoints[indices[1]], hit.facePoints[indices[2]]);
    if (!weights) continue;
    const uv = [0, 1].map(axis => indices.reduce((sum, slot, index) => sum + slots[slot][axis] * weights[index], 0));
    const point = [Math.floor(uv[0]), Math.floor(uv[1])];
    if (point[0] >= 0 && point[1] >= 0 && point[0] < canvas.width && point[1] < canvas.height) return point;
  }
  return null;
}

function faceUvWorldPoint(cube, faceName, facePoints, point) {
  if (!cube || !faceName || facePoints?.length !== 4) return null;
  const face = cube.faces?.[faceName] || {};
  const rectangle = Array.isArray(face.uv) && face.uv.length >= 4 ? face.uv : getBlockbenchBoxUv(cube, faceName);
  if (!rectangle) return null;
  const slots = createBlockbenchFaceUvSlots(rectangle, face.rotation || 0);
  for (const indices of [[0, 2, 1], [2, 3, 1]]) {
    const weights = barycentric2d(point, slots[indices[0]], slots[indices[1]], slots[indices[2]]);
    if (!weights || weights.some(weight => weight < -1e-5)) continue;
    return [0, 1, 2].map(axis => indices.reduce((sum, slot, index) => sum + facePoints[slot][axis] * weights[index], 0));
  }
  return null;
}

function facePixelWorldPoint(cube, faceName, facePoints, x, y) {
  return faceUvWorldPoint(cube, faceName, facePoints, [x + .5, y + .5]);
}

function blendRgbaPixel(data, offset, source, opacity = 1) {
  const sourceAlpha = clamp(source[3] * opacity, 0, 1);
  const destinationAlpha = data[offset + 3] / 255;
  if (state.paintIgnoreTransparent && destinationAlpha <= 0) return;
  if (sourceAlpha <= 0 || (state.alphaLock && destinationAlpha <= 0)) return;
  if (state.alphaLock) {
    for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.round(
      data[offset + channel] * (1 - sourceAlpha) + source[channel] * sourceAlpha);
    return;
  }
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  for (let channel = 0; channel < 3; channel++) data[offset + channel] = outputAlpha <= 0 ? 0 : Math.round(
    (source[channel] * sourceAlpha + data[offset + channel] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
  data[offset + 3] = Math.round(outputAlpha * 255);
}

function activePaintGradientStops() {
  if (state.paintGradientPalette) {
    const row = paletteRows.find(entry => entry.id === selectedPaletteRowId);
    if (row?.colors?.length) return row.colors.map(color => ({ color: hexToRgb(color), alpha: 1 }));
  }
  return [
    { color: hexToRgb(state.paintGradientStart), alpha: clamp(state.paintGradientStartAlpha / 100, 0, 1) },
    { color: hexToRgb(state.paintGradientEnd), alpha: clamp(state.paintGradientEndAlpha / 100, 0, 1) }
  ];
}

function samplePaintGradient(ratio, stops = activePaintGradientStops()) {
  if (!stops.length) return [...hexToRgb(state.paintGradientStart), 1];
  if (stops.length === 1) return [...stops[0].color, stops[0].alpha];
  const scaled = clamp(ratio, 0, 1) * (stops.length - 1);
  const leftIndex = Math.floor(scaled);
  const rightIndex = Math.min(stops.length - 1, leftIndex + 1);
  const amount = scaled - leftIndex;
  const left = stops[leftIndex], right = stops[rightIndex];
  return [
    ...left.color.map((channel, index) => Math.round(channel + (right.color[index] - channel) * amount)),
    left.alpha + (right.alpha - left.alpha) * amount
  ];
}

function paintGradientSvgStops(opacity = .72) {
  const stops = activePaintGradientStops();
  return stops.map((stop, index) => {
    const color = `#${stop.color.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
    const offset = stops.length === 1 ? 0 : index / (stops.length - 1);
    return `<stop offset="${offset}" stop-color="${color}" stop-opacity="${stop.alpha * opacity}"/>`;
  }).join('');
}

function projectedGradientRange(points, origin, direction) {
  const lengthSquared = dot3(direction, direction);
  if (lengthSquared < 1e-8 || !points.length) return null;
  const amounts = points.map(point => dot3(point.map((value, axis) => value - origin[axis]), direction) / lengthSquared);
  const min = Math.min(...amounts), max = Math.max(...amounts);
  if (max - min < 1e-8) return null;
  return {
    min, max,
    start: origin.map((value, axis) => value + direction[axis] * min),
    end: origin.map((value, axis) => value + direction[axis] * max)
  };
}

function clearPaintGradientSelection() {
  state.paintGradientAnchor = null;
  state.paintGradientHover = null;
  const overlay = $('#paintGradientOverlay');
  if (overlay) { overlay.innerHTML = ''; overlay.hidden = true; }
}

function renderPaintGradientPreview() {
  const overlay = $('#paintGradientOverlay');
  const anchor = state.paintGradientAnchor;
  const hover = state.paintGradientHover;
  if (!overlay || !anchor?.hit || !hover?.faceName) {
    if (overlay) { overlay.innerHTML = ''; overlay.hidden = true; }
    return;
  }
  const sameCube = (hover.cubeUid || hover.uid) === (anchor.hit.cubeUid || anchor.hit.uid);
  const sameFace = sameCube && hover.faceName === anchor.hit.faceName;
  if (!sameCube || (state.paintGradientMode === 'face' && !sameFace)) {
    overlay.innerHTML = ''; overlay.hidden = true; return;
  }
  const direction = hover.point.map((value, axis) => value - anchor.hit.point[axis]);
  const domainFaces = state.paintGradientMode === 'face'
    ? [hover]
    : sceneRenderer.getCubeFaceQuads(anchor.hit.uid, anchor.hit.cubeUid || anchor.hit.uid);
  const range = projectedGradientRange(domainFaces.flatMap(entry => entry.facePoints || []), anchor.hit.point, direction);
  if (!range) { overlay.innerHTML = ''; overlay.hidden = true; return; }
  const start = sceneRenderer.projectPoint(range.start);
  const end = sceneRenderer.projectPoint(range.end);
  const face = hover.facePoints.map(point => sceneRenderer.projectPoint(point));
  if (start.behind || end.behind || face.some(point => point.behind)) return;
  const width = sceneCanvas.clientWidth, height = sceneCanvas.clientHeight;
  const perimeter = [face[0], face[1], face[3], face[2]];
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  overlay.innerHTML = `<defs><linearGradient id="paintGradientPreviewFill" gradientUnits="userSpaceOnUse" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}">${paintGradientSvgStops()}</linearGradient></defs>
    ${state.paintGradientMode === 'face' ? `<path class="gradient-preview-face" d="M${perimeter.map(point => `${point.x},${point.y}`).join(' L')} Z"/>` : ''}
    <line class="gradient-preview-line" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}"/>
    <circle class="gradient-preview-point start" cx="${start.x}" cy="${start.y}" r="4"/><circle class="gradient-preview-point" cx="${end.x}" cy="${end.y}" r="4"/>`;
  overlay.hidden = false;
}

function updatePaintGradientHover(event) {
  if (!state.paintGradientAnchor || state.tool !== 'gradient') return;
  const rect = sceneCanvas.getBoundingClientRect();
  state.paintGradientHover = sceneRenderer.pickDetailed(state.project,
    event.clientX - rect.left, event.clientY - rect.top, true);
  renderPaintGradientPreview();
}

async function bakePaintGradient(anchorHit, endHit) {
  const cubeUid = anchorHit.cubeUid || anchorHit.uid;
  const domains = [];
  if (state.paintGradientMode === 'face') {
    const anchors = paintSymmetryRelatedHits(anchorHit);
    const ends = paintSymmetryRelatedHits(endHit);
    for (let index = 0; index < anchors.length; index++) {
      const anchor = anchors[index];
      const end = ends[index] && paintSymmetryFaceKey(ends[index]) === paintSymmetryFaceKey(anchor)
        ? ends[index]
        : ends.find(hit => paintSymmetryFaceKey(hit) === paintSymmetryFaceKey(anchor));
      if (end) domains.push({ anchor, end, hits: [anchor] });
    }
  } else {
    const anchors = paintSymmetryRelatedHits(anchorHit);
    const ends = paintSymmetryRelatedHits(endHit);
    for (let index = 0; index < anchors.length; index++) {
      const anchor = anchors[index];
      const end = ends[index] && paintSymmetryFaceKey(ends[index]) === paintSymmetryFaceKey(anchor)
        ? ends[index] : ends.find(hit => paintSymmetryFaceKey(hit) === paintSymmetryFaceKey(anchor));
      if (!end) continue;
      const targetCubeUid = anchor.cubeUid || anchor.uid;
      domains.push({
        anchor, end,
        hits: sceneRenderer.getCubeFaceQuads(anchor.uid, targetCubeUid).map(entry => ({ ...entry, point: anchor.point }))
      });
    }
  }
  const surfaces = new Map();
  const historyGroup = crypto.randomUUID();
  const stops = activePaintGradientStops();
  for (const domain of domains) {
    const direction = domain.end.point.map((value, axis) => value - domain.anchor.point[axis]);
    if (dot3(direction, direction) < 1e-8) continue;
    const projections = domain.hits.flatMap(hit => hit.facePoints || [])
      .map(point => dot3(point.map((value, axis) => value - domain.anchor.point[axis]), direction));
    const minimum = Math.min(...projections), maximum = Math.max(...projections), span = maximum - minimum;
    if (!Number.isFinite(span) || span < 1e-8) continue;
    for (const hit of domain.hits) {
      const target = facePaintTarget(hit);
      if (!target) continue;
      let surface = surfaces.get(target.asset._uid);
      if (!surface) {
        const result = await paintCanvasForAsset(target.asset);
        if (!result) continue;
        const pixelCount = result.canvas.width * result.canvas.height;
        surface = {
          ...result, asset: target.asset,
          image: result.context.getImageData(0, 0, result.canvas.width, result.canvas.height),
          samples: new Float32Array(pixelCount * 4), counts: new Uint32Array(pixelCount)
        };
        surfaces.set(target.asset._uid, surface);
        pushTexturePaintHistory(target.asset, result.canvas, historyGroup);
      }
      const bounds = paintUvBounds(target.cube, target.faceName, surface.canvas);
      for (let y = bounds.minV; y < bounds.maxV; y++) for (let x = bounds.minU; x < bounds.maxU; x++) {
        const world = facePixelWorldPoint(target.cube, target.faceName, hit.facePoints, x, y);
        if (!world) continue;
        const pixel = y * surface.canvas.width + x;
        const projection = dot3(world.map((value, axis) => value - domain.anchor.point[axis]), direction);
        const rgba = samplePaintGradient((projection - minimum) / span, stops);
        const offset = pixel * 4;
        for (let channel = 0; channel < 3; channel++) surface.samples[offset + channel] += rgba[channel] * rgba[3];
        surface.samples[offset + 3] += rgba[3];
        surface.counts[pixel]++;
      }
    }
  }
  if (!surfaces.size) return toast('漸變範圍無效，或對應面沒有貼圖');
  for (const surface of surfaces.values()) {
    // Combine all mapped gradients against the original texture once. An
    // overlapping self-mapping must neither erase another mapping nor apply
    // the stroke opacity repeatedly. Premultiplied averaging is order-free.
    for (let pixel = 0; pixel < surface.counts.length; pixel++) {
      const count = surface.counts[pixel];
      if (!count) continue;
      const offset = pixel * 4, alphaSum = surface.samples[offset + 3];
      const rgba = [0, 1, 2].map(channel => alphaSum > 0 ? surface.samples[offset + channel] / alphaSum : 0);
      rgba.push(alphaSum / count);
      blendRgbaPixel(surface.image.data, offset, rgba, paintToolOpacity('gradient'));
    }
    surface.context.putImageData(surface.image, 0, 0);
    commitPaintedTextureAsset(surface.asset, surface.canvas);
    queuePaintedTextureSync(surface.asset, surface.canvas);
  }
  syncPaintedTextureNow();
  renderTextureList();
  renderScene();
}

function useScenePaintGradient(hit) {
  if (!state.paintGradientAnchor?.hit) {
    state.paintGradientAnchor = { hit };
    state.paintGradientHover = hit;
    renderPaintGradientPreview();
    toast(state.paintGradientMode === 'face' ? '選擇面漸變終點' : '選擇同一 Cube 上的終點');
    return;
  }
  const anchor = state.paintGradientAnchor.hit;
  const sameCube = (hit.cubeUid || hit.uid) === (anchor.cubeUid || anchor.uid);
  const sameFace = sameCube && hit.faceName === anchor.faceName;
  if (!sameCube || (state.paintGradientMode === 'face' && !sameFace)) {
    toast(state.paintGradientMode === 'face' ? '面漸變的第二點必須在同一個面' : '體漸變的第二點必須在同一個 Cube');
    return;
  }
  clearPaintGradientSelection();
  bakePaintGradient(anchor, hit);
}

function cloneCanvas(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.naturalWidth || source.width;
  canvas.height = source.naturalHeight || source.height;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0);
  return { canvas, context };
}

async function paintCanvasForAsset(asset) {
  if (asset.layers?.length) {
    await prepareLayers(asset);
    return cloneCanvas(layerRasterCache.get(activeLayer(asset).uid).canvas);
  }
  const image = await loadTextureAssetImage(asset);
  return image ? cloneCanvas(image) : null;
}

function paintHitVisibleAtStart(hit, drag = null) {
  const target = facePaintTarget(hit);
  if (!target) return true;
  const layer = activeLayer(target.asset);
  const raster = (layer && layerRasterCache.get(layer.uid)?.canvas)
    || animationRasterCache.get(target.asset._uid)?.canvas;
  if (!raster) return true;
  const snapshot = drag?.paintHitAlphaSnapshots || paintHitAlphaCache;
  let cached = snapshot.get(target.asset._uid);
  if (!cached || (!drag && cached.canvas !== raster)) {
    cached = { canvas: raster, pixels: raster.getContext('2d').getImageData(0, 0, raster.width, raster.height).data };
    snapshot.set(target.asset._uid, cached);
  }
  const point = facePaintUvPoint(hit, target, cached.canvas);
  if (!point) return true;
  return cached.pixels[(point[1] * cached.canvas.width + point[0]) * 4 + 3] !== 0;
}

function paintHitAlphaSnapshot() {
  return new Map([...paintHitAlphaCache].filter(([uid, cached]) => {
    const asset = state.textureAssets.find(entry => entry._uid === uid);
    const layer = activeLayer(asset);
    return cached.canvas === ((layer && layerRasterCache.get(layer.uid)?.canvas)
      || animationRasterCache.get(uid)?.canvas);
  }));
}

function scenePaintHit(clientX, clientY, drag = null) {
  const rect = sceneCanvas.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  let hit, hits = [];
  if (state.paintIgnoreTransparent) {
    const ordered = sceneRenderer.pickCoincident(state.project, x, y, true, true);
    hit = ordered.find(candidate => paintHitVisibleAtStart(candidate, drag)) || null;
    if (hit && state.tool === 'brush' && state.paintBrushOverlay) {
      const tolerance = Math.max(1e-5, Math.abs(hit.distance) * 1e-6);
      hits = ordered.filter(candidate => Math.abs(candidate.distance - hit.distance) <= tolerance
        && Math.abs(dot3(candidate.normal, hit.normal)) >= .99999
        && paintHitVisibleAtStart(candidate, drag));
    }
  } else {
    hits = state.tool === 'brush' && state.paintBrushOverlay
      ? sceneRenderer.pickCoincident(state.project, x, y, true) : [];
    hit = hits[0] || sceneRenderer.pickDetailed(state.project, x, y, true);
  }
  if (!hit?.faceName) return null;
  if (drag && !drag.multiSurface && (hit.uid !== drag.uid
    || (hit.cubeUid || hit.uid) !== (drag.cubeUid || drag.uid)
    || hit.faceName !== drag.faceName)) return null;
  if (hits.length > 1) hit.coincidentHits = hits;
  return hit;
}

function ensureScenePaintAssetSurface(drag, asset) {
  if (drag.assetSurfaces.has(asset._uid)) return Promise.resolve(drag.assetSurfaces.get(asset._uid));
  if (drag.assetSurfacePromises.has(asset._uid)) return drag.assetSurfacePromises.get(asset._uid);
  const promise = paintCanvasForAsset(asset).then(result => {
    drag.assetSurfacePromises.delete(asset._uid);
    if (!result) return null;
    const surface = { ...result, asset, rootDrag: drag };
    surface.baseSurface = surface;
    drag.assetSurfaces.set(asset._uid, surface);
    return surface;
  });
  drag.assetSurfacePromises.set(asset._uid, promise);
  return promise;
}

async function sceneBrushSurfaceForHit(drag, hit) {
  const target = facePaintTarget(hit);
  if (!target) return null;
  const base = await ensureScenePaintAssetSurface(drag, target.asset);
  if (!base) return null;
  const clip = paintUvBounds(target.cube, target.faceName, base.canvas);
  const surface = {
    ...base, baseSurface: base, rootDrag: drag, clip,
    tool: drag.tool,
    cube: target.cube, faceName: target.faceName,
    paintFace: { cube: target.cube, faceName: target.faceName, facePoints: hit.facePoints },
    depthEdges: []
  };
  if (state.paintBrushDepth > 0 && !isFaceTiled(target.cube.faces?.[target.faceName])) {
    const neighbors = paintFaceDepthNeighbors(hit, target);
    for (const neighbor of neighbors) {
      const asset = adjacentPaintFaceAsset(target.cube, neighbor.faceName);
      if (!asset) continue;
      const neighborSurface = await ensureScenePaintAssetSurface(drag, asset);
      if (neighborSurface) surface.depthEdges.push({ ...neighbor, surface: neighborSurface });
    }
  }
  return surface;
}

function paintSymmetryScopeUids(owner) {
  return new Set(owner?.type === 'group' ? state.project.getDescendantElementUids(owner.uid) : owner ? [owner.uid] : []);
}

function paintSymmetryFaceKey(face) {
  return `${face.uid}::${face.cubeUid || face.uid}::${face.faceName}`;
}

function paintSymmetryFaceRecords(owner) {
  return sceneRenderer.getFaceQuadsForUids(paintSymmetryScopeUids(owner)).flatMap(face => {
    const cube = face.cube?.type === 'cube' ? face.cube : state.project.getNode(face.uid);
    if (cube?.type !== 'cube' || isCubeFaceCulled(cube.faces?.[face.faceName])) return [];
    const uvSlots = faceUvPixelSlots(cube, face.faceName);
    if (!uvSlots) return [];
    return [{ ...face, cube, uvSlots, key: paintSymmetryFaceKey(face) }];
  });
}

function paintSymmetryFramePoint(frame, point) {
  const offset = point.map((value, axis) => value - frame.origin[axis]);
  return frame.axes.map(axis => dot3(offset, axis));
}

function paintSymmetryWorldPoint(frame, point) {
  return frame.origin.map((value, axis) => value
    + frame.axes[0][axis] * point[0]
    + frame.axes[1][axis] * point[1]
    + frame.axes[2][axis] * point[2]);
}

function paintSymmetryTransforms(operator) {
  const transforms = [];
  if (operator.mode === 'axes') {
    const enabled = ['x', 'y', 'z'].map(axis => operator.axes?.[axis] === true);
    for (let mask = 1; mask < 8; mask++) {
      if ([0, 1, 2].some(axis => (mask & (1 << axis)) && !enabled[axis])) continue;
      transforms.push(point => point.map((value, axis) => mask & (1 << axis) ? -value : value));
    }
    return transforms;
  }
  const angles = symmetryModifierAngles(operator);
  const rotate = (point, degrees) => {
    const angle = degrees * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
    return [point[0] * cosine + point[2] * sine, point[1], -point[0] * sine + point[2] * cosine];
  };
  for (const degrees of angles) {
    if (Math.abs(((degrees % 360) + 360) % 360) > 1e-6) transforms.push(point => rotate(point, degrees));
    if (operator.mode === 'mandala') {
      // R(angle) composed with reflection across local X gives a reflection
      // axis at half that angle, producing all N distinct mandala reflections.
      const angle = -degrees * Math.PI / 360;
      const axis = [Math.cos(angle), Math.sin(angle)];
      transforms.push(point => {
        const projection = point[0] * axis[0] + point[2] * axis[1];
        return [2 * axis[0] * projection - point[0], point[1], 2 * axis[1] * projection - point[2]];
      });
    }
  }
  return transforms;
}

function paintSymmetryPermutation(points, candidate, tolerance) {
  const used = new Set(), permutation = [];
  for (const point of points) {
    let best = -1, distance = Infinity;
    for (let index = 0; index < candidate.length; index++) {
      if (used.has(index)) continue;
      const next = Math.hypot(...point.map((value, axis) => value - candidate[index][axis]));
      if (next < distance) { distance = next; best = index; }
    }
    if (best < 0 || distance > tolerance) return null;
    used.add(best); permutation.push(best);
  }
  return permutation;
}

function paintSymmetryUvEdgesMatch(source, target, permutation) {
  const edgeKey = (first, second) => first < second ? `${first}:${second}` : `${second}:${first}`;
  const targetEdges = new Set(PAINT_FACE_EDGES.map(edge => edgeKey(edge[0], edge[1])));
  return PAINT_FACE_EDGES.every(([first, second]) => {
    const targetFirst = permutation[first], targetSecond = permutation[second];
    if (!targetEdges.has(edgeKey(targetFirst, targetSecond))) return false;
    const sourceLength = Math.hypot(source.uvSlots[first][0] - source.uvSlots[second][0], source.uvSlots[first][1] - source.uvSlots[second][1]);
    const targetLength = Math.hypot(target.uvSlots[targetFirst][0] - target.uvSlots[targetSecond][0], target.uvSlots[targetFirst][1] - target.uvSlots[targetSecond][1]);
    return Math.abs(sourceLength - targetLength) <= Math.max(1e-4, Math.max(sourceLength, targetLength) * 1e-5);
  });
}

function paintSymmetryCenterKey(points) {
  return [0, 1, 2].map(axis => Math.round(points.reduce((sum, point) => sum + point[axis], 0) / points.length * 1e4)).join(':');
}

function paintSymmetryCacheSignature(owner, operator, records, frame) {
  const geometry = records.map(record => `${record.key}:${record.facePoints.map(point => paintSymmetryFramePoint(frame, point).map(value => value.toFixed(4)).join(',')).join(';')}:${record.uvSlots.map(point => point.map(value => Number(value).toFixed(4)).join(',')).join(';')}`).sort();
  return JSON.stringify({
    owner: owner.uid, mode: operator.mode, axes: operator.axes, copies: operator.copies,
    distribution: operator.distribution, rangeStart: operator.rangeStart, rangeEnd: operator.rangeEnd,
    geometry
  });
}

function buildPaintSymmetryRelationsForFace(cache, key) {
  if (cache.relations.has(key)) return cache.relations.get(key);
  const source = cache.records.get(key);
  if (!source) return [];
  const relations = [];
  const seen = new Set();
  const coordinateScale = Math.max(1, ...source.facePoints.flatMap(point => point.map(value => Math.abs(value))));
  const tolerance = Math.max(1e-4, coordinateScale * 1e-5);
  for (const transform of cache.transforms) {
    const transformed = source.facePoints.map(point => paintSymmetryWorldPoint(cache.frame,
      transform(paintSymmetryFramePoint(cache.frame, point))));
    const candidates = cache.centerBuckets.get(paintSymmetryCenterKey(transformed)) || [];
    for (const target of candidates) {
      const permutation = paintSymmetryPermutation(transformed, target.facePoints, tolerance);
      if (!permutation || !paintSymmetryUvEdgesMatch(source, target, permutation)) continue;
      if (source.key === target.key && permutation.every((slot, index) => slot === index)) continue;
      const relationKey = `${target.key}:${permutation.join('')}`;
      if (seen.has(relationKey)) continue;
      seen.add(relationKey);
      relations.push({ targetKey: target.key, permutation });
    }
  }
  cache.relations.set(key, relations);
  cache.relationCount += relations.length;
  return relations;
}

function beginPaintSymmetryBackgroundBuild(cache) {
  if (cache.building) return;
  cache.building = true;
  const keys = [...cache.records.keys()];
  let index = 0;
  const chunk = () => {
    const end = Math.min(keys.length, index + 10);
    while (index < end) buildPaintSymmetryRelationsForFace(cache, keys[index++]);
    if (index < keys.length) setTimeout(chunk, 0);
    else { cache.building = false; if (state.inspectorPage === 'operators') renderInspector(); }
  };
  setTimeout(chunk, 0);
}

function schedulePaintSymmetryBuild(owner, operator) {
  if (!owner || !operator?.enabled || paintSymmetryBuildScheduled.has(operator.uid)) return;
  paintSymmetryBuildScheduled.add(operator.uid);
  requestAnimationFrame(() => {
    paintSymmetryBuildScheduled.delete(operator.uid);
    if (operator.enabled && owner.operators?.includes(operator) && state.project.getNode(owner.uid) === owner) ensurePaintSymmetryCache(owner, operator);
  });
}

function scheduleAllPaintSymmetryBuilds() {
  for (const owner of [...(state.project.groups || []), ...(state.project.elements || [])]) {
    for (const operator of owner.operators || []) {
      if (operator.enabled && operator.type === 'paint_symmetry') schedulePaintSymmetryBuild(owner, operator);
    }
  }
}

function ensurePaintSymmetryCache(owner, operator, session = null) {
  const sessionCache = session?.paintSymmetryCaches?.get(operator.uid);
  if (sessionCache) return sessionCache;
  const frame = mirrorControllerWorldFrame(owner, operator);
  if (!frame) return null;
  const records = paintSymmetryFaceRecords(owner);
  const signature = paintSymmetryCacheSignature(owner, operator, records, frame);
  let cache = paintSymmetryRelationCache.get(operator.uid);
  if (cache?.signature === signature) {
    cache.frame = frame;
    cache.records = new Map(records.map(record => [record.key, record]));
    cache.centerBuckets = new Map();
    for (const record of records) {
      const key = paintSymmetryCenterKey(record.facePoints);
      const bucket = cache.centerBuckets.get(key) || [];
      bucket.push(record); cache.centerBuckets.set(key, bucket);
    }
    session?.paintSymmetryCaches?.set(operator.uid, cache);
    return cache;
  }
  cache = {
    signature, owner, operator, frame,
    records: new Map(records.map(record => [record.key, record])),
    relations: new Map(), transforms: paintSymmetryTransforms(operator),
    relationCount: 0, building: false
  };
  cache.centerBuckets = new Map();
  for (const record of records) {
    const key = paintSymmetryCenterKey(record.facePoints);
    const bucket = cache.centerBuckets.get(key) || [];
    bucket.push(record); cache.centerBuckets.set(key, bucket);
  }
  paintSymmetryRelationCache.set(operator.uid, cache);
  beginPaintSymmetryBackgroundBuild(cache);
  session?.paintSymmetryCaches?.set(operator.uid, cache);
  return cache;
}

function paintSymmetryOperatorsForUid(uidValue, session = null) {
  if (!session?.paintSymmetryOperatorScopes) {
    const owners = [...(state.project.groups || []), ...(state.project.elements || [])];
    const scopes = owners.flatMap(owner => {
      const operators = (owner.operators || []).filter(operator => operator.enabled && operator.type === 'paint_symmetry');
      return operators.length ? [{ owner, operators, uids: paintSymmetryScopeUids(owner) }] : [];
    });
    if (session) session.paintSymmetryOperatorScopes = scopes;
    else return scopes.filter(scope => scope.uids.has(uidValue)).flatMap(scope => scope.operators.map(operator => ({ owner: scope.owner, operator })));
  }
  return session.paintSymmetryOperatorScopes.filter(scope => scope.uids.has(uidValue))
    .flatMap(scope => scope.operators.map(operator => ({ owner: scope.owner, operator })));
}

function paintSymmetryMappedHit(sourceHit, sourceRecord, targetRecord, permutation) {
  const triangles = [[0, 2, 1], [2, 3, 1]];
  for (const indices of triangles) {
    const weights = barycentricPoint(sourceHit.point,
      sourceRecord.facePoints[indices[0]], sourceRecord.facePoints[indices[1]], sourceRecord.facePoints[indices[2]]);
    if (!weights) continue;
    const point = [0, 1, 2].map(axis => indices.reduce((sum, slot, index) =>
      sum + targetRecord.facePoints[permutation[slot]][axis] * weights[index], 0));
    return {
      uid: targetRecord.uid, cubeUid: targetRecord.cubeUid, cubeIndex: targetRecord.cubeIndex,
      cube: targetRecord.cube, faceName: targetRecord.faceName,
      facePoints: targetRecord.facePoints.map(entry => [...entry]), point,
      symmetryPermutation: (sourceHit.symmetryPermutation || [0, 1, 2, 3]).map(slot => permutation[slot]),
      symmetryInstanceKey: `${targetRecord.key}:${(sourceHit.symmetryPermutation || [0, 1, 2, 3]).map(slot => permutation[slot]).join(',')}`
    };
  }
  return null;
}

function paintSymmetryRelatedHits(hit, session = null) {
  const resultKey = paintHit => `${paintSymmetryFaceKey(paintHit)}:${(paintHit.symmetryPermutation || [0, 1, 2, 3]).join(',')}`;
  const result = new Map([[resultKey(hit), hit]]);
  const queue = [hit];
  while (queue.length) {
    const sourceHit = queue.shift();
    for (const { owner, operator } of paintSymmetryOperatorsForUid(sourceHit.uid, session)) {
      const cache = ensurePaintSymmetryCache(owner, operator, session);
      const sourceKey = paintSymmetryFaceKey(sourceHit);
      const sourceRecord = cache?.records.get(sourceKey);
      if (!sourceRecord) continue;
      // A face requested by a live stroke jumps ahead of the background build.
      for (const relation of buildPaintSymmetryRelationsForFace(cache, sourceKey)) {
        const targetRecord = cache.records.get(relation.targetKey);
        if (!targetRecord) continue;
        const mapped = paintSymmetryMappedHit(sourceHit, sourceRecord, targetRecord, relation.permutation);
        if (!mapped) continue;
        const key = resultKey(mapped);
        if (result.has(key)) continue;
        result.set(key, mapped); queue.push(mapped);
      }
    }
  }
  return [...result.values()];
}

function queueSceneBrushHit(drag, hit) {
  drag.queue = drag.queue.then(async () => {
    if (drag.canceled || !hit?.faceName) {
      drag.lastByFace.clear();
      return;
    }
    const directHits = drag.tool === 'brush' && state.paintBrushOverlay && hit.coincidentHits?.length ? hit.coincidentHits : [hit];
    const hits = [...new Map(directHits.flatMap(paintHit => paintSymmetryRelatedHits(paintHit, drag))
      .map(paintHit => [`${paintSymmetryFaceKey(paintHit)}:${(paintHit.symmetryPermutation || [0, 1, 2, 3]).join(',')}`, paintHit])).values()];
    const activeKeys = new Set();
    for (const paintHit of hits) {
      const surface = await sceneBrushSurfaceForHit(drag, paintHit);
      if (!surface || drag.canceled) continue;
      const point = facePaintUvPoint(paintHit, surface, surface.canvas);
      if (!point) continue;
      // Each concrete face owns its own UV-space cursor. This keeps a single
      // 3D stroke continuous while preventing lines between unrelated UVs.
      const faceKey = `${sceneBrushHitKey(paintHit)}::${surface.asset._uid}::${(paintHit.symmetryPermutation || [0, 1, 2, 3]).join(',')}`;
      const previousPoint = drag.lastByFace.get(faceKey);
      const wrapped = isFaceTiled(surface.cube.faces?.[surface.faceName]) && previousPoint
        && (Math.abs(previousPoint[0] - point[0]) > surface.canvas.width / 2 || Math.abs(previousPoint[1] - point[1]) > surface.canvas.height / 2);
      const previous = wrapped ? null : previousPoint;
      drawPaintSegment(surface, previous || point, point);
      drag.lastByFace.set(faceKey, point);
      activeKeys.add(faceKey);
    }
    for (const key of [...drag.lastByFace.keys()]) if (!activeKeys.has(key)) drag.lastByFace.delete(key);
  });
  return drag.queue;
}

function sceneBrushHitKey(hit) {
  return hit?.faceName ? `${hit.uid}::${hit.cubeUid || hit.uid}::${hit.faceName}` : '';
}

function sceneBrushBoundary(from, to, drag) {
  const fromKey = sceneBrushHitKey(from.hit), toKey = sceneBrushHitKey(to.hit);
  if (!fromKey || !toKey || fromKey === toKey) return null;
  let left = from, right = to;
  for (let iteration = 0; iteration < 11; iteration++) {
    const x = (left.x + right.x) / 2, y = (left.y + right.y) / 2;
    const hit = scenePaintHit(x, y, drag);
    const sample = { x, y, hit };
    if (sceneBrushHitKey(hit) === fromKey) left = sample;
    else right = sample;
  }
  return { before: left.hit, after: right.hit };
}

function queueSceneBrushPointer(drag, clientX, clientY) {
  const current = { x: clientX, y: clientY, hit: scenePaintHit(clientX, clientY, drag) };
  const previous = drag.lastPointerSample;
  if (!previous) {
    drag.lastPointerSample = current;
    queueSceneBrushHit(drag, current.hit);
    return;
  }
  const distance = Math.hypot(clientX - previous.x, clientY - previous.y);
  const sampleCount = Math.max(1, Math.min(128, Math.ceil(distance / 6)));
  let prior = previous;
  for (let index = 1; index <= sampleCount; index++) {
    const ratio = index / sampleCount;
    const sample = index === sampleCount ? current : {
      x: previous.x + (clientX - previous.x) * ratio,
      y: previous.y + (clientY - previous.y) * ratio
    };
    if (!sample.hit) sample.hit = scenePaintHit(sample.x, sample.y, drag);
    if (sceneBrushHitKey(prior.hit) !== sceneBrushHitKey(sample.hit)) {
      const boundary = sceneBrushBoundary(prior, sample, drag);
      if (boundary) {
        queueSceneBrushHit(drag, boundary.before);
        queueSceneBrushHit(drag, boundary.after);
      } else queueSceneBrushHit(drag, sample.hit);
    }
    if (index === sampleCount) queueSceneBrushHit(drag, sample.hit);
    prior = sample;
  }
  drag.lastPointerSample = current;
}

function finishScenePaintDrag(drag) {
  if (!drag || drag.finished) return;
  drag.finished = true;
  if (drag.multiSurface) {
    if (drag.lastPointerSample && drag.latestClient
      && (drag.lastPointerSample.x !== drag.latestClient[0] || drag.lastPointerSample.y !== drag.latestClient[1])) {
      queueSceneBrushPointer(drag, drag.latestClient[0], drag.latestClient[1]);
    }
    drag.queue.then(() => {
      if (drag.canceled) return;
      syncPaintedTextureNow();
      for (const surface of drag.touchedSurfaces) commitPaintedTextureAsset(surface.asset, surface.canvas);
      const lastSurface = [...drag.touchedSurfaces].at(-1);
      if (lastSurface && state.activeTextureUid !== lastSurface.asset._uid) {
        const index = state.textureAssets.findIndex(asset => asset._uid === lastSurface.asset._uid);
        if (index >= 0) activateProjectTexture(index);
      }
      renderScene();
    });
    return;
  }
  if (PAINT_SHAPE_TOOLS.includes(drag.tool) && drag.canvas) {
    finalizeScenePaintShapeSymmetry(drag);
    return;
  }
  if (!drag.canvas) return;
  syncPaintedTextureNow();
  commitPaintedTextureAsset(drag.asset, drag.canvas);
  if (state.activeTextureUid !== drag.asset._uid) {
    const index = state.textureAssets.findIndex(asset => asset._uid === drag.asset._uid);
    if (index >= 0) activateProjectTexture(index);
  }
  renderScene();
}

async function finalizeScenePaintShapeSymmetry(drag) {
  const endHit = drag.currentHit || drag.initialHit;
  const starts = paintSymmetryRelatedHits(drag.initialHit);
  const ends = paintSymmetryRelatedHits(endHit);
  const assets = new Map([[drag.asset._uid, {
    asset: drag.asset, canvas: drag.canvas, context: drag.context,
    baseImage: drag.baseImage, surfaces: []
  }]]);
  const sourceGroup = assets.get(drag.asset._uid);
  sourceGroup.surfaces.push({
    asset: drag.asset, canvas: drag.canvas, context: drag.context, baseImage: drag.baseImage,
    cube: drag.cube, faceName: drag.faceName, clip: drag.clip, tool: drag.tool,
    start: drag.start, end: drag.last || drag.start
  });
  for (let index = 1; index < starts.length; index++) {
    const startHit = starts[index];
    const endHitForTarget = ends[index] && paintSymmetryFaceKey(ends[index]) === paintSymmetryFaceKey(startHit)
      ? ends[index] : ends.find(hit => paintSymmetryFaceKey(hit) === paintSymmetryFaceKey(startHit));
    if (!endHitForTarget) continue;
    const target = facePaintTarget(startHit);
    if (!target) continue;
    let group = assets.get(target.asset._uid);
    if (!group) {
      const result = await paintCanvasForAsset(target.asset);
      if (!result) continue;
      group = {
        asset: target.asset, canvas: result.canvas, context: result.context,
        baseImage: result.context.getImageData(0, 0, result.canvas.width, result.canvas.height), surfaces: []
      };
      assets.set(target.asset._uid, group);
      pushTexturePaintHistory(target.asset, result.canvas);
    }
    const start = facePaintUvPoint(startHit, target, group.canvas);
    const end = facePaintUvPoint(endHitForTarget, target, group.canvas);
    if (!start || !end) continue;
    group.surfaces.push({
      asset: target.asset, canvas: group.canvas, context: group.context, baseImage: group.baseImage,
      cube: target.cube, faceName: target.faceName, clip: paintUvBounds(target.cube, target.faceName, group.canvas),
      tool: drag.tool, start, end
    });
  }
  for (const group of assets.values()) {
    group.context.putImageData(group.baseImage, 0, 0);
    group.strokeImage = null;
    group.strokeCoverage = null;
    const rootDrag = { holisticStroke: true, historyAssets: new Set([group.asset._uid]), touchedSurfaces: new Set(), historyGroup: null };
    group.rootDrag = rootDrag;
    group.baseSurface = group;
    for (const surface of group.surfaces) {
      surface.rootDrag = rootDrag;
      surface.baseSurface = group;
      drawPaintShape(surface, surface.end, false);
    }
    commitPaintedTextureAsset(group.asset, group.canvas);
    queuePaintedTextureSync(group.asset, group.canvas);
  }
  syncPaintedTextureNow();
  renderScene();
}

function moveScenePaintDrag(event, drag = state.dragging) {
  if (!drag || drag.type !== 'texture-paint-3d') return false;
  drag.latestClient = [event.clientX, event.clientY];
  if (drag.multiSurface) {
    queueSceneBrushPointer(drag, event.clientX, event.clientY);
    return true;
  }
  if (!drag.ready) return true;
  const hit = scenePaintHit(event.clientX, event.clientY, drag);
  const point = hit && facePaintUvPoint(hit, drag, drag.canvas);
  if (!point) {
    if (!PAINT_SHAPE_TOOLS.includes(drag.tool)) drag.last = null;
    return true;
  }
  if (PAINT_SHAPE_TOOLS.includes(drag.tool)) drawPaintShape(drag, point);
  else drawPaintSegment(drag, drag.last || point, point);
  drag.last = point;
  drag.currentHit = hit;
  return true;
}

function startScenePaintPointer(event, x, y) {
  const hit = scenePaintHit(event.clientX, event.clientY);
  if (state.tool === 'gradient') {
    if (!hit?.faceName) { toast('請指向一個 Cube 面'); return true; }
    const cube = hit.cube?.type === 'cube' ? hit.cube : state.project.getNode(hit.uid);
    const faceAsset = textureAssetForReference(cube?.faces?.[hit.faceName]?.texture);
    if (!faceAsset) { toast('這個面尚未分配貼圖，無法繪製'); return true; }
    event.preventDefault();
    useScenePaintGradient(hit);
    return true;
  }
  const target = facePaintTarget(hit);
  if (!target) {
    toast(hit?.faceName ? '這個面尚未分配貼圖，無法繪製' : '請指向一個 Cube 面');
    return true;
  }
  event.preventDefault();
  if (state.tool === 'fill') {
    (async () => {
      const related = paintSymmetryRelatedHits(hit);
      const seen = new Set();
      for (const paintHit of related) {
        const paintTarget = facePaintTarget(paintHit);
        if (!paintTarget) continue;
        const key = state.paintBucketScope === 'element'
          ? paintTarget.cube.uid
          : `${paintTarget.asset._uid}:${paintTarget.cube.uid}:${paintTarget.faceName}:${['color', 'contiguous'].includes(state.paintBucketScope) ? (paintHit.symmetryPermutation || [0, 1, 2, 3]).join(',') : 'face'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const result = await paintCanvasForAsset(paintTarget.asset);
        const point = result && facePaintUvPoint(paintHit, paintTarget, result.canvas);
        if (point) await applyTextureBucket(paintTarget.asset, point, { cube: paintTarget.cube, faceName: paintTarget.faceName });
      }
    })();
    return true;
  }
  if (state.tool === 'eyedropper') {
    paintCanvasForAsset(target.asset).then(result => {
      const point = result && facePaintUvPoint(hit, target, result.canvas);
      if (!point) return;
      const pixel = result.context.getImageData(point[0], point[1], 1, 1).data;
      setPaintColor(`#${[pixel[0], pixel[1], pixel[2]].map(value => value.toString(16).padStart(2, '0')).join('')}`, true);
      updateToolOptions();
    });
    return true;
  }
  sceneCanvas.setPointerCapture(event.pointerId);
  if (state.tool === 'brush') {
    const drag = {
      type: 'texture-paint-3d', multiSurface: true, pointerId: event.pointerId, tool: state.tool,
      latestClient: [event.clientX, event.clientY], queue: Promise.resolve(),
      assetSurfaces: new Map(), assetSurfacePromises: new Map(), historyAssets: new Set(), touchedSurfaces: new Set(),
      paintSymmetryCaches: new Map(), paintSymmetryOperatorScopes: null,
      historyGroup: crypto.randomUUID(), last: null, lastFaceKey: null,
      lastByFace: new Map(),
      paintHitAlphaSnapshots: paintHitAlphaSnapshot(),
      holisticStroke: true, lastPointerSample: { x: event.clientX, y: event.clientY, hit },
      ready: true, ended: false, canceled: false, finished: false
    };
    state.dragging = drag;
    queueSceneBrushHit(drag, hit);
    return true;
  }
  const drag = {
    type: 'texture-paint-3d', pointerId: event.pointerId, uid: hit.uid,
    cubeUid: hit.cubeUid || hit.uid, faceName: hit.faceName,
    asset: target.asset, cube: target.cube, tool: state.tool,
    initialHit: hit, latestClient: [event.clientX, event.clientY],
    canvas: null, context: null, last: null, ready: false, ended: false, canceled: false, finished: false,
    holisticStroke: true,
    paintHitAlphaSnapshots: paintHitAlphaSnapshot(),
    historyAssets: new Set([target.asset._uid]), touchedSurfaces: new Set()
  };
  drag.rootDrag = drag;
  drag.baseSurface = drag;
  const face = target.cube.faces?.[target.faceName] || {};
  const faceUv = Array.isArray(face.uv) && face.uv.length >= 4
    ? face.uv : getBlockbenchBoxUv(target.cube, target.faceName);
  drag.clip = {
    minU: Math.floor(Math.min(faceUv[0], faceUv[2])), minV: Math.floor(Math.min(faceUv[1], faceUv[3])),
    maxU: Math.ceil(Math.max(faceUv[0], faceUv[2])), maxV: Math.ceil(Math.max(faceUv[1], faceUv[3]))
  };
  state.dragging = drag;
  paintCanvasForAsset(target.asset).then(result => {
    if (!result || drag.canceled) return;
    drag.canvas = result.canvas;
    drag.context = result.context;
    drag.clip = paintUvBounds(target.cube, target.faceName, drag.canvas);
    pushTexturePaintHistory(drag.asset, drag.canvas);
    drag.ready = true;
    const initial = facePaintUvPoint(drag.initialHit, drag, drag.canvas);
    if (initial) {
      drag.start = initial;
      if (PAINT_SHAPE_TOOLS.includes(drag.tool)) {
        drag.baseImage = drag.context.getImageData(0, 0, drag.canvas.width, drag.canvas.height);
        drawPaintShape(drag, initial);
      } else drawPaintSegment(drag, initial, initial);
      drag.last = initial;
    }
    if (!drag.ended) {
      const [clientX, clientY] = drag.latestClient;
      moveScenePaintDrag({ clientX, clientY }, drag);
    } else finishScenePaintDrag(drag);
  });
  return true;
}

function startTexturePointer(event) {
  if (![0, 1].includes(event.button)) return;
  event.preventDefault();
  cancelTextureFocus();
  setDockHotspotFocus('texture');
  const preview = $('#texturePreview');
  if (state.mode === 'paint' && event.button === 0 && PAINT_TOOLS.includes(state.tool)) {
    startTexturePaintPointer(event);
    return;
  }
  preview.setPointerCapture(event.pointerId);
  if (event.button === 1) {
    $('#textureBrushCursor').hidden = true;
    preview.style.cursor = '';
    textureUvDrag = { kind: 'pan', pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    preview.classList.add('is-panning');
    return;
  }
  const point = clientToTextureUv(event.clientX, event.clientY);
  const entries = textureUvEntries();
  let selectedEntries = selectedTextureUvEntries(entries);
  if (event.altKey && selectedEntries.length) {
    textureUvDrag = {
      kind: 'assign', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      startUv: point, currentUv: point, entries: selectedEntries, moved: false, blank: false, snapshotTaken: false
    };
    preview.style.cursor = 'crosshair';
    return;
  }
  const bounds = normalizedUvBounds(selectedEntries);
  const handle = textureUvHandleAt(point, bounds);
  const hit = textureUvHit(entries, point);
  if (!handle && hit) {
    const next = event.shiftKey || event.ctrlKey || event.metaKey
      ? new Set(state.selectedUvFaces)
      : new Set();
    if (event.ctrlKey || event.metaKey) next.has(hit.key) ? next.delete(hit.key) : next.add(hit.key);
    else next.add(hit.key);
    state.selectedUvFaces = next;
    selectedEntries = selectedTextureUvEntries(entries);
    renderTextureUvOverlay(true);
    updateFaceSelectionOverlay();
  }
  textureUvDrag = {
    kind: handle ? 'resize' : selectedEntries.length && (!hit || state.selectedUvFaces.has(hit.key)) ? 'move' : 'select',
    handle, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
    startUv: point, moved: false, blank: !hit && !handle, snapshotTaken: false
  };
}

function moveTexturePointer(event) {
  updateTextureBrushCursor(event);
  if (moveTexturePaintPointer(event)) return;
  if (state.mode === 'paint' && PAINT_TOOLS.includes(state.tool) && !textureUvDrag) return;
  if (!textureUvDrag) {
    updateTextureUvCursor(event);
    return;
  }
  if (textureUvDrag.pointerId !== event.pointerId) return;
  if (textureUvDrag.kind === 'pan') {
    const dx = event.clientX - textureUvDrag.x;
    const dy = event.clientY - textureUvDrag.y;
    textureUvDrag.x = event.clientX;
    textureUvDrag.y = event.clientY;
    textureUvDrag.moved ||= Math.hypot(dx, dy) > 0;
    state.textureView.panX += dx;
    state.textureView.panY += dy;
    updateTextureStageTransform();
    return;
  }
  if (!textureUvDrag.moved && Math.hypot(event.clientX - textureUvDrag.startX, event.clientY - textureUvDrag.startY) < 3) return;
  textureUvDrag.moved = true;
  if (textureUvDrag.kind === 'assign') {
    const [width, height] = texturePreviewSize;
    const point = clientToTextureUv(event.clientX, event.clientY);
    textureUvDrag.currentUv = [
      clamp(snapValue(point[0], event), 0, width),
      clamp(snapValue(point[1], event), 0, height)
    ];
    renderTextureUvOverlay(true);
    return;
  }
  if (textureUvDrag.kind === 'select') return;
  applyTextureUvDrag(event);
}

function onTexturePointerMove(event) {
  if (event.pointerType === 'pen' && texturePaintDrag
    && typeof event.getCoalescedEvents === 'function') {
    const samples = event.getCoalescedEvents();
    if (samples.length) {
      event.preventDefault();
      for (const sample of samples) moveTexturePaintPointer(sample);
      updateTextureBrushCursor(event);
      return;
    }
  }
  moveTexturePointer(event);
}

function endTexturePointer(event) {
  if (endTexturePaintPointer(event)) {
    updateTextureBrushCursor(event);
    return;
  }
  if (!textureUvDrag || textureUvDrag.pointerId !== event.pointerId) return;
  const drag = textureUvDrag;
  textureUvDrag = null;
  const preview = $('#texturePreview');
  if (preview.hasPointerCapture?.(event.pointerId)) preview.releasePointerCapture(event.pointerId);
  preview.classList.remove('is-panning');
  if (drag.kind === 'pan') {
    snapTexturePan();
    updateTextureStageTransform();
  } else if (drag.kind === 'assign' && drag.moved && drag.entries.length) {
    snapshot('core.uv.assign');
    materializeUvFaces(drag.entries);
    const [width, height] = texturePreviewSize;
    const u1 = clamp(snapValue(Math.min(drag.startUv[0], drag.currentUv[0]), event), 0, width);
    const v1 = clamp(snapValue(Math.min(drag.startUv[1], drag.currentUv[1]), event), 0, height);
    const u2 = clamp(snapValue(Math.max(drag.startUv[0], drag.currentUv[0]), event), 0, width);
    const v2 = clamp(snapValue(Math.max(drag.startUv[1], drag.currentUv[1]), event), 0, height);
    if (u2 > u1 && v2 > v1) drag.entries.forEach(entry => {
      entry.cube.faces[entry.faceName].uv = [u1, v1, u2, v2];
    });
    markDirty();
    invalidateSelectionRenderGeometry();
    renderTextureUvOverlay();
    scheduleSceneRender();
  } else if (!drag.moved && drag.blank) {
    state.selectedUvFaces = new Set();
    renderTextureUvOverlay(true);
    updateFaceSelectionOverlay();
  } else if (drag.snapshotTaken) {
    markDirty();
    renderAll('selection');
  }
  updateTextureUvCursor(event);
}

function updateTextureUvCursor(event) {
  const preview = $('#texturePreview');
  if (!textureViewLayout || !selectedTextureUvEntries().length) {
    preview.style.cursor = event?.altKey ? 'crosshair' : '';
    return;
  }
  if (event?.altKey) {
    preview.style.cursor = 'crosshair';
    return;
  }
  const point = clientToTextureUv(event.clientX, event.clientY);
  const selectedEntries = selectedTextureUvEntries();
  const bounds = normalizedUvBounds(selectedEntries);
  const handle = textureUvHandleAt(point, bounds);
  const cursors = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
  preview.style.cursor = cursors[handle]
    || (textureUvHit(selectedEntries, point) ? 'move' : '');
}

function wheelTextureView(event) {
  event.preventDefault();
  cancelTextureFocus();
  setDockHotspotFocus('texture');
  if (!textureViewLayout) updateTextureStageTransform();
  if (event.ctrlKey || event.metaKey) {
    const before = clientToTextureUv(event.clientX, event.clientY);
    state.textureView.zoom = Math.max(.05, Math.min(64, state.textureView.zoom * (event.deltaY > 0 ? .9 : 1.1)));
    updateTextureStageTransform();
    const after = clientToTextureUv(event.clientX, event.clientY);
    state.textureView.panX += (after[0] - before[0]) * textureViewLayout.scale;
    state.textureView.panY += (after[1] - before[1]) * textureViewLayout.scale;
  } else if (event.shiftKey) state.textureView.panX -= event.deltaY || event.deltaX;
  else if (textureViewLayout.textureHeight * textureViewLayout.scale > textureViewLayout.viewportHeight + 1) state.textureView.panY -= event.deltaY;
  snapTexturePan();
  updateTextureStageTransform();
  updateTextureBrushCursor(event);
}

function setUvCoordinate(coordinate, value) {
  const entries = selectedTextureUvEntries();
  if (!entries.length || !Number.isFinite(value)) return;
  snapshot('core.uv.coordinate');
  const maximum = coordinate % 2 === 0 ? texturePreviewSize[0] : texturePreviewSize[1];
  const nextValue = clamp(value, 0, maximum);
  materializeUvFaces(entries);
  entries.forEach(entry => { entry.cube.faces[entry.faceName].uv[coordinate] = nextValue; });
  markDirty();
  renderAll('selection');
  updateTextureStageTransform();
}

function syncTexturePreviewPriority() {
  const panel = dockManager?.get('texture');
  const element = panel?.element || $('[data-panel="texture"]');
  if (!element || element.hidden || element.classList.contains('is-collapsed')) return;
  const width = element.getBoundingClientRect().width || panel?.state.width || 236;
  const [textureWidth, textureHeight] = texturePreviewSize;
  const previewHeight = Math.max(1, width - 24) * textureHeight / textureWidth;
  element.style.setProperty('--texture-preview-priority-height', `${previewHeight}px`);
}

function nextPowerOfTwo(value) {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

function drawTextureAtlasEntry(source, entry) {
  if (!source || !entry) return;
  const { x, y, width, height } = entry;
  textureAtlasCtx.clearRect(x - 1, y - 1, width + 2, height + 2);
  textureAtlasCtx.drawImage(source, 0, 0, source.width, source.height, x, y, width, height);
  textureAtlasCtx.drawImage(source, 0, 0, source.width, 1, x, y - 1, width, 1);
  textureAtlasCtx.drawImage(source, 0, source.height - 1, source.width, 1, x, y + height, width, 1);
  textureAtlasCtx.drawImage(source, 0, 0, 1, source.height, x - 1, y, 1, height);
  textureAtlasCtx.drawImage(source, source.width - 1, 0, 1, source.height, x + width, y, 1, height);
  textureAtlasCtx.drawImage(source, 0, 0, 1, 1, x - 1, y - 1, 1, 1);
  textureAtlasCtx.drawImage(source, source.width - 1, 0, 1, 1, x + width, y - 1, 1, 1);
  textureAtlasCtx.drawImage(source, 0, source.height - 1, 1, 1, x - 1, y + height, 1, 1);
  textureAtlasCtx.drawImage(source, source.width - 1, source.height - 1, 1, 1, x + width, y + height, 1, 1);
}

function textureAtlasPatch(entry) {
  const width = entry.width + 2, height = entry.height + 2;
  textureAtlasPatchCanvas.width = width;
  textureAtlasPatchCanvas.height = height;
  textureAtlasPatchCtx.imageSmoothingEnabled = false;
  textureAtlasPatchCtx.clearRect(0, 0, width, height);
  textureAtlasPatchCtx.drawImage(textureAtlasCanvas, entry.x - 1, entry.y - 1, width, height, 0, 0, width, height);
  return textureAtlasPatchCanvas;
}

function textureAtlasReferences(asset, index) {
  return [asset._uid, asset.uuid, asset.id, String(index), asset.name]
    .filter(value => value !== undefined && value !== null)
    .map(String);
}

function rebuildTextureAtlas() {
  if (textureAtlasRebuildFrame !== null) return;
  textureAtlasRebuildFrame = requestAnimationFrame(() => {
    textureAtlasRebuildFrame = null;
    rebuildTextureAtlasNow();
  });
}

async function rebuildTextureAtlasNow() {
  const revision = ++textureAtlasRevision;
  const records = (await Promise.all(state.textureAssets.map(async (asset, index) => {
    const image = await loadTextureAssetImage(asset);
    if (!image) return null;
    const original = imageCanvas(image);
    animationRasterCache.set(asset._uid, { canvas: original, source: asset.source });
    const frame = flipbookFrame(asset, original, asset.animation?.currentFrame || 0);
    return { asset, index, image: frame, width: frame.width, height: frame.height };
  }))).filter(Boolean);
  if (revision !== textureAtlasRevision) return false;
  const tileKeys = new Set();
  for (const element of state.project.elements) {
    const cubes = element.type === 'cube' ? [element] : element.toCubes?.() || [];
    for (const cube of cubes) for (const faceName of CUBE_FACE_NAMES) {
      const asset = textureAssetForReference(cube.faces?.[faceName]?.texture);
      if (asset?.mode !== 'tiled' || isCubeFaceCulled(cube.faces?.[faceName])) continue;
      const source = records.find(record => record.asset === asset)?.image;
      if (!source) continue;
      for (const region of tiledFaceRegions(cube, faceName, source.width, source.height)) {
        const reference = tiledFaceReference(cube, faceName, asset, region);
        if (tileKeys.has(reference)) continue;
        tileKeys.add(reference);
        const image = tiledFaceRaster(cube, faceName, source, region);
        records.push({ asset: { _uid: reference }, index: -1, image, width: image.width, height: image.height,
          references: [reference], tileSourceUid: asset._uid, tileCube: cube, tileFaceName: faceName, tileRegion: region });
      }
    }
  }
  if (!records.length) {
    textureAtlasEntries = [];
    textureAtlasLayoutByUid = new Map();
    sceneRenderer.setTexture(textureCanvas);
    uvPreviewRenderer.setTexture(textureCanvas);
    return false;
  }
  const totalArea = records.reduce((sum, record) => sum + (record.width + 2) * (record.height + 2), 0);
  const widest = Math.max(...records.map(record => record.width + 2));
  const atlasWidth = nextPowerOfTwo(Math.max(widest, Math.ceil(Math.sqrt(totalArea))));
  const sorted = [...records].sort((left, right) => right.height - left.height || right.width - left.width);
  let cursorX = 0, cursorY = 0, rowHeight = 0;
  const packed = [];
  for (const record of sorted) {
    const outerWidth = record.width + 2, outerHeight = record.height + 2;
    if (cursorX > 0 && cursorX + outerWidth > atlasWidth) {
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = 0;
    }
    packed.push({
      uid: record.asset._uid, x: cursorX + 1, y: cursorY + 1,
      width: record.width, height: record.height,
      references: record.references || textureAtlasReferences(record.asset, record.index),
      mode: record.asset.mode || 'default',
      tileSourceUid: record.tileSourceUid, tileCube: record.tileCube, tileFaceName: record.tileFaceName, tileRegion: record.tileRegion,
      default: !record.tileSourceUid && (record.asset.useAsDefault === true || record.index === 0),
      source: record.image
    });
    cursorX += outerWidth;
    rowHeight = Math.max(rowHeight, outerHeight);
  }
  const atlasHeight = nextPowerOfTwo(cursorY + rowHeight);
  textureAtlasCanvas.width = atlasWidth;
  textureAtlasCanvas.height = atlasHeight;
  textureAtlasCtx.imageSmoothingEnabled = false;
  textureAtlasCtx.clearRect(0, 0, atlasWidth, atlasHeight);
  packed.forEach(entry => drawTextureAtlasEntry(entry.source, entry));
  textureAtlasEntries = packed.map(({ source, ...entry }) => entry);
  textureAtlasLayoutByUid = new Map(textureAtlasEntries.map(entry => [entry.uid, entry]));
  sceneRenderer.setTextureAtlas(textureAtlasCanvas, textureAtlasEntries);
  uvPreviewRenderer.setTextureAtlas(textureAtlasCanvas, textureAtlasEntries);
  scheduleSceneRender();
  refreshUvPreview();
  return true;
}

function syncRendererTextureAsset(asset, source, composited = false) {
  if (asset?.layers?.length) {
    if (!composited) source = compositeLayers(asset, source);
    updateLayerCompositePreview(asset, source);
  }
  if (asset && source) animationRasterCache.set(asset._uid, { canvas: imageCanvas(source), source: asset.source });
  if (asset?._uid && source) livePaintTextureSources.set(asset._uid, { source, savedSource: asset.source });
  const atlasEntry = asset && textureAtlasLayoutByUid.get(asset._uid);
  if (asset?.animation?.enabled && source) source = flipbookFrame(asset, imageCanvas(source), asset.animation.currentFrame || 0);
  let atlasPatch = null;
  if (atlasEntry && source?.width === atlasEntry.width && source?.height === atlasEntry.height) {
    textureAtlasRevision++;
    drawTextureAtlasEntry(source, atlasEntry);
    atlasPatch = textureAtlasPatch(atlasEntry);
    if (!sceneRenderer.updateTextureAtlasRegion(atlasPatch, atlasEntry.x - 1, atlasEntry.y - 1)) {
      sceneRenderer.setTextureAtlas(textureAtlasCanvas, textureAtlasEntries);
    }
  } else if (state.textureAssets.length) {
    if (source) sceneRenderer.setTexture(source);
    rebuildTextureAtlas();
  }
  else {
    textureAtlasRevision++;
    textureAtlasEntries = [];
    textureAtlasLayoutByUid = new Map();
    sceneRenderer.setTexture(source);
  }
  uvPreviewTextureDirty = true;
  uvPreviewRenderDirty = true;
  if (uvPreviewIsActive()) {
    if (atlasEntry && source?.width === atlasEntry.width && source?.height === atlasEntry.height) {
      if (!uvPreviewRenderer.updateTextureAtlasRegion(atlasPatch, atlasEntry.x - 1, atlasEntry.y - 1)) {
        uvPreviewRenderer.setTextureAtlas(textureAtlasCanvas, textureAtlasEntries);
      }
    } else if (source) uvPreviewRenderer.setTexture(source);
    uvPreviewTextureDirty = false;
  }
  scheduleSceneRender();
  if (asset && source) refreshDerivedTileEntries(asset, source);
}

function syncRendererTexture(source) {
  syncRendererTextureAsset(activeTextureAsset(), source);
}

function renderTexture() {
  textureLoadRevision++;
  updateLayerCompositePreview(null, null);
  const width = Math.max(1, Number(state.project.textureSize?.[0]) || 16);
  const height = Math.max(1, Number(state.project.textureSize?.[1]) || 16);
  textureCanvas.width = width;
  textureCanvas.height = height;
  textureCtx.imageSmoothingEnabled = false;
  textureCtx.fillStyle = '#fff';
  textureCtx.fillRect(0, 0, width, height);
  syncRendererTexture(textureCanvas);
  textureCtx.clearRect(0, 0, width, height);
  texturePreviewSize = [width, height];
  $('#texturePreview').style.setProperty('--texture-aspect', `${width} / ${height}`);
  $('.texture-preview > span').textContent = `無貼圖 · ${width} × ${height}`;
  syncTexturePreviewPriority();
  resetTextureView(false);
}

const paletteRows = [
  { id: crypto.randomUUID(), name: '苔原', gradient: false, marker: .5, colors: ['#172016','#273522','#3a4d2c','#526b35','#708d42','#91ad52','#b4ce68','#d3e18b','#e9efb3','#f5f5da','#c8a85a','#a77a3f','#76502f','#463324'] },
  { id: crypto.randomUUID(), name: '深潭', gradient: false, marker: .5, colors: ['#11191b','#1d2a29','#2b403a','#3b5b4c','#4b7560','#629178','#7aaf91','#9bc9aa','#c3dfc9','#f1f3dd','#8baab2','#587989','#365261','#263640'] },
  { id: crypto.randomUUID(), name: '暖岩', gradient: false, marker: .5, colors: ['#22191b','#402329','#663233','#8b443b','#b65e48','#d9805a','#eca875','#f6d09b','#f4e4c2','#8b705b','#66503e','#48382f','#2f2926','#1c1d19'] }
];
let selectedPaletteRowId = paletteRows[0].id;
let selectedPaletteColorIndex = null;
let draggedPaletteColor = null;

function renderPalette() {
  $('#paletteSummary').textContent = `${paletteRows.length} 行 · 每行獨立設定`;
  $('#paletteRows').innerHTML = paletteRows.map((row, index) => `
    <div class="palette-row-card ${selectedPaletteRowId === row.id ? 'selected' : ''}" data-palette-id="${row.id}">
      <div class="palette-row-controls">
        <span class="palette-row-name" title="${escapeAttribute(row.name)}">${escapeHtml(row.name)}</span>
        <label class="row-gradient-toggle" title="此行使用連續漸變">
          <input type="checkbox" data-gradient-row="${index}" ${row.gradient ? 'checked' : ''} /> 漸變
        </label>
        <button class="delete-palette-row" data-delete-row="${index}" title="刪除此行">×</button>
      </div>
      ${row.gradient
        ? row.colors.length ? `<div class="gradient-picker" data-gradient-picker="${index}" style="background:linear-gradient(90deg, ${row.colors.join(', ')})"><i class="gradient-marker" style="left:${insetControlPosition(row.marker)}"></i></div>`
          : `<div class="palette-empty">空色卡 · 先從選色器加入顏色</div>`
        : `<div class="palette-row" data-palette-row="${row.id}">${row.colors.length ? row.colors.map((color, colorIndex) => `<span class="swatch-item ${selectedPaletteRowId === row.id && selectedPaletteColorIndex === colorIndex ? 'selected' : ''}" draggable="true" data-palette-row-id="${row.id}" data-palette-color-index="${colorIndex}"><button class="swatch" data-color="${color}" style="background:${color}" title="${color}"></button><button class="swatch-delete" title="刪除顏色">×</button></span>`).join('') : `<span class="palette-empty">空色卡 · 從選色器加入顏色</span>`}</div>`}
    </div>`).join('');

  $$('.palette-row-card').forEach(card => card.addEventListener('pointerdown', () => {
    selectedPaletteRowId = card.dataset.paletteId;
    selectedPaletteColorIndex = null;
    $$('.palette-row-card').forEach(entry => entry.classList.toggle('selected', entry === card));
    $$('.swatch-item').forEach(entry => entry.classList.remove('selected'));
  }));
  $$('.swatch').forEach(swatch => swatch.addEventListener('click', event => {
    const item = event.currentTarget.closest('.swatch-item');
    selectedPaletteRowId = item.dataset.paletteRowId;
    selectedPaletteColorIndex = Number(item.dataset.paletteColorIndex);
    if (state.mode !== 'paint') snapshot('core.texture.palette');
    applyPaletteColor(swatch.dataset.color);
    renderPalette();
  }));
  $$('.swatch-delete').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const item = button.closest('.swatch-item');
    const row = paletteRows.find(entry => entry.id === item.dataset.paletteRowId);
    if (!row) return;
    row.colors.splice(Number(item.dataset.paletteColorIndex), 1);
    selectedPaletteRowId = row.id;
    selectedPaletteColorIndex = row.colors.length ? Math.min(Number(item.dataset.paletteColorIndex), row.colors.length - 1) : null;
    renderPalette();
  }));
  $$('.swatch-item').forEach(item => {
    item.addEventListener('dragstart', event => {
      const row = paletteRows.find(entry => entry.id === item.dataset.paletteRowId);
      if (!row || row.gradient) return event.preventDefault();
      draggedPaletteColor = { rowId: row.id, index: Number(item.dataset.paletteColorIndex) };
      event.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragover', event => { if (draggedPaletteColor) event.preventDefault(); });
    item.addEventListener('drop', event => {
      if (!draggedPaletteColor) return;
      event.preventDefault();
      const source = paletteRows.find(entry => entry.id === draggedPaletteColor.rowId);
      const target = paletteRows.find(entry => entry.id === item.dataset.paletteRowId);
      if (!source || !target || target.gradient) return;
      const [color] = source.colors.splice(draggedPaletteColor.index, 1);
      let targetIndex = Number(item.dataset.paletteColorIndex);
      if (source === target && draggedPaletteColor.index < targetIndex) targetIndex--;
      target.colors.splice(targetIndex, 0, color);
      selectedPaletteRowId = target.id;
      selectedPaletteColorIndex = targetIndex;
      draggedPaletteColor = null;
      renderPalette();
    });
    item.addEventListener('dragend', () => { draggedPaletteColor = null; });
  });
  $$('.palette-row').forEach(rowNode => {
    rowNode.addEventListener('dragover', event => { if (draggedPaletteColor) event.preventDefault(); });
    rowNode.addEventListener('drop', event => {
      if (!draggedPaletteColor || event.target.closest('.swatch-item')) return;
      const source = paletteRows.find(entry => entry.id === draggedPaletteColor.rowId);
      const target = paletteRows.find(entry => entry.id === rowNode.dataset.paletteRow);
      if (!source || !target || target.gradient) return;
      const [color] = source.colors.splice(draggedPaletteColor.index, 1);
      target.colors.push(color);
      selectedPaletteRowId = target.id; selectedPaletteColorIndex = target.colors.length - 1;
      draggedPaletteColor = null; renderPalette();
    });
  });
  $$('[data-gradient-row]').forEach(toggle => toggle.addEventListener('change', () => {
    paletteRows[Number(toggle.dataset.gradientRow)].gradient = toggle.checked;
    renderPalette();
  }));
  $$('[data-delete-row]').forEach(button => button.addEventListener('click', () => {
    if (paletteRows.length === 1) return toast('至少保留一行色卡');
    const removed = paletteRows.splice(Number(button.dataset.deleteRow), 1)[0];
    if (removed.id === selectedPaletteRowId) { selectedPaletteRowId = paletteRows[0].id; selectedPaletteColorIndex = null; }
    renderPalette();
  }));
  $$('[data-gradient-picker]').forEach(picker => {
    picker.addEventListener('pointerdown', event => {
      event.preventDefault();
      if (state.mode !== 'paint') snapshot('core.texture.palette');
      picker.setPointerCapture(event.pointerId);
      pickGradientColor(picker, event);
    });
    picker.addEventListener('pointermove', event => { if (picker.hasPointerCapture(event.pointerId)) pickGradientColor(picker, event); });
  });
  if (state.tool === 'gradient' && state.paintGradientPalette) renderPaintGradientPreview();
}

function addPaletteRow() {
  const number = paletteRows.length + 1;
  paletteRows.push({
    id: crypto.randomUUID(), name: `自定義 ${number}`, gradient: false, marker: .5,
    colors: []
  });
  selectedPaletteRowId = paletteRows.at(-1).id;
  selectedPaletteColorIndex = null;
  renderPalette();
  const rows = $('#paletteRows'); rows.scrollTop = rows.scrollHeight;
}

function pickGradientColor(picker, event) {
  const index = Number(picker.dataset.gradientPicker);
  const rect = picker.getBoundingClientRect();
  const ratio = insetControlRatio(event.clientX, rect.left, rect.width);
  paletteRows[index].marker = ratio;
  picker.querySelector('.gradient-marker').style.left = insetControlPosition(ratio);
  applyPaletteColor(sampleGradient(paletteRows[index].colors, ratio), false);
}

function sampleGradient(colors, ratio) {
  if (!colors.length) return state.paintColor;
  if (colors.length === 1) return colors[0];
  const scaled = ratio * (colors.length - 1);
  const left = Math.floor(scaled);
  const right = Math.min(colors.length - 1, left + 1);
  const amount = scaled - left;
  const a = hexToRgb(colors[left]), b = hexToRgb(colors[right]);
  return `#${a.map((channel, axis) => Math.round(channel + (b[axis] - channel) * amount).toString(16).padStart(2, '0')).join('')}`;
}

function addPaintSwatchToSelection() {
  const row = paletteRows.find(entry => entry.id === selectedPaletteRowId) || paletteRows[0];
  if (!row) return;
  const insertion = selectedPaletteColorIndex === null ? row.colors.length : selectedPaletteColorIndex + 1;
  row.colors.splice(insertion, 0, state.paintColor);
  selectedPaletteRowId = row.id;
  selectedPaletteColorIndex = insertion;
  renderPalette();
  toast(`已加入「${row.name}」 ${state.paintColor}`);
}

function applyPaletteColor(color, notify = true) {
  if (state.mode === 'paint') {
    setPaintColor(color, notify);
    return;
  }
  const item = selected();
  if (!item) return toast('先選擇一個物件');
  noteJournalOperation('core.element.color');
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
  noteJournalOperation('core.project.snap');
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
  renderTextureFeatureControls();
}

function addTextureGroup() {
  noteJournalOperation('core.texture.group');
  const group = { id: `texture_group_${crypto.randomUUID()}`, name: `貼圖組 ${state.textureGroups.length + 1}`, collapsed: false };
  state.textureGroups.push(group);
  const active = state.textureAssets.find(asset => asset._uid === state.activeTextureUid);
  if (active) active.groupId = group.id;
  renderTextureList();
  markDirty();
  toast('已新增貼圖組');
}

function updateLayerCompositePreview(asset, canvas) {
  if (asset && asset._uid !== state.activeTextureUid) return;
  const preview = $('#textureLayerComposite');
  const layered = Boolean(asset?.layers?.length);
  preview.hidden = !layered;
  textureCanvas.style.opacity = layered ? '0' : '';
  if (layered && canvas) {
    preview.width = canvas.width; preview.height = canvas.height;
    const context = preview.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(canvas, 0, 0);
  }
}

function selectedTilingFaces() {
  const targets = [];
  for (const key of state.selectedUvFaces) {
    const parsed = parseUvFaceKey(key);
    const cube = parsed && state.project.getNode(parsed.uid);
    if (cube?.type === 'cube') targets.push({ cube, faceName: parsed.faceName });
  }
  if (!targets.length) {
    const data = selectedUvFaceData(false);
    if (data?.cube && state.uvPreviewSelectedFace?.faceName) targets.push({ cube: data.cube, faceName: state.uvPreviewSelectedFace.faceName });
  }
  return targets;
}

function renderTextureTileControls() {
  const root = $('#textureTileControls');
  if (!root) return;
  const targets = selectedTilingFaces();
  if (!targets.length) { delete root.dataset.renderKey; root.innerHTML = '<span>在主視圖或 UV 預覽選中面</span>'; return; }
  const first = targets[0].cube.faces?.[targets[0].faceName]?.tiling || {};
  const key = JSON.stringify([targets.map(target => [target.cube.uid, target.faceName, isFaceTiled(target.cube.faces?.[target.faceName])]), first]);
  if (root.dataset.renderKey === key) return;
  root.dataset.renderKey = key;
  root.innerHTML = `<span>平鋪參數（${targets.length} 面；僅平鋪貼圖使用，換回普通貼圖仍保留）</span>
    <div class="texture-feature-grid">${[['width', '單片寬度', 16], ['height', '單片高度', 16], ['offsetX', 'X 偏移', 0], ['offsetY', 'Y 偏移', 0]].map(([property, label, fallback]) => `<label>${label}<input type="number" step="any" data-tile-field="${property}" value="${first[property] ?? fallback}"></label>`).join('')}</div>`;
  $$('[data-tile-field]', root).forEach(input => input.addEventListener('change', () => {
    const property = input.dataset.tileField;
    let value = input.type === 'checkbox' ? input.checked : Number(input.value);
    if (input.type !== 'checkbox' && !Number.isFinite(value)) return;
    if (property === 'width' || property === 'height') value = Math.max(.0001, value);
    snapshot('core.uv.tiling');
    for (const { cube, faceName } of targets) {
      const face = ensureCubeFaceRecord(cube, faceName);
      face.tiling ||= { width: 16, height: 16, offsetX: 0, offsetY: 0 };
      face.tiling[property] = value;
      persistGeneratedPaintCube(cube);
    }
    uvPreviewProjectCache = null; textureUvEntryCache = null;
    rebuildTextureAtlas(); markDirty(); renderAll('selection');
  }));
}

function refreshDerivedTileEntries(asset, source) {
  for (const entry of textureAtlasEntries) {
    if (entry.tileSourceUid !== asset._uid || !entry.tileCube) continue;
    const canvas = tiledFaceRaster(entry.tileCube, entry.tileFaceName, imageCanvas(source), entry.tileRegion);
    if (canvas.width !== entry.width || canvas.height !== entry.height) { rebuildTextureAtlas(); continue; }
    drawTextureAtlasEntry(canvas, entry);
    const patch = textureAtlasPatch(entry);
    sceneRenderer.updateTextureAtlasRegion(patch, entry.x - 1, entry.y - 1);
    if (uvPreviewIsActive()) uvPreviewRenderer.updateTextureAtlasRegion(patch, entry.x - 1, entry.y - 1);
    else uvPreviewTextureDirty = true;
  }
}

function scheduleTextureAnimation() {
  // Animation is an asset-mode placeholder; no frame loop is started.
}

async function refreshLayeredTexture(asset) {
  await prepareLayers(asset);
  const canvas = compositeLayers(asset);
  if (!canvas) return;
  asset.source = canvas.toDataURL('image/png');
  livePaintTextureSources.delete(asset._uid);
  animationRasterCache.set(asset._uid, { canvas, source: asset.source });
  updateLayerCompositePreview(asset, canvas);
  rebuildTextureAtlas();
  renderTextureList(); activateProjectTexture(state.textureAssets.indexOf(asset));
  markDirty();
}

async function addTextureLayer() {
  const asset = activeTextureAsset();
  if (!asset) return toast('請先建立或導入貼圖');
  pushTexturePaintHistory(asset, textureCanvas, null, 'core.texture.layer');
  if (!asset.layers?.length) {
    const raster = await loadRaster(asset.source);
    asset.uvWidth = raster.width; asset.uvHeight = raster.height;
    asset.layers = [{ uid: crypto.randomUUID(), name: '底圖', source: raster.toDataURL('image/png'), visible: true, opacity: 100 }];
  }
  await prepareLayers(asset);
  const canvas = document.createElement('canvas'); canvas.width = asset.uvWidth || textureCanvas.width; canvas.height = asset.uvHeight || textureCanvas.height;
  const layer = { uid: crypto.randomUUID(), name: `圖層 ${asset.layers.length + 1}`, source: canvas.toDataURL('image/png'), visible: true, opacity: 100 };
  asset.layers.push(layer); asset.activeLayerUid = layer.uid;
  await refreshLayeredTexture(asset);
}

function renderTextureFeatureControls() {
  const root = $('#textureFeatureControls'), asset = activeTextureAsset();
  if (!asset) { root.innerHTML = '<span>請先選擇貼圖</span>'; return; }
  root.innerHTML = `<button type="button" data-add-layer>＋ 圖層</button>${(asset.layers || []).map((layer, index) => `<div class="texture-layer-row">
    <input type="checkbox" data-layer-visible="${layer.uid}" ${layer.visible !== false ? 'checked' : ''} title="顯示圖層">
    <button type="button" data-layer-select="${layer.uid}" class="${activeLayer(asset)?.uid === layer.uid ? 'active' : ''}" title="選擇圖層">◇</button>
    <input type="text" data-layer-name="${layer.uid}" value="${escapeAttribute(layer.name)}" title="圖層名稱">
    <input type="number" min="0" max="100" value="${layer.opacity ?? 100}" data-layer-opacity="${layer.uid}" title="透明度 %">
    <button type="button" data-layer-up="${index}" title="上移" ${index === asset.layers.length - 1 ? 'disabled' : ''}>↑</button>
    <button type="button" data-layer-down="${index}" title="下移" ${index === 0 ? 'disabled' : ''}>↓</button>
    <button type="button" data-layer-delete="${layer.uid}" title="刪除圖層" ${asset.layers.length < 2 ? 'disabled' : ''}>×</button></div>`).reverse().join('')}
    <label>貼圖模式 <select data-texture-mode><option value="default" ${!asset.mode || asset.mode === 'default' ? 'selected' : ''}>默認</option><option value="tiled" ${asset.mode === 'tiled' ? 'selected' : ''}>平鋪</option><option value="animation" ${asset.mode === 'animation' ? 'selected' : ''}>動畫（佔位）</option></select></label>
    ${asset.mode === 'animation' ? '<span>動畫邏輯待完善，目前顯示原始貼圖。</span>' : ''}`;
  $('[data-texture-mode]', root).addEventListener('change', event => {
    noteJournalOperation('core.texture.mode');
    asset.mode = event.target.value;
    textureUvEntryCache = null;
    invalidateUvPreviewTextureState();
    rebuildTextureAtlas(); renderTextureFeatureControls(); renderTextureTileControls(); markDirty();
  });
  $('[data-add-layer]', root).addEventListener('click', () => addTextureLayer().catch(error => toast(error.message)));
  $$('[data-layer-select]', root).forEach(button => button.addEventListener('click', () => { noteJournalOperation('core.texture.layer'); asset.activeLayerUid = button.dataset.layerSelect; activateProjectTexture(state.textureAssets.indexOf(asset)); renderTextureFeatureControls(); markDirty(); }));
  $$('[data-layer-name]', root).forEach(input => input.addEventListener('change', () => {
    const layer = asset.layers.find(entry => entry.uid === input.dataset.layerName);
    noteJournalOperation('core.texture.layer'); layer.name = input.value.trim() || layer.name; markDirty();
  }));
  const mutate = async action => { pushTexturePaintHistory(asset, textureCanvas, null, 'core.texture.layer'); action(); await refreshLayeredTexture(asset); };
  $$('[data-layer-visible]', root).forEach(input => input.addEventListener('change', () => mutate(() => { asset.layers.find(layer => layer.uid === input.dataset.layerVisible).visible = input.checked; })));
  $$('[data-layer-opacity]', root).forEach(input => input.addEventListener('change', () => mutate(() => { asset.layers.find(layer => layer.uid === input.dataset.layerOpacity).opacity = clamp(Number(input.value), 0, 100); })));
  $$('[data-layer-up], [data-layer-down]', root).forEach(button => button.addEventListener('click', () => mutate(() => {
    const index = Number(button.dataset.layerUp ?? button.dataset.layerDown), next = index + (button.dataset.layerUp !== undefined ? 1 : -1);
    [asset.layers[index], asset.layers[next]] = [asset.layers[next], asset.layers[index]];
  })));
  $$('[data-layer-delete]', root).forEach(button => button.addEventListener('click', () => mutate(() => {
    asset.layers = asset.layers.filter(layer => layer.uid !== button.dataset.layerDelete);
    asset.activeLayerUid = activeLayer(asset)?.uid;
  })));

}

const TEMPLATE_FACE_COLORS = Object.freeze({
  up: { fill: '#ecf8fd', outline: '#b4d4e1' },
  down: { fill: '#6e788c', outline: '#536174' },
  east: { fill: '#7bffa3', outline: '#43e88d' },
  north: { fill: '#7bd4ff', outline: '#5bbcf4' },
  west: { fill: '#ffa7a4', outline: '#f48686' },
  south: { fill: '#fff899', outline: '#f8dd72' }
});

function textureAssetForReference(reference) {
  if (reference === null || reference === undefined) return null;
  const raw = String(reference);
  const normalized = raw.startsWith('#') ? raw.slice(1) : raw;
  return state.textureAssets.find((asset, index) => [asset._uid, asset.uuid, asset.id, String(index), asset.name]
    .filter(value => value !== undefined && value !== null).some(value => String(value) === normalized || String(value) === raw)) || null;
}

function isFaceTiled(face) {
  return textureAssetForReference(face?.texture)?.mode === 'tiled';
}

function remapNumericFaceTextureReferences(previousAssets) {
  if (!previousAssets?.length) return;
  for (const element of state.project.elements) {
    if (!element.faces) continue;
    for (const face of Object.values(element.faces)) {
      if (!face || (typeof face.texture !== 'number' && !/^\d+$/.test(String(face.texture)))) continue;
      const previous = previousAssets[Number(face.texture)];
      if (!previous) continue;
      const nextIndex = state.textureAssets.indexOf(previous);
      if (nextIndex < 0) delete face.texture;
      else face.texture = typeof face.texture === 'number' ? nextIndex : String(nextIndex);
    }
  }
  invalidateAllRenderGeometry();
}

function loadTextureAssetImage(asset) {
  const live = asset && livePaintTextureSources.get(asset._uid);
  if (live && live.savedSource === asset.source) return Promise.resolve(live.source);
  return new Promise(resolve => {
    if (!asset?.source) return resolve(null);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = asset.source;
  });
}

function templateCubeTargets(selectedOnly = false) {
  const targets = [];
  const selected = selectedOnly ? getSelectionExpansion().elementSet : null;
  for (const element of state.project.elements) {
    if (element.subdivisionOwnerUid) continue;
    if (element.type === 'cube') {
      if (selected && !selected.has(element.uid)) continue;
      targets.push({ cube: element, owner: null, index: -1 });
      continue;
    }
    if (!isProceduralShape(element)) continue;
    const cubes = subdivisionSession?.ownerUid === element.uid ? subdivisionSession.cubes : element.toCubes();
    cubes.forEach((cube, index) => {
      if (!selected || selected.has(element.uid) || selected.has(cube.uid)) targets.push({ cube, owner: element, index });
    });
  }
  return targets;
}

function facePixelSize(cube, faceName, subdivisions) {
  const axisPairs = {
    north: [0, 1], south: [0, 1], east: [2, 1], west: [2, 1], up: [0, 2], down: [0, 2]
  };
  const axes = axisPairs[faceName];
  const roundedPixelLength = value => {
    const length = Math.abs(Number(value) || 0);
    return length > 0 ? Math.max(1, Math.round(length)) : 0;
  };
  if (cube.uvNormalized !== false) return axes.map(axis => roundedPixelLength(Math.abs(Number(cube.size[axis]) || 0) * subdivisions / 16));
  const face = cube.faces?.[faceName];
  const uv = Array.isArray(face?.uv) && face.uv.length >= 4 ? face.uv : getBlockbenchBoxUv(cube, faceName);
  const uvLengths = [Math.abs(Number(uv[2]) - Number(uv[0])), Math.abs(Number(uv[3]) - Number(uv[1]))];
  return axes.map((axis, index) => {
    const geometryLength = Math.abs(Number(cube.size?.[axis]) || 0);
    if (geometryLength <= 1e-9) return 0;
    return Math.max(1, Math.round(uvLengths[index]));
  });
}

function cubeFaceHasZeroGeometry(cube, faceName) {
  const axisPairs = {
    north: [0, 1], south: [0, 1], east: [2, 1], west: [2, 1], up: [0, 2], down: [0, 2]
  };
  return axisPairs[faceName].some(axis => Math.abs(Number(cube.size?.[axis]) || 0) <= 1e-9);
}

function minimumTemplatePackingSide(rectangles, padding) {
  if (!rectangles.length) return 1;
  const dimensions = rectangles.map(entry => ({
    width: Math.max(1, entry.width) + padding,
    height: Math.max(1, entry.height) + padding
  }));
  const totalArea = dimensions.reduce((sum, entry) => sum + entry.width * entry.height, 0);
  return Math.max(
    Math.ceil(Math.sqrt(totalArea)),
    ...dimensions.map(entry => Math.max(entry.width, entry.height))
  );
}

function packTemplateRectangles(rectangles, padding, fixedSide = null) {
  if (!rectangles.length) return { placements: new Map(), side: 1 };
  const sorted = [...rectangles].sort((left, right) => right.width * right.height - left.width * left.height
    || Math.max(right.width, right.height) - Math.max(left.width, left.height));
  const paddedWidth = entry => Math.max(1, entry.width) + padding;
  const paddedHeight = entry => Math.max(1, entry.height) + padding;
  const totalArea = sorted.reduce((sum, entry) => sum + paddedWidth(entry) * paddedHeight(entry), 0);
  const widest = Math.max(...sorted.map(paddedWidth));
  const tallest = Math.max(...sorted.map(paddedHeight));
  const totalWidth = sorted.reduce((sum, entry) => sum + paddedWidth(entry), 0);
  const lowerBound = Math.max(widest, tallest, Math.ceil(Math.sqrt(totalArea)));
  const upperBound = Math.max(totalWidth, tallest);

  const strategies = ['diagonal', 'area'];
  const packIntoSquare = (side, strategy) => {
    const freeRectangles = [{ x: 0, y: 0, width: side, height: side }];
    const placements = new Map();
    for (const entry of sorted) {
      const width = paddedWidth(entry), height = paddedHeight(entry);
      let choice = null;
      for (const free of freeRectangles) {
        if (width > free.width || height > free.height) continue;
        const areaWaste = free.width * free.height - width * height;
        const shortWaste = Math.min(free.width - width, free.height - height);
        const longWaste = Math.max(free.width - width, free.height - height);
        const scores = {
          area: [areaWaste, shortWaste, Math.max(free.x, free.y), free.y, free.x],
          'short-side': [shortWaste, longWaste, areaWaste, free.y, free.x],
          diagonal: [Math.max(free.x, free.y), free.x + free.y, areaWaste, shortWaste],
          'top-left': [free.y, free.x, areaWaste, shortWaste]
        };
        const score = scores[strategy];
        if (!choice || score.some((value, index) => value < choice.score[index]
          && score.slice(0, index).every((prior, priorIndex) => prior === choice.score[priorIndex]))) {
          choice = { free, score };
        }
      }
      if (!choice) return null;
      const used = { x: choice.free.x, y: choice.free.y, width, height };
      placements.set(entry, { x: used.x, y: used.y });
      const split = [];
      for (const free of freeRectangles) {
        const separated = used.x >= free.x + free.width || used.x + used.width <= free.x
          || used.y >= free.y + free.height || used.y + used.height <= free.y;
        if (separated) {
          split.push(free);
          continue;
        }
        if (used.x > free.x) split.push({ x: free.x, y: free.y, width: used.x - free.x, height: free.height });
        if (used.x + used.width < free.x + free.width) split.push({
          x: used.x + used.width, y: free.y,
          width: free.x + free.width - used.x - used.width, height: free.height
        });
        if (used.y > free.y) split.push({ x: free.x, y: free.y, width: free.width, height: used.y - free.y });
        if (used.y + used.height < free.y + free.height) split.push({
          x: free.x, y: used.y + used.height,
          width: free.width, height: free.y + free.height - used.y - used.height
        });
      }
      freeRectangles.length = 0;
      for (let index = 0; index < split.length; index++) {
        const candidate = split[index];
        if (candidate.width <= 0 || candidate.height <= 0) continue;
        const contained = split.some((other, otherIndex) => {
          if (otherIndex === index) return false;
          const inside = candidate.x >= other.x && candidate.y >= other.y
            && candidate.x + candidate.width <= other.x + other.width
            && candidate.y + candidate.height <= other.y + other.height;
          const identical = candidate.x === other.x && candidate.y === other.y
            && candidate.width === other.width && candidate.height === other.height;
          return inside && (!identical || otherIndex < index);
        });
        if (!contained) freeRectangles.push(candidate);
      }
    }
    const compactness = sorted.reduce((score, entry) => {
      const placement = placements.get(entry);
      const width = paddedWidth(entry), height = paddedHeight(entry);
      return score + (placement.y * side + placement.x) * width * height;
    }, 0);
    return { placements, side, score: side * side, compactness };
  };

  const packAtSide = side => {
    let preferred = null;
    for (const strategy of strategies) {
      const packed = packIntoSquare(side, strategy);
      if (packed && (!preferred || packed.compactness < preferred.compactness)) preferred = packed;
    }
    return preferred;
  };

  if (fixedSide !== null) return packAtSide(Math.max(lowerBound, Math.ceil(fixedSide)));

  let low = lowerBound, high = upperBound, best = packAtSide(high);
  while (low <= high) {
    const side = Math.floor((low + high) / 2);
    const packed = packAtSide(side);
    if (packed) {
      best = packed;
      high = side - 1;
    } else {
      low = side + 1;
    }
  }
  return best;
}

function beginTextureGenerationProgress(totalFaces) {
  const dialog = $('#textureProgressDialog');
  const progressBar = $('#textureGenerationProgress');
  const status = $('#textureGenerationStatus');
  const counter = $('#textureGenerationCounter');
  const total = Math.max(1, Number(totalFaces) || 1);
  const startedAt = performance.now();
  const refreshEvery = Math.max(1, Math.ceil(total / 100));
  let processed = 0, nextRefresh = 0, shown = false, finished = false;
  progressBar.max = total;
  progressBar.value = 0;
  counter.textContent = `0 / ${totalFaces}`;
  dialog.oncancel = event => event.preventDefault();

  const refresh = async (label, force = false) => {
    if (finished || (!force && processed < nextRefresh)) return;
    nextRefresh = processed + refreshEvery;
    progressBar.value = Math.min(total, processed);
    status.textContent = label;
    counter.textContent = `${Math.min(totalFaces, processed)} / ${totalFaces}`;
    if (!shown && (totalFaces >= 180 || performance.now() - startedAt >= 180)) {
      if (!dialog.open) dialog.showModal();
      shown = dialog.open;
    }
    if (shown || force) await new Promise(resolve => setTimeout(resolve, 0));
  };

  return {
    prepare(label) { return refresh(label, true); },
    advance(label) { processed++; return refresh(label); },
    finish() {
      finished = true;
      progressBar.value = total;
      if (dialog.open) dialog.close();
    }
  };
}

function alignedTextureSide(side, powerOfTwo, multiple) {
  const size = Math.max(1, Math.ceil(side));
  if (powerOfTwo) return 2 ** Math.ceil(Math.log2(size));
  const unit = Math.max(1, Math.round(multiple) || 4);
  return Math.ceil(size / unit) * unit;
}

function drawTemplateFace(ctx, entry, destination, sourceImages) {
  const { width, height, sourceUv, sourceAsset, faceName } = entry;
  if (width <= 0 || height <= 0) return;
  const image = sourceAsset ? sourceImages.get(sourceAsset._uid) : null;
  if (image && sourceAsset.mode === 'tiled') {
    const raster = tiledFaceRaster(entry.target.cube, faceName, imageCanvas(image), null, [width, height]);
    ctx.drawImage(raster, destination.x, destination.y);
    return;
  }
  if (image && sourceUv) {
    const left = Math.min(sourceUv[0], sourceUv[2]);
    const top = Math.min(sourceUv[1], sourceUv[3]);
    const sourceWidth = Math.abs(sourceUv[2] - sourceUv[0]);
    const sourceHeight = Math.abs(sourceUv[3] - sourceUv[1]);
    if (sourceWidth > 0 && sourceHeight > 0) {
      ctx.drawImage(image, left, top, sourceWidth, sourceHeight, destination.x, destination.y, width, height);
      return;
    }
  }
  const faceColors = TEMPLATE_FACE_COLORS[faceName] || { fill: '#b7b7b7', outline: '#9f9f9f' };
  ctx.fillStyle = faceColors.fill;
  ctx.fillRect(destination.x, destination.y, width, height);
  ctx.strokeStyle = faceColors.outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(destination.x + .5, destination.y + .5, Math.max(0, width - 1), Math.max(0, height - 1));
}

function faceDestinationUv(entry, destination) {
  const source = entry.sourceUv || [0, 0, entry.width, entry.height];
  const uForward = source[2] >= source[0], vForward = source[3] >= source[1];
  return [
    uForward ? destination.x : destination.x + entry.width,
    vForward ? destination.y : destination.y + entry.height,
    uForward ? destination.x + entry.width : destination.x,
    vForward ? destination.y + entry.height : destination.y
  ];
}

function syncGeneratedTemplateEdits(targets) {
  const owners = new Set(targets.map(target => target.owner).filter(Boolean));
  for (const owner of owners) {
    const ownerTargets = targets.filter(target => target.owner === owner);
    const edits = { ...(owner.subdivisionEdits || {}) };
    for (const target of ownerTargets) {
      const patch = subdivisionPatch(owner, target.cube, target.index);
      if (patch) edits[target.index] = patch;
      else delete edits[target.index];
    }
    owner.subdivisionEdits = edits;
  }
  if (subdivisionSession) syncSubdivisionEdits();
}

function registerGeneratedTexture(canvas, name, kind) {
  const id = `texture_${crypto.randomUUID()}`;
  const asset = {
    _uid: id, uuid: id, id, name: name.toLowerCase().endsWith('.png') ? name : `${name}.png`,
    source: canvas.toDataURL('image/png'), uvWidth: canvas.width, uvHeight: canvas.height,
    kind, groupId: null, useAsDefault: state.textureAssets.length === 0
  };
  state.textureAssets.push(asset);
  state.activeTextureUid = asset._uid;
  state.project.textureSize = [canvas.width, canvas.height];
  invalidateUvPreviewTextureState();
  renderTextureList();
  activateProjectTexture(state.textureAssets.length - 1);
  markDirty();
  return asset;
}

async function createTextureTemplate(options) {
  const targets = templateCubeTargets(options.selectedOnly);
  if (!targets.length) return toast('目前沒有可建立模板的 Cube');
  const initialFaceCount = targets.reduce((count, target) => count + CUBE_FACE_NAMES.filter(faceName => {
    const face = target.cube.faces?.[faceName];
    return !isCubeFaceCulled(face);
  }).length, 0);
  if (!initialFaceCount) return toast('目前沒有可建立模板的面');
  const invalidFaces = [];
  const invalidFacesByCube = new WeakMap();
  if (options.cleanInvalidFaces) {
    for (const target of targets) {
      for (const faceName of CUBE_FACE_NAMES) {
        if (isCubeFaceCulled(target.cube.faces?.[faceName]) || !cubeFaceHasZeroGeometry(target.cube, faceName)) continue;
        invalidFaces.push({ target, faceName });
        const names = invalidFacesByCube.get(target.cube) || new Set();
        names.add(faceName);
        invalidFacesByCube.set(target.cube, names);
      }
    }
  }
  const cleanedFaceCount = invalidFaces.length;
  const faceCount = initialFaceCount - cleanedFaceCount;
  if (!faceCount) {
    snapshot('core.uv.cull_face');
    invalidFaces.forEach(({ target, faceName }) => setCubeFaceCulled(target.cube, faceName, true));
    syncGeneratedTemplateEdits(targets);
    invalidateAllRenderGeometry();
    markDirty();
    renderAll('all');
    return toast(cleanedFaceCount ? `已清理 ${cleanedFaceCount} 個無效面；沒有可建立模板的面` : '目前沒有可建立模板的面');
  }
  snapshot('core.texture.generate');
  const progress = beginTextureGenerationProgress(faceCount);
  try {
  await progress.prepare(`正在準備 ${faceCount} 個面…`);
  const subdivisions = activeSnapSubdivisions();
  const padding = options.paddingEnabled ? Math.max(0, Math.round(options.padding)) : 0;
  const sourceAssets = new Set();
  const rectangles = [];
  const assignments = [];
  const sharedEntries = new Map();
  const addFaceEntry = (target, faceName, width, height, boxEntry = null, offset = null) => {
    const cube = target.cube;
    const face = cube.faces?.[faceName];
    const sourceUv = Array.isArray(face?.uv) && face.uv.length >= 4 ? [...face.uv] : [...getBlockbenchBoxUv(cube, faceName)];
    const sourceAsset = textureAssetForReference(face?.texture);
    if (sourceAsset) sourceAssets.add(sourceAsset);
    const duplicateKey = !options.keepMultiTexture && !boxEntry
      ? `${sourceAsset?._uid || 'color'}:${faceName}:${sourceAsset?.mode === 'tiled' ? JSON.stringify([faceTileSize(cube, faceName), face?.tiling]) : sourceUv.join(',')}:${width}x${height}` : null;
    let entry = duplicateKey ? sharedEntries.get(duplicateKey) : null;
    if (!entry) {
      entry = boxEntry || { width, height, faceName, sourceUv, sourceAsset, targets: [] };
      if (!boxEntry) rectangles.push(entry);
      if (duplicateKey) sharedEntries.set(duplicateKey, entry);
    }
    const assignment = { target, faceName, width, height, sourceUv, sourceAsset, entry, offset };
    entry.targets.push(assignment);
    assignments.push(assignment);
  };
  for (const target of targets) {
    const cube = target.cube;
    const dimensions = cube.size.map(value => {
      const scaled = Math.abs(Number(value) || 0) * subdivisions / 16;
      return scaled > 0 ? Math.max(1, Math.round(scaled)) : 0;
    });
    if (options.boxUv && cube.uvNormalized !== false) {
      const [x, y, z] = dimensions;
      const boxEntry = { width: 2 * (x + z), height: y + z, faceName: 'north', sourceUv: null, sourceAsset: null, targets: [] };
      rectangles.push(boxEntry);
      const offsets = {
        east: [0, z, z, y], north: [z, z, x, y], west: [z + x, z, z, y], south: [z + x + z, z, x, y],
        up: [z, 0, x, z], down: [z + x, 0, x, z]
      };
      for (const faceName of CUBE_FACE_NAMES) {
        const face = cube.faces?.[faceName];
      if (isCubeFaceCulled(face) || invalidFacesByCube.get(cube)?.has(faceName)) continue;
        const [ox, oy, width, height] = offsets[faceName];
        addFaceEntry(target, faceName, width, height, boxEntry, { x: ox, y: oy });
      }
    } else {
      for (const faceName of CUBE_FACE_NAMES) {
        const face = cube.faces?.[faceName];
      if (isCubeFaceCulled(face) || invalidFacesByCube.get(cube)?.has(faceName)) continue;
        const [width, height] = facePixelSize(cube, faceName, subdivisions);
        addFaceEntry(target, faceName, width, height);
      }
    }
  }
  await progress.prepare('正在讀取已有紋理…');
  const sourceImages = new Map(await Promise.all([...sourceAssets].map(async asset => [asset._uid, await loadTextureAssetImage(asset)])));
  await progress.prepare('正在由大到小排列 UV…');
  let packingSide = minimumTemplatePackingSide(rectangles, padding);
  let packed = null;
  while (!packed && packingSide <= 8192) {
    packed = packTemplateRectangles(rectangles, padding, packingSide);
    if (!packed) packingSide += Math.max(1, Math.ceil(packingSide * .06));
  }
  const side = alignedTextureSide(packingSide, options.powerOfTwo, options.multiple);
  if (!packed || side > 8192) {
    state.history.pop();
    return toast(`模板尺寸 ${side} × ${side} 過大，請降低吸附分辨率或間隔`);
  }
  invalidFaces.forEach(({ target, faceName }) => setCubeFaceCulled(target.cube, faceName, true));
  const canvas = document.createElement('canvas');
  canvas.width = side; canvas.height = side;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, side, side);
  for (const assignment of assignments) {
    const placement = packed.placements.get(assignment.entry);
    if (placement) {
      const destination = assignment.offset
        ? { x: placement.x + assignment.offset.x, y: placement.y + assignment.offset.y }
        : { x: placement.x, y: placement.y };
      drawTemplateFace(ctx, { ...assignment, faceName: assignment.faceName }, destination, sourceImages);
      const cube = assignment.target.cube;
      cube.faces ||= {};
      const previous = cube.faces[assignment.faceName] || {};
      cube.faces[assignment.faceName] = { ...previous, uv: faceDestinationUv(assignment, destination) };
    }
    await progress.advance('正在繪製並分配 UV…');
  }
  const asset = registerGeneratedTexture(canvas, options.name, 'TEMPLATE');
  state.project.uvMode = options.boxUv ? 'box' : 'face';
  for (const target of targets) {
    target.cube.uvMode = options.boxUv ? 'box' : 'face';
    target.cube.autoUv = false;
    if (target.owner) {
      target.owner.uvMode = target.cube.uvMode;
      target.owner.autoUv = false;
    }
    for (const assignment of assignments.filter(entry => entry.target === target)) {
      target.cube.faces[assignment.faceName].texture = `#${asset.id}`;
    }
    const boxAssignment = assignments.find(assignment => assignment.target === target && assignment.offset);
    if (boxAssignment && assignments.filter(assignment => assignment.target === target).length === CUBE_FACE_NAMES.length) {
      const placement = packed.placements.get(boxAssignment.entry);
      target.cube.uv = [placement.x, placement.y];
    }
  }
  syncGeneratedTemplateEdits(targets);
  invalidateUvPreviewTextureState();
  invalidateAllRenderGeometry();
  renderAll('all');
  toast(`已建立 ${side} × ${side} 紋理模板${cleanedFaceCount ? `，並清理 ${cleanedFaceCount} 個無效面` : ''}`);
  } finally {
    progress.finish();
  }
}

function createSimpleTexture(options) {
  snapshot('core.texture.create');
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(options.width));
  canvas.height = Math.max(1, Math.round(options.height));
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (options.type === 'solid') {
    ctx.fillStyle = options.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  registerGeneratedTexture(canvas, options.name, options.type === 'solid' ? 'SOLID' : 'BLANK');
  renderScene();
  toast(`已建立 ${canvas.width} × ${canvas.height} ${options.type === 'solid' ? '純色模板' : '空白貼圖'}`);
}

function updateTextureCreateDialog() {
  const type = $('#textureCreateType').value;
  $('#textureTemplateOptions').hidden = type !== 'template';
  $('#textureBasicOptions').hidden = type === 'template';
  $('#textureColorField').hidden = type !== 'solid';
  $('#textureTemplateSummary').hidden = type !== 'template';
  $('#textureTemplateMultiple').disabled = $('#textureTemplatePowerOfTwo').checked;
  $('#textureTemplatePadding').disabled = !$('#textureTemplatePaddingEnabled').checked;
}

function openTextureCreateDialog() {
  $('#textureCreateWidth').value = String(state.project.textureSize?.[0] || 64);
  $('#textureCreateHeight').value = String(state.project.textureSize?.[1] || 64);
  $('#textureTemplateBoxUv').checked = state.project.uvMode === 'box';
  $('#textureTemplateSelectedOnly').checked = false;
  $('#textureTemplateSelectedOnly').disabled = selectedElementUids().length === 0;
  const subdivisions = activeSnapSubdivisions();
  $('#textureTemplateSummary').textContent = `目前按項目基礎吸附 ${formatNumber(subdivisions)} 計算：UV 像素 = round(Cube 尺寸 × ${formatNumber(subdivisions)} ÷ 16)，非零邊長最少 1px，再由大到小自左上角打包。`;
  updateTextureCreateDialog();
  $('#textureCreateDialog').showModal();
}

function importTexture(file) {
  if (!file) return;
  const revision = ++textureLoadRevision;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    if (revision !== textureLoadRevision) return;
    noteJournalOperation('core.texture.import');
    const asset = { _uid: textureUid(), name: file.name, source: url, uvWidth: image.naturalWidth, uvHeight: image.naturalHeight,
      kind: file.type.split('/')[1]?.toUpperCase() || 'IMAGE', groupId: null };
    state.textureAssets.push(asset);
    state.activeTextureUid = asset._uid;
    updateLayerCompositePreview(asset, null);
    textureCanvas.width = image.naturalWidth;
    textureCanvas.height = image.naturalHeight;
    textureCtx.imageSmoothingEnabled = false;
    textureCtx.clearRect(0, 0, image.naturalWidth, image.naturalHeight);
    textureCtx.drawImage(image, 0, 0);
    syncRendererTexture(textureCanvas);
    renderScene();
    renderTextureFeatureControls();
    updateTexturePreviewFrame(image.naturalWidth, image.naturalHeight);
    renderTextureList();
    rebuildTextureAtlas();
    markDirty();
    toast(`已導入貼圖 ${file.name}`);
  };
  image.onerror = () => { URL.revokeObjectURL(url); toast('無法讀取這張圖片'); };
  image.src = url;
}

function loadTextureSource(source, name) {
  const revision = ++textureLoadRevision;
  const image = new Image();
  image.onload = () => {
    if (revision !== textureLoadRevision) return;
    const asset = activeTextureAsset();
    if (asset) { asset.uvWidth = image.naturalWidth; asset.uvHeight = image.naturalHeight; }
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
    renderTextureFeatureControls();
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
  renderTextureFeatureControls();
  if (asset.layers?.length) prepareLayers(asset).then(() => {
    if (state.activeTextureUid !== asset._uid) return;
    loadTextureSource(activeLayer(asset).source, asset.name);
    updateLayerCompositePreview(asset, compositeLayers(asset));
  }).catch(error => toast(error.message));
  else { updateLayerCompositePreview(asset, null); loadTextureSource(asset.source, asset.name); }
  scheduleTextureAnimation();
}

function invalidateUvPreviewTextureState() {
  // Preview cubes copy their face records. Regenerate those copies whenever
  // template creation replaces UV rectangles or texture assignments.
  uvPreviewProjectCache = null;
  state.uvPreviewSelectedFace = null;
  uvPreviewTextureDirty = true;
  uvPreviewRenderDirty = true;
  uvPreviewRenderer.invalidateGeometry();
}

function toolSupportsMode(tool, mode = state.mode) {
  const registered = TOOL_REGISTRY[tool]?.modes.includes(mode);
  if (!registered) return false;
  if (tool === 'faceSelect') return state.separateUvMode ? mode === 'uv' : mode === 'edit';
  return mode !== 'uv';
}

function applyModePanelVisibility() {
  if (!dockManager) return;
  if (state.separateUvMode && state.mode === 'edit') {
    for (const id of ['texture', 'uvPreview']) {
      const panel = dockManager.get(id);
      if (panel) panel.element.hidden = true;
    }
    dockManager.refreshZones();
  }
}

function setMode(mode) {
  if (mode === 'uv' && !state.separateUvMode) mode = 'edit';
  if (mode === 'paint' && subdivisionSession) exitSubdivisionEdit(false);
  state.mode = mode;
  renderOutliner();
  document.body.dataset.editorMode = mode;
  if (mode !== 'paint') {
    $('#textureBrushCursor').hidden = true;
    $('#texturePreview').style.cursor = '';
  }
  if (mode !== 'animate' && state.timelinePlaying) stopTimeline();
  dockManager?.setMode(mode);
  applyModePanelVisibility();
  $$('.mode-tab').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  updateToolVisibility();
  if (!toolSupportsMode(state.tool, mode)) setTool(mode === 'paint' ? 'brush' : mode === 'uv' ? 'faceSelect' : 'move');
  $('#viewLabel').textContent = mode === 'paint' ? '三維繪畫' : mode === 'uv' ? 'UV 編輯' : mode === 'animate' ? '動畫預覽' : '實體著色';
  if (mode === 'paint') activateDock('palette');
  if (mode === 'animate') activateDock('timeline');
  renderInspector();
  renderScene();
  toast({ edit: '編輯模式', uv: 'UV 編輯模式', paint: '繪畫模式', animate: '動畫模式' }[mode]);
}

function updateToolVisibility() {
  $$('.tool[data-tool]').forEach(button => {
    button.hidden = !toolSupportsMode(button.dataset.tool);
    button.disabled = button.dataset.tool === 'knife' && Boolean(subdivisionSession);
    button.setAttribute('aria-disabled', String(button.disabled));
  });
}

function setTool(tool, { temporary = false } = {}) {
  if (!toolSupportsMode(tool) || (tool === 'knife' && subdivisionSession)) {
    if (tool === 'knife' && subdivisionSession) toast('細分編輯期間不能使用刀具');
    return;
  }
  if (!temporary && tool !== 'vertexSnap') state.vertexSnapSource = null;
  if (!temporary && tool !== 'knife') cancelKnifeSelection(false);
  if (!temporary && tool !== 'gradient') clearPaintGradientSelection();
  if (!temporary && tool === 'gradient' && state.tool !== 'gradient') {
    state.paintGradientStop = 'start';
    state.paintGradientStart = state.paintColor;
  }
  state.tool = tool;
  sceneCanvas.classList.toggle('is-knife', tool === 'knife');
  $$('.tool').forEach(button => button.classList.toggle('active', button.dataset.tool === tool));
  updateToolOptions();
  renderScene();
}

function beginTemporaryEyedropper() {
  if (temporaryPaintTool || state.mode !== 'paint' || state.tool === 'eyedropper'
    || state.dragging || texturePaintDrag || textureUvDrag) return false;
  temporaryPaintTool = state.tool;
  setTool('eyedropper', { temporary: true });
  return true;
}

function endTemporaryEyedropper() {
  if (!temporaryPaintTool) return false;
  const previous = temporaryPaintTool;
  temporaryPaintTool = null;
  if (state.mode === 'paint' && toolSupportsMode(previous, 'paint')) setTool(previous, { temporary: true });
  return true;
}

function updateToolOptions() {
  const lane = $('#toolOptionsLane');
  const labels = {
    move: '移動', resize: '縮放', rotate: '旋轉', pivot: '移動樞軸', vertexSnap: '頂點捕捉', knife: '刀具切割', faceSelect: '面選擇',
    brush: '畫筆', line: '直線', rectangle: '矩形', ellipse: '橢圓', fill: '油漆桶', gradient: '漸變', eyedropper: '取色器'
  };
  const paintTool = PAINT_TOOLS.includes(state.tool);
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
  $('#paintToolOptions').hidden = !paintTool;
  $('#paintEraseControl').hidden = !PAINT_ERASE_TOOLS.includes(state.tool);
  $('#paintEraseMode').checked = paintToolErasing();
  $('#paintBrushSize').disabled = ['eyedropper', 'fill', 'gradient'].includes(state.tool);
  $('#paintBrushOpacity').disabled = state.tool === 'eyedropper';
  $('#paintBucketScopeControl').hidden = state.tool !== 'fill';
  const brushTipTool = state.tool === 'brush';
  $('#paintBrushShapeControl').hidden = !brushTipTool;
  $('#paintBrushAaControl').hidden = !brushTipTool || state.paintBrushShape !== 'circle';
  $('#paintBrushDepthControl').hidden = state.tool !== 'brush';
  $('#paintBrushOverlayControl').hidden = state.tool !== 'brush';
  $('#paintBucketSingleFaceControl').hidden = state.tool !== 'fill'
    || !['color', 'contiguous'].includes(state.paintBucketScope);
  const gradientTool = state.tool === 'gradient';
  $('#paintGradientModeControl').hidden = !gradientTool;
  $('#paintGradientPaletteControl').hidden = !gradientTool;
  $('#paintGradientStartControl').hidden = !gradientTool;
  $('#paintGradientStartAlphaControl').hidden = !gradientTool;
  $('#paintGradientEndControl').hidden = !gradientTool;
  $('#paintGradientEndAlphaControl').hidden = !gradientTool;
  $('#paintGradientStartControl').disabled = state.paintGradientPalette;
  $('#paintGradientEndControl').disabled = state.paintGradientPalette;
  $('#paintGradientStartAlpha').disabled = state.paintGradientPalette;
  $('#paintGradientEndAlpha').disabled = state.paintGradientPalette;
  $('#snapButton').hidden = paintTool;
  const knifePreview = getKnifePreviewLabel();
  $('#knifeStatus').textContent = knifePreview ? `預覽：${knifePreview}` : state.knifeSelection ? '選擇橫切或豎切' : '選擇切割點';
  if (!lane.hidden) $('#toolContext').textContent = labels[state.tool];
  if (document.activeElement !== $('#paintColor')) $('#paintColor').value = state.paintColor;
  if (document.activeElement !== $('#paintBrushSize')) $('#paintBrushSize').value = String(paintSetting().size);
  if (document.activeElement !== $('#paintBrushShape')) $('#paintBrushShape').value = state.paintBrushShape;
  $('#paintBrushAa').checked = state.paintBrushAa;
  if (document.activeElement !== $('#paintBrushDepth')) $('#paintBrushDepth').value = String(state.paintBrushDepth);
  $('#paintBrushOverlay').checked = state.paintBrushOverlay;
  if (document.activeElement !== $('#paintBrushOpacity')) $('#paintBrushOpacity').value = String(paintSetting().opacity);
  if (document.activeElement !== $('#paintBucketScope')) $('#paintBucketScope').value = state.paintBucketScope;
  $('#paintBucketSingleFace').checked = state.paintBucketSingleFace;
  $('#paintGradientMode').value = state.paintGradientMode;
  $('#paintGradientPalette').checked = state.paintGradientPalette;
  $('#paintGradientStartControl').classList.toggle('active', state.paintGradientStop === 'start' && !state.paintGradientPalette);
  $('#paintGradientEndControl').classList.toggle('active', state.paintGradientStop === 'end' && !state.paintGradientPalette);
  $('#paintGradientStartControl').style.setProperty('--gradient-color', state.paintGradientStart);
  $('#paintGradientEndControl').style.setProperty('--gradient-color', state.paintGradientEnd);
  $('#paintGradientStartAlpha').value = String(state.paintGradientStartAlpha);
  $('#paintGradientEndAlpha').value = String(state.paintGradientEndAlpha);
  $('#paintBrushOpacityOutput').textContent = `${paintSetting().opacity}%`;
  $('#paintIgnoreTransparentToggle').checked = state.paintIgnoreTransparent;
  updateTransformSpaceButtons();
  updateRotationModeButtons();
  updateScaleHandleModeButtons();
  updateMultiTransformModeButtons();
  $$('[data-vertex-snap-mode]').forEach(button => button.classList.toggle('active', button.dataset.vertexSnapMode === state.vertexSnapMode));
  $$('[data-vertex-rotation-mode]').forEach(button => button.classList.toggle('active', button.dataset.vertexRotationMode === state.vertexSnapRotationMode));
}

const renderModeLabels = Object.freeze({ wireframe: '線框', solid: '體塊', textured: '紋理', normal: '法向' });

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
      loadProjectContent(result.content, result.filePath, result.textureAssets || [], result.journalId || null);
    } else fileInput.click();
  } catch (error) { toast(`打開失敗：${error.message}`); }
}

async function serializableTextureAssets(assets = state.textureAssets) {
  return Promise.all(assets.map(async texture => {
    if (!String(texture.source || '').startsWith('blob:')) return texture;
    let sourcePromise = blobTextureSourceCache.get(texture.source);
    if (!sourcePromise) {
      sourcePromise = fetch(texture.source).then(response => response.blob()).then(blob => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('貼圖轉換失敗'));
        reader.readAsDataURL(blob);
      }));
      blobTextureSourceCache.set(texture.source, sourcePromise);
    }
    const source = await sourcePromise;
    return { ...texture, source };
  }));
}

function serializeCbmodel(textureAssets = [], project = state.project) {
  const data = typeof project.serialize === 'function' ? JSON.parse(project.serialize()) : structuredClone(project);
  data.textures = textureAssets.map((texture, index) => ({
    uuid: texture.uuid || texture._uid || `texture_${index + 1}`,
    id: texture.id || String(index),
    name: texture.name || `texture_${index + 1}.png`,
    source: texture.source,
    mode: texture.mode || 'default',
    layers: texture.layers ? structuredClone(texture.layers) : null,
    active_layer_uid: texture.activeLayerUid || null,
    animation: texture.animation ? Object.fromEntries(Object.entries(texture.animation).filter(([key]) => !key.startsWith('_'))) : null,
    uv_width: texture.uvWidth || data.textureSize[0],
    uv_height: texture.uvHeight || data.textureSize[1],
    use_as_default: texture.useAsDefault === true,
    group_id: texture.groupId || null,
    kind: texture.kind || 'IMAGE'
  }));
  return JSON.stringify(data, null, 2);
}

function loadProjectContent(content, filePath = '', resolvedTextures = [], journalId = null, options = {}) {
  const data = JSON.parse(content);
  const project = filePath.toLowerCase().endsWith('.bbmodel') || data.meta?.model_format ? importBlockbench(data) : new CubeBricksProject(data);
  const savedPath = filePath.toLowerCase().endsWith('.cbmodel') ? filePath : null;
  const embeddedTextures = (data.textures || []).filter(texture => typeof texture.source === 'string' && texture.source.startsWith('data:image/')).map(texture => ({
    uuid: texture.uuid, id: texture.id, name: texture.name || 'embedded_texture.png', source: texture.source,
    uvWidth: texture.uv_width, uvHeight: texture.uv_height, useAsDefault: texture.use_as_default === true,
    groupId: texture.group_id || null, kind: texture.kind || 'IMAGE',
    mode: texture.mode || 'default',
    layers: texture.layers || null, activeLayerUid: texture.active_layer_uid || null, animation: texture.animation || null
  }));
  addProjectTab(project, {
    filePath: savedPath,
    displayName: filePath ? filePath.split(/[\\/]/).pop() : null,
    textureAssets: resolvedTextures.length ? resolvedTextures : embeddedTextures,
    dirty: options.dirty ?? !savedPath,
    journalId,
    imported: true
  });
  if (options.dirty !== undefined) {
    suppressJournalRecording = true;
    try { markDirty(options.dirty); } finally { suppressJournalRecording = false; }
  } else markDirty(!savedPath);
  toast(`已打開 ${project.name}`);
}

async function offerProjectRecovery() {
  if (!window.cubeBricksDesktop?.listRecoverableProjects) return;
  try {
    const projects = await window.cubeBricksDesktop.listRecoverableProjects();
    if (!projects.length) return;
    const prompt = projects.length === 1
      ? `找到未保存的工作項目「${projects[0].name}」。要恢復嗎？`
      : `找到 ${projects.length} 個未保存的工作項目。要全部恢復到分頁嗎？`;
    if (!window.confirm(prompt)) return;
    for (const project of projects) {
      const result = await window.cubeBricksDesktop.recoverProjectJournal(project);
      loadProjectContent(result.content, project.filePath || '', [], result.journalId, { dirty: true });
    }
    if (projects.length > 1) toast(`已恢復 ${projects.length} 個工作項目`);
  } catch (error) { toast(`工作項目恢復失敗：${error.message}`); }
}

async function saveProject(saveAs = false) {
  try {
    const activeTab = projectTabById(activeProjectTabId);
    await flushProjectJournal(activeTab);
    await activeTab?.journalWrites;
    const content = serializeCbmodel(await serializableTextureAssets());
    if (window.cubeBricksDesktop) {
      const result = await window.cubeBricksDesktop.saveProject({ filePath: saveAs ? null : state.filePath, name: state.project.name, content, journalId: activeTab?.journalId });
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
    const activeTab = projectTabById(activeProjectTabId);
    await flushProjectJournal(activeTab);
    await activeTab?.journalWrites;
    const textureAssets = await serializableTextureAssets();
    const cbmodelContent = serializeCbmodel(textureAssets);
    const bbmodelContent = JSON.stringify(exportBlockbench(state.project, textureAssets), null, 2);
    if (window.cubeBricksDesktop?.exportProject) {
      const result = await window.cubeBricksDesktop.exportProject({
        name: state.project.name, cbmodelContent, bbmodelContent, journalId: activeTab?.journalId
      });
      if (!result) return;
      toast(result.extension === '.cbmodel'
        ? '已導出 .cbmodel'
        : '已導出 .bbmodel（程序化物件已轉為 Cube 組）');
    } else if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${state.project.name}.bbmodel`,
        types: [
          { description: 'Blockbench Model', accept: { 'application/json': ['.bbmodel'] } },
          { description: 'CubeBricks Model', accept: { 'application/json': ['.cbmodel'] } }
        ]
      });
      const extension = handle.name.toLowerCase().endsWith('.cbmodel') ? '.cbmodel' : '.bbmodel';
      const writable = await handle.createWritable();
      await writable.write(extension === '.cbmodel' ? cbmodelContent : bbmodelContent);
      await writable.close();
      toast(`已導出 ${extension}`);
    } else {
      download(bbmodelContent, `${state.project.name}.bbmodel`, 'application/json');
      toast('已導出 .bbmodel（目前瀏覽器不支援格式選擇）');
    }
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
  if (id === ConfigKey.SEPARATE_UV_MODE) {
    state.separateUvMode = value;
    $('#uvModeTab').hidden = !value;
    if (!value && state.mode === 'uv') setMode('edit');
    else {
      updateToolVisibility();
      dockManager?.setMode(state.mode);
      applyModePanelVisibility();
      if (!toolSupportsMode(state.tool)) setTool(state.mode === 'uv' ? 'faceSelect' : 'move');
    }
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
  if (id === ConfigKey.ALPHA_LOCK) { state.alphaLock = value; $('#alphaLockToggle').checked = value; }
  if (id === ConfigKey.PREVIEW_SHADE) { state.previewShade = value; $('#previewShadeToggle').checked = value; }
  if (id === ConfigKey.SHOW_PLAYER_REFERENCE) { state.playerReference = value; $('#playerReferenceToggle').checked = value; }
  if (id === ConfigKey.PLAYER_REFERENCE_TEXTURE) updatePlayerReferenceTexture(value);
  if (id === ConfigKey.SHOW_GEOMETRY_ONLY) { state.geometryOnly = value; $('#geometryOnlyToggle').checked = value; }
  if (id === ConfigKey.MODIFIER_RESULT_GHOST) {
    state.modifierResultGhost = value;
    $('#modifierResultGhostToggle').checked = value;
    if (value && state.selectedGenerated) clearSelection();
  }
  if (id === ConfigKey.PROJECTION) {
    if (state.projection && state.projection !== value) {
      if (state.axisView && state.generalCamera) {
        state.generalCamera.zoom = mapProjectionZoom(state.generalCamera.zoom, state.projection, value);
      } else state.zoom = mapProjectionZoom(state.zoom, state.projection, value);
    }
    state.projection = value;
    updateProjectionControls();
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
      uvPreviewRenderDirty = true;
      const [textureWidth = 16, textureHeight = 16] = state.project.textureSize || [];
      syncUvPreviewPanelAspect(Math.max(1, Number(textureWidth) || 1), Math.max(1, Number(textureHeight) || 1));
      syncTexturePreviewPriority();
      scheduleOutlinerWindow();
      requestAnimationFrame(renderScene);
    }
  });
  dockManager.setMode(state.mode);
  applyModePanelVisibility();
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
  if (state.mode === 'paint') {
    showContextMenu(event, { title: node.name, source, items: [
      { icon: '⌖', label: '聚焦此物件', action: focusSelected }
    ] });
    return;
  }
  const selectedNodes = selectedNodeUids().map(id => state.project.getNode(id)).filter(Boolean);
  const allVisible = selectedNodes.every(entry => entry.visible);
  showContextMenu(event, {
    title: selectedNodes.length > 1 ? `已選 ${selectedNodes.length} 項` : node.name,
    source,
    items: [
      { icon: '⌖', label: '聚焦此物件', action: focusSelected },
      { icon: allVisible ? '○' : '◉', label: allVisible ? '隱藏選中項' : '顯示選中項', action: () => {
        snapshot('core.element.visibility'); selectedNodes.forEach(entry => setNodeVisibility(entry, !allVisible)); markDirty(); renderAll();
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
      ...(isProceduralShape(node) && state.mode !== 'paint' ? [{
        icon: subdivisionSession?.ownerUid === node.uid ? '◆' : '◇',
        label: subdivisionSession?.ownerUid === node.uid ? '完成細分編輯' : '進入細分編輯',
        action: () => subdivisionSession?.ownerUid === node.uid ? exitSubdivisionEdit() : enterSubdivisionEdit(node)
      }] : []),
      ...(node.subdivisionOwnerUid ? [{ icon: '◆', label: '完成細分編輯', action: () => exitSubdivisionEdit() }] : []),
      { separator: true },
      { icon: '□', label: '複製　Ctrl+C', action: copySelected },
      { icon: '✂', label: '剪切　Ctrl+X', action: cutSelected },
      { icon: '▣', label: '貼上　Ctrl+V', action: () => pasteElements() },
      { icon: '⧉', label: '複製元素　Ctrl+D', action: () => pasteElements({ inPlace: true }) },
      ...(node.subdivisionOwnerUid ? [] : [
        { separator: true },
        { icon: '×', label: '刪除選中項', danger: true, action: deleteSelected }
      ])
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
    const hit = sceneRenderer.pickDetailed(state.project, event.clientX - rect.left, event.clientY - rect.top,
      state.geometryOnly, { includeGenerated: !state.modifierResultGhost });
    if (hit?.generated) {
      showContextMenu(event, { title: '修改器結果 · 唯讀', items: [
        { icon: '⌖', label: '選擇來源物件', action: () => selectItem(hit.uid, { revealInOutliner: true }) }
      ] });
      return;
    }
    const hitUid = hit?.uid;
    if (hitUid) {
      showElementContextMenu(event, hitUid);
      return;
    }
    const activeCurve = selected();
    if (state.mode === 'paint') {
      showContextMenu(event, { title: state.project.name, items: [
        { icon: '⌖', label: '聚焦選中物件', action: focusSelected },
        { icon: '◎', label: '回到場景中心', action: focusSceneOrigin }
      ] });
      return;
    }
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
        { icon: '▣', label: '貼上　Ctrl+V', action: () => pasteElements() },
        ...(selectedNodeUids().length ? [{ icon: '⧉', label: '複製元素　Ctrl+D', action: () => pasteElements({ inPlace: true }) }] : []),
        { separator: true },
        { icon: '#', label: state.grid ? '隱藏網格' : '顯示網格', action: () => configRegistry.set(ConfigKey.SHOW_GRID, !state.grid, { source: 'viewport-context-menu' }) },
        { icon: '▧', label: state.wire ? '隱藏邊界線框' : '顯示邊界線框', action: () => configRegistry.set(ConfigKey.SHOW_WIREFRAME, !state.wire, { source: 'viewport-context-menu' }) }
      ]
    });
  });
  outliner.addEventListener('contextmenu', event => {
    if (state.mode === 'paint') {
      const row = event.target.closest('.outliner-item');
      if (row) showElementContextMenu(event, row.dataset.uid, row);
      else showContextMenu(event, { title: state.project.name, source: outliner, items: [
        { icon: '⌖', label: '聚焦選中物件', action: focusSelected }
      ] });
      return;
    }
    const item = event.target.closest('.outliner-item');
    if (!item) {
      showContextMenu(event, { title: state.project.name, source: outliner, items: [
        { icon: '▣', label: '貼上　Ctrl+V', action: () => pasteElements() },
        ...(selectedNodeUids().length ? [{ icon: '⧉', label: '複製元素　Ctrl+D', action: () => pasteElements({ inPlace: true }) }] : [])
      ] });
      return;
    }
    if (item.dataset.curveNodeIndex !== undefined) {
      const curve = state.project.getNode(item.dataset.uid);
      const index = Number(item.dataset.curveNodeIndex);
      if (!isBezierElement(curve) || !curve.nodes[index]) return;
      state.selectedUid = curve.uid;
      state.selectedUids = new Set([curve.uid]);
      state.selectionAnchorUid = curve.uid;
      state.selectedModifierUid = null;
      state.selectedCurveNodeIndex = index;
      refreshSelectionUi();
      showContextMenu(event, { title: `節點 ${index + 1}`, source: item, items: [
        { icon: '×', label: '刪除節點', danger: true, action: () => {
          if (curve.nodes.length <= 2) return toast('曲線至少需要兩個節點');
          snapshot('core.curve.node_remove'); discardSubdivisionEdits(curve); curve.nodes.splice(index, 1);
          state.selectedCurveNodeIndex = Math.min(index, curve.nodes.length - 1);
          markDirty(); renderAll('selection');
        } }
      ] });
      return;
    }
    const uidValue = item.dataset.uid;
    const source = outliner.querySelector(`[data-uid="${uidValue}"]`);
    showElementContextMenu(event, uidValue, source);
  });
  outliner.addEventListener('dblclick', event => {
    if (state.mode === 'paint') return;
    const row = event.target.closest('.outliner-item');
    if (row?.dataset.curveNodeIndex !== undefined) return;
    const node = row && state.project.getNode(row.dataset.uid);
    if (!isProceduralShape(node)) return;
    event.preventDefault();
    subdivisionSession?.ownerUid === node.uid ? exitSubdivisionEdit() : enterSubdivisionEdit(node);
  });
  $('#viewport').addEventListener('dblclick', event => {
    if (state.mode === 'paint') return;
    if (event.target !== sceneCanvas) return;
    const rect = sceneCanvas.getBoundingClientRect();
    const selectedHit = sceneRenderer.pickDetailed(state.project,
      event.clientX - rect.left, event.clientY - rect.top, state.geometryOnly,
      { includeGenerated: !state.modifierResultGhost });
    if (selectedHit?.generated) return;
    const uidValue = selectedHit?.uid;
    if (!uidValue) {
      if (!subdivisionSession) return;
      event.preventDefault();
      exitSubdivisionEdit();
      return;
    }
    const node = uidValue && state.project.getNode(uidValue);
    if (!isProceduralShape(node)) return;
    event.preventDefault();
    enterSubdivisionEdit(node);
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
          noteJournalOperation('core.texture.delete');
          const previousAssets = [...state.textureAssets];
          state.textureAssets = state.textureAssets.filter(entry => entry._uid !== asset?._uid);
          remapNumericFaceTextureReferences(previousAssets);
          if (state.activeTextureUid === asset?._uid) state.activeTextureUid = null;
          renderTextureList();
          if (state.textureAssets.length) {
            const nextIndex = Math.max(0, state.textureAssets.findIndex(entry => entry._uid === state.activeTextureUid));
            activateProjectTexture(nextIndex);
          } else renderTexture();
          rebuildTextureAtlas();
          markDirty();
          renderScene();
        } }
      ] });
    }
    if (groupNode) {
      const group = state.textureGroups.find(entry => entry.id === groupNode.dataset.textureGroup);
      return showContextMenu(event, { title: group?.name || '貼圖組', source: groupNode, items: [
        { icon: openIconMarkup(group?.collapsed ? 'down' : 'up', 'context-open-icon'), label: group?.collapsed ? '展開組' : '折疊組', action: () => { group.collapsed = !group.collapsed; renderTextureList(); } },
        { icon: '×', label: '解散貼圖組', action: () => {
          noteJournalOperation('core.texture.group');
          state.textureAssets.forEach(asset => { if (asset.groupId === group.id) asset.groupId = null; });
          state.textureGroups = state.textureGroups.filter(entry => entry.id !== group.id); renderTextureList(); markDirty();
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
    const swatch = event.target.closest('.swatch-item');
    showContextMenu(event, { title: row.name, source: rowNode, items: [
      ...(swatch ? [{ icon: '×', label: '刪除顏色', action: () => {
        row.colors.splice(Number(swatch.dataset.paletteColorIndex), 1);
        selectedPaletteRowId = row.id;
        selectedPaletteColorIndex = null;
        renderPalette();
      } }] : []),
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
      { icon: item.visible ? '◉' : '○', label: item.visible ? '隱藏' : '顯示', action: () => { snapshot('core.element.visibility'); setNodeVisibility(item, !item.visible); markDirty(); renderAll(); } }
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
  if (state.mode === 'paint') return;
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
  snapshot('core.curve.node_add');
  discardSubdivisionEdits(curve);
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
  document.addEventListener('click', event => {
    const input = event.target.closest('input[type="color"]');
    if (!input || input.disabled) return;
    event.preventDefault();
    openColorPickerPopup(input.value, color => { input.value = color; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  });
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
  const shapeCreateButton = $('[data-action="toggleShapeCreate"]');
  const shapeCreateMenu = $('#shapeCreateMenu');
  const closeShapeCreateMenu = () => {
    shapeCreateMenu.hidden = true;
    shapeCreateButton.setAttribute('aria-expanded', 'false');
  };
  shapeCreateButton.addEventListener('click', event => {
    event.stopPropagation();
    if (!shapeCreateMenu.hidden) return closeShapeCreateMenu();
    const rect = shapeCreateButton.getBoundingClientRect();
    shapeCreateMenu.hidden = false;
    const menuRect = shapeCreateMenu.getBoundingClientRect();
    shapeCreateMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - menuRect.width - 8, rect.right - menuRect.width))}px`;
    shapeCreateMenu.style.top = `${Math.max(8, Math.min(window.innerHeight - menuRect.height - 8, rect.bottom + 5))}px`;
    shapeCreateButton.setAttribute('aria-expanded', 'true');
  });
  shapeCreateMenu.addEventListener('click', event => {
    event.stopPropagation();
    const option = event.target.closest('[data-create-shape]');
    if (!option) return;
    closeShapeCreateMenu();
    if (['polygon_prism', 'dodecahedron', 'truncated_icosahedron'].includes(option.dataset.createShape)) addShape(option.dataset.createShape);
    if (option.dataset.createShape === 'bezier2d') addBezierElement(2);
    if (option.dataset.createShape === 'bezier3d') addBezierElement(3);
  });
  document.addEventListener('click', closeShapeCreateMenu);
  $('[data-action="addLocator"]').addEventListener('click', addLocator);
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
  $('[data-action="theme"]').addEventListener('click', async () => {
    themeDialog.showModal();
    const label = $('#projectWorkspaceDirectory');
    if (window.cubeBricksDesktop?.projectWorkspaceRoot) label.textContent = await window.cubeBricksDesktop.projectWorkspaceRoot();
    else label.textContent = '瀏覽器預覽不使用展開式工作目錄';
  });
  $('[data-action="chooseProjectWorkspace"]').addEventListener('click', async () => {
    if (!window.cubeBricksDesktop?.chooseProjectWorkspaceRoot) return toast('僅桌面版可更改工作目錄');
    try {
      const directory = await window.cubeBricksDesktop.chooseProjectWorkspaceRoot();
      if (directory) { $('#projectWorkspaceDirectory').textContent = directory; toast('新項目將使用新的工作目錄'); }
    } catch (error) { toast(`工作目錄更改失敗：${error.message}`); }
  });
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
  $('[data-action="importPlayerReferenceTexture"]').addEventListener('click', () => {
    playerReferenceTextureInput.value = '';
    playerReferenceTextureInput.click();
  });
  $('[data-action="resetPlayerReferenceTexture"]').addEventListener('click', () => {
    configRegistry.reset(ConfigKey.PLAYER_REFERENCE_TEXTURE, { source: 'player-reference-settings' });
    toast('已恢復內置玩家紋理');
  });
  playerReferenceTextureInput.addEventListener('change', () => importPlayerReferenceTexture(playerReferenceTextureInput.files?.[0]));
  $('#alphaLockToggle').addEventListener('change', event => configRegistry.set(ConfigKey.ALPHA_LOCK, event.target.checked, { source: 'toolbar' }));
  $('#previewShadeToggle').addEventListener('change', event => configRegistry.set(ConfigKey.PREVIEW_SHADE, event.target.checked, { source: 'toolbar' }));
  $('#playerReferenceToggle').addEventListener('change', event => configRegistry.set(ConfigKey.SHOW_PLAYER_REFERENCE, event.target.checked, { source: 'toolbar' }));
  $('#modifierResultGhostToggle').addEventListener('change', event => configRegistry.set(ConfigKey.MODIFIER_RESULT_GHOST, event.target.checked, { source: 'bottom-options' }));
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
  $('#uvPreviewAutoFocusTexture').addEventListener('change', event => {
    state.uvPreviewAutoFocusTexture = event.target.checked;
  });
  $$('[data-uv-face-action]').forEach(button => button.addEventListener('click', () => {
    editSelectedUvFace(button.dataset.uvFaceAction);
  }));
  uvPreviewViewport.addEventListener('pointerdown', event => {
    if (![0, 1].includes(event.button) || !uvPreviewIsActive() || !uvPreviewElements().length) return;
    event.preventDefault();
    uvPreviewDrag = {
      pointerId: event.pointerId,
      button: event.button,
      rotates: event.button === 1,
      x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY,
      moved: false
    };
    if (uvPreviewDrag.rotates) uvPreviewViewport.classList.add('is-rotating');
    uvPreviewViewport.setPointerCapture(event.pointerId);
  });
  uvPreviewViewport.addEventListener('pointermove', event => {
    if (!uvPreviewDrag || uvPreviewDrag.pointerId !== event.pointerId) return;
    const dx = event.clientX - uvPreviewDrag.x;
    const dy = event.clientY - uvPreviewDrag.y;
    if (!uvPreviewDrag.moved && Math.hypot(event.clientX - uvPreviewDrag.startX, event.clientY - uvPreviewDrag.startY) < 4) return;
    uvPreviewDrag.moved = true;
    uvPreviewDrag.x = event.clientX;
    uvPreviewDrag.y = event.clientY;
    if (!uvPreviewDrag.rotates) return;
    state.uvPreviewYaw -= dx * .01;
    state.uvPreviewPitch = Math.max(-Math.PI / 2 + .02, Math.min(Math.PI / 2 - .02, state.uvPreviewPitch + dy * .01));
    renderUvPreview();
  });
  const endUvPreviewDrag = event => {
    if (!uvPreviewDrag || uvPreviewDrag.pointerId !== event.pointerId) return;
    const wasClick = !uvPreviewDrag.moved && uvPreviewDrag.button === 0;
    uvPreviewViewport.releasePointerCapture?.(event.pointerId);
    uvPreviewViewport.classList.remove('is-rotating');
    uvPreviewDrag = null;
    if (wasClick) {
      const rect = uvPreviewCanvas.getBoundingClientRect();
      const cache = getUvPreviewProject();
      const hit = uvPreviewRenderer.pickDetailed(cache.project,
        event.clientX - rect.left, event.clientY - rect.top, true);
      if (!hit) {
        state.uvPreviewSelectedFace = null;
        state.selectedUvFaces = new Set();
        renderTextureUvOverlay(true);
        updateFaceSelectionOverlay();
      }
      else if (state.project.getNode(hit.uid)?.type !== 'cube') {
        state.uvPreviewSelectedFace = null;
        toast('程序化 Shape 請先轉換為 Cube 才能編輯逐面 UV');
      } else state.uvPreviewSelectedFace = {
        uid: hit.uid,
        faceName: hit.faceName,
        points: hit.facePoints.map(point => [...point])
      };
      if (state.uvPreviewSelectedFace) {
        state.selectedUvFaces = new Set([uvFaceKey(state.uvPreviewSelectedFace.uid, state.uvPreviewSelectedFace.faceName)]);
        renderTextureUvOverlay(true);
        updateFaceSelectionOverlay();
        if (state.uvPreviewAutoFocusTexture) {
          dockManager?.expand('texture');
          setDockHotspotFocus('texture');
          requestAnimationFrame(focusSelectedTextureUvs);
        }
      }
      renderUvPreview();
    }
  };
  uvPreviewViewport.addEventListener('pointerup', endUvPreviewDrag);
  uvPreviewViewport.addEventListener('pointercancel', endUvPreviewDrag);
  uvPreviewViewport.addEventListener('auxclick', event => event.preventDefault());
  $$('[data-hotspot-focus="true"]').forEach(panel => panel.addEventListener('pointerdown', () => {
    setDockHotspotFocus(panel.dataset.panel);
  }));
  const texturePreview = $('#texturePreview');
  texturePreview.addEventListener('pointerdown', startTexturePointer);
  texturePreview.addEventListener('pointermove', onTexturePointerMove);
  texturePreview.addEventListener('pointerup', endTexturePointer);
  texturePreview.addEventListener('pointercancel', endTexturePointer);
  texturePreview.addEventListener('lostpointercapture', endTexturePointer);
  texturePreview.addEventListener('pointerleave', () => {
    if (!texturePaintDrag) $('#textureBrushCursor').hidden = true;
    if (!textureUvDrag && !texturePaintDrag) texturePreview.style.cursor = '';
  });
  texturePreview.addEventListener('auxclick', event => event.preventDefault());
  texturePreview.addEventListener('wheel', wheelTextureView, { passive: false });
  $$('[data-texture-face]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    setDockHotspotFocus('texture');
    const matching = textureUvEntries().filter(entry => entry.faceName === button.dataset.textureFace);
    const next = event.shiftKey || event.ctrlKey || event.metaKey
      ? new Set(state.selectedUvFaces)
      : new Set();
    matching.forEach(entry => {
      if (event.ctrlKey || event.metaKey) next.has(entry.key) ? next.delete(entry.key) : next.add(entry.key);
      else next.add(entry.key);
    });
    state.selectedUvFaces = next;
    renderTextureUvOverlay(true);
    updateFaceSelectionOverlay();
  }));
  $$('[data-uv-coordinate]').forEach(input => input.addEventListener('change', () => {
    setUvCoordinate(Number(input.dataset.uvCoordinate), Number(input.value));
  }));
  $('#paintColor').addEventListener('input', event => setPaintColor(event.target.value));
  $('#paintBrushSize').addEventListener('input', event => {
    const size = clamp(Math.round(Number(event.target.value)) || 1, 1, 64);
    if (state.tool === 'brush') state.paintBrushSize = size;
    else if (state.paintToolSettings[state.tool]) state.paintToolSettings[state.tool].size = size;
    event.target.value = String(size);
  });
  $('#paintBrushShape').addEventListener('change', event => {
    state.paintBrushShape = event.target.value === 'circle' ? 'circle' : 'square';
    updateToolOptions();
  });
  $('#paintBrushAa').addEventListener('change', event => {
    state.paintBrushAa = event.target.checked;
  });
  $('#paintBrushDepth').addEventListener('input', event => {
    state.paintBrushDepth = clamp(Math.round(Number(event.target.value)) || 0, 0, 32);
    event.target.value = String(state.paintBrushDepth);
  });
  $('#paintBrushOverlay').addEventListener('change', event => {
    state.paintBrushOverlay = event.target.checked;
  });
  $('#paintBrushOpacity').addEventListener('input', event => {
    const opacity = clamp(Math.round(Number(event.target.value)) || 100, 1, 100);
    if (state.tool === 'brush') state.paintBrushOpacity = opacity;
    else if (state.paintToolSettings[state.tool]) state.paintToolSettings[state.tool].opacity = opacity;
    $('#paintBrushOpacityOutput').textContent = `${opacity}%`;
  });
  $('#paintEraseMode').addEventListener('change', event => {
    if (state.tool === 'brush') state.paintBrushErase = event.target.checked;
    else if (state.paintToolSettings[state.tool]) state.paintToolSettings[state.tool].erase = event.target.checked;
  });
  $('#paintIgnoreTransparentToggle').addEventListener('change', event => { state.paintIgnoreTransparent = event.target.checked; });
  $('#paintBucketScope').addEventListener('change', event => {
    state.paintBucketScope = ['face', 'element', 'color', 'contiguous'].includes(event.target.value) ? event.target.value : 'face';
    updateToolOptions();
  });
  $('#paintBucketSingleFace').addEventListener('change', event => {
    state.paintBucketSingleFace = event.target.checked;
  });
  $('#paintGradientMode').addEventListener('change', event => {
    state.paintGradientMode = event.target.value === 'volume' ? 'volume' : 'face';
    clearPaintGradientSelection();
  });
  $('#paintGradientPalette').addEventListener('change', event => {
    state.paintGradientPalette = event.target.checked;
    if (!state.paintGradientPalette) selectPaintGradientStop(state.paintGradientStop);
    updateToolOptions();
    renderPaintGradientPreview();
  });
  $('#paintGradientStartControl').addEventListener('click', () => selectPaintGradientStop('start'));
  $('#paintGradientEndControl').addEventListener('click', () => selectPaintGradientStop('end'));
  $('#paintGradientStartAlpha').addEventListener('input', event => {
    state.paintGradientStartAlpha = clamp(Math.round(Number(event.target.value)) || 0, 0, 100);
    event.target.value = String(state.paintGradientStartAlpha);
    renderPaintGradientPreview();
  });
  $('#paintGradientEndAlpha').addEventListener('input', event => {
    state.paintGradientEndAlpha = clamp(Math.round(Number(event.target.value)) || 0, 0, 100);
    event.target.value = String(state.paintGradientEndAlpha);
    renderPaintGradientPreview();
  });
  new ResizeObserver(() => {
    syncTexturePreviewPriority();
    updateTextureStageTransform();
  }).observe(texturePreview);
  new ResizeObserver(entries => {
    const rect = entries[0]?.contentRect;
    if (!rect || rect.width < 2 || rect.height < 2 || uvPreviewResizeFrame !== null) return;
    uvPreviewResizeFrame = requestAnimationFrame(() => {
      uvPreviewResizeFrame = null;
      uvPreviewRenderDirty = true;
      refreshUvPreview(false);
    });
  }).observe(uvPreviewViewport);
  document.fonts?.load('12px "Fusion Pixel Latin"').then(() => {
    uvPreviewFaceLabelFontRevision++;
    uvPreviewFaceLabelCacheKey = null;
    refreshUvPreview();
  });
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
    if (state.axisView) return;
    configRegistry.set(ConfigKey.PROJECTION, button.dataset.projection, { source: 'viewport-toolbar' });
  }));
  $('[data-action="referenceImage"]').addEventListener('click', event => {
    event.stopPropagation();
    setReferenceImageMenu($('#referenceImageMenu').hidden);
  });
  $$('[data-reference-action]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const action = button.dataset.referenceAction;
    if (action === 'import') beginReferenceImageImport();
    if (action === 'edit') {
      setReferenceImageEditing(!referenceImageEditing);
      setReferenceImageMenu(false);
    }
    if (action === 'reset') resetReferenceImage();
    if (action === 'remove') removeReferenceImage();
  }));
  $('#referenceImageList').addEventListener('click', event => {
    const button = event.target.closest('[data-reference-select]');
    if (!button) return;
    event.stopPropagation();
    state.referenceImageSelection[referenceViewKey()] = button.dataset.referenceSelect;
    updateReferenceImageLayer();
  });
  referenceImageInput.addEventListener('change', () => {
    loadReferenceImageFiles(referenceImageInput.files, referenceImportViewKey);
  });
  referenceImageLayer.addEventListener('pointerdown', beginReferenceImageDrag);
  referenceImageLayer.addEventListener('pointermove', moveReferenceImageDrag);
  referenceImageLayer.addEventListener('pointerup', endReferenceImageDrag);
  referenceImageLayer.addEventListener('pointercancel', endReferenceImageDrag);
  referenceImageLayer.addEventListener('wheel', scaleReferenceImage, { passive: false });
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
    if (!event.target.closest('.reference-image-control')) setReferenceImageMenu(false);
  });
  $('#minecraftRenderType').addEventListener('change', event => {
    snapshot('core.project.render_type');
    state.project.renderType = event.target.value;
    markDirty();
    renderScene();
  });
  $('#cullFaces').addEventListener('change', event => {
    snapshot('core.project.face_culling');
    state.project.cullFaces = event.target.checked;
    markDirty();
    renderScene();
  });
  $('[data-action="addTexture"]').addEventListener('click', () => textureInput.click());
  $('[data-action="createTexture"]').addEventListener('click', openTextureCreateDialog);
  $('#textureCreateType').addEventListener('change', updateTextureCreateDialog);
  $('#textureTemplatePowerOfTwo').addEventListener('change', updateTextureCreateDialog);
  $('#textureTemplatePaddingEnabled').addEventListener('change', updateTextureCreateDialog);
  $('[data-action="cancelTextureCreate"]').addEventListener('click', () => $('#textureCreateDialog').close());
  $('#textureCreateForm').addEventListener('submit', async event => {
    event.preventDefault();
    const type = $('#textureCreateType').value;
    const name = $('#textureCreateName').value.trim() || 'texture.png';
    $('#textureCreateDialog').close();
    if (type === 'template') {
      await createTextureTemplate({
        name,
        selectedOnly: $('#textureTemplateSelectedOnly').checked,
        cleanInvalidFaces: $('#textureTemplateCleanInvalid').checked,
        boxUv: $('#textureTemplateBoxUv').checked,
        powerOfTwo: $('#textureTemplatePowerOfTwo').checked,
        keepMultiTexture: $('#textureTemplateKeepMulti').checked,
        paddingEnabled: $('#textureTemplatePaddingEnabled').checked,
        padding: Number($('#textureTemplatePadding').value) || 0,
        multiple: Number($('#textureTemplateMultiple').value) || 4
      });
    } else createSimpleTexture({
      type, name,
      width: Number($('#textureCreateWidth').value) || 1,
      height: Number($('#textureCreateHeight').value) || 1,
      color: $('#textureCreateColor').value
    });
  });
  $('[data-action="playTimeline"]')?.addEventListener('click', playTimeline);
  $('[data-action="stopTimeline"]')?.addEventListener('click', stopTimeline);
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
    if (button.dataset.curveNodeIndex !== undefined) {
      const curve = state.project.getNode(button.dataset.uid);
      if (!isBezierElement(curve)) return;
      sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
      state.selectedUid = curve.uid;
      state.selectedUids = new Set([curve.uid]);
      state.selectionAnchorUid = curve.uid;
      state.selectedModifierUid = null;
      state.selectedCurveNodeIndex = Number(button.dataset.curveNodeIndex);
      refreshSelectionUi();
      return;
    }
    const flag = event.target.closest('[data-node-toggle]');
    if (flag && !flag.classList.contains('unavailable')) {
      event.preventDefault();
      event.stopPropagation();
      const node = state.project.getNode(flag.dataset.nodeUid);
      const key = flag.dataset.nodeToggle;
      const current = key === 'autoUv' ? nodeAutoUvEnabled(node)
        : key === 'uvNormalized' ? nodeUvNormalizedEnabled(node)
        : key === 'locked' ? node.locked === true
        : node[key] !== false;
      const targets = state.selectedUids.has(node.uid) && state.selectedUids.size > 1
        ? inspectorBatchNodes()
        : [node];
      snapshot(`core.element.field.${key.toLowerCase()}`);
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
    state.selectedCurveNodeIndex = null;
    selectItem(button.dataset.uid, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
  });
  outliner.addEventListener('dragstart', event => {
    if (state.mode === 'paint') { event.preventDefault(); return; }
    if (event.target.closest('[data-node-toggle]')) { event.preventDefault(); return; }
    const item = event.target.closest('.outliner-item');
    if (!item) return;
    if (item.dataset.curveNodeIndex !== undefined) { event.preventDefault(); return; }
    if (!state.selectedUids.has(item.dataset.uid)) {
      sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
      state.selectedUid = item.dataset.uid;
      state.selectedUids = new Set([item.dataset.uid]);
      state.selectionAnchorUid = item.dataset.uid;
      outliner.querySelectorAll('.outliner-item.active').forEach(row => row.classList.remove('active'));
      item.classList.add('active');
      invalidateSelectionRenderGeometry(false);
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
    if (item.dataset.curveNodeIndex !== undefined) return;
    const node = state.project.getNode(item.dataset.uid);
    const rect = item.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    const zone = node?.type === 'group' && ratio > .27 && ratio < .73 ? 'inside' : ratio < .5 ? 'before' : 'after';
    item.classList.add(`drop-${zone}`);
    item.dataset.dropZone = zone;
  });
  outliner.addEventListener('drop', event => {
    if (state.mode === 'paint') { event.preventDefault(); clearOutlinerDropState(); return; }
    if (!state.outlinerDragUids?.length) return;
    event.preventDefault();
    const item = event.target.closest('.outliner-item');
    if (item?.dataset.curveNodeIndex !== undefined) {
      clearOutlinerDropState();
      removeOutlinerDragGhost();
      return;
    }
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
  bindTextureFaceDropSurface(viewport, sceneCanvas, sceneRenderer, () => state.project, '#sceneTextureDropFaceOverlay');
  bindTextureFaceDropSurface(uvPreviewViewport, uvPreviewCanvas, uvPreviewRenderer,
    () => uvPreviewIsActive() ? getUvPreviewProject().project : null, '#uvTextureDropFaceOverlay');
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
    if (item) {
      const preview = item.querySelector('.texture-thumb')?.cloneNode(true);
      if (preview) {
        preview.classList.add('texture-drag-preview');
        document.body.append(preview);
        event.dataTransfer.setDragImage(preview, 18, 18);
        requestAnimationFrame(() => preview.remove());
      }
    }
    event.dataTransfer.effectAllowed = item ? 'copyMove' : 'move';
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
    noteJournalOperation(state.textureDrag.type === 'asset' ? 'core.texture.reorder' : 'core.texture.group');
    const item = event.target.closest('.texture-item');
    const groupNode = !item && event.target.closest('.texture-group');
    const previousAssets = [...state.textureAssets];
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
    remapNumericFaceTextureReferences(previousAssets);
    renderTextureList();
    rebuildTextureAtlas();
    markDirty();
  });
  $('#textureList').addEventListener('dragend', () => {
    state.textureDrag = null;
    clearTextureFaceDropTarget();
    renderTextureList();
  });
  $$('[data-view-axis]').forEach(button => button.addEventListener('click', event => {
    if (suppressAxisWidgetClick) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    enterAxisView(button.dataset.viewAxis, Number(button.dataset.axisSign));
  }));
  const axisWidget = $('.axis-widget');
  axisWidget.addEventListener('pointerdown', beginAxisWidgetDrag);
  axisWidget.addEventListener('pointermove', moveAxisWidgetDrag);
  axisWidget.addEventListener('pointerup', endAxisWidgetDrag);
  axisWidget.addEventListener('pointercancel', endAxisWidgetDrag);
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
    if (handle.dataset.kind === 'modifier-anchor') {
      const owner = selected();
      const modifier = [...(owner?.modifiers || []), ...(owner?.operators || [])].find(entry => entry.uid === handle.dataset.modifierUid);
      if (!modifier?.enabled) return;
      state.selectedModifierUid = modifier.uid;
      state.selectedCurveNodeIndex = null;
      state.inspectorPage = modifier.type === 'paint_symmetry' ? 'operators' : 'modifiers';
      if (!['move', 'rotate', 'pivot'].includes(state.tool)) setTool('move');
      else { renderInspector(); renderScene(); updateSelectionLabels(); }
      return;
    }
    if (handle.dataset.kind === 'vertex') {
      useVertexSnapPoint(state.vertexSnapPoints?.[Number(handle.dataset.vertexIndex)]);
      return;
    }
    if (state.tool === 'rotate' && handle.dataset.kind?.startsWith('rotate')) {
      const signature = `${handle.dataset.kind}:${handle.dataset.axis || 'view'}:${handle.dataset.sign || 1}`;
      pendingRotationPress = {
        x: event.clientX, y: event.clientY,
        signature, selectedUid: state.selectedUid,
        serialized: state.project.serialize(), historyLength: state.history.length,
        future: [...state.future], dirty: state.dirty
      };
    } else pendingRotationPress = null;
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
  $('#transformGizmo').addEventListener('click', event => {
    if (event.detail === 1 && pendingRotationPress) recentRotationPress = pendingRotationPress;
  });
  $('#viewport').addEventListener('dblclick', event => {
    const prior = recentRotationPress;
    if (!prior || state.tool !== 'rotate' || prior.selectedUid !== state.selectedUid
      || Math.hypot(event.clientX - prior.x, event.clientY - prior.y) >= 12) return;
    event.preventDefault(); event.stopImmediatePropagation();
    recentRotationPress = null;
    // The browser's dblclick event uses the operating system's click timing.
    // Both pointer drags may already have committed by now; roll them back.
    if (state.project.serialize() !== prior.serialized) {
      state.history.length = prior.historyLength;
      state.future = prior.future;
      restore(prior.serialized);
      markDirty(prior.dirty);
    }
    const matching = control => control
      && `${control.dataset.kind}:${control.dataset.axis || 'view'}:${control.dataset.sign || 1}` === prior.signature;
    const resolved = resolveGizmoHandle(event);
    const handle = matching(resolved) ? resolved
      : [...$('#transformGizmo').querySelectorAll('.gizmo-control')].find(matching);
    if (handle) openPreciseRotationInput(event, handle);
  }, true);
  $('#transformGizmo').addEventListener('pointerleave', () => {
    $('#transformGizmo').querySelectorAll('.depth-hover').forEach(control => control.classList.remove('depth-hover'));
  });
  $('#transformGizmo').addEventListener('pointerup', endPointerDrag);
  $('#transformGizmo').addEventListener('pointercancel', endPointerDrag);
  sceneCanvas.addEventListener('pointerdown', onPointerDown);
  sceneCanvas.addEventListener('pointermove', onScenePointerMove);
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
  sceneCanvas.addEventListener('lostpointercapture', endPointerDrag);
  sceneCanvas.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
  sceneCanvas.addEventListener('wheel', event => { event.preventDefault(); cancelCameraFocus(); state.zoom = Math.max(.002, Math.min(100, state.zoom * (event.deltaY > 0 ? .9 : 1.1))); renderScene(); }, { passive: false });
  window.addEventListener('resize', renderScene);
  document.addEventListener('visibilitychange', refreshUvPreview);
  window.addEventListener('keydown', event => {
    if (event.target.matches('input,select,textarea') || event.target.isContentEditable) return;
    if (event.key === 'Alt' && !event.repeat && beginTemporaryEyedropper()) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      setRenderModeMenu(false);
      setReferenceImageMenu(false);
      if (referenceImageEditing) setReferenceImageEditing(false);
      closeShapeCreateMenu();
      if (subdivisionSession) exitSubdivisionEdit();
      clearPaintGradientSelection();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(event.shiftKey); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelected(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') { event.preventDefault(); cutSelected(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteElements(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); pasteElements({ inPlace: true }); }
    if (event.key === 'Delete') deleteSelected();
    if (event.key.toLowerCase() === 'f') { cancelCameraFocus(); state.zoom = 1.12; state.panX = 0; state.panY = 0; renderScene(); }
    if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      if (focusedDockHotspot === 'texture') event.shiftKey ? resetTextureView() : focusSelectedTextureUvs();
      else event.shiftKey ? focusSceneOrigin() : focusSelected();
    }
    if (state.mode === 'paint' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const paintShortcuts = { b: 'brush', l: 'line', m: 'rectangle', o: 'ellipse', g: 'fill', j: 'gradient', i: 'eyedropper' };
      const paintTool = paintShortcuts[event.key.toLowerCase()];
      if (paintTool) {
        event.preventDefault();
        setTool(paintTool);
      }
    }
    const shortcuts = { '1': 'move', '2': 'resize', '3': 'rotate', '4': 'pivot', '5': 'vertexSnap', '6': 'knife', '7': 'faceSelect' }; if (shortcuts[event.key]) setTool(shortcuts[event.key]);
    if (state.tool === 'knife' && state.knifePointer && ['Shift', 'Control'].includes(event.key)) refreshKnifeFromModifierEvent(event);
  });
  window.addEventListener('keyup', event => {
    if (event.key === 'Alt' && endTemporaryEyedropper()) {
      event.preventDefault();
      return;
    }
    if (state.tool === 'knife' && state.knifePointer && ['Shift', 'Control'].includes(event.key)) refreshKnifeFromModifierEvent(event);
  });
  window.addEventListener('blur', endTemporaryEyedropper);
  document.addEventListener('visibilitychange', scheduleTextureAnimation);
}

let timelineAnimation = null;
let timelineLastTime = 0;

function playTimeline() {
  if (state.timelinePlaying) return;
  state.timelinePlaying = true;
  timelineLastTime = performance.now();
  const playButton = $('[data-action="playTimeline"]');
  if (playButton) playButton.textContent = '❚❚';
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
  const playButton = $('[data-action="playTimeline"]');
  if (playButton) playButton.textContent = '▶';
  updateTimelineUI();
}

function updateTimelineUI() {
  const frame = Math.floor(state.timelineFrame);
  const seconds = Math.floor(frame / 24);
  const time = $('#timelineTime');
  const ruler = $('#timelineRuler');
  if (time) time.textContent = `00:00:${String(seconds).padStart(2, '0')}:${String(frame % 24).padStart(2, '0')}`;
  ruler?.style.setProperty('--playhead', `${state.timelineFrame / 48 * 100}%`);
}

function startCurveHandleDrag(event, curve, hit) {
  if (state.mode === 'paint') return;
  event.preventDefault();
  event.stopPropagation();
  sceneCanvas.setPointerCapture(event.pointerId);
  state.selectedModifierUid = null;
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
  state.outlinerWindowStart = -1;
  renderOutlinerWindow();
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
  if (state.mode === 'paint' && PAINT_TOOLS.includes(state.tool)) {
    startScenePaintPointer(event, x, y);
    return;
  }
  const suppressBlankDeselect = Boolean(focusedDockHotspot);
  if (focusedDockHotspot) setDockHotspotFocus(null);
  if (state.tool === 'knife') {
    event.preventDefault();
    useKnifePoint(event);
    return;
  }
  if (state.tool === 'faceSelect') {
    event.preventDefault();
    const hit = sceneRenderer.pickDetailed(state.project, x, y, true);
    const cube = hit && state.project.getNode(hit.uid);
    if (!hit?.faceName || cube?.type !== 'cube') {
      if (!suppressBlankDeselect) state.selectedUvFaces = new Set();
      renderTextureUvOverlay(true);
      updateFaceSelectionOverlay();
      return;
    }
    if (!state.selectedUids.has(hit.uid)) {
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
        state.selectedUids = new Set([...state.selectedUids, hit.uid]);
        state.selectedUid = hit.uid;
        state.selectionAnchorUid = hit.uid;
        refreshSelectionUi();
      } else selectItem(hit.uid, { revealInOutliner: true });
    }
    const key = uvFaceKey(hit.uid, hit.faceName);
    const next = event.shiftKey || event.ctrlKey || event.metaKey
      ? new Set(state.selectedUvFaces)
      : new Set();
    if (event.ctrlKey || event.metaKey) next.has(key) ? next.delete(key) : next.add(key);
    else next.add(key);
    state.selectedUvFaces = next;
    state.uvPreviewSelectedFace = { uid: hit.uid, faceName: hit.faceName, points: hit.facePoints.map(point => [...point]) };
    renderTextureUvOverlay(true);
    updateFaceSelectionOverlay();
    updateUvFaceUi();
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
      state.selectedModifierUid = null;
      state.selectedCurveNodeIndex = nodeHit.index;
      state.outlinerWindowStart = -1;
      renderOutlinerWindow();
      renderInspector();
      renderScene();
      return;
    }
    state.selectedCurveNodeIndex = null;
  }
  const selectionHit = sceneRenderer.pickDetailed(state.project, x, y, state.geometryOnly,
    { includeGenerated: !state.modifierResultGhost });
  const hitUid = selectionHit?.generated ? null : selectionHit?.uid || null;
  event.preventDefault();
  sceneCanvas.setPointerCapture(event.pointerId);
  state.dragging = {
    type: 'selection-box', pointerId: event.pointerId,
    x: event.clientX, y: event.clientY, startX: x, startY: y,
    currentX: x, currentY: y, moved: false, hitUid,
    generatedHit: selectionHit?.generated ? selectionHit : null,
    selection: new Set(state.selectedUids),
    mode: viewportSelectionMode(event), suppressBlankDeselect
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
  state.selectedGenerated = null;
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
  if (Number.isFinite(event.pointerId)) captureTarget.setPointerCapture(event.pointerId);
  bakeCameraPan();
  const frame = sceneRenderer.getCameraFrame();
  state.dragging = event.shiftKey || state.axisView
    ? {
        type: 'pan', pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        target: [...state.target], right: [...frame.right], up: [...frame.up], worldPerPixel: frame.worldPerPixel
      }
    : { type: 'orbit', pointerId: event.pointerId, x: event.clientX, y: event.clientY, yaw: state.yaw, pitch: state.pitch };
  sceneCanvas.classList.add(event.shiftKey || state.axisView ? 'is-panning' : 'is-orbiting');
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
  } else if (item.origin) {
    item.origin = item.origin.map((value, axis) => value + delta[axis]);
    if (isShapeElement(item)) item.pivot = item.pivot.map((value, axis) => value + delta[axis]);
  }
  else if (item.position) item.position = item.position.map((value, axis) => value + delta[axis]);
  else if (item.type === 'group') {
    const members = captureGroupMembers(item);
    item.pivot = item.pivot.map((value, axis) => value + delta[axis]);
    members.forEach(member => {
      if (member.node.type === 'cube') {
        member.node.position = member.position.map((value, axis) => value + delta[axis]);
        member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
      } else if (member.node.origin) {
        member.node.origin = member.position.map((value, axis) => value + delta[axis]);
        if (isShapeElement(member.node) && member.pivot) member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
      }
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
    if (pointEntry.generated) return toast('修改器結果只能作為目標捕捉點');
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
  snapshot('core.element.vertex_snap');
  if (state.vertexSnapMode === 'move') {
    if (state.vertexSnapSource.pointType === 'curveNode' && isBezierElement(sourceItem)) {
      const node = sourceItem.nodes[state.vertexSnapSource.nodeIndex];
      const worldDelta = pointEntry.point.map((value, axis) => value - state.vertexSnapSource.point[axis]);
      let localDelta = worldVectorToParentLocal(sourceItem, worldDelta);
      localDelta = inverseRotateVector(localDelta, sourceItem.rotation || [0, 0, 0]);
      node.position = node.position.map((value, axis) => sourceItem.dimension === 2 && axis === 1 ? 0 : value + localDelta[axis]);
    } else if (state.vertexSnapSource.pointType === 'pivot' && (['cube', 'group'].includes(sourceItem.type) || isShapeElement(sourceItem))) {
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
  const hit = sceneRenderer.pickDetailed(state.project, event.clientX - rect.left, event.clientY - rect.top,
    true, { includeGenerated: !state.modifierResultGhost });
  if (hit?.generated) return null;
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
  snapshot('core.knife.cube');
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
  snapshot('core.knife.curve');
  const originalNodes = curve.nodes.map(node => new CurveNode(structuredClone(node), curve.dimension === 2));
  curve.nodes = originalNodes.slice(0, segmentIndex + 1);
  const second = new BezierElement({
    name: curve.name, unnamed: curve.unnamed,
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

function buildEditorOverlayLines() {
  return buildKnifeOverlayLines();
}

function nodeTransformAnchor(node) {
  if (node.type === 'cube' || node.type === 'group' || isShapeElement(node)) return node.pivot;
  return node.position || node.origin;
}

function captureModifierAnchors(node) {
  return new Map([...(node.modifiers || []), ...(node.operators || [])].flatMap(modifier => Array.isArray(modifier.anchor?.position)
    ? [[modifier.uid, [...modifier.anchor.position]]]
    : []));
}

function translateModifierAnchorsFromSnapshot(node, anchors, delta) {
  for (const modifier of [...(node.modifiers || []), ...(node.operators || [])]) {
    const start = anchors?.get(modifier.uid);
    if (!start || !Array.isArray(modifier.anchor?.position)) continue;
    modifier.anchor.position = start.map((value, axis) => value + delta[axis]);
  }
}

function translateModifierAnchors(node, delta) {
  for (const modifier of [...(node.modifiers || []), ...(node.operators || [])]) {
    if (!Array.isArray(modifier.anchor?.position)) continue;
    modifier.anchor.position = modifier.anchor.position.map((value, axis) => value + delta[axis]);
  }
}

function captureTransformTarget(node) {
  const owner = subdivisionOwner(node);
  const chain = state.project.getGroupChain(owner?.uid || node.uid);
  const rotationChain = owner
    ? [...chain, { pivot: [0, 0, 0], rotation: owner.rotation || [0, 0, 0] }]
    : chain;
  const worldToLocalAxes = [0, 1, 2].map(worldAxis => {
    let local = [0, 1, 2].map(axis => axis === worldAxis ? 1 : 0);
    rotationChain.forEach(group => { local = inverseRotateVector(local, group.rotation || [0, 0, 0]); });
    return local;
  });
  const anchor = [...nodeTransformAnchor(node)];
  return {
    node,
    chain: rotationChain,
    anchor,
    worldAnchor: owner ? getTransformPivot(node) : applyGroupTransforms(anchor, chain),
    worldToLocalAxes,
    transformAxes: getTransformAxes(node).map(axis => [...axis]),
    position: node.position ? [...node.position] : node.origin ? [...node.origin] : node.pivot ? [...node.pivot] : [0, 0, 0],
    pivot: node.pivot ? [...node.pivot] : null,
    rotation: [...(node.rotation || [0, 0, 0])],
    size: node.size ? [...node.size] : null,
    radius: node.parameters?.radius,
    height: node.parameters?.height,
    modifierAnchors: captureModifierAnchors(node),
    groupMembers: node.type === 'group' ? captureGroupMembers(node) : []
  };
}

function translateCapturedTarget(target, delta) {
  const { node } = target;
  translateModifierAnchorsFromSnapshot(node, target.modifierAnchors, delta);
  if (node.type === 'cube') {
    node.position = target.position.map((value, axis) => value + delta[axis]);
    node.pivot = target.pivot.map((value, axis) => value + delta[axis]);
  } else if (node.origin) {
    node.origin = target.position.map((value, axis) => value + delta[axis]);
    if (isShapeElement(node) && target.pivot) node.pivot = target.pivot.map((value, axis) => value + delta[axis]);
  }
  else if (node.position) node.position = target.position.map((value, axis) => value + delta[axis]);
  else if (node.type === 'group') {
    node.pivot = target.position.map((value, axis) => value + delta[axis]);
    target.groupMembers.forEach(member => {
      if (member.node.type === 'cube') {
        member.node.position = member.position.map((value, axis) => value + delta[axis]);
        member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
      } else if (member.node.origin) {
        member.node.origin = member.position.map((value, axis) => value + delta[axis]);
        if (isShapeElement(member.node) && member.pivot) member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
      }
      else if (member.node.position) member.node.position = member.position.map((value, axis) => value + delta[axis]);
      else member.node.pivot = member.position.map((value, axis) => value + delta[axis]);
      translateModifierAnchorsFromSnapshot(member.node, member.modifierAnchors, delta);
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
  if (state.mode === 'paint') return;
  const modifierAnchorContext = activeModifierAnchorContext();
  const baseSelectionContext = getSelectionTransformContext();
  const selectionContext = modifierAnchorContext
    ? { nodes: [modifierAnchorContext.owner], multiple: false, commonGroup: null, center: null, pivot: null }
    : baseSelectionContext;
  const curveNodeContext = activeCurveNodeContext();
  let item = selected();
  if (state.tool === 'pivot' && selectionContext.multiple) item = selectionContext.commonGroup;
  if (!item || !['move', 'resize', 'rotate', 'pivot'].includes(state.tool)) return;
  const targetNodes = state.tool === 'resize'
    ? selectedElementUids().map(uidValue => state.project.getNode(uidValue)).filter(Boolean)
    : selectionContext.nodes;
  const resizeBatch = state.tool === 'resize' && (selectionContext.multiple || item.type === 'group');
  const targets = (resizeBatch || selectionContext.multiple) && ['move', 'rotate', 'resize'].includes(state.tool)
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
  const itemSubdivisionOwner = subdivisionOwner(item);
  const parentChain = state.project.getGroupChain(itemSubdivisionOwner?.uid || item.uid);
  const chain = modifierAnchorContext
    ? [...parentChain, { pivot: item.type === 'group' || item.type === 'cube' || isShapeElement(item) ? item.pivot : item.origin || item.position || [0, 0, 0], rotation: item.rotation || [0, 0, 0] }]
    : curveNodeContext
    ? [...parentChain, { pivot: item.origin, rotation: item.rotation || [0, 0, 0] }]
    : itemSubdivisionOwner
      ? [...parentChain, { pivot: (itemSubdivisionOwner.pivot || itemSubdivisionOwner.origin).map((value, axis) => value - itemSubdivisionOwner.origin[axis]), rotation: itemSubdivisionOwner.rotation || [0, 0, 0] }]
      : parentChain;
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
  if (Number.isFinite(event.pointerId)) captureTarget.setPointerCapture(event.pointerId);
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
    position: modifierAnchorContext ? [...modifierAnchorContext.modifier.anchor.position]
      : curveNodeContext ? [...curveNodeContext.node.position]
      : item.position ? [...item.position] : item.origin ? [...item.origin] : item.pivot ? [...item.pivot] : [0, 0, 0],
    pivot: modifierAnchorContext ? [...modifierAnchorContext.modifier.anchor.position]
      : curveNodeContext ? [...curveNodeContext.node.position]
      : item.pivot ? [...item.pivot] : item.type === 'node' ? [...item.position] : null,
    size: item.size ? [...item.size] : null,
    rotation: [...(modifierAnchorContext ? modifierAnchorContext.modifier.anchor.rotation : curveNodeContext
      ? curveNodeContext.node.autoTangent
        ? curveNodeContext.curve.resolvedNodeState(curveNodeContext.index).rotation
        : curveNodeContext.node.rotation
      : item.rotation || [0, 0, 0])],
    nodeRoll: curveNodeContext?.node.roll || 0,
    radius: item.parameters?.radius,
    height: item.parameters?.height,
    modifierAnchors: captureModifierAnchors(item),
    uvFrozen: false,
    groupMembers: item.type === 'group' ? captureGroupMembers(item) : [],
    curveNodeContext,
    modifierAnchorContext,
    resizeBatch
  };
  sceneRenderer.beginTransformGhost();
  $('#transformTooltip').hidden = true;
  sceneCanvas.classList.add(`is-${state.tool}`);
}

function dismissPreciseRotationInput() {
  preciseRotationInput?.remove();
  preciseRotationInput = null;
}

function openPreciseRotationInput(event, handle) {
  dismissPreciseRotationInput();
  if (!handle || !handle.dataset.kind?.startsWith('rotate')) return;
  const gizmo = $('#transformGizmo');
  const axisKey = handle.dataset.axis || 'view';
  const axisIndex = /^[0-2]$/.test(axisKey) ? Number(axisKey) : null;
  startTransformDrag(event, axisIndex, gizmo, handle.dataset.kind, Number(handle.dataset.sign || 1),
    handle, axisKey, axisIndex === null ? [] : [axisIndex], [Number(handle.dataset.sign || 1)]);
  const drag = state.dragging;
  if (!drag || drag.type !== 'transform') return;
  state.dragging = null;
  if (Number.isFinite(event.pointerId) && gizmo.hasPointerCapture?.(event.pointerId))
    gizmo.releasePointerCapture(event.pointerId);
  handle.classList.remove('active');
  sceneRenderer.endTransformGhost();
  sceneCanvas.classList.remove('is-rotate');
  const viewport = $('#viewport');
  const rect = viewport.getBoundingClientRect();
  const field = document.createElement('div');
  field.className = 'precise-rotation-input';
  field.style.left = `${Math.min(rect.width - 118, Math.max(8, event.clientX - rect.left + 14))}px`;
  field.style.top = `${Math.max(8, event.clientY - rect.top - 32)}px`;
  field.innerHTML = '<input type="number" step="any" value="0" aria-label="旋轉角度（度）"/><span>°</span>';
  viewport.append(field);
  preciseRotationInput = field;
  const input = field.querySelector('input');
  input.focus(); input.select();
  const outside = down => {
    if (field.contains(down.target)) return;
    document.removeEventListener('pointerdown', outside, true);
    dismissPreciseRotationInput();
  };
  document.addEventListener('pointerdown', outside, true);
  input.addEventListener('keydown', keyEvent => {
    if (keyEvent.key !== 'Enter') return;
    const degrees = Number(input.value);
    if (!Number.isFinite(degrees)) return;
    keyEvent.preventDefault();
    if (degrees) {
      snapshot('core.element.precise_rotation');
      applyExactRotation(drag, degrees * drag.rotationScreenSign);
      invalidateSelectionRenderGeometry();
      sceneRenderer.invalidateMirrorGeometry();
      markDirty();
      renderInspector();
      renderScene();
    }
    document.removeEventListener('pointerdown', outside, true);
    dismissPreciseRotationInput();
  });
}

function applyExactRotation(drag, degrees) {
  if (drag.targets.length > 1) {
    const commonAxis = drag.axis?.vector.map(value => value * drag.sign) || [0, 1, 0];
    const commonPivot = drag.selectionContext.pivot || drag.selectionContext.center || state.gizmoOrigin;
    for (const target of drag.targets) {
      const separate = drag.multiTransformMode === 'separate';
      const targetAxis = separate && drag.kind === 'rotate' ? target.transformAxes[drag.axisIndex] : commonAxis;
      if (!separate) {
        const next = rotatePointAroundAxis(target.worldAnchor, commonPivot, targetAxis, degrees);
        translateCapturedTarget(target, localDeltaFromWorld(target,
          next.map((value, axis) => value - target.worldAnchor[axis])));
      }
      applyTargetRotation(target, targetAxis, degrees, {
        separate, selfRelative: separate && drag.kind === 'rotate' && state.transformSpace === 'self',
        axisIndex: drag.axisIndex
      });
    }
    return;
  }
  if (drag.curveNodeContext?.curve.dimension === 3 && state.transformSpace === 'self'
    && drag.kind === 'rotate' && drag.axisIndex === 2) {
    drag.curveNodeContext.node.roll = drag.nodeRoll + degrees;
    return;
  }
  if (drag.curveNodeContext?.node.autoTangent) bakeCurveNodeTangent(drag.curveNodeContext.curve, drag.curveNodeContext.index);
  const target = drag.modifierAnchorContext?.modifier.anchor || drag.curveNodeContext?.node || drag.item;
  const turn = quaternionFromAxisAngle(drag.rotationAxis, degrees);
  const current = quaternionFromEuler(drag.rotation);
  target.rotation = eulerFromQuaternion(state.transformSpace === 'self' && drag.kind !== 'rotate-view'
    ? quaternionMultiply(current, turn) : quaternionMultiply(turn, current));
  if (drag.curveNodeContext?.curve.dimension === 2) {
    target.rotation[0] = 0; target.rotation[2] = 0;
  }
  if (drag.curveNodeContext) drag.curveNodeContext.node.autoTangent = false;
}

function onPointerMove(event) {
  if (state.dragging?.type === 'texture-paint-3d') {
    event.preventDefault?.();
    moveScenePaintDrag(event);
    return;
  }
  if (state.tool === 'knife' && !state.dragging) {
    updateKnifeHover(event);
    return;
  }
  if (state.tool === 'gradient' && !state.dragging && state.paintGradientAnchor) {
    updatePaintGradientHover(event);
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
      snapshot('core.curve.node_move');
      discardSubdivisionEdits(drag.curve);
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
    ).map(value => snapValue(value, event));
    if (drag.curve.dimension === 2) handle[1] = 0;
    if (isBezierElement(drag.curve)) drag.node.autoTangent = false;
    setCurveHandle(drag.node, drag.property, handle, drag.curve.dimension === 2);
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
      snapshot(state.dragging.tool === 'resize' ? 'core.element.scale'
        : state.dragging.tool === 'rotate' ? 'core.element.rotate'
          : state.dragging.tool === 'pivot' ? 'core.element.pivot' : 'core.element.move');
      if (state.dragging.tool === 'resize') {
        state.dragging.targets.forEach(target => discardSubdivisionEdits(target.node));
      }
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

function onScenePointerMove(event) {
  if (event.pointerType === 'pen' && state.dragging?.type === 'texture-paint-3d'
    && typeof event.getCoalescedEvents === 'function') {
    const samples = event.getCoalescedEvents();
    if (samples.length) {
      event.preventDefault();
      for (const sample of samples) moveScenePaintDrag(sample);
      return;
    }
  }
  onPointerMove(event);
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
  if (finishedDrag.type === 'texture-paint-3d') {
    if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      finishedDrag.latestClient = [event.clientX, event.clientY];
      if (finishedDrag.multiSurface) queueSceneBrushPointer(finishedDrag, event.clientX, event.clientY);
      else if (finishedDrag.ready) moveScenePaintDrag(event, finishedDrag);
    }
    state.dragging = null;
    const captureTarget = event.currentTarget;
    if (captureTarget.hasPointerCapture?.(event.pointerId)) captureTarget.releasePointerCapture(event.pointerId);
    finishedDrag.ended = true;
    if (finishedDrag.ready) finishScenePaintDrag(finishedDrag);
    return;
  }
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
      if (finishedDrag.generatedHit && !state.modifierResultGhost) {
        sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
        state.selectedUids = new Set(); state.selectedUid = null;
        state.selectedGenerated = {
          uid: finishedDrag.generatedHit.uid,
          instanceKey: finishedDrag.generatedHit.instanceKey
        };
        state.selectedCurveNodeIndex = null; state.selectedModifierUid = null;
        refreshSelectionUi();
      } else if (finishedDrag.hitUid) selectItem(finishedDrag.hitUid, {
        revealInOutliner: true,
        toggle: event.ctrlKey || event.metaKey,
        range: event.shiftKey
      });
      else if (!finishedDrag.suppressBlankDeselect) clearSelection();
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
    if (finishedDrag.modifierAnchorContext) {
      const { owner, modifier } = finishedDrag.modifierAnchorContext;
      if (modifier.type === 'paint_symmetry') {
        paintSymmetryRelationCache.delete(modifier.uid);
        schedulePaintSymmetryBuild(owner, modifier);
      }
      renderInspector();
    }
    else syncInspectorValues();
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
  const fallbackScale = drag.axis?.worldPerPixel || drag.referenceWorldPerPixel || (currentProjection() === 'perspective'
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
    if (drag.modifierAnchorContext) {
      drag.modifierAnchorContext.modifier.anchor.position = nextPivot;
    } else if (drag.curveNodeContext) {
      drag.curveNodeContext.node.position = nextPivot.map((value, axis) => drag.curveNodeContext.curve.dimension === 2 && axis === 1 ? 0 : value);
    } else if (item.type === 'node') item.position = nextPivot;
    else setPivotPreservingGeometry(state.project, item, nextPivot);
    drag.tooltipText = `${drag.modifierAnchorContext ? '對稱軸點' : drag.curveNodeContext || item.type === 'node' ? '節點' : '樞軸'} ${nextPivot.map(formatNumber).join(' / ')}`;
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
    if (drag.modifierAnchorContext) {
      drag.modifierAnchorContext.modifier.anchor.position = next;
    } else if (drag.curveNodeContext) {
      drag.curveNodeContext.node.position = next.map((value, axis) => drag.curveNodeContext.curve.dimension === 2 && axis === 1 ? 0 : value);
    } else if (item.type === 'cube') {
      const applied = next.map((value, axis) => value - drag.position[axis]);
      item.position = next;
      item.pivot = drag.pivot.map((value, axis) => value + applied[axis]);
      translateModifierAnchorsFromSnapshot(item, drag.modifierAnchors, applied);
    } else if (item.origin) {
      const applied = next.map((value, axis) => value - drag.position[axis]);
      item.origin = next;
      if (isShapeElement(item) && drag.pivot) item.pivot = drag.pivot.map((value, axis) => value + applied[axis]);
      translateModifierAnchorsFromSnapshot(item, drag.modifierAnchors, applied);
    }
    else if (item.position) {
      item.position = next;
      translateModifierAnchorsFromSnapshot(item, drag.modifierAnchors, next.map((value, axis) => value - drag.position[axis]));
    }
    else if (item.type === 'group') {
      const delta = next.map((value, axis) => value - drag.position[axis]);
      item.pivot = next;
      translateModifierAnchorsFromSnapshot(item, drag.modifierAnchors, delta);
      drag.groupMembers.forEach(member => {
        if (member.node.type === 'cube') {
          member.node.position = member.position.map((value, axis) => value + delta[axis]);
          member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
        } else if (member.node.origin) {
          member.node.origin = member.position.map((value, axis) => value + delta[axis]);
          if (isShapeElement(member.node) && member.pivot) member.node.pivot = member.pivot.map((value, axis) => value + delta[axis]);
        }
        else if (member.node.position) member.node.position = member.position.map((value, axis) => value + delta[axis]);
        else member.node.pivot = member.position.map((value, axis) => value + delta[axis]);
        translateModifierAnchorsFromSnapshot(member.node, member.modifierAnchors, delta);
      });
    }
  }
  if (drag.tool === 'resize' && drag.resizeBatch) {
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
            if ((drag.axisSigns[index] || 1) < 0) position[targetAxis] = target.position[targetAxis] - (size[targetAxis] - target.size[targetAxis]);
          });
        } else {
          const targetAxis = drag.axis ? drag.axisIndex : 0;
          const requestedChange = drag.axis ? snapValue(axisDelta, event) : snapValue(dx * fallbackScale, event);
          const proposed = target.size[targetAxis] + requestedChange;
          size[targetAxis] = state.allowNegativeSize ? proposed : Math.max(0, proposed);
          if (drag.axis && drag.sign < 0) position[targetAxis] = target.position[targetAxis] - (size[targetAxis] - target.size[targetAxis]);
        }
        targetItem.position = position;
        targetItem.size = size;
      } else if (isShapeElement(targetItem)) {
        if (targetItem.shapeType !== 'polygon_prism') {
          const distance = drag.kind === 'uniform'
            ? target.radius * (Math.max(0, 1 - dy * .01) - 1)
            : drag.kind === 'plane-uniform'
              ? getPlaneUniformDistance(drag, dx, dy)
              : drag.kind === 'plane'
                ? planeDistances.reduce((sum, value) => sum + value, 0) / Math.max(1, planeDistances.length)
                : axisDelta ?? dx * fallbackScale;
          targetItem.parameters.radius = Math.max(0, snapShapeDimension(targetItem, 'radius', target.radius + distance, event));
        } else if (drag.kind === 'plane-uniform') {
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
    if (isShapeElement(item)) {
      if (item.shapeType !== 'polygon_prism') {
        const distances = drag.kind === 'plane' ? getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event)) : [];
        const distance = drag.kind === 'uniform'
          ? drag.radius * (Math.max(0, 1 - dy * .01) - 1)
          : drag.kind === 'plane-uniform'
            ? getPlaneUniformDistance(drag, dx, dy)
            : drag.kind === 'plane'
              ? distances.reduce((sum, value) => sum + value, 0) / Math.max(1, distances.length)
              : axisDelta ?? dx * fallbackScale;
        item.parameters.radius = Math.max(0, snapShapeDimension(item, 'radius', drag.radius + distance, event));
        drag.tooltipText = `半徑 ${formatNumber(item.parameters.radius)} / 邊長 ${formatNumber(polyhedronEdgeLength(item, item.parameters.radius))} px`;
      } else if (drag.kind === 'plane-uniform') {
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
        const distances = getPlaneDragDistances(drag, event, dx, dy).map(value => snapValue(value, event));
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
        const target = drag.modifierAnchorContext?.modifier.anchor || drag.curveNodeContext?.node || item;
        target.rotation = [...drag.rotation];
        target.rotation[drag.axisIndex] = drag.rotation[drag.axisIndex] + snappedDelta;
      } else {
        const turn = quaternionFromAxisAngle(drag.rotationAxis, snappedDelta);
        const current = quaternionFromEuler(drag.rotation);
        const target = drag.modifierAnchorContext?.modifier.anchor || drag.curveNodeContext?.node || item;
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
      const target = drag.modifierAnchorContext?.modifier.anchor || drag.curveNodeContext?.node || item;
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
      if (node !== group) members.push({ node, position: [...node.pivot], modifierAnchors: captureModifierAnchors(node) });
      node.children.forEach(visit);
    } else if (node.type === 'cube') members.push({ node, position: [...node.position], pivot: [...node.pivot], modifierAnchors: captureModifierAnchors(node) });
    else if (node.position) members.push({ node, position: [...node.position], modifierAnchors: captureModifierAnchors(node) });
    else members.push({ node, position: [...node.origin], pivot: Array.isArray(node.pivot) ? [...node.pivot] : null, modifierAnchors: captureModifierAnchors(node) });
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

function polyhedronEdgeLength(shape, radius) {
  const value = Math.max(0, Number(radius) || 0);
  if (shape?.shapeType === 'dodecahedron') return value * 4 / (Math.sqrt(3) * (1 + Math.sqrt(5)));
  if (shape?.shapeType === 'truncated_icosahedron') return value * 4 / Math.sqrt(58 + 18 * Math.sqrt(5));
  const sides = Math.max(3, Math.round(Number(shape?.parameters?.sides) || 3));
  return value * 2 * Math.sin(Math.PI / sides);
}

function radiusFromPolyhedronEdge(shape, edgeLength) {
  const unitEdge = polyhedronEdgeLength(shape, 1);
  return unitEdge > 1e-8 ? edgeLength / unitEdge : 0;
}

function snapShapeDimension(shape, key, value, event = {}) {
  if (key !== 'radius') return snapValue(value, event);
  if (shape?.parameters?.snapMode === 'radius') return snapValue(value, event);
  return radiusFromPolyhedronEdge(shape, snapValue(polyhedronEdgeLength(shape, value), event));
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
void offerProjectRecovery();
