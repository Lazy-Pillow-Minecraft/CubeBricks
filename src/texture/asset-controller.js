import { activeLayer, compositeLayers, imageCanvas, loadRaster, normalizeTextureLayers, prepareLayers, tiledFaceRaster } from '../common/core/texture-features.js';
import { formatRules } from '../common/core/format-constraints.js';

export function createTextureAssetController({
  state, $, $$, textureCanvas, textureCtx, sceneRenderer, uvPreviewRenderer,
  uvPreviewController, uvEditorController, livePaintTextureSources,
  animationRasterCache, getTextureAtlasEntries, activeTextureAsset,
  escapeAttribute, escapeHtml, openIconMarkup, parseUvFaceKey,
  selectedUvFaceData, ensureCubeFaceRecord, persistGeneratedPaintCube,
  rebuildTextureAtlas, drawTextureAtlasEntry, textureAtlasPatch,
  uvPreviewIsActive, pushTexturePaintHistory, renderAll,
  invalidateAllRenderGeometry, registerGeneratedTexture, renderScene,
  updateTexturePreviewFrame, syncRendererTexture, selectedElementUids,
  activeSnapSubdivisions, renderTexture,
  noteJournalOperation, snapshot, markDirty, toast, formatNumber, clamp
}) {
let textureLoadRevision = 0;
let pendingTextureImage = null;

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
  const showComposite = Boolean(asset?.layers?.length && canvas?.width && canvas?.height);
  preview.hidden = !showComposite;
  textureCanvas.style.opacity = showComposite ? '0' : '';
  if (!asset) textureCanvas.style.visibility = '';
  if (showComposite) {
    preview.width = canvas.width; preview.height = canvas.height;
    const context = preview.getContext('2d');
    context.imageSmoothingEnabled = false;
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
    uvPreviewController.uvPreviewProjectCache = null; uvEditorController.textureUvEntryCache = null;
    rebuildTextureAtlas(); markDirty(); renderAll('selection');
  }));
}

function refreshDerivedTileEntries(asset, source) {
  for (const entry of getTextureAtlasEntries()) {
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
    asset.uvWidth ||= raster.width; asset.uvHeight ||= raster.height;
    asset.layers = [{ uid: crypto.randomUUID(), name: '底圖', source: raster.toDataURL('image/png'), visible: true, opacity: 100 }];
  }
  await prepareLayers(asset);
  const canvas = document.createElement('canvas'); canvas.width = textureCanvas.width; canvas.height = textureCanvas.height;
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
    uvEditorController.textureUvEntryCache = null;
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
    textureCanvas.style.visibility = '';
    window.dispatchEvent(new Event('cubebricks:texture-change'));
    syncRendererTexture(textureCanvas);
    renderScene();
    renderTextureFeatureControls();
    updateTexturePreviewFrame(asset?.uvWidth || image.naturalWidth, asset?.uvHeight || image.naturalHeight);
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
    // Blockbench may declare UV coordinates in a smaller logical resolution
    // than the actual high-density PNG. Keep those declared units intact.
    if (asset) {
      const fallback = state.project.meta?.importedFrom === 'bbmodel' ? state.project.textureSize : null;
      asset.uvWidth ||= fallback?.[0] || image.naturalWidth;
      asset.uvHeight ||= fallback?.[1] || image.naturalHeight;
    }
    textureCanvas.width = image.naturalWidth;
    textureCanvas.height = image.naturalHeight;
    textureCtx.imageSmoothingEnabled = false;
    textureCtx.clearRect(0, 0, image.naturalWidth, image.naturalHeight);
    textureCtx.drawImage(image, 0, 0);
    textureCanvas.style.visibility = '';
    window.dispatchEvent(new Event('cubebricks:texture-change'));
    updateTexturePreviewFrame(asset?.uvWidth || image.naturalWidth, asset?.uvHeight || image.naturalHeight);
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
  state.textureAssets = assets.map(asset => ({ ...asset, _uid: textureUid(asset), groupId: asset.groupId || null,
    layers: normalizeTextureLayers(asset) }));
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
  const switchingAsset = state.activeTextureUid !== asset._uid;
  // Reject an earlier image load before asynchronous layer preparation begins.
  const activationRevision = ++textureLoadRevision;
  state.activeTextureUid = asset._uid;
  if (switchingAsset) {
    updateLayerCompositePreview(asset, null);
    textureCanvas.style.visibility = 'hidden';
  }
  if (asset.uvWidth && asset.uvHeight) updateTexturePreviewFrame(asset.uvWidth, asset.uvHeight);
  $$('.texture-item').forEach(item => item.classList.toggle('active', item.dataset.textureUid === asset._uid));
  renderTextureFeatureControls();
  if (asset.layers?.length) prepareLayers(asset).then(() => {
    if (state.activeTextureUid !== asset._uid || activationRevision !== textureLoadRevision) return;
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
return {
  get textureLoadRevision() { return textureLoadRevision; },
  set textureLoadRevision(value) { textureLoadRevision = value; },
  get pendingTextureImage() { return pendingTextureImage; },
  set pendingTextureImage(value) { pendingTextureImage = value; },
  textureUid, renderTextureList, addTextureGroup, updateLayerCompositePreview, renderTextureTileControls, refreshDerivedTileEntries, scheduleTextureAnimation, textureAssetForReference, isFaceTiled, remapNumericFaceTextureReferences, loadTextureAssetImage, createSimpleTexture, updateTextureCreateDialog, openTextureCreateDialog, importTexture, loadTextureSource, installProjectTextures, activateProjectTexture, invalidateUvPreviewTextureState
};
}
