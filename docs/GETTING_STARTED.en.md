# Getting Started and Building

[简体中文](GETTING_STARTED.md) · [README](../README.md) · [User guide](USER_GUIDE.en.md) · [Architecture](../ARCHITECTURE.en.md)

## Run from the repository

CubeBricks does not have a separate download page yet. On Windows, clone this repository and run `npm install` once in its root directory. After that, double-click **`CubeBricksStart.exe`** in the repository root to launch the app. This icon-bearing EXE is a development launcher: it looks for `node_modules/electron/dist/electron.exe`. It is not a dependency-free portable build, and it shows a message if that Electron dependency is missing.

```powershell
git clone https://github.com/Lazy-Pillow-Minecraft/CubeBricks.git
cd CubeBricks
npm install
```

You can also drop a `.cbmodel` file onto `CubeBricksStart.exe` to open it. To see startup logs, double-click `CubeBricksStart.bat` or run `npm start` in a terminal. If GPU rendering is unavailable in a remote desktop session or virtual machine, try `npm run start:safe`.

The launcher source is [`launcher/CubeBricksStart.cs`](../launcher/CubeBricksStart.cs). To rebuild it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-launcher.ps1
```

## Browser preview

Run `npm run preview`, then open `http://127.0.0.1:8765/`. This previews the interface only. Use the Electron app for desktop file access, working journals, and resource packs.

## Checks and tests

```powershell
npm run check
npm run test:modules
npm run test:model
npm run test:render
npm run test:layer-tone-map
npm run test:color-space
npm run test:journal
```

See [`package.json`](../package.json) for the remaining test scripts.

## Build a single-file Windows executable

Double-click `build-portable.bat` in the repository root, or run `npm run dist:portable`. The build script checks the source and runs the test suite before producing `dist/CubeBricks-<version>-portable.exe`. The first build may need to download Electron packaging resources. This output is different from the small launcher committed at the repository root.

## Build a Windows installer

Double-click `build-installer.bat` in the repository root to enter a version before packaging (for example, `0.1.0-beta`; pressing Enter uses the current base version with a beta suffix). You can also run `npm run dist:installer`, setting `CUBEBRICKS_INSTALLER_VERSION` to override the version. This changes only the current build, not `package.json`. The script generates dark-brown and gold CubeBricks installer artwork and produces `dist/CubeBricks-v<version>-win-x64-setup.exe`. The wizard carries the existing app icon and title, offers an installation-directory choice, and creates desktop and Start Menu shortcuts. This installer is separate from the single-file portable build. A first build may need to download packaging resources; the output is not code-signed.
