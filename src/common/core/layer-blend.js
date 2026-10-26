export const LAYER_BLEND_MODES = Object.freeze([
  ['normal', '一般'],
  ['multiply', '正片疊底／相乘'],
  ['screen', '濾色'],
  ['add', '相加'],
  ['subtract', '相減'],
  ['hue', '按色相'],
  ['value', '按明度'],
  ['saturation', '按飽和度'],
  ['grayscale', '按灰度']
]);

const limit = value => Math.max(0, Math.min(255, value));
const luminance = ([r, g, b]) => .2126 * r + .7152 * g + .0722 * b;

function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const highest = Math.max(r, g, b), lowest = Math.min(r, g, b), delta = highest - lowest;
  let hue = 0;
  if (delta) {
    if (highest === r) hue = ((g - b) / delta) % 6;
    else if (highest === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = (hue / 6 + 1) % 1;
  }
  return [hue, highest ? delta / highest : 0, highest];
}

function hsvToRgb([hue, saturation, value]) {
  const cycle = (offset) => {
    const channel = (hue * 6 + offset) % 6;
    return Math.round(255 * value * (1 - saturation * Math.max(0, Math.min(1, Math.min(channel, 4 - channel)))));
  };
  return [cycle(5), cycle(3), cycle(1)];
}

function setVisualLuminance(color, requested) {
  const current = luminance(color);
  let result = color.map(channel => channel + requested - current);
  const low = Math.min(...result), high = Math.max(...result);
  if (low < 0) result = result.map(channel => requested + (channel - requested) * requested / (requested - low));
  if (high > 255) {
    const maximum = Math.max(...result);
    result = result.map(channel => requested + (channel - requested) * (255 - requested) / (maximum - requested));
  }
  return result.map(limit);
}

// The lower pixel supplies every component except the one named by the mode.
export function blendLayerRgb(lower, upper, mode = 'normal') {
  switch (mode) {
    case 'multiply': return lower.map((channel, index) => channel * upper[index] / 255);
    case 'screen': return lower.map((channel, index) => 255 - (255 - channel) * (255 - upper[index]) / 255);
    case 'add': return lower.map((channel, index) => limit(channel + upper[index]));
    case 'subtract': return lower.map((channel, index) => limit(channel - upper[index]));
    case 'hue': {
      const base = rgbToHsv(lower), source = rgbToHsv(upper);
      return hsvToRgb([source[0], base[1], base[2]]);
    }
    case 'value': {
      const base = rgbToHsv(lower), source = rgbToHsv(upper);
      return hsvToRgb([base[0], base[1], source[2]]);
    }
    case 'saturation': {
      const base = rgbToHsv(lower), source = rgbToHsv(upper);
      return hsvToRgb([base[0], source[1], base[2]]);
    }
    case 'grayscale': return setVisualLuminance(lower, luminance(upper));
    default: return upper;
  }
}

export function blendLayerImageData(lower, upper, opacity, mode) {
  const strength = Math.max(0, Math.min(1, Number(opacity) / 100));
  if (!strength) return lower;
  const componentMode = mode === 'hue' || mode === 'value' || mode === 'saturation' || mode === 'grayscale';
  for (let index = 0; index < lower.length; index += 4) {
    const sourceAlpha = upper[index + 3] / 255 * strength;
    if (!sourceAlpha) continue;
    const baseAlpha = lower[index + 3] / 255;
    const outputAlpha = sourceAlpha + baseAlpha * (1 - sourceAlpha);
    const blend = componentMode ? blendLayerRgb(
      [lower[index], lower[index + 1], lower[index + 2]],
      [upper[index], upper[index + 1], upper[index + 2]], mode) : null;
    for (let channel = 0; channel < 3; channel++) {
      const base = lower[index + channel], source = upper[index + channel];
      let blended = source;
      if (blend) blended = blend[channel];
      else if (mode === 'multiply') blended = base * source / 255;
      else if (mode === 'screen') blended = 255 - (255 - base) * (255 - source) / 255;
      else if (mode === 'add') blended = limit(base + source);
      else if (mode === 'subtract') blended = limit(base - source);
      lower[index + channel] = (sourceAlpha * (1 - baseAlpha) * source
        + sourceAlpha * baseAlpha * blended
        + baseAlpha * (1 - sourceAlpha) * base) / outputAlpha;
    }
    lower[index + 3] = outputAlpha * 255;
  }
  return lower;
}
