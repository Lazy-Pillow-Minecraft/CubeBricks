export const DOCK_PANEL_DEFINITIONS = Object.freeze([
  { id: 'texture', index: 0, modes: ['edit', 'uv', 'paint'], hotspotFocus: true, defaultDock: 'left', defaultOrder: 0, defaultPosition: { x: 24, y: 104 }, defaultSize: { width: 236, height: 620 }, defaultCollapsed: false },
  { id: 'uvPreview', index: 1, modes: ['edit', 'uv', 'paint', 'animate'], defaultDock: 'left', defaultOrder: 1, defaultPosition: { x: 24, y: 520 }, defaultSize: { width: 236, height: 260 }, defaultCollapsed: false },
  { id: 'inspector', index: 2, modes: ['edit', 'uv', 'paint', 'animate'], defaultDock: 'right', defaultOrder: 0, defaultPosition: { x: 920, y: 104 }, defaultSize: { width: 292, height: 340 }, defaultCollapsed: false },
  { id: 'outliner', index: 3, modes: ['edit', 'uv', 'paint', 'animate'], defaultDock: 'right', defaultOrder: 1, defaultPosition: { x: 920, y: 460 }, defaultSize: { width: 292, height: 340 }, defaultCollapsed: false },
  { id: 'bottom', index: 4, modes: ['paint'], defaultDock: 'bottom', defaultOrder: 0, defaultPosition: { x: 280, y: 620 }, defaultSize: { width: 720, height: 176 }, defaultCollapsed: false }
]);
