import { constrainBuiltinShape } from '../common/core/procedural-format.js';
export default {
  id: 'dodecahedron', label: '正十二面體', icon: 'dodecahedron',
  defaults: { radius: 4, snapMode: 'edge' },
  constrainFormat: constrainBuiltinShape,
  supportsFormat: rules => !rules.javaBlock || !rules.singleAxisRotation,
  generate(shape, api) { return api.regularPolyhedron(api.dodecahedronFaces, false); }
};
