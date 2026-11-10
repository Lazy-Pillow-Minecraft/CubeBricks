import { activeLayer, compositeLayers, flipbookFrame, imageCanvas, layerRasterCache, prepareLayers, tiledFaceRaster, tiledFaceReference, tiledFaceRegions } from '../common/core/texture-features.js';
import { isCubeFaceCulled } from '../common/core/geometry-utils.js';
import { performanceMonitor } from '../utils/performance-monitor.js';
import { boundPaintLayer } from '../paint/canvas-layer-binding.js';
import { paintHistoryRegion, snapshotEditableTexture } from './source-snapshot.js';
import { createLayerThumbnailUpdates } from './layer-thumbnail-controller.js';
import { layerRasterRegions } from '../common/utils/layer-raster-regions.js';

export function createTextureAtlasController({
  state, $, textureCanvas, textureCtx, sceneRenderer, uvPreviewRenderer,
  uvPreviewController, uvEditorController, livePaintTextureSources,
  animationRasterCache, CUBE_FACE_NAMES, loadTextureAssetImage,
  textureAssetForReference, scheduleSceneRender, refreshUvPreview,
  updateLayerCompositePreview, refreshDerivedTileEntries, uvPreviewIsActive,
  syncTexturePreviewPriority, resetTextureView, activeTextureAsset,
  getTextureAssetController
}) {
  const textureAtlasCanvas = document.createElement('canvas');
  const textureAtlasCtx = textureAtlasCanvas.getContext('2d');
  const textureAtlasPatchCanvas = document.createElement('canvas');
  const textureAtlasPatchCtx = textureAtlasPatchCanvas.getContext('2d');
  const neutralTextureCanvas = document.createElement('canvas');
  neutralTextureCanvas.width = neutralTextureCanvas.height = 1;
  const neutralTextureContext = neutralTextureCanvas.getContext('2d');
  neutralTextureContext.fillStyle = '#fff';
  neutralTextureContext.fillRect(0, 0, 1, 1);
  let textureAtlasEntries = [];
  let textureAtlasLayoutByUid = new Map();
  let textureAtlasRevision = 0;
  let textureAtlasRebuildFrame = null;
  const failedImageRetries = new WeakMap();
  const decodedCanvasCache = new WeakMap();
  const layerThumbnails = createLayerThumbnailUpdates({ activeTextureAsset });
  const floatingTextures = new Map();

  function displayTextureFrame(asset, source) {
    const floating = floatingTextures.get(asset);
    if (!floating) return source;
    floating.base = source;
    if (asset.animation?.enabled) floating.display = flipbookFrame(asset, floating.composite, null, floating.rasters);
    return floating.display;
  }

  function previewFloatingTexture(asset, canvas) {
    let floating = floatingTextures.get(asset);
    if (!floating) {
      const entry = textureAtlasLayoutByUid.get(asset._uid);
      let base = null;
      if (entry) {
        base = document.createElement('canvas');
        base.width = entry.width;
        base.height = entry.height;
        base.getContext('2d').drawImage(textureAtlasCanvas,
          entry.x, entry.y, entry.width, entry.height, 0, 0, base.width, base.height);
      }
      floating = { base };
      floatingTextures.set(asset, floating);
    }
    const layer = boundPaintLayer(asset, canvas);
    floating.rasters = layer ? new Map(layerRasterCache) : undefined;
    floating.composite = layer ? compositeLayers(asset, canvas, null, null, null, layer.uid, floating.rasters) : canvas;
    floating.display = flipbookFrame(asset, floating.composite, null, floating.rasters);
    uploadDisplayedTexture(asset, floating.display);
  }

  function clearFloatingTextures() {
    const previous = [...floatingTextures];
    floatingTextures.clear();
    for (const [asset, { base }] of previous) {
      if (!state.textureAssets.includes(asset)) continue;
      if (base) uploadDisplayedTexture(asset, base);
      else {
        updateLayerCompositePreview(asset, null);
        rebuildTextureAtlas();
      }
    }
  }

  function resetAtlas({ preserveGpu = false } = {}) {
    textureAtlasRevision++;
    textureAtlasEntries = [];
    textureAtlasLayoutByUid = new Map();
    // Journal navigation can restore the model before its replacement images
    // finish loading. Keep the previous atlas visible until the new one is
    // ready instead of flashing the neutral white texture for a frame.
    if (!preserveGpu) {
      sceneRenderer.setTexture(neutralTextureCanvas);
      uvPreviewRenderer.setTexture(neutralTextureCanvas);
    }
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

  function textureAtlasRegionPatch(source, entry, dirty) {
    const left = Math.max(0, Math.floor(dirty.x));
    const top = Math.max(0, Math.floor(dirty.y));
    const right = Math.min(entry.width, Math.ceil(dirty.x + dirty.width));
    const bottom = Math.min(entry.height, Math.ceil(dirty.y + dirty.height));
    if (right <= left || bottom <= top) return null;
    const patchX = entry.x + left - (left === 0 ? 1 : 0);
    const patchY = entry.y + top - (top === 0 ? 1 : 0);
    const patchWidth = right - left + (left === 0 ? 1 : 0) + (right === entry.width ? 1 : 0);
    const patchHeight = bottom - top + (top === 0 ? 1 : 0) + (bottom === entry.height ? 1 : 0);
    textureAtlasCtx.imageSmoothingEnabled = false;
    textureAtlasCtx.clearRect(patchX, patchY, patchWidth, patchHeight);
    textureAtlasCtx.drawImage(source, left, top, right - left, bottom - top,
      entry.x + left, entry.y + top, right - left, bottom - top);
    if (top === 0) textureAtlasCtx.drawImage(source, left, 0, right - left, 1,
      entry.x + left, entry.y - 1, right - left, 1);
    if (bottom === entry.height) textureAtlasCtx.drawImage(source, left, bottom - 1, right - left, 1,
      entry.x + left, entry.y + bottom, right - left, 1);
    if (left === 0) textureAtlasCtx.drawImage(source, 0, top, 1, bottom - top,
      entry.x - 1, entry.y + top, 1, bottom - top);
    if (right === entry.width) textureAtlasCtx.drawImage(source, right - 1, top, 1, bottom - top,
      entry.x + right, entry.y + top, 1, bottom - top);
    if (left === 0 && top === 0) textureAtlasCtx.drawImage(source, 0, 0, 1, 1, entry.x - 1, entry.y - 1, 1, 1);
    if (right === entry.width && top === 0) textureAtlasCtx.drawImage(source, right - 1, 0, 1, 1, entry.x + right, entry.y - 1, 1, 1);
    if (left === 0 && bottom === entry.height) textureAtlasCtx.drawImage(source, 0, bottom - 1, 1, 1, entry.x - 1, entry.y + bottom, 1, 1);
    if (right === entry.width && bottom === entry.height) textureAtlasCtx.drawImage(source, right - 1, bottom - 1, 1, 1,
      entry.x + right, entry.y + bottom, 1, 1);
    textureAtlasPatchCanvas.width = patchWidth;
    textureAtlasPatchCanvas.height = patchHeight;
    textureAtlasPatchCtx.imageSmoothingEnabled = false;
    textureAtlasPatchCtx.drawImage(textureAtlasCanvas, patchX, patchY, patchWidth, patchHeight,
      0, 0, patchWidth, patchHeight);
    return { source: textureAtlasPatchCanvas, x: patchX, y: patchY };
  }

  function textureAtlasReferences(asset, index) {
    return [asset._uid, asset.uuid, asset.id, String(index), asset.name]
      .filter(value => value !== undefined && value !== null)
      .map(String);
  }

  function rebuildTextureAtlas() {
    // Invalidate an in-flight build immediately, not one frame later. Otherwise
    // an old texture/project can briefly overwrite the new GPU atlas.
    textureAtlasRevision++;
    if (textureAtlasRebuildFrame !== null) return;
    textureAtlasRebuildFrame = requestAnimationFrame(() => {
      textureAtlasRebuildFrame = null;
      rebuildTextureAtlasNow();
    });
  }

  async function rebuildTextureAtlasNow() {
    const revision = ++textureAtlasRevision;
    const project = state.project;
    const assets = [...state.textureAssets];
    const records = (await Promise.all(assets.map(async (asset, index) => {
      const image = await loadTextureAssetImage(asset);
      if (!image) return null;
      let original = typeof image.getContext === 'function' ? imageCanvas(image) : decodedCanvasCache.get(image);
      if (!original) {
        original = imageCanvas(image);
        if (typeof image.getContext !== 'function') decodedCanvasCache.set(image, original);
      }
      if (asset.animation?.enabled && asset.layers?.length) await prepareLayers(asset);
      const frame = flipbookFrame(asset, original);
      return {
        asset, index, original, image: frame, width: frame.width, height: frame.height,
        uvWidth: Number(asset.uvWidth) || Number(state.project.textureSize?.[0]) || frame.width,
        uvHeight: Number(asset.uvHeight) || Number(state.project.textureSize?.[1]) || frame.height
      };
    }))).filter(Boolean);
    if (revision !== textureAtlasRevision || project !== state.project
      || assets.length !== state.textureAssets.length
      || assets.some((asset, index) => asset !== state.textureAssets[index])) {
      // A preview switch or paint patch superseded this asynchronous build.
      // Ensure the current project's atlas still gets its own final pass.
      rebuildTextureAtlas();
      return false;
    }
    for (const { asset, original } of records)
      animationRasterCache.set(asset._uid, { canvas: original, source: asset.source });
    for (const record of records) {
      record.image = displayTextureFrame(record.asset, record.image);
      if (floatingTextures.has(record.asset)) updateLayerCompositePreview(record.asset, record.image, null, true);
    }
    const loadedAssets = new Set(records.map(record => record.asset));
    let retryDelay = 0;
    for (const asset of assets) {
      if (loadedAssets.has(asset)) {
        failedImageRetries.delete(asset);
        continue;
      }
      const previous = failedImageRetries.get(asset);
      const attempts = previous?.source === asset.source ? previous.attempts + 1 : 1;
      failedImageRetries.set(asset, { source: asset.source, attempts });
      if (attempts <= 3) retryDelay = Math.max(retryDelay, attempts * 180);
    }
    if (retryDelay) setTimeout(() => {
      if (state.project === project && assets.every(asset => state.textureAssets.includes(asset))) rebuildTextureAtlas();
    }, retryDelay);
    const tileKeys = new Set();
    const tiledAssets = new Set(records.filter(record => record.asset.mode === 'tiled').map(record => record.asset));
    const tileSources = new Map(records.filter(record => tiledAssets.has(record.asset))
      .map(record => [record.asset, record.image]));
    const tileSourcePixels = new Map();
    for (const element of tiledAssets.size ? state.project.elements : []) {
      const cubes = element.type === 'cube' ? [element] : element.toCubes?.() || [];
      for (const cube of cubes) for (const faceName of CUBE_FACE_NAMES) {
        const asset = textureAssetForReference(cube.faces?.[faceName]?.texture);
        if (asset?.mode !== 'tiled' || isCubeFaceCulled(cube.faces?.[faceName])) continue;
        const source = tileSources.get(asset);
        if (!source) continue;
        let sourcePixels = tileSourcePixels.get(source);
        if (!sourcePixels) {
          sourcePixels = source.getContext('2d').getImageData(0, 0, source.width, source.height);
          tileSourcePixels.set(source, sourcePixels);
        }
        const tileAsset = { ...asset, width: source.width, height: source.height };
        for (const region of tiledFaceRegions(cube, faceName)) {
          const reference = tiledFaceReference(cube, faceName, tileAsset, region);
          if (tileKeys.has(reference)) continue;
          tileKeys.add(reference);
          const image = tiledFaceRaster(cube, faceName, source, region, null, sourcePixels);
          records.push({
            asset: { _uid: reference }, index: -1, image, width: image.width, height: image.height,
            references: [reference], tileSourceUid: asset._uid, tileCube: cube, tileFaceName: faceName, tileRegion: region
          });
        }
      }
    }
    if (!records.length) {
      textureAtlasEntries = [];
      textureAtlasLayoutByUid = new Map();
      sceneRenderer.setTexture(neutralTextureCanvas);
      uvPreviewRenderer.setTexture(neutralTextureCanvas);
      return false;
    }
    const totalArea = records.reduce((sum, record) => sum + (record.width + 2) * (record.height + 2), 0);
    let widest = 1;
    for (const record of records) widest = Math.max(widest, record.width + 2);
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
        uvWidth: record.uvWidth || record.width, uvHeight: record.uvHeight || record.height,
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
    // The preview owns a separate WebGL texture. Upload it when its dock is
    // actually rendered, rather than duplicating every atlas upload here.
    uvPreviewController.uvPreviewTextureDirty = true;
    uvPreviewController.uvPreviewRenderDirty = true;
    window.dispatchEvent(new Event('cubebricks:atlas-change'));
    scheduleSceneRender();
    refreshUvPreview();
    return true;
  }

  function syncRendererTextureAsset(asset, source, composited = false, dirty = null, changedLayerUid = null) {
    const editableSource = !composited ? source : null;
    const layerUid = editableSource && (boundPaintLayer(asset, source) || activeLayer(asset))?.uid;
    const previous = asset && livePaintTextureSources.get(asset._uid);
    const profile = performanceMonitor.enabled;
    const start = profile ? performance.now() : 0;
    if (asset?.layers?.length) {
      layerThumbnails.queue(asset, changedLayerUid || (!composited ? (boundPaintLayer(asset, source) || activeLayer(asset))?.uid : null));
      if (!composited) {
        const cached = livePaintTextureSources.get(asset._uid);
        const selected = boundPaintLayer(asset, source) || activeLayer(asset);
        const layerCanvas = selected && layerRasterCache.get(selected.uid)?.canvas;
        const region = dirty && cached?.savedSource === asset.source
          && cached.source?.width === source.width && cached.source?.height === source.height
          && layerCanvas?.width === source.width && layerCanvas?.height === source.height
          ? {
            x: Math.max(0, Math.floor(dirty.x)), y: Math.max(0, Math.floor(dirty.y)),
            width: Math.min(source.width, Math.ceil(dirty.x + dirty.width)) - Math.max(0, Math.floor(dirty.x)),
            height: Math.min(source.height, Math.ceil(dirty.y + dirty.height)) - Math.max(0, Math.floor(dirty.y))
          }
          : null;
        if (region?.width > 0 && region.height > 0) {
          const layerContext = layerCanvas.getContext('2d');
          layerContext.clearRect(region.x, region.y, region.width, region.height);
          layerContext.drawImage(source, region.x, region.y, region.width, region.height,
            region.x, region.y, region.width, region.height);
          layerRasterRegions.invalidate(layerCanvas, region);
          const patch = compositeLayers(asset, null, null, region);
          const compositeContext = cached.source.getContext('2d');
          compositeContext.clearRect(region.x, region.y, region.width, region.height);
          compositeContext.drawImage(patch, region.x, region.y);
          source = cached.source;
          dirty = region;
        } else {
          source = compositeLayers(asset, source, null, null, null, selected?.uid);
          dirty = null;
        }
      }
    }
    const compositeEnd = profile ? performance.now() : 0;
    source = snapshotEditableTexture(asset, source, textureCanvas, dirty);
    if (asset && source) animationRasterCache.set(asset._uid, {
      canvas: typeof source.getContext === 'function' ? source : imageCanvas(source), source: asset.source
    });
    if (asset?._uid && source) livePaintTextureSources.set(asset._uid, {
      source, savedSource: asset.source,
      editableSource, layerUid: layerUid || undefined,
      patchOnly: Boolean(editableSource && dirty && previous?.savedSource === asset.source
        && (previous.editableSource !== editableSource || previous.patchOnly))
    });
    source = flipbookFrame(asset, source, dirty);
    uploadDisplayedTexture(asset, displayTextureFrame(asset, source), floatingTextures.has(asset) ? null : dirty, start, compositeEnd);
  }

  function uploadDisplayedTexture(asset, source, dirty = null, start = 0, compositeEnd = 0) {
    updateLayerCompositePreview(asset, source, dirty, floatingTextures.has(asset));
    const atlasEntry = asset && textureAtlasLayoutByUid.get(asset._uid);
    let atlasPatch = null;
    if (atlasEntry && source?.width === atlasEntry.width && source?.height === atlasEntry.height) {
      textureAtlasRevision++;
      if (dirty) atlasPatch = textureAtlasRegionPatch(source, atlasEntry, dirty);
      if (!atlasPatch) {
        drawTextureAtlasEntry(source, atlasEntry);
        atlasPatch = { source: textureAtlasPatch(atlasEntry), x: atlasEntry.x - 1, y: atlasEntry.y - 1 };
      }
      if (!sceneRenderer.updateTextureAtlasRegion(atlasPatch.source, atlasPatch.x, atlasPatch.y)) {
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
        if (!uvPreviewRenderer.updateTextureAtlasRegion(atlasPatch.source, atlasPatch.x, atlasPatch.y)) {
          uvPreviewRenderer.setTextureAtlas(textureAtlasCanvas, textureAtlasEntries);
        }
      }
      uvPreviewController.uvPreviewTextureDirty = false;
    }
    scheduleSceneRender();
    const uploadEnd = start ? performance.now() : 0;
    if (asset && source) refreshDerivedTileEntries(asset, source);
    if (start) {
      const end = performance.now();
      performanceMonitor.record('paint.layerComposite', compositeEnd - start);
      performanceMonitor.record('paint.atlasUpload', uploadEnd - compositeEnd);
      performanceMonitor.record('paint.derivedTiles', end - uploadEnd);
    }
  }

  function syncRendererTexture(source, composited = false) {
    syncRendererTextureAsset(activeTextureAsset(), source, composited);
  }

  function restoreHistoryTextures(uids) {
    if (!uids.length) return true;
    const assets = uids.map(uid => state.textureAssets.find(asset => asset._uid === uid));
    if (assets.some(asset => !asset || !textureAtlasLayoutByUid.has(asset._uid))) return false;
    textureAtlasRevision++;
    for (const asset of assets) {
      const uid = asset._uid, source = asset.source;
      const region = !asset.animation?.enabled && asset.mode !== 'tiled'
        ? paintHistoryRegion(livePaintTextureSources.get(uid)?.savedSource, source) : null;
      livePaintTextureSources.delete(uid);
      animationRasterCache.delete(uid);
      void loadTextureAssetImage(asset).then(async image => {
        if (asset.animation?.enabled && asset.layers?.length) await prepareLayers(asset);
        // A newer undo, redo, or live stroke owns this slot now.
        if (!state.textureAssets.includes(asset) || asset.source !== source || livePaintTextureSources.has(uid)) return;
        if (image) syncRendererTextureAsset(asset, imageCanvas(image), true, region);
        else rebuildTextureAtlas();
      }).catch(() => { if (state.textureAssets.includes(asset)) rebuildTextureAtlas(); });
    }
    return true;
  }

  function renderTexture() {
    getTextureAssetController().textureLoadRevision++;
    getTextureAssetController().pendingTextureImage = null;
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
    uvEditorController.texturePreviewSize = [width, height];
    $('#texturePreview').style.setProperty('--texture-aspect', `${width} / ${height}`);
    $('.texture-preview > span').textContent = `無貼圖 · ${width} × ${height}`;
    syncTexturePreviewPriority();
    resetTextureView(false);
  }

  return {
    get textureAtlasCanvas() { return textureAtlasCanvas; },
    get textureAtlasEntries() { return textureAtlasEntries; },
    resetAtlas,
    drawTextureAtlasEntry,
    textureAtlasPatch,
    textureAtlasReferences,
    rebuildTextureAtlas,
    rebuildTextureAtlasNow,
    restoreHistoryTextures,
    previewFloatingTexture,
    clearFloatingTextures,
    syncRendererTextureAsset,
    syncRendererTexture,
    renderTexture,
  };
}
