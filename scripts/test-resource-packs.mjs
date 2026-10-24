import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { packZip } = require('../electron/zip-store.cjs');
const { listResourcePacks, orderedShapePacks, installPack, removePack, savePackOrder, readFontPack } =
  require('../electron/resource-packs.cjs');
const root = await mkdtemp(path.join(process.cwd(), '.tmp-resource-packs-'));

try {
  const languageFile = path.join(root, 'sample-language.json');
  await writeFile(languageFile, JSON.stringify({
    code: 'fr', label: 'Français', translations: { '設定': 'Paramètres' }
  }));
  assert.equal(await installPack(root, 'language', languageFile), 'language:sample-language.json');
  const fontZip = path.join(root, 'sample-font.zip');
  await writeFile(fontZip, packZip([
    ['sample-font/package.json', Buffer.from(JSON.stringify({ name: 'Sample font', hotReload: false }))],
    ['sample-font/fonts/latin.ttf', Buffer.from([0, 1, 0, 0, 0, 0])]
  ]));
  assert.equal(await installPack(root, 'font', fontZip), 'font:sample-font.zip');
  const shapeZip = path.join(root, 'sample-shape.zip');
  await writeFile(shapeZip, packZip([
    ['package.json', Buffer.from(JSON.stringify({
      name: 'Sample shape', shapes: [{ id: 'sample_shape', file: 'shape.js' }]
    }))],
    ['shapes/shape.js', Buffer.from('export default { id: "sample_shape" };')]
  ]));
  assert.equal(await installPack(root, 'shape', shapeZip), 'shape:sample-shape.zip');
  let result = await listResourcePacks(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.packs.length, 3);
  assert.equal(result.packs.find(pack => pack.kind === 'language').translations['設定'], 'Paramètres');
  assert.equal(result.packs.find(pack => pack.kind === 'font').fonts.length, 1);
  assert.equal(result.packs.find(pack => pack.kind === 'font').fonts[0].source, undefined);
  assert.ok((await readFontPack(root, 'font:sample-font.zip')).fonts[0].source.startsWith('data:font/ttf;base64,'));
  assert.equal(result.packs.find(pack => pack.kind === 'font').hotReload, false);
  await savePackOrder(root, ['font:sample-font.zip', 'shape:sample-shape.zip', 'language:sample-language.json']);
  result = await listResourcePacks(root);
  assert.deepEqual(result.packs.map(pack => pack.kind), ['font', 'shape', 'language']);
  assert.equal((await orderedShapePacks(root)).packs[0].id, 'shape:sample-shape.zip');
  const recovered = await removePack(root, 'language:sample-language.json');
  assert.ok((await readFile(recovered, 'utf8')).includes('Français'));
  assert.equal((await listResourcePacks(root)).packs.length, 2);
  const singleFont = path.join(root, 'single.ttf');
  await writeFile(singleFont, Buffer.from([0, 1, 0, 0, 0, 0]));
  assert.equal(await installPack(root, 'font', singleFont), 'font:single.ttf');
  assert.equal((await readFontPack(root, 'font:single.ttf')).fonts.length, 1);
  await assert.rejects(removePack(root, 'language:../sample-language.json'));
  console.log('Resource pack tests passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
