# Formats and Working-Journal Recovery

[简体中文](FORMATS_AND_RECOVERY.md) · [README](../README.md) · [User guide](USER_GUIDE.en.md) · [Architecture](../ARCHITECTURE.en.md)

## Model and palette formats

| Format | Purpose |
| --- | --- |
| `.cbmodel` | A complete CubeBricks project archive. It stores model data and textures and can optionally include operation history. Export can instead retain only the current complete state. |
| `.bbmodel` | Blockbench interchange. Export expands shapes and modifiers into compatible cubes and groups; native procedural shape parameters are not preserved as shapes in this format. |
| `.cbcmap` | Portable JSON for one palette's colors, gradient spacing, and color-space curve. It does not contain the palette's local name or ID. |

The newer `.cbmodel` archive combines operation JSON into Brotli-compressed blocks, deduplicates image data by content, and verifies files after extraction. Older ZIP-based projects remain readable. Separately, the desktop working directory stores a project-scoped operation sequence and element history. The default history limit is 200 operations and can be overridden per project. Exporting without history does not erase the local working journal.

## Opening and recovery

When a saved project is opened, the app compares its project UUID and history against a working copy at the same path. Matching copies, or copies on the same history that lag behind, can be reused. Divergent content prompts whether to open separately or replace the working copy; the source file is not silently overwritten.

If recovery reports a damaged project-state file with no previous completed state, neither `current_state` nor `current_state.previous` provides a reliable recovery point. That does not necessarily mean that a saved `.cbmodel` or `.bbmodel` is damaged. Back up the entire working directory first, then try opening the last saved model normally. Do not delete individual transaction, element, or texture files: operation indexes may still refer to them. Repeatedly clicking **Recover** cannot guarantee restoration of unsaved work.

Only one app window may write a given working project at a time. Undo and redo follow the history branch actually used. If a step's snapshot is missing or damaged, navigation stops at that boundary and keeps the current model instead of overwriting it with partial data.
