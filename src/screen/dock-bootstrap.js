import { DockManager } from './dock-manager.js';
import { dockPanelRegistry } from './docks/builtin.js';

export function createDockSystem({
  state, $, stopUvPreviewAnimation, refreshUvPreview,
  uvPreviewController, syncUvPreviewPanelAspect,
  syncTexturePreviewPriority, scheduleOutlinerWindow, renderScene
}) {
  const dockManager = new DockManager({
    root: $('.workspace'),
    definitions: dockPanelRegistry.list(),
    onInteraction: active => {
      state.layoutResizing = active;
      if (active) stopUvPreviewAnimation();
      else requestAnimationFrame(refreshUvPreview);
    },
    onLayoutChange: () => {
      uvPreviewController.uvPreviewRenderDirty = true;
      const [textureWidth = 16, textureHeight = 16] = state.project.textureSize || [];
      syncUvPreviewPanelAspect(Math.max(1, Number(textureWidth) || 1), Math.max(1, Number(textureHeight) || 1));
      syncTexturePreviewPriority();
      scheduleOutlinerWindow();
      requestAnimationFrame(renderScene);
    }
  });
  dockManager.setMode(state.mode);
  return dockManager;
}
