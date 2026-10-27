# CubeBricks 資源包

[返回 README](README.md) · [附加包索引](docs/ADDON_PACKS.md) · [Shape 包編寫規範](SHAPE_PACKS.md)

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
    "ui.settings": "Paramètres",
    "ui.new": "Nouveau",
    "ui.save": "Enregistrer",
    "ui.preparing-facecount": "Préparation de {0} faces…"
  }
}
```

`code` 使用語言標記；`translations` 的鍵使用穩定的 `ui.*` 語意 ID，不再以繁體中文字面作為翻譯鍵。可用的 ID、繁中原文及內置譯文列於 `src/common/config/ui-text-catalog.json`。沒有翻譯的文字會回退繁中；動態詞條的譯文可使用 `{0}`、`{1}` 佔位，例如上面的面數。舊版以繁中原文為鍵的語言包仍可讀取，但新包請只使用 ID。也可以用 ZIP：根目錄放 `language.json`；或放 `package.json`（含 `code`、`label` 和可選的 `translationsFile`），另放 `translations.json`。整包包在一層資料夾內也可以。

內置詞條由 `node scripts/extract-ui-text.mjs` 整理為 `src/common/i18n/messages.js`，其 ID 一經分配便保持不變；`english.js` 與 `simplified.js` 另處理執行期組合文字的後備翻譯。程式新增文案可使用 `translateUiKey('ui.settings')` 按 ID 取得譯文。

## 字體包

可直接加入 `.ttf`、`.otf`、`.woff` 或 `.woff2` 文件。多文件字體請製作 ZIP，將字體文件放入包內任意子目錄；可以加一份 `package.json` 指定顯示名稱與版本：

```json
{ "name": "My font", "version": "1.0.0", "hotReload": true }
```

多文件字體會按當前介面語言優先使用檔名帶 `zh_hant`、`zh_hans`、`ja` 或 `ko` 的文件，然後使用 `latin`，最後回退系統字體。建議依照內置 Fusion Pixel 的命名方式區分字形子集。

## Shape 包

Shape ZIP 的結構與 JS 定義見 [SHAPE_PACKS.md](SHAPE_PACKS.md)。管理視窗可安裝 ZIP；已有的資料夾包仍會從 `shapepacks/` 讀取。Shape 包會執行 JavaScript，請只安裝可信包。
