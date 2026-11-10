import assert from 'node:assert/strict';
import { Cube, CubeBricksProject } from '../src/model.js';
import { createTextureTemplateController } from '../src/texture/template-controller.js';

const source = { _uid: 'source', id: 'source', name: 'source.png', uvWidth: 64, uvHeight: 64 };
const faceNames = ['north', 'south', 'east', 'west', 'up', 'down'];
const original = new Cube({
  size: [2, 2, 2], uvMode: 'face', autoUv: false,
  faces: Object.fromEntries(faceNames.map(name => [name, { uv: [0, 0, 2, 2], texture: '#source' }]))
});
const copy = new Cube(structuredClone(original));
copy.uid = 'copied-cube';
const project = new CubeBricksProject({ elements: [original, copy], outliner: [original.uid, copy.uid] });
const [storedOriginal, storedCopy] = project.elements;
const state = { project, textureAssets: [source], activeTextureUid: source._uid, history: [] };
const fakeContext = {
  clearRect() {}, fillRect() {}, strokeRect() {}, drawImage() {},
  set imageSmoothingEnabled(value) {}, set fillStyle(value) {}, set strokeStyle(value) {}, set lineWidth(value) {}
};
const fakeCanvas = () => ({
  width: 1, height: 1, getContext: () => fakeContext,
  toDataURL: () => 'data:image/png;base64,AAAA'
});
const oldDocument = globalThis.document;
globalThis.document = { createElement: name => name === 'canvas' ? fakeCanvas() : null };
const progress = { max: 0, value: 0 };
const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
const controls = new Map([
  ['#textureProgressDialog', dialog], ['#textureGenerationProgress', progress],
  ['#textureGenerationStatus', { textContent: '' }], ['#textureGenerationCounter', { textContent: '' }]
]);
try {
  const controller = createTextureTemplateController({
    state, $: selector => controls.get(selector), CUBE_FACE_NAMES: faceNames,
    getSelectionExpansion: () => ({ elementSet: new Set() }), isProceduralShape: () => false,
    getSubdivisionSession: () => null, subdivisionPatch: () => null, syncSubdivisionEdits() {},
    invalidateUvPreviewTextureState() {}, renderTextureList() {}, activateProjectTexture() {},
    markDirty() {}, snapshot() {}, toast() {}, setCubeFaceCulled() {}, invalidateAllRenderGeometry() {},
    renderAll() {}, activeSnapSubdivisions: () => 16,
    textureAssetForReference: reference => reference === '#source' ? source : null,
    loadTextureAssetImage: async () => fakeCanvas()
  });
  await controller.createTextureTemplate({
    name: 'new.png', selectedOnly: false, cleanInvalidFaces: false,
    boxUv: false, powerOfTwo: false, keepMultiTexture: false, keepLayers: false,
    paddingEnabled: false, padding: 0, multiple: 4
  });
  assert.deepEqual(faceNames.map(name => storedOriginal.faces[name].uv),
    faceNames.map(name => storedCopy.faces[name].uv),
    'unchecked no-share option lets identical source UVs reuse one atlas slot across cubes');
  assert.equal(state.textureAssets.at(-1).templateUvIndependent, false);
  await controller.createTextureTemplate({
    name: 'all-faces.png', selectedOnly: false, cleanInvalidFaces: false,
    boxUv: false, powerOfTwo: false, keepMultiTexture: true, keepLayers: false,
    paddingEnabled: false, padding: 0, multiple: 4
  });
  const rectangles = [storedOriginal, storedCopy].flatMap(cube => faceNames.map(name => cube.faces[name].uv));
  assert.equal(new Set(rectangles.map(uv => uv.join(','))).size, rectangles.length,
    'face separation assigns each copied cube face a distinct rectangle');
  assert.equal(state.textureAssets.at(-1).templateUvIndependent, true);
  const copies = Array.from({ length: 30 }, (_, index) => {
    const cube = new Cube(structuredClone(original));
    cube.uid = `copied-cube-${index}`;
    project.elements.push(cube);
    project.outliner.push(cube.uid);
    return cube;
  });
  await controller.createTextureTemplate({
    name: 'box.png', selectedOnly: false, cleanInvalidFaces: false,
    boxUv: true, powerOfTwo: false, keepMultiTexture: true, keepLayers: false,
    paddingEnabled: false, padding: 0, multiple: 4
  });
  assert.equal(new Set([storedOriginal, storedCopy, ...copies].map(cube => cube.uv.join(','))).size, copies.length + 2,
    'box UV templates must reserve one distinct island per copied cube');
  console.log('Template duplicate UV tests passed.');
} finally {
  if (oldDocument === undefined) delete globalThis.document;
  else globalThis.document = oldDocument;
}
