import assert from 'node:assert/strict';
import { COLOR_MAP_FORMAT, decodeColorMap, decodePaletteFile, encodeColorMap, encodePaletteFile } from '../src/screen/palette/color-map-file.js';
import { palettesForCbmodel } from '../src/common/core/project-palettes.js';
import { CubeBricksProject } from '../src/model.js';

const rows = [{
  id: 'palette-a', name: '測試色卡', colors: ['#112233', '#aabbcc'], gradient: true,
  marker: 0, gradientSegments: 'custom', gradientPositions: [0, 1],
  colorSpaceGradient: true, colorSpaceCurve: {
    mode: 'hsv_cylinder', nodes: [
      {
        id: 'node-1',
        position: [.1, .2, .3],
        handleIn: [-.1, 0, 0],
        handleOut: [.1, 0, 0],
        autoTangent: false,
        handlesEnabled: true,
        symmetricHandles: false
      },
      {
        id: 'node-2',
        position: [.8, .7, .6],
        handleIn: [-.2, 0, 0],
        handleOut: [.2, 0, 0],
        autoTangent: true,
        handlesEnabled: false,
        symmetricHandles: true
      }
    ]
  }
}];
const encoded = encodeColorMap(rows, 1234);
assert.equal(JSON.parse(encoded).format, COLOR_MAP_FORMAT);
const decoded = decodeColorMap(encoded);
assert.equal(decoded.updatedAt, 1234);
assert.equal(decoded.palettes[0].marker, 0, 'a marker at the beginning must survive the round trip');
assert.deepEqual(decoded.palettes[0].colors, rows[0].colors);
assert.equal(decoded.palettes[0].gradientSegments, 'custom');
assert.deepEqual(decoded.palettes[0].gradientPositions, [0, 1]);
assert.equal(decoded.palettes[0].colorSpaceCurve.nodes[0].autoTangent, false);
assert.equal(decoded.palettes[0].colorSpaceCurve.nodes[1].handlesEnabled, false);
assert.deepEqual(decodeColorMap(JSON.stringify(rows), { legacy: true }).palettes[0].colors, rows[0].colors,
  'previous localStorage color maps remain readable');
assert.throws(() => decodeColorMap(JSON.stringify({ format: COLOR_MAP_FORMAT, version: 99, palettes: rows })), /格式/);
assert.throws(() => decodeColorMap(encodeColorMap([{ ...rows[0], colors: ['not a color'] }])), /顏色/);
const portable = encodePaletteFile(rows[0]);
assert.equal(JSON.parse(portable).palette.colors.length, 2);
assert.equal(JSON.parse(portable).palettes, undefined, 'portable exports contain only the selected card');
assert.equal(JSON.parse(portable).palette.name, undefined, 'portable exports omit the local card name');
assert.equal(JSON.parse(portable).palette.id, undefined, 'portable exports omit the local card identity');
assert.equal(JSON.parse(encodePaletteFile({ ...rows[0], scope: 'global' })).palette.scope, undefined,
  'portable palette files do not impose the sender’s project/global scope');
const imported = decodePaletteFile(portable, '從檔名取得');
assert.equal(imported.length, 1);
assert.equal(imported[0].name, '從檔名取得');
assert.deepEqual(imported[0].colors, rows[0].colors);
assert.equal(imported[0].colorSpaceCurve.nodes[0].autoTangent, false);
assert.equal(decodePaletteFile(encoded, 'ignored').length, 1,
  'the previous multi-card export is still importable');
assert.deepEqual(decodeColorMap(encodeColorMap([])).palettes, [],
  'deleting the final card must survive persistence and reload');
assert.throws(() => decodePaletteFile(encodeColorMap([]), 'empty'), /沒有色卡/,
  'an empty collection is valid for local storage but not as a palette import');
const projectCard = { ...rows[0], scope: 'project' };
const globalCard = { id: 'palette-global', name: 'Shared', colors: ['#ff0000'], scope: 'global' };
const unusedCard = { id: 'palette-unused', name: 'Unused', colors: ['#00ff00'], scope: 'global' };
const embedded = palettesForCbmodel([projectCard], [projectCard, globalCard, unusedCard], [
  { layers: [{ blendMode: 'tone_map', toneMap: { paletteId: globalCard.id } }] }
]);
assert.deepEqual(embedded.map(row => row.id), [projectCard.id, globalCard.id],
  'native exports keep local cards and only globally referenced cards');
assert.equal(embedded[1].scope, 'project', 'a receiving project owns its embedded card');
assert.equal(globalCard.scope, 'global', 'export must not change the sender’s global card');
const firstProject = new CubeBricksProject({ palettes: [projectCard] });
const reopenedProject = new CubeBricksProject(JSON.parse(firstProject.serialize()));
const nextProject = new CubeBricksProject({});
assert.deepEqual(reopenedProject.palettes.map(row => row.id), [projectCard.id],
  'project palettes persist in the native model document');
assert.deepEqual(nextProject.palettes, [], 'a new project does not inherit another project’s local cards');
console.log('Color map file tests passed.');
