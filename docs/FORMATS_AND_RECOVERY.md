# 文件格式與工作記錄 / Formats and Recovery

[返回 README](../README.md) · [操作教程](USER_GUIDE.md) · [架構概述](../ARCHITECTURE.md)

## 模型與色卡格式

| 格式 | 用途 |
| --- | --- |
| `.cbmodel` | CubeBricks 的完整工程封存。保存模型、貼圖與可選的操作歷史；導出時可選擇只保留當前完整狀態。 |
| `.bbmodel` | 與 Blockbench 交換模型。Shape 和修改器在導出時展開為相容的 Cube／組；原本的程序化參數不會以原生 Shape 形式留在 `.bbmodel`。 |
| `.cbcmap` | 單張色卡的可攜式 JSON，包含顏色、漸變分段和色彩空間曲線，不包含本地名稱或 ID。 |

`.cbmodel` 的新封存會把操作 JSON 整合為 Brotli 壓縮資料塊，按內容去重圖片資料並驗證解封後的檔案；舊 ZIP 版本仍可讀取。桌面工作目錄另外保存項目範圍的操作序列和元素歷史；預設最多保留 200 個歷史操作，可按項目覆寫。導出時不保留歷史不會清空本地工作日誌。

## 開啟與恢復

打開已保存的項目時，程式依項目 UUID 與歷史比對同路徑工作副本。相符或同一歷史上的落後副本可重用；內容分歧時詢問另開或替換工作副本，不會直接無提示覆蓋來源。

若恢復提示項目狀態文件損壞且找不到上一個完成狀態，表示 `current_state` 和 `current_state.previous` 都不足以提供可靠恢復點；不代表已保存的 `.cbmodel` 或 `.bbmodel` 必然損壞。請先備份完整工作目錄，再嘗試正常打開已保存的工程。不要只刪除單個交易、元素或貼圖文件，因為它們可能仍被操作索引引用。重複點「恢復」不能保證找回未保存內容。

同一工作項目只允許一個程式窗口寫入。撤銷／重做只沿實際使用的歷史分支導航；若某一步快照缺失或損壞，會停在該邊界並保留當前模型，而不是用不完整資料覆寫現狀。

## English

`.cbmodel` is CubeBricks' project archive, optionally including history. `.bbmodel` is for Blockbench interchange and bakes procedural results into compatible groups and cubes. `.cbcmap` exports one palette without a local name or ID. The desktop working journal is separate from a saved archive. If recovery reports corrupt state without a completed predecessor, back up the whole working directory and try opening the last saved model; do not delete individual journal files in isolation.
