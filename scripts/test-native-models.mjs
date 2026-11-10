import assert from 'node:assert/strict';
import { decodeNativeJson, encodeNativeJson, nativeExportKind } from '../src/model/formats/native-json.js';
import { exportModdedJava, importModdedJava, javaClassName } from '../src/model/formats/modded-java.js';
import { importBlockbench, exportBlockbench } from '../src/model.js';

const java = {
  parent: 'minecraft:block/block', ambientocclusion: false, display: { gui: { rotation: [30, 45, 0] } },
  textures: { base: 'demo:block/red', alias: '#base' }, elements: [{
    from: [0, 1, 2], to: [4, 5, 6],
    rotation: { origin: [2, 3, 4], x: 30, y: 50, z: -15 }, shade: false,
    faces: { north: { texture: '#alias', uv: [1, 2, 7, 8], rotation: 90, tintindex: 0, cullface: 'north' } }
  }]
};
const parsed = decodeNativeJson(java, 'test.json');
assert.equal(decodeNativeJson({ ...java, groups: [{ name: 'editor_group', children: [0] }] }).meta.model_format, 'java_block',
  'optional Blockbench group metadata does not turn native Java JSON into a CubeBricks project');
assert.equal(parsed.meta.model_format, 'java_block');
assert.equal(parsed.textures.length, 1);
assert.equal(parsed.textures[0].resource, 'demo:block/red');
assert.equal(parsed.elements[0].faces.north.texture, 0);
assert.equal(parsed.elements[0].faces.up.texture, null);
assert.deepEqual(parsed.elements[0].rotation, [30, 50, -15]);
const round = encodeNativeJson(parsed, [{ resource: 'demo:block/red' }], 'java_block_item', parsed._cubebricksFormatData);
assert.deepEqual(round.elements[0].rotation, java.elements[0].rotation);
assert.deepEqual(round.elements[0].faces.north, { uv: [1, 2, 7, 8], texture: '#0', rotation: 90, cullface: 'north', tintindex: 0 });
assert.deepEqual(round.display, java.display);
assert.equal(round.ambientocclusion, false);
assert.equal(nativeExportKind('modded_entity'), 'java');
for (const format of ['generic_model', 'image', 'minecraft_skin']) assert.equal(nativeExportKind(format), null);
assert.throws(() => encodeNativeJson(parsed, [], 'modded_entity'));

const bedrock = {
  format_version: '1.21.0', 'minecraft:geometry': [{
    description: { identifier: 'geometry.test', texture_width: 64, texture_height: 32 },
    bones: [{ name: 'root', pivot: [2, 3, 4], rotation: [10, 20, 30] }, {
      name: 'child', parent: 'root', pivot: [5, 6, 7],
      cubes: [{
        origin: [-3, 2, 1], size: [4, 5, 6], pivot: [1, 2, 3], rotation: [10, 20, 30], inflate: .2,
        uv: {
          north: { uv: [1, 2], uv_size: [3, 4], material_instance: 'texture_0', uv_rotation: 90 },
          up: { uv: [10, 12], uv_size: [-4, -6], material_instance: 'texture_1' }
        }
      }],
      locators: { point: { offset: [2, 3, 4], rotation: [5, 6, 7] } }
    }]
  }]
};
const locations = [{ resource: 'textures/red', material: 'texture_0', id: '0', uv_width: 64, uv_height: 32 },
{ resource: 'textures/blue', material: 'texture_1', id: '1', uv_width: 64, uv_height: 32 }];
const b = decodeNativeJson(bedrock, 'test.geo.json', locations, 'bedrock_block');
assert.equal(b.meta.model_format, 'bedrock_block');
assert.deepEqual(b.outliner[0].origin, [-2, 3, 4]);
assert.deepEqual(b.outliner[0].rotation, [-10, -20, 30]);
assert.deepEqual(b.elements[0].from, [-1, 2, 1]);
assert.deepEqual(b.elements[0].faces.up.uv, [6, 6, 10, 12]);
assert.equal(b.elements[0].faces.down.texture, null);
const b2 = encodeNativeJson(b, locations, 'bedrock_block', b._cubebricksFormatData);
assert.deepEqual(b2['minecraft:geometry'][0], bedrock['minecraft:geometry'][0]);
const cycle = structuredClone(bedrock);
cycle['minecraft:geometry'][0].bones[0].parent = 'child';
assert.throws(() => decodeNativeJson(cycle));

const bb = {
  meta: { model_format: 'modded_entity' }, name: 'TestModel', resolution: { width: 64, height: 32 },
  textures: [{ id: '0', uuid: 'texture', uv_width: 64, uv_height: 32, source: 'unused' }],
  elements: [{
    uuid: 'cube',
    type: 'cube',
    name: 'cube',
    from: [-2, 0, -1],
    to: [2, 4, 1],
    box_uv: true,
    uv_offset: [3, 4],
    inflate: .2
  }],
  outliner: [{ uuid: 'root', name: 'Head', origin: [0, 4, 0], rotation: [0, 30, 0], children: ['cube'] }]
};
const output = await exportModdedJava(bb, 'TestModel.java', [{ filePath: 'texture.png', resource: 'demo:entity/test' }]);
assert.match(output, /public final class TestModel/);
assert.match(output, /PartPose\.offsetAndRotation/);
assert.match(output, /\.addBox\(-2\.0F, 0\.0F, -1\.0F, 4\.0F, 4\.0F, 2\.0F/);
assert.match(output, /LayerDefinition\.create\(mesh, 64, 32\)/);
const restored = await importModdedJava(output);
assert.deepEqual(restored.elements, bb.elements);
assert.deepEqual(restored.outliner, bb.outliner);
assert.equal(restored.textures[0].source, undefined);
await assert.rejects(() => importModdedJava(output.replace('4.0F', '5.0F')), /已被修改/);
await assert.rejects(() => importModdedJava(output + '\n'), /已被修改/);
await assert.rejects(() => importModdedJava('public class Arbitrary {}'), /未经修改/);
await assert.rejects(() => exportModdedJava(bb, 'class.java', []), /合法/);
assert.equal(javaClassName('class'), 'Model_class');
const cubeProject = importBlockbench(decodeNativeJson({ elements: [{ from: [0, 0, 0], to: [2, 2, 2], rotation: { axis: 'y', angle: 22.5, rescale: true }, faces: {} }] }));
assert.equal(cubeProject.elements[0].rescale, true);
assert.equal(exportBlockbench(cubeProject).elements[0].rescale, true);
console.log('Native Java/Bedrock JSON, hierarchy, UV orientation, Java code and strict unchanged-source reimport passed.');
