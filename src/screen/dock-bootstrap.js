import { DockManager } from './dock-manager.js';
import { dockPanelRegistry } from './docks/builtin.js';
import { ConfigKey, configRegistry } from '../common/config/app-config.js';

export function createDockSystem({
  state, $, stopUvPreviewAnimation, refreshUvPreview,
  uvPreviewController,
  syncTexturePreviewPriority, scheduleOutlinerWindow, renderScene, toast
}) {
  const dockManager = new DockManager({
    root: $('.workspace'),
    definitions: dockPanelRegistry.list(),
    heightSnapping: configRegistry.get(ConfigKey.DOCK_HEIGHT_SNAP),
    onStorageError: () => toast('ui.dock-layout-save-failed'),
    onInteraction: active => {
      state.layoutResizing = active;
      if (active) stopUvPreviewAnimation();
      else requestAnimationFrame(refreshUvPreview);
    },
    onLayoutChange: () => {
      uvPreviewController.uvPreviewRenderDirty = true;
      syncTexturePreviewPriority();
      scheduleOutlinerWindow();
      requestAnimationFrame(renderScene);
    }
  });
  dockManager.setMode(state.mode);
  configRegistry.subscribe(ConfigKey.DOCK_HEIGHT_SNAP, ({ value }) => dockManager.setHeightSnapping(value));
  return dockManager;
}
