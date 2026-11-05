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

- Export opens a format window for editable `.cbmodel`, interchange `.bbmodel`, and supported native JSON/Java. Java block models and Bedrock geometry support JSON round-trips. Modded entities export Java model layers; unchanged CubeBricks-generated files can be verified and reimported. Native export saves textures before the model and records relative paths/resource names in a companion index.
- Textures support independent Save and Save As. A right-side save icon marks new, copied, or edited unsaved content; untouched imports remain clean. Pixel checks run in the background and ignore PNG re-encoding differences.
- `.bbmodel` export bakes tiled and flipbook textures. Tiled faces share a periodic plane per source, reusing UV areas wherever their phases overlap. Single-texture formats merge every texture, use the least common multiple of animation frame counts and the mean FPS, and disable interpolation. Multi-texture formats retain separate images and animation settings. Box-only formats keep fixed box nets. Export baking leaves the source project intact.
- Cubes may use per-face or box UVs. In per-face mode, faces can independently choose a texture, rotate or mirror UVs, be culled, and have UV coordinates edited. Texture mode switches between Default and Tiled; Flipbook is a separate attribute available with either. Mode and layer-creation controls remain fixed while scrolling.
- UV fields show X/Y origin and width/height. In Tiled mode they specify offsets and the entire face's pixel extent, with the intact source texture repeating across it. These per-face parameters support batch editing and are separate from ordinary UVs. Large faces split only for rendering, with derived textures capped at 1024px. UV Preview auto-focus can switch to the face's assigned texture.
- Flipbook expands the layer editor with a frame list and connection space. Frames support adding, deleting, copying, reordering, and many-to-many links; right-click to disconnect. The top-right port connects the entire layer list, and overflowing ports snap to its right border. Frames remember child visibility and paint layers; left edges mark membership. The timeline has clickable frame ticks, FPS, and interpolation. Each texture plays independently, with playback changed only by its play/pause button. PNG import reads a sibling `.png.mcmeta` and converts the sheet into flat image layers and linked frames of the correct size. Disabling Flipbook restores global visibility and retains its settings without stretching the texture into a strip.
- Texture layers support image layers and groups, reordering, visibility, opacity, blend modes, tone mapping, and independent mask sources. Context menus offer Merge Down and Delete; merging applies the upper layer's blend result. Creation controls remain visible while scrolling, and deep group nesting exposes horizontal scrolling. A dedicated layer editor shows the full texture beside the selected layer.
- New textures can be generated as texture templates, solid-color templates, or blank images. Template generation uses the project's base snap resolution for UV allocation, assigns at least 1 px to nonzero edges, can cull zero-area faces, and offers box UVs, padding, power-of-two dimensions, or custom size multiples.
- **Preserve layer structure** is enabled by default for texture templates. It remaps each source layer's pixels into the newly assigned UVs while retaining groups, order, visibility, blend settings, and mask relationships. Multiple source textures become separate groups. Turning the option off uses the previous flattened-image workflow. Box UVs default to off where per-face UVs are allowed; formats that require box UVs still enforce that rule.
- **Do Not Share UVs** defaults to on and assigns each face its own region. Disabling it allows matching source/old-UV faces to reuse regions across cubes.
- The texture view supports face multiselection and UV movement or resizing. UV Preview shows selected content, face-direction coloring, and rotation/mirror markers.

## Painting and color

- Paint on a 2D texture or directly on 3D model faces with Brush, Shape Drawing, Fill, Gradient, Eyedropper, and Selection. Brushes support square or round tips, antialiasing, opacity, continuous cross-face strokes, and brush depth. Faces without an assigned texture do not silently acquire one.
- Hold `Ctrl` while painting in 3D to project virtual screen pixels onto visible faces. The virtual pixel height is configurable in Settings. Live previews update layer composites and the texture atlas in affected regions.
- Paint Selection supports rectangle, brush, and freehand lasso modes. Shift adds and Ctrl subtracts. Selections constrain painting and can be moved, copied, or rotated in the 2D texture view.
- Palettes support discrete colors, gradients, and 3D color-space curves. A single palette can be imported or exported as `.cbcmap`. The color picker offers square, circular, and triangular HSV interfaces.
- In Paint mode, the hierarchy still supports finding, selecting, focusing, and toggling visibility/lock state. Model geometry changes require Edit mode.

## Projects and extension points

- `.cbmodel` saves model data, textures, and optional operation history. `.bbmodel` supports Blockbench interchange. The working directory keeps a recoverable operation journal; archive export can include or omit history.
- The radial history viewer shows all retained branches, with equal sectors for terminal nodes, hover details, state checkout, and separate node/branch deletion. History limits clear the oldest global sequence numbers; surviving detached branches use dashed links to a virtual center.
- History nodes support six geometric marks, custom colors, and name labels with fixed screen sizes. `R` focuses the selected point and `Shift+R` resets the view. History and UV Preview share a low-contrast checkerboard background.
- A registry defines model formats. Java Block/Item has three version-specific rotation rules, forced back-face culling, and element-coordinate bounds. Bedrock Block has a dynamic 30 px size constraint. Both show a complete boundary guide in the viewport. Modded Entity requires box UVs, integer cube dimensions, and group rotation rather than cube rotation.
- New Minecraft Skin and GeckoLib projects are temporarily disabled; recognition of existing and imported projects remains available.
- Java Block/Item has no Animation mode; its Display Settings page is currently a placeholder. Animation Editing in other formats also shows a placeholder while the full workflow is unfinished.
- External [Shape packs](../SHAPE_PACKS.en.md) and [language/font packs](../RESOURCE_PACKS.en.md) load through the pack manager. External modifier or operator packs are not available yet.
