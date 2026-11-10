const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ProjectJournal } = require('../electron/project-journal.cjs');
const { encodePng } = require('../electron/texture-delta.cjs');
const { retainProject, readProjectRetention } = require('../electron/project-retention.cjs');

const content = x => JSON.stringify({
  name: 'history-tree', elements: [{ uid: 'cube_a', type: 'cube', position: [x, 0, 0] }],
  groups: [], textures: [{ uuid: 'texture_a', source: encodePng({ width: 1, height: 1, rgba: Buffer.from([x, 10, 20, 255]) }) }], outliner: ['cube_a']
});

test('branch pruning preserves siblings, restores an affected current state, and cannot resurrect deleted history', async t => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.history-tree-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(__dirname, '..'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const journal = await new ProjectJournal(path.join(root, 'source')).initialize(content(0));
  await journal.commit(content(1), 'core.element.move', '移動');
  await journal.commit(content(2), 'core.element.move', '移動');
  await journal.checkout(2);
  await journal.commit(content(30), 'core.element.move', '移動');
  await journal.commit(content(40), 'core.element.move', '移動');
  await journal.checkout(3);
  await retainProject(journal.directory, 3);
  assert.deepEqual((await journal.historyGraph()).nodes.map(node => [node.sequence, node.parent]), [[1, null], [2, 1], [3, 2], [4, 2], [5, 4]]);
  const stale = await fs.readFile(journal.file('transactions/4.json'));
  const removed = await journal.pruneHistoryBranch(4);
  assert.equal(removed.content, null);
  assert.deepEqual(removed.removed.sort(), [4, 5]);
  assert.deepEqual((await journal.historyGraph()).nodes.map(node => node.sequence), [1, 2, 3]);
  assert.equal(JSON.parse(await journal.content()).elements[0].position[0], 2);
  assert.equal((await readProjectRetention(journal.directory)).persistent, true);
  await assert.rejects(journal.checkout(4), /已刪除/);
  await fs.writeFile(journal.file('transactions/4.json'), stale);
  const reopened = await new ProjectJournal(journal.directory).load();
  assert.deepEqual((await reopened.historyGraph()).nodes.map(node => node.sequence), [1, 2, 3]);
  await reopened.navigate('undo');
  assert.equal((await reopened.navigate('redo')).sequence, 3);
  const rollback = await reopened.pruneHistoryBranch(2);
  assert.equal(rollback.sequence, 1);
  assert.deepEqual(JSON.parse(rollback.content).elements, JSON.parse(content(0)).elements);
  assert.equal(JSON.parse(rollback.content).textures[0].source, JSON.parse(content(0)).textures[0].source);
  await assert.rejects(reopened.pruneHistoryBranch(1), /至少需要保留/);
  const next = await reopened.commit(content(6), 'core.element.move');
  assert.equal(next.sequence, 6);
  assert.deepEqual((await reopened.historyGraph()).nodes.map(node => node.sequence), [1, 6]);
  const archive = path.join(root, 'tree.cbmodel');
  await reopened.archive(archive);
  const restored = await ProjectJournal.fromArchive(await fs.readFile(archive), path.join(root, 'restored'));
  assert.deepEqual((await restored.historyGraph()).nodes.map(node => node.sequence), [1, 6]);
});

test('radial history layout places all tips on the rim and handles deep histories without recursion', async () => {
  const { layoutProjectHistory, nearestHistoryNode } = await import('../src/project/history-layout.js');
  const layout = layoutProjectHistory({
    current: 4, nodes: [{ sequence: 1, parent: null }, { sequence: 2, parent: 1 },
    { sequence: 3, parent: 2 }, { sequence: 4, parent: 2 }, { sequence: 5, parent: 4 }]
  });
  assert.equal(layout.byId.get(1).radius, 0);
  assert.equal(layout.byId.get(3).radius, 440);
  assert.equal(layout.byId.get(5).radius, 440);
  assert.equal(layout.byId.get(4).current, true);
  assert.equal(layout.byId.get(2).tip, false);
  for (const node of layout.points) assert.equal(nearestHistoryNode(layout, node.x, node.y, 1).sequence, node.sequence);
  assert.equal(nearestHistoryNode(layout, 10000, 10000, 9), null);
  assert.ok(!/NaN|Infinity/.test(layout.path));
  const deep = layoutProjectHistory({ current: 15000, nodes: Array.from({ length: 15000 }, (_, index) => ({ sequence: index + 1, parent: index || null })) });
  assert.equal(deep.points.length, 15000);
  assert.equal(deep.byId.get(15000).radius, 440);
});

test('history cap removes oldest individual records and preserves every newer branch with exact texture restoration', async t => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.history-forest-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(__dirname, '..'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const journal = await new ProjectJournal(path.join(root, 'source')).initialize(content(0));
  for (let value = 1; value <= 4; value++)await journal.commit(content(value), 'core.element.move');
  await journal.checkout(2);
  await journal.commit(content(30), 'core.element.move');
  await journal.commit(content(40), 'core.element.move');
  await journal.checkout(3);
  await journal.commit(content(50), 'core.element.move');
  await journal.commit(content(60), 'core.element.move');
  const compacted = await journal.compactHistory(4);
  assert.deepEqual(compacted.baselines, [5, 6, 8]);
  const graph = await journal.historyGraph();
  assert.deepEqual(graph.nodes.map(node => [node.sequence, node.parent]), [[5, null], [6, null], [7, 6], [8, null], [9, 8]]);
  assert.ok(graph.nodes.filter(node => node.parent === null).every(node => node.detached));
  const { layoutProjectHistory } = await import('../src/project/history-layout.js');
  const layout = layoutProjectHistory(graph);
  assert.equal(layout.virtualCenter, true);
  assert.equal(layout.edgeCount, 2);
  assert.equal((layout.detachedPath.match(/M/g) || []).length, 3);
  const tips = layout.points.filter(point => point.tip).sort((a, b) => a.angle - b.angle);
  for (let index = 1; index < tips.length; index++)assert.ok(Math.abs(tips[index].angle - tips[index - 1].angle - Math.PI * 2 / 3) < 1e-9);
  for (const [sequence, value] of [[5, 4], [7, 40], [8, 50], [6, 30], [9, 60]]) {
    const actual = JSON.parse(await journal.checkout(sequence));
    assert.deepEqual(actual.elements, JSON.parse(content(value)).elements);
    assert.equal(actual.textures[0].source, JSON.parse(content(value)).textures[0].source);
  }
  const archive = path.join(root, 'forest.cbmodel');
  await journal.archive(archive);
  const restored = await ProjectJournal.fromArchive(await fs.readFile(archive), path.join(root, 'restored'));
  assert.equal(JSON.parse(await restored.checkout(5)).textures[0].source, JSON.parse(content(4)).textures[0].source);
  assert.equal(JSON.parse(await restored.checkout(7)).textures[0].source, JSON.parse(content(40)).textures[0].source);
  const staged = await ProjectJournal.fromArchive(await fs.readFile(archive), path.join(root, 'staged'), null, () => {}, { deferHistory: true, historyThreshold: 1 });
  assert.equal(JSON.parse(await staged.checkout(5)).textures[0].source, JSON.parse(content(4)).textures[0].source);
  assert.equal(JSON.parse(await staged.checkout(7)).textures[0].source, JSON.parse(content(40)).textures[0].source);
  await staged.finishHistoryImport();
  const reduced = await restored.compactHistory(0);
  assert.equal(reduced.retained, 1);
  assert.deepEqual((await restored.historyGraph()).nodes.map(node => node.sequence), [7]);
  assert.equal((await fs.readdir(restored.file('history_roots'))).length, 1);
  assert.equal((await fs.readdir(restored.file('history_textures'))).length, 1);
});

test('deleting a single internal node preserves all descendants, including cross-root pixel history', async t => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.history-single-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(__dirname, '..'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const journal = await new ProjectJournal(path.join(root, 'source')).initialize(content(0));
  await journal.commit(content(10), 'core.element.move');
  await journal.commit(content(20), 'core.element.move');
  await journal.checkout(2);
  await journal.commit(content(30), 'core.element.move');
  const unrewritten = await fs.readFile(journal.file('transactions/3.json'));
  const removedRecord = await fs.readFile(journal.file('transactions/2.json'));
  const result = await journal.pruneHistoryBranch(2, { single: true });
  assert.equal(result.content, null);
  assert.deepEqual(result.removed, [2]);
  assert.deepEqual((await journal.historyGraph()).nodes.map(node => [node.sequence, node.parent]), [[1, null], [3, null], [4, null]]);
  // Simulate termination after the logical deletion commits but before all
  // old files and severed-parent manifests have been physically cleaned up.
  await fs.writeFile(journal.file('transactions/3.json'), unrewritten);
  await fs.writeFile(journal.file('transactions/2.json'), removedRecord);
  const reopened = await new ProjectJournal(journal.directory).load();
  assert.equal((await reopened.manifest(3)).parent, null);
  assert.deepEqual((await reopened.historyGraph()).nodes.map(node => node.sequence), [1, 3, 4]);
  for (const [sequence, value] of [[1, 0], [3, 20], [4, 30]]) assert.equal(JSON.parse(await reopened.checkout(sequence)).textures[0].source, JSON.parse(content(value)).textures[0].source);
  const deletedCurrent = await reopened.pruneHistoryBranch(4, { single: true });
  assert.equal(deletedCurrent.sequence, 3);
  assert.equal(JSON.parse(deletedCurrent.content).elements[0].position[0], 20);
  await reopened.pruneHistoryBranch(1, { single: true });
  assert.deepEqual((await reopened.historyGraph()).nodes.map(node => node.sequence), [3]);
  await assert.rejects(reopened.pruneHistoryBranch(3, { single: true }), /至少需要保留/);
});

test('radial layout preserves all intermediate edges and gives every terminal an equal circular sector', async () => {
  const { layoutProjectHistory } = await import('../src/project/history-layout.js');
  const nodes = [{ sequence: 1, parent: null }, { sequence: 2, parent: 1 }, { sequence: 3, parent: 2 },
  { sequence: 4, parent: 3 }, { sequence: 5, parent: 2 }, { sequence: 6, parent: 5 }, { sequence: 7, parent: 5 }, { sequence: 8, parent: 1 }];
  const layout = layoutProjectHistory({ nodes, current: 6 });
  assert.equal(layout.edgeCount, nodes.length - 1);
  assert.equal((layout.path.match(/M/g) || []).length, nodes.length - 1);
  assert.equal(layout.tipCount, 4);
  assert.equal(layout.detachedPath, '');
  const tips = layout.points.filter(point => point.tip).sort((a, b) => a.angle - b.angle);
  for (let index = 1; index < tips.length; index++)assert.ok(Math.abs(tips[index].angle - tips[index - 1].angle - Math.PI / 2) < 1e-9);
});

test('straight history chains distribute nodes equally across the full distance between fork and tip', async () => {
  const { layoutProjectHistory, nearestHistoryNode } = await import('../src/project/history-layout.js');
  const nodes = [{ sequence: 1, parent: null }, { sequence: 2, parent: 1 },
  { sequence: 3, parent: 2 }, { sequence: 4, parent: 3 }, { sequence: 5, parent: 4 }];
  for (let sequence = 6; sequence <= 18; sequence++)nodes.push({ sequence, parent: sequence === 6 ? 2 : sequence - 1 });
  const layout = layoutProjectHistory({ nodes, current: 4 });
  const equallySpaced = (ids, start) => {
    const chain = ids.map(id => layout.byId.get(id));
    const step = (chain.at(-1).radius - start) / chain.length;
    for (let index = 0; index < chain.length; index++) {
      const node = chain[index];
      assert.ok(Math.abs(node.radius - (start + (index + 1) * step)) < 1e-9);
      assert.ok(Math.abs(node.angle - chain[0].angle) < 1e-9);
      assert.equal(nearestHistoryNode(layout, node.x, node.y, .01).sequence, node.sequence);
    }
  };
  equallySpaced([3, 4, 5], layout.byId.get(2).radius);
  equallySpaced(Array.from({ length: 13 }, (_, index) => index + 6), layout.byId.get(2).radius);
  assert.equal(layout.byId.get(1).radius, 0);
  assert.equal(layout.byId.get(5).radius, 440);
  assert.equal(layout.byId.get(18).radius, 440);
});

test('detached straight chains include the virtual-center connection in their equal spacing', async () => {
  const { layoutProjectHistory } = await import('../src/project/history-layout.js');
  const nodes = [{ sequence: 1, parent: null, detached: true }, { sequence: 2, parent: 1 },
  ...Array.from({ length: 8 }, (_, index) => ({ sequence: index + 3, parent: index ? index + 2 : null, detached: index === 0 }))];
  const layout = layoutProjectHistory({ nodes, current: 2 });
  assert.equal(layout.virtualCenter, true);
  assert.equal(layout.byId.get(1).radius, 220);
  assert.equal(layout.byId.get(2).radius, 440);
  for (let index = 0; index < 8; index++)assert.equal(layout.byId.get(index + 3).radius, 55 * (index + 1));
  assert.equal(layout.edgeCount, nodes.length - 2);
  assert.equal((layout.detachedPath.match(/M0,0L/g) || []).length, 2);
});

test('history-limit settings persist independently of history, redo, checkout and archive mode', async t => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.history-settings-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(__dirname, '..'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const withLimit = (value, historyLimit) => JSON.stringify({ ...JSON.parse(content(value)), historyLimit });
  const journal = await new ProjectJournal(path.join(root, 'source')).initialize(withLimit(0, 20));
  await journal.commit(withLimit(10, 20), 'core.element.move');
  await journal.navigate('undo');
  const before = structuredClone(journal.state);
  await journal.setHistoryLimit(300);
  assert.deepEqual(journal.state, before);
  assert.deepEqual((await journal.historyGraph()).nodes.map(node => node.sequence), [1, 2]);
  assert.equal(JSON.parse(await journal.content()).historyLimit, 300);
  assert.equal(JSON.parse((await journal.navigate('redo')).content).historyLimit, 300);
  const unchanged = await journal.commit(withLimit(10, 5), 'core.project.information');
  assert.equal(unchanged.changed, false);
  assert.equal(journal.state.lastCommitted, 2);
  assert.equal(JSON.parse(await journal.content()).historyLimit, 300);
  for (const sequence of [1, 2]) assert.equal(Object.hasOwn((await journal.manifest(sequence)).information, 'historyLimit'), false);
  for (const includeHistory of [true, false]) {
    const archive = path.join(root, `${includeHistory}.cbmodel`);
    await journal.archive(archive, { includeHistory });
    const restored = await ProjectJournal.fromArchive(await fs.readFile(archive), path.join(root, `restored-${includeHistory}`));
    assert.equal(JSON.parse(await restored.content()).historyLimit, 300);
    if (includeHistory) assert.equal(JSON.parse((await restored.navigate('undo')).content).historyLimit, 300);
  }
  await journal.setHistoryLimit(null);
  assert.equal(JSON.parse(await journal.checkout(1)).historyLimit ?? null, null);
  const reopened = await new ProjectJournal(journal.directory).load();
  assert.equal(JSON.parse(await reopened.content()).historyLimit ?? null, null);
  await assert.rejects(reopened.setHistoryLimit(-1), /歷史上限/);
});

test('legacy limits migrate once from the current state and are ignored by model-history comparisons', async t => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.history-settings-legacy-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(__dirname, '..'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const original = await new ProjectJournal(root).initialize(content(0));
  await original.commit(content(10), 'core.element.move');
  for (const [sequence, historyLimit] of [[1, 10], [2, 80]]) {
    const manifest = await original.manifest(sequence);
    manifest.information.historyLimit = historyLimit;
    await fs.writeFile(original.file(`transactions/${sequence}.json`), JSON.stringify(manifest));
  }
  await fs.rm(original.file('project_settings'));
  const journal = await new ProjectJournal(root).load();
  assert.equal(JSON.parse(await journal.content()).historyLimit, 80);
  assert.equal(JSON.parse((await journal.navigate('undo')).content).historyLimit, 80);
  assert.equal((await journal.commit(JSON.stringify({ ...JSON.parse(content(0)), historyLimit: 999 }), 'core.project.information')).changed, false);
  assert.equal((await journal.historyGraph()).nodes.length, 2);
  const before = await journal.manifest(1), after = structuredClone(before);
  after.information.historyLimit = 1000;
  assert.equal(ProjectJournal.historySignature(before), ProjectJournal.historySignature(after));
  await journal.setHistoryLimit(500);
  assert.equal(JSON.parse(await (await new ProjectJournal(root).load()).content()).historyLimit, 500);
});

test('history marks are independent metadata, survive both archive modes, and follow node cleanup', async t => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.history-marks-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(__dirname, '..'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const journal = await new ProjectJournal(path.join(root, 'source')).initialize(content(0));
  await journal.commit(content(10), 'core.element.move');
  await journal.commit(content(20), 'core.element.move');
  await journal.navigate('undo');
  const before = structuredClone(journal.state);
  const { HISTORY_MARK_SHAPES, historyMarkPath } = await import('../src/project/history-mark-shapes.js');
  const paths = new Set();
  for (const { id } of HISTORY_MARK_SHAPES) {
    await journal.setHistoryMark(2, { shape: id, color: '#C85AFF', name: '  節點 R <test>  ' });
    const mark = (await journal.historyGraph()).nodes.find(node => node.sequence === 2).mark;
    assert.deepEqual(mark, { shape: id, color: '#c85aff', name: '節點 R <test>' });
    const path = historyMarkPath(id);
    assert.ok(!/NaN|Infinity/.test(path));
    paths.add(path);
  }
  assert.equal(paths.size, 6);
  assert.deepEqual(journal.state, before);
  assert.equal((await journal.navigate('redo')).sequence, 3);
  await journal.setHistoryMark(1, { shape: 'square', color: '#ffffff', name: 'Root' });
  await journal.setHistoryMark(3, { shape: 'star', color: '#abc123', name: 'Tip' });
  await assert.rejects(journal.setHistoryMark(3, { shape: 'wrong', color: '#fff000' }), /標記/);
  await assert.rejects(journal.setHistoryMark(999, { shape: 'circle', color: '#fff000' }));
  assert.equal(journal.state.activeHead, 3);
  assert.equal(journal.state.lastCommitted, 3);
  for (const includeHistory of [true, false]) {
    const archive = path.join(root, `${includeHistory}.cbmodel`);
    await journal.archive(archive, { includeHistory });
    const restored = await ProjectJournal.fromArchive(await fs.readFile(archive), path.join(root, `restored-${includeHistory}`));
    if (includeHistory) {
      assert.equal(restored.historyMarks[2].name, '節點 R <test>');
      assert.equal(Object.keys(restored.historyMarks).length, 3);
    }
    else assert.deepEqual(restored.historyMarks, { '1': { shape: 'star', color: '#abc123', name: 'Tip' } });
  }
  await journal.compactHistory(1);
  assert.equal(journal.historyMarks[1], undefined);
  await journal.pruneHistoryBranch(2, { single: true });
  assert.equal(journal.historyMarks[2], undefined);
  assert.equal(journal.historyMarks[3].name, 'Tip');
  await journal.setHistoryMark(3, null);
  const reopened = await new ProjectJournal(journal.directory).load();
  assert.deepEqual(reopened.historyMarks, {});
  assert.equal((await reopened.historyGraph()).nodes[0].mark, null);
});

test('frame-element metadata is reversible without changing or duplicating texture pixels', async t => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.frame-metadata-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(__dirname, '..'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const document = JSON.parse(content(10));
  document.textures[0].mode = 'tiled';
  document.textures[0].animation = { enabled: true, frames: [{ uid: 'frame_1', type: 'frame', name: 'Frame 1' }] };
  const source = document.textures[0].source, journal = await new ProjectJournal(root).initialize(JSON.stringify(document));
  document.textures[0].animation.frames.push({ uid: 'frame_2', type: 'frame', name: 'Frame 2' });
  await journal.commit(JSON.stringify(document), 'core.texture.frame.create');
  const delta = await journal.readRecord('texture_changes/2/texture_a.json');
  assert.ok(!JSON.stringify(delta).includes(source), 'metadata edits do not store another full pixel snapshot');
  const before = JSON.parse((await journal.navigate('undo')).content).textures[0];
  assert.deepEqual(before.animation.frames.map(frame => frame.uid), ['frame_1']);
  assert.equal(before.source, source);
  assert.equal(before.mode, 'tiled');
  const after = JSON.parse((await journal.navigate('redo')).content).textures[0];
  assert.deepEqual(after.animation.frames, document.textures[0].animation.frames);
  assert.equal(after.source, source);
  document.textures[0].animation.frames[0].layerUids = ['layer_a', 'group_a'];
  await journal.commit(JSON.stringify(document), 'core.texture.frame.link');
  const linked = JSON.parse((await journal.content())).textures[0];
  assert.deepEqual(linked.animation.frames[0].layerUids, ['layer_a', 'group_a']);
  assert.equal(linked.source, source);
  assert.equal(JSON.parse((await journal.navigate('undo')).content).textures[0].animation.frames[0].layerUids, undefined);
  assert.deepEqual(JSON.parse((await journal.navigate('redo')).content).textures[0].animation.frames[0].layerUids, ['layer_a', 'group_a']);
  const settings = document.textures[0].animation;
  settings.fps = 12;
  settings.interpolate = true;
  settings.frames[0].visibility = { layer_a: false };
  settings.frames[0].paintLayerUid = 'layer_b';
  await journal.commit(JSON.stringify(document), 'core.texture.frame.visibility');
  const reopened = await new ProjectJournal(root).load();
  assert.deepEqual(JSON.parse(await reopened.content()).textures[0].animation, settings);
  const old = JSON.parse((await reopened.navigate('undo')).content).textures[0].animation;
  assert.equal(old.frames[0].visibility, undefined);
  assert.deepEqual(JSON.parse((await reopened.navigate('redo')).content).textures[0].animation, settings);
});
