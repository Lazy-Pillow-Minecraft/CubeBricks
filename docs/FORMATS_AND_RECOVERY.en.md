# Formats and Working-Journal Recovery

[简体中文](FORMATS_AND_RECOVERY.md) · [README](../README.md) · [User guide](USER_GUIDE.en.md) · [Architecture](../ARCHITECTURE.en.md)

## Model and palette formats

| Format | Purpose |
| --- | --- |
| `.cbmodel` | A complete CubeBricks project archive. It stores model data and textures and can optionally include operation history. Export can instead retain only the current complete state. |
| `.bbmodel` | Blockbench interchange. Export expands shapes and modifiers into compatible cubes and groups; native procedural shape parameters are not preserved as shapes in this format. |
| `.json` | Native Java Block/Item models and Bedrock geometry only. Coordinates, bones, rotations, and UVs follow their format; external textures are saved first. |
| `.java` | A Mojang-mapped modded entity model layer with integrity metadata; only unchanged files produced by CubeBricks can be reimported. |
| `.png` / `.png.mcmeta` | Independently saved composite images; animation uses a vertical frame strip and companion metadata. |
| `.cbtextures.json` | A native model's companion relative texture-path/material index. It is not a model format and must not be opened as a model on its own. |
| `.cbcmap` | Portable JSON for one palette's colors, gradient spacing, and color-space curve. It does not contain the palette's local name or ID. |
| Palettes in `.cbmodel` | Stores project palettes and embeds global palettes referenced by layers during export. Imported cards become local to the receiving project. |

## Modeling-format boundaries

Native JSON follows [Minecraft Java 1.21.11 rotation fields](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-11) and the [Bedrock geometry documentation](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/visualreference/geometry.v1.19.30). Java's unsupported group hierarchy is composed into element poses; rotations the selected version cannot represent fail explicitly. Modded Entity has no JSON option. Its Java output is a model layer, without game registration or animation code.

In `.bbmodel`, tiling becomes ordinary UVs and flipbooks become embedded vertical PNG strips with Blockbench animation fields. Single-texture formats merge images using the least common multiple of frame counts and the mean FPS, with interpolation off; multi-texture formats remain separate. Java `.mcmeta` timing uses integral game ticks, so compatible durations are rounded to at least one tick while the exact FPS is also recorded. See the [Blockbench texture implementation](https://github.com/JannisX11/blockbench/blob/master/js/texturing/textures.js). Baking leaves the source project intact and reuses overlapping tiled regions. Results exceeding 16384px on either axis or 64M pixels fail explicitly rather than silently shortening sequences or reducing resolution.

In `.bbmodel`, tiling becomes ordinary UVs and flipbooks become embedded vertical PNG strips with Blockbench animation fields. Single-texture formats merge images using the least common multiple of frame counts and the mean FPS, with interpolation off; multi-texture formats remain separate. Java `.mcmeta` timing uses integral game ticks, so compatible durations are rounded to at least one tick while the exact FPS is also recorded. See the [Blockbench texture implementation](https://github.com/JannisX11/blockbench/blob/master/js/texturing/textures.js). Baking leaves the source project intact and reuses overlapping tiled regions. Results exceeding 16384px on either axis or 64M pixels fail explicitly rather than silently shortening sequences or reducing resolution.

Java Block/Item projects force back-face culling and per-face UVs. The version classes are 1.9–1.21.5 (one rotation axis, 22.5° steps within ±45°), 1.21.6–1.21.10 (one axis, unrestricted angle), and 1.21.11+ (unrestricted axes and angles). Raw element `from/to` coordinates must stay within −16 to 32 on each axis; the rotated visual bounding box does not replace that check. The ground reference grid shifts +8, 0, +8 relative to the modeling origin, while the red and blue axes still start at the origin.

Bedrock Block checks the actual model bounds against a dynamic 30 px size limit, rather than applying one fixed box to each cube. Its boundary guide moves with the model, which must retain a valid overlap with the central base region. Both formats show a complete twelve-edge guide using the same color and depth behavior as the main ground-grid lines. These guides are visual references, not model geometry. An edit that worsens an existing boundary violation is rejected.

The newer `.cbmodel` archive combines operation JSON into Brotli-compressed blocks, deduplicates image data by content, and verifies files after extraction. Older ZIP-based projects remain readable. Separately, the desktop working directory stores a project-scoped operation sequence and element history. The default history limit is 200 operations and can be overridden per project. Exporting without history does not erase the local working journal.

**Save** in the top bar confirms and retains the expanded working directory; closing the window will no longer ask whether to keep that project. To share or separately back up a model, use **Export** to create a `.cbmodel` or `.bbmodel` file. Saving the working folder is not the same as creating a standalone model file.

Retention is stored separately in the folder's `workspace_state`, unaffected by undo and excluded from exports. Saved projects auto-save on tab or application close and are never deleted automatically. Only new, never-saved projects ask whether to keep them. Removing an existing project requires a confirmed home-page context-menu action.

The project history limit is stored independently in `project_settings`, outside model-operation history. Older projects migrate the value from their current state when first opened; later checkouts cannot overwrite it. Both full-history and current-state `.cbmodel` exports include the current setting.

Node shapes, colors, and names are stored separately in `history_marks`, without changing model transactions. Full-history archives preserve retained marks; current-state exports remap the current node's mark to the new initial node. Deletion and history capping clean up corresponding marks, and recovery ignores stale marks for deleted nodes.

## Opening and recovery

When a saved project is opened, the app compares its project UUID and history against a working copy at the same path. Matching copies, or copies on the same history that lag behind, can be reused. Divergent content prompts whether to open separately or replace the working copy; the source file is not silently overwritten.

If recovery reports a damaged project-state file with no previous completed state, neither `current_state` nor `current_state.previous` provides a reliable recovery point. That does not necessarily mean that a saved `.cbmodel` or `.bbmodel` is damaged. Back up the entire working directory first, then try opening the last saved model normally. Do not delete individual transaction, element, or texture files: operation indexes may still refer to them. Repeatedly clicking **Recover** cannot guarantee restoration of unsaved work.

Only one app window may write a given working project at a time. Undo and redo follow the history branch actually used. If a step's snapshot is missing or damaged, navigation stops at that boundary and keeps the current model instead of overwriting it with partial data.

History limits remove individual records in global sequence order, keeping newer descendants even after their parents are removed. The atomic `history_pruned` index prevents stale files from reappearing after interrupted cleanup. Detached roots reference texture recovery baselines through `history_roots/`; `history_textures/` deduplicates the baseline data by content. Baselines exist only for retained roots, rather than storing a complete texture for every operation. Later records continue using bidirectional deltas, with validation when switching between roots. Expired baselines and unreferenced data are reclaimed, and exports that include history preserve these indexes.

Project journals run in a dedicated worker to reduce interference from saves, history reads, and archiving with window input. Recent history can be restored from memory, and geometry undo refreshes affected regions where possible. Texture restoration keeps the existing view available until replacement resources are ready. Background execution preserves operation order and integrity checks; the working-directory and `.cbmodel` formats are unchanged.

An opening progress dialog appears only after half a second. Large history archives restore current elements and textures first, then load remaining immutable history in the background with a thin bottom progress bar. Undo can read pending records during this work. Temporary `.history-import.cbmodel` and `.history-import` files support interrupted-import recovery and are removed on completion; neither is a per-step snapshot or included in subsequent exports.
