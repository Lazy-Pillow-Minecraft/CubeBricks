# CubeBricks 0.1.2-beta

[简体中文](RELEASE_0.1.2-beta.md) · [README](../README.md)

## Changes since 0.1.1

- **Transforms:** Cubes, groups, and Shapes can apply position or rotation as a new zero point in the property fields, then restore the displayed values without changing the model's appearance. Groups now have a separate Position field. Exports keep the final pose.
- **Curves and symmetry:** Nested envelope baking and export preserve group hierarchy, with group pivots and orientations following the outermost cube's start face. Symmetry baking retains overlapping group structure, while a single cube still produces cubes.
- **Rotation:** Gizmo drags continue smoothly past 180°. Java single-axis rotation limits and group rotation dragging behave more predictably.
- **Undo and capture:** Restoring history no longer mismatches curve-node selection and local handles. Model capture refreshes current geometry and offers optional preview-only auto-cropping with a visible crop outline.
- **Startup and controls:** A plain background covers the unfinished first frame. A one-time hint points new users to Blockbench-style controls if they drag with the left or right button before using the middle button. Shift can switch orbit and pan during a middle-button drag.
- **Interface and formats:** The paint-mode context menu and Center Pivot placement were refined. Creating new Skin and GeckoLib projects is temporarily disabled while existing projects remain readable. Simplified Chinese and English UI text was updated.

## Upload note

CubeBricks 0.1.2-beta improves transforms, baking, and reliability. Cubes, groups, and Shapes can apply or restore position and rotation. Envelope curves and symmetry baking preserve hierarchy more accurately, rotation drags pass 180° smoothly, curve-node undo and stale captures are fixed, and screenshots can be cropped non-destructively. Startup presentation, control hints, and translations were also refined.

Windows installer: `CubeBricks-v0.1.2-beta-win-x64-setup.exe`.
