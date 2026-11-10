import assert from 'node:assert/strict';
import { combinedAnimation, texturePlane, packExportPlanes, collectExportFaces, checkBakeSize, boxExportPlan } from '../src/texture/export-plan.js';
import { modelFormatRegistry } from '../src/common/config/model-formats.js';

const animated = (count, fps) => ({ animation: { enabled: true, frames: Array.from({ length: count }, () => ({})), fps } });
assert.deepEqual(combinedAnimation([animated(2, 10), animated(3, 20), {}]), { count: 6, fps: 15, animated: true });
assert.equal(combinedAnimation([animated(4, 12), animated(6, 24)]).count, 12);
assert.throws(() => combinedAnimation([animated(127, 10), animated(131, 10)]));
assert.throws(() => checkBakeSize(8192, 16384));
const faces = [{ face: { tiling: { offsetX: -3, offsetY: 5, width: 9, height: 7 } } },
{ face: { tiling: { offsetX: 5, offsetY: -3, width: 9, height: 7 } } }];
const plane = texturePlane({ mode: 'tiled' }, { width: 4, height: 4 }, faces);
assert.deepEqual(faces[0].pixelUv, [1, 1, 10, 8]);
assert.deepEqual(faces[0].pixelUv, faces[1].pixelUv, 'whole-period offsets share exactly the same UV area');
assert.deepEqual([plane.width, plane.height], [10, 8], 'two faces cost one shared periodic rectangle');
assert.equal(packExportPlanes([plane]).side, 16);
const bb = {
  textures: [{ uuid: 'first' }, { uuid: 'second' }], elements: [{
    from: [0, 0, 0], to: [2, 2, 2],
    box_uv: false, faces: {
      north: { texture: '#2', uv: [4, 3, 1, 0], rotation: 90 }, south: { texture: null },
      up: { texture: 'second', uv: [0, 0, 2, 2] }, down: { uv: [0, 0, 2, 2] }
    }
  }]
};
const entries = collectExportFaces(bb, [{ id: '2' }, { uuid: 'second' }]);
assert.deepEqual(entries.map(entry => [entry.name, entry.index]), [['north', 0], ['up', 1]]);
assert.deepEqual(entries[0].uv, [4, 3, 1, 0]);
bb.elements[0].faces.north.texture = 0;
assert.equal(collectExportFaces(bb, [{ uuid: 'first' }, { uuid: 'second', id: '0' }])[0].index, 0,
  'a copied texture display ID cannot override an earlier index reference');
assert.equal(modelFormatRegistry.resolve('bedrock').capabilities.singleTexture, true);
assert.equal(modelFormatRegistry.resolve('java_block').capabilities.singleTexture, false);
assert.equal(modelFormatRegistry.resolve('bedrock_block').capabilities.singleTexture, false);
const boxElement = { from: [0, 0, 0], to: [2, 2, 2] };
assert.equal(boxExportPlan({}, [{ element: boxElement, name: 'north', index: 0, pixelUv: [.5, .5, 2.5, 2.5], rotation: 0 }]).density, 2,
  'half-pixel UV phases are preserved in a doubled-resolution fixed box net');
assert.equal(boxExportPlan({}, [{ element: boxElement, name: 'north', index: 0, pixelUv: [1, 1, 10, 8], rotation: 0 }]).density, 63,
  'independent 9/2 and 7/2 tiling rates retain all pixel boundaries in their common box-net density');
console.log('Export frame periods, tiled overlap, face references and format capabilities passed.');
