import { constrainColorPosition } from '../color-space-gradient.js';

export const COLOR_MAP_FORMAT = 'cubebricks-color-map';
export const COLOR_MAP_VERSION = 1;
export const COLOR_MAP_MAX_BYTES = 2 * 1024 * 1024;

const clamp01 = value => Math.max(0, Math.min(1, value));
const vector = (value, fallback) => Array.from({ length: 3 }, (_, axis) => {
  const number = Number(value?.[axis]);
  return Number.isFinite(number) ? number : fallback[axis];
});

export function decodeColorMap(data, { legacy = false } = {}) {
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  const rows = legacy && Array.isArray(parsed)
    ? parsed.filter(row => row && typeof row.name === 'string' && Array.isArray(row.colors))
    : parsed?.format === COLOR_MAP_FORMAT && parsed?.version === COLOR_MAP_VERSION ? parsed.palettes : null;
  if (!Array.isArray(rows) || rows.length > 256) throw new Error('色卡檔案格式或數量無效');
  const palettes = rows.map(row => {
    if (!row || typeof row.name !== 'string' || !Array.isArray(row.colors)
      || !legacy && (row.colors.length > 256 || row.colors.some(color => !/^#[0-9a-f]{6}$/i.test(color)))) {
      throw new Error('色卡名稱或顏色資料無效');
    }
    const mode = row.colorSpaceCurve?.mode;
    const nodes = row.colorSpaceCurve?.nodes;
    const validCurve = ['hsv_cube', 'rgb_cube', 'hsv_cylinder'].includes(mode)
      && Array.isArray(nodes) && nodes.length >= 2 && nodes.length <= 128;
    const curve = validCurve ? {
      mode, revision: 0,
      nodes: nodes.map(entry => {
        const node = entry && typeof entry === 'object' ? entry : {};
        return {
          id: typeof node.id === 'string' && node.id ? node.id : crypto.randomUUID(),
          position: constrainColorPosition(vector(node.position, [0, 0, 0]), mode),
          handleIn: vector(node.handleIn, [-.12, 0, 0]),
          handleOut: vector(node.handleOut, [.12, 0, 0]),
          handlesEnabled: node.handlesEnabled !== false,
          autoTangent: node.autoTangent !== false,
          symmetricHandles: node.symmetricHandles !== false
        };
      })
    } : null;
    const marker = Number(row.marker);
    return {
      id: typeof row.id === 'string' && row.id ? row.id : crypto.randomUUID(),
      name: row.name.slice(0, 100), colors: legacy
        ? row.colors.filter(color => /^#[0-9a-f]{6}$/i.test(color)).slice(0, 256) : [...row.colors],
      gradient: Boolean(row.gradient), marker: Number.isFinite(marker) ? clamp01(marker) : .5,
      gradientSegments: ['equal', 'custom', 'curve_length'].includes(row.gradientSegments) ? row.gradientSegments : 'equal',
      gradientPositions: Array.isArray(row.gradientPositions) ? row.gradientPositions.slice(0, 256)
        .map(value => Number.isFinite(Number(value)) ? clamp01(Number(value)) : 0) : [],
      colorSpaceGradient: Boolean(row.colorSpaceGradient), colorSpaceCurve: curve
    };
  });
  const ids = new Set();
  for (const row of palettes) {
    if (ids.has(row.id)) row.id = crypto.randomUUID();
    ids.add(row.id);
  }
  return { palettes, updatedAt: Number.isFinite(Number(parsed?.updatedAt)) ? Number(parsed.updatedAt) : 0 };
}

export function encodeColorMap(palettes, updatedAt = Date.now()) {
  return JSON.stringify({ format: COLOR_MAP_FORMAT, version: COLOR_MAP_VERSION, updatedAt, palettes }, null, 2);
}

// Portable .cbcmap files carry exactly one card. Its local identity and name
// belong to the receiving workspace, not to the reusable color definition.
export function encodePaletteFile(row) {
  if (!row) throw new Error('請先選擇色卡');
  const { id, name, ...palette } = row;
  return JSON.stringify({ format: COLOR_MAP_FORMAT, version: COLOR_MAP_VERSION, palette }, null, 2);
}

export function decodePaletteFile(data, name) {
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  if (parsed?.format === COLOR_MAP_FORMAT && parsed?.version === COLOR_MAP_VERSION && parsed.palette) {
    const palette = { ...parsed.palette, id: crypto.randomUUID(), name };
    return decodeColorMap({ format: COLOR_MAP_FORMAT, version: COLOR_MAP_VERSION, palettes: [palette] }).palettes;
  }
  // Accept files exported by the earlier multi-card implementation too.
  const palettes = decodeColorMap(parsed).palettes;
  if (!palettes.length) throw new Error('匯入檔案沒有色卡');
  return palettes;
}
