export default {
  id: 'archway',
  label: '拱門',
  defaults: { width: 12, height: 12, depth: 2, wall: 2, segments: 16 },
  dimensionKeys: ['width', 'height', 'depth'],
  fields: [
    { key: 'width', label: 'X 外寬', min: 0.1, step: 0.25 },
    { key: 'height', label: 'Y 總高', min: 0.1, step: 0.25 },
    { key: 'depth', label: 'Z 深度', min: 0.1, step: 0.25 },
    { key: 'wall', label: '拱壁厚度', min: 0.05, step: 0.25 },
    { key: 'segments', label: '拱頂分段', min: 4, step: 1 }
  ],
  constrainFormat(subject, context) {
    return context.utils.format.procedural.constrainBuiltinShape(subject, context);
  },
  generate(shape, { Cube }) {
    const value = (key, fallback) => {
      const number = Number(shape.parameters[key]);
      return Number.isFinite(number) ? number : fallback;
    };
    const width = Math.max(0.1, value('width', 12));
    const height = Math.max(0.1, value('height', 12));
    const depth = Math.max(0.1, value('depth', 2));
    const outerX = width / 2;
    const rise = Math.min(outerX, height);
    const spring = height - rise;
    const wall = Math.min(Math.max(0.05, value('wall', 2)), outerX * 0.95, rise * 0.95);
    const innerX = outerX - wall;
    const innerRise = rise - wall;
    const segments = Math.max(4, Math.min(96, Math.round(value('segments', 16))));
    const common = {
      uvMode: shape.uvMode, uvNormalized: shape.uvNormalized, autoUv: shape.autoUv,
      exported: shape.exported, locked: shape.locked, shade: shape.shade, color: shape.color
    };
    const cubes = [];
    const cube = (name, center, size, angle = 0) => new Cube({
      ...common, name: `${shape.name}_${name}`,
      position: center.map((coordinate, axis) => coordinate - size[axis] / 2),
      size, pivot: center, rotation: [0, 0, angle]
    });
    if (spring > 1e-6) {
      const legSize = [wall, spring, depth];
      cubes.push(cube('left', [-(outerX + innerX) / 2, spring / 2, 0], legSize));
      cubes.push(cube('right', [(outerX + innerX) / 2, spring / 2, 0], legSize));
    }
    const outer = angle => [outerX * Math.cos(angle), spring + rise * Math.sin(angle)];
    const inner = angle => [innerX * Math.cos(angle), spring + innerRise * Math.sin(angle)];
    for (let index = 0; index < segments; index++) {
      const first = index * Math.PI / segments;
      const last = (index + 1) * Math.PI / segments;
      const points = [outer(first), outer(last), inner(first), inner(last)];
      const start = outer(first).map((coordinate, axis) => (coordinate + inner(first)[axis]) / 2);
      const end = outer(last).map((coordinate, axis) => (coordinate + inner(last)[axis]) / 2);
      const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
      const tangent = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
      const normal = [-tangent[1], tangent[0]];
      const along = points.map(point => point[0] * tangent[0] + point[1] * tangent[1]);
      const across = points.map(point => point[0] * normal[0] + point[1] * normal[1]);
      const u0 = Math.min(...along), u1 = Math.max(...along);
      const v0 = Math.min(...across), v1 = Math.max(...across);
      const u = (u0 + u1) / 2, v = (v0 + v1) / 2;
      const center = [u * tangent[0] + v * normal[0], u * tangent[1] + v * normal[1], 0];
      cubes.push(cube(`arch_${index + 1}`, center, [u1 - u0, v1 - v0, depth],
        Math.atan2(tangent[1], tangent[0]) * 180 / Math.PI));
    }
    return cubes;
  }
};
