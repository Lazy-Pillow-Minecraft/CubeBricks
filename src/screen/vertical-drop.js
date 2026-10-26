// Resolve a vertical sort target without hit-testing the pointer's X position.
// Entries may be DOM elements or objects with numeric top/height bounds.
export function verticalDropTarget(entries, clientY) {
  if (!entries.length) return null;
  const bounds = entry => entry.getBoundingClientRect?.() || entry;
  const first = bounds(entries[0]);
  if (clientY < first.top) return { entry: entries[0], index: 0, position: 'before', ratio: 0 };
  let low = 0, high = entries.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const rect = bounds(entries[middle]);
    if (clientY < rect.top + (rect.height || Math.max(0, rect.bottom - rect.top))) high = middle;
    else low = middle + 1;
  }
  const index = Math.min(low, entries.length - 1);
  const entry = entries[index];
  const rect = bounds(entry);
  const height = rect.height || Math.max(0, rect.bottom - rect.top);
  const ratio = low === entries.length ? 1 : height ? Math.max(0, Math.min(1, (clientY - rect.top) / height)) : 0;
  return { entry, index, position: ratio < .5 ? 'before' : 'after', ratio };
}
