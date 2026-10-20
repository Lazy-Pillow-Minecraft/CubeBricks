import { shapeRegistry } from './registry.js';
import polygonPrism from './polygon-prism.js';
import dodecahedron from './dodecahedron.js';
import truncatedIcosahedron from './truncated-icosahedron.js';
import bezier2d from './bezier-2d.js';
import bezier3d from './bezier-3d.js';

for (const definition of [polygonPrism, dodecahedron, truncatedIcosahedron, bezier2d, bezier3d]) {
  shapeRegistry.register(definition);
}

export { shapeRegistry };
