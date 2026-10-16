const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JournalOwnership } = require('../electron/journal-ownership.cjs');

test('only one owner may open or delete a working journal; crash claims can be reclaimed', async () => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.ownership-test-'));
  const first = new JournalOwnership(), second = new JournalOwnership();
  const directory = path.join(root, 'project_test');
  try {
    await first.acquire(directory);
    assert.equal(await second.isLocked(directory), true);
    await assert.rejects(second.acquire(directory), { code: 'JOURNAL_BUSY' });
    await second.release(directory);
    assert.equal(await first.isLocked(directory), true);
    await first.releaseAll();
    await second.acquire(directory);
    await second.releaseAll();
    await fs.writeFile(`${directory}.owner`, JSON.stringify({ pid: 2147483647, token: 'dead-process' }));
    await first.acquire(directory);
    await assert.rejects(second.acquire(directory), { code: 'JOURNAL_BUSY' });
    await first.releaseAll();
    assert.equal(await first.isLocked(directory), false);
  } finally {
    await first.releaseAll(); await second.releaseAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('simultaneous acquisition cannot both succeed', async () => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.ownership-race-test-'));
  const owners = [new JournalOwnership(), new JournalOwnership()];
  try {
    const results = await Promise.allSettled(owners.map(owner => owner.acquire(path.join(root, 'project_test'))));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  } finally {
    await Promise.all(owners.map(owner => owner.releaseAll()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('simultaneous stale-claim recovery still produces only one writer', async () => {
  const root = await fs.mkdtemp(path.join(__dirname, '..', '.ownership-stale-test-'));
  const owners = [new JournalOwnership(), new JournalOwnership()];
  const directory = path.join(root, 'project_test');
  try {
    await fs.writeFile(`${directory}.owner`, JSON.stringify({ pid: 2147483647, token: 'dead-process' }));
    const results = await Promise.allSettled(owners.map(owner => owner.acquire(directory)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const record = JSON.parse(await fs.readFile(`${directory}.owner`, 'utf8'));
    assert.ok(owners.some(owner => owner.owned.get(path.resolve(directory)) === record.token));
  } finally {
    await Promise.all(owners.map(owner => owner.releaseAll()));
    await fs.rm(root, { recursive: true, force: true });
  }
});
