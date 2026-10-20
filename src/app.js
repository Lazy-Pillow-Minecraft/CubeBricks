import { BezierElement, Cube, CurveNode, Group, Locator, NodeElement, Shape, CubeBricksProject, addModifier, addOperator, bakeModifier, bakeProceduralShape, exportBlockbench, getModifier, importBlockbench, setPivotPreservingGeometry } from './model.js';
import { ConfigKey, applyLanguage, configRegistry, getLanguageLabel } from './common/config/app-config.js';
import { createModelProjectData, modelFormatRegistry } from './common/config/model-formats.js';
import { modifierRegistry } from './common/config/modifiers.js';
import { operatorRegistry } from './common/config/operators.js';
import { allocateGroupName, refreshAutomaticNodeName, setNodeName, setNodeUnnamed } from './model.js';
import { activeLayer, compositeLayers, flipbookFrame, imageCanvas, layerRasterCache, loadRaster, prepareLayers, tiledFaceRaster, tiledFaceReference, tiledFaceRegions, faceTileSize } from './common/core/texture-features.js';
import { WebGLSceneRenderer, applyGroupTransforms, createBlockbenchFaceUvSlots, getBlockbenchBoxUv, getMinecraftRenderType, isCubeFaceCulled } from './render/webgl-renderer.js';
import { DockManager } from './screen/dock-manager.js';
import { DEFAULT_PLAYER_REFERENCE_TEXTURE, createPlayerReferenceProject } from './assets/player-reference.js';
import { operationDefinition, operationIndex, requireOperation } from './common/core/operation-registry.js';
import { JavaBlockVersion, formatRules, constrainNode, constrainProject } from './common/core/format-constraints.js';
import { findVertexSnapIntersections } from './common/core/vertex-intersections.js';
import { shapeRegistry } from './shapes/builtins.js';
import { state } from './editor/state.js';
import { TOOL_REGISTRY, PAINT_TOOLS, PAINT_STROKE_TOOLS, PAINT_SHAPE_TOOLS, PAINT_ERASE_TOOLS } from './editor/tool-registry.js';
import { DOCK_PANEL_DEFINITIONS } from './screen/dock-definitions.js';
import { createListDragAutoScroll } from './screen/list-drag-scroll.js';
import { rgbToHsv, hsvToRgb, rgbToHex, insetControlRatio, insetControlPosition, trianglePickerGeometry, barycentric2d, closestPointOnTriangle2d, TRIANGLE_RING_WIDTH } from './screen/color-picker/math.js';
import { createTextureTemplateController } from './texture/template-controller.js';
import { dot3, cross3, normalize3 } from './utils/math/vector3.js';
import { rotateVector, inverseRotateVector, quaternionMultiply, quaternionFromEuler, quaternionFromAxisAngle, eulerFromQuaternion } from './utils/math/rotation.js';
import { createColorPickerController } from './screen/color-picker/controller.js';
import { pickerSession } from './screen/color-picker/session.js';
import { createPaletteController } from './screen/palette/controller.js';
import { createPaintSymmetryController, paintSymmetryRelationCache } from './paint/symmetry-relations.js';
import { createModelCaptureController } from './render/model-capture.js';
import { createReferenceImageController } from './screen/reference-images.js';
import { createKnifeController } from './editor/knife-controller.js';
import { createMirrorGuideController } from './screen/mirror-guides.js';
import { createCameraController } from './screen/camera-controller.js';
import { PROJECT_SESSION_KEYS, createProjectTabsController } from './project/tabs-controller.js';
import { createProjectJournalController } from './project/journal-controller.js';
import { createInspectorController } from './screen/inspector-controller.js';
import { createGizmoController } from './screen/gizmo-controller.js';
import { createUvPreviewController } from './screen/uv-preview-controller.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const LOCATOR_ICON_SHAPES = '<path d="M98.74,144.52c-38.86,0-72.06-19.5-85.3-46.99-1.11,4.43-1.7,9-1.7,13.69,0,38.28,38.95,69.32,87,69.32s87-31.03,87-69.32c0-4.69-.59-9.26-1.7-13.69-13.24,27.49-46.44,46.99-85.3,46.99Z"/><rect x="81.01" y="56.54" width="35.47" height="96.98"/><rect x="59.53" y="77.83" width="78.43" height="25.75" rx="7.93" ry="7.93"/><path d="M98.74,0c-18.89,0-34.21,15.31-34.21,34.21s15.31,34.21,34.21,34.21,34.21-15.31,34.21-34.21S117.63,0,98.74,0ZM98.74,49.2c-8.28,0-14.99-6.71-14.99-14.99s6.71-14.99,14.99-14.99,14.99,6.71,14.99,14.99-6.71,14.99-14.99,14.99Z"/><path d="M26.73,85.59l17.01,31.01c1.89,3.45-.6,7.66-4.54,7.66H5.18c-3.93,0-6.43-4.22-4.54-7.66l17.01-31.01c1.96-3.58,7.11-3.58,9.07,0Z"/><path d="M179.83,85.59l17.01,31.01c1.89,3.45-.6,7.66-4.54,7.66h-34.03c-3.93,0-6.43-4.22-4.54-7.66l17.01-31.01c1.96-3.58,7.11-3.58,9.07,0Z"/><path d="M97.08,188.46l-18.84-16.15c-1.8-1.55-.71-4.5,1.67-4.5h37.68c2.38,0,3.47,2.96,1.67,4.5l-18.84,16.15c-.96.82-2.37.82-3.33,0Z"/>';
const CUBE_FACE_NAMES = ['north', 'east', 'south', 'west', 'up', 'down'];
const PAINT_FACE_EDGES = Object.freeze([[0, 1], [1, 3], [2, 3], [0, 2]]);
const livePaintTextureSources = new Map();
const blobTextureSourceCache = new Map();
const animationRasterCache = new Map();
const paintHitAlphaCache = new Map();
let recentRotationPress = null;
let pendingRotationPress = null;
let preciseRotationInput = null;


let temporaryPaintTool = null;


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
const palette = createPaletteController({
  state, $, $$, clamp, escapeHtml, escapeAttribute, hexToRgb, snapshot,
  renderPaintGradientPreview, setPaintColor,
  updatePaintColorPickerVisual: (...args) => updatePaintColorPickerVisual(...args),
  renderPaintColorPicker: (...args) => renderPaintColorPicker(...args),
  renderInspector, toast, selected, noteJournalOperation, markDirty, renderAll
});
const { paletteRows, renderPalette, renderPaintColorHistory, recordPaintColorHistory,
  syncPaletteSelectionToPaintColor, samplePaletteGradient, addPaletteRow,
  openColorSpaceCurveEditor, addPaintSwatchToSelection, deleteSelectedPaletteColor, applyPaletteColor } = palette;
const { updatePaintColorPickerVisual, renderPaintColorPicker, openColorPickerPopup } = createColorPickerController({
  state, inspector, hexToRgb, setPaintColor, renderPaintColorHistory, recordPaintColorHistory,
  renderInspector, setTool, addPaintSwatchToSelection
});
const { selectedMirrorGuideGroup, mirrorControllerWorldFrame, symmetryModifierAngles,
  finiteWorldGuideMarkup, updateMirrorGuideOverlay } = createMirrorGuideController({
  state, $, sceneCanvas, sceneRenderer, selected, isShapeElement,
  projectViewportPoint, addScaled3, clamp
});
const { paintSymmetryFaceKey, paintSymmetryRelatedHits, scheduleAllPaintSymmetryBuilds,
  schedulePaintSymmetryBuild, ensurePaintSymmetryCache } = createPaintSymmetryController({
  state, sceneRenderer, faceUvPixelSlots, symmetryModifierAngles,
  mirrorControllerWorldFrame, barycentricPoint, renderInspector, PAINT_FACE_EDGES
});
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
const referenceImages = createReferenceImageController({
  state, $, $$, escapeHtml, viewport, sceneRenderer,
  referenceImageInput, referenceImageLayer, referenceImageHint, snapshot, markDirty, toast
});
const { referenceViewKey, updateReferenceImageLayer, setReferenceImageEditing, setReferenceImageMenu,
  beginReferenceImageImport, resetReferenceImage, removeReferenceImage, loadReferenceImageFiles,
  beginReferenceImageDrag, moveReferenceImageDrag, endReferenceImageDrag, scaleReferenceImage } = referenceImages;
const cameraController = createCameraController({
  state, $, $$, sceneCanvas, sceneRenderer, viewport,
  renderScene, toast, mapProjectionZoom, setReferenceImageEditing
});
const { bakeCameraPan, cancelCameraFocus, focusSelected, focusSceneOrigin, currentProjection,
  updateProjectionControls, enterAxisView, exitAxisView, updateAxisWidget,
  beginAxisWidgetDrag, moveAxisWidgetDrag, endAxisWidgetDrag } = cameraController;
const { captureModel, saveModelCapture, copyModelCapture, clearModelCapture } = createModelCaptureController({
  state, $, sceneCanvas, sceneRenderer, textureCanvas,
  getTextureAtlasEntries: () => textureAtlasEntries, getTextureAtlasCanvas: () => textureAtlasCanvas,
  currentProjection, toast
});
const projectTabsController = createProjectTabsController({
  state, $, escapeHtml, escapeAttribute, projectTabsNode, projectState, projectInfoDialog,
  textureUid, restoreProjectTextureView, renderAll,
  getSubdivisionSession: () => inspectorController.subdivisionSession, exitSubdivisionEdit, referenceImages,
  cancelCameraFocus, sceneRenderer, startProjectJournal, flushProjectJournal, toast,
  compactProjectHistorySnapshot, markDirty, scheduleProjectJournal
});
const { projectTabById, projectTabLabel, discardProjectTabJournal,
  createProjectSession, captureProjectSession, syncActiveProjectTab,
  renderProjectTabs, updateProjectStateLabel, activateProjectTab, addProjectTab,
  closeProjectTab, projectTabInsertionIndex, previewProjectTabInsertion,
  moveProjectTabToIndex, openProjectInfo, applyProjectInfo, initializeProjectTabs,
  requestProjectClose, confirmProjectClose } = projectTabsController;
const journalController = createProjectJournalController({
  state, projectTabsController, textureCanvas, isBezierElement, textureUid,
  clearSubdivisionSession: () => { inspectorController.subdivisionSession = null; }, renderAll, toast,
  renderTextureList, activateProjectTexture, rebuildTextureAtlas,
  invalidateAllRenderGeometry, restoreProjectTextureView,
  serializableTextureAssets, serializeCbmodel, referenceImages,
  getTexturePaintDrag: () => texturePaintDrag, getTextureUvDrag: () => textureUvDrag
});
const { getKnifePreviewLabel, updateKnifeHover, refreshKnifeFromModifierEvent,
  cancelKnifeSelection, useKnifePoint, buildEditorOverlayLines } = createKnifeController({
  state, sceneCanvas, sceneRenderer, worldPointToCubeLocal, cubeLocalPointToWorld,
  snapValue, clamp, updateToolOptions, renderScene, renderAll,
  freezeCubeUvs, snapshot, markDirty, toast, isBezierElement, selected, selectItem, hexToRgb
});
const { createTextureTemplate } = createTextureTemplateController({
  state, $, CUBE_FACE_NAMES, getSelectionExpansion, isProceduralShape,
  getSubdivisionSession: () => inspectorController.subdivisionSession, subdivisionPatch, syncSubdivisionEdits,
  invalidateUvPreviewTextureState, renderTextureList, activateProjectTexture,
  markDirty, snapshot, toast, setCubeFaceCulled, invalidateAllRenderGeometry,
  renderAll, activeSnapSubdivisions, textureAssetForReference, loadTextureAssetImage
});
const playerReferenceTextureInput = $('#playerReferenceTextureInput');
const playerReferenceProject = createPlayerReferenceProject();
let toastTimer;
let outlinerFrame = null;
let outlinerDragGhost = null;
let dockManager = null;
let lockedHoverFrame = null;
let lockedHoverPickFrame = null;
let lockedHoverPointer = null;
let sceneRenderFrame = null;
let transformUpdateFrame = null;
let texturePreviewSize = [1, 1];
let shapePacksReady = Promise.resolve();
let selectionExpansionCache = null;
let selectionTransformContextCache = null;
let focusedDockHotspot = null;
let textureUvDrag = null;
let texturePaintDrag = null;
let texturePaintSyncFrame = null;
const texturePaintSyncTargets = new Map();
let textureFaceDropTarget = null;
let textureLoadRevision = 0;
let pendingTextureImage = null;
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
let playerReferenceTextureRevision = 0;


function restoreProjectTextureView() {
  // Texture previews and the scene atlas are separate consumers. Rebuild the
  // atlas as soon as a project becomes active; otherwise an image-load callback
  // for the currently selected preview is the only thing that starts it.
  textureLoadRevision++;
  textureAtlasRevision++;
  textureAtlasEntries = [];
  textureAtlasLayoutByUid = new Map();
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

function compactProjectHistorySnapshot(...args) { return journalController.compactProjectHistorySnapshot(...args); }
function snapshot(...args) { return journalController.snapshot(...args); }
function undo(...args) { return journalController.undo(...args); }
function redo(...args) { return journalController.redo(...args); }
function markDirty(...args) { return journalController.markDirty(...args); }
function startProjectJournal(...args) { return journalController.startProjectJournal(...args); }
function scheduleProjectJournal(...args) { return journalController.scheduleProjectJournal(...args); }
function noteJournalOperation(...args) { return journalController.noteJournalOperation(...args); }
function flushProjectJournal(...args) { return journalController.flushProjectJournal(...args); }


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
  uvPreviewController.uvPreviewRenderDirty = true;
  textureUvEntryCache = null;
  selectionTransformContextCache = null;
  if (uvPreviewController.uvPreviewProjectCache) uvPreviewController.uvPreviewProjectCache.fit = null;
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
  uvPreviewController.uvPreviewRenderDirty = true;
  selectionTransformContextCache = null;
  if (geometryChanged) {
    if (selectionAffectsMirrorPreview()) sceneRenderer.invalidateMirrorGeometry();
    uvPreviewRenderer.invalidateGeometry();
    textureUvEntryCache = null;
    if (uvPreviewController.uvPreviewProjectCache) uvPreviewController.uvPreviewProjectCache.fit = null;
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
    return `<button class="outliner-item ${state.mode === 'paint' ? 'paint-flags' : state.outlinerDetailed ? 'has-details' : ''} ${state.selectedUids.has(node.uid) && state.selectedCurveNodeIndex === null ? 'active' : ''} ${state.outlinerDragUids?.includes(node.uid) ? 'is-dragging' : ''}" data-uid="${node.uid}" draggable="false" style="padding-left:${5 + depth * 13}px">
      ${container ? `<span class="outliner-disclosure-hit" data-disclosure="${node.uid}" title="${collapsed ? '展開' : '折疊'}" draggable="false">${openIconMarkup(collapsed ? 'right' : 'down', 'outliner-disclosure')}</span>` : '<span class="outliner-disclosure-spacer"></span>'}
      <span class="kind">${outlinerKindMarkup(node)}</span>
      <span class="item-name">${escapeHtml(node.name)}</span>${outlinerStateMarkup(node)}
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
  if (state.mode === 'paint') return outlinerFlag(node, 'locked', node.locked === true,
    'icon-locked', 'icon-unlocked', '鎖定', '解鎖') + visible;
  if (!state.outlinerDetailed) return visible;
  const autoUvAvailable = isUvCapable(node) && node.uvMode !== 'box';
  return [
    ...(autoUvAvailable ? [outlinerFlag(node, 'autoUv', nodeAutoUvEnabled(node), 'icon-uv-update', 'icon-unuv-update', '自動 UV', '不自動更新 UV', true)] : []),
    outlinerFlag(node, 'uvNormalized', nodeUvNormalizedEnabled(node), 'icon-uv-normalize', 'icon-unuv-normalize', 'UV 歸一化', '保留原 UV 像素', isUvCapable(node)),
    outlinerFlag(node, 'exported', node.exported !== false, 'icon-save', 'icon-unsave', '參與後續格式轉換', '不參與後續格式轉換'),
    outlinerFlag(node, 'locked', node.locked === true, 'icon-locked', 'icon-unlocked', '鎖定', '解鎖'),
    visible
  ].join('');
}

function outlinerKindMarkup(node) {
  if (node.type === 'node') return '<span class="outliner-curve-kind" aria-hidden="true">●</span>';
  if (node.type === 'bezier2d' || node.type === 'bezier3d') return `<span class="outliner-curve-kind" aria-hidden="true">⌁${node.type === 'bezier2d' ? '²' : '³'}</span>`;
  if (isShapeElement(node)) {
    const icon = shapeRegistry.get(node.shapeType)?.icon;
    return icon?.startsWith('data:image/')
      ? `<img class="outliner-kind-icon object-icon" alt="" src="${escapeAttribute(icon)}" />`
      : `<svg class="outliner-kind-icon object-icon" aria-hidden="true"><use href="#icon-${icon || 'shape'}"></use></svg>`;
  }
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

const inspectorController = createInspectorController({
  state, $, $$, inspector, sceneRenderer, topLevelSelectedUids, selected, round,
  setTool, invalidateAllRenderGeometry, renderAll, updateToolVisibility, toast,
  openIconMarkup, escapeHtml, escapeAttribute, renderPaintColorPicker,
  polyhedronEdgeLength, formatNumber, freezeCubeUvs, openColorPickerPopup,
  snapshot, markDirty, invalidateSelectionRenderGeometry, renderScene,
  syncInspectorValues, translateModifierAnchors, setCurveHandle,
  bakeCurveNodeTangent, updateSelectionLabels, setMode, schedulePaintSymmetryBuild,
  deleteSelected, isUvCapable
});
function inspectorBatchNodes(...args) { return inspectorController.inspectorBatchNodes(...args); }
function sharedVectorValues(...args) { return inspectorController.sharedVectorValues(...args); }
function isBezierElement(...args) { return inspectorController.isBezierElement(...args); }
function isShapeElement(...args) { return inspectorController.isShapeElement(...args); }
function isProceduralShape(...args) { return inspectorController.isProceduralShape(...args); }
function subdivisionOwner(...args) { return inspectorController.subdivisionOwner(...args); }
function subdivisionPatch(...args) { return inspectorController.subdivisionPatch(...args); }
function syncSubdivisionEdits(...args) { return inspectorController.syncSubdivisionEdits(...args); }
function enterSubdivisionEdit(...args) { return inspectorController.enterSubdivisionEdit(...args); }
function exitSubdivisionEdit(...args) { return inspectorController.exitSubdivisionEdit(...args); }
function discardSubdivisionEdits(...args) { return inspectorController.discardSubdivisionEdits(...args); }
function renderInspector(...args) { return inspectorController.renderInspector(...args); }
function setNodeVisibility(...args) { return inspectorController.setNodeVisibility(...args); }
function setNodeFlag(...args) { return inspectorController.setNodeFlag(...args); }

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
  if (inspectorController.subdivisionSession && requestedNode.subdivisionOwnerUid !== inspectorController.subdivisionSession.ownerUid) {
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
  const definition = shapeRegistry.get(shapeType);
  if (!definition || ['bezier2d', 'bezier3d'].includes(shapeType)) return;
  snapshot('core.shape.create');
  const type = shapeType;
  const shape = new Shape({ type, shapeType: type, origin: [0, 2, 0], pivot: [0, 2, 0] });
  state.project.elements.push(shape);
  insertNewNodeUid(shape.uid);
  selectCreatedNode(shape.uid);
  const label = definition.label;
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
  if (inspectorController.subdivisionSession && selectedIds.some(uidValue => state.project.getNode(uidValue)?.subdivisionOwnerUid)) {
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
    else if (data.type === 'shape' || shapeRegistry.has(data.shapeType || data.type) && !['bezier2d', 'bezier3d'].includes(data.type)) node = new Shape(data);
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

const uvPreviewController = createUvPreviewController({
  state, $, $$, uvPreviewCanvas, uvPreviewViewport, uvPreviewRenderer,
  sceneRenderer, textureCanvas, getTextureAtlasEntries: () => textureAtlasEntries,
  getTextureAtlasCanvas: () => textureAtlasCanvas, getDockManager: () => dockManager,
  selectedElementUids, isShapeElement, isBezierElement,
  faceTextureReference, activeTextureAsset, renderTextureTileControls,
  formatNumber, addScaled3, uvFaceKey, parseUvFaceKey, snapshot, markDirty,
  invalidateSelectionRenderGeometry, renderScene, renderAll, toast
});
function uvPreviewIsActive(...args) { return uvPreviewController.uvPreviewIsActive(...args); }
function uvPreviewElements(...args) { return uvPreviewController.uvPreviewElements(...args); }
function getUvPreviewProject(...args) { return uvPreviewController.getUvPreviewProject(...args); }
function syncUvPreviewPanelAspect(...args) { return uvPreviewController.syncUvPreviewPanelAspect(...args); }
function effectiveFaceTextureReference(...args) { return uvPreviewController.effectiveFaceTextureReference(...args); }
function ensureCubeFaceRecord(...args) { return uvPreviewController.ensureCubeFaceRecord(...args); }
function setCubeFaceCulled(...args) { return uvPreviewController.setCubeFaceCulled(...args); }
function selectedUvFaceData(...args) { return uvPreviewController.selectedUvFaceData(...args); }
function updateUvFaceUi(...args) { return uvPreviewController.updateUvFaceUi(...args); }
function editSelectedUvFace(...args) { return uvPreviewController.editSelectedUvFace(...args); }
function renderUvPreview(...args) { return uvPreviewController.renderUvPreview(...args); }
function stopUvPreviewAnimation(...args) { return uvPreviewController.stopUvPreviewAnimation(...args); }
function refreshUvPreview(...args) { return uvPreviewController.refreshUvPreview(...args); }

function renderScene() {
  if (sceneRenderFrame !== null) cancelAnimationFrame(sceneRenderFrame);
  sceneRenderFrame = null;
  const hidePaintSelection = state.mode === 'paint';
  sceneRenderer.render(state.project, hidePaintSelection ? null : state.selectedUid, {
    ...state,
    selectedUids: hidePaintSelection ? new Set() : state.selectedUids,
    selectedUvFaces: hidePaintSelection ? new Set() : state.selectedUvFaces,
    projection: currentProjection(),
    subdivisionEditOwnerUid: inspectorController.subdivisionSession?.ownerUid || null,
    lockedDefaultAlpha: inspectorController.subdivisionSession ? 12 : state.lockedDefaultAlpha,
    lockedHoverFade: inspectorController.subdivisionSession ? false : state.lockedHoverFade,
    editorOverlayLines: buildEditorOverlayLines()
  });
  updateLocatorOverlay();
  updateMirrorGuideOverlay();
  updateTransformGizmo();
  updateAxisWidget();
  updateReferenceImageLayer();
  refreshUvPreview(false);
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
  uvPreviewController.uvPreviewRenderDirty = true;
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
    if (overlay.childElementCount) overlay.replaceChildren();
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
  const existing = new Map([...overlay.querySelectorAll('[data-locator-uid]')]
    .map(node => [node.dataset.locatorUid, node]));
  icons.forEach(({ element, point, size, opacity }, index) => {
    let node = existing.get(element.uid);
    if (!node) {
      node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      node.classList.add('locator-screen-icon');
      node.dataset.locatorUid = element.uid;
      node.setAttribute('viewBox', '0 0 197.49 189.08');
      node.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      node.innerHTML = LOCATOR_ICON_SHAPES;
    }
    existing.delete(element.uid);
    node.classList.toggle('selected', selectedElements.has(element.uid));
    node.setAttribute('x', point.x - size / 2);
    node.setAttribute('y', point.y - size / 2);
    node.setAttribute('width', size);
    node.setAttribute('height', size);
    node.setAttribute('opacity', opacity);
    node.setAttribute('aria-label', element.name);
    if (overlay.children[index] !== node) overlay.insertBefore(node, overlay.children[index] || null);
  });
  existing.forEach(node => node.remove());
  overlay.toggleAttribute('hidden', icons.length === 0);
}

function isEffectivelyLocked(uidValue) {
  return sceneRenderer.isLocked(uidValue);
}

function lockedObjectOpacity(uidValue, screenPoint) {
  if (!isEffectivelyLocked(uidValue)) return 1;
  const base = inspectorController.subdivisionSession ? .12 : state.lockedDefaultAlpha / 100;
  const hover = state.lockedHoverAlpha / 100;
  if (inspectorController.subdivisionSession || !state.lockedHoverFade || !state.lockedHoverPoint || !screenPoint || state.lockedHoverStrength <= 0) return base;
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

const gizmoController = createGizmoController({
  state, $, sceneCanvas, sceneRenderer, selected, isBezierElement,
  isShapeElement, getTransformPivot, selectedMirrorGuideGroup,
  mirrorControllerWorldFrame, activeCurveNodeContext,
  activeModifierAnchorContext, getSelectionTransformContext,
  getModifierAnchorTransformAxes, getCurveNodeTransformAxes,
  getSelectionTransformAxes, isEffectivelyLocked, finiteWorldGuideMarkup
});
function addScaled3(...args) { return gizmoController.addScaled3(...args); }
function intersectRayPlane(...args) { return gizmoController.intersectRayPlane(...args); }
function projectViewportPoint(...args) { return gizmoController.projectViewportPoint(...args); }
function resolveGizmoHandle(...args) { return gizmoController.resolveGizmoHandle(...args); }
function updateGizmoDepthHover(...args) { return gizmoController.updateGizmoDepthHover(...args); }
function updateTransformGizmo(...args) { return gizmoController.updateTransformGizmo(...args); }

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
      let uv = cube.uvMode !== 'box' && Array.isArray(face?.uv) && face.uv.length >= 4
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
  const boxUv = selectedEntries.some(entry => entry.cube.uvMode === 'box');
  $$('[data-uv-coordinate]').forEach(input => {
    const coordinate = Number(input.dataset.uvCoordinate);
    const first = selectedEntries[0]?.uv[coordinate];
    const shared = selectedEntries.length && selectedEntries.every(entry => Math.abs(entry.uv[coordinate] - first) < 1e-8);
    if (document.activeElement !== input) input.value = shared ? String(round(first)) : '';
    input.disabled = !selectedEntries.length || boxUv;
    input.title = boxUv ? '箱型 UV 的各面位置固定；可在預覽中整體移動' : '';
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
    if (entry.cube.uvMode === 'box') continue;
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
  drag.boxCubes = new Map(entries.filter(entry => entry.cube.uvMode === 'box')
    .map(entry => [entry.cube.uid, { cube: entry.cube, uv: [...entry.cube.uv] }]));
  drag.originals = new Map(entries.map(entry => [entry.key, entry.cube.uvMode === 'box'
    ? [...getBlockbenchBoxUv(entry.cube, entry.faceName)] : [...entry.cube.faces[entry.faceName].uv]]));
  const boxBounds = [...drag.boxCubes.values()].flatMap(({ cube }) => CUBE_FACE_NAMES.map(faceName => ({ uv: getBlockbenchBoxUv(cube, faceName) })));
  drag.bounds = normalizedUvBounds([...entries, ...boxBounds]);
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
      if (entry.cube.uvMode === 'box') return;
      const original = drag.originals.get(entry.key);
      entry.cube.faces[entry.faceName].uv = [original[0] + delta[0], original[1] + delta[1], original[2] + delta[0], original[3] + delta[1]];
    });
    for (const { cube, uv } of drag.boxCubes.values()) cube.uv = [uv[0] + delta[0], uv[1] + delta[1]];
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
      if (entry.cube.uvMode === 'box') return;
      const source = drag.originals.get(entry.key);
      entry.cube.faces[entry.faceName].uv = source.map((value, index) => index % 2 === 0
        ? next.minU + (value - original.minU) / oldWidth * (next.maxU - next.minU)
        : next.minV + (value - original.minV) / oldHeight * (next.maxV - next.minV));
    });
  }
  if (!state.dirty) markDirty();
  textureUvEntryCache = null;
  invalidateSelectionRenderGeometry();
  renderTextureUvOverlay();
  scheduleSceneRender();
}

const paintBrushOffsetCache = new Map();
const PAINT_FACE_LAYOUTS = Object.freeze({
  south: [7, 6, 4, 5], north: [2, 3, 1, 0], east: [6, 2, 5, 1],
  west: [3, 7, 0, 4], up: [3, 2, 7, 6], down: [4, 5, 0, 1]
});
function activeTextureAsset() {
  return state.textureAssets.find(asset => asset._uid === state.activeTextureUid) || null;
}

function setPaintColor(color, notify = false, preservePickerHue = false, recordHistory = true) {
  if (!/^#[0-9a-f]{6}$/i.test(String(color))) return;
  state.paintColor = String(color).toLowerCase();
  if (!pickerSession.popupRoot && !pickerSession.spaceRoot) {
    syncPaletteSelectionToPaintColor();
    if (recordHistory) recordPaintColorHistory(state.paintColor);
  }
  if (!pickerSession.popupRoot && !pickerSession.spaceRoot && state.tool === 'gradient' && !state.paintGradientPalette) {
    if (state.paintGradientStop === 'end') state.paintGradientEnd = state.paintColor;
    else state.paintGradientStart = state.paintColor;
  }
  const [hue, saturation, value] = rgbToHsv(hexToRgb(state.paintColor));
  if (!preservePickerHue) {
    if (saturation > 1e-4 && value > 1e-4) state.paintColorPickerHue = hue;
    state.paintColorPickerSaturation = saturation;
    state.paintColorPickerValue = value;
  }
  const startButton = $('#paintGradientStartControl'), endButton = $('#paintGradientEndControl');
  startButton?.style.setProperty('--gradient-color', state.paintGradientStart);
  endButton?.style.setProperty('--gradient-color', state.paintGradientEnd);
  updatePaintColorPickerVisual();
  if (pickerSession.spaceRoot) pickerSession.spaceApply?.(state.paintColor);
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
    if (cube.uvMode !== 'box' && !Array.isArray(face.uv)) face.uv = [...getBlockbenchBoxUv(cube, hit.faceName)];
    face.texture = reference;
    delete face.enabled;
    delete face[CULLED_FACE_TEXTURE_KEY];
    cube.autoUv = cube.uvMode === 'box';
    persistGeneratedPaintCube(cube);
  }
  markDirty();
  uvPreviewController.uvPreviewProjectCache = null;
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
    const row = paletteRows.find(entry => entry.id === palette.selectedRowId);
    if (row?.colorSpaceGradient || row?.colors?.length) return Array.from({ length: 65 }, (_, index) => ({
      color: hexToRgb(samplePaletteGradient(row, index / 64)), alpha: 1
    }));
  }
  return [
    { color: hexToRgb(state.paintGradientStart), alpha: clamp(state.paintGradientStartAlpha / 100, 0, 1) },
    { color: hexToRgb(state.paintGradientEnd), alpha: clamp(state.paintGradientEndAlpha / 100, 0, 1) }
  ];
}

function samplePaintGradient(ratio, stops = null) {
  if (state.paintGradientPalette) {
    const row = paletteRows.find(entry => entry.id === palette.selectedRowId);
    if (row?.colorSpaceGradient || row?.colors?.length) return [...hexToRgb(samplePaletteGradient(row, ratio)), 1];
  }
  stops ||= activePaintGradientStops();
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
  if (!target) {
    if (!drag.warnedUntextured) {
      drag.warnedUntextured = true;
      toast('這個面尚未分配貼圖，無法繪製');
    }
    return null;
  }
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
  if (fromKey === toKey) return null;
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
      } else if (index !== sampleCount) queueSceneBrushHit(drag, sample.hit);
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
      if (!drag.touchedSurfaces.size) return;
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
  if (state.tool === 'brush') {
    if (hit?.faceName && !facePaintTarget(hit)) {
      toast('這個面尚未分配貼圖，無法繪製');
      return true;
    }
    event.preventDefault();
    sceneCanvas.setPointerCapture(event.pointerId);
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
    if (hit) queueSceneBrushHit(drag, hit);
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
    if (selectedEntries.some(entry => entry.cube.uvMode === 'box')) {
      toast('箱型 UV 只能整體移動，不能逐面重新指定');
      return;
    }
    textureUvDrag = {
      kind: 'assign', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      startUv: point, currentUv: point, entries: selectedEntries, moved: false, blank: false, snapshotTaken: false
    };
    preview.style.cursor = 'crosshair';
    return;
  }
  const bounds = normalizedUvBounds(selectedEntries);
  const handle = selectedEntries.some(entry => entry.cube.uvMode === 'box') ? null : textureUvHandleAt(point, bounds);
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
  const handle = selectedEntries.some(entry => entry.cube.uvMode === 'box') ? null : textureUvHandleAt(point, bounds);
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
  if (entries.some(entry => entry.cube.uvMode === 'box')) return toast('箱型 UV 的六面相對位置固定，不能單獨修改面座標');
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
  if (revision !== textureAtlasRevision) {
    // A preview switch or paint patch superseded this asynchronous build.
    // Ensure the current project's atlas still gets its own final pass.
    rebuildTextureAtlas();
    return false;
  }
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
    // A project's faces may reference several textures. Uploading the active
    // preview as a temporary single texture discards the atlas layout and
    // forces a full mesh rebuild (and shows unrelated faces incorrectly).
    // Keep the previous atlas until the new one is ready.
    rebuildTextureAtlas();
  } else {
    textureAtlasRevision++;
    textureAtlasEntries = [];
    textureAtlasLayoutByUid = new Map();
    sceneRenderer.setTexture(source);
  }
  uvPreviewController.uvPreviewTextureDirty = true;
  uvPreviewController.uvPreviewRenderDirty = true;
  if (uvPreviewIsActive()) {
    if (atlasEntry && source?.width === atlasEntry.width && source?.height === atlasEntry.height) {
      if (!uvPreviewRenderer.updateTextureAtlasRegion(atlasPatch, atlasEntry.x - 1, atlasEntry.y - 1)) {
        uvPreviewRenderer.setTextureAtlas(textureAtlasCanvas, textureAtlasEntries);
      }
    }
    uvPreviewController.uvPreviewTextureDirty = false;
  }
  scheduleSceneRender();
  if (asset && source) refreshDerivedTileEntries(asset, source);
}

function syncRendererTexture(source) {
  syncRendererTextureAsset(activeTextureAsset(), source);
}

function renderTexture() {
  textureLoadRevision++;
  pendingTextureImage = null;
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
    uvPreviewController.uvPreviewProjectCache = null; textureUvEntryCache = null;
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
    else uvPreviewController.uvPreviewTextureDirty = true;
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
  const rules = formatRules(state.project);
  $('#textureTemplateBoxUv').checked = rules.moddedEntity || rules.allowBoxUv && state.project.uvMode === 'box';
  $('#textureTemplateBoxUv').disabled = !rules.allowBoxUv || !rules.allowFaceUv;
  $('#textureTemplateBoxUv').closest('label').hidden = !rules.allowBoxUv || !rules.allowFaceUv;
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
  pendingTextureImage = image;
  image.onload = () => {
    if (revision !== textureLoadRevision) return;
    pendingTextureImage = null;
    const asset = activeTextureAsset();
    if (asset) { asset.uvWidth = image.naturalWidth; asset.uvHeight = image.naturalHeight; }
    textureCanvas.width = image.naturalWidth;
    textureCanvas.height = image.naturalHeight;
    textureCtx.imageSmoothingEnabled = false;
    textureCtx.clearRect(0, 0, image.naturalWidth, image.naturalHeight);
    textureCtx.drawImage(image, 0, 0);
    updateTexturePreviewFrame(image.naturalWidth, image.naturalHeight);
    const activeName = $('.texture-item.active strong');
    if (activeName) activeName.textContent = name;
    syncRendererTexture(textureCanvas);
    renderScene();
    renderTextureFeatureControls();
  };
  image.onerror = () => {
    if (revision !== textureLoadRevision) return;
    pendingTextureImage = null;
    toast(`貼圖載入失敗：${name || '未命名貼圖'}`);
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
  uvPreviewController.uvPreviewProjectCache = null;
  state.uvPreviewSelectedFace = null;
  uvPreviewController.uvPreviewTextureDirty = true;
  uvPreviewController.uvPreviewRenderDirty = true;
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
  if (mode === 'paint' && inspectorController.subdivisionSession) exitSubdivisionEdit(false);
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
    button.disabled = button.dataset.tool === 'knife' && Boolean(inspectorController.subdivisionSession);
    button.setAttribute('aria-disabled', String(button.disabled));
  });
}

function setTool(tool, { temporary = false } = {}) {
  if (!toolSupportsMode(tool) || (tool === 'knife' && inspectorController.subdivisionSession)) {
    if (tool === 'knife' && inspectorController.subdivisionSession) toast('細分編輯期間不能使用刀具');
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
  if (temporaryPaintTool || state.mode !== 'paint' || state.tool === 'eyedropper') return false;
  // Finish a held stroke before changing tools; the stroke keeps its original
  // brush settings and Alt can immediately act as a temporary eyedropper.
  if (state.dragging?.type === 'texture-paint-3d') {
    const drag = state.dragging;
    endPointerDrag({ pointerId: drag.pointerId, currentTarget: sceneCanvas,
      clientX: drag.latestClient?.[0], clientY: drag.latestClient?.[1] });
  }
  if (texturePaintDrag) endTexturePaintPointer({ pointerId: texturePaintDrag.pointerId });
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
  $('#vertexSnapIntersectionControl').hidden = state.tool !== 'vertexSnap';
  $('#vertexSnapRotationControl').hidden = state.tool !== 'vertexSnap' || state.vertexSnapMode !== 'rotate';
  $('#vertexSnapStatus').hidden = state.tool !== 'vertexSnap';
  $('#vertexSnapStatus').textContent = state.vertexSnapSource
    ? state.vertexSnapIntersections ? '再選目標頂點或交點' : '再選目標頂點'
    : '先選來源頂點';
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
  $('#vertexSnapIntersectionToggle').classList.toggle('active', state.vertexSnapIntersections);
  $('#vertexSnapIntersectionToggle').setAttribute('aria-pressed', String(state.vertexSnapIntersections));
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
    await shapePacksReady;
    if (window.cubeBricksDesktop) {
      const result = await window.cubeBricksDesktop.openProject();
      if (!result) return;
      const existing = projectTabsController.tabs.find(tab => tab.journalId && tab.journalId === result.journalId);
      if (existing) { activateProjectTab(existing.id); return; }
      loadProjectContent(result.content, result.filePath, result.textureAssets || [], result.journalId || null,
        result.dirty === undefined ? {} : { dirty: result.dirty });
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

function serializeCbmodel(textureAssets = [], project = state.project, textureGroups = state.textureGroups) {
  const data = typeof project.serialize === 'function' ? JSON.parse(project.serialize()) : structuredClone(project);
  data.textureGroups = structuredClone(textureGroups || []);
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
  // A journal already contains native snapshots, regardless of the original
  // imported filename recorded in saved_state.
  const project = !journalId && (filePath.toLowerCase().endsWith('.bbmodel') || data.meta?.model_format)
    ? importBlockbench(data) : new CubeBricksProject(data);
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
    textureGroups: data.textureGroups || [],
    dirty: options.dirty ?? !savedPath,
    journalId,
    imported: true
  });
  if (options.dirty !== undefined) {
    journalController.suppressRecording = true;
    try { markDirty(options.dirty, { constrain: false }); } finally { journalController.suppressRecording = false; }
  } else markDirty(!savedPath, { constrain: false });
  toast(`已打開 ${project.name}`);
}

async function offerProjectRecovery() {
  if (!window.cubeBricksDesktop?.listRecoverableProjects) return;
  try {
    const retained = await window.cubeBricksDesktop.retainedProjectTabs?.() || [];
    const restored = new Set();
    for (const tab of retained) {
      try {
        const result = await window.cubeBricksDesktop.recoverProjectJournal(tab);
        loadProjectContent(result.content, tab.filePath || '', [], result.journalId, { dirty: tab.dirty === true });
        restored.add(tab.journalId);
      } catch (error) { toast(`分頁恢復失敗：${error.message}`); }
    }
    if (restored.size && projectTabsController.tabs.length > 1) {
      const initial = projectTabsController.tabs[0];
      if (!initial.session.project.elements.length && !initial.session.project.groups.length
        && !initial.session.dirty && !initial.session.filePath) {
        projectTabsController.tabs.shift();
        void discardProjectTabJournal(initial).catch(error => toast(`空白工作目錄清理失敗：${error.message}`));
        renderProjectTabs();
      }
      const preferred = retained.find(tab => tab.active && restored.has(tab.journalId));
      if (preferred) {
        const projectTab = projectTabsController.tabs.find(tab => tab.journalId === preferred.journalId);
        if (projectTab) activateProjectTab(projectTab.id);
      }
    }
    const projects = await window.cubeBricksDesktop.listRecoverableProjects();
    const pending = projects.filter(project => !restored.has(project.journalId));
    if (!pending.length) return;
    const prompt = pending.length === 1
      ? `找到未保存的工作項目「${pending[0].name}」。要恢復嗎？`
      : `找到 ${pending.length} 個未保存的工作項目。要全部恢復到分頁嗎？`;
    if (!window.confirm(prompt)) return;
    for (const project of pending) {
      const result = await window.cubeBricksDesktop.recoverProjectJournal(project);
      loadProjectContent(result.content, project.filePath || '', [], result.journalId, { dirty: true });
    }
    if (pending.length > 1) toast(`已恢復 ${pending.length} 個工作項目`);
  } catch (error) { toast(`工作項目恢復失敗：${error.message}`); }
}

async function saveProject(saveAs = false) {
  try {
    const activeTab = projectTabById(projectTabsController.activeId);
    await flushProjectJournal(activeTab);
    await activeTab?.journalWrites;
    const content = serializeCbmodel(await serializableTextureAssets());
    if (window.cubeBricksDesktop) {
      const result = await window.cubeBricksDesktop.saveProject({ filePath: saveAs ? null : state.filePath, name: state.project.name, content, journalId: activeTab?.journalId });
      if (!result) return;
      state.filePath = result.filePath;
      const tab = projectTabById(projectTabsController.activeId);
      if (tab) tab.displayName = null;
    } else download(content, `${state.project.name}.cbmodel`, 'application/json');
    markDirty(false); toast('項目已保存');
  } catch (error) { toast(`保存失敗：${error.message}`); }
}

async function exportProject() {
  try {
    const activeTab = projectTabById(projectTabsController.activeId);
    await flushProjectJournal(activeTab);
    await activeTab?.journalWrites;
    const textureAssets = await serializableTextureAssets();
    const cbmodelContent = serializeCbmodel(textureAssets);
    const exportModel = new CubeBricksProject(JSON.parse(state.project.serialize()));
    constrainProject(exportModel);
    const bbmodelContent = JSON.stringify(exportBlockbench(exportModel, textureAssets), null, 2);
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
      uvPreviewController.uvPreviewRenderDirty = true;
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
  const appendItem = (item, target) => {
    if (item.separator) {
      target.insertAdjacentHTML('beforeend', '<div class="context-menu-separator" role="separator"></div>');
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'menuitem';
    if (item.danger) button.classList.add('danger');
    button.innerHTML = `${item.icon ? `<span>${item.icon}</span>` : ''}<span>${escapeHtml(item.label)}</span>`;
    if (item.children?.length) {
      const wrapper = document.createElement('div');
      wrapper.className = 'context-menu-submenu';
      const panel = document.createElement('div');
      panel.className = 'context-menu-submenu-panel';
      panel.hidden = true;
      item.children.forEach(child => appendItem(child, panel));
      const open = () => {
        panel.hidden = false;
        panel.classList.toggle('is-left', wrapper.getBoundingClientRect().right + 160 > window.innerWidth);
      };
      wrapper.addEventListener('pointerenter', open);
      wrapper.addEventListener('pointerleave', () => { panel.hidden = true; });
      button.addEventListener('click', event => { event.stopPropagation(); panel.hidden ? open() : panel.hidden = true; });
      wrapper.append(button, panel);
      target.append(wrapper);
      return;
    }
    button.addEventListener('click', () => {
      closeContextMenu();
      item.action?.();
    });
    target.append(button);
  };
  items.forEach(item => appendItem(item, menu));
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
    const selectedNodes = selectedNodeUids().map(id => state.project.getNode(id)).filter(Boolean);
    const visible = node.visible !== false;
    const locked = node.locked === true;
    showContextMenu(event, { title: selectedNodes.length > 1 ? `已選 ${selectedNodes.length} 項` : node.name, source, items: [
      { icon: '⌖', label: '聚焦此物件', action: focusSelected },
      { icon: visible ? '○' : '◉', label: visible ? '隱藏選中項' : '顯示選中項', action: () => {
        snapshot('core.element.field.visible');
        selectedNodes.forEach(entry => setNodeFlag(entry, 'visible', !visible));
        markDirty(); renderAll();
      } },
      { icon: locked ? '◇' : '◆', label: locked ? '解鎖選中項' : '鎖定選中項', action: () => {
        snapshot('core.element.field.locked');
        selectedNodes.forEach(entry => setNodeFlag(entry, 'locked', !locked));
        sceneRenderer.invalidateLockState(); markDirty(); renderAll();
      } }
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
        icon: inspectorController.subdivisionSession?.ownerUid === node.uid ? '◆' : '◇',
        label: inspectorController.subdivisionSession?.ownerUid === node.uid ? '完成細分編輯' : '進入細分編輯',
        action: () => inspectorController.subdivisionSession?.ownerUid === node.uid ? exitSubdivisionEdit() : enterSubdivisionEdit(node)
      }] : []),
      ...(isProceduralShape(node) ? [{
        icon: '▣', label: '烘焙為 Cube 組', action: () => {
          if (inspectorController.subdivisionSession?.ownerUid === node.uid) exitSubdivisionEdit(false);
          const generated = node.toCubes();
          if (!generated.length) return toast('這個 Shape 沒有可烘焙的 Cube');
          snapshot('core.shape.bake');
          const result = bakeProceduralShape(state.project, node.uid, generated);
          if (!result) return toast('這個 Shape 沒有可烘焙的 Cube');
          result.group.operators.forEach(operator => paintSymmetryRelationCache.delete(operator.uid));
          state.selectedUid = result.group.uid;
          state.selectedUids = new Set([result.group.uid]);
          state.selectionAnchorUid = result.group.uid;
          state.selectedGenerated = null;
          state.selectedCurveNodeIndex = null;
          state.selectedModifierUid = null;
          state.selectedUvFaces = new Set();
          sceneRenderer.invalidateMirrorGeometry();
          sceneRenderer.invalidateLockState();
          markDirty(); renderAll();
          toast(`已烘焙為 ${result.cubes.length} 個 Cube`);
        }
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
  const captureItem = () => ({ icon: '▣', label: '截屏模型', children: [
    { icon: '▢', label: '屏幕截圖', action: () => captureModel('screen') },
    { icon: '▣', label: '離屏渲染', action: () => captureModel('offscreen') }
  ] });
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
        { icon: '◎', label: '回到場景中心', action: focusSceneOrigin },
        { separator: true }, captureItem()
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
        captureItem(),
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
    inspectorController.subdivisionSession?.ownerUid === node.uid ? exitSubdivisionEdit() : enterSubdivisionEdit(node);
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
      if (!inspectorController.subdivisionSession) return;
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
    if (palette.compact) { event.preventDefault(); return; }
    const rowNode = event.target.closest('.palette-row-card');
    if (!rowNode) return;
    const index = paletteRows.findIndex(row => row.id === rowNode.dataset.paletteId);
    const row = paletteRows[index];
    const swatch = event.target.closest('.swatch-item, .gradient-node-head');
    const gradientBar = event.target.closest('.gradient-picker');
    const barRect = gradientBar?.getBoundingClientRect();
    const barRatio = barRect ? insetControlRatio(event.clientX, barRect.left, barRect.width) : .5;
    if (swatch) {
      palette.selectedRowId = row.id;
      palette.selectedColorIndex = Number(swatch.dataset.paletteColorIndex ?? swatch.dataset.gradientNode);
    }
    showContextMenu(event, { title: row.name, source: rowNode, items: [
      ...(swatch ? [{ icon: '×', label: '刪除顏色', action: () => {
        deleteSelectedPaletteColor(row.id, Number(swatch.dataset.paletteColorIndex ?? swatch.dataset.gradientNode));
      } }] : []),
      ...(gradientBar && !swatch ? [{ icon: '＋', label: '在此新增漸變節點', action: () => insertPaletteGradientNode(row, barRatio) }] : []),
      { icon: '◫', label: row.gradient ? '改用離散色卡' : '啟用連續漸變', action: () => { row.gradient = !row.gradient; renderPalette(); } },
      { icon: '⌁', label: row.colorSpaceGradient ? '關閉色彩空間漸變' : '啟用色彩空間漸變', action: () => {
        row.colorSpaceGradient = !row.colorSpaceGradient;
        if (row.colorSpaceGradient) ensureColorSpaceCurve(row);
        renderPalette();
      } },
      ...(row.colorSpaceGradient ? [{ icon: '◇', label: '編輯色彩曲線', action: () => openColorSpaceCurveEditor(row) }] : []),
      { icon: '＋', label: '新增色卡行', action: addPaletteRow }
    ] });
  });
  $('#paletteRows').addEventListener('pointerdown', () => $('#paletteRows').focus({ preventScroll: true }), true);
  document.addEventListener('pointerdown', event => {
    const rows = $('#paletteRows');
    if (!event.target.closest('#bottomDock') && document.activeElement === rows) rows.blur();
  }, true);
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
  $('#modelCaptureSave').addEventListener('click', saveModelCapture);
  $('#modelCaptureCopy').addEventListener('click', copyModelCapture);
  $('#modelCaptureDialog').addEventListener('close', () => {
    $('#modelCaptureImage').removeAttribute('src');
    clearModelCapture();
  });
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
  const textureList = $('#textureList');
  const outlinerDragScroll = createListDragAutoScroll(outliner, () => Boolean(state.outlinerDragUids?.length), pointer => {
    renderOutlinerWindow();
    if (pointer) updateOutlinerDropTarget(pointer.y, document.elementFromPoint(pointer.x, pointer.y));
  });
  const textureDragScroll = createListDragAutoScroll(textureList, () => Boolean(state.textureDrag), pointer => {
    if (pointer) updateTextureDropTarget(pointer.y, document.elementFromPoint(pointer.x, pointer.y));
  });
  const paletteDragScroll = createListDragAutoScroll($('#paletteRows'), () => Boolean(palette.draggedColor));
  function updateOutlinerDropTarget(clientY, target) {
    clearOutlinerDropState({ keepDragging: true });
    const item = target?.closest('.outliner-item');
    if (!item || !outliner.contains(item) || item.dataset.curveNodeIndex !== undefined) return;
    const node = state.project.getNode(item.dataset.uid);
    const rect = item.getBoundingClientRect();
    const ratio = (clientY - rect.top) / rect.height;
    const zone = node?.type === 'group' && ratio > .27 && ratio < .73 ? 'inside' : ratio < .5 ? 'before' : 'after';
    item.classList.add(`drop-${zone}`);
    item.dataset.dropZone = zone;
  }
  function updateTextureDropTarget(clientY, target) {
    textureList.querySelectorAll('.drop-before,.drop-after,.drop-inside').forEach(node => node.classList.remove('drop-before', 'drop-after', 'drop-inside'));
    const item = target?.closest('.texture-item');
    const group = !item && target?.closest('.texture-group');
    if (item && textureList.contains(item) && state.textureDrag?.type === 'asset') {
      const zone = clientY < item.getBoundingClientRect().top + item.offsetHeight / 2 ? 'before' : 'after';
      item.classList.add(`drop-${zone}`); item.dataset.dropZone = zone;
    } else if (group && textureList.contains(group)) group.classList.add('drop-inside');
  }
  document.addEventListener('drop', () => {
    outlinerDragScroll.stop(); textureDragScroll.stop(); paletteDragScroll.stop();
    queueMicrotask(() => {
      if (state.outlinerDragUids?.length) {
        clearOutlinerDropState(); removeOutlinerDragGhost(); state.outlinerDragUids = null;
      }
      if (state.textureDrag) { state.textureDrag = null; clearTextureFaceDropTarget(); renderTextureList(); }
      palette.draggedColor = null;
    });
  }, true);
  document.addEventListener('dragend', () => {
    outlinerDragScroll.stop(); textureDragScroll.stop(); paletteDragScroll.stop();
    clearOutlinerDropState(); removeOutlinerDragGhost(); state.outlinerDragUids = null;
    if (state.textureDrag) {
      state.textureDrag = null;
      clearTextureFaceDropTarget();
      textureList.querySelectorAll('.is-dragging,.drop-before,.drop-after,.drop-inside').forEach(node =>
        node.classList.remove('is-dragging', 'drop-before', 'drop-after', 'drop-inside'));
    }
    palette.draggedColor = null;
  }, true);
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
    projectTabsController.draggingTabId = tab.dataset.projectTab;
    projectTabsController.draggingInsertIndex = projectTabInsertionIndex(event.clientX, projectTabsController.draggingTabId);
    tab.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/x-cubebricks-project-tab', projectTabsController.draggingTabId);
  });
  projectTabsNode.addEventListener('dragover', event => {
    if (!projectTabsController.draggingTabId) return;
    event.preventDefault();
    projectTabsController.draggingInsertIndex = projectTabInsertionIndex(event.clientX);
    previewProjectTabInsertion(projectTabsController.draggingInsertIndex);
  });
  projectTabsNode.addEventListener('drop', event => {
    if (!projectTabsController.draggingTabId) return;
    event.preventDefault();
    projectTabsController.draggingInsertIndex = projectTabInsertionIndex(event.clientX);
    moveProjectTabToIndex(projectTabsController.draggingTabId, projectTabsController.draggingInsertIndex);
    projectTabsController.draggingTabId = null;
    projectTabsController.draggingInsertIndex = null;
  });
  projectTabsNode.addEventListener('dragend', event => {
    if (projectTabsController.draggingTabId) {
      moveProjectTabToIndex(projectTabsController.draggingTabId, projectTabInsertionIndex(event.clientX));
    }
    projectTabsController.draggingTabId = null;
    projectTabsController.draggingInsertIndex = null;
    projectTabsNode.querySelectorAll('.is-dragging,.drop-before,.drop-after').forEach(node => node.classList.remove('is-dragging', 'drop-before', 'drop-after'));
  });
  $('#newProjectTab').addEventListener('click', openNewProjectDialog);
  $('#projectInfoForm').addEventListener('submit', event => {
    event.preventDefault();
    applyProjectInfo();
  });
  $$('[data-action="closeProjectInfo"]').forEach(button => button.addEventListener('click', () => {
    projectInfoDialog.close();
    projectTabsController.editingTabId = null;
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
    if (shapeRegistry.has(option.dataset.createShape) && !['bezier2d', 'bezier3d'].includes(option.dataset.createShape)) addShape(option.dataset.createShape);
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
      if (directory) {
        $('#projectWorkspaceDirectory').textContent = directory;
        shapePacksReady = loadExternalShapePacks();
        await shapePacksReady;
        toast('工作空間已切換；新項目使用 projects/，Shape 包從 shapepacks/ 載入');
      }
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
    uvPreviewController.uvPreviewDrag = {
      pointerId: event.pointerId,
      button: event.button,
      rotates: event.button === 1,
      x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY,
      moved: false
    };
    if (uvPreviewController.uvPreviewDrag.rotates) uvPreviewViewport.classList.add('is-rotating');
    uvPreviewViewport.setPointerCapture(event.pointerId);
  });
  uvPreviewViewport.addEventListener('pointermove', event => {
    if (!uvPreviewController.uvPreviewDrag || uvPreviewController.uvPreviewDrag.pointerId !== event.pointerId) return;
    const dx = event.clientX - uvPreviewController.uvPreviewDrag.x;
    const dy = event.clientY - uvPreviewController.uvPreviewDrag.y;
    if (!uvPreviewController.uvPreviewDrag.moved && Math.hypot(event.clientX - uvPreviewController.uvPreviewDrag.startX, event.clientY - uvPreviewController.uvPreviewDrag.startY) < 4) return;
    uvPreviewController.uvPreviewDrag.moved = true;
    uvPreviewController.uvPreviewDrag.x = event.clientX;
    uvPreviewController.uvPreviewDrag.y = event.clientY;
    if (!uvPreviewController.uvPreviewDrag.rotates) return;
    state.uvPreviewYaw -= dx * .01;
    state.uvPreviewPitch = Math.max(-Math.PI / 2 + .02, Math.min(Math.PI / 2 - .02, state.uvPreviewPitch + dy * .01));
    renderUvPreview();
  });
  const endUvPreviewDrag = event => {
    if (!uvPreviewController.uvPreviewDrag || uvPreviewController.uvPreviewDrag.pointerId !== event.pointerId) return;
    const wasClick = !uvPreviewController.uvPreviewDrag.moved && uvPreviewController.uvPreviewDrag.button === 0;
    uvPreviewViewport.releasePointerCapture?.(event.pointerId);
    uvPreviewViewport.classList.remove('is-rotating');
    uvPreviewController.uvPreviewDrag = null;
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
  texturePreview.addEventListener('pointerdown', () => texturePreview.focus({ preventScroll: true }), true);
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
    if (!rect || rect.width < 2 || rect.height < 2 || uvPreviewController.uvPreviewResizeFrame !== null) return;
    uvPreviewController.uvPreviewResizeFrame = requestAnimationFrame(() => {
      uvPreviewController.uvPreviewResizeFrame = null;
      uvPreviewController.uvPreviewRenderDirty = true;
      refreshUvPreview(false);
    });
  }).observe(uvPreviewViewport);
  document.fonts?.load('12px "Fusion Pixel Latin"').then(() => {
    uvPreviewController.uvPreviewFaceLabelFontRevision++;
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
  $('#vertexSnapIntersectionToggle').addEventListener('click', () => {
    state.vertexSnapIntersections = !state.vertexSnapIntersections;
    updateToolOptions();
    renderScene();
  });
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
      setReferenceImageEditing(!referenceImages.editing);
      setReferenceImageMenu(false);
    }
    if (action === 'reset') resetReferenceImage();
    if (action === 'remove') removeReferenceImage();
  }));
  $('#referenceImageList').addEventListener('click', event => {
    const button = event.target.closest('[data-reference-select]');
    if (!button) return;
    event.stopPropagation();
    referenceImages.selectReference(button.dataset.referenceSelect);
  });
  referenceImageInput.addEventListener('change', () => {
    loadReferenceImageFiles(referenceImageInput.files, referenceImages.importViewKey);
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
  $('#paletteCompactToggle').addEventListener('click', () => {
    palette.compact = !palette.compact;
    palette.saveCompactPreference();
    renderPalette();
  });
  $('#paletteRows').addEventListener('dragstart', () => {
    if (palette.draggedColor) paletteDragScroll.start();
  });
  $('#paletteRows').addEventListener('dragend', () => paletteDragScroll.stop());
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
      if (state.mode === 'paint' && key !== 'visible' && key !== 'locked') return;
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
      event.preventDefault();
      const uidValue = disclosure.dataset.disclosure;
      state.collapsedGroups.has(uidValue) ? state.collapsedGroups.delete(uidValue) : state.collapsedGroups.add(uidValue);
      renderOutliner(); return;
    }
    state.selectedCurveNodeIndex = null;
    selectItem(button.dataset.uid, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
  });
  // Native HTML drag suppresses wheel input on Windows. Keep hierarchy drags
  // pointer-driven so the list can still scroll beneath a held item.
  let outlinerPointerDrag = null;
  let suppressOutlinerClick = false;
  const finishOutlinerPointerDrag = (event, commit = false) => {
    const drag = outlinerPointerDrag;
    if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    outlinerPointerDrag = null;
    if (!drag.active) return;
    const target = commit ? document.elementFromPoint(event.clientX, event.clientY) : null;
    const inside = target && outliner.contains(target);
    const item = inside ? target.closest('.outliner-item') : null;
    const targetUid = item?.dataset.curveNodeIndex === undefined ? item?.dataset.uid || null : null;
    const zone = item?.dataset.dropZone || 'after';
    outlinerDragScroll.stop();
    clearOutlinerDropState();
    removeOutlinerDragGhost();
    state.outlinerDragUids = null;
    suppressOutlinerClick = true;
    setTimeout(() => { suppressOutlinerClick = false; }, 0);
    if (commit && inside && item?.dataset.curveNodeIndex === undefined) moveSelectedNodes(targetUid, zone);
  };
  outliner.addEventListener('pointerdown', event => {
    if (event.button !== 0 || state.mode === 'paint'
      || event.target.closest('[data-disclosure], [data-node-toggle]')) return;
    const item = event.target.closest('.outliner-item');
    if (!item || item.dataset.curveNodeIndex !== undefined) return;
    outlinerPointerDrag = { pointerId: event.pointerId, uid: item.dataset.uid,
      startX: event.clientX, startY: event.clientY, active: false };
  });
  document.addEventListener('pointermove', event => {
    const drag = outlinerPointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      const item = outliner.querySelector(`.outliner-item[data-uid="${CSS.escape(drag.uid)}"]`);
      if (!item) return finishOutlinerPointerDrag(event);
      drag.active = true;
      if (!state.selectedUids.has(drag.uid)) {
        sceneRenderer.commitSelectionGeometry(state.project, state.selectedUids);
        state.selectedUid = drag.uid;
        state.selectedUids = new Set([drag.uid]);
        state.selectionAnchorUid = drag.uid;
        outliner.querySelectorAll('.outliner-item.active').forEach(row => row.classList.remove('active'));
        item.classList.add('active');
        invalidateSelectionRenderGeometry(false);
        renderInspector(); renderScene(); updateSelectionLabels();
      }
      state.outlinerDragUids = topLevelSelectedUids();
      state.outlinerDragUids.forEach(uidValue =>
        outliner.querySelector(`.outliner-item[data-uid="${CSS.escape(uidValue)}"]`)?.classList.add('is-dragging'));
      createOutlinerDragGhost(state.outlinerDragUids);
      outlinerDragScroll.start();
    }
    event.preventDefault();
    outlinerDragGhost.style.left = `${event.clientX + 14}px`;
    outlinerDragGhost.style.top = `${event.clientY + 12}px`;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (target && outliner.contains(target)) updateOutlinerDropTarget(event.clientY, target);
    else clearOutlinerDropState({ keepDragging: true });
  });
  document.addEventListener('pointerup', event => finishOutlinerPointerDrag(event, true));
  document.addEventListener('pointercancel', event => finishOutlinerPointerDrag(event));
  window.addEventListener('blur', () => finishOutlinerPointerDrag(null));
  document.addEventListener('click', event => {
    if (!suppressOutlinerClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressOutlinerClick = false;
  }, true);
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
  textureList.addEventListener('dragstart', event => {
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
    textureDragScroll.start();
  });
  textureList.addEventListener('dragover', event => {
    if (!state.textureDrag) return;
    event.preventDefault();
    updateTextureDropTarget(event.clientY, event.target);
  });
  textureList.addEventListener('drop', event => {
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
  textureList.addEventListener('dragend', () => {
    textureDragScroll.stop();
    state.textureDrag = null;
    clearTextureFaceDropTarget();
    renderTextureList();
  });
  $$('[data-view-axis]').forEach(button => button.addEventListener('click', event => {
    if (cameraController.suppressAxisWidgetClick) {
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
  sceneCanvas.addEventListener('pointerdown', () => sceneCanvas.focus({ preventScroll: true }), true);
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
  sceneCanvas.addEventListener('wheel', event => { event.preventDefault(); cancelCameraFocus(); state.zoom = Math.max(.002, Math.min(100, state.zoom * (event.deltaY > 0 ? .9 : 1.1))); scheduleSceneRender(); }, { passive: false });
  window.addEventListener('resize', renderScene);
  document.addEventListener('visibilitychange', refreshUvPreview);
  window.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    if (event.key === 'Alt' && !event.repeat && beginTemporaryEyedropper()) {
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      if (event.target instanceof Element
        && (event.target.closest('input, textarea, [contenteditable]') || event.target.isContentEditable)) return;
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 's') {
      event.preventDefault();
      saveProject(event.shiftKey);
      return;
    }
    if (event.target.matches('input,select,textarea') || event.target.isContentEditable) return;
    if (event.key === 'Escape') {
      setRenderModeMenu(false);
      setReferenceImageMenu(false);
      if (referenceImages.editing) setReferenceImageEditing(false);
      closeShapeCreateMenu();
      if (inspectorController.subdivisionSession) exitSubdivisionEdit();
      clearPaintGradientSelection();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelected(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') { event.preventDefault(); cutSelected(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteElements(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); pasteElements({ inPlace: true }); }
    if (event.key === 'Delete') {
      const palette = $('#paletteRows');
      if (document.activeElement === palette || palette.contains(document.activeElement)) {
        event.preventDefault();
        if (!event.repeat) deleteSelectedPaletteColor();
        return;
      }
      deleteSelected();
    }
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
    if (pointEntry.targetOnly) return toast('交點只能作為目標點，請先選普通頂點或樞軸點');
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
  if (state.tool === 'rotate' && formatRules(state.project).moddedEntity && item.type === 'cube') {
    toast('模組版實體的 Cube 不能旋轉；請把它放入組後旋轉組');
    return;
  }
  if (state.tool === 'rotate' && formatRules(state.project).singleAxisRotation && axisIndex === null) {
    toast('目前 Java 版本只允許單軸旋轉，請拖動 X、Y 或 Z 軸圓環');
    return;
  }
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
      const rules = formatRules(state.project);
      constrainNode(drag.item, rules);
      for (const target of drag.targets || []) constrainNode(target.node, rules);
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
  // Pointer events can arrive far faster than the display refresh rate. Keep
  // the latest camera state, but render it only once per animation frame.
  scheduleSceneRender();
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
  const rules = formatRules(state.project);
  if (rules.javaBlock || rules.moddedEntity) {
    constrainNode(drag.item, rules);
    for (const target of drag.targets || []) constrainNode(target.node, rules);
  }
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
      constrainNode(target.node, formatRules(state.project));
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
  const requiredStep = formatRules(state.project).rotationStep;
  if (requiredStep) return requiredStep;
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

async function loadExternalShapePacks() {
  if (!window.cubeBricksDesktop?.listShapePacks) return;
  const menu = $('#shapeCreateMenu');
  menu.querySelectorAll('[data-external-shape]').forEach(node => node.remove());
  shapeRegistry.removeExternal();
  try {
    const { packs, errors } = await window.cubeBricksDesktop.listShapePacks();
    const failures = [...errors];
    for (const pack of packs) {
      for (const record of pack.shapes) {
        try {
          // Installing a pack explicitly opts into its JavaScript running in
          // the editor. Keep pack scripts self-contained and source-size bound.
          const module = await import(`data:text/javascript;base64,${record.source}`);
          const definition = module.default;
          if (definition?.id !== record.id) throw new Error('模組 ID 與包清單不一致');
          const registered = shapeRegistry.register({ ...definition, label: record.label,
            icon: record.icon || 'shape' }, { external: true, pack: `${pack.name} ${pack.version}` });
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.createShape = registered.id;
          button.dataset.externalShape = 'true';
          if (registered.icon.startsWith('data:image/')) {
            const icon = document.createElement('img');
            icon.src = registered.icon;
            icon.alt = '';
            icon.className = 'object-icon';
            button.append(icon);
          } else button.innerHTML = '<svg class="object-icon" aria-hidden="true"><use href="#icon-shape"></use></svg>';
          const label = document.createElement('span');
          label.textContent = registered.label;
          button.append(label);
          menu.append(button);
        } catch (error) { failures.push(`${pack.name}/${record.id}: ${error.message}`); }
      }
    }
    if (failures.length) {
      console.warn('Shape 包載入失敗', failures);
      toast(`${failures.length} 個 Shape 包項目未載入，詳見主控台`);
    }
    renderAll();
  } catch (error) { console.warn('Shape 包掃描失敗', error); toast(`Shape 包掃描失敗：${error.message}`); }
}

initializeDockSystem();
initializeConfigRegistry();
modelFormatRegistry.subscribe(() => {
  renderModelFormatPicker();
  updateSelectionLabels();
});
loadTheme();
sceneRenderer.setSelectionOutline(getComputedStyle(document.documentElement).getPropertyValue('--selection-outline').trim());
initializeProjectTabs();
if (window.cubeBricksDesktop?.onCloseRequested) {
  window.cubeBricksDesktop.onCloseRequested(requestProjectClose);
  $('#closeProjectsForm').addEventListener('submit', event => { event.preventDefault(); void confirmProjectClose(); });
  $('[data-action="cancelCloseProjects"]').addEventListener('click', () => $('#closeProjectsDialog').close());
}
renderTexture();
renderPalette();
renderModelFormatPicker();
bindEvents();
updateToolVisibility();
renderAll();
markDirty(false);
shapePacksReady = loadExternalShapePacks();
void shapePacksReady.then(offerProjectRecovery);
