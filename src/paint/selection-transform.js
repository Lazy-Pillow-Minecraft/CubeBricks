// Pixel transforms always sample the original snapshot. Repeated previews must
// never resample a previously rotated image, which would accumulate holes.
export function selectionBounds(mask, width, height, clip = {}) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = clip.top ?? 0; y < (clip.bottom ?? height); y++)
    for (let x = clip.left ?? 0; x < (clip.right ?? width); x++) {
      if (!mask[y * width + x]) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  return right < left ? null : {
    left, top, right, bottom,
    cx: (left + right + 1) / 2, cy: (top + bottom + 1) / 2
  };
}

export const mapSelectionPoint = ([a, b, c, d, x, y], [u, v]) => [a * u + c * v + x, b * u + d * v + y];
export function multiplySelectionTransforms([a, b, c, d, x, y], [e, f, g, h, u, v]) {
  return [a * e + c * f, b * e + d * f, a * g + c * h, b * g + d * h, a * u + c * v + x, b * u + d * v + y];
}
export function invertSelectionTransform([a, b, c, d, x, y]) {
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-10) return null;
  return [d / det, -b / det, -c / det, a / det, (c * y - d * x) / det, (b * x - a * y) / det];
}
export function selectionFrameMatrix([origin, right, bottom]) {
  return [right[0] - origin[0], right[1] - origin[1],
  bottom[0] - origin[0], bottom[1] - origin[1], ...origin];
}
export function selectionTransformMatrix(bounds, { dx = 0, dy = 0, angle = 0, scaleX = 1, scaleY = 1,
  pivot = [bounds.cx, bounds.cy] } = {}) {
  const [x, y] = pivot, cos = Math.cos(angle), sin = Math.sin(angle);
  const a = cos * scaleX, b = sin * scaleX, c = -sin * scaleY, d = cos * scaleY;
  return [a, b, c, d, x + dx - a * x - c * y, y + dy - b * x - d * y];
}
export const selectionCorners = ({ left, top, right, bottom }) =>
  [[left, top], [right + 1, top], [right + 1, bottom + 1], [left, bottom + 1]];

export function cutSelection(output, resultMask, mask, width, bounds, copy) {
  for (let y = bounds.top; y <= bounds.bottom; y++) for (let x = bounds.left; x <= bounds.right; x++) {
    const index = y * width + x;
    if (!mask[index]) continue;
    if (!copy) output.fill(0, index * 4, index * 4 + 4);
    if (resultMask) resultMask[index] = 0;
  }
}

export function transformSelectedPixels(source, mask, width, height,
  { copy = false, bounds: cachedBounds = null, matrix = null, clip = {}, output = new Uint8ClampedArray(source),
    outputWidth = width, outputHeight = height, sampling = 'smooth',
    resultMask = new Uint8Array(outputWidth * outputHeight), cut = true, claimed = null, ...transform } = {}) {
  const bounds = cachedBounds || selectionBounds(mask, width, height);
  if (!bounds) return { pixels: output, mask: resultMask };
  matrix ||= selectionTransformMatrix(bounds, transform);
  const inverse = invertSelectionTransform(matrix);
  if (!inverse) return { pixels: output, mask: resultMask };
  if (cut) cutSelection(output, resultMask, mask, width, bounds, copy);
  const corners = selectionCorners(bounds).map(point => mapSelectionPoint(matrix, point));
  const left = Math.max(0, clip.left ?? 0, Math.floor(Math.min(...corners.map(p => p[0]))));
  const top = Math.max(0, clip.top ?? 0, Math.floor(Math.min(...corners.map(p => p[1]))));
  const right = Math.min(outputWidth, clip.right ?? outputWidth, Math.ceil(Math.max(...corners.map(p => p[0]))));
  const bottom = Math.min(outputHeight, clip.bottom ?? outputHeight, Math.ceil(Math.max(...corners.map(p => p[1]))));
  // Inverse mapping visits *every destination pixel*. Forward-scattering the
  // source leaves cracks at diagonal angles. Four coverage samples soften only
  // the newly rotated boundary while preserving exact pixels at right angles.
  const exact = Math.abs(matrix[1]) + Math.abs(matrix[2]) < 1e-8 || Math.abs(matrix[0]) + Math.abs(matrix[3]) < 1e-8;
  const offsets = exact || sampling === 'nearest' ? [[.5, .5]] : [[.25, .25], [.75, .25], [.25, .75], [.75, .75]];
  const [a, b, c, d, tx, ty] = inverse;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const pixel = y * outputWidth + x;
    if (claimed?.[pixel]) continue;
    let red = 0, green = 0, blue = 0, opacity = 0, covered = 0;
    for (const [ox, oy] of offsets) {
      const sx = Math.floor(a * (x + ox) + c * (y + oy) + tx + 1e-8);
      const sy = Math.floor(b * (x + ox) + d * (y + oy) + ty + 1e-8);
      if (sx < 0 || sy < 0 || sx >= width || sy >= height || mask && !mask[sy * width + sx]) continue;
      const index = (sy * width + sx) * 4;
      const alpha = source[index + 3] / 255;
      red += source[index] * alpha;
      green += source[index + 1] * alpha;
      blue += source[index + 2] * alpha;
      opacity += alpha;
      covered++;
    }
    if (!covered || !opacity && !mask) continue;
    const index = pixel * 4;
    const coverage = opacity / offsets.length;
    const destinationAlpha = output[index + 3] / 255;
    const alpha = coverage + destinationAlpha * (1 - coverage);
    if (alpha > 0) {
      const weight = destinationAlpha * (1 - coverage);
      output[index] = (red / offsets.length + output[index] * weight) / alpha;
      output[index + 1] = (green / offsets.length + output[index + 1] * weight) / alpha;
      output[index + 2] = (blue / offsets.length + output[index + 2] * weight) / alpha;
    }
    output[index + 3] = Math.round(alpha * 255);
    if (resultMask) resultMask[pixel] = 1;
    if (claimed) claimed[pixel] = 1;
  }
  return { pixels: output, mask: resultMask };
}
