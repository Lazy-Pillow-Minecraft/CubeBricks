// Bezier variants share curve sampling; this file owns the 2D type metadata.
export default { id: 'bezier2d', label: '二維貝塞爾', icon: 'shape',
  defaults: { thickness: 1, segmentationMode: 'distance', segmentLength: 1, angleStep: 10 },
  generate(curve, api) { return api.bezierCubes(curve); } };
