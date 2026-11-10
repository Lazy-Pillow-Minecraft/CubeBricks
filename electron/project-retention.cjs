const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite } = require('./project-journal.cjs');

async function readProjectRetention(directory) {
  try {
    const state = JSON.parse(await fs.readFile(path.join(directory, 'workspace_state'), 'utf8'));
    if (state.version === 1 && typeof state.persistent === 'boolean') {
      if (!state.persistent && await fs.stat(path.join(directory, 'saved_state')).then(() => true).catch(() => false))
        return { ...state, persistent: true };
      return state;
    }
  } catch (error) {
    // Unknown, old or damaged retention metadata must never authorize deletion.
    if (error.code !== 'ENOENT') return { persistent: true };
  }
  return { persistent: true };
}

async function initializeProjectRetention(directory, persistent, sequence) {
  try {
    await fs.access(path.join(directory, 'workspace_state'));
    return readProjectRetention(directory);
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const state = {
    version: 1, persistent: persistent === true,
    savedSequence: persistent ? sequence : null, savedAt: persistent ? new Date().toISOString() : null
  };
  await atomicWrite(path.join(directory, 'workspace_state'), JSON.stringify(state));
  return state;
}

async function retainProject(directory, sequence) {
  const state = { version: 1, persistent: true, savedSequence: sequence, savedAt: new Date().toISOString() };
  await atomicWrite(path.join(directory, 'workspace_state'), JSON.stringify(state));
  return state;
}

module.exports = { readProjectRetention, initializeProjectRetention, retainProject };
