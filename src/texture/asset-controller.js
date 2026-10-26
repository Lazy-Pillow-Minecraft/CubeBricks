import { activeLayer, compositeLayers, createLayerGroup, imageCanvas, insertLayerNearSelection, layerDescendantUids, layerEntryRaster, layerRasterCache, layerTreeItems, loadRaster, normalizeTextureLayers, prepareLayers, reorderLayerStack, selectedLayerEntry, tiledFaceRaster } from '../common/core/texture-features.js';
import { formatRules } from '../common/core/format-constraints.js';
import { createListDragAutoScroll } from '../screen/list-drag-scroll.js';
import { verticalDropTarget } from '../screen/vertical-drop.js';
import { createLayerEditorDialog } from './layer-editor-dialog.js';

const CUBE_FACES = ['north', 'east', 'south', 'west', 'up', 'down'];
let textureClipboard = null;
const decodedTextureImages = new WeakMap();

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
const layerRefreshRevision = new WeakMap();
let layerDrag = null;
let layerDragBound = false;
let layerEditSession = null;
const layerEditor = createLayerEditorDialog({ $, activeTextureAsset, toast,
  onPropertyInput(layer, property, next) {
    const asset = activeTextureAsset();
    if (!asset || layer[property] === next) return;
    if (layerEditSession?.asset !== asset) {
      if (layerEditSession) finishLayerEdit();
      pushTexturePaintHistory(asset, textureCanvas, null, 'core.texture.layer');
      layerEditSession = { asset };
    }
    layer[property] = next;
    layerEditor.render();
  },
  onPropertyCommit: finishLayerEdit,
  onClose: finishLayerEdit
});

function finishLayerEdit() {
  const session = layerEditSession;
  if (!session) return;
  layerEditSession = null;
  refreshLayeredTexture(session.asset).catch(error => toast(error.message));
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
  layerEditor.render();
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
  const revision = (layerRefreshRevision.get(asset) || 0) + 1;
  layerRefreshRevision.set(asset, revision);
  const cached = asset.layers?.every(layer => {
    if (layer.type === 'group') return true;
    const raster = layerRasterCache.get(layer.uid);
    return raster && raster.savedSource === layer.source;
  });
  if (!cached) {
    await prepareLayers(asset);
    if (layerRefreshRevision.get(asset) !== revision) return;
  }
  const canvas = compositeLayers(asset);
  if (!canvas) return;
  asset.source = canvas.toDataURL('image/png');
  livePaintTextureSources.delete(asset._uid);
  animationRasterCache.set(asset._uid, { canvas, source: asset.source });
  if (asset._uid === state.activeTextureUid) showLayerComposite(asset, canvas);
  else rebuildTextureAtlas();
  renderTextureList();
  markDirty();
}

function showLayerComposite(asset, canvas) {
  // The preview and GPU receive the already-composited image. Never feed it
  // back into compositeLayers as the active layer's editable raster.
  ++textureLoadRevision;
  showEditableLayer(asset, canvas);
  textureCanvas.style.visibility = '';
  updateTexturePreviewFrame(asset.uvWidth || canvas.width, asset.uvHeight || canvas.height);
  updateLayerCompositePreview(asset, canvas);
  syncRendererTexture(canvas, true);
  window.dispatchEvent(new Event('cubebricks:texture-change'));
  renderScene();
}

function showEditableLayer(asset, fallback = null) {
  const editable = layerRasterCache.get(activeLayer(asset)?.uid)?.canvas;
  if (!editable && !fallback) return;
  textureCanvas.width = editable?.width || fallback.width;
  textureCanvas.height = editable?.height || fallback.height;
  textureCtx.imageSmoothingEnabled = false;
  textureCtx.clearRect(0, 0, textureCanvas.width, textureCanvas.height);
  if (editable) textureCtx.drawImage(editable, 0, 0);
}

async function ensureTextureLayers(asset) {
  if (asset.layers?.length) return;
  const raster = await loadRaster(asset.source);
  asset.uvWidth ||= raster.width; asset.uvHeight ||= raster.height;
  asset.layers = [{ uid: crypto.randomUUID(), name: '底圖', source: raster.toDataURL('image/png'), visible: true, opacity: 100, blendMode: 'normal' }];
  asset.activeLayerUid = asset.layers[0].uid;
}

async function addTextureLayer() {
  const asset = activeTextureAsset();
  if (!asset) return toast('請先建立或導入貼圖');
  pushTexturePaintHistory(asset, textureCanvas, null, 'core.texture.layer');
  await ensureTextureLayers(asset);
  await prepareLayers(asset);
  const canvas = document.createElement('canvas'); canvas.width = textureCanvas.width; canvas.height = textureCanvas.height;
  const count = asset.layers.filter(entry => entry.type !== 'group').length + 1;
  const layer = { uid: crypto.randomUUID(), name: `圖層 ${count}`, source: canvas.toDataURL('image/png'), visible: true, opacity: 100, blendMode: 'normal' };
  layerRasterCache.set(layer.uid, { canvas, savedSource: layer.source });
  asset.layers = insertLayerNearSelection(asset.layers, layer, asset.activeLayerUid);
  asset.activeLayerUid = layer.uid;
  await refreshLayeredTexture(asset);
  renderTextureFeatureControls();
}

async function addTextureLayerGroup() {
  const asset = activeTextureAsset();
  if (!asset) return toast('請先建立或導入貼圖');
  pushTexturePaintHistory(asset, textureCanvas, null, 'core.texture.layer');
  await ensureTextureLayers(asset);
  const uid = crypto.randomUUID();
  const numbers = new Set(asset.layers.filter(layer => layer.type === 'group')
    .map(layer => Number(String(layer.name || '').match(/^group_(\d+)$/)?.[1])).filter(Number.isFinite));
  let number = 1;
  while (numbers.has(number)) number++;
  asset.layers = createLayerGroup(asset.layers, asset.activeLayerUid, uid, `group_${number}`);
  asset.activeLayerUid = uid;
  await refreshLayeredTexture(asset);
  renderTextureFeatureControls();
}

function bindLayerDrag(root) {
  if (layerDragBound) return;
  layerDragBound = true;
  const scroll = root.closest('.texture-layer-panel-scroll');
  const autoScroll = createListDragAutoScroll(scroll, () => Boolean(layerDrag?.active), pointer => {
    if (pointer) updateLayerDropTarget(root, pointer.y);
  });
  const clearTarget = () => root.querySelectorAll('.drop-before,.drop-after,.drop-inside').forEach(row =>
    row.classList.remove('drop-before', 'drop-after', 'drop-inside'));
  function updateLayerDropTarget(rootNode, y) {
    clearTarget();
    layerDrag.targetUid = null;
    layerDrag.position = null;
    const target = verticalDropTarget([...rootNode.querySelectorAll('[data-layer-row]')], y);
    const row = target?.entry;
    if (!row || row.dataset.layerRow === layerDrag?.uid) return;
    layerDrag.targetUid = row.dataset.layerRow;
    const asset = layerDrag.asset;
    const targetLayer = asset?.layers?.find(entry => entry.uid === row.dataset.layerRow);
    const rect = row.getBoundingClientRect();
    const relativeY = (y - rect.top) / Math.max(1, rect.height);
    layerDrag.position = targetLayer?.type === 'group' && relativeY > .3 && relativeY < .7
      ? 'inside' : target.position;
    row.classList.add(`drop-${layerDrag.position}`);
  }
  root.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('input,button,[data-layer-group-line]')) return;
    const row = event.target.closest('[data-layer-row]');
    if (!row || !root.contains(row)) return;
    layerDrag = { uid: row.dataset.layerRow, startX: event.clientX, startY: event.clientY,
      pointerId: event.pointerId, asset: activeTextureAsset(), active: false, targetUid: null, position: null };
  });
  root.addEventListener('dragstart', event => {
    if (event.target.closest('[data-layer-row]')) event.preventDefault();
  });
  document.addEventListener('pointermove', event => {
    const drag = layerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      const row = root.querySelector(`[data-layer-row="${CSS.escape(drag.uid)}"]`);
      if (!row) { layerDrag = null; return; }
      drag.active = true;
      row.classList.add('is-dragging');
      const ghost = row.cloneNode(true);
      ghost.classList.remove('is-dragging');
      ghost.classList.add('texture-layer-drag-ghost');
      const originalThumb = row.querySelector('.texture-layer-thumb');
      const ghostThumb = ghost.querySelector('.texture-layer-thumb');
      if (originalThumb && ghostThumb) ghostThumb.getContext('2d').drawImage(originalThumb, 0, 0);
      ghost.style.width = `${row.getBoundingClientRect().width}px`;
      document.body.append(ghost);
      drag.ghost = ghost;
      autoScroll.start();
    }
    event.preventDefault();
    drag.ghost.style.left = `${event.clientX + 13}px`;
    drag.ghost.style.top = `${event.clientY + 9}px`;
    updateLayerDropTarget(root, event.clientY);
  });
  const finish = (event, commit) => {
    const drag = layerDrag;
    if (!drag || event?.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
    if (commit && drag.active) updateLayerDropTarget(root, event.clientY);
    layerDrag = null;
    autoScroll.stop();
    drag.ghost?.remove();
    root.querySelector(`[data-layer-row="${CSS.escape(drag.uid)}"]`)?.classList.remove('is-dragging');
    clearTarget();
    if (!commit || !drag.active || !drag.targetUid) return;
    const asset = drag.asset;
    if (!asset || asset !== activeTextureAsset()) return;
    const reordered = reorderLayerStack(asset.layers, drag.uid, drag.targetUid, drag.position);
    if (reordered === asset.layers) return;
    pushTexturePaintHistory(asset, textureCanvas, null, 'core.texture.layer');
    asset.layers = reordered;
    refreshLayeredTexture(asset).then(renderTextureFeatureControls).catch(error => toast(error.message));
  };
  document.addEventListener('pointerup', event => finish(event, true));
  document.addEventListener('pointercancel', event => finish(event, false));
  window.addEventListener('blur', () => finish(null, false));
}

function renderTextureFeatureControls() {
  const root = $('#textureFeatureControls'), asset = activeTextureAsset();
  bindLayerDrag(root);
  if (!asset) { root.innerHTML = '<span>請先選擇貼圖</span>'; return; }
  const selected = selectedLayerEntry(asset);
  const layerLineX = depth => 11 + depth * 16;
  const layerLines = (ancestors, own = null, ending = false) => ancestors.map(({ uid, depth }) =>
    `<span class="texture-layer-tree-line" data-layer-group-line="${escapeAttribute(uid)}" style="left:${layerLineX(depth)}px"></span>`).join('')
    + (own ? `<span class="texture-layer-tree-line ${ending ? 'ends-here' : 'starts-here'}" data-layer-group-line="${escapeAttribute(own.uid)}" style="left:${layerLineX(own.depth)}px"></span>` : '');
  const rows = layerTreeItems(asset.layers || []).map(({ layer, depth, ancestors, groupEnd }) => {
    if (groupEnd) return `<div class="texture-layer-group-end" data-layer-group-end="${escapeAttribute(groupEnd)}" style="--group-line-x:${layerLineX(depth)}px">
      ${layerLines(ancestors, { uid: groupEnd, depth }, true)}<span class="texture-layer-group-branch" data-layer-group-line="${escapeAttribute(groupEnd)}"></span></div>`;
    const group = layer.type === 'group';
    const uid = escapeAttribute(layer.uid);
    const visibilityLabel = layer.visible === false ? '顯示圖層' : '隱藏圖層';
    return `<div class="texture-layer-row ${group ? 'is-group' : ''} ${selected?.uid === layer.uid ? 'active' : ''}" style="--layer-depth:${depth}" data-layer-row="${uid}" title="拖動整行排序">
      ${layerLines(ancestors, group ? { uid: layer.uid, depth } : null)}
      <span class="texture-layer-grip" aria-hidden="true">⠿</span>
      ${group ? `<button type="button" class="texture-layer-disclosure" data-layer-toggle="${uid}" title="${layer.collapsed ? '展開組' : '折疊組'}" aria-label="${layer.collapsed ? '展開組' : '折疊組'}"><svg class="open-icon" data-icon-direction="${layer.collapsed ? 'right' : 'down'}" aria-hidden="true"><use href="#icon-open"></use></svg></button><svg class="texture-layer-folder-icon" aria-hidden="true"><use href="#icon-group"></use></svg><canvas class="texture-layer-thumb" width="27" height="27" aria-hidden="true"></canvas>`
        : '<span class="texture-layer-disclosure-spacer"></span><canvas class="texture-layer-thumb" width="27" height="27" aria-hidden="true"></canvas>'}
      <span class="texture-layer-name" title="${escapeAttribute(layer.name)}">${escapeHtml(layer.name)}</span>
      ${group ? `<button type="button" class="texture-layer-ungroup" data-layer-ungroup="${uid}" title="解散圖層組" aria-label="解散圖層組">×</button>` : ''}
      <button type="button" class="texture-layer-visibility ${layer.visible === false ? 'is-off' : ''}" data-layer-visible="${uid}" aria-label="${visibilityLabel}" title="${visibilityLabel}"><svg class="outliner-state-icon" aria-hidden="true"><use href="#${layer.visible === false ? 'icon-unshow' : 'icon-show'}"></use></svg></button></div>`;
  }).join('');
  root.innerHTML = `<label>貼圖模式 <select data-texture-mode><option value="default" ${!asset.mode || asset.mode === 'default' ? 'selected' : ''}>默認</option><option value="tiled" ${asset.mode === 'tiled' ? 'selected' : ''}>平鋪</option><option value="animation" ${asset.mode === 'animation' ? 'selected' : ''}>動畫（佔位）</option></select></label>
    ${asset.mode === 'animation' ? '<span>動畫邏輯待完善，目前顯示原始貼圖。</span>' : ''}
    <div class="texture-layer-control-strip"><button type="button" data-add-layer>＋ 圖層</button><button type="button" data-add-layer-group>＋ 組</button><button type="button" data-open-layer-editor title="編輯圖層" aria-label="編輯圖層"><svg class="object-icon" aria-hidden="true"><use href="#icon-setting"></use></svg></button></div>${rows}`;
  $$('[data-layer-row]', root).forEach(row => {
    const raster = layerEntryRaster(asset, row.dataset.layerRow);
    const canvas = row.querySelector('.texture-layer-thumb');
    if (!raster || !canvas) return;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    const scale = Math.min(canvas.width / raster.width, canvas.height / raster.height);
    const width = raster.width * scale, height = raster.height * scale;
    context.drawImage(raster, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  });
  $('[data-texture-mode]', root).addEventListener('change', event => {
    noteJournalOperation('core.texture.mode');
    asset.mode = event.target.value;
    uvEditorController.textureUvEntryCache = null;
    invalidateUvPreviewTextureState();
    rebuildTextureAtlas(); renderTextureFeatureControls(); renderTextureTileControls(); markDirty();
  });
  $('[data-add-layer]', root).addEventListener('click', () => addTextureLayer().catch(error => toast(error.message)));
  $('[data-add-layer-group]', root).addEventListener('click', () => addTextureLayerGroup().catch(error => toast(error.message)));
  $('[data-open-layer-editor]', root).addEventListener('click', layerEditor.open);
  $$('[data-layer-toggle]', root).forEach(button => button.addEventListener('click', () => {
    const group = asset.layers.find(layer => layer.uid === button.dataset.layerToggle);
    if (!group) return;
    group.collapsed = !group.collapsed;
    renderTextureFeatureControls();
  }));
  $$('[data-layer-ungroup]', root).forEach(button => button.addEventListener('click', () => mutate(() => {
    const group = asset.layers.find(layer => layer.uid === button.dataset.layerUngroup);
    if (!group) return;
    for (const child of asset.layers) if (child.parentUid === group.uid) child.parentUid = group.parentUid || null;
    asset.layers = asset.layers.filter(layer => layer.uid !== group.uid);
    if (asset.activeLayerUid === group.uid) asset.activeLayerUid = activeLayer(asset)?.uid || null;
  }).catch(error => toast(error.message))));
  const selectLayer = uid => {
    if (asset.activeLayerUid === uid) return;
    finishLayerEdit();
    asset.activeLayerUid = uid;
    showEditableLayer(asset);
    renderTextureFeatureControls();
    layerEditor.render();
  };
  $$('[data-layer-group-line]', root).forEach(line => line.addEventListener('click', event => {
    event.stopPropagation();
    selectLayer(line.dataset.layerGroupLine);
  }));
  $$('[data-layer-row]', root).forEach(row => row.addEventListener('click', event => {
    if (event.target.closest('[data-layer-visible],[data-layer-toggle],[data-layer-ungroup]')) return;
    selectLayer(row.dataset.layerRow);
  }));
  const mutate = async action => {
    pushTexturePaintHistory(asset, textureCanvas, null, 'core.texture.layer');
    action(); await refreshLayeredTexture(asset); renderTextureFeatureControls(); layerEditor.render();
  };
  $$('[data-layer-visible]', root).forEach(button => button.addEventListener('click', () => mutate(() => {
    const layer = asset.layers.find(entry => entry.uid === button.dataset.layerVisible);
    if (!layer) return;
    const visible = layer.visible === false;
    layer.visible = visible;
    if (layer.type === 'group') {
      const descendants = layerDescendantUids(asset.layers, layer.uid);
      for (const child of asset.layers) if (descendants.has(child.uid)) child.visible = visible;
    }
  }).catch(error => toast(error.message))));
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
  if (!asset?.source) return Promise.resolve(null);
  const source = asset.source;
  const cached = decodedTextureImages.get(asset);
  if (cached?.source === source) return cached.promise;
  const promise = new Promise(resolve => {
    const image = new Image();
    image.onload = () => {
      if (asset.source !== source && decodedTextureImages.get(asset)?.source === source)
        decodedTextureImages.delete(asset);
      resolve(asset.source === source ? image : null);
    };
    image.onerror = () => {
      if (decodedTextureImages.get(asset)?.source === source) decodedTextureImages.delete(asset);
      resolve(null);
    };
    image.src = source;
  });
  decodedTextureImages.set(asset, { source, promise });
  return promise;
}

function assignImportedTextureToBlankFaces(asset) {
  let assigned = 0;
  for (const cube of state.project.elements) {
    if (cube.type !== 'cube') continue;
    let cubeAssigned = false;
    for (const faceName of CUBE_FACES) {
      const face = cube.faces?.[faceName];
      // A null texture marks a deliberately culled face. Never restore it.
      if (face?.texture === null || face?.texture !== undefined && face.texture !== '') continue;
      cube.faces ||= {};
      cube.faces[faceName] = { ...face, texture: asset._uid };
      cubeAssigned = true;
      assigned++;
    }
    if (cubeAssigned) cube.autoUv = false;
  }
  if (assigned) {
    invalidateUvPreviewTextureState();
    invalidateAllRenderGeometry();
  }
  return assigned;
}

function copyTexture(asset = activeTextureAsset()) {
  if (!asset) return false;
  textureClipboard = { asset: structuredClone(asset), cut: false };
  toast(`已複製貼圖 ${asset.name}`);
  return true;
}

function removeTexture(asset = activeTextureAsset(), operation = 'core.texture.delete') {
  if (!asset) return false;
  if (operation) noteJournalOperation(operation);
  const previousAssets = [...state.textureAssets];
  const removedIndex = state.textureAssets.indexOf(asset);
  state.textureAssets = state.textureAssets.filter(entry => entry !== asset);
  remapNumericFaceTextureReferences(previousAssets);
  if (state.activeTextureUid === asset._uid) {
    const next = state.textureAssets[Math.min(removedIndex, state.textureAssets.length - 1)];
    state.activeTextureUid = next?._uid || null;
  }
  renderTextureList();
  if (state.textureAssets.length) activateProjectTexture(state.textureAssets.findIndex(entry => entry._uid === state.activeTextureUid));
  else renderTexture();
  rebuildTextureAtlas();
  markDirty();
  renderScene();
  return true;
}

function cutTexture(asset = activeTextureAsset()) {
  if (!asset) return false;
  noteJournalOperation('core.texture.cut');
  textureClipboard = { asset: structuredClone(asset), cut: true };
  const index = state.textureAssets.indexOf(asset);
  for (const element of state.project.elements) for (const face of Object.values(element.faces || {})) {
    if (face && String(face.texture).replace(/^#/, '') === String(index)) face.texture = asset._uid;
  }
  const removed = removeTexture(asset, null);
  if (removed) $('#textureList').focus({ preventScroll: true });
  return removed;
}

function pasteTexture({ inPlace = false } = {}) {
  const original = inPlace ? activeTextureAsset() : textureClipboard?.asset;
  if (!original) return false;
  noteJournalOperation(inPlace ? 'core.texture.duplicate' : 'core.texture.paste');
  const restoreCut = !inPlace && textureClipboard?.cut
    && !state.textureAssets.some(asset => asset._uid === original._uid);
  const id = restoreCut ? original._uid : textureUid();
  const asset = structuredClone(original);
  asset._uid = id;
  if (!restoreCut) { asset.uuid = id; asset.id = id; }
  asset.useAsDefault = false;
  if (!restoreCut) {
    const dot = asset.name?.lastIndexOf('.') ?? -1;
    asset.name = dot > 0 ? `${asset.name.slice(0, dot)}_copy${asset.name.slice(dot)}` : `${asset.name || 'texture'}_copy.png`;
  }
  const anchor = state.textureAssets.findIndex(entry => entry._uid === state.activeTextureUid);
  const index = inPlace && anchor >= 0 ? anchor + 1 : state.textureAssets.length;
  state.textureAssets.splice(index, 0, asset);
  if (restoreCut) textureClipboard.cut = false;
  state.activeTextureUid = asset._uid;
  renderTextureList();
  activateProjectTexture(index);
  rebuildTextureAtlas();
  markDirty();
  toast(`已${inPlace ? '原地複製' : '貼上'}貼圖 ${asset.name}`);
  return true;
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
  if (!/\.png$/i.test(file.name || '') || (file.type && file.type !== 'image/png')) {
    toast('目前只有 PNG 可以作為貼圖；其他圖片請導入為參考圖');
    return;
  }
  const revision = ++textureLoadRevision;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    if (revision !== textureLoadRevision) return;
    noteJournalOperation('core.texture.import');
    const asset = { _uid: textureUid(), name: file.name, source: url, uvWidth: image.naturalWidth, uvHeight: image.naturalHeight,
      kind: file.type.split('/')[1]?.toUpperCase() || 'IMAGE', groupId: null };
    decodedTextureImages.set(asset, { source: url, promise: Promise.resolve(image) });
    state.textureAssets.push(asset);
    state.activeTextureUid = asset._uid;
    const assignedFaces = assignImportedTextureToBlankFaces(asset);
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
    toast(`已導入貼圖 ${file.name}${assignedFaces ? `，填入 ${assignedFaces} 個空白面` : ''}`);
  };
  image.onerror = () => { URL.revokeObjectURL(url); toast('無法讀取這張圖片'); };
  image.src = url;
}

function loadTextureSource(source, name) {
  const revision = ++textureLoadRevision;
  const loaded = image => {
    if (revision !== textureLoadRevision) return;
    pendingTextureImage = null;
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const asset = activeTextureAsset();
    // Blockbench may declare UV coordinates in a smaller logical resolution
    // than the actual high-density PNG. Keep those declared units intact.
    if (asset) {
      const fallback = state.project.meta?.importedFrom === 'bbmodel' ? state.project.textureSize : null;
      asset.uvWidth ||= fallback?.[0] || width;
      asset.uvHeight ||= fallback?.[1] || height;
    }
    if (!asset?.layers?.length) updateLayerCompositePreview(asset, null);
    textureCanvas.width = width;
    textureCanvas.height = height;
    textureCtx.imageSmoothingEnabled = false;
    textureCtx.clearRect(0, 0, width, height);
    textureCtx.drawImage(image, 0, 0);
    textureCanvas.style.visibility = '';
    window.dispatchEvent(new Event('cubebricks:texture-change'));
    updateTexturePreviewFrame(asset?.uvWidth || width, asset?.uvHeight || height);
    const activeName = $('.texture-item.active strong');
    if (activeName) activeName.textContent = name;
    syncRendererTexture(textureCanvas);
    renderScene();
    renderTextureFeatureControls();
  };
  const failed = () => {
    if (revision !== textureLoadRevision) return;
    pendingTextureImage = null;
    textureCanvas.style.visibility = '';
    toast(`貼圖載入失敗：${name || '未命名貼圖'}`);
  };
  const asset = activeTextureAsset();
  if (asset?.source === source) {
    loadTextureAssetImage(asset).then(image => image ? loaded(image) : failed());
  } else {
    const image = new Image();
    pendingTextureImage = image;
    image.onload = () => loaded(image);
    image.onerror = failed;
    image.src = source;
  }
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
    // Keep the previous canvas or layer composite visible while this asset is
    // loading. Clearing either one here makes right-click texture switches
    // show an empty preview until the asynchronous decode finishes.
    textureCanvas.style.visibility = '';
  }
  if (asset.uvWidth && asset.uvHeight) updateTexturePreviewFrame(asset.uvWidth, asset.uvHeight);
  $$('.texture-item').forEach(item => item.classList.toggle('active', item.dataset.textureUid === asset._uid));
  renderTextureFeatureControls();
  if (asset.layers?.length) prepareLayers(asset).then(() => {
    if (state.activeTextureUid !== asset._uid || activationRevision !== textureLoadRevision) return;
    const composite = compositeLayers(asset);
    if (composite) { showLayerComposite(asset, composite); renderTextureFeatureControls(); }
  }).catch(error => toast(error.message));
  else loadTextureSource(asset.source, asset.name);
  scheduleTextureAnimation();
}

function invalidateUvPreviewTextureState() {
  // Preview cubes copy their face records. Regenerate those copies whenever
  // template creation replaces UV rectangles or texture assignments.
  uvPreviewController.uvPreviewProjectCache = null;
  uvEditorController.textureUvEntryCache = null;
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
  textureUid, renderTextureList, addTextureGroup, updateLayerCompositePreview, renderTextureTileControls, refreshDerivedTileEntries, scheduleTextureAnimation, textureAssetForReference, isFaceTiled, remapNumericFaceTextureReferences, loadTextureAssetImage, createSimpleTexture, updateTextureCreateDialog, openTextureCreateDialog, importTexture, loadTextureSource, installProjectTextures, activateProjectTexture, invalidateUvPreviewTextureState,
  copyTexture, cutTexture, pasteTexture, removeTexture
};
}
