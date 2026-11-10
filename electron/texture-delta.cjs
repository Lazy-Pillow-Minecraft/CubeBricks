const zlib = require('zlib');
const crypto = require('crypto');

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const table = Array.from({ length: 256 }, (_, number) => {
  let value = number;
  for (let index = 0; index < 8; index++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = table[(value ^ byte) & 255] ^ value >>> 8;
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const kind = Buffer.from(type);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  kind.copy(head, 4);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc(Buffer.concat([kind, data])));
  return Buffer.concat([head, data, checksum]);
}
function decodePng(source) {
  if (typeof source !== 'string' || !source.startsWith('data:image/png;base64,')) return null;
  const bytes = Buffer.from(source.slice(22), 'base64');
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let width, height, bitDepth, colorType, palette = null, transparency = null;
  let ended = false;
  const imageData = [];
  for (let cursor = 8; cursor + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(cursor);
    const type = bytes.toString('ascii', cursor + 4, cursor + 8);
    if (cursor + 12 + length > bytes.length) throw new Error('PNG 數據不完整');
    const data = bytes.subarray(cursor + 8, cursor + 8 + length);
    if (crc(bytes.subarray(cursor + 4, cursor + 8 + length)) !== bytes.readUInt32BE(cursor + 8 + length)) throw new Error('PNG 校驗失敗');
    if (!width && type !== 'IHDR') throw new Error('PNG 缺少圖像標頭');
    if (type === 'IHDR') {
      if (width || data.length !== 13) throw new Error('PNG 圖像標頭損壞');
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return null;
    } else if (type === 'IDAT') imageData.push(data);
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type !== 'IEND' && (type.charCodeAt(0) & 32) === 0) return null;
    cursor += 12 + length;
    if (type === 'IEND') { ended = data.length === 0; break; }
  }
  if (!ended || !imageData.length) throw new Error('PNG 數據不完整');
  if (!width || !height || width * height > 67108864 || bitDepth !== 8) return null;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
  if (!channels) return null;
  if (transparency && ((colorType === 0 && transparency.length !== 2)
    || (colorType === 2 && transparency.length !== 6)
    || (colorType === 3 && (!palette || transparency.length > palette.length / 3))
    || colorType === 4 || colorType === 6)) throw new Error('PNG 透明度數據損壞');
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(imageData), { maxOutputLength: (stride + 1) * height });
  if (raw.length !== (stride + 1) * height) throw new Error('PNG 像素數量不符');
  const rgba = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error('PNG 濾鏡不支援');
    for (let x = 0; filter && x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x];
      const upperLeft = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upperLeft;
        const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
        predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft;
      }
      row[x] = row[x] + predictor & 255;
    }
    if (colorType === 6) row.copy(rgba, y * stride);
    else for (let x = 0; x < width; x++) {
      const sourceOffset = x * channels, targetOffset = (y * width + x) * 4;
      if (colorType === 2) {
        row.copy(rgba, targetOffset, sourceOffset, sourceOffset + 3);
        rgba[targetOffset + 3] = transparency && row[sourceOffset] === transparency.readUInt16BE(0)
          && row[sourceOffset + 1] === transparency.readUInt16BE(2)
          && row[sourceOffset + 2] === transparency.readUInt16BE(4) ? 0 : 255;
      }
      else if (colorType === 0) {
        rgba.fill(row[sourceOffset], targetOffset, targetOffset + 3);
        rgba[targetOffset + 3] = transparency && row[sourceOffset] === transparency.readUInt16BE(0) ? 0 : 255;
      }
      else if (colorType === 4) { rgba.fill(row[sourceOffset], targetOffset, targetOffset + 3); rgba[targetOffset + 3] = row[sourceOffset + 1]; }
      else {
        const color = row[sourceOffset] * 3;
        if (!palette || color + 2 >= palette.length) throw new Error('PNG 調色盤損壞');
        palette.copy(rgba, targetOffset, color, color + 3);
        rgba[targetOffset + 3] = transparency?.[row[sourceOffset]] ?? 255;
      }
    }
    previous = row;
  }
  return { width, height, rgba };
}
function encodePng({ width, height, rgba }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return `data:image/png;base64,${Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]).toString('base64')}`;
}
function tileBytes(image, x, y, width, height) {
  const output = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) image.rgba.copy(output, row * width * 4, ((y + row) * image.width + x) * 4, ((y + row) * image.width + x + width) * 4);
  return output;
}
// Digesting and calculating a delta in the same commit both need these
// pixels. Cache immutable decoded data so one stroke does not inflate the
// same before/after PNGs twice.
const decoded = new Map();
let decodedBytes = 0;
const decodedLimit = 32 * 1024 * 1024;
function tryDecodePng(source) {
  const cached = decoded.get(source);
  if (cached) { decoded.delete(source); decoded.set(source, cached); return cached.image; }
  try {
    const image = decodePng(source);
    const bytes = (image?.rgba.length || 0) + (source?.length || 0);
    if (image && bytes <= decodedLimit) {
      decoded.set(source, { image, bytes }); decodedBytes += bytes;
      while (decoded.size > 64 || decodedBytes > decodedLimit) {
        const [old, entry] = decoded.entries().next().value;
        decoded.delete(old); decodedBytes -= entry.bytes;
      }
    }
    return image;
  }
  catch { return null; }
}
const fingerprintCache = new Map();
const FINGERPRINT_CACHE_MAX_BYTES = 32 * 1024 * 1024;
let fingerprintCacheBytes = 0;
function textureSourceFingerprint(source) {
  // Texture sources are immutable strings within a journal session. Hashing
  // multi-megabyte PNG strings just to look up their cached pixel hash made
  // geometry-only commits scan every texture again.
  if (fingerprintCache.has(source)) return fingerprintCache.get(source);
  const hash = crypto.createHash('sha256');
  const image = tryDecodePng(source);
  const result = image ? hash.update(`rgba:${image.width}:${image.height}:`).update(image.rgba).digest('hex')
    : hash.update(`source:${JSON.stringify(source)}`).digest('hex');
  // A fixed 16-entry cap thrashed on projects with many textures: every
  // geometry-only commit decoded the same PNGs again. Bound by source bytes
  // instead, retaining many small images without pinning huge projects.
  const sourceBytes = typeof source === 'string' ? source.length * 2 : 0;
  if (sourceBytes <= FINGERPRINT_CACHE_MAX_BYTES) {
    fingerprintCache.set(source, result);
    fingerprintCacheBytes += sourceBytes;
    while (fingerprintCache.size > 256 || fingerprintCacheBytes > FINGERPRINT_CACHE_MAX_BYTES) {
      const oldest = fingerprintCache.keys().next().value;
      fingerprintCache.delete(oldest);
      fingerprintCacheBytes -= typeof oldest === 'string' ? oldest.length * 2 : 0;
    }
  }
  return result;
}
function createTextureDelta(before, after) {
  if (before === after) return { kind: 'unchanged' };
  const oldImage = tryDecodePng(before), newImage = tryDecodePng(after);
  if (!oldImage || !newImage || oldImage.width !== newImage.width || oldImage.height !== newImage.height) {
    return { kind: 'replace', before, after };
  }
  const tiles = [];
  const stride = oldImage.width * 4;
  const changedRows = new Uint8Array(oldImage.height);
  for (let y = 0; y < oldImage.height; y++) {
    const start = y * stride;
    changedRows[y] = oldImage.rgba.compare(newImage.rgba, start, start + stride, start, start + stride) !== 0;
  }
  for (let y = 0; y < oldImage.height; y += 32) for (let x = 0; x < oldImage.width; x += 32) {
    const width = Math.min(32, oldImage.width - x), height = Math.min(32, oldImage.height - y);
    let different = false;
    for (let row = y; row < y + height; row++) {
      if (!changedRows[row]) continue;
      const start = row * stride + x * 4, end = start + width * 4;
      if (oldImage.rgba.compare(newImage.rgba, start, end, start, end) !== 0) { different = true; break; }
    }
    if (!different) continue;
    const original = tileBytes(oldImage, x, y, width, height);
    const result = tileBytes(newImage, x, y, width, height);
    tiles.push({ x, y, width, height,
      before: zlib.deflateSync(original).toString('base64'),
      after: zlib.deflateSync(result).toString('base64') });
  }
  return tiles.length ? { kind: 'tiles', width: oldImage.width, height: oldImage.height, tiles } : { kind: 'unchanged' };
}
function applyTextureDelta(source, delta, direction = 'after') {
  if (direction !== 'before' && direction !== 'after') throw new Error('貼圖差異方向不合法');
  if (!delta || typeof delta !== 'object') throw new Error('貼圖差異損壞');
  if (delta.kind === 'unchanged') return source;
  if (delta.kind === 'replace') return delta[direction];
  if (delta.kind !== 'tiles' || !Array.isArray(delta.tiles)) throw new Error('貼圖差異類型不支援');
  const image = decodePng(source);
  if (!image || image.width !== delta.width || image.height !== delta.height) throw new Error('貼圖差異與目前尺寸不符');
  if (!delta.tiles.length) return source;
  const patches = [];
  const positions = new Set();
  for (const tile of delta.tiles) {
    if (![tile.x, tile.y, tile.width, tile.height].every(Number.isInteger)
      || tile.x < 0 || tile.y < 0 || tile.width <= 0 || tile.height <= 0
      || tile.width > 32 || tile.height > 32 || tile.x % 32 || tile.y % 32
      || tile.x + tile.width > image.width || tile.y + tile.height > image.height
      || positions.has(`${tile.x},${tile.y}`)) throw new Error('貼圖差異範圍損壞');
    positions.add(`${tile.x},${tile.y}`);
    const length = tile.width * tile.height * 4;
    const bytes = zlib.inflateSync(Buffer.from(tile[direction], 'base64'), { maxOutputLength: length });
    const basis = zlib.inflateSync(Buffer.from(tile[direction === 'before' ? 'after' : 'before'], 'base64'), { maxOutputLength: length });
    if (bytes.length !== length || basis.length !== length) throw new Error('貼圖差異損壞');
    if (!tileBytes(image, tile.x, tile.y, tile.width, tile.height).equals(basis)) throw new Error('貼圖差異的原始像素與目前狀態不符');
    patches.push({ tile, bytes });
  }
  for (const { tile, bytes } of patches) {
    for (let row = 0; row < tile.height; row++) bytes.copy(image.rgba,
      ((tile.y + row) * image.width + tile.x) * 4,
      row * tile.width * 4, (row + 1) * tile.width * 4);
  }
  return encodePng(image);
}
module.exports = { decodePng, encodePng, createTextureDelta, applyTextureDelta, textureSourceFingerprint };
