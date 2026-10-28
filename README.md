# CubeBricks

[简体中文](#简体中文) · [English](#english)

## 简体中文

CubeBricks 是面向 Minecraft 模型工作流的桌面建模器，以 Cube、程序化 Shape 和 Bezier 曲线为基础，整合场景层级、UV、图层贴图、绘画、修改器与 Blockbench 模型交换。Java 方块／物品及基岩版方块提供各自的格式约束与视图范围提示。当前仍处于原型开发阶段，部分格式与动画能力尚在完善。

UV 编辑默认并入编辑模式，亦可在设置中开启独立模式；可选 Blockbench 风格鼠标操作。Minecraft 皮肤和 GeckoLib 暂停新建，已有模型仍可识别。

当前没有独立下载页。Windows 使用者可拉取本仓库，安装依赖一次后，直接双击根目录的 **`CubeBricksStart.exe`** 启动；也可双击 `build-installer.bat` 自行生成带图标和安装向导的安装包：

```powershell
git clone https://github.com/Lazy-Pillow-Minecraft/CubeBricks.git
cd CubeBricks
npm install
```

此 EXE 是仓库的轻量启动器，会使用 `node_modules` 中的 Electron；它与 `dist/` 中可自行打包的单文件版不同。完整步骤见 [启动与构建](docs/GETTING_STARTED.md)。

### 文档索引

| 想了解的内容 | 文档 |
| --- | --- |
| 从仓库启动、浏览器预览、测试、单文件打包 | [启动与构建](docs/GETTING_STARTED.md) |
| 当前的建模、UV、图层、绘画与扩展能力 | [功能概览](docs/FEATURES.md) |
| 日常操作、快捷键、纹理模板及绘画流程 | [操作教程](docs/USER_GUIDE.md) |
| `.cbmodel`、`.bbmodel`、`.cbcmap` 与工作记录恢复 | [文件格式与恢复](docs/FORMATS_AND_RECOVERY.md) |
| 模块分工、依赖方向与新增代码约定 | [架构概述](ARCHITECTURE.md) |
| 外部包类型与编写文档入口 | [附加包索引](docs/ADDON_PACKS.md) |
| 自定义 Shape 的配置清单、脚本、图标和 API | [Shape 包编写规范](SHAPE_PACKS.md) |
| 语言包、字体包与翻译键 | [资源包规范](RESOURCE_PACKS.md) |

## English

CubeBricks is a desktop editor for Minecraft model workflows. It combines cubes, procedural shapes, Bezier curves, hierarchy editing, UVs, layered textures, painting, modifiers, and Blockbench interchange. Java Block/Item and Bedrock Block projects have format-specific constraints and viewport boundary guides. It is still a prototype; some format and animation features are unfinished.

UV editing is part of Edit mode by default but can be split into a separate mode in Settings. Blockbench-style mouse controls are optional. New Minecraft Skin and GeckoLib projects are temporarily disabled; existing models remain recognizable.

There is no separate download page yet. On Windows, clone this repository, run `npm install` once, then double-click **`CubeBricksStart.exe`** in the repository root. This lightweight launcher uses the local Electron dependency; it is not the standalone portable build. To create an installer, double-click `build-installer.bat`.

### Documentation

| Topic | English guide |
| --- | --- |
| Clone, launch, preview, test, and build | [Getting started](docs/GETTING_STARTED.en.md) |
| Modeling, UVs, layers, painting, and extension features | [Feature overview](docs/FEATURES.en.md) |
| Everyday workflow, shortcuts, templates, and painting | [User guide](docs/USER_GUIDE.en.md) |
| `.cbmodel`, `.bbmodel`, `.cbcmap`, and journal recovery | [Formats and recovery](docs/FORMATS_AND_RECOVERY.en.md) |
| Modules, dependency boundaries, and code conventions | [Architecture overview](ARCHITECTURE.en.md) |
| Extension types and authoring guides | [Add-on pack index](docs/ADDON_PACKS.en.md) |
| Shape manifests, scripts, icons, and API | [Shape pack authoring](SHAPE_PACKS.en.md) |
| Language packs, font packs, and translation keys | [Resource pack authoring](RESOURCE_PACKS.en.md) |
