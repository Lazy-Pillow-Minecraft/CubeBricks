# CubeBricks 0.2.3-beta release notes

[简体中文](RELEASE_0.2.3-beta.md) · [README](../README.md)

Released 2026-11-21. Installer: `CubeBricks-v0.2.3-beta-win-x64-setup.exe`.

These notes cover changes since the original **0.2.2-beta**, including the intervening hotfix and dated builds.

## Animation editing

- Animation-capable formats now have an Animation Manager, Frame Properties, and a bottom Keyframes dock. Create, rename, and remove clips; set the editing FPS, end frame, and playback mode.
- Animation selection targets groups. Clicking geometry selects its nearest group; Shift-click climbs the hierarchy. The hierarchy shows groups only, with dim locator badges where applicable and no unnecessary disclosure controls on leaf groups.
- Move, Scale, Rotate, Pivot, and Toolbox remain available. Move/rotation/matrix-scale edits write animation keys; Pivot still edits the base model. Other animation transforms leave the rest geometry intact.
- Nonzero handle changes write keys immediately and a complete drag is one undo operation. Unconfigured channels show `-`. Editor-created tracks automatically receive a default start key when their first key is placed later; an existing start key remains authoritative.
- Gizmos keep their shape despite scaled or sheared geometry. Fixes cover pose changes on release, lost full rotation turns, and the accumulation of animation channels with a bone's rest rotation.

## Timeline and playback

- Flat, pinned group labels; a checkerboard track area; one centerline per row; ticks in the ruler only. The name divider fills the panel height, and an inactive margin precedes frame zero.
- Scroll beyond the end frame; Ctrl-wheel changes density while major and minor ticks adapt. Large zoom levels no longer produce stray ruler lines.
- A themed line and inverted triangle indicate playback time. Hold Ctrl while scrubbing for subframe positioning.
- Keys move horizontally within their own row, regardless of pointer height, with edge autoscroll. Dropping beyond the end extends the clip; holding Shift clamps the drop within its existing duration.
- Right-click or right-drag the ruler sets the end directly. A themed `]` marks it, the following ruler is dimmed, and the end cannot precede the last key.
- Key selection is independent of playback position. Multiple keys can be selected, with Frame Properties hidden for multiple selection; only actual keys show a drag cursor.
- Playback modes: once and return to start, hold last frame, or loop. Fixes remove the extra frame from cycle duration. Fractional times survive editing, and changing FPS preserves seconds.

## Animation interchange and rendering

- Import/export Bedrock `.animation.json` from Animation Manager or the main export chooser. Imports attach to the current model; exports support the current clip or all clips and share the geometry exporter's bone naming rules.
- Numeric position, rotation, scalar/vector scale, `pre/post`, linear interpolation, and Catmull-Rom are supported. Untouched timestamps, expressions, extension fields, and unmatched bones are preserved.
- `.bbmodel` interchange now carries bone animations; `.cbmodel` and project history preserve animation data and native metadata.
- Per-group mesh caches update matrices during playback. Background preparation and retained Edit-mode caches reduce repeated mesh construction when switching modes.
- **Limitations:** Molang, sound/particle events, entity-relative rotation, and similar dynamic content are preserved but not fully evaluated in preview. Animation controllers and in-game wiring are not implemented. Unsupported interpolation is reported instead of silently substituted.

## Modeling and groups

- New Toolbox after Face Select: uniform scaling, flip, quarter-turn rotation, and centering. Scaling supports bounding-box snapping, individual-element snapping, or no snapping; dimensions snap independently and Shift/Ctrl precision can change during a drag.
- Flip around world origin or pivot, rotate ±90° on each axis around either center, and center geometry or pivots per axis or globally.
- Seven rotation-compensation actions: X, Y, Z, YZ, XZ, XY, and global, accounting for parent orientation.
- Optional directional renaming swaps `left/right`, `up/down`, and `front/before` fragments while preserving case and avoiding ordinary words. Group-name conflicts are resolved; symmetry baking can clear previous direction words before assigning new ones.
- Group Selected also wraps a single element. G creates an empty sibling group; Shift+G groups the selection.
- Dissolve Group supports compensated and uncompensated rotation. Clicking the parent menu item performs normal dissolution; child groups remain intact, with ordering, UV, inflation, visibility, and lock handling preserved.
- Knife endpoints can be on another face, another element, or the background; the start determines the cut object and the endpoint determines direction.
- Generated modifier results can be selected and edited through their source with correctly placed gizmos. Their selection outline shifts hue while preserving saturation and brightness.
- Modifier/operator ordering uses six-dot handles and compact collapsed-title drag previews, with wheel and edge scrolling and a single commit on release.

## Formats, textures, and painting

- Java Block/Item projects can disable region bounds; out-of-bounds bbmodel imports disable them automatically and preserve the format settings.
- Correct quarter-turn folding for restricted Java cubes, retaining their remaining angle, negative dimensions, and hidden faces; fixes for inflation and procedural bake/export transforms.
- Copy-modifier nodes use their owner's sibling frame: independent of the owner's own transforms but following ancestors.
- Resize Texture offers crop, repeat, and stretch. Stretch updates assigned UVs on actual pixel boundaries, with layer and undo support.
- Generate evenly distributed random dots with minimum spacing on a layer; optionally generate once for each painting-symmetry relationship and copy to its partners.
- Shift-wheel changes brush/shape size in 2D and 3D; Alt eyedropper/palette scrolling keeps priority. Alt enables bidirectional scaling; negative starting dimensions reverse the corresponding scale handle without flipping it mid-drag.
- Responsive color-picker sizing and corrected triangle-ring markers. Palette ordering works again; gradient-node rings and stems follow the theme without gaps.
- Fixed Ignore Fully Transparent errors. Per-stroke alpha snapshots prevent unintended repeated penetration while erasing; regional texture snapshots reduce the cost of small edits on large textures.
- More robust rapid-paint commit ordering, failure handling, and journal retries; retrying one request does not create duplicate history operations. Damaged noncurrent history records remain marked while readable records can still be shown; checkout continues to validate target data.

## Workspace and appearance

- Violet and monochrome palettes plus six low-border block-style variants, for 12 themes. Each supports light, dark, or system mode. Removed five individual color overrides and fixed theme persistence.
- Number fields share left/right steppers, horizontal dragging, and hover-wheel adjustment with context-appropriate snapping. Viewport tooltips show the signed amount of the active handle.
- Dock layout, size, collapse, merged tabs, and active tab are persisted independently, with stale-layout restoration fixes.
- Per-mode corner controls choose whether side or bottom docks extend to the window edge. Edit/Paint default to side priority; Animation defaults to bottom priority.
- Animation defaults to management/properties on the left, hierarchy on the right, and timeline below. UV Preview and Object Properties are hidden there; Paint/Animation hierarchy search shares the count row.
- Improved group insertion regions, end-of-group snapping, indented drag overlays, node guides, and copy-node refresh/collapse behavior.
- Reference-image glow has constant screen width; reference locking prevents accidental editing while retaining color sampling.
- Mouse-side-button shortcuts and Esc-to-clear bindings; interface scaling down to 50%; new cubes inherit the creation-time theme color.
- Desktop process branding and startup fixes, updated menu/button icons and themed dropdowns, and additional stable translation keys.

## Short upload note

0.2.3-beta introduces group animation, a keyframe timeline, three playback modes, and Bedrock animation JSON interchange. It consolidates the Toolbox, rotation compensation, grouping/dissolution, texture resize, random dots, themes, number controls, and fixes for dock persistence, UV/baking, rapid painting, and history since 0.2.2. Dynamic animation scripts, event preview, and controllers remain in progress.
