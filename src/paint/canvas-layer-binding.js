// A stroke keeps its starting paint layer while animated frame display moves on.
const bindings = new WeakMap();
const editableSources = new WeakMap();
export function rememberEditablePaintSource(asset, canvas, layer = null) {
  if (asset && canvas) editableSources.set(canvas, { asset, uid: layer?.uid, source: layer?.source ?? asset.source });
}
export function editablePaintSourceMatches(asset, canvas, layer = null) {
  const entry = editableSources.get(canvas);
  return entry?.asset === asset && entry.uid === layer?.uid && entry.source === (layer?.source ?? asset.source);
}
export function bindPaintCanvas(asset, canvas, uid) {
  if (asset && canvas) bindings.set(canvas, { asset, uid });
}
export function boundPaintLayer(asset, canvas) {
  const binding = canvas && bindings.get(canvas);
  return binding?.asset === asset ? asset.layers?.find(layer => layer.uid === binding.uid) || null : null;
}
export function paintCanvasIsBound(canvas) { return bindings.has(canvas); }
export function releasePaintCanvas(canvas) {
  if (bindings.delete(canvas) && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('cubebricks:paint-canvas-released', { detail: canvas }));
}
