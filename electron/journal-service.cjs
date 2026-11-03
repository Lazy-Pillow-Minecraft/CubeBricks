const { Worker } = require('node:worker_threads');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ProjectJournal } = require('./project-journal.cjs');

let worker = null, sequence = 0;
const pending = new Map();
function ensureWorker() {
  if (worker) return worker;
  const current = new Worker(path.join(__dirname, 'journal-worker.cjs'));
  worker = current;
  const failed = error => {
    if (worker === current) worker = null;
    for (const [request, task] of pending) {
      if (task.worker !== current) continue;
      pending.delete(request); task.reject(error);
    }
  };
  current.on('message', response => {
    const task = pending.get(response.request);
    if (!task || task.worker !== current) return;
    if (response.progress) {
      try { task.onProgress?.(response.progress.value, response.progress.label); }
      catch { task.onProgress = null; }
      return;
    }
    pending.delete(response.request);
    if (!pending.size) current.unref();
    if (response.metadata) Object.assign(task.journal, response.metadata);
    if (response.error) {
      const error = new Error(response.error.message);
      if (response.error.code) error.code = response.error.code;
      error.stack = response.error.stack || error.stack;
      task.reject(error);
    } else task.resolve(response);
  });
  current.on('error', failed);
  current.on('exit', code => failed(new Error(`項目記錄工作執行緒已結束 (${code})`)));
  current.unref();
  return current;
}

class WorkerProjectJournal {
  constructor(directory) {
    this.directory = directory;
    this.workerId = randomUUID();
    this.state = null;
  }
  async call(method, args = [], onProgress = null) {
    const current = ensureWorker(), request = ++sequence;
    const response = await new Promise((resolve, reject) => {
      pending.set(request, { worker: current, journal: this, resolve, reject, onProgress });
      current.ref();
      try { current.postMessage({ request, journalId: this.workerId, directory: this.directory, method, args }); }
      catch (error) {
        pending.delete(request);
        if (!pending.size) current.unref();
        reject(error);
      }
    });
    return ['initialize', 'load', 'fromArchive'].includes(method) ? this : response.result;
  }
  static inspectArchive(...args) { return ProjectJournal.inspectArchive(...args); }
  static historySignature(...args) { return ProjectJournal.historySignature(...args); }
  static fromArchive(bytes, directory, entries = null, onProgress = null) {
    return new WorkerProjectJournal(directory).call('fromArchive', [bytes, entries], onProgress);
  }
}
for (const method of ['initialize', 'load', 'ensureReady', 'commit', 'content',
  'checkout', 'navigate', 'compactHistory', 'archive', 'dispose']) {
  WorkerProjectJournal.prototype[method] = function (...args) { return this.call(method, args); };
}
module.exports = { WorkerProjectJournal };
