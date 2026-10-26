import { DockPanelRegistry } from './registry.js';
import { textureDock } from './texture.js';
import { uvPreviewDock } from './uv-preview.js';
import { inspectorDock } from './inspector.js';
import { outlinerDock } from './outliner.js';
import { paletteDock } from './palette.js';
import { layersDock } from './layers.js';
import { paintOperatorsDock } from './paint-operators.js';

// Only bundled panels are registered for now; there is no external pack loader.
export const dockPanelRegistry = new DockPanelRegistry();
dockPanelRegistry.registerMany([textureDock, uvPreviewDock, inspectorDock, outlinerDock, paletteDock, layersDock, paintOperatorsDock]);
