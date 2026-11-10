const fs = require('node:fs/promises');
const path = require('node:path');
const { textureLocation, resourceCandidates } = require('./native-model-io.cjs');
const { readTextureAnimationMetadata } = require('./texture-animation-metadata.cjs');

function pngBytes(source) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(source || ''));
  if (!match) throw Error('贴图不是有效的 PNG');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length < 24 || bytes.length > 256 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('贴图 PNG 数据无效');
  return bytes;
}

function registerTextureFiles(handleIpc, saveFileDialog, atomicWrite) {
  handleIpc('texture:save', async (event, payload = {}) => {
    const bytes = pngBytes(payload.source);
    const supplied = typeof payload.filePath === 'string' && path.isAbsolute(payload.filePath) && /\.png$/i.test(payload.filePath) ? payload.filePath : null;
    const name = path.basename(String(payload.name || 'texture.png')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.[^.]+$/, '') + '.png';
    const picked = supplied ? { filePath: supplied } : await saveFileDialog(event, { title: 'ui.message-56',
      defaultPath: name, filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (picked.canceled || !picked.filePath) return null;
    const filePath = /\.png$/i.test(picked.filePath) ? picked.filePath : `${picked.filePath}.png`;
    let metadata = null;
    if (payload.metadata) {
      const value = JSON.stringify(payload.metadata);
      if (Buffer.byteLength(value) > 1024 * 1024 || !payload.metadata.animation || !Number.isInteger(payload.metadata.animation.frametime) || payload.metadata.animation.frametime < 1) throw Error('贴图动画配置无效');
      metadata = value;
    }
    await atomicWrite(filePath, bytes);
    if (metadata) await atomicWrite(`${filePath}.mcmeta`, metadata);
    else await fs.rm(`${filePath}.mcmeta`, { force: true });
    return textureLocation(filePath, payload.namespace);
  });
}

async function readTextureAssets(content, modelPath) {
  let model; try { model = JSON.parse(content); } catch { return []; }
  const assets = [];
  for (const texture of Array.isArray(model.textures) ? model.textures : []) {
    let source = null, loadedPath = null;
    const candidates = [];
    if (texture.relative_path) candidates.push(path.resolve(path.dirname(modelPath), texture.relative_path));
    if (texture.path) candidates.push(path.isAbsolute(texture.path) ? texture.path : path.resolve(path.dirname(modelPath), texture.path));
    candidates.push(...resourceCandidates(texture.resource, modelPath));
    for (const candidate of candidates) {
      try {
        const bytes = await fs.readFile(candidate), extension = path.extname(candidate).toLowerCase();
        const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : extension === '.gif' ? 'image/gif' : 'image/png';
        source = `data:${mime};base64,${bytes.toString('base64')}`; loadedPath = candidate; break;
      } catch { /* An unresolved game resource remains assignable in the editor. */ }
    }
    if (!source && String(texture.source).startsWith('data:image/')) source = texture.source;
    if (!source) continue;
    const imported = model.meta?.model_format;
    assets.push({ uuid: texture.uuid, id: texture.id, name: texture.name || path.basename(loadedPath || 'texture.png'), source,
      uvWidth: texture.uv_width, uvHeight: texture.uv_height, useAsDefault: texture.use_as_default === true,
      groupId: texture.group_id || null, kind: texture.kind || 'IMAGE', templateUvIndependent: texture.template_uv_independent ?? null,
      mode: texture.mode === 'bitmap' || texture.mode === 'link' ? 'default' : texture.mode || 'default',
      layers: texture.layers || null, activeLayerUid: texture.active_layer_uid || null, animation: texture.animation || null,
      namespace: texture.namespace, externalFile: texture.external_file || (imported ? { imported: true, path: loadedPath } : null),
      animationMetadata: loadedPath && imported ? await readTextureAnimationMetadata({ filePath: loadedPath }) : null });
  }
  return assets;
}

module.exports = { pngBytes, registerTextureFiles, readTextureAssets };
