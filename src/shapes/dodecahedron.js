export default {
  id: 'dodecahedron', label: '正十二面體', icon: 'dodecahedron',
  defaults: { radius: 4, snapMode: 'edge' },
  generate(shape, api) { return api.regularPolyhedron(api.dodecahedronFaces, false); }
};
