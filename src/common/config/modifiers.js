import { ModifierRegistry } from '../core/modifier-registry.js';
import { constrainSymmetryFormat, constrainCopyFormat } from '../core/modifier-format.js';

export const modifierRegistry = new ModifierRegistry({ globalFormatHooks: true });

modifierRegistry.register({
  id: 'symmetry',
  constrainFormat: constrainSymmetryFormat,
  label: '對稱',
  allowMultiple: true,
  targets: ['group', 'cube', 'polygon_prism', 'dodecahedron', 'truncated_icosahedron', 'bezier2d', 'bezier3d', 'locator'],
  createDefault: () => ({
    mode: 'axes',
    axes: { x: true, y: false, z: false },
    copies: 3,
    distribution: 'full',
    rangeStart: 0,
    rangeEnd: 180,
    wrapParent: true,
    ignoreDuplicateCubes: true,
    anchor: { position: [0, 0, 0], rotation: [0, 0, 0] }
  })
});

modifierRegistry.register({
  id: 'element_copy',
  constrainFormat: constrainCopyFormat,
  label: '元素拷貝',
  allowMultiple: true,
  targets: ['group', 'cube', 'polygon_prism', 'dodecahedron', 'truncated_icosahedron', 'bezier2d', 'bezier3d'],
  createDefault: () => ({ nodes: [] })
});

