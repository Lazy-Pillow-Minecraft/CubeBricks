const version = process.argv[2] ?? process.env.CUBEBRICKS_INSTALLER_VERSION ?? '';
const validVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9A-Za-z-][0-9A-Za-z-]*))*)?$/;

if (!validVersion.test(version)) {
  console.error(`[ERROR] Invalid installer version: ${version || '(empty)'}`);
  console.error('Use a version such as 0.1.0-beta, 0.1.0-rc.1, or 0.1.0. Do not include the leading v.');
  process.exitCode = 1;
} else {
  console.log(`Installer: CubeBricks-v${version}-win-x64-setup.exe`);
}
