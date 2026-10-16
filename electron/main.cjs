const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const syncFs = require('fs');
const crypto = require('crypto');
const { ProjectJournal, atomicWrite } = require('./project-journal.cjs');
const { JournalOwnership } = require('./journal-ownership.cjs');
const appIcon = path.join(__dirname, '..', 'src', 'assets', process.platform === 'win32' ? 'shortcut-icon.ico' : 'shortcut-icon.png');
const journals = new Map();
const journalQueues = new Map();
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
async function journalDirectory(id) { return path.join(await workspaceRoot(), id); }
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
      if (/^project_[a-f0-9-]{20,50}$/.test(tab.journalId)
        && !await journalOwnership.isLocked(await journalDirectory(tab.journalId))) available.push(tab);
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
    const journalId = `project_${crypto.randomUUID()}`;
    const journal = await openWorkingJournal(journalId, directory => ProjectJournal.fromArchive(bytes, directory));
    await atomicWrite(path.join(journal.directory, 'saved_state'), JSON.stringify({ sequence: journal.state.activeHead, filePath, savedAt: new Date().toISOString() }));
    journals.set(journalId, journal);
    const content = await journal.content();
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
  const root = await workspaceRoot();
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const recoverable = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^project_[a-f0-9-]{20,50}$/.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    if (journals.has(entry.name)) continue;
    let claimed = false;
    try {
      await journalOwnership.acquire(directory);
      claimed = true;
      const journal = await new ProjectJournal(directory).load();
      const saved = JSON.parse(await fs.readFile(path.join(root, entry.name, 'saved_state'), 'utf8').catch(() => 'null'));
      if (saved?.sequence === journal.state.activeHead) continue;
      const manifest = journal.activeManifest;
      if (manifest.sequence === 1 && !manifest.elementOrder.length && !manifest.textureIds.length) continue;
      recoverable.push({ journalId: entry.name, name: manifest.information.name || '未命名',
        sequence: journal.state.activeHead, modifiedAt: manifest.timestamp, filePath: saved?.filePath || null });
    } catch { /* Busy or incomplete projects must not be opened by another writer. */ }
    finally { if (claimed) await journalOwnership.release(directory); }
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

ipcMain.handle('project:workspace-root', async () => workspaceRoot());
ipcMain.handle('project:choose-workspace-root', async () => {
  const picked = await dialog.showOpenDialog({ title: '選擇項目工作目錄', properties: ['openDirectory', 'createDirectory'] });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const directory = picked.filePaths[0];
  await fs.mkdir(directory, { recursive: true });
  await atomicWrite(workspaceSettingsPath(), JSON.stringify({ directory }, null, 2));
  return directory;
});
ipcMain.handle('project:set-workspace-root', async (_event, directory) => {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('請選擇絕對路徑');
  await fs.mkdir(directory, { recursive: true });
  await atomicWrite(workspaceSettingsPath(), JSON.stringify({ directory }, null, 2));
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
