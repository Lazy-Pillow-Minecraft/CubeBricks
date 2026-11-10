# CubeBricks Architecture

[简体中文](ARCHITECTURE.md) · [README](README.md) · [User guide](docs/USER_GUIDE.en.md) · [Add-on packs](docs/ADDON_PACKS.en.md)

The [pre-animation structure and performance audit (2026-11-05, Chinese)](docs/PRE_ANIMATION_AUDIT_2026-11-05.md) records measured bottlenecks, resource lifetime issues, and the recommended work before adding animation.

The [first optimization results (2026-11-06)](docs/OPTIMIZATION_2026-11-06.en.md) cover indexed sorting, group previews, modifier reuse, recent undo, resource cleanup, and their validation boundaries.

`src/app.js` is the editor's assembly entry point. It creates controllers, injects dependencies, initializes services, and starts the app; new feature implementations should not be added there. State, tool definitions, tabs and documents, journals, docking, camera and reference images, inspectors, viewport gizmos, UV editing and preview, texture assets and atlases, palettes, 2D/3D painting, paint symmetry, knife, model capture, template generation, hierarchy rendering, drag handling, events, and element commands each live in modules with specific responsibilities.

## Directory ownership

| Location | Responsibility |
| --- | --- |
| `src/common/` | Cross-feature configuration, registries, format constraints, and shared mechanisms. |
| `src/screen/` | Docking, reference images, lists, color picker, palettes, and other visible UI behavior. |
| `src/project/` | Project tabs, session switching, history, and journal coordination. |
| `src/utils/` | Math, shared Shape geometry, packing, and performance tools. `dom/` contains UI helpers without project-state dependencies. `index.js` exposes public calculation tools to external Shape packs. |
| `src/editor/` | Shared editor state, tool registration, knife, and modeling interactions. |
| `src/paint/` | Strokes, selection, paint symmetry relations, and other painting-domain logic. |
| `src/texture/` | Texture generation, layers, and pixel processing. |
| `src/render/` | WebGL scene, previews, and rendering resources. |
| `src/shapes/` | Shape registry and individual Shape generators. |
| `src/model.js` | Current model data and Blockbench interchange; independent data algorithms are gradually moving to `src/model/`. |
| `electron/` | Desktop process, files, and project journal; it does not directly depend on renderer DOM. |
| `scripts/` | Checks, tests, preview server, and build helpers. |

## Conventions for new code

`common/core/format-hooks.js` supplies the empty default format interface shared by Shape and modifier definitions, plus bound object context, without importing registries or model code. `procedural-format.js` adapts Shape parameters and generated Cubes; `modifier-format.js` constrains modifiers using preceding results. Preview evaluates derived data and preserves live face identities when consuming quarter turns. `model/format-materialization.js` represents modded entity orientations with group rotations, while `model/formats/procedural-format-export.js` materializes Java group poses as legal Cube data. Subdivision edits compare against the adapted base, avoiding accidental storage of format compensation as user edits. See [optional format adaptation](SHAPE_PACKS.en.md#optional-format-adaptation).

1. Choose `common`, `screen`, `utils`, or the relevant domain directory before adding a module. Avoid vague `misc.js` files. Keep shared calculations and DOM helpers in separate directories; DOM helpers must not read editor project state.
2. The dependency direction is `utils/common/model → feature modules and screen → app.js`. Feature modules must not import `app.js` in reverse. Inject explicit callbacks at the entry point when a UI controller needs editor operations.
3. Keep mutable feature-specific state inside its controller and expose only necessary accessors. Shared editor state belongs in `src/editor/state.js`; do not create a second copy.
4. Separate data calculations from UI event wiring and test pure calculations directly. Project-affecting actions still need registered operation IDs and journal coverage.
5. New `.js`, `.mjs`, or `.cjs` files do not require a manually maintained check list: `npm run check` scans `src/`, `electron/`, and `scripts/` recursively. Add feature tests to the appropriate `test:*` script.

## Entry-point boundary

`model/formats/` separates Java JSON, Bedrock geometry, and integrity-checked Java model layers. Format definitions declare native export through `nativeExport`. `project/export-dialog.js` selects output and `native-export-controller.js` orchestrates textures before model files. Desktop paths and image writes live in `electron/native-model-io.cjs` and `texture-files.cjs`. `texture/save-state.js` refreshes only for changed content; a dedicated worker serializes pixel checks, avoiding false positives from PNG re-encoding and image work during camera drags.

`texture/export-bake.js` processes the existing geometry bake result. `export-plan.js` resolves references, shares periodic tiled regions, computes frame-count LCMs, and packs atlases or box nets; `export-raster.js` composites private snapshots and bakes pixels; `export-progress.js` owns the delayed progress dialog. Format definitions declare merging through `singleTexture`. Export does not depend on frame selection, the global layer raster cache, or editable canvases, and never writes baked results into the source project.

`app.js` retains a few forwarding functions to handle initialization order and callback cycles. Implementations should not flow back into the entry point. When moving code, preserve operation IDs and import/export and journal test coverage. The operation-ID audit scans all of `src/`, so moving a feature out of the entry point does not hide it from the audit.

## Texture templates and layers

`src/texture/template-controller.js` gathers cube faces, packs new UVs, draws the template, and updates face assignments. It should not reimplement layer compositing. With layer preservation enabled, it copies the source layer/group tree, remaps image-layer pixels, and redirects mask UIDs to the new layer IDs. Final compositing still uses the layer pipeline in `src/common/core/texture-features.js`. With preservation off, the original flattened-template path remains available. `src/texture/asset-controller.js` owns loading, activation, and preview refresh for texture assets.

`src/texture/frame-elements.js` manages independent frames; `layerUids`, `visibility`, and `paintLayerUid` within `animation.frames` store links, frame-local visibility, and paint targets. `frame-links.js` resolves root/group membership. Separate controllers own lists, connections, and playback. Playback position is runtime state; FPS and interpolation are texture settings. Display composition caches at most four frames and reuses dirty-region updates, blending precomposited images for interpolation without rewriting original pixels or mask sources. `src/paint/eyedropper.js` shares unlit sampling, with 3D rays continuing past fully transparent hits.

## Journal worker and viewport updates

`electron/main.cjs` owns windows, project ownership, and per-project operation queues. `journal-service.cjs` forwards journal calls to `journal-worker.cjs`; snapshots, file operations, undo, and archiving retain the implementation in `project-journal.cjs`. Completion or failure returns updated state and errors. Background execution preserves confirmation order, atomic writes, and recovery checks.

`project-retention.cjs` atomically stores durable retention in the working folder's `workspace_state`, independently of edit history and excluded from exports. Main-process automatic-discard paths recheck this flag; missing or damaged metadata defaults to retention. Home and model tabs have distinct types; home tabs create no journal and capture no model session.

`project_settings` stores the project history limit and is included in both archive modes. Project Information separates model changes from retention settings. The latter use a dedicated settings API on the existing project write queue, without adding transactions or clearing redo. History comparisons ignore the limit in older snapshots, and model restoration preserves the current setting.

`electron/history-marks.cjs` validates and atomically saves node marks through the existing project write queue. Frontend `history-mark-shapes.js` shares geometric paths; `history-mark-editor.js` manages the form and reuses the color picker. Inverse view scaling keeps marks and labels at fixed screen sizes, and labels render as literal user text. History focus shortcuts apply only to the topmost history dialog, and animation scheduling stops when focus settles.

`journal-import.cjs` stages large archives: current transactions, element snapshots, textures, and required counters come first; remaining immutable history is written in the background. Undo can read pending records directly. A durable archive copy and recovery marker allow interrupted imports to resume, and are removed when finished. Closing and exporting wait for required writes; history pruning is deferred while an import remains active.

`archive-index.cjs` reads and validates only the CBM2 blocks, files, and images currently needed, with a bounded decompressed-block cache. New archives group the current snapshot before historical files, avoiding full-history decompression before displaying the model. File contents and integrity checks remain unchanged.

`journal-history.cjs` reads the full history forest and handles chronological capping plus single-node/subtree deletion. `journal-history-storage.cjs` handles routes between roots and content-addressed texture baselines. Recovery data is prepared before committing the removal index; loading also normalizes parent pointers whose physical cleanup was interrupted. `src/project/history-layout.js` iteratively allocates circular sectors by terminal count and evenly spaces nodes within each straight segment. `history-dialog.js` redraws only when history changes, sizes ordinary dots at twice the screen-space line width, uses a spatial hit index built from final positions, and connects detached roots to a virtual center with dashed lines.

Gizmos use `src/utils/dom/svg-markup.js` to retain SVG nodes and update coordinates and paths, rebuilding only when topology changes. `src/utils/performance-monitor.js` provides short captures, and `electron/main-performance.cjs` records main-thread delays and active operations. `scripts/profile-viewport-input.cjs` runs automated benchmarks using temporary projects. Detailed measurements are in the [performance investigation record](docs/CODE_AUDIT_2026-11-01.md), currently in Chinese.
