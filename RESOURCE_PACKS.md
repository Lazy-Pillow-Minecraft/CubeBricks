# CubeBricks 资源包

[English](RESOURCE_PACKS.en.md) · [返回 README](README.md) · [附加包索引](docs/ADDON_PACKS.md) · [Shape 包编写规范](SHAPE_PACKS.md)

桌面版在「设置 → 一般 → 管理资源包」加入、移除、排序与重新加载资源包。「打开文件夹」会打开当前类别对应的工作空间目录。界面字体在「设置 → 外观」选择，界面语言在「设置 → 一般」选择。系统字体与三种内置语言无需安装。

三类包共用管理窗口，但各自存于工作空间的 `shapepacks/`、`languagepacks/`、`fontpacks/`。移除时包会被移到 `removed-packs/`，可手动移回。排序决定同类包的加载顺序；语言代码重复时，靠前的包先注册。包可在清单中点「↻」热重载；清单是否显示此按钮由包的 `hotReload` 设置决定（默认开启）。

## 语言包

最简单的形式是单个 JSON 文件，例如：

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

`code` 使用语言标记；`translations` 的键使用稳定的 `ui.*` 语义 ID，不再以界面原文作为翻译键。可用的 ID、原文及内置译文列于 `src/common/config/ui-text-catalog.json`。没有翻译的文字会回退到内置原文；动态词条的译文可使用 `{0}`、`{1}` 占位，例如上面的面数。旧版以界面原文为键的语言包仍可读取，但新包请只使用 ID。也可以用 ZIP：根目录放 `language.json`；或放 `package.json`（含 `code`、`label` 和可选的 `translationsFile`），另放 `translations.json`。整包包在一层文件夹内也可以。

内置词条由 `node scripts/extract-ui-text.mjs` 整理为 `src/common/i18n/messages.js`，其 ID 一经分配便保持不变；`english.js` 与 `simplified.js` 另处理运行时组合文字的后备翻译。程序新增文案可使用 `translateUiKey('ui.settings')` 按 ID 获取译文。

## 字体包

Fusion Pixel 已拆成独立的 [Fusion-Pixel-12px.zip](packs/Fusion-Pixel-12px.zip)，不再放进软件安装包。要试用它，在资源包管理器切到「字体包」，点「加入包」选择该 ZIP，然后在「设置 → 外观 → 界面字体」选择 Fusion Pixel 12px。也可以点「打开文件夹」把 ZIP 放进 `fontpacks/`，再点「重新整理」。旧版曾选用内置像素字体的设置，在检测到这个包时会自动转为该包；未安装时使用系统字体。

可直接加入 `.ttf`、`.otf`、`.woff` 或 `.woff2` 文件。多文件字体请制作 ZIP，将字体文件放入包内任意子目录；可以加一份 `package.json` 指定显示名称与版本：

```json
{ "name": "My font", "version": "1.0.0", "hotReload": true }
```

多文件字体会按当前界面语言优先使用文件名带 `zh_hant`、`zh_hans`、`ja` 或 `ko` 的文件，然后使用 `latin`，最后回退系统字体。可参照 Fusion Pixel 字体包的命名方式区分字形子集。

## Shape 包

Shape ZIP 的结构与 JS 定义见 [SHAPE_PACKS.md](SHAPE_PACKS.md)。管理窗口可安装 ZIP；已有的文件夹包仍会从 `shapepacks/` 读取。Shape 包会执行 JavaScript，请只安装可信包。
