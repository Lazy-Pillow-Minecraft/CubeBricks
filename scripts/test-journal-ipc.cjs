const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const mainFile = path.join(__dirname, '../electron/main.cjs');
const mainRequire = createRequire(mainFile);

async function application(root) {
  const handlers = new Map();
  let closed = false;
  const profile = path.join(root, 'profile');
  await fs.mkdir(profile, { recursive: true });
  const electron = {
    app: {
      getPath: name => name === 'userData' ? profile : root,
      commandLine: { appendSwitch() {} }, once() {}, on() {},
      whenReady: () => ({ then() {} })
    },
    BrowserWindow: { fromWebContents: () => ({ approveProjectClose() { closed = true; } }) },
    dialog: {}, ipcMain: { handle: (name, handler) => handlers.set(name, handler) }
  };
  const context = vm.createContext({
    require: name => name === 'electron' ? electron : mainRequire(name),
    __dirname: path.dirname(mainFile), process, Buffer, structuredClone, console, setTimeout
  });
  vm.runInContext(await fs.readFile(mainFile, 'utf8'), context, { filename: mainFile });
  return {
    call: (name, payload) => handlers.get(name)({ sender: {} }, payload),
    isClosed: () => closed,
    release: () => vm.runInContext('journalOwnership.releaseAll()', context)
  };
}

test('IPC cannot recover or delete a journal already open in another application instance', async () => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.journal-ipc-test-'));
  const apps = [];
  const id = 'project_12345678-1234-1234-1234-123456789012';
  try {
    const first = await application(root), second = await application(root);
    apps.push(first, second);
    await first.call('project:journal-init', { journalId: id, content: JSON.stringify({ name: 'test',
      elements: [{ uid: 'cube_a', type: 'cube', position: [0, 0, 0] }], groups: [], textures: [], outliner: ['cube_a'] }) });
    await assert.rejects(second.call('project:journal-recover', { journalId: id }), { code: 'JOURNAL_BUSY' });
    await assert.rejects(second.call('app:confirm-close', { discarded: [id], retained: [] }), /其他視窗/);
    assert.equal((await second.call('project:journal-list-recoverable')).length, 0);
    await first.call('app:confirm-close', { discarded: [], retained: [{ journalId: id, dirty: true, active: true }] });
    assert.equal(first.isClosed(), true);
    assert.equal((await second.call('app:retained-tabs')).length, 1);
    const recovered = await second.call('project:journal-recover', { journalId: id });
    assert.equal(JSON.parse(recovered.content).elements[0].uid, 'cube_a');
    // Changing workspace settings must not redirect a later deletion toward
    // an unrelated folder with the same session name.
    const movedRoot = path.join(root, 'different-workspace');
    await second.call('project:set-workspace-root', movedRoot);
    const decoy = path.join(movedRoot, id);
    await fs.mkdir(decoy);
    await fs.writeFile(path.join(decoy, 'keep.txt'), 'unrelated');
    await second.call('app:confirm-close', { discarded: [id], retained: [] });
    await assert.rejects(fs.access(path.join(root, 'profile', 'working-projects', id)), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(decoy, 'keep.txt'), 'utf8'), 'unrelated');
  } finally {
    await Promise.all(apps.map(app => app.release()));
    await fs.rm(root, { recursive: true, force: true });
  }
});
