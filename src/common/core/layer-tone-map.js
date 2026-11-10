const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const hexRgb = hex => /^#[0-9a-f]{6}$/i.test(hex || '')
  ? [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)) : null;
const gray = (red, green, blue) => .2126 * red + .7152 * green + .0722 * blue;

// Palette order is intentionally bright at the left and dark at the right.
export function toneMapStops(settings) {
  const samples = (Array.isArray(settings?.paletteSamples) ? settings.paletteSamples : []).map(hexRgb).filter(Boolean);
  if (!samples.length) return [];
  if (settings.paletteType !== 'continuous') return samples;
  const count = clamp(Math.round(Number(settings.segmentCount) || 8), 2, 256);
  const anchor = settings.anchorEnabled === true;
  const percentage = clamp(Number(settings.anchorPercent) || 0, 0, 100) / 100;
  const anchorIndex = anchor ? Math.round(percentage * (count - 1)) : -1;
  return Array.from({ length: count }, (_, index) => {
    const position = !anchor ? index / (count - 1)
      : index <= anchorIndex ? (anchorIndex ? percentage * index / anchorIndex : percentage)
        : percentage + (1 - percentage) * (index - anchorIndex) / (count - 1 - anchorIndex);
    const sampleIndex = clamp(Math.round(position * (samples.length - 1)), 0, samples.length - 1);
    return samples[sampleIndex];
  });
}

const toneMapLookupCache = new WeakMap();

function toneMapLookup(settings) {
  if (!settings || typeof settings !== 'object') return null;
  const signature = JSON.stringify(settings);
  const cached = toneMapLookupCache.get(settings);
  if (cached?.signature === signature) return cached.lookup;
  const stops = toneMapStops(settings);
  if (!stops.length) return null;
  const minimum = 0, maximum = 255;
  const anchor = settings?.anchorEnabled === true && stops.length > 1;
  const anchorIndex = settings.paletteType === 'continuous'
    ? Math.round(clamp(Number(settings.anchorPercent) || 0, 0, 100) / 100 * (stops.length - 1))
    : clamp(Math.round(Number(settings.anchorColorIndex) || 0), 0, stops.length - 1);
  const configuredGray = Number(settings.anchorGray ?? (settings.grayUnit === 'percent' ? 50 : 128));
  const anchorGray = clamp(Number.isFinite(configuredGray) ? configuredGray : 128, 0,
    settings.grayUnit === 'percent' ? 100 : 255) * (settings.grayUnit === 'percent' ? 2.55 : 1);
  const grayStops = Array.from({ length: stops.length }, (_, index) => {
    if (!anchor) return maximum - (maximum - minimum) * index / Math.max(1, stops.length - 1);
    if (anchorIndex === 0) return anchorGray - (anchorGray - minimum) * index / (stops.length - 1);
    if (anchorIndex === stops.length - 1) return maximum - (maximum - anchorGray) * index / (stops.length - 1);
    if (index <= anchorIndex) return maximum - (maximum - anchorGray) * index / Math.max(1, anchorIndex);
    return anchorGray - (anchorGray - minimum) * (index - anchorIndex) / Math.max(1, stops.length - 1 - anchorIndex);
  });
  const lookup = new Uint8Array(256 * 3);
  for (let brightness = 0; brightness < 256; brightness++) {
    let nearest = 0, distance = Infinity;
    for (let index = 0; index < grayStops.length; index++) {
      const next = Math.abs(grayStops[index] - brightness);
      if (next < distance) {
        distance = next;
        nearest = index;
      }
    }
    lookup.set(stops[nearest], brightness * 3);
  }
  toneMapLookupCache.set(settings, { signature, lookup });
  return lookup;
}

export function mapLayerTonePixels(pixels, settings) {
  const lookup = toneMapLookup(settings);
  if (!lookup) return pixels;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (!pixels[offset + 3]) continue;
    const colorOffset = clamp(Math.round(gray(pixels[offset], pixels[offset + 1], pixels[offset + 2])), 0, 255) * 3;
    pixels[offset] = lookup[colorOffset];
    pixels[offset + 1] = lookup[colorOffset + 1];
    pixels[offset + 2] = lookup[colorOffset + 2];
  }
  return pixels;
}
