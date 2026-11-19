import { PAINT_SHAPE_TOOLS } from '../editor/tool-registry.js';
import { shortcutHeld } from '../screen/shortcuts.js';

// Shared by the 2D and 3D surfaces, before either surface handles navigation.
export function createPaintSizeWheelHandler({ state, sceneCanvas, texturePreview, sizeInput, updateToolOptions, updateTextureBrushCursor }) {
  let remainder = 0, previousAt = 0, previousSurface = null, previousTool = null;
  return event => {
    const surface = sceneCanvas.contains(event.target) ? sceneCanvas : texturePreview.contains(event.target) ? texturePreview : null;
    const delta = Number(event.deltaY || event.deltaX || 0);
    if (event.defaultPrevented || state.mode !== 'paint' || !surface || !Number.isFinite(delta) || !delta
      || !shortcutHeld('brushSizeWheel', event) || shortcutHeld('temporaryEyedropper', event)
      || !(state.tool === 'brush' || PAINT_SHAPE_TOOLS.includes(state.tool))) {
      remainder = 0;
      return false;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const now = performance.now();
    if (surface !== previousSurface || state.tool !== previousTool || now - previousAt > 180
      || Math.sign(remainder) !== Math.sign(delta)) remainder = 0;
    previousSurface = surface; previousTool = state.tool; previousAt = now;
    // Normalize mouse notches; accumulate fine trackpad motion instead of
    // treating each tiny delta as an entire pixel of brush-size change.
    remainder += event.deltaMode || Math.abs(delta) >= 40 ? Math.sign(delta) * 40 : delta;
    const ticks = Math.trunc(remainder / 40);
    remainder -= ticks * 40;
    if (!ticks) return true;
    const current = state.tool === 'brush' ? state.paintBrushSize : state.paintToolSettings[state.tool].size;
    const size = Math.max(1, Math.min(64, (Math.round(Number(current)) || 1) - ticks));
    if (state.tool === 'brush') state.paintBrushSize = size;
    else state.paintToolSettings[state.tool].size = size;
    sizeInput.value = String(size);
    updateToolOptions();
    if (surface === texturePreview) updateTextureBrushCursor(event);
    return true;
  };
}
