export const inspectorDock = {
  id: 'inspector', index: 2, modes: ['edit', 'uv', 'paint'],
  defaultDock: 'right', defaultOrder: 0,
  defaultPosition: { x: 920, y: 104 }, defaultSize: { width: 292, height: 340 },
  defaultCollapsed: false,
  heightSnap: {
    modes: ['paint'],
    chromeHeight(panel) {
      const picker = panel.element.querySelector('.dock-color-picker');
      const stage = picker?.querySelector('.color-picker-stage');
      if (!stage) return null;
      const style = getComputedStyle(picker.parentElement);
      return panel.handle.offsetHeight + picker.offsetHeight - stage.offsetHeight
        + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 2;
    }
  }
};
