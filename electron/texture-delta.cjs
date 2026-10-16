const zlib = require('zlib');

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
  if (!source?.startsWith('data:image/png;base64,')) return null;
  const bytes = Buffer.from(source.slice(22), 'base64');
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let width, height, bitDepth, colorType, palette = null, transparency = null;
  const imageData = [];
  for (let cursor = 8; cursor + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(cursor);
    const type = bytes.toString('ascii', cursor + 4, cursor + 8);
    const data = bytes.subarray(cursor + 8, cursor + 8 + length);
    if (data.length !== length) throw new Error('PNG 數據不完整');
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) return null;
    } else if (type === 'IDAT') imageData.push(data);
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    cursor += 12 + length;
    if (type === 'IEND') break;
  }
  if (!width || !height || width * height > 67108864 || bitDepth !== 8) return null;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
  if (!channels) return null;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(imageData));
  if (raw.length !== (stride + 1) * height) throw new Error('PNG 像素數量不符');
  const rgba = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
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
      } else if (filter !== 0) throw new Error('PNG 濾鏡不支援');
      row[x] = row[x] + predictor & 255;
    }
    for (let x = 0; x < width; x++) {
      const sourceOffset = x * channels, targetOffset = (y * width + x) * 4;
      if (colorType === 6) row.copy(rgba, targetOffset, sourceOffset, sourceOffset + 4);
      else if (colorType === 2) { row.copy(rgba, targetOffset, sourceOffset, sourceOffset + 3); rgba[targetOffset + 3] = 255; }
      else if (colorType === 0) { rgba.fill(row[sourceOffset], targetOffset, targetOffset + 3); rgba[targetOffset + 3] = 255; }
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
function createTextureDelta(before, after) {
  const oldImage = decodePng(before), newImage = decodePng(after);
  if (!oldImage || !newImage || oldImage.width !== newImage.width || oldImage.height !== newImage.height) {
    return { kind: 'replace', before, after };
  }
  const tiles = [];
  for (let y = 0; y < oldImage.height; y += 32) for (let x = 0; x < oldImage.width; x += 32) {
    const width = Math.min(32, oldImage.width - x), height = Math.min(32, oldImage.height - y);
    const original = tileBytes(oldImage, x, y, width, height);
    const result = tileBytes(newImage, x, y, width, height);
    if (original.equals(result)) continue;
    tiles.push({ x, y, width, height,
      before: zlib.deflateSync(original).toString('base64'),
      after: zlib.deflateSync(result).toString('base64') });
  }
  return { kind: 'tiles', width: oldImage.width, height: oldImage.height, tiles };
}
function applyTextureDelta(source, delta, direction = 'after') {
  if (delta.kind === 'replace') return delta[direction];
  const image = decodePng(source);
  if (!image || image.width !== delta.width || image.height !== delta.height) throw new Error('貼圖差異與目前尺寸不符');
  for (const tile of delta.tiles) {
    const bytes = zlib.inflateSync(Buffer.from(tile[direction], 'base64'));
    if (bytes.length !== tile.width * tile.height * 4) throw new Error('貼圖差異損壞');
    for (let row = 0; row < tile.height; row++) bytes.copy(image.rgba,
      ((tile.y + row) * image.width + tile.x) * 4,
      row * tile.width * 4, (row + 1) * tile.width * 4);
  }
  return encodePng(image);
}
module.exports = { decodePng, encodePng, createTextureDelta, applyTextureDelta };
