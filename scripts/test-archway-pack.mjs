import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Shape } from '../src/model.js';
import { shapeRegistry } from '../src/shapes/builtins.js';
import { rotateVector } from '../src/utils/math/rotation.js';

const require = createRequire(import.meta.url);
const { loadShapePack } = require('../electron/shape-packs.cjs');
const pack = await loadShapePack(path.resolve('packs/Archway.zip'), {
  name: 'Archway.zip',
  isFile: () => true,
  isDirectory: () => false
});
const record = pack?.shapes[0];
assert.ok(record, 'the distributable ZIP loads as a Shape pack');
const definition = (await import(`data:text/javascript;base64,${record.source}`)).default;
assert.deepEqual(definition.dimensionKeys, ['width', 'height', 'depth']);
shapeRegistry.register(definition, { external: true, pack: 'Archway' });

function bounds(cubes) {
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (const cube of cubes) for (let mask = 0; mask < 8; mask++) {
    const point = cube.position.map((value, axis) => value + ((mask >> axis) & 1) * cube.size[axis]);
    const rotated = rotateVector(point.map((value, axis) => value - cube.pivot[axis]), cube.rotation)
      .map((value, axis) => value + cube.pivot[axis]);
    rotated.forEach((value, axis) => { low[axis] = Math.min(low[axis], value); high[axis] = Math.max(high[axis], value); });
  }
  return { low, high };
}

try {
  const initial = new Shape({ shapeType: 'archway' }).toCubes();
  assert.equal(initial.length, 18);
  assert.ok(initial.every(cube => cube.size.every(value => Number.isFinite(value) && value > 0)));
  assert.ok(initial.some(cube => cube.position[1] === 0), 'the arch has legs on the floor');
  const first = bounds(initial);
  assert.ok(first.low[0] < -5.9 && first.high[0] > 5.9);
  assert.ok(first.low[1] >= -0.5 && first.high[1] >= 12);
  assert.ok(Math.abs(first.high[2] - first.low[2] - 2) < 1e-7);

  const edited = new Shape({ shapeType: 'archway', parameters: { width: 18, height: 16, depth: 5 } }).toCubes();
  const second = bounds(edited);
  assert.ok(second.high[0] - second.low[0] > first.high[0] - first.low[0]);
  assert.ok(second.high[1] - second.low[1] > first.high[1] - first.low[1]);
  assert.ok(Math.abs(second.high[2] - second.low[2] - 5) < 1e-7);
  console.log('Archway pack loads and responds to X, Y and Z dimensions.');
} finally {
  shapeRegistry.removeExternal();
}
