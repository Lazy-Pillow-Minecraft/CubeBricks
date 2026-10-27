# CubeBricks

[繁體中文](#繁體中文) · [English](#english)

## 繁體中文

CubeBricks 是面向 Minecraft 模型工作流的桌面建模器，以 Cube、程序化 Shape 和 Bezier 曲線為基礎，整合場景層級、UV、圖層貼圖、繪畫、修改器與 Blockbench 模型交換。目前仍處於原型開發階段，部分格式與動畫能力尚在完善。

目前沒有獨立下載頁。Windows 使用者可拉取本倉庫，安裝依賴一次後，直接雙擊根目錄的 **`CubeBricksStart.exe`** 啟動：

```powershell
git clone https://github.com/Lazy-Pillow-Minecraft/CubeBricks.git
cd CubeBricks
npm install
```

此 EXE 是倉庫的輕量啟動器，會使用 `node_modules` 中的 Electron；它與 `dist/` 裡可自行打包的單文件版不同。完整步驟見 [啟動與建置](docs/GETTING_STARTED.md)。

### 文檔索引

| 想了解的內容 | 文檔 |
| --- | --- |
| 從倉庫啟動、瀏覽器預覽、測試、單文件打包 | [啟動與建置](docs/GETTING_STARTED.md) |
| 目前的建模、UV、圖層、繪畫與擴展能力 | [功能概覽](docs/FEATURES.md) |
| 日常操作、快捷鍵、紋理模板及繪畫流程 | [操作教程](docs/USER_GUIDE.md) |
| `.cbmodel`、`.bbmodel`、`.cbcmap` 與工作記錄恢復 | [文件格式與恢復](docs/FORMATS_AND_RECOVERY.md) |
| 模組分工、依賴方向與新增代碼約定 | [架構概述](ARCHITECTURE.md) |
| 外部包類型與編寫文檔入口 | [附加包索引](docs/ADDON_PACKS.md) |
| 自訂 Shape 的清單、腳本、圖標和 API | [Shape 包編寫規範](SHAPE_PACKS.md) |
| 語言包、字體包與翻譯鍵 | [資源包規範](RESOURCE_PACKS.md) |

## English

CubeBricks is a desktop editor for Minecraft model workflows. It combines cubes, procedural shapes, Bezier curves, hierarchy editing, UVs, layered textures, painting, modifiers, and Blockbench interchange. It is still a prototype; some format and animation features are unfinished.

There is no separate download page yet. On Windows, clone this repository, run `npm install` once, then double-click **`CubeBricksStart.exe`** in the repository root. This lightweight launcher uses the local Electron dependency; it is not the standalone portable build. See [Getting Started](docs/GETTING_STARTED.md).

The documentation above links directly to the [feature overview](docs/FEATURES.md), [user guide](docs/USER_GUIDE.md), [architecture](ARCHITECTURE.md), [file formats and recovery](docs/FORMATS_AND_RECOVERY.md), and [add-on pack index](docs/ADDON_PACKS.md).
