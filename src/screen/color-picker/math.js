const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function rgbToHsv(rgb) {
  const [red, green, blue] = rgb.map(channel => clamp(Number(channel) || 0, 0, 255) / 255);
  const maximum = Math.max(red, green, blue), minimum = Math.min(red, green, blue);
  const range = maximum - minimum;
  let hue = 0;
  if (range > 1e-8) {
    if (maximum === red) hue = ((green - blue) / range) % 6;
    else if (maximum === green) hue = (blue - red) / range + 2;
    else hue = (red - green) / range + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  return [hue, maximum <= 1e-8 ? 0 : range / maximum, maximum];
}

export function hsvToRgb(hue, saturation, value) {
  const h = ((Number(hue) % 1) + 1) % 1 * 6;
  const s = clamp(Number(saturation) || 0, 0, 1), v = clamp(Number(value) || 0, 0, 1);
  const chroma = v * s, intermediate = chroma * (1 - Math.abs(h % 2 - 1)), offset = v - chroma;
  const segments = [[chroma, intermediate, 0], [intermediate, chroma, 0], [0, chroma, intermediate],
    [0, intermediate, chroma], [intermediate, 0, chroma], [chroma, 0, intermediate]];
  return segments[Math.min(5, Math.floor(h))].map(channel => Math.round((channel + offset) * 255));
}

export function rgbToHex(rgb) {
  return `#${rgb.map(channel => clamp(Math.round(Number(channel) || 0), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

const COLOR_CONTROL_INSET = 2;
export const TRIANGLE_RING_WIDTH = 14;
const TRIANGLE_FIELD_INSET = 22;

export function insetControlRatio(clientCoordinate, start, length) {
  return clamp((clientCoordinate - start - COLOR_CONTROL_INSET)
    / Math.max(1, length - COLOR_CONTROL_INSET * 2), 0, 1);
}

export function insetControlPosition(ratio, inset = COLOR_CONTROL_INSET) {
  const normalized = clamp(ratio, 0, 1);
  return `calc(${normalized * 100}% + ${inset - normalized * inset * 2}px)`;
}

export function trianglePickerGeometry(rect) {
  const width = rect.width, height = rect.height;
  const center = [width / 2, height / 2];
  const radius = Math.max(2, Math.min(width, height) / 2 - TRIANGLE_FIELD_INSET);
  return {
    hue: [center[0], center[1] - radius],
    white: [center[0] - radius * Math.sqrt(3) / 2, center[1] + radius / 2],
    black: [center[0] + radius * Math.sqrt(3) / 2, center[1] + radius / 2]
  };
}

export function barycentric2d(point, a, b, c) {
  const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(denominator) < 1e-8) return null;
  const first = ((b[1] - c[1]) * (point[0] - c[0]) + (c[0] - b[0]) * (point[1] - c[1])) / denominator;
  const second = ((c[1] - a[1]) * (point[0] - c[0]) + (a[0] - c[0]) * (point[1] - c[1])) / denominator;
  return [first, second, 1 - first - second];
}

export function closestPointOnSegment2d(point, start, end) {
  const direction = [end[0] - start[0], end[1] - start[1]];
  const lengthSquared = direction[0] ** 2 + direction[1] ** 2;
  const amount = lengthSquared < 1e-8 ? 0 : clamp(
    ((point[0] - start[0]) * direction[0] + (point[1] - start[1]) * direction[1]) / lengthSquared, 0, 1);
  return [start[0] + direction[0] * amount, start[1] + direction[1] * amount];
}

export function closestPointOnTriangle2d(point, geometry) {
  return [[geometry.hue, geometry.white], [geometry.white, geometry.black], [geometry.black, geometry.hue]]
    .map(([start, end]) => closestPointOnSegment2d(point, start, end))
    .sort((first, second) => Math.hypot(first[0] - point[0], first[1] - point[1])
      - Math.hypot(second[0] - point[0], second[1] - point[1]))[0];
}
