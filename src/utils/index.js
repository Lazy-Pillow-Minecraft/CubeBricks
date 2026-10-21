import * as vector3 from './math/vector3.js';
import * as rotation from './math/rotation.js';
import * as templatePacker from './template-packer.js';
import * as bezierGeometry from './shape/bezier-geometry.js';
import * as polyhedronGeometry from './shape/polyhedron-geometry.js';

// Shape packs are imported from data URLs, so they cannot import project-relative
// modules. Keep every public utility reachable through this single API object.
export const shapePackUtils = Object.freeze({
  math: Object.freeze({ vector3, rotation }),
  shape: Object.freeze({ bezierGeometry, polyhedronGeometry }),
  templatePacker
});
