// Immutable decoded sources shared by history, layer loading and atlas loading.
// Callers must copy these images before painting; mutable canvases never enter
// this cache. Source keys prevent texture switches from replacing one another.
const entries = new Map();
let bytes = 0;
const limit = 48 * 1024 * 1024;
function trim() {
  while (entries.size > 192 || bytes > limit) {
    const [key, entry] = entries.entries().next().value;
    entries.delete(key); bytes -= entry.bytes;
  }
}
export function decodedRasterImage(source) {
  const cached = entries.get(source);
  if (cached) { entries.delete(source); entries.set(source, cached); return cached.promise; }
  const entry = { bytes: source?.length * 2 || 0, promise: null };
  entry.promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (entries.get(source) === entry) {
        bytes -= entry.bytes;
        entry.bytes += image.naturalWidth * image.naturalHeight * 4;
        bytes += entry.bytes; entry.ready = true; trim();
      }
      resolve(image);
    };
    image.onerror = () => {
      if (entries.get(source) === entry) { entries.delete(source); bytes -= entry.bytes; }
      reject(Error('貼圖載入失敗'));
    };
    image.src = source;
  });
  entries.set(source, entry); bytes += entry.bytes; trim();
  return entry.promise;
}
// Retain an owned raster before the image decoder needs the saved PNG.
export function rememberDecodedRaster(source, canvas) {
  const size = canvas.width * canvas.height * 4 + source.length * 2;
  if (size > limit || entries.get(source)?.ready) return;
  const snapshot = document.createElement('canvas');
  snapshot.width = canvas.width; snapshot.height = canvas.height;
  snapshot.getContext('2d').drawImage(canvas, 0, 0);
  const old = entries.get(source);
  if (old) { entries.delete(source); bytes -= old.bytes; }
  entries.set(source, { bytes: size, promise: Promise.resolve(snapshot), ready: true });
  bytes += size; trim();
}
export function warmTextureSources(textures) {
  if (typeof Image === 'undefined') return;
  for (const texture of textures || []) for (const image of [texture, ...(texture.layers || [])])
    if (typeof image.source === 'string' && image.source.startsWith('data:image/')) void decodedRasterImage(image.source).catch(() => {});
}
