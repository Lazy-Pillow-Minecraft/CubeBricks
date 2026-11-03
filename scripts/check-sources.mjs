import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (/\.(?:cjs|mjs|js)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const files = (await Promise.all(['src', 'electron', 'scripts'].map(sourceFiles))).flat().sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(`${file}\n${result.stderr || result.stdout}\n`);
    process.exitCode = 1;
  }
}
if (!process.exitCode) {
  const modules = files.filter(file => file.startsWith('src\\') || file.startsWith('src/')
    || file.startsWith('electron\\') || file.startsWith('electron/'));
  const absoluteFiles = new Set(modules.map(file => resolve(file)));
  const graph = new Map();
  for (const file of modules) {
    const source = await readFile(file, 'utf8');
    const targets = [];
    const imports = /(?:\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?|\brequire\s*\()\s*['"](\.[^'"]+)['"]/g;
    for (const match of source.matchAll(imports)) {
      const target = resolve(dirname(file), match[1]);
      if (!absoluteFiles.has(target)) continue;
      targets.push(target);
      if (target === resolve('src/render/webgl-renderer.js')
        && ![resolve('src/app.js'), resolve('src/render/model-capture.js')].includes(resolve(file))) {
        process.stderr.write(`${file}: import pure geometry helpers from common/core/geometry-utils.js, not the WebGL renderer.\n`);
        process.exitCode = 1;
      }
    }
    graph.set(resolve(file), targets);
  }
  const visited = new Set(), active = new Set(), stack = [];
  const visit = file => {
    if (active.has(file)) {
      const cycle = [...stack.slice(stack.indexOf(file)), file].map(entry => relative('.', entry));
      process.stderr.write(`Circular module dependency: ${cycle.join(' -> ')}\n`);
      process.exitCode = 1;
      return;
    }
    if (visited.has(file)) return;
    active.add(file); stack.push(file);
    for (const target of graph.get(file) || []) visit(target);
    stack.pop(); active.delete(file); visited.add(file);
  };
  for (const file of graph.keys()) visit(file);
}
if (!process.exitCode) process.stdout.write(`Checked ${files.length} source files and their module graph.\n`);
