// Bezier variants share curve sampling; this file owns the 3D type metadata.
import { constrainBuiltinShape } from '../common/core/procedural-format.js';
export default { id: 'bezier3d', label: '三維貝塞爾', icon: 'shape',
  constrainFormat: constrainBuiltinShape,
  defaults: { thickness: 1, segmentationMode: 'distance', segmentLength: 1, angleStep: 10 },
  generate(curve, api) { return api.bezierCubes(curve); } };
