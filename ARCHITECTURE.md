# CubeBricks 程序结构

[English](ARCHITECTURE.en.md) · [返回 README](README.md) · [操作教程](docs/USER_GUIDE.md) · [附加包索引](docs/ADDON_PACKS.md)

`src/app.js` 是编辑器的组装入口，只负责建立控制器、接入依赖、初始化与启动。状态、工具表、工程分页／文件与日志、停靠、摄像机与参考图、对象属性、主视图手柄与变换交互、UV 编辑与预览、贴图管理与图集、色卡与选色器、三维／二维绘画、绘画对称、刀具、模型截图、纹理模板生成，以及场景层级的渲染、拖动、事件和元素命令，均按职责放入独立模块。新增功能不要写进入口。

## 目录职责

| 位置 | 放置内容 |
| --- | --- |
| `src/common/` | 跨功能的配置定义、注册表、格式约束与既有通用机制。 |
| `src/screen/` | 停靠、参考图、列表、选色器和色卡等可见画面及交互。 |
| `src/project/` | 工程分页、工作阶段切换、历史记录与日志协调。 |
| `src/utils/` | 不读取 DOM 或项目状态的数学、Shape 共用几何与排版算法；`index.js` 统一向外部 Shape Pack 暴露公共工具。 |
| `src/editor/` | 编辑器共享状态、工具注册与刀具等建模交互。 |
| `src/paint/` | 笔画、对称关联等绘画领域逻辑。 |
| `src/texture/` | 贴图生成、图层与像素处理。 |
| `src/render/` | WebGL 场景、预览与渲染资源。 |
| `src/shapes/` | Shape 注册与各 Shape 的生成实现。 |
| `src/model.js` | 当前模型数据与 Blockbench 交换逻辑；新增的独立数据算法逐步迁往 `src/model/`。 |
| `electron/` | 桌面程序、文件和工程日志；不直接依赖渲染器 DOM。 |
| `scripts/` | 检查、测试、预览和打包工具。 |

## 新代码约定

1. 先按层分到 `common`、`screen`、`utils` 或领域目录，再按功能归档；不要建立含糊的 `misc.js`。只有真正跨功能的纯计算才进 `utils/`。
2. 依赖方向为 `utils/common/model → 功能模块与 screen → app.js`。功能模块不可反向导入 `app.js`。界面控制器需要编辑器操作时，由入口注入明确的回调。
3. 可变的功能内部状态留在控制器内，仅暴露必要读写界面。共享编辑状态放 `src/editor/state.js`，不要复制第二份。
4. 数据计算与画面事件分开；纯计算函数写直接测试。对工程有影响的操作仍须登记操作 ID，并保持日志测试覆盖。
5. 新增 `.js`、`.mjs` 或 `.cjs` 无须手改检查清单：`npm run check` 会递归检查 `src/`、`electron/` 和 `scripts/`。功能测试则加入相应的 `test:*` 指令。

## 入口边界

`app.js` 保留少量转发函数，以处理各控制器间的初始化顺序与回调循环；具体操作实现不应回流入口。移动功能时应保持操作 ID、日志与导入／导出测试覆盖。操作 ID 测试会递归扫描整个 `src/`，新模块不会因离开入口而漏出记录审核。

## 贴图模板与图层边界

`src/texture/template-controller.js` 负责收集 Cube 面、打包新 UV、绘制模板与更新面指派；它不应直接实现图层合成规则。勾选保留图层时，来源图层及组的结构会复制到新贴图，图片层的像素逐层重排，遮罩 UID 改指向新层；最终合成仍使用 `src/common/core/texture-features.js` 的图层管线。关闭时使用原本的合成单张模板流程。图层资产的加载、启用与预览刷新则由 `src/texture/asset-controller.js` 负责。
