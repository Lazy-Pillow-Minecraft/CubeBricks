# User Guide

[简体中文](USER_GUIDE.md) · [README](../README.md) · [Getting started](GETTING_STARTED.en.md) · [Feature overview](FEATURES.en.md)

## 1. Create, save, and switch projects

1. Choose a project format from the model-type list on the start page or from **New** in the top bar. The format supplies initial snapping and UV capabilities. Java Block/Item version restrictions can be changed in Project Information.
2. Use the top tabs to switch between open projects or drag them to reorder. Right-click a tab to edit project information; middle-click it or use its hover-only close icon to close it.
3. `Ctrl+S` saves and `Ctrl+Shift+S` saves as a new file. Export uses the selected or typed extension to choose `.cbmodel` or `.bbmodel`.
4. On desktop exit, the retention prompt lists only projects created during this app launch. Unchecking one deletes its expanded working directory. Previously existing projects reopened during this launch are not in that deletion list.

## 2. Camera and selection

| Input | Result |
| --- | --- |
| Middle-drag | Orbit in the general view; pan in an axis view |
| `Shift` + middle-drag | Pan the general view |
| Mouse wheel | Zoom the main viewport |
| `R` / `Shift+R` | Focus selected content / return to scene center; when the texture view has focus, these instead focus or reset that view |
| Click the six-direction axis widget | Enter the corresponding orthographic axis view; click the same direction again to flip to the opposite side |
| Drag the axis widget | Leave the axis view and return to the general view |
| Left-click an object / empty background | Select one object / clear selection |
| Left-drag a marquee | Select within the rectangle; hold `Shift` to add or `Ctrl` to subtract |
| `Ctrl+A` | Select all eligible elements in the main viewport or hierarchy |

The hierarchy and main viewport share object selection. The list supports multiselection, search, drag reordering, and moving entries into groups. During a list drag, scroll with the wheel or move the pointer near an edge to autoscroll. Right-clicking an object or its list row opens the same object actions.

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
- Move and Rotate can use local, parent, or global coordinates. Multiselection can apply transforms together or separately. Moving a pivot compensates object parameters so the visible geometry stays put.
- Hold `Alt` while rotating to show the selected object's vertices temporarily. Click one to move its pivot there. Vertex Snap can also show intersections; square-diamond intersection marks can be target points, not starting points.
- `Ctrl+Z` undoes and `Ctrl+Shift+Z` redoes. With a text field focused, `Ctrl+Z` edits the text rather than undoing the project.
- `Ctrl+C` copies, `Ctrl+X` cuts, `Ctrl+V` pastes, and `Ctrl+D` duplicates in place. Depending on focus, these operate on eligible objects or textures.

## 4. UVs and texture templates

1. Create or import a texture in the left texture list, then drag its list item onto a model face. If multiple elements are selected, their faces in the same direction receive the texture. Reassigning a texture does not discard existing UV or tiling parameters.
2. Select faces and UV outlines in the texture view. Shift-marquee adds and Ctrl-marquee subtracts. Drag an outline or its edge to adjust UV position or size. `Ctrl` + wheel zooms the texture; the wheel scrolls vertically, `Shift` + wheel scrolls horizontally, and middle-drag pans freely.
3. With the texture view focused, `R` focuses selected UVs and `Shift+R` resets the texture view. UV data outside the image bounds is preserved for compatibility with unusual models, although ordinary dragging does not deliberately move it farther out.
4. **New Texture → Texture Template** repacks UVs from the current cube faces. Options include selected elements only, zero-area face cleanup, box UVs, canvas-size alignment, padding, and separate occupancy for multiple textures.
5. **Preserve Layer Structure** is on by default. Each source texture's layers are remapped separately into the new UV layout, retaining groups, visibility, blend modes, and mask links. Multiple source textures become separate groups; faces with no texture go into a template base layer. Turn it off to output one flattened image. Box UVs default to off except where required by the model format.

## 5. Painting

Switch to **Paint** in the top bar. Brush, Shape Drawing, Fill, Gradient, Eyedropper, and Selection are in the paint toolbar. Shape Drawing and Selection expose their submodes inside the tool. Common shortcuts are `B` for Brush, `L` for Line, `M` for Rectangle, `O` for Ellipse, `G` for Fill, `J` for Gradient, and `I` for Eyedropper. Hold `Alt` for a temporary eyedropper, then release it to return to the previous tool. If the current color belongs to the selected palette, Alt + wheel can also move through palette colors or gradient positions.

- Paint in the 2D texture view or directly on 3D model faces. A brush stroke can begin over empty 3D space and continue across faces. A face without an assigned texture does not silently receive the current texture; assign one first.
- Brush controls include size, square/round tip, antialiasing, opacity, and brush depth. Shape Drawing can fill its interior. Fill can cover multiple faces or positions during a single drag.
- Face and volume gradients use two points to define direction and cover the full target. They can use two color slots or the current palette. Palettes support discrete colors, continuous gradients, and 3D color-space curves.
- Paint Selection offers rectangle, brush, and freehand lasso modes. Shift adds and Ctrl subtracts. Painting is confined to the selection. In the 2D texture view, Pixel Transform can move, copy, or rotate selected pixels.
- To use Paint Symmetry, first attach it on the element's or group's **Operators** property page, then edit its axis in the main viewport. It mirrors paint input without making new model geometry. Paint mode still allows visibility/lock changes in the hierarchy, but geometry changes require Edit mode.

## 6. Layers, palettes, and windows

The layer list supports new image layers or groups, drag reordering, collapse, and visibility toggles. Its gear opens the dedicated layer editor, where you can change names, opacity, blend modes, tone mapping, and mask sources. Changing the active layer should not erase other layers; the full texture is composited from all of them.

Palettes can be created, selected, reordered, and deleted. Export saves the currently selected single palette as `.cbcmap`; import appends instead of replacing. The palette list can use a compact display. Dock panels around the left, right, and bottom edges can detach, snap back near an edge, or merge by dropping onto another panel's header. Collapse and sizing are managed at each dock position.
