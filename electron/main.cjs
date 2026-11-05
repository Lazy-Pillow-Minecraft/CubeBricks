const { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, screen } = require('electron');
const { startMainPerformanceCapture, stopMainPerformanceCapture, trackMainOperation } = require('./main-performance.cjs');
const handleIpc = (name, handler) => ipcMain.handle(name, trackMainOperation(name, handler));
const path = require('path');
const fs = require('fs/promises');
const syncFs = require('fs');
const crypto = require('crypto');
const { atomicWrite } = require('./project-journal.cjs');
const { readTextureAssets, registerTextureFiles } = require('./texture-files.cjs');
const { readNativeModel, writeTextureReferences } = require('./native-model-io.cjs');
const { WorkerProjectJournal: ProjectJournal, onHistoryProgress } = require('./journal-service.cjs');
const { isArchiveV2, unpackArchiveWithProgress } = require('./archive-codec.cjs');
const { openIndexedArchive } = require('./archive-index.cjs');
const { JournalOwnership } = require('./journal-ownership.cjs');
const { readProjectRetention, initializeProjectRetention, retainProject } = require('./project-retention.cjs');
const { listResourcePacks, orderedShapePacks, installPack, removePack, savePackOrder, readFontPack } = require('./resource-packs.cjs');
const appIcon = path.join(__dirname, '..', 'src', 'assets', process.platform === 'win32' ? 'shortcut-icon.ico' : 'shortcut-icon.png');
const journals = new Map();
const journalQueues = new Map();
const workspaceLayoutPromises = new Map();
const workspaceCatalogs = new Map();
const workspaceCatalogWrites = new Map();
const journalOwnership = new JournalOwnership();
const workspaceSettingsPath = () => path.join(app.getPath('userData'), 'project-workspace.json');
const colorMapSettingsPath = () => path.join(app.getPath('userData'), 'palettes.cbcmap');
const retainedTabsPath = () => path.join(app.getPath('userData'), 'retained-project-tabs.json');
const coverPath = id => path.join(app.getPath('userData'), 'project-covers', `${safeSessionId(id)}.png`);
onHistoryProgress(({ directory, ...progress }) => {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed())
    win.webContents.send('project:history-progress', { journalId: path.basename(directory), ...progress });
});
const pendingExternalProjects = [];
let externalOpenReceiver = null;
const pendingUiPrompts = new Map();
function requestUiChoice(sender, options) {
  if (!sender || sender.isDestroyed()) return Promise.resolve({ index: options.cancelIndex ?? options.buttons.length - 1 });
  return new Promise(resolve => {
    const id = crypto.randomUUID();
    const finish = result => {
      pendingUiPrompts.delete(id);
      sender.removeListener('destroyed', canceled);
      resolve(result);
    };
    const canceled = () => finish({ index: options.cancelIndex ?? options.buttons.length - 1 });
    pendingUiPrompts.set(id, { sender, finish });
    sender.once('destroyed', canceled);
    sender.send('app:prompt-request', { id, options });
  });
}
handleIpc('app:prompt-response', (event, response) => {
  const pending = pendingUiPrompts.get(response?.id);
  if (!pending || pending.sender !== event.sender) return false;
  pending.finish({ index: Number(response.index), checked: response.checked === true });
  return true;
});
function externalProjectPath(argumentsList) {
  return argumentsList.map(value => String(value).replace(/^"|"$/g, ''))
    .find(value => /\.(?:cbmodel|bbmodel|json|java)$/i.test(value) && path.isAbsolute(value)) || null;
}
function queueExternalProject(filePath) {
  if (!filePath) return;
  if (externalOpenReceiver && !externalOpenReceiver.isDestroyed?.())
    externalOpenReceiver.send?.('project:external-open', filePath);
  else pendingExternalProjects.push(filePath);
}
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
  return { root, projects: path.join(root, 'projects'), shapePacks: path.join(root, 'shapepacks'),
    languagePacks: path.join(root, 'languagepacks'), fontPacks: path.join(root, 'fontpacks') };
}
async function ensureWorkspaceLayout() {
  const directories = await workspaceDirectories();
  const { root, projects, shapePacks, languagePacks, fontPacks } = directories;
  if (!workspaceLayoutPromises.has(root)) {
    const ready = (async () => {
      await Promise.all([projects, shapePacks, languagePacks, fontPacks].map(directory => fs.mkdir(directory, { recursive: true })));
      const marker = path.join(root, '.workspace-layout-v2');
      if (await fs.stat(marker).then(() => true).catch(() => false)) return;
      const legacy = await fs.readdir(root, { withFileTypes: true });
      let migrationFailed = false;
      for (const entry of legacy) {
        if (!entry.isDirectory() || !JOURNAL_NAME.test(entry.name) || journals.has(entry.name)) continue;
        const source = path.join(root, entry.name), destination = path.join(projects, entry.name);
        if (await fs.stat(destination).then(() => true).catch(() => false)) continue;
        if (await journalOwnership.isLocked(source)) continue;
        try { await fs.rename(source, destination); }
        catch (error) { migrationFailed = true; console.warn(`舊項目暫留原位置：${entry.name}`, error.message); continue; }
        const oldOwner = journalOwnership.lockPath(source), newOwner = journalOwnership.lockPath(destination);
        if (!await fs.stat(newOwner).then(() => true).catch(() => false)) {
          await fs.rename(oldOwner, newOwner).catch(error => {
            if (error.code !== 'ENOENT') console.warn(`舊項目鎖文件未遷移：${entry.name}`, error.message);
          });
        }
      }
      if (!migrationFailed) await atomicWrite(marker, 'complete');
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
async function projectSummary(id, directory) {
  const state = await fs.readFile(path.join(directory, 'current_state'), 'utf8').then(JSON.parse).catch(() => null);
  if (state?.status !== 'complete' || !Number.isInteger(state.activeHead)) return null;
  const manifest = await fs.readFile(path.join(directory, 'transactions', `${state.activeHead}.json`), 'utf8')
    .then(JSON.parse).catch(() => null);
  if (!manifest) return null;
  const saved = await fs.readFile(path.join(directory, 'saved_state'), 'utf8').then(JSON.parse).catch(() => null);
  const retention = await readProjectRetention(directory);
  return { journalId: id, name: manifest.information?.name || '未命名',
    modifiedAt: manifest.timestamp || '', sequence: state.activeHead,
    savedSequence: retention.savedSequence ?? saved?.sequence ?? null, persistent: retention.persistent, filePath: saved?.filePath || null,
    elementCount: manifest.elementOrder?.length || 0, textureCount: manifest.textureIds?.length || 0 };
}
async function workspaceCatalog() {
  const { root, projects } = await ensureWorkspaceLayout();
  if (!workspaceCatalogs.has(root)) workspaceCatalogs.set(root, (async () => {
    const file = path.join(root, 'project-index.json');
    const stored = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => null);
    if (stored?.version === 1 && Array.isArray(stored.projects)) return stored;
    // One-time migration: afterwards startup and file-open use the index, not
    // a deep ProjectJournal.load() pass through every working directory.
    const found = new Map();
    for (const searchRoot of [projects, root]) {
      for (const entry of await fs.readdir(searchRoot, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory() || !JOURNAL_NAME.test(entry.name) || found.has(entry.name)) continue;
        const summary = await projectSummary(entry.name, path.join(searchRoot, entry.name));
        if (summary) found.set(entry.name, summary);
      }
    }
    const catalog = { version: 1, projects: [...found.values()] };
    await atomicWrite(file, JSON.stringify(catalog));
    return catalog;
  })().catch(error => { workspaceCatalogs.delete(root); throw error; }));
  return { root, catalog: await workspaceCatalogs.get(root) };
}
function mutateWorkspaceCatalog(change) {
  const pending = (async () => {
    const { root } = await ensureWorkspaceLayout();
    const previous = workspaceCatalogWrites.get(root) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const { catalog } = await workspaceCatalog();
      await change(catalog);
      await atomicWrite(path.join(root, 'project-index.json'), JSON.stringify(catalog));
    });
    workspaceCatalogWrites.set(root, current);
    try { await current; } finally { if (workspaceCatalogWrites.get(root) === current) workspaceCatalogWrites.delete(root); }
  });
  return pending();
}
function indexWorkingJournal(journal) {
  return mutateWorkspaceCatalog(async catalog => {
    const summary = await projectSummary(path.basename(journal.directory), journal.directory);
    catalog.projects = catalog.projects.filter(entry => entry.journalId !== path.basename(journal.directory));
    if (summary) catalog.projects.push(summary);
  });
}
function unindexWorkingJournal(id) {
  return mutateWorkspaceCatalog(catalog => {
    catalog.projects = catalog.projects.filter(entry => entry.journalId !== id);
  });
}
async function openWorkingJournal(id, loader) {
  const existing = journals.get(id);
  if (existing) { await existing.ensureReady(); return existing; }
  const directory = await journalDirectory(id);
  await journalOwnership.acquire(directory);
  try {
    const journal = await loader(directory);
    journals.set(id, journal);
    await indexWorkingJournal(journal);
    return journal;
  } catch (error) {
    await journals.get(id)?.dispose?.().catch(() => {});
    journals.delete(id);
    await journalOwnership.release(directory);
    throw error;
  }
}
function queueJournal(id, task) {
  const previous = journalQueues.get(id) || Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    const journal = journals.get(id);
    if (journal) await journalOwnership.assertOwned(journal.directory);
    const result = await task();
    const current = journals.get(id);
    if (current) await indexWorkingJournal(current);
    else await unindexWorkingJournal(id);
    return result;
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
  const { catalog } = await workspaceCatalog();
  for (const entry of catalog.projects.filter(project => sameFilePath(project.filePath, filePath))) {
      const directory = await journalDirectory(entry.journalId);
      const saved = await fs.readFile(path.join(directory, 'saved_state'), 'utf8')
        .then(JSON.parse).catch(() => null);
      if (!sameFilePath(saved?.filePath, filePath)) continue;
      if (!journals.has(entry.journalId) && await journalOwnership.isLocked(directory)) continue;
      const state = await fs.readFile(path.join(directory, 'current_state'), 'utf8')
        .then(JSON.parse).catch(() => null);
      if (state?.status !== 'complete' || !Number.isInteger(state.activeHead)) continue;
      const projectUuid = await fs.readFile(path.join(directory, 'project_uuid'), 'utf8')
        .then(JSON.parse).catch(() => null);
      candidates.push({ id: entry.journalId, directory, saved, state, projectUuid });
  }
  return candidates.sort((left, right) => String(right.saved.savedAt || '').localeCompare(String(left.saved.savedAt || '')));
}
async function classifyJournalCandidate(candidate, archive) {
  if (archive.projectUuid && candidate.projectUuid && archive.projectUuid !== candidate.projectUuid) return 'divergent';
  // A capped working history may no longer contain the saved archive's head.
  if (candidate.saved?.fileHash && archive.fileHash === candidate.saved.fileHash) {
    const savedManifest = await fs.readFile(path.join(candidate.directory, 'transactions', `${candidate.saved.sequence}.json`), 'utf8')
      .then(JSON.parse).catch(() => null);
    if (!savedManifest && candidate.saved.prunedAncestor === true) {
      return candidate.state.activeHead === candidate.saved.sequence ? 'same' : 'workspace-ahead';
    }
    const archivedSaved = archive.entries.get(`transactions/${candidate.saved.sequence}.json`);
    if (archivedSaved && savedManifest.parent === null) {
      const archivedRecord = JSON.parse(archivedSaved.toString('utf8'));
      const originalSignature = ProjectJournal.historySignature({ ...savedManifest,
        parent: archivedRecord.parent, textureChanges: archivedRecord.textureChanges });
      if (originalSignature === archive.signature(candidate.saved.sequence)) {
        let current = candidate.state.activeHead;
        const visited = new Set();
        while (Number.isInteger(current) && !visited.has(current)) {
          if (current === candidate.saved.sequence) return current === candidate.state.activeHead ? 'same' : 'workspace-ahead';
          visited.add(current);
          const manifest = await fs.readFile(path.join(candidate.directory, 'transactions', `${current}.json`), 'utf8')
            .then(JSON.parse).catch(() => null);
          current = manifest?.parent;
        }
      }
    }
  }
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
async function discardOwnedJournal(id, { explicit = false } = {}) {
  const journal = journals.get(id);
  if (!journal) return false;
  await journalOwnership.assertOwned(journal.directory);
  if (!explicit && (await readProjectRetention(journal.directory)).persistent) return false;
  const target = path.resolve(journal.directory);
  if (path.basename(target) !== id || path.dirname(target) === target) throw new Error('工作目錄不在項目根目錄內');
  await journal.dispose();
  await fs.rm(target, { recursive: true, force: true });
  await fs.rm(coverPath(id), { force: true });
  journals.delete(id);
  await journalOwnership.release(target);
  await removeRetainedJournal(id);
  return true;
}
async function discardIdleJournal(candidate, { explicit = false } = {}) {
  if (journals.has(candidate.id)) return false;
  await journalOwnership.acquire(candidate.directory);
  try {
    if (!explicit && (await readProjectRetention(candidate.directory)).persistent) return false;
    const saved = await fs.readFile(path.join(candidate.directory, 'saved_state'), 'utf8').then(JSON.parse);
    if (!sameFilePath(saved.filePath, candidate.saved.filePath)) return false;
    const state = await fs.readFile(path.join(candidate.directory, 'current_state'), 'utf8').then(JSON.parse);
    if (state.activeHead !== candidate.state.activeHead || state.lastCommitted !== candidate.state.lastCommitted) return false;
    await fs.rm(candidate.directory, { recursive: true, force: true });
    await fs.rm(coverPath(candidate.id), { force: true });
    await unindexWorkingJournal(candidate.id);
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
    ...(process.platform === 'win32' ? { frame: false, thickFrame: true } : { titleBarStyle: 'hiddenInset' }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  win.removeMenu();
  const sendWindowState = () => {
    if (!win.isDestroyed()) win.webContents.send('app:window-state', { maximized: win.isMaximized() });
  };
  win.on('maximize', sendWindowState);
  win.on('unmaximize', sendWindowState);
  win.on('ready-to-show', sendWindowState);
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

handleIpc('app:window-control', (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return null;
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  } else if (action === 'close') win.close();
  return { maximized: win.isMaximized() };
});

handleIpc('app:cursor-client-point', event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || !win.isFocused()) return null;
  const started = process.hrtime.bigint();
  const cursor = screen.getCursorScreenPoint();
  const content = win.getContentBounds();
  return { x: cursor.x - content.x, y: cursor.y - content.y,
    mainDurationMs: Number(process.hrtime.bigint() - started) / 1e6 };
});

handleIpc('app:perf-start', () => startMainPerformanceCapture());
handleIpc('app:perf-stop', () => stopMainPerformanceCapture());

handleIpc('app:retained-tabs', async () => {
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

handleIpc('app:confirm-close', async (event, payload) => {
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
      if (!await discardOwnedJournal(id)) retained.push({ journalId: id, filePath: null, dirty: true, active: false });
    });
  }
  for (const tab of retained) {
    const journal = journals.get(tab.journalId);
    if (journal) await queueJournal(tab.journalId, async () => {
      await journal.finishHistoryImport();
      await retainProject(journal.directory, journal.state.activeHead);
    });
  }
  // Closed project tabs can still own a background history import. Finish
  // those writes before releasing ownership to another app instance.
  for (const [id, journal] of journals) if (!retained.some(tab => tab.journalId === id))
    await queueJournal(id, () => journal.finishHistoryImport());
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

handleIpc('project:open', async (event, options = {}) => {
  const suppliedPath = typeof options?.filePath === 'string' ? options.filePath : null;
  if (suppliedPath && (!path.isAbsolute(suppliedPath) || !/\.(?:cbmodel|bbmodel|json|java)$/i.test(suppliedPath)))
    throw new Error('不支援的項目文件路徑');
  const picked = suppliedPath ? { canceled: false, filePaths: [suppliedPath] } : await dialog.showOpenDialog({
    title: '打開模型',
    properties: ['openFile'],
    filters: [
      { name: 'CubeBricks / Blockbench', extensions: ['cbmodel', 'bbmodel'] },
      { name: 'JSON / Java', extensions: ['json', 'java'] }
    ]
  });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const filePath = picked.filePaths[0];
  let lastReportAt = 0, lastReportValue = -1;
  const report = (value, label) => {
    const now = Date.now();
    if (value > 0 && value < 1 && value - lastReportValue < 0.01 && now - lastReportAt < 100) return;
    lastReportAt = now;
    lastReportValue = value;
    event?.sender?.send?.('project:open-progress', { value: Math.max(0, Math.min(1, value)), label });
  };
  report(0, '正在讀取項目檔案');
  const bytes = await fs.readFile(filePath);
  if (bytes.subarray(0, 2).toString('ascii') === 'PK' || isArchiveV2(bytes)) {
    report(0.04, '正在解壓項目');
    const entries = isArchiveV2(bytes) ? openIndexedArchive(bytes)
      : await unpackArchiveWithProgress(bytes, (value, label) => report(0.04 + value * 0.66, label));
    const archive = ProjectJournal.inspectArchive(bytes, entries);
    report(0.72, '正在比對工作記錄');
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
        report(0.94, '正在載入模型與貼圖');
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
    let explicitReplacement = false;
    if (!matched && divergent) {
      const active = journals.has(divergent.id);
      const choice = await requestUiChoice(event.sender, {
        title: '同一項目的工作記錄不同',
        message: '這個文件與已有的展開工作記錄不屬於同一條歷史。',
        detail: active
          ? '現有工作副本仍在目前視窗使用；可以切換回它，或另外打開文件。'
          : '可以用文件取代舊工作副本，或保留兩份並另外打開。原始文件不會因此被改寫。',
        buttons: active ? ['另開一份', '切換到工作副本', '取消'] : ['另開一份', '以文件覆蓋工作副本', '取消'],
        defaultIndex: 0, cancelIndex: 2
      });
      if (choice.index === 2) return null;
      if (choice.index === 1 && active) {
        const journal = journals.get(divergent.id);
        report(0.94, '正在載入模型與貼圖');
        const content = await journal.content();
        return { filePath, content, journalId: divergent.id, dirty: true,
          textureAssets: await readTextureAssets(content, filePath) };
      }
      if (choice.index === 1) { replace = divergent; explicitReplacement = true; }
    }
    const journalId = `project_${crypto.randomUUID()}`;
    const journal = await openWorkingJournal(journalId, directory => ProjectJournal.fromArchive(bytes, directory,
      isArchiveV2(bytes) ? null : archive.entries, (value, label) => report(0.74 + value * 0.2, label), { deferHistory: true }));
    await atomicWrite(path.join(journal.directory, 'saved_state'), JSON.stringify({
      sequence: journal.state.activeHead, filePath, projectUuid: journal.projectUuid,
      fileHash: archive.fileHash, savedAt: new Date().toISOString()
    }));
    await indexWorkingJournal(journal);
    report(0.95, '正在載入模型與貼圖');
    const content = await journal.content();
    if (replace && !journals.has(replace.id)) {
      try { await discardIdleJournal(replace, { explicit: explicitReplacement }); }
      catch { /* Keep the old copy if another window claimed it meanwhile. */ }
    }
    return { filePath, content, journalId, textureAssets: await readTextureAssets(content, filePath) };
  }
  const rawContent = bytes.toString('utf8');
  let content = rawContent;
  if (/\.(json|java)$/i.test(filePath)) {
    const parsed = await readNativeModel(rawContent, filePath, {
      async chooseGeometry(names) {
        const result = await requestUiChoice(event.sender, { title: '选择几何模型', message: '文件包含多个几何模型，请选择要导入的一个', buttons: [...names, '取消'], cancelIndex: names.length });
        return result.index === names.length ? null : result.index;
      },
      async chooseBedrockFormat() {
        const result = await requestUiChoice(event.sender, { title: '选择基岩模型类型', message: '几何 JSON 本身不区分实体与方块', buttons: ['基岩版实体', '基岩版方块', '取消'], cancelIndex: 2 });
        return ['bedrock_entity', 'bedrock_block'][result.index] || null;
      }
    });
    if (!parsed) return null;
    content = JSON.stringify(parsed);
  }
  report(.6, '正在載入模型與貼圖');
  const textureAssets = await readTextureAssets(content, filePath);
  report(1, '項目已載入');
  return { filePath, content, textureAssets };
});

handleIpc('project:external-ready', event => {
  externalOpenReceiver = event.sender;
  while (pendingExternalProjects.length) externalOpenReceiver.send?.('project:external-open', pendingExternalProjects.shift());
  return true;
});

handleIpc('project:cover-save', async (_event, payload) => {
  const id = safeSessionId(payload?.journalId);
  return queueJournal(id, async () => {
    if (!journals.has(id)) return false;
    const target = coverPath(id);
    if (!payload?.dataUrl) { await fs.rm(target, { force: true }); return true; }
    const image = capturePngBuffer(payload.dataUrl);
    if (image.length > 2 * 1024 * 1024) throw new Error('項目封面過大');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await atomicWrite(target, image);
    return true;
  });
});

handleIpc('project:journal-init', async (_event, payload) => {
  const id = safeSessionId(payload.journalId);
  return queueJournal(id, async () => {
    const journal = await openWorkingJournal(id, directory => new ProjectJournal(directory).initialize(payload.content, payload.operationId || 'core.project.create', payload.operationIndex || []));
    const retention = await initializeProjectRetention(journal.directory, payload.imported === true, journal.state.activeHead);
    return { journalId: id, persistent: retention.persistent };
  });
});

handleIpc('project:journal-save', async (_event, payload) => {
  const id = safeSessionId(payload.journalId);
  return queueJournal(id, async () => {
    const journal = journals.get(id);
    if (!journal) throw new Error('項目工作目錄尚未建立');
    return retainProject(journal.directory, journal.state.activeHead);
  });
});

handleIpc('project:delete-workspace', async (event, payload) => {
  const id = safeSessionId(payload.journalId);
  const { catalog } = await workspaceCatalog();
  const entry = catalog.projects.find(project => project.journalId === id);
  if (!entry) throw new Error('工作項目已不存在');
  const directory = journals.get(id)?.directory || await journalDirectory(id);
  const choice = await requestUiChoice(event.sender, { title: '刪除項目',
    message: `確定刪除「${entry.name}」？`, detail: '將刪除這個項目的本機文件夾及全部歷史記錄，無法撤銷。已導出的模型文件不受影響。',
    buttons: ['刪除項目', '取消'], defaultIndex: 1, cancelIndex: 1 });
  if (choice.index !== 0) return false;
  return queueJournal(id, async () => {
    if (journals.has(id)) return discardOwnedJournal(id, { explicit: true });
    const target = path.resolve(directory);
    if (path.basename(target) !== id || path.dirname(target) === target) throw new Error('工作目錄不在項目根目錄內');
    await journalOwnership.acquire(target);
    try {
      await fs.rm(target, { recursive: true, force: true });
      await fs.rm(coverPath(id), { force: true });
      await removeRetainedJournal(id);
      return true;
    } finally { await journalOwnership.release(target); }
  });
});

handleIpc('project:journal-discard', async (_event, payload) => {
  const id = safeSessionId(payload.journalId);
  return queueJournal(id, () => discardOwnedJournal(id));
});

handleIpc('project:journal-commit', async (_event, payload) => {
  const id = safeSessionId(payload.journalId);
  return queueJournal(id, async () => {
    const journal = journals.get(id);
    if (!journal) throw new Error('項目工作目錄尚未建立');
    const result = await journal.commit(payload.content, payload.operationId, payload.operationLabel, payload.operationIndex || []);
    if (Number.isInteger(payload.historyLimit)) {
      try { await journal.compactHistory(payload.historyLimit); }
      catch (error) { result.historyWarning = error.message; }
    }
    return result;
  });
});
handleIpc('project:journal-compact', async (_event, payload) => {
  const id = safeSessionId(payload.journalId);
  return queueJournal(id, async () => {
    const journal = journals.get(id);
    if (!journal) throw new Error('項目工作目錄尚未建立');
    return journal.compactHistory(payload.historyLimit);
  });
});

handleIpc('project:journal-settings',async(_event,payload)=>{
  const id=safeSessionId(payload.journalId);
  return queueJournal(id,async()=>{
    const journal=journals.get(id);
    if(!journal)throw new Error('項目工作目錄尚未建立');
    return journal.setHistoryLimit(payload.historyLimit);
  });
});

handleIpc('project:journal-checkout', async (_event, payload) => {
  const id = safeSessionId(payload.journalId);
  return queueJournal(id, async () => {
    const journal = journals.get(id);
    if (!journal) throw new Error('項目工作目錄尚未建立');
    if (payload.direction) return journal.navigate(payload.direction);
    return { content: await journal.checkout(payload.sequence), sequence: Number(payload.sequence),
      changedUids: journal.lastCheckoutChangedUids, textureChanged: journal.lastCheckoutTextureChanged };
  });
});

handleIpc('project:journal-state', async (_event, payload) => {
  const id = safeSessionId(payload.journalId);
  return queueJournal(id, async () => {
    const journal = journals.get(id);
    return journal ? { ...journal.state } : null;
  });
});

handleIpc('project:history-graph', async (_event,payload) => {
  const id=safeSessionId(payload.journalId);
  return queueJournal(id,async()=>{
    const journal=journals.get(id);
    if(!journal)throw Error('項目工作目錄尚未建立');
    return journal.historyGraph();
  });
});
handleIpc('project:history-prune', async (_event,payload) => {
  const id=safeSessionId(payload.journalId);
  return queueJournal(id,async()=>{
    const journal=journals.get(id);
    if(!journal)throw Error('項目工作目錄尚未建立');
    return journal.pruneHistoryBranch(Number(payload.sequence),{single:payload.single===true});
  });
});
handleIpc('project:history-mark',async(_event,payload)=>{
  const id=safeSessionId(payload.journalId);
  return queueJournal(id,async()=>{
    const journal=journals.get(id);
    if(!journal)throw Error('項目工作目錄尚未建立');
    return journal.setHistoryMark(Number(payload.sequence),payload.mark);
  });
});

handleIpc('project:journal-list-recoverable', async () => {
  const recoverable = [];
  const { catalog } = await workspaceCatalog();
  for (const entry of catalog.projects) {
      if (journals.has(entry.journalId) || entry.savedSequence === entry.sequence) continue;
      if (entry.sequence === 1 && !entry.elementCount && !entry.textureCount) continue;
      const directory = await journalDirectory(entry.journalId);
      let claimed = false;
      try {
        await journalOwnership.acquire(directory);
        claimed = true;
        recoverable.push(entry);
      } catch { /* Busy or incomplete projects must not be opened by another writer. */ }
      finally { if (claimed) await journalOwnership.release(directory); }
  }
  return recoverable.sort((left, right) => String(right.modifiedAt).localeCompare(String(left.modifiedAt)));
});

handleIpc('project:list-workspace', async (_event, options = {}) => {
  if (options.refresh === true) {
    const { root, projects } = await ensureWorkspaceLayout();
    await mutateWorkspaceCatalog(async catalog => {
      const found = new Map();
      for (const searchRoot of [projects, root]) {
        for (const entry of await fs.readdir(searchRoot, { withFileTypes: true })) {
          if (!entry.isDirectory() || !JOURNAL_NAME.test(entry.name) || found.has(entry.name)) continue;
          const summary = await projectSummary(entry.name, path.join(searchRoot, entry.name));
          if (summary) found.set(entry.name, summary);
        }
      }
      catalog.projects = [...found.values()];
    });
  }
  const { catalog } = await workspaceCatalog();
  const ordered = [...catalog.projects].sort((left, right) => String(right.modifiedAt).localeCompare(String(left.modifiedAt)));
  if (options.includeCovers === false) return ordered.map(project => ({ ...project, cover: null }));
  const result = [];
  for (let index = 0; index < ordered.length; index += 8) {
    result.push(...await Promise.all(ordered.slice(index, index + 8).map(async project => {
      let cover = null;
      try { cover = `data:image/png;base64,${(await fs.readFile(coverPath(project.journalId))).toString('base64')}`; }
      catch { /* A missing or stale cover falls back to the card placeholder. */ }
      return { ...project, cover };
    })));
  }
  return result;
});

handleIpc('project:cover-get', async (_event, payload) => {
  const id = safeSessionId(payload?.journalId);
  try { return `data:image/png;base64,${(await fs.readFile(coverPath(id))).toString('base64')}`; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
});

handleIpc('project:journal-recover', async (event, payload) => {
  const id = safeSessionId(payload.journalId);
  return queueJournal(id, async () => {
    event.sender.send('project:open-progress', { value: .05, label: '正在讀取工作項目' });
    const journal = await openWorkingJournal(id, directory => new ProjectJournal(directory).load());
    event.sender.send('project:open-progress', { value: .8, label: '正在還原模型與貼圖' });
    const content = await journal.content();
    const { catalog } = await workspaceCatalog();
    const entry = catalog.projects.find(project => project.journalId === id);
    const retention = await readProjectRetention(journal.directory);
    event.sender.send('project:open-progress', { value: 1, label: '項目已載入' });
    return { journalId: id, content, persistent: retention.persistent, filePath: payload.filePath || entry?.filePath || null,
      dirty: entry?.savedSequence !== journal.state.activeHead };
  });
});

handleIpc('project:workspace-root', async () => (await ensureWorkspaceLayout()).root);
handleIpc('shape-packs:list', async () => orderedShapePacks((await ensureWorkspaceLayout()).root));
handleIpc('packs:list', async () => listResourcePacks((await ensureWorkspaceLayout()).root));
handleIpc('packs:font-data', async (_event, id) => readFontPack((await ensureWorkspaceLayout()).root, id));
handleIpc('packs:install', async (_event, kind) => {
  const filters = {
    shape: [{ name: 'Shape ZIP', extensions: ['zip'] }],
    language: [{ name: 'Language pack', extensions: ['json', 'zip'] }],
    font: [{ name: 'Font or font ZIP', extensions: ['ttf', 'otf', 'woff', 'woff2', 'zip'] }]
  };
  if (!filters[kind]) throw new Error('未知包類型');
  const picked = await dialog.showOpenDialog({ title: '加入資源包', properties: ['openFile'], filters: filters[kind] });
  if (picked.canceled || !picked.filePaths[0]) return null;
  return installPack((await ensureWorkspaceLayout()).root, kind, picked.filePaths[0]);
});
handleIpc('packs:remove', async (_event, id) => removePack((await ensureWorkspaceLayout()).root, id));
handleIpc('packs:order', async (_event, order) => savePackOrder((await ensureWorkspaceLayout()).root, order));
handleIpc('project:choose-workspace-root', async () => {
  const picked = await dialog.showOpenDialog({ title: '選擇項目工作目錄', properties: ['openDirectory', 'createDirectory'] });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const directory = picked.filePaths[0];
  await fs.mkdir(directory, { recursive: true });
  await atomicWrite(workspaceSettingsPath(), JSON.stringify({ directory }, null, 2));
  await ensureWorkspaceLayout();
  return directory;
});
handleIpc('project:set-workspace-root', async (_event, directory) => {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('請選擇絕對路徑');
  await fs.mkdir(directory, { recursive: true });
  await atomicWrite(workspaceSettingsPath(), JSON.stringify({ directory }, null, 2));
  await ensureWorkspaceLayout();
  return directory;
});

handleIpc('texture:animation-metadata',(_event,payload)=>require('./texture-animation-metadata.cjs').readTextureAnimationMetadata(payload));
registerTextureFiles(handleIpc, dialog, atomicWrite);

handleIpc('project:save', async (_event, payload) => {
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
    if (Number.isInteger(payload.historyLimit)) await journal.compactHistory(payload.historyLimit);
    await journal.archive(filePath);
  });
  return { filePath };
});

handleIpc('project:export', async (_event, payload) => {
  const preferred = ['cbmodel', 'bbmodel', 'json', 'java'].includes(payload.extension) ? payload.extension : 'bbmodel';
  const picked = payload.filePath ? { canceled: false, filePath: payload.filePath } : await dialog.showSaveDialog({
    title: '導出模型',
    defaultPath: `${payload.name || 'untitled'}.${preferred}`,
    filters: ['json', 'java'].includes(preferred) ? [{ name: preferred.toUpperCase(), extensions: [preferred] }] : [
      ...(preferred === 'cbmodel' ? [{ name: 'CubeBricks Model', extensions: ['cbmodel'] }, { name: 'Blockbench Model', extensions: ['bbmodel'] }]
        : [{ name: 'Blockbench Model', extensions: ['bbmodel'] }, { name: 'CubeBricks Model', extensions: ['cbmodel'] }])
    ]
  });
  if (picked.canceled || !picked.filePath) return null;
  let filePath = picked.filePath;
  let extension = path.extname(filePath).toLowerCase();
  if (['json', 'java'].includes(preferred) ? extension !== `.${preferred}` : !['.cbmodel', '.bbmodel'].includes(extension)) {
    extension = `.${preferred}`;
    filePath += extension;
  }
  if (extension === '.cbmodel') {
    if (typeof payload.includeHistory !== 'boolean') return { filePath, extension, requiresHistoryChoice: true };
    if (typeof payload.cbmodelContent !== 'string') return { filePath, extension, requiresContent: true };
    const id = payload.journalId ? safeSessionId(payload.journalId) : `project_${crypto.randomUUID()}`;
    await queueJournal(id, async () => {
      let journal = journals.get(id);
      if (!journal) {
        journal = await openWorkingJournal(id, directory => new ProjectJournal(directory).initialize(payload.cbmodelContent));
      } else await journal.commit(payload.cbmodelContent, payload.operationId || 'core.project.information', payload.operationLabel || '修改項目信息');
      await journal.archive(filePath, { includeHistory: payload.includeHistory, markSaved: false });
    });
  } else if (extension === '.json' || extension === '.java') {
    if (typeof payload.modelContent !== 'string') return { filePath, extension, requiresContent: true };
    if (Buffer.byteLength(payload.modelContent) > 64 * 1024 * 1024) throw Error('原生模型文件过大');
    if (extension === '.json') JSON.parse(payload.modelContent);
    if (Array.isArray(payload.textureLocations))
      await writeTextureReferences(filePath, payload.formatId, payload.textureLocations, atomicWrite);
    await atomicWrite(filePath, payload.modelContent);
  } else {
    if (typeof payload.bbmodelContent !== 'string') return { filePath, extension, requiresContent: true };
    await atomicWrite(filePath, payload.bbmodelContent);
  }
  return { filePath, extension };
});

function validatedColorMap(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024)
    throw new Error('色卡檔案不能超過 2 MB');
  const value = JSON.parse(content);
  if (value?.format !== 'cubebricks-color-map' || value.version !== 1
    || !Array.isArray(value.palettes) || value.palettes.length < 1 || value.palettes.length > 256)
    throw new Error('色卡檔案格式無效');
  return content;
}
let colorMapSaveQueue = Promise.resolve();
handleIpc('palette:load', async () => {
  try {
    const filePath = colorMapSettingsPath();
    if ((await fs.stat(filePath)).size > 2 * 1024 * 1024) throw new Error('色卡檔案不能超過 2 MB');
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
});
handleIpc('palette:save', (_event, content) => {
  const data = validatedColorMap(content);
  colorMapSaveQueue = colorMapSaveQueue.catch(() => {}).then(() => atomicWrite(colorMapSettingsPath(), data));
  return colorMapSaveQueue;
});
handleIpc('palette:export', async (_event, payload) => {
  const data = String(payload?.content || '');
  if (Buffer.byteLength(data, 'utf8') > 2 * 1024 * 1024) throw new Error('色卡檔案不能超過 2 MB');
  const value = JSON.parse(data);
  if (value?.format !== 'cubebricks-color-map' || value.version !== 1 || !value.palette
    || typeof value.palette !== 'object' || Array.isArray(value.palette)
    || Object.hasOwn(value.palette, 'name') || Object.hasOwn(value.palette, 'id'))
    throw new Error('單張色卡檔案格式無效');
  const filename = path.basename(String(payload?.filename || 'color-map.cbcmap'))
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const picked = await dialog.showSaveDialog({
    title: '導出色卡', defaultPath: filename,
    filters: [{ name: 'CubeBricks 色卡', extensions: ['cbcmap'] }]
  });
  if (picked.canceled || !picked.filePath) return null;
  const filePath = path.extname(picked.filePath).toLowerCase() === '.cbcmap'
    ? picked.filePath : `${picked.filePath}.cbcmap`;
  await atomicWrite(filePath, data);
  return { filePath };
});

function capturePngBuffer(dataUrl) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('模型截圖不是有效的 PNG');
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length || buffer.length > 64 * 1024 * 1024) throw new Error('模型截圖尺寸無效');
  return buffer;
}

handleIpc('image:save-capture', async (_event, payload) => {
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

handleIpc('image:copy-capture', (_event, dataUrl) => {
  const image = nativeImage.createFromBuffer(capturePngBuffer(dataUrl));
  if (image.isEmpty()) throw new Error('無法讀取模型截圖');
  clipboard.writeImage(image);
  return true;
});

queueExternalProject(externalProjectPath(process.argv.slice(1)));
app.on('open-file', (event, filePath) => { event.preventDefault(); queueExternalProject(filePath); });
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
