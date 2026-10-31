const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

if (process.platform !== 'win32') {
  console.error('The CubeBricks installer can only be built on Windows.');
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, '..');
const baseVersion = require(path.join(projectRoot, 'package.json')).version;
const installerVersion = process.env.CUBEBRICKS_INSTALLER_VERSION || (baseVersion.includes('-') ? baseVersion : `${baseVersion}-beta`);
const versionCheck = spawnSync(process.execPath, [path.join(__dirname, 'installer-version.cjs'), installerVersion], {
  cwd: projectRoot, stdio: 'inherit'
});
if (versionCheck.error || versionCheck.status !== 0) {
  process.exit(versionCheck.status || 1);
}
const art = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  path.join(__dirname, 'generate-installer-art.ps1')], { cwd: projectRoot, stdio: 'inherit' });
if (art.error || art.status !== 0) {
  console.error(art.error || 'Installer artwork generation failed.');
  process.exit(art.status || 1);
}

const environment = { ...process.env };
let temporaryRceditDirectory;
const localRcedit = path.join(projectRoot, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
if (!environment.ELECTRON_BUILDER_RCEDIT_PATH && fs.existsSync(localRcedit)) {
  temporaryRceditDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cubebricks-rcedit-'));
  for (const name of ['rcedit-x64.exe', 'rcedit-x86.exe']) {
    fs.copyFileSync(localRcedit, path.join(temporaryRceditDirectory, name));
  }
  environment.ELECTRON_BUILDER_RCEDIT_PATH = temporaryRceditDirectory;
}

if (!environment.ELECTRON_BUILDER_7ZIP_PATH) {
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

function cleanup() {
  if (!temporaryRceditDirectory) return;
  const target = path.resolve(temporaryRceditDirectory);
  if (path.dirname(target) !== path.resolve(os.tmpdir())
    || !path.basename(target).startsWith('cubebricks-rcedit-')) return;
  fs.rmSync(target, { recursive: true, force: true });
}

const builder = path.join(projectRoot, 'node_modules', 'electron-builder', 'cli.js');
const child = spawn(process.execPath, [builder, '--win', 'nsis', '--x64', '--config.win.signExecutable=false',
  `--config.extraMetadata.version=${installerVersion}`], {
  cwd: projectRoot, env: environment, stdio: 'inherit'
});
child.on('error', error => { console.error(error); cleanup(); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  cleanup();
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code || 0;
});
