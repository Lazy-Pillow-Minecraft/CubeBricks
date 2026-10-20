const { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const syncFs = require('fs');
const crypto = require('crypto');
const { ProjectJournal, atomicWrite } = require('./project-journal.cjs');
const { JournalOwnership } = require('./journal-ownership.cjs');
const { listShapePacks } = require('./shape-packs.cjs');
const appIcon = path.join(__dirname, '..', 'src', 'assets', process.platform === 'win32' ? 'shortcut-icon.ico' : 'shortcut-icon.png');
const journals = new Map();
const journalQueues = new Map();
const workspaceLayoutPromises = new Map();
const journalOwnership = new JournalOwnership();
const workspaceSettingsPath = () => path.join(app.getPath('userData'), 'project-workspace.json');
const retainedTabsPath = () => path.join(app.getPath('userData'), 'retained-project-tabs.json');
async function workspaceRoot() {
  try {
    const settings = JSON.parse(await fs.readFile(workspaceSettingsPath(), 'utf8'));
    if (typeof settings.directory === 'string' && path.isAbsolute(settings.directory)) return settings.directory;
  } catch { /* The default is under userData on the system drive. */ }
  return path.join(app.getPath('userData'), 'working-projects');
}
const JOURNAL_NAME = /^project_[a-f0-9-]{20,50}$/;
async function workspaceDirectories() {
  const root = await workspaceRoot();
  return { root, projects: path.join(root, 'projects'), shapePacks: path.join(root, 'shapepacks') };
}
async function ensureWorkspaceLayout() {
  const directories = await workspaceDirectories();
  const { root, projects, shapePacks } = directories;
  if (!workspaceLayoutPromises.has(root)) {
    const ready = (async () => {
      await Promise.all([fs.mkdir(projects, { recursive: true }), fs.mkdir(shapePacks, { recursive: true })]);
      const legacy = await fs.readdir(root, { withFileTypes: true });
      for (const entry of legacy) {
        if (!entry.isDirectory() || !JOURNAL_NAME.test(entry.name) || journals.has(entry.name)) continue;
        const source = path.join(root, entry.name), destination = path.join(projects, entry.name);
        if (await fs.stat(destination).then(() => true).catch(() => false)) continue;
        if (await journalOwnership.isLocked(source)) continue;
        try { await fs.rename(source, destination); }
        catch (error) { console.warn(`舊項目暫留原位置：${entry.name}`, error.message); continue; }
        const oldOwner = journalOwnership.lockPath(source), newOwner = journalOwnership.lockPath(destination);
        if (!await fs.stat(newOwner).then(() => true).catch(() => false)) {
          await fs.rename(oldOwner, newOwner).catch(error => {
            if (error.code !== 'ENOENT') console.warn(`舊項目鎖文件未遷移：${entry.name}`, error.message);
          });
        }
      }
    })().catch(error => { workspaceLayoutPromises.delete(root); throw error; });
    workspaceLayoutPromises.set(root, ready);
  }
  await workspaceLayoutPromises.get(root);
  return directories;
}
async function journalDirectory(id) {
  const { root, projects } = await ensureWorkspaceLayout();
  const current = path.join(projects, id), legacy = path.join(root, id);
  if (await fs.stat(current).then(stat => stat.isDirectory()).catch(() => false)) return current;
  if (await fs.stat(legacy).then(stat => stat.isDirectory()).catch(() => false)) return legacy;
  return current;
}
async function journalSearchRoots() {
  const { root, projects } = await ensureWorkspaceLayout();
  return [projects, root];
}
async function openWorkingJournal(id, loader) {
  const existing = journals.get(id);
  if (existing) { await existing.ensureReady(); return existing; }
  const directory = await journalDirectory(id);
  await journalOwnership.acquire(directory);
  try {
    const journal = await loader(directory);
    journals.set(id, journal);
    return journal;
  } catch (error) { await journalOwnership.release(directory); throw error; }
}
function queueJournal(id, task) {
  const previous = journalQueues.get(id) || Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    const journal = journals.get(id);
    if (journal) await journalOwnership.assertOwned(journal.directory);
    return task();
  });
  journalQueues.set(id, current);
  current.finally(() => { if (journalQueues.get(id) === current) journalQueues.delete(id); }).catch(() => {});
  return current;
}
function safeSessionId(value) {
  const id = String(value || '');
  if (!/^project_[a-f0-9-]{20,50}$/.test(id)) throw new Error('項目工作階段 ID 不合法');
  return id;
}
const fileHash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sameFilePath = (left, right) => typeof left === 'string' && typeof right === 'string'
  && (process.platform === 'win32'
    ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
    : path.resolve(left) === path.resolve(right));
async function journalCandidatesForFile(filePath) {
  const candidates = [];
  const seen = new Set();
  for (const root of await journalSearchRoots()) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !JOURNAL_NAME.test(entry.name)) continue;
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      const directory = path.join(root, entry.name);
      const saved = await fs.readFile(path.join(directory, 'saved_state'), 'utf8')
        .then(JSON.parse).catch(() => null);
      if (!sameFilePath(saved?.filePath, filePath)) continue;
      if (!journals.has(entry.name) && await journalOwnership.isLocked(directory)) continue;
      const state = await fs.readFile(path.join(directory, 'current_state'), 'utf8')
        .then(JSON.parse).catch(() => null);
      if (state?.status !== 'complete' || !Number.isInteger(state.activeHead)) continue;
      const projectUuid = await fs.readFile(path.join(directory, 'project_uuid'), 'utf8')
        .then(JSON.parse).catch(() => null);
      candidates.push({ id: entry.name, directory, saved, state, projectUuid });
    }
  }
  return candidates.sort((left, right) => String(right.saved.savedAt || '').localeCompare(String(left.saved.savedAt || '')));
}
async function classifyJournalCandidate(candidate, archive) {
  if (archive.projectUuid && candidate.projectUuid && archive.projectUuid !== candidate.projectUuid) return 'divergent';
  const localHead = candidate.state.activeHead;
  const localManifest = await fs.readFile(path.join(candidate.directory, 'transactions', `${localHead}.json`), 'utf8')
    .then(JSON.parse).catch(() => null);
  if (!localManifest) return 'divergent';
  if (archive.hasAncestor(localHead) && archive.signature(localHead) === ProjectJournal.historySignature(localManifest))
    return localHead === archive.activeHead ? 'same' : 'archive-ahead';
  const ancestor = await fs.readFile(path.join(candidate.directory, 'transactions', `${archive.activeHead}.json`), 'utf8')
    .then(JSON.parse).catch(() => null);
  if (ancestor && archive.signature(archive.activeHead) === ProjectJournal.historySignature(ancestor)) {
    let current = localHead;
    const visited = new Set();
    while (Number.isInteger(current) && !visited.has(current)) {
      if (current === archive.activeHead) return 'workspace-ahead';
      visited.add(current);
      const manifest = current === localHead ? localManifest
        : await fs.readFile(path.join(candidate.directory, 'transactions', `${current}.json`), 'utf8')
          .then(JSON.parse).catch(() => null);
      current = manifest?.parent;
    }
  }
  return 'divergent';
}
async function removeRetainedJournal(id) {
  const previous = await fs.readFile(retainedTabsPath(), 'utf8').then(JSON.parse).catch(() => null);
  if (!Array.isArray(previous) || !previous.some(tab => tab.journalId === id)) return;
  await atomicWrite(retainedTabsPath(), JSON.stringify(previous.filter(tab => tab.journalId !== id)));
}
async function discardOwnedJournal(id) {
  const journal = journals.get(id);
  if (!journal) return false;
  await journalOwnership.assertOwned(journal.directory);
  const target = path.resolve(journal.directory);
  if (path.basename(target) !== id || path.dirname(target) === target) throw new Error('工作目錄不在項目根目錄內');
  await fs.rm(target, { recursive: true, force: true });
  journals.delete(id);
  await journalOwnership.release(target);
  await removeRetainedJournal(id);
  return true;
}
async function discardIdleJournal(candidate) {
  if (journals.has(candidate.id)) return false;
  await journalOwnership.acquire(candidate.directory);
  try {
    const saved = await fs.readFile(path.join(candidate.directory, 'saved_state'), 'utf8').then(JSON.parse);
    if (!sameFilePath(saved.filePath, candidate.saved.filePath)) return false;
    const state = await fs.readFile(path.join(candidate.directory, 'current_state'), 'utf8').then(JSON.parse);
    if (state.activeHead !== candidate.state.activeHead || state.lastCommitted !== candidate.state.lastCommitted) return false;
    await fs.rm(candidate.directory, { recursive: true, force: true });
    await removeRetainedJournal(candidate.id);
    return true;
  } finally { await journalOwnership.release(candidate.directory); }
}

app.commandLine.appendSwitch('disable-features', 'WinUseBrowserSpellChecker');

// Multiple application processes must not compete for Chromium's disk cache.
// Keep sessionData/userData unchanged: theme, settings and dock layout live in
// localStorage there. Only disposable caches are isolated per process.
let instanceCacheDirectory = null;
try {
  instanceCacheDirectory = syncFs.mkdtempSync(path.join(app.getPath('temp'), 'cubebricks-cache-'));
  app.commandLine.appendSwitch('disk-cache-dir', instanceCacheDirectory);
} catch {
  app.commandLine.appendSwitch('disable-http-cache');
}
// This disables disk persistence only; GPU rendering and in-memory program
// caching remain available, including the software-rendering fallback below.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.once('quit', () => {
  if (!instanceCacheDirectory) return;
  try { syncFs.rmSync(instanceCacheDirectory, { recursive: true, force: true }); }
  catch { /* Windows may still hold a cache handle while Chromium exits. */ }
});

// Keep WebGL available on remote/virtual Windows sessions by using SwiftShader.
if (process.env.CUBEBRICKS_SOFTWARE_RENDERING === '1') {
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('in-process-gpu');
}

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    icon: appIcon,
    backgroundColor: '#11130f',
    titleBarStyle: 'hiddenInset',
    titleBarOverlay: process.platform === 'win32' ? {
      color: '#151812', symbolColor: '#dfe9d4', height: 38
    } : false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  win.removeMenu();
  let closeApproved = false;
  win.on('close', event => {
    if (closeApproved) return;
    event.preventDefault();
    win.webContents.send('app:request-close');
  });
  win.on('closed', () => { closeApproved = false; });
  win.approveProjectClose = () => { closeApproved = true; win.close(); };
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
};

ipcMain.handle('app:retained-tabs', async () => {
  try {
    const tabs = JSON.parse(await fs.readFile(retainedTabsPath(), 'utf8'));
    if (!Array.isArray(tabs)) return [];
    const available = [];
    for (const tab of tabs) {
      if (/^project_[a-f0-9-]{20,50}$/.test(tab.journalId)) {
        const directory = await journalDirectory(tab.journalId);
        if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)
          && !await journalOwnership.isLocked(directory)) available.push(tab);
      }
    }
    return available;
  } catch { return []; }
});

ipcMain.handle('app:confirm-close', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new Error('關閉視窗已不存在');
  const retained = (payload.retained || []).map(tab => ({
    journalId: safeSessionId(tab.journalId),
    filePath: typeof tab.filePath === 'string' ? tab.filePath : null,
    dirty: tab.dirty === true,
    active: tab.active === true
  }));
  const discarded = (payload.discarded || []).map(safeSessionId);
  const keepIds = new Set(retained.map(tab => tab.journalId));
  if (discarded.some(id => keepIds.has(id))) throw new Error('同一項目不能同時保留和刪除');
  for (const id of [...keepIds, ...discarded]) {
    const journal = journals.get(id);
    if (!journal || !journalOwnership.owned.has(path.resolve(journal.directory))) throw new Error('不能修改其他視窗的工作項目');
  }
  for (const id of discarded) {
    await queueJournal(id, async () => {
      // Use the directory claimed when opening, even if settings now point to
      // another workspace. Never delete a different instance's directory.
      const target = path.resolve(journals.get(id).directory);
      if (path.basename(target) !== id || path.dirname(target) === target) throw new Error('工作目錄不在項目根目錄內');
      await fs.rm(target, { recursive: true, force: true });
      journals.delete(id);
      await journalOwnership.release(target);
    });
  }
  // Keep tabs belonging to other app instances when this one closes.
  let previousTabs = [];
  try { previousTabs = JSON.parse(await fs.readFile(retainedTabsPath(), 'utf8')); } catch { /* First close. */ }
  const handled = new Set([...journals.keys(), ...discarded]);
  const otherTabs = Array.isArray(previousTabs) ? previousTabs.filter(tab => !handled.has(tab.journalId)) : [];
  await atomicWrite(retainedTabsPath(), JSON.stringify([...otherTabs, ...retained]));
  await journalOwnership.releaseAll();
  win.approveProjectClose();
  return true;
});

ipcMain.handle('project:open', async () => {
  const picked = await dialog.showOpenDialog({
    title: '打開模型',
    properties: ['openFile'],
    filters: [
      { name: 'CubeBricks / Blockbench', extensions: ['cbmodel', 'bbmodel'] },
      { name: 'JSON', extensions: ['json'] }
    ]
  });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const filePath = picked.filePaths[0];
  const bytes = await fs.readFile(filePath);
  if (bytes.subarray(0, 2).toString('ascii') === 'PK') {
    const archive = ProjectJournal.inspectArchive(bytes);
    archive.fileHash = fileHash(bytes);
    const candidates = await journalCandidatesForFile(filePath);
    let matched = null;
    let divergent = null;
    for (const candidate of candidates) {
      const relation = await classifyJournalCandidate(candidate, archive);
      if (relation === 'divergent') { divergent ||= candidate; continue; }
      matched = { candidate, relation };
      break;
    }
    if (matched && ['same', 'workspace-ahead'].includes(matched.relation)) {
      const { candidate } = matched;
      try {
        const journal = await openWorkingJournal(candidate.id, directory => new ProjectJournal(directory).load());
        const content = await journal.content();
        return { filePath, content, journalId: candidate.id,
          dirty: candidate.saved.sequence !== journal.state.activeHead,
          textureAssets: await readTextureAssets(content, filePath) };
      } catch (error) {
        if (error.code !== 'JOURNAL_BUSY') throw error;
        // Another process claimed the candidate after our read-only scan.
        // Keep its data untouched and open this archive in a separate session.
      }
    }
    let replace = matched?.relation === 'archive-ahead'
      && matched.candidate.saved.sequence === matched.candidate.state.activeHead
      && matched.candidate.state.lastCommitted === matched.candidate.state.activeHead
      ? matched.candidate : null;
    if (!matched && divergent) {
      const active = journals.has(divergent.id);
      const choice = await dialog.showMessageBox({
        type: 'warning', title: '同一項目的工作記錄不同',
        message: '這個文件與已有的展開工作記錄不屬於同一條歷史。',
        detail: active
          ? '現有工作副本仍在目前視窗使用；可以切換回它，或另外打開文件。'
          : '可以用文件取代舊工作副本，或保留兩份並另外打開。原始文件不會因此被改寫。',
        buttons: active ? ['另開一份', '切換到工作副本', '取消'] : ['另開一份', '以文件覆蓋工作副本', '取消'],
        defaultId: 0, cancelId: 2, noLink: true
      });
      if (choice.response === 2) return null;
      if (choice.response === 1 && active) {
        const journal = journals.get(divergent.id);
        const content = await journal.content();
        return { filePath, content, journalId: divergent.id, dirty: true,
          textureAssets: await readTextureAssets(content, filePath) };
      }
      if (choice.response === 1) replace = divergent;
    }
    const journalId = `project_${crypto.randomUUID()}`;
    const journal = await openWorkingJournal(journalId, directory => ProjectJournal.fromArchive(bytes, directory, archive.entries));
    await atomicWrite(path.join(journal.directory, 'saved_state'), JSON.stringify({
      sequence: journal.state.activeHead, filePath, projectUuid: journal.projectUuid,
      fileHash: archive.fileHash, savedAt: new Date().toISOString()
    }));
    const content = await journal.content();
    if (replace && !journals.has(replace.id)) {
      try { await discardIdleJournal(replace); }
      catch { /* Keep the old copy if another window claimed it meanwhile. */ }
    }
    return { filePath, content, journalId, textureAssets: await readTextureAssets(content, filePath) };
  }
  const content = bytes.toString('utf8');
  return { filePath, content, textureAssets: await readTextureAssets(content, filePath) };
});

ipcMain.handle('project:journal-init', async (_event, payload) => {
  const id = safeSessionId(payload.journalId);
  return queueJournal(id, async () => {
    await openWorkingJournal(id, directory => new ProjectJournal(directory).initialize(payload.content, payload.operationId || 'core.project.create', payload.operationIndex || []));
    return { journalId: id };
  });
});

ipcMain.handle('project:journal-discard', async (_event, payload) => {
  const id = safeSessionId(payload.journalId);
  return queueJournal(id, () => discardOwnedJournal(id));
});

ipcMain.handle('project:journal-commit', async (_event, payload) => {
  const id = safeSessionId(payload.journalId);
  return queueJournal(id, async () => {
    const journal = journals.get(id);
    if (!journal) throw new Error('項目工作目錄尚未建立');
    return journal.commit(payload.content, payload.operationId, payload.operationLabel, payload.operationIndex || []);
  });
});

ipcMain.handle('project:journal-checkout', async (_event, payload) => {
  const id = safeSessionId(payload.journalId);
  return queueJournal(id, async () => {
    const journal = journals.get(id);
    if (!journal) throw new Error('項目工作目錄尚未建立');
    if (payload.direction) return journal.navigate(payload.direction);
    return { content: await journal.checkout(payload.sequence), sequence: Number(payload.sequence) };
  });
});

ipcMain.handle('project:journal-state', async (_event, payload) => {
  const id = safeSessionId(payload.journalId);
  return queueJournal(id, async () => {
    const journal = journals.get(id);
    return journal ? { ...journal.state } : null;
  });
});

ipcMain.handle('project:journal-list-recoverable', async () => {
  const recoverable = [];
  const seen = new Set();
  for (const root of await journalSearchRoots()) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !JOURNAL_NAME.test(entry.name)) continue;
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      const directory = path.join(root, entry.name);
      if (journals.has(entry.name)) continue;
      let claimed = false;
      try {
        await journalOwnership.acquire(directory);
        claimed = true;
        const journal = await new ProjectJournal(directory).load();
        const saved = JSON.parse(await fs.readFile(path.join(directory, 'saved_state'), 'utf8').catch(() => 'null'));
        if (saved?.sequence === journal.state.activeHead) continue;
        const manifest = journal.activeManifest;
        if (manifest.sequence === 1 && !manifest.elementOrder.length && !manifest.textureIds.length) continue;
        recoverable.push({ journalId: entry.name, name: manifest.information.name || '未命名',
          sequence: journal.state.activeHead, modifiedAt: manifest.timestamp, filePath: saved?.filePath || null });
      } catch { /* Busy or incomplete projects must not be opened by another writer. */ }
      finally { if (claimed) await journalOwnership.release(directory); }
    }
  }
  return recoverable.sort((left, right) => String(right.modifiedAt).localeCompare(String(left.modifiedAt)));
});

ipcMain.handle('project:journal-recover', async (_event, payload) => {
  const id = safeSessionId(payload.journalId);
  return queueJournal(id, async () => {
    const journal = await openWorkingJournal(id, directory => new ProjectJournal(directory).load());
    const content = await journal.content();
    return { journalId: id, content, filePath: payload.filePath || null };
  });
});

ipcMain.handle('project:workspace-root', async () => (await ensureWorkspaceLayout()).root);
ipcMain.handle('shape-packs:list', async () => listShapePacks((await ensureWorkspaceLayout()).shapePacks));
ipcMain.handle('project:choose-workspace-root', async () => {
  const picked = await dialog.showOpenDialog({ title: '選擇項目工作目錄', properties: ['openDirectory', 'createDirectory'] });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const directory = picked.filePaths[0];
  await fs.mkdir(directory, { recursive: true });
  await atomicWrite(workspaceSettingsPath(), JSON.stringify({ directory }, null, 2));
  await ensureWorkspaceLayout();
  return directory;
});
ipcMain.handle('project:set-workspace-root', async (_event, directory) => {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('請選擇絕對路徑');
  await fs.mkdir(directory, { recursive: true });
  await atomicWrite(workspaceSettingsPath(), JSON.stringify({ directory }, null, 2));
  await ensureWorkspaceLayout();
  return directory;
});

async function readTextureAssets(content, modelPath) {
  let model;
  try { model = JSON.parse(content); } catch { return []; }
  const assets = [];
  for (const texture of model.textures || []) {
    let source = null;
    let loadedPath = null;
    const candidates = [];
    if (texture.relative_path) candidates.push(path.resolve(path.dirname(modelPath), texture.relative_path));
    if (texture.path) candidates.push(path.isAbsolute(texture.path) ? texture.path : path.resolve(path.dirname(modelPath), texture.path));
    for (const candidate of candidates) {
      try {
        const bytes = await fs.readFile(candidate);
        const extension = path.extname(candidate).toLowerCase();
        const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
          : extension === '.webp' ? 'image/webp'
            : extension === '.gif' ? 'image/gif' : 'image/png';
        source = `data:${mime};base64,${bytes.toString('base64')}`;
        loadedPath = candidate;
        break;
      } catch { /* Try the next Blockbench-compatible path. */ }
    }
    if (!source && typeof texture.source === 'string' && texture.source.startsWith('data:image/')) source = texture.source;
    if (source) assets.push({
      uuid: texture.uuid,
      id: texture.id,
      name: texture.name || path.basename(loadedPath || 'texture.png'),
      source,
      uvWidth: texture.uv_width,
      uvHeight: texture.uv_height,
      useAsDefault: texture.use_as_default === true,
      groupId: texture.group_id || null,
      kind: texture.kind || 'IMAGE',
      mode: texture.mode || 'default',
      layers: texture.layers || null, activeLayerUid: texture.active_layer_uid || null, animation: texture.animation || null
    });
  }
  return assets;
}

ipcMain.handle('project:save', async (_event, payload) => {
  let filePath = payload.filePath;
  if (!filePath) {
    const picked = await dialog.showSaveDialog({
      title: '保存 CubeBricks 模型',
      defaultPath: `${payload.name || 'untitled'}.cbmodel`,
      filters: [{ name: 'CubeBricks Model', extensions: ['cbmodel'] }]
    });
    if (picked.canceled || !picked.filePath) return null;
    filePath = picked.filePath;
  }
  const id = payload.journalId ? safeSessionId(payload.journalId) : `project_${crypto.randomUUID()}`;
  await queueJournal(id, async () => {
    let journal = journals.get(id);
    if (!journal) {
      journal = await openWorkingJournal(id, directory => new ProjectJournal(directory).initialize(payload.content));
    } else if (payload.content) await journal.commit(payload.content, payload.operationId || 'core.project.information', payload.operationLabel || '修改項目信息');
    await journal.archive(filePath);
  });
  return { filePath };
});

ipcMain.handle('project:export', async (_event, payload) => {
  const picked = await dialog.showSaveDialog({
    title: '導出模型',
    defaultPath: `${payload.name || 'untitled'}.bbmodel`,
    filters: [
      { name: 'Blockbench Model', extensions: ['bbmodel'] },
      { name: 'CubeBricks Model', extensions: ['cbmodel'] }
    ]
  });
  if (picked.canceled || !picked.filePath) return null;
  let filePath = picked.filePath;
  let extension = path.extname(filePath).toLowerCase();
  if (extension !== '.cbmodel' && extension !== '.bbmodel') {
    extension = '.bbmodel';
    filePath += extension;
  }
  if (extension === '.cbmodel') {
    const id = payload.journalId ? safeSessionId(payload.journalId) : `project_${crypto.randomUUID()}`;
    await queueJournal(id, async () => {
      let journal = journals.get(id);
      if (!journal) {
        journal = await openWorkingJournal(id, directory => new ProjectJournal(directory).initialize(payload.cbmodelContent));
      } else await journal.commit(payload.cbmodelContent, payload.operationId || 'core.project.information', payload.operationLabel || '修改項目信息');
      await journal.archive(filePath);
    });
  } else await atomicWrite(filePath, payload.bbmodelContent);
  return { filePath, extension };
});

function capturePngBuffer(dataUrl) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('模型截圖不是有效的 PNG');
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length || buffer.length > 64 * 1024 * 1024) throw new Error('模型截圖尺寸無效');
  return buffer;
}

ipcMain.handle('image:save-capture', async (_event, payload) => {
  const image = capturePngBuffer(payload?.dataUrl);
  const safeName = path.basename(String(payload?.name || 'model-capture.png')).replace(/[<>:"/\\|?*]/g, '_');
  const picked = await dialog.showSaveDialog({
    title: '另存模型截圖', defaultPath: safeName,
    filters: [{ name: 'PNG 圖片', extensions: ['png'] }]
  });
  if (picked.canceled || !picked.filePath) return null;
  const filePath = path.extname(picked.filePath).toLowerCase() === '.png'
    ? picked.filePath : `${picked.filePath}.png`;
  await fs.writeFile(filePath, image);
  return { filePath };
});

ipcMain.handle('image:copy-capture', (_event, dataUrl) => {
  const image = nativeImage.createFromBuffer(capturePngBuffer(dataUrl));
  if (image.isEmpty()) throw new Error('無法讀取模型截圖');
  clipboard.writeImage(image);
  return true;
});

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.cubebricks.desktop');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
