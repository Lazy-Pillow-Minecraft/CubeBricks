import * as vector3 from './math/vector3.js';
import * as rotation from './math/rotation.js';
import * as templatePacker from './template-packer.js';
import * as bezierGeometry from './shape/bezier-geometry.js';
import * as polyhedronGeometry from './shape/polyhedron-geometry.js';
import * as javaCurveFit from './shape/java-curve-fit.js';
import * as formatConstraints from '../common/core/format-constraints.js';
import * as proceduralFormat from '../common/core/procedural-format.js';
import * as png from './image/png-pixels.js';
import * as rasterCache from './image/raster-cache.js';

// Shape packs are imported from data URLs, so they cannot import project-relative
// modules. Keep every public utility reachable through this single API object.
export const shapePackUtils = Object.freeze({
  math: Object.freeze({ vector3, rotation }),
  shape: Object.freeze({ bezierGeometry, polyhedronGeometry, javaCurveFit }),
  format: Object.freeze({ constraints: formatConstraints, procedural: proceduralFormat }),
  image: Object.freeze({ png, rasterCache }),
  templatePacker
});
