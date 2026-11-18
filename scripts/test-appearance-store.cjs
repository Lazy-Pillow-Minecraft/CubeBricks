const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createAppearanceStore } = require('../electron/appearance-store.cjs');

test('desktop appearance is ordered, durable and independent of renderer storage', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cubebricks-appearance-'));
  const file = path.join(directory, 'appearance.json');
  const store = () => createAppearanceStore(() => file, async (target, value) => {
    await new Promise(resolve => setTimeout(resolve, 5));
    await fs.writeFile(target, value);
  });
  try {
    const first = store();
    assert.equal(await first.read(), null);
    const writes = ['moss', 'violet', 'violet-blocks'].map(preset => first.write({ preset }));
    await first.flush();
    await Promise.all(writes);
    assert.equal((await store().read()).preset, 'violet-blocks', 'a fresh store reads the last chosen theme');
    assert.throws(() => first.write(null), /Invalid appearance/);
  } finally {
    await fs.unlink(file).catch(() => {});
    await fs.rmdir(directory);
  }
});
