const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let jsonCodec, javaCodec;
const codecs = () => jsonCodec ||= import(pathToFileURL(path.join(__dirname, '../src/model/formats/native-json.js')).href);

function textureLocation(filePath, namespace = 'minecraft') {
  const normalized = filePath.replaceAll('\\', '/');
  const java = /(?:^|\/)assets\/([^/]+)\/textures\/(.+)\.png$/i.exec(normalized);
  const bedrock = /(?:^|\/)(textures\/.+)\.png$/i.exec(normalized);
  const valid = value => String(value).toLowerCase().replace(/[^a-z0-9_./-]/g, '_');
  return { filePath, namespace: java ? java[1] : namespace,
    resource: java ? `${java[1]}:${java[2]}` : bedrock ? bedrock[1] : `${valid(namespace || 'minecraft')}:${valid(path.basename(filePath, path.extname(filePath)))}` };
}

function resourceCandidates(resource, modelPath) {
  const directory = path.dirname(modelPath), normalized = modelPath.replaceAll('\\', '/');
  const value = String(resource || '').replace(/\.png$/i, '');
  if (!value || value.startsWith('#') || value.includes('..') || path.isAbsolute(value)) return [];
  const [namespace, resourcePath] = value.includes(':') ? value.split(':', 2) : ['minecraft', value];
  const candidates = [path.resolve(directory, `${resourcePath}.png`), path.resolve(directory, `${path.basename(resourcePath)}.png`)];
  const assets = normalized.lastIndexOf('/assets/');
  if (assets >= 0) candidates.unshift(path.resolve(normalized.slice(0, assets), 'assets', namespace, 'textures', `${resourcePath}.png`));
  const models = normalized.lastIndexOf('/models/');
  if (models >= 0) candidates.push(path.resolve(normalized.slice(0, models), `${resourcePath}.png`));
  return candidates;
}

async function readNativeModel(content, modelPath, { chooseGeometry, chooseBedrockFormat } = {}) {
  let data;
  if (/\.java$/i.test(modelPath)) {
    javaCodec ||= import(pathToFileURL(path.join(__dirname, '../src/model/formats/modded-java.js')).href);
    data = await (await javaCodec).importModdedJava(content);
  } else data = JSON.parse(content.replace(/^\uFEFF/, ''));
  if (!/\.(json|java)$/i.test(modelPath)) return data;
  let reference = null;
  try {
    const text = await fs.readFile(`${modelPath}.cbtextures.json`, 'utf8');
    if (text.length > 4 * 1024 * 1024) throw Error('模型贴图索引过大');
    reference = JSON.parse(text);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const textures = Array.isArray(reference?.textures) ? reference.textures : [];
  if (data['minecraft:geometry']?.length > 1 && chooseGeometry) {
    const index = await chooseGeometry(data['minecraft:geometry'].map((geometry, index) => geometry.description?.identifier || String(index + 1)));
    if (index === null) return null;
    data = { ...data, 'minecraft:geometry': [data['minecraft:geometry'][index]] };
  }
  if ((data['minecraft:geometry'] || Object.keys(data).some(key => key.startsWith('geometry.') && data[key]?.bones)) && !reference?.formatId && chooseBedrockFormat) {
    const formatId = await chooseBedrockFormat(); if (!formatId) return null;
    reference = { ...reference, formatId };
  }
  const bb = (await codecs()).decodeNativeJson(data, path.basename(modelPath), textures, reference?.formatId);
  if (/\.java$/i.test(modelPath) && reference?.textures?.length) {
    bb.textures.forEach((texture, index) => {
      const saved = reference.textures[index]; if (saved?.relative_path) { texture.relative_path = saved.relative_path; texture.path = ''; }
    });
  }
  if (data['minecraft:geometry'] && (!bb.textures?.length || bb.textures.length === 1 && !bb.textures[0].resource && !bb.textures[0].path && !bb.textures[0].relative_path)) {
    const candidate = path.join(path.dirname(modelPath), path.basename(modelPath).replace(/(?:\.geo)?\.json$/i, '.png'));
    try {
      await fs.access(candidate);
      if (bb.textures.length) { bb.textures[0].path = candidate; bb.textures[0].name = path.basename(candidate); }
      else bb.textures = [{ uuid: crypto.randomUUID(), id: '0', path: candidate, name: path.basename(candidate) }];
    } catch { /* An external geometry may require manual material assignment. */ }
  }
  return bb;
}

async function writeTextureReferences(modelPath, formatId, textures, atomicWrite) {
  const references = textures.map((texture, index) => ({ id: String(index), name: path.basename(texture.filePath),
    relative_path: path.relative(path.dirname(modelPath), texture.filePath).replaceAll('\\', '/'),
    resource: texture.resource, material: `texture_${index}`, uv_width: texture.uvWidth, uv_height: texture.uvHeight }));
  await atomicWrite(`${modelPath}.cbtextures.json`, JSON.stringify({ format: 'cubebricks-texture-references', version: 1, formatId, textures: references }, null, 2));
}

module.exports = { readNativeModel, textureLocation, resourceCandidates, writeTextureReferences };
