// Read-only module inventory used by the pre-animation architecture audit.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative, extname } from 'node:path';
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(name));
    else if (/\.(?:js|cjs|mjs)$/.test(name)) result.push(name);
  }
  return result;
}
const paths = [...await files('src'), ...await files('electron')], available = new Set(paths), modules = [];
const graph = new Map(), incoming = new Map(), factories = [], unresolved = [];
for (const file of paths) {
  const source = await readFile(file, 'utf8'), dependencies = new Set();
  const imports = /(?:\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?['"](\.[^'"]+)['"]|\b(?:import|require)\s*\(\s*['"](\.[^'"]+)['"])/g;
  for (const match of source.matchAll(imports)) {
    const specifier = match[1] || match[2], base = resolve(dirname(file), specifier);
    const target = [base, ...['.js', '.cjs', '.mjs', '/index.js'].map(extension => base + extension)].find(candidate => available.has(candidate));
    if (!target) {
      if (!extname(base) || /\.(?:js|cjs|mjs)$/.test(base)) unresolved.push({ file: relative('.', file), specifier });
      continue;
    }
    dependencies.add(target);
  }
  graph.set(file, dependencies);
  for (const dependency of dependencies) incoming.set(dependency, (incoming.get(dependency) || 0) + 1);
  for (const match of source.matchAll(/export\s+function\s+(create\w+)\s*\(\s*\{([^}]+)\}/g)) {
    factories.push({
      file: relative('.', file),
      name: match[1],
      injectedNames: match[2].split(',').map(value => value.trim()).filter(Boolean).length
    });
  }
  modules.push({
    file: relative('.', file),
    lines: source.split('\n').length,
    bytes: Buffer.byteLength(source),
    imports: dependencies.size
  });
}
const active = new Set(), visited = new Set(), stack = [], cycles = [];
function visit(file) {
  if (active.has(file)) {
    cycles.push([...stack.slice(stack.indexOf(file)), file].map(name => relative('.', name)));
    return;
  }
  if (visited.has(file)) return;
  active.add(file);
  stack.push(file);
  for (const target of graph.get(file)) visit(target);
  stack.pop();
  active.delete(file);
  visited.add(file);
}
for (const file of paths) visit(file);
const layer = file => relative('.', file).replaceAll('\\', '/').split('/').slice(0, 2).join('/');
const crossLayer = [];
for (const [file, dependencies] of graph) for (const dependency of dependencies) {
  if (/^src\/(?:common|utils)/.test(layer(file)) && /^src\/(?:screen|editor|texture|paint|project)/.test(layer(dependency)))
    crossLayer.push({ from: relative('.', file), to: relative('.', dependency) });
}
const report = {
  generatedAt: new Date().toISOString(), moduleCount: paths.length,
  totalLines: modules.reduce((sum, entry) => sum + entry.lines, 0),
  edgeCount: [...graph.values()].reduce((sum, entries) => sum + entries.size, 0), cycles, unresolved, crossLayer,
  largest: [...modules].sort((a, b) => b.lines - a.lines).slice(0, 20),
  fanIn: [...incoming].map(([file, count]) => ({ file: relative('.', file), count })).sort((a, b) => b.count - a.count),
  factories: factories.sort((a, b) => b.injectedNames - a.injectedNames), modules
};
await mkdir('build/performance', { recursive: true });
const suffix = process.argv.find(value => value.startsWith('--suffix='))?.slice(9).replace(/[^\w-]/g, '') || '';
await writeFile(`build/performance/audit-structure-2026-11-05${suffix ? '-' + suffix : ''}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  ...report,
  modules: undefined,
  largest: report.largest.slice(0, 10),
  fanIn: report.fanIn.slice(0, 10),
  factories: report.factories.slice(0, 10)
}, null, 2));
