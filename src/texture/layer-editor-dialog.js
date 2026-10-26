import { LAYER_BLEND_MODES } from '../common/core/layer-blend.js';
import { activeLayer, compositeLayers, layerRasterCache, loadRaster, prepareLayers, selectedLayerEntry } from '../common/core/texture-features.js';
import { tonePaletteSnapshot } from './tone-palette.js';

export function createLayerEditorDialog({ $, activeTextureAsset, paletteRows, samplePaletteGradient, onPropertyInput, onPropertyCommit, onClose, toast }) {
  const dialog = $('#layerEditorDialog');
  const layerList = $('#textureFeatureControls').closest('.texture-layer-panel-scroll');
  const originalParent = layerList.parentNode;
  const host = $('#layerEditorListHost');
  const range = $('#layerOpacityRange');
  const value = $('#layerOpacityValue');
  const nameInput = $('#layerEditorName');
  const blendMode = $('#layerBlendMode');
  const maskSource = $('#layerMaskSource');
  const toneOptions = $('#layerToneMapOptions');
  const tonePalette = $('#layerTonePalette');
  const discreteOptions = $('#layerToneDiscrete');
  const continuousOptions = $('#layerToneContinuous');
  const discreteAnchor = $('#layerToneAnchorDiscrete');
  const continuousAnchor = $('#layerToneAnchorContinuous');
  const anchorColor = $('#layerToneAnchorColor');
  const anchorPercent = $('#layerToneAnchorPercent');
  const anchorGray = $('#layerToneAnchorGray');
  const grayField = $('#layerToneGrayField');
  const segments = $('#layerToneSegments');
  const compositePreview = $('#layerEditorComposite');
  const currentPreview = $('#layerEditorCurrent');
  let frame = null;
  let pendingAsset = null;
  let fallbackRaster = null;

  blendMode.innerHTML = LAYER_BLEND_MODES.map(([key, title]) => `<option value="${key}">${title}</option>`).join('');

  function paletteSnapshot(row) {
    return tonePaletteSnapshot(row, samplePaletteGradient);
  }

  function currentLayer() {
    const asset = activeTextureAsset();
    return selectedLayerEntry(asset) || activeLayer(asset);
  }

  function updateToneControls(layer) {
    const visible = Boolean(layer && layer.blendMode === 'tone_map');
    toneOptions.hidden = !visible;
    if (!visible) return;
    const settings = layer.toneMap || paletteSnapshot(paletteRows.find(row => row.colors.length || row.colorSpaceGradient));
    tonePalette.innerHTML = paletteRows.filter(row => row.colors.length || row.colorSpaceGradient).map(row => {
      const option = document.createElement('option');
      option.value = row.id;
      option.textContent = row.name;
      return option.outerHTML;
    }).join('');
    if (settings?.paletteId && !paletteRows.some(row => row.id === settings.paletteId)) {
      const missing = document.createElement('option');
      missing.value = settings.paletteId;
      missing.textContent = '已移除的色卡（使用保存的顏色）';
      tonePalette.append(missing);
    }
    tonePalette.value = settings?.paletteId || '';
    const continuous = settings?.paletteType === 'continuous';
    discreteOptions.hidden = continuous;
    continuousOptions.hidden = !continuous;
    grayField.hidden = !settings?.anchorEnabled;
    discreteAnchor.checked = continuousAnchor.checked = Boolean(settings?.anchorEnabled);
    segments.value = String(settings?.segmentCount ?? 8);
    anchorPercent.value = String(settings?.anchorPercent ?? 50);
    anchorGray.value = String(settings?.grayUnit === 'percent' ? settings.anchorGray
      : Math.round((settings?.anchorGray ?? 128) / 255 * 1000) / 10);
    const palette = paletteRows.find(row => row.id === settings?.paletteId);
    anchorColor.innerHTML = (palette?.colors || settings?.paletteSamples || []).map((color, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${index + 1} · ${color}`;
      option.style.color = color;
      return option.outerHTML;
    }).join('');
    anchorColor.value = String(settings?.anchorColorIndex ?? 0);
    anchorColor.disabled = continuous || !settings?.anchorEnabled;
    anchorPercent.disabled = !continuous || !settings?.anchorEnabled;
  }

  function editTone(change) {
    const layer = currentLayer();
    if (!layer) return;
    const initial = layer.toneMap || paletteSnapshot(paletteRows.find(row => row.colors.length || row.colorSpaceGradient));
    if (!initial) return toast('請先建立有顏色的色卡');
    const next = { ...initial, grayUnit: 'percent',
      anchorGray: initial.grayUnit === 'percent' ? initial.anchorGray : Math.round((initial.anchorGray ?? 128) / 255 * 1000) / 10,
      ...change };
    onPropertyInput(layer, 'toneMap', next);
    onPropertyCommit();
    scheduleRender();
  }

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
    nameInput.disabled = range.disabled = value.disabled = blendMode.disabled = maskSource.disabled = !layer;
    if (document.activeElement !== nameInput) nameInput.value = layer?.name || '';
    range.value = value.value = String(layer?.opacity ?? 100);
    blendMode.value = layer?.blendMode || 'normal';
    maskSource.replaceChildren();
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '無蒙版';
    maskSource.append(none);
    for (const entry of asset?.layers || []) {
      if (entry.uid === layer?.uid) continue;
      const option = document.createElement('option');
      option.value = entry.uid;
      option.textContent = `${entry.type === 'group' ? '▣ ' : '▧ '}${entry.name || entry.uid}`;
      maskSource.append(option);
    }
    maskSource.value = layer?.maskLayerUid || '';
    updateToneControls(layer);
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
    if (blendMode.value === 'tone_map' && !layer.toneMap) {
      const initial = paletteSnapshot(paletteRows.find(row => row.colors.length || row.colorSpaceGradient));
      if (initial) onPropertyInput(layer, 'toneMap', initial);
    }
    onPropertyCommit();
    scheduleRender();
  });
  maskSource.addEventListener('change', () => {
    const layer = currentLayer();
    if (!layer) return;
    onPropertyInput(layer, 'maskLayerUid', maskSource.value || null);
    onPropertyCommit();
    scheduleRender();
  });
  tonePalette.addEventListener('change', () => {
    const row = paletteRows.find(entry => entry.id === tonePalette.value);
    const snapshot = paletteSnapshot(row);
    if (snapshot) editTone(snapshot);
  });
  discreteAnchor.addEventListener('change', () => editTone({ anchorEnabled: discreteAnchor.checked }));
  continuousAnchor.addEventListener('change', () => editTone({ anchorEnabled: continuousAnchor.checked }));
  anchorColor.addEventListener('change', () => editTone({ anchorColorIndex: Number(anchorColor.value) }));
  for (const [control, field, low, high] of [
    [segments, 'segmentCount', 2, 256], [anchorPercent, 'anchorPercent', 0, 100], [anchorGray, 'anchorGray', 0, 100]
  ]) control.addEventListener('change', () => {
    const value = Math.max(low, Math.min(high, Number(control.value)));
    if (!Number.isFinite(value)) return;
    control.value = String(value);
    editTone({ [field]: value });
  });
  nameInput.addEventListener('change', () => {
    const layer = selectedLayerEntry(activeTextureAsset()) || activeLayer(activeTextureAsset());
    if (!layer) return;
    const name = nameInput.value.trim();
    if (!name) { nameInput.value = layer.name; return; }
    if (name === layer.name) return;
    onPropertyInput(layer, 'name', name);
    onPropertyCommit();
    $('#layerEditorLayerName').textContent = name;
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
