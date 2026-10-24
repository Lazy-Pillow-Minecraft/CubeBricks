import { dockPanelRegistry } from './docks/builtin.js';

// Compatibility export for modules that still read the complete built-in list.
export const DOCK_PANEL_DEFINITIONS = Object.freeze(dockPanelRegistry.list());
