import { ModifierRegistry } from '../core/modifier-registry.js';

export const modifierRegistry = new ModifierRegistry();

modifierRegistry.register({
  id: 'symmetry',
  label: '對稱',
  allowMultiple: false,
  targets: ['group', 'cube', 'polygon_prism', 'bezier2d', 'bezier3d', 'locator'],
  createDefault: () => ({
    mode: 'axes',
    axes: { x: true, y: false, z: false },
    copies: 3,
    distribution: 'full',
    rangeStart: 0,
    rangeEnd: 180,
    wrapParent: true,
    anchor: { position: [0, 0, 0], rotation: [0, 0, 0] }
  })
});

