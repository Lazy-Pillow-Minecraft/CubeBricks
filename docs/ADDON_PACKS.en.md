# Add-on Pack Index

[简体中文](ADDON_PACKS.md) · [README](../README.md) · [Architecture](../ARCHITECTURE.en.md)

The pack manager is under **Settings → General → Manage Resource Packs**. Shape, language, and font packs share its window but live in separate workspace folders: `shapepacks/`, `languagepacks/`, and `fontpacks/`. The manager can add, reorder, remove, and hot-reload packs where the pack allows it. Removed files are retained under `removed-packs/`.

| What you want to author | Complete specification |
| --- | --- |
| Custom shapes: manifest, `shapes/*.js`, icons, `generate` API, `utils` | [Shape pack authoring](../SHAPE_PACKS.en.md) |
| Interface languages: `ui.*` translation IDs, JSON/ZIP layout | [Language packs](../RESOURCE_PACKS.en.md#language-packs) |
| Custom fonts: individual font files or a multi-file ZIP | [Font packs](../RESOURCE_PACKS.en.md#font-packs) |

Shape packs execute JavaScript inside the editor. A ZIP is a distribution container, not a sandbox; install only trusted code. Modifiers and operators have internal registries, but external packs for them are not supported yet.
