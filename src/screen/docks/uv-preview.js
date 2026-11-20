export const uvPreviewDock = {
  id: 'uvPreview', index: 1, modes: ['edit', 'uv', 'paint'],
  defaultDock: 'left', defaultOrder: 1,
  defaultPosition: { x: 24, y: 520 }, defaultSize: { width: 236, height: 260 },
  defaultCollapsed: false,
  heightSnap: {
    chromeHeight(panel) {
      return panel.handle.offsetHeight + [...panel.element.querySelectorAll('.uv-face-actions, .uv-preview-options')]
        .reduce((height, controls) => height + controls.offsetHeight, 2);
    }
  }
};
