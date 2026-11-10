import { layerDescendantUids } from '../common/core/texture-features.js';

export function layerBranchEntries(layers, uid) {
  const root = layers?.find(layer => layer.uid === uid);
  if (!root) return [];
  const included = root.type === 'group' ? layerDescendantUids(layers, uid) : new Set();
  included.add(uid);
  return layers.filter(layer => included.has(layer.uid));
}

export function captureLayerBranch(layers, uid, sourceFor = layer => layer.source) {
  const entries = layerBranchEntries(layers, uid);
  if (!entries.length) return null;
  return {
    rootUid: uid, entries: entries.map(layer => {
      const copy = structuredClone(layer);
      if (layer.type !== 'group') copy.source = sourceFor(layer);
      if (layer.uid === uid) copy.parentUid = null;
      return copy;
    })
  };
}

export function instantiateLayerBranch(layers, clipboard, selectedUid, { inPlace = false, createUid = () => crypto.randomUUID() } = {}) {
  if (!clipboard?.entries?.length) return null;
  const selected = layers.find(layer => layer.uid === selectedUid);
  const parentUid = selected?.type === 'group' && !inPlace ? selected.uid : selected?.parentUid || null;
  const ids = new Map(clipboard.entries.map(layer => [layer.uid, createUid()]));
  const existing = new Set(layers.map(layer => layer.uid));
  const entries = clipboard.entries.map(layer => {
    const copy = structuredClone(layer);
    copy.uid = ids.get(layer.uid);
    copy.parentUid = layer.uid === clipboard.rootUid ? parentUid : ids.get(layer.parentUid) || null;
    if (copy.maskLayerUid) copy.maskLayerUid = ids.get(copy.maskLayerUid)
      || (existing.has(copy.maskLayerUid) ? copy.maskLayerUid : null);
    return copy;
  });
  const index = selected ? layers.indexOf(selected) + (selected.type === 'group' && !inPlace ? 0 : 1) : layers.length;
  const next = [...layers];
  next.splice(index, 0, ...entries);
  const frameVisibility = Object.fromEntries(Object.entries(clipboard.frameVisibility || {})
    .filter(([uid]) => ids.has(uid)).map(([uid, visible]) => [ids.get(uid), visible]));
  return { layers: next, entries, rootUid: ids.get(clipboard.rootUid), frameVisibility };
}

export function binarizePixelAlpha(pixels) {
  let changed = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0 && pixels[index] < 255) {
      pixels[index] = 255;
      changed++;
    }
  }
  return changed;
}
