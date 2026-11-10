# First optimization pass before animation development

[简体中文](OPTIMIZATION_2026-11-06.md) · [Architecture](../ARCHITECTURE.en.md) · [Original audit, Chinese](PRE_ANIMATION_AUDIT_2026-11-05.md)

This pass implements indexed transparency ordering, group drag previews, modifier evaluation reuse, recent model undo previews, layer-cache cleanup, and export readback reuse. Measurements use generated models and temporary profiles on this machine; they are not speed guarantees for every device.

## Measurements

| Workflow | Before | After | Scope |
| --- | ---: | ---: | --- |
| 1,000 translucent Cubes, camera movement | 18.1ms | 2.1ms | Median CPU submission |
| 5,000 translucent Cubes, camera movement | 88.6ms | 13.0ms | Median CPU submission; no vertex reuploads over 20 frames |
| 5,000 Cubes, eight-way symmetry with deduplication | 340.0ms | 189.5ms | Old/new model modules in the same Node process |
| 5,000 Cubes, eight-way symmetry without deduplication | 198.3ms | 87.7ms | Same comparison |
| 5,000 Cubes, dragging one ordinary group | 362ms | About 0.9–2.3ms | Geometry rebuild versus GPU preview submission; excludes release-time commit |
| 30 box UV nets sharing one 1024² image | 442ms | About 5–11ms | Export painting; 180 readbacks reduced to one |
| 100 layers, 256², complex local blending | 73.0ms | 46.4ms | Median cached 16×16 update |
| 20 layers, 1024², complex local blending | 15.4ms | 0.3ms | Same; first access still populates the cache |
| 1,000 Cubes, first visible undo | 6843ms | About 90–130ms | Includes UI updates while initial transactions remain queued |
| Closing a project with five 1024² image layers | Five retained | Zero retained | Global layer raster cache; at least 20MiB of RGBA storage released |

An eight-second camera test in the real application recorded 479 frame intervals with 1,000 Cubes: P99 17.2ms, maximum 21.8ms, and none above 40ms. Scene CPU work was 1.9ms at P99, with no application errors or main-process event-loop gaps.

## Implementation boundaries

### Rendering and group dragging

`render/ordered-face-mesh.js` retains transparent vertices and uploads reordered indices. It supports 16/32-bit indices and falls back to the previous path when a device cannot address a large mesh. Depth sorting reuses scratch entries; geometry invalidation releases old face references.

`editor/rigid-transform-preview.js` identifies groups that can reuse the existing GPU matrix preview. The document remains unchanged during dragging and commits once on release. Constrained Java/Bedrock block formats, geometry-producing modifiers, and transparent groups requiring global face order retain the evaluated path. This is not yet a multi-group animation pose system.

### Modifiers

Elements sharing a modifier stack reuse its composed transforms within one evaluation. `model/cube-overlap-index.js` buckets candidates by dimension signs and bounds, then compares complete unordered vertices for possible duplicates. Exact signed axis permutations can transform bounds directly; general rotations still inspect all eight corners.

Preview, Cube baking, and group baking share this index. Positive and negative geometry remain distinct, and identical bounds alone never authorize removal. Selection invalidation now also accounts for element-copy modifiers.

### Undo

`project/recent-model-history.js` caches nearby complete project states, covering models, UVs, Shapes, modifiers, painting, layers and texture properties. Non-element operations no longer clear the cache. Creating or reopening a project seeds its current state; a disk checkout also seeds the adjacent redo state.

Durable navigation remains ordered and verified, but local display does not wait for that queue. The window holds at most nine states (eight steps), shares unchanged nodes, layers and PNG strings, uses an estimated 64MiB memory budget, and respects project retention limits. A worker compares losslessly decoded PNG pixels, including hidden RGB under zero alpha, so encoding changes do not create phantom edits. Failed pixel proofs and unconverted Blob URLs use disk validation. Older states, history-tree navigation and pruning retain the validated path. New branches conservatively rebuild the window to avoid previewing a pruned parent. Editable objects receive isolated arrays.

In an isolated full-app test with durable commits deliberately blocked, local undo/redo took about 80/26ms for 1,000 Cubes and 60/24ms for layers. The persisted models and layers were checked after releasing the queue. These single-machine samples include UI updates and are not latency guarantees for other models.

Edits after a preview commit after the queued navigation on the correct branch. Validation or write failures preserve visible work and block subsequent writes. Saving and closing still await required durable operations. Atomic writes and recovery checks are unchanged; initial bulk filesystem writes themselves are not faster in this pass.

Pixel/layer navigation retains the model and GPU meshes. A bounded immutable image-source cache supplies fresh editable canvas copies. Cached backend texture states no longer replay deltas. Retention cleanup deletes known snapshots only after their last reference disappears, rather than accessing all surviving snapshots or recursively scanning the elements directory. New manifests also index deletion snapshots. Invalid parent links fail explicitly rather than looping.

### Textures and resource lifetime

`common/utils/layer-raster-regions.js` caches 64×64 source blocks for complex blending, with an 8MiB global RGBA limit. Painting invalidates intersecting blocks; replacement canvases have separate keys. Deleting layers/textures and closing projects release their data. Closing the last relevant project clears block caches. Late image decodes cannot repopulate a disposed project's cache, and further layer decoding stops.

The original Canvas blending and transparent-pixel rounding are retained. A faster CPU-compositing experiment changed some low-alpha channels by one value and was rejected.

`texture/export-bake.js` shares source pixels within each output frame. The benchmark's readback volume drops from 720MiB to 4MiB. Potentially changed canvases are not reused across frames; editable layers and playback state remain unchanged.

## Validation and remaining work

- Source/module-graph checks and model, format, modifier, rendering, paint-selection, layer, module, and journal tests.
- Journal tests cover branches, recovery, bidirectional texture deltas, edits after previews, write failures, and target mismatches.
- Hidden-window pixel comparisons cover every blend mode, groups/masks, cached local updates, orthographic/perspective views, negative dimensions, mirrors, face tinting, and selection previews. Images match exactly; WebGL reports no errors.
- Real-application verification confirms correct durable state after editing an undo preview. Export verification covers flipbooks, tiled textures, high-resolution box UVs, and culled faces.

Remaining work includes complex 100-layer blending that can still exceed a frame budget, undo UI latency above the audit's 33ms target, and reevaluation during modifier geometry edits or transparent-group dragging. Before animation, add independent pose evaluation and multi-group matrix submission so playback cannot modify documents, history, or project covers. Large injected event-controller interfaces also still need smaller feature boundaries.

Reproducible scripts:

- `scripts/verify-optimization-rendering.cjs`: compares the baseline compositor against the current compositor and indexed rendering against its non-indexed fallback.
- `scripts/compare-modifier-performance.mjs`: same-process old/new modifier comparison.
- `scripts/audit-animation-performance.cjs`: supports `--render`, `--pixels`, and `--suffix=name`.
- `scripts/audit-workflow-performance.cjs`: real undo, branch persistence, and cache cleanup; supports `--suffix=name`.
- `scripts/profile-viewport-input.cjs`: real-application camera profiling.
- `scripts/test-optimization-caches.mjs`: bounds, invalidation, snapshot isolation, index fallback, deduplication, and group drag commit tests.

Raw results are in the Git-ignored `build/performance/` directory, including `modifier-comparison-2026-11-06.json`, `camera-1000-2026-11-06.json`, performance reports ending in `-final`, and `optimization-rendering.json`.

The two old/new comparison scripts default to baseline `a6dfa154184cd15f4d84a511ab39913865ccd6f3`. Pass `--baseline=git-revision` to select another baseline without silently comparing new code against itself after a commit.
