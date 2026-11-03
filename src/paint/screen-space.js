export function screenPaintGrid(rect, virtualHeight) {
  const height = Math.max(32, Math.min(4096, Math.round(Number(virtualHeight) || 512)));
  const width = Math.max(1, Math.round(height * rect.width / Math.max(1, rect.height)));
  return { width, height, left: rect.left, top: rect.top,
    scaleX: width / Math.max(1, rect.width), scaleY: height / Math.max(1, rect.height) };
}

export function screenPaintPoint(grid, clientX, clientY) {
  return [Math.floor((clientX - grid.left) * grid.scaleX),
    Math.floor((clientY - grid.top) * grid.scaleY)];
}

export function screenPaintClientPoint(grid, x, y) {
  return [grid.left + (x + .5) / grid.scaleX, grid.top + (y + .5) / grid.scaleY];
}

export function rasterScreenUvFootprint(corners, center, bounds = null) {
  const polygon = [corners[0], corners[1], corners[3], corners[2]];
  const minX = Math.max(Math.floor(Math.min(...corners.map(point => point[0]))), bounds?.minU ?? -Infinity);
  const maxX = Math.min(Math.ceil(Math.max(...corners.map(point => point[0]))) - 1, (bounds?.maxU ?? Infinity) - 1);
  const minY = Math.max(Math.floor(Math.min(...corners.map(point => point[1]))), bounds?.minV ?? -Infinity);
  const maxY = Math.min(Math.ceil(Math.max(...corners.map(point => point[1]))) - 1, (bounds?.maxV ?? Infinity) - 1);
  const axes = [[1, 0], [0, 1]];
  for (let edge = 0; edge < 4; edge++) {
    const a = polygon[edge], b = polygon[(edge + 1) % 4];
    const axis = [b[1] - a[1], a[0] - b[0]];
    if (Math.abs(axis[0]) + Math.abs(axis[1]) > 1e-10) axes.push(axis);
  }
  const projections = axes.map(([ax, ay]) => {
    const values = polygon.map(([x, y]) => ax * x + ay * y);
    return { ax, ay, min: Math.min(...values), max: Math.max(...values) };
  });
  const overlaps = (x, y) => projections.every(({ ax, ay, min, max }) => {
    const near = (ax < 0 ? ax * (x + 1) : ax * x) + (ay < 0 ? ay * (y + 1) : ay * y);
    const far = (ax > 0 ? ax * (x + 1) : ax * x) + (ay > 0 ? ay * (y + 1) : ay * y);
    return far > min + 1e-9 && near < max - 1e-9;
  });
  const centerAllowed = center[0] >= (bounds?.minU ?? -Infinity) && center[0] < (bounds?.maxU ?? Infinity)
    && center[1] >= (bounds?.minV ?? -Infinity) && center[1] < (bounds?.maxV ?? Infinity);
  const pixels = centerAllowed ? [center] : [];
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if ((x !== center[0] || y !== center[1]) && overlaps(x, y)) pixels.push([x, y]);
  }
  return pixels;
}

const stampFootprintCache = new Map();
function stampFootprint(size, shape, antialias) {
  const key = `${size}:${shape}:${antialias ? 1 : 0}`;
  const cached = stampFootprintCache.get(key);
  if (cached) return cached;
  const footprint = [];
  const center = (size - 1) / 2;
  const radius = size / 2;
  for (let oy = 0; oy < size; oy++) for (let ox = 0; ox < size; ox++) {
    let coverage = 1;
    if (shape === 'circle' && size > 1) {
      if (antialias) {
        let inside = 0;
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++)
          if (Math.hypot(ox - center + (sx + .5) / 4 - .5,
            oy - center + (sy + .5) / 4 - .5) <= radius) inside++;
        coverage = inside / 16;
        if (!coverage) continue;
      } else if (Math.hypot(ox - center, oy - center) > radius) continue;
    }
    footprint.push([ox, oy, coverage]);
  }
  stampFootprintCache.set(key, footprint);
  if (stampFootprintCache.size > 16) stampFootprintCache.delete(stampFootprintCache.keys().next().value);
  return footprint;
}

export function rasterScreenPaint(tool, start, end, grid, options = {}) {
  const pixels = new Map();
  const size = Math.max(1, Math.min(64, Math.round(options.size) || 1));
  const half = Math.floor((size - 1) / 2);
  const footprint = stampFootprint(size, tool === 'brush' ? options.brushShape || 'square' : 'square', options.antialias);
  const stamp = (cx, cy) => {
    for (const [ox, oy, coverage] of footprint) {
      const x = cx + ox - half, y = cy + oy - half;
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
      const index = y * grid.width + x;
      pixels.set(index, Math.max(pixels.get(index) || 0, coverage));
    }
  };
  const line = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    for (let step = 0; step <= steps; step++) {
      const ratio = step / steps;
      stamp(Math.round(a[0] + dx * ratio), Math.round(a[1] + dy * ratio));
    }
  };
  if (tool === 'brush' || tool === 'line') line(start, end);
  else if (tool === 'rectangle') {
    const minX = Math.min(start[0], end[0]), maxX = Math.max(start[0], end[0]);
    const minY = Math.min(start[1], end[1]), maxY = Math.max(start[1], end[1]);
    if (options.filled) {
      for (let y = Math.max(0, minY - half); y <= Math.min(grid.height - 1, maxY + size - half - 1); y++)
        for (let x = Math.max(0, minX - half); x <= Math.min(grid.width - 1, maxX + size - half - 1); x++)
          pixels.set(y * grid.width + x, 1);
    } else {
      line([minX, minY], [maxX, minY]); line([maxX, minY], [maxX, maxY]);
      line([maxX, maxY], [minX, maxY]); line([minX, maxY], [minX, minY]);
    }
  } else if (tool === 'ellipse') {
    const centerX = (start[0] + end[0]) / 2, centerY = (start[1] + end[1]) / 2;
    const radiusX = Math.max(.5, Math.abs(end[0] - start[0]) / 2);
    const radiusY = Math.max(.5, Math.abs(end[1] - start[1]) / 2);
    if (options.filled) {
      for (let y = Math.max(0, Math.floor(centerY - radiusY)); y <= Math.min(grid.height - 1, Math.ceil(centerY + radiusY)); y++)
        for (let x = Math.max(0, Math.floor(centerX - radiusX)); x <= Math.min(grid.width - 1, Math.ceil(centerX + radiusX)); x++)
          if (((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2 <= 1) stamp(x, y);
    } else {
      const steps = Math.max(24, Math.ceil(Math.PI * Math.max(radiusX, radiusY) * 2));
      let previous = [Math.round(centerX + radiusX), Math.round(centerY)];
      for (let index = 1; index <= steps; index++) {
        const angle = index / steps * Math.PI * 2;
        const next = [Math.round(centerX + Math.cos(angle) * radiusX), Math.round(centerY + Math.sin(angle) * radiusY)];
        line(previous, next); previous = next;
      }
    }
  }
  return pixels;
}
