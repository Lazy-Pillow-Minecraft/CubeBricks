# CubeBricks 資源包

桌面版在「設定 → 一般 → 管理資源包」加入、移除、排序與重新載入資源包。介面字體在「設定 → 外觀」選擇，介面語言在「設定 → 一般」選擇。內置 Fusion Pixel、系統字體與三種內置語言無需安裝。

三類包共用管理視窗，但各自存於工作空間的 `shapepacks/`、`languagepacks/`、`fontpacks/`。移除時包會被移到 `removed-packs/`，可手動移回。排序決定同類包的載入順序；語言代碼重複時，靠前的包先註冊。包可在清單中點「↻」熱重載；清單是否顯示此按鈕由包的 `hotReload` 設定決定（預設開啟）。

## 語言包

最簡單的形式是單個 JSON 文件，例如：

```json
{
  "code": "fr",
  "label": "Français",
  "hotReload": true,
  "translations": {
    "設定": "Paramètres",
    "新建": "Nouveau",
    "保存": "Enregistrer"
  }
}
```

`code` 使用語言標記；`translations` 的鍵是介面原始繁體中文文字，值為目標語言文字。沒有翻譯的文字會維持原文。動態內容可用 `{0}`、`{1}` 佔位，例如 `"多選 {0}": "{0} selected"`。也可以用 ZIP：根目錄放 `language.json`；或放 `package.json`（含 `code`、`label` 和可選的 `translationsFile`），另放 `translations.json`。整包包在一層資料夾內也可以。

內置英語與簡體中文的翻譯資料分別位於 `src/common/i18n/english.js` 和 `src/common/i18n/simplified.js`。

## 字體包

可直接加入 `.ttf`、`.otf`、`.woff` 或 `.woff2` 文件。多文件字體請製作 ZIP，將字體文件放入包內任意子目錄；可以加一份 `package.json` 指定顯示名稱與版本：

```json
{ "name": "My font", "version": "1.0.0", "hotReload": true }
```

多文件字體會按當前介面語言優先使用檔名帶 `zh_hant`、`zh_hans`、`ja` 或 `ko` 的文件，然後使用 `latin`，最後回退系統字體。建議依照內置 Fusion Pixel 的命名方式區分字形子集。

## Shape 包

Shape ZIP 的結構與 JS 定義見 [SHAPE_PACKS.md](SHAPE_PACKS.md)。管理視窗可安裝 ZIP；已有的資料夾包仍會從 `shapepacks/` 讀取。Shape 包會執行 JavaScript，請只安裝可信包。
