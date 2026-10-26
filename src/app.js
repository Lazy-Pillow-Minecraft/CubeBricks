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
import { createUvEditorController } from './texture/uv-editor-controller.js';
import { createTextureAssetController } from './texture/asset-controller.js';
import { createPaintStrokeController } from './paint/stroke-controller.js';
import { createScenePaintController } from './paint/scene-controller.js';
import { createTexturePointerController } from './texture/pointer-controller.js';
import { createProjectFileController } from './project/file-controller.js';
import { createSettingsController } from './screen/settings-controller.js';
import { createContextMenuController } from './screen/context-menus.js';
import { createTextureAtlasController } from './texture/atlas-controller.js';
import { createModelFormatPicker } from './project/format-picker.js';
import { createProjectCoverController } from './project/cover-controller.js';
import { createOutlinerViewController } from './screen/outliner-view.js';
import { createOutlinerDragController } from './screen/outliner-drag.js';
import { createElementCommands } from './editor/element-commands.js';
import { createSelectionController } from './editor/selection-controller.js';
import { createTransformGeometry } from './editor/transform-geometry.js';
import { createTransformTargets } from './editor/transform-targets.js';
import { createTransformInteraction } from './editor/transform-interaction.js';
import { createEventBinder } from './screen/events-controller.js';
import { createSceneController } from './screen/scene-controller.js';
import { createPlayerReferenceController } from './screen/player-reference-controller.js';
import { createTransformContext } from './editor/transform-context.js';
import { createTextureFaceDropController } from './texture/face-drop-controller.js';
import { createToolModeController } from './editor/tool-mode-controller.js';
import { createViewportPointerController } from './editor/viewport-pointer-controller.js';
import { createSnapController } from './editor/snap-controller.js';
import { escapeHtml, escapeAttribute, round, hexToRgb } from './screen/ui-format.js';
import { createShapePackLoader } from './shapes/pack-loader.js';
import { createPacksController } from './screen/packs-controller.js';
import { createTexturePaintPointerController } from './paint/texture-pointer-controller.js';
import { createPaintSelectionController } from './paint/selection-controller.js';
import { createPaintColorController } from './paint/color-controller.js';
import { createCurvePlacementController } from './editor/curve-placement.js';
import { createTimelineController } from './screen/timeline-controller.js';
import { createWorkspaceCoordinator } from './editor/workspace-coordinator.js';
import { createDockSystem } from './screen/dock-bootstrap.js';
import { showAppChoice } from './screen/prompt-dialog.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const LOCATOR_ICON_SHAPES = '<path d="M98.74,144.52c-38.86,0-72.06-19.5-85.3-46.99-1.11,4.43-1.7,9-1.7,13.69,0,38.28,38.95,69.32,87,69.32s87-31.03,87-69.32c0-4.69-.59-9.26-1.7-13.69-13.24,27.49-46.44,46.99-85.3,46.99Z"/><rect x="81.01" y="56.54" width="35.47" height="96.98"/><rect x="59.53" y="77.83" width="78.43" height="25.75" rx="7.93" ry="7.93"/><path d="M98.74,0c-18.89,0-34.21,15.31-34.21,34.21s15.31,34.21,34.21,34.21,34.21-15.31,34.21-34.21S117.63,0,98.74,0ZM98.74,49.2c-8.28,0-14.99-6.71-14.99-14.99s6.71-14.99,14.99-14.99,14.99,6.71,14.99,14.99-6.71,14.99-14.99,14.99Z"/><path d="M26.73,85.59l17.01,31.01c1.89,3.45-.6,7.66-4.54,7.66H5.18c-3.93,0-6.43-4.22-4.54-7.66l17.01-31.01c1.96-3.58,7.11-3.58,9.07,0Z"/><path d="M179.83,85.59l17.01,31.01c1.89,3.45-.6,7.66-4.54,7.66h-34.03c-3.93,0-6.43-4.22-4.54-7.66l17.01-31.01c1.96-3.58,7.11-3.58,9.07,0Z"/><path d="M97.08,188.46l-18.84-16.15c-1.8-1.55-.71-4.5,1.67-4.5h37.68c2.38,0,3.47,2.96,1.67,4.5l-18.84,16.15c-.96.82-2.37.82-3.33,0Z"/>';
const CUBE_FACE_NAMES = ['north', 'east', 'south', 'west', 'up', 'down'];
const PAINT_FACE_EDGES = Object.freeze([[0, 1], [1, 3], [2, 3], [0, 2]]);
const livePaintTextureSources = new Map();
const animationRasterCache = new Map();
const paintHitAlphaCache = new Map();
let preciseRotationInput = null;




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
  openColorSpaceCurveEditor, addPaintSwatchToSelection, deleteSelectedPaletteColor, applyPaletteColor,
  insertPaletteGradientNode, ensureColorSpaceCurve } = palette;
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
  referenceImageInput, referenceImageLayer, referenceImageHint, snapshot, markDirty, toast,
  setPaintColor, updateToolOptions
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
const { captureModel, captureProjectCover, saveModelCapture, copyModelCapture, clearModelCapture } = createModelCaptureController({
  state, $, sceneCanvas, sceneRenderer, textureCanvas,
  getTextureAtlasEntries: () => textureAtlasController.textureAtlasEntries, getTextureAtlasCanvas: () => textureAtlasController.textureAtlasCanvas,
  currentProjection, toast
});
let projectCoverController = null;
const projectTabsController = createProjectTabsController({
  state, $, escapeHtml, escapeAttribute, projectTabsNode, projectState, projectInfoDialog,
  textureUid, restoreProjectTextureView, renderAll,
  getSubdivisionSession: () => inspectorController.subdivisionSession, exitSubdivisionEdit, referenceImages,
  cancelCameraFocus, sceneRenderer, startProjectJournal, flushProjectJournal, toast,
  compactProjectHistorySnapshot, markDirty, scheduleProjectJournal,
  onProjectActivated: tab => projectCoverController?.schedule(tab),
  onProjectClosing: tab => projectCoverController?.flush(tab)
});
projectCoverController = createProjectCoverController({ projectTabsController, captureProjectCover });
window.addEventListener('cubebricks:texture-change', () => {
  projectCoverController.schedule(projectTabsController.tabs.find(tab => tab.id === projectTabsController.activeId));
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
  restoreProjectTextureView,
  serializableTextureAssets, serializeCbmodel, referenceImages,
  getTexturePaintDrag: () => texturePaintPointerController.texturePaintDrag, getTextureUvDrag: () => uvEditorController.textureUvDrag,
  scheduleProjectCover: tab => projectCoverController?.schedule(tab)
});
const { getKnifePreviewLabel, updateKnifeHover, refreshKnifeFromModifierEvent,
  cancelKnifeSelection, useKnifePoint, buildEditorOverlayLines } = createKnifeController({
  state, sceneCanvas, sceneRenderer, worldPointToCubeLocal, cubeLocalPointToWorld,
  snapValue, clamp, updateToolOptions, renderScene, renderAll,
  freezeCubeUvs, snapshot, markDirty, toast, isBezierElement, selected, selectItem, hexToRgb
});
const { createTextureTemplate, registerGeneratedTexture } = createTextureTemplateController({
  state, $, CUBE_FACE_NAMES, getSelectionExpansion, isProceduralShape,
  getSubdivisionSession: () => inspectorController.subdivisionSession, subdivisionPatch, syncSubdivisionEdits,
  invalidateUvPreviewTextureState, renderTextureList, activateProjectTexture,
  markDirty, snapshot, toast, setCubeFaceCulled, invalidateAllRenderGeometry,
  renderAll, activeSnapSubdivisions, textureAssetForReference, loadTextureAssetImage
});
const playerReferenceTextureInput = $('#playerReferenceTextureInput');
const playerReferenceProject = createPlayerReferenceProject();
let dockManager = null;
let shapePacksReady = Promise.resolve();


const workspaceCoordinator = createWorkspaceCoordinator({
  state, $, sceneRenderer, uvPreviewRenderer,
  getTextureAssetController: () => textureAssetController, getTextureAtlasController: () => textureAtlasController,
  livePaintTextureSources, animationRasterCache,
  renderTextureList, renderTexture, activateProjectTexture,
  rebuildTextureAtlas, updateSnapButton, updateRenderModeControl,
  updateToolOptions, renderOutliner, renderInspector, renderScene,
  updateTextureStageTransform, updateSelectionLabels,
  getUvPreviewController: () => uvPreviewController, getUvEditorController: () => uvEditorController, getTransformContext: () => transformContext,
  scheduleAllPaintSymmetryBuilds, syncSubdivisionEdits
});
function restoreProjectTextureView(...args) { return workspaceCoordinator.restoreProjectTextureView(...args); }

function compactProjectHistorySnapshot(...args) { return journalController.compactProjectHistorySnapshot(...args); }
function snapshot(...args) { return journalController.snapshot(...args); }
function restore(...args) { return journalController.restore(...args); }
function undo(...args) { return journalController.undo(...args); }
function redo(...args) { return journalController.redo(...args); }
function markDirty(...args) { return journalController.markDirty(...args); }
function startProjectJournal(...args) { return journalController.startProjectJournal(...args); }
function scheduleProjectJournal(...args) { return journalController.scheduleProjectJournal(...args); }
function noteJournalOperation(...args) { return journalController.noteJournalOperation(...args); }
function flushProjectJournal(...args) { return journalController.flushProjectJournal(...args); }


function selected(...args) { return workspaceCoordinator.selected(...args); }
function toast(...args) { return workspaceCoordinator.toast(...args); }
function renderAll(...args) { return workspaceCoordinator.renderAll(...args); }
function invalidateAllRenderGeometry(...args) { return workspaceCoordinator.invalidateAllRenderGeometry(...args); }
function selectionAffectsMirrorPreview(...args) { return workspaceCoordinator.selectionAffectsMirrorPreview(...args); }
function invalidateSelectionRenderGeometry(...args) { return workspaceCoordinator.invalidateSelectionRenderGeometry(...args); }

const outlinerViewController = createOutlinerViewController({
  state, $, outliner, LOCATOR_ICON_SHAPES, selected, selectedElementUids,
  isBezierElement, isShapeElement, escapeHtml, escapeAttribute
});
function updateSelectionLabels(...args) { return outlinerViewController.updateSelectionLabels(...args); }
function renderOutliner(...args) { return outlinerViewController.renderOutliner(...args); }
function renderOutlinerWindow(...args) { return outlinerViewController.renderOutlinerWindow(...args); }
function stateIconMarkup(...args) { return outlinerViewController.stateIconMarkup(...args); }
function nodeAutoUvEnabled(...args) { return outlinerViewController.nodeAutoUvEnabled(...args); }
function isUvCapable(...args) { return outlinerViewController.isUvCapable(...args); }
function nodeUvNormalizedEnabled(...args) { return outlinerViewController.nodeUvNormalizedEnabled(...args); }
function outlinerFlag(...args) { return outlinerViewController.outlinerFlag(...args); }
function outlinerStateMarkup(...args) { return outlinerViewController.outlinerStateMarkup(...args); }
function outlinerKindMarkup(...args) { return outlinerViewController.outlinerKindMarkup(...args); }
function openIconMarkup(...args) { return outlinerViewController.openIconMarkup(...args); }
function scheduleOutlinerWindow(...args) { return outlinerViewController.scheduleOutlinerWindow(...args); }

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

const selectionController = createSelectionController({
  state, $$, outliner, inspector, sceneRenderer, inspectorController,
  renderOutliner, renderOutlinerWindow, invalidateSelectionRenderGeometry,
  updateToolOptions, renderInspector, renderScene, renderTextureUvOverlay,
  updateSelectionLabels, cancelKnifeSelection, toast, selected,
  inspectorBatchNodes, sharedVectorValues, round
});
function revealOutlinerItem(...args) { return selectionController.revealOutlinerItem(...args); }
function refreshSelectionUi(...args) { return selectionController.refreshSelectionUi(...args); }
function clearSelection(...args) { return selectionController.clearSelection(...args); }
function selectAllElements(...args) { return selectionController.selectAllElements(...args); }
function selectItem(...args) { return selectionController.selectItem(...args); }
function syncInspectorValues(...args) { return selectionController.syncInspectorValues(...args); }
function getSelectionExpansion(...args) { return selectionController.getSelectionExpansion(...args); }
function selectedNodeUids(...args) { return selectionController.selectedNodeUids(...args); }
function selectedElementUids(...args) { return selectionController.selectedElementUids(...args); }
function selectedTopLevelNodes(...args) { return selectionController.selectedTopLevelNodes(...args); }
function deepestCommonSelectionGroup(...args) { return selectionController.deepestCommonSelectionGroup(...args); }
function topLevelSelectedUids(...args) { return selectionController.topLevelSelectedUids(...args); }

const elementCommands = createElementCommands({
  state, selectedNodeUids, topLevelSelectedUids, snapshot, markDirty,
  renderAll, toast, captureOutlinerRowPositions, animateOutlinerReorder,
  inspectorController
});
function nodeContainer(...args) { return elementCommands.nodeContainer(...args); }
function insertNewNodeUid(...args) { return elementCommands.insertNewNodeUid(...args); }
function selectCreatedNode(...args) { return elementCommands.selectCreatedNode(...args); }
function addCube(...args) { return elementCommands.addCube(...args); }
function addShape(...args) { return elementCommands.addShape(...args); }
function addLocator(...args) { return elementCommands.addLocator(...args); }
function addBezierElement(...args) { return elementCommands.addBezierElement(...args); }
function addGroup(...args) { return elementCommands.addGroup(...args); }
function deleteSelected(...args) { return elementCommands.deleteSelected(...args); }
function captureSelectedElements(...args) { return elementCommands.captureSelectedElements(...args); }
function copySelected(...args) { return elementCommands.copySelected(...args); }
function instantiateClipboard(...args) { return elementCommands.instantiateClipboard(...args); }
function insertClonedRoots(...args) { return elementCommands.insertClonedRoots(...args); }
function pasteElements(...args) { return elementCommands.pasteElements(...args); }
function cutSelected(...args) { return elementCommands.cutSelected(...args); }

const outlinerDragController = createOutlinerDragController({
  state, $$, outliner, outlinerKindMarkup, escapeHtml,
  topLevelSelectedUids, nodeContainer, toast, snapshot, markDirty, renderAll
});
function clearOutlinerDropState(...args) { return outlinerDragController.clearOutlinerDropState(...args); }
function captureOutlinerRowPositions(...args) { return outlinerDragController.captureOutlinerRowPositions(...args); }
function animateOutlinerReorder(...args) { return outlinerDragController.animateOutlinerReorder(...args); }
function removeOutlinerDragGhost(...args) { return outlinerDragController.removeOutlinerDragGhost(...args); }
function createOutlinerDragGhost(...args) { return outlinerDragController.createOutlinerDragGhost(...args); }
function moveSelectedNodes(...args) { return outlinerDragController.moveSelectedNodes(...args); }

const uvPreviewController = createUvPreviewController({
  state, $, $$, uvPreviewCanvas, uvPreviewViewport, uvPreviewRenderer,
  sceneRenderer, textureCanvas, getTextureAtlasEntries: () => textureAtlasController.textureAtlasEntries,
  getTextureAtlasCanvas: () => textureAtlasController.textureAtlasCanvas, getDockManager: () => dockManager,
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

const sceneController = createSceneController({
  state, $, $$, sceneCanvas, sceneRenderer, inspectorController,
  uvPreviewController, LOCATOR_ICON_SHAPES, getSelectionExpansion,
  getTransformPivot, updateTransformGizmo, refreshUvPreview,
  currentProjection, buildEditorOverlayLines, updateMirrorGuideOverlay,
  updateAxisWidget, updateReferenceImageLayer
});
function renderScene(...args) { return sceneController.renderScene(...args); }
function updateFaceSelectionOverlay(...args) { return sceneController.updateFaceSelectionOverlay(...args); }
function scheduleSceneRender(...args) { return sceneController.scheduleSceneRender(...args); }
function renderLockedHoverFrame(...args) { return sceneController.renderLockedHoverFrame(...args); }
function updateLocatorOverlay(...args) { return sceneController.updateLocatorOverlay(...args); }
function isEffectivelyLocked(...args) { return sceneController.isEffectivelyLocked(...args); }
function lockedObjectOpacity(...args) { return sceneController.lockedObjectOpacity(...args); }
function updateLocatorHoverOpacity(...args) { return sceneController.updateLocatorHoverOpacity(...args); }
function animateLockedHoverStrength(...args) { return sceneController.animateLockedHoverStrength(...args); }
function updateLockedHover(...args) { return sceneController.updateLockedHover(...args); }
function scheduleLockedHover(...args) { return sceneController.scheduleLockedHover(...args); }
function clearLockedHoverCapture(...args) { return sceneController.clearLockedHoverCapture(...args); }

async function reloadShapePacks() {
  shapePacksReady = loadExternalShapePacks();
  await shapePacksReady;
}



const playerReferenceController = createPlayerReferenceController({
  $, sceneRenderer, playerReferenceProject, renderScene, toast
});
function updatePlayerReferenceTexture(...args) { return playerReferenceController.updatePlayerReferenceTexture(...args); }
function importPlayerReferenceTexture(...args) { return playerReferenceController.importPlayerReferenceTexture(...args); }




const transformContext = createTransformContext({
  state, $, $$, sceneRenderer, deepestCommonSelectionGroup,
  isBezierElement, isShapeElement, selected, selectedElementUids,
  selectedTopLevelNodes, subdivisionOwner
});
function updateTransformSpaceButtons(...args) { return transformContext.updateTransformSpaceButtons(...args); }
function updateRotationModeButtons(...args) { return transformContext.updateRotationModeButtons(...args); }
function updateScaleHandleModeButtons(...args) { return transformContext.updateScaleHandleModeButtons(...args); }
function updateMultiTransformModeButtons(...args) { return transformContext.updateMultiTransformModeButtons(...args); }
function getTransformPivot(...args) { return transformContext.getTransformPivot(...args); }
function inverseApplyGroupTransforms(...args) { return transformContext.inverseApplyGroupTransforms(...args); }
function selectedWorldPoints(...args) { return transformContext.selectedWorldPoints(...args); }
function selectionGeometryCenter(...args) { return transformContext.selectionGeometryCenter(...args); }
function getSelectionTransformContext(...args) { return transformContext.getSelectionTransformContext(...args); }
function getTransformAxes(...args) { return transformContext.getTransformAxes(...args); }
function getSelectionTransformAxes(...args) { return transformContext.getSelectionTransformAxes(...args); }
function activeCurveNodeContext(...args) { return transformContext.activeCurveNodeContext(...args); }
function activeModifierAnchorContext(...args) { return transformContext.activeModifierAnchorContext(...args); }
function bakeCurveNodeTangent(...args) { return transformContext.bakeCurveNodeTangent(...args); }
function setCurveHandle(...args) { return transformContext.setCurveHandle(...args); }
function getCurveNodeTransformAxes(...args) { return transformContext.getCurveNodeTransformAxes(...args); }
function getModifierAnchorTransformAxes(...args) { return transformContext.getModifierAnchorTransformAxes(...args); }

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

const uvEditorController = createUvEditorController({
  state, $, $$, getSelectionExpansion, activeTextureAsset,
  textureAtlasReferences, effectiveFaceTextureReference, isFaceTiled,
  round, renderTextureTileControls, syncTexturePreviewPriority,
  clamp, snapValue, snapshot, markDirty,
  invalidateSelectionRenderGeometry, scheduleSceneRender
});
function updateTexturePreviewFrame(...args) { return uvEditorController.updateTexturePreviewFrame(...args); }
function uvFaceKey(...args) { return uvEditorController.uvFaceKey(...args); }
function parseUvFaceKey(...args) { return uvEditorController.parseUvFaceKey(...args); }
function textureUvEntries(...args) { return uvEditorController.textureUvEntries(...args); }
function selectedTextureUvEntries(...args) { return uvEditorController.selectedTextureUvEntries(...args); }
function normalizedUvBounds(...args) { return uvEditorController.normalizedUvBounds(...args); }
function renderTextureUvOverlay(...args) { return uvEditorController.renderTextureUvOverlay(...args); }
function updateTextureStageTransform(...args) { return uvEditorController.updateTextureStageTransform(...args); }
function cancelTextureFocus(...args) { return uvEditorController.cancelTextureFocus(...args); }
function resetTextureView(...args) { return uvEditorController.resetTextureView(...args); }
function focusSelectedTextureUvs(...args) { return uvEditorController.focusSelectedTextureUvs(...args); }
function setDockHotspotFocus(...args) { return uvEditorController.setDockHotspotFocus(...args); }
function clientToTextureUv(...args) { return uvEditorController.clientToTextureUv(...args); }
function textureUvHit(...args) { return uvEditorController.textureUvHit(...args); }
function textureUvHandleAt(...args) { return uvEditorController.textureUvHandleAt(...args); }
function snapTexturePan(...args) { return uvEditorController.snapTexturePan(...args); }
function materializeUvFaces(...args) { return uvEditorController.materializeUvFaces(...args); }
function applyTextureUvDrag(...args) { return uvEditorController.applyTextureUvDrag(...args); }

function activeTextureAsset() {
  return state.textureAssets.find(asset => asset._uid === state.activeTextureUid) || null;
}

const paintColorController = createPaintColorController({
  state, $, pickerSession, syncPaletteSelectionToPaintColor,
  recordPaintColorHistory, hexToRgb, updatePaintColorPickerVisual,
  renderPaintGradientPreview, toast, updateToolOptions, clamp
});
function setPaintColor(...args) { return paintColorController.setPaintColor(...args); }
function selectPaintGradientStop(...args) { return paintColorController.selectPaintGradientStop(...args); }
function paintSetting(...args) { return paintColorController.paintSetting(...args); }
function paintToolErasing(...args) { return paintColorController.paintToolErasing(...args); }
function paintToolOpacity(...args) { return paintColorController.paintToolOpacity(...args); }

const paintStrokeController = createPaintStrokeController({
  state, $, $$, textureCanvas, textureCtx, uvEditorController,
  clientToTextureUv, clamp, isFaceTiled, faceUvWorldPoint,
  paintSetting, paintToolErasing, paintToolOpacity, PAINT_FACE_EDGES,
  CUBE_FACE_NAMES, textureAtlasReferences, effectiveFaceTextureReference,
  textureAssetForReference, getTextureAtlasEntries: () => textureAtlasController.textureAtlasEntries,
  paintCanvasForAsset, syncRendererTextureAsset,
  scheduleSceneRender, uvPreviewIsActive, renderUvPreview,
  updateTexturePreviewFrame, noteJournalOperation, markDirty, toast,
  renderScene, invalidateAllRenderGeometry, paintHitAlphaCache
});
function paintPointFromEvent(...args) { return paintStrokeController.paintPointFromEvent(...args); }
function paintPointInside(...args) { return paintStrokeController.paintPointInside(...args); }
function faceUvPixelSlots(...args) { return paintStrokeController.faceUvPixelSlots(...args); }
function paintFaceDepthNeighbors(...args) { return paintStrokeController.paintFaceDepthNeighbors(...args); }
function updateTextureBrushCursor(...args) { return paintStrokeController.updateTextureBrushCursor(...args); }
function syncPaintedTextureNow(...args) { return paintStrokeController.syncPaintedTextureNow(...args); }
function queuePaintedTextureSync(...args) { return paintStrokeController.queuePaintedTextureSync(...args); }
function drawPaintSegment(...args) { return paintStrokeController.drawPaintSegment(...args); }
function drawPaintShape(...args) { return paintStrokeController.drawPaintShape(...args); }
function paintUvBounds(...args) { return paintStrokeController.paintUvBounds(...args); }
function allTextureUvEntriesForAsset(...args) { return paintStrokeController.allTextureUvEntriesForAsset(...args); }
function applyTextureBucket(...args) { return paintStrokeController.applyTextureBucket(...args); }
function pushTexturePaintHistory(...args) { return paintStrokeController.pushTexturePaintHistory(...args); }
function commitPaintedTextureAsset(...args) { return paintStrokeController.commitPaintedTextureAsset(...args); }
function replayTexturePaintPoints(...args) { return paintStrokeController.replayTexturePaintPoints(...args); }
function finishTexturePaintDrag(...args) { return paintStrokeController.finishTexturePaintDrag(...args); }

const texturePaintPointerController = createTexturePaintPointerController({
  state, $, textureCanvas, textureCtx, toast, pushTexturePaintHistory,
  paintUvBounds, activePaintGradientStops, samplePaintGradient,
  blendRgbaPixel, paintToolOpacity, commitPaintedTextureAsset,
  queuePaintedTextureSync, syncPaintedTextureNow, clearPaintGradientSelection,
  activeTextureAsset, paintPointFromEvent, paintPointInside,
  textureUvHit, allTextureUvEntriesForAsset, applyTextureBucket,
  setPaintColor, updateToolOptions, clamp, replayTexturePaintPoints,
  drawPaintShape, drawPaintSegment, finishTexturePaintDrag
});
function useTexturePaintGradient(...args) { return texturePaintPointerController.useTexturePaintGradient(...args); }
function startTexturePaintPointer(...args) { return texturePaintPointerController.startTexturePaintPointer(...args); }
function moveTexturePaintPointer(...args) { return texturePaintPointerController.moveTexturePaintPointer(...args); }
function endTexturePaintPointer(...args) { return texturePaintPointerController.endTexturePaintPointer(...args); }

const textureFaceDropController = createTextureFaceDropController({
  state, $, viewport, uvPreviewViewport, getSelectionExpansion,
  ensureCubeFaceRecord, snapshot, persistGeneratedPaintCube, markDirty,
  uvPreviewController, uvEditorController, invalidateAllRenderGeometry, renderTextureList,
  renderOutliner, renderInspector, renderScene, updateTextureStageTransform,
  toast, CUBE_FACE_NAMES, remapNumericFaceTextureReferences
});
function faceTextureReference(...args) { return textureFaceDropController.faceTextureReference(...args); }
function draggedTextureAsset(...args) { return textureFaceDropController.draggedTextureAsset(...args); }
function clearTextureFaceDropTarget(...args) { return textureFaceDropController.clearTextureFaceDropTarget(...args); }
function showTextureFaceDropTarget(...args) { return textureFaceDropController.showTextureFaceDropTarget(...args); }
function textureDropCubes(...args) { return textureFaceDropController.textureDropCubes(...args); }
function applyTextureAssetToFace(...args) { return textureFaceDropController.applyTextureAssetToFace(...args); }
function bindTextureFaceDropSurface(...args) { return textureFaceDropController.bindTextureFaceDropSurface(...args); }

const scenePaintController = createScenePaintController({
  state, $, sceneCanvas, sceneRenderer, textureCanvas,
  textureAssetForReference, subdivisionPatch, isFaceTiled,
  clamp, paintToolOpacity, paletteRows, palette, samplePaletteGradient,
  hexToRgb, paintSymmetryRelatedHits, paintSymmetryFaceKey,
  pushTexturePaintHistory, paintUvBounds, commitPaintedTextureAsset,
  queuePaintedTextureSync, syncPaintedTextureNow, drawPaintSegment,
  drawPaintShape, paintFaceDepthNeighbors, applyTextureBucket,
  loadTextureAssetImage, paintHitAlphaCache, animationRasterCache,
  renderTextureList, renderScene, toast, setPaintColor, updateToolOptions,
  activateProjectTexture, sampleReferenceImage: referenceImages.sampleReferenceImage
});
function persistGeneratedPaintCube(...args) { return scenePaintController.persistGeneratedPaintCube(...args); }
function barycentricPoint(...args) { return scenePaintController.barycentricPoint(...args); }
function faceUvWorldPoint(...args) { return scenePaintController.faceUvWorldPoint(...args); }
function blendRgbaPixel(...args) { return scenePaintController.blendRgbaPixel(...args); }
function activePaintGradientStops(...args) { return scenePaintController.activePaintGradientStops(...args); }
function samplePaintGradient(...args) { return scenePaintController.samplePaintGradient(...args); }
function clearPaintGradientSelection(...args) { return scenePaintController.clearPaintGradientSelection(...args); }
function renderPaintGradientPreview(...args) { return scenePaintController.renderPaintGradientPreview(...args); }
function updatePaintGradientHover(...args) { return scenePaintController.updatePaintGradientHover(...args); }
function paintCanvasForAsset(...args) { return scenePaintController.paintCanvasForAsset(...args); }
function queueSceneBrushPointer(...args) { return scenePaintController.queueSceneBrushPointer(...args); }
function finishScenePaintDrag(...args) { return scenePaintController.finishScenePaintDrag(...args); }
function moveScenePaintDrag(...args) { return scenePaintController.moveScenePaintDrag(...args); }
function startScenePaintPointer(...args) { return scenePaintController.startScenePaintPointer(...args); }

const paintSelectionController = createPaintSelectionController({
  state, $, sceneCanvas, sceneRenderer, textureCanvas, textureCtx, clientToTextureUv,
  textureAssetForReference, facePaintUvPoint: scenePaintController.facePaintUvPoint,
  paintSymmetryRelatedHits, getTextureAtlasEntries: () => textureAtlasController.textureAtlasEntries,
  getTextureAtlasCanvas: () => textureAtlasController.textureAtlasCanvas,
  scheduleSceneRender, updateToolOptions, pushTexturePaintHistory,
  commitPaintedTextureAsset
});

const texturePointerController = createTexturePointerController({
  state, $, dockManager, uvEditorController, getTexturePaintDrag: () => texturePaintPointerController.texturePaintDrag,
  cancelTextureFocus, setDockHotspotFocus, startTexturePaintPointer,
  clientToTextureUv, textureUvEntries, selectedTextureUvEntries,
  normalizedUvBounds, textureUvHandleAt, textureUvHit,
  renderTextureUvOverlay, updateFaceSelectionOverlay, updateTextureBrushCursor,
  moveTexturePaintPointer, endTexturePaintPointer, applyTextureUvDrag,
  clamp, snapValue, snapTexturePan, updateTextureStageTransform,
  snapshot, materializeUvFaces, markDirty, invalidateSelectionRenderGeometry,
  scheduleSceneRender, renderAll, toast
});
function startTexturePointer(...args) { return texturePointerController.startTexturePointer(...args); }
function moveTexturePointer(...args) { return texturePointerController.moveTexturePointer(...args); }
function onTexturePointerMove(...args) { return texturePointerController.onTexturePointerMove(...args); }
function endTexturePointer(...args) { return texturePointerController.endTexturePointer(...args); }
function updateTextureUvCursor(...args) { return texturePointerController.updateTextureUvCursor(...args); }
function wheelTextureView(...args) { return texturePointerController.wheelTextureView(...args); }
function setUvCoordinate(...args) { return texturePointerController.setUvCoordinate(...args); }
function syncTexturePreviewPriority(...args) { return texturePointerController.syncTexturePreviewPriority(...args); }

const textureAtlasController = createTextureAtlasController({
  state, $, textureCanvas, textureCtx, sceneRenderer, uvPreviewRenderer,
  uvPreviewController, uvEditorController, livePaintTextureSources,
  animationRasterCache, CUBE_FACE_NAMES, loadTextureAssetImage,
  textureAssetForReference, scheduleSceneRender, refreshUvPreview,
  updateLayerCompositePreview, refreshDerivedTileEntries, uvPreviewIsActive,
  syncTexturePreviewPriority, resetTextureView, activeTextureAsset,
  getTextureAssetController: () => textureAssetController
});
function textureAtlasReferences(...args) { return textureAtlasController.textureAtlasReferences(...args); }
function drawTextureAtlasEntry(...args) { return textureAtlasController.drawTextureAtlasEntry(...args); }
function textureAtlasPatch(...args) { return textureAtlasController.textureAtlasPatch(...args); }
function rebuildTextureAtlas(...args) { return textureAtlasController.rebuildTextureAtlas(...args); }
function rebuildTextureAtlasNow(...args) { return textureAtlasController.rebuildTextureAtlasNow(...args); }
function syncRendererTextureAsset(...args) { return textureAtlasController.syncRendererTextureAsset(...args); }
function syncRendererTexture(...args) { return textureAtlasController.syncRendererTexture(...args); }
function renderTexture(...args) { return textureAtlasController.renderTexture(...args); }


function activeSnapSubdivisions(...args) { return snapController.activeSnapSubdivisions(...args); }
function updateSnapButton(...args) { return snapController.updateSnapButton(...args); }
function cycleSnap(...args) { return snapController.cycleSnap(...args); }

const textureAssetController = createTextureAssetController({
  state, $, $$, textureCanvas, textureCtx, sceneRenderer, uvPreviewRenderer,
  uvPreviewController, uvEditorController, livePaintTextureSources,
  animationRasterCache, getTextureAtlasEntries: () => textureAtlasController.textureAtlasEntries,
  activeTextureAsset, escapeAttribute, escapeHtml, openIconMarkup, parseUvFaceKey,
  selectedUvFaceData, ensureCubeFaceRecord, persistGeneratedPaintCube,
  rebuildTextureAtlas, drawTextureAtlasEntry, textureAtlasPatch,
  uvPreviewIsActive, pushTexturePaintHistory, renderAll,
  invalidateAllRenderGeometry, registerGeneratedTexture, renderScene,
  updateTexturePreviewFrame, syncRendererTexture, selectedElementUids,
  activeSnapSubdivisions, renderTexture,
  noteJournalOperation, snapshot, markDirty, toast, formatNumber, clamp
});
function textureUid(...args) { return textureAssetController.textureUid(...args); }
function renderTextureList(...args) { return textureAssetController.renderTextureList(...args); }
function addTextureGroup(...args) { return textureAssetController.addTextureGroup(...args); }
function updateLayerCompositePreview(...args) { return textureAssetController.updateLayerCompositePreview(...args); }
function renderTextureTileControls(...args) { return textureAssetController.renderTextureTileControls(...args); }
function refreshDerivedTileEntries(...args) { return textureAssetController.refreshDerivedTileEntries(...args); }
function scheduleTextureAnimation(...args) { return textureAssetController.scheduleTextureAnimation(...args); }
function textureAssetForReference(...args) { return textureAssetController.textureAssetForReference(...args); }
function isFaceTiled(...args) { return textureAssetController.isFaceTiled(...args); }
function remapNumericFaceTextureReferences(...args) { return textureAssetController.remapNumericFaceTextureReferences(...args); }
function loadTextureAssetImage(...args) { return textureAssetController.loadTextureAssetImage(...args); }
function createSimpleTexture(...args) { return textureAssetController.createSimpleTexture(...args); }
function updateTextureCreateDialog(...args) { return textureAssetController.updateTextureCreateDialog(...args); }
function openTextureCreateDialog(...args) { return textureAssetController.openTextureCreateDialog(...args); }
function importTexture(...args) { return textureAssetController.importTexture(...args); }
function loadTextureSource(...args) { return textureAssetController.loadTextureSource(...args); }
function installProjectTextures(...args) { return textureAssetController.installProjectTextures(...args); }
function activateProjectTexture(...args) { return textureAssetController.activateProjectTexture(...args); }
function invalidateUvPreviewTextureState(...args) { return textureAssetController.invalidateUvPreviewTextureState(...args); }
function copyTexture(...args) { return textureAssetController.copyTexture(...args); }
function cutTexture(...args) { return textureAssetController.cutTexture(...args); }
function pasteTexture(...args) { return textureAssetController.pasteTexture(...args); }
function removeTexture(...args) { return textureAssetController.removeTexture(...args); }

const toolModeController = createToolModeController({
  state, $, $$, inspectorController, exitSubdivisionEdit, renderOutliner,
  stopTimeline, renderInspector, renderScene, toast, sceneCanvas,
  cancelKnifeSelection, clearPaintGradientSelection, endPointerDrag,
  getTexturePaintDrag: () => texturePaintPointerController.texturePaintDrag, endTexturePaintPointer, selectedTopLevelNodes,
  paintToolErasing, paintSetting, getKnifePreviewLabel,
  updateTransformSpaceButtons, updateRotationModeButtons,
  updateScaleHandleModeButtons, updateMultiTransformModeButtons,
  getDockManager: () => dockManager
});
function toolSupportsMode(...args) { return toolModeController.toolSupportsMode(...args); }
function applyModePanelVisibility(...args) { return toolModeController.applyModePanelVisibility(...args); }
function setMode(...args) { return toolModeController.setMode(...args); }
function updateToolVisibility(...args) { return toolModeController.updateToolVisibility(...args); }
function setTool(...args) { return toolModeController.setTool(...args); }
function beginTemporaryEyedropper(...args) { return toolModeController.beginTemporaryEyedropper(...args); }
function endTemporaryEyedropper(...args) { return toolModeController.endTemporaryEyedropper(...args); }
function updateToolOptions(...args) { return toolModeController.updateToolOptions(...args); }
function updateRenderModeControl(...args) { return toolModeController.updateRenderModeControl(...args); }
function setRenderModeMenu(...args) { return toolModeController.setRenderModeMenu(...args); }
function activateDock(...args) { return toolModeController.activateDock(...args); }

const projectFileController = createProjectFileController({
  state, fileInput, projectTabsController, journalController,
  getShapePacksReady: () => shapePacksReady, activateProjectTab, addProjectTab, markDirty,
  discardProjectTabJournal, renderProjectTabs, projectTabById,
  flushProjectJournal, toast
});
function openProject(...args) { return projectFileController.openProject(...args); }
function serializableTextureAssets(...args) { return projectFileController.serializableTextureAssets(...args); }
function serializeCbmodel(...args) { return projectFileController.serializeCbmodel(...args); }
function loadProjectContent(...args) { return projectFileController.loadProjectContent(...args); }
function offerProjectRecovery(...args) { return projectFileController.offerProjectRecovery(...args); }
function saveProject(...args) { return projectFileController.saveProject(...args); }
function exportProject(...args) { return projectFileController.exportProject(...args); }

const modelFormatPicker = createModelFormatPicker({
  $, newProjectDialog, escapeHtml, escapeAttribute, formatNumber,
  addProjectTab, markDirty, toast, configRegistry, loadProjectContent
});
function modelFormatIconMarkup(...args) { return modelFormatPicker.modelFormatIconMarkup(...args); }
function renderModelFormatPicker(...args) { return modelFormatPicker.renderModelFormatPicker(...args); }
function openNewProjectDialog(...args) { return modelFormatPicker.openNewProjectDialog(...args); }
function newProject(...args) { return modelFormatPicker.newProject(...args); }

const settingsController = createSettingsController({
  state, $, $$, sceneRenderer, hexToRgb, renderScene, toast,
  configRegistry, languageSelect, modelFormatRegistry, getDockManager: () => dockManager,
  setMode, updateToolVisibility, applyModePanelVisibility,
  toolSupportsMode, setTool, updateSnapButton, updatePlayerReferenceTexture,
  clearSelection, updateProjectionControls, animateLockedHoverStrength
});
function setThemeVar(...args) { return settingsController.setThemeVar(...args); }
function saveTheme(...args) { return settingsController.saveTheme(...args); }
function loadTheme(...args) { return settingsController.loadTheme(...args); }
function applyPreset(...args) { return settingsController.applyPreset(...args); }
function initializeConfigRegistry(...args) { return settingsController.initializeConfigRegistry(...args); }
function applyRegisteredConfig(...args) { return settingsController.applyRegisteredConfig(...args); }
function mapProjectionZoom(...args) { return settingsController.mapProjectionZoom(...args); }
function setConfigFromControl(...args) { return settingsController.setConfigFromControl(...args); }

function initializeDockSystem() {
  dockManager = createDockSystem({ state, $, stopUvPreviewAnimation, refreshUvPreview,
    uvPreviewController, syncUvPreviewPanelAspect, syncTexturePreviewPriority,
    scheduleOutlinerWindow, renderScene });
  applyModePanelVisibility();
}

const contextMenuController = createContextMenuController({
  state, $, outliner, inspector, sceneCanvas, sceneRenderer, inspectorController,
  referenceImages, getDockManager: () => dockManager,
  textureInput, palette, paletteRows, configRegistry,
  captureModel, saveModelCapture, copyModelCapture, clearModelCapture,
  cancelKnifeSelection, updateToolOptions, renderScene, toast,
  selectItem, selected, selectedNodeUids, focusSelected, focusSceneOrigin,
  pasteElements, isBezierElement, addCurveNodeAtViewportPoint,
  refreshSelectionUi, snapshot, discardSubdivisionEdits, markDirty, renderAll,
  isProceduralShape, exitSubdivisionEdit, enterSubdivisionEdit,
  renderTextureList, remapNumericFaceTextureReferences, activateProjectTexture,
  renderTexture, rebuildTextureAtlas, noteJournalOperation, addTextureGroup,
  setMode, deleteSelectedPaletteColor, insertPaletteGradientNode,
  renderPalette, ensureColorSpaceCurve, openColorSpaceCurveEditor, addPaletteRow,
  setNodeVisibility, setNodeFlag, renderOutliner, addGroup,
  copySelected, cutSelected, deleteSelected, openIconMarkup, escapeHtml,
  copyTexture, cutTexture, pasteTexture, removeTexture
});
function closeContextMenu(...args) { return contextMenuController.closeContextMenu(...args); }
function showContextMenu(...args) { return contextMenuController.showContextMenu(...args); }
function setActiveTextureItem(...args) { return contextMenuController.setActiveTextureItem(...args); }
function showElementContextMenu(...args) { return contextMenuController.showElementContextMenu(...args); }
function bindContextMenus(...args) { return contextMenuController.bindContextMenus(...args); }

const curvePlacementController = createCurvePlacementController({
  state, sceneCanvas, sceneRenderer, intersectRayPlane, snapValue,
  snapshot, discardSubdivisionEdits, markDirty, renderAll, toast,
  worldPointToParentLocal
});
function addCurveNodeAtViewportPoint(...args) { return curvePlacementController.addCurveNodeAtViewportPoint(...args); }
function worldPointToCurveLocal(...args) { return curvePlacementController.worldPointToCurveLocal(...args); }
function getCurveWorldPlane(...args) { return curvePlacementController.getCurveWorldPlane(...args); }

const eventBinder = createEventBinder({
  state, $, $$, viewport, sceneCanvas, sceneRenderer, uvPreviewCanvas,
  uvPreviewViewport, uvPreviewRenderer, uvPreviewController, uvEditorController,
  outliner, outlinerDragController, inspectorController, palette, fileInput,
  textureInput, playerReferenceTextureInput, referenceImageInput,
  referenceImageLayer, referenceImages, languageSelect, themeDialog,
  projectInfoDialog, projectTabsController, projectTabsNode,
  getDockManager: () => dockManager, getTexturePaintDrag: () => texturePaintPointerController.texturePaintDrag, reloadShapePacks, clearLockedHoverCapture,
  openColorPickerPopup, closeProjectTab, activateProjectTab, openProjectInfo,
  projectTabInsertionIndex, previewProjectTabInsertion, moveProjectTabToIndex,
  applyProjectInfo, setReferenceImageMenu, beginReferenceImageImport,
  setReferenceImageEditing, resetReferenceImage, removeReferenceImage,
  loadReferenceImageFiles, beginReferenceImageDrag, moveReferenceImageDrag,
  endReferenceImageDrag, scaleReferenceImage, createTextureTemplate,
  addPaletteRow, renderPalette, enterAxisView, beginAxisWidgetDrag,
  moveAxisWidgetDrag, endAxisWidgetDrag, restore, cancelCameraFocus,
  deleteSelectedPaletteColor, refreshKnifeFromModifierEvent,
  activateDock, addBezierElement, addCube, addGroup, addLocator, addShape,
  addTextureGroup, animateLockedHoverStrength, applyPreset,
  beginTemporaryEyedropper, bindContextMenus, bindTextureFaceDropSurface,
  cameraController, clamp, clearOutlinerDropState,
  clearPaintGradientSelection, clearSelection, clearTextureFaceDropTarget,
  copySelected, copyTexture, createOutlinerDragGhost, createSimpleTexture, cutSelected, cutTexture,
  cycleSnap, deleteSelected, editSelectedUvFace, endPointerDrag,
  endTemporaryEyedropper, endTexturePointer, exitSubdivisionEdit,
  exportProject, focusSelected, focusSceneOrigin, focusSelectedTextureUvs, getUvPreviewProject,
  importPlayerReferenceTexture, importTexture, inspectorBatchNodes,
  invalidateSelectionRenderGeometry, isBezierElement, isEffectivelyLocked,
  loadProjectContent, markDirty, moveSelectedNodes, newProject,
  nodeAutoUvEnabled, nodeUvNormalizedEnabled, noteJournalOperation,
  onPointerDown, onPointerMove, onScenePointerMove, onTexturePointerMove,
  openNewProjectDialog, openPreciseRotationInput, openProject,
  openTextureCreateDialog, pasteElements, pasteTexture, playTimeline,
  rebuildTextureAtlas, redo, refreshSelectionUi, refreshUvPreview,
  remapNumericFaceTextureReferences, removeOutlinerDragGhost,
  renderAll, renderInspector, renderOutliner, renderOutlinerWindow,
  renderPaintGradientPreview, renderScene, renderTextureList,
  renderTextureUvOverlay, renderUvPreview, resetTextureView,
  resolveGizmoHandle, round, saveProject, scheduleLockedHover,
  scheduleOutlinerWindow, scheduleSceneRender, scheduleTextureAnimation,
  selected, selectAllElements, selectItem, selectPaintGradientStop, setActiveTextureItem,
  setConfigFromControl, setDockHotspotFocus, setMode, setNodeFlag,
  setRenderModeMenu, setThemeVar, setTool, setUvCoordinate, snapshot,
  startCameraDrag, startTexturePointer, startTransformDrag, stopTimeline,
  stopUvPreviewAnimation, syncTexturePreviewPriority, textureUid,
  textureUvEntries, toast, topLevelSelectedUids, undo,
  updateFaceSelectionOverlay, updateGizmoDepthHover,
  updateMultiTransformModeButtons, updateRenderModeControl,
  updateRotationModeButtons, updateScaleHandleModeButtons,
  updateSelectionLabels, updateTextureCreateDialog,
  updateTextureStageTransform, updateToolOptions, useVertexSnapPoint,
  updateTransformGizmo, movePivotToRotationVertex,
  uvFaceKey, uvPreviewElements, uvPreviewIsActive, wheelTextureView
});
function bindEvents(...args) { return eventBinder.bindEvents(...args); }

const timelineController = createTimelineController({ state, $ });
function playTimeline(...args) { return timelineController.playTimeline(...args); }
function stopTimeline(...args) { return timelineController.stopTimeline(...args); }
function updateTimelineUI(...args) { return timelineController.updateTimelineUI(...args); }

const viewportPointerController = createViewportPointerController({
  state, sceneCanvas, sceneRenderer, selectionMarquee, uvEditorController,
  getCurveWorldPlane, isBezierElement, isEffectivelyLocked,
  refreshSelectionUi, renderInspector, renderOutlinerWindow, renderScene,
  renderTextureUvOverlay, revealOutlinerItem, selected, selectItem,
  setDockHotspotFocus, startScenePaintPointer, updateFaceSelectionOverlay,
  updateUvFaceUi, uvFaceKey, useKnifePoint, cancelCameraFocus, bakeCameraPan
});
function startCurveHandleDrag(...args) { return viewportPointerController.startCurveHandleDrag(...args); }
function onPointerDown(...args) { return viewportPointerController.onPointerDown(...args); }
function viewportSelectionMode(...args) { return viewportPointerController.viewportSelectionMode(...args); }
function updateSelectionMarquee(...args) { return viewportPointerController.updateSelectionMarquee(...args); }
function applyViewportBoxSelection(...args) { return viewportPointerController.applyViewportBoxSelection(...args); }
function startCameraDrag(...args) { return viewportPointerController.startCameraDrag(...args); }

const transformGeometry = createTransformGeometry({
  state, CUBE_FACE_NAMES, isShapeElement, isBezierElement,
  captureGroupMembers, selected, updateToolOptions, renderScene,
  toast, snapshot, markDirty, invalidateAllRenderGeometry, renderAll
});
function freezeCubeUvs(...args) { return transformGeometry.freezeCubeUvs(...args); }
function translateItemByLocalDelta(...args) { return transformGeometry.translateItemByLocalDelta(...args); }
function worldVectorToParentLocal(...args) { return transformGeometry.worldVectorToParentLocal(...args); }
function worldPointToParentLocal(...args) { return transformGeometry.worldPointToParentLocal(...args); }
function worldPointToCubeLocal(...args) { return transformGeometry.worldPointToCubeLocal(...args); }
function quaternionFromVectors(...args) { return transformGeometry.quaternionFromVectors(...args); }
function vertexRotationTurn(...args) { return transformGeometry.vertexRotationTurn(...args); }
function useVertexSnapPoint(...args) { return transformGeometry.useVertexSnapPoint(...args); }
function movePivotToRotationVertex(...args) { return transformGeometry.movePivotToRotationVertex(...args); }
function clamp(...args) { return transformGeometry.clamp(...args); }

const transformTargets = createTransformTargets({
  state, isShapeElement, subdivisionOwner, getTransformPivot,
  getTransformAxes
});
function cubeLocalPointToWorld(...args) { return transformTargets.cubeLocalPointToWorld(...args); }
function nodeTransformAnchor(...args) { return transformTargets.nodeTransformAnchor(...args); }
function captureModifierAnchors(...args) { return transformTargets.captureModifierAnchors(...args); }
function translateModifierAnchorsFromSnapshot(...args) { return transformTargets.translateModifierAnchorsFromSnapshot(...args); }
function translateModifierAnchors(...args) { return transformTargets.translateModifierAnchors(...args); }
function captureTransformTarget(...args) { return transformTargets.captureTransformTarget(...args); }
function translateCapturedTarget(...args) { return transformTargets.translateCapturedTarget(...args); }
function localDirectionFromWorld(...args) { return transformTargets.localDirectionFromWorld(...args); }
function localDeltaFromWorld(...args) { return transformTargets.localDeltaFromWorld(...args); }
function rotatePointAroundAxis(...args) { return transformTargets.rotatePointAroundAxis(...args); }
function translationMatrix(...args) { return transformTargets.translationMatrix(...args); }
function rotationMatrixAroundAxis(...args) { return transformTargets.rotationMatrixAroundAxis(...args); }
function applyTargetRotation(...args) { return transformTargets.applyTargetRotation(...args); }

const transformInteraction = createTransformInteraction({
  state, $, sceneCanvas, sceneRenderer, viewport, preciseRotationInput, selectionMarquee,
  activeCurveNodeContext, activeModifierAnchorContext, applyTargetRotation,
  applyViewportBoxSelection, bakeCurveNodeTangent, captureGroupMembers,
  captureModifierAnchors, captureTransformTarget, clearSelection,
  discardSubdivisionEdits, finishScenePaintDrag, formatNumber, formatSigned,
  freezeCubeUvs, getAngleSnapStep, getSelectionTransformContext,
  intersectRayPlane, invalidateSelectionRenderGeometry, isBezierElement,
  isEffectivelyLocked, isShapeElement, localDeltaFromWorld, markDirty,
  moveScenePaintDrag, polyhedronEdgeLength, queueSceneBrushPointer,
  refreshSelectionUi, renderInspector, renderScene, rotatePointAroundAxis,
  rotationMatrixAroundAxis, scheduleSceneRender, selected, selectedElementUids,
  selectItem, setCurveHandle, snapAngle, snapShapeDimension, snapshot,
  snapValue, subdivisionOwner, syncInspectorValues, toast,
  translateCapturedTarget, translateModifierAnchorsFromSnapshot,
  translationMatrix, updatePaintGradientHover, updateSelectionMarquee,
  viewportSelectionMode, worldPointToCurveLocal, worldPointToParentLocal,
  updateKnifeHover, schedulePaintSymmetryBuild, currentProjection
});
function startTransformDrag(...args) { return transformInteraction.startTransformDrag(...args); }
function dismissPreciseRotationInput(...args) { return transformInteraction.dismissPreciseRotationInput(...args); }
function openPreciseRotationInput(...args) { return transformInteraction.openPreciseRotationInput(...args); }
function applyExactRotation(...args) { return transformInteraction.applyExactRotation(...args); }
function onPointerMove(...args) { return transformInteraction.onPointerMove(...args); }
function onScenePointerMove(...args) { return transformInteraction.onScenePointerMove(...args); }
function applyPendingTransform(...args) { return transformInteraction.applyPendingTransform(...args); }
function commitBatchTransform(...args) { return transformInteraction.commitBatchTransform(...args); }
function scheduleTransformUpdate(...args) { return transformInteraction.scheduleTransformUpdate(...args); }
function endPointerDrag(...args) { return transformInteraction.endPointerDrag(...args); }
function getPlaneDragDistances(...args) { return transformInteraction.getPlaneDragDistances(...args); }
function getPlaneUniformDistance(...args) { return transformInteraction.getPlaneUniformDistance(...args); }
function applyTransformDrag(...args) { return transformInteraction.applyTransformDrag(...args); }
function updateTransformTooltip(...args) { return transformInteraction.updateTransformTooltip(...args); }

function captureGroupMembers(...args) { return transformTargets.captureGroupMembers(...args); }

const snapController = createSnapController({ state, $, noteJournalOperation, markDirty, toast });
function getSnapSubdivisions(...args) { return snapController.getSnapSubdivisions(...args); }
function getSnapStep(...args) { return snapController.getSnapStep(...args); }
function snapValue(...args) { return snapController.snapValue(...args); }
function getAngleSnapStep(...args) { return snapController.getAngleSnapStep(...args); }
function polyhedronEdgeLength(...args) { return snapController.polyhedronEdgeLength(...args); }
function radiusFromPolyhedronEdge(...args) { return snapController.radiusFromPolyhedronEdge(...args); }
function snapShapeDimension(...args) { return snapController.snapShapeDimension(...args); }
function snapAngle(...args) { return snapController.snapAngle(...args); }
function formatNumber(...args) { return snapController.formatNumber(...args); }
function formatSigned(...args) { return snapController.formatSigned(...args); }

const shapePackLoader = createShapePackLoader({ $, toast, renderAll });
function loadExternalShapePacks(...args) { return shapePackLoader.loadExternalShapePacks(...args); }
const packsController = createPacksController({ $, toast, reloadShapePacks: loadExternalShapePacks });

initializeDockSystem();
initializeConfigRegistry();
window.cubeBricksDesktop?.onPromptRequest?.(async request => {
  const result = await showAppChoice(request.options);
  await window.cubeBricksDesktop.respondPrompt({ id: request.id, ...result });
});
modelFormatRegistry.subscribe(() => {
  renderModelFormatPicker();
  if (document.body.classList.contains('project-home-active')) void modelFormatPicker.renderProjectHome();
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
modelFormatPicker.bindProjectHome();
bindEvents();
window.cubeBricksDesktop?.onExternalProjectOpen?.(filePath => { void openProject(filePath); });
paintSelectionController.bind();
updateToolVisibility();
renderAll();
markDirty(false);
shapePacksReady = loadExternalShapePacks();
void shapePacksReady.then(async () => {
  await packsController.refresh();
  modelFormatPicker.renderProjectHome();
}).catch(error => console.warn('資源包載入失敗', error));
