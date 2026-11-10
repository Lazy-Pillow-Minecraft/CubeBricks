// Lossless PNG pixels for history comparisons, matching the journal decoder.
// Canvas decoding premultiplies alpha and can erase hidden RGB values.
const table = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = table[(value ^ byte) & 255] ^ value >>> 8;
  return (value ^ 0xffffffff) >>> 0;
}
export async function pngPixels(source) {
  if (typeof source !== 'string' || !source.startsWith('data:image/png;base64,')) return null;
  const base64 = source.slice(22);
  const bytes = typeof Uint8Array.fromBase64 === 'function' ? Uint8Array.fromBase64(base64)
    : Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if ([137,80,78,71,13,10,26,10].some((value, index) => bytes[index] !== value)) return null;
  let width, height, type, depth, palette, transparency, ended = false;
  const compressed = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset), name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (offset + 12 + length > bytes.length) throw Error('Incomplete PNG');
    const data = bytes.subarray(offset + 8, offset + 8 + length), dataView = new DataView(data.buffer, data.byteOffset, data.length);
    if (crc(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)) throw Error('PNG checksum mismatch');
    if (!width && name !== 'IHDR') throw Error('Missing PNG header');
    if (name === 'IHDR') {
      if (width || length !== 13) throw Error('Invalid PNG header');
      width = dataView.getUint32(0); height = dataView.getUint32(4); depth = data[8]; type = data[9];
      if (data[10] || data[11] || data[12]) return null;
    } else if (name === 'IDAT') compressed.push(data);
    else if (name === 'PLTE') palette = data;
    else if (name === 'tRNS') transparency = data;
    else if (name !== 'IEND' && !(name.charCodeAt(0) & 32)) return null;
    offset += length + 12;
    if (name === 'IEND') { ended = length === 0; break; }
  }
  if (!ended || !compressed.length) throw Error('Incomplete PNG');
  if (!width || !height || width * height > 67108864 || depth !== 8) return null;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[type];
  if (!channels) return null;
  if (transparency && (type === 0 && transparency.length !== 2 || type === 2 && transparency.length !== 6
    || type === 3 && (!palette || transparency.length > palette.length / 3) || type === 4 || type === 6)) throw Error('Invalid PNG transparency');
  const stride = width * channels, expected = (stride + 1) * height;
  const reader = new Blob(compressed).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const raw = new Uint8Array(expected); let offset = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    if (offset + value.length > expected) { await reader.cancel(); throw Error('Invalid PNG pixel count'); }
    raw.set(value, offset); offset += value.length;
  }
  if (offset !== expected) throw Error('Invalid PNG pixel count');
  const rgba = new Uint8Array(width * height * 4), transparent = transparency && new DataView(transparency.buffer, transparency.byteOffset, transparency.length);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), filter = raw[y * (stride + 1)];
    if (filter > 4) throw Error('Unsupported PNG filter');
    for (let x = 0; filter && x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0, up = previous[x], upperLeft = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upperLeft, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
        predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft;
      }
      row[x] = row[x] + predictor & 255;
    }
    if (type === 6) rgba.set(row, y * stride);
    else for (let x = 0; x < width; x++) {
      const input = x * channels, output = (y * width + x) * 4;
      if (type === 2) {
        rgba.set(row.subarray(input, input + 3), output);
        rgba[output + 3] = transparent && row[input] === transparent.getUint16(0)
          && row[input + 1] === transparent.getUint16(2) && row[input + 2] === transparent.getUint16(4) ? 0 : 255;
      } else if (type === 0 || type === 4) {
        rgba.fill(row[input], output, output + 3);
        rgba[output + 3] = type === 4 ? row[input + 1] : transparent && row[input] === transparent.getUint16(0) ? 0 : 255;
      } else {
        const color = row[input] * 3;
        if (!palette || color + 2 >= palette.length) throw Error('Invalid PNG palette');
        rgba.set(palette.subarray(color, color + 3), output); rgba[output + 3] = transparency?.[row[input]] ?? 255;
      }
    }
    previous = row;
  }
  return { width, height, rgba };
}
