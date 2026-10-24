const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const { unpackZip } = require('./zip-store.cjs');

const MAGIC = Buffer.from('CBM2\r\n\x1a\n', 'binary');
const compress = promisify(zlib.brotliCompress);
const decompress = promisify(zlib.brotliDecompress);
const MAX_BLOCK = 8 * 1024 * 1024;
const MAX_MANIFEST = 32 * 1024 * 1024;
const MAX_ENTRY = 512 * 1024 * 1024;
const MAX_TOTAL = 2 * 1024 * 1024 * 1024;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const BROTLI_OPTIONS = { params: {
  [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
  [zlib.constants.BROTLI_PARAM_LGWIN]: 24
} };

function validName(name) {
  if (typeof name !== 'string' || !name || name.startsWith('/') || name.includes('\\') || name.includes(':')) return false;
  return !name.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

function detachImages(bytes, blobs, name) {
  const source = bytes.toString('latin1');
  const matches = [];
  const pattern = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}/g;
  for (const match of source.matchAll(pattern)) {
    const comma = match[0].indexOf(',');
    matches.push({ at: match.index, length: match[0].length,
      prefix: match[0].slice(0, comma + 1), encoded: match[0].slice(comma + 1) });
  }
  if (/^texture_changes\/\d+\/[^/]+\.json$/.test(name)) {
    for (const match of source.matchAll(/"(?:before|after)"\s*:\s*"([A-Za-z0-9+/]+={0,2})"/g)) {
      matches.push({ at: match.index + match[0].indexOf(match[1]), length: match[1].length,
        prefix: '', encoded: match[1] });
    }
  }
  matches.sort((left, right) => left.at - right.at);
  const pieces = [], images = [];
  let cursor = 0, length = 0;
  for (const match of matches) {
    if (match.at < cursor) continue;
    const image = Buffer.from(match.encoded, 'base64');
    if (image.toString('base64') !== match.encoded) continue;
    const preceding = bytes.subarray(cursor, match.at);
    pieces.push(preceding); length += preceding.length;
    const hash = sha(image);
    if (!blobs.has(hash)) blobs.set(hash, image);
    images.push({ at: length, hash, prefix: match.prefix });
    cursor = match.at + match.length;
  }
  pieces.push(bytes.subarray(cursor));
  return { bytes: images.length ? Buffer.concat(pieces) : bytes, images };
}

function restoreImages(bytes, images, blobs) {
  if (!images?.length) return bytes;
  const pieces = [];
  let cursor = 0;
  for (const image of images) {
    if (!Number.isSafeInteger(image.at) || image.at < cursor || image.at > bytes.length
      || typeof image.prefix !== 'string' || image.prefix !== ''
      && !/^data:image\/[a-zA-Z0-9.+-]+;base64,$/.test(image.prefix)) {
      throw new Error('CBMODEL 圖片索引損壞');
    }
    const blob = blobs.get(image.hash);
    if (!blob) throw new Error('CBMODEL 圖片資料缺失');
    pieces.push(bytes.subarray(cursor, image.at), Buffer.from(image.prefix + blob.toString('base64')));
    cursor = image.at;
  }
  pieces.push(bytes.subarray(cursor));
  return Buffer.concat(pieces);
}

async function packArchive(entries) {
  const files = [], blobs = new Map(), blocks = [];
  let pending = [], pendingSize = 0;
  const flush = async () => {
    if (!pending.length) return;
    const plain = Buffer.concat(pending, pendingSize);
    const encoded = await compress(plain, BROTLI_OPTIONS);
    blocks.push({ bytes: encoded, size: plain.length, hash: sha(plain) });
    pending = []; pendingSize = 0;
  };
  const names = new Set();
  let totalOriginal = 0;
  for (const [name, value] of entries) {
    if (!validName(name) || names.has(name)) throw new Error('CBMODEL 包含重複或不安全路徑');
    names.add(name);
    const original = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (original.length > MAX_ENTRY || (totalOriginal += original.length) > MAX_TOTAL) throw new Error('CBMODEL 展開後過大');
    const detached = detachImages(original, blobs, name);
    if (pendingSize && pendingSize + detached.bytes.length > MAX_BLOCK) await flush();
    const block = blocks.length;
    const offset = pendingSize;
    pending.push(detached.bytes);
    pendingSize += detached.bytes.length;
    files.push({ name, block, offset, length: detached.bytes.length,
      originalLength: original.length, hash: sha(original), images: detached.images });
    if (pendingSize >= MAX_BLOCK) await flush();
  }
  await flush();
  if (files.length > 200000 || blocks.length > 200000 || blobs.size > 200000) throw new Error('CBMODEL 文件項目過多');
  const manifest = { format: 'cubebricks-archive', version: 2, files,
    blocks: blocks.map(({ bytes, size, hash }) => ({ length: bytes.length, size, hash })),
    blobs: [...blobs].map(([hash, bytes]) => ({ hash, length: bytes.length })) };
  const header = Buffer.from(JSON.stringify(manifest));
  if (header.length > MAX_MANIFEST) throw new Error('CBMODEL 文件索引過大');
  const compressedHeader = await compress(header, BROTLI_OPTIONS);
  if (compressedHeader.length > MAX_MANIFEST) throw new Error('CBMODEL 壓縮索引過大');
  const size = Buffer.alloc(4); size.writeUInt32LE(compressedHeader.length);
  return Buffer.concat([MAGIC, size, compressedHeader, ...blocks.map(block => block.bytes), ...blobs.values()]);
}

function isArchiveV2(bytes) { return bytes.length >= MAGIC.length && bytes.subarray(0, MAGIC.length).equals(MAGIC); }

function unpackArchive(bytes) {
  if (!isArchiveV2(bytes)) return unpackZip(bytes);
  if (bytes.length < 12) throw new Error('CBMODEL 文件標頭不完整');
  const length = bytes.readUInt32LE(8);
  if (!length || length > MAX_MANIFEST || 12 + length > bytes.length) throw new Error('CBMODEL 文件索引損壞');
  const header = zlib.brotliDecompressSync(bytes.subarray(12, 12 + length), { maxOutputLength: MAX_MANIFEST });
  const manifest = JSON.parse(header.toString('utf8'));
  if (manifest.format !== 'cubebricks-archive' || manifest.version !== 2
    || !Array.isArray(manifest.files) || !Array.isArray(manifest.blocks) || !Array.isArray(manifest.blobs)
    || manifest.files.length > 200000 || manifest.blocks.length > 200000
    || manifest.blobs.length > 200000) throw new Error('CBMODEL 文件版本或索引不正確');
  let cursor = 12 + length, total = 0, expandedBlocks = 0, binaryTotal = 0;
  const blocks = [];
  for (const block of manifest.blocks) {
    if (!Number.isSafeInteger(block.length) || block.length < 0 || !Number.isSafeInteger(block.size)
      || block.size < 0 || (expandedBlocks += block.size) > MAX_TOTAL
      || cursor + block.length > bytes.length) throw new Error('CBMODEL 壓縮區塊損壞');
    const plain = zlib.brotliDecompressSync(bytes.subarray(cursor, cursor + block.length), { maxOutputLength: Math.max(1, block.size) });
    if (plain.length !== block.size || sha(plain) !== block.hash) throw new Error('CBMODEL 壓縮區塊校驗失敗');
    blocks.push(plain); cursor += block.length;
  }
  const blobs = new Map();
  for (const blob of manifest.blobs) {
    if (!/^[a-f0-9]{64}$/.test(blob.hash) || !Number.isSafeInteger(blob.length) || blob.length < 0
      || blob.length > MAX_ENTRY || (binaryTotal += blob.length) > MAX_TOTAL
      || cursor + blob.length > bytes.length || blobs.has(blob.hash)) throw new Error('CBMODEL 圖片區塊損壞');
    const image = bytes.subarray(cursor, cursor + blob.length);
    if (sha(image) !== blob.hash) throw new Error('CBMODEL 圖片區塊校驗失敗');
    blobs.set(blob.hash, image); cursor += blob.length;
  }
  if (cursor !== bytes.length) throw new Error('CBMODEL 文件末尾包含額外資料');
  const result = new Map();
  for (const file of manifest.files) {
    if (!validName(file.name) || result.has(file.name) || !Number.isSafeInteger(file.block)
      || !Number.isSafeInteger(file.offset) || !Number.isSafeInteger(file.length)
      || file.block < 0 || file.offset < 0 || file.length < 0
      || file.offset + file.length > (blocks[file.block]?.length ?? -1)
      || !Number.isSafeInteger(file.originalLength) || file.originalLength < 0 || file.originalLength > MAX_ENTRY
      || (total += file.originalLength) > MAX_TOTAL) throw new Error('CBMODEL 文件項目索引損壞');
    const transformed = blocks[file.block].subarray(file.offset, file.offset + file.length);
    const plain = restoreImages(transformed, file.images, blobs);
    if (plain.length !== file.originalLength || sha(plain) !== file.hash) throw new Error(`CBMODEL 文件校驗失敗：${file.name}`);
    result.set(file.name, plain);
  }
  return result;
}

// Opening uses the asynchronous decoder so the progress IPC and dialog can
// update between blocks. Keep the synchronous decoder for existing callers.
async function unpackArchiveWithProgress(bytes, onProgress = () => {}) {
  if (!isArchiveV2(bytes)) {
    onProgress(0, '解壓舊版項目');
    await new Promise(resolve => setImmediate(resolve));
    const entries = unpackZip(bytes, { onProgress });
    onProgress(1, '舊版項目已解壓');
    return entries;
  }
  if (bytes.length < 12) throw new Error('CBMODEL 文件標頭不完整');
  const length = bytes.readUInt32LE(8);
  if (!length || length > MAX_MANIFEST || 12 + length > bytes.length) throw new Error('CBMODEL 文件索引損壞');
  const header = await decompress(bytes.subarray(12, 12 + length), { maxOutputLength: MAX_MANIFEST });
  const manifest = JSON.parse(header.toString('utf8'));
  if (manifest.format !== 'cubebricks-archive' || manifest.version !== 2
    || !Array.isArray(manifest.files) || !Array.isArray(manifest.blocks) || !Array.isArray(manifest.blobs)
    || manifest.files.length > 200000 || manifest.blocks.length > 200000
    || manifest.blobs.length > 200000) throw new Error('CBMODEL 文件版本或索引不正確');
  let cursor = 12 + length, total = 0, expandedBlocks = 0, binaryTotal = 0;
  const blocks = [], blobs = new Map(), result = new Map();
  const steps = Math.max(1, manifest.blocks.length + manifest.blobs.length + manifest.files.length);
  let completed = 0;
  const advance = label => onProgress(++completed / steps, label);
  onProgress(0, '正在讀取項目索引');
  for (const block of manifest.blocks) {
    if (!Number.isSafeInteger(block.length) || block.length < 0 || !Number.isSafeInteger(block.size)
      || block.size < 0 || (expandedBlocks += block.size) > MAX_TOTAL
      || cursor + block.length > bytes.length) throw new Error('CBMODEL 壓縮區塊損壞');
    const plain = await decompress(bytes.subarray(cursor, cursor + block.length), { maxOutputLength: Math.max(1, block.size) });
    if (plain.length !== block.size || sha(plain) !== block.hash) throw new Error('CBMODEL 壓縮區塊校驗失敗');
    blocks.push(plain); cursor += block.length;
    advance(`正在解壓區塊 ${blocks.length} / ${manifest.blocks.length}`);
  }
  for (const blob of manifest.blobs) {
    if (!/^[a-f0-9]{64}$/.test(blob.hash) || !Number.isSafeInteger(blob.length) || blob.length < 0
      || blob.length > MAX_ENTRY || (binaryTotal += blob.length) > MAX_TOTAL
      || cursor + blob.length > bytes.length || blobs.has(blob.hash)) throw new Error('CBMODEL 圖片區塊損壞');
    const image = bytes.subarray(cursor, cursor + blob.length);
    if (sha(image) !== blob.hash) throw new Error('CBMODEL 圖片區塊校驗失敗');
    blobs.set(blob.hash, image); cursor += blob.length;
    advance(`正在驗證圖片 ${blobs.size} / ${manifest.blobs.length}`);
    if (completed % 32 === 0) await new Promise(resolve => setImmediate(resolve));
  }
  if (cursor !== bytes.length) throw new Error('CBMODEL 文件末尾包含額外資料');
  for (const file of manifest.files) {
    if (!validName(file.name) || result.has(file.name) || !Number.isSafeInteger(file.block)
      || !Number.isSafeInteger(file.offset) || !Number.isSafeInteger(file.length)
      || file.block < 0 || file.offset < 0 || file.length < 0
      || file.offset + file.length > (blocks[file.block]?.length ?? -1)
      || !Number.isSafeInteger(file.originalLength) || file.originalLength < 0 || file.originalLength > MAX_ENTRY
      || (total += file.originalLength) > MAX_TOTAL) throw new Error('CBMODEL 文件項目索引損壞');
    const transformed = blocks[file.block].subarray(file.offset, file.offset + file.length);
    const plain = restoreImages(transformed, file.images, blobs);
    if (plain.length !== file.originalLength || sha(plain) !== file.hash) throw new Error(`CBMODEL 文件校驗失敗：${file.name}`);
    result.set(file.name, plain);
    advance(`正在還原檔案 ${result.size} / ${manifest.files.length}`);
    if (completed % 32 === 0) await new Promise(resolve => setImmediate(resolve));
  }
  return result;
}

module.exports = { MAGIC, isArchiveV2, packArchive, unpackArchive, unpackArchiveWithProgress };
