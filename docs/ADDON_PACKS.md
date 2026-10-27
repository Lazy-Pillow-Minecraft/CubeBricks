# 附加包索引 / Add-on Packs

[English](ADDON_PACKS.en.md) · [返回 README](../README.md) · [架构概述](../ARCHITECTURE.md)

CubeBricks 的资源包管理器位于「设置 → 一般 → 管理资源包」。Shape、语言与字体包共用管理窗口，但分别储存在工作空间的 `shapepacks/`、`languagepacks/`、`fontpacks/`。可在窗口中加入、排序、移除和按包配置热重载；移除的文件暂存于 `removed-packs/`。

| 要编写的内容 | 完整规范 |
| --- | --- |
| 自定义 Shape：清单、`shapes/*.js`、图标、`generate` API、`utils` | [Shape 包编写规范](../SHAPE_PACKS.md) |
| 新界面语言：`ui.*` 翻译键、JSON/ZIP 结构 | [语言包规范](../RESOURCE_PACKS.md#语言包) |
| 自定义字体：单个字体或多文件 ZIP | [字体包规范](../RESOURCE_PACKS.md#字体包) |

Shape 包会在编辑器内执行 JavaScript。ZIP 只是封装，不是沙盒；只安装可信来源。修改器和操作器当前有内部注册表，但此处的外部包入口尚未开放，请不要把它们当作已支持的包类型。
