const BLOCK = 32;
const readers = new WeakMap();

function readBlock(snapshot, x, y) {
  const { canvas, blocks } = snapshot;
  const key = y * canvas.width + x;
  let block = blocks.get(key);
  if (!block) {
    const width = Math.min(BLOCK, canvas.width - x);
    const height = Math.min(BLOCK, canvas.height - y);
    const rgba = canvas.getContext('2d').getImageData(x, y, width, height).data;
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
    block = { width, alpha };
    blocks.set(key, block);
  }
  return block;
}

export function createPaintAlphaSnapshot(canvas) {
  const snapshot = { canvas, blocks: new Map() };
  const current = readers.get(canvas)?.filter(ref => ref.deref()) || [];
  current.push(new WeakRef(snapshot));
  readers.set(canvas, current);
  return snapshot;
}

export function releasePaintAlphaSnapshot(snapshot) {
  const current = readers.get(snapshot.canvas)?.filter(ref => {
    const reader = ref.deref();
    return reader && reader !== snapshot;
  });
  if (current?.length) readers.set(snapshot.canvas, current);
  else readers.delete(snapshot.canvas);
}

export function paintSnapshotAlpha(snapshot, x, y) {
  const left = Math.floor(x / BLOCK) * BLOCK;
  const top = Math.floor(y / BLOCK) * BLOCK;
  const { alpha, width } = readBlock(snapshot, left, top);
  return alpha[(y - top) * width + x - left];
}

// Save only the old blocks that a live update is about to overwrite, so an
// eraser cannot start hitting the surface behind it halfway through a stroke.
export function preservePaintAlpha(canvas, { x, y, width, height }) {
  const current = readers.get(canvas);
  if (!current) return;
  const left = Math.max(0, Math.floor(x / BLOCK) * BLOCK);
  const top = Math.max(0, Math.floor(y / BLOCK) * BLOCK);
  const right = Math.min(x + width, canvas.width);
  const bottom = Math.min(y + height, canvas.height);
  const active = [];
  for (const ref of current) {
    const snapshot = ref.deref();
    if (!snapshot) continue;
    active.push(ref);
    for (let row = top; row < bottom; row += BLOCK) {
      for (let column = left; column < right; column += BLOCK) readBlock(snapshot, column, row);
    }
  }
  if (active.length) readers.set(canvas, active);
  else readers.delete(canvas);
}
