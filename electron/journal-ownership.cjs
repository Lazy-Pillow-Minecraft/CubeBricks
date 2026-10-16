const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

function busyError() {
  const error = new Error('這個工作項目已在另一個 CubeBricks 視窗開啟，請先關閉該視窗');
  error.code = 'JOURNAL_BUSY';
  return error;
}

// A working journal has one writer, even when several app processes are open.
// The sibling lock survives accidental removal of the journal itself and is
// never included in a cbmodel archive.
class JournalOwnership {
  constructor() { this.owned = new Map(); }

  lockPath(directory) { return `${path.resolve(directory)}.owner`; }

  async readOwner(directory) {
    try {
      const filename = this.lockPath(directory);
      const [text, stat] = await Promise.all([fs.readFile(filename, 'utf8'), fs.stat(filename)]);
      let owner = null;
      try { owner = JSON.parse(text); } catch { /* A writer may still be filling its claim. */ }
      return { owner, text, stat };
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async isLocked(directory) {
    const record = await this.readOwner(directory);
    if (!record) return false;
    if (record.owner?.pid) return processAlive(record.owner.pid);
    return Date.now() - record.stat.mtimeMs < 60000;
  }

  async acquire(directory) {
    directory = path.resolve(directory);
    if (this.owned.has(directory)) return;
    const filename = this.lockPath(directory);
    await fs.mkdir(path.dirname(directory), { recursive: true });
    for (let attempt = 0; attempt < 3; attempt++) {
      let handle;
      try { handle = await fs.open(filename, 'wx'); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const record = await this.readOwner(directory);
        if (!record) continue;
        if (record.owner?.pid ? processAlive(record.owner.pid) : Date.now() - record.stat.mtimeMs < 60000) throw busyError();
        // Recheck before reclaiming a dead process's claim. Never remove a
        // claim just because it has been held for a long-running edit session.
        // Serialize stale-claim cleanup. Without this guard, two processes
        // can both inspect the dead owner, then one can unlink the other's
        // freshly acquired claim after the first cleanup.
        let reaper;
        const reaperPath = `${filename}.reclaim`;
        try { reaper = await fs.open(reaperPath, 'wx'); }
        catch (error) { if (error.code === 'EEXIST') throw busyError(); throw error; }
        try {
          const current = await this.readOwner(directory);
          if (current?.text === record.text && current.stat.ino === record.stat.ino) {
            await fs.unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
          }
        } finally { await reaper.close(); await fs.unlink(reaperPath); }
        continue;
      }
      const owner = { pid: process.pid, token: crypto.randomUUID(), createdAt: new Date().toISOString() };
      try { await handle.writeFile(JSON.stringify(owner)); await handle.sync(); }
      catch (error) { await handle.close(); await fs.unlink(filename).catch(() => {}); throw error; }
      await handle.close();
      this.owned.set(directory, owner.token);
      return;
    }
    throw busyError();
  }

  async release(directory) {
    directory = path.resolve(directory);
    const token = this.owned.get(directory);
    if (!token) return;
    const record = await this.readOwner(directory);
    if (record?.owner?.token === token) await fs.unlink(this.lockPath(directory));
    this.owned.delete(directory);
  }

  async assertOwned(directory) {
    const token = this.owned.get(path.resolve(directory));
    const record = await this.readOwner(directory);
    if (!token || record?.owner?.token !== token) throw busyError();
  }

  async releaseAll() {
    await Promise.all([...this.owned.keys()].map(directory => this.release(directory)));
  }
}

module.exports = { JournalOwnership };
