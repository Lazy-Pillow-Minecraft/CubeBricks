// Native models own their local palettes. Export only the global palettes
// referenced by a tone-mapped layer, so a receiving user can edit that layer.
export function palettesForCbmodel(localPalettes = [], availablePalettes = [], textureAssets = []) {
  const result = localPalettes.map(row => ({ ...structuredClone(row), scope: 'project' }));
  const known = new Set(result.map(row => row.id));
  const available = new Map(availablePalettes.map(row => [row.id, row]));
  for (const asset of textureAssets) for (const layer of asset.layers || []) {
    const id = layer.toneMap?.paletteId;
    if (layer.blendMode !== 'tone_map' || !id || known.has(id)) continue;
    const row = available.get(id);
    if (!row) continue;
    result.push({ ...structuredClone(row), scope: 'project' });
    known.add(id);
  }
  return result;
}
