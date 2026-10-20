import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

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
if (!process.exitCode) process.stdout.write(`Checked ${files.length} source files.\n`);
