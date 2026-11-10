import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { RecentModelHistory, historySnapshot } from '../src/project/recent-model-history.js';
import { noteCanvasHistoryImage } from '../src/project/history-fingerprint.js';
import { pngPixels } from '../src/utils/image/png-pixels.js';
const require = createRequire(import.meta.url);
const { ProjectJournal } = require('../electron/project-journal.cjs');
const { decodePng, encodePng } = require('../electron/texture-delta.cjs');
const { historyRoute } = require('../electron/journal-history-storage.cjs');

function chunk(type, data) {
  const kind = Buffer.from(type); let checksum = 0xffffffff;
  for (const byte of Buffer.concat([kind, data])) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++) checksum = checksum & 1 ? 0xedb88320 ^ checksum >>> 1 : checksum >>> 1;
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); kind.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE((checksum ^ 0xffffffff) >>> 0, data.length + 8); return result;
}
function png(type, samples, { filter = 0, transparency, palette, level = 0 } = {}) {
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[type];
  const header = Buffer.alloc(13); header.writeUInt32BE(2, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = type;
  const rows = [];
  for (let y = 0; y < 2; y++) {
    const row = [filter];
    for (let x = 0; x < 2 * channels; x++) {
      const index = y * 2 * channels + x, left = x >= channels ? samples[index - channels] : 0;
      const up = y ? samples[index - 2 * channels] : 0, upperLeft = y && x >= channels ? samples[index - 3 * channels] : 0;
      const p = left + up - upperLeft, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
      const predictor = [0, left, up, Math.floor((left + up) / 2), a <= b && a <= c ? left : b <= c ? up : upperLeft][filter];
      row.push((samples[index] - predictor) & 255);
    }
    rows.push(...row);
  }
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    ...(palette ? [chunk('PLTE', Buffer.from(palette))] : []), ...(transparency ? [chunk('tRNS', Buffer.from(transparency))] : []),
    chunk('IDAT', deflateSync(Buffer.from(rows), { level })), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const pixels = [120, 60, 30, 0, 210, 100, 20, 128, 0, 30, 80, 255, 20, 60, 100, 255];
const original = png(6, pixels), samePixels = encodePng(decodePng(original));
const edited = png(6, pixels.map((value, index) => index === 4 ? 42 : value));
const fingerprint = async source => {
  const image = await pngPixels(source);
  return image ? `${image.width}:${image.height}:${createHash('sha256').update(image.rgba).digest('hex')}` : source;
};
const model = x => ({ name: 'test', elements: [{ uid: 'cube', type: 'cube', position: [x, 0, 0] }], groups: [], outliner: ['cube'], textureSize: [16, 16] });
const texture = source => ({ _uid: 'texture', source, layers: [{ uid: 'layer', source }], activeLayerUid: 'layer' });

test('history PNG comparisons match journal pixels for all supported channels, filters and transparency', async () => {
  for (let filter = 0; filter < 5; filter++) for (const [type, samples, options] of [
    [6, pixels, {}], [4, [10, 0, 20, 128, 50, 255, 200, 255], {}],
    [0, [10, 20, 50, 200], { transparency: [0, 10] }],
    [2, [10, 20, 30, 40, 50, 60, 100, 110, 120, 200, 210, 220], { transparency: [0, 10, 0, 20, 0, 30] }],
    [3, [0, 1, 1, 0], { palette: [120, 60, 30, 20, 40, 60], transparency: [0, 128] }]
  ]) {
    const source = png(type, samples, { ...options, filter });
    assert.deepEqual(Buffer.from((await pngPixels(source)).rgba), decodePng(source).rgba);
  }
  assert.equal((await pngPixels(original)).rgba[0], 120, 'transparent hidden RGB is not erased by canvas premultiplication');
  assert.equal(await fingerprint(original), await fingerprint(samePixels));
  await assert.rejects(pngPixels(original.slice(0, -20)));
});

test('model, UV, shape, modifier, layer and pixel edits all retain neighboring states', async () => {
  const history = new RecentModelHistory(model(0), [texture(original)], { fingerprint });
  for (const [index, operation] of ['core.element.create', 'core.uv.move', 'shape.bezier3d.property', 'modifier.symmetry.property', 'core.texture.layer'].entries())
    history.push(model(index + 1), [texture(index === 4 ? edited : original)], operation);
  for (let x = 4; x >= 0; x--) assert.equal((await history.navigate('undo')).data.elements[0].position[0], x);
  for (let x = 1; x <= 5; x++) assert.equal((await history.navigate('redo')).data.elements[0].position[0], x);
  const preview = await history.navigate('undo');
  assert.equal(preview.textureChanged, true); assert.equal(preview.geometryChanged, true);
  assert.equal(await preview.matches(historySnapshot(model(4), [texture(samePixels)])), true);
  preview.data.elements[0].position[0] = 999;
  assert.equal(await preview.matches(historySnapshot(model(4), [texture(original)])), true, 'live edits never mutate cached state');
});

test('pixel-only undo preserves model geometry and skips PNG encoder-only no-op steps', async () => {
  const history = new RecentModelHistory(model(0), [texture(original)], { fingerprint });
  history.push(model(0), [texture(samePixels)], 'core.texture.layer');
  history.push(model(0), [texture(edited)], 'core.paint.stroke');
  const preview = await history.navigate('undo');
  assert.equal(preview.textureChanged, true); assert.equal(preview.modelChanged, false); assert.equal(preview.geometryChanged, false);
  assert.deepEqual(preview.changedUids, []);
  assert.equal(await history.navigate('undo'), null, 'a re-encoded image is not a phantom transaction');
  assert.equal((await history.navigate('redo')).data.textures[0].source, edited);
});

test('asynchronous pixel proof serializes rapid navigation and reset invalidates pending requests', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const history = new RecentModelHistory(model(0), [texture(original)], { fingerprint: source => gate.then(() => source) });
  history.push(model(1), [texture(original)], 'core.element.create'); history.push(model(2), [texture(edited)], 'core.paint.stroke');
  const first = history.navigate('undo'), second = history.navigate('undo'); release();
  assert.equal((await first).data.elements[0].position[0], 1); assert.equal((await second).data.elements[0].position[0], 0);
  let resume;
  const wait = new Promise(resolve => { resume = resolve; });
  history.fingerprint = source => wait.then(() => source);
  history.push(model(3), [texture('new-source')], 'core.paint.stroke'); history.push(model(4), [texture('new-source-2')], 'core.paint.stroke');
  const stale = history.navigate('undo'); history.reset(null, null); resume();
  assert.equal(await stale, null);
});

test('failed pixel proof falls back safely and memory budgets include image sources', async () => {
  const failed = new RecentModelHistory(model(0), [texture(original)], { fingerprint: () => Promise.reject(Error('worker unavailable')) });
  failed.push(model(1), [texture(edited)], 'core.paint.stroke');
  assert.equal(await failed.navigate('undo'), null);
  const limited = new RecentModelHistory(model(0), [texture('x'.repeat(5000))], { byteLimit: 2000 });
  assert.equal(limited.entries.length, 0); assert.equal(limited.bytes, 0);
  const shared = new RecentModelHistory(model(0), [texture('x'.repeat(5000))]);
  for (let x = 1; x < 9; x++) shared.push(model(x), [texture('x'.repeat(5000))], 'core.element.move');
  assert.equal(shared.entries[0].data.textures, shared.entries.at(-1).data.textures);
  assert.ok(shared.bytes < 20000, 'unchanged PNGs and layer records occupy one shared snapshot');
  shared.seedCheckout(historySnapshot(model(8), []), historySnapshot(model(7), []), 'undo');
  assert.equal(shared.navigate('redo').data.elements[0].position[0], 8, 'a cold checkout seeds immediate redo');
});

test('a verified paint pixel change restores without waiting for whole-image PNG fingerprints', () => {
  noteCanvasHistoryImage(original, edited, { alpha: true });
  const history = new RecentModelHistory(model(0), [texture(original)], { fingerprint: () => new Promise(() => {}) });
  history.push(model(0), [texture(edited)], 'core.texture.brush');
  const preview = history.navigate('undo');
  assert.equal(preview.textureChanged, true);
  assert.equal(preview.modelChanged, false);
  assert.equal(preview.data.textures[0].source, original);
  assert.equal(preview.matches(historySnapshot(model(0), [texture(original)])), true,
    'an exact journal receipt needs no decode');
});

test('runtime-only undefined fields follow JSON serialization and pending blob URLs fall back safely', async () => {
  const asset = { ...texture(original), layers: [{ uid: 'layer', source: original, parentUid: undefined }], externalFile: { path: undefined } };
  const history = new RecentModelHistory(model(0), [asset], { fingerprint });
  history.push(model(1), [asset], 'core.element.move');
  const preview = await history.navigate('undo');
  assert.equal(await preview.matches(JSON.parse(JSON.stringify(historySnapshot(model(0), [asset])))), true);
  const blob = new RecentModelHistory(model(0), [texture('blob:pending')]);
  blob.push(model(1), [texture('blob:pending')], 'core.element.move');
  assert.equal(await blob.navigate('undo'), null);
});

test('cached backend pixel states restore without replaying texture deltas', async t => {
  const directory = await mkdtemp(join(resolve('.'), '.recent-pixel-history-'));
  t.after(async () => { assert.equal(dirname(directory), resolve('.')); await rm(directory, { recursive: true, force: true }); });
  const before = historySnapshot(model(0), [texture(original)]), after = historySnapshot(model(0), [texture(edited)]);
  const journal = await new ProjectJournal(directory).initialize(JSON.stringify(before));
  await journal.commit(JSON.stringify(after), 'core.paint.stroke');
  journal.applyTextureChange = async () => { throw Error('a cached target must not replay deltas'); };
  assert.deepEqual(decodePng(JSON.parse((await journal.navigate('undo')).content).textures[0].source).rgba, decodePng(original).rgba);
  assert.deepEqual(decodePng(JSON.parse((await journal.navigate('redo')).content).textures[0].source).rgba, decodePng(edited).rgba);
});

test('invalid history parent links fail rather than looping indefinitely', async () => {
  const records = new Map([[1, { sequence: 1, parent: null }], [2, { sequence: 2, parent: 3 }], [3, { sequence: 3, parent: 2 }]]);
  await assert.rejects(historyRoute({ manifest: async id => records.get(id) }, records.get(3), records.get(1)), /循環/);
});

test('retention removes only unreferenced snapshots and records deletion tombstones for cleanup', async t => {
  const directory = await mkdtemp(join(resolve('.'), '.recent-prune-history-'));
  t.after(async () => { assert.equal(dirname(directory), resolve('.')); await rm(directory, { recursive: true, force: true }); });
  const journal = await new ProjectJournal(directory).initialize(JSON.stringify(historySnapshot(model(0), [])));
  await journal.commit(JSON.stringify(historySnapshot(model(1), [])), 'core.element.move');
  const deleted = model(2); deleted.elements = []; deleted.outliner = [];
  await journal.commit(JSON.stringify(historySnapshot(deleted, [])), 'core.element.delete');
  const record = JSON.parse(await readFile(journal.file('transactions/3.json')));
  assert.equal(record.writtenSnapshots.length, 1);
  await journal.commit(JSON.stringify({ ...deleted, name: 'renamed' }), 'core.project.rename');
  await journal.compactHistory(0);
  const folder = record.writtenSnapshots[0].folder;
  assert.equal((await readdir(journal.file(folder))).filter(name => /^\d+\.json$/.test(name)).length, 0);
  assert.deepEqual(JSON.parse(await journal.content()).elements, []);
});
