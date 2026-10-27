# 功能概覽 / Features

[返回 README](../README.md) · [操作教程](USER_GUIDE.md) · [文件格式與恢復](FORMATS_AND_RECOVERY.md)

CubeBricks 仍在原型開發階段。以下列出目前的主要工作流與邊界，而不是更新日誌；尚未完成的功能會明確標示。

## 建模與場景

- 以 Cube 為基礎幾何，支援組、Locator、節點、二維／三維 Bezier 曲線，以及多邊形柱體、正十二面體、足球形截角二十面體等程序化 Shape。Shape 可保留參數並覆寫其生成 Cube 的細分內容。
- 場景層級支援多選、範圍選擇、搜索、分組、拖動排序與快速定位。可見性、鎖定、自動 UV、UV 歸一化及導出標記可在詳細列表管理。
- 移動、縮放、旋轉、樞軸移動、頂點捕捉、交點顯示、刀具與面選擇分別處理幾何交互。移動和旋轉可選自身、父級或全局參考；樞軸移動會補償幾何位置。
- 組與元素可各自掛載修改器；內置對稱支援 XYZ、徑向與曼陀羅，可重複掛載、預覽和逐個烘焙。程序化結果在 `.bbmodel` 導出時展開為相容的 Cube／組。
- 即時操作器與修改器分開；目前的繪畫對稱操作器關聯可匹配的面及其 UV 邊長，不生成額外場景元素。

## 視圖與工作區

- 提供透視、正交和獨立的六向軸視圖；軸視圖僅正交，攝像機可平移、環繞、縮放及緩動聚焦。
- 線框、體塊、紋理和法向顯示模式可切換。網格、手柄、線框與模型表面各有適合自身的渲染處理。
- 主視圖支援參考圖、玩家視覺參考、模型透明背景截圖，以及鎖定物件和修改器結果的獨立虛化顯示。
- 多項目頁籤和左、右、底部可停靠面板可拆出、吸附、合併為多頁籤部件、折疊與調整尺寸。

## UV、貼圖與圖層

- Cube 可使用逐面或箱型 UV；逐面模式下各面可獨立選貼圖、旋轉、鏡像、剔除及編輯 UV。貼圖可設為普通、平鋪或動畫模式；動畫目前仍是佔位。
- 圖層支援圖片層與組、排序、可見性、透明度、混合模式、色階映射及獨立蒙版來源。圖層編輯子窗口可查看完整貼圖和選中圖層。
- 新建貼圖可選紋理模板、純色模板或空白貼圖。模板按工程基礎吸附分辨率分配 UV，非零邊至少 1px，可清理零面積面、選擇箱型 UV、留間隔並按 2 冪或指定倍數裁切畫布。
- 紋理模板的「保留圖層結構」預設開啟：依新 UV 重排各來源圖層像素，保留組、順序、可見性、混合設定及遮罩關聯；多來源貼圖會分別成組。關閉時沿用合成單張貼圖的流程。箱型 UV 在允許逐面 UV 的格式中預設關閉；格式強制箱型時仍遵循格式限制。
- 左側貼圖視圖可多選面、移動和拉伸 UV；UV 預覽顯示選中內容、面向區分、旋轉與鏡像標記。

## 繪畫與色彩

- 在二維貼圖或三維模型面上繪畫，包含畫筆、圖形繪製、油漆桶、漸變及取色器。畫筆支援方形／圓形筆尖、AA、透明度、跨面連續筆畫與筆刷深度；未分配貼圖的面不會自動取得貼圖。
- 繪畫選區可使用矩形、塗抹或自由圈選；Shift 追加、Ctrl 擦除。選區可限制繪畫，並在二維貼圖內移動、複製或旋轉像素。
- 色卡支援離散色、漸變及三維色彩空間曲線，並可單張導入／導出 `.cbcmap`。選色器提供方形、圓形與三角形 HSV 介面。
- 繪畫模式的場景層級保留查找、選取、聚焦與可見／鎖定切換，但不修改模型幾何；幾何編輯須回到編輯模式。

## 工程與擴展

- `.cbmodel` 保存模型、貼圖和操作歷史；`.bbmodel` 用於 Blockbench 交換。工作目錄保存可恢復的操作日誌，導出可選擇是否包含歷史。
- 模型格式由註冊表定義。Java 方塊／物品有三種版本旋轉規則；模組版實體限制為箱型 UV、整數 Cube 尺寸及組旋轉。
- 外部 [Shape 包](../SHAPE_PACKS.md)、[語言／字體包](../RESOURCE_PACKS.md) 可從資源包管理器載入；未開放外部修改器或操作器包。

## English overview

CubeBricks is a prototype desktop Minecraft-model editor with cubes, procedural shapes, Bezier curves, hierarchy editing, modifiers, paint operators, UV editing, layered textures, painting, palettes, and Blockbench interchange. Texture-template generation can optionally preserve source layer trees while remapping each layer into the new UV atlas; this is enabled by default. Some areas, including animated textures, remain placeholders. See the [user guide](USER_GUIDE.md), [architecture](../ARCHITECTURE.md), and [pack documentation](ADDON_PACKS.md) for the relevant workflows and extension boundaries.
