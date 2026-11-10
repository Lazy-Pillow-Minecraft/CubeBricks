const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { isArchiveV2, unpackArchive } = require('./archive-codec.cjs');
const MAX_TOTAL = 2 * 1024 * 1024 * 1024, MAX_ENTRY = 512 * 1024 * 1024, MAX_HEADER = 32 * 1024 * 1024;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const safeName = name => typeof name === 'string' && name && !name.includes('\\') && !name.includes(':')
  && !name.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));

// Read only the independently compressed blocks needed by requested files.
// The original archive remains the durable source until background import ends.
class IndexedArchive {
  constructor(bytes) {
    this.bytes = bytes;
    this.files = new Map();
    this.blocks = [];
    this.blobs = new Map();
    this.cache = new Map();
    this.verifiedBlobs = new Set();
    if (bytes.length < 12) throw Error('CBMODEL 文件標頭不完整');
    const length = bytes.readUInt32LE(8);
    if (!length || length > MAX_HEADER || 12 + length > bytes.length) throw Error('CBMODEL 文件索引損壞');
    const manifest = JSON.parse(zlib.brotliDecompressSync(bytes.subarray(12, 12 + length), { maxOutputLength: MAX_HEADER }).toString('utf8'));
    if (manifest.format !== 'cubebricks-archive' || manifest.version !== 2
      || ![manifest.files, manifest.blocks, manifest.blobs].every(items => Array.isArray(items) && items.length <= 200000))
      throw Error('CBMODEL 文件版本或索引不正確');
    let cursor = 12 + length, total = 0, binary = 0;
    for (const block of manifest.blocks) {
      if (!Number.isSafeInteger(block.length) || block.length < 0 || !Number.isSafeInteger(block.size) || block.size < 0
        || (total += block.size) > MAX_TOTAL || cursor + block.length > bytes.length) throw Error('CBMODEL 壓縮區塊損壞');
      this.blocks.push({ ...block, offset: cursor });
      cursor += block.length;
    }
    for (const blob of manifest.blobs) {
      if (!/^[a-f0-9]{64}$/.test(blob.hash) || !Number.isSafeInteger(blob.length) || blob.length < 0
        || blob.length > MAX_ENTRY || (binary += blob.length) > MAX_TOTAL || cursor + blob.length > bytes.length || this.blobs.has(blob.hash))
        throw Error('CBMODEL 圖片區塊損壞');
      this.blobs.set(blob.hash, { ...blob, offset: cursor });
      cursor += blob.length;
    }
    if (cursor !== bytes.length) throw Error('CBMODEL 文件末尾包含額外資料');
    total = 0;
    for (const file of manifest.files) {
      if (!safeName(file.name) || this.files.has(file.name) || !Number.isSafeInteger(file.block) || file.block < 0
        || !Number.isSafeInteger(file.offset) || file.offset < 0 || !Number.isSafeInteger(file.length) || file.length < 0
        || file.offset + file.length > (this.blocks[file.block]?.size ?? -1) || !Number.isSafeInteger(file.originalLength)
        || file.originalLength < 0 || file.originalLength > MAX_ENTRY || (total += file.originalLength) > MAX_TOTAL)
        throw Error('CBMODEL 文件項目索引損壞');
      this.files.set(file.name, file);
    }
  }
  get size() { return this.files.size; }
  has(name) { return this.files.has(name); }
  keys() { return this.files.keys(); }
  originalSize(name) { return this.files.get(name)?.originalLength || 0; }
  get(name) {
    const file = this.files.get(name);
    if (!file) return undefined;
    let plain = this.cache.get(file.block);
    if (!plain) {
      const block = this.blocks[file.block];
      plain = zlib.brotliDecompressSync(this.bytes.subarray(block.offset, block.offset + block.length), { maxOutputLength: Math.max(1, block.size) });
      if (plain.length !== block.size || sha(plain) !== block.hash) throw Error('CBMODEL 壓縮區塊校驗失敗');
      this.cache.set(file.block, plain);
      while (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value);
    }
    const stripped = plain.subarray(file.offset, file.offset + file.length), pieces = [];
    let cursor = 0;
    for (const image of file.images || []) {
      if (!Number.isSafeInteger(image.at) || image.at < cursor || image.at > stripped.length || typeof image.prefix !== 'string'
        || image.prefix !== '' && !/^data:image\/[a-zA-Z0-9.+-]+;base64,$/.test(image.prefix)) throw Error('CBMODEL 圖片索引損壞');
      const blob = this.blobs.get(image.hash);
      if (!blob) throw Error('CBMODEL 圖片資料缺失');
      const value = this.bytes.subarray(blob.offset, blob.offset + blob.length);
      if (!this.verifiedBlobs.has(image.hash)) {
        if (sha(value) !== image.hash) throw Error('CBMODEL 圖片區塊校驗失敗');
        this.verifiedBlobs.add(image.hash);
      }
      pieces.push(stripped.subarray(cursor, image.at), Buffer.from(image.prefix + value.toString('base64')));
      cursor = image.at;
    }
    pieces.push(stripped.subarray(cursor));
    const restored = pieces.length === 1 ? pieces[0] : Buffer.concat(pieces);
    if (restored.length !== file.originalLength || sha(restored) !== file.hash) throw Error(`CBMODEL 文件校驗失敗：${name}`);
    return restored;
  }
  *[Symbol.iterator]() { for (const name of this.keys()) yield [name, this.get(name)]; }
}

function openIndexedArchive(bytes) { return isArchiveV2(bytes) ? new IndexedArchive(bytes) : unpackArchive(bytes); }
module.exports = { openIndexedArchive, IndexedArchive };
