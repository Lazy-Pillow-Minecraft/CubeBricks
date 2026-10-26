import { LAYER_BLEND_MODES } from '../common/core/layer-blend.js';
import { activeLayer, compositeLayers, layerRasterCache, loadRaster, prepareLayers, selectedLayerEntry } from '../common/core/texture-features.js';

export function createLayerEditorDialog({ $, activeTextureAsset, onPropertyInput, onPropertyCommit, onClose, toast }) {
  const dialog = $('#layerEditorDialog');
  const layerList = $('#textureFeatureControls').closest('.texture-layer-panel-scroll');
  const originalParent = layerList.parentNode;
  const host = $('#layerEditorListHost');
  const range = $('#layerOpacityRange');
  const value = $('#layerOpacityValue');
  const blendMode = $('#layerBlendMode');
  const compositePreview = $('#layerEditorComposite');
  const currentPreview = $('#layerEditorCurrent');
  let frame = null;
  let pendingAsset = null;
  let fallbackRaster = null;

  blendMode.innerHTML = LAYER_BLEND_MODES.map(([key, title]) => `<option value="${key}">${title}</option>`).join('');

  function paintPreview(canvas, source, width, height) {
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (source) context.drawImage(source, 0, 0);
  }

  function render() {
    if (!dialog.open) return;
    const asset = activeTextureAsset();
    const layer = selectedLayerEntry(asset) || activeLayer(asset);
    $('#layerEditorLayerName').textContent = layer?.name || '未選擇圖層';
    range.disabled = value.disabled = blendMode.disabled = !layer;
    range.value = value.value = String(layer?.opacity ?? 100);
    blendMode.value = layer?.blendMode || 'normal';
    const composite = asset?.layers?.length ? compositeLayers(asset) : fallbackRaster;
    const current = layer?.type === 'group' ? compositeLayers(asset, null, layer.uid)
      : layerRasterCache.get(layer?.uid)?.canvas || null;
    paintPreview(compositePreview, composite, composite?.width || 16, composite?.height || 16);
    paintPreview(currentPreview, current, current?.width || 16, current?.height || 16);
  }

  function scheduleRender() {
    if (!dialog.open || frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; render(); });
  }

  function editOpacity(input, commit = false) {
    const layer = selectedLayerEntry(activeTextureAsset()) || activeLayer(activeTextureAsset());
    if (!layer || input.value === '') return;
    const opacity = Math.max(0, Math.min(100, Number(input.value)));
    if (!Number.isFinite(opacity)) return;
    range.value = value.value = String(opacity);
    onPropertyInput(layer, 'opacity', opacity);
    scheduleRender();
    if (commit) onPropertyCommit();
  }

  for (const input of [range, value]) {
    input.addEventListener('input', () => editOpacity(input));
    input.addEventListener('change', () => editOpacity(input, true));
  }
  blendMode.addEventListener('change', () => {
    const layer = selectedLayerEntry(activeTextureAsset()) || activeLayer(activeTextureAsset());
    if (!layer) return;
    onPropertyInput(layer, 'blendMode', blendMode.value);
    onPropertyCommit();
    scheduleRender();
  });

  $('#closeLayerEditor').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    onClose();
    originalParent.append(layerList);
    pendingAsset = null;
    fallbackRaster = null;
  });

  function open() {
    const asset = activeTextureAsset();
    if (!asset) return toast('請先建立或選擇貼圖');
    if (dialog.open) return;
    host.append(layerList);
    dialog.showModal();
    pendingAsset = asset;
    fallbackRaster = null;
    render();
    if (!asset.layers?.length && asset.source) loadRaster(asset.source).then(raster => {
      if (dialog.open && pendingAsset === asset) { fallbackRaster = raster; scheduleRender(); }
    }).catch(error => toast(error.message));
    prepareLayers(asset).then(() => {
      if (dialog.open && pendingAsset === asset) scheduleRender();
    }).catch(error => toast(error.message));
  }

  return { open, render: scheduleRender, get isOpen() { return dialog.open; } };
}
