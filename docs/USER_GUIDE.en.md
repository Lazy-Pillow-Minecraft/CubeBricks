# User Guide

[简体中文](USER_GUIDE.md) · [README](../README.md) · [Getting started](GETTING_STARTED.en.md) · [Feature overview](FEATURES.en.md)

## 1. Create, save, and switch projects

1. Choose a project format from the model-type list on the start page or from **New** in the top bar. The format supplies initial snapping and UV capabilities. Java Block/Item version restrictions can be changed in Project Information.
2. Use the top tabs to switch projects or drag them to reorder. Right-click a project tab for information; middle-click or use its hover-only close icon to close it. The plus directly after the list adds a home tab without closing projects. Creating or opening from that home replaces its tab in place.
3. `Ctrl+S` or **Save** in the top bar retains the project's working folder without generating a `.cbmodel` or opening a file dialog. `Ctrl+Shift+S` and **Export** create a file; the chosen or typed extension selects `.cbmodel` or `.bbmodel`.
4. Saved status is stored in the project directory and survives restarts. Previously saved projects save automatically when closing a tab or the application, without a prompt or automatic folder deletion. Only new, never-saved projects ask whether to keep or discard them; canceling keeps the project open.
5. Right-click a home project entry and choose **Delete project**. Confirmation is required before removing its working folder and history. Exported files remain intact, and any tab for the deleted project closes.

Opening an existing project shows a progress dialog only after half a second. Large history archives restore the current model and textures first, then read remaining history in the background. A thin progress bar at the bottom tracks this work while editing and undo remain available.

**History**, directly after **Export**, opens a radial branch window. Terminal nodes receive equal circular sectors. The current node is highlighted, tips have a secondary highlight, and ordinary nodes use dots matching the line color, with a diameter twice the line width. Nodes are evenly spaced along each straight segment between forks or leading to a tip. Hover for operation and timestamp details. Use the wheel to zoom; drag empty space or middle-drag to pan.

Left-click a history node to select it. `R` smoothly focuses that point; `Shift+R` restores the initial radial view, without changing the main camera or model state. UV Preview and History share the same fixed, low-contrast checkerboard background.

Choose **Mark node** from a node's context menu to select a square, diamond, circle, hexagon, five-pointed star, or triangle, then set its color and name. The color button opens the existing three-mode picker. Names appear directly above their nodes in bright text on translucent dark backgrounds. Mark and label sizes stay constant on screen while zooming. When a marked node becomes current, its shape grows to 1.5 times its normal size with a fixed 3 px white outline; the label moves upward to keep clear of the enlarged shape. Right-click again to edit or remove a mark. Marks are saved independently, creating no history nodes and surviving state checkout; deleting or capping a node also clears its mark.

Right-click a node to restore its state, delete only that node, or delete it and its entire descendant branch. Deletion requires confirmation and must leave at least one state. If the current state is removed, a retained parent or nearby state is restored first. Single-node deletion preserves successors. Branches whose parents were removed connect to a shared virtual center with dashed lines and remain navigable.

The history cap removes the oldest project-wide sequence numbers individually, preserving newer records across all branches. The virtual center indicates that earlier connections were cleared; it has no restorable model state.

Set a project-specific history limit in Project Information, or leave it empty to use the application default. The limit is saved independently: changing it creates no history node, and undo, redo, or history checkout does not change it. Reducing the limit still performs the required cleanup of old records.

Java Block/Item projects force back-face culling and per-face UVs. Their three version classes allow, respectively, 22.5° steps on one axis, arbitrary angles on one axis, or unrestricted rotation axes. The viewport guide marks the −16 to 32 `from/to` coordinate range; the ground reference grid shifts +8 on X/Z while the red and blue axes still start at the origin and extend farther. Animation mode is unavailable for this format, and Display Settings is currently only a placeholder. The Bedrock Block guide moves with the model to indicate its 30 px size constraint; a drag or numeric change that worsens an out-of-range model is rejected. The guides share the main ground-grid line color and depth behavior.

## 2. Camera and selection

| Input | Result |
| --- | --- |
| Middle-drag | Orbit in the general view; pan in an axis view |
| `Shift` + middle-drag | Pan the general view; press or release `Shift` without releasing the middle button to switch modes |
| Mouse wheel | Zoom the main viewport |
| `R` / `Shift+R` | Focus selected content / return to scene center; when the texture view has focus, these instead focus or reset that view |
| Click the six-direction axis widget | Enter the corresponding orthographic axis view; click the same direction again to flip to the opposite side |
| Drag the axis widget | Leave the axis view and return to the general view |
| Left-click an object / empty background | Select one object / clear selection |
| Left-drag a marquee | Select within the rectangle; hold `Shift` to add or `Ctrl` to subtract |
| `Ctrl+A` | Select all eligible elements in the main viewport or hierarchy |

The hierarchy and main viewport share object selection. The list supports multiselection, search, drag reordering, and moving entries into groups. During a list drag, scroll with the wheel or move the pointer near an edge to autoscroll. Right-clicking an object or its list row opens the same object actions.

**Separate UV Editing Mode** is off by default in Settings, so UV tools are part of Edit mode; turn it on for a separate UV workspace. **Blockbench-style controls** are off by default. When enabled, left-drag orbits and right-drag pans in the modeling viewport; box selection requires `Shift` + left-drag. A stationary left-click still selects, and only a stationary right-click opens the context menu. Paint mode keeps left-click for painting. Right-clicking empty paint-viewport background opens the view menu without Paste or Duplicate in Place.

On first use, dragging the modeling viewport with the left or right button before using the middle button shows a one-time reminder that Blockbench-style controls are available in Settings.

## 3. Modeling and transforms

Use the controls above the scene hierarchy to create cubes, groups, locators, and shapes. A new cube is a 2×2×2 cube resting on the horizontal plane. An element created under a group starts relative to that group's pivot. The Shape menu contains prisms, polyhedra, and Bezier variants.

| Shortcut | Tool |
| --- | --- |
| `1` | Move |
| `2` | Scale |
| `3` | Rotate |
| `4` | Move Pivot |
| `5` | Vertex Snap |
| `6` | Knife |
| `7` | Face Select |

- Gizmos respond to the left mouse button; the middle button remains reserved for camera control. Axis, plane, and center handles perform the corresponding dimensional transforms.
- Move and Rotate can use local, parent, or global coordinates. Multiselection can apply transforms together or separately. Moving a pivot compensates object parameters so the visible geometry stays put. **Center Pivot** follows the Pivot X/Y/Z fields in Object Properties and places all selected pivots at the combined geometric center.
- Cube, group, and Shape properties offer **Apply Position / Rotation** and separate **Restore** actions. Applying resets the corresponding displayed values to zero so later edits start there; restoring shows the current effective values again. Neither action changes the visible model. A group's Position moves its descendants, while Pivot changes compensate them. Exports contain the final pose without the editor's baseline metadata.
- Hold `Alt` while rotating to show the selected object's vertices temporarily. Click one to move its pivot there. Vertex Snap can also show intersections; square-diamond intersection marks can be target points, not starting points.
- `Ctrl+Z` undoes and `Ctrl+Shift+Z` redoes. With a text field focused, `Ctrl+Z` edits the text rather than undoing the project.
- `Ctrl+C` copies, `Ctrl+X` cuts, `Ctrl+V` pastes, and `Ctrl+D` duplicates in place. Depending on focus, these operate on eligible objects or textures.

## 4. UVs and texture templates

1. Create or import a texture in the left texture list, then drag its list item onto a model face. If multiple elements are selected, their faces in the same direction receive the texture. Reassigning a texture does not discard existing UV or tiling parameters.
2. Select faces and UV outlines in the texture view. Shift-marquee adds and Ctrl-marquee subtracts. Drag an outline or its edge to adjust UV position or size. `Ctrl` + wheel zooms the texture; the wheel scrolls vertically, `Shift` + wheel scrolls horizontally, and middle-drag pans freely.
3. With the texture view focused, `R` focuses selected UVs and `Shift+R` resets the texture view. UV data outside the image bounds is preserved for compatibility with unusual models, although ordinary dragging does not deliberately move it farther out.
4. **New Texture → Texture Template** repacks UVs from the current cube faces. Options include selected elements only, zero-area face cleanup, box UVs, canvas-size alignment, padding, and **Do Not Share UVs**. The latter is checked by default each time the dialog opens. Unchecking it allows faces with the same source and old UVs to reuse a new slot, even across different cubes.
5. **Preserve Layer Structure** is on by default. Each source texture's layers are remapped separately into the new UV layout, retaining groups, visibility, blend modes, and mask links. Multiple source textures become separate groups; faces with no texture go into a template base layer. Turn it off to output one flattened image. Box UVs default to off except where required by the model format.

The four fields below the texture view show X/Y origin and width W/height H. For ordinary UVs, moving the origin translates the whole rectangle, and resizing preserves its mirror orientation. Mixed values in a multi-selection show `-`.

Change texture mode at the top of the Layers panel. Mode and creation controls stay visible while scrolling. In **Tiled** mode, the fields specify X/Y starting offsets and the entire face's pixel width/height. The source image repeats intact: a 16px-wide image repeats twice across a face whose W is 32px. These parameters are separate from ordinary UVs. Switch back to **Default** to edit the original UV coordinates.

With UV Preview's auto-focus option enabled, clicking a face switches to its assigned texture and focuses its UVs automatically.

Lines, rectangles, and ellipses on tiled faces use continuous face positions before their pixels wrap onto the source texture. Screen-space painting fills the actual projected footprint, keeping stroke width consistent with ordinary textures.

**Flipbook** is a separate checkbox available for both Default and Tiled textures. Open the layer editor using the gear beside the layer-creation controls; frame elements appear in its rightmost list. Use **+ Frame** to add one, drag a row to reorder, or right-click to copy, paste, cut, duplicate, or delete. With the frame list focused, `Ctrl+C/V/X/D` and `Delete` perform the same actions. Edits support undo and redo. Frames have no grouping or visibility controls.

The frame list appears only with Flipbook enabled. The window expands to the right with the list and a gap about half the layer-list width, preserving existing columns; smaller screens can scroll horizontally. Drag between dots for many-to-many links; the top-right port represents the entire layer list, and overflowing layer ports snap to its right border. Right-click a curve to disconnect it. Highlights follow the last selected frame or layer. Each frame composites only connected content; thick left edges mark effective members. Connected-group children have frame-local visibility controls in the editor. Painting is restricted to editable image layers in the current frame, which remembers its last paint layer and initially chooses the first editable one. The timeline supports scrubbing and clickable frame ticks; header controls set FPS and interpolation. Textures play independently and only their play/pause buttons change playback state. Other actions and focus changes do not pause them. The timeline appears automatically with Flipbook frames, without a visibility switch. PNG import reads a sibling `filename.png.mcmeta`, creating flat image layers and linked frames while preserving order, timing, and interpolation. Disabling Flipbook restores global visibility and retains frame settings. Original pixels, dimensions, and UVs remain intact.

The eyedropper skips fully transparent pixels and continues to deeper faces in 3D. Hold `Ctrl` to sample the final composite, including current-frame interpolation, blending, and masks, without lighting or shadows. This also works with the temporary `Alt` eyedropper.

### Exporting tiled and flipbook textures

Choosing `.bbmodel` bakes textures after the existing Shape/modifier geometry pass, leaving the current project, layers, and playback position unchanged. Animation frames become a vertical PNG strip in frame-list order. Longer exports display progress.

- **Single-texture formats**, including Bedrock Entity and Java Modded Entity, merge all textures into one atlas. The output count is the least common multiple of all animation frame counts, each sequence cycles independently, and static images remain unchanged in every frame. FPS is the mean of the animated textures' rates and interpolation is disabled. The same rule applies when there is only one animated texture.
- **Multi-texture formats**, including Java Block/Item, keep static textures separate and bake each animation independently, preserving its rate, frame durations, and interpolation setting.
- **Tiled faces** bake their offsets and full-face extents. Faces using the same source share a periodic plane; whole-period offsets and compatible overlapping regions reuse UV pixels instead of receiving separate images. The renderer's 1024px cache cap does not truncate exports. Box-only formats bake into fixed box nets and reuse identical nets.

`.cbmodel` retains editable textures, layers, frame links, and tiling parameters. Keep an engineering project file for subsequent editing.

### Exporting tiled and flipbook textures

Choosing `.bbmodel` bakes textures after the existing Shape/modifier geometry pass, leaving the current project, layers, and playback position unchanged. Animation frames become a vertical PNG strip in frame-list order. Longer exports display progress.

- **Single-texture formats**, including Bedrock Entity and Java Modded Entity, merge all textures into one atlas. The output count is the least common multiple of all animation frame counts, each sequence cycles independently, and static images remain unchanged in every frame. FPS is the mean of the animated textures' rates and interpolation is disabled. The same rule applies when there is only one animated texture.
- **Multi-texture formats**, including Java Block/Item, keep static textures separate and bake each animation independently, preserving its rate, frame durations, and interpolation setting.
- **Tiled faces** bake their offsets and full-face extents. Faces using the same source share a periodic plane; whole-period offsets and compatible overlapping regions reuse UV pixels instead of receiving separate images. The renderer's 1024px cache cap does not truncate exports. Box-only formats bake into fixed box nets and reuse identical nets.

`.cbmodel` retains editable textures, layers, frame links, and tiling parameters. Keep an engineering project file for subsequent editing.

## 5. Painting

Switch to **Paint** in the top bar. Brush, Shape Drawing, Fill, Gradient, Eyedropper, and Selection are in the paint toolbar. Shape Drawing and Selection expose their submodes inside the tool. Common shortcuts are `B` for Brush, `L` for Line, `M` for Rectangle, `O` for Ellipse, `G` for Fill, `J` for Gradient, and `I` for Eyedropper. Hold `Alt` for a temporary eyedropper, then release it to return to the previous tool. If the current color belongs to the selected palette, Alt + wheel can also move through palette colors or gradient positions.

- Paint in the 2D texture view or directly on 3D model faces. A brush stroke can begin over empty 3D space and continue across faces. A face without an assigned texture does not silently receive the current texture; assign one first.
- Brush controls include size, square/round tip, antialiasing, opacity, and brush depth. Shape Drawing can fill its interior. Fill can cover multiple faces or positions during a single drag.
- Face and volume gradients use two points to define direction and cover the full target. They can use two color slots or the current palette. Palettes support discrete colors, continuous gradients, and 3D color-space curves.
- Paint Selection offers rectangle, brush, and freehand lasso modes. Shift adds and Ctrl subtracts. Painting is confined to the selection. In the 2D texture view, Pixel Transform can move, copy, or rotate selected pixels.
- Hold `Ctrl` while painting in the 3D viewport to use screen-space coordinates for the brush, line, rectangle, ellipse, bucket, and gradient. Erase mode works the same way. Set the virtual screen height in **Settings → Viewport**; its width follows the viewport aspect ratio. The next stroke returns to normal painting after releasing `Ctrl`.
- To use Paint Symmetry, first attach it on the element's or group's **Operators** property page, then edit its axis in the main viewport. It mirrors paint input without making new model geometry. Paint mode still allows visibility/lock changes in the hierarchy, but geometry changes require Edit mode.

## 6. Layers, palettes, and windows

The layer list supports new image layers or groups, drag reordering, collapse, and visibility toggles. The create controls stay visible while the list scrolls. Right-click a layer to merge it down or delete it; merging bakes the upper layer's blend result into the lower layer's pixels. Its gear opens the dedicated layer editor, which has the same layer context menu and controls for names, opacity, blend modes, tone mapping, and mask sources. Changing the active layer does not erase other layers. During painting, the preview recomposites only the affected region; the complete texture is saved when the stroke ends.

Palettes can be created, selected, reordered, deleted, and renamed from their context menu. Export saves the currently selected single palette as `.cbcmap`; import appends instead of replacing. The palette list can use a compact display. Dock panels around the left, right, and bottom edges can detach, snap back near an edge, or merge by dropping onto another panel's header. Collapse and sizing are managed at each dock position.
