export default {
  id: 'polygon_prism', label: '多邊形柱體', icon: 'polygon-prism',
  defaults: { radius: 4, height: 8, sides: 8, cubeSize: 1,
    innerRadiusEnabled: false, innerRadiusMode: 'radius', innerRadius: 2, snapMode: 'edge' },
  generate(shape, { Cube }) {
    const radius = Math.max(.001, Number(shape.parameters.radius) || 0);
    const height = Math.max(0, Number(shape.parameters.height) || 0);
    const sides = Math.max(3, Math.round(Number(shape.parameters.sides) || 3));
    const halfTurn = Math.PI / sides;
    const hollow = shape.parameters.innerRadiusEnabled === true;
    const outerApothem = radius * Math.cos(halfTurn);
    const edgeLength = 2 * radius * Math.sin(halfTurn);
    const innerValue = Math.max(0, Number(shape.parameters.innerRadius) || 0);
    const innerRadius = !hollow ? 0 : shape.parameters.innerRadiusMode === 'depth'
      ? Math.max(0, outerApothem - Math.min(outerApothem, innerValue))
      : Math.max(0, Math.min(outerApothem - .001, innerValue));
    const mergedOpposites = !hollow && sides % 2 === 0;
    return Array.from({ length: mergedOpposites ? sides / 2 : sides }, (_, index) => {
      const angle = Math.PI / 2 + (index + .5) * Math.PI * 2 / sides;
      const radial = [Math.cos(angle), Math.sin(angle)];
      const startRadius = mergedOpposites ? -outerApothem : innerRadius;
      const cubeLength = outerApothem - startRadius;
      const midpointRadius = (startRadius + outerApothem) / 2;
      const midpoint = radial.map(value => value * midpointRadius);
      return new Cube({
        name: `${shape.name}_${index + 1}`,
        position: [midpoint[0] - edgeLength / 2, 0, midpoint[1] - cubeLength / 2],
        size: [edgeLength, height, cubeLength], pivot: [midpoint[0], height / 2, midpoint[1]],
        rotation: [0, Math.atan2(radial[0], radial[1]) * 180 / Math.PI, 0],
        uvMode: shape.uvMode, uvNormalized: shape.uvNormalized, autoUv: shape.autoUv,
        exported: shape.exported, locked: shape.locked, shade: shape.shade, color: shape.color
      });
    });
  }
};
