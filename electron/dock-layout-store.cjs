const fs = require('node:fs/promises');

const object = value => value && typeof value === 'object' && !Array.isArray(value);
function validLayout(value) {
  return value?.version === 1 && object(value.layout) && object(value.zones)
    && Object.keys(value.layout).length <= 128
    && Object.entries(value.layout).every(([id, state]) => /^[a-z][a-zA-Z0-9]*$/.test(id) && object(state)
      && ['left', 'right', 'bottom', 'floating'].includes(state.dock)
      && ['order', 'x', 'y', 'width', 'height'].every(key => Number.isFinite(state[key])))
    && Number.isFinite(value.updatedAt);
}

function createDockLayoutStore(filePath, atomicWrite) {
  let pending = Promise.resolve();
  return {
    async read() {
      await pending.catch(() => {});
      try {
        const value = JSON.parse(await fs.readFile(filePath(), 'utf8'));
        return validLayout(value) ? value : null;
      } catch (error) {
        if (error.code !== 'ENOENT') console.warn('CubeBricks dock layout read failed:', error);
        return null;
      }
    },
    write(value) {
      if (!validLayout(value)) throw new Error('Invalid dock layout');
      const content = JSON.stringify(value);
      if (content.length > 262144) throw new Error('Dock layout is too large');
      pending = pending.catch(() => {}).then(() => atomicWrite(filePath(), content));
      return pending;
    },
    flush: () => pending
  };
}

module.exports = { createDockLayoutStore };
