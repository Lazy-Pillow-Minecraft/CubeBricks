const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { ProjectJournal } = require('../electron/project-journal.cjs');

test('animation modes, expressions and fractional keys survive history and portable archives', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cubebricks-animation-storage-'));
  const clip = { uid: 'clip', name: 'walk', fps: 24, length: 24, loop: 'once',
    tracks: { bone: { position: [], scale: [], rotation: [{ frame: 2.4, value: ['query.anim_time', 0, 720] }] } },
    native: { identifier: 'animation.test.walk', animation: { timeline: { '0.1250': ['v.a = 1;'] } }, preserveStarts: ['bone'] } };
  const content = () => JSON.stringify({ name: 'test', formatVersion: 3, elements: [],
    groups: [{ uid: 'bone', type: 'group', children: [] }], outliner: ['bone'], animations: [clip], textures: [] });
  try {
    const journal = await new ProjectJournal(path.join(directory, 'project')).initialize(content());
    clip.loop = 'hold'; await journal.commit(content(), 'core.animation.information', 'Edit animation');
    clip.loop = 'loop'; await journal.commit(content(), 'core.animation.information', 'Edit animation');
    await journal.navigate('undo');
    assert.equal(JSON.parse(await journal.content()).animations[0].loop, 'hold');
    await journal.navigate('undo');
    assert.equal(JSON.parse(await journal.content()).animations[0].loop, 'once');
    await journal.navigate('redo'); await journal.navigate('redo');
    const reopened = await new ProjectJournal(path.join(directory, 'project')).load();
    assert.deepEqual(JSON.parse(await reopened.content()).animations, [clip]);
    for (const includeHistory of [false, true]) {
      const filename = path.join(directory, `animation-${includeHistory}.cbmodel`);
      await reopened.archive(filename, { includeHistory, markSaved: false });
      const imported = await ProjectJournal.fromArchive(await fs.readFile(filename), path.join(directory, `imported-${includeHistory}`));
      assert.deepEqual(JSON.parse(await imported.content()).animations, [clip]);
    }
  } finally {
    // Delete only the unique temporary fixture created by this test.
    if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('cubebricks-animation-storage-')) {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
});
