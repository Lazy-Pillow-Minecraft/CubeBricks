const zlib = require('zlib');

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function packZip(entries) {
  if (entries.length > 0xffff) throw new Error('項目文件過多，超出 ZIP 格式上限');
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
    const plain = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const compressed = zlib.deflateRawSync(plain);
    const checksum = crc32(plain);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(plain.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, filename);
    offset += local.length + filename.length + compressed.length;
    if (offset > 0xffffffff) throw new Error('項目包過大，超出 ZIP 格式上限');
  }
  const directorySize = centrals.reduce((sum, bytes) => sum + bytes.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function unpackZip(bytes, { maxEntrySize = 512 * 1024 * 1024, maxTotalSize = 2 * 1024 * 1024 * 1024,
  onProgress = null } = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let end = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index--) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new Error('不是有效的 ZIP／cbmodel 文件');
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  if (cursor >= end) throw new Error('ZIP 目錄位置不正確');
  const result = new Map();
  let totalPlainSize = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end) throw new Error('ZIP 目錄不完整');
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP 目錄損壞');
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const plainSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    if (cursor + 46 + nameLength + extraLength + commentLength > end) throw new Error('ZIP 目錄不完整');
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    const directoryEntry = name.endsWith('/');
    const segments = (directoryEntry ? name.slice(0, -1) : name).split('/');
    if (!name || name.startsWith('/') || name.includes('\\') || name.includes(':')
      || segments.some(segment => !segment || segment === '.' || segment === '..'
        || /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) {
      throw new Error('ZIP 包含不安全路徑');
    }
    if (plainSize > maxEntrySize || (totalPlainSize += plainSize) > maxTotalSize) {
      throw new Error('ZIP 展開後體積過大');
    }
    if (localOffset + 30 > cursor) throw new Error('ZIP 文件條目位置不正確');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP 文件條目損壞');
    const dataOffset = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    if (dataOffset > cursor || dataOffset + compressedSize > cursor) throw new Error('ZIP 文件條目不完整');
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    if (compressed.length !== compressedSize) throw new Error('ZIP 文件不完整');
    const plain = method === 8 ? zlib.inflateRawSync(compressed, { maxOutputLength: plainSize + 1 }) : method === 0 ? compressed : null;
    if (!plain || plain.length !== plainSize || crc32(plain) !== checksum) throw new Error(`ZIP 校驗失敗：${name}`);
    if (directoryEntry) {
      if (plain.length) throw new Error(`ZIP 目錄條目含資料：${name}`);
    } else result.set(name, plain);
    onProgress?.((index + 1) / Math.max(1, count), `正在解壓檔案 ${index + 1} / ${count}`);
  }
  return result;
}

module.exports = { packZip, unpackZip };
