const { parentPort } = require('node:worker_threads');
const { ProjectJournal } = require('./project-journal.cjs');

const journals = new Map();
const metadata = journal => journal && ({
  state: journal.state, projectUuid: journal.projectUuid,
  lastCheckoutChangedUids: journal.lastCheckoutChangedUids,
  lastCheckoutTextureChanged: journal.lastCheckoutTextureChanged
});
const methods = new Set(['initialize', 'load', 'ensureReady', 'commit', 'content',
  'checkout', 'navigate', 'compactHistory', 'archive']);
parentPort.on('message', async ({ request, journalId, directory, method, args }) => {
  try {
    if (method === 'dispose') {
      journals.delete(journalId);
      parentPort.postMessage({ request, result: null });
      return;
    }
    let journal = journals.get(journalId), result;
    if (method === 'fromArchive') {
      const entries = args[1] && new Map([...args[1]].map(([key, bytes]) => [key, Buffer.from(bytes)]));
      journal = await ProjectJournal.fromArchive(Buffer.from(args[0]), directory, entries,
        (value, label) => parentPort.postMessage({ request, progress: { value, label } }));
      journals.set(journalId, journal);
    } else {
      if (!methods.has(method)) throw new Error('Unknown journal worker operation');
      if (!journal || method === 'load' || method === 'initialize') {
        journal = new ProjectJournal(directory);
        journals.set(journalId, journal);
        if (!['load', 'initialize'].includes(method)) await journal.load();
      }
      result = await journal[method](...args);
      if (result === journal) result = null;
    }
    parentPort.postMessage({ request, result, metadata: metadata(journal) });
  } catch (error) {
    if (['initialize', 'load', 'fromArchive'].includes(method)) journals.delete(journalId);
    parentPort.postMessage({ request, metadata: metadata(journals.get(journalId)),
      error: { message: error.message, code: error.code, stack: error.stack } });
  }
});
