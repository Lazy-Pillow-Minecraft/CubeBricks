# User Guide

[简体中文](USER_GUIDE.md) · [README](../README.md) · [Getting started](GETTING_STARTED.en.md) · [Feature overview](FEATURES.en.md)

## 1. Create, save, and switch projects

1. Choose a project format from the model-type list on the start page. Java Block/Item and Bedrock models open a creation dialog for snapping, texture size, UV mode, and applicable version limits. Modded entities are created directly.
2. Use the top tabs to switch projects or drag them to reorder. Right-click a project tab for information; middle-click or use its hover-only close icon to close it. The plus directly after the list adds a home tab without closing projects. Creating or opening from that home replaces its tab in place.
3. `Ctrl+S` or **Save** retains the project's working folder without creating a separate file. `Ctrl+Shift+S` or **Export** opens a format window offering `.cbmodel`, `.bbmodel`, and the current format's native JSON or Java output. Unsupported options are omitted.
4. Saved status is stored in the project directory and survives restarts. Previously saved projects save automatically when closing a tab or the application, without a prompt or automatic folder deletion. Only new, never-saved projects ask whether to keep or discard them; canceling keeps the project open.
5. Right-click a home project entry and choose **Delete project**. Confirmation is required before removing its working folder and history. Exported files remain intact, and any tab for the deleted project closes.

Opening an existing project shows a progress dialog only after half a second. Large history archives restore the current model and textures first, then read remaining history in the background. A thin progress bar at the bottom tracks this work while editing and undo remain available.

Choose **Minecraft Skin** on the home page to open the model picker. Switch between Java and Bedrock, then search or select an entity template. Visible list entries render thumbnails on demand. The large preview renders the selected model and its chosen game texture or UV-preserving six-face template directly; drag it with the left mouse button to rotate the view. It shows an empty checkerboard before selection. **Start painting** creates a paint-only skin project without model editing or animation modes.

**History**, directly after **Export**, opens a radial branch window. Terminal nodes receive equal circular sectors. The current node is highlighted, tips have a secondary highlight, and ordinary nodes use dots matching the line color, with a diameter twice the line width. Nodes are evenly spaced along each straight segment between forks or leading to a tip. Hover for operation and timestamp details. Use the wheel to zoom; drag empty space or middle-drag to pan.

Left-click a history node to select it. `R` smoothly focuses that point; `Shift+R` restores the initial radial view, without changing the main camera or model state. UV Preview and History share the same fixed, low-contrast checkerboard background.

Choose **Mark node** from a node's context menu to select a square, diamond, circle, hexagon, five-pointed star, or triangle, then set its color and name. The color button opens the existing three-mode picker. Names appear directly above their nodes in bright text on translucent dark backgrounds. Mark and label sizes stay constant on screen while zooming. When a marked node becomes current, its shape grows to 1.5 times its normal size with a fixed 3 px white outline; the label moves upward to keep clear of the enlarged shape. Right-click again to edit or remove a mark. Marks are saved independently, creating no history nodes and surviving state checkout; deleting or capping a node also clears its mark.

Right-click a node to restore its state, delete only that node, or delete it and its entire descendant branch. Deletion requires confirmation and must leave at least one state. If the current state is removed, a retained parent or nearby state is restored first. Single-node deletion preserves successors. Branches whose parents were removed connect to a shared virtual center with dashed lines and remain navigable.

The history cap removes the oldest project-wide sequence numbers individually, preserving newer records across all branches. The virtual center indicates that earlier connections were cleared; it has no restorable model state.

Set a project-specific history limit in Project Information, or leave it empty to use the application default. The limit is saved independently: changing it creates no history node, and undo, redo, or history checkout does not change it. Reducing the limit still performs the required cleanup of old records.

Java Block/Item projects force back-face culling and per-face UVs. Their three version classes allow, respectively, 22.5° steps on one axis, arbitrary angles on one axis, or unrestricted rotation axes. The default viewport guide marks the −16 to 32 `from/to` coordinate range. **Disable region limits**, in project creation and Project Information, removes position/size constraints and hides that guide while retaining rotation-version and UV rules. Importing a bbmodel whose original coordinates exceed the range automatically disables region limits to preserve its geometry. The setting persists in cbmodel and exported bbmodel files. The ground reference grid shifts +8 on X/Z while the red and blue axes still start at the origin and extend farther. Animation mode is unavailable for this format, and Display Settings is currently only a placeholder. The Bedrock Block guide moves with the model to indicate its 30 px size constraint; a drag or numeric change that worsens an out-of-range model is rejected. The guides share the main ground-grid line color and depth behavior.

For Java Cubes with a single-axis limit, whole 90° turns are folded into position, dimensions, and per-face UVs before constraining the remaining angle. Face culling, UV mirrors, and negative dimensions are preserved. Exported bbmodels store the selected version class in the root `java_block_version` property and restore it on import; this is separate from the bbmodel file version in `meta.format_version`.

Built-in Shapes and modifiers also follow format restrictions. Polygon columns and curves fit legal angles in restricted Java versions; symmetry and element copy constrain axes, counts, angles, and node positions using preceding modifier results. Bedrock Block Shapes fit as complete assemblies, and modifier results participate in bounds checks. Modded entity Shapes use integer dimensions and box UVs, with group rotations preserving curve directions during baking and export. Preview, manual baking, and export share the adaptation. Both spherical polyhedra are temporarily unavailable in the two single-axis Java versions; existing data is retained and becomes available again after switching to 1.21.11+ or another supported format.

Restricted Java Shapes approximate the original form using rotated beams with the requested thickness, rather than bounding-box or voxel fills. Spatial curves add oriented segments only when angular error would otherwise break path coverage. Unrestricted versions do not add these fitting segments.

Recent undo/redo restores the view from memory before completing ordered storage validation. Models, UVs, painting and layers share this cache, which keeps up to eight steps within its memory budget and the project's history limit. Older states are read from project history. Saving and closing still wait for required writes.

All number fields share left/right step buttons inside the field, with the decrease button placed after any XYZ label. Click the value to type, or drag horizontally anywhere in the field to adjust in snapped steps. The cursor stays at its starting position until release, and a drag creates one undo step. Position, size and UV fields use project snapping; rotation uses angle snapping. You can change `Shift`, `Ctrl` or their combination during a drag. Counts, pixels and percentages use their own steps and limits.

Hover a number field and scroll to adjust it without focusing it or scrolling its parent panel. Hover a dropdown and scroll to switch between available options, skipping disabled entries.

Number fields keep the normal input cursor until horizontal dragging actually begins. Main-view move, resize, rotate and pivot feedback shows only the signed drag amount along the active handle, such as `+2 px` or `-15°`, for individual objects, multiple selections and groups alike.

Theme, color scheme, corner radius and UI scale save automatically. The desktop app keeps an independent `appearance.json` in its application data folder and restores it on restart, while retaining compatibility with older appearance records.

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

**Lock reference images**, in the top-right reference menu, protects all references in the current project. Double-clicking the background, using the edit command, and importing an image cannot enter adjustment mode while locked. Unlock to adjust again. The lock is saved with the project and supports undo; color sampling remains available. The selected reference's theme-colored edge glow keeps a fixed screen width regardless of source resolution, image scale, or axis-view zoom.

## 3. Modeling and transforms

Use the controls above the scene hierarchy to create cubes, groups, locators, and shapes. A new cube is a 2×2×2 cube resting on the horizontal plane. An element created under a group starts relative to that group's pivot. The Shape menu contains prisms, polyhedra, and Bezier variants.

In Edit mode, `G` creates an empty group immediately after the last selected item, including when multiple items are selected. `Shift+G` or **Group elements** in an element or group's context menu wraps the selection in a new group in place. A single element or group can also be wrapped.

Shortcut fields in Settings accept keyboard keys and mouse side buttons (`Mouse4` / `Mouse5`), including combinations with `Ctrl`, `Shift`, and other modifiers. The first input after focusing replaces the previous binding. Press `Enter` or leave the field to save; `Esc` clears and disables that shortcut. Per-action and global resets restore defaults. In Paint mode, `G` remains the paint bucket.

| Shortcut | Tool |
| --- | --- |
| `1` | Move |
| `2` | Scale |
| `3` | Rotate |
| `4` | Move Pivot |
| `5` | Vertex Snap |
| `6` | Knife |
| `7` | Face Select |

The **Toolbox** in the Edit toolbar provides four categories, selected through its first dropdown:

New Cubes use the current theme accent as their initial display color. That color is saved on the element; changing themes does not recolor existing Cubes.

- **Uniform Scale**: drag the center cube upward to enlarge or downward to shrink. Snap the combined envelope dimensions, snap each element's dimensions separately, or disable snapping. The drag starts with a uniform factor; snapping rounds X/Y/Z independently, so the final proportions may differ slightly. It uses the current project grid and the configured `Shift`, `Ctrl`, and `Ctrl+Shift` precision. Changing modifiers during a drag takes effect immediately.
- **Flip**: six buttons reflect across X/Y/Z, either around the global origin or around the selection pivot. **Swap direction names** is on by default: it swaps `left/right`, `up/down`, or `front/before` for the flipped axis, matching case-insensitively and retaining the original case style. It recognizes separate words, delimiters, numbers, and camel-case parts, such as `LEFT_arm → RIGHT_arm` and `LeftArm → RightArm`, without changing ordinary words such as `group` or `backup`. Group collisions fill gaps in the project-wide numbering; automatically named children follow the final group name. Naming and geometry share one undo step. Disable the toggle to flip geometry alone; the preference survives restarting.
- **Rotate**: twelve buttons turn +90° or −90° about X/Y/Z, around either the world origin or the selection pivot. Seven rotation compensation buttons follow, ordered X, Y, Z, YZ, XZ, XY, and Global. They zero the requested world rotation axes through all parent groups; Global aligns to the world axes. Each selected root turns around its own pivot, with group contents following together. YZ, XZ, and XY icons use the X, Y, and Z axis colors respectively. Restricted Java Cubes fold whole quarter turns into dimensions and face UVs, changing the residual rotation axis when needed while preserving the existing tilt and appearance.
- **Center**: use the geometric center or pivot as the reference, then center one axis or all three at the origin.

Axis-button icons use red, green, and blue for X/Y/Z. Toolbox operations retain group hierarchy, procedural Shape parameters, and face UVs, respect the current model format, and create one undo step per click or complete drag. The existing Scale tool retains its axis and plane handles; Toolbox Uniform Scale shows only the center handle. Assign a Toolbox shortcut in Settings if desired.

The group's **Dissolve group** submenu offers two choices. **Dissolve normally** preserves world position and orientation and compensates each child's modifier and operator frames; formats that cannot store the inherited Cube rotation directly use a legal rotation group. **Without rotation compensation** removes the parent while retaining the children's original local transform values, so their world position and orientation change with the removed parent. Both choices keep child groups intact, promote direct children in order, preserve UVs and inherited inflation and visibility, and create one undo step.

XYZ symmetry modifiers enable **Remove existing direction words** by default. Baking and export strip existing direction parts before assigning the current prefix: `LeftArm → right_Arm / left_Arm`. Disabling it retains the original text: `right_LeftArm / left_LeftArm`. Each modifier saves its own option; it also applies to subgroups and standalone Cubes. Groups with colliding generated names receive numeric suffixes. Radial and mandala numbering is unchanged, and groups merged by overlap deduplication retain their original names.

Drag the six-dot `⠿` grip at the left of a modifier or operator heading to reorder its stack. The carried card shows only an opaque collapsed heading, while its actual expansion state stays unchanged. The drop guide follows pointer Y only and clamps to the first or last position outside the list. Wheel scrolling and edge autoscroll remain available during dragging. Evaluation order changes only on release, creating one undo step.

- Gizmos respond to the left mouse button; the middle button remains reserved for camera control. Axis, plane, and center handles perform the corresponding dimensional transforms.
- Move and Rotate can use local, parent, or global coordinates. Multiselection can apply transforms together or separately. Moving a pivot compensates object parameters so the visible geometry stays put. **Center Pivot** follows the Pivot X/Y/Z fields in Object Properties and places all selected pivots at the combined geometric center.
- Cube, group, and Shape properties offer **Apply Position / Rotation** and separate **Restore** actions. Applying resets the corresponding displayed values to zero so later edits start there; restoring shows the current effective values again. Neither action changes the visible model. A group's Position moves its descendants, while Pivot changes compensate them. Exports contain the final pose without the editor's baseline metadata.
- Element Copy nodes share their owner's parent coordinate system. Parent-group moves and rotations affect them; transforming the owner alone does not. Editing the parent's pivot while preserving geometry also preserves the nodes' world positions.
- Hold `Alt` while rotating to show the selected object's vertices temporarily. Click one to move its pivot there. Vertex Snap can also show intersections; square-diamond intersection marks can be target points, not starting points.
- `Ctrl+Z` undoes and `Ctrl+Shift+Z` redoes. With a text field focused, `Ctrl+Z` edits the text rather than undoing the project.
- `←` and `→` cycle through the current mode's tools in toolbar order. In Edit mode, `C` creates a cube and `S` opens the Shape creation menu at the pointer.
- After choosing a snapped Knife starting point on a cube face, the second click only chooses a horizontal or vertical cutting direction. It may land on another face, another object, or the background; the starting point determines the cube and cut position. Direction uses the starting face's extended plane, so the preview matches the final cut.
- With **Ghost Modifier Results** off, click a generated virtual element to select and edit its source. Its outline shifts the original outline hue by 180° while preserving saturation and brightness. Move, scale, rotation, and pivot handles follow the selected instance's position and orientation. Drags and exact angles are mapped back to the source, including reflected rotation directions. Right-click opens the source's menu. Copy nodes remain separately editable through their markers or hierarchy entries. Editing does not bake or create additional elements.
- Each project remembers the last tool used in each mode. Move, Rotate, and Move Pivot save their coordinate systems separately and default to local coordinates. Dock layouts automatically save panel order, sidebar widths, panel heights, floating positions, collapsed states, tab groups, and their selected tabs. The desktop app also stores the layout in `dock-layout.json` in its application data directory, so it can restore the layout after restarting without relying on the browser cache.
- `Ctrl+C` copies, `Ctrl+X` cuts, `Ctrl+V` pastes, and `Ctrl+D` duplicates in place. Depending on focus, these operate on eligible objects or textures.

## 4. UVs and texture templates

1. Create or import a texture in the left texture list, then drag its list item onto a model face. If multiple elements are selected, their faces in the same direction receive the texture. Reassigning a texture does not discard existing UV or tiling parameters.
2. Select faces and UV outlines in the texture view. Shift-marquee adds and Ctrl-marquee subtracts. Drag an outline or its edge to adjust UV position or size. `Ctrl` + wheel zooms the texture; the wheel scrolls vertically, `Shift` + wheel scrolls horizontally, and middle-drag pans freely.
3. With the texture view focused, `R` focuses selected UVs and `Shift+R` resets the texture view. UV data outside the image bounds is preserved for compatibility with unusual models, although ordinary dragging does not deliberately move it farther out.
4. **New Texture → Texture Template** repacks UVs from the current cube faces. Options include selected elements only, zero-area face cleanup, box UVs, canvas-size alignment, padding, and **Do Not Share UVs**. The latter is checked by default each time the dialog opens. Unchecking it allows faces with the same source and old UVs to reuse a new slot, even across different cubes.
5. **Preserve Layer Structure** is on by default. Each source texture's layers are remapped separately into the new UV layout, retaining groups, visibility, blend modes, and mask links. Multiple source textures become separate groups; faces with no texture go into a template base layer. Turn it off to output one flattened image. Box UVs default to off except where required by the model format.

The four fields below the texture view show X/Y origin and width W/height H. For ordinary UVs, moving the origin translates the whole rectangle, and resizing preserves its mirror orientation. Mixed values in a multi-selection show `-`.

The texture context menu's **Resize texture** offers Crop, Repeat, and Stretch. Stretch scales the UVs assigned to that texture along each axis and snaps their edges to physical pixel boundaries in the new image. Faces using other textures keep their UVs, including on the same cube. Shape UV edits are included; undo and redo restore pixels and UVs together. Exactly representable layouts keep box UVs; other layouts use per-face UVs where the format allows them. Formats requiring fixed box UVs reject incompatible ratios.

Change texture mode at the top of the Layers panel. Mode and creation controls stay visible while scrolling. In **Tiled** mode, the fields specify X/Y starting offsets and the entire face's pixel width/height. The source image repeats intact: a 16px-wide image repeats twice across a face whose W is 32px. These parameters are separate from ordinary UVs. Switch back to **Default** to edit the original UV coordinates.

With UV Preview's auto-focus option enabled, clicking a face switches to its assigned texture and focuses its UVs automatically.

Lines, rectangles, and ellipses on tiled faces use continuous face positions before their pixels wrap onto the source texture. Screen-space painting fills the actual projected footprint, keeping stroke width consistent with ordinary textures.

**Flipbook** is a separate checkbox available for both Default and Tiled textures. Open the layer editor using the gear beside the layer-creation controls; frame elements appear in its rightmost list. Use **+ Frame** to add one, drag a row to reorder, or right-click to copy, paste, cut, duplicate, or delete. With the frame list focused, `Ctrl+C/V/X/D` and `Delete` perform the same actions. Edits support undo and redo. Frames have no grouping or visibility controls.

The frame list appears only with Flipbook enabled. The window expands to the right with the list and a gap about half the layer-list width, preserving existing columns; smaller screens can scroll horizontally. Drag between dots for many-to-many links; the top-right port represents the entire layer list, and overflowing layer ports snap to its right border. Right-click a curve to disconnect it. Highlights follow the last selected frame or layer. Each frame composites only connected content; thick left edges mark effective members. Connected-group children have frame-local visibility controls in the editor. Painting is restricted to editable image layers in the current frame, which remembers its last paint layer and initially chooses the first editable one. The timeline supports scrubbing and clickable frame ticks; header controls set FPS and interpolation. Textures play independently and only their play/pause buttons change playback state. Other actions and focus changes do not pause them. The timeline appears automatically with Flipbook frames, without a visibility switch. PNG import reads a sibling `filename.png.mcmeta`, creating flat image layers and linked frames while preserving order, timing, and interpolation. Disabling Flipbook restores global visibility and retains frame settings. Original pixels, dimensions, and UVs remain intact.

The eyedropper skips fully transparent pixels and continues to deeper faces in 3D. Hold `Ctrl` to sample the final composite, including current-frame interpolation, blending, and masks, without lighting or shadows. This also works with the temporary `Alt` eyedropper.

### Exporting tiled and flipbook textures

Java Block/Item imports and exports native model `.json`; Bedrock Entity, Bedrock Block, and GeckoLib geometry use native geometry JSON. Multi-geometry files offer a choice, and Bedrock files without type metadata ask whether to import as an entity or block. Modded Entity exports a Java model layer using the Minecraft 1.17+ Mojang-mapped `createBodyLayer()` API. Only unchanged Java files exported by CubeBricks can be reimported; editing code or restoration metadata invalidates reimport.

Native JSON/Java export saves each baked PNG and any `.png.mcmeta` first, then asks for the model filename. Canceling any step stops model export. Java JSON uses resource locations; saving under `assets/<namespace>/textures/` infers the namespace automatically. A sibling `<model filename>.cbtextures.json` records actual relative image paths and material links for reimport; Bedrock geometry itself has no image-path field. Keep images and this index together when moving interchange files, and arrange resource-pack directories and materials when integrating into a game.

Texture context menus offer **Save Texture** and **Save Texture As**. New, copied, or edited unsaved textures show a clickable save icon on the right. Untouched imports and saved textures hide it. Saving writes the full composite; flipbooks write the complete strip and metadata. Editable layers remain part of the `.cbmodel` project.

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
- Paint Selection offers rectangle, brush, and freehand lasso modes. Shift adds and Ctrl subtracts. Drag inside a selection to lift its pixels and clear the mask. Click empty space to place the pixels or use Undo to cancel an unplaced transform. The dashed frame carries rotation and scale handles. Rotation snaps by 90° by default. Hold Shift for free rotation or Ctrl for 15° snapping. Angled rotations default to nearest-neighbor sampling and also offer smooth sampling. While scaling, hold Shift to keep the proportions at the start of the drag or Ctrl to restore the original proportions. In 3D, the handles are projected on the starting face and the pixels stay clipped to it. Enable selection symmetry to transform matching faces together.
- Right-click a selection in either paint view to copy, duplicate in place, or paste pixels. Duplicating or pasting places the current floating pixels before lifting the new ones. Floating pixels can also be deleted or moved to a new layer directly above their source.
- With the texture panel focused and a selection or floating pixels active, `Ctrl+X / C / V / D` cut, copy, paste, or duplicate pixels in place. Paste is also available in the texture view immediately after cutting. In Paint mode, `Delete` removes floating pixels and protects model elements.
- In the texture view, the bucket's Face and Element modes fill the current layer. The two matching-color modes still support the single-face restriction.
- Hold `Ctrl` while painting in the 3D viewport to use screen-space coordinates for the brush, line, rectangle, ellipse, bucket, and gradient. Erase mode works the same way. Set the virtual screen height in **Settings → Viewport**; its width follows the viewport aspect ratio. The next stroke returns to normal painting after releasing `Ctrl`.
- Hold `Shift` and scroll over the 2D texture or 3D viewport to adjust brush size: up increases it, down decreases it. Shape-tool thickness is adjusted independently, including in erase mode. Sizes stay within 1–64; the 2D cursor updates immediately, and the gesture does not zoom or pan the view. Rebind or disable **Adjust brush size with wheel** in shortcut settings. The `Alt` palette wheel retains priority.
- To use Paint Symmetry, first attach it on the element's or group's **Operators** property page, then edit its axis in the main viewport. It mirrors paint input without making new model geometry. Paint mode still allows visibility/lock changes in the hierarchy, but geometry changes require Edit mode.

## 6. Layers, palettes, and windows

The layer list supports new image layers or groups, drag reordering, collapse, and visibility toggles. The create controls stay visible while the list scrolls. Right-click a layer to merge it down or delete it; merging bakes the upper layer's blend result into the lower layer's pixels. Its gear opens the dedicated layer editor, which has the same layer context menu and controls for names, opacity, blend modes, tone mapping, and mask sources. Changing the active layer does not erase other layers. During painting, the preview recomposites only the affected region; the complete texture is saved when the stroke ends.

The context menu also offers Copy, Paste, and Duplicate Layer (`Ctrl+C`, `Ctrl+V`, and `Ctrl+D` while the layer list has focus). Group copies retain descendants and internal mask links with independent identities. Pasting into a selected group inserts children, while duplicating a group creates a sibling. Flipbook pastes connect to the current frame. **Binarize Alpha** leaves alpha 0 unchanged and sets every other pixel alpha to 255 without changing RGB. On groups it processes descendant image layers, preserving hierarchy, blending, and layer-opacity settings. Paste, duplicate, and binarization are undoable.

Palettes can be created, selected, reordered, deleted, and renamed from their context menu. Export saves the currently selected single palette as `.cbcmap`; import appends instead of replacing. New palettes belong to the current project by default and are saved with `.cbmodel`. Use the Project/Global button or context menu to share a palette across projects. A `.cbmodel` export also embeds global palettes referenced by its layers, so the recipient can still edit tone mapping. The palette list can use a compact display. Dock panels around the left, right, and bottom edges can detach, snap back near an edge, or merge by dropping onto another panel's header. Collapse and sizing are managed at each dock position.

## 7. Bone animation

1. Prepare groups in an animation-capable model, switch to Animation, and create a clip in Animation Manager. Transform tools cannot write keys without an active clip.
2. Clicking geometry selects its nearest group; Shift-click climbs to a parent. Move, Rotate, and matrix Scale write keys at the playhead and preview during dragging. Pivot still changes the base model.
3. Frame Properties separates position, scale, and rotation; unconfigured channels show `-`. Selecting one key shows its properties; selecting multiple keys hides them. Key selection does not move the playhead.
4. Drag the playhead to seek, holding Ctrl for subframe positions. Ctrl-wheel zooms the timeline. Key retiming uses horizontal position only and scrolls near the edges. A drop beyond the end extends the clip; hold Shift on release to clamp it inside the current end.
5. Right-click or right-drag the top ruler to set the end, which cannot precede the last key. Transport controls jump to the start or end.
6. Choose Once (return to start), Hold Last Frame, or Loop. Editing FPS changes preserve seconds; imported times retain fractional precision.
7. Open a model with matching groups before importing `.animation.json` from Animation Manager. Export the current clip or all clips there, or through the main export chooser. `.bbmodel` and `.cbmodel` can retain bone animation.

Expressions, sound/particle events, unmatched bones, and extension fields are retained for export but dynamic content is not fully previewed. Controllers and in-game references still require separate configuration.
