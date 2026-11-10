// Frame membership is independent of layer visibility, order and pixel storage.
const selectedFrames = new WeakMap();
export const FRAME_ROOT_UID = '__all_layers__';

export function activeTextureFrame(asset) {
  const frames = asset?.animation?.frames;
  if (!Array.isArray(frames)) return null;
  return frames.find(frame => frame.uid === selectedFrames.get(asset)?.uid) || frames[0] || null;
}

export function selectTextureFrame(asset, uid) {
  if (asset) selectedFrames.set(asset, { uid, mix: 0 });
}

export function textureFramePosition(asset) {
  const frames = asset?.animation?.frames || [], frame = activeTextureFrame(asset);
  return Math.max(0, frames.indexOf(frame)) + (selectedFrames.get(asset)?.mix || 0);
}
export function setTextureFramePosition(asset, position) {
  const frames = asset?.animation?.frames || [];
  if (!frames.length) return;
  const value = Math.max(0, Math.min(frames.length - 1e-7, Number(position) || 0)), index = Math.floor(value);
  selectedFrames.set(asset, { uid: frames[index].uid, mix: value - index });
}
export function textureFrameSample(asset) {
  const frames = asset?.animation?.frames || [], frame = activeTextureFrame(asset), index = frames.indexOf(frame);
  return {
    frame,
    next: frames[(index + 1) % frames.length],
    mix: asset?.animation?.interpolate ? (selectedFrames.get(asset)?.mix || 0) : 0
  };
}

const frameTimings = new WeakMap();
export function advanceTextureFrames(asset, seconds) {
  const frames = asset?.animation?.frames || [];
  if (!frames.length) return;
  let timing = frameTimings.get(frames);
  if (!timing) {
    const starts = [0];
    for (const frame of frames) starts.push(starts.at(-1) + (Number(frame.duration) > 0 ? Number(frame.duration) : 1));
    timing = { starts, total: starts.at(-1) };
    frameTimings.set(frames, timing);
  }
  const position = textureFramePosition(asset), index = Math.floor(position), fraction = position - index;
  const unit = timing.starts[index] + fraction * (timing.starts[index + 1] - timing.starts[index]);
  const next = ((unit + Math.max(0, seconds) * (Number(asset.animation.fps) || 20)) % timing.total + timing.total) % timing.total;
  let low = 0, high = frames.length;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (timing.starts[middle] <= next) low = middle; else high = middle;
  }
  setTextureFramePosition(asset, low + (next - timing.starts[low]) / (timing.starts[low + 1] - timing.starts[low]));
}

export function frameVisibilityControls(asset, frame = activeTextureFrame(asset)) {
  const layers = asset?.layers || [], roots = new Set(frame?.layerUids || []), groups = new Set(layers.filter(layer => layer.type === 'group' && roots.has(layer.uid)).map(layer => layer.uid));
  if (roots.has(FRAME_ROOT_UID)) return new Set(layers.map(layer => layer.uid));
  const children = new Map();
  for (const layer of layers) {
    if (!children.has(layer.parentUid)) children.set(layer.parentUid, []);
    children.get(layer.parentUid).push(layer.uid);
  }
  const result = new Set(), pending = [...groups];
  for (let i = 0; i < pending.length; i++)for (const uid of children.get(pending[i]) || []) if (!result.has(uid)) {
    result.add(uid);
    pending.push(uid);
  }
  return result;
}

export function frameLayerUids(asset, frame = activeTextureFrame(asset)) {
  const layers = asset?.layers || [], entries = new Map(layers.map(layer => [layer.uid, layer]));
  const roots = frame?.layerUids || [];
  const included = new Set(roots.includes(FRAME_ROOT_UID) ? layers.map(layer => layer.uid) : roots.filter(uid => entries.has(uid)));
  // Connected groups include all descendants. Ancestors retain their own
  // opacity, visibility and compositing, without bringing in other children.
  const children = new Map();
  for (const layer of layers) {
    if (!children.has(layer.parentUid)) children.set(layer.parentUid, []);
    children.get(layer.parentUid).push(layer.uid);
  }
  const visit = uid => {
    for (const child of children.get(uid) || []) {
      if (included.has(child)) continue;
      included.add(child);
      visit(child);
    }
  };
  for (const uid of [...included]) if (entries.get(uid)?.type === 'group') visit(uid);
  for (const uid of [...included]) {
    let parent = entries.get(uid)?.parentUid;
    const seen = new Set();
    while (entries.get(parent)?.type === 'group' && !seen.has(parent)) {
      seen.add(parent);
      included.add(parent);
      parent = entries.get(parent).parentUid;
    }
  }
  for (const uid of [...included]) {
    let current = uid;
    const seen = new Set();
    while (entries.has(current) && !seen.has(current)) {
      seen.add(current);
      if (frame?.visibility?.[current] === false) {
        included.delete(uid);
        break;
      }
      current = entries.get(current).parentUid;
    }
  }
  return included;
}

export function framePaintLayer(asset) {
  const frame = activeTextureFrame(asset), included = frameLayerUids(asset, frame), layers = asset?.layers || [];
  const valid = layer => layer && layer.type !== 'group' && !layer.locked && included.has(layer.uid);
  const saved = layers.find(layer => layer.uid === frame?.paintLayerUid);
  if (valid(saved)) return saved;
  const children = new Map();
  for (const layer of layers) {
    const key = layer.parentUid || null;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(layer);
  }
  const pending = [...(children.get(null) || [])], seen = new Set();
  while (pending.length) {
    const layer = pending.pop();
    if (seen.has(layer.uid)) continue;
    seen.add(layer.uid);
    if (valid(layer)) return layer;
    if (layer.type === 'group') pending.push(...(children.get(layer.uid) || []));
  }
  return null;
}
export function rememberFramePaintLayer(asset, uid) {
  const frame = activeTextureFrame(asset), layer = asset?.layers?.find(entry => entry.uid === uid);
  if (!frame || !layer || layer.type === 'group' || layer.locked || !frameLayerUids(asset, frame).has(uid) || frame.paintLayerUid === uid) return false;
  frame.paintLayerUid = uid;
  return true;
}
export function setFrameLayerVisibility(asset, uid, visible) {
  const frame = activeTextureFrame(asset);
  if (!frame || !frameVisibilityControls(asset, frame).has(uid)) return false;
  asset.animation = { ...asset.animation, frames: asset.animation.frames.map(entry => entry === frame ? { ...frame, visibility: { ...frame.visibility, [uid]: visible } } : entry) };
  return true;
}

export function setFrameLayerLink(asset, frameUid, layerUid, connected) {
  const frames = asset?.animation?.frames;
  if (!Array.isArray(frames) || layerUid !== FRAME_ROOT_UID && !asset.layers?.some(layer => layer.uid === layerUid)) return false;
  const frame = frames.find(entry => entry.uid === frameUid);
  if (!frame) return false;
  const links = new Set(frame.layerUids || []);
  if (links.has(layerUid) === connected) return false;
  if (connected) links.add(layerUid); else links.delete(layerUid);
  asset.animation = { ...asset.animation, frames: frames.map(entry => entry === frame ? { ...frame, layerUids: [...links] } : entry) };
  return true;
}
