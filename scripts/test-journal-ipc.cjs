const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const mainFile = path.join(__dirname, '../electron/main.cjs');
const mainRequire = createRequire(mainFile);

async function application(root, options = {}) {
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
    dialog: {
      showOpenDialog: async () => ({ canceled: !options.openFile, filePaths: options.openFile ? [options.openFile] : [] }),
      showMessageBox: async data => {
        options.messages?.push(data);
        return { response: options.choice ?? 0 };
      }
    }, ipcMain: { handle: (name, handler) => handlers.set(name, handler) }
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
    await assert.rejects(fs.access(path.join(root, 'profile', 'working-projects', 'projects', id)), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(decoy, 'keep.txt'), 'utf8'), 'unrelated');
  } finally {
    await Promise.all(apps.map(app => app.release()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('legacy working journals move into projects while locked or conflicting folders stay intact', async () => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.journal-layout-test-'));
  const apps = [];
  const { ProjectJournal } = require('../electron/project-journal.cjs');
  const { JournalOwnership } = require('../electron/journal-ownership.cjs');
  const workspace = path.join(root, 'profile', 'working-projects');
  const movedId = 'project_11111111-1111-1111-1111-111111111111';
  const busyId = 'project_22222222-2222-2222-2222-222222222222';
  const conflictId = 'project_33333333-3333-3333-3333-333333333333';
  const owner = new JournalOwnership();
  try {
    await fs.mkdir(workspace, { recursive: true });
    for (const id of [movedId, busyId, conflictId]) {
      await new ProjectJournal(path.join(workspace, id)).initialize(JSON.stringify({
        name: id, elements: [], groups: [], textures: [], outliner: []
      }));
    }
    await fs.writeFile(path.join(workspace, `${movedId}.owner`), JSON.stringify({ pid: 99999999 }));
    await owner.acquire(path.join(workspace, busyId));
    const conflict = path.join(workspace, 'projects', conflictId);
    await fs.mkdir(conflict, { recursive: true });
    await fs.writeFile(path.join(conflict, 'keep.txt'), 'do not replace');
    const app = await application(root);
    apps.push(app);
    assert.equal(await app.call('project:workspace-root'), workspace);
    assert.ok((await fs.stat(path.join(workspace, 'projects', movedId))).isDirectory());
    await assert.rejects(fs.access(path.join(workspace, movedId)), { code: 'ENOENT' });
    assert.ok((await fs.stat(path.join(workspace, 'projects', `${movedId}.owner`))).isFile());
    assert.ok((await fs.stat(path.join(workspace, busyId))).isDirectory());
    assert.ok((await fs.stat(path.join(workspace, conflictId))).isDirectory());
    assert.equal(await fs.readFile(path.join(conflict, 'keep.txt'), 'utf8'), 'do not replace');
    assert.ok((await fs.stat(path.join(workspace, 'shapepacks'))).isDirectory());
    assert.equal(JSON.parse((await app.call('project:journal-recover', { journalId: movedId })).content).name, movedId);
  } finally {
    await owner.releaseAll();
    await Promise.all(apps.map(app => app.release()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('workspace home uses its index until the user explicitly refreshes it', async () => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.journal-index-test-'));
  const apps = [];
  const id = 'project_44444444-4444-4444-4444-444444444444';
  try {
    const app = await application(root);
    apps.push(app);
    assert.equal((await app.call('project:list-workspace')).length, 0);
    const folder = path.join(root, 'profile', 'working-projects', 'projects', id);
    const { ProjectJournal } = require('../electron/project-journal.cjs');
    await new ProjectJournal(folder).initialize(JSON.stringify({ name: 'external',
      elements: [], groups: [], textures: [], outliner: [] }));
    assert.equal((await app.call('project:list-workspace')).length, 0,
      'normal home navigation should not rescan every project folder');
    const refreshed = await app.call('project:list-workspace', { refresh: true });
    assert.equal(refreshed.length, 1);
    assert.equal(refreshed[0].name, 'external');
  } finally {
    await Promise.all(apps.map(app => app.release()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('project UUID survives archive reopening and the same file reuses its working directory', async () => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.journal-uuid-test-'));
  const apps = [];
  try {
    const { ProjectJournal } = require('../electron/project-journal.cjs');
    const archive = path.join(root, 'model.cbmodel');
    const source = await new ProjectJournal(path.join(root, 'source')).initialize(JSON.stringify({
      name: 'model', elements: [{ uid: 'cube_a', type: 'cube', position: [0, 0, 0] }],
      groups: [], textures: [], outliner: ['cube_a']
    }));
    await source.archive(archive);
    const first = await application(root, { openFile: archive });
    apps.push(first);
    const opened = await first.call('project:open');
    assert.equal(JSON.parse(opened.content).projectUuid, source.projectUuid);
    assert.equal((await first.call('project:open')).journalId, opened.journalId);
    const changed = JSON.parse(opened.content);
    changed.elements[0].position[0] = 9;
    await first.call('project:journal-commit', { journalId: opened.journalId,
      content: JSON.stringify(changed), operationId: 'core.element.move' });
    const resumed = await first.call('project:open');
    assert.equal(resumed.journalId, opened.journalId);
    assert.equal(resumed.dirty, true);
    assert.equal(JSON.parse(resumed.content).elements[0].position[0], 9);
    await first.release();
    const second = await application(root, { openFile: archive });
    apps.push(second);
    assert.equal((await second.call('project:open')).journalId, opened.journalId);
    const folders = await fs.readdir(path.join(root, 'profile', 'working-projects', 'projects'), { withFileTypes: true });
    assert.equal(folders.filter(entry => entry.isDirectory() && entry.name.startsWith('project_')).length, 1);
  } finally {
    await Promise.all(apps.map(app => app.release()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a newer archive on the same history replaces only an idle, saved working copy', async () => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.journal-newer-test-'));
  const apps = [];
  try {
    const { ProjectJournal } = require('../electron/project-journal.cjs');
    const archive = path.join(root, 'model.cbmodel');
    const content = position => JSON.stringify({ name: 'model',
      elements: [{ uid: 'cube_a', type: 'cube', position: [position, 0, 0] }],
      groups: [], textures: [], outliner: ['cube_a'] });
    const source = await new ProjectJournal(path.join(root, 'source')).initialize(content(0));
    await source.archive(archive);
    const first = await application(root, { openFile: archive });
    apps.push(first);
    const original = await first.call('project:open');
    await first.release();
    await source.commit(content(7), 'core.element.move');
    await source.archive(archive);
    const second = await application(root, { openFile: archive });
    apps.push(second);
    const reopened = await second.call('project:open');
    assert.notEqual(reopened.journalId, original.journalId);
    assert.equal(JSON.parse(reopened.content).projectUuid, source.projectUuid);
    assert.equal(JSON.parse(reopened.content).elements[0].position[0], 7);
    const folders = await fs.readdir(path.join(root, 'profile', 'working-projects', 'projects'), { withFileTypes: true });
    assert.equal(folders.filter(entry => entry.isDirectory() && entry.name.startsWith('project_')).length, 1);
  } finally {
    await Promise.all(apps.map(app => app.release()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('divergent history asks before replacing a working copy', async () => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.journal-divergent-test-'));
  const apps = [];
  try {
    const { ProjectJournal } = require('../electron/project-journal.cjs');
    const archive = path.join(root, 'model.cbmodel');
    const messages = [];
    const options = { openFile: archive, messages, choice: 0 };
    const original = await new ProjectJournal(path.join(root, 'original')).initialize(JSON.stringify({
      name: 'model', elements: [{ uid: 'cube_a', type: 'cube', position: [0, 0, 0] }],
      groups: [], textures: [], outliner: ['cube_a']
    }));
    await original.archive(archive);
    const app = await application(root, options);
    apps.push(app);
    const first = await app.call('project:open');
    const divergent = await new ProjectJournal(path.join(root, 'divergent')).initialize(JSON.stringify({
      projectUuid: original.projectUuid, name: 'model',
      elements: [{ uid: 'cube_a', type: 'cube', position: [99, 0, 0] }],
      groups: [], textures: [], outliner: ['cube_a']
    }));
    await divergent.archive(archive);
    const separate = await app.call('project:open');
    assert.notEqual(separate.journalId, first.journalId);
    assert.equal(messages.length, 1);
    assert.equal(JSON.parse(separate.content).elements[0].position[0], 99);
    options.choice = 2;
    // Another divergent file is canceled without changing either open copy.
    const third = await new ProjectJournal(path.join(root, 'third')).initialize(JSON.stringify({
      projectUuid: original.projectUuid, name: 'model',
      elements: [{ uid: 'cube_a', type: 'cube', position: [101, 0, 0] }],
      groups: [], textures: [], outliner: ['cube_a']
    }));
    await third.archive(archive);
    assert.equal(await app.call('project:open'), null);
  } finally {
    await Promise.all(apps.map(app => app.release()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('explicit overwrite replaces an idle divergent copy without touching the source file', async () => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.journal-overwrite-test-'));
  const apps = [];
  try {
    const { ProjectJournal } = require('../electron/project-journal.cjs');
    const archive = path.join(root, 'model.cbmodel');
    const content = (uuid, position) => JSON.stringify({ projectUuid: uuid, name: 'model',
      elements: [{ uid: 'cube_a', type: 'cube', position: [position, 0, 0] }],
      groups: [], textures: [], outliner: ['cube_a'] });
    const firstSource = await new ProjectJournal(path.join(root, 'first')).initialize(content(null, 0));
    await firstSource.archive(archive);
    const first = await application(root, { openFile: archive });
    apps.push(first);
    const opened = await first.call('project:open');
    await first.release();
    const replacement = await new ProjectJournal(path.join(root, 'replacement')).initialize(content(firstSource.projectUuid, 30));
    await replacement.archive(archive);
    const second = await application(root, { openFile: archive, choice: 1 });
    apps.push(second);
    const result = await second.call('project:open');
    assert.notEqual(result.journalId, opened.journalId);
    assert.equal(JSON.parse(result.content).elements[0].position[0], 30);
    assert.equal(ProjectJournal.inspectArchive(await fs.readFile(archive)).projectUuid, firstSource.projectUuid);
    const folders = await fs.readdir(path.join(root, 'profile', 'working-projects', 'projects'), { withFileTypes: true });
    assert.equal(folders.filter(entry => entry.isDirectory() && entry.name.startsWith('project_')).length, 1);
  } finally {
    await Promise.all(apps.map(app => app.release()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a shared transaction outside the active branch is still a divergence', async () => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.journal-branch-test-'));
  const apps = [];
  try {
    const { ProjectJournal } = require('../electron/project-journal.cjs');
    const archive = path.join(root, 'model.cbmodel');
    const content = position => JSON.stringify({ name: 'model',
      elements: [{ uid: 'cube_a', type: 'cube', position: [position, 0, 0] }],
      groups: [], textures: [], outliner: ['cube_a'] });
    const source = await new ProjectJournal(path.join(root, 'source')).initialize(content(0));
    await source.commit(content(1), 'core.element.move');
    await source.commit(content(2), 'core.element.move');
    await source.archive(archive);
    const messages = [];
    const app = await application(root, { openFile: archive, messages, choice: 2 });
    apps.push(app);
    const opened = await app.call('project:open');
    await app.call('project:journal-checkout', { journalId: opened.journalId, direction: 'undo' });
    await app.call('project:journal-commit', { journalId: opened.journalId,
      content: content(40), operationId: 'core.element.move' });
    assert.equal(await app.call('project:open'), null);
    assert.equal(messages.length, 1);
  } finally {
    await Promise.all(apps.map(app => app.release()));
    await fs.rm(root, { recursive: true, force: true });
  }
});
