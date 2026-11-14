import { performanceMonitor } from '../utils/performance-monitor.js';
import { shortcutMatches, shortcutTriggerReleased } from './shortcuts.js';

// Dispatch clipboard commands by focus before falling through to editor tools.
export function bindWorkspaceShortcuts({
  state, $, $$, viewport, outliner, uvEditorController, inspectorController,
  shapeCreateMenu, openShapeCreateMenu, closeShapeCreateMenu, getPointerPosition,
  toast, beginTemporaryEyedropper, endTemporaryEyedropper, undo, redo, saveProject,
  exportProject, selectAllElements, handlePixelShortcut, copyTexture, cutTexture,
  pasteTexture, updateTransformGizmo, setRenderModeMenu, setReferenceImageMenu,
  referenceImages, setReferenceImageEditing, exitSubdivisionEdit, clearPaintGradientSelection,
  copySelected, cutSelected, pasteElements, deleteSelectedPaletteColor, removeActiveLayer,
  removeTexture, deleteSelected, setTool, addCube, cancelCameraFocus, renderScene,
  resetTextureView, focusSelectedTextureUvs, focusSceneOrigin, focusSelected,
  refreshKnifeFromModifierEvent
}) {
  // Focus-specific clipboard commands run before the global shortcuts.
  window.addEventListener('keydown', event => {
    if (state.projectHomeActive || event.defaultPrevented || event.isComposing) return;
    if (!event.repeat && shortcutMatches(event, 'performance')) {
      event.preventDefault();
      toast('開始記錄 8 秒，請持續操作主視圖');
      performanceMonitor.capture(8000).then(async report => {
        try {
          await navigator.clipboard.writeText(JSON.stringify(report));
          toast('性能記錄已複製到剪貼板');
        } catch {
          console.info('CubeBricks performance report', report);
          toast('無法複製性能記錄，請查看開發者工具');
        }
      });
      return;
    }
    if (!event.repeat && shortcutMatches(event, 'temporaryEyedropper') && beginTemporaryEyedropper()) {
      event.preventDefault();
      return;
    }
    if (shortcutMatches(event, 'undo') || shortcutMatches(event, 'redo')) {
      if (event.target instanceof Element
        && (event.target.closest('input, textarea, [contenteditable]') || event.target.isContentEditable)) return;
      event.preventDefault();
      shortcutMatches(event, 'redo') ? redo() : undo();
      return;
    }
    if (shortcutMatches(event, 'save') || shortcutMatches(event, 'export')) {
      event.preventDefault();
      if (!event.repeat) shortcutMatches(event, 'export') ? exportProject() : saveProject();
      return;
    }
    if (event.target instanceof Element
      && (event.target.closest('input, select, textarea, [contenteditable]') || event.target.isContentEditable)) return;
    if (state.mode === 'display') return;
    if (shortcutMatches(event, 'selectAll')
      && event.target instanceof Element
      && (viewport.contains(event.target) || outliner.contains(event.target))) {
      event.preventDefault();
      selectAllElements();
      return;
    }
    const focus = document.activeElement;
    const textureListFocused = focus?.closest('#textureList');
    const texturePanelFocused = focus?.closest('[data-panel="texture"]')
      || focus === document.body && uvEditorController.focusedDockHotspot === 'texture';
    if (texturePanelFocused) {
      const pixelCommand = ['cut', 'copy', 'paste', 'duplicate'].find(id => shortcutMatches(event, id));
      if (pixelCommand && handlePixelShortcut(pixelCommand, {
        repeat: event.repeat, allowUnselectedPaste: !textureListFocused
      })) {
        event.preventDefault();
        return;
      }
    }
    if (textureListFocused) {
      if (shortcutMatches(event, 'copy')) {
        event.preventDefault();
        copyTexture();
        return;
      }
      if (shortcutMatches(event, 'cut')) {
        event.preventDefault();
        cutTexture();
        return;
      }
      if (shortcutMatches(event, 'paste')) {
        event.preventDefault();
        pasteTexture();
        return;
      }
      if (shortcutMatches(event, 'duplicate')) {
        event.preventDefault();
        pasteTexture({ inPlace: true });
        return;
      }
    }
    if (shortcutMatches(event, 'temporaryEyedropper') && state.mode !== 'paint' && state.tool === 'rotate' && !state.rotationVertexPick) {
      event.preventDefault();
      state.rotationVertexPick = true;
      updateTransformGizmo();
    }
    if (shortcutMatches(event, 'dismiss')) {
      setRenderModeMenu(false);
      setReferenceImageMenu(false);
      if (referenceImages.editing) setReferenceImageEditing(false);
      closeShapeCreateMenu();
      if (inspectorController.subdivisionSession) exitSubdivisionEdit();
      clearPaintGradientSelection();
    }
    if (shortcutMatches(event, 'copy')) {
      event.preventDefault();
      copySelected();
      return;
    }
    if (shortcutMatches(event, 'cut')) {
      event.preventDefault();
      cutSelected();
      return;
    }
    if (shortcutMatches(event, 'paste')) {
      event.preventDefault();
      pasteElements();
      return;
    }
    if (shortcutMatches(event, 'duplicate')) {
      event.preventDefault();
      pasteElements({ inPlace: true });
      return;
    }
    if (shortcutMatches(event, 'delete')) {
      if (handlePixelShortcut('delete', { repeat: event.repeat })) {
        event.preventDefault();
        return;
      }
      const palette = $('#paletteRows');
      if (document.activeElement === palette || palette.contains(document.activeElement)) {
        event.preventDefault();
        if (!event.repeat) deleteSelectedPaletteColor();
        return;
      }
      if (focus?.closest?.('#textureFeatureControls, #layerEditorDialog')) {
        event.preventDefault();
        if (!event.repeat) removeActiveLayer().catch(error => toast(error.message));
        return;
      }
      if (focus?.closest?.('#textureList')) {
        event.preventDefault();
        if (!event.repeat) removeTexture();
        return;
      }
      if (state.mode !== 'paint') deleteSelected();
      return;
    }
    if (!document.querySelector('dialog[open]')) {
      if (shortcutMatches(event, 'previousTool') || shortcutMatches(event, 'nextTool')) {
        const tools = $$('.tool-lane .tool').filter(button => !button.disabled && button.getClientRects().length)
          .map(button => button.dataset.tool || state.paintShapeTool);
        if (tools.length) {
          const index = tools.indexOf(state.tool), step = shortcutMatches(event, 'previousTool') ? -1 : 1;
          const next = tools[index < 0 ? (step > 0 ? 0 : tools.length - 1) : (index + step + tools.length) % tools.length];
          event.preventDefault();
          if (next !== state.tool) {
            closeShapeCreateMenu();
            setTool(next);
          }
        }
        return;
      }
      if (state.mode === 'edit' && (shortcutMatches(event, 'addCube') || shortcutMatches(event, 'addShape'))) {
        event.preventDefault();
        if (!event.repeat) {
          if (shortcutMatches(event, 'addCube')) {
            closeShapeCreateMenu();
            addCube();
          }
          else if (shapeCreateMenu.hidden) {
            const [pointerX, pointerY] = getPointerPosition();
            openShapeCreateMenu(pointerX ?? window.innerWidth / 2, pointerY ?? window.innerHeight / 2);
          }
          else closeShapeCreateMenu();
        }
        return;
      }
    }
    if (shortcutMatches(event, 'zoomReset')) {
      cancelCameraFocus();
      state.zoom = 1.12;
      state.panX = 0;
      state.panY = 0;
      renderScene();
    }
    if (shortcutMatches(event, 'focus') || shortcutMatches(event, 'focusReset')) {
      event.preventDefault();
      if (uvEditorController.focusedDockHotspot === 'texture') shortcutMatches(event, 'focusReset') ? resetTextureView() : focusSelectedTextureUvs();
      else shortcutMatches(event, 'focusReset') ? focusSceneOrigin() : focusSelected();
    }
    if (state.mode === 'paint') {
      const paintShortcuts = { paintBrush: 'brush', paintLine: 'line', paintRectangle: 'rectangle', paintEllipse: 'ellipse', paintFill: 'fill', paintGradient: 'gradient', paintEyedropper: 'eyedropper' };
      const paintTool = Object.entries(paintShortcuts).find(([id]) => shortcutMatches(event, id))?.[1];
      if (paintTool) {
        event.preventDefault();
        setTool(paintTool);
      }
    }
    if (state.mode !== 'paint') {
      const shortcuts = { toolMove: 'move', toolResize: 'resize', toolRotate: 'rotate', toolPivot: 'pivot', toolVertexSnap: 'vertexSnap', toolKnife: 'knife', toolFaceSelect: 'faceSelect' };
      const tool = Object.entries(shortcuts).find(([id]) => shortcutMatches(event, id))?.[1];
      if (tool) setTool(tool);
    }
    if (state.tool === 'knife' && state.knifePointer && ['Shift', 'Control'].includes(event.key)) refreshKnifeFromModifierEvent(event);
  });
  window.addEventListener('keyup', event => {
    if (shortcutTriggerReleased(event, 'temporaryEyedropper') && state.rotationVertexPick) {
      state.rotationVertexPick = false;
      updateTransformGizmo();
      event.preventDefault();
    }
    if (shortcutTriggerReleased(event, 'temporaryEyedropper') && endTemporaryEyedropper()) {
      event.preventDefault();
      return;
    }
    if (state.tool === 'knife' && state.knifePointer && ['Shift', 'Control'].includes(event.key)) refreshKnifeFromModifierEvent(event);
  });
  window.addEventListener('blur', () => {
    endTemporaryEyedropper();
    if (state.rotationVertexPick) {
      state.rotationVertexPick = false;
      updateTransformGizmo();
    }
  });
}
