import { importBlockbench } from '../model.js';
import { ModelFormatId } from '../common/config/model-formats.js';
import { getBlockbenchBoxUv, isCubeFaceCulled } from '../common/core/geometry-utils.js';
import { TEMPLATE_FACE_COLORS } from '../texture/template-colors.js';
import { skinModelForTexture } from './skin-variant-layers.js';

const FACE_NAMES = ['north', 'south', 'east', 'west', 'up', 'down'];

function faceTextureIndex(face, sourceTextures) {
  const reference = face?.texture;
  if (reference === null) return -1;
  if (reference === undefined) return 0;
  const key = String(reference).replace(/^#/, '');
  const byId = sourceTextures.findIndex(texture => String(texture.id) === key || texture.uuid === key);
  return byId >= 0 ? byId : Number.isInteger(Number(key)) ? Number(key) : 0;
}

function templateImage(project, sourceTextures, textureIndex, uvWidth, uvHeight, rasterWidth, rasterHeight) {
  const canvas = document.createElement('canvas');
  canvas.width = rasterWidth;
  canvas.height = rasterHeight;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  const scaleU = rasterWidth / uvWidth, scaleV = rasterHeight / uvHeight;
  for (const cube of project.elements) {
    if (cube.type !== 'cube') continue;
    for (const faceName of FACE_NAMES) {
      const face = cube.faces?.[faceName];
      if (isCubeFaceCulled(face) || faceTextureIndex(face, sourceTextures) !== textureIndex) continue;
      const uv = Array.isArray(face?.uv) && face.uv.length >= 4 ? face.uv
        : getBlockbenchBoxUv(cube, faceName);
      if (!uv?.every(Number.isFinite)) continue;
      const x = Math.max(0, Math.floor(Math.min(uv[0], uv[2]) * scaleU));
      const y = Math.max(0, Math.floor(Math.min(uv[1], uv[3]) * scaleV));
      const right = Math.min(rasterWidth, Math.ceil(Math.max(uv[0], uv[2]) * scaleU));
      const bottom = Math.min(rasterHeight, Math.ceil(Math.max(uv[1], uv[3]) * scaleV));
      if (right <= x || bottom <= y) continue;
      const colors = TEMPLATE_FACE_COLORS[faceName];
      context.fillStyle = colors.fill;
      context.fillRect(x, y, right - x, bottom - y);
      context.strokeStyle = colors.outline;
      context.lineWidth = 1;
      context.strokeRect(x + .5, y + .5, Math.max(0, right - x - 1), Math.max(0, bottom - y - 1));
    }
  }
  return canvas.toDataURL('image/png');
}

export function createSkinProject(record, sourceModel, { name, textureMode = 'game', gameTexture = null } = {}) {
  const selectedTextureId = textureMode === 'game' && gameTexture?.id
    ? gameTexture.id : record.defaultTextureId;
  const model = skinModelForTexture(record, sourceModel, selectedTextureId);
  const project = importBlockbench(model);
  project.formatId = ModelFormatId.MINECRAFT_SKIN;
  project.modelType = 'skin';
  project.name = name || record.names?.zhHant || record.variant;
  project.formatData = {
    ...project.formatData,
    skinTemplate: { id: record.id, edition: record.edition, version: record.version,
      textureMode, gameTexture: gameTexture?.id || null }
  };
  const sourceTextures = sourceModel.textures || [];
  const assets = sourceTextures.map((texture, index) => {
    const uid = texture.uuid || crypto.randomUUID();
    const width = Math.max(1, Number(texture.uv_width) || Number(sourceModel.resolution?.width) || 64);
    const height = Math.max(1, Number(texture.uv_height) || Number(sourceModel.resolution?.height) || 64);
    const rasterWidth = Math.max(1, Number(texture.width) || width);
    const rasterHeight = Math.max(1, Number(texture.height) || height);
    const selectedName = index === 0 && gameTexture?.id ? gameTexture.id.split('/').pop() : texture.name;
    const name = textureMode === 'template'
      ? `${(texture.name || `skin_${index + 1}`).replace(/\.png$/i, '')}_template.png`
      : /\.png$/i.test(selectedName || '') ? selectedName : `${selectedName || `skin_${index + 1}`}.png`;
    return {
      _uid: uid, uuid: uid,
      id: texture.id ?? String(index), name,
      source: textureMode === 'template' ? templateImage(project, sourceTextures, index,
        width, height, rasterWidth, rasterHeight)
        : index === 0 && gameTexture?.source ? gameTexture.source : texture.source,
      uvWidth: width, uvHeight: height, useAsDefault: index === 0, kind: 'IMAGE', groupId: null
    };
  });
  if (!assets.length) {
    const width = Math.max(1, Number(sourceModel.resolution?.width) || 64);
    const height = Math.max(1, Number(sourceModel.resolution?.height) || 64);
    assets.push({
      _uid: crypto.randomUUID(), id: '0', name: 'skin_template.png',
      source: templateImage(project, [{ id: '0' }], 0, width, height, width, height),
      uvWidth: width, uvHeight: height, useAsDefault: true, kind: 'IMAGE', groupId: null
    });
  }
  project.textureSize = [assets[0].uvWidth, assets[0].uvHeight];
  return { project, textureAssets: assets };
}
