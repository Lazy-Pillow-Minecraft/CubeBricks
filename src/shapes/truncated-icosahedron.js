import { constrainBuiltinShape } from '../common/core/procedural-format.js';
export default {
  id: 'truncated_icosahedron', label: '足球（截角二十面體）', icon: 'truncated-icosahedron',
  defaults: { radius: 4, snapMode: 'edge' },
  constrainFormat: constrainBuiltinShape,
  supportsFormat: rules => !rules.javaBlock || !rules.singleAxisRotation,
  generate(shape, api) { return api.regularPolyhedron(api.truncatedIcosahedronFaces, true); }
};
