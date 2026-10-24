const fs = require('fs/promises');
const path = require('path');
const { unpackZip } = require('./zip-store.cjs');

const SAFE_ID = /^[a-z][a-z0-9_.-]{1,63}$/i;
const MAX_PACK_BYTES = 16 * 1024 * 1024;
const MAX_SCRIPT_BYTES = 128 * 1024;

function normalizedZipEntries(entries) {
  const names = [...entries.keys()];
  const rootPrefix = names.every(name => name.includes('/') && name.split('/')[0] === names[0].split('/')[0])
    ? `${names[0].split('/')[0]}/` : '';
  return new Map([...entries].map(([name, bytes]) => [name.slice(rootPrefix.length), bytes]));
}

async function loadShapePack(filePath, entry) {
  const zip = entry.isFile() && /\.zip$/i.test(entry.name);
  const folder = entry.isDirectory();
  if (!zip && !folder) return null;
  const packName = folder ? entry.name : entry.name.replace(/\.zip$/i, '');
  let entries;
  if (zip) {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_PACK_BYTES) throw new Error('ZIP 超過 16 MiB');
    entries = normalizedZipEntries(unpackZip(await fs.readFile(filePath), {
      maxEntrySize: 512 * 1024, maxTotalSize: 8 * 1024 * 1024
    }));
  } else {
    entries = new Map();
    const metadataPath = path.join(filePath, 'package.json');
    if ((await fs.stat(metadataPath)).size > 64 * 1024) throw new Error('package.json 過大');
    const metadata = await fs.readFile(metadataPath);
    entries.set('package.json', metadata);
    for (const child of await fs.readdir(path.join(filePath, 'shapes'), { withFileTypes: true })) {
      if (!child.isFile() || !/^[a-z0-9_.-]+\.(js|svg|png|webp)$/i.test(child.name)) continue;
      const childPath = path.join(filePath, 'shapes', child.name);
      if ((await fs.stat(childPath)).size > 512 * 1024) throw new Error(`Shape 包文件過大：${child.name}`);
      entries.set(`shapes/${child.name}`, await fs.readFile(childPath));
    }
  }
  const metadataBytes = entries.get('package.json');
  if (!metadataBytes || metadataBytes.length > 64 * 1024) throw new Error('缺少或過大的 package.json');
  const metadata = JSON.parse(metadataBytes.toString('utf8'));
  if (!Array.isArray(metadata.shapes) || !metadata.shapes.length) throw new Error('package.json 缺少 shapes 列表');
  const shapes = metadata.shapes.map(record => {
    if (!SAFE_ID.test(record.id) || !/^[a-z0-9_.-]+\.js$/i.test(record.file || '')) throw new Error('Shape ID 或文件名不合法');
    const source = entries.get(`shapes/${record.file}`);
    if (!source || source.length > MAX_SCRIPT_BYTES) throw new Error(`Shape 文件缺失或過大：${record.file}`);
    let icon = null;
    if (record.icon && /^[a-z0-9_.-]+\.(svg|png|webp)$/i.test(record.icon)) {
      const bytes = entries.get(`shapes/${record.icon}`);
      if (bytes && bytes.length <= 256 * 1024) {
        const mime = record.icon.endsWith('.svg') ? 'image/svg+xml' : record.icon.endsWith('.webp') ? 'image/webp' : 'image/png';
        icon = `data:${mime};base64,${bytes.toString('base64')}`;
      }
    }
    return { id: record.id, label: String(record.label || record.id),
      source: source.toString('base64'), icon };
  });
  return { name: packName, filename: entry.name, version: String(metadata.version || '0.0.0'),
    hotReload: metadata.hotReload !== false, shapes };
}

async function listShapePacks(root) {
  await fs.mkdir(root, { recursive: true });
  const packs = [], errors = [];
  for (const entry of (await fs.readdir(root, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    try {
      const pack = await loadShapePack(path.join(root, entry.name), entry);
      if (pack) packs.push(pack);
    } catch (error) { errors.push(`${entry.name}: ${error.message}`); }
  }
  return { packs, errors };
}

module.exports = { listShapePacks, loadShapePack };
