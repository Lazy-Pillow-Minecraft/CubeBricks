// The editable DOM canvas is reused for every texture. Per-texture caches own
// their pixels so selecting another texture cannot replace a previous image.
const snapshots = new WeakMap();
const historyRegions = [];
let historyRegionBytes = 0;
export function rememberPaintHistoryRegion(before, after, region) {
  if (!before || !after || before === after || !region) return;
  historyRegions.push({ before, after, region });
  historyRegionBytes += before.length + after.length;
  while (historyRegions.length > 16 || historyRegionBytes > 32 * 1024 * 1024) {
    const old = historyRegions.shift();
    historyRegionBytes -= old.before.length + old.after.length;
  }
}
export function paintHistoryRegion(before, after) {
  if (!before || !after || before === after) return null;
  return historyRegions.findLast(entry => entry.before === before && entry.after === after
    || entry.before === after && entry.after === before)?.region || null;
}
export function snapshotEditableTexture(asset, source, editableCanvas, dirty = null) {
  if (!asset || source !== editableCanvas) return source;
  let snapshot = snapshots.get(asset), patch = dirty && snapshot?.width === source.width && snapshot?.height === source.height;
  if (!snapshot) {
    snapshot = document.createElement('canvas');
    snapshots.set(asset, snapshot);
  }
  if (snapshot.width !== source.width || snapshot.height !== source.height) {
    snapshot.width = source.width;
    snapshot.height = source.height;
    patch = false;
  }
  const context = snapshot.getContext('2d');
  context.imageSmoothingEnabled = false;
  if (patch) {
    context.clearRect(dirty.x, dirty.y, dirty.width, dirty.height);
    context.drawImage(source, dirty.x, dirty.y, dirty.width, dirty.height, dirty.x, dirty.y, dirty.width, dirty.height);
  }
  else {
    context.clearRect(0, 0, snapshot.width, snapshot.height);
    context.drawImage(source, 0, 0);
  }
  return snapshot;
}
