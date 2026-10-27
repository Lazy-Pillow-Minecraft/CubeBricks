# CubeBricks Shape 包编写规范

[English](SHAPE_PACKS.en.md) · [返回 README](README.md) · [附加包索引](docs/ADDON_PACKS.md) · [架构概述](ARCHITECTURE.md)

桌面版会读取工作空间的 `shapepacks/`。一个包可以是文件夹，或是同样结构的 `.zip`；ZIP 可直接以 `package.json` 为根，也可多包一层总文件夹。包显示名取最外层文件夹／ZIP 的文件名，而不是 `package.json` 里的名称。可在「设置 → 一般 → 管理资源包」直接加入 ZIP、调整顺序、移除或热重载；文件夹包仍可手动放入目录后刷新。

```text
<工作空间>/
  projects/                 新项目的展开式操作记录
  shapepacks/
    MyShapes/               包名为 MyShapes
      package.json
      shapes/
        arch.js
        arch.svg             可选；没有时使用内置 Shape 图标
    AnotherPack.zip
```

`package.json` 是包配置清单，`version` 保存包版本，`shapes` 逐一指出脚本和图标。`hotReload: false` 可隐藏该包的热重载按钮；省略时默认允许。不同包的 Shape ID 仍须全局唯一，不能占用内置 ID。

```json
{
  "version": "1.0.0",
  "shapes": [
    { "id": "sample_arch", "label": "拱门", "file": "arch.js", "icon": "arch.svg" }
  ]
}
```

`file` 和 `icon` 只能是 `shapes/` 内的单一文件名。图标可用 SVG、PNG 或 WebP；省略 `icon` 时使用内置 Shape 通用图标。包内 JS 必须是自包含的 ES module，使用 `export default`，当前不支持相对 `import`；编辑器的共用工具通过 `generate` 的 `utils` 参数提供。每个脚本不超过 128 KiB、整个 ZIP 不超过 16 MiB；单次生成最多 10,000 个 Cube。

```js
export default {
  id: 'sample_arch',                 // 必须和 package.json 一致；存进工程的永久类型 ID
  label: '拱门',                      // 包清单中的 label 用于界面显示
  defaults: { width: 8, height: 8 }, // 新 Shape 的初始 parameters
  fields: [
    { key: 'width', label: '宽度', min: 0.1, step: 0.1 },
    { key: 'height', label: '高度', min: 0.1, step: 0.1 }
  ],
  generate(shape, { Cube, utils }) {
    const width = Number(shape.parameters.width);
    const height = Number(shape.parameters.height);
    const halfWidth = utils.math.vector3.dot3([width, 0, 0], [0.5, 0, 0]);
    return [new Cube({
      name: `${shape.name}_1`,
      position: [-halfWidth, 0, -0.5],
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

`generate(shape, api)` 必须同步返回 Cube 数组；也可返回传入 `new Cube(...)` 的普通数据对象。生成的 Cube 使用 Shape 的局部坐标，编辑器在后续统一套用 Shape 自身的 `origin`、`pivot`、`rotation`、父组变换、细分覆盖与修改器。不要在 `generate` 内自行重复加上 `origin`。`shape.parameters` 保存可编辑参数；当前通用属性面板自动呈现 `fields` 中的数值栏位。参数、细分覆盖及 Shape ID 随 `.cbmodel` 保存；未安装对应包时保留数据但不生成几何，重新安装后恢复。

`utils` 暴露当前 `src/utils/` 的全部公共模块：`utils.math.vector3`、`utils.math.rotation`、`utils.shape.polyhedronGeometry`、`utils.shape.bezierGeometry`、`utils.templatePacker`。使用命名空间可避免不同模块的同名函数冲突；新增公共工具时同步更新 `src/utils/index.js`。工具只提供计算，不会替包脚本绕过 Cube 数量和格式约束。

内置 Shape 也按同一注册界面拆分在 `src/shapes/`；多边形、正十二面体、足球和两种贝塞尔各有自己的定义文件，共用几何计算放在 `src/utils/shape/`。

## 安全提示

Shape 脚本会在编辑器进程执行，等同安装程序扩展。只把自己编写或信任来源的包放进 `shapepacks/`；ZIP 格式只是分发封装，不是安全沙盒。加载错误会显示提示并记录在控制台，不会删除工程中的 Shape 数据。
