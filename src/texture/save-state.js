const sourceDigests = new WeakMap();
let pixelWorker = null, requestId = 0;
const pendingDigests = new Map();
function pixelDigest(source) {
  if (!pixelWorker) {
    pixelWorker = new Worker(new URL('./save-fingerprint-worker.js', import.meta.url), { type: 'module' });
    pixelWorker.onmessage = ({ data }) => {
      const request = pendingDigests.get(data.id); pendingDigests.delete(data.id);
      if (data.error) request?.reject(new Error(data.error)); else request?.resolve(data.result);
    };
    pixelWorker.onerror = error => {
      for (const request of pendingDigests.values()) request.reject(new Error(error.message));
      pendingDigests.clear(); pixelWorker?.terminate(); pixelWorker = null;
    };
  }
  return new Promise((resolve, reject) => { const id = ++requestId; pendingDigests.set(id, { resolve, reject }); pixelWorker.postMessage({ id, source }); });
}
async function digest(text) {
  const bytes = new TextEncoder().encode(text);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}
function sourceDigest(owner, source) {
  const cached = sourceDigests.get(owner);
  if (cached?.source === source) return cached.promise;
  const promise = (async () => {
    if (typeof Worker !== 'undefined' && /^(data:image\/|blob:)/.test(String(source))) return pixelDigest(source);
    if (String(source).startsWith('blob:')) {
      const buffer = await (await fetch(source)).arrayBuffer();
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), n => n.toString(16).padStart(2, '0')).join('');
    }
    if (String(source).startsWith('data:')) {
      const comma = source.indexOf(','), header = source.slice(0, comma), payload = source.slice(comma + 1);
      const bytes = header.endsWith(';base64') ? Uint8Array.from(atob(payload), char => char.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(payload));
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
    }
    return digest(String(source || ''));
  })();
  sourceDigests.set(owner, { source, promise });
  return promise;
}

// Image digests are cached per immutable source on its owning asset/layer.
// Playing, selecting frames, panning and camera motion never hash images.
export async function textureSaveFingerprint(asset) {
  const layers = asset.layers || [];
  const normalized = layers.map(layer => {
    const { uid, parentUid, type, visible, opacity, blendMode, maskLayerUid, toneMap } = layer;
    return { uid, parentUid, type, visible, opacity, blendMode, maskLayerUid, toneMap: structuredClone(toneMap), source: sourceDigest(layer, layer.source) };
  });
  const animation = asset.animation?.enabled ? { enabled: true, fps: asset.animation.fps, interpolate: asset.animation.interpolate,
    frames: (asset.animation.frames || []).map(frame => ({ layerUids: [...(frame.layerUids || [])], duration: frame.duration,
      visibility: structuredClone(frame.visibility) })) } : null;
  const source = layers.length ? null : sourceDigest(asset, asset.source);
  await Promise.all(normalized.map(async layer => { layer.source = await layer.source; }));
  return digest(JSON.stringify({ source: source ? await source : null, layers: normalized, animation }));
}

export function createTextureSaveIndicators({ state, root = () => document.getElementById('textureList') }) {
  const dirty = new WeakMap(), revisions = new WeakMap(), checked = new WeakMap(); let queued = false, forcePaint = false;
  const importedBaselines = new WeakMap(), savedFiles = new Map();
  const projectKey = () => state.project?.projectUuid || 'default';
  function registerImported(asset) {
    const external = asset.externalFile;
    if (!external?.imported || external.fingerprint || importedBaselines.has(external)) return;
    const pending = textureSaveFingerprint(asset);
    importedBaselines.set(external, pending); void pending.catch(() => {});
  }
  const stamp = asset => ({ sources: asset.layers?.length ? asset.layers.map(layer => layer.source) : [asset.source],
    metadata: JSON.stringify({ layers: asset.layers?.map(layer => ({ uid: layer.uid, parentUid: layer.parentUid, type: layer.type,
      visible: layer.visible, opacity: layer.opacity, blendMode: layer.blendMode, maskLayerUid: layer.maskLayerUid, toneMap: layer.toneMap })),
      animation: asset.animation?.enabled ? { fps: asset.animation.fps, interpolate: asset.animation.interpolate,
        frames: asset.animation.frames?.map(frame => ({ layerUids: frame.layerUids, duration: frame.duration, visibility: frame.visibility })) } : null,
      baseline: asset.externalFile?.fingerprint, imported: asset.externalFile?.imported }) });
  function paint(asset, value) {
    dirty.set(asset, value);
    const row = root()?.querySelector(`[data-texture-uid="${CSS.escape(asset._uid)}"]`);
    const button = row?.querySelector('[data-save-texture]');
    if (button) button.hidden = !value;
  }
  async function refreshAsset(asset, repaint = false) {
    const saved = savedFiles.get(projectKey())?.get(asset._uid);
    if (saved && asset.externalFile !== saved) asset.externalFile = saved;
    registerImported(asset);
    const current = stamp(asset), previous = checked.get(asset);
    if (previous && previous.metadata === current.metadata && previous.sources.length === current.sources.length
      && previous.sources.every((source, index) => source === current.sources[index])) {
      if (repaint) paint(asset, dirty.get(asset) ?? !asset.externalFile); return;
    }
    checked.set(asset, current);
    const revision = (revisions.get(asset) || 0) + 1; revisions.set(asset, revision);
    if (!asset.externalFile) { paint(asset, true); return; }
    const external = asset.externalFile;
    const fingerprintTask = textureSaveFingerprint(asset);
    if (!external.fingerprint && external.imported) external.fingerprint = await importedBaselines.get(external);
    const fingerprint = await fingerprintTask;
    if (revisions.get(asset) !== revision) return;
    // Imported pixels start clean, even when embedded in a model. They still
    // need an external filename before a game-format export can reference them.
    if (!asset.externalFile.fingerprint && asset.externalFile.imported) asset.externalFile.fingerprint = fingerprint;
    checked.set(asset, stamp(asset));
    paint(asset, fingerprint !== asset.externalFile.fingerprint);
  }
  return {
    registerImported,
    isDirty: asset => dirty.get(asset) ?? !asset.externalFile,
    refresh({ paint: repaintRequested = false } = {}) {
      forcePaint ||= repaintRequested;
      if (queued) return; queued = true;
      queueMicrotask(() => { const repaint = forcePaint; forcePaint = false; queued = false;
        for (const asset of state.textureAssets) void refreshAsset(asset, repaint).catch(() => paint(asset, true)); });
    },
    async markSaved(asset, fingerprint, { filePath, resource, ownFile = true, projectUuid = projectKey() } = {}) {
      asset.externalFile = { ...asset.externalFile, fingerprint, imported: false,
        ...(ownFile ? { path: filePath, resource } : { exportPath: filePath }) };
      if (!savedFiles.has(projectUuid)) savedFiles.set(projectUuid, new Map());
      savedFiles.get(projectUuid).set(asset._uid, asset.externalFile);
      if (projectUuid === projectKey() && state.textureAssets.includes(asset)) await refreshAsset(asset);
    }
  };
}
