const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const { pngBytes, registerTextureFiles, readTextureAssets } = require('../electron/texture-files.cjs');
const { textureLocation, resourceCandidates, readNativeModel, writeTextureReferences } = require('../electron/native-model-io.cjs');
const { atomicWrite } = require('../electron/project-journal.cjs');
const { localizeDialogOptions } = require('../electron/dialog-i18n.cjs');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

test('file dialogs localize app-provided labels while preserving file paths', () => {
  const options = {
    title: 'ui.open-model-dialog', defaultPath: '動畫.續集.bbmodel',
    filters: [{ name: 'ui.blockbench-model-filter', extensions: ['bbmodel'] }]
  };
  assert.deepEqual(localizeDialogOptions(options, 'zh-Hans'), {
    title: '打开模型', defaultPath: options.defaultPath,
    filters: [{ name: 'Blockbench 模型', extensions: ['bbmodel'] }]
  });
  assert.equal(localizeDialogOptions(options, 'zh-Hant').title, '打開模型');
  assert.equal(localizeDialogOptions(options, 'en').title, 'Open Model');
});

test('texture paths preserve resource-pack namespaces and resolve resources without scanning projects', () => {
  assert.equal(textureLocation('D:\\pack\\assets\\demo\\textures\\block\\stone.png').resource, 'demo:block/stone');
  assert.equal(textureLocation('D:\\pack\\textures\\entity\\player.png').resource, 'textures/entity/player');
  assert.equal(textureLocation('D:\\art\\tile.png', 'custom').resource, 'custom:tile');
  assert.ok(resourceCandidates('demo:block/stone', 'D:\\pack\\assets\\demo\\models\\block\\stone.json')
    .includes(path.resolve('D:/pack/assets/demo/textures/block/stone.png')));
  assert.deepEqual(resourceCandidates('../secrets', 'D:/model.json'), []);
  assert.throws(() => pngBytes('data:image/png;base64,AA=='));
});

test('independent PNG saving, animation companions, native JSON references and cancellation round-trip', async () => {
  const directory = await fs.mkdtemp(path.join(__dirname, '..', '.native-files-test-'));
  try {
    const handlers = new Map(), filePath = path.join(directory, 'art.png');
    let canceled = false;
    registerTextureFiles((id, handler) => handlers.set(id, handler), async () => ({ canceled, filePath }), atomicWrite);
    const save = payload => handlers.get('texture:save')({}, payload);
    const result = await save({ source: png, name: 'art.png', namespace: 'demo', metadata: { animation: { frametime: 2 } } });
    assert.equal(result.filePath, filePath);
    assert.equal(result.resource, 'demo:art');
    assert.deepEqual(await fs.readFile(filePath), pngBytes(png));
    assert.equal(JSON.parse(await fs.readFile(`${filePath}.mcmeta`, 'utf8')).animation.frametime, 2);
    const modelPath = path.join(directory, 'model.json');
    await writeTextureReferences(modelPath, 'java_block_item', [{ ...result, uvWidth: 16, uvHeight: 16 }], atomicWrite);
    await fs.writeFile(modelPath, JSON.stringify({ textures: { 0: 'demo:art' }, elements: [{ from: [0, 0, 0], to: [2, 2, 2], faces: { north: { texture: '#0' } } }] }));
    const bb = await readNativeModel(await fs.readFile(modelPath, 'utf8'), modelPath);
    assert.equal(bb.textures[0].relative_path, 'art.png');
    const assets = await readTextureAssets(JSON.stringify(bb), modelPath);
    assert.equal(assets[0].source, png);
    assert.equal(assets[0].externalFile.imported, true);
    assert.equal(assets[0].externalFile.path, filePath);
    assert.equal(assets[0].animationMetadata.animation.frametime, 2);
    await save({ source: png, filePath });
    await assert.rejects(() => fs.access(`${filePath}.mcmeta`), /ENOENT/);
    canceled = true;
    assert.equal(await save({ source: png, name: 'other.png' }), null);
    assert.deepEqual(await fs.readFile(filePath), pngBytes(png));
  } finally {
    assert.equal(path.dirname(directory), path.resolve(__dirname, '..'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
