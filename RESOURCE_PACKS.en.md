# CubeBricks Resource Packs

[简体中文](RESOURCE_PACKS.md) · [README](README.md) · [Add-on pack index](docs/ADDON_PACKS.en.md) · [Shape pack authoring](SHAPE_PACKS.en.md)

The desktop app manages packs under **Settings → General → Manage Resource Packs**. Choose the interface language under Settings → General and the font under Settings → Appearance. The built-in Fusion Pixel font, system fonts, and three built-in languages need no installation.

Shape, language, and font packs share a management window but live in separate workspace folders: `shapepacks/`, `languagepacks/`, and `fontpacks/`. Removing a pack moves its files to `removed-packs/`, from which they can be restored manually. Ordering controls load priority within a pack category; if language codes conflict, the higher-priority pack registers first. Packs may show a hot-reload `↻` button. Their `hotReload` setting controls whether it appears, defaulting to enabled.

## Language packs

The simplest pack is one JSON file:

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

`code` is a language tag. Translation keys use stable semantic `ui.*` IDs, not UI source strings. The available IDs, source strings, and built-in translations are listed in `src/common/config/ui-text-catalog.json`. Missing translations fall back to the built-in source text. Dynamic entries may contain `{0}`, `{1}`, and so on, as in the face-count example. Older packs keyed by source strings remain readable, but new packs should use IDs only.

ZIP language packs are also accepted. Put `language.json` at the root, or use `package.json` with `code`, `label`, and optional `translationsFile`, plus a `translations.json` file. One enclosing folder inside the ZIP is allowed.

Built-in strings are assembled by `node scripts/extract-ui-text.mjs` into `src/common/i18n/messages.js`. Once assigned, their IDs remain stable. `english.js` and `simplified.js` also handle fallback translation for dynamically assembled text. New UI copy can call `translateUiKey('ui.settings')` by ID.

## Font packs

Individual `.ttf`, `.otf`, `.woff`, or `.woff2` files can be installed directly. For multi-file fonts, place font files anywhere inside a ZIP. You may add `package.json` to specify the displayed name and version:

```json
{ "name": "My font", "version": "1.0.0", "hotReload": true }
```

For multi-file fonts, the app prefers filenames carrying `zh_hant`, `zh_hans`, `ja`, or `ko` for the active interface language, then uses a `latin` file and finally falls back to system fonts. The built-in Fusion Pixel naming scheme is a useful reference for separate glyph subsets.

## Shape packs

See [Shape pack authoring](SHAPE_PACKS.en.md) for ZIP layout and JavaScript definitions. The manager can install ZIPs; existing folder packs are still read from `shapepacks/`. Shape packs execute JavaScript, so install only trusted code.
