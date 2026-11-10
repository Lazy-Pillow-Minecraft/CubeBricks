import { execFileSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import * as current from '../src/model.js';

// Load the pre-optimization module with its imports resolved to the same
// production dependencies, without modifying any source or model files.
const baseline = process.argv.find(value => value.startsWith('--baseline='))?.slice(11)
  || 'a6dfa154184cd15f4d84a511ab39913865ccd6f3';
const source = execFileSync('git', ['show', `${baseline}:src/model.js`], { encoding: 'utf8' })
  .replace(/from (['"])(\.[^'"]+)\1/g, (_match, quote, target) => `from ${quote}${new URL(target, new URL('../src/model.js', import.meta.url)).href}${quote}`);
const previous = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const results = [];
for (const count of [1000, 5000]) for (const dedup of [true, false]) {
  const row = { count, dedup };
  for (const [name, api] of [['baseline', previous], ['optimized', current]]) {
    const elements = Array.from({ length: count }, (_, index) => new api.Cube({
      uid: `cube-${index}`,
      position: [index % 25 * 2, Math.floor(index / 625) * 2, Math.floor(index / 25) % 25 * 2], size: [1, 1, 1]
    }));
    const group = new api.Group({ uid: 'root', children: elements.map(cube => cube.uid) });
    const project = new api.CubeBricksProject({ formatId: 'bedrock_entity', elements, groups: [group], outliner: [group.uid] });
    api.addModifier(project.groups[0], 'symmetry', { axes: { x: true, y: true, z: true }, ignoreDuplicateCubes: dedup });
    api.buildModifierRenderInstances(project);
    api.buildModifierRenderInstances(project);
    const samples = [];
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      const instances = api.buildModifierRenderInstances(project);
      samples.push(performance.now() - start);
      row.instances = instances.length;
    }
    samples.sort((a, b) => a - b);
    row[name] = { p50: samples[3], p95: samples[6] };
  }
  results.push(row);
}
await mkdir(new URL('../build/performance/', import.meta.url), { recursive: true });
await writeFile(new URL('../build/performance/modifier-comparison-2026-11-06.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
