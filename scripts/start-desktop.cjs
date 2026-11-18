const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const manifest = require('../package.json');

const root = path.resolve(__dirname, '..');

function stageRuntime(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'electron.exe' || entry.name === 'log') continue;
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) stageRuntime(from, to);
    else if (entry.isFile()) {
      try { fs.linkSync(from, to); }
      catch { fs.copyFileSync(from, to); }
    }
  }
}

function windowsExecutable(electron) {
  const icon = path.join(root, 'src', 'assets', 'shortcut-icon.ico');
  const rcedit = path.join(root, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
  const runtime = path.dirname(electron);
  const cache = path.join(root, 'node_modules', '.cache', 'cubebricks-desktop');
  const version = manifest.version.match(/^\d+\.\d+\.\d+/)?.[0] || '0.0.0';
  const key = createHash('sha256').update('windows-desktop-v1')
    .update(fs.readFileSync(path.join(runtime, 'version')))
    .update(String(fs.statSync(electron).mtimeMs))
    .update(manifest.productName).update(manifest.version)
    .update(fs.readFileSync(icon)).digest('hex').slice(0, 20);
  const destination = path.join(cache, key);
  const executableName = `${manifest.productName}.exe`;
  const executable = path.join(destination, executableName);
  if (fs.existsSync(executable)) return executable;

  fs.mkdirSync(cache, { recursive: true });
  const staging = fs.mkdtempSync(path.join(cache, 'staging-'));
  try {
    stageRuntime(runtime, staging);
    const stagedExecutable = path.join(staging, executableName);
    fs.copyFileSync(electron, stagedExecutable);
    const edit = spawnSync(rcedit, [
      stagedExecutable, '--set-icon', icon,
      '--set-version-string', 'FileDescription', manifest.productName,
      '--set-version-string', 'ProductName', manifest.productName,
      '--set-version-string', 'CompanyName', manifest.author,
      '--set-version-string', 'InternalName', manifest.productName,
      '--set-version-string', 'OriginalFilename', executableName,
      '--set-file-version', version, '--set-product-version', version
    ], { windowsHide: true, encoding: 'utf8' });
    if (edit.error || edit.status !== 0) {
      throw edit.error || new Error(edit.stderr.trim() || edit.stdout.trim() || 'Could not set CubeBricks executable resources.');
    }
    try { fs.renameSync(staging, destination); }
    catch (error) { if (!fs.existsSync(executable)) throw error; }
    return executable;
  } finally {
    if (path.dirname(staging) === cache && path.basename(staging).startsWith('staging-')) {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}

function startEditor(executable, args, fallback = null) {
  const started = Date.now();
  const child = spawn(executable, [root, ...args], { cwd: root, stdio: 'inherit' });
  child.on('error', error => {
    if (fallback) startEditor(fallback, args);
    else { console.error(error.message); process.exitCode = 1; }
  });
  child.on('exit', (code, signal) => {
    if (fallback && code !== 0 && Date.now() - started < 4000) {
      console.error('CubeBricks: branded executable exited during startup; retrying with Electron.');
      startEditor(fallback, args);
    } else if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

try {
  const original = require('electron');
  const args = process.argv.slice(2);
  let executable = original;
  if (process.platform === 'win32') {
    try { executable = windowsExecutable(original); }
    catch (error) {
      if (args[0] === '--prepare-runtime') throw error;
      console.error(`CubeBricks: could not prepare the branded executable: ${error.message}`);
    }
  }
  if (args[0] === '--prepare-runtime') console.log(executable);
  else startEditor(executable, args, executable === original ? null : original);
} catch (error) {
  console.error(`CubeBricks: ${error.message}`);
  process.exitCode = 1;
}
