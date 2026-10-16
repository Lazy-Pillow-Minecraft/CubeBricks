const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { ProjectJournal } = require('../electron/project-journal.cjs');
const { encodePng, createTextureDelta, applyTextureDelta } = require('../electron/texture-delta.cjs');
const { packZip, unpackZip } = require('../electron/zip-store.cjs');

function image(color) {
  const rgba = Buffer.alloc(16 * 16 * 4);
  for (let pixel = 0; pixel < 16 * 16; pixel++) {
    rgba[pixel * 4] = color;
    rgba[pixel * 4 + 3] = 255;
  }
  return encodePng({ width: 16, height: 16, rgba });
}
function model(nodes, textures = []) {
  return JSON.stringify({ name: 'test', formatVersion: 3, outliner: nodes.map(node => node.uid),
    elements: nodes, groups: [], textures });
}
test('texture delta stores both directions and restores pixels', () => {
  const before = image(25), after = image(210);
  const delta = createTextureDelta(before, after);
  assert.equal(delta.kind, 'tiles');
  assert.ok(delta.tiles[0].before && delta.tiles[0].after);
  assert.equal(applyTextureDelta(after, delta, 'before'), before);
  assert.equal(applyTextureDelta(before, delta, 'after'), after);
});

test('archive reader rejects unsafe Windows paths', () => {
  assert.throws(() => unpackZip(packZip([['C:/escape', Buffer.from('x')]])), /不安全路徑/);
  assert.throws(() => unpackZip(packZip([['texture:alt', Buffer.from('x')]])), /不安全路徑/);
});

test('texture delta stores only changed tiles, not a full image per operation', () => {
  const beforePixels = Buffer.alloc(64 * 64 * 4);
  const afterPixels = Buffer.from(beforePixels);
  afterPixels[(41 * 64 + 47) * 4] = 180;
  afterPixels[(41 * 64 + 47) * 4 + 3] = 255;
  const before = encodePng({ width: 64, height: 64, rgba: beforePixels });
  const after = encodePng({ width: 64, height: 64, rgba: afterPixels });
  const delta = createTextureDelta(before, after);
  assert.equal(delta.kind, 'tiles');
  assert.equal(delta.tiles.length, 1);
  assert.deepEqual([delta.tiles[0].x, delta.tiles[0].y], [32, 32]);
  assert.equal(applyTextureDelta(before, delta, 'after'), after);
  assert.equal(applyTextureDelta(after, delta, 'before'), before);
});

test('multi-element operation, branch preservation, archive and recovery', async () => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.journal-test-'));
  try {
    const directory = path.join(root, 'working');
    const a = { uid: 'cube_a', type: 'cube', position: [0, 0, 0] };
    const b = { uid: 'cube_b', type: 'cube', position: [0, 0, 0] };
    const texture = { uuid: 'texture_a', name: 'texture.png', source: image(10) };
    const journal = await new ProjectJournal(directory).initialize(model([a, b], [texture]));
    const result = await journal.commit(model([
      { ...a, position: [2, 0, 0] }, { ...b, position: [3, 0, 0] }
    ], [{ ...texture, source: image(70) }]), 'core.element.move', '移動元素');
    assert.equal(result.globalSequence, '2_T');
    const aRecord = JSON.parse(await fs.readFile(path.join(directory, 'elements/geometric/cubes/cube_a/2.json')));
    const bRecord = JSON.parse(await fs.readFile(path.join(directory, 'elements/geometric/cubes/cube_b/2.json')));
    assert.equal(aRecord.globalSequence, bRecord.globalSequence);
    assert.equal(aRecord.operationId, 'core.element.move');
    await journal.checkout(1);
    assert.equal(JSON.parse(await journal.content()).textures[0].source, texture.source);
    const branch = await journal.commit(model([{ ...a, position: [9, 0, 0] }, b], [texture]), 'core.element.move', '移動元素');
    assert.equal(branch.sequence, 3);
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'elements/geometric/cubes/cube_a/3.json'))).state.position[0], 9);
    assert.equal((await journal.manifest(2)).parent, 1);
    assert.equal((await journal.manifest(3)).parent, 1);
    const archive = path.join(root, 'model.cbmodel');
    await journal.archive(archive);
    const reopened = await ProjectJournal.fromArchive(await fs.readFile(archive), path.join(root, 'reopened'));
    assert.equal(JSON.parse(await reopened.content()).elements[0].position[0], 9);
    await reopened.checkout(2);
    assert.equal(JSON.parse(await reopened.content()).textures[0].source, image(70));
    const deleted = await reopened.commit(model([
      { ...a, position: [2, 0, 0] }, { ...b, position: [3, 0, 0] }
    ], []), 'core.texture.delete', '刪除貼圖');
    assert.equal(JSON.parse(await reopened.content()).textures.length, 0);
    await reopened.checkout(2);
    assert.equal(JSON.parse(await reopened.content()).textures[0].source, image(70));
    await reopened.checkout(deleted.sequence);
    assert.equal(JSON.parse(await reopened.content()).textures.length, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('pending global state rolls back incomplete transaction', async () => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.journal-crash-test-'));
  try {
    const journal = await new ProjectJournal(root).initialize(model([{ uid: 'cube_a', type: 'cube', position: [0, 0, 0] }]));
    await fs.writeFile(path.join(root, 'index_number'), '2');
    await fs.writeFile(path.join(root, 'current_state'), JSON.stringify({ ...journal.state, status: 'in_progress', sequence: 2 }));
    const reopened = await new ProjectJournal(root).load();
    assert.equal(reopened.state.activeHead, 1);
    assert.equal(JSON.parse(await reopened.content()).elements[0].position[0], 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('locator files update only for changed nodes and recover after an interrupted sync', async () => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.journal-pointer-test-'));
  try {
    const a = { uid: 'cube_a', type: 'cube', position: [0, 0, 0] };
    const b = { uid: 'cube_b', type: 'cube', position: [0, 0, 0] };
    const journal = await new ProjectJournal(root).initialize(model([a, b]));
    const aLocator = path.join(root, 'elements/geometric/cubes/cube_a/locator');
    const bLocator = path.join(root, 'elements/geometric/cubes/cube_b/locator');
    const untouched = await fs.readFile(bLocator, 'utf8');
    await journal.commit(model([{ ...a, position: [4, 0, 0] }, b]), 'core.element.move', '移動元素');
    assert.equal(await fs.readFile(bLocator, 'utf8'), untouched);
    const expected = await fs.readFile(aLocator, 'utf8');
    await fs.writeFile(aLocator, JSON.stringify({ identifier: 'cube_a', local: 1 }));
    await fs.writeFile(path.join(root, 'current_state'), JSON.stringify({ ...journal.state, pointerSyncFrom: 1 }));
    const reopened = await new ProjectJournal(root).load();
    assert.equal(await fs.readFile(aLocator, 'utf8'), expected);
    assert.equal(await fs.readFile(bLocator, 'utf8'), untouched);
    assert.equal(reopened.state.pointerSyncFrom, undefined);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
