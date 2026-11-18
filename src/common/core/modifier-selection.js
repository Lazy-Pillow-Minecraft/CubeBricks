// Generated selections retain a stable stack branch, rather than a matrix key
// that changes whenever an owner or its modifier frame moves.
export function generatedSelection(hit, targetUid = hit.uid) {
  return { uid: hit.uid, targetUid, instanceKey: hit.instanceKey, variantKey: hit.variantKey };
}

export function findGeneratedInstance(instances, selection) {
  if (!selection) return null;
  return instances?.find(instance => instance.sourceUids.includes(selection.uid)
    && (selection.variantKey
      ? instance.selectionKeys?.[selection.uid]?.includes(selection.variantKey)
      : instance.key === selection.instanceKey)) || null;
}

export function generatedSelectionFrame(state, renderer) {
  if (!state.selectedGenerated || state.modifierResultGhost) return null;
  if (renderer.mirrorCache?.project && renderer.mirrorCache.project !== state.project) return null;
  if (!state.selectedUids.has(state.selectedGenerated.targetUid || state.selectedGenerated.uid)) return null;
  return renderer.getGeneratedSelectionInstance?.(state.selectedGenerated) || null;
}

export function generatedVector(frame, vector) {
  return frame ? frame.matrix.map(row => row.reduce((sum, value, axis) => sum + value * vector[axis], 0)) : [...vector];
}

export function sourceVector(frame, vector) {
  // Current geometry modifiers are rigid rotations/reflections, so their
  // inverse linear map is the transpose. Translation never affects a delta.
  return frame ? [0, 1, 2].map(axis => frame.matrix.reduce((sum, row, index) => sum + row[axis] * vector[index], 0)) : [...vector];
}

export function generatedPoint(frame, point) {
  return frame ? generatedVector(frame, point).map((value, axis) => value + frame.translation[axis]) : [...point];
}

export function sourcePoint(frame, point) {
  return sourceVector(frame, frame ? point.map((value, axis) => value - frame.translation[axis]) : point);
}

export function generatedRotationSign(frame) {
  return frame?.reflected ? -1 : 1;
}
