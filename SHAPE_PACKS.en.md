# CubeBricks Shape Pack Authoring

[简体中文](SHAPE_PACKS.md) · [README](README.md) · [Add-on pack index](docs/ADDON_PACKS.en.md) · [Architecture](ARCHITECTURE.en.md)

The desktop app reads `shapepacks/` under the configured workspace. A pack can be a folder or a `.zip` containing the same structure. A ZIP may put `package.json` at its root or wrap the package in one top-level folder. The displayed pack name comes from the outer folder or ZIP filename, not from a name inside `package.json`. Use **Settings → General → Manage Resource Packs** to install ZIPs, reorder, remove, or hot-reload packs. Folder packs can also be placed into the directory manually, followed by a refresh.

```text
<workspace>/
  projects/                 Expanded operation journals for new projects
  shapepacks/
    MyShapes/               Displayed pack name: MyShapes
      package.json
      shapes/
        arch.js
        arch.svg             Optional; falls back to the built-in Shape icon
    AnotherPack.zip
```

The `package.json` manifest stores the pack version and lists each Shape script and icon. Set `hotReload: false` to hide that pack's hot-reload button; omission allows hot reload. Shape IDs must be globally unique across packs and must not claim a built-in ID.

```json
{
  "version": "1.0.0",
  "shapes": [
    { "id": "sample_arch", "label": "Arch", "file": "arch.js", "icon": "arch.svg" }
  ]
}
```

`file` and `icon` must each be a single filename inside `shapes/`. Icons may be SVG, PNG, or WebP. If `icon` is omitted, the generic built-in Shape icon is used. A pack script must be a self-contained ES module with `export default`; relative `import` is not currently supported. Shared editor utilities arrive through the `utils` parameter of `generate`. Each script is limited to 128 KiB, a ZIP to 16 MiB, and one generation to 10,000 cubes.

```js
export default {
  id: 'sample_arch',                 // Must match package.json; permanent Shape type ID in projects
  label: 'Arch',                     // The manifest label is used in the interface
  defaults: { width: 8, height: 8 }, // Initial shape.parameters
  fields: [
    { key: 'width', label: 'Width', min: 0.1, step: 0.1 },
    { key: 'height', label: 'Height', min: 0.1, step: 0.1 }
  ],
  generate(shape, { Cube, utils }) {
    const width = Number(shape.parameters.width);
    const height = Number(shape.parameters.height);
    const halfWidth = utils.math.vector3.dot3([width, 0, 0], [0.5, 0, 0]);
    return [new Cube({
      name: `${shape.name}_1`,
      position: [-halfWidth, 0, -0.5],
      size: [width, height, 1],
      pivot: [0, height / 2, 0],
      rotation: [0, 0, 0],
      uvMode: shape.uvMode,
      uvNormalized: shape.uvNormalized,
      autoUv: shape.autoUv,
      exported: shape.exported,
      locked: shape.locked,
      shade: shape.shade,
      color: shape.color
    })];
  }
};
```

`generate(shape, api)` must return an array of cubes synchronously. Plain objects suitable for `new Cube(...)` are also accepted. Generated cubes use Shape-local coordinates. The editor subsequently applies the Shape's `origin`, `pivot`, `rotation`, parent-group transform, subdivision overrides, and modifiers; do not add `origin` inside `generate` a second time. `shape.parameters` stores editable values. The generic property panel currently renders numeric `fields` automatically. The Shape ID, parameters, and subdivision overrides are saved in `.cbmodel`. If the pack is missing, the project retains the data but does not generate geometry; reinstalling the pack restores it.

`utils` exposes the public modules under `src/utils/`: `utils.math.vector3`, `utils.math.rotation`, `utils.shape.polyhedronGeometry`, `utils.shape.bezierGeometry`, and `utils.templatePacker`. Namespaces prevent collisions between functions from different modules. When adding a public utility, update `src/utils/index.js`. Utilities provide calculations; they do not bypass cube-count or format constraints.

Built-in Shapes follow the same registration interface and live in separate files under `src/shapes/`. Polygon, dodecahedron, soccer ball, and the two Bezier variants have their own definitions; shared geometry lives under `src/utils/shape/`.

## Security

Shape scripts execute in the editor process, effectively installing executable extension code. Only place packs you wrote or trust in `shapepacks/`. ZIP is packaging, not a security sandbox. Load failures show a notification and are logged to the console; they do not delete Shape data from the project.
