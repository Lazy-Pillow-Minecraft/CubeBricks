// Native drag events can run a microtask checkpoint between capture and target
// listeners. Cleanup must wait for the next task, after every drop handler ran.
export function scheduleDropCleanup({ state, palette, clearOutlinerDropState,
  removeOutlinerDragGhost, clearTextureFaceDropTarget, renderTextureList }) {
  const outliner = state.outlinerDragUids, texture = state.textureDrag, color = palette.draggedColor;
  return setTimeout(() => {
    if (outliner?.length && state.outlinerDragUids === outliner) {
      clearOutlinerDropState();
      removeOutlinerDragGhost();
      state.outlinerDragUids = null;
    }
    if (texture && state.textureDrag === texture) {
      state.textureDrag = null;
      clearTextureFaceDropTarget();
      renderTextureList();
    }
    if (palette.draggedColor === color) palette.draggedColor = null;
  }, 0);
}
