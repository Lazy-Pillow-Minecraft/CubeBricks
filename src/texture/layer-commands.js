import { activeLayer, layerRasterCache, loadRaster, releaseLayerRaster, selectedLayerEntry } from '../common/core/texture-features.js';
import { activeTextureFrame, frameLayerUids } from '../common/core/frame-links.js';
import { binarizePixelAlpha, captureLayerBranch, instantiateLayerBranch, layerBranchEntries } from './layer-clipboard.js';
import { shortcutMatches } from '../screen/shortcuts.js';

export function createLayerCommands({ state, activeTextureAsset, textureCanvas, finishLayerEdit,
  pushTexturePaintHistory, refreshLayeredTexture, onChange, root, toast }) {
  let clipboard = null, queue = Promise.resolve();
  const context = uid => ({
    project: state.project, asset: activeTextureAsset(),
    uid: uid || selectedLayerEntry(activeTextureAsset())?.uid || activeLayer(activeTextureAsset())?.uid,
    frameUid: activeTextureFrame(activeTextureAsset())?.uid
  });
  const valid = scope => state.project === scope.project && activeTextureAsset() === scope.asset
    && state.textureAssets.includes(scope.asset);
  const enqueue = action => {
    const pending = queue.then(action);
    queue = pending.catch(() => {});
    return pending;
  };
  const blank = (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    return canvas;
  };

  async function ready(scope) {
    if (!scope.asset || !valid(scope)) return false;
    await finishLayerEdit();
    return valid(scope);
  }

  async function prepare(scope, entries) {
    for (const layer of entries) {
      if (layer.type === 'group') continue;
      const cached = layerRasterCache.get(layer.uid);
      if (cached && cached.savedSource === layer.source) continue;
      const source = layer.source;
      const canvas = source ? await loadRaster(source) : blank(textureCanvas.width, textureCanvas.height);
      if (!valid(scope) || layer.source !== source) return false;
      layerRasterCache.set(layer.uid, { canvas, savedSource: source });
    }
    return valid(scope);
  }

  async function capture(scope) {
    const entries = layerBranchEntries(scope.asset.layers || [], scope.uid);
    if (!entries.length || !await prepare(scope, entries)) return null;
    return captureFrameVisibility(scope, captureLayerBranch(scope.asset.layers, scope.uid,
      layer => layerRasterCache.get(layer.uid).canvas.toDataURL('image/png')));
  }

  function captureFrameVisibility(scope, snapshot) {
    if (!snapshot) return null;
    const frame = scope.asset.animation?.frames?.find(entry => entry.uid === scope.frameUid);
    snapshot.frameVisibility = scope.asset.animation?.enabled ? Object.fromEntries(Object.entries(frame?.visibility || {})
      .filter(([uid]) => snapshot.entries.some(layer => layer.uid === uid)))
      : Object.fromEntries(snapshot.entries.filter(layer => layer.visible === false).map(layer => [layer.uid, false]));
    return snapshot;
  }

  async function copy(uid) {
    const scope = context(uid);
    if (!scope.asset) return false;
    const pending = finishLayerEdit();
    const snapshot = captureFrameVisibility(scope, captureLayerBranch(scope.asset.layers || [], scope.uid, layer => {
      const cached = layerRasterCache.get(layer.uid);
      return cached?.savedSource === layer.source ? cached.canvas.toDataURL('image/png') : layer.source;
    }));
    if (!snapshot) return false;
    // Capture immutable pixels immediately. Switching textures or projects
    // while a pending property edit finishes must not cancel a completed copy.
    clipboard = snapshot;
    await pending;
    toast('已复制图层');
    return true;
  }

  function paste({ uid, inPlace = false } = {}) {
    const scope = context(uid);
    return enqueue(async () => {
      if (!await ready(scope)) return false;
      const snapshot = inPlace ? await capture(scope) : clipboard;
      if (!snapshot || !valid(scope)) return false;
      const asset = scope.asset;
      let layers = asset.layers || [], base = null;
      if (!layers.length) {
        const canvas = asset.source ? await loadRaster(asset.source) : blank(textureCanvas.width, textureCanvas.height);
        if (!valid(scope)) return false;
        base = { canvas, uid: crypto.randomUUID() };
        layers = [{
          uid: base.uid,
          name: '底图',
          source: canvas.toDataURL('image/png'),
          visible: true,
          opacity: 100,
          blendMode: 'normal'
        }];
      } else if (!await prepare(scope, layers)) return false;
      const created = instantiateLayerBranch(layers, snapshot, scope.uid, { inPlace });
      if (!created) return false;
      const rasters = layers.filter(layer => layer.type !== 'group').map(layer => layerRasterCache.get(layer.uid)?.canvas).filter(Boolean);
      const width = base?.canvas.width || (rasters.length ? Math.max(...rasters.map(canvas => canvas.width)) : textureCanvas.width);
      const height = base?.canvas.height || (rasters.length ? Math.max(...rasters.map(canvas => canvas.height)) : textureCanvas.height);
      const prepared = new Map();
      for (const layer of created.entries) {
        if (layer.type === 'group') continue;
        const image = layer.source ? await loadRaster(layer.source) : null;
        if (!valid(scope)) return false;
        const canvas = blank(width, height);
        if (image) canvas.getContext('2d').drawImage(image, 0, 0);
        layer.source = canvas.toDataURL('image/png');
        prepared.set(layer.uid, { canvas, savedSource: layer.source });
      }
      if (!valid(scope)) return false;
      pushTexturePaintHistory(asset, textureCanvas, null, inPlace ? 'core.texture.layer.duplicate' : 'core.texture.layer.paste');
      asset.layers = created.layers;
      if (base) layerRasterCache.set(base.uid, { canvas: base.canvas, savedSource: layers[0].source });
      for (const [uid, raster] of prepared) layerRasterCache.set(uid, raster);
      asset.activeLayerUid = created.rootUid;
      connectToFrame(asset, scope.frameUid, created);
      await refreshLayeredTexture(asset);
      if (valid(scope)) {
        onChange(created.rootUid);
        root?.focus({ preventScroll: true });
      }
      return true;
    });
  }

  function connectToFrame(asset, frameUid, created) {
    if (!asset.animation?.enabled) return;
    const frame = asset.animation.frames?.find(entry => entry.uid === frameUid);
    if (!frame) return;
    const included = frameLayerUids(asset, frame);
    const leaf = created.entries.filter(layer => layer.type !== 'group' && !layer.locked && created.frameVisibility[layer.uid] !== false).at(-1);
    asset.animation = {
      ...asset.animation, frames: asset.animation.frames.map(entry => entry === frame ? {
        ...frame, layerUids: included.has(created.rootUid) ? frame.layerUids : [...(frame.layerUids || []), created.rootUid],
        visibility: { ...frame.visibility, ...created.frameVisibility },
        paintLayerUid: leaf?.uid || frame.paintLayerUid
      } : entry)
    };
  }

  function binarizeAlpha(uid) {
    const scope = context(uid);
    return enqueue(async () => {
      if (!await ready(scope)) return false;
      const entries = layerBranchEntries(scope.asset.layers || [], scope.uid).filter(layer => layer.type !== 'group');
      if (!entries.length || !await prepare(scope, entries)) return false;
      const changes = [];
      for (const layer of entries) {
        const current = layerRasterCache.get(layer.uid).canvas;
        const pixels = current.getContext('2d').getImageData(0, 0, current.width, current.height);
        if (!binarizePixelAlpha(pixels.data)) continue;
        const canvas = blank(current.width, current.height);
        canvas.getContext('2d').putImageData(pixels, 0, 0);
        changes.push({ layer, canvas, source: canvas.toDataURL('image/png') });
      }
      if (!changes.length || !valid(scope)) return false;
      pushTexturePaintHistory(scope.asset, textureCanvas, null, 'core.texture.layer.alpha_binary');
      for (const { layer, canvas, source } of changes) {
        layer.source = source;
        releaseLayerRaster(layer.uid);
        layerRasterCache.set(layer.uid, { canvas, savedSource: source });
      }
      await refreshLayeredTexture(scope.asset);
      if (valid(scope)) onChange(scope.uid);
      return true;
    });
  }

  root?.addEventListener('keydown', event => {
    const action = ['copy', 'paste', 'duplicate'].find(id => shortcutMatches(event, id));
    if (!action || event.target.closest('input,select,textarea,[contenteditable="true"]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    (action === 'copy' ? copy() : paste({ inPlace: action === 'duplicate' })).catch(error => toast(error.message));
  });
  return { copy, paste, binarizeAlpha, canPaste: () => Boolean(clipboard) };
}
