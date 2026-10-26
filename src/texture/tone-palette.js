export function tonePaletteSnapshot(row, sampleGradient) {
  if (!row || !(row.colors?.length || row.colorSpaceGradient)) return null;
  const continuous = row.gradient || row.colorSpaceGradient;
  return {
    paletteId: row.id, paletteType: continuous ? 'continuous' : 'discrete',
    paletteSamples: continuous
      ? Array.from({ length: 256 }, (_, index) => sampleGradient(row, index / 255))
      : row.colors.slice(),
    anchorEnabled: false, anchorColorIndex: 0, anchorPercent: 50,
    anchorGray: 50, grayUnit: 'percent', segmentCount: 8
  };
}
