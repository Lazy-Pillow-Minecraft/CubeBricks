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

For three independent X, Y, and Z dimensions, add `dimensionKeys: ['width', 'height', 'depth']` to the definition and declare those three numeric keys in `fields`. The inspector groups them into one XYZ size row, and resize handles edit each axis independently. Packs without `dimensionKeys` keep their separate numeric fields.

`utils` exposes the public modules under `src/utils/`: `utils.math.vector3`, `utils.math.rotation`, `utils.shape.polyhedronGeometry`, `utils.shape.bezierGeometry`, `utils.shape.javaCurveFit`, and `utils.templatePacker`. Namespaces prevent collisions between functions from different modules. When adding a public utility, update `src/utils/index.js`. Utilities provide calculations; they do not bypass cube-count or format constraints.

Built-in Shapes follow the same registration interface and live in separate files under `src/shapes/`. Polygon, dodecahedron, soccer ball, and the two Bezier variants have their own definitions; shared geometry lives under `src/utils/shape/`.

## Optional format adaptation

Shape and modifier definitions share the defaults from `FormatConstraintDefinition`: `constrainFormat(subject, context)` does nothing, and `supportsFormat(rules)` returns `true`. Existing packs need no changes. Override these methods when your generator needs format-specific behavior.

```js
constrainFormat(subject, context) {
  return context.utils.format.procedural.constrainBuiltinShape(subject, context);
},
supportsFormat(rules) {
  return true;
}
```

The context contains `phase`, `owner`, `project`, `rules`, and shared `utils`. During `parameters`, the subject is the Shape being constrained at creation, load, or edit time. During `geometry`, it is the generated Cube array; update that array or return a replacement. Geometry evaluation must not modify the source Shape, project, or external caches. With subdivision overrides, the editor adapts the base geometry, applies overrides, then constrains the result again; geometry hooks must tolerate repeated evaluation without cumulative drift. `toBaseCubes()` returns raw generated geometry, `toFormatBaseCubes()` supplies the adapted subdivision baseline, and `toCubes()` returns the final result.

Rules include `javaBlock`, `bedrockBlock`, `moddedEntity`, `version`, `singleAxisRotation`, `rotationStep`, `integerCubeSize`, `allowCubeRotation`, and `allowBoxUv`. Shared helpers are also available through `utils.format.constraints`. Return `false` from `supportsFormat` for unsupported formats: creation is disabled, existing object data is retained, and export asks for a supported format.

The built-in adapter fits legal Java orientations while preserving editable face identities and UVs, fits Bedrock Block assemblies uniformly inside their dynamic domain, and generates integer-sized, box-UV modded entity Cubes whose directions become group rotations when baked. The two spherical polyhedra currently exclude both single-axis Java versions. An empty default hook does not automatically make arbitrary external geometry valid in every format; pack authors choose the adaptation policy.

Java fitting chooses legal angles using geometric direction and dimensions, preserving a beam's cross-section and physical center instead of enlarging it into a bounding box. Curves prioritize their tangents. Only when angular error would move the path outside that cross-section are additional oriented segments fitted along the path, retaining thickness and continuity. The unrestricted version keeps the original geometry.

Modifier definitions use the same interface, currently in the `parameters` phase. Their context additionally carries the preceding-result evaluation cache, `evaluation`. Built-in symmetry and element-copy adapters use it to constrain axes, angles, copy counts, and node positions. Read-only preview evaluates a modifier copy without writing project history. This interface does not yet enable external modifier packs.

## Security

Shape scripts execute in the editor process, effectively installing executable extension code. Only place packs you wrote or trust in `shapepacks/`. ZIP is packaging, not a security sandbox. Load failures show a notification and are logged to the console; they do not delete Shape data from the project.
