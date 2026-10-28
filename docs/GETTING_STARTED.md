# 启动与构建 / Getting Started

[English](GETTING_STARTED.en.md) · [返回 README](../README.md) · [操作教程](USER_GUIDE.md) · [架构概述](../ARCHITECTURE.md)

## 从仓库启动

CubeBricks 当前没有独立下载页。Windows 使用者可以拉取本仓库，在根目录执行一次 `npm install` 安装依赖，之后直接双击根目录的 **`CubeBricksStart.exe`** 启动。这个 EXE 是附带图标的开发版启动器，会寻找 `node_modules/electron/dist/electron.exe`，不是无需依赖的完整打包版；缺少依赖时会显示提示。

```powershell
git clone https://github.com/Lazy-Pillow-Minecraft/CubeBricks.git
cd CubeBricks
npm install
```

也可以把 `.cbmodel` 拖到 `CubeBricksStart.exe` 上打开。若要查看启动日志，使用 `CubeBricksStart.bat` 或在终端执行 `npm start`。远程桌面或虚拟机的 GPU 不可用时，可试 `npm run start:safe`。

启动器源代码在 [`launcher/CubeBricksStart.cs`](../launcher/CubeBricksStart.cs)；需要重新编译启动器时执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-launcher.ps1
```

## 浏览器预览

执行 `npm run preview`，再打开 `http://127.0.0.1:8765/`。这仅供预览界面；桌面文件、工作日志及资源包功能请使用 Electron 版。

## 检查与测试

```powershell
npm run check
npm run test:modules
npm run test:model
npm run test:render
npm run test:layer-tone-map
npm run test:color-space
npm run test:journal
```

其余测试指令见 [`package.json`](../package.json)。

## 打包 Windows 单文件版

双击根目录的 `build-portable.bat`，或执行 `npm run dist:portable`。构建脚本会先检查源代码并运行测试，成功后在 `dist/` 生成 `CubeBricks-<version>-portable.exe`。首次构建可能需要下载 Electron 打包资源；这个产物和仓库根目录的轻量启动器不是同一个文件。

## 打包 Windows 安装版

双击根目录的 `build-installer.bat`，可在打包前输入版本号（例如 `0.1.0-beta`，直接按回车则使用当前基础版本的 beta 版）；也可执行 `npm run dist:installer`，或通过环境变量 `CUBEBRICKS_INSTALLER_VERSION` 指定版本。版本只用于本次打包，不会改写 `package.json`。脚本会生成深棕／金色的 CubeBricks 安装器图像，并在 `dist/` 生成 `CubeBricks-v<version>-win-x64-setup.exe`。安装向导使用现有软件图标与标题，可选择安装目录，并建立桌面及开始菜单快捷方式。这是安装版，不是 `build-portable.bat` 的单文件便携版。首次构建可能需要下载打包资源；产物未进行代码签名。
