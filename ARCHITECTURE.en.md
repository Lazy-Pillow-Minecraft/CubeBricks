# CubeBricks Architecture

[简体中文](ARCHITECTURE.md) · [README](README.md) · [User guide](docs/USER_GUIDE.en.md) · [Add-on packs](docs/ADDON_PACKS.en.md)

`src/app.js` is the editor's assembly entry point. It creates controllers, injects dependencies, initializes services, and starts the app; new feature implementations should not be added there. State, tool definitions, tabs and documents, journals, docking, camera and reference images, inspectors, viewport gizmos, UV editing and preview, texture assets and atlases, palettes, 2D/3D painting, paint symmetry, knife, model capture, template generation, hierarchy rendering, drag handling, events, and element commands each live in modules with specific responsibilities.

## Directory ownership

| Location | Responsibility |
| --- | --- |
| `src/common/` | Cross-feature configuration, registries, format constraints, and shared mechanisms. |
| `src/screen/` | Docking, reference images, lists, color picker, palettes, and other visible UI behavior. |
| `src/project/` | Project tabs, session switching, history, and journal coordination. |
| `src/utils/` | Math, shared Shape geometry, and packing algorithms that do not read the DOM or project state. `index.js` exposes the public API to external Shape packs. |
| `src/editor/` | Shared editor state, tool registration, knife, and modeling interactions. |
| `src/paint/` | Strokes, selection, paint symmetry relations, and other painting-domain logic. |
| `src/texture/` | Texture generation, layers, and pixel processing. |
| `src/render/` | WebGL scene, previews, and rendering resources. |
| `src/shapes/` | Shape registry and individual Shape generators. |
| `src/model.js` | Current model data and Blockbench interchange; independent data algorithms are gradually moving to `src/model/`. |
| `electron/` | Desktop process, files, and project journal; it does not directly depend on renderer DOM. |
| `scripts/` | Checks, tests, preview server, and build helpers. |

## Conventions for new code

1. Choose `common`, `screen`, `utils`, or the relevant domain directory before adding a module. Avoid vague `misc.js` files. Put only genuinely cross-feature pure calculations in `utils/`.
2. The dependency direction is `utils/common/model → feature modules and screen → app.js`. Feature modules must not import `app.js` in reverse. Inject explicit callbacks at the entry point when a UI controller needs editor operations.
3. Keep mutable feature-specific state inside its controller and expose only necessary accessors. Shared editor state belongs in `src/editor/state.js`; do not create a second copy.
4. Separate data calculations from UI event wiring and test pure calculations directly. Project-affecting actions still need registered operation IDs and journal coverage.
5. New `.js`, `.mjs`, or `.cjs` files do not require a manually maintained check list: `npm run check` scans `src/`, `electron/`, and `scripts/` recursively. Add feature tests to the appropriate `test:*` script.

## Entry-point boundary

`app.js` retains a few forwarding functions to handle initialization order and callback cycles. Implementations should not flow back into the entry point. When moving code, preserve operation IDs and import/export and journal test coverage. The operation-ID audit scans all of `src/`, so moving a feature out of the entry point does not hide it from the audit.

## Texture templates and layers

`src/texture/template-controller.js` gathers cube faces, packs new UVs, draws the template, and updates face assignments. It should not reimplement layer compositing. With layer preservation enabled, it copies the source layer/group tree, remaps image-layer pixels, and redirects mask UIDs to the new layer IDs. Final compositing still uses the layer pipeline in `src/common/core/texture-features.js`. With preservation off, the original flattened-template path remains available. `src/texture/asset-controller.js` owns loading, activation, and preview refresh for texture assets.
