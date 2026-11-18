// The destination is an insertion boundary in the original target row, rather
// than a swatch index. This distinguishes dropping before and after a neighbor.
export function movePaletteColor(rows, dragged, rowId, insertionIndex) {
  if (!dragged) return null;
  const source = rows.find(row => row.id === dragged.rowId), target = rows.find(row => row.id === rowId);
  if (!source || !target || source.gradient || source.colorSpaceGradient || target.gradient || target.colorSpaceGradient
    || !Number.isInteger(dragged.index) || dragged.index < 0 || dragged.index >= source.colors.length
    || !Number.isFinite(insertionIndex)) return null;
  let index = Math.max(0, Math.min(target.colors.length, Math.trunc(insertionIndex)));
  if (source === target && dragged.index < index) index--;
  if (source === target && index === dragged.index) return null;
  const [color] = source.colors.splice(dragged.index, 1);
  target.colors.splice(index, 0, color);
  return { row: target, index };
}
