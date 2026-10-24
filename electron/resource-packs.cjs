const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { unpackZip } = require('./zip-store.cjs');
const { listShapePacks, loadShapePack } = require('./shape-packs.cjs');

const FOLDERS = Object.freeze({ shape: 'shapepacks', language: 'languagepacks', font: 'fontpacks' });
const FONT_EXTENSION = /\.(ttf|otf|woff2?)$/i;
const MAX_ARCHIVE = 32 * 1024 * 1024;
const SAFE_ENTRY = /^(?!.*[. ]$)[^\\/:*?"<>|.][^\\/:*?"<>|]*$/;

function folder(root, kind) {
  if (!FOLDERS[kind]) throw new Error('未知包類型');
  return path.join(root, FOLDERS[kind]);
}

async function entriesFromArchive(file) {
  const bytes = await fs.readFile(file);
  if (bytes.length > MAX_ARCHIVE) throw new Error('包文件超過 32 MiB');
  const unpacked = unpackZip(bytes, { maxEntrySize: 16 * 1024 * 1024, maxTotalSize: MAX_ARCHIVE });
  const names = [...unpacked.keys()];
  const prefix = names.length && names.every(name => name.startsWith(names[0].split('/')[0] + '/'))
    ? names[0].split('/')[0] + '/' : '';
  return new Map([...unpacked].map(([name, value]) => [name.slice(prefix.length), value]));
}

function languageFromObject(source, fallbackName) {
  const code = String(source.code || source.language || '');
  const label = String(source.label || source.name || code);
  const translations = source.translations || source.messages;
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/i.test(code)) throw new Error('語言代碼不合法');
  if (!translations || typeof translations !== 'object' || Array.isArray(translations)) throw new Error('缺少 translations 對照表');
  if (Object.entries(translations).some(([key, value]) => key.length > 500 || typeof value !== 'string' || value.length > 2000)) throw new Error('翻譯內容不合法');
  return { code, label: label.slice(0, 80), translations, name: fallbackName,
    hotReload: source.hotReload !== false };
}

async function loadLanguage(file, name) {
  let source;
  if (/\.zip$/i.test(name)) {
    const entries = await entriesFromArchive(file);
    const manifest = entries.get('package.json');
    const direct = entries.get('language.json');
    if (!manifest && !direct) throw new Error('語言 ZIP 缺少 language.json 或 package.json');
    if (direct) source = JSON.parse(direct.toString('utf8'));
    else {
      const metadata = JSON.parse(manifest.toString('utf8'));
      const entryName = metadata.translationsFile || 'translations.json';
      if (!/^[\w.-]+\.json$/i.test(entryName) || !entries.has(entryName)) throw new Error('翻譯文件不存在');
      source = { ...metadata, translations: JSON.parse(entries.get(entryName).toString('utf8')) };
    }
  } else {
    const bytes = await fs.readFile(file);
    if (bytes.length > 4 * 1024 * 1024) throw new Error('語言文件超過 4 MiB');
    source = JSON.parse(bytes.toString('utf8'));
  }
  return languageFromObject(source, name);
}

async function loadFont(file, name, { includeSources = true } = {}) {
  const archive = /\.zip$/i.test(name);
  const entries = archive ? await entriesFromArchive(file) : new Map([[name, await fs.readFile(file)]]);
  const manifest = entries.get('package.json');
  const metadata = manifest ? JSON.parse(manifest.toString('utf8')) : {};
  const fonts = [...entries].filter(([entryName]) => FONT_EXTENSION.test(entryName)).map(([entryName, bytes]) => {
    if (bytes.length > 16 * 1024 * 1024) throw new Error('字體文件超過 16 MiB');
    const extension = path.extname(entryName).toLowerCase();
    const signature = bytes.subarray(0, 4).toString('latin1');
    const valid = extension === '.ttf' ? (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x00010000) || signature === 'true'
      : extension === '.otf' ? signature === 'OTTO'
        : extension === '.woff' ? signature === 'wOFF' : signature === 'wOF2';
    if (!valid) throw new Error(`字體文件標頭不正確：${entryName}`);
    const mime = extension === '.woff2' ? 'font/woff2' : extension === '.woff' ? 'font/woff'
      : extension === '.otf' ? 'font/otf' : 'font/ttf';
    return includeSources ? { file: entryName, source: `data:${mime};base64,${bytes.toString('base64')}` }
      : { file: entryName };
  });
  if (!fonts.length) throw new Error('包內沒有可用字體');
  return { name: String(metadata.name || name.replace(/\.(zip|ttf|otf|woff2?)$/i, '')).slice(0, 80),
    version: String(metadata.version || '1.0.0'), hotReload: metadata.hotReload !== false, fonts };
}

async function preferences(root) {
  const file = path.join(root, 'pack-order.json');
  const value = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => ({}));
  return value && typeof value === 'object' ? value : {};
}

function sortPacks(items, order = []) {
  return items.sort((a, b) => {
    const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
    return (ai < 0 ? 1e9 : ai) - (bi < 0 ? 1e9 : bi) || a.name.localeCompare(b.name);
  });
}

async function listResourcePacks(root) {
  const pref = await preferences(root);
  const packs = [], errors = [];
  for (const kind of ['shape', 'language', 'font']) {
    const directory = folder(root, kind);
    await fs.mkdir(directory, { recursive: true });
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const filename = entry.name, file = path.join(directory, filename);
      if (!entry.isFile() && !(kind === 'shape' && entry.isDirectory())) continue;
      if (kind === 'font' && !FONT_EXTENSION.test(filename) && !/\.zip$/i.test(filename)) continue;
      if (kind === 'language' && !/\.(json|zip)$/i.test(filename)) continue;
      if (kind === 'shape' && !entry.isDirectory() && !/\.zip$/i.test(filename)) continue;
      try {
        const data = kind === 'shape' ? await loadShapePack(file, entry)
          : kind === 'language' ? await loadLanguage(file, filename) : await loadFont(file, filename, { includeSources: false });
        packs.push({ kind, id: `${kind}:${filename}`, filename, name: data.name,
          version: data.version || '1.0.0', hotReload: data.hotReload !== false,
          ...(kind === 'language' ? { code: data.code, label: data.label, translations: data.translations } : {}),
          ...(kind === 'font' ? { fonts: data.fonts } : {}) });
      } catch (error) { errors.push(`${filename}: ${error.message}`); }
    }
  }
  return { packs: sortPacks(packs, pref.order), errors };
}

async function orderedShapePacks(root) {
  const result = await listShapePacks(folder(root, 'shape'));
  const pref = await preferences(root);
  result.packs = sortPacks(result.packs.map(pack => ({ ...pack, id: `shape:${pack.filename}` })), pref.order);
  return result;
}

async function installPack(root, kind, source) {
  const name = path.basename(source);
  if (!SAFE_ENTRY.test(name) || name === '.' || name === '..') throw new Error('文件名不合法');
  if (kind === 'shape') {
    if (!/\.zip$/i.test(name)) throw new Error('Shape 包請使用 ZIP');
    await loadShapePack(source, { name, isFile: () => true, isDirectory: () => false });
  }
  else if (kind === 'language') {
    if (!/\.(json|zip)$/i.test(name)) throw new Error('語言包請使用 JSON 或 ZIP');
    await loadLanguage(source, name);
  }
  else if (kind === 'font') {
    if (!FONT_EXTENSION.test(name) && !/\.zip$/i.test(name)) throw new Error('不支援的字體格式');
    await loadFont(source, name, { includeSources: false });
  }
  else throw new Error('未知包類型');
  const destination = path.join(folder(root, kind), name);
  await fs.mkdir(folder(root, kind), { recursive: true });
  await fs.copyFile(source, destination, require('fs').constants.COPYFILE_EXCL);
  return `${kind}:${name}`;
}

async function readFontPack(root, id) {
  const name = String(id).startsWith('font:') ? String(id).slice(5) : '';
  if (!SAFE_ENTRY.test(name) || name === '.' || name === '..') throw new Error('字體包識別碼不合法');
  return loadFont(path.join(folder(root, 'font'), name), name);
}

async function removePack(root, id) {
  const split = String(id).indexOf(':');
  const kind = String(id).slice(0, split), name = String(id).slice(split + 1);
  if (!FOLDERS[kind] || !SAFE_ENTRY.test(name) || name === '.' || name === '..') throw new Error('包識別碼不合法');
  const source = path.join(folder(root, kind), name);
  if (path.dirname(source) !== folder(root, kind)) throw new Error('包路徑不合法');
  const archive = path.join(root, 'removed-packs');
  await fs.mkdir(archive, { recursive: true });
  const target = path.join(archive, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${kind}-${name}`);
  await fs.rename(source, target);
  return target;
}

async function savePackOrder(root, order) {
  if (!Array.isArray(order) || order.length > 1000 || order.some(id => typeof id !== 'string' || id.length > 255)) throw new Error('包排序不合法');
  const file = path.join(root, 'pack-order.json'), temp = file + '.tmp';
  await fs.writeFile(temp, JSON.stringify({ order }, null, 2));
  await fs.rename(temp, file);
}

module.exports = { listResourcePacks, orderedShapePacks, installPack, removePack, savePackOrder,
  loadLanguage, loadFont, readFontPack };
