# 啟動與建置 / Getting Started

[返回 README](../README.md) · [操作教程](USER_GUIDE.md) · [架構概述](../ARCHITECTURE.md)

## 從倉庫啟動

CubeBricks 目前沒有獨立下載頁。Windows 使用者可以拉取本倉庫，在根目錄執行一次 `npm install` 安裝依賴，之後直接雙擊根目錄的 **`CubeBricksStart.exe`** 啟動。這個 EXE 是附帶圖標的開發版啟動器，會尋找 `node_modules/electron/dist/electron.exe`，不是無需依賴的完整打包版；缺少依賴時會顯示提示。

```powershell
git clone https://github.com/Lazy-Pillow-Minecraft/CubeBricks.git
cd CubeBricks
npm install
```

也可以把 `.cbmodel` 拖到 `CubeBricksStart.exe` 上開啟。若要看啟動日誌，使用 `CubeBricksStart.bat` 或在終端執行 `npm start`。遠端桌面或虛擬機的 GPU 不可用時，可試 `npm run start:safe`。

啟動器原始碼在 [`launcher/CubeBricksStart.cs`](../launcher/CubeBricksStart.cs)；需要重新編譯啟動器時執行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-launcher.ps1
```

## 瀏覽器預覽

執行 `npm run preview`，再開啟 `http://127.0.0.1:8765/`。這僅供預覽介面；桌面文件、工作日誌及資源包功能請使用 Electron 版。

## 檢查與測試

```powershell
npm run check
npm run test:modules
npm run test:model
npm run test:render
npm run test:layer-tone-map
npm run test:color-space
npm run test:journal
```

其餘測試指令見 [`package.json`](../package.json)。

## 打包 Windows 單文件版

雙擊根目錄的 `build-portable.bat`，或執行 `npm run dist:portable`。建置腳本會先檢查原始碼與測試，成功後在 `dist/` 產生 `CubeBricks-<version>-portable.exe`。首次建置可能需要下載 Electron 打包資源；這個產物和倉庫根目錄的輕量啟動器不是同一個文件。

## English

There is no separate download page yet. On Windows, clone the repository, run `npm install` once, then double-click **`CubeBricksStart.exe`** in the repository root. It launches the local Electron dependency; it is not the standalone portable build. Drop a `.cbmodel` onto the launcher to open it, or use `CubeBricksStart.bat` / `npm start` to see startup logs. Run `npm run start:safe` when GPU rendering is unavailable. `npm run dist:portable` builds the separate single-file executable under `dist/`.
