const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const environment = { ...process.env };
let temporaryRceditDirectory;

// electron-builder's current resource editor expects two architecture-specific
// filenames. The installed Windows packaging dependency ships the same editor
// under one name, so reuse it instead of requiring another network download.
if (process.platform === 'win32' && !environment.ELECTRON_BUILDER_RCEDIT_PATH) {
  const localRcedit = path.join(projectRoot, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
  if (fs.existsSync(localRcedit)) {
    temporaryRceditDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cubebricks-rcedit-'));
    for (const name of ['rcedit-x64.exe', 'rcedit-x86.exe']) {
      fs.copyFileSync(localRcedit, path.join(temporaryRceditDirectory, name));
    }
    environment.ELECTRON_BUILDER_RCEDIT_PATH = temporaryRceditDirectory;
  }
}

// The builder's legacy 7-Zip cache is usable even when its newer downloader
// does not recognize that cache entry. Respect an explicit user override.
if (process.platform === 'win32' && !environment.ELECTRON_BUILDER_7ZIP_PATH) {
  const cacheRoot = environment.ELECTRON_BUILDER_CACHE
    || path.join(environment.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache');
  const sevenZipCache = path.join(cacheRoot, '7zip@1.0.0');
  if (fs.existsSync(sevenZipCache)) {
    for (const entry of fs.readdirSync(sevenZipCache, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const executable = path.join(sevenZipCache, entry.name, 'bin', '7za.exe');
      if (fs.existsSync(executable)) {
        environment.ELECTRON_BUILDER_7ZIP_PATH = executable;
        break;
      }
    }
  }
}

const builder = path.join(projectRoot, 'node_modules', 'electron-builder', 'cli.js');
const child = spawn(process.execPath, [builder, '--win', 'portable', '--x64', '--config.win.signExecutable=false'], {
  cwd: projectRoot,
  env: environment,
  stdio: 'inherit',
});

child.on('error', error => {
  console.error(error);
  if (temporaryRceditDirectory) fs.rmSync(temporaryRceditDirectory, { recursive: true, force: true });
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (temporaryRceditDirectory) fs.rmSync(temporaryRceditDirectory, { recursive: true, force: true });
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code || 0;
});
