# CubeBricks 0.1.3-beta

[简体中文](RELEASE_0.1.3-beta.md) · [README](../README.md) · [Previous release](RELEASE_0.1.2-beta.en.md)

## Improvements

- **Viewport performance:** Reduced repeated calculations and UI updates during camera drags. Gizmo SVGs reuse existing nodes. CPU, GPU, input, and main-thread timings help investigate remaining intermittent stalls.
- **Background journals and undo:** Project snapshots, journal reads and writes, history navigation, and archiving now run in a dedicated worker. Recent-history restoration and local model refreshes are optimized while preserving operation order, validation, and crash recovery.
- **Texture restoration:** Fixed restoration validation failures involving layer state and equivalent PNG encodings. Geometry undo retains existing textures, and texture restoration keeps the existing atlas available to reduce blank frames and flicker.
- **Painting and layers:** Improved live 2D/3D stroke feedback and regional layer compositing. Ctrl enables screen-space painting, with improved face-edge coverage. Layers have Merge Down and Delete context-menu actions, creation controls stay visible, and palettes can be renamed from their context menu.
- **Texture templates:** Fixed cases where **Do Not Share UVs** still reused a slot. The option defaults to on; disabling it still allows matching faces to reuse slots across cubes.
- **Code and documentation:** Clarified geometry-helper dependency boundaries, added circular-module checks, and updated the Simplified Chinese and English guides.

## Validation scope

Source and module-graph checks, 62 journal/undo tests, and model, module, and rendering tests passed. Packaged-content and isolated-startup checks also passed. Automated camera benchmarks did not reproduce the fixed half-second stall, but internally injected input does not cover the full physical-mouse path and cannot establish that the symptom is resolved on every device.

## Upload note

CubeBricks 0.1.3-beta focuses on viewport, painting, and undo responsiveness. Project journals run in a dedicated worker, and gizmos reuse existing nodes to reduce interference from background saves and UI rebuilding. This release fixes several texture-restoration validation failures and undo flicker, improves live stroke feedback and regional layer compositing, and strengthens Ctrl screen-space painting and face-edge coverage. It also adds layer Merge Down/Delete actions, fixed creation controls, palette renaming, and a fix for exclusive UV allocation in texture templates. Chinese and English documentation has been updated.

Windows installer: `CubeBricks-v0.1.3-beta-win-x64-setup.exe`.
