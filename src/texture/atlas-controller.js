import { compositeLayers, flipbookFrame, imageCanvas, tiledFaceRaster, tiledFaceReference, tiledFaceRegions } from '../common/core/texture-features.js';
import { isCubeFaceCulled } from '../render/webgl-renderer.js';

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
    const original = imageCanvas(image);
    animationRasterCache.set(asset._uid, { canvas: original, source: asset.source });
    const frame = flipbookFrame(asset, original, asset.animation?.currentFrame || 0);
    return { asset, index, image: frame, width: frame.width, height: frame.height,
      uvWidth: Number(asset.uvWidth) || Number(state.project.textureSize?.[0]) || frame.width,
      uvHeight: Number(asset.uvHeight) || Number(state.project.textureSize?.[1]) || frame.height };
  }))).filter(Boolean);
  if (revision !== textureAtlasRevision || project !== state.project
    || assets.length !== state.textureAssets.length
    || assets.some((asset, index) => asset !== state.textureAssets[index])) {
    // A preview switch or paint patch superseded this asynchronous build.
    // Ensure the current project's atlas still gets its own final pass.
    rebuildTextureAtlas();
    return false;
  }
  const loadedAssets = new Set(records.map(record => record.asset));
  let retryDelay = 0;
  for (const asset of assets) {
    if (loadedAssets.has(asset)) { failedImageRetries.delete(asset); continue; }
    const previous = failedImageRetries.get(asset);
    const attempts = previous?.source === asset.source ? previous.attempts + 1 : 1;
    failedImageRetries.set(asset, { source: asset.source, attempts });
    if (attempts <= 3) retryDelay = Math.max(retryDelay, attempts * 180);
  }
  if (retryDelay) setTimeout(() => {
    if (state.project === project && assets.every(asset => state.textureAssets.includes(asset))) rebuildTextureAtlas();
  }, retryDelay);
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
    sceneRenderer.setTexture(neutralTextureCanvas);
    uvPreviewRenderer.setTexture(neutralTextureCanvas);
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
  uvPreviewRenderer.setTextureAtlas(textureAtlasCanvas, textureAtlasEntries);
  window.dispatchEvent(new Event('cubebricks:atlas-change'));
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
  syncRendererTextureAsset,
  syncRendererTexture,
  renderTexture,
};
}
