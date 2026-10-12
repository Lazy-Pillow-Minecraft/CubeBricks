import { OperatorRegistry } from '../core/operator-registry.js';

export const operatorRegistry = new OperatorRegistry();

operatorRegistry.register({
  id: 'paint_symmetry',
  label: '繪畫對稱',
  allowMultiple: true,
  targets: ['group', 'cube', 'polygon_prism', 'dodecahedron', 'truncated_icosahedron', 'bezier2d', 'bezier3d'],
  createDefault: () => ({
    mode: 'axes',
    axes: { x: true, y: false, z: false },
    copies: 4,
    distribution: 'full',
    rangeStart: 0,
    rangeEnd: 180,
    anchor: { position: [0, 0, 0], rotation: [0, 0, 0] }
  })
});
