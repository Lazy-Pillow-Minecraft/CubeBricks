import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CubeBricksProject, Shape } from '../src/model.js';
import { shapeRegistry } from '../src/shapes/builtins.js';
import { shapePackUtils } from '../src/utils/index.js';

const require = createRequire(import.meta.url);
const { listShapePacks } = require('../electron/shape-packs.cjs');
const { packZip } = require('../electron/zip-store.cjs');
const root = await mkdtemp(path.join(tmpdir(), 'cubebricks-shape-packs-'));
const packageJson = JSON.stringify({ version: '1.2.3', shapes: [{ id: 'sample_arch', label: '拱門', file: 'arch.js' }] });
const source = `export default { id:'sample_arch', label:'Arch', defaults:{width:8},
  fields:[{key:'width',label:'寬度',min:0,step:1}],
  generate(shape,{Cube,utils}) { return [new Cube({position:[utils.math.vector3.dot3([shape.parameters.width,0,0],[.5,0,0]),0,0],size:[shape.parameters.width,1,1]})]; } };`;

assert.equal(typeof shapePackUtils.math.rotation.rotateVector, 'function');
assert.equal(typeof shapePackUtils.shape.bezierGeometry.bezierCubes, 'function');
assert.equal(shapePackUtils.shape.polyhedronGeometry.DODECAHEDRON_UNIT_FACES.length, 12);
assert.equal(typeof shapePackUtils.templatePacker.packTemplateRectangles, 'function');

try {
  const folder = path.join(root, 'FolderPack');
  await mkdir(path.join(folder, 'shapes'), { recursive: true });
  await writeFile(path.join(folder, 'package.json'), packageJson);
  await writeFile(path.join(folder, 'shapes', 'arch.js'), source);
  const loaded = await listShapePacks(root);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.packs[0].name, 'FolderPack');
  assert.equal(loaded.packs[0].version, '1.2.3');
  assert.equal(loaded.packs[0].shapes[0].icon, null);
  const record = loaded.packs[0].shapes[0];
  const definition = (await import(`data:text/javascript;base64,${record.source}`)).default;
  shapeRegistry.register(definition, { external: true, pack: loaded.packs[0].name });
  const project = new CubeBricksProject({ elements: [{ type: 'sample_arch', shapeType: 'sample_arch', parameters: { width: 5 } }] });
  assert.ok(project.elements[0] instanceof Shape);
  assert.equal(project.elements[0].toCubes()[0].size[0], 5);
  assert.equal(project.elements[0].toCubes()[0].position[0], 2.5, 'external shapes receive shared utils');
  assert.equal(new Shape({ shapeType: 'polygon_prism' }).toCubes().length, 4);

  await writeFile(path.join(root, 'ZipPack.zip'), packZip([
    ['ZipPack/', Buffer.alloc(0)],
    ['ZipPack/shapes/', Buffer.alloc(0)],
    ['ZipPack/package.json', Buffer.from(JSON.stringify({ version: '2.0.0',
      shapes: [{ id: 'zip_arch', label: 'Zip Arch', file: 'arch.js' }] }))],
    ['ZipPack/shapes/arch.js', Buffer.from(source.replaceAll('sample_arch', 'zip_arch'))]
  ]));
  const zipped = await listShapePacks(root);
  assert.deepEqual(zipped.errors, []);
  assert.equal(zipped.packs.find(pack => pack.name === 'ZipPack')?.shapes[0].id, 'zip_arch');
  assert.ok((await readFile(path.join(folder, 'shapes', 'arch.js'), 'utf8')).includes('generate'));
  console.log('Shape pack tests passed.');
} finally {
  shapeRegistry.removeExternal();
  await rm(root, { recursive: true, force: true });
}
