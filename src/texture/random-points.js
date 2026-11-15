// Bridson-style Poisson disk sampling on integer pixel positions. The spacing
// is measured between dot edges, so center distance is diameter + gap.
const ATTEMPTS_PER_POINT = 30;
const MAX_DENSITY_QUOTIENT = 400_000;

export async function sampleRandomPoints({
  width, height, diameter, gap, random = Math.random,
  yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)),
  onProgress = () => {}
}) {
  if (![width, height, diameter, gap].every(Number.isInteger)
    || width < 1 || height < 1 || diameter < 1 || gap < 0) {
    throw new RangeError('點尺寸、間隔及畫布尺寸必須是有效像素數值');
  }
  const maxX = width - diameter, maxY = height - diameter;
  if (maxX < 0 || maxY < 0) return [];
  const distance = diameter + gap;
  if (width * height / (distance * distance) > MAX_DENSITY_QUOTIENT) {
    throw new RangeError('點的密度過高，請增加尺寸或最小間隔');
  }
  const cell = distance / Math.SQRT2;
  const columns = Math.floor(maxX / cell) + 1;
  const rows = Math.floor(maxY / cell) + 1;
  const occupied = new Map();
  const points = [], active = [];
  const gridKey = (x, y) => Math.floor(y / cell) * columns + Math.floor(x / cell);
  const add = (x, y) => {
    const index = points.length;
    points.push({ x, y });
    active.push(index);
    occupied.set(gridKey(x, y), index);
  };
  const fits = (x, y) => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    for (let row = Math.max(0, gy - 2); row <= Math.min(rows - 1, gy + 2); row++) {
      for (let column = Math.max(0, gx - 2); column <= Math.min(columns - 1, gx + 2); column++) {
        const index = occupied.get(row * columns + column);
        if (index === undefined) continue;
        const other = points[index];
        if ((x - other.x) ** 2 + (y - other.y) ** 2 < distance ** 2) return false;
      }
    }
    return true;
  };
  add(Math.floor(random() * (maxX + 1)), Math.floor(random() * (maxY + 1)));
  let attemptsSinceYield = 0;
  while (active.length) {
    const slot = Math.floor(random() * active.length);
    const origin = points[active[slot]];
    let accepted = false;
    for (let attempt = 0; attempt < ATTEMPTS_PER_POINT; attempt++) {
      const angle = random() * Math.PI * 2;
      const radius = distance * Math.sqrt(1 + 3 * random());
      const x = Math.round(origin.x + Math.cos(angle) * radius);
      const y = Math.round(origin.y + Math.sin(angle) * radius);
      attemptsSinceYield++;
      if (x < 0 || y < 0 || x > maxX || y > maxY || !fits(x, y)) continue;
      add(x, y);
      accepted = true;
      break;
    }
    if (!accepted) {
      active[slot] = active.at(-1);
      active.pop();
    }
    if (attemptsSinceYield >= 20_000) {
      attemptsSinceYield = 0;
      onProgress(points.length);
      await yieldControl();
    }
  }
  onProgress(points.length);
  return points;
}

export async function drawRandomPoints(context, points, diameter, color, onProgress = () => {}) {
  const stamp = document.createElement('canvas');
  stamp.width = stamp.height = diameter;
  const stampContext = stamp.getContext('2d');
  stampContext.fillStyle = color;
  const radius = diameter / 2;
  for (let row = 0; row < diameter; row++) {
    const offset = row + .5 - radius;
    const reach = Math.sqrt(Math.max(0, radius * radius - offset * offset));
    const left = Math.max(0, Math.ceil(radius - reach - .5));
    const right = Math.min(diameter - 1, Math.floor(radius + reach - .5));
    if (right >= left) stampContext.fillRect(left, row, right - left + 1, 1);
  }
  for (let index = 0; index < points.length; index++) {
    context.drawImage(stamp, points[index].x, points[index].y);
    if ((index + 1) % 5_000 === 0) {
      onProgress(index + 1);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  onProgress(points.length);
}
