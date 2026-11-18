import { createTextureResizeDialog } from './resize-dialog.js';
import { resizeTextureRaster } from './resize-texture.js';
import { pendingPaintCommit } from '../paint/commit-order.js';
import { layerRasterCache, loadRaster, releaseLayerRaster } from '../common/core/texture-features.js';
import { planTextureStretchUvs } from './resize-uv.js';

export function createTextureResizeController({ state, $, textureCanvas, activeTextureAsset, finishPaintSelection,
  finishLayerEdit, loadTextureAssetImage, pushTexturePaintHistory, livePaintTextureSources, animationRasterCache,
  invalidateUvPreviewTextureState, showLayerComposite, renderTextureFeatureControls, renderLayerEditor,
  renderTextureList, rebuildTextureAtlas, invalidateAllRenderGeometry, markDirty, renderScene, toast }) {
  let textureResizeDialog = null;

  async function prepareTextureResize(asset) {
    const project = state.project;
    await finishPaintSelection?.();
    await pendingPaintCommit(project);
    await finishLayerEdit();
    if (state.project !== project || !state.textureAssets.includes(asset)) return null;
    const raster = await loadTextureAssetImage(asset);
    if (!raster || state.project !== project || !state.textureAssets.includes(asset)) return null;
    return { project, asset, width: raster.naturalWidth || raster.width, height: raster.naturalHeight || raster.height };
  }

  async function resizeTexture(target, width, height, mode) {
    const { project, asset } = target;
    const valid = () => state.project === project && state.textureAssets.includes(asset);
    if (!valid()) throw new Error('目标贴图已改变，请重新打开');
    if (width === target.width && height === target.height) return;
    const source = asset.source, layers = asset.layers;
    const unchanged = () => valid() && asset.source === source && asset.layers === layers;
    const original = await loadTextureAssetImage(asset);
    if (!original || !unchanged()) throw new Error('目标贴图已改变，请重新打开');
    const canvas = resizeTextureRaster(original, width, height, mode);
    const uvBefore = [asset.uvWidth || target.width, asset.uvHeight || target.height];
    const uvAfter = [uvBefore[0] * width / target.width, uvBefore[1] * height / target.height];
    const nextLayers = [];
    // Prepare every output before mutating the asset so a decode/encode error
    // cannot leave only some layers resized.
    for (const layer of layers || []) {
      if (layer.type === 'group') continue;
      const cached = layerRasterCache.get(layer.uid);
      const raster = cached?.savedSource === layer.source ? cached.canvas : await loadRaster(layer.source);
      if (!unchanged()) throw new Error('目标贴图已改变，请重新打开');
      const resized = resizeTextureRaster(raster, width, height, mode);
      nextLayers.push({ layer, canvas: resized, source: resized.toDataURL('image/png') });
    }
    const nextSource = canvas.toDataURL('image/png');
    if (!unchanged()) throw new Error('目标贴图已改变，请重新打开');
    const uvPlan = mode === 'stretch' ? planTextureStretchUvs(project, asset, state.textureAssets,
      { pixels: [target.width, target.height], uv: uvBefore }, { pixels: [width, height], uv: uvAfter }) : null;
    const history = pushTexturePaintHistory(asset, textureCanvas, null, 'core.texture.resize');
    if (history && uvPlan?.previous.length) history.textureResizeUvs = uvPlan.previous;
    uvPlan?.apply();
    for (const next of nextLayers) {
      next.layer.source = next.source;
      releaseLayerRaster(next.layer.uid);
      layerRasterCache.set(next.layer.uid, { canvas: next.canvas, savedSource: next.source });
    }
    asset.source = nextSource;
    // Keep the imported physical-pixel/UV-unit density when the canvas changes.
    [asset.uvWidth, asset.uvHeight] = uvAfter;
    livePaintTextureSources.delete(asset._uid);
    animationRasterCache.set(asset._uid, { canvas, source: asset.source });
    invalidateUvPreviewTextureState();
    if (activeTextureAsset() === asset) {
      showLayerComposite(asset, canvas);
      renderTextureFeatureControls();
    }
    renderLayerEditor();
    renderTextureList();
    rebuildTextureAtlas();
    if (uvPlan) invalidateAllRenderGeometry();
    markDirty();
    renderScene();
  }

  function open(asset = activeTextureAsset()) {
    textureResizeDialog ||= createTextureResizeDialog({
      $, prepare: prepareTextureResize, resize: resizeTexture
    });
    return textureResizeDialog.open(asset).catch(error => toast(error.message));
  }

  return { open };
}
