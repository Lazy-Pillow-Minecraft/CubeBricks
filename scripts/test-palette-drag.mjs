import assert from 'node:assert/strict';
import { movePaletteColor } from '../src/screen/palette/drag-colors.js';
import { scheduleDropCleanup } from '../src/screen/drag-drop-cleanup.js';
import { encodeColorMap, decodeColorMap } from '../src/screen/palette/color-map-file.js';

const [a, b, c, d] = ['#111111', '#222222', '#333333', '#444444'];
for (const [sourceIndex, boundary, expected, destinationIndex] of [
  [0, 2, [b, a, c, d], 1], // immediately after the next swatch
  [1, 0, [b, a, c, d], 0],
  [0, 4, [b, c, d, a], 3],
  [3, 1, [a, d, b, c], 1]
]) {
  const row = { id: 'default', name: 'Default', scope: 'global', colors: [a, b, c, d], gradient: false };
  const result = movePaletteColor([row], { rowId: row.id, index: sourceIndex }, row.id, boundary);
  assert.deepEqual(row.colors, expected);
  assert.equal(result.index, destinationIndex);
  assert.deepEqual(decodeColorMap(encodeColorMap([row])).palettes[0].colors, expected,
    'the reordered default palette survives saving and reopening');
}
{
  const row = { id: 'same', colors: [a, b, c] };
  for (const boundary of [1, 2]) {
    assert.equal(movePaletteColor([row], { rowId: row.id, index: 1 }, row.id, boundary), null);
    assert.deepEqual(row.colors, [a, b, c], 'dropping on the current slot does not remove or duplicate colors');
  }
}
{
  const source = { id: 'source', colors: [a, b] }, target = { id: 'target', colors: [] };
  assert.equal(movePaletteColor([source, target], { rowId: source.id, index: 0 }, target.id, 0).index, 0);
  assert.deepEqual(source.colors, [b]);
  assert.deepEqual(target.colors, [a], 'a color can move to an empty palette');
  target.gradient = true;
  assert.equal(movePaletteColor([source, target], { rowId: source.id, index: 0 }, target.id, 0), null);
  target.gradient = false;
  target.colorSpaceGradient = true;
  assert.equal(movePaletteColor([source, target], { rowId: source.id, index: 0 }, target.id, 0), null);
  assert.deepEqual(source.colors, [b], 'rejecting a gradient target leaves the source intact');
  for (const index of [-1, 4, NaN]) assert.equal(movePaletteColor([source, target],
    { rowId: source.id, index }, source.id, 0), null);
}
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));
{
  const row = { id: 'row', colors: [a, b, c] };
  const drag = { rowId: row.id, index: 0 };
  const palette = { draggedColor: drag }, state = {};
  scheduleDropCleanup({ state, palette });
  await Promise.resolve(); // The native event can checkpoint here, before its target listener.
  assert.equal(palette.draggedColor, drag, 'capture cleanup does not consume the target drop payload');
  movePaletteColor([row], palette.draggedColor, row.id, 2);
  assert.deepEqual(row.colors, [b, a, c]);
  await nextTask();
  assert.equal(palette.draggedColor, null, 'unconsumed state is cleared only after dispatch finishes');
}
{
  const palette = { draggedColor: {} }, state = { outlinerDragUids: ['old'], textureDrag: {} };
  const noop = () => { throw Error('stale cleanup must not touch a new drag'); };
  scheduleDropCleanup({ state, palette, clearOutlinerDropState: noop,
    removeOutlinerDragGhost: noop, clearTextureFaceDropTarget: noop, renderTextureList: noop });
  const nextColor = {}, nextElements = ['new'], nextTexture = {};
  palette.draggedColor = nextColor;
  state.outlinerDragUids = nextElements;
  state.textureDrag = nextTexture;
  await nextTask();
  assert.equal(palette.draggedColor, nextColor);
  assert.equal(state.outlinerDragUids, nextElements);
  assert.equal(state.textureDrag, nextTexture);
}
console.log('Palette adjacent / cross-row sorting, persistence and native-event cleanup ordering passed.');
