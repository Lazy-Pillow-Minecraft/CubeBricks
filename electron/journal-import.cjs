const fs = require('node:fs/promises');
const path = require('node:path');
const { openIndexedArchive } = require('./archive-index.cjs');

const HISTORY_ARCHIVE = '.history-import.cbmodel';
const HISTORY_MARKER = '.history-import';
const historical = name => /^transactions\/\d+\.json$/.test(name)
  || /^elements\/.+\/\d+\.json$/.test(name) || /^texture_changes\/\d+\/.+\.json$/.test(name)
  || /^reference_images\/[a-f0-9]{64}\.txt$/.test(name)
  || /^history_roots\/\d+\.json$/.test(name) || /^history_textures\/[a-f0-9]{64}\.json$/.test(name);

function historyPlan(entries) {
  const state = JSON.parse(entries.get('current_state').toString('utf8'));
  const manifest = JSON.parse(entries.get(`transactions/${state.activeHead}.json`).toString('utf8'));
  const essential = new Set([`transactions/${state.activeHead}.json`, `transactions/${state.pointerSyncFrom}.json`]);
  for (const pointer of Object.values(manifest.pointers || {})) essential.add(`${pointer.folder}/${pointer.local}.json`);
  for (const records of Object.values(manifest.information?.referenceImages || {}))
    for (const record of Array.isArray(records) ? records : records ? [records] : [])
      if (record.sourceRef) essential.add(`reference_images/${record.sourceRef}.txt`);
  return { essential, background: [...entries.keys()].filter(name => historical(name) && !essential.has(name)) };
}

function hasLargeHistory(entries, options = {}) {
  const { background } = historyPlan(entries);
  return background.length >= (options.historyThreshold ?? 512)
    || background.reduce((sum, name) => sum + (entries.originalSize?.(name) ?? entries.get(name).length), 0) >= (options.historyByteThreshold ?? 8 * 1024 * 1024);
}

function validateEntries(entries) {
  for (const name of entries.keys()) if (name.startsWith('/') || name.includes('\\') || name.includes(':')
    || name.split('/').includes('..') || [HISTORY_ARCHIVE, HISTORY_MARKER].includes(name))
    throw new Error('不安全的項目路徑');
}

async function writeEntry(directory, name, bytes) {
  const filename = path.join(directory, ...name.split('/'));
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.history.tmp`;
  const file = await fs.open(temporary, 'w');
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally { await file.close(); }
  await fs.rename(temporary, filename);
}

function backgroundImport(directory, names, entries, onProgress) {
  const remaining = new Set(names), total = remaining.size;
  let canceled = false, started = false, done;
  let resolveDone, rejectDone;
  done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  done.catch(() => {});
  const run = async () => {
    const files = [...remaining];
    let written = 0, lastReport = 0;
    onProgress({ value: 0, total, completed: 0 });
    for (let index = 0; index < files.length && !canceled; index += 4) {
      const results = await Promise.allSettled(files.slice(index, index + 4).map(async name => {
        await writeEntry(directory, name, entries.get(name));
        remaining.delete(name);
        written++;
      }));
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      if (Date.now() - lastReport >= 100 || written === total) {
        lastReport = Date.now();
        onProgress({ value: written / Math.max(1, total), total, completed: written });
      }
      await new Promise(resolve => setImmediate(resolve));
    }
    if (!canceled) {
      await fs.rm(path.join(directory, HISTORY_MARKER), { force: true });
      await fs.rm(path.join(directory, HISTORY_ARCHIVE), { force: true });
      onProgress({ value: 1, total, completed: total });
    }
  };
  return {
    remaining, done,
    readBytes(name) { return remaining.has(name) ? entries.get(name) : undefined; },
    read(name) { return remaining.has(name) ? JSON.parse(entries.get(name).toString('utf8')) : undefined; },
    start() {
      if (started) return;
      started = true;
      run().then(resolveDone, error => {
        onProgress({ error: error.message });
        rejectDone(error);
      });
    },
    async cancel() {
      canceled = true;
      if (!started) resolveDone();
      await done.catch(() => {});
      onProgress({ value: 1, canceled: true });
    }
  };
}

async function stageJournalImport(bytes, directory, entries, onProgress, onHistoryProgress, { resume = false } = {}) {
  validateEntries(entries);
  const { essential, background } = historyPlan(entries);
  if (!resume) {
    await fs.mkdir(directory, { recursive: true });
    if ((await fs.readdir(directory)).length) throw new Error('工作目錄已有記錄，不能覆寫導入');
    const directories = new Set();
    for (const name of entries.keys()) {
      const parts = name.split('/');
      for (let depth = 1; depth < parts.length; depth++) directories.add(parts.slice(0, depth).join('/'));
    }
    for (const relative of [...directories].sort((a, b) => a.split('/').length - b.split('/').length))
      await fs.mkdir(path.join(directory, ...relative.split('/')), { recursive: true });
    await writeEntry(directory, HISTORY_ARCHIVE, bytes);
    const first = [...entries.keys()].filter(name => !historical(name) || essential.has(name))
      .filter(name => name !== 'current_state');
    let completed = 0;
    for (let index = 0; index < first.length; index += 16) {
      const results = await Promise.allSettled(first.slice(index, index + 16).map(async name => {
        await writeEntry(directory, name, entries.get(name));
        completed++;
      }));
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      onProgress(completed / Math.max(1, first.length), '正在還原目前模型與貼圖');
    }
    await writeEntry(directory, HISTORY_MARKER, JSON.stringify({ version: 1 }));
    await writeEntry(directory, 'current_state', entries.get('current_state'));
  }
  return backgroundImport(directory, background, entries, onHistoryProgress);
}

async function resumeJournalImport(directory, onProgress) {
  try { await fs.access(path.join(directory, HISTORY_MARKER)); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const bytes = await fs.readFile(path.join(directory, HISTORY_ARCHIVE));
  return stageJournalImport(bytes, directory, openIndexedArchive(bytes), () => {}, onProgress, { resume: true });
}

module.exports = { stageJournalImport, resumeJournalImport, hasLargeHistory, HISTORY_ARCHIVE, HISTORY_MARKER };
