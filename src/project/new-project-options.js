import { createModelProjectData, ModelFormatId } from '../common/config/model-formats.js';
import { JavaBlockVersion, normalizeJavaBlockVersion } from '../common/core/java-block-version.js';

export const JAVA_BLOCK_VERSIONS = Object.freeze([
  { value: JavaBlockVersion.LEGACY, label: '1.9 – 1.21.5 · 22.5°／單軸' },
  { value: JavaBlockVersion.SINGLE_AXIS, label: '1.21.6 – 1.21.10 · 自由角度／單軸' },
  { value: JavaBlockVersion.UNRESTRICTED, label: '1.21.11+ · 無限制' }
]);

export function availableUvModes(format) {
  return [
    ...(format.capabilities?.boxUv ? [{ value: 'box', label: '箱型 UV' }] : []),
    ...(format.capabilities?.faceUv ? [{ value: 'face', label: '逐面 UV' }] : [])
  ];
}

export function newProjectDefaults(format, language) {
  const data = createModelProjectData(format.id, { name: 'untitled', language });
  return {
    name: 'untitled',
    javaBlockVersion: JavaBlockVersion.LEGACY,
    uvMode: availableUvModes(format).some(mode => mode.value === data.uvMode)
      ? data.uvMode : availableUvModes(format)[0]?.value || data.uvMode,
    textureWidth: data.textureSize?.[0] || 16,
    textureHeight: data.textureSize?.[1] || 16,
    snap: data.snap?.subdivisions || 16,
    historyLimit: data.historyLimit ?? null,
    description: data.formatData?.projectDescription || ''
  };
}

export function prepareNewProjectData(format, language, options) {
  const name = String(options.name || '').trim();
  const width = Number(options.textureWidth), height = Number(options.textureHeight);
  const snap = Number(options.snap);
  const historyText = String(options.historyLimit ?? '').trim();
  const historyLimit = historyText ? Number(historyText) : null;
  if (!name) throw new Error('請輸入項目名稱');
  if (![width, height].every(value => Number.isInteger(value) && value >= 1 && value <= 8192))
    throw new Error('貼圖寬高必須是 1 至 8192 的整數');
  if (!Number.isFinite(snap) || snap < .0001) throw new Error('請輸入有效的標準吸附精度');
  if (historyLimit !== null && (!Number.isInteger(historyLimit) || historyLimit < 0 || historyLimit > 10000))
    throw new Error('操作歷史上限必須是 0 至 10000 的整數');
  const modes = availableUvModes(format);
  if (!modes.some(mode => mode.value === options.uvMode)) throw new Error('此格式不支援所選 UV 模式');
  const data = createModelProjectData(format.id, { name, language });
  data.name = name;
  data.textureSize = [width, height];
  data.snap = { ...data.snap, subdivisions: snap };
  data.uvMode = options.uvMode;
  data.historyLimit = historyLimit;
  data.formatData = { ...data.formatData, projectDescription: String(options.description || '').trim().slice(0, 1000) };
  if (format.id === ModelFormatId.JAVA_BLOCK_ITEM) {
    data.formatData = { ...data.formatData,
      javaBlockVersion: normalizeJavaBlockVersion(options.javaBlockVersion) };
  }
  return data;
}
