# CubeBricks 0.1.4-beta

[简体中文](RELEASE_0.1.4-beta.md) · [README](../README.md) · [Previous release](RELEASE_0.1.3-beta.en.md)

## Changes

- **Tiling and UVs:** UV fields show origin and size. Tiled faces store offsets and full-face pixel dimensions separately, support seam painting, and retain normal UVs. Mode controls stay fixed and UV Preview focus can switch textures automatically.
- **Flipbooks:** The layer editor has an independent frame list, many-to-many curve links, per-frame visibility, and remembered paint targets. Each texture plays independently, with scrubbing, clickable frame ticks, interpolation, and sibling `.png.mcmeta` import.
- **Export baking:** `.bbmodel` bakes tiling and animation. Single-texture formats merge every image, cycle through the least common multiple of frame counts, use mean FPS, and disable interpolation. Multi-texture formats remain separate. Tiled regions overlap where possible and box-only formats retain fixed nets. Source projects remain editable and unchanged.
- **Projects and history:** Independent home tabs, persistent saved-project markers, confirmed project deletion, and progress for large project opens and background history loading. The radial history window supports marks, focusing, node/branch deletion, and oldest-first per-operation retention.
- **Texture stability:** Fixes pixel sharing between separate or copied textures, updates layer thumbnails during painting, and keeps the timeline below the list after the layer editor closes.

## Upload note

Source/dependency checks, model/render checks, and 79 history/undo checks passed. The packaged application passed isolated startup and 38 export pixel/metadata checks.

CubeBricks 0.1.4-beta completes the tiled and flipbook texture workflow with layer/frame links, independent playback, per-frame visibility, and animation metadata import. bbmodel export bakes full sequences, merges atlases for single-texture formats, and reuses overlapping tiled regions. Adds persistent project management and a marked radial history view, improves texture switching, copying, and live thumbnails, and updates the Simplified Chinese and English guides.

Windows installer: `CubeBricks-v0.1.4-beta-win-x64-setup.exe`.
