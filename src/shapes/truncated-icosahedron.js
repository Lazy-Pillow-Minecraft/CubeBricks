export default {
  id: 'truncated_icosahedron', label: '足球（截角二十面體）', icon: 'truncated-icosahedron',
  defaults: { radius: 4, snapMode: 'edge' },
  generate(shape, api) { return api.regularPolyhedron(api.truncatedIcosahedronFaces, true); }
};
