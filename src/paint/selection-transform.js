// Pixel transforms always sample the original snapshot. Repeated previews must
// never resample a previously rotated image, which would accumulate holes.
export function selectionBounds(mask, width, height) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!mask[y * width + x]) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < left ? null : { left, top, right, bottom,
    cx: (left + right + 1) / 2, cy: (top + bottom + 1) / 2 };
}

export function transformSelectedPixels(source, mask, width, height,
  { dx = 0, dy = 0, angle = 0, copy = false, bounds: cachedBounds = null } = {}) {
  const bounds = cachedBounds || selectionBounds(mask, width, height);
  const output = new Uint8ClampedArray(source);
  const resultMask = new Uint8Array(width * height);
  if (!bounds) return { pixels: output, mask: resultMask };
  if (!copy) for (let y = bounds.top; y <= bounds.bottom; y++)
    for (let x = bounds.left; x <= bounds.right; x++) {
      const index = y * width + x;
      if (mask[index]) output.fill(0, index * 4, index * 4 + 4);
    }
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const corners = [[bounds.left, bounds.top], [bounds.right + 1, bounds.top],
    [bounds.left, bounds.bottom + 1], [bounds.right + 1, bounds.bottom + 1]]
    .map(([x, y]) => [bounds.cx + dx + (x - bounds.cx) * cosine - (y - bounds.cy) * sine,
      bounds.cy + dy + (x - bounds.cx) * sine + (y - bounds.cy) * cosine]);
  const left = Math.max(0, Math.floor(Math.min(...corners.map(p => p[0]))));
  const top = Math.max(0, Math.floor(Math.min(...corners.map(p => p[1]))));
  const right = Math.min(width, Math.ceil(Math.max(...corners.map(p => p[0]))));
  const bottom = Math.min(height, Math.ceil(Math.max(...corners.map(p => p[1]))));
  // Inverse mapping visits *every destination pixel*. Forward-scattering the
  // source leaves cracks at diagonal angles. Four coverage samples soften only
  // the newly rotated boundary while preserving exact pixels at right angles.
  const exact = Math.abs(sine) < 1e-8 || Math.abs(cosine) < 1e-8;
  const offsets = exact ? [[.5, .5]] : [[.25, .25], [.75, .25], [.25, .75], [.75, .75]];
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const rgba = [0, 0, 0, 0];
    let covered = 0;
    for (const [ox, oy] of offsets) {
      const relativeX = x + ox - bounds.cx - dx, relativeY = y + oy - bounds.cy - dy;
      const sx = Math.floor(bounds.cx + relativeX * cosine + relativeY * sine);
      const sy = Math.floor(bounds.cy - relativeX * sine + relativeY * cosine);
      if (sx < 0 || sy < 0 || sx >= width || sy >= height || !mask[sy * width + sx]) continue;
      const index = (sy * width + sx) * 4;
      const alpha = source[index + 3] / 255;
      for (let channel = 0; channel < 3; channel++) rgba[channel] += source[index + channel] * alpha;
      rgba[3] += alpha;
      covered++;
    }
    if (!covered) continue;
    const index = (y * width + x) * 4;
    const coverage = rgba[3] / offsets.length;
    const destinationAlpha = output[index + 3] / 255;
    const alpha = coverage + destinationAlpha * (1 - coverage);
    if (alpha > 0) for (let channel = 0; channel < 3; channel++) {
      output[index + channel] = (rgba[channel] / offsets.length
        + output[index + channel] * destinationAlpha * (1 - coverage)) / alpha;
    }
    output[index + 3] = Math.round(alpha * 255);
    resultMask[y * width + x] = 1;
  }
  return { pixels: output, mask: resultMask };
}
