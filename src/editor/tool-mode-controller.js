import { TOOL_REGISTRY, PAINT_TOOLS, PAINT_ERASE_TOOLS } from './tool-registry.js';

export function createToolModeController({
  state, $, $$, inspectorController, exitSubdivisionEdit, renderOutliner,
  stopTimeline, renderInspector, renderScene, toast, sceneCanvas,
  cancelKnifeSelection, clearPaintGradientSelection, endPointerDrag,
  getTexturePaintDrag, endTexturePaintPointer, selectedTopLevelNodes,
  paintToolErasing, paintSetting, getKnifePreviewLabel,
  updateTransformSpaceButtons, updateRotationModeButtons,
  updateScaleHandleModeButtons, updateMultiTransformModeButtons,
  getDockManager
}) {
let temporaryPaintTool = null;
let renderModeBeforePaint = null;
function toolSupportsMode(tool, mode = state.mode) {
  const registered = TOOL_REGISTRY[tool]?.modes.includes(mode);
  if (!registered) return false;
  if (tool === 'faceSelect') return state.separateUvMode ? mode === 'uv' : mode === 'edit';
  return mode !== 'uv';
}

function applyModePanelVisibility() {
  if (!getDockManager()) return;
  if (state.separateUvMode && state.mode === 'edit') {
    for (const id of ['texture', 'uvPreview']) {
      const panel = getDockManager().get(id);
      if (panel) panel.element.hidden = true;
    }
    getDockManager().refreshZones();
  }
}

function setMode(mode) {
  if (mode === 'display' && state.project.formatId !== 'java_block_item') mode = 'edit';
  if (mode === 'animate' && state.project.formatId === 'java_block_item') mode = 'display';
  if (mode === 'uv' && !state.separateUvMode) mode = 'edit';
  if (mode === 'paint' && inspectorController.subdivisionSession) exitSubdivisionEdit(false);
  if (mode === 'paint' && state.mode !== 'paint') {
    renderModeBeforePaint = state.renderMode;
    state.renderMode = 'textured';
  } else if (state.mode === 'paint' && mode !== 'paint' && renderModeBeforePaint) {
    state.renderMode = renderModeBeforePaint;
    renderModeBeforePaint = null;
  }
  state.mode = mode;
  $('#displaySettingsPlaceholder').hidden = mode !== 'display';
  $('#animationEditorPlaceholder').hidden = mode !== 'animate';
  $('#paintShapeMenu').hidden = true;
  $('#paintShapeModeButton').setAttribute('aria-expanded', 'false');
  $('#paintSelectionModeMenu').hidden = true;
  $('#paintSelectionModeButton').setAttribute('aria-expanded', 'false');
  updateRenderModeControl();
  renderOutliner();
  document.body.dataset.editorMode = mode;
  if (mode !== 'paint') {
    $('#textureBrushCursor').hidden = true;
    $('#texturePreview').style.cursor = '';
  }
  if (mode !== 'animate' && state.timelinePlaying) stopTimeline();
  getDockManager()?.setMode(mode);
  applyModePanelVisibility();
  $$('.mode-tab').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  updateToolVisibility();
  if (!toolSupportsMode(state.tool, mode)) setTool(mode === 'paint' ? 'brush' : mode === 'uv' ? 'faceSelect' : 'move');
  $('#viewLabel').textContent = mode === 'paint' ? '三維繪畫' : mode === 'uv' ? 'UV 編輯' : mode === 'animate' ? '動畫編輯' : mode === 'display' ? '顯示設置' : '實體著色';
  if (mode === 'paint') activateDock('palette');
  if (mode === 'animate') activateDock('timeline');
  renderInspector();
  renderScene();
  toast({ edit: '編輯模式', uv: 'UV 編輯模式', paint: '繪畫模式', animate: '動畫編輯（開發中）', display: '顯示設置（開發中）' }[mode]);
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
  if (['line', 'rectangle', 'ellipse'].includes(tool)) state.paintShapeTool = tool;
  sceneCanvas.classList.toggle('is-knife', tool === 'knife');
  $$('.tool').forEach(button => button.classList.toggle('active', button.dataset.tool === tool));
  $('#paintShapeButton').classList.toggle('active', ['line', 'rectangle', 'ellipse'].includes(tool));
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
  if (getTexturePaintDrag()) endTexturePaintPointer({ pointerId: getTexturePaintDrag().pointerId });
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
    brush: '畫筆', paintSelection: '繪畫選區', line: '直線', rectangle: '矩形', ellipse: '橢圓', fill: '油漆桶', gradient: '漸變', eyedropper: '取色器'
  };
  const paintTool = PAINT_TOOLS.includes(state.tool);
  if (state.paintSelectionMode === 'transform') state.paintSelectionMode = 'rectangle';
  const shapeNames = { line: '直線', rectangle: '矩形', ellipse: '橢圓' };
  const shapeTool = state.paintShapeTool || 'line';
  $('#paintShapeButton').title = `圖形繪製（目前：${shapeNames[shapeTool]}）`;
  $('#paintShapeButton').dataset.shape = shapeTool;
  $('#paintShapeModeButton').textContent = shapeNames[shapeTool];
  $('#paintShapeModeButton').dataset.shape = shapeTool;
  $$('[data-paint-shape]').forEach(button => button.classList.toggle('active', button.dataset.paintShape === shapeTool));
  const selectionNames = { rectangle: '拉框', brush: '塗抹', lasso: '自由圈選' };
  $('#paintSelectionModeButton').textContent = selectionNames[state.paintSelectionMode] || selectionNames.rectangle;
  $('#paintSelectionModeButton').dataset.selectionShape = state.paintSelectionMode;
  $$('[data-paint-selection-mode]').forEach(button => button.classList.toggle('active', button.dataset.paintSelectionMode === state.paintSelectionMode));
  lane.hidden = state.mode === 'display' || !labels[state.tool];
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
  $('#paintToolOptions').hidden = !paintTool && state.tool !== 'paintSelection';
  $('#paintShapeModeControl').hidden = !['line', 'rectangle', 'ellipse'].includes(state.tool);
  $('#paintShapeFillControl').hidden = !['rectangle', 'ellipse'].includes(state.tool);
  $('#paintShapeFilled').checked = state.paintShapeFilled;
  $('#paintSelectionModeControl').hidden = state.tool !== 'paintSelection';
  $('#paintSelectionBrushControl').hidden = state.tool !== 'paintSelection' || state.paintSelectionMode !== 'brush';
  $('#paintSelectionSymmetryControl').hidden = state.tool !== 'paintSelection';
  const selectionTransform = state.tool === 'paintSelection' && state.paintSelectionMode === 'transform';
  $('#paintSelectionTransformControl').hidden = !selectionTransform;
  $('#paintSelectionFreeRotateControl').hidden = !selectionTransform || state.paintSelectionTransformMode !== 'rotate';
  for (const id of ['#paintSelectionCopy', '#paintSelectionRotateLeft', '#paintSelectionRotateRight']) $(id).hidden = !selectionTransform;
  $('#paintSelectionTransformMode').value = state.paintSelectionTransformMode;
  $('#paintSelectionFreeRotate').checked = state.paintSelectionFreeRotate;
  $('#paintSelectionCopy').textContent = `複製像素：${state.paintSelectionCopy ? '開' : '關'}`;
  $('#paintSelectionClear').hidden = state.tool !== 'paintSelection';
  $('#paintSelectionMode').value = state.paintSelectionMode;
  $('#paintSelectionBrushSize').value = String(state.paintSelectionBrushSize);
  $('#paintSelectionSymmetry').checked = state.paintSelectionSymmetry;
  for (const selector of ['#paintEraseControl', '#paintBrushSize', '#paintBrushShapeControl', '#paintBrushAaControl', '#paintBrushDepthControl', '#paintBrushOverlayControl', '#paintBrushOpacity', '#paintBucketScopeControl', '#paintBucketSingleFaceControl', '#paintGradientModeControl', '#paintGradientPaletteControl', '#paintGradientStartControl', '#paintGradientStartAlphaControl', '#paintGradientEndControl', '#paintGradientEndAlphaControl']) {
    const control = $(selector);
    if (state.tool === 'paintSelection') control.closest('label,button')?.setAttribute('data-selection-hidden', '');
    else control.closest('label,button')?.removeAttribute('data-selection-hidden');
  }
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
  $('#snapButton').hidden = state.mode === 'display' || paintTool || state.tool === 'paintSelection';
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
  getDockManager()?.expand('bottom');
}

return {
  toolSupportsMode,
  applyModePanelVisibility,
  setMode,
  updateToolVisibility,
  setTool,
  beginTemporaryEyedropper,
  endTemporaryEyedropper,
  updateToolOptions,
  updateRenderModeControl,
  setRenderModeMenu,
  activateDock,
};
}
