# Feature Overview

[简体中文](FEATURES.md) · [README](../README.md) · [User guide](USER_GUIDE.en.md) · [Formats and recovery](FORMATS_AND_RECOVERY.en.md)

CubeBricks is still a prototype. This page describes the current workflows and boundaries, rather than serving as a changelog. Features that are only placeholders are identified explicitly.

## Modeling and scene hierarchy

- Cube geometry is the foundation. The editor also supports groups, locators, nodes, 2D/3D Bezier curves, and procedural shapes including polygonal prisms, dodecahedra, and soccer-ball-like truncated icosahedra. Shapes can retain their parameters while storing overrides to generated cubes.
- The hierarchy supports multiselection, range selection, search, grouping, drag reordering, and quick navigation. Detailed rows expose visibility, locking, automatic UV, UV normalization, and export flags.
- Move, Scale, Rotate, Move Pivot, Vertex Snap, intersection display, Knife, and Face Select cover different geometry interactions. Move and Rotate can use local, parent, or global reference frames; moving a pivot compensates geometry placement.
- Cubes, groups, and Shapes can apply position and rotation independently as a new editing baseline. Their property fields return to zero without changing the visible model; Restore brings the applied values back to the fields. Exports use the composed final pose.
- UV editing is part of Edit mode by default but can be split into a separate mode. Optional Blockbench-style viewport controls use left-drag to orbit, right-drag to pan, and Shift + left-drag to box-select.
- Groups and individual elements can carry modifier stacks. The built-in symmetry modifier supports XYZ mirrors, radial copies, and mandala patterns; it can be stacked repeatedly, previewed, and baked one modifier at a time. `.bbmodel` export expands procedural results into compatible cubes and groups.
- Real-time operators are separate from modifiers. The current Paint Symmetry operator relates matching faces and checks corresponding UV edge lengths; it creates no additional scene elements.

## Viewport and workspace

- Perspective, orthographic, and dedicated six-direction axis views are available. Axis views are orthographic only; the camera supports pan, orbit, zoom, and eased focus.
- Wireframe, solid, textured, and normal display modes are available. Grid, gizmos, outlines, and model surfaces each use an appropriate rendering path.
- The main viewport supports reference images, a visual-only player reference, transparent-background model capture, and separate faded rendering for locked objects or modifier results.
- Model capture preview offers optional automatic cropping with a visible crop outline. Saving or copying uses the crop only while enabled; the full image remains available.
- Multiple projects can stay open as tabs. Dock panels on the left, right, and bottom can detach, snap back, merge into tabbed panels, collapse, and resize.

## UVs, textures, and layers

- Cubes may use per-face or box UVs. In per-face mode, faces can independently choose a texture, rotate or mirror UVs, be culled, and have UV coordinates edited. The texture-mode dropdown currently allows only ordinary textures; Tiled and Flipbook appear as disabled “Coming Soon” choices. Existing data remains readable.
- Texture layers support image layers and groups, reordering, visibility, opacity, blend modes, tone mapping, and independent mask sources. A dedicated layer editor shows the full texture beside the selected layer.
- New textures can be generated as texture templates, solid-color templates, or blank images. Template generation uses the project's base snap resolution for UV allocation, assigns at least 1 px to nonzero edges, can cull zero-area faces, and offers box UVs, padding, power-of-two dimensions, or custom size multiples.
- **Preserve layer structure** is enabled by default for texture templates. It remaps each source layer's pixels into the newly assigned UVs while retaining groups, order, visibility, blend settings, and mask relationships. Multiple source textures become separate groups. Turning the option off uses the previous flattened-image workflow. Box UVs default to off where per-face UVs are allowed; formats that require box UVs still enforce that rule.
- The texture view supports face multiselection and UV movement or resizing. UV Preview shows selected content, face-direction coloring, and rotation/mirror markers.

## Painting and color

- Paint on a 2D texture or directly on 3D model faces with Brush, Shape Drawing, Fill, Gradient, Eyedropper, and Selection. Brushes support square or round tips, antialiasing, opacity, continuous cross-face strokes, and brush depth. Faces without an assigned texture do not silently acquire one.
- Paint Selection supports rectangle, brush, and freehand lasso modes. Shift adds and Ctrl subtracts. Selections constrain painting and can be moved, copied, or rotated in the 2D texture view.
- Palettes support discrete colors, gradients, and 3D color-space curves. A single palette can be imported or exported as `.cbcmap`. The color picker offers square, circular, and triangular HSV interfaces.
- In Paint mode, the hierarchy still supports finding, selecting, focusing, and toggling visibility/lock state. Model geometry changes require Edit mode.

## Projects and extension points

- `.cbmodel` saves model data, textures, and optional operation history. `.bbmodel` supports Blockbench interchange. The working directory keeps a recoverable operation journal; archive export can include or omit history.
- A registry defines model formats. Java Block/Item has three version-specific rotation rules, forced back-face culling, and element-coordinate bounds. Bedrock Block has a dynamic 30 px size constraint. Both show a complete boundary guide in the viewport. Modded Entity requires box UVs, integer cube dimensions, and group rotation rather than cube rotation.
- New Minecraft Skin and GeckoLib projects are temporarily disabled; recognition of existing and imported projects remains available.
- Java Block/Item has no Animation mode; its Display Settings page is currently a placeholder. Animation Editing in other formats also shows a placeholder while the full workflow is unfinished.
- External [Shape packs](../SHAPE_PACKS.en.md) and [language/font packs](../RESOURCE_PACKS.en.md) load through the pack manager. External modifier or operator packs are not available yet.
