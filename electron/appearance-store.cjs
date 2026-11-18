const fs = require('node:fs/promises');

// The desktop copy survives changes to the renderer's origin/profile cache.
// Serialize writes so rapidly switching themes cannot save an older choice last.
function createAppearanceStore(filePath, atomicWrite) {
  let pending = Promise.resolve();
  return {
    async read() {
      await pending.catch(() => {});
      try { return JSON.parse(await fs.readFile(filePath(), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') console.warn('CubeBricks appearance read failed:', error); return null; }
    },
    write(value) {
      if (!value || typeof value !== 'object' || typeof value.preset !== 'string') throw new Error('Invalid appearance settings');
      const content = JSON.stringify(value);
      if (content.length > 65536) throw new Error('Appearance settings are too large');
      pending = pending.catch(() => {}).then(() => atomicWrite(filePath(), content));
      return pending;
    },
    flush: () => pending
  };
}

module.exports = { createAppearanceStore };
