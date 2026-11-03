const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { WorkerProjectJournal } = require('../electron/journal-service.cjs');

async function workspace(t) {
  const workspaceRoot = path.resolve(__dirname, '..');
  const root = await fs.mkdtemp(path.join(workspaceRoot, '.journal-worker-test-'));
  const journals = [];
  t.after(async () => {
    await Promise.all(journals.map(journal => journal.dispose()));
    const target = path.resolve(root);
    assert.equal(path.dirname(target), workspaceRoot);
    assert.ok(path.basename(target).startsWith('.journal-worker-test-'));
    await fs.rm(target, { recursive: true, force: true });
  });
  return { root, journal(name) {
    const journal = new WorkerProjectJournal(path.join(root, name));
    journals.push(journal);
    return journal;
  }, track(journal) { journals.push(journal); return journal; } };
}
const content = x => JSON.stringify({ name: 'worker', elements: [
  { type:'cube', uid:'cube_one', position:[x,0,0], size:[2,2,2], pivot:[0,0,0], rotation:[0,0,0] }
], groups:[], textures:[] });

test('journal worker keeps undo, redo, UUID and archive progress across the process boundary', async t => {
  const store = await workspace(t), journal = store.journal('source');
  await journal.initialize(content(0), 'core.project.create');
  const uuid = journal.projectUuid;
  await journal.commit(content(7), 'core.element.move');
  const undone = await journal.navigate('undo');
  assert.equal(JSON.parse(undone.content).elements[0].position[0], 0);
  assert.equal(journal.state.activeHead, 1);
  assert.ok(journal.lastCheckoutChangedUids.includes('cube_one'));
  const redone = await journal.navigate('redo');
  assert.equal(JSON.parse(redone.content).elements[0].position[0], 7);
  const archivePath = path.join(store.root, 'model.cbmodel');
  await journal.archive(archivePath);
  const bytes = await fs.readFile(archivePath), progress = [];
  const restored = store.track(await WorkerProjectJournal.fromArchive(bytes,
    path.join(store.root, 'restored'), null, value => progress.push(value)));
  assert.equal(restored.projectUuid, uuid);
  assert.equal(JSON.parse(await restored.content()).elements[0].position[0], 7);
  assert.ok(progress.length > 0);
  assert.equal(JSON.parse((await restored.navigate('undo')).content).elements[0].position[0], 0);
});

test('journal worker returns validation failures and recovers without changing committed data', async t => {
  const store = await workspace(t), journal = store.journal('source');
  await journal.initialize(content(0), 'core.project.create');
  await assert.rejects(journal.commit(content(3), 'invalid operation'), /操作 ID/);
  assert.equal(JSON.parse(await journal.content()).elements[0].position[0], 0);
  await journal.commit(content(5), 'core.element.move');
  assert.equal(JSON.parse(await journal.content()).elements[0].position[0], 5);
});
