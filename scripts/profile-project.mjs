// Read-only CPU profile for an exported cbmodel. No project files are modified.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { CubeBricksProject, buildModifierRenderInstances } from '../src/model.js';

const require = createRequire(import.meta.url);
const { unpackArchive } = require('../electron/archive-codec.cjs');
const filename = process.argv[2];
if (!filename) throw new Error('Usage: node scripts/profile-project.mjs <file.cbmodel>');

const start = performance.now();
const entries = unpackArchive(fs.readFileSync(filename));
const unpackMs = performance.now() - start;
const state = JSON.parse(entries.get('current_state')?.toString('utf8') || 'null');
const manifest = JSON.parse(entries.get(`transactions/${state?.activeHead}.json`)?.toString('utf8') || 'null');
if (!manifest) throw new Error('This profiler requires an expanded-project cbmodel archive');
const nodesStart = performance.now();
const readNode = uid => {
  const pointer = manifest.pointers[uid];
  const record = JSON.parse(entries.get(`${pointer.folder}/${pointer.local}.json`).toString('utf8'));
  return record.state;
};
const data = JSON.parse(JSON.stringify(manifest.information));
data.elements = manifest.elementOrder.map(readNode);
data.groups = manifest.groupOrder.map(readNode);
const nodesMs = performance.now() - nodesStart;
const constructStart = performance.now();
const project = new CubeBricksProject(data);
const constructMs = performance.now() - constructStart;
const oneCubeData = { ...data, elements: data.elements.map((element, index) => index === 0
  ? { ...element, position: [...(element.position || [0, 0, 0])] } : element) };
const undoConstructStart = performance.now();
new CubeBricksProject(oneCubeData, {
  reuseElementsFrom: project, changedUids: [data.elements[0]?.uid]
});
const oneCubeUndoConstructMs = performance.now() - undoConstructStart;
const serializeStart = performance.now();
project.serialize();
const serializeMs = performance.now() - serializeStart;
const modifierRuns = [];
let instances;
for (let run = 0; run < 5; run++) {
  const modifierStart = performance.now();
  instances = buildModifierRenderInstances(project);
  modifierRuns.push(performance.now() - modifierStart);
}
const sortedModifierRuns = [...modifierRuns].sort((a, b) => a - b);
const modifierMs = sortedModifierRuns[Math.floor(sortedModifierRuns.length / 2)];
let generatedCubes = 0;
const shapesStart = performance.now();
for (const element of project.elements) {
  if (element.type === 'cube' || typeof element.toCubes !== 'function') continue;
  generatedCubes += element.toCubes().length;
}
const shapesMs = performance.now() - shapesStart;
const buckets = new Map();
for (const [name, bytes] of entries) {
  const bucket = name.split('/')[0];
  const item = buckets.get(bucket) || { files: 0, bytes: 0 };
  item.files++;
  item.bytes += bytes.length;
  buckets.set(bucket, item);
}
console.log(JSON.stringify({
  archiveBytes: fs.statSync(filename).size,
  entries: entries.size,
  elements: project.elements.length,
  groups: project.groups.length,
  shapes: project.elements.filter(node => node.type === 'shape' || node.type?.startsWith('bezier')).length,
  generatedCubes,
  modifierInstances: instances.length,
  timingsMs: { unpack: unpackMs, readNodes: nodesMs, construct: constructMs,
    oneCubeUndoConstruct: oneCubeUndoConstructMs,
    serialize: serializeMs, modifiersMedianOf5: modifierMs, shapes: shapesMs },
  buckets: Object.fromEntries(buckets)
}, null, 2));
