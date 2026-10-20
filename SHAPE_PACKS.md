# CubeBricks Shape 包編寫規範

桌面版會讀取「設定 → 工作空間目錄」下的 `shapepacks/`。一個包可以是資料夾，或是同樣結構的 `.zip`；ZIP 可直接以 `package.json` 為根，也可多包一層總資料夾。包顯示名取最外層資料夾／ZIP 的檔名，而不是 `package.json` 裡的名稱。新增、移除或更新包後重新啟動程式；切換工作空間目錄也會重新載入。

```text
<工作空間>/
  projects/                 新項目的展開式操作記錄
  shapepacks/
    MyShapes/               包名為 MyShapes
      package.json
      shapes/
        arch.js
        arch.svg             可選；沒有時使用內建 Shape 圖標
    AnotherPack.zip
```

`package.json` 是包清單，`version` 保存包版本，`shapes` 逐一指出腳本和圖標。不同包的 Shape ID 仍須全局唯一，不能佔用內建 ID。

```json
{
  "version": "1.0.0",
  "shapes": [
    { "id": "sample_arch", "label": "拱門", "file": "arch.js", "icon": "arch.svg" }
  ]
}
```

`file` 和 `icon` 只能是 `shapes/` 內的單一文件名。圖標可用 SVG、PNG 或 WebP；省略 `icon` 時使用內建 Shape 通用圖標。包內 JS 必須是自包含的 ES module，使用 `export default`，目前不支援相對 `import`。每個腳本不超過 128 KiB、整個 ZIP 不超過 16 MiB；單次生成最多 10,000 個 Cube。

```js
export default {
  id: 'sample_arch',                 // 必須和 package.json 一致；存進工程的永久類型 ID
  label: '拱門',                      // 包清單中的 label 用於界面顯示
  defaults: { width: 8, height: 8 }, // 新 Shape 的初始 parameters
  fields: [
    { key: 'width', label: '寬度', min: 0.1, step: 0.1 },
    { key: 'height', label: '高度', min: 0.1, step: 0.1 }
  ],
  generate(shape, { Cube }) {
    const width = Number(shape.parameters.width);
    const height = Number(shape.parameters.height);
    return [new Cube({
      name: `${shape.name}_1`,
      position: [-width / 2, 0, -0.5],
      size: [width, height, 1],
      pivot: [0, height / 2, 0],
      rotation: [0, 0, 0],
      uvMode: shape.uvMode,
      uvNormalized: shape.uvNormalized,
      autoUv: shape.autoUv,
      exported: shape.exported,
      locked: shape.locked,
      shade: shape.shade,
      color: shape.color
    })];
  }
};
```

`generate(shape, api)` 必須同步返回 Cube 陣列；也可返回傳入 `new Cube(...)` 的普通資料物件。生成的 Cube 使用 Shape 的局部座標，編輯器在後續統一套用 Shape 自身的 `origin`、`pivot`、`rotation`、父組變換、細分覆寫與修改器。不要在 `generate` 內自行重複加上 `origin`。`shape.parameters` 保存可編輯參數；目前通用屬性面板自動呈現 `fields` 中的數值欄位。參數、細分覆寫及 Shape ID 隨 `.cbmodel` 保存；未安裝對應包時保留資料但不生成幾何，重新安裝後恢復。

內建 Shape 也按同一註冊介面拆分在 `src/shapes/`；多邊形、正十二面體、足球和兩種貝塞爾各有自己的定義文件，共用幾何計算放在 `polyhedron-geometry.js` 與 `bezier-geometry.js`。

## 安全提示

Shape 腳本會在編輯器進程執行，等同安裝程式擴充。只把自己編寫或信任來源的包放進 `shapepacks/`；ZIP 格式只是分發封裝，不是安全沙盒。載入錯誤會顯示提示並記錄在主控台，不會刪除工程中的 Shape 資料。
