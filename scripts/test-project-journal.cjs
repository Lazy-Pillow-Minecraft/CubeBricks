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

async function withJournal(run) {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.journal-regression-'));
  try { await run(root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('missing old root does not block intact adjacent undo and redo', () => withJournal(async root => {
  const cube = { uid: 'cube_a', type: 'cube', position: [0, 0, 0] };
  const journal = await new ProjectJournal(root).initialize(model([cube]));
  await journal.commit(model([{ ...cube, position: [1, 0, 0] }]), 'core.element.move');
  await journal.commit(model([{ ...cube, position: [2, 0, 0] }]), 'core.element.move');
  await fs.unlink(path.join(root, 'transactions/1.json'));
  assert.equal(JSON.parse((await journal.navigate('undo')).content).elements[0].position[0], 1);
  assert.equal(JSON.parse((await journal.navigate('redo')).content).elements[0].position[0], 2);
  await journal.navigate('undo');
  await assert.rejects(journal.navigate('undo'), /操作 1 的記錄缺失/);
  assert.equal(journal.state.activeHead, 2);
  assert.equal(JSON.parse(await journal.content()).elements[0].position[0], 1);
}));

test('deleted working directory cannot be silently recreated by a stale writer', () => withJournal(async root => {
  const working = path.join(root, 'working');
  const cube = { uid: 'cube_a', type: 'cube', position: [0, 0, 0] };
  const journal = await new ProjectJournal(working).initialize(model([cube]));
  await fs.rename(working, path.join(root, 'preserved'));
  await assert.rejects(journal.commit(model([{ ...cube, position: [4, 0, 0] }]), 'core.element.move'), /移除/);
  await assert.rejects(fs.access(working), { code: 'ENOENT' });
}));

test('damaged target snapshot fails before changing committed head or textures', () => withJournal(async root => {
  const cube = { uid: 'cube_a', type: 'cube', position: [0, 0, 0] };
  const journal = await new ProjectJournal(root).initialize(model([cube]));
  await journal.commit(model([{ ...cube, position: [4, 0, 0] }]), 'core.element.move');
  const record = path.join(root, 'elements/geometric/cubes/cube_a/1.json');
  const corrupted = JSON.parse(await fs.readFile(record));
  corrupted.state.position[0] = 999;
  await fs.writeFile(record, JSON.stringify(corrupted));
  await assert.rejects(journal.checkout(1), /快照損壞/);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'current_state'))).activeHead, 2);
  assert.equal(JSON.parse(await journal.content()).elements[0].position[0], 4);
}));

test('missing pointer cannot silently drop an element during restoration', () => withJournal(async root => {
  const cube = { uid: 'cube_a', type: 'cube', position: [0, 0, 0] };
  const journal = await new ProjectJournal(root).initialize(model([cube]));
  delete journal.activeManifest.pointers.cube_a;
  await assert.rejects(journal.content(), /元素索引損壞/);
}));

test('failed post-commit finalization is recovered before another write in the same process', () => withJournal(async root => {
  const cube = { uid: 'cube_a', type: 'cube', position: [0, 0, 0] };
  const texture = { uuid: 'texture_a', source: image(10) };
  const journal = await new ProjectJournal(root).initialize(model([cube], [texture]));
  const writePointers = journal.writeNodePointers;
  journal.writeNodePointers = async () => { throw new Error('injected finalization failure'); };
  const updated = model([{ ...cube, position: [6, 0, 0] }], [{ ...texture, source: image(80) }]);
  await assert.rejects(journal.commit(updated, 'core.element.move'), /injected/);
  journal.writeNodePointers = writePointers;
  assert.equal((await journal.commit(updated, 'core.element.move')).changed, false);
  assert.equal(journal.state.pointerSyncFrom, undefined);
  const undo = JSON.parse((await journal.navigate('undo')).content);
  assert.equal(undo.elements[0].position[0], 0);
  assert.equal(undo.textures[0].source, texture.source);
}));

test('committed texture staging finishes after crash, incomplete staging rolls back', () => withJournal(async root => {
  const texture = { uuid: 'texture_a', source: image(10) };
  const journal = await new ProjectJournal(root).initialize(model([], [texture]));
  await journal.commit(model([], [{ ...texture, source: image(80) }]), 'core.paint.stroke');
  await fs.writeFile(path.join(root, 'textures/texture_a/current'), JSON.stringify(texture));
  await fs.writeFile(path.join(root, 'textures/texture_a/next'), JSON.stringify({ sequence: 2, purpose: 'commit', texture: { ...texture, source: image(80) } }));
  const restored = await new ProjectJournal(root).load();
  assert.equal(JSON.parse(await restored.content()).textures[0].source, image(80));
  await fs.writeFile(path.join(root, 'current_state'), JSON.stringify({ ...restored.state, status: 'checking_out', targetHead: 1 }));
  await fs.writeFile(path.join(root, 'textures/texture_a/next'), JSON.stringify({ sequence: 1, purpose: 'checkout', texture }));
  const rolledBack = await new ProjectJournal(root).load();
  assert.equal(rolledBack.state.activeHead, 2);
  assert.equal(JSON.parse(await rolledBack.content()).textures[0].source, image(80));
  assert.equal(rolledBack.state.targetHead, undefined);
}));

test('bulk texture assignment undoes all faces, UV flags, hierarchy and texture folders together', () => withJournal(async root => {
  const nodes = ['a', 'b'].map(id => ({ uid: `cube_${id}`, type: 'cube', autoUv: true,
    position: [0, 0, 0], faces: { north: { texture: 'old_texture', uv: [2, 3, 6, 9] } } }));
  const before = JSON.parse(model(nodes));
  before.groups = [{ uid: 'group_a', type: 'group', children: nodes.map(node => node.uid), pivot: [1, 2, 3], rotation: [12, 17, 26] }];
  before.outliner = ['group_a'];
  before.textureGroups = [{ uid: 'folder_a', name: 'folder' }];
  const journal = await new ProjectJournal(root).initialize(before);
  const after = structuredClone(before);
  after.elements.forEach(cube => { cube.faces.north.texture = 'new_texture'; cube.autoUv = false; });
  const result = await journal.commit(after, 'core.texture.assign');
  assert.equal(result.globalSequence, '2_T');
  assert.deepEqual(JSON.parse((await journal.navigate('undo')).content), before);
  assert.deepEqual(JSON.parse((await journal.navigate('redo')).content), after);
}));

test('duplicate node IDs are rejected rather than overwriting a different snapshot', () => withJournal(async root => {
  const node = { uid: 'cube_a', type: 'cube' };
  await assert.rejects(new ProjectJournal(root).initialize(model([node, node])), /重複/);
}));

function withPngComment(source) {
  const chunk = Buffer.alloc(16);
  chunk.writeUInt32BE(4, 0);
  chunk.write('tEXt', 4); chunk.write('test', 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 12)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 12);
  const png = Buffer.from(source.slice(22), 'base64');
  return `data:image/png;base64,${Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]).toString('base64')}`;
}

test('reencoded PNG after undo does not create a false edit or destroy redo', () => withJournal(async root => {
  const texture = { uuid: 'texture_a', source: withPngComment(image(10)), layers: null };
  const journal = await new ProjectJournal(root).initialize(model([], [texture]));
  await journal.commit(model([], [{ ...texture, source: image(80) }]), 'core.paint.stroke');
  const undone = await journal.navigate('undo');
  assert.notEqual(JSON.parse(undone.content).textures[0].source, texture.source);
  assert.equal((await journal.commit(undone.content, 'core.element.property')).changed, false);
  assert.equal((await journal.navigate('redo')).sequence, 2);
}));

test('legacy texture hashes compare actual pixels instead of creating false history', () => withJournal(async root => {
  const texture = { uuid: 'texture_a', source: withPngComment(image(10)), layers: null };
  const journal = await new ProjectJournal(root).initialize(model([], [texture]));
  delete journal.activeManifest.textureHashVersion;
  journal.activeManifest.textureHashes.texture_a = 'legacy-encoding-hash';
  await fs.writeFile(path.join(root, 'transactions/1.json'), JSON.stringify(journal.activeManifest));
  assert.equal((await journal.commit(model([], [{ ...texture, source: image(10) }]), 'core.element.property')).changed, false);
}));

test('redo returns to the branch actually undone, including after reopen', () => withJournal(async root => {
  const cube = { uid: 'cube_a', type: 'cube', position: [0, 0, 0] };
  const journal = await new ProjectJournal(root).initialize(model([cube]));
  await journal.commit(model([{ ...cube, position: [2, 0, 0] }]), 'core.element.move');
  await journal.checkout(1);
  await journal.commit(model([{ ...cube, position: [3, 0, 0] }]), 'core.element.move');
  await journal.checkout(2);
  await journal.navigate('undo');
  const reopened = await new ProjectJournal(root).load();
  const result = await reopened.navigate('redo');
  assert.equal(result.sequence, 2);
  assert.equal(JSON.parse(result.content).elements[0].position[0], 2);
}));
