import assert from 'node:assert/strict';
import { resizeTextureRaster } from '../src/texture/resize-texture.js';
import { createTextureResizeController } from '../src/texture/resize-controller.js';
import { layerRasterCache } from '../src/common/core/texture-features.js';
import { captureResizeUvState, planTextureStretchUvs, restoreResizeUvState, stretchUvRectangle } from '../src/texture/resize-uv.js';
import { Cube, CubeBricksProject, Shape } from '../src/model.js';
import { getBlockbenchBoxUv } from '../src/common/core/geometry-utils.js';

const before = { pixels: [16, 16], uv: [16, 16] }, after = { pixels: [24, 8], uv: [24, 8] };
assert.deepEqual(stretchUvRectangle([2, 2, 6, 6], before, after), [3, 1, 9, 3]);
assert.deepEqual(stretchUvRectangle([6, 6, 2, 2], before, after), [9, 3, 3, 1], 'mirrored rectangles retain their endpoint order');
assert.deepEqual(stretchUvRectangle([-2, -2, 20, 20], before, after), [-3, -1, 30, 10], 'out-of-bounds UVs remain valid');
assert.deepEqual(stretchUvRectangle([.25, .5, 1.25, 2.5],
  { pixels: [64, 32], uv: [16, 16] }, { pixels: [96, 48], uv: [24, 24] }),
  [.5, 1, 2, 4], 'high-resolution imports snap physical pixels rather than logical UV units');

const texture = { _uid: 'asset', id: 'id', uuid: 'uuid', name: 'skin.png' };
const directions = ['north', 'east', 'south', 'west', 'up', 'down'];
const allFaces = reference => Object.fromEntries(directions.map(name => [name, { texture: reference }]));
const modelState = project => JSON.stringify({ elements: project.elements, groups: project.groups, outliner: project.outliner });
{
  const cube = new Cube({ uid: 'face-cube', uvMode: 'face', faces: {
    north: { texture: '#id', uv: [2, 2, 6, 6], rotation: 90 },
    south: { texture: 'other', uv: [5, 4, 1, 2] }, east: null,
    west: { texture: null, _cubebricksCulledTexture: 'uuid', uv: [6, 6, 2, 2] }
  } });
  const project = new CubeBricksProject({ formatId: 'bedrock_entity', elements: [cube] });
  const original = modelState(project);
  const plan = planTextureStretchUvs(project, texture, [texture], before, after);
  assert.equal(modelState(project), original, 'preparing UV changes is atomic and does not edit the project');
  plan.apply();
  const current = project.getNode(cube.uid);
  assert.deepEqual(current.faces.north, { texture: '#id', uv: [3, 1, 9, 3], rotation: 90 });
  assert.deepEqual(current.faces.south, cube.faces.south, 'other textures on the same cube keep their own UVs');
  assert.equal(current.faces.east, null);
  assert.deepEqual(current.faces.west, { texture: null, _cubebricksCulledTexture: 'uuid', uv: [9, 3, 3, 1] });
  const redo = captureResizeUvState(project, plan.previous);
  restoreResizeUvState(project, plan.previous);
  assert.equal(modelState(project), original, 'undo restores UVs and culling exactly');
  restoreResizeUvState(project, redo);
  assert.deepEqual(current.faces.north.uv, [3, 1, 9, 3]);
}
for (const reference of ['asset', '#uuid', 'id', '#id', 'skin.png', 0, '#0']) {
  const project = new CubeBricksProject({ formatId: 'bedrock_entity', elements: [new Cube({ uid: 'alias',
    uvMode: 'face', faces: { north: { texture: reference, uv: [2, 2, 6, 6] } } })] });
  planTextureStretchUvs(project, texture, [texture], before, after).apply();
  assert.deepEqual(project.getNode('alias').faces.north.uv, [3, 1, 9, 3], `texture alias ${reference}`);
}
{
  const other = { _uid: 'other', name: texture.name };
  const project = new CubeBricksProject({ formatId: 'bedrock_entity', elements: [new Cube({ uid: 'duplicate-name',
    uvMode: 'face', faces: { north: { texture: 'skin.png', uv: [2, 2, 6, 6] } } })] });
  planTextureStretchUvs(project, texture, [other, texture], before, after).apply();
  assert.deepEqual(project.getNode('duplicate-name').faces.north.uv, [2, 2, 6, 6],
    'a duplicate texture name does not resize UVs that resolve to a different asset');
}
{
  const project = new CubeBricksProject({ formatId: 'bedrock_entity', elements: [new Cube({ uid: 'box',
    size: [2, 3, 1], uv: [1, 2], faces: allFaces('id') })] });
  const cube = project.getNode('box');
  const oldUv = getBlockbenchBoxUv(cube, 'north');
  planTextureStretchUvs(project, texture, [texture], before,
    { pixels: [32, 32], uv: [32, 32] }).apply();
  assert.equal(cube.uvMode, 'box', 'an exactly representable uniform stretch retains box UV');
  assert.deepEqual(getBlockbenchBoxUv(cube, 'north'), oldUv.map(value => value * 2));
  const south = getBlockbenchBoxUv(cube, 'south');
  cube.faces.south.texture = 'other';
  planTextureStretchUvs(project, texture, [texture], { pixels: [32, 32], uv: [32, 32] }, after).apply();
  assert.equal(cube.uvMode, 'face', 'non-uniform / mixed-texture box UV materializes into exact face rectangles');
  assert.deepEqual(cube.faces.south.uv, south);
}
{
  const project = new CubeBricksProject({ formatId: 'modded_entity', elements: [new Cube({ uid: 'restricted-box',
    size: [2, 3, 1], faces: allFaces('id') })] });
  const initial = modelState(project);
  assert.throws(() => planTextureStretchUvs(project, texture, [texture], before, after), /box-uv-limit/);
  assert.equal(modelState(project), initial, 'an unrepresentable fixed-box resize fails before any UV is changed');
  planTextureStretchUvs(project, texture, [texture], before, { pixels: [32, 32], uv: [32, 32] }).apply();
  assert.equal(project.getNode('restricted-box').uvMode, 'box');
  assert.equal(project.getNode('restricted-box').uvScale, 2);
}
for (const liveEditing of [false, true]) {
  const shape = new Shape({ uid: 'shape', shapeType: 'polygon_prism', parameters: { sides: 4 },
    subdivisionEdits: { 0: { uvMode: 'face', autoUv: false, faces: { north: { texture: '#id', uv: [2, 2, 6, 6] } } } } });
  const project = new CubeBricksProject({ formatId: 'bedrock_entity', elements: [shape] });
  const owner = project.getNode('shape');
  if (liveEditing) { project.elements.push(...owner.toCubes(project)); project.invalidateHierarchyIndex(); }
  const initial = modelState(project);
  const plan = planTextureStretchUvs(project, texture, [texture], before, after);
  plan.apply();
  assert.deepEqual(owner.toCubes(project)[0].faces.north.uv, [3, 1, 9, 3], 'procedural edits survive regeneration');
  if (liveEditing) assert.deepEqual(project.getNode('shape::subdivision::0').faces.north.uv, [3, 1, 9, 3]);
  const restored = new CubeBricksProject(JSON.parse(project.serialize()));
  assert.deepEqual(restored.getNode('shape').toCubes(restored)[0].faces.north.uv, [3, 1, 9, 3]);
  restoreResizeUvState(project, plan.previous);
  assert.equal(modelState(project), initial, 'undo restores shape UV patches and active subdivision cubes together');
}

{
  const project = new CubeBricksProject({ formatId: 'bedrock_entity', elements: [new Shape({ uid: 'box-shape',
    shapeType: 'polygon_prism', parameters: { sides: 4 }, subdivisionEdits: { 0: { faces: allFaces('id') } } })] });
  planTextureStretchUvs(project, texture, [texture], before, { pixels: [32, 32], uv: [32, 32] }).apply();
  const cube = project.getNode('box-shape').toCubes(project)[0];
  if (cube.uvMode === 'box') assert.equal(cube.uvScale, 2, 'box UV density is preserved in procedural patches');
  const roundTrip = new CubeBricksProject(JSON.parse(project.serialize()));
  assert.deepEqual(roundTrip.getNode('box-shape').toCubes(roundTrip)[0].faces, cube.faces);
}

// A small software Canvas checks exact pixel placement without a browser.
class Canvas {
  width = 0;
  height = 0;
  pixels = [];
  toDataURL() { return JSON.stringify([this.width, this.height, this.pixels]); }
  getContext() {
    const destination = this;
    return {
      imageSmoothingEnabled: true,
      createPattern: source => source,
      fillRect(x, y, width, height) {
        for (let row = 0; row < height; row++) {
          for (let column = 0; column < width; column++) {
            const source = this.fillStyle;
            destination.pixels[row * destination.width + column] =
              source.pixels[(row % source.height) * source.width + column % source.width];
          }
        }
      },
      drawImage(source, x, y, width = source.width, height = source.height) {
        assert.equal(this.imageSmoothingEnabled, false);
        for (let row = 0; row < Math.min(height, destination.height); row++) {
          for (let column = 0; column < Math.min(width, destination.width); column++) {
            destination.pixels[row * destination.width + column] =
              source.pixels[Math.floor(row * source.height / height) * source.width
                + Math.floor(column * source.width / width)];
          }
        }
      }
    };
  }
}
const savedDocument = globalThis.document;
globalThis.document = { createElement: () => new Canvas() };
try {
  const source = Object.assign(new Canvas(), { width: 2, height: 2, pixels: [1, 2, 3, 0] });
  const crop = resizeTextureRaster(source, 3, 3, 'crop');
  assert.deepEqual(Array.from({ length: 9 }, (_, i) => crop.pixels[i] || 0), [1, 2, 0, 3, 0, 0, 0, 0, 0]);
  assert.deepEqual(resizeTextureRaster(source, 1, 1, 'crop').pixels, [1]);
  assert.deepEqual(resizeTextureRaster(source, 3, 3, 'repeat').pixels, [1, 2, 1, 3, 0, 3, 1, 2, 1]);
  assert.deepEqual(resizeTextureRaster(source, 4, 2, 'stretch').pixels, [1, 1, 2, 2, 3, 3, 0, 0]);
  assert.deepEqual(source.pixels, [1, 2, 3, 0], 'resizing leaves the source untouched');
  for (const [width, height, mode] of [[0, 2, 'crop'], [2, 8193, 'repeat'], [2.5, 2, 'crop'], [2, 2, 'unknown']]) {
    assert.throws(() => resizeTextureRaster(source, width, height, mode), RangeError);
  }
  const control = () => ({ value: '', disabled: false, events: {},
    addEventListener(name, handler) { this.events[name] = handler; }, focus() {}, select() {} });
  const controls = new Map(['Dialog', 'Form', 'Width', 'Height', 'Status', 'Apply', 'Name', 'Cancel']
    .map(name => [`#textureResize${name}`, control()]));
  const $ = selector => controls.get(selector);
  const dialog = $('#textureResizeDialog'), form = $('#textureResizeForm');
  dialog.querySelector = () => control();
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.events.close(); };
  form.elements = { resizeMode: { value: 'crop' } };
  form.reportValidity = () => true;
  const asset = {
    _uid: 'resized', source: 'original', uvWidth: 1, uvHeight: 2,
    layers: [{ uid: 'resize-group', type: 'group' },
      { uid: 'resize-layer', source: 'layer', parentUid: 'resize-group', opacity: 50 }]
  };
  const project = new CubeBricksProject({ formatId: 'bedrock_entity', elements: [new Cube({ uid: 'resize-cube',
    uvMode: 'face', faces: { north: { texture: 'resized', uv: [0, .5, .5, 1.5] } } })] });
  const state = { project, textureAssets: [asset] };
  layerRasterCache.set('resize-layer', { canvas: source, savedSource: 'layer' });
  const operations = [], refreshes = [], historyEntries = [];
  const noop = () => {};
  const controller = createTextureResizeController({
    state, $, textureCanvas: source, activeTextureAsset: () => asset,
    finishLayerEdit: noop, finishPaintSelection: noop, loadTextureAssetImage: async () => source,
    pushTexturePaintHistory: (_asset, _canvas, _group, operation) => {
      operations.push(operation);
      const entry = {};
      historyEntries.push(entry);
      return entry;
    },
    livePaintTextureSources: new Map(), animationRasterCache: new Map(),
    invalidateUvPreviewTextureState: noop, showLayerComposite: () => refreshes.push('preview'),
    renderTextureFeatureControls: noop, renderLayerEditor: noop, renderTextureList: noop,
    rebuildTextureAtlas: () => refreshes.push('atlas'), invalidateAllRenderGeometry: () => refreshes.push('geometry'),
    markDirty: noop, renderScene: noop, toast: noop
  });
  await controller.open(asset);
  assert.equal(dialog.open, true);
  $('#textureResizeWidth').value = '4';
  $('#textureResizeHeight').value = '6';
  form.elements.resizeMode.value = 'stretch';
  await form.events.submit({ preventDefault() {} });
  assert.equal(dialog.open, false);
  assert.deepEqual(operations, ['core.texture.resize']);
  assert.equal(asset.uvWidth, 2);
  assert.equal(asset.uvHeight, 6);
  assert.equal(asset.layers[1].parentUid, 'resize-group');
  assert.equal(asset.layers[1].opacity, 50);
  assert.equal(layerRasterCache.get('resize-layer').canvas.height, 6);
  assert.deepEqual(refreshes, ['preview', 'atlas', 'geometry']);
  assert.deepEqual(project.getNode('resize-cube').faces.north.uv, [0, 2, 1, 5]);
  assert.deepEqual(historyEntries[0].textureResizeUvs[0].values.faces.north.uv, [0, .5, .5, 1.5],
    'one resize history operation includes the original UVs as well as the image');
  await controller.open(asset);
  const committedSource = asset.source;
  $('#textureResizeWidth').value = '0';
  await form.events.submit({ preventDefault() {} });
  assert.equal(asset.source, committedSource);
  assert.equal(operations.length, 1, 'invalid dimensions leave pixels and history untouched');
  assert.equal(dialog.open, true);
  layerRasterCache.delete('resize-layer');
} finally {
  if (savedDocument === undefined) delete globalThis.document;
  else globalThis.document = savedDocument;
}
console.log('Texture resize pixels, UV stretching / pixel snapping, aliases, box UV, Shape persistence and undo passed.');
