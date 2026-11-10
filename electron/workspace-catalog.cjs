const path = require('node:path');
const fs = require('node:fs/promises');
const { atomicWrite } = require('./project-journal.cjs');
const { readProjectRetention } = require('./project-retention.cjs');

// Index promises, layout migrations and catalog writes are keyed by workspace root.
function createWorkspaceCatalog({ app, journals, journalOwnership, workspaceSettingsPath }) {
  const workspaceLayoutPromises = new Map();
  const workspaceCatalogs = new Map();
  const workspaceCatalogWrites = new Map();

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
    return {
      root, projects: path.join(root, 'projects'), shapePacks: path.join(root, 'shapepacks'),
      languagePacks: path.join(root, 'languagepacks'), fontPacks: path.join(root, 'fontpacks')
    };
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
          catch (error) {
            migrationFailed = true;
            console.warn(`舊項目暫留原位置：${entry.name}`, error.message);
            continue;
          }
          const oldOwner = journalOwnership.lockPath(source), newOwner = journalOwnership.lockPath(destination);
          if (!await fs.stat(newOwner).then(() => true).catch(() => false)) {
            await fs.rename(oldOwner, newOwner).catch(error => {
              if (error.code !== 'ENOENT') console.warn(`舊項目鎖文件未遷移：${entry.name}`, error.message);
            });
          }
        }
        if (!migrationFailed) await atomicWrite(marker, 'complete');
      })().catch(error => {
        workspaceLayoutPromises.delete(root);
        throw error;
      });
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
    return {
      journalId: id, name: manifest.information?.name || '未命名',
      modifiedAt: manifest.timestamp || '', sequence: state.activeHead,
      savedSequence: retention.savedSequence ?? saved?.sequence ?? null, persistent: retention.persistent, filePath: saved?.filePath || null,
      elementCount: manifest.elementOrder?.length || 0, textureCount: manifest.textureIds?.length || 0
    };
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
    })().catch(error => {
      workspaceCatalogs.delete(root);
      throw error;
    }));
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

  return {
    JOURNAL_NAME, ensureWorkspaceLayout, journalDirectory, projectSummary, workspaceCatalog,
    mutateWorkspaceCatalog, indexWorkingJournal, unindexWorkingJournal
  };
}

module.exports = { createWorkspaceCatalog };
