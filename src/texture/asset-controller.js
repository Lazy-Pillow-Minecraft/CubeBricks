import { activeLayer, compositeLayers, createLayerGroup, imageCanvas, insertLayerNearSelection, layerDescendantUids, layerEntryRaster, layerRasterCache, layerTreeItems, loadRaster, normalizeTextureLayers, prepareLayers, releaseLayerRaster, releaseTextureRasters, selectedLayerEntry, tiledFaceRaster } from '../common/core/texture-features.js';
import { formatRules } from '../common/core/format-constraints.js';
import { createLayerDragBinder } from './layer-drag.js';
import { createLayerEditorDialog } from './layer-editor-dialog.js';
import { tonePaletteSnapshot } from './tone-palette.js';
import { faceTilingValues, setFaceTilingCoordinate } from '../common/core/face-tiling.js';
import { migrateTextureAnimationMode, createTextureFrameElement, textureFrameElements } from './frame-elements.js';
import { createTextureFrameList } from './frame-list-controller.js';
import { createFrameConnections } from './frame-connections-controller.js';
import { activeTextureFrame, frameLayerUids, framePaintLayer, frameVisibilityControls, rememberFramePaintLayer, setFrameLayerLink, setFrameLayerVisibility } from '../common/core/frame-links.js';
import { createFramePlayback } from './frame-playback-controller.js';
import { readCompanionAnimation, splitTextureAnimation } from './animation-import.js';
import { boundPaintLayer, paintCanvasIsBound, rememberEditablePaintSource } from '../paint/canvas-layer-binding.js';
import { isolateTextureLayerIds, reidentifyTextureLayers } from '../common/core/texture-layer-identity.js';
import { createLayerCommands } from './layer-commands.js';
import { decodedRasterImage } from '../utils/image/raster-cache.js';

const CUBE_FACES = ['north', 'east', 'south', 'west', 'up', 'down'];
const TEXTURE_MODE_LABEL = '貼圖模式';
const TEXTURE_MODES = [['default', '默認'], ['tiled', '平鋪']];
let textureClipboard = null;
let textureCopyRevision = 0;
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
  updateTexturePreviewFrame, syncRendererTexture, syncRendererTextureAsset, getAllTextureAssets, texturePlaybackKey, selectedElementUids,
  activeSnapSubdivisions, renderTexture,
  paletteRows, samplePaletteGradient,
  noteJournalOperation, snapshot, markDirty, toast, formatNumber, clamp, showContextMenu, textureSaveIndicators
}) {
  let textureLoadRevision = 0;
  let pendingTextureImage = null;
  const layerRefreshRevision = new WeakMap();
  let tiledEntryIndexSource = null;
  let tiledEntryIndex = new Map();
  const bindLayerDrag = createLayerDragBinder({
    activeTextureAsset, textureCanvas, pushTexturePaintHistory,
    refreshLayeredTexture, renderTextureFeatureControls, toast
  });
  let layerEditSession = null;
  let paletteRefreshTimer = null;
  const frameConnections = createFrameConnections({
    $, activeTextureAsset, noteJournalOperation, markDirty,
    onChange: refreshFrameDisplay, onSelectFrame: uid => frameList.select(uid)
  });
  const frameList = createTextureFrameList({
    $, activeTextureAsset, noteJournalOperation, markDirty, showContextMenu,
    onSelect: frameConnections.selectFrame, onChange: refreshFrameDisplay
  });
  const framePlayback = createFramePlayback({ $, state, activeTextureAsset, getAllTextureAssets, texturePlaybackKey, onChange: refreshFrameDisplay });
  window.addEventListener('cubebricks:paint-canvas-released', event => {
    if (event.detail === textureCanvas && activeTextureAsset()?.animation?.enabled) showEditableLayer(activeTextureAsset());
  });
  const layerEditor = createLayerEditorDialog({
    $, activeTextureAsset, toast, paletteRows, samplePaletteGradient,
    getCompositeSource(asset) {
      if (layerEditSession?.asset === asset) return null;
      const cached = animationRasterCache.get(asset?._uid);
      return cached?.source === asset?.source ? cached.canvas : null;
    },
    onRender() {
      frameList.render();
      frameConnections.render();
      updateFrameLayerIndicators();
    },
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
    onClose() {
      finishLayerEdit();
      updateFrameLayerIndicators();
    }
  });
  const layerCommands = createLayerCommands({
    state, activeTextureAsset, textureCanvas, finishLayerEdit,
    pushTexturePaintHistory, refreshLayeredTexture, root: $('#textureFeatureControls'), toast,
    onChange(uid) {
      frameConnections.selectLayer(uid);
      renderTextureFeatureControls();
      layerEditor.render();
    }
  });

  function finishLayerEdit() {
    const session = layerEditSession;
    if (!session) return;
    layerEditSession = null;
    return refreshLayeredTexture(session.asset).then(() => {
      renderTextureFeatureControls();
      layerEditor.render();
    }).catch(error => toast(error.message));
  }

  function syncToneMappedPalettes() {
    if (paletteRefreshTimer !== null) clearTimeout(paletteRefreshTimer);
    paletteRefreshTimer = setTimeout(() => {
      paletteRefreshTimer = null;
      for (const asset of state.textureAssets) {
        let changed = false;
        for (const layer of asset.layers || []) {
          if (layer.blendMode !== 'tone_map' || !layer.toneMap?.paletteId) continue;
          const row = paletteRows.find(entry => entry.id === layer.toneMap.paletteId);
          const current = tonePaletteSnapshot(row, samplePaletteGradient);
          if (!current) continue; // Keep the saved colors when a local palette is unavailable.
          if (layer.toneMap.paletteType === current.paletteType
            && JSON.stringify(layer.toneMap.paletteSamples) === JSON.stringify(current.paletteSamples)) continue;
          if (!changed) pushTexturePaintHistory(asset, textureCanvas, null, 'core.texture.layer');
          Object.assign(layer.toneMap, { paletteType: current.paletteType, paletteSamples: current.paletteSamples });
          changed = true;
        }
        if (changed) refreshLayeredTexture(asset).catch(error => toast(error.message));
      }
      layerEditor.render();
    }, 80);
  }

  function textureUid(asset = {}) {
    return asset._uid || asset.uuid || asset.id || `texture_${crypto.randomUUID()}`;
  }

  function textureItemMarkup(asset, index) {
    return `<button class="texture-item ${asset._uid === state.activeTextureUid ? 'active' : ''}" draggable="true"
      data-texture-uid="${escapeAttribute(asset._uid)}" data-texture-index="${index}">
    <span class="texture-thumb" style="background-image:url(&quot;${escapeAttribute(asset.source || '')}&quot;);background-size:cover;image-rendering:pixelated"></span>
    <span><strong>${escapeHtml(asset.name || `texture_${index + 1}.png`)}</strong><small>${asset.uvWidth || '?'} × ${asset.uvHeight || '?'} · ${asset.kind || 'IMAGE'}</small></span>
    <span class="texture-save-action" role="button" tabindex="0" data-save-texture="${escapeAttribute(asset._uid)}" title="保存贴图" aria-label="保存贴图" ${textureSaveIndicators?.isDirty(asset) === false ? 'hidden' : ''}></span>
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
    textureSaveIndicators?.refresh({ paint: true });
  }

  function updateLayerCompositePreview(asset, canvas, dirty = null, floating = false) {
    if (asset && asset._uid !== state.activeTextureUid) return;
    const preview = $('#textureLayerComposite');
    const showComposite = Boolean((floating || asset?.layers?.length || asset?.animation?.enabled && activeTextureFrame(asset)) && canvas?.width && canvas?.height);
    preview.hidden = !showComposite;
    textureCanvas.style.opacity = showComposite ? '0' : '';
    if (!asset) textureCanvas.style.visibility = '';
    if (showComposite) {
      const patch = dirty && preview.width === canvas.width && preview.height === canvas.height;
      if (!patch) {
        preview.width = canvas.width;
        preview.height = canvas.height;
      }
      const context = preview.getContext('2d');
      context.imageSmoothingEnabled = false;
      if (patch) {
        context.clearRect(dirty.x, dirty.y, dirty.width, dirty.height);
        context.drawImage(canvas, dirty.x, dirty.y, dirty.width, dirty.height,
          dirty.x, dirty.y, dirty.width, dirty.height);
      } else {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(canvas, 0, 0);
      }
    }
  }

  function selectedTilingFaces() {
    const asset = activeTextureAsset();
    if (asset?.mode !== 'tiled') return [];
    const targets = [];
    for (const key of state.selectedUvFaces) {
      const parsed = parseUvFaceKey(key);
      const cube = parsed && state.project.getNode(parsed.uid);
      if (cube?.type === 'cube' && textureAssetForReference(cube.faces?.[parsed.faceName]?.texture) === asset)
        targets.push({ cube, faceName: parsed.faceName });
    }
    if (!targets.length) {
      const data = selectedUvFaceData(false);
      if (data?.cube && state.uvPreviewSelectedFace?.faceName && textureAssetForReference(data.face?.texture) === asset)
        targets.push({ cube: data.cube, faceName: state.uvPreviewSelectedFace.faceName });
    }
    return targets;
  }

  function renderTextureTileControls() {
    uvEditorController.updateTextureUvFields();
  }

  function setTilingCoordinate(coordinate, value) {
    if (activeTextureAsset()?.mode !== 'tiled') return false;
    if (!Number.isInteger(coordinate) || coordinate < 0 || coordinate > 3 || !Number.isFinite(value)) return true;
    const next = coordinate >= 2 ? Math.max(.0001, value) : value;
    const targets = selectedTilingFaces().filter(({ cube, faceName }) =>
      faceTilingValues(cube.faces?.[faceName])[coordinate] !== next);
    if (!targets.length) return true;
    snapshot('core.uv.tiling');
    for (const { cube, faceName } of targets) {
      setFaceTilingCoordinate(ensureCubeFaceRecord(cube, faceName), coordinate, next);
      persistGeneratedPaintCube(cube);
    }
    uvPreviewController.uvPreviewProjectCache = null;
    uvEditorController.textureUvEntryCache = null;
    uvPreviewController.uvPreviewRenderDirty = true;
    rebuildTextureAtlas();
    markDirty();
    renderTextureTileControls();
    return true;
  }

  function refreshDerivedTileEntries(asset, source) {
    const atlasEntries = getTextureAtlasEntries();
    if (atlasEntries !== tiledEntryIndexSource) {
      tiledEntryIndexSource = atlasEntries;
      tiledEntryIndex = new Map();
      for (const entry of atlasEntries) {
        if (!entry.tileSourceUid || !entry.tileCube) continue;
        if (!tiledEntryIndex.has(entry.tileSourceUid)) tiledEntryIndex.set(entry.tileSourceUid, []);
        tiledEntryIndex.get(entry.tileSourceUid).push(entry);
      }
    }
    const entries = tiledEntryIndex.get(asset._uid) || [];
    if (!entries.length) return;
    const sourceCanvas = typeof source.getContext === 'function' ? source : imageCanvas(source);
    const sourcePixels = sourceCanvas.getContext('2d').getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    for (const entry of entries) {
      const canvas = tiledFaceRaster(entry.tileCube, entry.tileFaceName, sourceCanvas, entry.tileRegion, null, sourcePixels);
      if (canvas.width !== entry.width || canvas.height !== entry.height) {
        rebuildTextureAtlas();
        continue;
      }
      drawTextureAtlasEntry(canvas, entry);
      const patch = textureAtlasPatch(entry);
      sceneRenderer.updateTextureAtlasRegion(patch, entry.x - 1, entry.y - 1);
      if (uvPreviewIsActive()) uvPreviewRenderer.updateTextureAtlasRegion(patch, entry.x - 1, entry.y - 1);
      else uvPreviewController.uvPreviewTextureDirty = true;
    }
  }

  function scheduleTextureAnimation() {
    // Frame selection changes membership; timed playback is not started here.
  }

  function refreshFrameDisplay({ asset = activeTextureAsset(), playback = false, frameChanged = true } = {}) {
    if (asset && asset !== activeTextureAsset()) {
      const cache = animationRasterCache.get(asset._uid), source = cache?.source === asset.source ? cache.canvas : compositeLayers(asset);
      if (source) syncRendererTextureAsset(asset, source, true);
      return;
    }
    if (asset?.animation?.enabled && frameChanged) {
      asset.activeLayerUid = framePaintLayer(asset)?.uid || null;
      if (asset.activeLayerUid) rememberFramePaintLayer(asset, asset.activeLayerUid);
      showEditableLayer(asset);
    }
    const existing = asset && animationRasterCache.get(asset._uid);
    if (playback && existing?.source === asset.source) { syncRendererTexture(existing.canvas, true); }
    else if (asset?.layers?.length) {
      const composite = compositeLayers(asset);
      if (composite) showLayerComposite(asset, composite);
    }
    else if (asset) {
      const cached = animationRasterCache.get(asset._uid);
      syncRendererTexture(cached?.source === asset.source ? cached.canvas : textureCanvas, true);
    }
    if (!playback) renderTextureFeatureControls();
    else if (frameChanged) updateFrameLayerIndicators();
    if (!playback || frameChanged) {
      layerEditor.render();
      frameConnections.render();
    }
    else layerEditor.refreshPreview();
    framePlayback.render();
  }

  function updateFrameLayerIndicators() {
    const asset = activeTextureAsset(), root = $('#textureFeatureControls');
    if (!asset) return;
    const enabled = asset.animation?.enabled, frame = activeTextureFrame(asset), members = enabled ? frameLayerUids(asset) : new Set();
    const local = enabled && layerEditor.isOpen ? frameVisibilityControls(asset) : new Set();
    const paintUid = enabled ? framePaintLayer(asset)?.uid : asset.activeLayerUid;
    for (const row of root.querySelectorAll('[data-layer-row]')) {
      const layer = asset.layers.find(entry => entry.uid === row.dataset.layerRow);
      if (!layer) continue;
      row.classList.toggle('frame-member', members.has(layer.uid));
      const selected = layer.type === 'group' ? asset.activeLayerUid === layer.uid : paintUid === layer.uid;
      row.classList.toggle('active', selected);
      const slot = row.querySelector('[data-layer-visibility-slot]');
      const visible = enabled ? frame?.visibility?.[layer.uid] !== false : layer.visible !== false;
      const show = !enabled || local.has(layer.uid);
      const key = show ? `${enabled}:${visible}` : 'hidden';
      if (slot.dataset.state === key) continue;
      slot.dataset.state = key;
      slot.innerHTML = show ? `<button type="button" class="texture-layer-visibility ${enabled ? 'frame-local ' : ''}${visible ? '' : 'is-off'}" data-layer-visible="${escapeAttribute(layer.uid)}" title="${visible ? '隱藏圖層' : '顯示圖層'}" aria-label="${visible ? '隱藏圖層' : '顯示圖層'}"><svg class="outliner-state-icon" aria-hidden="true"><use href="#${visible ? 'icon-show' : 'icon-unshow'}"></use></svg></button>` : '';
    }
  }
  $('#textureFeatureControls').addEventListener('click', event => {
    const button = event.target.closest('[data-layer-visible]'), asset = activeTextureAsset();
    if (!button || !asset) return;
    const layer = asset.layers.find(entry => entry.uid === button.dataset.layerVisible);
    if (!layer) return;
    if (asset.animation?.enabled) {
      noteJournalOperation('core.texture.frame.visibility');
      if (setFrameLayerVisibility(asset, layer.uid, activeTextureFrame(asset)?.visibility?.[layer.uid] === false)) {
        markDirty();
        refreshFrameDisplay();
      }
    } else {
      pushTexturePaintHistory(asset, textureCanvas, null, 'core.texture.layer');
      const visible = layer.visible === false;
      layer.visible = visible;
      if (layer.type === 'group') {
        const children = layerDescendantUids(asset.layers, layer.uid);
        for (const child of asset.layers) if (children.has(child.uid)) child.visible = visible;
      }
      refreshLayeredTexture(asset).catch(error => toast(error.message));
    }
  });

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
      if (layerRefreshRevision.get(asset) !== revision || !state.textureAssets.includes(asset)) return;
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
    syncRendererTexture(canvas, true);
    window.dispatchEvent(new Event('cubebricks:texture-change'));
    renderScene();
  }

  function showEditableLayer(asset, fallback = null) {
    if (paintCanvasIsBound(textureCanvas)) return;
    const layer = activeLayer(asset), raster = layerRasterCache.get(layer?.uid);
    const editable = raster?.savedSource === layer?.source ? raster?.canvas : null;
    if (!editable && !fallback) return;
    textureCanvas.width = editable?.width || fallback.width;
    textureCanvas.height = editable?.height || fallback.height;
    textureCtx.imageSmoothingEnabled = false;
    textureCtx.clearRect(0, 0, textureCanvas.width, textureCanvas.height);
    if (editable) textureCtx.drawImage(editable, 0, 0);
    if (editable) rememberEditablePaintSource(asset, textureCanvas, layer);
  }

  function discardMissingLayerMasks(asset) {
    const remaining = new Set(asset.layers.map(layer => layer.uid));
    for (const layer of asset.layers) if (layer.maskLayerUid && !remaining.has(layer.maskLayerUid)) layer.maskLayerUid = null;
  }

  async function ensureTextureLayers(asset) {
    if (asset.layers?.length) return;
    const raster = await loadRaster(asset.source);
    asset.uvWidth ||= raster.width;
    asset.uvHeight ||= raster.height;
    asset.layers = [{
      uid: crypto.randomUUID(),
      name: '底圖',
      source: raster.toDataURL('image/png'),
      visible: true,
      opacity: 100,
      blendMode: 'normal'
    }];
    asset.activeLayerUid = asset.layers[0].uid;
  }

  async function addTextureLayer() {
    const asset = activeTextureAsset();
    if (!asset) return toast('請先建立或導入貼圖');
    pushTexturePaintHistory(asset, textureCanvas, null, 'core.texture.layer');
    await ensureTextureLayers(asset);
    await prepareLayers(asset);
    const canvas = document.createElement('canvas');
    canvas.width = textureCanvas.width;
    canvas.height = textureCanvas.height;
    const count = asset.layers.filter(entry => entry.type !== 'group').length + 1;
    const layer = {
      uid: crypto.randomUUID(),
      name: `圖層 ${count}`,
      source: canvas.toDataURL('image/png'),
      visible: true,
      opacity: 100,
      blendMode: 'normal'
    };
    layerRasterCache.set(layer.uid, { canvas, savedSource: layer.source });
    asset.layers = insertLayerNearSelection(asset.layers, layer, asset.activeLayerUid);
    asset.activeLayerUid = layer.uid;
    await refreshLayeredTexture(asset);
    renderTextureFeatureControls();
  }

  async function moveSelectionToLayer(asset, sourceLayer, remaining, pixels) {
    const remainingSource = remaining.toDataURL('image/png');
    const pixelSource = pixels.toDataURL('image/png');
    if (!sourceLayer) {
      sourceLayer = { uid: crypto.randomUUID(), name: '底圖', visible: true, opacity: 100, blendMode: 'normal' };
      asset.layers = [sourceLayer];
    }
    sourceLayer.source = remainingSource;
    layerRasterCache.set(sourceLayer.uid, { canvas: remaining, savedSource: sourceLayer.source });
    const count = asset.layers.filter(entry => entry.type !== 'group').length + 1;
    const layer = {
      uid: crypto.randomUUID(), name: `圖層 ${count}`, source: pixelSource,
      visible: true, opacity: 100, blendMode: 'normal'
    };
    layerRasterCache.set(layer.uid, { canvas: pixels, savedSource: layer.source });
    asset.layers = insertLayerNearSelection(asset.layers, layer, sourceLayer.uid);
    asset.activeLayerUid = layer.uid;
    if (asset.animation?.enabled) {
      const frame = activeTextureFrame(asset);
      if (frame && !frameLayerUids(asset, frame).has(layer.uid)) setFrameLayerLink(asset, frame.uid, layer.uid, true);
      rememberFramePaintLayer(asset, layer.uid);
    }
    await refreshLayeredTexture(asset);
    if (asset === activeTextureAsset()) renderTextureFeatureControls();
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

  function renderTextureFeatureControls() {
    const root = $('#textureFeatureControls'), asset = activeTextureAsset();
    bindLayerDrag(root);
    if (!asset) {
      root.style.removeProperty('--layer-tree-min-width');
      root.innerHTML = '<span>請先選擇貼圖</span>';
      framePlayback.render();
      layerEditor.render();
      return;
    }
    migrateTextureAnimationMode(asset);
    const selected = selectedLayerEntry(asset);
    const layerLineX = depth => 11 + depth * 16;
    const groupStarts = new Map(), groupRails = [];
    let treeY = 0, treeMinWidth = 220;
    const rows = layerTreeItems(asset.layers || []).map(({ layer, depth, groupEnd }) => {
      if (groupEnd) {
        const start = groupStarts.get(groupEnd);
        if (start) groupRails.push({ uid: groupEnd, depth, top: start.top + 40.5, bottom: treeY + 7 });
        treeY += 14;
        return `<div class="texture-layer-group-end" data-layer-group-end="${escapeAttribute(groupEnd)}"></div>`;
      }
      const group = layer.type === 'group';
      treeMinWidth = Math.max(treeMinWidth, 220 + depth * 16);
      if (group) groupStarts.set(layer.uid, { top: treeY });
      treeY += 42;
      const uid = escapeAttribute(layer.uid);
      const visibilityLabel = layer.visible === false ? '顯示圖層' : '隱藏圖層';
      return `<div class="texture-layer-row ${group ? 'is-group' : ''} ${selected?.uid === layer.uid ? 'active' : ''}" style="--layer-depth:${depth}" data-layer-row="${uid}" title="拖動整行排序">
      <span class="texture-layer-grip" aria-hidden="true">⠿</span>
      ${group ? `<button type="button" class="texture-layer-disclosure" data-layer-toggle="${uid}" title="${layer.collapsed ? '展開組' : '折疊組'}" aria-label="${layer.collapsed ? '展開組' : '折疊組'}"><svg class="open-icon" data-icon-direction="${layer.collapsed ? 'right' : 'down'}" aria-hidden="true"><use href="#icon-open"></use></svg></button><svg class="texture-layer-folder-icon" aria-hidden="true"><use href="#icon-group"></use></svg><canvas class="texture-layer-thumb" width="27" height="27" aria-hidden="true"></canvas>`
          : '<span class="texture-layer-disclosure-spacer"></span><canvas class="texture-layer-thumb" width="27" height="27" aria-hidden="true"></canvas>'}
      <span class="texture-layer-name" title="${escapeAttribute(layer.name)}">${escapeHtml(layer.name)}</span>
      ${group ? `<button type="button" class="texture-layer-ungroup" data-layer-ungroup="${uid}" title="解散圖層組" aria-label="解散圖層組">×</button>` : ''}
      <span class="texture-layer-visibility-slot" data-layer-visibility-slot></span></div>`;
    }).join('');
    const rails = groupRails.map(({ uid, depth, top, bottom }) => `<span class="texture-layer-group-rail"
    data-layer-group-line="${escapeAttribute(uid)}" style="left:${layerLineX(depth)}px;top:${top}px;height:${Math.max(0, bottom - top)}px"><span class="texture-layer-group-rail-branch"></span></span>`).join('');
    root.style.setProperty('--layer-tree-min-width', `${treeMinWidth}px`);
    root.innerHTML = `<div class="texture-layer-panel-header">
    <label class="texture-layer-mode-row">${TEXTURE_MODE_LABEL} <select data-texture-mode>${TEXTURE_MODES.map(([mode, label]) => `<option value="${mode}" ${(asset.mode || 'default') === mode ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <label class="texture-animation-toggle"><input type="checkbox" data-texture-animation ${asset.animation?.enabled ? 'checked' : ''}>手翻書</label>
    ${asset.animation?.enabled ? `<div class="texture-animation-options"><label>FPS <input type="number" data-frame-fps min="0.1" max="240" step="0.1" value="${Number(asset.animation.fps) || 20}"></label><label><input type="checkbox" data-frame-interpolate ${asset.animation.interpolate ? 'checked' : ''}>幀漸變</label></div>` : ''}
    <div class="texture-layer-control-strip"><button type="button" data-add-layer>＋ 圖層</button><button type="button" data-add-layer-group>＋ 組</button><button type="button" data-open-layer-editor title="編輯圖層" aria-label="編輯圖層"><svg class="object-icon" aria-hidden="true"><use href="#icon-setting"></use></svg></button></div>
    </div><div class="texture-layer-tree">${rows}${rails}<span class="texture-layer-drop-guide" hidden></span></div>`;
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
      if (!['default', 'tiled'].includes(event.target.value)
        || (asset.mode || 'default') === event.target.value) return;
      noteJournalOperation('core.texture.mode');
      asset.mode = event.target.value;
      uvEditorController.textureUvEntryCache = null;
      uvPreviewController.uvPreviewProjectCache = null;
      uvPreviewController.uvPreviewTextureDirty = true;
      uvPreviewController.uvPreviewRenderDirty = true;
      uvPreviewRenderer.invalidateGeometry();
      rebuildTextureAtlas();
      renderTextureFeatureControls();
      renderTextureTileControls();
      markDirty();
    });
    $('[data-texture-animation]', root).addEventListener('change', event => {
      noteJournalOperation('core.texture.animation');
      asset.animation = { ...asset.animation, enabled: event.target.checked };
      markDirty();
      refreshFrameDisplay();
      frameList.render();
      frameConnections.render();
    });
    $('[data-frame-fps]', root)?.addEventListener('change', event => {
      noteJournalOperation('core.texture.animation.settings');
      asset.animation = { ...asset.animation, fps: Math.max(.1, Math.min(240, Number(event.target.value) || 20)) };
      markDirty();
      framePlayback.render();
    });
    $('[data-frame-interpolate]', root)?.addEventListener('change', event => {
      noteJournalOperation('core.texture.animation.settings');
      asset.animation = { ...asset.animation, interpolate: event.target.checked };
      markDirty();
      refreshFrameDisplay();
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
      discardMissingLayerMasks(asset);
      if (asset.activeLayerUid === group.uid) asset.activeLayerUid = activeLayer(asset)?.uid || null;
    }).catch(error => toast(error.message))));
    const selectLayer = uid => {
      root.focus({ preventScroll: true });
      frameConnections.selectLayer(uid);
      if (asset.activeLayerUid === uid) return;
      finishLayerEdit();
      asset.activeLayerUid = uid;
      if (asset.animation?.enabled && rememberFramePaintLayer(asset, uid)) {
        noteJournalOperation('core.texture.frame.paint_layer');
        markDirty();
      }
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
      action();
      await refreshLayeredTexture(asset);
      renderTextureFeatureControls();
      layerEditor.render();
    };
    $$('[data-layer-opacity]', root).forEach(input => input.addEventListener('change', () => mutate(() => {
      asset.layers.find(layer => layer.uid === input.dataset.layerOpacity).opacity = clamp(Number(input.value), 0, 100);
    })));
    $$('[data-layer-up], [data-layer-down]', root).forEach(button => button.addEventListener('click', () => mutate(() => {
      const index = Number(button.dataset.layerUp ?? button.dataset.layerDown), next = index + (button.dataset.layerUp !== undefined ? 1 : -1);
      [asset.layers[index], asset.layers[next]] = [asset.layers[next], asset.layers[index]];
    })));
    $$('[data-layer-delete]', root).forEach(button => button.addEventListener('click', () => mutate(() => {
      asset.layers = asset.layers.filter(layer => layer.uid !== button.dataset.layerDelete);
      discardMissingLayerMasks(asset);
      asset.activeLayerUid = activeLayer(asset)?.uid;
    })));
    updateFrameLayerIndicators();
    framePlayback.render();
    layerEditor.render();
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
    const promise = decodedRasterImage(source).then(image => asset.source === source ? image : null, () => null);
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

  async function copyTexture(asset = activeTextureAsset()) {
    if (!asset) return false;
    const revision = ++textureCopyRevision;
    textureClipboard = { asset: structuredClone(asset), cut: false };
    try {
      if (layerEditSession?.asset === asset) await finishLayerEdit();
      if (asset.layers?.length) await prepareLayers(asset);
      if (revision !== textureCopyRevision) return false;
      const liveLayer = asset === activeTextureAsset() ? boundPaintLayer(asset, textureCanvas) : null;
      const canvas = asset.layers?.length
        ? compositeLayers(asset, liveLayer ? textureCanvas : null, null, null, null, liveLayer?.uid)
        : await loadRaster(asset.source);
      if (!canvas) throw new Error('無法合成貼圖');
      const png = canvas.toDataURL('image/png');
      if (revision !== textureCopyRevision) return false;
      const copied = structuredClone(asset);
      copied.source = png;
      if (liveLayer) {
        const layer = copied.layers.find(entry => entry.uid === liveLayer.uid);
        if (layer) layer.source = textureCanvas.toDataURL('image/png');
      }
      textureClipboard.asset = copied;
      if (window.cubeBricksDesktop?.copyCaptureImage) await window.cubeBricksDesktop.copyCaptureImage(png);
      else if (navigator.clipboard?.write) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('無法產生 PNG 圖片');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      } else throw new Error('目前無法寫入系統剪切板');
    } catch (error) {
      if (revision !== textureCopyRevision) return false;
      toast(`已在軟件內複製貼圖，但無法寫入系統剪切板：${error.message}`);
      return true;
    }
    if (revision !== textureCopyRevision) return false;
    toast(`已複製貼圖 ${asset.name}，並放入系統剪切板`);
    return true;
  }

  function releaseTextureAssets(assets, retained = []) {
    const retainedUids = new Set(retained.map(asset => asset._uid));
    for (const asset of assets) {
      releaseTextureRasters(asset, retained);
      if (retained.includes(asset)) continue;
      framePlayback.release(asset);
      if (!retainedUids.has(asset._uid)) {
        livePaintTextureSources.delete(asset._uid);
        animationRasterCache.delete(asset._uid);
      }
    }
  }

  function removeTexture(asset = activeTextureAsset(), operation = 'core.texture.delete') {
    if (!asset) return false;
    if (operation) noteJournalOperation(operation);
    const previousAssets = [...state.textureAssets];
    const removedIndex = state.textureAssets.indexOf(asset);
    state.textureAssets = state.textureAssets.filter(entry => entry !== asset);
    releaseTextureAssets([asset], (getAllTextureAssets?.() || state.textureAssets).filter(entry => entry !== asset));
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

  async function removeTextureLayer(uid) {
    const asset = activeTextureAsset();
    const selected = asset?.layers?.find(layer => layer.uid === uid);
    if (!asset || !selected) return false;
    await finishLayerEdit();
    pushTexturePaintHistory(asset, textureCanvas, null, 'core.texture.layer');
    const removed = selected.type === 'group'
      ? new Set([selected.uid, ...layerDescendantUids(asset.layers, selected.uid)])
      : new Set([selected.uid]);
    asset.layers = asset.layers.filter(layer => !removed.has(layer.uid));
    for (const removedUid of removed) releaseLayerRaster(removedUid);
    discardMissingLayerMasks(asset);
    if (!asset.layers.some(layer => layer.type !== 'group')) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, asset.uvWidth || textureCanvas.width);
      canvas.height = Math.max(1, asset.uvHeight || textureCanvas.height);
      const replacement = {
        uid: crypto.randomUUID(), name: '底圖', source: canvas.toDataURL('image/png'),
        visible: true, opacity: 100, blendMode: 'normal'
      };
      layerRasterCache.set(replacement.uid, { canvas, savedSource: replacement.source });
      asset.layers.push(replacement);
    }
    asset.activeLayerUid = activeLayer(asset)?.uid || null;
    await refreshLayeredTexture(asset);
    renderTextureFeatureControls();
    layerEditor.render();
    return true;
  }

  function removeActiveLayer() {
    return removeTextureLayer(selectedLayerEntry(activeTextureAsset())?.uid);
  }

  async function mergeTextureLayerDown(uid) {
    const asset = activeTextureAsset();
    const upper = asset?.layers?.find(layer => layer.uid === uid);
    if (!upper) return false;
    const parent = upper.parentUid || null;
    const siblings = asset.layers.filter(layer => (layer.parentUid || null) === parent);
    const lower = siblings[siblings.indexOf(upper) - 1];
    if (!lower) return false;
    await finishLayerEdit();
    await prepareLayers(asset);
    const removed = new Set([upper.uid, lower.uid,
    ...layerDescendantUids(asset.layers, upper.uid), ...layerDescendantUids(asset.layers, lower.uid)]);
    const shadow = {
      ...asset, layers: asset.layers.map(layer => ({
        ...layer,
        parentUid: layer.uid === upper.uid || layer.uid === lower.uid ? null : layer.parentUid,
        visible: removed.has(layer.uid) ? layer.visible : false
      }))
    };
    const merged = compositeLayers(shadow);
    if (!merged) return false;
    pushTexturePaintHistory(asset, textureCanvas, null, 'core.texture.layer');
    const source = merged.toDataURL('image/png');
    asset.layers = asset.layers.filter(layer => !removed.has(layer.uid) || layer.uid === lower.uid);
    for (const removedUid of removed) if (removedUid !== lower.uid) releaseLayerRaster(removedUid);
    Object.assign(lower, {
      type: 'layer', source, visible: true, opacity: 100,
      blendMode: 'normal', maskLayerUid: null, toneMap: null
    });
    layerRasterCache.set(lower.uid, { canvas: merged, savedSource: source });
    discardMissingLayerMasks(asset);
    asset.activeLayerUid = lower.uid;
    await refreshLayeredTexture(asset);
    renderTextureFeatureControls();
    layerEditor.render();
    return true;
  }

  function cutTexture(asset = activeTextureAsset()) {
    if (!asset) return false;
    ++textureCopyRevision;
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
    if (!restoreCut) reidentifyTextureLayers(asset);
    if (!restoreCut && textureFrameElements(asset).length) {
      const previous = asset.animation.selectedFrameUid;
      const mapped = new Map();
      asset.animation.frames = textureFrameElements(asset).map(frame => {
        const next = createTextureFrameElement([], frame);
        mapped.set(frame.uid, next.uid);
        return next;
      });
      if (previous) asset.animation.selectedFrameUid = mapped.get(previous) || null;
    }
    asset._uid = id;
    if (!restoreCut) {
      asset.uuid = id;
      asset.id = id;
    }
    if (!restoreCut) delete asset.externalFile;
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
    $('#textureTemplateBoxUv').checked = Boolean(rules.moddedEntity);
    $('#textureTemplateBoxUv').disabled = !rules.allowBoxUv || !rules.allowFaceUv;
    $('#textureTemplateBoxUv').closest('label').hidden = !rules.allowBoxUv || !rules.allowFaceUv;
    $('#textureTemplateSelectedOnly').checked = false;
    $('#textureTemplateKeepMulti').checked = true;
    $('#textureTemplateKeepLayers').checked = true;
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
    const metadata = readCompanionAnimation(file).catch(error => {
      toast(`動畫配置讀取失敗：${error.message}`);
      return null;
    });
    image.onload = async () => {
      const configuration = await metadata;
      if (revision !== textureLoadRevision) return;
      let animation = null;
      try { animation = splitTextureAnimation(image, configuration); } catch (error) { toast(`動畫配置讀取失敗：${error.message}`); }
      noteJournalOperation('core.texture.import');
      const asset = {
        _uid: textureUid(), name: file.name, source: url, uvWidth: image.naturalWidth, uvHeight: image.naturalHeight,
        kind: file.type.split('/')[1]?.toUpperCase() || 'IMAGE', groupId: null, ...animation,
        externalFile: { imported: true, path: window.cubeBricksDesktop?.getPathForFile?.(file) || null }
      };
      textureSaveIndicators?.registerImported(asset);
      if (!animation) decodedTextureImages.set(asset, { source: url, promise: Promise.resolve(image) });
      state.textureAssets.push(asset);
      state.activeTextureUid = asset._uid;
      const assignedFaces = assignImportedTextureToBlankFaces(asset);
      if (animation) {
        URL.revokeObjectURL(url);
        activateProjectTexture(state.textureAssets.length - 1);
        renderTextureList();
        rebuildTextureAtlas();
        markDirty();
        toast(`已導入動畫貼圖 ${file.name}`);
        return;
      }
      updateLayerCompositePreview(asset, null);
      textureCanvas.width = image.naturalWidth;
      textureCanvas.height = image.naturalHeight;
      textureCtx.imageSmoothingEnabled = false;
      textureCtx.clearRect(0, 0, image.naturalWidth, image.naturalHeight);
      textureCtx.drawImage(image, 0, 0);
      if (asset) rememberEditablePaintSource(asset, textureCanvas);
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
    image.onerror = () => {
      URL.revokeObjectURL(url);
      toast('無法讀取這張圖片');
    };
    image.src = url;
  }

  function loadTextureSource(source, name, { updateAtlas = true } = {}) {
    const revision = ++textureLoadRevision;
    const loaded = image => {
      if (revision !== textureLoadRevision) return;
      pendingTextureImage = null;
      if (paintCanvasIsBound(textureCanvas)) return;
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
      if (asset) rememberEditablePaintSource(asset, textureCanvas);
      textureCanvas.style.visibility = '';
      window.dispatchEvent(new Event('cubebricks:texture-change'));
      updateTexturePreviewFrame(asset?.uvWidth || width, asset?.uvHeight || height);
      const activeName = $('.texture-item.active strong');
      if (activeName) activeName.textContent = name;
      if (updateAtlas) syncRendererTexture(textureCanvas);
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
    state.textureAssets = isolateTextureLayerIds(assets.map(asset => ({
      ...asset, _uid: textureUid(asset), groupId: asset.groupId || null,
      layers: normalizeTextureLayers(asset), animation: asset.animation ? structuredClone(asset.animation) : null
    })));
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

  function activateProjectTexture(index, { restoreSavedComposite = false } = {}) {
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
    if (restoreSavedComposite) {
      const source = asset.source;
      if (!asset.layers?.length) loadTextureSource(source, asset.name, { updateAtlas: false });
      else {
        // A journal snapshot already has the merged image. Show it directly
        // instead of loading and compositing every editable layer first.
        const layer = activeLayer(asset);
        const ready = layer && layerRasterCache.get(layer.uid);
        if (layer && ready?.savedSource === layer.source) showEditableLayer(asset);
        else if (layer?.source) {
          const layerSource = layer.source;
          void loadRaster(layerSource).then(canvas => {
            if (activationRevision !== textureLoadRevision || layerSource !== layer.source || asset.source !== source
              || paintCanvasIsBound(textureCanvas)) return;
            layerRasterCache.set(layer.uid, { canvas, savedSource: layerSource });
            showEditableLayer(asset);
            renderTextureFeatureControls();
          }).catch(error => toast(error.message));
        }
        window.dispatchEvent(new Event('cubebricks:texture-change'));
      }
      scheduleTextureAnimation();
      return;
    }
    if (asset.layers?.length) prepareLayers(asset).then(() => {
      if (state.activeTextureUid !== asset._uid || activationRevision !== textureLoadRevision) return;
      const composite = compositeLayers(asset);
      if (composite) {
        showLayerComposite(asset, composite);
        renderTextureFeatureControls();
      }
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
    textureUid, renderTextureList, updateLayerCompositePreview, renderTextureTileControls, refreshDerivedTileEntries, scheduleTextureAnimation, textureAssetForReference, isFaceTiled, remapNumericFaceTextureReferences, loadTextureAssetImage, createSimpleTexture, updateTextureCreateDialog, openTextureCreateDialog, importTexture, loadTextureSource, installProjectTextures, activateProjectTexture, invalidateUvPreviewTextureState,
    selectedTilingFaces, setTilingCoordinate,
    copyTexture, cutTexture, pasteTexture, removeTexture, removeActiveLayer, removeTextureLayer, mergeTextureLayerDown,
    copyTextureLayer: layerCommands.copy, pasteTextureLayer: layerCommands.paste,
    binarizeTextureLayerAlpha: layerCommands.binarizeAlpha, canPasteTextureLayer: layerCommands.canPaste,
    syncToneMappedPalettes, releaseTextureAssets, moveSelectionToLayer
  };
}
