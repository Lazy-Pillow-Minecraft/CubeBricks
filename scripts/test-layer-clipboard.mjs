import assert from 'node:assert/strict';
import { binarizePixelAlpha, captureLayerBranch, instantiateLayerBranch } from '../src/texture/layer-clipboard.js';
import { layerDisplayRows } from '../src/common/core/texture-features.js';

const original = [
  {
    uid: 'leaf',
    parentUid: 'nested',
    source: 'red',
    name: 'Ink',
    opacity: 70,
    blendMode: 'multiply',
    maskLayerUid: 'mask'
  },
  { uid: 'nested', type: 'group', parentUid: 'group', name: 'Nested', opacity: 60 },
  { uid: 'mask', parentUid: 'group', source: 'white', visible: false, name: 'Mask' },
  { uid: 'group', type: 'group', name: 'Group', parentUid: null, collapsed: true },
  { uid: 'outside', source: 'blue', name: 'Other' }
];
const before = JSON.stringify(original), clipboard = captureLayerBranch(original, 'group');
clipboard.frameVisibility = { leaf: false, mask: true, outside: false };
let sequence = 0;
const createUid = () => `new-${++sequence}`;
const duplicate = instantiateLayerBranch(original, clipboard, 'group', { inPlace: true, createUid });
assert.equal(duplicate.entries.length, 4);
assert.equal(duplicate.entries.at(-1).parentUid, null, 'duplicate groups remain siblings of their source');
assert.equal(duplicate.entries[0].parentUid, duplicate.entries[1].uid);
assert.equal(duplicate.entries[1].parentUid, duplicate.rootUid);
assert.equal(duplicate.entries[0].maskLayerUid, duplicate.entries[2].uid, 'internal masks point to the copied layer');
assert.deepEqual(duplicate.frameVisibility, { [duplicate.entries[0].uid]: false, [duplicate.entries[2].uid]: true }, 'frame-local visibility uses only copied identities');
assert.deepEqual([duplicate.entries[0].opacity, duplicate.entries[0].blendMode, duplicate.entries[2].visible], [70, 'multiply', false]);
assert.equal(duplicate.entries.at(-1).name, 'Group');
const pasted = instantiateLayerBranch(original, clipboard, 'group', { createUid });
assert.equal(pasted.entries.at(-1).parentUid, 'group', 'paste into a selected group');
assert.equal(layerDisplayRows(duplicate.layers).filter(row => row.layer.type === 'group' && !row.layer.parentUid).length, 2);
const second = instantiateLayerBranch([], clipboard, null, { createUid });
assert.ok(second.entries.every(layer => !duplicate.entries.some(other => other.uid === layer.uid)), 'each paste has an independent identity graph');
assert.equal(JSON.stringify(original), before);
assert.deepEqual(captureLayerBranch(original, 'group').entries, clipboard.entries, 'pasting does not mutate the clipboard');
const leaf = captureLayerBranch(original, 'leaf', () => 'latest live paint');
assert.equal(leaf.entries[0].source, 'latest live paint');
assert.equal(instantiateLayerBranch(original, leaf, 'outside', { createUid }).entries[0].maskLayerUid, 'mask', 'retain valid masks in the destination texture');
assert.equal(instantiateLayerBranch([], leaf, null, { createUid }).entries[0].maskLayerUid, null, 'do not create dangling cross-texture mask references');
assert.equal(captureLayerBranch(original, 'missing'), null);

const pixels = new Uint8ClampedArray([31, 42, 53, 0, 31, 42, 53, 1, 77, 88, 99, 127, 111, 122, 133, 254, 144, 155, 166, 255]);
const colors = [...pixels].filter((_, index) => index % 4 !== 3);
assert.equal(binarizePixelAlpha(pixels), 3);
assert.deepEqual([...pixels].filter((_, index) => index % 4 === 3), [0, 255, 255, 255, 255]);
assert.deepEqual([...pixels].filter((_, index) => index % 4 !== 3), colors, 'alpha binarization leaves RGB values unchanged');
assert.equal(binarizePixelAlpha(pixels), 0, 'already binary alpha creates no change');
console.log('Layer clipboard: independent group trees, pixel snapshots, mask references and binary alpha passed.');
