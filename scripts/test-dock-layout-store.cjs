const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createDockLayoutStore } = require('../electron/dock-layout-store.cjs');
const { atomicWrite } = require('../electron/project-journal.cjs');

test('layout writes are ordered, atomic and survive reopening independently of renderer storage', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cubebricks-dock-layout-'));
  const file = path.join(directory, 'dock-layout.json');
  const open = () => createDockLayoutStore(() => file, atomicWrite);
  try {
    const store = open();
    assert.equal(await store.read(), null);
    const snapshots = [1, 2, 3].map(order => ({ version: 1, updatedAt: order, zones: { right: true },
      corners: { edit: { left: true, right: false }, animate: { left: false, right: true } }, layout: {
      inspector: { dock: 'floating', order, x: 321, y: 123, width: 333, height: 444, collapsed: true,
        stackId: 'dock-stack-test', stackOrder: 0, stackActive: true }
    } }));
    const writes = snapshots.map(value => store.write(value));
    await store.flush();
    await Promise.all(writes);
    assert.deepEqual(await open().read(), snapshots.at(-1));
    assert.throws(() => store.write({ ...snapshots[0], layout: { bad: { dock: 'invalid' } } }), /Invalid dock layout/);
    assert.throws(() => store.write({ ...snapshots[0], corners: { edit: { left: 'true' } } }), /Invalid dock layout/);
    assert.deepEqual(await open().read(), snapshots.at(-1), 'invalid saves leave the existing file intact');
  } finally {
    await fs.unlink(file).catch(() => {});
    await fs.rmdir(directory);
  }
});
