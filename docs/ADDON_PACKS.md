# 附加包索引 / Add-on Packs

[返回 README](../README.md) · [架構概述](../ARCHITECTURE.md)

CubeBricks 的資源包管理器位於「設定 → 一般 → 管理資源包」。Shape、語言與字體包共用管理窗口，但分別儲存在工作空間的 `shapepacks/`、`languagepacks/`、`fontpacks/`。可在窗口中加入、排序、移除和按包配置熱重載；移除的文件暫存於 `removed-packs/`。

| 要編寫的內容 | 完整規範 |
| --- | --- |
| 自訂 Shape：清單、`shapes/*.js`、圖標、`generate` API、`utils` | [Shape 包編寫規範](../SHAPE_PACKS.md) |
| 新介面語言：`ui.*` 翻譯鍵、JSON/ZIP 結構 | [語言包規範](../RESOURCE_PACKS.md#語言包) |
| 自訂字體：單個字體或多文件 ZIP | [字體包規範](../RESOURCE_PACKS.md#字體包) |

Shape 包會在編輯器內執行 JavaScript。ZIP 只是封裝，不是沙盒；只安裝可信來源。修改器和操作器目前有內部註冊表，但此處的外部包入口尚未開放，請不要把它們當作已支持的包類型。

## English

The pack manager lives under Settings → General. Shape, language, and font packs have separate workspace folders. Use the linked specifications above for package layout and APIs. Shape packs execute JavaScript inside the editor, so install only trusted code. External modifier/operator packs are not supported yet.
